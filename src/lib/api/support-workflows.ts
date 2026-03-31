import { NextResponse } from 'next/server';

import { getBusinessDateValue } from '@/lib/business-date';
import { hashPassword, verifyPassword } from '@/lib/auth';
import { getSanityClient, sanityDelete, sanityGetById, sanityGetNextNumber } from '@/lib/sanity';

import {
    assertIsoDate,
    isPlainObject,
    normalizeCurrencyNumber,
    normalizeNumber,
    normalizeOptionalText,
    normalizeText,
    type ApiSession,
} from './data-helpers';

type AuditLogFn = (
    session: Pick<ApiSession, '_id' | 'name'>,
    action: string,
    entityType: string,
    entityRef: string,
    summary: string
) => void | Promise<void>;

const MANAGEABLE_USER_ROLES = ['OWNER', 'OPERASIONAL', 'FINANCE', 'ARMADA', 'DRIVER'] as const;

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
        typeof data.role === 'string' && MANAGEABLE_USER_ROLES.includes(data.role as typeof MANAGEABLE_USER_ROLES[number])
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
    const allowedOwnerFields = new Set(['name', 'email', 'role', 'active', 'driverRef', 'password', 'passwordHash']);
    const allowedSelfFields = new Set(['name', 'password', 'passwordHash']);
    const existingUser = await sanityGetById<{ _id: string; email: string; role: string; active: boolean; passwordHash: string; driverRef?: string }>(targetUserId);
    if (!existingUser) {
        throw new Error('User tidak ditemukan');
    }

    const isSelfUpdate = session._id === targetUserId;
    if (session.role !== 'OWNER' && !isSelfUpdate) {
        throw new Error('Forbidden');
    }

    const allowedFields = session.role === 'OWNER' ? allowedOwnerFields : allowedSelfFields;
    if (Object.keys(updates).some(key => !allowedFields.has(key))) {
        throw new Error(session.role === 'OWNER' ? 'Field user tidak valid' : 'Perubahan profil ini tidak diizinkan');
    }

    const nextUpdates: Record<string, unknown> = {};
    for (const key of allowedFields) {
        if (Object.prototype.hasOwnProperty.call(updates, key)) {
            nextUpdates[key] = updates[key];
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

    if (
        typeof nextUpdates.role === 'string' &&
        !MANAGEABLE_USER_ROLES.includes(nextUpdates.role as typeof MANAGEABLE_USER_ROLES[number])
    ) {
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

    const totalAmount = normalizeCurrencyNumber(data.totalAmount);
    if (!Number.isFinite(totalAmount) || totalAmount <= 0) {
        return NextResponse.json({ error: 'Total invoice tidak valid' }, { status: 400 });
    }

    const issueDate =
        normalizeOptionalText(data.issueDate) ||
        normalizeOptionalText(data.date) ||
        getBusinessDateValue();
    const dueDate =
        normalizeOptionalText(data.dueDate) ||
        normalizeOptionalText(data.date) ||
        issueDate;
    try {
        assertIsoDate(issueDate, 'Tanggal invoice');
        assertIsoDate(dueDate, 'Tanggal jatuh tempo invoice');
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Tanggal invoice tidak valid' },
            { status: 400 }
        );
    }

    const mode =
        typeof data.mode === 'string' && (data.mode === 'ORDER' || data.mode === 'DO') ? data.mode : 'ORDER';
    const orderRef = normalizeOptionalText(data.orderRef);
    const doRef = normalizeOptionalText(data.doRef);
    const customerRef = normalizeOptionalText(data.customerRef);
    const customerName = normalizeOptionalText(data.customerName);
    const masterResi = normalizeOptionalText(data.masterResi);
    const notes = normalizeOptionalText(data.notes);

    const invoiceId = crypto.randomUUID();
    const invoiceNumber = await sanityGetNextNumber('invoice');
    const invoiceDoc: { _id: string; _type: 'invoice'; [key: string]: unknown } = {
        _id: invoiceId,
        _type: 'invoice',
        invoiceNumber,
        mode,
        issueDate,
        dueDate,
        status: 'UNPAID',
        totalAmount,
        totalAdjustmentAmount: 0,
        netAmount: totalAmount,
    };
    if (orderRef) {
        invoiceDoc.orderRef = orderRef;
    }
    if (doRef) {
        invoiceDoc.doRef = doRef;
    }
    if (customerRef) {
        invoiceDoc.customerRef = customerRef;
    }
    if (customerName) {
        invoiceDoc.customerName = customerName;
    }
    if (masterResi) {
        invoiceDoc.masterResi = masterResi;
    }
    if (notes) {
        invoiceDoc.notes = notes;
    }

    const transaction = getSanityClient().transaction().create(invoiceDoc);
    for (const item of items) {
        const subtotal = normalizeCurrencyNumber(item.subtotal);
        const qty = normalizeNumber(item.qty);
        const price = normalizeCurrencyNumber(item.price);
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
    await addAuditLog(session, 'CREATE', 'invoices', invoiceId, `Created invoices: ${invoiceNumber}`);
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

    const relatedCustomerProduct = await getSanityClient().fetch<{ _id: string } | null>(
        `*[_type == "customerProduct" && customerRef == $ref][0]{ _id }`,
        { ref: id }
    );
    if (relatedCustomerProduct) {
        return NextResponse.json({ error: 'Hapus dulu master barang customer sebelum menghapus customer' }, { status: 409 });
    }

    const relatedCustomerRecipient = await getSanityClient().fetch<{ _id: string } | null>(
        `*[_type == "customerRecipient" && customerRef == $ref][0]{ _id }`,
        { ref: id }
    );
    if (relatedCustomerRecipient) {
        return NextResponse.json({ error: 'Hapus dulu master penerima customer sebelum menghapus customer' }, { status: 409 });
    }

    const relatedCustomerPickup = await getSanityClient().fetch<{ _id: string } | null>(
        `*[_type == "customerPickupLocation" && customerRef == $ref][0]{ _id }`,
        { ref: id }
    );
    if (relatedCustomerPickup) {
        return NextResponse.json({ error: 'Hapus dulu master pickup customer sebelum menghapus customer' }, { status: 409 });
    }

    const relatedCustomerReceipt = await getSanityClient().fetch<{ _id: string } | null>(
        `*[_type == "customerReceipt" && customerRef == $ref][0]{ _id }`,
        { ref: id }
    );
    if (relatedCustomerReceipt) {
        return NextResponse.json({ error: 'Customer yang sudah dipakai pada penerimaan tidak boleh dihapus' }, { status: 409 });
    }

    await sanityDelete(id);
    await addAuditLog(session, 'DELETE', 'customers', id, `Deleted customers ${customer.name || id}`);
    return NextResponse.json({ success: true });
}
