import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Box, CircularProgress, Typography } from '@mui/material';
import PlayCircleIcon from '@mui/icons-material/PlayCircle';
import InsertDriveFileIcon from '@mui/icons-material/InsertDriveFile';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
import DescriptionIcon from '@mui/icons-material/Description';
import ArchiveIcon from '@mui/icons-material/Archive';
import { runMediaDecryptionPipeline, getEffectiveAttachmentId, getBlobCacheKey, E2EE_ERRORS } from '../../encryption/cryptoService';
import { mediaKeyCache } from '../../encryption/mediaKeyCache';
import { blobCache } from '../../encryption/blobCache';
import { retain, release } from '../../../services/mediaMemoryManager';

const DecryptedMedia = React.memo(function DecryptedMedia({ 
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
  const attachmentId = useMemo(() => getEffectiveAttachmentId(attachment, attachment.index), [attachment]);
  const cacheKey = useMemo(() => getBlobCacheKey(noteId, attachment, attachment.index), [noteId, attachment]);

  // 2. Synchronous Cache Check (Fixes Flickering)
  // If the hydration happened in the background (Lifecycle), we skip the loading state entirely.
  const cachedData = blobCache.get(cacheKey);
  const initialUrl = typeof cachedData === 'string' ? cachedData : cachedData?.url;

  const [objectUrl, setObjectUrl] = useState(initialUrl);
  const [status, setStatus] = useState(initialUrl ? 'success' : 'loading');
  const [errorCode, setErrorCode] = useState(null);
  const [videoFrame, setVideoFrame] = useState(null);

  const [visible, setVisible] = useState(!!initialUrl);
  const containerRef = useRef(null);

  // Lazy Load Observer
  useEffect(() => {
    if (initialUrl || visible) return;
    const io = new IntersectionObserver(entries => {
      entries.forEach(e => {
         if (e.isIntersecting) setVisible(true);
      });
    }, { rootMargin: '200px', threshold: 0.01 });
    
    if (containerRef.current) io.observe(containerRef.current);
    return () => io.disconnect();
  }, [initialUrl, visible]);

  // Safe Memory Lifecycle
  useEffect(() => {
     if (objectUrl && objectUrl.startsWith('blob:')) {
         retain(cacheKey);
     }
     return () => {
         if (objectUrl && objectUrl.startsWith('blob:')) {
             release(cacheKey);
         }
     };
  }, [objectUrl, cacheKey]);

  useEffect(() => {
    let active = true;

    // Phase 0: Wait for viewport visibility!
    if (!visible && !initialUrl) return;

    // If we already have the URL from a synchronous check, skip the effect logic!
    if (objectUrl && status === 'success') return;

    // Phase 1 Guard: Skip local preview files (Drafts/Sent Messages already have Object URLs)
    if (attachment.url?.startsWith('blob:')) {
      if (active) {
        setObjectUrl(attachment.url);
        setStatus('success');
      }
      return;
    }

    // removed bad Video optimization that starved thumbnails from rendering unless user cached the payload

    const loadMedia = async () => {
      try {
        if (!initialUrl) setStatus('loading');
        setErrorCode(null);

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
            if (active) {
                setErrorCode(E2EE_ERRORS.MEDIA_KEY_MISSING);
                setStatus('failed'); // ✅ STOP LOADER
            }
            return;
        }

        const url = await runMediaDecryptionPipeline(noteId, attachment, aesKey, iv, attachment.index);

        if (active) {
          if (!url || url.failed) {
              // Graceful delay: Pipeline returned null due to missing materials
              setErrorCode(E2EE_ERRORS.MEDIA_KEY_MISSING);
              setStatus('failed');
          } else {
              setObjectUrl(url);
              setStatus('success');
          }
        }
      } catch (err) {
        console.error(`[DecryptedMedia] Pipeline failure for ${cacheKey}:`, err);
        if (active) {
          // Pass the error code for the parent to map
          setErrorCode(err.code || E2EE_ERRORS.MEDIA_DECRYPT_FAIL);
          setStatus('failed');
        }
      }
    };

    loadMedia();
    
    // UI FAIL SAFE: Break infinite loaders after 10 seconds.
    const loopBreaker = setTimeout(() => {
       if (active) {
          // If status isn't accessible due to closure staleness, we can use a ref or just blindly call it if it's still hanging.
          // Wait, status is in the dependency array for useEffect? No, it's not. 
          // We can use setState with callback:
          setStatus(prev => prev === 'loading' ? 'failed' : prev);
       }
    }, 10000);

    return () => {
      active = false;
      clearTimeout(loopBreaker);
    };
  }, [attachment.url, attachment.originalName, attachmentId, attachment.type, remoteUserId, isSentByMe, noteId, cacheKey, initialUrl]);

  // Phase 3 Enhancement: Async Background Video Thumbnail Generation
  // Captures a frame from the encrypted blob natively via Canvas 
  useEffect(() => {
    let active = true;

    if (isThumbnail && attachment.type === 'video' && objectUrl && !videoFrame) {
      const generateThumbnail = () => {
         const video = document.createElement("video");
         video.crossOrigin = "anonymous"; // ✅ CORS FIX
         video.src = objectUrl;
         video.muted = true;
         video.playsInline = true;

         video.onloadedmetadata = () => {
             if (active) video.currentTime = 1;
         };

         video.onseeked = () => {
             if (!active) return;
             try {
                 const canvas = document.createElement("canvas");
                 canvas.width = video.videoWidth;
                 canvas.height = video.videoHeight;
                 
                 const ctx = canvas.getContext("2d");
                 ctx.drawImage(video, 0, 0);
                 
                 setVideoFrame(canvas.toDataURL());
             } catch (e) {
                 console.warn("Could not generate video thumbnail", e);
             }
             
             // GC Detach
             video.removeAttribute("src");
             video.load();
         };
      };

      if (window.requestIdleCallback) {
          window.requestIdleCallback(generateThumbnail);
      } else {
          setTimeout(generateThumbnail, 0);
      }
    }

    return () => {
        active = false;
    };
  }, [objectUrl, isThumbnail, attachment.type, videoFrame]);

  // Intercept the loading spinner ONLY if it is not a video thumbnail
  // Video thumbnails should render their structural black fallback immediately and hydrate the `videoFrame` behind the scenes.
  if (status === 'loading' && !(isThumbnail && attachment.type === 'video')) {
    return (
      <Box ref={containerRef} sx={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: 'rgba(0,0,0,0.2)' }}>
        <CircularProgress size={24} sx={{ color: '#00a884' }} />
      </Box>
    );
  }

  if (status === 'deleted') {
    return (
      <Box ref={containerRef} sx={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: 'rgba(0,0,0,0.3)', p: 1 }}>
        <Typography variant="caption" sx={{ color: '#8696a0' }}>Deleted</Typography>
      </Box>
    );
  }

  if (status === 'failed') {
    return (
      <Box ref={containerRef} sx={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: 'rgba(0,0,0,0.3)', flexDirection: 'column', p: 1 }}>
        <Typography variant="caption" sx={{ color: '#8696a0', textAlign: 'center' }}>
            {errorCode === E2EE_ERRORS.MEDIA_KEY_MISSING ? "Waiting for media..." : "File unavailable"}
        </Typography>
      </Box>
    );
  }

  if (status !== 'success') return null;

  if (attachment.type === 'image') {
    return (
      <Box ref={containerRef} sx={{ width: '100%', height: '100%', position: 'relative' }}>
        <img src={objectUrl} alt="attachment" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        {extraCount > 0 && (
           <Box sx={{ position: 'absolute', inset: 0, bgcolor: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Typography variant="h5" sx={{ color: '#fff', fontWeight: 500 }}>+{extraCount}</Typography>
           </Box>
        )}
      </Box>
    );
  }

  if (attachment.type === 'video') {
      if (isThumbnail) {
        return (
            <Box ref={containerRef} sx={{ position: 'relative', width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: '#000' }}>
               {videoFrame ? (
                   <img src={videoFrame} alt="video thumbnail" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
               ) : (
                   <Box sx={{ 
                       width: '100%', height: '100%', 
                       display: 'flex', alignItems: 'center', justifyContent: 'center',
                       bgcolor: 'rgba(255,255,255,0.05)'
                   }} />
               )}
               
               <PlayCircleIcon sx={{ position: 'absolute', fontSize: 48, color: 'rgba(255,255,255,0.8)', zIndex: 1 }} />
               
               {attachment.duration && (
                   <Typography variant="caption" sx={{ position: 'absolute', bottom: 8, right: 8, color: '#fff', bgcolor: 'rgba(0,0,0,0.4)', px: 1, borderRadius: 1, fontWeight: 500, zIndex: 1 }}>
                       {attachment.duration}
                   </Typography>
               )}

               {extraCount > 0 && (
                  <Box sx={{ position: 'absolute', inset: 0, bgcolor: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2 }}>
                      <Typography variant="h5" sx={{ color: '#fff', fontWeight: 500 }}>+{extraCount}</Typography>
                  </Box>
               )}
            </Box>
        );
      }

      return (
        <Box ref={containerRef} sx={{ position: 'relative', width: '100%', height: '100%' }}>
          <video controls controlsList="nodownload" autoPlay src={objectUrl} style={{ width: '100%', height: '100%', objectFit: 'contain', backgroundColor: '#000' }} />
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
          <Box ref={containerRef} sx={{ width: '100%', display: 'flex', flexDirection: 'column', p: 1.5, bgcolor: 'rgba(255,255,255,0.05)', borderRadius: 2, border: "1px solid rgba(255,255,255,0.02)" }}>
             <Box sx={{ display: 'flex', alignItems: 'center', mb: 1, px: 0.5 }}>
                <Typography variant="body2" noWrap sx={{ fontWeight: 500, color: "#e9edef", flex: 1 }}>
                    {attachment.originalName || "Voice Message"}
                </Typography>
                <Typography variant="caption" sx={{ color: "#8696a0", ml: 1 }}>
                    {attachment.size ? formatBytes(attachment.size) : ''}
                </Typography>
             </Box>
             <audio controls controlsList="nodownload" src={objectUrl} style={{ width: '100%', maxWidth: 300, height: 40 }} />
          </Box>
      );
  }

  if (attachment.type === 'document' || attachment.type === 'archive') {
      const isPdf = attachment.originalName?.toLowerCase().endsWith('.pdf');
      const isWord = attachment.originalName?.toLowerCase().match(/\.(doc|docx)$/);
      const isArchive = attachment.type === 'archive';
      
      const Icon = isPdf ? PictureAsPdfIcon :
                   isWord ? DescriptionIcon :
                   isArchive ? ArchiveIcon : InsertDriveFileIcon;
                   
      const formatBytes = (bytes) => {
          if (!bytes) return '';
          const k = 1024, sizes = ['B', 'KB', 'MB'];
          const i = Math.floor(Math.log(bytes) / Math.log(k));
          return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
      };

      return (
          <Box ref={containerRef} sx={{ width: '100%', display: 'flex', alignItems: 'center', p: 1.5, bgcolor: 'rgba(255,255,255,0.05)', borderRadius: 2, border: "1px solid rgba(255,255,255,0.02)", cursor: 'pointer', "&:hover": { bgcolor: "rgba(255,255,255,0.08)" } }} onClick={(e) => { e.stopPropagation(); window.open(objectUrl, '_blank'); }}>
             <Box sx={{ width: 40, height: 40, borderRadius: 1, bgcolor: isPdf ? 'rgba(239,83,80,0.15)' : isWord ? 'rgba(66,165,245,0.15)' : 'rgba(158,158,158,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', mr: 2 }}>
                 <Icon sx={{ color: isPdf ? '#ef5350' : isWord ? '#64b5f6' : '#bdbdbd' }} />
             </Box>
             <Box sx={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
                 <Typography variant="body2" noWrap sx={{ color: '#e9edef', fontWeight: 500 }}>
                     {attachment.originalName || "Document"}
                 </Typography>
                 {attachment.size > 0 && (
                     <Typography variant="caption" sx={{ color: '#8696a0' }}>
                         {formatBytes(attachment.size)} • {attachment.originalName?.split('.').pop().toUpperCase()}
                     </Typography>
                 )}
             </Box>
          </Box>
      );
  }

  return (
    <Box ref={containerRef} sx={{ p: 2, textAlign: 'center' }}>
       <Typography variant="caption">Unsupported Preview Format</Typography>
    </Box>
  );
});

export default DecryptedMedia;
