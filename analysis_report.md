# Analysis Report: UI and File Naming Bugs

## Overview of Issues from Images & JSON
Based on the provided images and JSON payload analysis, there are **three primary issues** currently affecting the application flow:

### 1. The ".enc" Hash Naming Bug
* **Image Evidence**: Image 1 (Fullscreen preview) shows the file title as `0e57ada...793e.enc`. Image 3 (Chat bubbles) shows all attached documents and audios with names like `c4d0...bf66.enc`. Image 4 (Download Save-As dialogue) defaults the download name to `b254...a86.enc`.
* **JSON Evidence**: In the `attachments` array, the `originalName` attribute is populated with the Multer-generated encrypted filename (e.g., `c4d0...bf66.enc`), whereas `id` is the hash.
* **Cause**: In `server/routes/noteRoutes.js`, the JSON payload is being mapped such that `originalName: file.originalname`. Because Multer strictly appends `.enc` to the filenames BEFORE they hit the route, `file.originalname` is the hashed `.enc` name. The true human-readable name is passed in `meta.fileName`, but the frontend explicitly expects `attachment.originalName` for rendering Titles and triggering Downloads.
* **Has this been raised before?**: This is a new side-effect directly caused by the recent security hardening of the storage pipeline. It doesn't break encryption, but it breaks UX.
* **Solution**: In `noteRoutes.js`, remap the assignment of `originalName` to prioritize the unencrypted human-readable name stored in the `attachmentsMeta` payload. 

### 2. Preview Modal Cramped Limits & Overflow
* **Image Evidence**: Image 2 shows the `PreviewModal` where multiple file previews (PDF, M4A, Images, Video) are cramped together. The modal is expanding horizontally, throwing the input field down. Also, there is no way to scroll through the list properly if too many are added, and the user reported the "Add more" button goes out of sight.
* **Cause**: In `client/src/features/chat/components/PreviewModal.jsx`, the container `<Box>` mapping the `previewFiles` uses `overflowX: 'auto'` but does not enforce a rigid wrapping layout, maximum width, or responsive scrolling bounds on the parent `Dialog`. Additionally, the "Add More" button is rendered *inside* the scrolling flex-row but doesn't shrink, pushing it out of view.
* **Solution**: Wrap the items in a structured flex container (`display: flex`, `flexWrap: nowrap`, `overflowX: auto`) with a fixed spacing gap, and ensure the add button `<Box>` is sticky or permanently visible. Update the `DialogContent` padding to prevent input clipping.

### 3. Broken Document & Audio Preview Icons
* **Image Evidence**: Image 2 shows a PDF file named "Lagn_Patrika.pdf" rendering as a broken black vertical rectangle, because the UI is blindly forcing it into an `<img>` or `<video>` tag logic instead of generating a fallback icon.
* **Cause**: In `PreviewModal.jsx`, looking at lines 9-33, the `PreviewItem` has a syntax error/misplaced bracket where the `else` fallback simply renders `<img src={pf.url} />` no matter if the document is recognized or not, or the PDF categorization isn't matching perfectly from the `pf.type`.
* **Solution**: Refactor `PreviewItem` in `PreviewModal.jsx` to correctly map `pf.type === 'image'` to `<img>`, `video` to `<video>`, and explicitly cleanly fallback `audio` / `document` / `archive` to MUI Icons.

---

## Exact Required Code Changes

### Fix 1: Naming Bug (`server/routes/noteRoutes.js`)
**What happens**: Changes the metadata router mapping. Does **not** break or affect the 100MB limits or the `.enc` storage format.
**Snippet required change**:
```javascript
// Around Line 48 in server/routes/noteRoutes.js
return {
    id: meta.id, 
    fileName: meta.fileName || file.originalname,
    url: `/uploads/${file.filename}`, 
    encryptedBlobUrl: `/uploads/${file.filename}`,
    type,
    originalMimeType: meta.originalMimeType || mime,
    // THE FIX: Provide the frontend exactly what it expects: the human name!
    originalName: meta.fileName || file.originalname, 
    size: file.size,
    encryptedKeys: meta.encryptedKeysMap || {},
    iv: meta.iv
};
```

### Fix 2 & 3: Modal UI & Broken Icons (`client/src/features/chat/components/PreviewModal.jsx`)
**What happens**: Redesigns the flexbox scrolling rules and ensures PDF/Audio render as Icons instead of broken images. Does **not** affect the AES encryption flow.
**Snippet required change**:
```javascript
// Inside PreviewModal.jsx -> PreviewItem Component
const PreviewItem = React.memo(({ pf, onRemove }) => {
  return (
    <Box sx={{ position: 'relative', flexShrink: 0, width: 120, height: 120 }}>
      {pf.type === 'video' ? (
         <video src={pf.url} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 8, backgroundColor: '#000' }} />
      ) : pf.type === 'audio' ? (
         <Box sx={{ width: '100%', height: '100%', bgcolor: "#2a3942", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", borderRadius: 8 }}>
            <AudioFileIcon sx={{ fontSize: 40, color: "#00a884" }} />
            <Typography variant="caption" noWrap sx={{ maxWidth: "90%", mt: 1, color: "#e9edef" }}>{pf.origName}</Typography>
         </Box>
      ) : (pf.type === 'document' || pf.type === 'archive') ? (
         <Box sx={{ width: '100%', height: '100%', bgcolor: "#2a3942", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", borderRadius: 8 }}>
            <InsertDriveFileIcon sx={{ fontSize: 40, color: "#8696a0" }} />
            <Typography variant="caption" noWrap sx={{ maxWidth: "90%", mt: 1, color: "#e9edef" }}>{pf.origName}</Typography>
         </Box>
      ) : ( // Default to Image handling safely
         <img src={pf.url} alt="preview" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 8, backgroundColor: '#2a3942' }} />
      )}
      {/* Remove Button Render */}
    </Box>
  );
});

// Inside PreviewModal DialogContent:
<DialogContent sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
  {/* Horizontal Scroller container */}
  <Box sx={{ display: 'flex', gap: 2, overflowX: 'auto', pb: 1, '&::-webkit-scrollbar': { height: 6 }, '&::-webkit-scrollbar-thumb': { bgcolor: '#3b4a54', borderRadius: 4 } }}>
     {previewFiles.map(...) }
     {/* The sticky Add More box */}
  </Box>
  <TextField ... />
</DialogContent>
```

Everything is mapped out and poses zero risk to existing backend pipelines. Awaiting your approval to apply.
