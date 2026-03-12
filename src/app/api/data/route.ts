/* ============================================================
   LOGISTIK - General Data API
   Centralized CRUD API - Sanity CMS Backend
   ============================================================ */

import { NextResponse } from 'next/server';

import { createSession, getSession, setSessionCookie } from '@/lib/auth';
import {
    CASH_ACCOUNT_SYSTEM_KEY,
    ensureCashAccount,
    extractRefId,
    isPlainObject,
    type ApiSession as Session,
    type BankAccountSummary,
} from '@/lib/api/data-helpers';
import {
    handleBoronganPayment,
    handleDriverBoronganCreate,
    handleDriverBoronganDelete,
    handleDriverVoucherCreate,
    handleDriverVoucherIssueRepair,
    handleDriverVoucherItemCreate,
    handleDriverVoucherItemDelete,
    handleDriverVoucherSettlement,
} from '@/lib/api/driver-workflows';
import {
    handleBankTransfer,
    handleExpenseCreate,
    handleFreightNotaCreate,
    handleFreightNotaDelete,
    handlePaymentCreate,
} from '@/lib/api/finance-workflows';
import {
    handleDriverDelete,
    handleExpenseCategoryDelete,
    handleIncidentCreate,
    handleIncidentStatusUpdate,
    handleServiceDelete,
    handleVehicleDelete,
    normalizeDriverPayload,
    normalizeExpenseCategoryPayload,
    normalizeMaintenanceCreatePayload,
    normalizeServicePayload,
    normalizeTireEventPayload,
    normalizeVehiclePayload,
} from '@/lib/api/operations-workflows';
import {
    handleDeliveryOrderCreate,
    handleDeliveryOrderStatusUpdate,
    handleOrderCreate,
    handleOrderDelete,
    syncOrderStatusFromItems,
} from '@/lib/api/order-workflows';
import {
    handleCustomerDelete,
    handleInvoiceCreate,
    normalizeUserCreatePayload,
    normalizeUserUpdates,
} from '@/lib/api/support-workflows';
import { filterExpensesByRole, sanitizeVehicleForRole } from '@/lib/rbac';
import {
    getSanityClient,
    SANITY_TYPE_MAP,
    sanityCreate,
    sanityDelete,
    sanityGetAll,
    sanityGetByFilter,
    sanityGetById,
    sanityGetCompanyProfile,
    sanityGetNextNumber,
    sanityUpdate,
} from '@/lib/sanity';
import type { Expense, User, Vehicle } from '@/lib/types';
type DashboardSummary = {
    orderStats: { total: number; open: number; partial: number; complete: number; onHold: number };
    doStats: { total: number; onDelivery: number };
    notaStats: { unpaid: number; totalOutstanding: number };
    boronganStats: { unpaid: number; totalOutstanding: number };
    voucherStats: { unsettled: number; totalIssued: number };
    fleetStats: { openIncidents: number; maintenanceDue: number };
    recentOrders: Array<{ _id: string; masterResi?: string; customerName?: string; status?: string; createdAt?: string }>;
    recentNotas: Array<{ _id: string; notaNumber?: string; customerName?: string; status?: string; totalAmount?: number }>;
};

const OWNER_ONLY_READ_ENTITIES = new Set(['audit-logs']);
const OWNER_ONLY_MUTATION_ENTITIES = new Set(['company', 'audit-logs', 'bank-accounts', 'bank-transactions', 'services', 'expense-categories']);
const LEGACY_READ_ONLY_ENTITIES = new Set(['invoices', 'invoice-items']);

function validateEntity(entity: string | null): entity is keyof typeof SANITY_TYPE_MAP {
    return Boolean(entity && SANITY_TYPE_MAP[entity]);
}

function forbidOwnerOnlyEntity(session: Session, entity: string) {
    if (OWNER_ONLY_MUTATION_ENTITIES.has(entity) && session.role !== 'OWNER') {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    return null;
}

async function addAuditLog(
    session: Pick<Session, '_id' | 'name'>,
    action: string,
    entityType: string,
    entityRef: string,
    summary: string
) {
    try {
        await sanityCreate({
            _type: 'auditLog',
            actorUserRef: session._id,
            actorUserName: session.name,
            action,
            entityType,
            entityRef,
            changesSummary: summary,
            timestamp: new Date().toISOString(),
        });
    } catch {
        console.warn('Audit log write failed');
    }
}

async function getDashboardSummary(session: Session): Promise<DashboardSummary> {
    const client = getSanityClient();
    const [
        orderStats,
        doStats,
        unpaidNotas,
        unpaidBorongans,
        openVouchers,
        fleetStats,
        recentOrders,
        recentNotas,
    ] = await Promise.all([
        client.fetch<DashboardSummary['orderStats']>(`{
            "total": count(*[_type == "order"]),
            "open": count(*[_type == "order" && status == "OPEN"]),
            "partial": count(*[_type == "order" && status == "PARTIAL"]),
            "complete": count(*[_type == "order" && status == "COMPLETE"]),
            "onHold": count(*[_type == "order" && status == "ON_HOLD"])
        }`),
        client.fetch<DashboardSummary['doStats']>(`{
            "total": count(*[_type == "deliveryOrder"]),
            "onDelivery": count(*[_type == "deliveryOrder" && status == "ON_DELIVERY"])
        }`),
        client.fetch<Array<{ totalAmount?: number }>>(`*[_type == "freightNota" && status != "PAID"]{ totalAmount }`),
        client.fetch<Array<{ totalAmount?: number }>>(`*[_type == "driverBorongan" && status != "PAID"]{ totalAmount }`),
        client.fetch<Array<{ cashGiven?: number }>>(`*[_type == "driverVoucher" && status != "SETTLED"]{ cashGiven }`),
        client.fetch<DashboardSummary['fleetStats']>(`{
            "openIncidents": count(*[_type == "incident" && (status == "OPEN" || status == "IN_PROGRESS")]),
            "maintenanceDue": count(*[_type == "maintenance" && status == "SCHEDULED"])
        }`),
        client.fetch<DashboardSummary['recentOrders']>(`*[_type == "order"] | order(_createdAt desc)[0...5]{
            _id,
            masterResi,
            customerName,
            status,
            createdAt
        }`),
        client.fetch<DashboardSummary['recentNotas']>(`*[_type == "freightNota"] | order(_createdAt desc)[0...5]{
            _id,
            notaNumber,
            customerName,
            status,
            totalAmount
        }`),
    ]);

    const notaOutstanding = unpaidNotas.reduce(
        (sum, nota) => sum + (typeof nota.totalAmount === 'number' ? nota.totalAmount : 0),
        0
    );
    const boronganOutstanding = unpaidBorongans.reduce(
        (sum, borongan) => sum + (typeof borongan.totalAmount === 'number' ? borongan.totalAmount : 0),
        0
    );
    const voucherIssued = openVouchers.reduce(
        (sum, voucher) => sum + (typeof voucher.cashGiven === 'number' ? voucher.cashGiven : 0),
        0
    );

    return {
        orderStats,
        doStats,
        notaStats: {
            unpaid: unpaidNotas.length,
            totalOutstanding: session.role === 'OWNER' ? notaOutstanding : 0,
        },
        boronganStats: {
            unpaid: unpaidBorongans.length,
            totalOutstanding: session.role === 'OWNER' ? boronganOutstanding : 0,
        },
        voucherStats: {
            unsettled: openVouchers.length,
            totalIssued: session.role === 'OWNER' ? voucherIssued : 0,
        },
        fleetStats,
        recentOrders,
        recentNotas,
    };
}


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








export async function GET(request: Request) {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const entity = searchParams.get('entity');
    const id = searchParams.get('id');
    const filter = searchParams.get('filter');

    if (entity === 'dashboard-summary') {
        try {
            const summary = await getDashboardSummary(session);
            return NextResponse.json({ data: summary });
        } catch (err) {
            console.error('API GET Dashboard Summary Error:', err);
            return NextResponse.json({ error: 'Server error' }, { status: 500 });
        }
    }

    if (!validateEntity(entity)) {
        return NextResponse.json({ error: 'Invalid entity type' }, { status: 400 });
    }

    if (entity === 'users' && session.role !== 'OWNER' && id !== session._id) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    if (OWNER_ONLY_READ_ENTITIES.has(entity) && session.role !== 'OWNER') {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const docType = SANITY_TYPE_MAP[entity];

    try {
        if (entity === 'company') {
            const profile = await sanityGetCompanyProfile();
            return NextResponse.json({ data: profile });
        }

        if (entity === 'bank-accounts') {
            await ensureCashAccount();
        }

        if (id) {
            let item = await sanityGetById(id);
            if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404 });
            if ((item as { _type?: string })._type !== docType) {
                return NextResponse.json({ error: 'Not found' }, { status: 404 });
            }

            if (entity === 'vehicles' && session.role !== 'OWNER') {
                item = sanitizeVehicleForRole(item as unknown as Vehicle, session.role) as unknown as Record<string, unknown>;
            }
            return NextResponse.json({ data: item });
        }

        let items: Record<string, unknown>[] = [];

        if (filter) {
            try {
                const filterObj = JSON.parse(filter) as Record<string, unknown>;
                items = await sanityGetByFilter(docType, filterObj);
            } catch {
                items = await sanityGetAll(docType);
            }
        } else {
            items = await sanityGetAll(docType);
        }

        if (entity === 'expenses') {
            items = filterExpensesByRole(items as unknown as Expense[], session.role) as unknown as Record<string, unknown>[];
        }

        if (entity === 'vehicles' && session.role !== 'OWNER') {
            items = (items as unknown as Vehicle[]).map(item => sanitizeVehicleForRole(item, session.role)) as unknown as Record<string, unknown>[];
        }

        return NextResponse.json({ data: items });
    } catch (err) {
        console.error('API GET Error:', err);
        return NextResponse.json({ error: 'Server error' }, { status: 500 });
    }
}

export async function POST(request: Request) {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    try {
        const body = await request.json();
        const entity = typeof body.entity === 'string' ? body.entity : null;
        const action =
            typeof body.action === 'string'
                ? body.action
                : typeof body.data?.action === 'string'
                    ? body.data.action
                    : undefined;
        const data = isPlainObject(body.data) ? body.data : {};

        if (!validateEntity(entity)) {
            return NextResponse.json({ error: 'Invalid entity type' }, { status: 400 });
        }

        if (LEGACY_READ_ONLY_ENTITIES.has(entity)) {
            return NextResponse.json(
                { error: 'Invoice legacy sudah dibekukan. Gunakan Nota Ongkos untuk workflow tagihan aktif.' },
                { status: 409 }
            );
        }

        if (entity === 'users') {
            if (action === 'delete') {
                return NextResponse.json({ error: 'User tidak boleh dihapus permanen' }, { status: 409 });
            }

            if (session.role !== 'OWNER' && action !== 'update') {
                return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
            }
        }

        const forbidden = forbidOwnerOnlyEntity(session, entity);
        if (forbidden) return forbidden;

        const docType = SANITY_TYPE_MAP[entity];

        if (action === 'update') {
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
            if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 });

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

        if (action === 'delete') {
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

        if (entity === 'driver-borongans' && action === 'mark-paid') {
            return handleBoronganPayment(session, data, addAuditLog);
        }

        if (entity === 'incidents' && action === 'set-status') {
            return handleIncidentStatusUpdate(session, data, addAuditLog);
        }

        if (entity === 'orders' && action === 'create-with-items') {
            return handleOrderCreate(session, data, addAuditLog);
        }

        if (entity === 'delivery-orders' && action === 'create-with-items') {
            return handleDeliveryOrderCreate(session, data, addAuditLog);
        }

        if (entity === 'freight-notas' && action === 'create-with-items') {
            return handleFreightNotaCreate(session, data, addAuditLog);
        }

        if (entity === 'invoices' && action === 'create-with-items') {
            return handleInvoiceCreate(session, data, addAuditLog);
        }

        if (entity === 'delivery-orders' && action === 'set-status') {
            return handleDeliveryOrderStatusUpdate(session, data, addAuditLog);
        }

        if (entity === 'driver-borongans' && action === 'create-with-items') {
            return handleDriverBoronganCreate(session, data, addAuditLog);
        }

        if (entity === 'driver-vouchers' && action === 'settle') {
            return handleDriverVoucherSettlement(session, data, addAuditLog);
        }

        if (entity === 'driver-vouchers' && action === 'repair-issue-ledger') {
            return handleDriverVoucherIssueRepair(session, data, addAuditLog);
        }

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

        if (entity === 'bank-transactions' && action === 'transfer') {
            return handleBankTransfer(data);
        }

        if (entity === 'payments') {
            return handlePaymentCreate(session, data, addAuditLog);
        }

        if (entity === 'expenses') {
            return handleExpenseCreate(session, data, addAuditLog);
        }

        if (entity === 'driver-vouchers') {
            return handleDriverVoucherCreate(session, data, addAuditLog);
        }

        if (entity === 'driver-voucher-items') {
            return handleDriverVoucherItemCreate(data);
        }

        if (entity === 'incidents') {
            return handleIncidentCreate(session, data, addAuditLog);
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
            `Created ${entity}: ${(newDoc as Record<string, unknown>).masterResi ||
            (newDoc as Record<string, unknown>).doNumber ||
            (newDoc as Record<string, unknown>).invoiceNumber ||
            (newDoc as Record<string, unknown>).incidentNumber ||
            (newDoc as Record<string, unknown>).name ||
            newId}`
        );

        return NextResponse.json({ data: created, id: newId });
    } catch (err) {
        const message = err instanceof Error ? err.message : 'Server error';
        const status = message === 'Forbidden' ? 403 : 400;
        console.error('API POST Error:', err);
        return NextResponse.json({ error: message }, { status });
    }
}
