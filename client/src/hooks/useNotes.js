import { useState, useRef, useCallback, useEffect } from 'react';
import { fetchNotes, createNote, deleteNoteAPI, deleteMultipleNotesAPI, pinNoteAPI, unpinNoteAPI, editNoteAPI, fetchUnreadCountsAPI, markReadAPI, fetchConversationsAPI } from '../services/api';
import useSocket from './useSocket';
import useMessageStatus from './useMessageStatus';
import useEncryptedMessaging from './useEncryptedMessaging';
import { saveMessageLocally, getMessageLocally } from '../features/encryption/localMessageStore';

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
      // 1. If we sent this message, we CANNOT logically decrypt it since ratchets are asymmetric.
      // We must pull the plaintext version from our local optimistic store or in-flight cache.
      let note;
      if (rawNote.senderId === userId) {
        if (sentMessagesCache.current.has(rawNote.ciphertext)) {
          note = { ...rawNote, noteText: sentMessagesCache.current.get(rawNote.ciphertext), isDecrypted: true };
        } else {
          const cachedLocal = await getMessageLocally(rawNote._id);
          if (cachedLocal) {
            note = { ...rawNote, noteText: cachedLocal.noteText, isDecrypted: true };
          } else {
            note = { ...rawNote, noteText: "🔐 Message sent from another device or storage cleared", isDecrypted: false };
          }
        }
      } else {
        // It's an incoming message, decrypt it normally.
        note = await decryptIncoming(rawNote);
      }

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

      // CRITICAL FIX: Always save successfully decrypted incoming messages locally!
      // Signal Double Ratchet consumes the ephemeral key upon decryption.
      // If we don't save the plaintext now, opening the chat later will fetch the ciphertext,
      // attempt to decrypt it again, and fail with "MessageCounterError".
      if (note.senderId !== userId && note.isDecrypted) {
        saveMessageLocally(note);
      }

      if (isRelevant) {
        setNotes(prev => {
          if (prev.some(n => n._id === note._id)) return prev;
          return [note, ...prev];
        });

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
      // Decrypt all fetched messages using cache to prevent Double Ratchet Consumption Error
      // Decrypt strictly sequentially from oldest to newest to completely prevent Double Ratchet race conditions
      const data = new Array(rawData.length);
      for (let i = rawData.length - 1; i >= 0; i--) {
        const n = rawData[i];
        if (!n.ciphertext) {
          data[i] = { ...n, noteText: n.noteText || "🔐 Decryption error", isDecrypted: false };
          continue;
        }
        const local = await getMessageLocally(n._id);
        if (local) {
          data[i] = local;
          continue;
        }

        if (n.senderId === userId) {
          data[i] = { ...n, noteText: "🔐 Message sent from another device or storage cleared", isDecrypted: false };
          continue;
        }

        const decrypted = await decryptIncoming(n);
        if (decrypted.isDecrypted) {
          await saveMessageLocally(decrypted);
        }
        data[i] = decrypted;
      }
      setNotes(data);
      setHasMore(data.length === initialLimit);
    } finally {
      loadingRef.current = false;
    }
  }, [initialLimit, userId, chatWithId]);

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
      // Decrypt strictly sequentially from oldest to newest to completely prevent Double Ratchet race conditions
      const data = new Array(rawData.length);
      for (let i = rawData.length - 1; i >= 0; i--) {
        const n = rawData[i];
        if (!n.ciphertext) {
          data[i] = { ...n, noteText: n.noteText || "🔐 Decryption error", isDecrypted: false };
          continue;
        }
        const local = await getMessageLocally(n._id);
        if (local) {
          data[i] = local;
          continue;
        }

        if (n.senderId === userId) {
          data[i] = { ...n, noteText: "🔐 Message sent from another device or storage cleared", isDecrypted: false };
          continue;
        }

        const decrypted = await decryptIncoming(n);
        if (decrypted.isDecrypted) {
          await saveMessageLocally(decrypted);
        }
        data[i] = decrypted;
      }
      setNotes(prev => [...prev, ...data]);
      setHasMore(data.length === initialLimit);
    } finally {
      loadingRef.current = false;
    }
  }, [initialLimit, notes, userId, chatWithId]);

  const addNote = useCallback(async (noteData, replyTo = null) => {
    if (!chatWithId) return null;
    let payload;
    const senderName = username || "Anonymous";

    // 1. Encrypt Outgoing Data
    const plaintext = typeof noteData === 'string' ? noteData : noteData.get('noteText');
    let ciphertext, type, encryptedFiles;
    try {
      ({ ciphertext, type, encryptedFiles } = await encryptOutgoing(chatWithId, plaintext, []));
      sentMessagesCache.current.set(ciphertext, plaintext);
    } catch (err) {
      alert(`Could not securely encrypt message: ${err.message}`);
      return null; // Halt message transmission
    }

    try {
      if (typeof noteData === 'string') {
        payload = { ciphertext, type, replyTo, senderName, senderId: userId, receiverId: chatWithId };
      } else {
        // Support for attachments (TODO: Map encryptedFiles blobs into FormData properly)
        payload = noteData;
        payload.append('ciphertext', ciphertext);
        payload.append('type', type);
        payload.append('senderName', senderName);
        payload.append('senderId', userId);
        payload.append('receiverId', chatWithId);
        if (replyTo) {
          payload.append('replyTo', replyTo);
        }
      }
      const newNote = await createNote(payload);

      // We update local state immediately for snappy UI,
      // Socket will ignore duplicate due to the effect logic.
      const optimisticNote = {
        ...newNote,
        _id: newNote._id || Date.now().toString(), // fallback if somehow not returned
        noteText: plaintext, // Restore the plaintext only for the local optimistic UI
        status: "sent" // Optimistic UI
      };

      await saveMessageLocally(optimisticNote); // Cache our own sent message

      setNotes(prev => {
        if (prev.some(n => n._id === optimisticNote._id)) return prev;
        return [optimisticNote, ...prev];
      });
      return optimisticNote;
    } catch (err) {
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
    socket
  };
}
