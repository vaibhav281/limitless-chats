import { useEffect, useCallback } from 'react';

export default function useMessageStatus(socket, setNotes, currentUserId) {
    useEffect(() => {
        if (!socket) return;

        const handleSingleStatusUpdate = ({ messageId, status, deliveredAt }) => {
            setNotes(prev => prev.map(note =>
                note._id === messageId
                    ? { ...note, status, deliveredAt: deliveredAt || note.deliveredAt }
                    : note
            ));
        };

        const handleMultipleStatusUpdate = ({ messageIds, status, seenAt }) => {
            setNotes(prev => prev.map(note =>
                messageIds.includes(note._id)
                    ? { ...note, status, seenAt: seenAt || note.seenAt }
                    : note
            ));
        };

        socket.on("messageStatusUpdate", handleSingleStatusUpdate);
        socket.on("messagesStatusUpdate", handleMultipleStatusUpdate);

        return () => {
            socket.off("messageStatusUpdate", handleSingleStatusUpdate);
            socket.off("messagesStatusUpdate", handleMultipleStatusUpdate);
        };
    }, [socket, setNotes, currentUserId]);

    // Utility to determine if we should mark incoming message as delivered
    const markAsDelivered = useCallback((messageId) => {
        if (socket) {
            socket.emit("message_delivered", messageId);
        }
    }, [socket]);

    // Utility to mark messages as seen when chat is open
    const markAsSeen = useCallback((chatId, messageIds) => {
        if (socket && messageIds.length > 0) {
            socket.emit("message_seen", { chatId, messageIds });
        }
    }, [socket]);

    return { markAsDelivered, markAsSeen };
}
