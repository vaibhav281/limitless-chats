import { useState, useCallback, useRef } from "react";
import axios from "axios";
import { uploadFilesWithProgress, downloadFileWithProgress } from "../services/fileService";

export default function useFileUpload() {
    const [fileProgress, setFileProgress] = useState({});
    const tasksRef = useRef({});

    const uploadFiles = useCallback(async (tempId, formData) => {
        tasksRef.current[tempId] = { type: 'upload', formData };
        const cancelSource = axios.CancelToken.source();

        setFileProgress((prev) => ({
            ...prev,
            [tempId]: { progress: 0, status: 'uploading', cancelSource }
        }));

        try {
            const response = await uploadFilesWithProgress(formData, (progress) => {
                setFileProgress((prev) => ({
                    ...prev,
                    [tempId]: { ...prev[tempId], progress }
                }));
            }, cancelSource);

            setFileProgress((prev) => ({
                ...prev,
                [tempId]: { progress: 100, status: 'completed', cancelSource: null }
            }));

            return response.data; // The actual created Note object
        } catch (error) {
            if (axios.isCancel(error)) {
                console.log('Upload canceled', error.message);
            }
            setFileProgress((prev) => ({
                ...prev,
                [tempId]: { ...prev[tempId], status: 'failed', cancelSource: null }
            }));
            throw error;
        }
    }, []);

    const downloadFile = useCallback(async (url, originalName, encryptionKeys = null, noteId = null, attachmentId = null) => {
        let activeKeys = encryptionKeys;

        // 1. Autonomous Cache Lookup (Hardening)
        if (!activeKeys && noteId && attachmentId && !url.startsWith('blob:')) {
            try {
                const { mediaKeyCache } = await import("../features/encryption/mediaKeyCache");
                const userId = localStorage.getItem('userId');
                const cached = await mediaKeyCache.getMediaKey(userId, noteId, attachmentId);
                if (cached) {
                    activeKeys = {
                        aesKey: cached.aesKey || cached.binaryAesKey,
                        iv: cached.iv,
                        // mimeType will be resolved from extension or passed
                    };
                }
            } catch (e) {
                console.warn("[useFileUpload] Autonomous key lookup failed", e);
            }
        }

        if (url && url.startsWith('blob:')) {
            const a = document.createElement('a');
            a.href = url;
            a.download = originalName || 'download';
            document.body.appendChild(a); // Required for Firefox/some browsers
            a.click();
            document.body.removeChild(a);
            return;
        }

        tasksRef.current[url] = { type: 'download', url, originalName, encryptionKeys: activeKeys };
        const cancelSource = axios.CancelToken.source();

        setFileProgress((prev) => ({
            ...prev,
            [url]: { progress: 0, status: 'downloading', cancelSource }
        }));

        try {
            if (activeKeys && activeKeys.aesKey && activeKeys.iv) {
                // Secure E2EE Download Path
                const { downloadAndDecryptFileWithProgress } = await import("../services/fileService");
                await downloadAndDecryptFileWithProgress(
                    url,
                    originalName,
                    activeKeys.aesKey,
                    activeKeys.iv,
                    activeKeys.mimeType,
                    (progress) => {
                        setFileProgress((prev) => ({
                            ...prev,
                            [url]: { ...prev[url], progress }
                        }));
                    },
                    cancelSource
                );
            } else {
                // Legacy / Plaintext Download Path
                await downloadFileWithProgress(url, originalName, (progress) => {
                    setFileProgress((prev) => ({
                        ...prev,
                        [url]: { ...prev[url], progress }
                    }));
                }, cancelSource);
            }

            setFileProgress((prev) => {
                const next = { ...prev };
                delete next[url]; // Remove from state once completed to revert to natural UI
                return next;
            });

        } catch (error) {
            console.error("[useFileUpload] Download pipeline failed", error);
            if (axios.isCancel(error)) {
                console.log('Download canceled', error.message);
            }
            setFileProgress((prev) => ({
                ...prev,
                [url]: { ...prev[url], status: 'failed', cancelSource: null }
            }));
        }
    }, [downloadFileWithProgress]);

    const cancelTask = useCallback((idOrUrl) => {
        setFileProgress((prev) => {
            const task = prev[idOrUrl];
            if (task && task.cancelSource) {
                task.cancelSource.cancel("User cancelled the operation.");
            }
            return prev;
        });
    }, []);

    const clearState = useCallback((idOrUrl) => {
        setFileProgress((prev) => {
            const next = { ...prev };
            delete next[idOrUrl];
            return next;
        });
    }, []);

    const retryTask = useCallback(async (idOrUrl) => {
        const task = tasksRef.current[idOrUrl];
        if (!task) return;
        if (task.type === 'upload') {
            return await uploadFiles(idOrUrl, task.formData);
        } else if (task.type === 'download') {
            return await downloadFile(task.url, task.originalName, task.encryptionKeys);
        }
    }, [uploadFiles, downloadFile]);

    return { fileProgress, uploadFiles, downloadFile, cancelTask, clearState, retryTask };
}
