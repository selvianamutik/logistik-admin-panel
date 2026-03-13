import { NextResponse } from 'next/server';

import { createSession, hashPassword, isPasswordHashMigrated, verifyPassword } from '@/lib/auth';
import { getDriverAppContext } from '@/lib/api/driver-portal';
import { clearFailedAttempts, getRequestIp, recordFailedAttempt } from '@/lib/api/rate-limit';
import { sanityGetById, sanityUpdate, getSanityClient } from '@/lib/sanity';
import type { Driver, User } from '@/lib/types';

const LOGIN_ATTEMPT_LIMIT = 10;
const LOGIN_WINDOW_MS = 10 * 60 * 1000;

function buildLoginRateLimitKey(request: Request, email: string) {
    return `driver-mobile-login:${email.toLowerCase()}:${getRequestIp(request)}`;
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

export async function POST(request: Request) {
    try {
        const { email, password } = await request.json() as { email?: string; password?: string };
        const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
        const rateLimitKey = buildLoginRateLimitKey(request, normalizedEmail || 'unknown');

        if (!normalizedEmail || !password) {
            return NextResponse.json({ error: 'Email dan password wajib diisi' }, { status: 400 });
        }

        const user = await getSanityClient().fetch<User | null>(
            `*[_type == "user" && lower(email) == $email && active == true][0]`,
            { email: normalizedEmail }
        );

        if (!user) {
            const attempt = recordFailedAttempt(rateLimitKey, LOGIN_ATTEMPT_LIMIT, LOGIN_WINDOW_MS);
            if (attempt.limited) {
                return tooManyAttemptsResponse(attempt.retryAfterSeconds);
            }
            return NextResponse.json({ error: 'Email atau password salah' }, { status: 401 });
        }

        if (user.role !== 'DRIVER') {
            const attempt = recordFailedAttempt(rateLimitKey, LOGIN_ATTEMPT_LIMIT, LOGIN_WINDOW_MS);
            if (attempt.limited) {
                return tooManyAttemptsResponse(attempt.retryAfterSeconds);
            }
            return NextResponse.json({ error: 'Akun ini bukan akun mobile driver' }, { status: 403 });
        }

        if (!user.driverRef) {
            return NextResponse.json({ error: 'Akun driver belum terhubung ke data supir' }, { status: 409 });
        }

        const isValid = await verifyPassword(password, user.passwordHash);
        if (!isValid) {
            const attempt = recordFailedAttempt(rateLimitKey, LOGIN_ATTEMPT_LIMIT, LOGIN_WINDOW_MS);
            if (attempt.limited) {
                return tooManyAttemptsResponse(attempt.retryAfterSeconds);
            }
            return NextResponse.json({ error: 'Email atau password salah' }, { status: 401 });
        }

        const driver = await sanityGetById<Driver>(user.driverRef);
        if (!driver || driver.active === false) {
            return NextResponse.json({ error: 'Akun driver tidak aktif atau data supir tidak tersedia' }, { status: 409 });
        }

        let nextPasswordHash: string | undefined;
        if (!isPasswordHashMigrated(user.passwordHash)) {
            nextPasswordHash = await hashPassword(password);
        }

        const lastLoginAt = new Date().toISOString();
        await sanityUpdate(user._id, {
            lastLoginAt,
            ...(nextPasswordHash ? { passwordHash: nextPasswordHash } : {}),
        });

        clearFailedAttempts(rateLimitKey);

        const token = await createSession({
            ...user,
            lastLoginAt,
            passwordHash: nextPasswordHash || user.passwordHash,
        });
        const appContext = await getDriverAppContext();

        return NextResponse.json({
            success: true,
            token,
            expiresIn: 60 * 60 * 24,
            user: {
                _id: user._id,
                name: user.name,
                email: user.email,
                role: user.role,
                driverRef: user.driverRef,
                driverName: user.driverName,
            },
            driver,
            company: appContext.company,
        });
    } catch (error) {
        console.error('Driver mobile login error:', error);
        return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 });
    }
}
