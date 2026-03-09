import { SessionCipher, SignalProtocolAddress } from '@privacyresearch/libsignal-protocol-typescript';
import { signalStore } from './keyManager';
import { Buffer } from 'buffer';

// Decrypts incoming Signal Ciphertext back into plaintext string
export const decryptMessage = async (remoteUserId, type, ciphertextBase64, isMediaKey = false) => {
    try {
        const address = new SignalProtocolAddress(remoteUserId, 1);
        const cipher = new SessionCipher(signalStore, address);

        // Convert pure Base64 JSON transport string natively back to binary parsing format
        const binaryString = Buffer.from(ciphertextBase64, 'base64').toString('binary');

        let plaintextBuffer;

        if (type === 3) {
            // type 3 == PreKeyWhisperMessage (initial session setup step)
            plaintextBuffer = await cipher.decryptPreKeyWhisperMessage(binaryString, 'binary');
        } else {
            // type 1 == standard Ratchet message
            plaintextBuffer = await cipher.decryptWhisperMessage(binaryString, 'binary');
        }

        // Convert decrypted buffer back to UTF-8 Javascript String
        const decoder = new TextDecoder();
        return decoder.decode(new Uint8Array(plaintextBuffer));

    } catch (err) {
        console.error(`E2EE Decryption Failed for ${remoteUserId}:`, err);
        if (isMediaKey) {
            throw new Error('Media AES Key failed to decrypt. Ciphertext may be unratcheted.');
        }
        // Return a secure fallback so UI doesn't crash completely, but warns user
        return "🔐 Waiting for this message. This may take a while.";
    }
};
