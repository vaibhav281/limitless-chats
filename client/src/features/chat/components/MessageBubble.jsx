import React, { useState, useEffect, useMemo } from 'react';
import { Box, Paper, Typography, IconButton, Button, CircularProgress } from '@mui/material';
import FileDownloadIcon from '@mui/icons-material/FileDownload';
import PlayCircleIcon from '@mui/icons-material/PlayCircle';
import PushPinIcon from '@mui/icons-material/PushPin';
import ReplyIcon from '@mui/icons-material/Reply';
import InsertDriveFileIcon from '@mui/icons-material/InsertDriveFile';
import AudioFileIcon from '@mui/icons-material/AudioFile';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
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
import { getEffectiveAttachmentId, runMediaDecryptionPipeline, E2EE_ERRORS } from '../../encryption/cryptoService';
import { mediaKeyCache } from '../../encryption/mediaKeyCache';
import { classifyFile, FILE_TYPES } from '../utils/fileTypeClassifier';

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
  onRightClick
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

  const isLong = note.noteText && note.noteText.length > 300;
  const displayText = (isLong && !showFull) ? note.noteText.substring(0,300)+"..." : note.noteText;

  // Hydration is now handled by MessageLifecycleManager. Background triggers removed from UI.

  const handleMediaClick = async (e, idx) => {
    e.stopPropagation();
    
    const itemsWithDecryptedUrls = await Promise.all(note.attachments.map(async (att) => {
        const effectiveId = getEffectiveAttachmentId(att);
        const cacheKey = `${note._id}_${effectiveId}`;
        const cachedUrl = blobCache.get(cacheKey);

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

  const TextRenderer = () => {
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

  const MediaRenderer = ({ items }) => {
    if (!items.length) return null;
    const extraCount = Math.max(0, items.length - 4);
    const displayItems = items.slice(0, 4);
    const isSingle = displayItems.length === 1 && !note.noteText;

    return (
        <Box sx={{ 
            display: "grid", 
            gap: 0.5, 
            mb: (displayText || note.ciphertext) ? 1 : 0,
            gridTemplateColumns: isSingle ? '1fr' : 'repeat(2, 1fr)',
            width: '100%',
            maxWidth: '320px', // Strict limit to prevent giant image/video bubbles
        }}>
            {displayItems.map((att, idx) => {
                const originalIdx = note.attachments.indexOf(att);
                const isThreeGridFirst = displayItems.length === 3 && idx === 0;

                return (
                    <Box 
                        key={att.id || `media-${idx}`}
                        sx={{ 
                            position: "relative", 
                            cursor: "pointer", 
                            borderRadius: 2, 
                            overflow: "hidden", 
                            bgcolor: "rgba(0,0,0,0.1)",
                            gridColumn: isThreeGridFirst ? 'span 2' : 'span 1',
                            aspectRatio: isSingle ? (att.type === 'video' || classifyFile(att) === FILE_TYPES.VIDEO ? '16 / 9' : 'auto') : (isThreeGridFirst ? '2 / 1' : '1 / 1'),
                            maxHeight: isSingle ? 400 : 'none',
                            minHeight: isSingle && (att.type === 'video' || classifyFile(att) === FILE_TYPES.VIDEO) ? 180 : 'auto',
                        }} 
                        onClick={(e) => handleMediaClick(e, originalIdx)}
                    >
                        <DecryptedMedia 
                            attachment={att} 
                            noteId={note._id}
                            remoteUserId={remoteUserId}
                            isSentByMe={isSentByMe}
                            isSingle={isSingle}
                            isThreeGridFirst={isThreeGridFirst}
                            extraCount={idx === 3 ? extraCount : 0} 
                            isThumbnail={true}
                        />
                        
                        {/* WhatsApp-Style Floating Download Button for Media */}
                        {att._isReady && (
                            <IconButton
                                size="small"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    downloadFile(att.url, att.fileName || att.originalName, att.binaryAesKey ? { aesKey: att.binaryAesKey, iv: att.binaryIv, mimeType: att.originalMimeType } : null);
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
                                    '.MuiBox-root:hover &': { opacity: 1 } // Show on parent hover
                                }}
                            >
                                <FileDownloadIcon fontSize="small" />
                            </IconButton>
                        )}
                    </Box>
                );
            })}
        </Box>
    );
  };

  const FileRenderer = ({ items }) => {
    if (!items.length) return null;

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, mb: (displayText || note.ciphertext) ? 1 : 0 }}>
            {items.map((att, idx) => {
                const type = classifyFile(att);
                const isPdf = type === FILE_TYPES.PDF;
                
                return (
                    <Box 
                        key={att.id || `file-${idx}`}
                        sx={{ 
                            display: "flex", 
                            alignItems: "center", 
                            p: 1.5, 
                            bgcolor: "rgba(255,255,255,0.05)", 
                            borderRadius: 1, 
                            border: "1px solid rgba(255,255,255,0.05)", 
                            cursor: 'pointer',
                            '&:hover': { bgcolor: "rgba(255,255,255,0.1)" }
                        }} 
                        onClick={(e) => {
                            e.stopPropagation();
                            downloadFile(att.url, att.fileName || att.originalName, att.binaryAesKey ? { aesKey: att.binaryAesKey, iv: att.binaryIv, mimeType: att.originalMimeType } : null);
                        }}
                    >
                        <Box sx={{ mr: 1.5, display: 'flex' }}>
                            {isPdf ? <PictureAsPdfIcon sx={{ fontSize: 32, color: "#e53935" }} /> : 
                             type === FILE_TYPES.AUDIO ? <AudioFileIcon sx={{ fontSize: 32, color: "#aebac1" }} /> : 
                             <InsertDriveFileIcon sx={{ fontSize: 32, color: "#aebac1" }} />}
                        </Box>
                        <Box sx={{ flex: 1, overflow: "hidden" }}>
                            <Typography variant="body2" noWrap sx={{ fontWeight: 500, color: "#e9edef" }}>
                                {att.fileName || att.originalName}
                            </Typography>
                            <Typography variant="caption" sx={{ color: "#8696a0" }}>
                                {att.size ? formatBytes(att.size) : ''} • {att.type ? att.type.toUpperCase() : 'FILE'}
                            </Typography>
                        </Box>
                        <IconButton size="small" sx={{ color: "#aebac1" }}>
                            <FileDownloadIcon fontSize="small" />
                        </IconButton>
                    </Box>
                );
            })}
        </Box>
    );
  };

  // Optimization: Memoize attachment filtering (Hardening Rule 8)
  const { mediaAttachments, fileAttachments, audioAttachments } = useMemo(() => {
    const media = [];
    const files = [];
    const audio = [];
    (note.attachments || []).forEach(a => {
        const type = classifyFile(a);
        if (type === FILE_TYPES.IMAGE || type === FILE_TYPES.VIDEO) media.push(a);
        else if (type === FILE_TYPES.AUDIO) audio.push(a);
        else files.push(a);
    });
    return { mediaAttachments: media, fileAttachments: files, audioAttachments: audio };
  }, [note.attachments]);

  if (note.isDeletedForEveryone || note.isDeletedForMe || note.isDeleted) {
      return (
        <Box id={`deleted-${note._id}`} ref={ref} sx={{ display: "flex", justifyContent: bubbleAlignment, width: "100%", boxSizing: "border-box", py: 0.5, px: { xs: 1, sm: 2 } }}>
          <Paper sx={{ p: "6px 8px 8px 10px", maxWidth:{ xs:"85%", sm:"70%" }, bgcolor: bubbleColor, borderRadius: borderRadius, boxShadow: "0 1px 0.5px rgba(0,0,0,0.13)", display: "flex", alignItems: "center", color: "#8696a0", fontStyle: "italic", opacity: 0.8 }}>
            <BlockIcon sx={{ fontSize: 16, mr: 1 }} />
            <Typography variant="body2">This message was deleted</Typography>
          </Paper>
        </Box>
      );
  }

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
         transform: `translateX(${swipeOffset}px)`,
         transition: touchStart ? 'none' : 'transform 0.2s',
         bgcolor: isSelected ? "rgba(0,168,132,0.2)" : "transparent"
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
      {/* Desktop Hover Actions */}
      {isHovered && (
        <Box sx={{ position: "absolute", [isSentByMe ? 'right' : 'left']: "100%", [isSentByMe ? 'mr' : 'ml']: 1, top: "50%", transform: "translateY(-50%)", display: { xs: 'none', md: 'flex' }, gap: 0.5, zIndex: 10 }}>
          <IconButton size="small" sx={{ bgcolor: "rgba(0,0,0,0.3)", color: "#aebac1", '&:hover': { bgcolor: "rgba(0,0,0,0.6)", color: "#e9edef" } }} onClick={(e) => { e.stopPropagation(); onSwipeRight(note); }}>
            <ReplyIcon fontSize="small" sx={{ transform: "scaleX(-1)" }} />
          </IconButton>
        </Box>
      )}

      <Paper sx={{
        p: "6px 8px 8px 10px",
        maxWidth:{ xs:"85%", sm:"70%" },
        bgcolor: isSelected ? "rgba(0,168,132,0.6)" : (note.pinned ? "#182229" : bubbleColor),
        borderRadius: borderRadius,
        boxShadow: "0 1px 0.5px rgba(0,0,0,0.13)",
        position:"relative",
        cursor:"pointer",
        "&:hover": { boxShadow: "0 1px 2px rgba(0,0,0,0.2)" },
        ...(isSelected && { border: "1px solid #00a884" }),
        display: "flex",
        flexDirection: "column",
        color: "#e9edef",
        minWidth: 0,
        overflowWrap: "anywhere",
        wordBreak: "break-word"
      }}>
        {/* Sender Name */}
        {!isSentByMe && senderName !== "Anonymous" && note.isGroup && (
           <Typography variant="caption" sx={{ color: getUserColor(note.senderId), fontWeight: 'bold', display: 'block', mb: 0.5 }}>
              {senderName}
           </Typography>
        )}

        {/* Reply Reference */}
        {note.replyTo && (
           <Box sx={{ mb: 0.5, borderLeft: "4px solid #00a884", pl: 1, bgcolor: "rgba(0,0,0,0.2)", borderRadius: 1, py: 0.5, cursor: "pointer" }} onClick={(e) => {
             e.stopPropagation();
             const el = document.getElementById(note.replyTo._id);
             if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
           }}>
              <Typography variant="caption" sx={{ color: "#00a884", fontWeight: 700, display: "block" }}>{note.replyTo.senderName || note.replyTo.sender || "Unknown"}</Typography>
              <Typography variant="caption" noWrap sx={{ color: "#aebac1", display: "block" }}>
                {note.replyTo.attachments?.length > 0 ? "Photo/Video" : note.replyTo.noteText}
              </Typography>
           </Box>
        )}

        {note.pinned && (
           <Box sx={{ display: "flex", alignItems: "center", mb: 0.5, borderLeft: "4px solid #8696a0", pl: 1, bgcolor: "rgba(0,0,0,0.2)", borderRadius: 1, py: 0.5 }}>
              <PushPinIcon sx={{ fontSize: 12, mr: 0.5, color: "#8696a0" }} />
              <Typography variant="caption" sx={{ color: "#8696a0", fontWeight: 600 }}>Pinned</Typography>
           </Box>
        )}

        {/* Message Content */}
        <Box sx={{ display: 'flex', flexDirection: 'column' }}>
            {(() => {
                return (
                    <>
                        <MediaRenderer items={mediaAttachments} />
                        {audioAttachments.map((att, idx) => (
                            <Box key={att.id || `audio-${idx}`} sx={{ mb: (displayText || note.ciphertext) ? 1 : 0 }}>
                                <DecryptedMedia 
                                    attachment={{...att, type: 'audio'}} 
                                    noteId={note._id}
                                    remoteUserId={remoteUserId}
                                    isSentByMe={isSentByMe}
                                    isSingle={true}
                                    isThumbnail={false}
                                />
                            </Box>
                        ))}
                        <FileRenderer items={fileAttachments} />
                        <TextRenderer />
                    </>
                );
            })()}
        </Box>

        {/* Timestamp & Status */}
        <Box sx={{ display: "flex", alignItems: "flex-end", justifyContent: "flex-end", mt: 0.5 }}>
              <Typography 
                variant="caption" 
                sx={{ 
                  color: isSentByMe ? "rgba(255,255,255,0.7)" : "#8696a0", 
                  fontSize: "0.65rem", 
                  display: 'flex',
                  alignItems: 'center',
                  gap: 0.5
                }}
              >
                {note.isEdited && <span>(edited) </span>}
                {dayjs(note.timestamp).format("h:mm A")}
                {isSentByMe && (
                  <Box component="span" sx={{ display: 'flex', alignItems: 'center', ml: 0.5 }}>
                    {(note.isRead || note.status === 'seen') ? (
                       <DoneAllIcon sx={{ fontSize: 14, color: '#53bdeb' }} />
                    ) : note.status === 'delivered' ? (
                       <DoneAllIcon sx={{ fontSize: 14, color: '#8696a0' }} />
                    ) : (
                       <CheckIcon sx={{ fontSize: 14, color: '#8696a0' }} />
                    )}
                  </Box>
                )}
              </Typography>
        </Box>
      </Paper>
    </Box>
  );
});

export default MessageBubble;
