import React, { useState } from 'react';
import { Box, Paper, TextField, Button, Typography, CircularProgress, Link as MuiLink, Alert } from '@mui/material';
import { Link, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { generateAndUploadKeys, signalStore } from '../../features/encryption/keyManager';

export default function LoginPage() {
    const [formData, setFormData] = useState({ email: '', password: '' });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [statusText, setStatusText] = useState("");
    const navigate = useNavigate();

    const handleChange = (e) => setFormData({ ...formData, [e.target.name]: e.target.value });

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError(null);
        setLoading(true);
        setStatusText("Authenticating...");

        try {
            // 1. Authenticate with backend
            const { data } = await axios.post('/api/v1/auth/login', formData);
            const { token, user } = data;

            // Save basic auth locally so we can use it to fetch keys if needed
            localStorage.setItem('token', token);
            localStorage.setItem('userId', user._id);
            localStorage.setItem('username', user.username);

            // Set axios bearer for subsequent E2EE Key upload if required
            axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;

            // 2. Ensure Local E2EE Identity Exists and belongs to this user
            setStatusText("Verifying encryption engine...");
            await generateAndUploadKeys(user._id);

            // 3. Enter application
            window.location.href = '/daily-notes';

        } catch (err) {
            console.error(err);
            setError(err.response?.data?.message || "Invalid credentials. Please try again.");
            setLoading(false);
        }
    };

    return (
        <Box sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: '#111b21', color: '#e9edef' }}>
            <Paper elevation={4} sx={{ p: 4, width: '100%', maxWidth: 400, bgcolor: '#202c33', color: '#e9edef', borderRadius: 2 }}>
                <Box sx={{ display: 'flex', justifyContent: 'center', mb: 3 }}>
                    <img src="/chat_app.svg" alt="Waitz Logo" style={{ width: 48, height: 48 }} />
                </Box>
                <Typography variant="h5" sx={{ textAlign: 'center', mb: 1, fontWeight: 'bold' }}>
                    Welcome back
                </Typography>
                <Typography variant="body2" sx={{ textAlign: 'center', mb: 3, color: '#8696a0' }}>
                    Log in to Limitless Notes
                </Typography>

                {error && <Alert severity="error" sx={{ mb: 2, bgcolor: 'rgba(211, 47, 47, 0.1)', color: '#ff8a80' }}>{error}</Alert>}

                <form onSubmit={handleSubmit}>
                    <TextField
                        fullWidth label="Email" name="email" type="email" variant="outlined" margin="normal" required
                        value={formData.email} onChange={handleChange}
                        InputLabelProps={{ style: { color: '#8696a0' } }}
                        sx={{ input: { color: '#e9edef' }, '& .MuiOutlinedInput-root': { '& fieldset': { borderColor: '#2a3942' }, '&:hover fieldset': { borderColor: '#00a884' }, '&.Mui-focused fieldset': { borderColor: '#00a884' } } }}
                    />
                    <TextField
                        fullWidth label="Password" name="password" type="password" variant="outlined" margin="normal" required
                        value={formData.password} onChange={handleChange}
                        InputLabelProps={{ style: { color: '#8696a0' } }}
                        sx={{ input: { color: '#e9edef' }, '& .MuiOutlinedInput-root': { '& fieldset': { borderColor: '#2a3942' }, '&:hover fieldset': { borderColor: '#00a884' }, '&.Mui-focused fieldset': { borderColor: '#00a884' } } }}
                    />
                    
                    <Button
                        type="submit" fullWidth variant="contained"
                        disabled={loading}
                        sx={{ mt: 3, mb: 2, bgcolor: '#00a884', color: '#111b21', fontWeight: 'bold', py: 1.5, '&:hover': { bgcolor: '#029072' }, '&.Mui-disabled': { bgcolor: '#005c4b', color: '#8696a0' } }}
                    >
                        {loading ? <CircularProgress size={24} sx={{ color: '#00a884' }} /> : 'Log In Securely'}
                    </Button>
                    
                    {loading && <Typography variant="caption" sx={{ display: 'block', textAlign: 'center', mb: 2, color: '#00a884' }}>{statusText}</Typography>}

                    <Typography variant="body2" sx={{ textAlign: 'center', color: '#8696a0' }}>
                        Don't have an account?{' '}
                        <MuiLink component={Link} to="/register" sx={{ color: '#53bdeb', textDecoration: 'none', '&:hover': { textDecoration: 'underline' } }}>
                            Register now
                        </MuiLink>
                    </Typography>
                </form>
            </Paper>
        </Box>
    );
}
