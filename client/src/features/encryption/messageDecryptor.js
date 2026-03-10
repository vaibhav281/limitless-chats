import { SessionCipher, SignalProtocolAddress } from '@privacyresearch/libsignal-protocol-typescript';
import { signalStore } from './keyManager';
import { base64ToUint8 } from './cryptoService';

// Decrypts incoming Signal Ciphertext back into plaintext string
export const decryptMessage = async (remoteUserId, type, ciphertextBase64, isMediaKey = false) => {
    try {
        const address = new SignalProtocolAddress(remoteUserId, 1);
        const cipher = new SessionCipher(signalStore, address);

        console.log(`[messageDecryptor] Decrypting type ${type} message from ${address.toString()}`);

        // Strictly convert Base64 into an exact ArrayBuffer (avoiding NodeJS Buffer Pool offsets)
        const ciphertextArray = base64ToUint8(ciphertextBase64);

        let plaintextBuffer;

        if (type === 3) {
            // type 3 == PreKeyWhisperMessage (initial session setup step)
            plaintextBuffer = await cipher.decryptPreKeyWhisperMessage(ciphertextArray.buffer);
        } else {
            // type 1 == standard Ratchet message
            plaintextBuffer = await cipher.decryptWhisperMessage(ciphertextArray.buffer);
        }

        // Convert decrypted buffer back to UTF-8 Javascript String natively
        const decoder = new TextDecoder();
        return decoder.decode(new Uint8Array(plaintextBuffer));

    } catch (err) {
        console.error(`E2EE Decryption Failed for ${remoteUserId}:`, err);
        if (isMediaKey) {
            throw new Error('Media AES Key failed to decrypt. Ciphertext may be unratcheted.');
        }
        // Return a structured fallback so UI can mount error boundaries cleanly
        return {
            text: "",
            error: true,
            reason: err.message || "Decryption failed. Could not verify keys."
        };
    }
};
