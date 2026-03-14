import { getMessageLocally, saveMessageLocally } from './localMessageStore';
import { mediaKeyCache } from './mediaKeyCache';
import { runMediaDecryptionPipeline, getEffectiveAttachmentId } from './cryptoService';
import { blobCache } from './blobCache';

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

        // Hydrate media immediately before scrubbing keys (or use the binary keys directly)
        this.scheduleMediaHydration(decryptedNote);

        if (decryptedNote.isDecrypted && decryptedNote.attachments && decryptedNote.attachments.length > 0) {
            for (const [idx, att] of decryptedNote.attachments.entries()) {
                if (att.binaryAesKey) {
                    delete att.binaryAesKey;
                    delete att.binaryIv;
                }
            }
        }

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

            for (const att of note.attachments) {
                const effectiveId = getEffectiveAttachmentId(att);
                const cacheKey = `${note._id}_${effectiveId}`;

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
                        runMediaDecryptionPipeline(note._id, att, aesKey, iv).catch(() => { });
                    }
                } catch (err) {
                    console.warn(`[Hydration] Failed for ${note._id}/${effectiveId}`, err);
                }
            }
        });
    }
};
