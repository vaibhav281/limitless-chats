const map = new Map(); // key -> { url, mimeType, fileName, refCount }

export function bindUrl(key, url, meta = {}) {
    if (!key || !url) return;
    const existing = map.get(key);
    if (existing) {
        existing.refCount += 1;
        return existing.url;
    }
    map.set(key, { url, mimeType: meta.mimeType || null, fileName: meta.fileName || null, refCount: 1 });
    return url;
}

export function retain(key) {
    const e = map.get(key);
    if (e) e.refCount++;
}

export function release(key) {
    const e = map.get(key);
    if (!e) return;
    e.refCount--;
    if (e.refCount <= 0) {
        try { URL.revokeObjectURL(e.url); } catch (err) { /* swallow */ }
        map.delete(key);
    }
}

export function getMeta(key) {
    return map.get(key) || null;
}
