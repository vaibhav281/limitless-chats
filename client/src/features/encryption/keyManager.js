import { KeyHelper } from '@privacyresearch/libsignal-protocol-typescript';
import { SignalProtocolStore } from './SignalProtocolStore';
import { bufferToBase64, base64ToBuffer } from './cryptoService';
import { clearLocalMessages } from './localMessageStore';
import { mediaKeyCache } from './mediaKeyCache';
import axios from 'axios';

// Singleton Store
export const signalStore = new SignalProtocolStore();

export const generateAndUploadKeys = async (userId) => {
    try {
        // 1. Check if we already have Keys in IndexedDB AND they belong to this user
        const existingRegistrationId = await signalStore.getLocalRegistrationId();
        const vaultOwner = localStorage.getItem('e2eeVaultOwner');

        if (existingRegistrationId && vaultOwner === userId) {
            console.log("Keys already exist locally for this user. No need to regenerate.");
            return;
        }

        // If vault belonged to someone else, wipe it completely before generating
        if (existingRegistrationId && vaultOwner !== userId) {
            console.log("Vault belongs to a different user. Wiping clean...");
            await clearLocalKeys();
        }

        console.log("Generating new E2EE Keys for user...");

        // 2. Generate Identity Key Pair and Registration ID
        const registrationId = KeyHelper.generateRegistrationId();
        await signalStore.putLocalRegistrationId(registrationId);

        const identityKeyPair = await KeyHelper.generateIdentityKeyPair();
        await signalStore.putIdentityKeyPair(identityKeyPair);

        // 3. Generate Signed Pre-Key
        const signedPreKeyId = 1;
        const signedPreKey = await KeyHelper.generateSignedPreKey(identityKeyPair, signedPreKeyId);
        await signalStore.storeSignedPreKey(signedPreKeyId, signedPreKey);

        // 4. Generate One-Time Pre-Keys
        const publicPreKeys = [];

        // Generate a small batch of pre-keys (e.g., 50)
        for (let i = 1; i <= 50; i++) {
            const preKey = await KeyHelper.generatePreKey(i);
            await signalStore.storePreKey(preKey.keyId, preKey.keyPair);
            publicPreKeys.push({
                keyId: preKey.keyId,
                publicKey: bufferToBase64(preKey.keyPair.pubKey)
            });
        }

        // 5. Structure Payload for Server
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

        // 6. Upload to Backend
        await axios.post('/api/v1/keys/upload', payload);

        // 7. Lock the vault to this user
        localStorage.setItem('e2eeVaultOwner', userId);
        console.log("Successfully uploaded E2EE Keys to Server and locked vault.");

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
