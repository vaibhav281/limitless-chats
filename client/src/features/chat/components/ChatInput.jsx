import React, { useState, useRef } from 'react';
import { Box, TextField, IconButton, Fade, Typography, CircularProgress, Popover } from '@mui/material';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import SendIcon from '@mui/icons-material/Send';
import CloseIcon from '@mui/icons-material/Close';
import InsertEmoticonIcon from '@mui/icons-material/InsertEmoticon';
import CameraAltIcon from '@mui/icons-material/CameraAlt';
import PhotoLibraryIcon from '@mui/icons-material/PhotoLibrary';
import DescriptionIcon from '@mui/icons-material/Description';
import HeadphonesIcon from '@mui/icons-material/Headphones';
import useEmojiPicker from '../../../hooks/useEmojiPicker';
import EmojiPickerContainer from './EmojiPickerContainer';
import { insertAtCursor } from '../../../utils/insertAtCursor';

const ATTACH_OPTIONS = [
  { key: 'camera',   icon: CameraAltIcon,    label: 'Camera',   color: '#f06292' },
  { key: 'gallery',  icon: PhotoLibraryIcon,  label: 'Gallery',  color: '#7c4dff' },
  { key: 'document', icon: DescriptionIcon,   label: 'Document', color: '#5c6bc0' },
  { key: 'audio',    icon: HeadphonesIcon,    label: 'Audio',    color: '#f57c00' },
];

export default function ChatInput({ 
  inputRef, 
  handleSend, 
  handleKeyDown, 
  handleAttachmentClick,
  onCameraClick,
  onGalleryClick,
  onDocumentClick,
  onAudioClick,
  replyingTo,
  setReplyingTo,
  editingNote,
  setEditingNote
}) {
  const { isOpen, togglePicker, pickerRef, buttonRef } = useEmojiPicker();
  const [attachAnchor, setAttachAnchor] = useState(null);
  const attachOpen = Boolean(attachAnchor);

  const handleEmojiClick = (emojiData) => {
    if (!inputRef.current) return;
    const { newText, cursorStart } = insertAtCursor(inputRef.current, emojiData.emoji);
    inputRef.current.value = newText;
    
    // Restore focus and cursor position instantly
    inputRef.current.focus();
    inputRef.current.setSelectionRange(cursorStart, cursorStart);
  };

  const handleAttachOption = (key) => {
    setAttachAnchor(null);
    switch (key) {
      case 'camera':   onCameraClick?.();   break;
      case 'gallery':  onGalleryClick?.();  break;
      case 'document': onDocumentClick?.(); break;
      case 'audio':    onAudioClick?.();    break;
      default: handleAttachmentClick?.();
    }
  };

  return (
    <Box sx={{ px: { xs: 1, sm: 2 }, py: 1.5, bgcolor: "#202c33", display: "flex", flexDirection: "column", position: 'relative' }}>
      
      {/* Absolute floating Emoji Picker */}
      <EmojiPickerContainer isOpen={isOpen} pickerRef={pickerRef} onEmojiClick={handleEmojiClick} />
      
      {/* Reply/Edit Preview */}
      {(replyingTo || editingNote) && (
        <Fade in={!!(replyingTo || editingNote)}>
          <Box sx={{ 
            mb: 1, 
            p: 1.5, 
            bgcolor: "#2a3942", 
            borderRadius: 2, 
            borderLeft: "4px solid #00a884", 
            display: "flex", 
            justifyContent: "space-between", 
            alignItems: "center",
            mx: 1,
            position: "relative"
          }}>
            <Box sx={{ flex: 1, overflow: "hidden" }}>
              <Typography variant="caption" sx={{ color: "#00a884", fontWeight: 700, display: "block" }}>
                {editingNote ? "Editing Message" : "Replying to"}
              </Typography>
              <Typography variant="body2" noWrap sx={{ color: "#8696a0" }}>
                {editingNote ? ((editingNote.isEdited && editingNote.plaintextEdit) ? editingNote.plaintextEdit : editingNote.noteText) : (replyingTo?.attachments?.length > 0 ? "Photo/Video" : replyingTo?.noteText)}
              </Typography>
            </Box>
            <IconButton size="small" onClick={() => { setReplyingTo(null); setEditingNote(null); inputRef.current.value = ""; }} sx={{ color: "#aebac1" }}>
              <CloseIcon fontSize="small" />
            </IconButton>
          </Box>
        </Fade>
      )}
      
      <Box sx={{ display: "flex", alignItems: "flex-end", gap: 1 }}>
        <Box sx={{ 
          flex: 1, 
          display: "flex", 
          alignItems: "center", 
          bgcolor: "#2a3942", 
          borderRadius: 8, 
          px: 1, 
          py: 0.5
        }}>
        <IconButton ref={buttonRef} onClick={togglePicker} sx={{ color: "#aebac1" }}>
           <InsertEmoticonIcon />
        </IconButton>
        <IconButton 
          onClick={(e) => setAttachAnchor(e.currentTarget)} 
          sx={{ color: "#aebac1" }}
        >
          <AttachFileIcon />
        </IconButton>

        {/* WhatsApp-style Attachment Popover (Vertical) */}
        <Popover
          open={attachOpen}
          anchorEl={attachAnchor}
          onClose={() => setAttachAnchor(null)}
          anchorOrigin={{ vertical: 'top', horizontal: 'left' }}
          transformOrigin={{ vertical: 'bottom', horizontal: 'left' }}
          slotProps={{
            paper: {
              sx: {
                bgcolor: '#233138',
                borderRadius: 3,
                p: 1,
                boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
                minWidth: 160,
              }
            }
          }}
        >
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
            {ATTACH_OPTIONS.map(opt => (
              <Box
                key={opt.key}
                onClick={() => handleAttachOption(opt.key)}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 2,
                  p: 1,
                  borderRadius: 1.5,
                  cursor: 'pointer',
                  transition: '0.2s',
                  '&:hover': { bgcolor: '#2a3942' },
                  '&:hover .attach-icon-circle': { transform: 'scale(1.1)' },
                }}
              >
                <Box
                  className="attach-icon-circle"
                  sx={{
                    width: 36,
                    height: 36,
                    borderRadius: '50%',
                    bgcolor: opt.color,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transition: 'transform 0.15s ease',
                    flexShrink: 0
                  }}
                >
                  <opt.icon sx={{ color: '#fff', fontSize: 20 }} />
                </Box>
                <Typography variant="body2" sx={{ color: '#e9edef', fontWeight: 500 }}>
                  {opt.label}
                </Typography>
              </Box>
            ))}
          </Box>
        </Popover>

        <TextField 
          inputRef={inputRef} 
          multiline 
          maxRows={6} 
          placeholder="Type a message" 
          fullWidth 
          onKeyDown={handleKeyDown}
          variant="standard"
          InputProps={{ disableUnderline: true, sx: { px: 1, py: 1, fontSize: "0.95rem", color: "#e9edef" } }}
        />
    </Box>
    <IconButton 
      onClick={handleSend} 
      sx={{ 
        bgcolor: "#00a884", 
        color: "#fff", 
        "&:hover": { bgcolor: "#008f72" }, 
        width: 48, 
        height: 48,
        boxShadow: "0 1px 1px rgba(0,0,0,0.1)"
      }}
    >
      <SendIcon />
    </IconButton>
  </Box>
 </Box>
  );
}
