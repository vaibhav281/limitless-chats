import { ensureUint8Array } from './cryptoService';

const DB_NAME = 'limitless-media-cache';
const DB_VERSION = 1;
const STORE_NAME = 'mediaKeys';

/**
 * Production-Grade Persistent Media Key Cache.
 * Stores decrypted AES keys in IndexedDB as Uint8Arrays to avoid Signal ratchet desync.
 * Uses composite keys (userId:noteId:attachmentIndex) or (userId:noteId:text) to prevent cross-account leaks and multi-file overwrites.
 */
const openDB = () => {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME);
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
};

export const mediaKeyCache = {
    /**
     * @param {string} userId - Current logged in user
     * @param {string} noteId - ID of the message/note
     * @param {number|string} indexOrType - The attachment index (0, 1, 2) OR 'text' for message body
     * @param {Object} data - { aesKey: Uint8Array, iv: Uint8Array, etc } or { decryptedText: string }
     */
    async saveMediaKey(userId, noteId, indexOrType, data) {
        try {
            const db = await openDB();
            const compositeKey = `${userId}:${noteId}:${indexOrType}`;
            return new Promise((resolve, reject) => {
                const transaction = db.transaction(STORE_NAME, 'readwrite');
                const store = transaction.objectStore(STORE_NAME);

                const entry = {
                    ...data,
                    cacheKey: compositeKey,
                    timestamp: Date.now(),
                    version: 1
                };

                const request = store.put(entry, compositeKey);
                request.onsuccess = () => resolve();
                request.onerror = () => reject(request.error);
            });
        } catch (err) {
            console.error("Failed to save media key to persistent cache:", err);
        }
    },

    /**
     * @param {string} userId 
     * @param {string} noteId 
     * @param {number|string} indexOrType - The attachment index (0, 1, 2) OR 'text'
     * @returns {Promise<Object|null>}
     */
    async getMediaKey(userId, noteId, indexOrType) {
        try {
            const db = await openDB();
            const compositeKey = `${userId}:${noteId}:${indexOrType}`;
            return new Promise((resolve, reject) => {
                const transaction = db.transaction(STORE_NAME, 'readonly');
                const store = transaction.objectStore(STORE_NAME);
                const request = store.get(compositeKey);
                request.onsuccess = () => {
                    const result = request.result;
                    if (result && result.aesKey) {
                        // Ensure single cached key is correctly restored as Uint8Array
                        result.aesKey = ensureUint8Array(result.aesKey || result.binaryAesKey);
                    }
                    resolve(result);
                };
                request.onerror = () => reject(request.error);
            });
        } catch (err) {
            console.error("Failed to get media key from persistent cache:", err);
            return null;
        }
    },

    async clearCache() {
        try {
            const db = await openDB();
            return new Promise((resolve, reject) => {
                const transaction = db.transaction(STORE_NAME, 'readwrite');
                const store = transaction.objectStore(STORE_NAME);
                const request = store.clear();
                request.onsuccess = () => resolve();
                request.onerror = () => reject(request.error);
            });
        } catch (err) {
            console.error("Failed to clear media key cache:", err);
        }
    }
};
