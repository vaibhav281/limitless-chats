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

    // Convert ArrayBuffers to Base64 for easier JSON transport via Signal (the key and IV)
    const keyBase64 = bufferToBase64(exportedKey);
    const ivBase64 = bufferToBase64(iv.buffer);

    return {
        ciphertextBlob: new Blob([ciphertextBuffer], { type: file.type || "application/octet-stream" }),
        keyBase64,
        ivBase64
    };
};

export const decryptFile = async (ciphertextBlob, keyBase64, ivBase64, originalMimeType) => {
    const arrayBuffer = await ciphertextBlob.arrayBuffer();

    const rawKey = base64ToBuffer(keyBase64);
    const iv = new Uint8Array(base64ToBuffer(ivBase64));

    const key = await window.crypto.subtle.importKey(
        "raw",
        rawKey,
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
export function bufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
}

export function base64ToBuffer(base64) {
    const binary_string = window.atob(base64);
    const len = binary_string.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binary_string.charCodeAt(i);
    }
    return bytes.buffer;
}
