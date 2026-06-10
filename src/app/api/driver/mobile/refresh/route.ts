import {
    createDriverMobileSession,
    createDriverRefreshSession,
    getDriverSessionFromRefreshToken,
} from '@/lib/auth';
import { getDriverAppContext, getDriverPortalAccessNotice, sanitizeDriverForMobile } from '@/lib/api/driver-portal';
import { clearRefreshAttempts, getRequestIp, recordRefreshAttempt } from '@/lib/api/rate-limit';
import { jsonNoStore, parseJsonBody } from '@/lib/api/request-security';
import { getDocumentById } from '@/lib/repositories/document-store';
import { DRIVER_MOBILE_SESSION_MAX_AGE, DRIVER_REFRESH_SESSION_MAX_AGE } from '@/lib/session';
import type { Driver, User } from '@/lib/types';

const REFRESH_ATTEMPT_LIMIT = 20;
const REFRESH_WINDOW_MS = 10 * 60 * 1000;

function buildRefreshRateLimitKey(request: Request, token: string): string {
    return `driver-app-refresh:${getRequestIp(request)}:${token.slice(-8)}`;
}

function tooManyAttemptsResponse(retryAfterSeconds: number) {
    return jsonNoStore(
        { error: 'Terlalu banyak percobaan refresh. Coba lagi beberapa saat lagi.' },
        {
            status: 429,
            headers: {
                'Retry-After': String(retryAfterSeconds),
            },
        }
    );
}

export async function POST(request: Request) {
    try {
        const parsedBody = await parseJsonBody<{ refreshToken?: string }>(request);
        if ('error' in parsedBody) {
            return parsedBody.error;
        }

        const refreshToken = typeof parsedBody.data.refreshToken === 'string'
            ? parsedBody.data.refreshToken.trim()
            : '';
        if (!refreshToken) {
            return jsonNoStore({ error: 'Refresh token driver wajib diisi' }, { status: 400 });
        }

        // SEC-2: Rate limiting on refresh endpoint
        const rateLimitKey = buildRefreshRateLimitKey(request, refreshToken);
        const rateLimitStatus = await recordRefreshAttempt(
            rateLimitKey,
            REFRESH_ATTEMPT_LIMIT,
            REFRESH_WINDOW_MS
        );
        if (rateLimitStatus.limited) {
            return tooManyAttemptsResponse(rateLimitStatus.retryAfterSeconds);
        }

        const session = await getDriverSessionFromRefreshToken(refreshToken);
        if (!session || !session.driverRef) {
            return jsonNoStore({ error: 'Unauthorized' }, { status: 401 });
        }

        const user = await getDocumentById<User>(session._id, 'user');
        if (!user || user.active === false || user.role !== 'DRIVER' || !user.driverRef) {
            return jsonNoStore({ error: 'Akun driver tidak aktif' }, { status: 403 });
        }

        const driver = await getDocumentById<Driver>(user.driverRef, 'driver');
        if (!driver || driver.active === false) {
            return jsonNoStore({ error: 'Data supir tidak aktif atau tidak ditemukan' }, { status: 403 });
        }

        // SEC-1: Token rotation — old refresh token is now invalidated after use
        const token = await createDriverMobileSession(user);
        const nextRefreshToken = await createDriverRefreshSession(user);

        // Clear rate limit on successful refresh
        await clearRefreshAttempts(rateLimitKey);

        const appContext = await getDriverAppContext();
        const driverAccessNotice = await getDriverPortalAccessNotice(driver._id);

        return jsonNoStore({
            success: true,
            token,
            refreshToken: nextRefreshToken,
            expiresIn: DRIVER_MOBILE_SESSION_MAX_AGE,
            refreshExpiresIn: DRIVER_REFRESH_SESSION_MAX_AGE,
            user: {
                _id: user._id,
                name: user.name,
                email: user.email,
                role: user.role,
                driverRef: user.driverRef,
                driverName: user.driverName,
            },
            driver: sanitizeDriverForMobile(driver),
            company: appContext.company,
            driverAccessNotice,
        });
    } catch (error) {
        console.error('Driver mobile refresh error:', error);
        return jsonNoStore({ error: 'Terjadi kesalahan server' }, { status: 500 });
    }
}