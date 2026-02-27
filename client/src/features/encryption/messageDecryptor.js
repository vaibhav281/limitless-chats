import { SessionCipher, SignalProtocolAddress } from '@privacyresearch/libsignal-protocol-typescript';
import { signalStore } from './keyManager';

// Decrypts incoming Signal Ciphertext back into plaintext string
export const decryptMessage = async (remoteUserId, type, ciphertextBody) => {
    try {
        const address = new SignalProtocolAddress(remoteUserId, 1);
        const cipher = new SessionCipher(signalStore, address);

        // Ensure it's a Buffer to hand to Signal
        // libsignal might return body as a string (base64) or string (raw bytes) depending on build. 
        // Assuming standard String output that libsignal expects:
        let plaintextBuffer;

        if (type === 3) {
            // type 3 == PreKeyWhisperMessage (initial session setup step)
            plaintextBuffer = await cipher.decryptPreKeyWhisperMessage(ciphertextBody, 'binary');
        } else {
            // type 1 == standard Ratchet message
            plaintextBuffer = await cipher.decryptWhisperMessage(ciphertextBody, 'binary');
        }

        // Convert decrypted buffer back to UTF-8 Javascript String
        const decoder = new TextDecoder();
        return decoder.decode(new Uint8Array(plaintextBuffer));

    } catch (err) {
        console.error(`E2EE Decryption Failed for ${remoteUserId}:`, err);
        // Return a secure fallback so UI doesn't crash completely, but warns user
        return "🔐 Waiting for this message. This may take a while.";
    }
};
