import { SessionCipher, SignalProtocolAddress } from '@privacyresearch/libsignal-protocol-typescript';
import { signalStore } from './keyManager';
import { ensureSession } from './sessionManager';

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

        return {
            type: ciphertextObj.type,
            body: ciphertextObj.body // This is typically a base64 string provided by libsignal
        };

    } catch (err) {
        console.error(`E2EE Encryption Failed for ${remoteUserId}:`, err);
        throw err;
    }
};
