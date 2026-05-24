import { SignJWT, jwtVerify } from 'jose';

import type { SessionUser } from './types';

export const SESSION_COOKIE = 'logistik-session';
export const DRIVER_SESSION_COOKIE = 'logistik-driver-session';
export const SESSION_MAX_AGE = 60 * 60 * 24; // 24 hours
export const DRIVER_MOBILE_SESSION_MAX_AGE = 60 * 60 * 24 * 14; // 14 days
export const DRIVER_REFRESH_SESSION_MAX_AGE = 60 * 60 * 24 * 60; // 60 days
export type SessionTokenType = 'access' | 'refresh';

export class SessionConfigError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'SessionConfigError';
    }
}

export function isSessionConfigError(error: unknown): error is SessionConfigError {
    return error instanceof SessionConfigError || (
        typeof error === 'object'
        && error !== null
        && 'name' in error
        && error.name === 'SessionConfigError'
    );
}

function requireEnv(name: string): string {
    const value = process.env[name]?.trim();
    if (!value) {
        throw new SessionConfigError(`Missing required session environment variable: ${name}`);
    }
    return value;
}

export function getJwtSecret(): Uint8Array {
    return new TextEncoder().encode(requireEnv('JWT_SECRET'));
}

export async function createSessionToken(
    user: SessionUser,
    options: { maxAge?: number; tokenType?: SessionTokenType } = {}
): Promise<string> {
    return new SignJWT({ user, tokenType: options.tokenType || 'access' })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime(`${options.maxAge || SESSION_MAX_AGE}s`)
        .sign(getJwtSecret());
}

export async function verifySessionToken(
    token: string,
    options: { tokenType?: SessionTokenType } = {}
): Promise<SessionUser> {
    const { payload } = await jwtVerify(token, getJwtSecret());
    const expectedType = options.tokenType || 'access';
    const tokenType = payload.tokenType;
    if (tokenType && tokenType !== expectedType) {
        throw new Error('Invalid session token type');
    }
    if (!tokenType && expectedType !== 'access') {
        throw new Error('Invalid session token type');
    }
    return (payload as { user: SessionUser }).user;
}
