import { createHash } from 'node:crypto';

import { getSupabaseClient } from '@/lib/supabase';

type PersistedRateLimitBucket = {
    id: string;
    count?: number;
    resetAt?: number;
    updatedAt?: string;
};

type RateLimitResult = {
    limited: boolean;
    retryAfterSeconds: number;
};

type LocalRateLimitBucket = {
    count: number;
    resetAt: number;
};

const RATE_LIMIT_DOC_TYPE = 'loginRateLimit';
const MAX_MUTATION_RETRIES = 5;

declare global {
    var __logistikRateLimitCache: Map<string, LocalRateLimitBucket> | undefined;
}

const localRateLimitCache = globalThis.__logistikRateLimitCache ?? new Map<string, LocalRateLimitBucket>();
globalThis.__logistikRateLimitCache = localRateLimitCache;

function buildRateLimitDocId(key: string) {
    const hash = createHash('sha256').update(key).digest('hex');
    return `${RATE_LIMIT_DOC_TYPE}.${hash}`;
}

function getBucketCount(bucket: PersistedRateLimitBucket | null) {
    return typeof bucket?.count === 'number' && Number.isFinite(bucket.count) && bucket.count > 0
        ? bucket.count
        : 0;
}

function getBucketResetAt(bucket: PersistedRateLimitBucket | null) {
    return typeof bucket?.resetAt === 'number' && Number.isFinite(bucket.resetAt) && bucket.resetAt > 0
        ? bucket.resetAt
        : 0;
}

function isRateLimitConflictError(error: unknown) {
    const statusCode =
        typeof error === 'object' && error !== null && 'statusCode' in error && typeof error.statusCode === 'number'
            ? error.statusCode
            : typeof error === 'object' && error !== null && 'status' in error && typeof error.status === 'number'
                ? error.status
                : undefined;
    const message =
        error instanceof Error
            ? error.message
            : typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string'
                ? error.message
                : '';

    return statusCode === 409 || /revision/i.test(message) || /conflict/i.test(message);
}

function isRateLimitNotFoundError(error: unknown) {
    const statusCode =
        typeof error === 'object' && error !== null && 'statusCode' in error && typeof error.statusCode === 'number'
            ? error.statusCode
            : typeof error === 'object' && error !== null && 'status' in error && typeof error.status === 'number'
                ? error.status
                : undefined;
    const message =
        error instanceof Error
            ? error.message
            : typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string'
                ? error.message
                : '';

    return statusCode === 404 || /not found/i.test(message);
}

function nowIso(now: number) {
    return new Date(now).toISOString();
}

async function getRateLimitBucket(docId: string) {
    const response = await getSupabaseClient().fetch(
        `rate_limit_buckets?select=*&id=eq.${encodeURIComponent(docId)}&limit=1`
    );
    const rows = await response.json() as Array<{
        id: string;
        count?: number | null;
        reset_at?: number | null;
        updated_at?: string | null;
    }>;
    const row = rows[0];
    if (!row) return null;
    return {
        id: row.id,
        count: typeof row.count === 'number' ? row.count : 0,
        resetAt: typeof row.reset_at === 'number' ? row.reset_at : 0,
        updatedAt: row.updated_at || undefined,
    } satisfies PersistedRateLimitBucket;
}

async function upsertRateLimitBucket(docId: string, count: number, resetAt: number, now: number) {
    await getSupabaseClient().fetch('rate_limit_buckets', {
        method: 'POST',
        headers: {
            Prefer: 'resolution=merge-duplicates,return=minimal',
        },
        body: JSON.stringify({
            id: docId,
            count,
            reset_at: resetAt,
            updated_at: nowIso(now),
        }),
    });
}

async function deleteRateLimitBucket(docId: string) {
    await getSupabaseClient().fetch(
        `rate_limit_buckets?id=eq.${encodeURIComponent(docId)}`,
        { method: 'DELETE' }
    );
}

function cleanupLocalRateLimitCache(now: number) {
    for (const [key, bucket] of localRateLimitCache.entries()) {
        if (bucket.resetAt <= now) {
            localRateLimitCache.delete(key);
        }
    }
}

function readLocalRateLimitBucket(docId: string, now: number) {
    cleanupLocalRateLimitCache(now);
    return localRateLimitCache.get(docId) ?? null;
}

function writeLocalRateLimitBucket(docId: string, count: number, resetAt: number) {
    localRateLimitCache.set(docId, { count, resetAt });
}

function clearLocalRateLimitBucket(docId: string) {
    localRateLimitCache.delete(docId);
}

export function getRequestIp(request: Request) {
    const forwardedFor = request.headers.get('x-forwarded-for');
    if (forwardedFor) {
        return forwardedFor.split(',')[0]?.trim() || 'unknown';
    }

    return request.headers.get('x-real-ip') || 'unknown';
}

export async function recordLoginAttempt(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
    const docId = buildRateLimitDocId(key);

    for (let attemptIndex = 0; attemptIndex < MAX_MUTATION_RETRIES; attemptIndex += 1) {
        const now = Date.now();
        const localBucket = readLocalRateLimitBucket(docId, now);
        const persistedBucket = await getRateLimitBucket(docId);
        const persistedResetAt = getBucketResetAt(persistedBucket);
        const persistedCount = getBucketCount(persistedBucket);
        const mergedResetAt = Math.max(persistedResetAt, localBucket?.resetAt ?? 0);
        const bucketCount =
            mergedResetAt > now
                ? Math.max(persistedCount, localBucket?.count ?? 0)
                : persistedCount;
        const bucket = persistedBucket
            ? ({
                ...persistedBucket,
                count: bucketCount,
                resetAt: mergedResetAt > 0 ? mergedResetAt : persistedResetAt,
            } satisfies PersistedRateLimitBucket)
            : localBucket
                ? ({
                    id: docId,
                    count: localBucket.count,
                    resetAt: localBucket.resetAt,
                } satisfies PersistedRateLimitBucket)
                : null;
        const resetAt = bucket && mergedResetAt > 0 ? mergedResetAt : getBucketResetAt(bucket);

        if (!bucket || resetAt <= now) {
            const freshBucket = {
                id: docId,
                count: 1,
                resetAt: now + windowMs,
                updatedAt: nowIso(now),
            } satisfies PersistedRateLimitBucket;

            try {
                await upsertRateLimitBucket(docId, freshBucket.count, freshBucket.resetAt, now);
                writeLocalRateLimitBucket(docId, 1, freshBucket.resetAt);
                return { limited: false, retryAfterSeconds: 0 };
            } catch (error) {
                if (isRateLimitConflictError(error) && attemptIndex < MAX_MUTATION_RETRIES - 1) {
                    continue;
                }
                throw error;
            }
        }

        const nextCount = getBucketCount(bucket) + 1;
        try {
            await upsertRateLimitBucket(docId, nextCount, resetAt, now);
            writeLocalRateLimitBucket(docId, nextCount, resetAt);
            if (nextCount > limit) {
                return {
                    limited: true,
                    retryAfterSeconds: Math.max(1, Math.ceil((resetAt - now) / 1000)),
                };
            }

            return { limited: false, retryAfterSeconds: 0 };
        } catch (error) {
            if (isRateLimitNotFoundError(error) && attemptIndex < MAX_MUTATION_RETRIES - 1) {
                clearLocalRateLimitBucket(docId);
                continue;
            }
            if (isRateLimitConflictError(error) && attemptIndex < MAX_MUTATION_RETRIES - 1) {
                continue;
            }
            throw error;
        }
    }

    throw new Error('Tidak dapat memperbarui rate limit login setelah beberapa percobaan.');
}

export async function clearFailedAttempts(key: string) {
    const docId = buildRateLimitDocId(key);
    clearLocalRateLimitBucket(docId);
    const bucket = await getRateLimitBucket(docId);
    if (!bucket?.id) {
        return;
    }

    try {
        await deleteRateLimitBucket(docId);
    } catch (error) {
        if (isRateLimitConflictError(error) || isRateLimitNotFoundError(error)) {
            return;
        }
        throw error;
    }
}
