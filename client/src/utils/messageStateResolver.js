export function resolveMessageFSM(note, currentUserId) {
    // 1. DELETED STATES
    if (note.isDeletedForEveryone) {
        return 'deleted-global';
    }

    if (note.isDeletedForMe || (note.deletedForUsers && note.deletedForUsers.includes(currentUserId))) {
        return 'deleted-local';
    }

    // 2. FAILED / PLACEHOLDER STATES
    // If it's pure ciphertext with no decrypted text and no attachments (and no decrypted error string)
    // Actually, Decrypt pending errors are strings like "Waiting for this message..."
    if (note.noteText === 'Waiting for this message. This may take a while.' || note.isEncrypted) {
        // Wait, noteText might just be from error map.
        // Let's rely on standard properties.
        if (note.noteText === undefined && (!note.attachments || note.attachments.length === 0)) {
            return 'empty';
        }
    }

    // Check if it's explicitly decrypted with a Signal error
    if (typeof note.noteText === 'string' && note.noteText.startsWith('🔐')) {
        return 'waiting';
    }

    if (note.isEncrypted && !note.isDecrypted && !note.noteText && (!note.attachments || note.attachments.length === 0)) {
       return 'waiting';
    }

    // 4. NORMAL
    return 'normal';
}
