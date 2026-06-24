import React, { useState } from 'react';
import { TextField, InputAdornment, IconButton } from '@mui/material';
import { Visibility, VisibilityOff } from '@mui/icons-material';

const PasswordField = ({ label, name, value, onChange, required = false, fullWidth = true, margin = "normal", sx = {}, ...props }) => {
    const [showPassword, setShowPassword] = useState(false);

    const handleClickShowPassword = () => setShowPassword(!showPassword);
    const handleMouseDownPassword = (event) => event.preventDefault();

    return (
        <TextField
            {...props}
            fullWidth={fullWidth}
            label={label}
            name={name}
            type={showPassword ? 'text' : 'password'}
            variant="outlined"
            margin={margin}
            required={required}
            value={value}
            onChange={onChange}
            InputLabelProps={{ style: { color: '#8696a0' } }}
            sx={{
                input: { color: '#e9edef' },
                '& .MuiOutlinedInput-root': {
                    '& fieldset': { borderColor: '#2a3942' },
                    '&:hover fieldset': { borderColor: '#00a884' },
                    '&.Mui-focused fieldset': { borderColor: '#00a884' },
                },
                ...sx
            }}
            InputProps={{
                endAdornment: (
                    <InputAdornment position="end">
                        <IconButton
                            aria-label="toggle password visibility"
                            onClick={handleClickShowPassword}
                            onMouseDown={handleMouseDownPassword}
                            edge="end"
                            sx={{ color: '#8696a0' }}
                        >
                            {showPassword ? <VisibilityOff /> : <Visibility />}
                        </IconButton>
                    </InputAdornment>
                ),
            }}
        />
    );
};

export default PasswordField;
