import { SessionCipher, SignalProtocolAddress } from '@privacyresearch/libsignal-protocol-typescript';
import { signalStore } from './keyManager';
import { ensureSession } from './sessionManager';
import { Buffer } from 'buffer';

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
            base64Body = Buffer.from(ciphertextObj.body, 'binary').toString('base64');
        } else {
            base64Body = Buffer.from(ciphertextObj.body).toString('base64');
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
