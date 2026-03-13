type RateLimitBucket = {
    count: number;
    resetAt: number;
};

declare global {
    var __logistikRateLimitStore: Map<string, RateLimitBucket> | undefined;
}

const rateLimitStore = globalThis.__logistikRateLimitStore ?? new Map<string, RateLimitBucket>();
globalThis.__logistikRateLimitStore = rateLimitStore;

function cleanupExpiredBuckets(now: number) {
    for (const [key, bucket] of rateLimitStore.entries()) {
        if (bucket.resetAt <= now) {
            rateLimitStore.delete(key);
        }
    }
}

export function getRequestIp(request: Request) {
    const forwardedFor = request.headers.get('x-forwarded-for');
    if (forwardedFor) {
        return forwardedFor.split(',')[0]?.trim() || 'unknown';
    }

    return request.headers.get('x-real-ip') || 'unknown';
}

export function recordFailedAttempt(key: string, limit: number, windowMs: number) {
    const now = Date.now();
    cleanupExpiredBuckets(now);

    const current = rateLimitStore.get(key);
    if (!current || current.resetAt <= now) {
        rateLimitStore.set(key, { count: 1, resetAt: now + windowMs });
        return { limited: false, retryAfterSeconds: 0 };
    }

    const nextCount = current.count + 1;
    const nextBucket = { ...current, count: nextCount };
    rateLimitStore.set(key, nextBucket);

    if (nextCount > limit) {
        return {
            limited: true,
            retryAfterSeconds: Math.max(1, Math.ceil((nextBucket.resetAt - now) / 1000)),
        };
    }

    return { limited: false, retryAfterSeconds: 0 };
}

export function clearFailedAttempts(key: string) {
    rateLimitStore.delete(key);
}
