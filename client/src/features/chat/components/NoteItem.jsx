import React from 'react';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import dayjs from 'dayjs';
import Box from '@mui/material/Box';

export default function NoteItem({ note }) {
  return (
    <Box sx={{ my: 1, display: 'flex', justifyContent: 'flex-start' }}>
      <Paper elevation={1} sx={{ p: 1.25, maxWidth: '78%' }}>
        <Typography variant="body1">{note.noteText}</Typography>
        
        {/* Attachments */}
        {note.attachments && note.attachments.length > 0 && (
          <Box sx={{ mt: 1, display: 'flex', flexWrap: 'wrap', gap: 1 }}>
            {note.attachments.map((att, index) => (
              <Box key={index} sx={{ maxWidth: '100%' }}>
                {att.type === 'video' ? (
                  <video src={`${import.meta.env.VITE_API_BASE.replace('/api/v1', '')}${att.url}`} controls style={{ maxWidth: '100%', borderRadius: 8 }} />
                ) : (
                  <img src={`${import.meta.env.VITE_API_BASE.replace('/api/v1', '')}${att.url}`} alt={att.originalName} style={{ maxWidth: '100%', borderRadius: 8 }} />
                )}
              </Box>
            ))}
          </Box>
        )}

        <Typography variant="caption" sx={{ display: 'block', mt: 0.5 }}>
          {dayjs(note.timestamp).format('D MMM YYYY, h:mm A')}
        </Typography>
      </Paper>
    </Box>
  );
}
