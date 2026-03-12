/* ============================================================
   LOGISTIK - General Data API
   Centralized CRUD API - Sanity CMS Backend
   ============================================================ */

import { NextResponse } from 'next/server';

import { getSession } from '@/lib/auth';
import {
    ensureCashAccount,
    isPlainObject,
    type ApiSession as Session,
} from '@/lib/api/data-helpers';
import {
    handleBoronganPayment,
    handleDriverBoronganCreate,
    handleDriverVoucherCreate,
    handleDriverVoucherIssueRepair,
    handleDriverVoucherItemCreate,
    handleDriverVoucherSettlement,
} from '@/lib/api/driver-workflows';
import {
    handleBankTransfer,
    handleExpenseCreate,
    handleFreightNotaCreate,
    handlePaymentCreate,
} from '@/lib/api/finance-workflows';
import {
    handleGenericCreate,
    handleGenericDelete,
    handleGenericUpdate,
} from '@/lib/api/generic-workflows';
import {
    handleIncidentCreate,
    handleIncidentStatusUpdate,
} from '@/lib/api/operations-workflows';
import {
    handleDeliveryOrderCreate,
    handleDeliveryOrderStatusUpdate,
    handleOrderCreate,
} from '@/lib/api/order-workflows';
import { handleInvoiceCreate } from '@/lib/api/support-workflows';
import { filterExpensesByRole, sanitizeVehicleForRole } from '@/lib/rbac';
import {
    getSanityClient,
    SANITY_TYPE_MAP,
    sanityCreate,
    sanityGetAll,
    sanityGetByFilter,
    sanityGetById,
    sanityGetCompanyProfile,
} from '@/lib/sanity';
import type { Expense, Vehicle } from '@/lib/types';
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


export async function GET(request: Request) {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (session.role === 'DRIVER') {
        return NextResponse.json({ error: 'Driver tidak diizinkan mengakses API admin' }, { status: 403 });
    }

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
    if (session.role === 'DRIVER') {
        return NextResponse.json({ error: 'Driver tidak diizinkan mengakses API admin' }, { status: 403 });
    }

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
            return handleGenericUpdate(session, entity, data, addAuditLog);
        }

        if (action === 'delete') {
            return handleGenericDelete(session, entity, data, addAuditLog);
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

        return handleGenericCreate(session, entity, docType, data, addAuditLog);
    } catch (err) {
        const message = err instanceof Error ? err.message : 'Server error';
        const status = message === 'Forbidden' ? 403 : 400;
        console.error('API POST Error:', err);
        return NextResponse.json({ error: message }, { status });
    }
}
