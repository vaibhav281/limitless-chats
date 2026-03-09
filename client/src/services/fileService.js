import axios from "axios";
import { decryptFile } from "../features/encryption/cryptoService";

const API_BASE_URL = "/api/v1";

export const uploadFilesWithProgress = async (formData, onProgress, cancelTokenSource) => {
    return await axios.post(`${API_BASE_URL}/notes`, formData, {
        headers: {
            "Content-Type": "multipart/form-data",
        },
        onUploadProgress: (progressEvent) => {
            if (progressEvent.total) {
                const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
                if (onProgress) onProgress(percentCompleted);
            }
        },
        cancelToken: cancelTokenSource ? cancelTokenSource.token : undefined,
    });
};

export const downloadFileWithProgress = async (url, originalName, onProgress, cancelTokenSource) => {
    // Use relative path for downloads to respect proxy
    let fullUrl = url;
    if (url.startsWith('/uploads')) {
        fullUrl = `/api/v1${url}`; // or wherever the backend router expects it. Actually, Vite proxies `/uploads` directly!
    }
    if (url.startsWith('/')) {
        fullUrl = url;
    }

    const response = await axios.get(fullUrl, {
        responseType: "blob",
        onDownloadProgress: (progressEvent) => {
            if (progressEvent.total) {
                const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
                if (onProgress) onProgress(percentCompleted);
            }
        },
        cancelToken: cancelTokenSource ? cancelTokenSource.token : undefined,
    });

    // Trigger download in browser
    const blob = new Blob([response.data]);
    const link = document.createElement("a");
    link.href = window.URL.createObjectURL(blob);
    link.download = originalName || "download";
    link.click();
    window.URL.revokeObjectURL(link.href);
};

/**
 * Downloads an encrypted file, decrypts it in-memory, and triggers a browser save.
 */
export const downloadAndDecryptFileWithProgress = async (url, originalName, aesKey, iv, mimeType, onProgress, cancelTokenSource) => {
    let fullUrl = url;
    if (url.startsWith('/uploads')) {
        fullUrl = `/api/v1${url}`;
    }
    if (url.startsWith('/')) {
        fullUrl = url;
    }

    const response = await axios.get(fullUrl, {
        responseType: "arraybuffer", // Need binary data for crypto
        onDownloadProgress: (progressEvent) => {
            if (progressEvent.total) {
                const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
                if (onProgress) onProgress(percentCompleted);
            }
        },
        cancelToken: cancelTokenSource ? cancelTokenSource.token : undefined,
    });

    // Decrypt the file
    const decryptedBlob = await decryptFile(
        response.data,
        aesKey,
        iv,
        mimeType || "application/octet-stream"
    );

    // Trigger download in browser
    const link = document.createElement("a");
    link.href = window.URL.createObjectURL(decryptedBlob);
    link.download = originalName || "download";
    link.click();
    window.URL.revokeObjectURL(link.href);
};
