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

    const downloadFile = useCallback(async (url, originalName) => {
        if (url && url.startsWith('blob:')) {
            const a = document.createElement('a');
            a.href = url;
            a.download = originalName || 'download';
            a.click();
            return;
        }

        tasksRef.current[url] = { type: 'download', url, originalName };
        const cancelSource = axios.CancelToken.source();

        setFileProgress((prev) => ({
            ...prev,
            [url]: { progress: 0, status: 'downloading', cancelSource }
        }));

        try {
            await downloadFileWithProgress(url, originalName, (progress) => {
                setFileProgress((prev) => ({
                    ...prev,
                    [url]: { ...prev[url], progress }
                }));
            }, cancelSource);

            setFileProgress((prev) => {
                const next = { ...prev };
                delete next[url]; // Remove from state once completed to revert to natural UI
                return next;
            });

        } catch (error) {
            if (axios.isCancel(error)) {
                console.log('Download canceled', error.message);
            }
            setFileProgress((prev) => ({
                ...prev,
                [url]: { ...prev[url], status: 'failed', cancelSource: null }
            }));
        }
    }, []);

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
            return await downloadFile(task.url, task.originalName);
        }
    }, [uploadFiles, downloadFile]);

    return { fileProgress, uploadFiles, downloadFile, cancelTask, clearState, retryTask };
}
