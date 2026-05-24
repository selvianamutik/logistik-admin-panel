import { createDriverMobileSession, createDriverRefreshSession, verifyPassword } from '@/lib/auth';
import { writeAuditLog } from '@/lib/api/data-helpers';
import { getDriverAppContext, getDriverPortalAccessNotice, sanitizeDriverForMobile } from '@/lib/api/driver-portal';
import { clearFailedAttempts, getRequestIp, recordLoginAttempt } from '@/lib/api/rate-limit';
import { jsonNoStore, parseJsonBody } from '@/lib/api/request-security';
import { getDocumentById } from '@/lib/repositories/document-store';
import { findActiveUserByEmail, updateUserLoginState } from '@/lib/repositories/user-store';
import { DRIVER_MOBILE_SESSION_MAX_AGE, DRIVER_REFRESH_SESSION_MAX_AGE } from '@/lib/session';
import type { Driver, User } from '@/lib/types';

const LOGIN_ATTEMPT_LIMIT = 10;
const LOGIN_WINDOW_MS = 10 * 60 * 1000;

function buildLoginRateLimitKey(request: Request, email: string) {
    return `driver-app-login:${email.toLowerCase()}:${getRequestIp(request)}`;
}

function tooManyAttemptsResponse(retryAfterSeconds: number) {
    return jsonNoStore(
        { error: 'Terlalu banyak percobaan login. Coba lagi beberapa saat lagi.' },
        {
            status: 429,
            headers: {
                'Retry-After': String(retryAfterSeconds),
            },
        }
    );
}

async function syncSuccessfulDriverLogin(user: User): Promise<{ user: User; driver: Driver } | { errorResponse: Response }> {
    if (user.role !== 'DRIVER') {
        return {
            errorResponse: jsonNoStore(
                { error: 'Akun ini bukan akun mobile driver' },
                { status: 403 }
            ),
        };
    }

    if (!user.driverRef) {
        return {
            errorResponse: jsonNoStore(
                { error: 'Akun driver belum terhubung ke data supir' },
                { status: 409 }
            ),
        };
    }

    const driver = await getDocumentById<Driver>(user.driverRef, 'driver');
    if (!driver || driver.active === false) {
        return {
            errorResponse: jsonNoStore(
                { error: 'Akun driver tidak aktif atau data supir tidak tersedia' },
                { status: 409 }
            ),
        };
    }

    const lastLoginAt = new Date().toISOString();
    const updated = await updateUserLoginState(user._id, {
        lastLoginAt,
    });

    return {
        user: {
            ...user,
            ...updated,
            lastLoginAt,
        },
        driver,
    };
}

export async function POST(request: Request) {
    try {
        const parsedBody = await parseJsonBody<{ email?: string; password?: string }>(request);
        if ('error' in parsedBody) {
            return parsedBody.error;
        }
        const { email, password } = parsedBody.data;
        const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
        const rateLimitKey = buildLoginRateLimitKey(request, normalizedEmail || 'unknown');

        if (!normalizedEmail || !password) {
            return jsonNoStore({ error: 'Email dan password wajib diisi' }, { status: 400 });
        }

        const rateLimitStatus = await recordLoginAttempt(
            rateLimitKey,
            LOGIN_ATTEMPT_LIMIT,
            LOGIN_WINDOW_MS
        );
        if (rateLimitStatus.limited) {
            return tooManyAttemptsResponse(rateLimitStatus.retryAfterSeconds);
        }

        const user = await findActiveUserByEmail(normalizedEmail);
        if (!user) {
            return jsonNoStore({ error: 'Email atau password salah' }, { status: 401 });
        }

        const isValid = await verifyPassword(password, user.passwordHash);
        if (!isValid) {
            return jsonNoStore({ error: 'Email atau password salah' }, { status: 401 });
        }

        const syncResult = await syncSuccessfulDriverLogin(user);
        if ('errorResponse' in syncResult) {
            return syncResult.errorResponse;
        }
        const syncedUser = syncResult.user;
        const driver = syncResult.driver;

        await clearFailedAttempts(rateLimitKey);

        const token = await createDriverMobileSession(syncedUser);
        const refreshToken = await createDriverRefreshSession(syncedUser);
        const appContext = await getDriverAppContext();
        const driverAccessNotice = await getDriverPortalAccessNotice(driver._id);
        await writeAuditLog(
            { _id: syncedUser._id, name: syncedUser.name, email: syncedUser.email, role: syncedUser.role },
            'LOGIN',
            'driver-mobile-auth',
            syncedUser._id,
            'Login aplikasi driver'
        );

        return jsonNoStore({
            success: true,
            token,
            refreshToken,
            expiresIn: DRIVER_MOBILE_SESSION_MAX_AGE,
            refreshExpiresIn: DRIVER_REFRESH_SESSION_MAX_AGE,
            user: {
                _id: syncedUser._id,
                name: syncedUser.name,
                email: syncedUser.email,
                role: syncedUser.role,
                driverRef: syncedUser.driverRef,
                driverName: syncedUser.driverName,
            },
            driver: sanitizeDriverForMobile(driver),
            company: appContext.company,
            driverAccessNotice,
        });
    } catch (error) {
        console.error('Driver mobile login error:', error);
        return jsonNoStore({ error: 'Terjadi kesalahan server' }, { status: 500 });
    }
}
