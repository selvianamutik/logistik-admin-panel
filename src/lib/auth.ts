/* ============================================================
   LOGISTIK - Auth Utilities
   JWT sessions with httpOnly cookies
   ============================================================ */

import { compare, hash } from 'bcryptjs';
import { cookies, headers } from 'next/headers';

import type { SessionUser, User } from './types';
import {
    createSessionToken,
    SESSION_COOKIE,
    SESSION_MAX_AGE,
    verifySessionToken,
} from './session';

const BCRYPT_PREFIX = /^\$2[aby]\$/;

export async function verifyPassword(plainPassword: string, storedHash: string): Promise<boolean> {
    if (!storedHash) return false;
    if (BCRYPT_PREFIX.test(storedHash)) {
        return compare(plainPassword, storedHash);
    }
    // Transitional support for legacy plaintext rows already stored in Sanity.
    return plainPassword === storedHash;
}

export async function hashPassword(password: string): Promise<string> {
    return hash(password, 10);
}

export async function createSession(user: User): Promise<string> {
    const payload: SessionUser = {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
    };

    return createSessionToken(payload);
}

export async function getSession(): Promise<SessionUser | null> {
    try {
        const cookieStore = await cookies();
        const token = cookieStore.get(SESSION_COOKIE)?.value;
        if (!token) return null;

        return await verifySessionToken(token);
    } catch {
        return null;
    }
}

async function shouldUseSecureCookies(): Promise<boolean> {
    if (process.env.NODE_ENV !== 'production') return false;

    const headerStore = await headers();
    const forwardedProto = headerStore.get('x-forwarded-proto')?.toLowerCase();
    if (forwardedProto) {
        return forwardedProto === 'https';
    }

    const host = headerStore.get('host')?.toLowerCase() ?? '';
    return !/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
}

export async function setSessionCookie(token: string): Promise<void> {
    const cookieStore = await cookies();
    cookieStore.set(SESSION_COOKIE, token, {
        httpOnly: true,
        secure: await shouldUseSecureCookies(),
        sameSite: 'lax',
        maxAge: SESSION_MAX_AGE,
        path: '/',
    });
}

export async function clearSession(): Promise<void> {
    const cookieStore = await cookies();
    cookieStore.delete(SESSION_COOKIE);
}
