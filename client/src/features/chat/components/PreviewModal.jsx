import React from 'react';
import { Box, Typography, IconButton, Button, Dialog, DialogTitle, DialogContent, DialogActions, TextField, CircularProgress } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import AddPhotoAlternateIcon from '@mui/icons-material/AddPhotoAlternate';
import AudioFileIcon from '@mui/icons-material/AudioFile';
import InsertDriveFileIcon from '@mui/icons-material/InsertDriveFile';

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
      <DialogContent>
        <Box sx={{ display: 'flex', gap: 1, overflowX: 'auto', mb: 2, py: 1 }}>
          {previewFiles.map((pf, index) => (
            <Box key={index} sx={{ position: 'relative', flexShrink: 0 }}>
              {pf.type === 'video' ? (
                 <video src={pf.url} style={{ width: 120, height: 120, objectFit: 'cover', borderRadius: 8, backgroundColor: '#000' }} />
              ) : pf.type === 'audio' ? (
                 <Box sx={{ width: 120, height: 120, bgcolor: "#f0f0f0", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", borderRadius: 8 }}>
                    <AudioFileIcon sx={{ fontSize: 40, color: "#666" }} />
                    <Typography variant="caption" noWrap sx={{ maxWidth: "90%", mt: 1 }}>{pf.origName}</Typography>
                 </Box>
              ) : (pf.type === 'document' || pf.type === 'archive') ? (
                 <Box sx={{ width: 120, height: 120, bgcolor: "#f0f0f0", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", borderRadius: 8 }}>
                    {pf.type==='document' ? <InsertDriveFileIcon sx={{ fontSize: 40, color: "#666" }} /> : <InsertDriveFileIcon sx={{ fontSize: 40, color: "#666" }} />}
                    <Typography variant="caption" noWrap sx={{ maxWidth: "90%", mt: 1 }}>{pf.origName}</Typography>
                 </Box>
              ) : (
                   <img src={pf.url} alt="preview" style={{ width: 120, height: 120, objectFit: 'cover', borderRadius: 8, backgroundColor: '#f0f0f0' }} />
                )}
                <IconButton 
                  size="small" 
                  onClick={() => handleRemovePreview(index)}
                  sx={{ position: 'absolute', top: 4, right: 4, bgcolor: 'rgba(255,255,255,0.8)', "&:hover": {bgcolor: "#fff"} }}
                >
                  <CloseIcon fontSize="small" />
                </IconButton>
              </Box>
            ))}
            <Box sx={{ 
                minWidth: 120, 
                height: 120, 
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
               <AddPhotoAlternateIcon sx={{ color: "#aebac1", fontSize: 40 }} />
               <Typography variant="caption" sx={{ color: "#aebac1" }}>Add more</Typography>
            </Box>
          </Box>
        <TextField
          autoFocus
          margin="dense"
          placeholder="Add a caption..."
          fullWidth
          variant="outlined"
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendAttachments(); }
          }}
          sx={{ "& .MuiOutlinedInput-root": { borderRadius: 3 } }}
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
