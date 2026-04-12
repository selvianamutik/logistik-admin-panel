/* ============================================================
   LOGISTIK — Login API Route (Sanity CMS)
   ============================================================ */

import { getSanityClient, sanityGetById } from '@/lib/sanity';
import { verifyPassword, createSession, hashPassword, isPasswordHashMigrated, setSessionCookie } from '@/lib/auth';
import { isMutationConflictError, writeAuditLog } from '@/lib/api/data-helpers';
import { clearFailedAttempts, getRequestIp, recordLoginAttempt } from '@/lib/api/rate-limit';
import { ensureSameOriginRequest, jsonNoStore, parseJsonBody } from '@/lib/api/request-security';
import { DRIVER_SESSION_COOKIE, SESSION_COOKIE } from '@/lib/session';
import type { Driver, User } from '@/lib/types';

const LOGIN_ATTEMPT_LIMIT = 10;
const LOGIN_WINDOW_MS = 10 * 60 * 1000;
type LoginUser = User & { _rev?: string };

function waitForRetry(delayMs: number) {
    return new Promise<void>(resolve => {
        setTimeout(resolve, delayMs);
    });
}

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
    user: LoginUser,
    plainPassword: string,
    loginScope: 'ADMIN' | 'DRIVER'
): Promise<{ user: User } | { errorResponse: Response }> {
    let candidate: LoginUser | null = user;

    for (let attempt = 0; attempt < 10; attempt += 1) {
        if (!candidate?._rev) {
            return {
                errorResponse: jsonNoStore(
                    { error: 'Revisi akun login tidak tersedia. Coba lagi.' },
                    { status: 409 }
                ),
            };
        }

        if (loginScope === 'DRIVER' && candidate.role !== 'DRIVER') {
            return {
                errorResponse: jsonNoStore(
                    { error: 'Akun ini bukan akun mobile driver' },
                    { status: 403 }
                ),
            };
        }

        if (loginScope === 'ADMIN' && candidate.role === 'DRIVER') {
            return {
                errorResponse: jsonNoStore(
                    { error: 'Akun driver harus login dari aplikasi driver' },
                    { status: 403 }
                ),
            };
        }

        if (candidate.role === 'DRIVER') {
            if (!candidate.driverRef) {
                return {
                    errorResponse: jsonNoStore(
                        { error: 'Akun driver belum terhubung ke data supir' },
                        { status: 409 }
                    ),
                };
            }
            const driver = await sanityGetById<Driver>(candidate.driverRef);
            if (!driver || driver.active === false) {
                return {
                    errorResponse: jsonNoStore(
                        { error: 'Akun driver tidak aktif atau data supir tidak tersedia' },
                        { status: 409 }
                    ),
                };
            }
        }

        const nextPasswordHash = !isPasswordHashMigrated(candidate.passwordHash)
            ? await hashPassword(plainPassword)
            : undefined;
        const lastLoginAt = new Date().toISOString();

        try {
            await getSanityClient()
                .patch(candidate._id)
                .ifRevisionId(candidate._rev)
                .set({
                    lastLoginAt,
                    ...(nextPasswordHash ? { passwordHash: nextPasswordHash } : {}),
                })
                .commit();

            return {
                user: {
                    ...candidate,
                    lastLoginAt,
                    passwordHash: nextPasswordHash || candidate.passwordHash,
                },
            };
        } catch (error) {
            if (!isMutationConflictError(error)) {
                throw error;
            }

            const latest: LoginUser | null = await sanityGetById<LoginUser>(candidate._id);
            if (!latest || latest.active === false) {
                return {
                    errorResponse: jsonNoStore(
                        { error: 'Akun berubah atau tidak aktif. Login ulang.' },
                        { status: 409 }
                    ),
                };
            }

            const latestPasswordValid = await verifyPassword(plainPassword, latest.passwordHash);
            if (!latestPasswordValid) {
                return {
                    errorResponse: jsonNoStore(
                        { error: 'Email atau password salah' },
                        { status: 401 }
                    ),
                };
            }

            candidate = latest;
            await waitForRetry(50 * (attempt + 1));
        }
    }

    return {
        errorResponse: jsonNoStore(
            { error: 'Data akun berubah saat login. Coba lagi.' },
            { status: 409 }
        ),
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

        // Validate types early so TypeScript narrows correctly downstream
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

        // Find user from Sanity
        const user = await getSanityClient().fetch<LoginUser | null>(
            `*[_type == "user" && lower(email) == $email && active == true][0]{ ..., _rev }`,
            { email: normalizedEmail }
        );

        if (!user) {
            return jsonNoStore({ error: 'Email atau password salah' }, { status: 401 });
        }

        // Verify password — normalizedPassword is string ✅
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

        // Create session
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
