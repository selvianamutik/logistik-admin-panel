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

        const updated = await sanityUpdate<User>(id, updates);
        void addAuditLog(auth.session, 'UPDATE', id, `Memperbarui akun driver mobile untuk ${driver.name}`);
        return NextResponse.json({ data: sanitizeUserForClient(updated) });
    } catch (error) {
        console.error('Driver account route error:', error);
        return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 });
    }
}
