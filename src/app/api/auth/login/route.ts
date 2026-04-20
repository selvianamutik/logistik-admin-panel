/* ============================================================
   LOGISTIK - Login API Route
   ============================================================ */

import { createSession, hashPassword, isPasswordHashMigrated, setSessionCookie, verifyPassword } from '@/lib/auth';
import { writeAuditLog } from '@/lib/api/data-helpers';
import { clearFailedAttempts, getRequestIp, recordLoginAttempt } from '@/lib/api/rate-limit';
import { ensureSameOriginRequest, jsonNoStore, parseJsonBody } from '@/lib/api/request-security';
import { getDocumentById } from '@/lib/repositories/document-store';
import { findActiveUserByEmail, updateUserLoginState } from '@/lib/repositories/user-store';
import { DRIVER_SESSION_COOKIE, SESSION_COOKIE } from '@/lib/session';
import type { Driver, User } from '@/lib/types';

const LOGIN_ATTEMPT_LIMIT = 10;
const LOGIN_WINDOW_MS = 10 * 60 * 1000;

function buildLoginRateLimitKey(request: Request, email: string, scope: 'ADMIN' | 'DRIVER') {
    return `login:${scope}:${email.toLowerCase()}:${getRequestIp(request)}`;
}

function tooManyAttemptsResponse(retryAfterSeconds: number) {
    return jsonNoStore(
        { error: 'Terlalu banyak percobaan login. Coba lagi beberapa saat lagi.' },
        {
            status: 429,
            headers: { 'Retry-After': String(retryAfterSeconds) },
        }
    );
}

export async function GET() {
    return jsonNoStore({ error: 'Use POST method', methods: ['POST'] }, { status: 405 });
}

async function syncSuccessfulLogin(
    user: User,
    plainPassword: string,
    loginScope: 'ADMIN' | 'DRIVER'
): Promise<{ user: User } | { errorResponse: Response }> {
    if (loginScope === 'DRIVER' && user.role !== 'DRIVER') {
        return {
            errorResponse: jsonNoStore(
                { error: 'Akun ini bukan akun mobile driver' },
                { status: 403 }
            ),
        };
    }

    if (loginScope === 'ADMIN' && user.role === 'DRIVER') {
        return {
            errorResponse: jsonNoStore(
                { error: 'Akun driver harus login dari aplikasi driver' },
                { status: 403 }
            ),
        };
    }

    if (user.role === 'DRIVER') {
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
    }

    const nextPasswordHash = !isPasswordHashMigrated(user.passwordHash)
        ? await hashPassword(plainPassword)
        : undefined;
    const lastLoginAt = new Date().toISOString();
    const updated = await updateUserLoginState(user._id, {
        lastLoginAt,
        passwordHash: nextPasswordHash,
    });

    return {
        user: {
            ...user,
            ...updated,
            lastLoginAt,
            passwordHash: nextPasswordHash || user.passwordHash,
        },
    };
}

export async function POST(request: Request) {
    try {
        const originError = ensureSameOriginRequest(request);
        if (originError) return originError;

        const parsedBody = await parseJsonBody<{
            email?: unknown;
            password?: unknown;
            scope?: unknown;
        }>(request);
        if ('error' in parsedBody) {
            return parsedBody.error;
        }
        const body = parsedBody.data;

        const { email, password, scope } = body;
        const loginScope = scope === 'DRIVER' ? 'DRIVER' : 'ADMIN';
        const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
        const normalizedPassword = typeof password === 'string' ? password : '';

        if (!normalizedEmail || !normalizedPassword) {
            return jsonNoStore(
                { error: 'Email dan password wajib diisi' },
                { status: 400 }
            );
        }

        const rateLimitKey = buildLoginRateLimitKey(request, normalizedEmail, loginScope);
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

        const isValid = await verifyPassword(normalizedPassword, user.passwordHash);
        if (!isValid) {
            return jsonNoStore({ error: 'Email atau password salah' }, { status: 401 });
        }

        const syncResult = await syncSuccessfulLogin(user, normalizedPassword, loginScope);
        if ('errorResponse' in syncResult) {
            return syncResult.errorResponse;
        }
        const syncedUser = syncResult.user;

        await clearFailedAttempts(rateLimitKey);

        const token = await createSession(syncedUser);
        await setSessionCookie(
            token,
            loginScope === 'DRIVER' ? DRIVER_SESSION_COOKIE : SESSION_COOKIE
        );
        await writeAuditLog(
            { _id: syncedUser._id, name: syncedUser.name, email: syncedUser.email, role: syncedUser.role },
            'LOGIN',
            loginScope === 'DRIVER' ? 'driver-web-auth' : 'admin-web-auth',
            syncedUser._id,
            loginScope === 'DRIVER' ? 'Login portal driver' : 'Login admin web'
        );

        return jsonNoStore({
            success: true,
            user: {
                _id: syncedUser._id,
                name: syncedUser.name,
                email: syncedUser.email,
                role: syncedUser.role,
                driverRef: syncedUser.driverRef,
            },
        });
    } catch (err) {
        console.error('Login error:', err);
        return jsonNoStore({ error: 'Terjadi kesalahan server' }, { status: 500 });
    }
}
