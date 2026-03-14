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
    async saveMedia(messageId, attachmentId, blobOrBuffer) {
        try {
            const db = await openDB();
            const key = `${messageId}_${attachmentId}`;

            // NORMALIZATION: Convert to Uint8Array before IndexedDB persistence
            // to avoid structured-clone issues across different browsers/versions.
            let binaryData;
            if (blobOrBuffer instanceof Blob) {
                binaryData = new Uint8Array(await blobOrBuffer.arrayBuffer());
            } else if (blobOrBuffer instanceof ArrayBuffer) {
                binaryData = new Uint8Array(blobOrBuffer);
            } else if (blobOrBuffer instanceof Uint8Array) {
                binaryData = blobOrBuffer;
            } else {
                throw new Error("Unsupported data type for persistent storage");
            }

            return new Promise((resolve, reject) => {
                const transaction = db.transaction(STORE_NAME, 'readwrite');
                const store = transaction.objectStore(STORE_NAME);
                const request = store.put(binaryData, key);
                request.onsuccess = () => resolve();
                request.onerror = () => reject(request.error);
            });
        } catch (err) {
            console.error('[persistentBlobStore] Failed to save binary data:', err);
        }
    },

    async getMedia(messageId, attachmentId, mimeType) {
        try {
            const db = await openDB();
            const key = `${messageId}_${attachmentId}`;
            return new Promise((resolve, reject) => {
                const transaction = db.transaction(STORE_NAME, 'readonly');
                const store = transaction.objectStore(STORE_NAME);
                const request = store.get(key);
                request.onsuccess = () => {
                    const result = request.result;
                    if (!result) return resolve(null);

                    // RESTORATION: Wrap normalized Uint8Array back into a Blob
                    // Note: Caller usually knows the MIME type from the attachment metadata
                    const blob = mimeType ? new Blob([result], { type: mimeType }) : new Blob([result]);
                    resolve(blob);
                };
                request.onerror = () => reject(request.error);
            });
        } catch (err) {
            console.error('[persistentBlobStore] Failed to get binary data:', err);
            return null;
        }
    }
};
