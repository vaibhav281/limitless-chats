# Testing Checklist: E2EE Media Pipeline

Execute these manual tests to verify the integrity of the file upload, UI rendering, and E2EE encryption pipelines. Do not proceed to architecture hardening until all tests pass.

## Test 1: Image Upload
**Upload:** `.jpg`, `.png`, `.webp`, `.heic`
**Verify:**
- [ ] Preview modal renders images correctly without overflow.
- [ ] Image successfully decrypts and displays in the chat bubble.
- [ ] Original filename is preserved upon downloading.

## Test 2: Video Upload
**Upload:** `.mp4`, `.mkv`, `.mov`
**Verify:**
- [ ] Chat bubble only displays a thumbnail placeholder with a Play icon.
- [ ] Full video player only loads and plays when expanded/opened in the modal.
- [ ] No console errors regarding memory or decryption failures.

## Test 3: Audio Upload
**Upload:** `.mp3`, `.m4a`, `.opus`, `.amr`
**Verify:**
- [ ] Audio player capsule loads correctly in the chat bubble.
- [ ] Audio plays successfully after decryption.
- [ ] Playback controls (and waveform if implemented) are fully interactive.

## Test 4: Document Upload
**Upload:** `.pdf`, `.docx`, `.csv`
**Verify:**
- [ ] Correct Material UI document icon is displayed in the preview modal.
- [ ] File bubble renders correctly in the chat timeline.
- [ ] Clicking to download/view opens the correct native viewer or prompts an accurate "Save As" dialogue with the original unencrypted filename.

## Test 5: Blocked Files (Security Validation)
**Upload:** `.exe`, `.bat`, `.sh`
**Expected Result:**
- [ ] Upload is immediately rejected by the frontend validation.
- [ ] If bypassed on the frontend, the backend Multer middleware strictly rejects it.
- [ ] No malicious payload reaches the E2EE storage array.
