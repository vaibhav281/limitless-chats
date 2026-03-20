# E2EE State Management & Architecture Rules

This document permanently locks the application's foundational rules for State Management, Caching, and End-to-End Encryption (E2EE) pipeline synchronization.

⚠️ **Violation of these rules will result in catastrophic state divergence (e.g., stale edits, disappearing messages, sync glitches).**

## PART 1 — CORE PRINCIPLE (NON-NEGOTIABLE)
✅ **SINGLE SOURCE OF TRUTH**
1. **SERVER STATE** = ABSOLUTE TRUTH
2. **SOCKET** = REAL-TIME DELIVERY OF TRUTH
3. **CACHE** = PERFORMANCE LAYER (NEVER AUTHORITY)
4. **UI** = PURE RENDER OF STATE

## PART 2 — IMMUTABLE MESSAGE STRUCTURE (FIXED)
Every message MUST follow this structure. This schema is locked:

```javascript
{
  _id: string,

  // ORIGINAL MESSAGE (IMMUTABLE)
  noteText: string,          // ciphertext (never change)
  createdAt: timestamp,

  // EDIT SYSTEM (STRICT LAYER SEPARATION)
  ciphertextEdit: string,    // 🔴 encrypted edit (SERVER ONLY)
  plaintextEdit: string,     // 🔴 decrypted edit (CLIENT ONLY)

  editedAt: timestamp,
  version: number,           // 🔴 MUST increment every edit

  // FLAGS (SERVER CONTROLLED ONLY)
  isEdited: boolean,
  isDeletedForEveryone: boolean,

  // METADATA
  senderId: string,
  attachments: [],
}
```

## PART 3 — HARD RULES (ABSOLUTE, NEVER BREAK)

🚫 **RULE 1 — NEVER TRUST CACHE WITHOUT VERSION CHECK**
Cache is valid ONLY IF `cache.version === server.version`. 
Otherwise: FORCE RE-DECRYPT → UPDATE CACHE.

🚫 **RULE 2 — NEVER STORE CIPHERTEXT AS PLAINTEXT**
❌ WRONG: `local.plaintextEdit = rawMessage.plaintextEdit` (This causes type collision!)
✅ RIGHT: `decrypt(ciphertextEdit) → store decryptedText as plaintextEdit`

🚫 **RULE 3 — `noteText` IS IMMUTABLE FOREVER**
NEVER overwrite. NEVER reuse for edits. NEVER mutate.

🚫 **RULE 4 — SOCKET PROVIDES TRUTH, CACHE REQUIRES VERSION MATCH**
When socket event arrives, use the socket payload as the immutable truth.
You may only use local cache IF `cache.version === socket.version`.
Otherwise: FORCE DECRYPT → UPDATE CACHE → UPDATE UI.

🚫 **RULE 5 — VERSION > EVERYTHING**
Priority order: `version > editedAt > cache > UI`

🚫 **RULE 6 — SENDER & RECEIVER MUST FOLLOW DIFFERENT LOGIC**
- **Sender**: NEVER decrypt own message via Signal. ALWAYS use local cache.
- **Receiver**: ALWAYS decrypt incoming edit. NEVER trust cache blindly.

🚫 **RULE 7 — SENDER MUST ALSO VALIDATE VERSION**
Sender MUST NOT blindly trust cache. Sender MUST compare `cache.version` with incoming `version`. If mismatch → RECONCILE using server data.

🚫 **RULE 8 — NEVER MIX ENCRYPTED & DECRYPTED FIELDS**
- `ciphertextEdit` → ONLY derived from server payload.
- `plaintextEdit` → ONLY derived after successful decryption block.
- UI → MUST ONLY read `plaintextEdit`.

🚫 **RULE 9 — `plaintextEdit` MUST NEVER BE PERSISTED ON SERVER**
`plaintextEdit` MUST NEVER be sent from server. MUST NEVER be stored in database. MUST ONLY exist in React state after decryption.

🚫 **RULE 10 — RENDER LOCK (`isEditReady`)**
UI MUST NOT render edited message text until decryption is confirmed complete.
- `IF note.isEdited && note.isEditReady` → render `plaintextEdit`
- `IF note.isEdited && !note.isEditReady` → keep previous stable text
- `IF !note.isEdited` → render `noteText`
- UI MUST NEVER render `ciphertextEdit`.

🚫 **RULE 11 — NO PARTIAL STATE RENDER**
A message must ONLY render when: `version` is valid AND decryption is complete AND state is stable.

🚫 **RULE 12 — DECRYPTION IS ATOMIC**
Never partially update state. All fields (`plaintextEdit`, `version`, `isEditReady`, `editedAt`) must be set together in a single state update.

## PART 4 — FINAL MESSAGE FLOW (WHATSAPP-LEVEL)

### STEP 1 — MESSAGE CREATE
1. User → Encrypt → Send → Server
2. Server → Store (`version = 1`)
3. Server → Emit socket
4. Receiver → Decrypt → Cache → Render

### STEP 2 — MESSAGE EDIT
**Sender**:
Encrypt new text (`ciphertextEdit`) → `version = version + 1` → Send to server → Set `isEditReady = true` immediately
**Server**:
Update message → Broadcast socket (with `ciphertextEdit`, NEVER `plaintextEdit`)
**Receiver**:
IF `incoming.version > local.version`: FORCE DECRYPT (`incoming.ciphertextEdit`) → UPDATE CACHE → Set `isEditReady = true` → UPDATE UI

### STEP 3 — HYDRATION (REFRESH)
Fetch from server. FOR EACH MESSAGE:
- **IF cache exists**: 
  - `IF cache.version === server.version`: USE CACHE (`plaintextEdit`), set `isEditReady = true`
  - `ELSE`: RE-DECRYPT (`ciphertextEdit`) → UPDATE CACHE → set `isEditReady = true`
- **IF no cache**: DECRYPT → STORE → set `isEditReady = true` → RENDER

### STEP 4 — DELETE
Server → sets `isDeletedForEveryone = true`
**ALL CLIENTS**:
CLEAR: `noteText = ""`, `ciphertextEdit = ""`, `plaintextEdit = ""`, `attachments = []`.
UI: "This message was deleted".

## PART 5 — FUTURE-PROOF ARCHITECTURE CODEC
1. **No blind changes**: Every change must trace Server → Socket → Cache → UI.
2. **No assumption coding**: Never assume a field exists. Always validate schema.
3. **No direct state mutation**: Always use reducer/merge logic.
4. **Define authority**: Every new feature must explicitly define Source of truth, Sync mechanism, and Conflict resolution before code is written.
5. **E2EE pipeline is LOCKED**: ❌ DO NOT TOUCH encryption logic. Only handle *when* to decrypt and *when* to ignore cache.
6. **All sync must be deterministic**: Same Input → Same Output on every device.
