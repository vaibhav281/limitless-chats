import { useState, useCallback, useEffect } from 'react';
import { generateAndUploadKeys, clearLocalKeys } from '../features/encryption/keyManager';
import { encryptMessage } from '../features/encryption/messageEncryptor';
import { decryptMessage } from '../features/encryption/messageDecryptor';
import { encryptFile, decryptFile } from '../features/encryption/cryptoService';
import axios from 'axios';

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
            let encryptedTextPayload = null;
            if (plaintext) {
                encryptedTextPayload = await encryptMessage(receiverId, plaintext);
            }

            const encryptedFiles = [];
            for (const fileObj of plainFiles) {
                // 1. Encrypt File with random AES-GCM Key
                const { ciphertextBlob, keyBase64, ivBase64 } = await encryptFile(fileObj.file);

                // 2. Encrypt the *AES Key* itself via Signal Double Ratchet so ONLY the receiver can unlock the file
                const encryptedKeyPayload = await encryptMessage(receiverId, keyBase64);

                encryptedFiles.push({
                    blob: ciphertextBlob,
                    encryptedKey: window.btoa(encryptedKeyPayload.body), // Base64 encode Signal Ciphertext String for safety
                    keyType: encryptedKeyPayload.type,      // Signal Type
                    iv: ivBase64,
                    originalName: fileObj.origName || fileObj.originalName,
                    type: fileObj.type,
                    originalMimeType: fileObj.file.type
                });
            }

            return {
                ciphertext: encryptedTextPayload ? encryptedTextPayload.body : "",
                type: encryptedTextPayload ? encryptedTextPayload.type : 3,
                encryptedFiles
            };
        } catch (err) {
            console.error("encryptOutgoing encountered an error:", err.message);
            throw err;
        }
    }, []);

    let decryptionMutex = Promise.resolve();

    /**
     * Decrypts Incoming Notes (intercepting sockets / fetch calls before hitting state)
     */
    const decryptIncoming = useCallback(async (note) => {
        // Queue the decryption to ensure ratchets process strictly sequentially
        const currentMutex = decryptionMutex;
        let releaseMutex;
        decryptionMutex = new Promise(resolve => releaseMutex = resolve);

        await currentMutex; // wait for all prior decryptions to finish

        try {
            if (!note) return null;

            // Group Chat fallback (not fully E2EE ratcheted in this MVP, we pass it through)
            // Standard WhatsApp implements sender-keys for groups, which is vastly heavier.
            // For this step, if it's a global group, we might just pass through or use a shared key.
            if (note.receiverId === 'global_group') {
                return { ...note, noteText: "Group E2EE not implemented yet.", isDecrypted: false };
            }

            // 1. Determine who we are talking to (the "remote" party)
            const remoteUserId = note.senderId === userId ? note.receiverId : note.senderId;

            let decryptedText = "";
            if (note.ciphertext) {
                try {
                    decryptedText = await decryptMessage(remoteUserId, note.type, note.ciphertext);
                } catch (e) {
                    decryptedText = "🔐 Message unreadable (key mismatch)";
                }
            }

            // Restore the UI format
            const restoredNote = { ...note, noteText: decryptedText, isDecrypted: true };

            // 3. Fully Decrypt the Attachments Array (WhatsApp E2EE File Model)
            if (restoredNote.attachments && restoredNote.attachments.length > 0) {
                const decryptedAttachments = [];
                for (const attachment of restoredNote.attachments) {
                    try {
                        if (attachment.encryptedKey && attachment.iv && attachment.url) {
                            // 3a. Decrypt AES key using Signal Double Ratchet
                            const decryptedKeyBase64 = await decryptMessage(
                                remoteUserId,
                                attachment.keyType,
                                window.atob(attachment.encryptedKey)
                            );

                            // 3b. Download encrypted blob payload from server
                            const response = await axios.get(
                                `${import.meta.env.VITE_API_BASE.replace('/api/v1', '')}${attachment.url}`,
                                { responseType: 'blob' }
                            );
                            const encryptedBlob = response.data;

                            // 3c. Decrypt file locally using the newly unlocked AES-GCM Key
                            const decryptedBlob = await decryptFile(
                                encryptedBlob,
                                decryptedKeyBase64,
                                attachment.iv,
                                attachment.originalMimeType || (attachment.type === "image" ? "image/jpeg" : "application/octet-stream")
                            );

                            // 3d. Create secure local ephemeral URL
                            const localUrl = URL.createObjectURL(decryptedBlob);

                            decryptedAttachments.push({
                                ...attachment,
                                decryptedUrl: localUrl
                            });
                        } else {
                            decryptedAttachments.push(attachment);
                        }
                    } catch (e) {
                        console.error("Attachment decryption failed:", e);
                        decryptedAttachments.push(attachment);
                    }
                }
                restoredNote.attachments = decryptedAttachments;
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
