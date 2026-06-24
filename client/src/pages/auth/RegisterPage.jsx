import React, { useState, useMemo, useRef } from 'react';
import { Box, Paper, TextField, Button, Typography, CircularProgress, Link as MuiLink, Alert, LinearProgress, Collapse } from '@mui/material';
import { CheckCircle, RadioButtonUnchecked } from '@mui/icons-material';
import { Link, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { generateAndUploadKeys, clearLocalKeys } from '../../features/encryption/keyManager';
import PasswordField from '../../components/common/PasswordField';
import { generatePassword, getPasswordStrength } from '../../utils/passwordGenerator';

export default function RegisterPage() {
    const [formData, setFormData] = useState({ username: '', email: '', password: '', confirmPassword: '' });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null); // General error (alert)
    const [fieldErrors, setFieldErrors] = useState({}); // Specific field errors
    const [statusText, setStatusText] = useState("");
    const [focusedField, setFocusedField] = useState(null);
    const navigate = useNavigate();
    const scrollContainerRef = useRef(null);

    const handleChange = (e) => {
        setFormData({ ...formData, [e.target.name]: e.target.value });
        if (fieldErrors[e.target.name]) {
            setFieldErrors({ ...fieldErrors, [e.target.name]: null });
        }
    };

    const handleFocus = (name) => setFocusedField(name);
    const handleBlur = () => setFocusedField(null);

    const handleGeneratePassword = () => {
        const newPassword = generatePassword(16);
        setFormData({ ...formData, password: newPassword, confirmPassword: newPassword });
        setFieldErrors({ ...fieldErrors, password: null, confirmPassword: null });
    };

    const passwordRequirements = useMemo(() => {
        const p = formData.password || "";
        return [
            { label: "At least 8 characters", met: p.length >= 8 },
            { label: "At least one uppercase letter", met: /[A-Z]/.test(p) },
            { label: "At least one number", met: /[0-9]/.test(p) },
            { label: "At least one special character", met: /[^A-Za-z0-9]/.test(p) }
        ];
    }, [formData.password]);

    const passwordStrength = useMemo(() => {
        if (!formData.password) return 0;
        return getPasswordStrength(formData.password);
    }, [formData.password]);

    const getStrengthColor = (strength) => {
        switch (strength) {
            case 1: return '#f44336'; // Red
            case 2: return '#ffeb3b'; // Yellow
            case 3: return '#4caf50'; // Green
            case 4: return '#00bcd4'; // Cyan
            default: return '#2a3942';
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError(null);
        setFieldErrors({});

        const newFieldErrors = {};
        if (formData.password !== formData.confirmPassword) {
            newFieldErrors.confirmPassword = "Passwords do not match";
        }

        if (formData.password.length < 8) {
            newFieldErrors.password = "Password must be at least 8 characters long";
        }

        if (Object.keys(newFieldErrors).length > 0) {
            setFieldErrors(newFieldErrors);
            setError("Please fix the errors below");
            return;
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
            const serverMsg = err.response?.data?.message || "Registration failed";
            
            // Map server errors to fields if possible
            const lowerMsg = serverMsg.toLowerCase();
            if (lowerMsg.includes("email")) {
                setFieldErrors({ email: serverMsg });
            } else if (lowerMsg.includes("username")) {
                setFieldErrors({ username: serverMsg });
            } else if (lowerMsg.includes("password")) {
                setFieldErrors({ password: serverMsg });
            }
            
            setError(serverMsg);
            setLoading(false);
        }
    };

    return (
        <Box sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: '#111b21', color: '#e9edef', p: 2 }}>
            <Paper elevation={4} sx={{ width: '100%', maxWidth: 450, maxHeight: '90vh', bgcolor: '#202c33', color: '#e9edef', borderRadius: 3, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                {/* Header - Stays Fixed */}
                <Box sx={{ p: 3, pb: 2, borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                    <Box sx={{ display: 'flex', justifyContent: 'center', mb: 2 }}>
                        <img src="/chat_app.svg" alt="Waitz Logo" style={{ width: 44, height: 44 }} />
                    </Box>
                    <Typography variant="h5" sx={{ textAlign: 'center', mb: 0.5, fontWeight: 'bold' }}>
                        Join Limitless Notes
                    </Typography>
                    <Typography variant="body2" sx={{ textAlign: 'center', color: '#8696a0' }}>
                        End-to-End Encrypted Messaging
                    </Typography>
                </Box>

                {/* Scrollable Content Area */}
                <Box 
                    ref={scrollContainerRef}
                    sx={{ 
                        flex: 1, overflowY: 'auto', p: 3, pt: 2,
                        '&::-webkit-scrollbar': { width: '6px' },
                        '&::-webkit-scrollbar-track': { bgcolor: 'transparent' },
                        '&::-webkit-scrollbar-thumb': { bgcolor: '#2a3942', borderRadius: '10px' },
                        '&::-webkit-scrollbar-thumb:hover': { bgcolor: '#3b4a54' }
                    }}
                >
                    {error && <Alert severity="error" sx={{ mb: 2, bgcolor: 'rgba(211, 47, 47, 0.1)', color: '#ff8a80', '& .MuiAlert-message': { fontWeight: 500 } }}>{error}</Alert>}

                    <form onSubmit={handleSubmit}>
                        <TextField
                            fullWidth label="Username" name="username" variant="outlined" margin="normal" required
                            value={formData.username} onChange={handleChange}
                            error={Boolean(fieldErrors.username)}
                            helperText={fieldErrors.username}
                            InputLabelProps={{ style: { color: fieldErrors.username ? '#f44336' : '#8696a0' } }}
                            sx={{ mb: 2, input: { color: '#e9edef' }, '& .MuiOutlinedInput-root': { '& fieldset': { borderColor: fieldErrors.username ? '#f44336' : '#2a3942' }, '&:hover fieldset': { borderColor: '#00a884' }, '&.Mui-focused fieldset': { borderColor: '#00a884' } }, '& .MuiFormHelperText-root': { color: '#f44336', ml: 0 } }}
                        />
                        <TextField
                            fullWidth label="Email" name="email" type="email" variant="outlined" margin="normal" required
                            value={formData.email} onChange={handleChange}
                            error={Boolean(fieldErrors.email)}
                            helperText={fieldErrors.email}
                            InputLabelProps={{ style: { color: fieldErrors.email ? '#f44336' : '#8696a0' } }}
                            sx={{ mb: 2, input: { color: '#e9edef' }, '& .MuiOutlinedInput-root': { '& fieldset': { borderColor: fieldErrors.email ? '#f44336' : '#2a3942' }, '&:hover fieldset': { borderColor: '#00a884' }, '&.Mui-focused fieldset': { borderColor: '#00a884' } }, '& .MuiFormHelperText-root': { color: '#f44336', ml: 0 } }}
                        />
                        
                        <PasswordField
                            label="Password" name="password" required
                            value={formData.password} onChange={handleChange}
                            onFocus={() => handleFocus('password')}
                            onBlur={handleBlur}
                            error={Boolean(fieldErrors.password)}
                            helperText={fieldErrors.password}
                            sx={{ '& .MuiFormHelperText-root': { color: '#f44336', ml: 0 } }}
                        />

                        {/* Password Strength - Small, always shows if text exists */}
                        {formData.password && (
                            <Box sx={{ mt: 1, mb: 1.5 }}>
                                <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                                    <Typography variant="caption" sx={{ color: '#8696a0' }}>Strength</Typography>
                                    <Typography variant="caption" sx={{ color: getStrengthColor(passwordStrength) }}>
                                        {['Weak', 'Medium', 'Strong', 'Very Strong'][passwordStrength - 1]}
                                    </Typography>
                                </Box>
                                <LinearProgress 
                                    variant="determinate" 
                                    value={(passwordStrength / 4) * 100} 
                                    sx={{ 
                                        height: 3, borderRadius: 1, bgcolor: '#2a3942', mb: 1,
                                        '& .MuiLinearProgress-bar': { bgcolor: getStrengthColor(passwordStrength) }
                                    }} 
                                />
                                
                                {/* Dynamic Suggestion Checklist - Collapses when password field loses focus */}
                                <Collapse in={focusedField === 'password'}>
                                    <Box sx={{ bgcolor: 'rgba(255, 255, 255, 0.04)', borderRadius: 2, p: 2, mt: 1, border: '1px solid rgba(255,255,255,0.05)' }}>
                                        <Typography variant="caption" sx={{ color: '#8696a0', fontWeight: 'bold', display: 'block', mb: 1, fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Suggestions for a strong password:</Typography>
                                        {passwordRequirements.map((req, i) => (
                                            <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.8 }}>
                                                {req.met ? <CheckCircle sx={{ fontSize: 13, color: '#00a884' }} /> : <RadioButtonUnchecked sx={{ fontSize: 13, color: '#8696a0', opacity: 0.6 }} />}
                                                <Typography variant="caption" sx={{ color: req.met ? '#e9edef' : '#8696a0', fontSize: '0.75rem' }}>{req.label}</Typography>
                                            </Box>
                                        ))}
                                    </Box>
                                </Collapse>
                            </Box>
                        )}

                        <PasswordField
                            label="Confirm Password" name="confirmPassword" required
                            value={formData.confirmPassword} onChange={handleChange}
                            error={Boolean(fieldErrors.confirmPassword)}
                            helperText={fieldErrors.confirmPassword}
                            sx={{ '& .MuiFormHelperText-root': { color: '#f44336', ml: 0 } }}
                        />

                        <Button
                            fullWidth variant="text" size="small"
                            onClick={handleGeneratePassword}
                            sx={{ color: '#00a884', textTransform: 'none', mb: 2, mt: 1, justifyContent: 'flex-start', p: 0, '&:hover': { bgcolor: 'transparent', color: '#029072' } }}
                        >
                            Suggest a strong password
                        </Button>
                        
                        <Button
                            type="submit" fullWidth variant="contained"
                            disabled={loading}
                            sx={{ mb: 2.5, bgcolor: '#00a884', color: '#111b21', fontWeight: 'bold', py: 1.5, borderRadius: 2, textTransform: 'none', fontSize: '1rem', '&:hover': { bgcolor: '#029072' }, '&.Mui-disabled': { bgcolor: '#005c4b', color: '#8696a0' } }}
                        >
                            {loading ? <CircularProgress size={24} sx={{ color: '#00a884' }} /> : 'Register Securely'}
                        </Button>
                        
                        {loading && <Typography variant="caption" sx={{ display: 'block', textAlign: 'center', mb: 2, color: '#00a884' }}>{statusText}</Typography>}

                        <Typography variant="body2" sx={{ textAlign: 'center', color: '#8696a0', pb: 1 }}>
                            Already have an account?{' '}
                            <MuiLink component={Link} to="/login" sx={{ color: '#53bdeb', textDecoration: 'none', fontWeight: 500, '&:hover': { textDecoration: 'underline' } }}>
                                Log in
                            </MuiLink>
                        </Typography>
                    </form>
                </Box>
            </Paper>
        </Box>
    );
}
