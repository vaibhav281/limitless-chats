# Architecture TODO List

## Security Hardening
* Add magic number validation using the `file-type` library in `upload.js`
* Prevent MIME spoofing by checking actual file signatures

## Memory Management
* Implement `URL.revokeObjectURL` on `DecryptedMedia.jsx` unmount
* Add reference counting to `blobCache.js`
* Prevent memory leaks from large media

## Performance Optimization
* Add `IntersectionObserver` lazy decryption
* Prevent simultaneous decryption of all media messages

## Configuration Safety
* Add `configValidator.js` to validate `supportedFileTypes.json` at server startup
* Ensure required keys exist:
  * `images`
  * `video`
  * `audio`
  * `documents`
  * `archives`
  * `MAX_FILE_SIZE`

## UI Improvements
* Convert `PreviewModal` from horizontal scroll to WhatsApp-style grid layout
* Ensure modal handles 20+ attachments cleanly

## Future Features
* BlurHash preview for encrypted images
* Chunked encryption for files larger than 100MB
* IndexedDB blob persistence for offline preview
