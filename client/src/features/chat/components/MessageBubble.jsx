import React, { useState } from 'react';
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
  const [swipeOffset, setSwipeOffset] = useState(0);
  const [showFull, setShowFull] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

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

  const onTouchStartLocal = (e) => setTouchStart(e.targetTouches[0].clientX);
  const onTouchMoveLocal = (e) => {
    if(!touchStart) return;
    const currentTouch = e.targetTouches[0].clientX;
    const diff = currentTouch - touchStart;
    if(diff > 0 && diff < 100) setSwipeOffset(diff);
  };
  const onTouchEndLocal = () => {
    if(swipeOffset > 50) onSwipeRight(note);
    setTouchStart(null); setSwipeOffset(0);
  };

  const isLong = note.noteText && note.noteText.length > 300;
  const displayText = (isLong && !showFull) ? note.noteText.substring(0,300)+"..." : note.noteText;

  let mousePressTimer;
  const handleMouseDown = () => { mousePressTimer = setTimeout(() => onLongPress(note), 500); };
  const handleMouseUp = () => { clearTimeout(mousePressTimer); };

  const handleMediaClick = (e, idx) => {
    e.stopPropagation();
    onPreviewMedia({ items: note.attachments, currentIndex: idx, note });
  };

  // -----------------------------------------
  // DELETED MESSAGE STATE (Muted bubble)
  // -----------------------------------------
  if (note.isDeletedForEveryone || note.isDeletedForMe || note.isDeleted) {
      return (
        <Box 
          id={`deleted-${note._id}`}
          ref={ref}
          sx={{ 
             display: "flex", justifyContent: bubbleAlignment, width: "100%", boxSizing: "border-box", py: 0.5, px: { xs: 1, sm: 2 }
          }}
        >
          <Paper sx={{
            p: "6px 8px 8px 10px",
            maxWidth:{ xs:"85%", sm:"70%" },
            bgcolor: bubbleColor,
            borderRadius: borderRadius,
            boxShadow: "0 1px 0.5px rgba(0,0,0,0.13)",
            display: "flex", alignItems: "center", color: "#8696a0", fontStyle: "italic", opacity: 0.8
          }}>
            <BlockIcon sx={{ fontSize: 16, mr: 1 }} />
            <Typography variant="body2">This message was deleted</Typography>
            <Typography variant="caption" sx={{ color: "rgba(255,255,255,0.4)", fontSize: "0.65rem", ml: 2, alignSelf: 'flex-end', mb: '-2px' }}>
              {dayjs(note.timestamp).format("h:mm A")}
            </Typography>
          </Paper>
        </Box>
      );
  }

  // -----------------------------------------
  // NORMAL MESSAGE STATE
  // -----------------------------------------
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
      onTouchStart={onTouchStartLocal}
      onTouchMove={onTouchMoveLocal}
      onTouchEnd={onTouchEndLocal}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={(e) => { handleMouseUp(e); setIsHovered(false); }}
      onContextMenu={(e) => { 
        e.preventDefault(); 
        if (onRightClick) onRightClick(e, note); 
      }}
    >
      {/* Swipe Icon Hint */}
      {swipeOffset > 20 && (
        <Box sx={{ position: "absolute", left: -30, top: "50%", transform: "translateY(-50%)", color: "#aebac1" }}>
          <ReplyIcon fontSize="small" />
        </Box>
      )}

      {/* Desktop Hover Actions */}
      {isHovered && !(note.isDeletedForEveryone || note.isDeletedForMe || note.isDeleted) && (
        <Box 
          sx={{ 
            position: "absolute", 
            [isSentByMe ? 'right' : 'left']: "100%", 
            [isSentByMe ? 'mr' : 'ml']: 1, 
            top: "50%", 
            transform: "translateY(-50%)", 
            display: { xs: 'none', md: 'flex' }, // Hide on mobile where swipe exists
            gap: 0.5,
            zIndex: 10
          }}
        >
          <IconButton 
            size="small" 
            sx={{ bgcolor: "rgba(0,0,0,0.3)", color: "#aebac1", '&:hover': { bgcolor: "rgba(0,0,0,0.6)", color: "#e9edef" } }}
            onClick={(e) => { e.stopPropagation(); onSwipeRight(note); }}
            title="Reply"
          >
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
        {/* Sender Name (only if not me) */}
        {!isSentByMe && senderName !== "Anonymous" && note.isGroup && (
           <Typography variant="caption" sx={{ color: getUserColor(note.senderId), fontWeight: 'bold', display: 'block', mb: 0.5, cursor: "pointer", "&:hover": { textDecoration: "underline" } }}>
              {senderName}
           </Typography>
        )}

        {/* Reply Reference */}
        {note.replyTo && (
           <Box sx={{ 
             mb: 0.5, 
             borderLeft: "4px solid #00a884", 
             pl: 1, 
             bgcolor: "rgba(0,0,0,0.2)", 
             borderRadius: 1, 
             py: 0.5,
             cursor: "pointer",
             "&:hover": { bgcolor: "rgba(0,0,0,0.3)" }
           }} onClick={(e) => {
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

        {/* Attachments Grouping */}
        {note.attachments && note.attachments.length > 0 && (() => {
          const media = note.attachments.filter(a => a.type === 'image' || a.type === 'video');
          const others = note.attachments.filter(a => a.type !== 'image' && a.type !== 'video');
          const isSingle = media.length === 1;
          const displayMedia = media.slice(0, 4);
          const extraCount = media.length - 4;

          return (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, mb: note.noteText ? 1 : 0, mt: 0.5 }}>
              
              {/* Media Grid */}
              {media.length > 0 && (
                <Box sx={{ 
                  display: 'grid', 
                  gridTemplateColumns: isSingle ? '1fr' : 'repeat(2, 1fr)', 
                  gap: '4px'
                }}>
                  {displayMedia.map((att, idx) => {
                    const originalIdx = note.attachments.indexOf(att);
                    const isThreeGridFirst = media.length === 3 && idx === 0;
                    return (
                      <Box 
                        key={originalIdx} 
                        sx={{ 
                          position: "relative", 
                          cursor: "pointer", 
                          borderRadius: 2, 
                          overflow: "hidden", 
                          bgcolor: "rgba(0,0,0,0.1)",
                          gridColumn: isThreeGridFirst ? 'span 2' : 'span 1',
                          aspectRatio: isSingle ? 'auto' : (isThreeGridFirst ? '2 / 1' : '1 / 1'),
                          maxHeight: isSingle ? 300 : 'none',
                        }} 
                        onClick={(e) => {
                          if (note.status === 'uploading' || note.status === 'failed') return;
                          handleMediaClick(e, originalIdx);
                        }}
                      >
                         <DecryptedMedia 
                           attachment={att} 
                           remoteUserId={remoteUserId}
                           isSentByMe={isSentByMe}
                           isSingle={isSingle}
                           isThreeGridFirst={isThreeGridFirst}
                           extraCount={idx === 3 ? extraCount : 0} 
                        />
                         
                         {/* Uploading Progress Overlay */}
                         {note.status === 'uploading' && fileProgress?.[note._id] && (
                            <Box sx={{ position: 'absolute', inset: 0, bgcolor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
                               <Box sx={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                  <CircularProgress variant="determinate" value={fileProgress[note._id].progress} sx={{ color: '#00a884' }} size={48} />
                                  <IconButton size="small" sx={{ position: 'absolute', color: '#fff' }} onClick={(e) => { e.stopPropagation(); cancelTask(note._id); }}>
                                     <CancelIcon fontSize="medium" />
                                  </IconButton>
                               </Box>
                               <Typography variant="caption" sx={{ color: '#fff', mt: 1, fontWeight: 'bold' }}>{fileProgress[note._id].progress}%</Typography>
                            </Box>
                         )}
                         {/* Failed Overlay */}
                         {(note.status === 'failed' || fileProgress?.[note._id]?.status === 'failed') && (
                            <Box sx={{ position: 'absolute', inset: 0, bgcolor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
                               <ErrorOutlineIcon sx={{ color: '#ff4c4c', fontSize: 36 }} />
                               <Typography variant="caption" sx={{ color: '#fff', mt: 0.5 }}>Upload Failed</Typography>
                               <Button size="small" variant="contained" sx={{ mt: 1, textTransform: 'none', bgcolor: '#00a884', '&:hover': { bgcolor: '#008a6d' } }} onClick={(e) => { e.stopPropagation(); retryTask(note._id); }}>
                                  Retry
                               </Button>
                            </Box>
                         )}
                         {/* Media Download Button Overlay */}
                         {note.status !== 'uploading' && note.status !== 'failed' && fileProgress?.[note._id]?.status !== 'failed' && att.url && (
                             <Box sx={{ position: 'absolute', top: 6, right: 6, zIndex: 10, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', pointerEvents: 'none' }}>
                                {(() => {
                                    const downloadState = fileProgress?.[att.url];
                                    const isDownloading = !!downloadState && downloadState.status === 'downloading';
                                    if (isDownloading) {
                                        return (
                                           <Box sx={{ bgcolor: 'rgba(0,0,0,0.7)', borderRadius: 2, p: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', pointerEvents: 'auto' }}>
                                               <Box sx={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                  <CircularProgress variant="determinate" value={downloadState.progress} sx={{ color: '#00a884' }} size={36} />
                                                  <IconButton size="small" sx={{ position: 'absolute', color: '#fff' }} onClick={(e) => { e.stopPropagation(); cancelTask(att.url); }}>
                                                     <CancelIcon sx={{ fontSize: 16 }} />
                                                  </IconButton>
                                               </Box>
                                               <Typography variant="caption" sx={{ color: '#fff', mt: 0.5, fontWeight: 'bold' }}>{downloadState.progress}%</Typography>
                                           </Box>
                                        );
                                    }
                                    if (downloadState && downloadState.status === 'failed') {
                                        return (
                                           <Box sx={{ bgcolor: 'rgba(0,0,0,0.7)', borderRadius: 2, p: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.5, pointerEvents: 'auto' }}>
                                              <ErrorOutlineIcon sx={{ color: '#ff4c4c', fontSize: 24 }} />
                                              <Typography variant="caption" sx={{ color: '#fff' }}>Download Failed</Typography>
                                              <Box sx={{ display: 'flex', gap: 0.5 }}>
                                                <Button size="small" variant="contained" sx={{ textTransform: 'none', bgcolor: '#00a884', color: '#fff', fontSize: '0.7rem', padding: '2px 8px', minWidth: 0, '&:hover': { bgcolor: '#008a6d' } }} onClick={(e) => { e.stopPropagation(); retryTask(att.url) || downloadFile(att.decryptedUrl || att.url, att.originalName); }}>
                                                   Retry
                                                </Button>
                                                <Button size="small" variant="outlined" sx={{ textTransform: 'none', color: '#fff', borderColor: '#fff', fontSize: '0.7rem', padding: '2px 8px', minWidth: 0 }} onClick={(e) => { e.stopPropagation(); window.open(att.url, '_blank'); }}>
                                                   Direct
                                                </Button>
                                              </Box>
                                           </Box>
                                        );
                                    }
                                    return (
                                        <Box sx={{ pointerEvents: 'auto' }}>
                                           <IconButton size="small" sx={{ bgcolor: 'rgba(0,0,0,0.6)', color: '#fff', '&:hover': { bgcolor: 'rgba(0,0,0,0.8)' } }} onClick={(e) => { e.stopPropagation(); downloadFile(att.decryptedUrl || att.url, att.originalName); }}>
                                              <FileDownloadIcon fontSize="small" />
                                           </IconButton>
                                        </Box>
                                    );
                                })()}
                             </Box>
                         )}
                      </Box>
                    );
                  })}
                </Box>
              )}

              {/* Other Files (Documents/Audio) */}
              {others.map((att, idx) => {
                 const uploadState = note.status === 'uploading' ? fileProgress?.[note._id] : null;
                 const downloadState = fileProgress?.[att.url];
                 const isUploading = !!uploadState && uploadState.status === 'uploading';
                 const isDownloading = !!downloadState && downloadState.status === 'downloading';
                 const hasFailed = note.status === 'failed' || downloadState?.status === 'failed' || uploadState?.status === 'failed';

                 return (
                 <Box 
                   key={`other-${idx}`} 
                   sx={{ display: "flex", alignItems: "center", p: 1.5, boxSizing: 'border-box', bgcolor: "rgba(255,255,255,0.05)", borderRadius: 1, width: "100%", border: "1px solid rgba(255,255,255,0.05)", cursor: isUploading ? 'default' : 'pointer' }} 
                   onClick={(e) => { 
                       e.stopPropagation(); 
                       if(isUploading || hasFailed) return;
                       if(!isDownloading) downloadFile(att.decryptedUrl || att.url, att.originalName); 
                   }}
                 >
                    <Box sx={{ position: 'relative', mr: 1, display: 'flex' }}>
                       {att.type==='audio' ? <AudioFileIcon sx={{ fontSize: 32, color: "#aebac1" }} /> : att.type==='document' && att.originalName.endsWith('.pdf') ? <PictureAsPdfIcon sx={{ fontSize: 32, color: "#e53935" }} /> : <InsertDriveFileIcon sx={{ fontSize: 32, color: "#aebac1" }} />}
                    </Box>

                    <Box sx={{ flex: 1, overflow: "hidden" }}>
                        <Typography variant="body2" noWrap sx={{ fontWeight: 500, color: "#e9edef" }}>{att.originalName}</Typography>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                           {isUploading ? (
                               <Typography variant="caption" sx={{ color: "#00a884" }}>Uploading... {uploadState.progress}%</Typography>
                           ) : isDownloading ? (
                               <Typography variant="caption" sx={{ color: "#00a884" }}>Downloading... {downloadState.progress}%</Typography>
                           ) : hasFailed ? (
                               <Typography variant="caption" sx={{ color: "#ff4c4c" }}>Failed ({note.status === 'failed' || uploadState?.status === 'failed' ? 'Upload' : 'Download'})</Typography>
                           ) : (
                               <Typography variant="caption" sx={{ color: "#8696a0", display: 'flex', gap: 1 }}>
                                  {att.size ? formatBytes(att.size) : ''} {att.size ? '•' : ''} {att.type.toUpperCase()}
                               </Typography>
                           )}
                        </Box>
                    </Box>
                    
                    {isUploading ? (
                       <Box sx={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <CircularProgress variant="determinate" value={uploadState.progress} sx={{ color: '#00a884' }} size={28} />
                          <IconButton size="small" sx={{ position: 'absolute', color: '#aebac1' }} onClick={(e) => { e.stopPropagation(); cancelTask(note._id); }}>
                             <CancelIcon sx={{ fontSize: 16 }} />
                          </IconButton>
                       </Box>
                    ) : isDownloading ? (
                       <Box sx={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <CircularProgress variant="determinate" value={downloadState.progress} sx={{ color: '#00a884' }} size={28} />
                          <IconButton size="small" sx={{ position: 'absolute', color: '#aebac1' }} onClick={(e) => { e.stopPropagation(); cancelTask(att.url); }}>
                             <CancelIcon sx={{ fontSize: 16 }} />
                          </IconButton>
                       </Box>
                    ) : hasFailed ? (
                       <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                         <Button size="small" sx={{ color: '#00a884', textTransform: 'none', fontWeight: 'bold' }} onClick={(e) => { 
                             e.stopPropagation(); 
                             if (note.status === 'failed' || uploadState?.status === 'failed') retryTask(note._id);
                             else if (downloadState?.status === 'failed') { retryTask(att.url) || downloadFile(att.decryptedUrl || att.url, att.originalName); }
                         }}>
                            Retry
                         </Button>
                         {downloadState?.status === 'failed' && (
                           <Button size="small" sx={{ color: '#aebac1', textTransform: 'none', minWidth: 0 }} onClick={(e) => { e.stopPropagation(); window.open(att.url, '_blank'); }}>
                             Direct URL
                           </Button>
                         )}
                       </Box>
                    ) : (
                       <IconButton size="small" sx={{ color: "#aebac1" }} onClick={(e) => { e.stopPropagation(); downloadFile(att.decryptedUrl || att.url, att.originalName); }}>
                          <FileDownloadIcon fontSize="small" />
                       </IconButton>
                    )}
                 </Box>
                 );
              })}
            </Box>
          );
        })()}

        <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between", mt: 0.5 }}>
          <Typography variant="body1" sx={{ whiteSpace:"pre-wrap", wordBreak:"break-word", fontSize: "0.95rem", color: "#e9edef", flex: 1, pr: 1 }}>
            {parseMessageText(displayText, currentUser?.username)}
            {isLong && <Button onClick={e=>{e.stopPropagation(); setShowFull(!showFull);}} sx={{ ml:0, p:0, minWidth:0, fontSize:"0.75rem", textTransform:"none", color:"#53bdeb" }}>{showFull?"Read less":"Read more"}</Button>}
          </Typography>
              <Typography 
                variant="caption" 
                sx={{ 
                  color: isSentByMe ? "rgba(255,255,255,0.7)" : "#8696a0", 
                  fontSize: "0.65rem", 
                  alignSelf: 'flex-end', 
                  mb: '-2px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 0.5
                }}
              >
                {note.isEdited && <span style={{ fontStyle: 'italic', marginRight: '2px' }}>(edited)</span>}
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
