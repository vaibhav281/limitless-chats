import React, { useState, useEffect, useMemo } from 'react';
import { Box, Paper, Typography, IconButton, Button, CircularProgress, useMediaQuery } from '@mui/material';
import '../styles/chat-theme.css';
import '../styles/message-bubble.css';
import FileDownloadIcon from '@mui/icons-material/FileDownload';
import PlayCircleIcon from '@mui/icons-material/PlayCircle';
import PushPinIcon from '@mui/icons-material/PushPin';
import ReplyIcon from '@mui/icons-material/Reply';
import InsertDriveFileIcon from '@mui/icons-material/InsertDriveFile';
import AudioFileIcon from '@mui/icons-material/AudioFile';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
import DescriptionIcon from '@mui/icons-material/Description';
import FolderZipIcon from '@mui/icons-material/FolderZip';
import GridOnIcon from '@mui/icons-material/GridOn';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import CancelIcon from '@mui/icons-material/Cancel';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import BlockIcon from '@mui/icons-material/Block';
import CheckIcon from '@mui/icons-material/Check';
import DoneAllIcon from '@mui/icons-material/DoneAll';
import dayjs from "dayjs";
import { getUserColor } from '../../../utils/getUserColor';
import { parseMessageText } from '../../../utils/messageParser';
import DecryptedMedia from './DecryptedMedia';
import { blobCache } from '../../encryption/blobCache';
import { getEffectiveAttachmentId, runMediaDecryptionPipeline, E2EE_ERRORS, safeUnboxCachedUrl, getBlobCacheKey } from '../../encryption/cryptoService';
import { mediaKeyCache } from '../../encryption/mediaKeyCache';
import { classifyFile, FILE_TYPES } from '../utils/fileTypeClassifier';
import { normalizeAttachments } from '../../../../../shared/utils/normalizeAttachments';
import { resolveMessageFSM } from '../../../utils/messageStateResolver';

// Error messages mapping (Technical code -> User friendly)
const ERROR_MAP = {
    [E2EE_ERRORS.DECRYPT_PENDING]: "Waiting for this message. This may take a while.",
    [E2EE_ERRORS.SIGNAL_DESYNC]: "Secure session re-syncing...",
    [E2EE_ERRORS.MEDIA_KEY_MISSING]: "Waiting for media...",
    [E2EE_ERRORS.MEDIA_DECRYPT_FAIL]: "Decryption failed",
    "PERMANENT_SESSION_LOST": "This message was sent before you logged in."
};

const MessageBubble = React.forwardRef(({ 
  note, 
  allNotes = [],
  userId, 
  onLongPress, 
  onSwipeRight, 
  isSelected, 
  onPress, 
  onPreviewMedia, 
  fileProgress, 
  downloadFile, 
  cancelTask,
  retryTask,
  currentUser,
  onRightClick,
  isPinned,
  isFirstInGroup = false
}, ref) => {
  const [touchStart, setTouchStart] = useState(null);
  const [touchTimer, setTouchTimer] = useState(null);
  const [swipeOffset, setSwipeOffset] = useState(0);
  const [showFull, setShowFull] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  const handleTouchStateStart = (e) => {
      const timer = setTimeout(() => {
          if (onLongPress) onLongPress(note);
      }, 500); // 500ms WhatsApp-style long press
      setTouchTimer(timer);
  };

  const handleTouchStateEnd = () => {
      if (touchTimer) clearTimeout(touchTimer);
  };

  const senderName = note.senderName || note.sender || "Anonymous";
  const isSentByMe = note.senderId === userId;
  const remoteUserId = isSentByMe ? note.receiverId : note.senderId;
  const bubbleColor = isSentByMe ? "#005c4b" : "#202c33";
  const bubbleAlignment = isSentByMe ? "flex-end" : "flex-start";
  const borderRadius = isSentByMe ? "8px 0px 8px 8px" : "0px 8px 8px 8px";

  const formatBytes = (bytes) => {
    if (!bytes || bytes === 0) return '';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  // 🔴 RULE 10: RENDER LOCK — Never render edited message until decryption is complete
  let finalText;
  if (note.isEdited) {
    if (note.isEditReady) {
      finalText = note.plaintextEdit || "";
    } else {
      // Keep previous stable text until decryption resolves
      finalText = note.plaintextEdit || note.noteText || "";
    }
  } else {
    finalText = note.noteText;
  }
  const isLong = finalText && finalText.length > 300;
  const displayText = (isLong && !showFull) ? finalText.substring(0,300)+"..." : finalText;

  // FIX: Dynamic Reply Resolution (WhatsApp behavior)
  const repliedMessage = note.replyTo ? allNotes.find(n => n._id === (note.replyTo._id || note.replyTo)) : null;
  const reply = repliedMessage
    ? {
        senderLabel: repliedMessage.senderId === userId ? "You" : (repliedMessage.senderName || repliedMessage.sender || "Unknown"),
        text: repliedMessage.isDeletedForEveryone ? "This message was deleted" : (repliedMessage.isEdited ? (repliedMessage.plaintextEdit || "") : (repliedMessage.noteText || "🔐"))
      }
    : null;

  // Hydration is now handled by MessageLifecycleManager. Background triggers removed from UI.

  const handleMediaClick = async (e, idx) => {
    e.stopPropagation();
    
    const itemsWithDecryptedUrls = await Promise.all(note.attachments.map(async (att, idx) => {
        const effectiveId = getEffectiveAttachmentId(att);
        const cacheKey = getBlobCacheKey(note._id, att, idx);
        const boxed = safeUnboxCachedUrl(blobCache.get(cacheKey));
        const cachedUrl = boxed ? boxed.url : null;

        const currentUserId = localStorage.getItem('userId');
        const cachedMediaKey = await mediaKeyCache.getMediaKey(currentUserId, note._id, effectiveId);
        
        return { 
            ...att, 
            url: cachedUrl || att.url, 
            _isReady: !!cachedUrl,
            binaryAesKey: att.binaryAesKey || cachedMediaKey?.aesKey || cachedMediaKey?.binaryAesKey,
            binaryIv: att.binaryIv || att.iv || cachedMediaKey?.iv,
            originalMimeType: att.originalMimeType
        }; 
    }));

    onPreviewMedia({ items: itemsWithDecryptedUrls, currentIndex: idx, note });
  };

  // -----------------------------------------
  // Sub-Renderers
  // -----------------------------------------

  const renderText = () => {
    const hasMedia = note.attachments && note.attachments.length > 0;
    const isDecrypted = note.isDecrypted;
    
    // 1. SUCCESS: Text is decrypted (even if empty for media-only)
    if (isDecrypted && !displayText) {
        return null;
    }

    // 2. SUCCESS: Text is decrypted and present
    if (isDecrypted && displayText) {
        return (
            <Typography variant="body1" sx={{ whiteSpace:"pre-wrap", wordBreak:"break-word", fontSize: "0.95rem", color: "#e9edef", flex: 1, pr: 1 }}>
                {parseMessageText(displayText, currentUser?.username)}
                {isLong && <Button onClick={e=>{e.stopPropagation(); setShowFull(!showFull);}} sx={{ ml:0, p:0, minWidth:0, fontSize:"0.75rem", textTransform:"none", color:"#53bdeb" }}>{showFull?"Read less":"Read more"}</Button>}
            </Typography>
        );
    }

    // 3. SUCCESS: Message was deleted
    if (note.isDeletedForEveryone) {
        return (
            <Typography variant="body1" sx={{ fontStyle: "italic", color: "#8696a0", fontSize: "0.95rem" }}>
                This message was deleted
            </Typography>
        );
    }

    // 3. PENDING/ERROR: Ciphertext exists but not yet decrypted
    if (note.ciphertext && !isDecrypted && !isSentByMe) {
        let errorMsg = ERROR_MAP[E2EE_ERRORS.DECRYPT_PENDING];
        
        if (note.noteText?.includes("previous session") || note.permanentlyFailed) {
            errorMsg = ERROR_MAP["PERMANENT_SESSION_LOST"];
        } else if (note.noteText?.includes("Bad MAC") || note.noteText?.includes("ratchet")) {
            errorMsg = ERROR_MAP[E2EE_ERRORS.SIGNAL_DESYNC];
        }
        
        return (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 0.5 }}>
                <ErrorOutlineIcon sx={{ fontSize: 16, color: '#8696a0' }} />
                <Typography variant="body2" sx={{ fontStyle: 'italic', color: '#8696a0' }}>
                    {errorMsg}
                </Typography>
            </Box>
        );
    }

    // 4. SENDER FALLBACK: Sender doesn't have local cache
    if (isSentByMe && (!displayText || displayText.startsWith("🔐"))) {
        return (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 0.5 }}>
                <Typography variant="body2" sx={{ fontStyle: 'italic', color: '#8696a0' }}>
                    🔐 Message sent (copy unavailable)
                </Typography>
            </Box>
        );
    }

    return null;
  };

  const renderMetadataRow = (isOverlay = false) => {
    const task = fileProgress && fileProgress[note._id];
    const isPending = task && (task.status === 'uploading' || task.status === 'encrypting');
    const isFailed = (task && task.status === 'failed') || note.permanentlyFailed;

    const StatusIcon = () => {
      if (isPending) return <CircularProgress size={12} sx={{ color: isOverlay ? '#fff' : '#8696a0' }} />;
      if (isFailed) return <ErrorOutlineIcon sx={{ fontSize: 14, color: '#f15c6d' }} />;
      if (note.isRead || note.status === 'seen') return <DoneAllIcon sx={{ fontSize: 14, color: '#53bdeb' }} />;
      const iconColor = isOverlay ? '#fff' : '#8696a0';
      if (note.status === 'delivered') return <DoneAllIcon sx={{ fontSize: 14, color: iconColor }} />;
      return <CheckIcon sx={{ fontSize: 14, color: iconColor }} />;
    };

    return (
      <Box className={isOverlay ? "msg-media-meta" : "msg-meta"}>
        {isPinned && !isOverlay && (
          <PushPinIcon sx={{ fontSize: 13, mr: 0.5, color: isSentByMe ? '#aebac1' : '#8696a0', transform: 'rotate(45deg)' }} />
        )}
        {note.isEdited && !note.isDeletedForEveryone && (
          <Box component="span" sx={{ fontSize: '0.65rem', fontStyle: 'italic', opacity: 0.7, mr: 0.5 }}>edited</Box>
        )}
        {dayjs(note.timestamp).format("h:mm A")}
        {isSentByMe && (
          <Box component="span" sx={{ ml: 0.5, display: 'flex', alignItems: 'center' }}>
            <StatusIcon />
          </Box>
        )}
      </Box>
    );
  };

  const renderMediaGrid = (items, isFirst) => {
    if (!items.length) return null;
    const isMobile = useMediaQuery('(max-width:600px)');
    const isTablet = useMediaQuery('(max-width:960px)');

    const displayCount = 4;
    const displayItems = items.slice(0, displayCount);
    const extraCount = Math.max(0, items.length - displayCount);
    const count = displayItems.length;
    const isSingle = count === 1;

    // WhatsApp-style grid (STRICT 2x2 cap with +X overlay)
    const getGridTemplate = () => {
      if (isSingle) return { columns: '1fr', rows: 'auto' };
      if (count === 2) return { columns: '1fr 1fr', rows: 'auto' };
      if (count === 3) return { columns: '1fr 1fr', rows: 'auto auto' };
      return { columns: '1fr 1fr', rows: '1fr 1fr' }; // Strict 2x2 cap
    };

    const grid = getGridTemplate();

    return (
        <Box key="media-grid" className="msg-media" style={{ 
            gridTemplateColumns: grid.columns,
            gridTemplateRows: grid.rows
        }}>
            {displayItems.map((att, idx) => {
                try {
                    const originalIdx = note.attachments.indexOf(att);
                    // For 3 items: first item spans full width
                    const spanFull = count === 3 && idx === 0;

                    return (
                        <Box 
                            key={att.id || `media-${idx}`}
                            sx={{ 
                                position: "relative", 
                                cursor: "pointer", 
                                overflow: "hidden", 
                                bgcolor: "#0b141a",
                                aspectRatio: isSingle 
                                    ? (att.type === 'video' || classifyFile(att) === FILE_TYPES.VIDEO ? '16 / 9' : 'auto') 
                                    : '1 / 1',
                                maxHeight: isSingle ? 400 : (count > 9 ? 120 : (count > 4 ? 160 : 220)),
                                minHeight: isSingle && (att.type === 'video' || classifyFile(att) === FILE_TYPES.VIDEO) ? 180 : (isSingle ? 'auto' : 80),
                                ...(spanFull && { gridColumn: '1 / -1', aspectRatio: '16 / 9', maxHeight: 220 }),
                                '&:hover': { opacity: 0.92 }
                            }} 
                            onClick={(e) => handleMediaClick(e, originalIdx)}
                        >
                            <DecryptedMedia 
                                attachment={att} 
                                noteId={note._id}
                                remoteUserId={remoteUserId}
                                isSentByMe={isSentByMe}
                                isSingle={isSingle}
                                isThreeGridFirst={spanFull}
                                index={originalIdx}
                                extraCount={idx === displayItems.length - 1 ? extraCount : 0} 
                                isThumbnail={true}
                            />
                            
                            {/* Metadata Overlay for Media */}
                            {renderMetadataRow(true)}
                            
                            {/* WhatsApp-Style Floating Download Button for Media */}
                            {att._isReady && (
                                <IconButton
                                    size="small"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        downloadFile(att.url, att.fileName || att.originalName, att.binaryAesKey ? { aesKey: att.binaryAesKey, iv: att.binaryIv, mimeType: att.mimeType || att.originalMimeType || att.type } : null);
                                    }}
                                    sx={{
                                        position: 'absolute',
                                        top: 6,
                                        right: 6,
                                        bgcolor: 'rgba(0,0,0,0.5)',
                                        color: '#e9edef',
                                        opacity: 0,
                                        transition: 'opacity 0.2s',
                                        '&:hover': { bgcolor: '#00a884', color: '#fff' },
                                        '.MuiBox-root:hover &': { opacity: 1 }
                                    }}
                                >
                                    <FileDownloadIcon fontSize="small" />
                                </IconButton>
                            )}
                        </Box>
                    );
                } catch (err) {
                    console.error("Media render failed:", err);
                    return <Box key={`err-${idx}`} sx={{ p: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: 'rgba(0,0,0,0.2)', color: '#8696a0', fontSize: '12px' }}>⚠️ Media failed</Box>;
                }
            })}
        </Box>
    );
  };

  const renderAudioRow = (att, isFirst) => {
      return (
          <Box key={getEffectiveAttachmentId(att, isFirst ? 0 : 1)} sx={{ overflow: 'hidden' }}>
              <Box className="msg-audio">
                  <Box sx={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
                      <DecryptedMedia 
                          attachment={att} 
                          noteId={note._id}
                          remoteUserId={remoteUserId}
                          isSentByMe={isSentByMe}
                          isSingle={true}
                          isThumbnail={false}
                      />
                  </Box>
                  <IconButton
                      size="small"
                      onClick={(e) => {
                          e.stopPropagation();
                          downloadFile(att.url, att.fileName || att.originalName, att.binaryAesKey ? { aesKey: att.binaryAesKey, iv: att.binaryIv, mimeType: att.mimeType || att.originalMimeType || att.type } : null);
                      }}
                      sx={{ 
                          color: 'var(--accent)', 
                          bgcolor: 'rgba(0,168,132,0.12)', 
                          flexShrink: 0,
                          width: 36, height: 36,
                          '&:hover': { bgcolor: 'rgba(0,168,132,0.25)' }
                      }}
                  >
                      <FileDownloadIcon fontSize="small" />
                  </IconButton>
              </Box>
          </Box>
      );
  };

  const getFileIcon = (att) => {
      const str = ((att.type || '') + ' ' + (att.fileName || att.originalName || '')).toLowerCase();
      if (str.includes("pdf")) return <PictureAsPdfIcon sx={{ fontSize: 28, color: "#fff" }} />;
      if (str.includes("word") || str.includes("doc")) return <DescriptionIcon sx={{ fontSize: 28, color: "#fff" }} />;
      if (str.includes("excel") || str.includes("xls")) return <GridOnIcon sx={{ fontSize: 28, color: "#fff" }} />;
      if (str.includes("zip") || str.includes("rar")) return <FolderZipIcon sx={{ fontSize: 28, color: "#fff" }} />;
      return <InsertDriveFileIcon sx={{ fontSize: 28, color: "#fff" }} />;
  };

  const getIconBg = (att) => {
      const str = ((att.type || '') + ' ' + (att.fileName || att.originalName || '')).toLowerCase();
      if (str.includes("pdf")) return '#e53935';
      if (str.includes("word") || str.includes("doc")) return '#42a5f5';
      if (str.includes("excel") || str.includes("xls")) return '#4caf50';
      if (str.includes("zip") || str.includes("rar")) return '#ffa726';
      return '#8696a0';
  };

  const getFileExt = (att) => {
      const name = att.fileName || att.originalName || '';
      const ext = name.split('.').pop();
      return ext ? ext.toUpperCase() : 'FILE';
  };

  const renderFileRow = (att, isFirst) => {
      return (
          <Box key={att.id || `file-${att.fileName}`} className="msg-file-card">
              <Box className="msg-file-info">
                  <Box sx={{ 
                      width: 42, height: 42, borderRadius: 2, 
                      bgcolor: getIconBg(att), 
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      flexShrink: 0
                  }}>
                      {getFileIcon(att)}
                  </Box>
                  <Box sx={{ flex: 1, minWidth: 0, overflow: 'hidden', pr: 8 }}>
                      <Typography variant="body2" noWrap sx={{ fontWeight: 500, color: 'var(--text-primary)', fontSize: '0.875rem' }}>
                          {att.fileName || att.originalName}
                      </Typography>
                      <Typography variant="caption" sx={{ color: 'var(--text-secondary)', fontSize: '0.7rem' }}>
                          {getFileExt(att)} • {att.size ? formatBytes(att.size) : ''}
                      </Typography>
                  </Box>
                  {/* Integrated Metadata for File Card */}
                  <Box className="msg-file-metadata">
                     {renderMetadataRow(false)}
                  </Box>
              </Box>
              <Box className="msg-file-actions">
                  <Box onClick={(e) => { e.stopPropagation(); downloadFile(att.url, att.fileName || att.originalName, att.binaryAesKey ? { aesKey: att.binaryAesKey, iv: att.binaryIv, mimeType: att.mimeType || att.originalMimeType || att.type } : null); }}>
                      Open
                  </Box>
                  <Box onClick={(e) => { e.stopPropagation(); downloadFile(att.url, att.fileName || att.originalName, att.binaryAesKey ? { aesKey: att.binaryAesKey, iv: att.binaryIv, mimeType: att.mimeType || att.originalMimeType || att.type } : null); }}>
                      Save as...
                  </Box>
              </Box>
          </Box>
      );
  };

  // Optimization: Memoize attachment filtering (Hardening Rule 8)
  // Optimization: Memoize attachment filtering using global normalization utility (Hardening Rule 8)
  const { images, videos, audio, files } = useMemo(() => {
     return normalizeAttachments(note.attachments);
  }, [note.attachments]);

  const mediaAttachments = [...images, ...videos];
  const audioAttachments = audio;
  const fileAttachments = files;

  // Unified content array mapping WhatsApp principle (ONE fused stream)
  const unifiedContent = [
      ...fileAttachments.map(f => ({ type: 'file', data: f })),
      ...(mediaAttachments.length ? [{ type: 'media', data: mediaAttachments }] : []),
      ...audioAttachments.map(a => ({ type: 'audio', data: a }))
  ];

  const messageState = resolveMessageFSM(note, userId);

  // 🚫 DO NOT RENDER (Private Deletes)
  if (messageState === 'deleted-local') {
      return null;
  }

  // 🪦 DELETED FOR EVERYONE (Tombstone)
  if (messageState === 'deleted-global') {
      return (
        <Box id={`deleted-${note._id}`} ref={ref} sx={{ display: "flex", justifyContent: bubbleAlignment, width: "100%", boxSizing: "border-box", py: 0.5, px: { xs: 1, sm: 2 } }}>
          <Paper sx={{ p: "6px 8px 8px 10px", maxWidth:{ xs:"85%", sm:"70%" }, bgcolor: bubbleColor, borderRadius: borderRadius, boxShadow: "0 1px 0.5px rgba(0,0,0,0.13)", display: "flex", alignItems: "center", color: "#8696a0", fontStyle: "italic", opacity: 0.8 }}>
            <BlockIcon sx={{ fontSize: 16, mr: 1 }} />
            <Typography variant="body2">This message was deleted</Typography>
          </Paper>
        </Box>
      );
  }

  // ⏳ WAITING FOR RATCHET
  if (messageState === 'waiting') {
      return (
        <Box id={`waiting-${note._id}`} ref={ref} sx={{ display: "flex", justifyContent: bubbleAlignment, width: "100%", boxSizing: "border-box", py: 0.5, px: { xs: 1, sm: 2 } }}>
          <Paper sx={{ p: "6px 8px 8px 10px", maxWidth:{ xs:"85%", sm:"70%" }, bgcolor: bubbleColor, borderRadius: borderRadius, boxShadow: "0 1px 0.5px rgba(0,0,0,0.13)", display: "flex", alignItems: "center", color: "#8696a0", fontStyle: "italic", opacity: 0.8 }}>
            <Typography variant="body2">Waiting for this message. This may take a while.</Typography>
          </Paper>
        </Box>
      );
  }

  // ⚠️ EMPTY / CORRUPT DATA
  if (messageState === 'empty') {
      return (
        <Box id={`empty-${note._id}`} ref={ref} sx={{ display: "flex", justifyContent: bubbleAlignment, width: "100%", boxSizing: "border-box", py: 0.5, px: { xs: 1, sm: 2 } }}>
          <Paper sx={{ p: "6px 8px 8px 10px", maxWidth:{ xs:"85%", sm:"70%" }, bgcolor: bubbleColor, borderRadius: borderRadius, boxShadow: "0 1px 0.5px rgba(0,0,0,0.13)", display: "flex", alignItems: "center", color: "#8696a0", fontStyle: "italic", opacity: 0.8 }}>
            <ErrorOutlineIcon sx={{ fontSize: 16, mr: 1 }} />
            <Typography variant="body2">Message sent (copy unavailable)</Typography>
          </Paper>
        </Box>
      );
  }

  const hasText = !!displayText;
  const hasFiles = fileAttachments.length > 0;
  const hasMedia = mediaAttachments.length > 0;

  return (
    <Box 
      id={note._id}
      ref={ref}
      sx={{ 
         display: "flex", 
         justifyContent: bubbleAlignment, 
         width: "100%", 
         boxSizing: "border-box",
         py: 0.5, px: { xs: 1, sm: 2 },
         position: 'relative',
         transform: `translateX(${swipeOffset}px)`,
         transition: touchStart ? 'none' : 'transform 0.2s',
         bgcolor: isSelected ? "rgba(0,168,132,0.2)" : "transparent",
         '&:hover .msg-forward-btn': { opacity: 1 }
      }}
      onClick={() => onPress(note)}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onTouchStart={handleTouchStateStart}
      onTouchEnd={handleTouchStateEnd}
      onTouchMove={handleTouchStateEnd}
      onContextMenu={(e) => {
          e.preventDefault();
          if (onRightClick) onRightClick(e, note);
          else if (onLongPress) onLongPress(note);
      }}
    >
      {/* WhatsApp Forward Icon (Visible on hover) */}
      <Box className="msg-forward-btn" sx={{ 
        position: 'absolute', 
        [isSentByMe ? 'right' : 'left']: '100%', 
        [isSentByMe ? 'marginRight' : 'marginLeft']: 1.5,
        top: '50%', transform: 'translateY(-50%)',
        opacity: 0, transition: 'opacity 0.2s',
        display: { xs: 'none', md: 'flex' }
      }}>
        <IconButton size="small" sx={{ bgcolor: 'rgba(255,255,255,0.05)', color: '#aebac1', '&:hover': { bgcolor: 'rgba(255,255,255,0.1)', color: '#fff' } }}>
           <ReplyIcon sx={{ transform: 'scaleX(-1)', fontSize: 20 }} />
        </IconButton>
      </Box>

      <Paper 
        className={`msg-bubble ${isSentByMe ? 'out' : 'in'} ${isSelected ? 'selected' : ''} ${isFirstInGroup ? 'has-tail' : ''}`}
        sx={{
          border: isPinned ? `1px solid ${isSentByMe ? '#00a884' : 'rgba(134,150,160,0.5)'}` : 'none',
          bgcolor: isPinned ? (isSentByMe ? '#054740' : '#26353d') : bubbleColor, // subtle shift for pinned
          boxShadow: isPinned ? `0 0 8px ${isSentByMe ? 'rgba(0,168,132,0.2)' : 'rgba(134,150,160,0.2)'}` : '0 1px 0.5px rgba(0,0,0,0.13)'
        }}
      >
        {/* Sender Name (Group only) */}
        {!isSentByMe && senderName !== "Anonymous" && note.isGroup && (
           <Typography variant="caption" sx={{ color: getUserColor(note.senderId), fontWeight: 'bold', display: 'block', mb: 0.5, px: 'var(--bubble-padding-x)', pt: '8px' }}>
              {senderName}
           </Typography>
        )}

        {/* Reply Reference (WhatsApp Style) */}
        {reply && (
           <Box className="msg-reply" onClick={(e) => {
             e.stopPropagation();
             const el = document.getElementById(repliedMessage?._id);
             if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
           }}>
              <Typography variant="caption" sx={{ color: "var(--accent)", fontWeight: 700, display: "block", fontSize: 12 }}>
                {reply.senderLabel}
              </Typography>
              <Typography variant="caption" noWrap sx={{ color: "var(--text-secondary)", display: "block", fontSize: 12 }}>
                {repliedMessage?.attachments?.length > 0 ? "Photo/Video" : reply.text}
              </Typography>
           </Box>
        )}

        {/* Message Content Stream (Unified Surface) */}
        <Box className="msg-content">
            {unifiedContent.map((item, i) => {
                const isFirst = i === 0;
                if (item.type === 'file') return renderFileRow(item.data, isFirst);
                if (item.type === 'media') return renderMediaGrid(item.data, isFirst);
                if (item.type === 'audio') return renderAudioRow(item.data, isFirst);
                return null;
            })}
        </Box>
        
        {/* Text Content */}
        {displayText && (
            <Box className="msg-text">
                {renderText()}
            </Box>
        )}

        {/* Bottom Metadata (Only if text is present. Media/Files have their own) */}
        {(hasText || (!hasMedia && !hasFiles)) && renderMetadataRow(false)}
      </Paper>
    </Box>
  );
});

export default React.memo(MessageBubble, (prevProps, nextProps) => {
    const isNoteSame = prevProps.note._id === nextProps.note._id && 
                      prevProps.note.status === nextProps.note.status && 
                      prevProps.note.isDecrypted === nextProps.note.isDecrypted &&
                      prevProps.note.isEdited === nextProps.note.isEdited &&
                      prevProps.note.plaintextEdit === nextProps.note.plaintextEdit &&
                      prevProps.note.isDeletedForEveryone === nextProps.note.isDeletedForEveryone;

    // We must also re-render if the original message being replied to changes its text!
    const replyId = nextProps.note.replyTo?._id || nextProps.note.replyTo;
    let isReplySame = true;
    if (replyId) {
        const prevReply = prevProps.allNotes?.find(n => n._id === replyId);
        const nextReply = nextProps.allNotes?.find(n => n._id === replyId);
        isReplySame = prevReply?.plaintextEdit === nextReply?.plaintextEdit && 
                     prevReply?.isDeletedForEveryone === nextReply?.isDeletedForEveryone;
    }

    return isNoteSame && 
           isReplySame && 
           prevProps.isSelected === nextProps.isSelected && 
           prevProps.isPinned === nextProps.isPinned &&
           prevProps.isFirstInGroup === nextProps.isFirstInGroup;
});
