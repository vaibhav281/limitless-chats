import React from 'react';
import { Box, Typography, Button } from '@mui/material';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("ErrorBoundary caught an error:", error, errorInfo);

    // TEMP: allow errors to surface
    if (import.meta.env.DEV || process.env.NODE_ENV === "development") {
      throw error;
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <Box sx={{ 
          p: 3, 
          display: 'flex', 
          flexDirection: 'column', 
          alignItems: 'center', 
          justifyContent: 'center',
          textAlign: 'center',
          height: '100%',
          bgcolor: '#111b21',
          color: '#e9edef'
        }}>
          <ErrorOutlineIcon sx={{ fontSize: 48, color: '#f15c6d', mb: 2 }} />
          <Typography variant="h6" gutterBottom>
            Something went wrong
          </Typography>
          <Typography variant="body2" sx={{ color: '#8696a0', mb: 3, maxWidth: 400 }}>
            The chat interface encountered an unexpected error. This has been logged and we're looking into it.
          </Typography>
          <Button 
            variant="contained" 
            onClick={() => window.location.reload()}
            sx={{ 
                bgcolor: '#00a884', 
                '&:hover': { bgcolor: '#008f6f' },
                textTransform: 'none',
                borderRadius: '24px',
                px: 4
            }}
          >
            Reload Chat
          </Button>
        </Box>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
