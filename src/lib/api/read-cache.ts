type CacheInvalidator = () => void;

const globalCacheRegistry = globalThis as typeof globalThis & {
    __LOGISTIK_API_READ_CACHE_INVALIDATORS__?: Set<CacheInvalidator>;
};

const apiReadCacheInvalidators =
    globalCacheRegistry.__LOGISTIK_API_READ_CACHE_INVALIDATORS__ ??
    (globalCacheRegistry.__LOGISTIK_API_READ_CACHE_INVALIDATORS__ = new Set<CacheInvalidator>());

export function registerApiReadCacheInvalidator(invalidator: CacheInvalidator) {
    apiReadCacheInvalidators.add(invalidator);
}

export function clearApiReadCaches() {
    for (const invalidator of apiReadCacheInvalidators) {
        try {
            invalidator();
        } catch {
            // Cache invalidation must never block a business mutation.
        }
    }
}
