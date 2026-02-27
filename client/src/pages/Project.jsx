import React from 'react';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';

export default function Project() {
  return (
    <Box sx={{ maxWidth: 900, mx: 'auto' }}>
      <Paper sx={{ p: 3 }}>
        <Typography variant="h5">Project Details</Typography>
        <Typography sx={{ mt: 1 }}>Tech stack</Typography>
        <List>
          <ListItem><ListItemText primary="Frontend: React (Vite) + Material UI" /></ListItem>
          <ListItem><ListItemText primary="Backend: Node.js + Express" /></ListItem>
          <ListItem><ListItemText primary="Database: MongoDB (Mongoose)" /></ListItem>
        </List>

        <Typography variant="h6" sx={{ mt: 2 }}>Features</Typography>
        <List>
          <ListItem><ListItemText primary="Chat-like daily notes (grouped by day)" /></ListItem>
          <ListItem><ListItemText primary="Infinite scroll to load older notes" /></ListItem>
          <ListItem><ListItemText primary="API versioning: /api/v1/notes" /></ListItem>
        </List>

        <Typography variant="h6" sx={{ mt: 2 }}>Roadmap</Typography>
        <List>
          <ListItem><ListItemText primary="Authentication & multi-user support" /></ListItem>
          <ListItem><ListItemText primary="Real-time sync (WebSockets)" /></ListItem>
          <ListItem><ListItemText primary="Search, tags, export & export to PDF" /></ListItem>
        </List>
      </Paper>
    </Box>
  );
}
