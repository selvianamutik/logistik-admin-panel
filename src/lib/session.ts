import { SignJWT, jwtVerify } from 'jose';

import type { SessionUser } from './types';

export const SESSION_COOKIE = 'logistik-session';
export const SESSION_MAX_AGE = 60 * 60 * 24; // 24 hours

function requireEnv(name: string): string {
    const value = process.env[name]?.trim();
    if (!value) {
        throw new Error(`Missing required environment variable: ${name}`);
    }
    return value;
}

export function getJwtSecret(): Uint8Array {
    return new TextEncoder().encode(requireEnv('JWT_SECRET'));
}

export async function createSessionToken(user: SessionUser): Promise<string> {
    return new SignJWT({ user })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime(`${SESSION_MAX_AGE}s`)
        .sign(getJwtSecret());
}

export async function verifySessionToken(token: string): Promise<SessionUser> {
    const { payload } = await jwtVerify(token, getJwtSecret());
    return (payload as { user: SessionUser }).user;
}
