# PROJECT MASTER HANDOVER: Limitless-Chats E2EE Platform
# ULTIMATE MERGED EDITION — COMPLETE SOURCE FILES

This is the absolute "Source of Truth" for the **Limitless-Chats** project. It merges ALL historic documentation, audit reports, and technical deep-dives. Every critical file is included IN FULL — no snippets, no cuts.

---

## 🚀 1. Project Vision & Philosophy
**Limitless-Chats** is a production-grade E2EE messaging platform mirroring **Signal/WhatsApp** protocols.

*   **The Golden Rule**: The Server and Database are **UNTRUSTED**. They must never see plaintext.
*   **Security Standard**: Signal Protocol (X3DH + Double Ratchet) + AES-256-GCM Media.
*   **Tech Stack**:
    *   **Frontend**: React (Vite) + Material UI + Web Crypto API.
    *   **Backend**: Node.js (Express) + Socket.IO + MongoDB (Mongoose).
    *   **Persistence**: IndexedDB (Client keys/blobs) + MongoDB (Server ciphertext).

---

## 🏗️ 2. The 5-Layer Encryption Model
1.  **Identity Layer**: Long-term Curve25519 identity key pairs stored in IndexedDB.
2.  **Session Layer (X3DH)**: Uses ephemeral PreKeys for asynchronous session setup.
3.  **Ratchet Layer**: Double Ratchet provides **Forward Secrecy** + **Post-Compromise Security**.
4.  **Message Layer**: Signal-encrypted envelope containing text/attachment metadata.
5.  **Media Layer**: Hybrid Encryption — random AES key per file, delivered inside the Signal envelope.

---

## 📡 3. API Specification

### Auth & Key Management
- `POST /api/v1/auth/register`: Create user account.
- `POST /api/v1/auth/login`: Authenticate and obtain JWT.
- `POST /api/v1/keys/upload`: `{ userId, identityKey, signedPreKey, preKeys[] }` (Base64).
- `GET /api/v1/keys/:userId`: Fetch public bundle to start a session.

### Messaging (Note API)
- `POST /api/v1/notes`: Multipart Upload for messages with attachments.
- `GET /api/v1/notes?userId=...&chatWithId=...`: Fetch history with offset/limit.
- `PUT /api/v1/notes/:id`: Edit. Writes encrypted ciphertext to `plaintextEdit` (15m window).
- `DELETE /api/v1/notes/:id?deleteType=for_everyone`: Soft delete tombstones (24h window).
- `PUT /api/v1/notes/mark-read`: Triggers "Blue Ticks" via Socket.IO.
- `GET /api/v1/notes/conversations/:userId`: Sidebar conversation list with last message.
- `GET /api/v1/notes/unread-counts/:userId`: Unread badge counts.
- `POST /api/v1/notes/pin/:id`: Pin message (max 3 per user).
- `POST /api/v1/notes/unpin/:id`: Unpin message.

### POST /api/v1/notes — Data Passing Detail
**Content-Type**: `multipart/form-data`

| Field | Content | Format |
|:---|:---|:---|
| `ciphertext` | Signal Envelope | Base64 String |
| `type` | Signal message type (1 or 3) | Number |
| `senderId` | Sender's userId | String |
| `receiverId` | Receiver's userId or `global_group` | String |
| `senderName` | Display name | String |
| `replyTo` | MongoDB ObjectId of replied message | String (optional) |
| `attachmentsMeta` | Array of per-file encryption metadata | Stringified JSON |
| `files[]` | Encrypted binary blobs | Binary Files |

**`attachmentsMeta` JSON structure (per file)**:
```json
{
  "id": "sha256_content_hash",
  "fileName": "photo.jpg",
  "iv": "base64_iv_12_bytes",
  "type": "image",
  "originalMimeType": "image/jpeg",
  "encryptedKeysMap": {
    "receiver_user_id": {
      "key": "signal_wrapped_aes_key_base64",
      "type": 3
    }
  }
}
```

---

## 💾 4. IndexedDB Store Architecture (Client-Side Vault)
| DB Name | Store | Key Schema | Contents |
|:---|:---|:---|:---|
| `LimitlessE2EE` | `identity`, `preKeys`, `signedPreKeys`, `sessions`, `identityKeys` | Various | Signal protocol state |
| `limitless-media-cache` | `mediaKeys` | `userId:noteId:attachmentIndex` | Decrypted AES keys (Uint8Array) |
| `limitless-media-blobs` | `files` | `noteId_attachmentId` | Decrypted binary file data |
| `LocalMessageStore` | `messages` | `_id` (message ID) | Decrypted message objects |

---

## 🔒 5. Critical Security Nuances
*   **Global Signal Mutex**: `globalSignalMutex` in `useEncryptedMessaging.js` ensures only ONE ratchet processes at once. Prevents `MessageCounterError`.
*   **Session Repair**: Detects "Bad MAC" → removes broken session → fetches fresh X3DH bundle → re-decrypts.
*   **IV Reuse Guard**: `usedIVs` Set prevents using same IV twice in a session.
*   **Single Decryption Rule**: Every message decrypted strictly ONCE. Re-decrypting old messages would rewind the ratchet.
*   **Key Scrubbing**: After persisting AES keys to IndexedDB, binary keys are `delete`d from React state objects.
*   **Sender Skip Rule**: Sender NEVER attempts Signal decryption of their own messages (would cause `MessageCounterError`).

---

## 📜 6. Project History & Milestones
*   **Jan 2026**: Basic chat with Socket.IO.
*   **Feb 2026**: E2EE implementation (Signal Protocol + AES-GCM media).
*   **Feb 2026**: Production caching with IndexedDB for media keys.
*   **Mar 2026**: Emergency pipeline repair (flickering, hydration bugs).
*   **Mar 2026**: Download naming fix (Multer hash → original filename mapping).
*   **Mar 2026**: IDB v2 upgrade to clear corrupted `{0: 121...}` serialized objects.

---

## 🌍 7. Global Features

### ✅ Working Now
*   E2EE Text + Media (Signal + AES-GCM)
*   Global Group Chat (`global_group` broadcast)
*   Status Ticks (Sent → Delivered → Seen/Blue)
*   Message Selection (multi-select bulk delete/pin)
*   Reply-to with E2EE text resolution
*   Edit (15min window, E2EE re-encrypted)
*   Pin (max 3 per user)
*   Delete for Me / Delete for Everyone (24h window)
*   LRU Blob Cache (200 items, memory-safe)
*   Lazy Load (IntersectionObserver in DecryptedMedia)
*   Video Thumbnail Generation (Canvas + requestIdleCallback)
*   Ref-counted Memory Manager (retain/release/revokeObjectURL)

### ⏳ Planned Global Features
1.  **Group E2EE (Sender Keys)**: WhatsApp-style group master key model.
2.  **Contact Discovery**: Hash-based privacy-preserving user lookup.
3.  **WASM Media Compression**: FFMPEG/Canvas resize before encryption.
4.  **BlurHash Thumbnails**: 20-30 byte blur placeholder inside E2EE envelope.
5.  **Chunked Encryption**: Stream encryption for 100MB+ files.

---

## ⚠ 8. Known Bugs & Issues
*   **Edit Cache Bug**: Edited messages become blank after page refresh. `MessageLifecycleManager` merge logic doesn't correctly pull `plaintextEdit` from `mediaKeyCache`.
*   **Sidebar Preview Bug**: Sidebar conversation preview doesn't show edited text after socket update.
*   **Memory Leaks**: Systematic `URL.revokeObjectURL` needed for 1000+ message scroll sessions.
*   **MIME Hardening**: Magic-byte validation in `upload.js` partially implemented but bypasses `.enc` files.

---

## ⚖️ 9. Strict Development Rules
1.  **NO Crypto in React Components**: Use `MessageLifecycleManager`.
2.  **NO NodeJS Buffer**: Use `Uint8Array` in the frontend.
3.  **NO Blob URL Persistence**: Only store binary data in IndexedDB, never `blob:` URLs.
4.  **METADATA IS ENCRYPTED**: Filenames, types, sizes delivered inside E2EE packet.
5.  **NEVER re-decrypt**: Decrypt once, cache, serve from cache forever.
6.  **RESPECT the Ratchet**: Never call `decryptMessage` twice for the same ciphertext.

---

## 📂 10. COMPLETE SOURCE FILES

Every critical file below is provided IN FULL with no cuts.

---

### 10.1 `server/models/Note.js` — MongoDB Schema
```javascript
const mongoose = require("mongoose");

const noteSchema = new mongoose.Schema(
    {
        ciphertext: { type: String, default: "" },
        iv: { type: String, default: "" },
        type: { type: Number, default: 3 },
        timestamp: { type: Date, default: Date.now },
        pinned: { type: Boolean, default: false },
        pinnedAt: { type: Date, default: null },
        attachments: [
            {
                id: { type: String },
                url: { type: String },
                type: { type: String },
                originalMimeType: { type: String },
                originalName: { type: String },
                size: { type: Number },
                encryptedBlobUrl: { type: String },
                encryptedKeys: {
                    type: Map,
                    of: new mongoose.Schema({
                        key: { type: String },
                        type: { type: Number }
                    }, { _id: false })
                },
                iv: { type: String }
            },
        ],
        senderId: { type: String, required: true },
        senderName: { type: String, default: "Anonymous" },
        receiverId: { type: String, required: true },
        isEdited: { type: Boolean, default: false },
        plaintextEdit: { type: String, default: null },
        editedAt: { type: Date },
        editHistory: [{
            noteText: String,
            editedAt: Date
        }],
        isDeletedForEveryone: { type: Boolean, default: false },
        deletedForUsers: [{ type: String }],
        replyTo: { type: mongoose.Schema.Types.ObjectId, ref: "Note", default: null },
        isGroup: { type: Boolean, default: false },
        isRead: { type: Boolean, default: false },
        readBy: [{ type: String }],
        deliveredTo: [{ type: String }],
        status: { type: String, enum: ["sent", "delivered", "seen"], default: "sent" },
        deliveredAt: { type: Date },
        seenAt: { type: Date },
    },
    { timestamps: true }
);

module.exports = mongoose.model("Note", noteSchema);
```

---

### 10.2 `client/src/services/api.js` — API Client
```javascript
import axios from 'axios';

const api = axios.create({
  baseURL: '/api/v1',
  timeout: 10000
});

export const fetchNotes = async ({ before, limit = 20, userId, chatWithId }) => {
  const params = { limit };
  if (before) params.before = before;
  if (userId) params.userId = userId;
  if (chatWithId) params.chatWithId = chatWithId;
  const res = await api.get('/notes', { params });
  return res.data;
};

export const createNote = async (payload) => {
  const res = await api.post('/notes', payload);
  return res.data;
};

export const deleteNoteAPI = async (id, userId, deleteType) => {
  const res = await api.delete(`/notes/${id}`, { params: { userId, deleteType } });
  return res.data;
};

export const deleteMultipleNotesAPI = async (ids, userId, deleteType) => {
  const res = await api.post('/notes/delete-multiple', { ids, userId, deleteType });
  return res.data;
};

export const editNoteAPI = async (id, payload) => {
  const res = await api.put(`/notes/${id}`, payload);
  return res.data;
};

export const pinNoteAPI = async (id, userId) => {
  const res = await api.post(`/notes/pin/${id}`, { userId });
  return res.data;
};

export const fetchPinnedNotesAPI = async (userId) => {
  const res = await api.get(`/notes/pinned/${userId}`);
  return res.data;
};

export const unpinNoteAPI = async (id, userId) => {
  const res = await api.post(`/notes/unpin/${id}`, { userId });
  return res.data;
};

export const fetchUnreadCountsAPI = async (userId) => {
  const res = await api.get(`/notes/unread-counts/${userId}`);
  return res.data;
};

export const markReadAPI = async (senderId, receiverId, isGroup = false) => {
  const res = await api.put('/notes/mark-read', { senderId, receiverId, isGroup });
  return res.data;
};

export const fetchConversationsAPI = async (userId) => {
  const res = await api.get(`/notes/conversations/${userId}`);
  return res.data;
};
```

---

### 10.3 `client/src/hooks/useSocket.js` — Socket.IO Connection
```javascript
import { useState, useEffect } from 'react';
import { io } from 'socket.io-client';

const socketUrl = import.meta.env.VITE_API_BASE ? import.meta.env.VITE_API_BASE.replace('/api/v1', '') : undefined;
const socket = io(socketUrl);

export default function useSocket(userId, username) {
    const [activeUsers, setActiveUsers] = useState([]);

    useEffect(() => {
        const registerUser = () => {
            if (username && userId) {
                socket.emit("register", { userId, username });
            }
        };

        if (socket.connected) {
            registerUser();
        }

        socket.on("connect", registerUser);

        return () => {
            socket.off("connect", registerUser);
        };
    }, [username, userId]);

    useEffect(() => {
        socket.on('activeUsers', (users) => {
            setActiveUsers(users);
        });

        return () => {
            socket.off('activeUsers');
        };
    }, []);

    return { socket, activeUsers };
}
```

---

### 10.4 `client/src/features/encryption/localMessageStore.js` — Local IDB Cache
```javascript
let localDB = null;

export const initDB = () => {
    if (localDB) return Promise.resolve(localDB);
    return new Promise((resolve, reject) => {
        const request = indexedDB.open("LocalMessageStore", 1);

        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains("messages")) {
                db.createObjectStore("messages", { keyPath: "_id" });
            }
        };

        request.onsuccess = (event) => {
            localDB = event.target.result;
            resolve(localDB);
        };

        request.onerror = (event) => {
            reject(event.target.error);
        };
    });
};

export const saveMessageLocally = async (noteObj) => {
    try {
        const db = await initDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(["messages"], "readwrite");
            const store = transaction.objectStore("messages");

            const noteToSave = { ...noteObj };
            delete noteToSave.ciphertext;

            const request = store.put(noteToSave);

            request.onsuccess = () => resolve();
            request.onerror = (e) => reject(e.target.error);
        });
    } catch (err) {
        console.warn("Failed to save message to local store", err);
    }
};

export const getMessageLocally = async (noteId) => {
    try {
        const db = await initDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(["messages"], "readonly");
            const store = transaction.objectStore("messages");
            const request = store.get(noteId);

            request.onsuccess = (event) => resolve(event.target.result || null);
            request.onerror = (e) => reject(e.target.error);
        });
    } catch (err) {
        console.warn("Failed to get message from local store", err);
        return null;
    }
};

export const clearLocalMessages = async () => {
    try {
        const db = await initDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(["messages"], "readwrite");
            const store = transaction.objectStore("messages");
            const request = store.clear();

            request.onsuccess = () => resolve();
            request.onerror = (e) => reject(e.target.error);
        });
    } catch (err) {
        console.warn("Failed to clear local messages store", err);
    }
};
```

---

### 10.5 `client/src/utils/messageStateResolver.js` — FSM for Message States
```javascript
export function resolveMessageFSM(note, currentUserId) {
    if (note.isDeletedForEveryone) {
        return 'deleted-global';
    }

    if (note.isDeletedForMe || (note.deletedForUsers && note.deletedForUsers.includes(currentUserId))) {
        return 'deleted-local';
    }

    if (note.noteText === 'Waiting for this message. This may take a while.' || note.isEncrypted) {
        if (note.noteText === undefined && (!note.attachments || note.attachments.length === 0)) {
            return 'empty';
        }
    }

    if (typeof note.noteText === 'string' && note.noteText.startsWith('🔐')) {
        return 'waiting';
    }

    if (note.isEncrypted && !note.isDecrypted && !note.noteText && (!note.attachments || note.attachments.length === 0)) {
       return 'waiting';
    }

    return 'normal';
}
```

---

### 10.6 `shared/utils/normalizeAttachments.js` — File Type Classifier
```javascript
export function normalizeAttachments(attachments) {
    const images = [];
    const videos = [];
    const audio = [];
    const files = [];

    if (!attachments || !Array.isArray(attachments)) {
        return { images, videos, audio, files };
    }

    attachments.forEach(file => {
        const mime = (file.mimeType || file.originalMimeType || "").toLowerCase();
        const type = (file.type || "").toLowerCase();
        const name = (file.originalName || file.fileName || "").toLowerCase();

        const isAudioExt = name.endsWith('.mp3') || name.endsWith('.wav') || name.endsWith('.ogg') || name.endsWith('.m4a') || name.endsWith('.aac') || name.endsWith('.wma') || name.endsWith('.opus');
        const isVideoExt = name.endsWith('.mp4') || name.endsWith('.mov') || name.endsWith('.mkv') || name.endsWith('.webm') || name.endsWith('.avi') || name.endsWith('.m4v');
        const isImageExt = name.endsWith('.jpg') || name.endsWith('.jpeg') || name.endsWith('.png') || name.endsWith('.gif') || name.endsWith('.webp') || name.endsWith('.svg');

        if (isAudioExt) {
            audio.push(file);
        } else if (isVideoExt) {
            videos.push(file);
        } else if (isImageExt || mime.startsWith("image/") || type === "image") {
            images.push(file);
        } else {
            files.push(file);
        }
    });

    return { images, videos, audio, files };
}
```

---

### 10.7 `client/src/services/mediaMemoryManager.js` — Ref-Counted URL Manager
```javascript
const map = new Map();

export function bindUrl(key, url, meta = {}) {
    if (!key || !url) return;
    const existing = map.get(key);
    if (existing) {
        existing.refCount += 1;
        return existing.url;
    }
    map.set(key, { url, mimeType: meta.mimeType || null, fileName: meta.fileName || null, refCount: 1 });
    return url;
}

export function retain(key) {
    const e = map.get(key);
    if (e) e.refCount++;
}

export function release(key) {
    const e = map.get(key);
    if (!e) return;
    e.refCount--;
    if (e.refCount <= 0) {
        try { URL.revokeObjectURL(e.url); } catch (err) { /* swallow */ }
        map.delete(key);
    }
}

export function getMeta(key) {
    return map.get(key) || null;
}
```

---

*Continued in next section: Encryption Layer, Hooks, UI Components, and Server Routes...*
*Generated: 2026-03-19 | Status: PART 1 OF 2*
