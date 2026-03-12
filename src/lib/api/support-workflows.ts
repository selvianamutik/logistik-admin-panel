import { NextResponse } from 'next/server';

import { hashPassword, verifyPassword } from '@/lib/auth';
import { getSanityClient, sanityDelete, sanityGetById, sanityGetNextNumber } from '@/lib/sanity';

import { isPlainObject, normalizeText, type ApiSession } from './data-helpers';

type AuditLogFn = (
    session: Pick<ApiSession, '_id' | 'name'>,
    action: string,
    entityType: string,
    entityRef: string,
    summary: string
) => void | Promise<void>;

async function validateDriverAccountLink(driverRef: unknown, excludeUserId?: string) {
    const normalizedDriverRef = normalizeText(driverRef);
    if (!normalizedDriverRef) {
        throw new Error('Supir untuk akun mobile wajib dipilih');
    }

    const driver = await sanityGetById<{ _id: string; name?: string; active?: boolean }>(normalizedDriverRef);
    if (!driver) {
        throw new Error('Data supir untuk akun mobile tidak ditemukan');
    }
    if (driver.active === false) {
        throw new Error('Supir tidak aktif dan tidak bisa diberi akun mobile');
    }

    const duplicateDriverAccount = await getSanityClient().fetch<{ _id: string } | null>(
        `*[_type == "user" && role == "DRIVER" && driverRef == $driverRef && _id != $excludeId][0]{ _id }`,
        { driverRef: normalizedDriverRef, excludeId: excludeUserId || '' }
    );
    if (duplicateDriverAccount) {
        throw new Error('Supir ini sudah memiliki akun mobile');
    }

    return {
        driverRef: normalizedDriverRef,
        driverName: driver.name || undefined,
    };
}

export async function normalizeUserCreatePayload(data: Record<string, unknown>) {
    const name = normalizeText(data.name);
    const email = normalizeText(data.email).toLowerCase();
    const password = typeof data.password === 'string' ? data.password.trim() : '';
    const role =
        data.role === 'OWNER' || data.role === 'ADMIN' || data.role === 'DRIVER'
            ? data.role
            : null;
    if (!name || !email) {
        throw new Error('Nama dan email wajib diisi');
    }
    if (!role) {
        throw new Error('Role user tidak valid');
    }
    if (password.length < 8) {
        throw new Error('Password minimal 8 karakter');
    }

    const existingEmail = await getSanityClient().fetch<{ _id: string } | null>(
        `*[_type == "user" && lower(email) == $email][0]{ _id }`,
        { email }
    );
    if (existingEmail) {
        throw new Error('Email user sudah digunakan');
    }

    const driverLink = role === 'DRIVER'
        ? await validateDriverAccountLink(data.driverRef)
        : { driverRef: undefined, driverName: undefined };

    return {
        ...data,
        name,
        email,
        role,
        driverRef: driverLink.driverRef,
        driverName: driverLink.driverName,
        passwordHash: await hashPassword(password),
        active: true,
        createdAt: new Date().toISOString(),
    };
}

export async function normalizeUserUpdates(
    session: ApiSession,
    targetUserId: string,
    updates: Record<string, unknown>,
    currentPassword: unknown
) {
    const nextUpdates = { ...updates };
    const existingUser = await sanityGetById<{ _id: string; email: string; role: string; active: boolean; passwordHash: string; driverRef?: string }>(targetUserId);
    if (!existingUser) {
        throw new Error('User tidak ditemukan');
    }

    const isSelfUpdate = session._id === targetUserId;
    if (session.role !== 'OWNER' && !isSelfUpdate) {
        throw new Error('Forbidden');
    }

    if (session.role !== 'OWNER') {
        const allowedSelfFields = new Set(['name', 'password', 'passwordHash']);
        if (Object.keys(nextUpdates).some(key => !allowedSelfFields.has(key))) {
            throw new Error('Perubahan profil ini tidak diizinkan');
        }
    }

    if (typeof nextUpdates.name === 'string') {
        const normalizedName = nextUpdates.name.trim();
        if (!normalizedName) {
            throw new Error('Nama wajib diisi');
        }
        nextUpdates.name = normalizedName;
    }

    if (typeof nextUpdates.email === 'string') {
        const normalizedEmail = nextUpdates.email.trim().toLowerCase();
        if (!normalizedEmail) {
            throw new Error('Email wajib diisi');
        }
        const duplicateEmail = await getSanityClient().fetch<{ _id: string } | null>(
            `*[_type == "user" && lower(email) == $email && _id != $excludeId][0]{ _id }`,
            { email: normalizedEmail, excludeId: targetUserId }
        );
        if (duplicateEmail) {
            throw new Error('Email user sudah digunakan');
        }
        nextUpdates.email = normalizedEmail;
    }

    if (typeof nextUpdates.role === 'string' && !['OWNER', 'ADMIN', 'DRIVER'].includes(nextUpdates.role)) {
        throw new Error('Role user tidak valid');
    }

    if ('active' in nextUpdates && typeof nextUpdates.active !== 'boolean') {
        throw new Error('Status user tidak valid');
    }

    const nextRole =
        typeof nextUpdates.role === 'string' ? nextUpdates.role : existingUser.role;
    const nextActive =
        typeof nextUpdates.active === 'boolean' ? nextUpdates.active : existingUser.active;

    if (isSelfUpdate && !nextActive) {
        throw new Error('Anda tidak dapat menonaktifkan akun sendiri');
    }

    if (existingUser.role === 'OWNER' && (nextRole !== 'OWNER' || !nextActive)) {
        const otherActiveOwners = await getSanityClient().fetch<number>(
            `count(*[_type == "user" && role == "OWNER" && active == true && _id != $excludeId])`,
            { excludeId: targetUserId }
        );
        if (otherActiveOwners === 0) {
            throw new Error('Minimal harus ada satu OWNER aktif');
        }
    }

    if (nextRole === 'DRIVER' || existingUser.role === 'DRIVER' || Object.prototype.hasOwnProperty.call(nextUpdates, 'driverRef')) {
        if (nextRole === 'DRIVER') {
            const driverLink = await validateDriverAccountLink(
                Object.prototype.hasOwnProperty.call(nextUpdates, 'driverRef') ? nextUpdates.driverRef : existingUser.driverRef,
                targetUserId
            );
            nextUpdates.driverRef = driverLink.driverRef;
            nextUpdates.driverName = driverLink.driverName;
        } else {
            nextUpdates.driverRef = undefined;
            nextUpdates.driverName = undefined;
        }
    }

    const rawPassword =
        typeof nextUpdates.password === 'string'
            ? nextUpdates.password
            : typeof nextUpdates.passwordHash === 'string'
                ? nextUpdates.passwordHash
                : null;

    if (rawPassword !== null) {
        const password = rawPassword.trim();
        if (password.length < 8) {
            throw new Error('Password minimal 8 karakter');
        }

        if (isSelfUpdate) {
            if (typeof currentPassword !== 'string' || !currentPassword.trim()) {
                throw new Error('Password saat ini wajib diisi');
            }

            const validCurrentPassword = await verifyPassword(currentPassword, existingUser.passwordHash);
            if (!validCurrentPassword) {
                throw new Error('Password saat ini tidak valid');
            }
        }

        nextUpdates.passwordHash = await hashPassword(password);
    }

    delete nextUpdates.password;
    return nextUpdates;
}

export async function handleInvoiceCreate(
    session: ApiSession,
    data: Record<string, unknown>,
    addAuditLog: AuditLogFn
) {
    const rawItems = Array.isArray(data.items) ? data.items : [];
    const items = rawItems.filter(isPlainObject);
    if (items.length === 0) {
        return NextResponse.json({ error: 'Item invoice wajib diisi' }, { status: 400 });
    }

    const totalAmount = typeof data.totalAmount === 'number' ? data.totalAmount : Number(data.totalAmount);
    if (!Number.isFinite(totalAmount) || totalAmount <= 0) {
        return NextResponse.json({ error: 'Total invoice tidak valid' }, { status: 400 });
    }

    const invoiceId = crypto.randomUUID();
    const invoiceNumber = await sanityGetNextNumber('invoice');
    const invoiceDoc = {
        _id: invoiceId,
        _type: 'invoice',
        ...data,
        invoiceNumber,
        status: 'UNPAID',
        totalAmount,
    };

    const transaction = getSanityClient().transaction().create(invoiceDoc);
    for (const item of items) {
        const subtotal = typeof item.subtotal === 'number' ? item.subtotal : Number(item.subtotal);
        const qty = typeof item.qty === 'number' ? item.qty : Number(item.qty);
        const price = typeof item.price === 'number' ? item.price : Number(item.price);
        if (!Number.isFinite(subtotal) || !Number.isFinite(qty) || !Number.isFinite(price)) {
            return NextResponse.json({ error: 'Ada item invoice yang tidak valid' }, { status: 400 });
        }

        transaction.create({
            _id: crypto.randomUUID(),
            _type: 'invoiceItem',
            invoiceRef: invoiceId,
            description: typeof item.description === 'string' ? item.description : '',
            qty,
            price,
            subtotal,
        });
    }

    await transaction.commit();
    void addAuditLog(session, 'CREATE', 'invoices', invoiceId, `Created invoices: ${invoiceNumber}`);
    return NextResponse.json({ data: invoiceDoc, id: invoiceId });
}

export async function handleCustomerDelete(
    session: ApiSession,
    data: Record<string, unknown>,
    addAuditLog: AuditLogFn
) {
    const id = typeof data.id === 'string' ? data.id : '';
    if (!id) {
        return NextResponse.json({ error: 'Customer tidak valid' }, { status: 400 });
    }

    const customer = await sanityGetById<{ _id: string; name?: string }>(id);
    if (!customer) {
        return NextResponse.json({ error: 'Customer tidak ditemukan' }, { status: 404 });
    }

    const relatedOrder = await getSanityClient().fetch<{ _id: string } | null>(
        `*[_type == "order" && customerRef == $ref][0]{ _id }`,
        { ref: id }
    );
    if (relatedOrder) {
        return NextResponse.json({ error: 'Customer yang sudah dipakai pada order tidak boleh dihapus' }, { status: 409 });
    }

    const relatedFreightNota = await getSanityClient().fetch<{ _id: string } | null>(
        `*[_type == "freightNota" && customerRef == $ref][0]{ _id }`,
        { ref: id }
    );
    if (relatedFreightNota) {
        return NextResponse.json({ error: 'Customer yang sudah dipakai pada nota tidak boleh dihapus' }, { status: 409 });
    }

    const relatedInvoice = await getSanityClient().fetch<{ _id: string } | null>(
        `*[_type == "invoice" && customerRef == $ref][0]{ _id }`,
        { ref: id }
    );
    if (relatedInvoice) {
        return NextResponse.json({ error: 'Customer yang sudah dipakai pada invoice tidak boleh dihapus' }, { status: 409 });
    }

    await sanityDelete(id);
    void addAuditLog(session, 'DELETE', 'customers', id, `Deleted customers ${customer.name || id}`);
    return NextResponse.json({ success: true });
}
