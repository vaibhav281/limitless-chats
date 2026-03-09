import { useState, useCallback, useEffect } from 'react';
import { generateAndUploadKeys, clearLocalKeys } from '../features/encryption/keyManager';
import { encryptMessage } from '../features/encryption/messageEncryptor';
import { decryptMessage } from '../features/encryption/messageDecryptor';
import { encryptFile, decryptFile, uint8ToBase64, base64ToUint8, ensureUint8Array } from '../features/encryption/cryptoService';
import { mediaKeyCache } from '../features/encryption/mediaKeyCache';
import axios from 'axios';

// Global mutex to ensure Signal ratchets are processed strictly sequentially across the entire session.
// Since SignalStore is a singleton, the lock must also be global to this JS context.
let globalSignalMutex = Promise.resolve();

export default function useEncryptedMessaging(userId) {
    const [isKeysReady, setIsKeysReady] = useState(false);

    // Initialize E2EE Keys on App Load
    useEffect(() => {
        if (!userId) return;
        generateAndUploadKeys(userId)
            .then(() => setIsKeysReady(true))
            .catch(err => console.error("E2EE Init Error", err));
    }, [userId]);

    /**
     * Encrypts outgoing text and files
     */
    const encryptOutgoing = useCallback(async (receiverId, plaintext, plainFiles = []) => {
        try {
            // Always encrypt to advance the Signal Double Ratchet precisely once per message
            // If the message is only attachments, we encrypt a placeholder to maintain session lockstep
            const payload = plaintext || "__media__";
            const encryptedTextPayload = await encryptMessage(receiverId, payload);

            const encryptedFiles = [];
            for (const fileObj of plainFiles) {
                // 1. Encrypt File with random AES-GCM Key
                const { ciphertextBlob, keyBase64, ivBase64 } = await encryptFile(fileObj.file);

                const encryptedKeysMap = {};

                // Use a stable UUID instead of a volatile array index (Adjustment for Phase 1)
                const attachmentId = typeof crypto !== 'undefined' && crypto.randomUUID
                    ? crypto.randomUUID()
                    : Date.now().toString(36) + Math.random().toString(36).slice(2);

                // 2. Encrypt the *AES Key* itself via Signal Double Ratchet for the receiver
                if (receiverId !== 'global_group') {
                    try {
                        const encryptedKeyPayloadReceiver = await encryptMessage(receiverId, keyBase64);
                        encryptedKeysMap[receiverId] = {
                            key: encryptedKeyPayloadReceiver.body, // Natively base64 string from libsignal
                            type: encryptedKeyPayloadReceiver.type
                        };
                    } catch (err) {
                        console.error("Failed to encrypt AES key for receiver", err);
                    }
                }

                // 3. Encrypt the *AES Key* for OURSELVES (multi-device/refresh resilience)
                try {
                    const encryptedKeyPayloadSender = await encryptMessage(userId, keyBase64);
                    encryptedKeysMap[userId] = {
                        key: encryptedKeyPayloadSender.body, // Natively base64 string from libsignal
                        type: encryptedKeyPayloadSender.type
                    };
                } catch (err) {
                    console.error("Failed to encrypt AES key for sender", err);
                }

                encryptedFiles.push({
                    // Supply stable attachmentId into the persistent payload mapping!
                    attachmentId: attachmentId,
                    blob: ciphertextBlob,
                    encryptedKeysMap: JSON.stringify(encryptedKeysMap), // Send as stringified map
                    iv: ivBase64,
                    originalName: fileObj.origName || fileObj.originalName,
                    type: fileObj.type,
                    originalMimeType: fileObj.file.type,
                    // Strictly parse into proper typed Arrays for immediate Sender Optimistic Cache!
                    binaryAesKey: ensureUint8Array(base64ToUint8(keyBase64)),
                    binaryIv: ensureUint8Array(base64ToUint8(ivBase64))
                });
            }

            const result = {
                ciphertext: encryptedTextPayload.body,
                type: encryptedTextPayload.type,
                encryptedFiles
            };

            // 4. Cache OUTGOING message details immediately for refresh resilience
            // We give it a temporary ID or wait for the server? 
            // Actually, we usually get the server ID after sending. 
            // However, we can use the result but we need the note._id.
            // Since we don't have the final message ID yet, we'll rely on the receiver side
            // OR if the socket-reply includes the ID, we cache IT then.
            // For now, let's ensure decryptIncoming is bulletproof for sent messages.

            return result;
        } catch (err) {
            console.error("encryptOutgoing encountered an error:", err.message);
            throw err;
        }
    }, []);

    /**
     * Decrypts Incoming Notes (intercepting sockets / fetch calls before hitting state)
     */
    const decryptIncoming = useCallback(async (note) => {
        // Queue the decryption to ensure ratchets process strictly sequentially
        const currentMutex = globalSignalMutex;
        let releaseMutex;
        globalSignalMutex = new Promise(resolve => releaseMutex = resolve);

        await currentMutex; // wait for all prior decryptions to finish

        try {
            if (!note) return null;

            // 0. Check Persistent text cache FIRST
            const textCacheEntry = await mediaKeyCache.getMediaKey(userId, note._id, 'text');

            // 1. Determine who we are talking to (the "remote" party)
            const remoteUserId = note.senderId === userId ? note.receiverId : note.senderId;

            let decryptedText = "";
            if (note.ciphertext) {
                if (textCacheEntry && textCacheEntry.decryptedText) {
                    decryptedText = textCacheEntry.decryptedText;
                } else if (note.senderId === userId) {
                    // SENDER logic: If we are here after refresh, it means persistent cache missed.
                    // We NEVER attempt Signal decryption for our own outgoing text ratchet.
                    decryptedText = "🔐 Message sent (plaintext not in cache)";
                } else {
                    try {
                        decryptedText = await decryptMessage(remoteUserId, note.type, note.ciphertext);
                        if (decryptedText === "__media__") {
                            decryptedText = ""; // Hide the placeholder from the UI
                        }
                    } catch (e) {
                        console.error("Signal Decryption Failed:", e);
                        decryptedText = "🔐 Decryption error: Could not verify keys";
                    }
                }
            } else {
                // No ciphertext - check if it's in cache or just empty (e.g. attachment-only)
                decryptedText = textCacheEntry?.decryptedText || "";
            }

            // Restore the UI format
            const restoredNote = { ...note, noteText: decryptedText, isDecrypted: true };

            // 2. Decrypt Attachments (Strict Signal-Once Policy)
            const newKeysToCache = [];
            if (restoredNote.attachments && restoredNote.attachments.length > 0) {
                const decryptedAttachments = [];

                for (let i = 0; i < restoredNote.attachments.length; i++) {
                    const attachment = restoredNote.attachments[i];
                    try {
                        let binaryAesKey = null;

                        // Use explicit attachmentId if it exists (new UUID standard), fallback to fileIndex or array position 'i' (legacy)
                        const effectiveId = attachment.attachmentId || (attachment.fileIndex !== undefined ? attachment.fileIndex : i);

                        // Lookup this specific attachment in the persistent cache by deterministic ID
                        const cachedAttachment = await mediaKeyCache.getMediaKey(userId, note._id, effectiveId);

                        if (cachedAttachment && (cachedAttachment.aesKey || cachedAttachment.binaryAesKey)) {
                            binaryAesKey = cachedAttachment.aesKey || cachedAttachment.binaryAesKey;
                        } else if (note.senderId === userId) {
                            // STRICT CACHE BYPASS: If we sent this file but it's not in our cache, 
                            // NEVER attempt Signal decryption! Double Ratchet burns keys and 
                            // decrypting our own message again causes MessageCounterError.
                            console.warn(`Local cache miss for outgoing attachment ${effectiveId}. Skipping Signal decrypt to preserve ratchet.`);
                            binaryAesKey = null;
                        } else {
                            // Cache miss & Incoming Message - Trigger Signal Double Ratchet extraction!
                            let encryptedKeys = attachment.encryptedKeys;

                            // Support stringified metadata from legacy or varied transport
                            if (typeof encryptedKeys === 'string') {
                                try {
                                    encryptedKeys = JSON.parse(encryptedKeys);
                                } catch (e) {
                                    encryptedKeys = null;
                                }
                            }

                            const myKeyObj = encryptedKeys ? (encryptedKeys[userId] || encryptedKeys.encryptedKeysMap?.[userId]) : null;

                            if (myKeyObj && myKeyObj.key && (attachment.iv || attachment.binaryIv)) {
                                // If we are the sender, we MUST use our OWN session (userId) 
                                // that we used to encrypt for ourselves in encryptOutgoing.
                                const sessionTarget = (note.senderId === userId) ? userId : remoteUserId;

                                try {
                                    const decryptedKeyBase64 = await decryptMessage(
                                        sessionTarget,
                                        myKeyObj.type,
                                        myKeyObj.key,
                                        true // isMediaKey = true
                                    );

                                    if (decryptedKeyBase64 && !decryptedKeyBase64.startsWith('🔐')) {
                                        binaryAesKey = base64ToUint8(decryptedKeyBase64);
                                        newKeysToCache.push({
                                            index: effectiveId,
                                            aesKey: binaryAesKey
                                        });
                                    } else {
                                        console.warn(`Signal returned error string for attachment ${i}: ${decryptedKeyBase64}`);
                                    }
                                } catch (err) {
                                    console.error(`Media AES Key failed to decrypt for attachment ${i}:`, err);
                                }
                            }
                        }

                        if (binaryAesKey) {
                            decryptedAttachments.push({
                                ...attachment,
                                binaryAesKey,
                                binaryIv: (typeof attachment.iv === 'string') ? base64ToUint8(attachment.iv) : attachment.iv
                            });
                        } else {
                            decryptedAttachments.push(attachment);
                        }
                    } catch (e) {
                        console.error("Signal Attachment Decryption Failed:", e);
                        decryptedAttachments.push(attachment);
                    }
                }
                restoredNote.attachments = decryptedAttachments;
            }

            // 3. Update persistent cache if we have new Signal results or decrypted text
            // Skip updating if everything was already from cache
            const isValidPlaintext = typeof decryptedText === 'string' && !decryptedText.startsWith("🔐");
            const hasNewText = isValidPlaintext && (!textCacheEntry || textCacheEntry.decryptedText === undefined);

            if (hasNewText) {
                await mediaKeyCache.saveMediaKey(userId, note._id, 'text', {
                    decryptedText
                });
            }

            // Save new attachment keys instantly and safely into IndexedDB
            for (const newKey of newKeysToCache) {
                await mediaKeyCache.saveMediaKey(userId, note._id, newKey.index, {
                    aesKey: newKey.aesKey
                });
            }

            return restoredNote;
        } catch (err) {
            console.error("Failed to decrypt note", note._id, err);
            return { ...note, noteText: "🔐 Decryption error", isDecrypted: false };
        } finally {
            releaseMutex();
        }
    }, [userId]);

    return { isKeysReady, encryptOutgoing, decryptIncoming };
}
