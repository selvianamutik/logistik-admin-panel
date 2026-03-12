import { NextResponse } from 'next/server';

import { createSession, setSessionCookie } from '@/lib/auth';
import {
    getSanityClient,
    sanityCreate,
    sanityDelete,
    sanityGetById,
    sanityGetCompanyProfile,
    sanityGetNextNumber,
    sanityUpdate,
} from '@/lib/sanity';
import type { User } from '@/lib/types';

import {
    CASH_ACCOUNT_SYSTEM_KEY,
    extractRefId,
    isPlainObject,
    type ApiSession,
    type BankAccountSummary,
} from './data-helpers';
import {
    handleDriverBoronganDelete,
    handleDriverVoucherItemDelete,
} from './driver-workflows';
import { handleFreightNotaDelete } from './finance-workflows';
import {
    handleDriverDelete,
    handleExpenseCategoryDelete,
    handleServiceDelete,
    handleVehicleDelete,
    normalizeDriverPayload,
    normalizeExpenseCategoryPayload,
    normalizeMaintenanceCreatePayload,
    normalizeServicePayload,
    normalizeTireEventPayload,
    normalizeVehiclePayload,
} from './operations-workflows';
import { handleOrderDelete, syncOrderStatusFromItems } from './order-workflows';
import {
    handleCustomerDelete,
    normalizeUserCreatePayload,
    normalizeUserUpdates,
} from './support-workflows';

type AuditLogFn = (
    session: Pick<ApiSession, '_id' | 'name'>,
    action: string,
    entityType: string,
    entityRef: string,
    summary: string
) => void | Promise<void>;

function isProtectedLedgerEntity(entity: string) {
    return entity === 'payments' || entity === 'incomes' || entity === 'expenses' || entity === 'bank-transactions';
}

function isWorkflowManagedCreateEntity(entity: string) {
    return (
        entity === 'orders' ||
        entity === 'delivery-orders' ||
        entity === 'invoices' ||
        entity === 'freight-notas' ||
        entity === 'driver-borongans' ||
        entity === 'incomes' ||
        entity === 'bank-transactions'
    );
}

function isWorkflowManagedDeleteEntity(entity: string) {
    return (
        entity === 'delivery-orders' ||
        entity === 'delivery-order-items' ||
        entity === 'order-items' ||
        entity === 'invoice-items' ||
        entity === 'freight-nota-items' ||
        entity === 'driver-borogan-items' ||
        entity === 'tracking-logs'
    );
}

function buildCreateSummary(newDoc: Record<string, unknown>, fallbackId: string) {
    return (
        newDoc.masterResi ||
        newDoc.doNumber ||
        newDoc.invoiceNumber ||
        newDoc.notaNumber ||
        newDoc.boronganNumber ||
        newDoc.incidentNumber ||
        newDoc.name ||
        fallbackId
    );
}

export async function handleGenericUpdate(
    session: ApiSession,
    entity: string,
    data: Record<string, unknown>,
    addAuditLog: AuditLogFn
) {
    const id = typeof data.id === 'string' ? data.id : '';
    const updates = isPlainObject(data.updates) ? data.updates : null;
    if (!id || !updates) {
        return NextResponse.json({ error: 'Invalid update payload' }, { status: 400 });
    }

    if (isProtectedLedgerEntity(entity)) {
        return NextResponse.json({ error: 'Entri keuangan yang sudah terposting tidak boleh diubah lewat API umum' }, { status: 409 });
    }

    if (entity === 'driver-vouchers') {
        const existingVoucher = await sanityGetById<{ status?: string }>(id);
        if (!existingVoucher) {
            return NextResponse.json({ error: 'Bon supir tidak ditemukan' }, { status: 404 });
        }
        if (existingVoucher.status === 'SETTLED') {
            return NextResponse.json({ error: 'Bon yang sudah settle tidak bisa diubah' }, { status: 409 });
        }

        const protectedFields = new Set([
            'bonNumber',
            'cashGiven',
            'issueBankRef',
            'issueBankName',
            'status',
            'settledDate',
            'settledBy',
            'settlementBankRef',
            'settlementBankName',
        ]);
        if (Object.keys(updates).some(key => protectedFields.has(key))) {
            return NextResponse.json({ error: 'Field bon supir sensitif harus lewat workflow server' }, { status: 400 });
        }
    }

    if (entity === 'incidents' && typeof updates.status === 'string') {
        return NextResponse.json({ error: 'Status insiden harus lewat workflow server' }, { status: 400 });
    }

    if (entity === 'delivery-orders' && typeof updates.status === 'string') {
        return NextResponse.json({ error: 'Status surat jalan harus lewat workflow server' }, { status: 400 });
    }

    if (entity === 'maintenances' && typeof updates.status === 'string') {
        const existingMaintenance = await sanityGetById<{ status?: string }>(id);
        if (!existingMaintenance) {
            return NextResponse.json({ error: 'Maintenance tidak ditemukan' }, { status: 404 });
        }

        if (existingMaintenance.status !== 'SCHEDULED') {
            return NextResponse.json({ error: 'Maintenance yang sudah diproses tidak bisa diubah lagi' }, { status: 409 });
        }

        if (!['DONE', 'SKIPPED'].includes(updates.status)) {
            return NextResponse.json({ error: 'Status maintenance tidak valid' }, { status: 400 });
        }

        if (typeof updates.completedDate !== 'string' || !updates.completedDate) {
            updates.completedDate = new Date().toISOString().slice(0, 10);
        }
    }

    if (entity === 'tire-events') {
        const existingTire = await sanityGetById<Record<string, unknown>>(id);
        if (!existingTire) {
            return NextResponse.json({ error: 'Catatan ban tidak ditemukan' }, { status: 404 });
        }
        const normalizedTireUpdates = await normalizeTireEventPayload({ ...existingTire, ...updates }, id);
        const updated = await sanityUpdate(id, normalizedTireUpdates);
        void addAuditLog(session, 'UPDATE', entity, id, `Updated ${entity}: ${JSON.stringify(normalizedTireUpdates).slice(0, 200)}`);
        return NextResponse.json({ data: updated });
    }

    if (entity === 'bank-accounts') {
        if ('currentBalance' in updates || 'initialBalance' in updates) {
            return NextResponse.json({ error: 'Saldo rekening tidak boleh diubah manual lewat API umum' }, { status: 409 });
        }

        const existingAccount = await sanityGetById<BankAccountSummary>(id);
        if (!existingAccount) {
            return NextResponse.json({ error: 'Rekening tidak ditemukan' }, { status: 404 });
        }
        if (existingAccount.systemKey === CASH_ACCOUNT_SYSTEM_KEY) {
            if ('active' in updates && updates.active === false) {
                return NextResponse.json({ error: 'Akun Kas Tunai sistem tidak boleh dinonaktifkan' }, { status: 409 });
            }
            if ('bankName' in updates || 'accountNumber' in updates || 'accountHolder' in updates || 'accountType' in updates || 'systemKey' in updates) {
                return NextResponse.json({ error: 'Identitas akun Kas Tunai sistem tidak boleh diubah manual' }, { status: 409 });
            }
        }
    }

    const normalizedUpdates =
        entity === 'users'
            ? await normalizeUserUpdates(session, id, updates, data.currentPassword)
            : entity === 'services'
                ? await normalizeServicePayload(updates, { partial: true, excludeId: id })
                : entity === 'expense-categories'
                    ? await normalizeExpenseCategoryPayload(updates, { partial: true, excludeId: id })
                    : entity === 'drivers'
                        ? await normalizeDriverPayload(updates, { partial: true, excludeId: id })
                        : entity === 'vehicles'
                            ? await normalizeVehiclePayload(session, updates, { partial: true, excludeId: id })
                            : updates;

    const updated = await sanityUpdate(id, normalizedUpdates);
    if (!updated) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    if (entity === 'users' && id === session._id) {
        const nextSessionToken = await createSession(updated as unknown as User);
        await setSessionCookie(nextSessionToken);
    }

    void addAuditLog(session, 'UPDATE', entity, id, `Updated ${entity}: ${JSON.stringify(normalizedUpdates).slice(0, 200)}`);

    if (entity === 'order-items' && typeof normalizedUpdates.status === 'string') {
        const orderItem = updated as { orderRef?: unknown };
        const orderRef = extractRefId(orderItem.orderRef);
        if (orderRef) {
            await syncOrderStatusFromItems(orderRef, session, addAuditLog);
        }
    }

    if (entity === 'delivery-orders' && typeof normalizedUpdates.status === 'string') {
        const doDoc = updated as { orderRef?: unknown };
        const orderRef = extractRefId(doDoc.orderRef);
        if (orderRef) {
            await syncOrderStatusFromItems(orderRef, session, addAuditLog);
        }
    }

    return NextResponse.json({ data: updated });
}

export async function handleGenericDelete(
    session: ApiSession,
    entity: string,
    data: Record<string, unknown>,
    addAuditLog: AuditLogFn
) {
    if (entity === 'driver-voucher-items') {
        return handleDriverVoucherItemDelete(data);
    }

    if (isProtectedLedgerEntity(entity)) {
        return NextResponse.json({ error: 'Entri keuangan yang sudah terposting tidak boleh dihapus lewat API umum' }, { status: 409 });
    }

    if (isWorkflowManagedDeleteEntity(entity)) {
        return NextResponse.json({ error: 'Dokumen turunan workflow tidak boleh dihapus langsung lewat API umum' }, { status: 409 });
    }

    if (entity === 'orders') {
        return handleOrderDelete(session, data, addAuditLog);
    }

    if (entity === 'customers') {
        return handleCustomerDelete(session, data, addAuditLog);
    }

    if (entity === 'services') {
        return handleServiceDelete(session, data, addAuditLog);
    }

    if (entity === 'expense-categories') {
        return handleExpenseCategoryDelete(session, data, addAuditLog);
    }

    if (entity === 'drivers') {
        return handleDriverDelete(session, data, addAuditLog);
    }

    if (entity === 'vehicles') {
        return handleVehicleDelete(session, data, addAuditLog);
    }

    if (entity === 'freight-notas') {
        return handleFreightNotaDelete(session, data, addAuditLog);
    }

    if (entity === 'driver-borongans') {
        return handleDriverBoronganDelete(session, data, addAuditLog);
    }

    const id = typeof data.id === 'string' ? data.id : '';
    if (!id) {
        return NextResponse.json({ error: 'Invalid delete payload' }, { status: 400 });
    }

    await sanityDelete(id);
    void addAuditLog(session, 'DELETE', entity, id, `Deleted ${entity} ${id}`);
    return NextResponse.json({ success: true });
}

export async function handleGenericCreate(
    session: ApiSession,
    entity: string,
    docType: string,
    data: Record<string, unknown>,
    addAuditLog: AuditLogFn
) {
    if (entity === 'company') {
        const existing = await sanityGetCompanyProfile();
        if (existing?._id) {
            const updated = await sanityUpdate(existing._id, data);
            void addAuditLog(session, 'UPDATE', 'companyProfile', existing._id, 'Company profile updated');
            return NextResponse.json({ data: updated });
        }

        const created = await sanityCreate({ _type: 'companyProfile', ...data });
        return NextResponse.json({ data: created });
    }

    if (isWorkflowManagedCreateEntity(entity)) {
        return NextResponse.json({ error: 'Dokumen ini harus dibuat lewat workflow server yang sesuai' }, { status: 409 });
    }

    const newDoc: { _type: string; [key: string]: unknown } = { _type: docType, ...data };

    if (entity === 'delivery-order-items') {
        const deliveryOrderRef = typeof data.deliveryOrderRef === 'string' ? data.deliveryOrderRef : '';
        const orderItemRef = typeof data.orderItemRef === 'string' ? data.orderItemRef : '';
        if (!deliveryOrderRef || !orderItemRef) {
            return NextResponse.json({ error: 'Relasi DO item tidak valid' }, { status: 400 });
        }

        const deliveryOrder = await sanityGetById<{ _id: string; status?: string }>(deliveryOrderRef);
        if (!deliveryOrder) {
            return NextResponse.json({ error: 'Surat jalan tidak ditemukan' }, { status: 404 });
        }
        if (deliveryOrder.status === 'CANCELLED') {
            return NextResponse.json({ error: 'Tidak bisa menambah item ke surat jalan yang dibatalkan' }, { status: 409 });
        }

        const orderItem = await sanityGetById<{ _id: string }>(orderItemRef);
        if (!orderItem) {
            return NextResponse.json({ error: 'Item order tidak ditemukan' }, { status: 404 });
        }

        const activeAssignment = await getSanityClient().fetch<{ _id: string } | null>(
            `*[
                _type == "deliveryOrderItem" &&
                orderItemRef == $orderItemRef &&
                deliveryOrderRef != $deliveryOrderRef &&
                defined(*[_type == "deliveryOrder" && _id == ^.deliveryOrderRef && status != "CANCELLED"][0]._id)
            ][0]{ _id }`,
            { orderItemRef, deliveryOrderRef }
        );
        if (activeAssignment) {
            return NextResponse.json({ error: 'Item order sudah terikat ke surat jalan aktif lain' }, { status: 409 });
        }
    }

    if (entity === 'orders') {
        newDoc.masterResi = await sanityGetNextNumber('resi');
        newDoc.status = 'OPEN';
        newDoc.createdAt = new Date().toISOString();
        newDoc.createdBy = session._id;
    }

    if (entity === 'delivery-orders') {
        newDoc.doNumber = await sanityGetNextNumber('do');
        newDoc.status = 'CREATED';
    }

    if (entity === 'invoices') {
        newDoc.invoiceNumber = await sanityGetNextNumber('invoice');
        newDoc.status = 'UNPAID';
    }

    if (entity === 'freight-notas') {
        newDoc.notaNumber = await sanityGetNextNumber('nota');
        newDoc.status = 'UNPAID';
    }

    if (entity === 'driver-borongans') {
        newDoc.boronganNumber = await sanityGetNextNumber('borong');
        newDoc.status = 'UNPAID';
    }

    if (entity === 'maintenances') {
        const normalizedMaintenance = normalizeMaintenanceCreatePayload(data);
        Object.assign(newDoc, normalizedMaintenance);
        newDoc.status = 'SCHEDULED';
    }

    if (entity === 'services') {
        Object.assign(newDoc, await normalizeServicePayload(data));
    }

    if (entity === 'expense-categories') {
        Object.assign(newDoc, await normalizeExpenseCategoryPayload(data));
    }

    if (entity === 'drivers') {
        Object.assign(newDoc, await normalizeDriverPayload(data));
    }

    if (entity === 'vehicles') {
        Object.assign(newDoc, await normalizeVehiclePayload(session, data));
    }

    if (entity === 'users') {
        const normalizedUser = await normalizeUserCreatePayload(data);
        newDoc.name = normalizedUser.name;
        newDoc.email = normalizedUser.email;
        newDoc.role = normalizedUser.role;
        newDoc.passwordHash = normalizedUser.passwordHash;
        newDoc.active = normalizedUser.active;
        newDoc.createdAt = normalizedUser.createdAt;
        delete newDoc.password;
    }

    if (entity === 'tire-events') {
        const normalizedTireEvent = await normalizeTireEventPayload(data);
        Object.assign(newDoc, normalizedTireEvent);
    }

    if (entity === 'bank-accounts') {
        if (data.accountType === 'CASH' || typeof data.systemKey === 'string') {
            return NextResponse.json({ error: 'Akun sistem tidak boleh dibuat manual' }, { status: 409 });
        }
        newDoc.accountType = 'BANK';
    }

    const created = await sanityCreate(newDoc);
    const newId = (created as Record<string, unknown>)._id as string;

    if (entity === 'bank-accounts') {
        const initialBalance =
            typeof data.initialBalance === 'number'
                ? data.initialBalance
                : Number(data.initialBalance || 0);
        await sanityUpdate(newId, { currentBalance: Number.isFinite(initialBalance) ? initialBalance : 0 });
    }

    void addAuditLog(
        session,
        'CREATE',
        entity,
        newId,
        `Created ${entity}: ${buildCreateSummary(newDoc, newId)}`
    );

    return NextResponse.json({ data: created, id: newId });
}
