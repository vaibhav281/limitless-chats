import React from 'react';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';

export default function About() {
  return (
    <Box sx={{ maxWidth: 900, mx: 'auto' }}>
      <Paper sx={{ p: 3 }}>
        <Typography variant="h5">About</Typography>
        <Typography sx={{ mt: 1 }}>
          Limitless Notes is a lightweight, scalable notes app built with React + MUI, Node + Express and MongoDB.
        </Typography>
        <Typography sx={{ mt: 2 }}>
          Mission: Provide a fast, chat-like daily note-taking experience with a minimal UI and a scalable backend.
        </Typography>
      </Paper>
    </Box>
  );
}
