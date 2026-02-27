import React, { useEffect, useState } from 'react';
import { Link as RouterLink, useLocation, useNavigate } from 'react-router-dom';
import { clearLocalKeys } from '../features/encryption/keyManager';
import AppBar from '@mui/material/AppBar';
import Box from '@mui/material/Box';
import Toolbar from '@mui/material/Toolbar';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import MenuIcon from '@mui/icons-material/Menu';
import LogoutIcon from '@mui/icons-material/Logout';
import Drawer from '@mui/material/Drawer';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';
import Link from '@mui/material/Link';

const navItems = [
  { label: 'Daily Notes', to: '/daily-notes' },
  { label: 'Project', to: '/project' },
  { label: 'About', to: '/about' }
];

export default function Layout({ children }) {
  const [open, setOpen] = useState(false);
  const [username, setUsername] = useState("");
  const location = useLocation();
  const navigate = useNavigate();

  const handleLogout = async () => {
    localStorage.clear();
    sessionStorage.clear();
    await clearLocalKeys(); // Wipes IndexedDB Signal Store
    setUsername("");
    navigate('/');
    window.location.reload();
  };
  
  const isChatApp = ['/daily-notes', '/', '/login', '/register'].includes(location.pathname);

  useEffect(() => {
    // Basic polling or one-time check for username in navbar
    const checkName = () => {
      const stored = localStorage.getItem("username");
      if (stored && stored !== username) setUsername(stored);
    };
    checkName();
    const interval = setInterval(checkName, 2000);
    return () => clearInterval(interval);
  }, [username]);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100dvh', overflow: 'hidden' }}>
      {/* Top Navbar */}
      {!isChatApp && (
        <AppBar position="static">
          <Toolbar>
            <IconButton
              edge="start"
              color="inherit"
              aria-label="menu"
              onClick={() => setOpen(true)}
              sx={{ mr: 2, display: { sm: 'none' } }}
            >
              <MenuIcon />
            </IconButton>
            <Box sx={{ flexGrow: 1, display: 'flex', alignItems: 'center', gap: 2 }}>
               <Box sx={{ display: 'flex', alignItems: 'center' }}>
                 <img src="/chat_app.svg" alt="Logo" style={{ width: 28, height: 28, marginRight: 12 }} />
                 <Typography variant="h6">
                     Limitless Chats
                 </Typography>
               </Box>
               {username && (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Typography variant="subtitle2" sx={{ bgcolor: 'rgba(255,255,255,0.2)', px: 1.5, py: 0.5, borderRadius: 2, display: { xs: 'none', sm: 'block' } }}>
                       👤 {username}
                    </Typography>
                    <IconButton color="inherit" onClick={handleLogout} title="Sign Out & Clear Keys" size="small">
                       <LogoutIcon />
                    </IconButton>
                  </Box>
               )}
            </Box>
            <Box sx={{ display: { xs: 'none', sm: 'flex' }, alignItems: 'center' }}>
              {navItems.map(item => (
                <Link
                  key={item.to}
                  component={RouterLink}
                  to={item.to}
                  color="inherit"
                  underline="none"
                  sx={{ ml: 3 }}
                >
                  {item.label}
                </Link>
              ))}
            </Box>
          </Toolbar>
        </AppBar>
      )}

      {/* Sidebar Drawer (mobile) */}
      <Drawer open={open} onClose={() => setOpen(false)}>
        <Box sx={{ width: 240 }} role="presentation" onClick={() => setOpen(false)}>
          <List>
            {navItems.map(item => (
              <ListItem
                button
                key={item.to}
                component={RouterLink}
                to={item.to}
              >
                <ListItemText primary={item.label} />
              </ListItem>
            ))}
          </List>
        </Box>
      </Drawer>

      {/* Main content */}
      <Box
        component="main"
        sx={{
          flex: 1,
          mt: 0,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          bgcolor: '#e5ddd5' // WhatsApp background
        }}
      >
        {children}
      </Box>
    </Box>
  );
}
