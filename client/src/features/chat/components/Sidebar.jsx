import React, { useMemo } from 'react';
import { Box, Typography, Avatar, Badge, IconButton, Tooltip } from '@mui/material';
import PhotoIcon from '@mui/icons-material/Photo';
import VideocamIcon from '@mui/icons-material/Videocam';
import InsertDriveFileIcon from '@mui/icons-material/InsertDriveFile';
import AudiotrackIcon from '@mui/icons-material/Audiotrack';
import LogoutIcon from '@mui/icons-material/Logout';
import { useNavigate } from 'react-router-dom';
import { clearLocalKeys } from '../../encryption/keyManager';
import dayjs from "dayjs";
import isToday from "dayjs/plugin/isToday";
import isYesterday from "dayjs/plugin/isYesterday";
dayjs.extend(isToday);
dayjs.extend(isYesterday);

export default function Sidebar({ chatWithId, setChatWithId, activeUsers, userId, unreadCounts = {}, conversations = [] }) {
  const navigate = useNavigate();
  const username = localStorage.getItem("username") || "User";

  const handleLogout = async () => {
    localStorage.clear();
    sessionStorage.clear();
    await clearLocalKeys();
    navigate('/login');
    window.location.reload();
  };

  // Format Timestamp
  const formatTime = (timestamp) => {
    if (!timestamp) return "";
    const date = dayjs(timestamp);
    if (date.isToday()) return date.format("h:mm a");
    if (date.isYesterday()) return "Yesterday";
    return date.format("DD/MM/YYYY");
  };

  // Generate Message Preview
  const renderPreview = (lastMessage, isGroup) => {
    if (!lastMessage) return null;

    if (lastMessage.isDeletedForEveryone || lastMessage.isDeletedForMe || lastMessage.isDeleted) {
       return (
         <Typography variant="body2" sx={{ color: "#8696a0", mt: 0.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontStyle: 'italic', display: 'flex', alignItems: 'center' }}>
           🚫 This message was deleted
         </Typography>
       );
    }

    let prefix = null;
    if (isGroup && lastMessage.senderId !== userId) {
      prefix = <span style={{ color: "#aebac1" }}>{lastMessage.senderName}: </span>;
    } else if (lastMessage.senderId === userId) {
      prefix = <span style={{ color: "#aebac1" }}>You: </span>;
    }

    if (lastMessage.isEdited) {
       // Optional: Add edited flag if desired, but standard WhatsApp often hides it in preview
    }

    if (lastMessage.attachments && lastMessage.attachments.length > 0) {
      const type = lastMessage.attachments[0].type;
      let icon = <InsertDriveFileIcon sx={{ fontSize: 16, mr: 0.5, verticalAlign: "middle" }} />;
      let text = "File";
      if (type === "image") { icon = <PhotoIcon sx={{ fontSize: 16, mr: 0.5, verticalAlign: "middle" }} />; text = "Photo"; }
      if (type === "video") { icon = <VideocamIcon sx={{ fontSize: 16, mr: 0.5, verticalAlign: "middle" }} />; text = "Video"; }
      if (type === "audio") { icon = <AudiotrackIcon sx={{ fontSize: 16, mr: 0.5, verticalAlign: "middle" }} />; text = "Audio"; }
      
      const countText = lastMessage.attachments.length > 1 ? ` (${lastMessage.attachments.length})` : "";
      
      return (
        <Typography variant="body2" sx={{ display: 'flex', alignItems: 'center', color: "#8696a0", mt: 0.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {prefix}{icon}{text}{countText} {lastMessage.noteText ? ` - ${lastMessage.noteText}` : ""}
        </Typography>
      );
    }

    if (!lastMessage.noteText && (!lastMessage.attachments || lastMessage.attachments.length === 0)) {
        return (
          <Typography variant="body2" sx={{ color: "#8696a0", mt: 0.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontStyle: 'italic', display: 'flex', alignItems: 'center' }}>
            🚫 This message was deleted
          </Typography>
        );
    }

    return (
       <Typography variant="body2" sx={{ color: "#8696a0", mt: 0.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
         {prefix}{lastMessage.noteText}
       </Typography>
    );
  };

  // Merge active socket users with historical conversations
  const displayChats = useMemo(() => {
    const chatMap = new Map();

    // 1. First add historical conversations from the DB
    conversations.forEach(c => {
       if (c.partnerId === "global_group") return; // Keep global separate
       chatMap.set(c.partnerId, {
           userId: c.partnerId,
           username: c.partnerName || c.partnerId,
           isGroup: c.isGroup,
           lastMessage: c.lastMessage,
           updatedAt: c.updatedAt,
           isOnline: false // By default offline
       });
    });

    // 2. Overwrite/Patch with Socket Active Users (which gives us live usernames)
    activeUsers.forEach(u => {
       if (u.userId === userId) return;
       if (chatMap.has(u.userId)) {
           // We have history, just patch the real username and set online
           chatMap.set(u.userId, { ...chatMap.get(u.userId), username: u.username, isOnline: true });
       } else {
           // Brand new active user with zero history
           chatMap.set(u.userId, {
               userId: u.userId,
               username: u.username,
               isGroup: false,
               lastMessage: null,
               updatedAt: new Date(0).toISOString(), // Sort to bottom if no messages
               isOnline: true
           });
       }
    });

    // 3. Convert back to array and Sort
    return Array.from(chatMap.values()).sort((a, b) => {
        // Unread sorting
        const unreadA = unreadCounts[a.userId] || 0;
        const unreadB = unreadCounts[b.userId] || 0;
        if (unreadA > 0 && unreadB === 0) return -1;
        if (unreadB > 0 && unreadA === 0) return 1;

        // Timestamp sorting (Newest first)
        const timeA = new Date(a.updatedAt).getTime();
        const timeB = new Date(b.updatedAt).getTime();
        if (timeA !== timeB) return timeB - timeA;

        // Fallback alphabetical
        return a.username.localeCompare(b.username);
    });

  }, [conversations, activeUsers, unreadCounts, userId]);

  const globalConv = conversations.find(c => c.partnerId === "global_group" || c.isGroup);
  return (
    <Box sx={{ 
      width: { xs: chatWithId ? 0 : "100%", sm: 320 }, 
      display: { xs: chatWithId ? "none" : "flex", sm: "flex" }, 
      flexDirection: "column", 
      borderRight: "1px solid rgba(255,255,255,0.1)",
      bgcolor: "#111b21",
     
    }}>
       {/* App Branding Header */}
       <Box sx={{ px: 2, py: 1.5, display: 'flex', alignItems: 'center', bgcolor: "#111b21" }}>
          <Box sx={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
            <img src="/chat_app.svg" alt="Limitless Chats Logo" style={{ width: 26, height: 26, marginRight: 12 }} />
            <Typography variant="subtitle1" sx={{ fontWeight: 600, color: "#e9edef", fontSize: '1.05rem' }}>Limitless Chats</Typography>
          </Box>
       </Box>

       {/* Chats Header and Actions */}
       <Box sx={{ px: 2, py: 1, minHeight: 60, display: 'flex', alignItems: 'center', justifyContent: 'space-between', bgcolor: "#111b21", boxSizing: "border-box" }}>
          <Typography variant="h5" sx={{ fontWeight: 700, color: "#e9edef" }}>Chats</Typography>
       </Box>
       <Box sx={{ flex: 1, overflowY: "auto", bgcolor: "#111b21", p: 0 }}>
          {/* Global Chat Item */}
          <Box 
            onClick={() => setChatWithId("global_group")}
            sx={{ 
              display: 'flex', alignItems: 'center', p: 2, 
              borderBottom: "1px solid rgba(255,255,255,0.05)", cursor: "pointer",
              bgcolor: chatWithId === "global_group" ? "#2a3942" : "transparent",
              "&:hover": { bgcolor: "#202c33" },
              justifyContent: 'space-between'
            }}>
              <Box sx={{ display: 'flex', alignItems: 'center', flex: 1, overflow: 'hidden' }}>
                 <Avatar src="/chat_app.svg" sx={{ bgcolor: "transparent", mr: 2, flexShrink: 0, '& img': { objectFit: 'contain' } }} />
                 <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                       <Typography sx={{ fontWeight: unreadCounts?.['global_group'] > 0 ? 600 : 500, color: "#e9edef" }}>
                          Global Chat
                       </Typography>
                       {globalConv?.updatedAt && (
                          <Typography sx={{ fontSize: '0.75rem', color: unreadCounts?.['global_group'] > 0 ? '#00a884' : '#8696a0', ml: 1 }}>
                             {formatTime(globalConv.updatedAt)}
                          </Typography>
                       )}
                    </Box>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mt: 0.5 }}>
                       <Box sx={{ flex: 1, overflow: 'hidden', pr: 1 }}>
                          {globalConv?.lastMessage ? renderPreview(globalConv.lastMessage, true) : (
                             <Typography variant="body2" sx={{ color: "#8696a0", fontStyle: "italic" }}>No messages yet</Typography>
                          )}
                       </Box>
                       
                       {/* WhatsApp-style Unread Badge for Global */}
                       {unreadCounts?.['global_group'] > 0 && (
                          <Box sx={{ 
                             minWidth: 22, height: 22, borderRadius: '11px', bgcolor: '#00a884', 
                             display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                             px: unreadCounts?.['global_group'] > 9 ? 1 : 0
                          }}>
                             <Typography sx={{ color: '#111b21', fontSize: '0.75rem', fontWeight: 600 }}>
                                {unreadCounts['global_group'] > 99 ? '99+' : unreadCounts['global_group']}
                             </Typography>
                          </Box>
                       )}
                    </Box>
                 </Box>
              </Box>
          </Box>

          {/* Individual Users */}
          {displayChats.map(u => (
              <Box 
                key={u.userId} 
                onClick={() => setChatWithId(u.userId)}
                sx={{ 
                  display: 'flex', alignItems: 'center', p: 2, 
                  borderBottom: "1px solid rgba(255,255,255,0.05)", cursor: "pointer",
                  bgcolor: chatWithId === u.userId ? "#2a3942" : "transparent",
                  "&:hover": { bgcolor: "#202c33" },
                  justifyContent: 'space-between'
                }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', flex: 1, overflow: 'hidden' }}>
                    <Badge
                      overlap="circular"
                      anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
                      variant="dot"
                      sx={{
                        mr: 2,
                        '& .MuiBadge-badge': {
                          backgroundColor: u.isOnline ? '#00a884' : '#8696a0',
                          color: u.isOnline ? '#00a884' : '#8696a0',
                          boxShadow: `0 0 0 2px #111b21`,
                          width: 10, height: 10, borderRadius: '50%'
                        }
                      }}
                    >
                      <Avatar sx={{ bgcolor: "#00a884", flexShrink: 0 }}>{u.username.charAt(0).toUpperCase()}</Avatar>
                    </Badge>
                    <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
                       <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <Typography sx={{ fontWeight: unreadCounts[u.userId] > 0 ? 600 : 500, color: "#e9edef", wordBreak: "break-word", overflowWrap: "anywhere", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                             {u.username}
                          </Typography>
                          {u.updatedAt && new Date(u.updatedAt).getTime() > 0 && (
                             <Typography sx={{ fontSize: '0.75rem', color: unreadCounts[u.userId] > 0 ? '#00a884' : '#8696a0', ml: 1, flexShrink: 0 }}>
                                {formatTime(u.updatedAt)}
                             </Typography>
                          )}
                       </Box>
                       <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mt: 0.5 }}>
                          <Box sx={{ flex: 1, overflow: 'hidden', pr: 1 }}>
                             {u.lastMessage ? renderPreview(u.lastMessage, false) : (
                                <Typography variant="body2" sx={{ color: "#8696a0", fontStyle: "italic" }}>No messages yet</Typography>
                             )}
                          </Box>
                          
                          {/* WhatsApp-style Unread Badge */}
                          {unreadCounts[u.userId] > 0 && (
                             <Box sx={{ 
                                minWidth: 22, height: 22, borderRadius: '11px', bgcolor: '#00a884', 
                                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                                px: unreadCounts[u.userId] > 9 ? 1 : 0
                             }}>
                                <Typography sx={{ color: '#111b21', fontSize: '0.75rem', fontWeight: 600 }}>
                                   {unreadCounts[u.userId] > 99 ? '99+' : unreadCounts[u.userId]}
                                </Typography>
                             </Box>
                          )}
                       </Box>
                    </Box>
                  </Box>
              </Box>
          ))}
          {displayChats.length === 0 && (
              <Typography sx={{ p: 3, textAlign: "center", color: "#8696a0" }}>No offline history and no other users online right now.</Typography>
          )}
       </Box>

       {/* Clean Logout / Profile Footer */}
       <Box sx={{ 
          p: 2, 
          bgcolor: "#202c33", 
          borderTop: "1px solid rgba(255,255,255,0.05)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexShrink: 0
       }}>
          <Box sx={{ display: 'flex', alignItems: 'center' }}>
             <Avatar sx={{ bgcolor: "#00a884", mr: 1.5, width: 38, height: 38, color: '#111b21', fontWeight: 'bold' }}>
                {username.charAt(0).toUpperCase()}
             </Avatar>
             <Box>
                 <Typography sx={{ color: "#e9edef", fontSize: '0.95rem', fontWeight: 500, lineHeight: 1.2 }}>
                    {username}
                 </Typography>
                 <Typography sx={{ color: "#00a884", fontSize: '0.8rem', mt: 0.3 }}>
                    Online・Secure
                 </Typography>
             </Box>
          </Box>
          <Tooltip title="Log Out & Clear Keys" placement="top">
             <IconButton onClick={handleLogout} sx={{ color: "#aebac1", transition: '0.2s', '&:hover': { color: '#f15c6d', bgcolor: 'rgba(241,92,109,0.1)', transform: 'scale(1.1)' } }}>
                <LogoutIcon fontSize="small" />
             </IconButton>
          </Tooltip>
       </Box>
    </Box>
  );
}
