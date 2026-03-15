/* ============================================================
   LOGISTIK — Login API Route (Sanity CMS)
   ============================================================ */

import { NextResponse } from 'next/server';
import { getSanityClient, sanityGetById, sanityUpdate } from '@/lib/sanity';
import { verifyPassword, createSession, hashPassword, isPasswordHashMigrated, setSessionCookie } from '@/lib/auth';
import { clearFailedAttempts, getRequestIp, recordFailedAttempt } from '@/lib/api/rate-limit';
import { ensureSameOriginRequest } from '@/lib/api/request-security';
import type { Driver, User } from '@/lib/types';
import { debug } from 'console';

const LOGIN_ATTEMPT_LIMIT = 10;
const LOGIN_WINDOW_MS = 10 * 60 * 1000;

function buildLoginRateLimitKey(request: Request, email: string, scope: 'ADMIN' | 'DRIVER') {
    return `login:${scope}:${email.toLowerCase()}:${getRequestIp(request)}`;
}

function tooManyAttemptsResponse(retryAfterSeconds: number) {
    return NextResponse.json(
        { error: 'Terlalu banyak percobaan login. Coba lagi beberapa saat lagi.' },
        {
            status: 429,
            headers: {
                'Retry-After': String(retryAfterSeconds),
            },
        }
    );
}

export async function GET() {
    return NextResponse.json({ error: 'Use POST method', methods: ['POST'] }, { status: 405 });
}

export async function POST(request: Request) {
    try {
        const body = await request.json() as {
            email?: unknown;
            password?: unknown;
            scope?: unknown;
        };
        const { email, password, scope } = body;
        const loginScope = scope === 'DRIVER' ? 'DRIVER' : 'ADMIN';
        const clientType = request.headers.get('x-client-type')?.trim().toLowerCase();
        const isDriverAppClient = clientType === 'driver-app';

        if (!isDriverAppClient && loginScope !== 'DRIVER') {
            const originError = ensureSameOriginRequest(request);
            if (originError) {
                return originError;
            }
        }

        const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
        const rateLimitKey = buildLoginRateLimitKey(request, normalizedEmail || 'unknown', loginScope);

        if (!normalizedEmail || !password) {
            return NextResponse.json(
                { error: 'Email dan password wajib diisi' },
                { status: 400 }
            );
        }

        // Find user from Sanity
        const user = await getSanityClient().fetch<User | null>(
            `*[_type == "user" && email == $email && active == true][0]`,
            { email: normalizedEmail }
        );

        if (!user) {
            const attempt = recordFailedAttempt(rateLimitKey, LOGIN_ATTEMPT_LIMIT, LOGIN_WINDOW_MS);
            if (attempt.limited) {
                return tooManyAttemptsResponse(attempt.retryAfterSeconds);
            }
            return NextResponse.json(
                { error: 'Email atau password salah' },
                { status: 401 }
            );
        }

        // Verify password
        const isValid = await verifyPassword(password, user.passwordHash);
        if (!isValid) {
            const attempt = recordFailedAttempt(rateLimitKey, LOGIN_ATTEMPT_LIMIT, LOGIN_WINDOW_MS);
            if (attempt.limited) {
                return tooManyAttemptsResponse(attempt.retryAfterSeconds);
            }
            return NextResponse.json(
                { error: 'Email atau password salah' },
                { status: 401 }
            );
        }

        let nextPasswordHash: string | undefined;
        if (!isPasswordHashMigrated(user.passwordHash)) {
            nextPasswordHash = await hashPassword(password);
        }

        if (loginScope === 'DRIVER' && user.role !== 'DRIVER') {
            return NextResponse.json(
                { error: 'Akun ini bukan akun mobile driver' },
                { status: 403 }
            );
        }

        if (loginScope === 'ADMIN' && user.role === 'DRIVER') {
            return NextResponse.json(
                { error: 'Akun driver harus login dari aplikasi driver' },
                { status: 403 }
            );
        }

        if (user.role === 'DRIVER') {
            if (!user.driverRef) {
                return NextResponse.json(
                    { error: 'Akun driver belum terhubung ke data supir' },
                    { status: 409 }
                );
            }

            const driver = await sanityGetById<Driver>(user.driverRef);
            if (!driver || driver.active === false) {
                return NextResponse.json(
                    { error: 'Akun driver tidak aktif atau data supir tidak tersedia' },
                    { status: 409 }
                );
            }
        }

        clearFailedAttempts(rateLimitKey);

        const lastLoginAt = new Date().toISOString();
        await sanityUpdate(user._id, {
            lastLoginAt,
            ...(nextPasswordHash ? { passwordHash: nextPasswordHash } : {}),
        });
        user.lastLoginAt = lastLoginAt;
        if (nextPasswordHash) {
            user.passwordHash = nextPasswordHash;
        }

        // Create session
        const token = await createSession(user);
        await setSessionCookie(token);

        return NextResponse.json({
            success: true,
            token,
            user: {
                _id: user._id,
                name: user.name,
                email: user.email,
                role: user.role,
                driverRef: user.driverRef,
            },
        });
    } catch (err) {
        console.error('Login error:', err);
        return NextResponse.json(
            { error: 'Terjadi kesalahan server' },
            { status: 500 }
        );
    }
}
