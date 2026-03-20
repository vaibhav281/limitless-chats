
---

## 📂 12. COMPLETE SOURCE FILES — PART 3: HOOKS, UI, AND SERVER

---

### 12.1 `client/src/hooks/useEncryptedMessaging.js` — Protocol Bridge (303 lines)
```javascript
import { useState, useCallback, useEffect } from 'react';
import { generateAndUploadKeys, clearLocalKeys } from '../features/encryption/keyManager';
import { encryptMessage } from '../features/encryption/messageEncryptor';
import { decryptMessage } from '../features/encryption/messageDecryptor';
import { encryptFile, decryptFile, uint8ToBase64, base64ToUint8, ensureUint8Array, getEffectiveAttachmentId, computeAttachmentHash } from '../features/encryption/cryptoService';
import { mediaKeyCache } from '../features/encryption/mediaKeyCache';
import { signalStore } from '../features/encryption/keyManager';
import { ensureSession } from '../features/encryption/sessionManager';
import axios from 'axios';

let globalSignalMutex = Promise.resolve();
const sessionRepairLocks = new Set();

export default function useEncryptedMessaging(userId) {
    const [isKeysReady, setIsKeysReady] = useState(false);

    useEffect(() => {
        if (!userId) return;
        generateAndUploadKeys(userId)
            .then(() => setIsKeysReady(true))
            .catch(err => console.error("E2EE Init Error", err));
    }, [userId]);

    const encryptOutgoing = useCallback(async (receiverId, plaintext, plainFiles = []) => {
        try {
            const payload = plaintext || "__media__";
            const encryptedTextPayload = await encryptMessage(receiverId, payload);

            const encryptedFiles = [];
            for (const fileObj of plainFiles) {
                const { ciphertextBlob, ciphertextBuffer, keyBase64, ivBase64 } = await encryptFile(fileObj.file);

                const encryptedKeysMap = {};

                const canonicalId = await computeAttachmentHash(ciphertextBuffer);

                if (receiverId !== 'global_group') {
                    try {
                        const encryptedKeyPayloadReceiver = await encryptMessage(receiverId, keyBase64);
                        encryptedKeysMap[receiverId] = {
                            key: encryptedKeyPayloadReceiver.body,
                            type: encryptedKeyPayloadReceiver.type
                        };
                    } catch (err) {
                        console.error("Failed to encrypt AES key for receiver", err);
                    }
                }

                encryptedFiles.push({
                    id: canonicalId,
                    attachmentId: canonicalId,
                    blob: ciphertextBlob,
                    encryptedKeysMap: JSON.stringify(encryptedKeysMap),
                    iv: ivBase64,
                    originalName: fileObj.origName || fileObj.originalName || fileObj.file.name,
                    type: fileObj.type,
                    originalMimeType: fileObj.file.type,
                    size: fileObj.file?.size || 0,
                    binaryAesKey: ensureUint8Array(base64ToUint8(keyBase64)),
                    binaryIv: ensureUint8Array(base64ToUint8(ivBase64))
                });
            }

            const result = {
                ciphertext: encryptedTextPayload.body,
                type: encryptedTextPayload.type,
                encryptedFiles
            };

            return result;
        } catch (err) {
            console.error("encryptOutgoing encountered an error:", err.message);
            throw err;
        }
    }, []);

    const decryptIncoming = useCallback(async (note) => {
        const currentMutex = globalSignalMutex;
        let releaseMutex;
        globalSignalMutex = new Promise(resolve => releaseMutex = resolve);

        await currentMutex;

        try {
            if (!note) return null;

            const textCacheEntry = await mediaKeyCache.getMediaKey(userId, note._id, 'text');

            const remoteUserId = note.senderId === userId ? note.receiverId : note.senderId;

            let decryptedText = "";
            let decryptResult = null;

            if (note.ciphertext) {
                if (textCacheEntry && textCacheEntry.decryptedText) {
                    decryptedText = textCacheEntry.decryptedText;
                } else if (note.senderId === userId) {
                    decryptedText = "🔐 Message sent (plaintext not in cache)";
                } else {
                    try {
                        decryptResult = await decryptMessage(remoteUserId, note.type, note.ciphertext);

                        if (decryptResult && typeof decryptResult === 'object' && decryptResult.error) {
                            if (note.type === 3 && (decryptResult.reason.includes("Invalid private key") || decryptResult.reason.includes("Bad MAC") || decryptResult.reason.includes("Missing Signed PreKey") || decryptResult.reason.includes("No record for device"))) {
                                if (!sessionRepairLocks.has(remoteUserId)) {
                                    sessionRepairLocks.add(remoteUserId);

                                    await signalStore.removeSession(`${remoteUserId}.1`);
                                    await ensureSession(remoteUserId);
                                    decryptResult = await decryptMessage(remoteUserId, note.type, note.ciphertext);

                                    setTimeout(() => sessionRepairLocks.delete(remoteUserId), 10000);
                                }
                            }
                        }

                        if (decryptResult && typeof decryptResult === 'object' && decryptResult.error) {
                            decryptedText = `🔐 ${decryptResult.reason}`;
                        } else if (decryptResult === "__media__") {
                            decryptedText = "";
                        } else {
                            decryptedText = decryptResult;
                        }
                    } catch (e) {
                        console.error("Signal Decryption Failed:", e);
                        decryptedText = "🔐 Decryption error: Could not verify keys";
                    }
                }
            } else {
                decryptedText = textCacheEntry?.decryptedText || "";
            }

            const restoredNote = { ...note, noteText: decryptedText, isDecrypted: true };

            if (restoredNote.replyTo) {
                try {
                    const replyCacheEntry = await mediaKeyCache.getMediaKey(userId, restoredNote.replyTo._id, 'text');
                    if (replyCacheEntry && replyCacheEntry.decryptedText) {
                        restoredNote.replyTo.noteText = replyCacheEntry.decryptedText;
                        if (restoredNote.replyTo.isEdited) {
                             restoredNote.replyTo.plaintextEdit = replyCacheEntry.decryptedText;
                        }
                    } else {
                        restoredNote.replyTo.noteText = "🔐 (Encrypted reply)";
                    }
                } catch(e) { console.warn("Failed to unpack reply text", e); }
            }

            const newKeysToCache = [];
            const textRatchetFailed = decryptResult && typeof decryptResult === 'object' && decryptResult.error;

            if (!textRatchetFailed && restoredNote.attachments && restoredNote.attachments.length > 0) {
                const decryptedAttachments = [];

                for (let i = 0; i < restoredNote.attachments.length; i++) {
                    const attachment = restoredNote.attachments[i];
                    try {
                        let binaryAesKey = null;

                        const effectiveId = getEffectiveAttachmentId(attachment, i);

                        const cachedAttachment = await mediaKeyCache.getMediaKey(userId, note._id, effectiveId);

                        if (cachedAttachment && (cachedAttachment.aesKey || cachedAttachment.binaryAesKey)) {
                            binaryAesKey = cachedAttachment.aesKey || cachedAttachment.binaryAesKey;
                        } else if (note.senderId === userId) {
                            binaryAesKey = null;
                        } else {
                            let encryptedKeys = attachment.encryptedKeys;

                            if (typeof encryptedKeys === 'string') {
                                try {
                                    encryptedKeys = JSON.parse(encryptedKeys);
                                } catch (e) {
                                    encryptedKeys = null;
                                }
                            }

                            const myKeyObj = encryptedKeys ? (encryptedKeys[userId] || encryptedKeys.encryptedKeysMap?.[userId]) : null;

                            if (myKeyObj && myKeyObj.key && (attachment.iv || attachment.binaryIv)) {
                                const sessionTarget = (note.senderId === userId) ? userId : remoteUserId;

                                try {
                                    const decryptedKeyBase64 = await decryptMessage(
                                        sessionTarget,
                                        myKeyObj.type,
                                        myKeyObj.key,
                                        true
                                    );

                                    if (decryptedKeyBase64 && !decryptedKeyBase64.startsWith('🔐')) {
                                        binaryAesKey = base64ToUint8(decryptedKeyBase64);
                                        newKeysToCache.push({
                                            index: effectiveId,
                                            aesKey: binaryAesKey
                                        });
                                    }
                                } catch (err) {
                                    console.error(`Media AES Key failed to decrypt for attachment ${i}:`, err);
                                }
                            }
                        }

                        if (binaryAesKey) {
                            decryptedAttachments.push({
                                ...attachment,
                                binaryAesKey,
                                binaryIv: (typeof attachment.iv === 'string') ? base64ToUint8(attachment.iv) : attachment.iv
                            });
                        } else {
                            decryptedAttachments.push(attachment);
                        }
                    } catch (e) {
                        console.error("Signal Attachment Decryption Failed:", e);
                        decryptedAttachments.push(attachment);
                    }
                }
                restoredNote.attachments = decryptedAttachments;
            }

            const isValidPlaintext = typeof decryptedText === 'string' && !decryptedText.startsWith("🔐");
            const hasNewText = isValidPlaintext && (!textCacheEntry || textCacheEntry.decryptedText === undefined);

            if (hasNewText) {
                await mediaKeyCache.saveMediaKey(userId, note._id, 'text', {
                    decryptedText
                });
            }

            for (const newKey of newKeysToCache) {
                await mediaKeyCache.saveMediaKey(userId, note._id, newKey.index, {
                    aesKey: newKey.aesKey
                });
            }

            return restoredNote;
        } catch (err) {
            console.error("Failed to decrypt note", note._id, err);
            return { ...note, noteText: "🔐 Decryption error", isDecrypted: false };
        } finally {
            releaseMutex();
        }
    }, [userId]);

    return { isKeysReady, encryptOutgoing, decryptIncoming };
}
```

---

### 12.2 `client/src/hooks/useNotes.js` — Main State Hook (522 lines)

**This file contains the Socket handlers (`newNote`, `noteUpdated`, `messagesRead`), the merge logic, the `addNote`/`editNote`/`deleteNote` functions, and the sidebar conversation updater.**

```javascript
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

function mergeMessages(existing, incoming) {
  const all = [...existing, ...incoming];
  const unique = [];
  const seen = new Set();

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

      const note = await MessageLifecycleManager.processMessage(rawNoteToProcess, decryptIncoming);

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

        if (note.senderId !== userId) {
          markReadAPI(sender, userId).catch(err => console.error("Failed to mark newly socketed note read", err));
          socket.emit('markAsRead', { senderId: sender, receiverId: userId });
          markAsDelivered(note._id);
          markAsSeen(chatWithId, [note._id]);
        }
      } else {
        if (note.senderId !== userId) {
          markAsDelivered(note._id);
          setUnreadCounts(prev => ({
            ...prev,
            [sender]: (prev[sender] || 0) + 1
          }));
        }
      }

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

        return next.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
      });

    });

    socket.on('messagesRead', ({ senderId, receiverId }) => {
      if (receiverId === userId) {
        setUnreadCounts(prev => {
          const next = { ...prev };
          delete next[senderId];
          return next;
        });
      }
    });

    socket.on('noteUpdated', async (updatedNote) => {
      let decryptedEdit = updatedNote.plaintextEdit;
      if (updatedNote.isEdited && updatedNote.plaintextEdit) {
         try {
             const currentUserId = localStorage.getItem('userId');
             
             if (updatedNote.senderId === currentUserId) {
                 const cached = await mediaKeyCache.getMediaKey(currentUserId, updatedNote._id, 'text');
                 if (cached?.decryptedText) decryptedEdit = cached.decryptedText;
             } else {
                 const decryptedResult = await decryptIncoming({ ...updatedNote, noteText: updatedNote.plaintextEdit });
                 if (decryptedResult.noteText) {
                     decryptedEdit = decryptedResult.noteText;
                     await mediaKeyCache.saveMediaKey(currentUserId, updatedNote._id, 'text', { decryptedText: decryptedEdit });
                 }
             }
         } catch(e) { 
             console.warn("Socket Sync Fail", e); 
             const cached = await mediaKeyCache.getMediaKey(localStorage.getItem('userId'), updatedNote._id, 'text');
             if (cached?.decryptedText) decryptedEdit = cached.decryptedText;
         }
      }

      const applyUpdate = (local) => {
          if (!local) return local;
          if (updatedNote.isDeletedForEveryone) {
              return {
                  ...local,
                  isDeletedForEveryone: true,
                  noteText: "",
                  plaintextEdit: "",
                  attachments: [],
                  status: 'sent'
              };
          }
          return {
              ...local,
              isEdited: updatedNote.isEdited,
              editedAt: updatedNote.editedAt,
              plaintextEdit: decryptedEdit, 
              isPinned: updatedNote.isPinned,
              isDeleted: updatedNote.isDeleted,
              status: 'sent'
          };
      };

      setNotes(prev => prev.map(n => n._id === updatedNote._id ? applyUpdate(n) : n));

      setConversations(prev => prev.map(conv => {
        if (conv.lastMessage?._id === updatedNote._id) {
          return {
            ...conv,
            lastMessage: applyUpdate(conv.lastMessage)
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

      const reversedRaw = [...rawData].reverse();

      const data = await MessageLifecycleManager.processMessages(reversedRaw, decryptIncoming);

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
          isDecrypted: true,
          status: "sent"
        };

        setNotes(prev => {
          if (prev.some(n => n._id === finalOptimisticNote._id)) return prev;
          return [finalOptimisticNote, ...prev];
        });

      } else {
        payload = noteData;
        const newNote = await createNote(payload);

        let noteText = "";
        let finalAttachments = newNote.attachments || [];
        const cachedSentInfo = sentMessagesCache.current.get(newNote.ciphertext);

        if (cachedSentInfo) {
          noteText = cachedSentInfo.text || "";
          if (cachedSentInfo.attachments) {
            finalAttachments = newNote.attachments.map((srvAtt, idx) => {
              const attachId = srvAtt.attachmentId || srvAtt.fileIndex || idx;
              const volatileBlobUrl = cachedSentInfo.attachments[idx]?.url;
              if (volatileBlobUrl && volatileBlobUrl.startsWith('blob:')) {
                blobCache.set(getBlobCacheKey(newNote._id, srvAtt), {
                  url: volatileBlobUrl,
                  mimeType: srvAtt.originalMimeType || srvAtt.type,
                  fileName: srvAtt.fileName || srvAtt.originalName
                });
              }

              return {
                ...srvAtt,
                url: srvAtt.url,
                binaryAesKey: cachedSentInfo.attachments[idx]?.binaryAesKey,
                binaryIv: cachedSentInfo.attachments[idx]?.binaryIv
              };
            });
          }
        }

        finalOptimisticNote = {
          ...newNote,
          noteText: noteText,
          attachments: finalAttachments,
          isDecrypted: true,
          status: "sent"
        };

        if (finalOptimisticNote.attachments && finalOptimisticNote.attachments.length > 0) {
          for (const [idx, att] of finalOptimisticNote.attachments.entries()) {
            if (att.binaryAesKey) {
              const attachId = att.attachmentId || (att.fileIndex !== undefined ? att.fileIndex : idx);
              await mediaKeyCache.saveMediaKey(userId, finalOptimisticNote._id, attachId, {
                aesKey: att.binaryAesKey
              });
              delete att.binaryAesKey;
              delete att.binaryIv;
            }
          }
        }
      }

      await saveMessageLocally(finalOptimisticNote);

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
      if (deleteType === 'for_me' || data?.forMeOnly) {
        setNotes(prev => prev.map(n => n._id === id ? { ...n, isDeletedForMe: true, noteText: "", attachments: [] } : n));
      } else if (data && data.note) {
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
      const { ciphertext } = await encryptOutgoing(chatWithId, newText, []);
      const updated = await editNoteAPI(id, { noteText: ciphertext, userId });
      const currentUserId = localStorage.getItem('userId');
      
      await mediaKeyCache.saveMediaKey(currentUserId, id, 'text', {
          decryptedText: newText
      });
      
      setNotes(prev => prev.map(n => {
        if (n._id === id) {
           return {
             ...n,
             plaintextEdit: newText,
             isEdited: true,
             editedAt: updated.editedAt
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
        next.add(id);
        return next;
      });
    } catch(err) { console.error(err); }
  }, [userId]);

  const unpinNote = useCallback(async (id) => {
    try {
      await unpinNoteAPI(id, userId);
      setPinnedMessageIds(prev => {
         const next = new Set(prev);
         next.delete(id);
         return next;
      });
    } catch(err) { console.error(err); }
  }, [userId]);

  const fetchNotesAgain = useCallback(loadLatest, [loadLatest]);

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
```

---

### 12.3 `server/routes/noteRoutes.js` — Backend I/O (541 lines)

Due to size, this file is provided under a separate dedicated document: **`PROJECT_MASTER_HANDOVER_SERVER.md`**

If your AI agent needs the server routes, provide it with the file directly from:
`server/routes/noteRoutes.js`

---

### 12.4 `client/src/features/chat/components/MessageBubble.jsx` — UI Rendering Logic

Due to size (579 lines), this file is provided under a separate dedicated document or can be read directly from:
`client/src/features/chat/components/MessageBubble.jsx`

**KEY LOGIC LINE (Line 88)**:
```javascript
const finalText = (note.isEdited && note.plaintextEdit) ? note.plaintextEdit : note.noteText;
```
This is where the UI decides which text to display. If the message has been edited, it uses `plaintextEdit`. Otherwise, it uses `noteText`.

---

### 12.5 `client/src/features/chat/components/DecryptedMedia.jsx` — Media Renderer

Due to size (356 lines), this file can be read directly from:
`client/src/features/chat/components/DecryptedMedia.jsx`

**KEY LOGIC**: Uses `IntersectionObserver` for lazy loading and `requestIdleCallback` for background video thumbnail generation via Canvas.

---

## END OF DOCUMENT

*Generated: 2026-03-19*
*Status: FINAL MERGED HANDOVER — COMPLETE SOURCE FILES*
*Total Files Embedded: 17 (full) + 3 (referenced by path)*
