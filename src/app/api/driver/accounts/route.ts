import { createHash } from 'node:crypto';
import { hashPassword } from '@/lib/auth';
import { isMutationConflictError, sanitizeUserForClient } from '@/lib/api/data-helpers';
import { requireInternalSession } from '@/lib/api/driver-portal';
import { ensureSameOriginRequest, jsonNoStore, parseJsonBody } from '@/lib/api/request-security';
import { getSanityClient, sanityCreate, sanityGetById } from '@/lib/sanity';
import type { Driver, User } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type UniqueConstraintMutationSpec = {
    id: string;
    message: string;
    doc: {
        _id: string;
        _type: 'uniqueConstraint';
        entityType: string;
        fieldName: string;
        value: string;
        valueLower: string;
        ownerRef: string;
        ownerType: string;
        createdAt: string;
        updatedAt: string;
    };
};

function buildUniqueConstraintId(entityType: string, fieldName: string, value: string) {
    const normalizedValue = value.trim().toLowerCase();
    const encodedValue = Buffer.from(normalizedValue, 'utf8').toString('base64url');
    const directId = `unique-constraint.${entityType}.${fieldName}.${encodedValue}`;
    if (directId.length <= 128) {
        return directId;
    }
    const hash = createHash('sha256')
        .update(`${entityType}:${fieldName}:${normalizedValue}`)
        .digest('base64url')
        .slice(0, 32);
    return `unique-constraint.${entityType}.${fieldName}.h${hash}`;
}

function buildUniqueConstraintSpec(params: {
    entityType: string;
    fieldName: string;
    ownerRef: string;
    ownerType: string;
    value: string;
    message: string;
}) {
    const normalizedValue = params.value.trim();
    const timestamp = new Date().toISOString();
    const id = buildUniqueConstraintId(params.entityType, params.fieldName, normalizedValue);
    return {
        id,
        message: params.message,
        doc: {
            _id: id,
            _type: 'uniqueConstraint' as const,
            entityType: params.entityType,
            fieldName: params.fieldName,
            value: normalizedValue,
            valueLower: normalizedValue.toLowerCase(),
            ownerRef: params.ownerRef,
            ownerType: params.ownerType,
            createdAt: timestamp,
            updatedAt: timestamp,
        },
    } satisfies UniqueConstraintMutationSpec;
}

function buildDriverUserConstraintSpecs(userId: string, doc: Record<string, unknown>) {
    const specs: UniqueConstraintMutationSpec[] = [];
    const email = normalizeText(doc.email).toLowerCase();
    if (email) {
        specs.push(buildUniqueConstraintSpec({
            entityType: 'user',
            fieldName: 'email',
            ownerRef: userId,
            ownerType: 'user',
            value: email,
            message: 'Email user sudah digunakan',
        }));
    }
    const driverRef = normalizeText(doc.driverRef);
    if (driverRef) {
        specs.push(buildUniqueConstraintSpec({
            entityType: 'user',
            fieldName: 'driverRef',
            ownerRef: userId,
            ownerType: 'user',
            value: driverRef,
            message: 'Supir ini sudah memiliki akun mobile',
        }));
    }
    return specs;
}

function appendUniqueConstraintMutations(
    transaction: ReturnType<ReturnType<typeof getSanityClient>['transaction']>,
    currentSpecs: UniqueConstraintMutationSpec[],
    nextSpecs: UniqueConstraintMutationSpec[],
) {
    const currentByField = new Map(currentSpecs.map(spec => [spec.doc.fieldName, spec]));
    const nextByField = new Map(nextSpecs.map(spec => [spec.doc.fieldName, spec]));

    for (const [fieldName, currentSpec] of currentByField.entries()) {
        const nextSpec = nextByField.get(fieldName);
        if (!nextSpec || nextSpec.id !== currentSpec.id) {
            transaction.delete(currentSpec.id);
        }
    }

    for (const [fieldName, nextSpec] of nextByField.entries()) {
        const currentSpec = currentByField.get(fieldName);
        if (!currentSpec || currentSpec.id !== nextSpec.id) {
            transaction.create(nextSpec.doc);
        }
    }
}

function resolveUniqueConstraintConflictMessage(error: unknown, specs: UniqueConstraintMutationSpec[]) {
    const message =
        error instanceof Error
            ? error.message
            : error && typeof error === 'object' && 'message' in error && typeof (error as { message?: unknown }).message === 'string'
                ? (error as { message: string }).message
                : '';
    const statusCode =
        error && typeof error === 'object' && 'statusCode' in error && typeof (error as { statusCode?: unknown }).statusCode === 'number'
            ? (error as { statusCode: number }).statusCode
            : error && typeof error === 'object' && 'status' in error && typeof (error as { status?: unknown }).status === 'number'
                ? (error as { status: number }).status
                : undefined;

    if (statusCode !== 409 && !/already exists/i.test(message)) {
        return null;
    }

    for (const spec of specs) {
        if (message.includes(spec.id) && /already exists/i.test(message)) {
            return spec.message;
        }
    }
    return null;
}

async function addAuditLog(actor: { _id: string; name: string; email?: string; role?: string }, action: string, entityRef: string, summary: string) {
    try {
        await sanityCreate({
            _type: 'auditLog',
            actorUserRef: actor._id,
            actorUserName: actor.name,
            actorUserEmail: actor.email,
            actorUserRole: actor.role,
            action,
            entityType: 'driverMobileAccess',
            entityRef,
            changesSummary: summary,
            timestamp: new Date().toISOString(),
        });
    } catch {
        console.warn('Audit log write failed for driver account');
    }
}

async function getDuplicateEmail(email: string, excludeId?: string) {
    return getSanityClient().fetch<{ _id: string } | null>(
        `*[_type == "user" && lower(email) == $email && _id != $excludeId][0]{ _id }`,
        { email: email.toLowerCase(), excludeId: excludeId || '' }
    );
}

async function getDuplicateDriverAccount(driverRef: string, excludeId?: string) {
    return getSanityClient().fetch<{ _id: string } | null>(
        `*[_type == "user" && role == "DRIVER" && driverRef == $driverRef && _id != $excludeId][0]{ _id }`,
        { driverRef, excludeId: excludeId || '' }
    );
}

function normalizeText(value: unknown) {
    return typeof value === 'string' ? value.trim() : '';
}

function buildPatchPayload(updates: Record<string, unknown>) {
    const set: Record<string, unknown> = {};
    const unset: string[] = [];

    for (const [key, value] of Object.entries(updates)) {
        if (value === undefined) {
            unset.push(key);
        } else {
            set[key] = value;
        }
    }

    return { set, unset };
}

async function deactivateDriverAccountAtomically(input: {
    session: { _id: string; name: string };
    accountId: string;
    accountRev?: string;
    accountUpdates: Record<string, unknown>;
    driverRef: string;
    driverRev?: string;
    driverName: string;
    currentConstraintSpecs: UniqueConstraintMutationSpec[];
    nextConstraintSpecs: UniqueConstraintMutationSpec[];
}) {
    if (!input.accountRev) {
        return {
            stoppedTrackingCount: 0,
            conflictMessage: 'Revisi akun driver tidak tersedia. Refresh lalu coba lagi.',
        };
    }

    const now = new Date().toISOString();
    const [driver, trackedDeliveryOrders] = await Promise.all([
        sanityGetById<Driver>(input.driverRef),
        getSanityClient().fetch<Array<{ _id: string; _rev?: string; doNumber?: string; status?: string }>>(
            `*[
                _type == "deliveryOrder" &&
                (driverRef == $ref || driverRef._ref == $ref) &&
                trackingState in ["ACTIVE", "PAUSED"]
            ]{
                _id,
                _rev,
                doNumber,
                status
            }`,
            { ref: input.driverRef }
        ),
    ]);

    if (input.driverRev && (!driver || !driver._rev)) {
        return {
            stoppedTrackingCount: 0,
            conflictMessage: 'Revisi supir tidak tersedia. Refresh lalu coba lagi.',
        };
    }
    if (trackedDeliveryOrders.some(deliveryOrder => !deliveryOrder._rev)) {
        return {
            stoppedTrackingCount: 0,
            conflictMessage: 'Revisi tracking surat jalan tidak tersedia. Refresh lalu coba lagi.',
        };
    }

    const transaction = getSanityClient().transaction();
    const accountPatch = buildPatchPayload(input.accountUpdates);

    if (Object.keys(accountPatch.set).length > 0 || accountPatch.unset.length > 0) {
        transaction.patch(input.accountId, {
            ifRevisionID: input.accountRev,
            ...(Object.keys(accountPatch.set).length > 0 ? { set: accountPatch.set } : {}),
            ...(accountPatch.unset.length > 0 ? { unset: accountPatch.unset } : {}),
        });
    }

    appendUniqueConstraintMutations(transaction, input.currentConstraintSpecs, input.nextConstraintSpecs);

    if (driver && input.driverRev) {
        transaction.patch(input.driverRef, {
            ifRevisionID: input.driverRev,
            set: { activeTrackingUpdatedAt: now },
            unset: ['activeTrackingDeliveryOrderRef'],
        });
    }

    for (const deliveryOrder of trackedDeliveryOrders) {
        transaction.patch(deliveryOrder._id, {
            ifRevisionID: deliveryOrder._rev,
            set: {
                trackingState: 'STOPPED',
                trackingStoppedAt: now,
                trackingLastSeenAt: now,
            },
        });
        transaction.create({
            _id: crypto.randomUUID(),
            _type: 'trackingLog',
            refType: 'DO',
            refRef: deliveryOrder._id,
            status: deliveryOrder.status || 'ON_DELIVERY',
            note: `Tracking dihentikan otomatis karena akun mobile driver ${input.driverName} dinonaktifkan`,
            source: 'DRIVER_APP',
            timestamp: now,
            userRef: input.session._id,
            userName: input.session.name,
        });
    }

    try {
        await transaction.commit();
    } catch (error) {
        if (isMutationConflictError(error)) {
            return {
                stoppedTrackingCount: 0,
                conflictMessage: 'Data akun driver atau tracking berubah karena ada update lain. Refresh lalu coba lagi.',
            };
        }
        throw error;
    }

    return { stoppedTrackingCount: trackedDeliveryOrders.length };
}

export async function GET(request: Request) {
    const auth = await requireInternalSession(['OWNER', 'ARMADA']);
    if ('error' in auth) {
        return jsonNoStore({ error: auth.error }, { status: auth.status });
    }

    const { searchParams } = new URL(request.url);
    const driverRefsParam = searchParams.get('driverRefs');
    const countOnly = searchParams.get('countOnly') === '1';
    const activeOnly = searchParams.get('activeOnly') === '1';
    const driverRefs = driverRefsParam
        ? driverRefsParam.split(',').map(value => value.trim()).filter(Boolean)
        : [];

    const conditions = ['_type == "user"', 'role == "DRIVER"'];
    const params: Record<string, unknown> = {};

    if (activeOnly) {
        conditions.push('active != false');
    }
    if (driverRefs.length > 0) {
        conditions.push('driverRef in $driverRefs');
        params.driverRefs = driverRefs;
    }

    const whereClause = conditions.join(' && ');

    if (countOnly) {
        const total = await getSanityClient().fetch<number>(`count(*[${whereClause}])`, params);
        return jsonNoStore({ data: [], meta: { total } });
    }

    const accounts = await getSanityClient().fetch<Array<Pick<User, '_id' | 'name' | 'email' | 'active' | 'driverRef' | 'driverName' | 'lastLoginAt'>>>(
        `*[${whereClause}] | order(name asc){
            _id,
            name,
            email,
            active,
            driverRef,
            driverName,
            lastLoginAt
        }`,
        params
    );

    return jsonNoStore({ data: accounts });
}

export async function POST(request: Request) {
    const originError = ensureSameOriginRequest(request);
    if (originError) {
        return originError;
    }

    const auth = await requireInternalSession(['OWNER', 'ARMADA']);
    if ('error' in auth) {
        return jsonNoStore({ error: auth.error }, { status: auth.status });
    }

    try {
        const parsedBody = await parseJsonBody<{
            action?: string;
            id?: string;
            driverRef?: string;
            name?: string;
            email?: string;
            password?: string;
            active?: boolean;
        }>(request);
        if ('error' in parsedBody) {
            return parsedBody.error;
        }
        const body = parsedBody.data;

        const action =
            body.action === 'create' || body.action === 'update'
                ? body.action
                : '';
        const driverRef = normalizeText(body.driverRef);
        const name = normalizeText(body.name);
        const email = normalizeText(body.email).toLowerCase();
        const password = typeof body.password === 'string' ? body.password.trim() : '';

        if (!action) {
            return jsonNoStore({ error: 'Aksi akun driver tidak valid' }, { status: 400 });
        }

        if (!driverRef || !name || !email) {
            return jsonNoStore({ error: 'Nama, email, dan supir wajib diisi' }, { status: 400 });
        }

        const driver = await sanityGetById<Driver>(driverRef);
        if (!driver) {
            return jsonNoStore({ error: 'Supir tidak ditemukan' }, { status: 404 });
        }
        if (driver.active === false) {
            return jsonNoStore({ error: 'Supir tidak aktif dan tidak bisa diberi akun mobile' }, { status: 409 });
        }
        if (!driver._rev) {
            return jsonNoStore({ error: 'Revisi supir untuk akun mobile tidak tersedia. Refresh lalu coba lagi.' }, { status: 409 });
        }

        if (action === 'create') {
            if (password.length < 8) {
                return jsonNoStore({ error: 'Password minimal 8 karakter' }, { status: 400 });
            }

            const duplicateEmail = await getDuplicateEmail(email);
            if (duplicateEmail) {
                return jsonNoStore({ error: 'Email user sudah digunakan' }, { status: 409 });
            }

            const duplicateDriverAccount = await getDuplicateDriverAccount(driverRef);
            if (duplicateDriverAccount) {
                return jsonNoStore({ error: 'Supir ini sudah memiliki akun mobile' }, { status: 409 });
            }

            const newId = crypto.randomUUID();
            const createdDoc: User = {
                _id: newId,
                _type: 'user',
                name,
                email,
                role: 'DRIVER',
                driverRef,
                driverName: driver.name,
                passwordHash: await hashPassword(password),
                active: typeof body.active === 'boolean' ? body.active : true,
                createdAt: new Date().toISOString(),
            };
            const constraintSpecs = buildDriverUserConstraintSpecs(newId, createdDoc as unknown as Record<string, unknown>);
            try {
                const transaction = getSanityClient().transaction();
                transaction.patch(driverRef, {
                    ifRevisionID: driver._rev,
                    set: { updatedAt: new Date().toISOString() },
                });
                for (const spec of constraintSpecs) {
                    transaction.create(spec.doc);
                }
                transaction.create(createdDoc);
                await transaction.commit();
            } catch (error) {
                const conflictMessage = resolveUniqueConstraintConflictMessage(error, constraintSpecs);
                if (conflictMessage) {
                    return jsonNoStore({ error: conflictMessage }, { status: 409 });
                }
                if (isMutationConflictError(error)) {
                    return jsonNoStore({ error: 'User atau supir untuk akun mobile berubah karena ada update lain. Refresh lalu coba lagi.' }, { status: 409 });
                }
                throw error;
            }

            const created = await sanityGetById<User>(newId);
            if (!created) {
                return jsonNoStore({ error: 'Akun driver tidak ditemukan setelah dibuat' }, { status: 404 });
            }

            await addAuditLog(auth.session, 'CREATE', created._id, `Membuat akun driver mobile untuk ${driver.name}`);
            return jsonNoStore({ data: sanitizeUserForClient(created) });
        }

        const id = normalizeText(body.id);
        if (!id) {
            return jsonNoStore({ error: 'ID akun driver tidak valid' }, { status: 400 });
        }

        const existing = await sanityGetById<User & { _rev?: string }>(id);
        if (!existing || existing.role !== 'DRIVER') {
            return jsonNoStore({ error: 'Akun driver tidak ditemukan' }, { status: 404 });
        }
        if (!existing._rev) {
            return jsonNoStore({ error: 'Revisi akun driver tidak tersedia. Refresh lalu coba lagi.' }, { status: 409 });
        }

        const duplicateEmail = await getDuplicateEmail(email, id);
        if (duplicateEmail) {
            return jsonNoStore({ error: 'Email user sudah digunakan' }, { status: 409 });
        }

        const duplicateDriverAccount = await getDuplicateDriverAccount(driverRef, id);
        if (duplicateDriverAccount) {
            return jsonNoStore({ error: 'Supir ini sudah memiliki akun mobile' }, { status: 409 });
        }

        const updates: Record<string, unknown> = {
            name,
            email,
            driverRef,
            driverName: driver.name,
        };

        if (typeof body.active === 'boolean') {
            updates.active = body.active;
        }

        if (password) {
            if (password.length < 8) {
                return jsonNoStore({ error: 'Password minimal 8 karakter' }, { status: 400 });
            }
            updates.passwordHash = await hashPassword(password);
        }

        const isDeactivatingAccount = existing.active !== false && updates.active === false;
        const isDriverRefChanging = normalizeText(existing.driverRef) !== driverRef;
        let stoppedTrackingCount = 0;
        const currentConstraintSpecs = buildDriverUserConstraintSpecs(id, existing as unknown as Record<string, unknown>);
        const nextConstraintSpecs = buildDriverUserConstraintSpecs(id, {
            ...existing,
            ...updates,
            role: 'DRIVER',
        });

        let updated: User;
        if (isDeactivatingAccount) {
            if (isDriverRefChanging) {
                return jsonNoStore(
                    { error: 'Driver akun mobile tidak boleh dipindah bersamaan dengan proses nonaktifkan akun' },
                    { status: 409 }
                );
            }
            const trackingResult = await deactivateDriverAccountAtomically({
                session: auth.session,
                accountId: id,
                accountRev: existing._rev,
                accountUpdates: updates,
                driverRef,
                driverRev: driver._rev,
                driverName: driver.name,
                currentConstraintSpecs,
                nextConstraintSpecs,
            });
            if ('conflictMessage' in trackingResult) {
                return jsonNoStore({ error: trackingResult.conflictMessage }, { status: 409 });
            }
            stoppedTrackingCount = trackingResult.stoppedTrackingCount;
            const refreshed = await sanityGetById<User>(id);
            if (!refreshed) {
                return jsonNoStore({ error: 'Akun driver tidak ditemukan' }, { status: 404 });
            }
            updated = refreshed;
        } else {
            try {
                const transaction = getSanityClient().transaction();
                transaction.patch(id, {
                    ifRevisionID: existing._rev,
                    set: updates,
                });
                transaction.patch(driverRef, {
                    ifRevisionID: driver._rev,
                    set: { updatedAt: new Date().toISOString() },
                });
                appendUniqueConstraintMutations(transaction, currentConstraintSpecs, nextConstraintSpecs);
                await transaction.commit();
            } catch (error) {
                const conflictMessage = resolveUniqueConstraintConflictMessage(error, nextConstraintSpecs);
                if (conflictMessage) {
                    return jsonNoStore({ error: conflictMessage }, { status: 409 });
                }
                if (isMutationConflictError(error)) {
                    return jsonNoStore({ error: 'Data akun driver atau supir berubah karena ada update lain. Refresh lalu coba lagi.' }, { status: 409 });
                }
                throw error;
            }
            const refreshed = await sanityGetById<User>(id);
            if (!refreshed) {
                return jsonNoStore({ error: 'Akun driver tidak ditemukan setelah diperbarui' }, { status: 404 });
            }
            updated = refreshed;
        }

        await addAuditLog(auth.session, 'UPDATE', id, `Memperbarui akun driver mobile untuk ${driver.name}`);
        return jsonNoStore({
            data: sanitizeUserForClient(updated),
            meta: {
                stoppedTrackingCount,
            },
        });
    } catch (error) {
        if (isMutationConflictError(error)) {
            return jsonNoStore({ error: 'Data akun driver berubah karena ada update lain. Refresh lalu coba lagi.' }, { status: 409 });
        }
        console.error('Driver account route error:', error);
        return jsonNoStore({ error: 'Terjadi kesalahan server' }, { status: 500 });
    }
}
