import React from 'react';
import { Box, Fade } from '@mui/material';
import Picker, { Theme, EmojiStyle } from 'emoji-picker-react';

export default function EmojiPickerContainer({ isOpen, pickerRef, onEmojiClick }) {
  return (
    <Fade in={isOpen}>
      <Box
        ref={pickerRef}
        sx={{
          position: 'absolute',
          bottom: '100%',
          left: 0,
          mb: 1, // small margin slightly above the input
          zIndex: 1300,
          boxShadow: '0 4px 15px rgba(0,0,0,0.5)',
          borderRadius: 2,
          overflow: 'hidden',
          // Mimic WhatsApp's smooth size on desktop vs mobile
          width: { xs: '100%', sm: '350px' },
          height: '400px',
          display: isOpen ? 'block' : 'none'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <Picker 
          onEmojiClick={onEmojiClick}
          theme={Theme.DARK}
          emojiStyle={EmojiStyle.APPLE} // WhatsApp uses Apple emojis natively
          lazyLoadEmojis={true}
          autoFocusSearch={false}
          width="100%"
          height="100%"
          searchDisabled={true} // WhatsApp inline picker usually skips search or keeps it minimal
          skinTonesDisabled={true} // Fast perf
          previewConfig={{ showPreview: false }} // WhatsApp style minimalism
        />
      </Box>
    </Fade>
  );
}
