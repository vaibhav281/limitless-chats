
---

## 📂 11. COMPLETE SOURCE FILES — PART 2: ENCRYPTION LAYER

---

### 11.1 `client/src/features/encryption/MessageLifecycleManager.js` — CENTRAL PIPELINE
```javascript
import { getMessageLocally, saveMessageLocally } from './localMessageStore';
import { mediaKeyCache } from './mediaKeyCache';
import { runMediaDecryptionPipeline, getEffectiveAttachmentId, getBlobCacheKey } from './cryptoService';
import { blobCache } from './blobCache';

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
            this.scheduleMediaHydration(rawMessage);
            return rawMessage;
        }

        const local = await getMessageLocally(rawMessage._id);
        if (local) {
            // CRITICAL CACHE FIX: ALWAYS TRUST SERVER FOR MUTATIONS
            local.isDeletedForEveryone = rawMessage.isDeletedForEveryone || local.isDeletedForEveryone;
            local.isDeletedForMe = rawMessage.isDeletedForMe || local.isDeletedForMe;
            local.isDeleted = rawMessage.isDeleted || local.isDeleted;
            local.deletedForUsers = rawMessage.deletedForUsers || local.deletedForUsers;

            // FIX: Server `plaintextEdit` is ciphertext. Only pull from cache.
            if (rawMessage.isEdited) {
                const userId = localStorage.getItem('userId');
                const cached = await mediaKeyCache.getMediaKey(userId, rawMessage._id, "text");

                if (cached?.decryptedText) {
                    local.plaintextEdit = cached.decryptedText;
                }

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

        this.scheduleMediaHydration(decryptedNote);

        if (decryptedNote.isDecrypted) {
            await saveMessageLocally(decryptedNote);
        }

        return decryptedNote;
    },

    scheduleMediaHydration(note) {
        if (!note.attachments || note.attachments.length === 0) return;

        queueMicrotask(async () => {
            const userId = localStorage.getItem('userId');

            for (const [idx, att] of note.attachments.entries()) {
                const effectiveId = getEffectiveAttachmentId(att, idx);
                const cacheKey = getBlobCacheKey(note._id, att, idx);

                if (blobCache.has(cacheKey)) continue;

                try {
                    let aesKey = att.binaryAesKey;
                    let iv = att.binaryIv || att.iv;

                    if (!aesKey) {
                        const cached = await mediaKeyCache.getMediaKey(userId, note._id, effectiveId);
                        if (cached) {
                            aesKey = cached.aesKey || cached.binaryAesKey;
                            iv = iv || cached.iv;
                        }
                    }

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
```

---

### 11.2 `client/src/features/encryption/cryptoService.js` — WebCrypto + Pipeline Mutex
```javascript
import { Buffer } from 'buffer';
import axios from 'axios';
import { persistentBlobStore } from './persistentBlobStore';
import { blobCache } from './blobCache';
import { bindUrl } from '../../services/mediaMemoryManager';

const mediaDecryptionLocks = new Map();
const usedIVs = new Set();

export const E2EE_ERRORS = {
    DECRYPT_PENDING: "ERR_DECRYPT_PENDING",
    SIGNAL_DESYNC: "ERR_SIGNAL_DESYNC",
    MEDIA_KEY_MISSING: "ERR_MEDIA_KEY_MISSING",
    MEDIA_DECRYPT_FAIL: "ERR_MEDIA_DECRYPT_FAIL",
    MEDIA_NOT_FOUND: "ERR_MEDIA_NOT_FOUND",
    MEDIA_TIMEOUT: "ERR_MEDIA_TIMEOUT",
    CACHE_CORRUPT: "ERR_CACHE_CORRUPT",
    HASH_MISMATCH: "ERR_HASH_MISMATCH"
};

export async function computeAttachmentHash(buffer) {
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function encryptFile(file) {
    const arrayBuffer = await file.arrayBuffer();
    const aesKey = await crypto.subtle.generateKey(
        { name: "AES-GCM", length: 256 },
        true,
        ["encrypt", "decrypt"]
    );
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ivBase64 = uint8ToBase64(iv);

    if (usedIVs.has(ivBase64)) {
        throw new Error("Critical Security Error: IV reuse detected in encryption pipeline.");
    }
    usedIVs.add(ivBase64);

    const ciphertext = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv: iv },
        aesKey,
        arrayBuffer
    );

    const keyRaw = await crypto.subtle.exportKey("raw", aesKey);
    const keyBase64 = uint8ToBase64(new Uint8Array(keyRaw));

    return {
        ciphertextBlob: new Blob([ciphertext], { type: file.type || 'application/octet-stream' }),
        ciphertextBuffer: new Uint8Array(ciphertext),
        keyBase64,
        ivBase64
    };
}

export const decryptFile = async (ciphertextBlob, aesKeyInput, ivInput, originalMimeType) => {
    const arrayBuffer = ciphertextBlob instanceof ArrayBuffer ? ciphertextBlob : await ciphertextBlob.arrayBuffer();

    const iv = ensureUint8Array(ivInput);

    if (!iv || iv.length !== 12) {
        throw new Error(`Invalid IV length: expected 12, got ${iv?.length}. Source: ${typeof ivInput}`);
    }

    const rawKey = ensureUint8Array(aesKeyInput);

    if (!rawKey || rawKey.length !== 32) {
        throw new Error(`Invalid AES Key: expected 32 bytes, got ${rawKey?.length}. Potential Signal desync.`);
    }

    const keyData = rawKey.slice().buffer;

    const key = await window.crypto.subtle.importKey(
        "raw",
        keyData,
        { name: "AES-GCM", length: 256 },
        false,
        ["decrypt"]
    );

    const plaintextBuffer = await window.crypto.subtle.decrypt(
        { name: "AES-GCM", iv: iv },
        key,
        arrayBuffer
    );

    return new Blob([plaintextBuffer], { type: originalMimeType });
};

export function getEffectiveAttachmentId(attachment, indexFallback = 0) {
    if (!attachment) return `unknown_${indexFallback}`;
    if (attachment.fileHash) return attachment.fileHash;
    if (attachment.id) return attachment.id;
    if (attachment.attachmentId) return attachment.attachmentId;
    if (attachment.fileIndex !== undefined) return attachment.fileIndex;
    if (attachment.index !== undefined) return attachment.index;
    return `unknown_${indexFallback}`;
}

export function getBlobCacheKey(noteId, attachment, index = 0) {
  if (attachment?.fileHash) return attachment.fileHash;
  if (attachment?.id) return attachment.id;
  if (attachment?.attachmentId) return attachment.attachmentId;
  return `${noteId}_${index}`;
}

export const runMediaDecryptionPipeline = async (noteId, attachment, aesKey, iv, index = 0) => {
    const attachmentId = getEffectiveAttachmentId(attachment, index);
    const cacheKey = getBlobCacheKey(noteId, attachment, index);

    if (mediaDecryptionLocks.has(cacheKey)) {
        return mediaDecryptionLocks.get(cacheKey);
    }

    const pipelinePromise = (async () => {
        try {
            const boxed = safeUnboxCachedUrl(blobCache.get(cacheKey));
            if (boxed && boxed.url) return boxed.url;

            if (attachment.url && attachment.url.startsWith('blob:')) {
                return attachment.url;
            }

            const resolvedMimeType = attachment.originalMimeType ||
                (attachment.originalName?.toLowerCase().endsWith('.svg') ? 'image/svg+xml' :
                    (attachment.type === "image" ? "image/jpeg" : "application/octet-stream"));

            const cachedBlob = await persistentBlobStore.getMedia(noteId, attachmentId, resolvedMimeType);
            if (cachedBlob) {
                const url = URL.createObjectURL(cachedBlob);
                blobCache.set(cacheKey, { url, mimeType: resolvedMimeType, fileName: attachment.fileName || attachment.originalName });
                return url;
            }

            if (!aesKey || !iv || !attachment.url) {
                console.warn("[cryptoService] Missing metadata");
                return { failed: true };
            }

            const response = await axios.get(attachment.url, { responseType: 'arraybuffer' });

            const decryptedBlob = await decryptFile(
                response.data,
                aesKey,
                iv,
                resolvedMimeType
            );

            await persistentBlobStore.saveMedia(noteId, attachmentId, decryptedBlob);

            const finalUrl = URL.createObjectURL(decryptedBlob);
            blobCache.set(cacheKey, { url: finalUrl, mimeType: resolvedMimeType, fileName: attachment.fileName || attachment.originalName });
            bindUrl(cacheKey, finalUrl, { mimeType: resolvedMimeType, fileName: attachment.fileName || attachment.originalName });

            return finalUrl;

        } catch (err) {
            console.error(`[cryptoService] Pipeline failed for ${cacheKey}:`, err);
            throw err;
        }
    })();

    mediaDecryptionLocks.set(cacheKey, pipelinePromise);

    try {
        return await pipelinePromise;
    } finally {
        mediaDecryptionLocks.delete(cacheKey);
    }
};

export function uint8ToBase64(uint8) {
    return Buffer.from(uint8).toString("base64");
}

export function base64ToUint8(base64) {
    return Uint8Array.from(Buffer.from(base64, "base64"));
}

export function bufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
}

export function base64ToBuffer(base64) {
    const binary = window.atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
}

export function safeUnboxCachedUrl(entry) {
  if (!entry) return null;
  if (typeof entry === 'string') return { url: entry, mimeType: null, fileName: null };
  if (entry && typeof entry === 'object' && entry.url) return {
    url: entry.url,
    mimeType: entry.mimeType || null,
    fileName: entry.fileName || null
  };
  return null;
}

export function ensureUint8Array(input) {
    if (!input) return null;
    if (input instanceof Uint8Array) return input;
    if (typeof input === 'string') return base64ToUint8(input);
    if (input instanceof ArrayBuffer) return new Uint8Array(input);

    if (typeof input === 'object' && typeof input[0] === 'number') {
        const arr = [];
        for (let i = 0; typeof input[i] === 'number'; i++) {
            arr.push(input[i]);
        }
        return new Uint8Array(arr);
    }

    return null;
}
```

---

### 11.3 `client/src/features/encryption/mediaKeyCache.js` — Persistent Media Key Store
```javascript
import { ensureUint8Array } from './cryptoService';

const DB_NAME = 'limitless-media-cache';
const DB_VERSION = 1;
const STORE_NAME = 'mediaKeys';

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
```

---

### 11.4 `client/src/features/encryption/blobCache.js` — LRU RAM Cache
```javascript
class LRUBlobCache {
    constructor(maxSize = 200) {
        this.cache = new Map();
        this.maxSize = maxSize;
    }

    get(key) {
        if (!this.cache.has(key)) return null;
        const val = this.cache.get(key);
        this.cache.delete(key);
        this.cache.set(key, val);
        return val;
    }

    set(key, value) {
        if (this.cache.has(key)) {
            this.cache.delete(key);
        } else if (this.cache.size >= this.maxSize) {
            const oldestKey = this.cache.keys().next().value;
            const oldestVal = this.cache.get(oldestKey);

            this.cache.delete(oldestKey);

            import('../../services/mediaMemoryManager').then(({ release }) => {
                release(oldestKey);
            }).catch(() => {});
        }
        this.cache.set(key, value);
    }

    has(key) {
        return this.cache.has(key);
    }
}

export const blobCache = new LRUBlobCache(200);
```

---

### 11.5 `client/src/features/encryption/persistentBlobStore.js` — IDB Binary Store
```javascript
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
```

---

### 11.6 `client/src/features/encryption/SignalProtocolStore.js` — Signal Session Store
```javascript
import { bufferToBase64, base64ToBuffer } from './cryptoService';

export class SignalProtocolStore {
    constructor() {
        this.dbName = 'LimitlessE2EE';
        this.dbVersion = 2;
        this.storeNames = ['identity', 'preKeys', 'signedPreKeys', 'sessions', 'identityKeys'];
        this.initDB();
    }

    async initDB() {
        if (this.db) return;
        if (this._initPromise) return this._initPromise;

        this._initPromise = new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.dbVersion);
            request.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (e.oldVersion < 2) {
                    this.storeNames.forEach(name => {
                        if (db.objectStoreNames.contains(name)) {
                            db.deleteObjectStore(name);
                        }
                        db.createObjectStore(name);
                    });
                } else {
                    this.storeNames.forEach(name => {
                        if (!db.objectStoreNames.contains(name)) {
                            db.createObjectStore(name);
                        }
                    });
                }
            };
            request.onsuccess = () => {
                this.db = request.result;
                this._initPromise = null;
                resolve();
            };
            request.onerror = (e) => {
                this._initPromise = null;
                reject(e.target.error);
            };
        });

        return this._initPromise;
    }

    closeDB() {
        if (this.db) { this.db.close(); this.db = null; }
    }

    async clearAllStores() {
        if (!this.db) await this.initDB();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(this.storeNames, 'readwrite');
            this.storeNames.forEach(name => { tx.objectStore(name).clear(); });
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
        const serialized = await this._get('identity', 'keyPair');
        if (!serialized) return undefined;
        return {
            pubKey: base64ToBuffer(serialized.pubKey),
            privKey: base64ToBuffer(serialized.privKey)
        };
    }

    async getLocalRegistrationId() {
        return this._get('identity', 'registrationId');
    }

    async putIdentityKeyPair(keyPair) {
        const serialized = {
            pubKey: bufferToBase64(keyPair.pubKey),
            privKey: bufferToBase64(keyPair.privKey)
        };
        await this._put('identity', 'keyPair', serialized);
    }

    async putLocalRegistrationId(id) {
        await this._put('identity', 'registrationId', id);
    }

    async isTrustedIdentity(identifier, identityKey, direction) {
        if (!identifier) throw new Error("tried to check identity for undefined");
        const trusted = await this._get('identityKeys', identifier);
        if (!trusted) {
            await this.saveIdentity(identifier, identityKey);
            return true;
        }
        const t8 = new Uint8Array(base64ToBuffer(trusted));
        const i8 = new Uint8Array(identityKey);
        if (t8.length !== i8.length) return false;
        for (let i = 0; i < t8.length; i++) {
            if (t8[i] !== i8[i]) {
                await this.saveIdentity(identifier, identityKey);
                return true;
            }
        }
        return true;
    }

    async loadIdentityKey(identifier) {
        const b64 = await this._get('identityKeys', identifier);
        return b64 ? base64ToBuffer(b64) : undefined;
    }

    async saveIdentity(identifier, identityKey) {
        const b64 = bufferToBase64(identityKey);
        return this._put('identityKeys', identifier, b64);
    }

    async loadPreKey(keyId) {
        let res = await this._get('preKeys', keyId);
        if (res && res.pubKey) {
            return { pubKey: base64ToBuffer(res.pubKey), privKey: base64ToBuffer(res.privKey) };
        }
        return res;
    }

    async storePreKey(keyId, keyPair) {
        return this._put('preKeys', keyId, {
            keyId: keyId,
            pubKey: bufferToBase64(keyPair.pubKey),
            privKey: bufferToBase64(keyPair.privKey)
        });
    }

    async removePreKey(keyId) { return this._remove('preKeys', keyId); }

    async loadSignedPreKey(keyId) {
        let res = await this._get('signedPreKeys', keyId);
        if (res && res.pubKey) {
            return { pubKey: base64ToBuffer(res.pubKey), privKey: base64ToBuffer(res.privKey) };
        }
        return res;
    }

    async storeSignedPreKey(keyId, keyPair) {
        return this._put('signedPreKeys', keyId, {
            keyId: keyId,
            pubKey: bufferToBase64(keyPair.pubKey),
            privKey: bufferToBase64(keyPair.privKey)
        });
    }

    async removeSignedPreKey(keyId) { return this._remove('signedPreKeys', keyId); }

    async loadSession(identifier) {
        const data = await this._get('sessions', identifier);
        if (!data) return undefined;
        return data;
    }

    async storeSession(identifier, record) {
        const serializedRecord = typeof record.serialize === 'function' ? record.serialize() : record;
        return this._put('sessions', identifier, serializedRecord);
    }

    async removeSession(identifier) { return this._remove('sessions', identifier); }

    async removeAllSessions(identifier) { return this._remove('sessions', identifier); }
}
```

---

### 11.7 `client/src/features/encryption/keyManager.js` — Key Generation & Upload
```javascript
import { KeyHelper } from '@privacyresearch/libsignal-protocol-typescript';
import { SignalProtocolStore } from './SignalProtocolStore';
import { bufferToBase64, base64ToBuffer } from './cryptoService';
import { clearLocalMessages } from './localMessageStore';
import { mediaKeyCache } from './mediaKeyCache';
import axios from 'axios';

export const signalStore = new SignalProtocolStore();

export const generateAndUploadKeys = async (userId) => {
    try {
        const existingRegistrationId = await signalStore.getLocalRegistrationId();
        const vaultOwner = localStorage.getItem('e2eeVaultOwner');

        if (existingRegistrationId && vaultOwner === userId) {
            return;
        }

        if (existingRegistrationId && vaultOwner !== userId) {
            await clearLocalKeys();
        }

        const registrationId = KeyHelper.generateRegistrationId();
        await signalStore.putLocalRegistrationId(registrationId);

        const identityKeyPair = await KeyHelper.generateIdentityKeyPair();
        await signalStore.putIdentityKeyPair(identityKeyPair);

        const signedPreKeyId = 1;
        const signedPreKey = await KeyHelper.generateSignedPreKey(identityKeyPair, signedPreKeyId);
        await signalStore.storeSignedPreKey(signedPreKeyId, signedPreKey.keyPair);

        const publicPreKeys = [];
        for (let i = 1; i <= 50; i++) {
            const preKey = await KeyHelper.generatePreKey(i);
            await signalStore.storePreKey(preKey.keyId, preKey.keyPair);
            publicPreKeys.push({
                keyId: preKey.keyId,
                publicKey: bufferToBase64(preKey.keyPair.pubKey)
            });
        }

        const payload = {
            userId,
            registrationId,
            identityKey: bufferToBase64(identityKeyPair.pubKey),
            signedPreKey: {
                keyId: signedPreKeyId,
                publicKey: bufferToBase64(signedPreKey.keyPair.pubKey),
                signature: bufferToBase64(signedPreKey.signature)
            },
            preKeys: publicPreKeys
        };

        await axios.post('/api/v1/keys/upload', payload);
        localStorage.setItem('e2eeVaultOwner', userId);
    } catch (err) {
        console.error("Failed to generate or upload keys:", err);
        throw new Error(err.response?.data?.error || "Failed to secure E2EE keys on server");
    }
};

export const clearLocalKeys = async () => {
    try {
        await clearLocalMessages();
        await mediaKeyCache.clearCache();
    } catch (err) {
        console.warn(err);
    }

    if (signalStore) {
        try {
            await signalStore.clearAllStores();
        } catch (e) {
            console.warn("Failed to clear signal store", e);
        }
    }
};
```

---

### 11.8 `client/src/features/encryption/sessionManager.js` — X3DH Session Builder
```javascript
import { SessionBuilder, SignalProtocolAddress } from '@privacyresearch/libsignal-protocol-typescript';
import { signalStore } from './keyManager';
import { base64ToBuffer } from './cryptoService';
import axios from 'axios';

const sessionLocks = {};

export const ensureSession = async (remoteUserId) => {
    if (sessionLocks[remoteUserId]) {
        return sessionLocks[remoteUserId];
    }

    sessionLocks[remoteUserId] = (async () => {
        try {
            const address = new SignalProtocolAddress(remoteUserId, 1);
            const sessionRecord = await signalStore.loadSession(address.toString());

            if (sessionRecord) {
                return;
            }

            const response = await axios.get(`/api/v1/keys/${remoteUserId}`);
            const bundle = response.data;

            if (!bundle || !bundle.identityKey || !bundle.signedPreKey || !bundle.signedPreKey.publicKey) {
                throw new Error("User encryption keys are incomplete or corrupted on the server");
            }

            if (!bundle.preKey || !bundle.preKey.publicKey) {
                throw new Error("PreKey missing from server response. Remote user has exhausted all keys.");
            }

            const preKeyBundle = {
                registrationId: bundle.registrationId,
                identityKey: base64ToBuffer(bundle.identityKey),
                signedPreKey: {
                    keyId: bundle.signedPreKey.keyId,
                    publicKey: base64ToBuffer(bundle.signedPreKey.publicKey),
                    signature: base64ToBuffer(bundle.signedPreKey.signature)
                },
                preKey: {
                    keyId: bundle.preKey.keyId,
                    publicKey: base64ToBuffer(bundle.preKey.publicKey)
                }
            };

            const builder = new SessionBuilder(signalStore, address);
            await builder.processPreKey(preKeyBundle);

        } catch (err) {
            if (err.response && err.response.status === 404) {
                throw new Error("User not initialized for encryption");
            }
            throw err;
        } finally {
            delete sessionLocks[remoteUserId];
        }
    })();

    return sessionLocks[remoteUserId];
};
```

---

### 11.9 `client/src/features/encryption/messageEncryptor.js` — Signal Encrypt
```javascript
import { SessionCipher, SignalProtocolAddress } from '@privacyresearch/libsignal-protocol-typescript';
import { signalStore } from './keyManager';
import { ensureSession } from './sessionManager';
import { uint8ToBase64 } from './cryptoService';

export const encryptMessage = async (remoteUserId, plaintext) => {
    try {
        await ensureSession(remoteUserId);

        const encoder = new TextEncoder();
        const plaintextBuffer = encoder.encode(plaintext);

        const address = new SignalProtocolAddress(remoteUserId, 1);
        const cipher = new SessionCipher(signalStore, address);

        const ciphertextObj = await cipher.encrypt(plaintextBuffer.buffer);

        let base64Body;
        if (typeof ciphertextObj.body === 'string') {
            const charCodes = new Uint8Array(ciphertextObj.body.length);
            for (let i = 0; i < ciphertextObj.body.length; i++) {
                charCodes[i] = ciphertextObj.body.charCodeAt(i);
            }
            base64Body = uint8ToBase64(charCodes);
        } else {
            base64Body = uint8ToBase64(new Uint8Array(ciphertextObj.body));
        }

        return {
            type: ciphertextObj.type,
            body: base64Body
        };

    } catch (err) {
        console.error(`E2EE Encryption Failed for ${remoteUserId}:`, err);
        throw err;
    }
};
```

---

### 11.10 `client/src/features/encryption/messageDecryptor.js` — Signal Decrypt
```javascript
import { SessionCipher, SignalProtocolAddress } from '@privacyresearch/libsignal-protocol-typescript';
import { signalStore } from './keyManager';
import { base64ToUint8 } from './cryptoService';

export const decryptMessage = async (remoteUserId, type, ciphertextBase64, isMediaKey = false) => {
    try {
        const address = new SignalProtocolAddress(remoteUserId, 1);
        const cipher = new SessionCipher(signalStore, address);

        const ciphertextArray = base64ToUint8(ciphertextBase64);

        let plaintextBuffer;

        if (type === 3) {
            plaintextBuffer = await cipher.decryptPreKeyWhisperMessage(ciphertextArray.buffer);
        } else {
            plaintextBuffer = await cipher.decryptWhisperMessage(ciphertextArray.buffer);
        }

        const decoder = new TextDecoder();
        return decoder.decode(new Uint8Array(plaintextBuffer));

    } catch (err) {
        console.error(`E2EE Decryption Failed for ${remoteUserId}:`, err);
        if (isMediaKey) {
            throw new Error('Media AES Key failed to decrypt. Ciphertext may be unratcheted.');
        }
        return {
            text: "",
            error: true,
            reason: err.message || "Decryption failed. Could not verify keys."
        };
    }
};
```

---

*Continued in Part 3: Hooks (useNotes, useEncryptedMessaging), UI Components (MessageBubble, DecryptedMedia), and Server Routes (noteRoutes)...*
*Generated: 2026-03-19 | Status: PART 2 OF 3*
