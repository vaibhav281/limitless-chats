import React from 'react';
import { Box, Typography, Avatar, IconButton, Badge } from '@mui/material';
import KeyboardArrowLeftIcon from '@mui/icons-material/KeyboardArrowLeft';

const ChatHeader = React.memo(function ChatHeader({ chatWithId, setChatWithId, activeUsers, conversations = [] }) {
  if (!chatWithId) return null;

  let displayName = activeUsers.find(u => u.userId === chatWithId)?.username;
  if (!displayName) {
    const conv = conversations.find(c => c.partnerId === chatWithId);
    if (conv) displayName = conv.partnerName || conv.partnerId;
  }

  return (
    <Box sx={{ px: 2, py: 1, minHeight: 64, maxHeight: 64, boxSizing: "border-box", bgcolor: "#202c33", display: "flex", alignItems: "center", borderBottom: "1px solid rgba(255,255,255,0.1)" }}>
        <IconButton sx={{ display: { sm: "none" }, mr: 1, color: "#aebac1" }} onClick={() => setChatWithId(null)}>
            <KeyboardArrowLeftIcon />
        </IconButton>
        <Badge
          overlap="circular"
          anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
          variant="dot"
          sx={{
            mr: 2,
            '& .MuiBadge-badge': {
              backgroundColor: activeUsers.some(u => u.userId === chatWithId) ? '#00a884' : '#8696a0',
              color: activeUsers.some(u => u.userId === chatWithId) ? '#00a884' : '#8696a0',
              boxShadow: `0 0 0 2px #202c33`,
              width: 12, height: 12, borderRadius: '50%',
              display: chatWithId === "global_group" ? 'none' : 'flex'
            }
          }}
        >
          <Avatar sx={{ width: 36, height: 36, bgcolor: chatWithId === "global_group" ? "#005c4b" : "#00a884" }}>
             {chatWithId === "global_group" ? "G" : (displayName ? displayName.charAt(0).toUpperCase() : "?")}
          </Avatar>
        </Badge>
        <Typography sx={{ fontWeight: 500, color: "#e9edef" }}>
           {chatWithId === "global_group" ? "Global Chat" : (displayName || "Unknown")}
        </Typography>
    </Box>
  );
});

export default ChatHeader;
