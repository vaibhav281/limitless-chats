const DB_NAME = 'limitless-media-blobs';
const DB_VERSION = 1;
const STORE_NAME = 'files';

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

export const persistentBlobStore = {
    async saveMedia(messageId, attachmentId, blob) {
        try {
            const db = await openDB();
            const key = `${messageId}_${attachmentId}`;
            return new Promise((resolve, reject) => {
                const transaction = db.transaction(STORE_NAME, 'readwrite');
                const store = transaction.objectStore(STORE_NAME);
                const request = store.put(blob, key);
                request.onsuccess = () => resolve();
                request.onerror = () => reject(request.error);
            });
        } catch (err) {
            console.error('[persistentBlobStore] Failed to save blob:', err);
        }
    },

    async getMedia(messageId, attachmentId) {
        try {
            const db = await openDB();
            const key = `${messageId}_${attachmentId}`;
            return new Promise((resolve, reject) => {
                const transaction = db.transaction(STORE_NAME, 'readonly');
                const store = transaction.objectStore(STORE_NAME);
                const request = store.get(key);
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            });
        } catch (err) {
            console.error('[persistentBlobStore] Failed to get blob:', err);
            return null;
        }
    }
};
