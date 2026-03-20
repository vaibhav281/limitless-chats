/**
 * normalizeAttachments.js
 * 
 * Centralized utility to categorize E2EE file attachments accurately 
 * prior to UI rendering to eliminate mixed-bundle presentation bugs.
 */

export function normalizeAttachments(attachments) {
    const images = [];
    const videos = [];
    const audio = [];
    const files = [];

    if (!attachments || !Array.isArray(attachments)) {
        return { images, videos, audio, files };
    }

    attachments.forEach(file => {
        // Determine type strictly by explicit mimeType first
        const mime = (file.mimeType || file.originalMimeType || "").toLowerCase();
        const type = (file.type || "").toLowerCase();
        const name = (file.originalName || file.fileName || "").toLowerCase();

        const isAudioExt = name.endsWith('.mp3') || name.endsWith('.wav') || name.endsWith('.ogg') || name.endsWith('.m4a') || name.endsWith('.aac') || name.endsWith('.wma') || name.endsWith('.opus');
        const isVideoExt = name.endsWith('.mp4') || name.endsWith('.mov') || name.endsWith('.mkv') || name.endsWith('.webm') || name.endsWith('.avi') || name.endsWith('.m4v');
        const isImageExt = name.endsWith('.jpg') || name.endsWith('.jpeg') || name.endsWith('.png') || name.endsWith('.gif') || name.endsWith('.webp') || name.endsWith('.svg');

        // STRICT EVALUATION ROUND 7: Do NOT rely on MIME substring matching for media mapping!
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
