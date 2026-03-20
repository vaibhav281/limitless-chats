/**
 * A memory-safe LRU (Least Recently Used) cache for decrypted blob URLs.
 * Prevents the application from crashing due to out-of-memory errors
 * when a user scrolls through thousands of images/videos.
 */
class LRUBlobCache {
    constructor(maxSize = 200) {
        this.cache = new Map();
        this.maxSize = maxSize;
    }

    get(key) {
        if (!this.cache.has(key)) return null;

        // Retrieve the value and move it to the end of the Map
        // to mark it as the most recently used.
        const val = this.cache.get(key);
        this.cache.delete(key);
        this.cache.set(key, val);
        return val;
    }

    set(key, value) {
        if (this.cache.has(key)) {
            // If it already exists, remove it so we can push it to the end
            this.cache.delete(key);
        } else if (this.cache.size >= this.maxSize) {
            // If we are at capacity, evict the earliest (oldest) entry
            // Map.prototype.keys() returns items in insertion order
            const oldestKey = this.cache.keys().next().value;
            const oldestVal = this.cache.get(oldestKey);

            this.cache.delete(oldestKey);

            // Critical Memory Release: Delegate to centralized ref-counter
            import('../../services/mediaMemoryManager').then(({ release }) => {
                release(oldestKey);
            }).catch(() => {});
        }
        this.cache.set(key, value);
    }

    has(key) {
        return this.cache.has(key);
    }
}

// Export a robust singleton with a safe ceiling (e.g. 200 large media files)
export const blobCache = new LRUBlobCache(200);
