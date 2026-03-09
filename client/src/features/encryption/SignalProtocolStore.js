// Signal Protocol Store Implementation using IndexedDB
export class SignalProtocolStore {
    constructor() {
        this.dbName = 'LimitlessE2EE';
        this.dbVersion = 1;
        this.storeNames = ['identity', 'preKeys', 'signedPreKeys', 'sessions', 'identityKeys'];
        this.initDB();
    }

    async initDB() {
        if (this.db) return;
        if (this._initPromise) return this._initPromise;

        console.log("[SignalStore] Initializing IndexedDB...");
        this._initPromise = new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.dbVersion);
            request.onupgradeneeded = (e) => {
                const db = e.target.result;
                console.log("[SignalStore] Upgrading IndexedDB stores...");
                this.storeNames.forEach(name => {
                    if (!db.objectStoreNames.contains(name)) {
                        db.createObjectStore(name);
                    }
                });
            };
            request.onsuccess = () => {
                this.db = request.result;
                this._initPromise = null;
                console.log("[SignalStore] IndexedDB Initialized.");
                resolve();
            };
            request.onerror = (e) => {
                console.error("[SignalStore] IndexedDB Init Error:", e.target.error);
                this._initPromise = null;
                reject(e.target.error);
            };
        });

        return this._initPromise;
    }

    closeDB() {
        if (this.db) {
            this.db.close();
            this.db = null;
        }
    }

    async clearAllStores() {
        if (!this.db) await this.initDB();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(this.storeNames, 'readwrite');
            this.storeNames.forEach(name => {
                tx.objectStore(name).clear();
            });
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }

    async _get(storeName, key) {
        if (!this.db) await this.initDB();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(storeName, 'readonly');
            const req = tx.objectStore(storeName).get(key);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    async _put(storeName, key, value) {
        if (!this.db) await this.initDB();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(storeName, 'readwrite');
            tx.objectStore(storeName).put(value, key);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }

    async _remove(storeName, key) {
        if (!this.db) await this.initDB();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(storeName, 'readwrite');
            tx.objectStore(storeName).delete(key);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }

    async getIdentityKeyPair() {
        return this._get('identity', 'keyPair');
    }

    async getLocalRegistrationId() {
        return this._get('identity', 'registrationId');
    }

    async putIdentityKeyPair(keyPair) {
        await this._put('identity', 'keyPair', keyPair);
    }

    async putLocalRegistrationId(id) {
        await this._put('identity', 'registrationId', id);
    }

    async isTrustedIdentity(identifier, identityKey, direction) {
        if (!identifier) throw new Error("tried to check identity for undefined");

        const trusted = await this._get('identityKeys', identifier);

        if (!trusted) {
            console.log(`[SignalStore] Trusting identity on first use for ${identifier}`);
            return true;
        }

        const t8 = new Uint8Array(trusted);
        const i8 = new Uint8Array(identityKey);

        if (t8.length !== i8.length) return false;

        for (let i = 0; i < t8.length; i++) {
            if (t8[i] !== i8[i]) return false;
        }

        return true;
    }

    async loadIdentityKey(identifier) {
        return this._get('identityKeys', identifier);
    }

    async saveIdentity(identifier, identityKey) {
        return this._put('identityKeys', identifier, identityKey);
    }

    async loadPreKey(keyId) {
        let res = await this._get('preKeys', keyId);
        if (res && res.keyPair) {
            res = res.keyPair;
        }
        return res;
    }

    async storePreKey(keyId, keyPair) {
        return this._put('preKeys', keyId, {
            keyId: keyId,
            keyPair: keyPair
        });
    }

    async removePreKey(keyId) {
        return this._remove('preKeys', keyId);
    }

    async loadSignedPreKey(keyId) {
        let res = await this._get('signedPreKeys', keyId);
        if (res && res.keyPair) {
            res = res.keyPair;
        }
        return res;
    }

    async storeSignedPreKey(keyId, keyPair) {
        return this._put('signedPreKeys', keyId, {
            keyId: keyId,
            keyPair: keyPair
        });
    }

    async removeSignedPreKey(keyId) {
        return this._remove('signedPreKeys', keyId);
    }

    async loadSession(identifier) {
        const session = await this._get('sessions', identifier);
        if (session) {
            console.log(`[SignalStore] Loaded session for ${identifier}`);
        } else {
            console.warn(`[SignalStore] No session found for ${identifier}`);
        }
        return session;
    }

    async storeSession(identifier, record) {
        console.log(`[SignalStore] Storing session for ${identifier}`);
        // Ensure serialization if the record provides it (Signal Protocol v2+ handling)
        const serializedRecord = typeof record.serialize === 'function' ? record.serialize() : record;
        return this._put('sessions', identifier, serializedRecord);
    }

    async removeSession(identifier) {
        return this._remove('sessions', identifier);
    }

    async removeAllSessions(identifier) {
        // Exact match for one-to-one sessions
        return this._remove('sessions', identifier);
    }
}
