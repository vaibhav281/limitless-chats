import { Buffer } from 'buffer';
import axios from 'axios';
import { persistentBlobStore } from './persistentBlobStore';
import { blobCache } from './blobCache';
import { bindUrl } from '../../services/mediaMemoryManager';

// Global Deduplication Lock Registry for Media Decryption
// Ensures that multiple UI components requesting the same media only trigger ONE pipeline execution.
const mediaDecryptionLocks = new Map();
const usedIVs = new Set(); // Session-level IV reuse guard

// Production-Grade E2EE Error Codes
export const E2EE_ERRORS = {
    DECRYPT_PENDING: "ERR_DECRYPT_PENDING",     // Waiting for Signal ratchet
    SIGNAL_DESYNC: "ERR_SIGNAL_DESYNC",         // MAC failure / Session lost
    MEDIA_KEY_MISSING: "ERR_MEDIA_KEY_MISSING", // AES key not found in cache
    MEDIA_DECRYPT_FAIL: "ERR_MEDIA_DECRYPT_FAIL", // AES-GCM decryption failed
    MEDIA_NOT_FOUND: "ERR_MEDIA_NOT_FOUND",     // 404 from server
    MEDIA_TIMEOUT: "ERR_MEDIA_TIMEOUT",         // Network timeout
    CACHE_CORRUPT: "ERR_CACHE_CORRUPT",         // IndexedDB error
    HASH_MISMATCH: "ERR_HASH_MISMATCH"          // Integrity failure
};

/**
 * Computes SHA-256 hash of a buffer to use as a canonical attachment ID.
 * This ensures stability across refreshes and devices.
 */
export async function computeAttachmentHash(buffer) {
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Encrypts a file using AES-GCM 256
 */
export async function encryptFile(file) {
    const arrayBuffer = await file.arrayBuffer();
    const aesKey = await crypto.subtle.generateKey(
        { name: "AES-GCM", length: 256 },
        true,
        ["encrypt", "decrypt"]
    );
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ivBase64 = uint8ToBase64(iv);

    // IV Reuse Guard: Ensure key (freshly generated) + IV pair never repeats in this session
    if (usedIVs.has(ivBase64)) {
        throw new Error("Critical Security Error: IV reuse detected in encryption pipeline.");
    }
    usedIVs.add(ivBase64);

    const ciphertext = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv: iv },
        aesKey, // Use aesKey here
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

    // 1. Restore Binary IV from potential Object/String form
    const iv = ensureUint8Array(ivInput);

    if (!iv || iv.length !== 12) {
        throw new Error(`Invalid IV length: expected 12, got ${iv?.length}. Source: ${typeof ivInput}`);
    }

    // 2. Restore Binary AES Key from potential Object/String form
    const rawKey = ensureUint8Array(aesKeyInput);

    if (!rawKey || rawKey.length !== 32) {
        // This is the common cause of OperationError if Signal returned a warning string (🔐)
        throw new Error(`Invalid AES Key: expected 32 bytes, got ${rawKey?.length}. Potential Signal desync.`);
    }

    // WEB CRYPTO CAUTION: Uint8Array.buffer may return a larger pool buffer.
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

/**
 * Resolves a stable ID for an attachment. 
 * PRIORITIES: 
 * 1. fileHash (The Gold Standard)
 * 2. Canonical 'id' (SHA-256 Content Hash)
 * 3. Attachment UUID ('attachmentId')
 * 4. File Index ('fileIndex')
 */
export function getEffectiveAttachmentId(attachment, indexFallback = 0) {
    if (!attachment) return `unknown_${indexFallback}`;

    // 1. Explicit File Hash
    if (attachment.fileHash) return attachment.fileHash;

    // 2. Canonical id
    if (attachment.id) return attachment.id;

    // 3. Client-generated UUID
    if (attachment.attachmentId) return attachment.attachmentId;

    // 4. File Index (from Signal, for attachments in a message)
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

/**
 * Production-Grade Media Decryption Pipeline.
 * 1. Deduplicates requests via a promise registry (Mutex).
 * 2. Checks caches (LRU then Persistent).
 * 3. Fetches, decrypts, and persists results.
 * 4. Returns a usable Object URL.
 */
export const runMediaDecryptionPipeline = async (noteId, attachment, aesKey, iv, index = 0) => {
    const attachmentId = getEffectiveAttachmentId(attachment, index);
    const cacheKey = getBlobCacheKey(noteId, attachment, index);

    // 1. Enforce Deduplication Lock (Mutex)
    if (mediaDecryptionLocks.has(cacheKey)) {
        console.log(`[cryptoService] Awaiting existing pipeline for ${cacheKey}`);
        return mediaDecryptionLocks.get(cacheKey);
    }

    const pipelinePromise = (async () => {
        try {
            // 2. Check LRU Cache (RAM)
            const boxed = safeUnboxCachedUrl(blobCache.get(cacheKey));
            if (boxed && boxed.url) return boxed.url;

            // 3. Sender Preview / Plaintext Bypass
            // If the URL is already a local blob, it's plaintext. Skip pipeline!
            if (attachment.url && attachment.url.startsWith('blob:')) {
                return attachment.url;
            }

            const resolvedMimeType = attachment.originalMimeType ||
                (attachment.originalName?.toLowerCase().endsWith('.svg') ? 'image/svg+xml' :
                    (attachment.type === "image" ? "image/jpeg" : "application/octet-stream"));

            // 4. Check Persistent Store (IndexedDB)
            const cachedBlob = await persistentBlobStore.getMedia(noteId, attachmentId, resolvedMimeType);
            if (cachedBlob) {
                const url = URL.createObjectURL(cachedBlob);
                blobCache.set(cacheKey, { url, mimeType: resolvedMimeType, fileName: attachment.fileName || attachment.originalName });
                return url;
            }

            // 5. Material Guard
            // If we are missing keys/URL, we return null gracefully. 
            // The UI will show a loading/error state until next hydration.
            if (!aesKey || !iv || !attachment.url) {
                console.warn("[cryptoService] Missing metadata");
                return { failed: true };
            }

            console.log(`[cryptoService] Starting network pipeline for ${attachment.originalName}`);
            const response = await axios.get(attachment.url, { responseType: 'arraybuffer' });

            const decryptedBlob = await decryptFile(
                response.data,
                aesKey,
                iv,
                resolvedMimeType
            );

            // 5. Persist to IndexedDB immediately (Hardening Step)
            await persistentBlobStore.saveMedia(noteId, attachmentId, decryptedBlob);

            // 6. Push to LRU and Return URL
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
        // Clear the lock so future requests (post-cache-eviction) can re-run
        mediaDecryptionLocks.delete(cacheKey);
    }
};

// Utils
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

/**
 * Ensures we always get a structured object when reading from cache,
 * whether the legacy cache saved a string or the new cache saved an object.
 */
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

/**
 * Robustly ensures a value is a Uint8Array.
 * Handles: Uint8Array, ArrayBuffer, Base64 String, and plain Objects (from IndexedDB serialization).
 */
export function ensureUint8Array(input) {
    if (!input) return null;
    if (input instanceof Uint8Array) return input;
    if (typeof input === 'string') return base64ToUint8(input);
    if (input instanceof ArrayBuffer) return new Uint8Array(input);

    // Handle plain objects {0: 121, 1: 44, ...} often seen in serialized DB results
    if (typeof input === 'object' && typeof input[0] === 'number') {
        const arr = [];
        for (let i = 0; typeof input[i] === 'number'; i++) {
            arr.push(input[i]);
        }
        return new Uint8Array(arr);
    }

    return null;
}
