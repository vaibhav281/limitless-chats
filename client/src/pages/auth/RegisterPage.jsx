import React, { useState } from 'react';
import { Box, Paper, TextField, Button, Typography, CircularProgress, Link as MuiLink, Alert } from '@mui/material';
import { Link, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { generateAndUploadKeys, clearLocalKeys } from '../../features/encryption/keyManager';

export default function RegisterPage() {
    const [formData, setFormData] = useState({ username: '', email: '', password: '', confirmPassword: '' });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [statusText, setStatusText] = useState("");
    const navigate = useNavigate();

    const handleChange = (e) => setFormData({ ...formData, [e.target.name]: e.target.value });

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError(null);

        if (formData.password !== formData.confirmPassword) {
            return setError("Passwords do not match");
        }

        setLoading(true);
        setStatusText("Creating account...");

        try {
            // 1. Create User
            const { data } = await axios.post('/api/v1/auth/register', {
                username: formData.username,
                email: formData.email,
                password: formData.password
            });

            const userId = data.user._id;
            
            // Clean slate any old local keys before generating new ones securely
            await clearLocalKeys();
            localStorage.removeItem('e2eeVaultOwner');

            // 2. Generate and Upload Signal E2EE Keys
            setStatusText("Generating secure E2EE keys... (Do not close tab)");
            await generateAndUploadKeys(userId);

            // 3. Request JWT Token now that keys are active
            setStatusText("Finalizing secure session...");
            const tokenRes = await axios.post('/api/v1/auth/token', { userId });
            
            // 4. Save session natively
            localStorage.setItem('token', tokenRes.data.token);
            localStorage.setItem('userId', userId);
            localStorage.setItem('username', data.user.username);

            // 5. Redirect to Chat
            window.location.href = '/daily-notes';

        } catch (err) {
            console.error(err);
            setError(err.response?.data?.message || "Registration failed. Please try again.");
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
                    Join Limitless Notes
                </Typography>
                <Typography variant="body2" sx={{ textAlign: 'center', mb: 3, color: '#8696a0' }}>
                    End-to-End Encrypted Messaging
                </Typography>

                {error && <Alert severity="error" sx={{ mb: 2, bgcolor: 'rgba(211, 47, 47, 0.1)', color: '#ff8a80' }}>{error}</Alert>}

                <form onSubmit={handleSubmit}>
                    <TextField
                        fullWidth label="Username" name="username" variant="outlined" margin="normal" required
                        value={formData.username} onChange={handleChange}
                        InputLabelProps={{ style: { color: '#8696a0' } }}
                        sx={{ input: { color: '#e9edef' }, '& .MuiOutlinedInput-root': { '& fieldset': { borderColor: '#2a3942' }, '&:hover fieldset': { borderColor: '#00a884' }, '&.Mui-focused fieldset': { borderColor: '#00a884' } } }}
                    />
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
                    <TextField
                        fullWidth label="Confirm Password" name="confirmPassword" type="password" variant="outlined" margin="normal" required
                        value={formData.confirmPassword} onChange={handleChange}
                        InputLabelProps={{ style: { color: '#8696a0' } }}
                        sx={{ input: { color: '#e9edef' }, '& .MuiOutlinedInput-root': { '& fieldset': { borderColor: '#2a3942' }, '&:hover fieldset': { borderColor: '#00a884' }, '&.Mui-focused fieldset': { borderColor: '#00a884' } } }}
                    />
                    
                    <Button
                        type="submit" fullWidth variant="contained"
                        disabled={loading}
                        sx={{ mt: 3, mb: 2, bgcolor: '#00a884', color: '#111b21', fontWeight: 'bold', py: 1.5, '&:hover': { bgcolor: '#029072' }, '&.Mui-disabled': { bgcolor: '#005c4b', color: '#8696a0' } }}
                    >
                        {loading ? <CircularProgress size={24} sx={{ color: '#00a884' }} /> : 'Register Securely'}
                    </Button>
                    
                    {loading && <Typography variant="caption" sx={{ display: 'block', textAlign: 'center', mb: 2, color: '#00a884' }}>{statusText}</Typography>}

                    <Typography variant="body2" sx={{ textAlign: 'center', color: '#8696a0' }}>
                        Already have an account?{' '}
                        <MuiLink component={Link} to="/login" sx={{ color: '#53bdeb', textDecoration: 'none', '&:hover': { textDecoration: 'underline' } }}>
                            Log in
                        </MuiLink>
                    </Typography>
                </form>
            </Paper>
        </Box>
    );
}
