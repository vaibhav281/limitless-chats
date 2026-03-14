# Architectural Review: Answers to 5 Critical Questions

Thank you for the rigorous review! Here are the precise answers regarding the current state of the architecture:

### 1. Does `upload.js` validate MIME type using file signature (magic number) or only extension + MIME header?
**It ONLY uses the extension and the MIME header** provided by the client payload. It does **not** currently use a magic number / file signature check (e.g., via the `file-type` library). You are correct that this leaves a vulnerability where a renamed `.exe` could slip through. We absolutely need to implement true byte-level magic number validation.

### 2. Does `blobCache.js` / `DecryptedMedia.jsx` revoke object URLs using `URL.revokeObjectURL` when media unmounts?
**No, it does not revoke exactly on unmount.** Currently, `DecryptedMedia.jsx` relies entirely on `blobCache.js` (an LRU cache of size 200). `URL.revokeObjectURL` only triggers when old items are pushed out of the 200-item cache. While this prevents infinite leaks, holding 200 high-res images/videos in memory is risky. We need to implement an immediate `revokeObjectURL` on component unmount along with a reference-counting mechanism, or tightly couple the revocation to an `IntersectionObserver`.

### 3. Does `supportedFileTypes.json` have runtime validation to prevent missing keys?
**No.** It is currently blindly destructured in `upload.js`, `DailyNotesPage.jsx`, and `fileTypeClassifier.js`. If a developer or a bad deployment accidentally corrupts or deletes a key inside the JSON, the backend will crash trying to call `.flat()` on an undefined property. A server-startup runtime validator (`configValidator.js`) is highly recommended to enforce the schema.

### 4. Does `PreviewModal.jsx` prevent layout overflow when more than 20 files are selected?
**Technically yes, but practically no.** It uses a horizontal scroll (`overflow-x: auto`), which physically stops the modal from breaking its graphical width. However, making the user swipe horizontally through 20+ thumbnails is exceptionally poor UX. A flexible CSS Grid (wrapping at 3 or 4 columns, max height, vertical scroll) exactly like WhatsApp is the proper structural fix.

### 5. Does `DecryptedMedia.jsx` avoid decrypting all media in the chat list simultaneously?
**No.** Right now, `DecryptedMedia.jsx` immediately begins decryption in its `useEffect` upon mount. If 50 media items are loaded into the chat history document body simultaneously, 50 decryption pipelines fire off at once in a massive Promise chain. This heavily bottlenecks the browser's main thread and WebCrypto API. We need a modern lazy-load mechanism (`IntersectionObserver`) to ensure heavy decryption algorithms only run when the media bubble gets close to entering the viewport.

---
**Final Verdict:** Your assessment is 100% correct. These 5 architectural vulnerabilities require immediate attention to reach truly production-grade parity with Signal/WhatsApp.

I am ready to implement these improvements:
- Integrations of `file-type` magic numbers in Multer.
- Lazy Decryption Interceptors (`react-intersection-observer`).
- JSON Schema guard on Node startup.
- WhatsApp-style Grid refactor for the `PreviewModal.jsx`. 
- `revokeObjectURL` precise memory management.
