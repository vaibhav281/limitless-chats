import React, { useState, useEffect } from 'react';
import { Box, CircularProgress, Typography } from '@mui/material';
import PlayCircleIcon from '@mui/icons-material/PlayCircle';
import axios from 'axios';
import { decryptFile } from '../../encryption/cryptoService';
import { blobCache } from '../../encryption/blobCache';

export default function DecryptedMedia({ attachment, noteId, remoteUserId, isSentByMe, isSingle, isThreeGridFirst, extraCount }) {
  const [objectUrl, setObjectUrl] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    const loadDecrypted = async () => {
      // 1. If the file is an optimistic local blob (e.g., sender side preview before refresh)
      // It is already plaintext. We DO NOT decrypt it, even if AES keys are attached for storage.
      if (attachment.url && attachment.url.startsWith('blob:')) {
         setObjectUrl(attachment.url);
         setLoading(false);
         return;
      }

      // 1.5 Check LRU RAM Cache to prevent WebCrypto freezes on re-render / scrolling
      const cacheKey = `${noteId}_${attachment.attachmentId || (attachment.fileIndex !== undefined ? attachment.fileIndex : (attachment.index || attachment.originalName))}`;
      const cachedUrl = blobCache.get(cacheKey);
      if (cachedUrl) {
          setObjectUrl(cachedUrl);
          setLoading(false);
          return;
      }

      // 2. Prioritize Production-Grade Binary Results from the persistent cache
      const aesKey = attachment.binaryAesKey || attachment.decryptedKeyBase64;
      const iv = attachment.binaryIv || attachment.iv;

      if (aesKey && iv && attachment.url) {
         try {
            console.log(`[DecryptedMedia] Attempting decryption for ${attachment.originalName}. Key present: ${!!aesKey}, IV present: ${!!iv}`);
            const response = await axios.get(attachment.url, { responseType: 'arraybuffer' });
            
            const resolvedMimeType = attachment.originalMimeType || 
                (attachment.originalName?.toLowerCase().endsWith('.svg') ? 'image/svg+xml' : 
                (attachment.type === "image" ? "image/jpeg" : "application/octet-stream"));

            const decryptedBlob = await decryptFile(
                response.data,
                aesKey,
                iv,
                resolvedMimeType
            );

            const newObjectUrl = URL.createObjectURL(decryptedBlob);
            
            // Push to LRU Cache immediately
            blobCache.set(cacheKey, newObjectUrl);
            
            setObjectUrl(newObjectUrl);
            setLoading(false);
         } catch (err) {
            console.error(`[DecryptedMedia] Decryption failed for ${attachment.originalName}:`, err);
            setError(`Decryption failed: ${err.message || "Crypto Error"}`);
            setLoading(false);
         }
         return;
      }

      // (Local blob check was moved to the very top to prevent OperationError on sender UI)

      // If we made it here without a decryptedUrl, the primary hook's decryption failed.
      // Warn the user securely. Do NOT attempt duplicate ratchet advancement here.
      if (active) {
         if (attachment.encryptedKeys || attachment.encryptedKey) {
            setError("Decryption failed. Could not verify keys.");
         } else {
            // Legacy plaintext fallback
            setObjectUrl(attachment.url);
         }
         setLoading(false);
      }
    };

    loadDecrypted();

    return () => {
      active = false;
      // Memory cleanup for blob URLs is now strictly delegated to the `LRUBlobCache` class
      // or the parent component (for optimistic sender uploads). Calling URL.revokeObjectURL 
      // here would destroy the image while scrolling.
    };
  }, [attachment.url, attachment.originalName, attachment.attachmentId, attachment.fileIndex, attachment.type, remoteUserId, isSentByMe]);

  if (loading) {
    return (
      <Box sx={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: 'rgba(0,0,0,0.2)' }}>
        <CircularProgress size={24} sx={{ color: '#00a884' }} />
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: 'rgba(0,0,0,0.3)', flexDirection: 'column', p: 1 }}>
        <Typography variant="caption" sx={{ color: '#8696a0', textAlign: 'center' }}>{error}</Typography>
      </Box>
    );
  }

  if (attachment.type === 'image') {
    return (
      <>
        <img src={objectUrl} alt="attachment" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        {extraCount > 0 && (
           <Box sx={{ position: 'absolute', inset: 0, bgcolor: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Typography variant="h5" sx={{ color: '#fff', fontWeight: 500 }}>+{extraCount}</Typography>
           </Box>
        )}
      </>
    );
  }

  if (attachment.type === 'video') {
      return (
        <Box sx={{ position: 'relative', width: '100%', height: '100%' }}>
          <video controls src={objectUrl} style={{ width: '100%', height: '100%', objectFit: 'contain', backgroundColor: '#000' }} />
          {extraCount > 0 && (
            <Box sx={{ position: 'absolute', inset: 0, bgcolor: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Typography variant="h5" sx={{ color: '#fff', fontWeight: 500 }}>+{extraCount}</Typography>
            </Box>
          )}
        </Box>
      );
  }

  if (attachment.type === 'audio') {
      return (
          <Box sx={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', p: 1, bgcolor: 'rgba(0,0,0,0.05)', borderRadius: 2 }}>
             <audio controls src={objectUrl} style={{ width: '100%', maxWidth: 300 }} />
          </Box>
      );
  }

  if (attachment.type === 'document' || attachment.type === 'archive') {
      return (
          <Box sx={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', p: 4, bgcolor: 'rgba(0,0,0,0.05)', borderRadius: 2 }}>
             <Typography variant="body2" sx={{ color: '#00a884', textDecoration: 'underline', cursor: 'pointer' }} onClick={() => {
                 const a = document.createElement('a'); a.href = objectUrl; a.download = attachment.originalName || 'download'; a.click();
             }}>
                 Download {attachment.originalName || "Document"}
             </Typography>
          </Box>
      );
  }

  // Generic Fallback
  return (
    <Box sx={{ p: 2, textAlign: 'center' }}>
       <Typography variant="caption">Unsupported Preview Format</Typography>
    </Box>
  );
}
