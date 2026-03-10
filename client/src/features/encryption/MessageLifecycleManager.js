import { getMessageLocally, saveMessageLocally } from './localMessageStore';
import { mediaKeyCache } from './mediaKeyCache';

// Global map to hold promises for currently processing messages
// to completely prevent race conditions natively across the entire app
const processingLocks = new Map();

export const MessageLifecycleManager = {
    /**
     * MUST be injected with the `decryptIncoming` function from `useEncryptedMessaging`
     * until the crypto layer is fully decoupled from the React lifecycle.
     */
    async processMessage(rawMessage, decryptIncomingFn) {
        if (!rawMessage || !rawMessage._id) return rawMessage;

        // 1. Enforce Per-Message Mutex (Adjustment 1)
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

    /**
     * Processes an array of messages incrementally, allowing partial successes (Adjustment 2)
     */
    async processMessages(rawMessages, decryptIncomingFn) {
        const processed = [];
        for (const msg of rawMessages) {
            try {
                const result = await this.processMessage(msg, decryptIncomingFn);
                processed.push(result);
            } catch (err) {
                console.error(`Failed to process message ${msg._id}:`, err);
                // Push a failed state so the UI can render an error bubble instead of dropping it entirely
                processed.push({ ...msg, noteText: "🔐 Decryption error", isDecrypted: false });
            }
        }
        return processed;
    },

    async _internalProcess(rawMessage, decryptIncomingFn) {
        // If it lacks ciphertext, it's either an error or a system message
        if (!rawMessage.ciphertext) {
            return { ...rawMessage, noteText: rawMessage.noteText || "🔐 Error: Missing ciphertext", isDecrypted: false };
        }

        // If the socket or cache already hydrated the plaintext (e.g. sender's own message), skip crypto!
        if (rawMessage.isDecrypted) {
            return rawMessage;
        }

        // 1. Check IndexedDB cache first (fast path)
        const local = await getMessageLocally(rawMessage._id);
        if (local) {
            return local;
        }

        // SENDER SOCKET RACE FIX: Prevent Senders from decrypting their own websocket bounce-backs!
        const currentUserId = localStorage.getItem('userId');
        if (rawMessage.senderId === currentUserId) {
            return {
                ...rawMessage,
                noteText: "🔐 Message sent (plaintext not in cache)",
                isDecrypted: true,
                permanentlyFailed: true
            };
        }

        // 2. Not cached. Must decrypt via Signal Protocol.
        const decryptedNote = await decryptIncomingFn(rawMessage);

        // OLD RATCHET LOCK: If Signal Protocol catches Bad MAC / Session Desync for an old message,
        // we permanently mark it as undecryptable and save it to IndexedDB so it never retries on refresh!
        if (decryptedNote.noteText && decryptedNote.noteText.includes("🔐") &&
            (decryptedNote.noteText.includes("Bad MAC") || decryptedNote.noteText.includes("No record for device") || decryptedNote.noteText.includes("Decryption error"))) {

            decryptedNote.isDecrypted = false;
            decryptedNote.permanentlyFailed = true;
            decryptedNote.noteText = "🔐 Messages from previous session cannot be decrypted";

            await saveMessageLocally(decryptedNote);
            return decryptedNote;
        }

        // 3. Extract and cache Media Keys (Adjustment 4)
        if (decryptedNote.isDecrypted && decryptedNote.attachments && decryptedNote.attachments.length > 0) {
            for (const [idx, att] of decryptedNote.attachments.entries()) {
                if (att.binaryAesKey) {
                    const attachIndex = att.fileIndex !== undefined ? att.fileIndex : idx;
                    await mediaKeyCache.saveMediaKey(rawMessage.receiverId, rawMessage._id, attachIndex, {
                        aesKey: att.binaryAesKey
                    });

                    // Make sure we clear binaryAesKey from the message object before caching plaintext 
                    // to maintain strict separation of concerns (Storage Layer Rule)
                    // UI components should always hit the `mediaKeyCache`
                    delete att.binaryAesKey;
                    delete att.binaryIv;
                }
            }
        }

        // 4. Cache Plaintext Message ONLY (Adjustment 4)
        if (decryptedNote.isDecrypted) {
            await saveMessageLocally(decryptedNote);
        }

        // 5. Return to UI (Adjustment 5)
        return decryptedNote;
    }
};
