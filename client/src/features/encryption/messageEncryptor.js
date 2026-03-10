import { SessionCipher, SignalProtocolAddress } from '@privacyresearch/libsignal-protocol-typescript';
import { signalStore } from './keyManager';
import { ensureSession } from './sessionManager';
import { uint8ToBase64 } from './cryptoService';

// Encrypts plaintext message into a Signal Ciphertext object
export const encryptMessage = async (remoteUserId, plaintext) => {
    try {
        // 1. Ensure we have an active X3DH session
        await ensureSession(remoteUserId);

        // 2. Wrap text into a Uint8Array
        const encoder = new TextEncoder();
        const plaintextBuffer = encoder.encode(plaintext);

        // 3. Initialize Cipher
        const address = new SignalProtocolAddress(remoteUserId, 1);
        const cipher = new SessionCipher(signalStore, address);

        // 4. Encrypt! This produces either a PreKeyWhisperMessage (type 3) or WhisperMessage (type 1)
        const ciphertextObj = await cipher.encrypt(plaintextBuffer.buffer);

        // Natively convert Libsignal binary strings/buffers to pure secure Base64 for JSON transit!
        let base64Body;
        if (typeof ciphertextObj.body === 'string') {
            // Convert binary string to base64 completely natively
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
