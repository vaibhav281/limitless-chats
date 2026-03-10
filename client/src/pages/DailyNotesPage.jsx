import React, { useEffect, useState, useRef, useCallback, useMemo } from "react";
import useNotes from "../hooks/useNotes";
import useFileUpload from "../hooks/useFileUpload";
import useEncryptedMessaging from "../hooks/useEncryptedMessaging";
import { Box, Paper, IconButton, Typography, Modal, TextField, Button, Dialog, Fade, Fab } from "@mui/material";
import { saveMessageLocally } from "../features/encryption/localMessageStore";
import { mediaKeyCache } from "../features/encryption/mediaKeyCache";
import InfiniteScroll from "react-infinite-scroll-component";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import DeleteIcon from "@mui/icons-material/Delete";
import PushPinIcon from "@mui/icons-material/PushPin";
import ReplyIcon from "@mui/icons-material/Reply";
import EditIcon from "@mui/icons-material/Edit";
import CloseIcon from "@mui/icons-material/Close";
import Webcam from "react-webcam";
import CameraAltIcon from '@mui/icons-material/CameraAlt';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import axios from 'axios';
import { blobCache } from '../features/encryption/blobCache';
import dayjs from "dayjs";
import isToday from "dayjs/plugin/isToday";
import isYesterday from "dayjs/plugin/isYesterday";
dayjs.extend(isToday);
dayjs.extend(isYesterday);

import Sidebar from "../features/chat/components/Sidebar";
import ChatHeader from "../features/chat/components/ChatHeader";
import ChatInput from "../features/chat/components/ChatInput";
import MessageBubble from "../features/chat/components/MessageBubble";
import PreviewModal from "../features/chat/components/PreviewModal";
import { markReadAPI } from '../services/api';

export default function DailyNotesPage() {
  const inputRef = useRef();
  const nameInputRef = useRef();
  const scrollableRef = useRef();
  
  const [selectedNotes, setSelectedNotes] = useState([]);
  const [showActionBar, setShowActionBar] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const webcamRef = useRef(null);
  const fileInputRef = useRef(null);

  const [username, setUsername] = useState("");
  const [showNamePrompt, setShowNamePrompt] = useState(false);
  const [showScrollButton, setShowScrollButton] = useState(false);

  useEffect(() => {
    const storedName = localStorage.getItem("username");
    if (storedName) setUsername(storedName);
    else setShowNamePrompt(true);
  }, []);

  const [chatWithId, setChatWithId] = useState(null);
  const { notes, setNotes, loadLatest, loadOlder, addNote, deleteNote, deleteMany, pinNote, unpinNote, hasMore, fetchNotes, activeUsers, userId, editNote, unreadCounts, setUnreadCounts, conversations, socket, cacheSentMessage } = useNotes(20, chatWithId, username);
  const { fileProgress, uploadFiles, downloadFile, cancelTask, retryTask } = useFileUpload();
  const { encryptOutgoing } = useEncryptedMessaging(userId);

  const handleSaveName = (name) => {
    if (!name.trim()) return;
    localStorage.setItem("username", name.trim());
    setUsername(name.trim());
    setShowNamePrompt(false);
  };

  const [previewFiles, setPreviewFiles] = useState([]);
  const [caption, setCaption] = useState("");
  const [viewingMedia, setViewingMedia] = useState(null);
  
  const scrollRef = useRef(null);
  const firstUnreadRef = useRef(null);
  const messagesEndRef = useRef(null);
  const shouldAutoScrollRef = useRef(true);

  const firstUnreadNoteId = useMemo(() => {
    if (!notes || notes.length === 0) return null;
    // Iterate backwards to find the oldest unread message
    for (let i = notes.length - 1; i >= 0; i--) {
      if (!notes[i].isRead && notes[i].senderId !== userId) {
        return notes[i]._id;
      }
    }
    return null;
  }, [notes, userId]);

  // When a chat is opened, instantly mark any unread messages as read
  useEffect(() => {
    if (chatWithId) {
      if (unreadCounts[chatWithId] > 0) {
          // 1. Fire HTTP request to permanently update DB
          markReadAPI(chatWithId, userId).catch(err => console.error(err));
            
          // 2. Zero out the local badge state instantly
          setUnreadCounts(prev => {
            const next = { ...prev };
            delete next[chatWithId];
            return next;
          });
          
          // 3. Emit socket to sync other open tabs
          if (socket) socket.emit('markAsRead', { senderId: chatWithId, receiverId: userId });
          
          // 4. Trigger auto-scroll specifically to the newly injected ref
          setTimeout(() => {
              if (firstUnreadRef.current) {
                  firstUnreadRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  shouldAutoScrollRef.current = false; // Prevent tail-scroll from overriding this jump
              }
          }, 300);
      } else {
          // If no unread messages, jump immediately to the bottom
          shouldAutoScrollRef.current = true;
          if (messagesEndRef.current) messagesEndRef.current.scrollIntoView();
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatWithId]); // Only run on chat switch to prevent re-firing

  const [openPreview, setOpenPreview] = useState(false);
  const [replyingTo, setReplyingTo] = useState(null);
  const [editingNote, setEditingNote] = useState(null);
  const [isUploading, setIsUploading] = useState(false);

  // When notes change, stick to bottom if flag is true
  useEffect(() => {
    if (shouldAutoScrollRef.current && messagesEndRef.current) {
        messagesEndRef.current.scrollIntoView();
        shouldAutoScrollRef.current = false; 
    }
  }, [notes]);

  const handleScroll = (e) => {
    // Math.abs because of flexDirection: column-reverse, scroll is negative
    const scrollPos = Math.abs(e.target.scrollTop);
    
    // Show quick scroll button if scrolled up past 100px.
    if (scrollPos > 100) {
      setShowScrollButton(true);
    } else {
      setShowScrollButton(false);
    }
    
    // If the user naturally scrolls back to the bottom, lock the autoscroll back to true
    // so incoming messages will push the scroll natively like WhatsApp
    if (scrollPos < 50) {
       shouldAutoScrollRef.current = true;
    }
  };

  const scrollToBottom = () => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  };

  const handleFileSelect = (e) => {
    const files = Array.from(e.target.files);
    if (!files.length) return;

    const SUPPORTED_FILE_TYPES = [
      "image/jpeg", "image/png", "image/jpg", "image/webp", "image/gif", "image/svg+xml",
      "video/mp4", "video/webm", "video/quicktime",
      "audio/mp3", "audio/mpeg", "audio/wav", "audio/ogg",
      "application/pdf", "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/zip", "application/x-zip-compressed", "text/plain"
    ];

    const unsupportedFiles = files.filter(f => !SUPPORTED_FILE_TYPES.includes(f.type) && !f.name.endsWith('.enc'));
    if (unsupportedFiles.length > 0) {
       alert(`Some files are not supported: ${unsupportedFiles.map(f => f.name).join(', ')}`);
       e.target.value = null;
       return;
    }

    const newPreviews = files.map(file => {
       const url = URL.createObjectURL(file);
       const mime = file.type;
       let type = 'other';
       if(mime.startsWith('image/')) type = 'image';
       else if(mime.startsWith('video/')) type = 'video';
       else if(mime.startsWith('audio/')) type = 'audio';
       else if(mime.includes('pdf') || mime.includes('document')) type = 'document';
       else if(mime.includes('zip') || mime.includes('rar') || mime.includes('7z')) type = 'archive';
       return { file, url, type, origName: file.name };
    });
    setPreviewFiles(prev => [...prev, ...newPreviews]);
    setOpenPreview(true);
    e.target.value = null;
  };

  const handleSendAttachments = async () => {
    if(previewFiles.length === 0 && !caption.trim()) return;
    shouldAutoScrollRef.current = true;
    const formData = new FormData();
    const textTarget = caption.trim() || "";
    
    // Extract optimistic thumbnails
    const optimisticAttachments = previewFiles.map(pf => ({
       url: pf.url, // objectURL already created via handleFileSelect
       type: pf.type,
       originalName: pf.origName,
       size: pf.file?.size
    }));

    // Perform E2EE Encryption on text and files
    // The encryptOutgoing hook will AES-GCM encrypt the blob and Double Ratchet the file keys
    let ciphertext, type, encryptedFiles;
    try {
        ({ ciphertext, type, encryptedFiles } = await encryptOutgoing(chatWithId, textTarget, previewFiles));
        
        // Merge binary encryption details into optimisticAttachments for local caching
        encryptedFiles.forEach((ef, idx) => {
           if (optimisticAttachments[idx]) {
               optimisticAttachments[idx].binaryAesKey = ef.binaryAesKey;
               optimisticAttachments[idx].binaryIv = ef.binaryIv;
               optimisticAttachments[idx].originalMimeType = ef.originalMimeType;
           }
        });

        cacheSentMessage(ciphertext, textTarget, optimisticAttachments);
    } catch (err) {
        alert(`Could not securely encrypt attachments: ${err.message}`);
        setPreviewFiles([]); setCaption(""); setOpenPreview(false); setReplyingTo(null); setEditingNote(null);
        setIsUploading(false);
        return;
    }

    formData.append('ciphertext', ciphertext);
    formData.append('type', type);
    
    const senderName = username || "Anonymous";
    formData.append('senderName', senderName);
    formData.append('senderId', userId);
    formData.append('receiverId', chatWithId);
    if(replyingTo) formData.append('replyTo', replyingTo._id);

    const attachmentsMeta = [];

    encryptedFiles.forEach(ef => {
       if(ef.blob) {
         formData.append('files', ef.blob, ef.originalName);
         
         // Build structured metadata
         let parsedMap = {};
         try {
             parsedMap = JSON.parse(ef.encryptedKeysMap);
         } catch (e) {
             console.warn("Could not parse keys map for metadata", e);
         }

         attachmentsMeta.push({
             encryptedKeysMap: parsedMap,
             iv: ef.iv,
             originalMimeType: ef.originalMimeType,
             type: ef.type
         });
       } else console.warn("Missing file blob for", ef);
    });

    formData.append('attachmentsMeta', JSON.stringify(attachmentsMeta));

    const tempId = "temp-" + Date.now();
    const tempNote = {
       _id: tempId,
       noteText: textTarget,
       timestamp: new Date().toISOString(),
       senderId: userId,
       receiverId: chatWithId,
       senderName: senderName,
       replyTo: replyingTo || null,
       attachments: optimisticAttachments,
       status: 'uploading'
    };

    // UI Snappy Reset
    setNotes(prev => [tempNote, ...prev]);
    setPreviewFiles([]); setCaption(""); setOpenPreview(false); setReplyingTo(null); setEditingNote(null);
    setIsUploading(false); // Modal closes instantly

    try {
      const realNote = await uploadFiles(tempId, formData);
      
      const realNoteForSender = {
          ...realNote,
          noteText: textTarget,
          attachments: realNote.attachments.map((serverAtt, idx) => {
              const attachId = serverAtt.attachmentId || serverAtt.fileIndex || idx;
              const volatileBlobUrl = optimisticAttachments[idx]?.url;
              
              if (volatileBlobUrl && volatileBlobUrl.startsWith('blob:')) {
                  blobCache.set(`${realNote._id}_${attachId}`, volatileBlobUrl);
              }

              return {
                  ...serverAtt,
                  url: serverAtt.url, // Store the stable Server API URL in IndexedDB!
                  binaryAesKey: optimisticAttachments[idx]?.binaryAesKey,
                  binaryIv: optimisticAttachments[idx]?.binaryIv
              };
          }),
          isDecrypted: true,
          status: 'sent'
      };

      await saveMessageLocally(realNoteForSender);

      // Also cache for the Secure pipeline (mediaKeyCache)
      await mediaKeyCache.saveMediaKey(userId, realNote._id, 'text', {
          decryptedText: textTarget
      });

      for (let i = 0; i < optimisticAttachments.length; i++) {
          await mediaKeyCache.saveMediaKey(userId, realNote._id, i, {
              aesKey: optimisticAttachments[i].binaryAesKey
          });
      }

      // Backend returned the new Document. The Socket may have already emitted and added it to the array.
      setNotes(prev => {
         const alreadyExists = prev.some(n => n._id === realNote._id);
         if (alreadyExists) {
            // Socket already inserted it. Filter out tempId, and OVERWRITE socket's version with secure local version
            return prev
              .filter(n => n._id !== tempId)
              .map(n => n._id === realNote._id ? realNoteForSender : n);
         }
         // Socket hasn't fired yet. Swap the temporary mock with the verified real note.
         return prev.map(n => n._id === tempId ? realNoteForSender : n);
      });
    } catch(err) {
      console.error("Upload failed", err);
      setNotes(prev => prev.map(n => n._id === tempId ? { ...n, status: 'failed' } : n));
    }
  };

  const handleSend = async () => {
    const text = inputRef.current.value.trim();
    if(!text) return;
    shouldAutoScrollRef.current = true;
    
    if (editingNote) {
       await editNote(editingNote._id, text);
       setEditingNote(null);
    } else {
       await addNote(text, replyingTo?._id);
    }
    
    inputRef.current.value = "";
    setReplyingTo(null);
    inputRef.current.focus();
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleNoteLongPress = (note) => {
    setSelectedNotes(prev => {
       if(!prev.includes(note._id)) {
           const next = [...prev, note._id];
           setShowActionBar(true);
           return next;
       }
       return prev;
    });
    if(window.navigator.vibrate) window.navigator.vibrate(50);
  };

  const handleNotePress = (note) => {
    if (selectedNotes.length > 0) {
      setSelectedNotes(prev => {
        const isSelected = prev.includes(note._id);
        const next = isSelected ? prev.filter(id => id !== note._id) : [...prev, note._id];
        if (next.length === 0) setShowActionBar(false);
        return next;
      });
    }
  };

  const handleSwipeRight = (note) => { handleReply(note); };

  const handleCopy = () => {
    const text = notes.filter(n => selectedNotes.includes(n._id)).map(n => n.noteText).join("\n");
    navigator.clipboard.writeText(text);
    handleCancelAction();
  };

  const handleRightClick = (e, note) => {
    e.preventDefault();
    setSelectedNotes([note._id]);
    setShowActionBar(true);
  };

  const handleConfirmDelete = (type) => {
    if (selectedNotes.length === 1) deleteNote(selectedNotes[0], type);
    else deleteMany(selectedNotes, type);
    setSelectedNotes([]); setShowActionBar(false); setConfirmDelete(false);
  };

  const handleCancelAction = () => { setSelectedNotes([]); setShowActionBar(false); setEditingNote(null); };

  const handleReply = (note) => {
    setReplyingTo(note);
    setSelectedNotes([]);
    setShowActionBar(false);
    inputRef.current?.focus();
  };

  const handleEdit = (note) => {
    setEditingNote(note);
    setReplyingTo(null);
    setSelectedNotes([]);
    setShowActionBar(false);
    if (inputRef.current) {
        inputRef.current.value = note.noteText;
        inputRef.current.focus();
    }
  };

  const handlePin = () => {
    selectedNotes.forEach(id => {
       const note = notes.find(n => n._id === id);
       if (note) note.pinned ? unpinNote(id) : pinNote(id);
    });
    handleCancelAction();
  };

  const capturePhoto = useCallback(() => {
    const imageSrc = webcamRef.current.getScreenshot();
    if(imageSrc) {
       fetch(imageSrc).then(res => res.blob()).then(blob => {
          const file = new File([blob], "camera_photo.jpg", { type: "image/jpeg" });
          const url = URL.createObjectURL(file);
          setPreviewFiles(prev => [...prev, { file, url, type: 'image', origName: "camera_photo.jpg" }]);
          setOpenPreview(true);
          setCameraOpen(false);
       });
    }
  }, [webcamRef]);

  const canDelete = selectedNotes.length > 0;
  // Edit Rules: 1 item, sender=user, no attachments, not deleted privately or globally, age < 15min
  const canEdit = selectedNotes.length === 1 && (() => {
      const n = notes.find(n => n._id === selectedNotes[0]);
      if (!n) return false;
      const isMine = n.senderId === userId;
      const hasNoAttachments = !n.attachments?.length;
      const isNotDeleted = !(n.isDeletedForEveryone || n.isDeletedForMe || n.isDeleted);
      const isUnder15Mins = (Date.now() - new Date(n.timestamp).getTime()) <= 900000;
      return isMine && hasNoAttachments && isNotDeleted && isUnder15Mins;
  })();

  return (
    <Box sx={{ flex: 1, display: "flex", height: "100%", overflow: "hidden", position: "relative" }}>
      <Sidebar chatWithId={chatWithId} setChatWithId={setChatWithId} activeUsers={activeUsers} userId={userId} unreadCounts={unreadCounts} conversations={conversations} />

      {/* Main Chat Area */}
      <Box sx={{ flex: 1, display: { xs: chatWithId ? "flex" : "none", sm: "flex" }, flexDirection: "column", position: "relative" }}>
         {chatWithId ? (
            <>
              <ChatHeader chatWithId={chatWithId} setChatWithId={setChatWithId} activeUsers={activeUsers} conversations={conversations} />
              
              {/* Action Bar (Replaces Header when selecting messages) */}
              <Fade in={showActionBar}>
                <Paper sx={{ position: "absolute", top: 0, left: 0, right: 0, zIndex: 10, bgcolor: "#202c33", px: 2, py: 1, minHeight: 64, maxHeight: 64, boxSizing: "border-box", display: showActionBar ? "flex" : "none", alignItems: "center", justifyContent: "space-between", borderRadius: 0 }}>
                  <Typography sx={{ fontWeight: 500, color: "#e9edef" }}>{selectedNotes.length} selected</Typography>
                  <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
                    <IconButton color="inherit" sx={{ color: "#aebac1" }} onClick={handleCopy}><ContentCopyIcon /></IconButton>
                    {canDelete && <IconButton color="error" onClick={() => setConfirmDelete(true)}><DeleteIcon /></IconButton>}
                    <IconButton color="inherit" sx={{ color: "#aebac1" }} onClick={handlePin}><PushPinIcon /></IconButton>
                    {canEdit && <IconButton color="inherit" sx={{ color: "#aebac1" }} onClick={() => handleEdit(notes.find(n => n._id === selectedNotes[0]))}><EditIcon /></IconButton>}
                    {selectedNotes.length === 1 && <IconButton color="inherit" sx={{ color: "#aebac1" }} onClick={() => handleReply(notes.find(n => n._id === selectedNotes[0]))}><ReplyIcon /></IconButton>}
                    <IconButton sx={{ color: "#aebac1" }} onClick={handleCancelAction}><CloseIcon /></IconButton>
                  </Box>
                </Paper>
              </Fade>

              <Box 
                id="scrollableDiv" 
                ref={scrollableRef}
                onScroll={handleScroll}
                sx={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", bgcolor: "#0b141a", backgroundImage: 'linear-gradient(rgba(11,20,26,0.9), rgba(11,20,26,0.9)), url("../../chat_background.png")', backgroundSize: "contain", backgroundRepeat: "repeat", px: { xs: 1, sm: 4, md: '5%' }, py: 2 }}
              >
                <InfiniteScroll
                  dataLength={notes.length}
                  next={loadOlder}
                  style={{ display: 'flex', flexDirection: 'column-reverse', gap: '8px', overflow: 'hidden' }}
                  inverse={true}
                  hasMore={hasMore}
                  loader={<Typography textAlign="center" variant="body2" color="#aebac1" my={2}>Loading older messages...</Typography>}
                  scrollableTarget="scrollableDiv"
                >
                  <Box sx={{ display: 'flex', flexDirection: 'column-reverse', gap: 1 }}>
                    <div ref={messagesEndRef} />
                    {notes.map((note, index) => {
                      // Because array is [Newest, ..., Oldest] and container is column-reverse:
                      // DOM end = Visual top.
                      // We want date separator visually ABOVE the oldest message of that day.
                      // This means in the DOM, the separator must come AFTER the oldest message of that day.
                      // So we check if the NEXT note in the array (which is older) has a DIFFERENT date.
                      // If it does, we append a separator after rendering this current note.
                      const currentDay = dayjs(note.timestamp).startOf('day');
                      const olderNote = notes[index + 1];
                      let showDateSeparator = false;
                      
                      if (!olderNote) {
                        // This is the absolute oldest message in the array, it gets a separator above it
                        showDateSeparator = true;
                      } else {
                        const olderDay = dayjs(olderNote.timestamp).startOf('day');
                        if (!currentDay.isSame(olderDay)) {
                          showDateSeparator = true;
                        }
                      }

                      let dateLabel = "";
                      if (showDateSeparator) {
                        if (currentDay.isToday()) dateLabel = "Today";
                        else if (currentDay.isYesterday()) dateLabel = "Yesterday";
                        else dateLabel = currentDay.format("DD/MM/YYYY");
                      }
                      
                      const isFirstUnread = note._id === firstUnreadNoteId;

                      return (
                        <React.Fragment key={note._id || `temp-${index}`}>
                          {showDateSeparator && (
                            <Box sx={{ display: "flex", justifyContent: "center", my: 1, width: "100%" }}>
                              <Typography variant="caption" sx={{ bgcolor: "#182229", color: "#8696a0", px: 2, py: 0.5, borderRadius: 2, boxShadow: "0 1px 0.5px rgba(0,0,0,0.13)" }}>
                                {dateLabel}
                              </Typography>
                            </Box>
                          )}
                          
                          {/* WhatsApp Style Unread Separator */}
                          {isFirstUnread && (
                            <Box 
                              ref={firstUnreadRef} 
                              sx={{ display: "flex", justifyContent: "center", my: 1.5, width: "100%", scrollMarginTop: "80px" }}
                            >
                               <Typography variant="caption" sx={{ bgcolor: "rgba(255,255,255,0.06)", color: "#00a884", px: 2, py: 0.5, borderRadius: 2, fontWeight: 500 }}>
                                  Unread Messages
                               </Typography>
                            </Box>
                          )}
                          
                          <MessageBubble 
                            note={note}
                            userId={userId}
                            isSelected={selectedNotes.includes(note._id)}
                            onPress={handleNotePress}
                            onLongPress={handleNoteLongPress}
                            onSwipeRight={handleSwipeRight}
                            onPreviewMedia={setViewingMedia}
                            fileProgress={fileProgress}
                            downloadFile={downloadFile}
                            cancelTask={cancelTask}
                            retryTask={retryTask}
                            currentUser={{ username }}
                            onRightClick={handleRightClick}
                          />
                        </React.Fragment>
                      );
                    })}
                  </Box>
                </InfiniteScroll>
              </Box>

              {/* Floating Scroll-to-Bottom Button */}
              <Fade in={showScrollButton}>
                 <Fab 
                    size="small" 
                    onClick={scrollToBottom}
                    sx={{ 
                      position: 'absolute', 
                      bottom: (replyingTo || editingNote) ? 140 : 80, 
                      right: { xs: 16, sm: '5%' }, 
                      zIndex: 10, 
                      bgcolor: '#202c33', 
                      color: '#aebac1',
                      transition: 'bottom 0.2s',
                      '&:hover': { bgcolor: '#2a3942' }
                    }}
                 >
                    <KeyboardArrowDownIcon />
                 </Fab>
              </Fade>

              {/* Bottom Input */}
              <input type="file" ref={fileInputRef} hidden multiple accept="image/*,video/*,audio/*,application/pdf" onChange={handleFileSelect} />
              <ChatInput 
                inputRef={inputRef}
                handleSend={handleSend}
                handleKeyDown={handleKeyDown}
                handleAttachmentClick={() => fileInputRef.current?.click()}
                replyingTo={replyingTo}
                setReplyingTo={setReplyingTo}
                editingNote={editingNote}
                setEditingNote={setEditingNote}
              />

              {/* WhatsApp Delete Modal */}
              <Dialog 
                open={confirmDelete} 
                onClose={() => setConfirmDelete(false)}
                PaperProps={{ sx: { bgcolor: "#3b4a54", color: "#e9edef", borderRadius: 3, minWidth: '300px' } }}
              >
                <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 1 }}>
                   <Typography variant="body1" sx={{ mb: 1, fontWeight: 500, px: 1 }}>Delete message?</Typography>
                   {selectedNotes.length === 1 && notes.find(n => n._id === selectedNotes[0])?.senderId === userId && (Date.now() - new Date(notes.find(n => n._id === selectedNotes[0])?.timestamp).getTime() < 86400000) && (
                      <Button fullWidth sx={{ color: "#f15c6d", bgcolor: "transparent", '&:hover': { bgcolor: "rgba(255,255,255,0.05)" }, justifyContent: 'flex-end', px: 3, py: 1.5, textTransform: 'none', fontSize: '1rem' }} onClick={() => handleConfirmDelete('for_everyone')}>
                          Delete for everyone
                      </Button>
                   )}
                   <Button fullWidth sx={{ color: "#e9edef", bgcolor: "transparent", '&:hover': { bgcolor: "rgba(255,255,255,0.05)" }, justifyContent: 'flex-end', px: 3, py: 1.5, textTransform: 'none', fontSize: '1rem' }} onClick={() => handleConfirmDelete('for_me')}>
                       Delete for me
                   </Button>
                   <Button fullWidth sx={{ color: "#00a884", mt: 1, textTransform: 'none', fontSize: '0.95rem', justifyContent: 'flex-end', px: 3 }} onClick={() => setConfirmDelete(false)}>
                       Cancel
                   </Button>
                </Box>
              </Dialog>

            </>
         ) : (
            <Box sx={{ flex: 1, display: "flex", justifyContent: "center", alignItems: "center", flexDirection: "column", bgcolor: "#202c33", borderBottom: "6px solid #00a884" }}>
                <img src="/chat_app.svg" alt="Limitless Chats Logo" style={{ width: 140, height: 140, marginBottom: 24, opacity: 0.9 }} />
                <Typography variant="h4" sx={{ color: "#e9edef", fontWeight: 300 }}>Limitless Chats</Typography>
                <Typography variant="body1" sx={{ color: "#8696a0", mt: 2, textAlign: "center", maxWidth: "400px" }}>Send and receive messages without keeping your phone online.<br/>Experience Limitless Real-time File Syncing.</Typography>
            </Box>
         )}
      </Box>

      {/* Helper Modals */}
      <PreviewModal 
        openPreview={openPreview} setOpenPreview={setOpenPreview} previewFiles={previewFiles}
        handleRemovePreview={(idx) => setPreviewFiles(prev => prev.filter((_, i) => i !== idx))}
        fileInputRef={fileInputRef} caption={caption} setCaption={setCaption}
        handleSendAttachments={handleSendAttachments} isUploading={isUploading}
      />
      {/* Camera Fullscreen Modal */}
      <Dialog open={cameraOpen} fullScreen>
        <Box sx={{ bgcolor: "#000", height: "100vh", display: "flex", flexDirection: "column" }}>
            <Webcam audio={false} ref={webcamRef} screenshotFormat="image/jpeg" videoConstraints={{ facingMode: "user" }} style={{ flex: 1, objectFit: "cover" }} />
            <Box sx={{ display: 'flex', justifyContent: 'center', p: 2, gap: 2 }}>
                <IconButton onClick={capturePhoto} sx={{ bgcolor: "#fff", color: "#000" }}><CameraAltIcon /></IconButton>
                <IconButton onClick={() => setCameraOpen(false)} sx={{ color: "#fff" }}><CloseIcon /></IconButton>
            </Box>
        </Box>
      </Dialog>
      
      {/* Username Modal */}
      <Modal open={showNamePrompt}>
        <Box sx={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: 400, bgcolor: '#202c33', borderRadius: 2, p: 4 }}>
          <Typography variant="h6" sx={{ color: "#e9edef", mb: 2 }}>Welcome!</Typography>
          <TextField autoFocus fullWidth inputRef={nameInputRef} placeholder="Enter your name" variant="outlined" sx={{ bgcolor: "#2a3942", input: { color: "#e9edef" } }} onKeyDown={(e) => { if (e.key === 'Enter') handleSaveName(nameInputRef.current.value); }} />
          <Button fullWidth variant="contained" sx={{ mt: 2, bgcolor: "#00a884" }} onClick={() => handleSaveName(nameInputRef.current?.value)}>Start Chatting</Button>
        </Box>
      </Modal>

      {/* Fullscreen Media Viewer */}
      <Dialog open={!!viewingMedia} fullScreen sx={{ zIndex: 9999 }}>
         <Box sx={{ bgcolor: "rgba(0,0,0,0.95)", height: "100vh", display: "flex", flexDirection: "column", position: "relative" }}>
            <Box sx={{ p: 2, display: "flex", justifyContent: "space-between", alignItems: "center", bgcolor: "transparent" }}>
               <Typography variant="body1" sx={{ color: "#fff" }}>
                  {viewingMedia?.items[viewingMedia.currentIndex]?.originalName}
               </Typography>
               <IconButton onClick={() => setViewingMedia(null)} sx={{ color: "#fff" }}><CloseIcon /></IconButton>
            </Box>
            <Box sx={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", p: 2 }}>
               {viewingMedia?.items[viewingMedia.currentIndex]?.type === 'image' ? (
                  <img src={viewingMedia.items[viewingMedia.currentIndex].url} alt="enlarged" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
               ) : viewingMedia?.items[viewingMedia.currentIndex]?.type === 'video' ? (
                  <video src={viewingMedia.items[viewingMedia.currentIndex].url} controls controlsList="nodownload" autoPlay style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
               ) : (viewingMedia?.items[viewingMedia.currentIndex]?.type === 'document' || viewingMedia?.items[viewingMedia.currentIndex]?.type === 'archive') ? (
                  <iframe src={viewingMedia.items[viewingMedia.currentIndex].url} style={{ width: "100%", height: "100%", border: "none" }} title="Document Viewer" />
               ) : (
                  <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                     <Typography sx={{ color: '#fff' }}>Preview not available for this file type.</Typography>
                     <Button variant="contained" href={viewingMedia?.items[viewingMedia.currentIndex]?.url} download={viewingMedia?.items[viewingMedia.currentIndex]?.originalName}>Download File</Button>
                  </Box>
               )}
            </Box>
            
            {/* Multiple media thumbnails carousel */}
            {viewingMedia?.items?.length > 1 && (
               <Box sx={{ p: 2, display: "flex", gap: 2, overflowX: "auto", justifyContent: "center", bgcolor: "rgba(0,0,0,0.5)" }}>
                 {viewingMedia.items.map((item, idx) => (
                    <Box 
                      key={idx} 
                      onClick={() => setViewingMedia({ ...viewingMedia, currentIndex: idx })}
                      sx={{ 
                         width: 60, height: 60, flexShrink: 0, cursor: "pointer", borderRadius: 1, overflow: "hidden", 
                         border: viewingMedia.currentIndex === idx ? "2px solid #00a884" : "2px solid transparent",
                         opacity: viewingMedia.currentIndex === idx ? 1 : 0.5,
                         transition: "all 0.2s"
                      }}
                    >
                       {item.type === 'image' ? (
                          <img src={item.url} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                       ) : item.type === 'video' ? (
                          <video src={item.url} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                       ) : null}
                    </Box>
                 ))}
               </Box>
            )}
         </Box>
      </Dialog>
    </Box>
  );
}
