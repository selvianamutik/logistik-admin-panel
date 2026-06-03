/* ============================================================
   LOGISTIK - Login API Route
   ============================================================ */

import { createSession, setSessionCookie, verifyPassword } from '@/lib/auth';
import { writeAuditLog } from '@/lib/api/data-helpers';
import { clearFailedAttempts, getRequestIp, recordLoginAttempt } from '@/lib/api/rate-limit';
import { ensureSameOriginRequest, jsonNoStore, parseJsonBody } from '@/lib/api/request-security';
import { findActiveUserByEmail, updateUserLoginState } from '@/lib/repositories/user-store';
import { isSessionConfigError, SESSION_COOKIE } from '@/lib/session';
import { isSupabaseConfigError, SupabaseServiceError } from '@/lib/supabase';
import type { User } from '@/lib/types';

const LOGIN_ATTEMPT_LIMIT = 10;
const LOGIN_WINDOW_MS = 10 * 60 * 1000;

function buildLoginRateLimitKey(request: Request, email: string) {
    return `login:ADMIN:${email.toLowerCase()}:${getRequestIp(request)}`;
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

function serverLoginErrorResponse(error: unknown) {
    if (isSupabaseConfigError(error) || isSessionConfigError(error)) {
        return jsonNoStore(
            {
                error: 'Konfigurasi server belum lengkap. Hubungi admin sistem.',
                code: 'SERVER_CONFIG_ERROR',
            },
            { status: 503 }
        );
    }

    if (error instanceof SupabaseServiceError && (error.status === 401 || error.status === 403)) {
        return jsonNoStore(
            {
                error: 'Konfigurasi database tidak valid. Hubungi admin sistem.',
                code: 'DATABASE_AUTH_ERROR',
            },
            { status: 503 }
        );
    }

    return jsonNoStore({ error: 'Terjadi kesalahan server' }, { status: 500 });
}

export async function GET() {
    return jsonNoStore({ error: 'Use POST method', methods: ['POST'] }, { status: 405 });
}

async function syncSuccessfulLogin(
    user: User
): Promise<{ user: User } | { errorResponse: Response }> {
    if (user.role === 'DRIVER') {
        return {
            errorResponse: jsonNoStore(
                { error: 'Akun driver harus login dari aplikasi driver' },
                { status: 403 }
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

        const { email, password } = body;
        const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
        const normalizedPassword = typeof password === 'string' ? password : '';

        if (!normalizedEmail || !normalizedPassword) {
            return jsonNoStore(
                { error: 'Email dan password wajib diisi' },
                { status: 400 }
            );
        }

        const rateLimitKey = buildLoginRateLimitKey(request, normalizedEmail);
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

        const syncResult = await syncSuccessfulLogin(user);
        if ('errorResponse' in syncResult) {
            return syncResult.errorResponse;
        }
        const syncedUser = syncResult.user;

        await clearFailedAttempts(rateLimitKey);

        const token = await createSession(syncedUser);
        await setSessionCookie(token, SESSION_COOKIE);
        await writeAuditLog(
            { _id: syncedUser._id, name: syncedUser.name, email: syncedUser.email, role: syncedUser.role },
            'LOGIN',
            'admin-web-auth',
            syncedUser._id,
            'Login admin web'
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
        return serverLoginErrorResponse(err);
    }
}
