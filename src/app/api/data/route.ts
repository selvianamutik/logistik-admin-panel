/* ============================================================
   LOGISTIK - General Data API
   Centralized CRUD API - Sanity CMS Backend
   ============================================================ */

import { NextResponse } from 'next/server';

import { getSession } from '@/lib/auth';
import {
    ensureCashAccount,
    isPlainObject,
    sanitizeCompanyProfileForRole,
    sanitizeUserForClient,
    type ApiSession as Session,
} from '@/lib/api/data-helpers';
import { ensureSameOriginRequest } from '@/lib/api/request-security';
import {
    handleBoronganPayment,
    handleDriverVoucherCreate,
    handleDriverVoucherDisbursementDelete,
    handleDriverVoucherIssueRepair,
    handleDriverVoucherItemCreate,
    handleDriverVoucherSettlement,
    handleDriverVoucherTopUp,
} from '@/lib/api/driver-workflows';
import {
    handleBankTransfer,
    handleCustomerReceiptCreate,
    handleExpenseCreate,
    handleFreightNotaCreate,
    handleInvoiceAdjustmentCreate,
    handleInvoiceAdjustmentVoid,
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
    handleDeliveryOrderShipperReferenceUpdate,
    handleDeliveryOrderTripResourceAssign,
    handleDeliveryOrderDriverStatusRequestReject,
    handleDeliveryOrderStatusUpdate,
    handleOrderItemHoldRelease,
    handleOrderItemHoldSet,
    handleOrderCreate,
    handleOrderTargetRevision,
    handleOrderUpdateWithItems,
} from '@/lib/api/order-workflows';
import { handleInvoiceCreate } from '@/lib/api/support-workflows';
import {
    filterExpensesByRole,
    hasPermission,
    normalizeUserRole,
    sanitizeVehicleForRole,
    type AppModule,
    type ModulePermissions,
} from '@/lib/rbac';
import {
    getAuditLogsSummary,
    getBankAccountsSummary,
    getBoronganSummary,
    getCustomersSummary,
    getDashboardSummary,
    getExpensesSummary,
    getFreightNotasSummary,
    getListSortClause,
    getVehiclesSummary,
} from '@/lib/api/data-query-support';
import {
    SANITY_TYPE_MAP,
    sanityCreate,
    sanityGetAll,
    sanityGetByFilter,
    sanityGetById,
    sanityGetCompanyProfile,
    sanityList,
} from '@/lib/sanity';
import type { Expense, User, Vehicle } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const OWNER_ONLY_READ_ENTITIES = new Set(['audit-logs', 'driver-borongans', 'driver-borongan-items', 'driver-borogan-items']);
const OWNER_ONLY_MUTATION_ENTITIES = new Set(['company', 'audit-logs', 'services', 'expense-categories', 'driver-borongans', 'driver-borongan-items', 'driver-borogan-items']);
const LEGACY_READ_ONLY_ENTITIES = new Set(['invoices', 'invoice-items']);
const ENTITY_MODULE_MAP: Partial<Record<keyof typeof SANITY_TYPE_MAP, AppModule>> = {
    customers: 'customers',
    'customer-products': 'customers',
    'customer-recipients': 'customers',
    'customer-pickups': 'customers',
    'trip-route-rates': 'tripRouteRates',
    services: 'services',
    'expense-categories': 'expenseCategories',
    drivers: 'drivers',
    orders: 'orders',
    'order-items': 'orders',
    'delivery-orders': 'deliveryOrders',
    'delivery-order-items': 'deliveryOrders',
    'tracking-logs': 'deliveryOrders',
    payments: 'freightNotas',
    'customer-receipts': 'freightNotas',
    'invoice-adjustments': 'freightNotas',
    expenses: 'expenses',
    vehicles: 'vehicles',
    maintenances: 'maintenance',
    'tire-events': 'tires',
    incidents: 'incidents',
    'incident-action-logs': 'incidents',
    'bank-accounts': 'bankAccounts',
    'bank-transactions': 'bankAccounts',
    'driver-vouchers': 'driverVouchers',
    'driver-voucher-disbursements': 'driverVouchers',
    'driver-voucher-items': 'driverVouchers',
    'freight-notas': 'freightNotas',
    'freight-nota-items': 'freightNotas',
    invoices: 'freightNotas',
    'invoice-items': 'freightNotas',
    'driver-borongans': 'driverBorongans',
    'driver-borogan-items': 'driverBorongans',
    'driver-borongan-items': 'driverBorongans',
    users: 'userManagement',
    'audit-logs': 'auditLogs',
};

function validateEntity(entity: string | null): entity is keyof typeof SANITY_TYPE_MAP {
    return Boolean(entity && SANITY_TYPE_MAP[entity]);
}

function forbidOwnerOnlyEntity(session: Session, entity: string) {
    if (OWNER_ONLY_MUTATION_ENTITIES.has(entity) && session.role !== 'OWNER') {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    return null;
}

function getEntityModule(entity: string | null): AppModule | null {
    if (!entity) return null;
    return ENTITY_MODULE_MAP[entity as keyof typeof SANITY_TYPE_MAP] || null;
}

function getMutationPermissionAction(action?: string): keyof ModulePermissions {
    if (action === 'delete') return 'delete';
    if (
        action === 'update' ||
        action === 'update-with-items' ||
        action === 'revise-targets' ||
        action === 'set-status' ||
        action === 'assign-trip-resources' ||
        action === 'update-shipper-reference' ||
        action === 'reject-driver-status-request' ||
        action === 'set-hold-quantity' ||
        action === 'release-hold' ||
        action === 'settle' ||
        action === 'top-up' ||
        action === 'repair-issue-ledger' ||
        action === 'mark-paid' ||
        action === 'void'
    ) {
        return 'update';
    }
    return 'create';
}

function hasSpecialMutationPermission(session: Session, entity: string, action?: string): boolean | null {
    const role = normalizeUserRole(session.role);

    if (entity === 'delivery-orders' && action === 'assign-trip-resources') {
        return role === 'OWNER' || role === 'OPERASIONAL' || role === 'ARMADA';
    }

    if (entity === 'delivery-orders' && action === 'update-shipper-reference') {
        return role === 'OWNER' || role === 'OPERASIONAL' || role === 'FINANCE';
    }

    if (entity === 'driver-vouchers' && action === 'settle') {
        return role === 'OWNER' || role === 'FINANCE';
    }

    if (entity === 'driver-vouchers' && action === 'top-up') {
        return role === 'OWNER' || role === 'OPERASIONAL';
    }

    if (entity === 'driver-vouchers' && action === 'repair-issue-ledger') {
        return role === 'OWNER' || role === 'FINANCE';
    }

    return null;
}

function forbidModuleAccess(session: Session, entity: string, action: keyof ModulePermissions) {
    const targetModule = getEntityModule(entity);
    if (!targetModule) return null;
    if (!hasPermission(session.role, targetModule, action)) {
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
    const pageParam = searchParams.get('page');
    const pageSizeParam = searchParams.get('pageSize');
    const searchQuery = searchParams.get('q')?.trim() || '';
    const searchFieldsParam = searchParams.get('searchFields');
    const countOnly = searchParams.get('countOnly') === '1';
    const sortField = searchParams.get('sortField')?.trim() || undefined;
    const sortDirParam = searchParams.get('sortDir');
    const sortDir = sortDirParam === 'asc' ? 'asc' : sortDirParam === 'desc' ? 'desc' : undefined;
    const sortPreset = searchParams.get('sortPreset');
    const orFiltersParam = searchParams.get('orFilters');
    const definedFieldsParam = searchParams.get('definedFields');

    if (entity === 'dashboard-summary') {
        if (!hasPermission(session.role, 'dashboard', 'view')) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }
        try {
            const summary = await getDashboardSummary(session);
            return NextResponse.json({ data: summary });
        } catch (err) {
            console.error('API GET Dashboard Summary Error:', err);
            return NextResponse.json({ error: 'Server error' }, { status: 500 });
        }
    }

    if (entity === 'customers-summary') {
        if (!hasPermission(session.role, 'customers', 'view')) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }
        try {
            const idsParam = searchParams.get('ids');
            const ids = idsParam
                ? idsParam.split(',').map(value => value.trim()).filter(Boolean)
                : [];
            const summary = await getCustomersSummary(ids);
            return NextResponse.json({ data: summary });
        } catch (err) {
            console.error('API GET Customer Summary Error:', err);
            return NextResponse.json({ error: 'Server error' }, { status: 500 });
        }
    }

    if (entity === 'vehicles-summary') {
        if (!hasPermission(session.role, 'vehicles', 'view')) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }
        try {
            const idsParam = searchParams.get('ids');
            const ids = idsParam
                ? idsParam.split(',').map(value => value.trim()).filter(Boolean)
                : [];
            const summary = await getVehiclesSummary(ids);
            return NextResponse.json({ data: summary });
        } catch (err) {
            console.error('API GET Vehicle Summary Error:', err);
            return NextResponse.json({ error: 'Server error' }, { status: 500 });
        }
    }

    if (entity === 'expenses-summary') {
        if (!hasPermission(session.role, 'expenses', 'view')) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }
        try {
            const summary = await getExpensesSummary(session, searchQuery);
            return NextResponse.json({ data: summary });
        } catch (err) {
            console.error('API GET Expense Summary Error:', err);
            return NextResponse.json({ error: 'Server error' }, { status: 500 });
        }
    }

    if (entity === 'bank-accounts-summary') {
        if (!hasPermission(session.role, 'bankAccounts', 'view')) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }
        try {
            const summary = await getBankAccountsSummary();
            return NextResponse.json({ data: summary });
        } catch (err) {
            console.error('API GET Bank Account Summary Error:', err);
            return NextResponse.json({ error: 'Server error' }, { status: 500 });
        }
    }

    if (entity === 'audit-logs-summary') {
        if (!hasPermission(session.role, 'auditLogs', 'view')) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }
        try {
            const summary = await getAuditLogsSummary();
            return NextResponse.json({ data: summary });
        } catch (err) {
            console.error('API GET Audit Summary Error:', err);
            return NextResponse.json({ error: 'Server error' }, { status: 500 });
        }
    }

    if (entity === 'driver-borongans-summary') {
        if (session.role !== 'OWNER' || !hasPermission(session.role, 'driverBorongans', 'view')) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }
        try {
            const summary = await getBoronganSummary(searchQuery, searchParams.get('status') || '');
            return NextResponse.json({ data: summary });
        } catch (err) {
            console.error('API GET Borongan Summary Error:', err);
            return NextResponse.json({ error: 'Server error' }, { status: 500 });
        }
    }

    if (entity === 'freight-notas-summary') {
        if (!hasPermission(session.role, 'freightNotas', 'view')) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }
        try {
            const summary = await getFreightNotasSummary(searchQuery, searchParams.get('status') || '');
            return NextResponse.json({ data: summary });
        } catch (err) {
            console.error('API GET Freight Nota Summary Error:', err);
            return NextResponse.json({ error: 'Server error' }, { status: 500 });
        }
    }

    if (!validateEntity(entity)) {
        return NextResponse.json({ error: 'Invalid entity type' }, { status: 400 });
    }

    if (entity !== 'users' && entity !== 'company') {
        const forbiddenModuleRead = forbidModuleAccess(session, entity, 'view');
        if (forbiddenModuleRead) {
            return forbiddenModuleRead;
        }
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
            return NextResponse.json({
                data: profile
                    ? sanitizeCompanyProfileForRole(profile, session.role)
                    : null,
            });
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

            if (entity === 'users') {
                item = sanitizeUserForClient(item as unknown as User) as unknown as Record<string, unknown>;
            }

            if (entity === 'vehicles' && session.role !== 'OWNER') {
                item = sanitizeVehicleForRole(item as unknown as Vehicle, session.role) as unknown as Record<string, unknown>;
            }
            return NextResponse.json({ data: item });
        }

        let items: Record<string, unknown>[] = [];
        let totalItems = 0;
        let filterObj: Record<string, unknown> | undefined;
        let orFilters: Array<{ fields: string[]; value: string | number | boolean }> | undefined;
        let definedFields: string[] | undefined;

        if (filter) {
            try {
                filterObj = JSON.parse(filter) as Record<string, unknown>;
            } catch (error) {
                return NextResponse.json(
                    { error: error instanceof Error ? error.message : 'Filter query tidak valid' },
                    { status: 400 }
                );
            }
        }

        if (orFiltersParam) {
            try {
                const parsed = JSON.parse(orFiltersParam) as unknown;
                if (!Array.isArray(parsed)) {
                    throw new Error('Or filter query tidak valid');
                }
                orFilters = parsed
                    .filter((item): item is { fields: string[]; value: string | number | boolean } => (
                        typeof item === 'object' &&
                        item !== null &&
                        Array.isArray((item as { fields?: unknown }).fields) &&
                        ((item as { value?: unknown }).value !== undefined)
                    ))
                    .map(item => ({
                        fields: item.fields,
                        value: item.value,
                    }));
            } catch (error) {
                return NextResponse.json(
                    { error: error instanceof Error ? error.message : 'Or filter query tidak valid' },
                    { status: 400 }
                );
            }
        }

        if (definedFieldsParam) {
            definedFields = definedFieldsParam
                .split(',')
                .map(field => field.trim())
                .filter(Boolean);
        }

        const needsPaginatedList =
            countOnly ||
            pageParam !== null ||
            pageSizeParam !== null ||
            Boolean(searchQuery) ||
            Boolean(searchFieldsParam) ||
            Boolean(sortField) ||
            Boolean(sortDir);

        if (needsPaginatedList) {
            try {
                const page = pageParam ? Number.parseInt(pageParam, 10) : 1;
                const pageSize = pageSizeParam ? Number.parseInt(pageSizeParam, 10) : 10;
                const searchFields = searchFieldsParam
                    ? searchFieldsParam.split(',').map(field => field.trim()).filter(Boolean)
                    : [];
                const result = await sanityList(docType, {
                    filterObj,
                    orFilters,
                    definedFields,
                    search: searchQuery || undefined,
                    searchFields,
                    page,
                    pageSize,
                    sortField,
                    sortDir,
                    sortClause: getListSortClause(entity, sortPreset),
                });
                items = result.items as Record<string, unknown>[];
                totalItems = result.total;
            } catch (error) {
                return NextResponse.json(
                    { error: error instanceof Error ? error.message : 'Pagination query tidak valid' },
                    { status: 400 }
                );
            }
        } else if (filterObj) {
            items = await sanityGetByFilter(docType, filterObj);
            totalItems = items.length;
        } else {
            items = await sanityGetAll(docType);
            totalItems = items.length;
        }

        if (entity === 'users') {
            items = items.map(item => sanitizeUserForClient(item as unknown as User) as unknown as Record<string, unknown>);
        }

        if (entity === 'expenses') {
            items = filterExpensesByRole(items as unknown as Expense[], session.role) as unknown as Record<string, unknown>[];
        }

        if (entity === 'vehicles' && session.role !== 'OWNER') {
            items = (items as unknown as Vehicle[]).map(item => sanitizeVehicleForRole(item, session.role)) as unknown as Record<string, unknown>[];
        }

        if (entity === 'audit-logs') {
            items = [...items].sort((left, right) => {
                const leftTime =
                    (typeof left.timestamp === 'string' && left.timestamp) ||
                    (typeof left._createdAt === 'string' && left._createdAt) ||
                    '';
                const rightTime =
                    (typeof right.timestamp === 'string' && right.timestamp) ||
                    (typeof right._createdAt === 'string' && right._createdAt) ||
                    '';
                return rightTime.localeCompare(leftTime);
            });
        }

        if (countOnly) {
            return NextResponse.json({
                data: [],
                meta: {
                    page: pageParam ? Number.parseInt(pageParam, 10) || 1 : 1,
                    pageSize: pageSizeParam ? Number.parseInt(pageSizeParam, 10) || 10 : 10,
                    total: totalItems,
                },
            });
        }

        if (needsPaginatedList) {
            return NextResponse.json({
                data: items,
                meta: {
                    page: pageParam ? Number.parseInt(pageParam, 10) || 1 : 1,
                    pageSize: pageSizeParam ? Number.parseInt(pageSizeParam, 10) || 10 : 10,
                    total: totalItems,
                },
            });
        }

        return NextResponse.json({ data: items });
    } catch (err) {
        console.error('API GET Error:', err);
        return NextResponse.json({ error: 'Server error' }, { status: 500 });
    }
}

export async function POST(request: Request) {
    const originError = ensureSameOriginRequest(request);
    if (originError) {
        return originError;
    }

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

        if (entity === 'users') {
            if (action === 'delete') {
                return NextResponse.json({ error: 'User tidak boleh dihapus permanen' }, { status: 409 });
            }

            if (session.role !== 'OWNER' && action !== 'update') {
                return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
            }
        } else {
            const specialMutationPermission = hasSpecialMutationPermission(session, entity, action);
            if (specialMutationPermission === false) {
                return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
            }
            if (specialMutationPermission === null) {
                const forbiddenModuleMutation = forbidModuleAccess(session, entity, getMutationPermissionAction(action));
                if (forbiddenModuleMutation) {
                    return forbiddenModuleMutation;
                }
            }
        }

        const forbidden = forbidOwnerOnlyEntity(session, entity);
        if (forbidden) return forbidden;

        if (LEGACY_READ_ONLY_ENTITIES.has(entity)) {
            return NextResponse.json(
                { error: 'Arsip invoice lama sudah dibekukan. Gunakan Nota Ongkos untuk workflow tagihan aktif.' },
                { status: 409 }
            );
        }

        const docType = SANITY_TYPE_MAP[entity];

        if (action === 'update') {
            return await handleGenericUpdate(session, entity, data, addAuditLog);
        }

        if (action === 'delete') {
            return await handleGenericDelete(session, entity, data, addAuditLog);
        }

        if (entity === 'driver-borongans' && action === 'mark-paid') {
            return await handleBoronganPayment(session, data, addAuditLog);
        }

        if (entity === 'incidents' && action === 'set-status') {
            return await handleIncidentStatusUpdate(session, data, addAuditLog);
        }

        if (entity === 'orders' && action === 'create-with-items') {
            return await handleOrderCreate(session, data, addAuditLog);
        }

        if (entity === 'orders' && action === 'update-with-items') {
            return await handleOrderUpdateWithItems(session, data, addAuditLog);
        }

        if (entity === 'orders' && action === 'revise-targets') {
            return await handleOrderTargetRevision(session, data, addAuditLog);
        }

        if (entity === 'delivery-orders' && action === 'create-with-items') {
            return await handleDeliveryOrderCreate(session, data, addAuditLog);
        }

        if (entity === 'order-items' && action === 'set-hold-quantity') {
            return await handleOrderItemHoldSet(session, data, addAuditLog);
        }

        if (entity === 'order-items' && action === 'release-hold') {
            return await handleOrderItemHoldRelease(session, data, addAuditLog);
        }

        if (entity === 'freight-notas' && action === 'create-with-items') {
            return await handleFreightNotaCreate(session, data, addAuditLog);
        }

        if (entity === 'invoices' && action === 'create-with-items') {
            return await handleInvoiceCreate(session, data, addAuditLog);
        }

        if (entity === 'delivery-orders' && action === 'set-status') {
            return await handleDeliveryOrderStatusUpdate(session, data, addAuditLog);
        }

        if (entity === 'delivery-orders' && action === 'assign-trip-resources') {
            return await handleDeliveryOrderTripResourceAssign(session, data, addAuditLog);
        }

        if (entity === 'delivery-orders' && action === 'update-shipper-reference') {
            return await handleDeliveryOrderShipperReferenceUpdate(session, data, addAuditLog);
        }

        if (entity === 'delivery-orders' && action === 'reject-driver-status-request') {
            return await handleDeliveryOrderDriverStatusRequestReject(session, data, addAuditLog);
        }

        if (entity === 'driver-borongans' && action === 'create-with-items') {
            return NextResponse.json(
                { error: 'Slip borongan baru sudah dinonaktifkan. Gunakan Uang Jalan Trip per DO/trip untuk settlement aktif.' },
                { status: 409 }
            );
        }

        if (entity === 'driver-vouchers' && action === 'settle') {
            return await handleDriverVoucherSettlement(session, data, addAuditLog);
        }

        if (entity === 'driver-vouchers' && action === 'top-up') {
            return await handleDriverVoucherTopUp(session, data, addAuditLog);
        }

        if (entity === 'driver-vouchers' && action === 'repair-issue-ledger') {
            return await handleDriverVoucherIssueRepair(session, data, addAuditLog);
        }

        if (entity === 'driver-voucher-disbursements' && action === 'delete') {
            return await handleDriverVoucherDisbursementDelete(session, data, addAuditLog);
        }

        if (entity === 'bank-transactions' && action === 'transfer') {
            return await handleBankTransfer(session, data, addAuditLog);
        }

        if (entity === 'payments') {
            return await handlePaymentCreate(session, data, addAuditLog);
        }

        if (entity === 'customer-receipts') {
            return await handleCustomerReceiptCreate(session, data, addAuditLog);
        }

        if (entity === 'invoice-adjustments' && action === 'void') {
            return await handleInvoiceAdjustmentVoid(session, data, addAuditLog);
        }

        if (entity === 'invoice-adjustments') {
            return await handleInvoiceAdjustmentCreate(session, data, addAuditLog);
        }

        if (entity === 'expenses') {
            return await handleExpenseCreate(session, data, addAuditLog);
        }

        if (entity === 'driver-vouchers') {
            return await handleDriverVoucherCreate(session, data, addAuditLog);
        }

        if (entity === 'driver-voucher-items') {
            return await handleDriverVoucherItemCreate(session, data, addAuditLog);
        }

        if (entity === 'incidents') {
            return await handleIncidentCreate(session, data, addAuditLog);
        }

        return await handleGenericCreate(session, entity, docType, data, addAuditLog);
    } catch (err) {
        const message = err instanceof Error ? err.message : 'Server error';
        const status = message === 'Forbidden' ? 403 : 400;
        console.error('API POST Error:', err);
        return NextResponse.json({ error: message }, { status });
    }
}
