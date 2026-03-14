import React, { useState, useEffect, useMemo } from 'react';
import { Box, CircularProgress, Typography } from '@mui/material';
import PlayCircleIcon from '@mui/icons-material/PlayCircle';
import { runMediaDecryptionPipeline, getEffectiveAttachmentId, E2EE_ERRORS } from '../../encryption/cryptoService';
import { mediaKeyCache } from '../../encryption/mediaKeyCache';
import { blobCache } from '../../encryption/blobCache';

export default function DecryptedMedia({ 
  attachment, 
  noteId, 
  remoteUserId, 
  isSentByMe, 
  isSingle, 
  isThreeGridFirst, 
  extraCount,
  isThumbnail = false 
}) {
  // 1. Resolve effective ID and Cache Key synchronously
  const attachmentId = useMemo(() => getEffectiveAttachmentId(attachment), [attachment]);
  const cacheKey = useMemo(() => `${noteId}_${attachmentId}`, [noteId, attachmentId]);

  // 2. Synchronous Cache Check (Fixes Flickering)
  // If the hydration happened in the background (Lifecycle), we skip the loading state entirely.
  const initialUrl = blobCache.get(cacheKey);

  const [objectUrl, setObjectUrl] = useState(initialUrl);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(!initialUrl);

  useEffect(() => {
    let active = true;

    // If we already have the URL from a synchronous check, skip the effect logic!
    if (objectUrl && !loading) return;

    // Phase 1 Guard: Skip local preview files (Drafts/Sent Messages already have Object URLs)
    if (attachment.url?.startsWith('blob:')) {
      if (active) {
        setObjectUrl(attachment.url);
        setLoading(false);
      }
      return;
    }

    // Phase 2 Optimization: If it's a video placeholder, we don't strictly NEED the URL 
    // unless it's already cached. This prevents main-thread jank.
    if (isThumbnail && attachment.type === 'video' && !initialUrl) {
        if (active) setLoading(false);
        return;
    }

    const loadMedia = async () => {
      try {
        if (!initialUrl) setLoading(true);
        setError(null);

        const currentUserId = localStorage.getItem('userId');
        let aesKey = attachment.binaryAesKey || attachment.decryptedKeyBase64;
        let iv = attachment.binaryIv || attachment.iv;

        // Phase 1 Guard: Attempt to recover missing keys from cache before giving up
        if (!aesKey) {
            const cachedMediaKey = await mediaKeyCache.getMediaKey(currentUserId, noteId, attachmentId);
            if (cachedMediaKey) {
                aesKey = cachedMediaKey.aesKey || cachedMediaKey.binaryAesKey;
                iv = iv || cachedMediaKey.iv;
            }
        }

        // Phase 1 Guard: Strictly only run pipeline if materials exist and it's a network URL
        if (!aesKey || !iv || !attachment.url) {
            // Silence console spam: This is an expected state during Signal ratchet delays
            if (active) setLoading(false);
            return;
        }

        const url = await runMediaDecryptionPipeline(noteId, attachment, aesKey, iv);

        if (active) {
          if (!url) {
              // Graceful delay: Pipeline returned null due to missing materials
              setError(E2EE_ERRORS.MEDIA_KEY_MISSING);
              setLoading(false);
          } else {
              setObjectUrl(url);
              setLoading(false);
          }
        }
      } catch (err) {
        console.error(`[DecryptedMedia] Pipeline failure for ${cacheKey}:`, err);
        if (active) {
          // Pass the error code for the parent to map
          setError(err.code || E2EE_ERRORS.MEDIA_DECRYPT_FAIL);
          setLoading(false);
        }
      }
    };

    loadMedia();

    return () => {
      active = false;
    };
  }, [attachment.url, attachment.originalName, attachmentId, attachment.type, remoteUserId, isSentByMe, noteId, cacheKey, initialUrl]);

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
        <Typography variant="caption" sx={{ color: '#8696a0', textAlign: 'center' }}>
            {error === E2EE_ERRORS.MEDIA_KEY_MISSING ? "Waiting for media..." : "File decryption failed"}
        </Typography>
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
      if (isThumbnail) {
        return (
            <Box sx={{ position: 'relative', width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: '#000' }}>
               {/* Video Placeholder: Dark background with Play Icon (WhatsApp Style) */}
               <Box sx={{ 
                   width: '100%', height: '100%', 
                   display: 'flex', alignItems: 'center', justifyContent: 'center',
                   bgcolor: 'rgba(255,255,255,0.05)'
               }}>
                   <PlayCircleIcon sx={{ fontSize: 48, color: 'rgba(255,255,255,0.8)' }} />
               </Box>
               
               {attachment.duration && (
                   <Typography variant="caption" sx={{ position: 'absolute', bottom: 8, right: 8, color: '#fff', bgcolor: 'rgba(0,0,0,0.4)', px: 1, borderRadius: 1, fontWeight: 500 }}>
                       {attachment.duration}
                   </Typography>
               )}

               {extraCount > 0 && (
                  <Box sx={{ position: 'absolute', inset: 0, bgcolor: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1 }}>
                      <Typography variant="h5" sx={{ color: '#fff', fontWeight: 500 }}>+{extraCount}</Typography>
                  </Box>
               )}
            </Box>
        );
      }

      return (
        <Box sx={{ position: 'relative', width: '100%', height: '100%' }}>
          <video controls autoPlay src={objectUrl} style={{ width: '100%', height: '100%', objectFit: 'contain', backgroundColor: '#000' }} />
          {extraCount > 0 && (
            <Box sx={{ position: 'absolute', inset: 0, bgcolor: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Typography variant="h5" sx={{ color: '#fff', fontWeight: 500 }}>+{extraCount}</Typography>
            </Box>
          )}
        </Box>
      );
  }

  if (attachment.type === 'audio') {
      const formatBytes = (bytes) => {
          if (!bytes || bytes === 0) return '';
          const k = 1024;
          const sizes = ['B', 'KB', 'MB'];
          const i = Math.floor(Math.log(bytes) / Math.log(k));
          return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
      };

      return (
          <Box sx={{ width: '100%', display: 'flex', flexDirection: 'column', p: 1.5, bgcolor: 'rgba(255,255,255,0.05)', borderRadius: 2, border: "1px solid rgba(255,255,255,0.02)" }}>
             <Box sx={{ display: 'flex', alignItems: 'center', mb: 1, px: 0.5 }}>
                <Typography variant="body2" noWrap sx={{ fontWeight: 500, color: "#e9edef", flex: 1 }}>
                    {attachment.originalName || "Voice Message"}
                </Typography>
                <Typography variant="caption" sx={{ color: "#8696a0", ml: 1 }}>
                    {attachment.size ? formatBytes(attachment.size) : ''}
                </Typography>
             </Box>
             <audio controls src={objectUrl} style={{ width: '100%', maxWidth: 300, height: 40 }} />
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
