import { useState, useRef, useCallback, useEffect } from 'react';
import { fetchNotes, createNote, deleteNoteAPI, deleteMultipleNotesAPI, pinNoteAPI, unpinNoteAPI, editNoteAPI, fetchUnreadCountsAPI, markReadAPI, fetchConversationsAPI, fetchPinnedNotesAPI } from '../services/api';
import useSocket from './useSocket';
import useMessageStatus from './useMessageStatus';
import useEncryptedMessaging from './useEncryptedMessaging';
import { saveMessageLocally, getMessageLocally } from '../features/encryption/localMessageStore';
import { mediaKeyCache } from '../features/encryption/mediaKeyCache';
import { blobCache } from '../features/encryption/blobCache';
import { MessageLifecycleManager } from '../features/encryption/MessageLifecycleManager';
import { getBlobCacheKey } from '../features/encryption/cryptoService';
import { decryptMessage } from '../features/encryption/messageDecryptor';

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
  const [pinnedMessageIds, setPinnedMessageIds] = useState(new Set());
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

    fetchPinnedNotesAPI(userId)
      .then(pins => setPinnedMessageIds(new Set(pins)))
      .catch(err => console.error("Error fetching pins:", err));
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

    socket.on('noteUpdated', async (updatedNote) => {
      // 1. FORCED DECRYPTION LAYER
      // 🔴 CRITICAL: Server sends ciphertextEdit. DO NOT use decryptIncoming() for edits!
      // decryptIncoming() has a cache-first pattern that returns stale v1 text.
      const encryptedPayload = updatedNote.ciphertextEdit;
      let decryptedEdit = "";
      let editReady = false;

      if (updatedNote.isEdited && encryptedPayload) {
         try {
             const currentUserId = localStorage.getItem('userId');
             if (updatedNote.senderId === currentUserId) {
                 // SENDER: Use local cache (we just encrypted this, plaintext is already cached)
                 const cached = await mediaKeyCache.getMediaKey(currentUserId, updatedNote._id, 'text');
                 if (cached?.decryptedText) {
                     decryptedEdit = cached.decryptedText;
                     editReady = true;
                 }
             } else {
                 // 🔴 RECEIVER: Call raw decryptMessage() directly — BYPASS decryptIncoming()
                 // decryptIncoming() would return stale cached text from v1, which is THE bug.
                 const rawDecrypted = await decryptMessage(
                     updatedNote.senderId,
                     updatedNote.editType || 1,
                     encryptedPayload
                 );
                 if (rawDecrypted && typeof rawDecrypted === 'string') {
                     decryptedEdit = rawDecrypted;
                     editReady = true;
                     // Save to cache with version so hydration works after refresh
                     await mediaKeyCache.saveMediaKey(currentUserId, updatedNote._id, 'text', { 
                         decryptedText: decryptedEdit,
                         version: updatedNote.version
                     });
                 } else if (rawDecrypted && rawDecrypted.error) {
                     console.warn("Edit decrypt failed:", rawDecrypted.reason);
                 }
             }
         } catch(e) { console.warn("Socket Edit Decrypt Fail", e); }
      }

      // 2. STATE AUTHORITY LAYER
      setNotes(prev => {
          const localNote = prev.find(n => n._id === updatedNote._id);
          
          // 🔴 Delete-for-all ALWAYS passes through — no version check for deletes
          if (updatedNote.isDeletedForEveryone) {
              return prev.map(n => n._id === updatedNote._id 
                  ? { ...n, isDeletedForEveryone: true, noteText: "", plaintextEdit: "", attachments: [], status: 'sent', isEditReady: true }
                  : n
              );
          }
          
          // 🔴 CRITICAL VERSION LOCK: Drop older or equal packets (edits only)
          if (localNote && localNote.version >= updatedNote.version) {
              return prev; 
          }

          const applyUpdate = (local) => {
              if (updatedNote.isDeletedForEveryone) {
                  return { ...local, isDeletedForEveryone: true, noteText: "", plaintextEdit: "", attachments: [], status: 'sent', isEditReady: true };
              }
              // 🔴 RULE 12: ATOMIC STATE UPDATE — all fields together
              return {
                  ...local,
                  version: updatedNote.version,
                  isEdited: updatedNote.isEdited,
                  isEditReady: editReady,
                  editedAt: updatedNote.editedAt,
                  plaintextEdit: decryptedEdit, 
                  isPinned: updatedNote.isPinned,
                  isDeleted: updatedNote.isDeleted,
                  status: 'sent'
              };
          };
          return prev.map(n => n._id === updatedNote._id ? applyUpdate(n) : n);
      });

      // 3. SIDEBAR SYNC LAYER
      setConversations(prev => prev.map(conv => {
        if (conv.lastMessage?._id === updatedNote._id) {
          // Delete-for-all always passes through
          if (!updatedNote.isDeletedForEveryone && conv.lastMessage.version >= updatedNote.version) return conv;
          
          const newLastMsg = { 
              ...conv.lastMessage, 
              version: updatedNote.version,
              isEdited: updatedNote.isEdited,
              isEditReady: editReady,
              editedAt: updatedNote.editedAt,
              plaintextEdit: decryptedEdit,
              isDeletedForEveryone: updatedNote.isDeletedForEveryone,
              isDeleted: updatedNote.isDeleted,
              isPinned: updatedNote.isPinned
          };
          if (updatedNote.isDeletedForEveryone) {
              newLastMsg.noteText = "";
              newLastMsg.attachments = [];
          }
          return { ...conv, lastMessage: newLastMsg };
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
          version: 1, // 🔴 CRITICAL: Force version on new message
          noteText: plaintext,
          isDecrypted: true,
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

        let noteText = "";
        let finalAttachments = newNote.attachments || [];
        const cachedSentInfo = sentMessagesCache.current.get(newNote.ciphertext);

        if (cachedSentInfo) {
          noteText = cachedSentInfo.text || "";
          if (cachedSentInfo.attachments) {
            finalAttachments = newNote.attachments.map((srvAtt, idx) => {
              // Push the volatile blob URL into RAM (LRU Cache) so it survives for instant preview without network fetch
              // but DO NOT commit it to IndexedDB, as blob URLs expire on page fresh!
              const attachId = srvAtt.attachmentId || srvAtt.fileIndex || idx;
              const volatileBlobUrl = cachedSentInfo.attachments[idx]?.url;
              if (volatileBlobUrl && volatileBlobUrl.startsWith('blob:')) {
                blobCache.set(getBlobCacheKey(newNote._id, srvAtt, idx), {
                  url: volatileBlobUrl,
                  mimeType: srvAtt.originalMimeType || srvAtt.type,
                  fileName: srvAtt.fileName || srvAtt.originalName
                });
              }

              return {
                ...srvAtt,
                url: srvAtt.url, // Strictly enforce the real Server API URL for DB Storage!
                binaryAesKey: cachedSentInfo.attachments[idx]?.binaryAesKey,
                binaryIv: cachedSentInfo.attachments[idx]?.binaryIv
              };
            });
          }
        }

        finalOptimisticNote = {
          ...newNote,
          version: 1, // 🔴 CRITICAL: Force version on new message (attachments)
          noteText: noteText,
          attachments: finalAttachments,
          isDecrypted: true,
          status: "sent"
        };

        // Save SENDER media keys directly to DB so refresh doesn't break DecryptedMedia!
        if (finalOptimisticNote.attachments && finalOptimisticNote.attachments.length > 0) {
          const { getEffectiveAttachmentId } = await import("../features/encryption/cryptoService");
          for (const [idx, att] of finalOptimisticNote.attachments.entries()) {
            if (att.binaryAesKey) {
              const stableId = getEffectiveAttachmentId(att, idx);
              await mediaKeyCache.saveMediaKey(userId, finalOptimisticNote._id, stableId, {
                aesKey: att.binaryAesKey
              });
              delete att.binaryAesKey;
              delete att.binaryIv;
            }
          }
        }
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
      // ✅ E2EE FIX: Sender MUST encrypt the edited text before dispatching!
      const { ciphertext, type: editType } = await encryptOutgoing(chatWithId, newText, []);
      const updated = await editNoteAPI(id, { noteText: ciphertext, editType, userId });
      const currentUserId = localStorage.getItem('userId');
      const targetNote = notes.find(n => n._id === id);
      const newVersion = (targetNote?.version || 1) + 1;
      
      // ✅ Cache the decrypted plaintext locally so hydration survives!
      await mediaKeyCache.saveMediaKey(currentUserId, id, 'text', {
          decryptedText: newText,
          version: newVersion // 🔴 CRITICAL: Store version during edit (Sender Side)
      });
      
      setNotes(prev => prev.map(n => {
        if (n._id === id) {
           return {
             ...n,
             version: newVersion, // 🔴 CRITICAL: Optimistic UI MUST SET VERSION
             // DO NOT overwrite noteText (immutable).
             // Set optimistic plaintextEdit for instant feedback.
             plaintextEdit: newText,
             isEdited: true,
             isEditReady: true, // 🔴 Sender already has plaintext — ready immediately
             editedAt: updated.editedAt || new Date().toISOString()
           };
        }
        return n;
      }));
      return updated;
    } catch (err) {
      console.error(err);
      alert("Failed to edit note. You may not be the author.");
      throw err;
    }
  }, [userId, chatWithId, encryptOutgoing]);

  const pinNote = useCallback(async (id) => {
    try {
      await pinNoteAPI(id, userId);
      setPinnedMessageIds(prev => {
        const next = new Set(prev);
        if (!next.has(id)) {
          if (next.size >= 3) {
            // Enforce 3-pin limit locally (FIFO)
            const oldestId = next.values().next().value;
            next.delete(oldestId);
          }
          next.add(id);
        }
        return new Set(next);
      });
    } catch(err) { console.error(err); }
  }, [userId]);

  const unpinNote = useCallback(async (id) => {
    try {
      await unpinNoteAPI(id, userId);
      setPinnedMessageIds(prev => {
         const next = new Set(prev);
         next.delete(id);
         return new Set(next);
      });
    } catch(err) { console.error(err); }
  }, [userId]);

  const fetchNotesAgain = useCallback(loadLatest, [loadLatest]);

  // Reset and load when chatWithId changes
  useEffect(() => {
    setNotes([]);
    setHasMore(true);
    if (userId) {
       fetchPinnedNotesAPI(userId).then(pins => setPinnedMessageIds(new Set(pins))).catch(err => console.error(err));
    }
    if (chatWithId) {
      loadLatest();
    }
  }, [chatWithId, loadLatest, userId]);

  const cacheSentMessage = useCallback((cText, plainText, plainAttachments) => {
    sentMessagesCache.current.set(cText, { text: plainText, attachments: plainAttachments });
  }, []);

  const getSentMessage = useCallback((cText) => {
    return sentMessagesCache.current.get(cText);
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
    cacheSentMessage,
    getSentMessage,
    pinnedMessageIds
  };
}
