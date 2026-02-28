/* ============================================================
   LOGISTIK — Auth Utilities
   JWT sessions with httpOnly cookies
   ============================================================ */

import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import { SessionUser, User } from './types';

const JWT_SECRET = new TextEncoder().encode(
    process.env.JWT_SECRET || 'logistik-admin-panel-secret-key-2026-very-secure'
);

const SESSION_COOKIE = 'logistik-session';
const SESSION_MAX_AGE = 60 * 60 * 24; // 24 hours

// ── Password Comparison (simplified for demo — no bcrypt dependency needed) ──
export function verifyPassword(plainPassword: string, storedHash: string): boolean {
    // For demo: direct comparison with known password
    // In production: use bcrypt.compare
    if (storedHash === '$2a$10$dummyhashforTEST1234ownerpassword') {
        return plainPassword === 'TEST1234';
    }
    // For dynamically created users, we store password directly (demo only)
    return plainPassword === storedHash;
}

export function hashPassword(password: string): string {
    // For demo: store directly (in production use bcrypt)
    return password;
}

// ── JWT ──
export async function createSession(user: User): Promise<string> {
    const payload: SessionUser = {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
    };

    const token = await new SignJWT({ user: payload })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime(`${SESSION_MAX_AGE}s`)
        .sign(JWT_SECRET);

    return token;
}

export async function getSession(): Promise<SessionUser | null> {
    try {
        const cookieStore = await cookies();
        const token = cookieStore.get(SESSION_COOKIE)?.value;
        if (!token) return null;

        const { payload } = await jwtVerify(token, JWT_SECRET);
        return (payload as { user: SessionUser }).user;
    } catch {
        return null;
    }
}

export async function setSessionCookie(token: string): Promise<void> {
    const cookieStore = await cookies();
    cookieStore.set(SESSION_COOKIE, token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: SESSION_MAX_AGE,
        path: '/',
    });
}

export async function clearSession(): Promise<void> {
    const cookieStore = await cookies();
    cookieStore.delete(SESSION_COOKIE);
}
