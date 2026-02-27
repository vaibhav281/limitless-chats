import React, { useState, useEffect } from 'react';
import { Box, CircularProgress, Typography } from '@mui/material';
import PlayCircleIcon from '@mui/icons-material/PlayCircle';
import { decryptMessage } from '../../encryption/messageDecryptor';
import { decryptFile } from '../../encryption/cryptoService';
import axios from 'axios';

export default function DecryptedMedia({ attachment, remoteUserId, isSentByMe, isSingle, isThreeGridFirst, extraCount }) {
  const [objectUrl, setObjectUrl] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    const loadDecrypted = async () => {
      // If securely decrypted by useEncryptedMessaging
      if (attachment.decryptedUrl) {
         setObjectUrl(attachment.decryptedUrl);
         setLoading(false);
         return;
      }

      // If the file is still an optimistic local blob (has no encryptedKey yet), just use the url
      if (attachment.url && attachment.url.startsWith('blob:')) {
         setObjectUrl(attachment.url);
         setLoading(false);
         return;
      }

      // If we are the sender, the encryptedKey on the server was built for the receiver's Session Ratchet.
      // We cannot decrypt it. (Full Signal implementations distribute a sender-key or sync linked devices).
      // For this MVP, we show a secure placeholder for the sender upon refresh.
      if (isSentByMe) {
         setError("AES Key ratchet is locked to receiver.");
         setLoading(false);
         return;
      }

      if (!attachment.encryptedKey) {
         // Legacy unencrypted attachment
         setObjectUrl(attachment.url);
         setLoading(false);
         return;
      }

      try {
        // 1. Fetch the raw AES encrypted blob from the backend
        const res = await axios.get(attachment.url, { responseType: 'blob' });
        const encryptedBlob = res.data;

        // 2. Decrypt the AES Key String using the Signal Protocol Ratchet
        const base64AesKey = await decryptMessage(remoteUserId, attachment.keyType || 3, attachment.encryptedKey);

        if (base64AesKey.startsWith("🔐")) {
            throw new Error("Signal Decryption of AES Key failed");
        }

        // 3. Decrypt the Blob using the AES Key and IV
        const originalMime = attachment.type === 'image' ? 'image/jpeg' : 'video/mp4'; // fallback approximation
        const decryptedBlob = await decryptFile(encryptedBlob, base64AesKey, attachment.iv, originalMime);

        if (!active) return;
        const url = URL.createObjectURL(decryptedBlob);
        setObjectUrl(url);
        setLoading(false);
      } catch (err) {
        if (active) {
          setError("Decryption failed");
          setLoading(false);
        }
      }
    };

    loadDecrypted();

    return () => {
      active = false;
      if (objectUrl && !objectUrl.startsWith('blob:')) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [attachment, remoteUserId, isSentByMe]);

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

  return (
    <Box sx={{ position: 'relative', width: '100%', height: '100%' }}>
      <video src={objectUrl} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      <Box sx={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Box sx={{ borderRadius: "50%", bgcolor: "rgba(0,0,0,0.5)", display: "flex", p: 1 }}>
          <PlayCircleIcon sx={{ color: "#fff", fontSize: isSingle ? 48 : 32 }} />
        </Box>
      </Box>
      {extraCount > 0 && (
         <Box sx={{ position: 'absolute', inset: 0, bgcolor: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Typography variant="h5" sx={{ color: '#fff', fontWeight: 500 }}>+{extraCount}</Typography>
         </Box>
      )}
    </Box>
  );
}
