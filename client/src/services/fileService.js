import axios from "axios";

const API_BASE_URL = import.meta.env.VITE_API_BASE || "http://localhost:5000/api/v1";

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
    // Assuming the absolute backend host for uploads if URL starts with /uploads
    let fullUrl = url;
    if (url.startsWith('/')) {
        const BASE = API_BASE_URL.replace('/api/v1', '');
        fullUrl = `${BASE}${url}`;
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
