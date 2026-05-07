type CacheInvalidator = () => void;

const apiReadCacheInvalidators = new Set<CacheInvalidator>();

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
