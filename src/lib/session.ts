import { SignJWT, jwtVerify, importPKCS8, importSPKI } from 'jose';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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

// SEC-3: Support both RS256 (preferred) and HS256 (legacy fallback)
// RS256 = asymmetric: private key signs, public key verifies.
// HS256 = symmetric: same secret signs and verifies.
// If RSA key files exist, use RS256. Otherwise fall back to HS256.
function getJwtSigningConfig(): { alg: string; signingKey: string; verificationKey: string } {
    const privateKeyPath = process.env['JWT_RSA_PRIVATE_KEY_PATH']?.trim();
    const publicKeyPath = process.env['JWT_RSA_PUBLIC_KEY_PATH']?.trim();

    if (privateKeyPath && publicKeyPath) {
        try {
            const baseDir = process.cwd();
            const privatePem = readFileSync(join(baseDir, privateKeyPath), 'utf8').trim();
            const publicPem = readFileSync(join(baseDir, publicKeyPath), 'utf8').trim();
            if (privatePem.includes('-----BEGIN') && publicPem.includes('-----BEGIN')) {
                return { alg: 'RS256', signingKey: privatePem, verificationKey: publicPem };
            }
        } catch {
            // Fall through to HS256
        }
    }

    // Legacy HS256 mode
    return {
        alg: 'HS256',
        signingKey: requireEnv('JWT_SECRET'),
        verificationKey: requireEnv('JWT_SECRET'),
    };
}

export async function createSessionToken(
    user: SessionUser,
    options: { maxAge?: number; tokenType?: SessionTokenType } = {}
): Promise<string> {
    const { alg, signingKey } = getJwtSigningConfig();
    const maxAge = options.maxAge || SESSION_MAX_AGE;

    if (alg === 'RS256') {
        // For RS256, import PEM key as CryptoKey then sign
        const cryptoKey = await importPKCS8(signingKey, 'RS256');
        return new SignJWT({ user, tokenType: options.tokenType || 'access' })
            .setProtectedHeader({ alg: 'RS256' })
            .setIssuedAt()
            .setExpirationTime(`${maxAge}s`)
            .sign(cryptoKey);
    }

    // HS256
    const key = new TextEncoder().encode(signingKey);
    return new SignJWT({ user, tokenType: options.tokenType || 'access' })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime(`${maxAge}s`)
        .sign(key);
}

export async function verifySessionToken(
    token: string,
    options: { tokenType?: SessionTokenType } = {}
): Promise<SessionUser> {
    const { alg, verificationKey } = getJwtSigningConfig();
    const expectedType = options.tokenType || 'access';

    // Try the configured algorithm first
    try {
        let key;
        if (alg === 'RS256') {
            key = await importSPKI(verificationKey, 'RS256');
        } else {
            key = new TextEncoder().encode(verificationKey);
        }
        const { payload } = await jwtVerify(token, key, { algorithms: [alg] });
        const tokenType = payload.tokenType;
        if (tokenType && tokenType !== expectedType) {
            throw new Error('Invalid session token type');
        }
        if (!tokenType && expectedType !== 'access') {
            throw new Error('Invalid session token type');
        }
        return (payload as { user: SessionUser }).user;
    } catch (primaryError) {
        // If RS256 fails and we have HS256 configured, try HS256 as fallback
        // This handles the transition period where existing tokens are HS256
        if (alg === 'RS256') {
            try {
                const hsKey = new TextEncoder().encode(process.env['JWT_SECRET']?.trim() || '');
                if (hsKey.length > 0) {
                    const { payload } = await jwtVerify(token, hsKey, { algorithms: ['HS256'] });
                    const tokenType = payload.tokenType;
                    if (tokenType && tokenType !== expectedType) {
                        throw new Error('Invalid session token type');
                    }
                    if (!tokenType && expectedType !== 'access') {
                        throw new Error('Invalid session token type');
                    }
                    return (payload as { user: SessionUser }).user;
                }
            } catch {
                // Fall through to primary error
            }
        }
        throw primaryError;
    }
}