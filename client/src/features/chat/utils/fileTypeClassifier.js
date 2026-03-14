/**
 * File Type Classifier Service
 * Categorizes attachments into logical groups for specialized rendering components.
 */

import config from '../../../../../shared/constants/supportedFileTypes.json';
const { SUPPORTED_EXTENSIONS } = config;

export const FILE_TYPES = {
    IMAGE: 'image',
    VIDEO: 'video',
    PDF: 'pdf',
    AUDIO: 'audio',
    DOCUMENT: 'document',
    ARCHIVE: 'archive',
    OTHER: 'other'
};

export function classifyFile(attachment) {
    if (!attachment) return FILE_TYPES.OTHER;

    // 1. Priority check on stored 'type' field (often set securely during upload)
    if (attachment.type && Object.values(FILE_TYPES).includes(attachment.type)) {
        return attachment.type;
    }

    // 2. MimeType classification (quick sweep for standard browsers)
    const mime = (attachment.originalMimeType || attachment.mimeType || '').toLowerCase();
    if (mime.startsWith('image/')) return FILE_TYPES.IMAGE;
    if (mime.startsWith('video/')) return FILE_TYPES.VIDEO;
    if (mime.startsWith('audio/')) return FILE_TYPES.AUDIO;
    if (mime === 'application/pdf') return FILE_TYPES.PDF;

    // 3. Extension fallback via unified shared configurations
    const name = (attachment.fileName || attachment.originalName || '').toLowerCase();
    const ext = name.split('.').pop();

    for (const [category, extensions] of Object.entries(SUPPORTED_EXTENSIONS)) {
        if (extensions.includes(ext)) {
            // Map 'document' to FILE_TYPES.DOCUMENT, etc.
            // PDF has a special standalone previewer usually
            if (ext === 'pdf') return FILE_TYPES.PDF;
            return category; // 'image', 'video', 'audio', 'document', 'archive', 'other'
        }
    }

    return FILE_TYPES.OTHER;
}
