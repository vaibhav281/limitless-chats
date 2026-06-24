# Limitless-Chats: Secure E2EE Messaging Platform
## Project Overview & Technical Summary

**Limitless-Chats** is a production-grade, end-to-end encrypted (E2EE) messaging platform designed to provide privacy and security equivalent to industry-standard protocols like Signal and WhatsApp. This document provides a high-level summary of the project’s vision, architecture, and development history for academic and professional review.

---

### 🚀 1. Project Vision & Philosophy
The core philosophy of **Limitless-Chats** is that the **Server and Database are UNTRUSTED**. 

- **Privacy First**: The backend acts strictly as a delivery man. It never sees plaintext messages or file contents.
- **Security Standard**: We implement the **Signal Protocol** (X3DH Key Exchange + Double Ratchet) for messaging and **AES-256-GCM** for media encryption.
- **Zero-Knowledge**: All decryption keys are generated and stored exclusively on the user's device (IndexedDB), ensuring that even a total compromise of the server would not expose user conversations.

---

### 🏗️ 2. The 5-Layer Encryption Model
To ensure maximum security, the platform employs a layered encryption approach:
1.  **Identity Layer**: Long-term Curve25519 identity key pairs.
2.  **Session Layer (X3DH)**: Uses ephemeral "PreKeys" to allow users to start secure sessions even when one party is offline.
3.  **Ratchet Layer**: Implements a Double Ratchet algorithm to provide **Forward Secrecy** (past messages stay secure even if a key is stolen) and **Post-Compromise Security** (the system heals itself after a breach).
4.  **Message Layer**: Each message is wrapped in a Signal-encrypted envelope.
5.  **Media Layer**: Hybrid Encryption—each file is encrypted with a unique random AES key, which is then delivered securely within the Signal envelope.

---

### 💾 3. Client-Side Vault (IndexedDB Architecture)
Unlike traditional web apps that store data in memory or unencrypted local storage, **Limitless-Chats** uses a sophisticated multi-database IndexedDB architecture:
- **`LimitlessE2EE`**: Stores Signal protocol state (Identity keys, Sessions, Ratchets).
- **`limitless-media-cache`**: A persistent vault for decrypted media keys.
- **`limitless-media-blobs`**: A binary store for decrypted attachments, using a reference-counted memory manager to prevent leaks.
- **`LocalMessageStore`**: A local cache of decrypted text messages for instant loading.

---

### 📜 4. Project History & Milestones (What We Have Done)
The project has evolved through several critical development phases:
- **January 2026**: Foundation—Built the real-time communication layer using Node.js, Socket.IO, and MongoDB.
- **February 2026**: Security Core—Implemented the full Signal Protocol implementation and AES-GCM media encryption pipeline.
- **February 2026**: Optimization—Added persistent client-side caching using IndexedDB to handle large media files without performance degradation.
- **March 2026**: Hardening—Fixed critical "Message Counter Errors" by implementing a Global Signal Mutex and automated session repair logic.
- **March 2026**: UX Refinement—Implemented lazy loading for media, background video thumbnail generation, and a sophisticated message lifecycle manager.

---

### ✅ 5. Current Feature Set
- **E2EE Core**: Text and Media encryption (Signal + AES-GCM).
- **Real-time Status**: Sent, Delivered, and Seen (Blue Tick) indicators.
- **Message Management**: Pinning (max 3), Editing (15m window), and Deleting (For Me/Everyone).
- **Global Groups**: Real-time broadcast in a `global_group` context.
- **Media Handling**: Secure video previews, audio playback, and high-res image viewing.
- **Performance**: LRU (Least Recently Used) cache for memory management and IntersectionObserver for smooth scrolling.

---

### ⏳ 6. Future Roadmap (What's Next)
1.  **Sender Keys (Group E2EE)**: Implementing WhatsApp-style group encryption for private group chats.
2.  **Contact Discovery**: Privacy-preserving user lookups using hashed identifiers.
3.  **WASM Media Compression**: Using FFMPEG (via WebAssembly) to compress videos/images before encryption to save bandwidth.
4.  **BlurHash**: Including instant, tiny blur placeholders in the encrypted envelope for a better loading experience.

---

**Author:** Vaibhav Chavan  
**Tech Stack:** React, Node.js, MongoDB, Socket.IO, Web Crypto API.
