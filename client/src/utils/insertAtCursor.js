export const insertAtCursor = (inputElement, emoji) => {
    if (!inputElement) return { newText: emoji, cursorStart: emoji.length };

    const { selectionStart, selectionEnd, value } = inputElement;

    // If the input isn't fully initialized with selection cursors, just append
    if (typeof selectionStart !== "number" || typeof selectionEnd !== "number") {
        return { newText: value + emoji, cursorStart: value.length + emoji.length };
    }

    // Slice string at cursor positions
    const startText = value.substring(0, selectionStart);
    const endText = value.substring(selectionEnd, value.length);

    const newText = startText + emoji + endText;
    const newCursorPos = selectionStart + emoji.length;

    return { newText, cursorStart: newCursorPos };
};
