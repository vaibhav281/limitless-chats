import React from 'react';
import { Box } from '@mui/material';

// Regex implementations
const URL_REGEX = /(https?:\/\/[^\s]+)/g;
const MENTION_REGEX = /(@[xXyYzZa-zA-Z0-9_]+)/g; // @username
const BOLD_REGEX = /\*([^*]+)\*/g; // *bold*
const ITALIC_REGEX = /_([^_]+)_/g; // _italic_

export const parseMessageText = (text, currentUsername) => {
    if (!text) return null;

    // 1. Split across URLs First to isolate them
    const urlParts = text.split(URL_REGEX);

    return urlParts.map((part, urlIdx) => {
        if (part.match(URL_REGEX)) {
            return (
                <a 
                    key={`url-${urlIdx}`} 
                    href={part} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    style={{ color: "#53bdeb", textDecoration: "underline" }}
                    onClick={(e) => e.stopPropagation()}
                >
                    {part}
                </a>
            );
        }

        // 2. Further parse Mentions inside non-URL blocks
        const mentionParts = part.split(MENTION_REGEX);

        return mentionParts.map((mPart, mIdx) => {
            if (mPart.match(MENTION_REGEX)) {
                const mentionedName = mPart.substring(1).toLowerCase(); 
                const isMe = currentUsername && mentionedName === currentUsername.toLowerCase();
                
                return (
                    <Box 
                        component="span" 
                        key={`mention-${urlIdx}-${mIdx}`} 
                        sx={{ 
                            color: isMe ? "#111b21" : "#53bdeb", 
                            bgcolor: isMe ? "#53bdeb" : "transparent",
                            fontWeight: 600,
                            px: isMe ? 0.5 : 0,
                            borderRadius: 1
                        }}
                    >
                        {mPart}
                    </Box>
                );
            }

            // 3. Further parse Bold inside non-Mention blocks
            const boldParts = mPart.split(BOLD_REGEX);
            return boldParts.map((bPart, bIdx) => {
                if (bIdx % 2 === 1) { 
                    // Matches capturing group of BOLD_REGEX
                    return <strong key={`bold-${urlIdx}-${mIdx}-${bIdx}`}>{bPart}</strong>;
                }

                // 4. Further parse Italic inside non-Bold blocks
                const italicParts = bPart.split(ITALIC_REGEX);
                return italicParts.map((iPart, iIdx) => {
                    if (iIdx % 2 === 1) {
                        return <em key={`italic-${urlIdx}-${mIdx}-${bIdx}-${iIdx}`}>{iPart}</em>;
                    }
                    return iPart || null;
                });
            });
        });
    });
};
