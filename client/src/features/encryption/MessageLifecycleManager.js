import { getMessageLocally, saveMessageLocally } from './localMessageStore';
import { mediaKeyCache } from './mediaKeyCache';
import { runMediaDecryptionPipeline, getEffectiveAttachmentId, getBlobCacheKey } from './cryptoService';
import { blobCache } from './blobCache';
import { decryptMessage } from './messageDecryptor';

// Global map to hold promises for currently processing messages
const processingLocks = new Map();

export const MessageLifecycleManager = {
    async processMessage(rawMessage, decryptIncomingFn) {
        if (!rawMessage || !rawMessage._id) return rawMessage;

        if (processingLocks.has(rawMessage._id)) {
            return processingLocks.get(rawMessage._id);
        }

        const processPromise = this._internalProcess(rawMessage, decryptIncomingFn);
        processingLocks.set(rawMessage._id, processPromise);

        try {
            const result = await processPromise;
            return result;
        } finally {
            processingLocks.delete(rawMessage._id);
        }
    },

    async processMessages(rawMessages, decryptIncomingFn) {
        const processed = [];
        for (const msg of rawMessages) {
            try {
                const result = await this.processMessage(msg, decryptIncomingFn);
                processed.push(result);
            } catch (err) {
                console.error(`Failed to process message ${msg._id}:`, err);
                processed.push({ ...msg, noteText: "🔐 Decryption error", isDecrypted: false });
            }
        }
        return processed;
    },

    async _internalProcess(rawMessage, decryptIncomingFn) {
        if (!rawMessage.ciphertext) {
            return { ...rawMessage, noteText: rawMessage.noteText || "🔐 Error: Missing ciphertext", isDecrypted: false };
        }

        if (rawMessage.isDecrypted) {
            // Even if already marked decrypted (e.g. sender sync), ensure media is hydrated
            this.scheduleMediaHydration(rawMessage);
            return rawMessage;
        }

        const local = await getMessageLocally(rawMessage._id);
        if (local) {
            // CRITICAL CACHE FIX: ALWAYS TRUST SERVER FOR MUTATIONS
            // The local DB has the raw decrypted media/text, but the Server knows if it was deleted/edited.
            local.isDeletedForEveryone = rawMessage.isDeletedForEveryone || local.isDeletedForEveryone;
            local.isDeletedForMe = rawMessage.isDeletedForMe || local.isDeletedForMe;
            local.isDeleted = rawMessage.isDeleted || local.isDeleted;
            local.deletedForUsers = rawMessage.deletedForUsers || local.deletedForUsers;

            // 🔴 CRITICAL VERSION LOCK: Hydration validation
            if (rawMessage.isEdited) {
                const userId = localStorage.getItem('userId');
                const cached = await mediaKeyCache.getMediaKey(userId, rawMessage._id, "text");

                if (cached && cached.version === rawMessage.version && cached.decryptedText) {
                    // CACHE IS VALID: Safe to use
                    local.plaintextEdit = cached.decryptedText;
                    local.isEditReady = true;
                } else {
                    // CACHE IS STALE: Force fresh decryption
                    // 🔴 BYPASS decryptIncomingFn() — call raw decryptMessage() directly
                    const encryptedSource = rawMessage.ciphertextEdit;
                    if (encryptedSource) {
                        try {
                            const rawDecrypted = await decryptMessage(
                                rawMessage.senderId,
                                rawMessage.editType || 1,
                                encryptedSource
                            );
                            if (rawDecrypted && typeof rawDecrypted === 'string') {
                                local.plaintextEdit = rawDecrypted;
                                local.isEditReady = true;
                                await mediaKeyCache.saveMediaKey(userId, rawMessage._id, "text", {
                                    decryptedText: rawDecrypted,
                                    version: rawMessage.version
                                });
                            }
                        } catch (e) {
                            console.warn("Hydration edit decrypt fail", e);
                            // Last resort: use stale cache if available
                            if (cached?.decryptedText) {
                                local.plaintextEdit = cached.decryptedText;
                                local.isEditReady = true;
                            }
                        }
                    }
                }

                local.version = rawMessage.version;
                local.isEdited = true;
                local.editedAt = rawMessage.editedAt;
            }

            this.scheduleMediaHydration(local);
            return local;
        }

        const currentUserId = localStorage.getItem('userId');
        if (rawMessage.senderId === currentUserId) {
            const decryptedNote = await decryptIncomingFn(rawMessage);
            if (decryptedNote && decryptedNote.isDecrypted === undefined) {
                decryptedNote.isDecrypted = true;
            }
            this.scheduleMediaHydration(decryptedNote);
            return decryptedNote;
        }

        const decryptedNote = await decryptIncomingFn(rawMessage);

        if (decryptedNote.noteText && decryptedNote.noteText.includes("🔐") &&
            (decryptedNote.noteText.includes("Bad MAC") || decryptedNote.noteText.includes("No record for device") || decryptedNote.noteText.includes("Decryption error"))) {

            decryptedNote.isDecrypted = false;
            decryptedNote.permanentlyFailed = true;
            decryptedNote.noteText = "🔐 Messages from previous session cannot be decrypted";

            await saveMessageLocally(decryptedNote);
            return decryptedNote;
        }

        // CRITICAL: Save keys to IndexedDB BEFORE deleting from object
        // scheduleMediaHydration runs in a microtask (LATER), so keys would be gone by then
        if (decryptedNote.isDecrypted && decryptedNote.attachments && decryptedNote.attachments.length > 0) {
            const userId = localStorage.getItem('userId');
            for (const [idx, att] of decryptedNote.attachments.entries()) {
                if (att.binaryAesKey) {
                    const effectiveId = getEffectiveAttachmentId(att, idx);
                    await mediaKeyCache.saveMediaKey(userId, decryptedNote._id, effectiveId, {
                        aesKey: att.binaryAesKey
                    });
                    delete att.binaryAesKey;
                    delete att.binaryIv;
                }
            }
        }

        // Now hydrate media — keys are safely in IndexedDB for the pipeline to find
        this.scheduleMediaHydration(decryptedNote);

        if (decryptedNote.isDecrypted) {
            await saveMessageLocally(decryptedNote);
        }

        return decryptedNote;
    },

    /**
     * Non-blocking background hydration of all media in a message.
     * Uses microtasks to ensure UI responsiveness.
     */
    scheduleMediaHydration(note) {
        if (!note.attachments || note.attachments.length === 0) return;

        // Use queueMicrotask to defer decryption until after the current processing batch
        queueMicrotask(async () => {
            const userId = localStorage.getItem('userId');

            for (const [idx, att] of note.attachments.entries()) {
                const effectiveId = getEffectiveAttachmentId(att, idx);
                const cacheKey = getBlobCacheKey(note._id, att, idx);

                // Skip if already in memory cache
                if (blobCache.has(cacheKey)) continue;

                try {
                    // Retrieval: If keys are missing (post-scrub), look them up in IndexedDB
                    let aesKey = att.binaryAesKey;
                    let iv = att.binaryIv || att.iv;

                    if (!aesKey) {
                        const cached = await mediaKeyCache.getMediaKey(userId, note._id, effectiveId);
                        if (cached) {
                            aesKey = cached.aesKey || cached.binaryAesKey;
                            iv = iv || cached.iv;
                        }
                    }

                    // Trigger pipeline (deduplicated by mediaDecryptionLocks)
                    if (att.url && !att.url.startsWith('blob:')) {
                        runMediaDecryptionPipeline(note._id, att, aesKey, iv, idx).catch(() => { });
                    }
                } catch (err) {
                    console.warn(`[Hydration] Failed for ${note._id}/${effectiveId}`, err);
                }
            }
        });
    }
};
