import { Buffer } from 'buffer';

// AES-GCM for File Encryption (not handled by libsignal which is for text)
export const encryptFile = async (file) => {
    const arrayBuffer = await file.arrayBuffer();
    const key = await window.crypto.subtle.generateKey(
        { name: "AES-GCM", length: 256 },
        true,
        ["encrypt", "decrypt"]
    );
    const iv = window.crypto.getRandomValues(new Uint8Array(12));

    const ciphertextBuffer = await window.crypto.subtle.encrypt(
        { name: "AES-GCM", iv: iv },
        key,
        arrayBuffer
    );

    const exportedKey = await window.crypto.subtle.exportKey("raw", key);

    // Convert ArrayBuffers to Base64 using robust Node Buffer to avoid Latin1 corruption
    const keyBase64 = uint8ToBase64(new Uint8Array(exportedKey));
    const ivBase64 = uint8ToBase64(iv);

    return {
        ciphertextBlob: new Blob([ciphertextBuffer], { type: file.type || "application/octet-stream" }),
        keyBase64,
        ivBase64
    };
};

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
