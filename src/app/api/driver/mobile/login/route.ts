import { createSession, hashPassword, isPasswordHashMigrated, verifyPassword } from '@/lib/auth';
import { isMutationConflictError, writeAuditLog } from '@/lib/api/data-helpers';
import { getDriverAppContext, getDriverPortalAccessNotice, sanitizeDriverForMobile } from '@/lib/api/driver-portal';
import { clearFailedAttempts, getRequestIp, recordLoginAttempt } from '@/lib/api/rate-limit';
import { jsonNoStore, parseJsonBody } from '@/lib/api/request-security';
import { sanityGetById, getSanityClient } from '@/lib/sanity';
import type { Driver, User } from '@/lib/types';

const LOGIN_ATTEMPT_LIMIT = 10;
const LOGIN_WINDOW_MS = 10 * 60 * 1000;
type LoginUser = User & { _rev?: string };

function waitForRetry(delayMs: number) {
    return new Promise<void>(resolve => {
        setTimeout(resolve, delayMs);
    });
}

function buildLoginRateLimitKey(request: Request, email: string) {
    return `driver-app-login:${email.toLowerCase()}:${getRequestIp(request)}`;
}

function tooManyAttemptsResponse(retryAfterSeconds: number) {
    return jsonNoStore(
        { error: 'Terlalu banyak percobaan login. Coba lagi beberapa saat lagi.' },
        {
            status: 429,
            headers: {
                'Retry-After': String(retryAfterSeconds),
            },
        }
    );
}

async function syncSuccessfulDriverLogin(
    user: LoginUser,
    plainPassword: string
): Promise<{ user: User; driver: Driver } | { errorResponse: Response }> {
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

        if (candidate.role !== 'DRIVER') {
            return {
                errorResponse: jsonNoStore(
                    { error: 'Akun ini bukan akun mobile driver' },
                    { status: 403 }
                ),
            };
        }

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
                driver,
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
        const parsedBody = await parseJsonBody<{ email?: string; password?: string }>(request);
        if ('error' in parsedBody) {
            return parsedBody.error;
        }
        const { email, password } = parsedBody.data;
        const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
        const rateLimitKey = buildLoginRateLimitKey(request, normalizedEmail || 'unknown');

        if (!normalizedEmail || !password) {
            return jsonNoStore({ error: 'Email dan password wajib diisi' }, { status: 400 });
        }

        const rateLimitStatus = await recordLoginAttempt(
            rateLimitKey,
            LOGIN_ATTEMPT_LIMIT,
            LOGIN_WINDOW_MS
        );
        if (rateLimitStatus.limited) {
            return tooManyAttemptsResponse(rateLimitStatus.retryAfterSeconds);
        }

        const user = await getSanityClient().fetch<LoginUser | null>(
            `*[_type == "user" && lower(email) == $email && active == true][0]{ ..., _rev }`,
            { email: normalizedEmail }
        );

        if (!user) {
            return jsonNoStore({ error: 'Email atau password salah' }, { status: 401 });
        }

        const isValid = await verifyPassword(password, user.passwordHash);
        if (!isValid) {
            return jsonNoStore({ error: 'Email atau password salah' }, { status: 401 });
        }

        const syncResult = await syncSuccessfulDriverLogin(user, password);
        if ('errorResponse' in syncResult) {
            return syncResult.errorResponse;
        }
        const syncedUser = syncResult.user;
        const driver = syncResult.driver;

        await clearFailedAttempts(rateLimitKey);

        const token = await createSession(syncedUser);
        const appContext = await getDriverAppContext();
        const driverAccessNotice = await getDriverPortalAccessNotice(driver._id);
        await writeAuditLog(
            { _id: syncedUser._id, name: syncedUser.name, email: syncedUser.email, role: syncedUser.role },
            'LOGIN',
            'driver-mobile-auth',
            syncedUser._id,
            'Login aplikasi driver'
        );

        return jsonNoStore({
            success: true,
            token,
            expiresIn: 60 * 60 * 24,
            user: {
                _id: syncedUser._id,
                name: syncedUser.name,
                email: syncedUser.email,
                role: syncedUser.role,
                driverRef: syncedUser.driverRef,
                driverName: syncedUser.driverName,
            },
            driver: sanitizeDriverForMobile(driver),
            company: appContext.company,
            driverAccessNotice,
        });
    } catch (error) {
        console.error('Driver mobile login error:', error);
        return jsonNoStore({ error: 'Terjadi kesalahan server' }, { status: 500 });
    }
}
