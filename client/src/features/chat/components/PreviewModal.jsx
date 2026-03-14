import React from 'react';
import { Box, Typography, IconButton, Button, Dialog, DialogTitle, DialogContent, DialogActions, TextField, CircularProgress } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import AddPhotoAlternateIcon from '@mui/icons-material/AddPhotoAlternate';
import AudioFileIcon from '@mui/icons-material/AudioFile';
import InsertDriveFileIcon from '@mui/icons-material/InsertDriveFile';

const PreviewItem = React.memo(({ pf, onRemove }) => {
  return (
    <Box sx={{ position: 'relative', flexShrink: 0, width: 120, height: 120 }}>
      {pf.type === 'video' ? (
         <video src={pf.url} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 8, backgroundColor: '#000' }} />
      ) : pf.type === 'audio' ? (
         <Box sx={{ width: '100%', height: '100%', bgcolor: "#2a3942", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", borderRadius: 8 }}>
            <AudioFileIcon sx={{ fontSize: 40, color: "#00a884" }} />
            <Typography variant="caption" noWrap sx={{ maxWidth: "90%", mt: 1, color: "#e9edef" }}>{pf.origName}</Typography>
         </Box>
      ) : (pf.type === 'document' || pf.type === 'archive') ? (
         <Box sx={{ width: '100%', height: '100%', bgcolor: "#2a3942", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", borderRadius: 8 }}>
            <InsertDriveFileIcon sx={{ fontSize: 40, color: "#8696a0" }} />
            <Typography variant="caption" noWrap sx={{ maxWidth: "90%", mt: 1, color: "#e9edef" }}>{pf.origName}</Typography>
         </Box>
      ) : (
         <img src={pf.url} alt="preview" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 8, backgroundColor: '#2a3942' }} />
      )}
      <IconButton 
        size="small" 
        onClick={onRemove}
        sx={{ position: 'absolute', top: 4, right: 4, bgcolor: 'rgba(0,0,0,0.5)', color: "#fff", "&:hover": { bgcolor: "rgba(255,255,255,0.9)", color: "#000" } }}
      >
        <CloseIcon fontSize="small" />
      </IconButton>
    </Box>
  );
});

export default function PreviewModal({ 
  openPreview, 
  setOpenPreview, 
  previewFiles, 
  handleRemovePreview, 
  fileInputRef,
  caption,
  setCaption,
  handleSendAttachments,
  isUploading
}) {
  return (
    <Dialog open={openPreview} onClose={() => setOpenPreview(false)} fullWidth maxWidth="sm">
      <DialogTitle sx={{ pb: 1 }}>Preview</DialogTitle>
      <DialogContent sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Box sx={{ 
            display: 'flex', gap: 2, overflowX: 'auto', pb: 2, pt: 1, width: "100%",
            '&::-webkit-scrollbar': { height: 8 }, 
            '&::-webkit-scrollbar-thumb': { bgcolor: '#8696a0', borderRadius: 4 },
            '&::-webkit-scrollbar-track': { bgcolor: 'rgba(255,255,255,0.05)', borderRadius: 4 } 
        }}>
          {previewFiles.map((pf, index) => (
            <PreviewItem 
                key={pf.url} 
                pf={pf} 
                onRemove={() => handleRemovePreview(index)} 
            />
          ))}
          <Box sx={{ 
              minWidth: 120, 
              width: 120,
              height: 120, 
              flexShrink: 0,
              borderRadius: 2, 
              border: "2px dashed #aebac1", 
              display: "flex", 
              flexDirection: "column",
              alignItems: "center", 
              justifyContent: "center", 
              cursor: "pointer",
              "&:hover": { bgcolor: "rgba(255,255,255,0.05)", borderColor: "#e9edef" }
            }}
            onClick={() => fileInputRef.current.click()}
          >
             <AddPhotoAlternateIcon sx={{ color: "#aebac1", fontSize: 40, mb: 1 }} />
             <Typography variant="caption" sx={{ color: "#aebac1", fontWeight: 500 }}>Add more</Typography>
          </Box>
        </Box>
        <TextField
          autoFocus
          margin="none"
          placeholder="Add a caption..."
          fullWidth
          variant="outlined"
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendAttachments(); }
          }}
          sx={{ 
            "& .MuiOutlinedInput-root": { borderRadius: 3, bgcolor: '#202c33', color: '#e9edef' },
            "& .MuiOutlinedInput-notchedOutline": { borderColor: '#202c33' },
            "&:hover .MuiOutlinedInput-notchedOutline": { borderColor: '#2a3942' },
          }}
        />
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={() => setOpenPreview(false)} color="inherit" disabled={isUploading}>Cancel</Button>
        <Button onClick={handleSendAttachments} variant="contained" disabled={isUploading} sx={{ bgcolor: "#00a884", borderRadius: 4, px: 3, "&:hover": {bgcolor: "#008f72"} }}>
          {isUploading ? <CircularProgress size={24} color="inherit" /> : "Send"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
