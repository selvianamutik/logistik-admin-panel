import { NextResponse } from 'next/server';

import { hashPassword } from '@/lib/auth';
import { sanitizeUserForClient } from '@/lib/api/data-helpers';
import { requireAdminOrOwnerSession } from '@/lib/api/driver-portal';
import { ensureSameOriginRequest } from '@/lib/api/request-security';
import { getSanityClient, sanityCreate, sanityGetById, sanityUpdate } from '@/lib/sanity';
import type { Driver, User } from '@/lib/types';

async function addAuditLog(actor: { _id: string; name: string }, action: string, entityRef: string, summary: string) {
    try {
        await sanityCreate({
            _type: 'auditLog',
            actorUserRef: actor._id,
            actorUserName: actor.name,
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
    accountUpdates: Record<string, unknown>;
    driverRef: string;
    driverName: string;
}) {
    const now = new Date().toISOString();
    const [driver, trackedDeliveryOrders] = await Promise.all([
        sanityGetById<Driver>(input.driverRef),
        getSanityClient().fetch<Array<{ _id: string; doNumber?: string; status?: string }>>(
            `*[
                _type == "deliveryOrder" &&
                (driverRef == $ref || driverRef._ref == $ref) &&
                trackingState in ["ACTIVE", "PAUSED"]
            ]{
                _id,
                doNumber,
                status
            }`,
            { ref: input.driverRef }
        ),
    ]);

    const transaction = getSanityClient().transaction();
    const accountPatch = buildPatchPayload(input.accountUpdates);

    if (Object.keys(accountPatch.set).length > 0 || accountPatch.unset.length > 0) {
        transaction.patch(input.accountId, {
            ...(Object.keys(accountPatch.set).length > 0 ? { set: accountPatch.set } : {}),
            ...(accountPatch.unset.length > 0 ? { unset: accountPatch.unset } : {}),
        });
    }

    if (driver) {
        transaction.patch(input.driverRef, {
            set: { activeTrackingUpdatedAt: now },
            unset: ['activeTrackingDeliveryOrderRef'],
        });
    }

    for (const deliveryOrder of trackedDeliveryOrders) {
        transaction.patch(deliveryOrder._id, {
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

    await transaction.commit();
    return { stoppedTrackingCount: trackedDeliveryOrders.length };
}

export async function GET() {
    const auth = await requireAdminOrOwnerSession();
    if ('error' in auth) {
        return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const accounts = await getSanityClient().fetch<Array<Pick<User, '_id' | 'name' | 'email' | 'active' | 'driverRef' | 'driverName' | 'lastLoginAt'>>>(
        `*[_type == "user" && role == "DRIVER"] | order(name asc){
            _id,
            name,
            email,
            active,
            driverRef,
            driverName,
            lastLoginAt
        }`
    );

    return NextResponse.json({ data: accounts });
}

export async function POST(request: Request) {
    const originError = ensureSameOriginRequest(request);
    if (originError) {
        return originError;
    }

    const auth = await requireAdminOrOwnerSession();
    if ('error' in auth) {
        return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    try {
        const body = await request.json() as {
            action?: string;
            id?: string;
            driverRef?: string;
            name?: string;
            email?: string;
            password?: string;
            active?: boolean;
        };

        const action = body.action === 'update' ? 'update' : 'create';
        const driverRef = normalizeText(body.driverRef);
        const name = normalizeText(body.name);
        const email = normalizeText(body.email).toLowerCase();
        const password = typeof body.password === 'string' ? body.password.trim() : '';

        if (!driverRef || !name || !email) {
            return NextResponse.json({ error: 'Nama, email, dan supir wajib diisi' }, { status: 400 });
        }

        const driver = await sanityGetById<Driver>(driverRef);
        if (!driver) {
            return NextResponse.json({ error: 'Supir tidak ditemukan' }, { status: 404 });
        }
        if (driver.active === false) {
            return NextResponse.json({ error: 'Supir tidak aktif dan tidak bisa diberi akun mobile' }, { status: 409 });
        }

        if (action === 'create') {
            if (password.length < 8) {
                return NextResponse.json({ error: 'Password minimal 8 karakter' }, { status: 400 });
            }

            const duplicateEmail = await getDuplicateEmail(email);
            if (duplicateEmail) {
                return NextResponse.json({ error: 'Email user sudah digunakan' }, { status: 409 });
            }

            const duplicateDriverAccount = await getDuplicateDriverAccount(driverRef);
            if (duplicateDriverAccount) {
                return NextResponse.json({ error: 'Supir ini sudah memiliki akun mobile' }, { status: 409 });
            }

            const created = await sanityCreate<User>({
                _type: 'user',
                name,
                email,
                role: 'DRIVER',
                driverRef,
                driverName: driver.name,
                passwordHash: await hashPassword(password),
                active: typeof body.active === 'boolean' ? body.active : true,
                createdAt: new Date().toISOString(),
            });

            void addAuditLog(auth.session, 'CREATE', created._id, `Membuat akun driver mobile untuk ${driver.name}`);
            return NextResponse.json({ data: sanitizeUserForClient(created) });
        }

        const id = normalizeText(body.id);
        if (!id) {
            return NextResponse.json({ error: 'ID akun driver tidak valid' }, { status: 400 });
        }

        const existing = await sanityGetById<User>(id);
        if (!existing || existing.role !== 'DRIVER') {
            return NextResponse.json({ error: 'Akun driver tidak ditemukan' }, { status: 404 });
        }

        const duplicateEmail = await getDuplicateEmail(email, id);
        if (duplicateEmail) {
            return NextResponse.json({ error: 'Email user sudah digunakan' }, { status: 409 });
        }

        const duplicateDriverAccount = await getDuplicateDriverAccount(driverRef, id);
        if (duplicateDriverAccount) {
            return NextResponse.json({ error: 'Supir ini sudah memiliki akun mobile' }, { status: 409 });
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
                return NextResponse.json({ error: 'Password minimal 8 karakter' }, { status: 400 });
            }
            updates.passwordHash = await hashPassword(password);
        }

        const isDeactivatingAccount = existing.active !== false && updates.active === false;
        let stoppedTrackingCount = 0;

        let updated: User;
        if (isDeactivatingAccount) {
            const trackingResult = await deactivateDriverAccountAtomically({
                session: auth.session,
                accountId: id,
                accountUpdates: updates,
                driverRef,
                driverName: driver.name,
            });
            stoppedTrackingCount = trackingResult.stoppedTrackingCount;
            const refreshed = await sanityGetById<User>(id);
            if (!refreshed) {
                return NextResponse.json({ error: 'Akun driver tidak ditemukan' }, { status: 404 });
            }
            updated = refreshed;
        } else {
            updated = await sanityUpdate<User>(id, updates);
        }

        void addAuditLog(auth.session, 'UPDATE', id, `Memperbarui akun driver mobile untuk ${driver.name}`);
        return NextResponse.json({
            data: sanitizeUserForClient(updated),
            meta: {
                stoppedTrackingCount,
            },
        });
    } catch (error) {
        console.error('Driver account route error:', error);
        return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 });
    }
}
