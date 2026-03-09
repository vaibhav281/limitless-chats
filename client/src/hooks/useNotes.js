import { useState, useRef, useCallback, useEffect } from 'react';
import { fetchNotes, createNote, deleteNoteAPI, deleteMultipleNotesAPI, pinNoteAPI, unpinNoteAPI, editNoteAPI, fetchUnreadCountsAPI, markReadAPI, fetchConversationsAPI } from '../services/api';
import useSocket from './useSocket';
import useMessageStatus from './useMessageStatus';
import useEncryptedMessaging from './useEncryptedMessaging';
import { saveMessageLocally, getMessageLocally } from '../features/encryption/localMessageStore';
import { mediaKeyCache } from '../features/encryption/mediaKeyCache';
import { MessageLifecycleManager } from '../features/encryption/MessageLifecycleManager';

// Helper to reliably merge notes chronologically (Adjustment 3)
function mergeMessages(existing, incoming) {
  const all = [...existing, ...incoming];
  const unique = [];
  const seen = new Set();

  // Sort by timestamp newest first (index 0 is newest)
  all.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  for (const m of all) {
    if (!seen.has(m._id)) {
      seen.add(m._id);
      unique.push(m);
    }
  }
  return unique;
}

export default function useNotes(initialLimit = 20, chatWithId = null, username = "") {
  const [userId] = useState(() => {
    return localStorage.getItem('userId');
  });

  const [notes, setNotes] = useState([]);
  const [hasMore, setHasMore] = useState(true);
  const [unreadCounts, setUnreadCounts] = useState({});
  const [conversations, setConversations] = useState([]);
  const loadingRef = useRef(false);

  const { socket, activeUsers } = useSocket(userId, username);
  const { markAsDelivered, markAsSeen } = useMessageStatus(socket, setNotes, userId);
  const { isKeysReady, encryptOutgoing, decryptIncoming } = useEncryptedMessaging(userId);
  const sentMessagesCache = useRef(new Map());

  // Fetch initial unread counts and conversation history on mount
  useEffect(() => {
    fetchUnreadCountsAPI(userId)
      .then(counts => setUnreadCounts(counts))
      .catch(err => console.error("Error fetching unread counts:", err));

    fetchConversationsAPI(userId)
      .then(convs => setConversations(convs))
      .catch(err => console.error("Error fetching conversations:", err));
  }, [userId]);

  useEffect(() => {
    if (!socket) return;

    socket.on('newNote', async (rawNote) => {
      // 1. Pull optimistic text if we sent it
      let rawNoteToProcess = rawNote;
      if (rawNote.senderId === userId && sentMessagesCache.current.has(rawNote.ciphertext)) {
        const cachedPayload = sentMessagesCache.current.get(rawNote.ciphertext);
        if (typeof cachedPayload === 'string') {
          rawNoteToProcess = { ...rawNote, noteText: cachedPayload, isDecrypted: true };
        } else {
          rawNoteToProcess = {
            ...rawNote,
            noteText: cachedPayload.text,
            attachments: cachedPayload.attachments || [],
            isDecrypted: true
          };
        }
      }

      // 2. CENTRAL MESSAGE LIFECYCLE PIPELINE (Adjustment 5: UI doesn't talk directly to Crypto)
      const note = await MessageLifecycleManager.processMessage(rawNoteToProcess, decryptIncoming);

      // Determine if this note belongs to the currently perfectly focused chat
      let isRelevant = false;
      const isGroup = note.isGroup || note.receiverId === 'global_group';
      const sender = isGroup ? note.receiverId : note.senderId;

      if (isGroup) {
        isRelevant = (chatWithId === note.receiverId);
      } else {
        isRelevant =
          (note.senderId === chatWithId && note.receiverId === userId) ||
          (note.senderId === userId && note.receiverId === chatWithId);
      }

      if (isRelevant) {
        setNotes(prev => mergeMessages(prev, [note]));

        // Immediately mark this incoming socket message as read natively
        if (note.senderId !== userId) {
          markReadAPI(sender, userId).catch(err => console.error("Failed to mark newly socketed note read", err));
          socket.emit('markAsRead', { senderId: sender, receiverId: userId }); // Sync other tabs
          markAsDelivered(note._id);
          markAsSeen(chatWithId, [note._id]);
        }
      } else {
        // We are NOT looking at this chat. Safely increment the unread badge natively.
        // Don't alert if we actually sent it ourselves from another tab
        if (note.senderId !== userId) {
          markAsDelivered(note._id);
          setUnreadCounts(prev => ({
            ...prev,
            [sender]: (prev[sender] || 0) + 1
          }));
        }
      }
      // Update Conversations List (Sidebar Previews)
      setConversations(prev => {
        const next = [...prev];
        const isGlobal = note.receiverId === 'global_group' || note.isGroup;
        const partnerId = isGlobal ? note.receiverId : (note.senderId === userId ? note.receiverId : note.senderId);

        const existingIdx = next.findIndex(c => c.partnerId === partnerId);

        const newConvData = {
          _id: isGlobal ? note.receiverId : (note.senderId < note.receiverId ? `${note.senderId}_${note.receiverId}` : `${note.receiverId}_${note.senderId}`),
          partnerId,
          isGroup: isGlobal,
          lastMessage: {
            _id: note._id,
            noteText: note.noteText,
            senderId: note.senderId,
            senderName: note.senderName,
            timestamp: note.timestamp,
            attachments: note.attachments,
            isEdited: note.isEdited
          },
          updatedAt: note.timestamp
        };

        if (existingIdx > -1) {
          next[existingIdx] = newConvData;
        } else {
          next.push(newConvData);
        }

        // Sort so the latest is at the top
        return next.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
      });

    });

    socket.on('messagesRead', ({ senderId, receiverId }) => {
      // If another tab marked messages from a specific sender as read, clear the local badge
      if (receiverId === userId) {
        setUnreadCounts(prev => {
          const next = { ...prev };
          delete next[senderId];
          return next;
        });
      }
    });

    socket.on('noteUpdated', (updatedNote) => {
      setNotes(prev => prev.map(n => n._id === updatedNote._id ? updatedNote : n));

      // Update sidebar preview if the edited note is the last message
      setConversations(prev => prev.map(conv => {
        if (conv.lastMessage._id === updatedNote._id) {
          return {
            ...conv,
            lastMessage: {
              ...conv.lastMessage,
              noteText: updatedNote.noteText,
              isEdited: updatedNote.isEdited,
              isDeletedForEveryone: updatedNote.isDeletedForEveryone,
              isDeleted: updatedNote.isDeleted,
              attachments: updatedNote.attachments
            }
          };
        }
        return conv;
      }));
    });

    return () => {
      socket.off('newNote');
      socket.off('messagesRead');
      socket.off('noteUpdated');
    };
  }, [socket, chatWithId, userId, markAsDelivered, markAsSeen]);

  const loadLatest = useCallback(async () => {
    if (loadingRef.current || !chatWithId) return;
    loadingRef.current = true;
    try {
      const rawData = await fetchNotes({ limit: initialLimit, userId, chatWithId });

      // Reverse raw data so the pipeline processes sequentially from oldest to newest
      const reversedRaw = [...rawData].reverse();

      // Execute the centralized Incremental Pipeline
      const data = await MessageLifecycleManager.processMessages(reversedRaw, decryptIncoming);

      // Ensure the UI state remains perfectly ordered newest-first
      data.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

      setNotes(data);
      setHasMore(data.length === initialLimit);
    } finally {
      loadingRef.current = false;
    }
  }, [initialLimit, userId, chatWithId, decryptIncoming]);

  const loadOlder = useCallback(async () => {
    if (loadingRef.current || !notes.length || !chatWithId) return;
    loadingRef.current = true;
    try {
      const earliest = notes[notes.length - 1].timestamp;
      const rawData = await fetchNotes({ before: earliest, limit: initialLimit, userId, chatWithId });
      if (!rawData.length) {
        setHasMore(false);
        return;
      }

      const reversedRaw = [...rawData].reverse();
      const data = await MessageLifecycleManager.processMessages(reversedRaw, decryptIncoming);

      setNotes(prev => mergeMessages(prev, data));
      setHasMore(data.length === initialLimit);
    } finally {
      loadingRef.current = false;
    }
  }, [initialLimit, notes, userId, chatWithId, decryptIncoming]);

  const addNote = useCallback(async (noteData, replyTo = null) => {
    if (!chatWithId) return null;
    let payload;
    const senderName = username || "Anonymous";
    let finalOptimisticNote;

    try {
      if (typeof noteData === 'string') {
        const plaintext = noteData;
        let ciphertext, type;

        ({ ciphertext, type } = await encryptOutgoing(chatWithId, plaintext, []));
        sentMessagesCache.current.set(ciphertext, plaintext);

        payload = { ciphertext, type, replyTo, senderName, senderId: userId, receiverId: chatWithId };
        const newNote = await createNote(payload);

        finalOptimisticNote = {
          ...newNote,
          _id: newNote._id || Date.now().toString(),
          noteText: plaintext,
          status: "sent"
        };

        setNotes(prev => {
          if (prev.some(n => n._id === finalOptimisticNote._id)) return prev;
          return [finalOptimisticNote, ...prev];
        });

      } else {
        // Support for attachments (DailyNotesPage already encrypted and appended to FormData)
        payload = noteData;
        const newNote = await createNote(payload);

        finalOptimisticNote = {
          ...newNote,
          status: "sent"
        };
      }

      await saveMessageLocally(finalOptimisticNote); // Cache our own sent message

      if (typeof noteData === 'string') {
        await mediaKeyCache.saveMediaKey(userId, finalOptimisticNote._id, 'text', {
          decryptedText: noteData
        });
      }

      return finalOptimisticNote;
    } catch (err) {
      console.error(err);
      alert(err.message || "Encryption and Delivery Failed");
      return null;
    }
  }, [chatWithId, userId, username, encryptOutgoing]);

  const deleteNote = useCallback(async (id, deleteType = 'for_me') => {
    try {
      const data = await deleteNoteAPI(id, userId, deleteType);

      // If it's private (for_me directly or via API response), set a local tombstone
      if (deleteType === 'for_me' || data?.forMeOnly) {
        setNotes(prev => prev.map(n => n._id === id ? { ...n, isDeletedForMe: true, noteText: "", attachments: [] } : n));
      } else if (data && data.note) {
        // If for everyone, reflect the muted state
        setNotes(prev => prev.map(n => n._id === id ? data.note : n));
      }
    } catch (err) {
      console.error(err);
      alert(err.response?.data?.error || "Failed to delete note.");
    }
  }, [userId]);

  const deleteMany = useCallback(async (ids, deleteType = 'for_me') => {
    try {
      await deleteMultipleNotesAPI(ids, userId, deleteType);
      if (deleteType === 'for_me') {
        setNotes(prev => prev.map(n =>
          ids.includes(n._id) ? { ...n, isDeletedForMe: true, noteText: "", attachments: [] } : n
        ));
      } else {
        setNotes(prev => prev.map(n =>
          ids.includes(n._id) ? { ...n, isDeletedForEveryone: true, noteText: "", attachments: [] } : n
        ));
      }
    } catch (err) {
      console.error(err);
      alert("Failed to delete notes.");
    }
  }, [userId]);

  const editNote = useCallback(async (id, newText) => {
    try {
      const updated = await editNoteAPI(id, { noteText: newText, userId });
      setNotes(prev => prev.map(n => (n._id === id ? updated : n)));
      return updated;
    } catch (err) {
      console.error(err);
      alert("Failed to edit note. You may not be the author.");
      throw err;
    }
  }, [userId]);

  const pinNote = useCallback(async (id) => {
    const updated = await pinNoteAPI(id);
    setNotes(prev => prev.map(n => (n._id === id ? updated : n)));
  }, []);

  const unpinNote = useCallback(async (id) => {
    const updated = await unpinNoteAPI(id);
    setNotes(prev => prev.map(n => (n._id === id ? updated : n)));
  }, []);

  const fetchNotesAgain = useCallback(loadLatest, [loadLatest]);

  // Reset and load when chatWithId changes
  useEffect(() => {
    setNotes([]);
    setHasMore(true);
    if (chatWithId) {
      loadLatest();
    }
  }, [chatWithId, loadLatest]);

  const cacheSentMessage = useCallback((cText, plainText, plainAttachments) => {
    sentMessagesCache.current.set(cText, { text: plainText, attachments: plainAttachments });
  }, []);

  return {
    notes,
    setNotes,
    activeUsers,
    userId,
    hasMore,
    loadLatest,
    loadOlder,
    addNote,
    deleteNote,
    deleteMany,
    pinNote,
    unpinNote,
    fetchNotes: fetchNotesAgain,
    editNote,
    unreadCounts,
    setUnreadCounts,
    conversations,
    socket,
    cacheSentMessage
  };
}
