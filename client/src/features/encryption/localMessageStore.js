let localDB = null;

export const initDB = () => {
    if (localDB) return Promise.resolve(localDB);
    return new Promise((resolve, reject) => {
        const request = indexedDB.open("LocalMessageStore", 1);

        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains("messages")) {
                db.createObjectStore("messages", { keyPath: "_id" });
            }
        };

        request.onsuccess = (event) => {
            localDB = event.target.result;
            resolve(localDB);
        };

        request.onerror = (event) => {
            reject(event.target.error);
        };
    });
};

export const saveMessageLocally = async (noteObj) => {
    try {
        const db = await initDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(["messages"], "readwrite");
            const store = transaction.objectStore("messages");

            // Store the note without the ciphertext to save space and keep it clean
            const noteToSave = { ...noteObj };
            delete noteToSave.ciphertext;

            const request = store.put(noteToSave);

            request.onsuccess = () => resolve();
            request.onerror = (e) => reject(e.target.error);
        });
    } catch (err) {
        console.warn("Failed to save message to local store", err);
    }
};

export const getMessageLocally = async (noteId) => {
    try {
        const db = await initDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(["messages"], "readonly");
            const store = transaction.objectStore("messages");
            const request = store.get(noteId);

            request.onsuccess = (event) => resolve(event.target.result || null);
            request.onerror = (e) => reject(e.target.error);
        });
    } catch (err) {
        console.warn("Failed to get message from local store", err);
        return null;
    }
};

export const clearLocalMessages = async () => {
    try {
        const db = await initDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(["messages"], "readwrite");
            const store = transaction.objectStore("messages");
            const request = store.clear();

            request.onsuccess = () => resolve();
            request.onerror = (e) => reject(e.target.error);
        });
    } catch (err) {
        console.warn("Failed to clear local messages store", err);
    }
};
