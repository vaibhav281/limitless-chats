import { SessionBuilder, SignalProtocolAddress } from '@privacyresearch/libsignal-protocol-typescript';
import { signalStore } from './keyManager';
import { base64ToBuffer } from './cryptoService';
import axios from 'axios';

// Ensure a session exists with a given user. If not, fetch their public bundle and build it.
export const ensureSession = async (remoteUserId) => {
    // 1. Check if we already have a session
    const address = new SignalProtocolAddress(remoteUserId, 1);
    const sessionRecord = await signalStore.loadSession(address.toString());

    if (sessionRecord) {
        // Session exists
        return;
    }

    try {
        // 2. Fetch their Public Key Bundle from Server
        console.log(`No local E2EE session for ${remoteUserId}. Fetching public keys...`);
        const response = await axios.get(`/api/v1/keys/${remoteUserId}`);
        const bundle = response.data;

        if (!bundle || !bundle.identityKey || !bundle.signedPreKey || !bundle.signedPreKey.publicKey) {
            console.error("Invalid key bundle received from server:", bundle);
            throw new Error("User encryption keys are incomplete or corrupted on the server");
        }

        if (!bundle.preKey || !bundle.preKey.publicKey) {
            throw new Error("PreKey missing from server response. Remote user has exhausted all keys.");
        }

        // 3. Construct PreKeyBundle object expected by Signal Protocol
        const preKeyBundle = {
            registrationId: bundle.registrationId,
            identityKey: base64ToBuffer(bundle.identityKey),
            signedPreKey: {
                keyId: bundle.signedPreKey.keyId,
                publicKey: base64ToBuffer(bundle.signedPreKey.publicKey),
                signature: base64ToBuffer(bundle.signedPreKey.signature)
            },
            preKey: {
                keyId: bundle.preKey.keyId,
                publicKey: base64ToBuffer(bundle.preKey.publicKey)
            }
        };

        // 4. Build the Session (X3DH)
        const builder = new SessionBuilder(signalStore, address);
        await builder.processPreKey(preKeyBundle);

        console.log(`X3DH Session established with ${remoteUserId}.`);
    } catch (err) {
        if (err.response && err.response.status === 404) {
            throw new Error("User not initialized for encryption");
        }
        throw err;
    }
};
