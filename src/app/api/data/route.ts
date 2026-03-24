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
    sanitizeVehicleForRole,
    type AppModule,
    type ModulePermissions,
} from '@/lib/rbac';
import {
    getSanityClient,
    SANITY_TYPE_MAP,
    sanityCreate,
    sanityGetAll,
    sanityGetByFilter,
    sanityGetById,
    sanityGetCompanyProfile,
    sanityList,
} from '@/lib/sanity';
import { getSuggestedVehicleTireLayout, resolveTireAssetStatus, resolveTireSlotCode } from '@/lib/tire-slots';
import type { BankAccount, DriverBorongan, Expense, TireEvent, User, Vehicle } from '@/lib/types';
import { getDriverVoucherIssuedAmount } from '@/lib/utils';
type DashboardSummary = {
    orderStats: { total: number; open: number; partial: number; complete: number; onHold: number };
    doStats: { total: number; onDelivery: number };
    notaStats: { unpaid: number; totalOutstanding: number };
    boronganStats: { unpaid: number; totalOutstanding: number };
    voucherStats: { unsettled: number; totalIssued: number };
    fleetStats: { openIncidents: number; maintenanceDue: number };
    recentOrders: Array<{ _id: string; masterResi?: string; customerName?: string; status?: string; createdAt?: string }>;
    recentNotas: Array<{
        _id: string;
        notaNumber?: string;
        customerName?: string;
        status?: string;
        totalAmount?: number;
        totalAdjustmentAmount?: number;
        netAmount?: number;
    }>;
};

const OWNER_ONLY_READ_ENTITIES = new Set(['audit-logs']);
const OWNER_ONLY_MUTATION_ENTITIES = new Set(['company', 'audit-logs', 'services', 'expense-categories']);
const LEGACY_READ_ONLY_ENTITIES = new Set(['invoices', 'invoice-items']);
const ENTITY_MODULE_MAP: Partial<Record<keyof typeof SANITY_TYPE_MAP, AppModule>> = {
    customers: 'customers',
    'customer-products': 'customers',
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

function getListSortClause(entity: string, sortPreset?: string | null) {
    if (!sortPreset) return undefined;

    if (entity === 'orders' && sortPreset === 'work-queue') {
        return 'select(status == "OPEN" => 0, status == "PARTIAL" => 1, status == "ON_HOLD" => 2, status == "COMPLETE" => 3, status == "CANCELLED" => 4, 99) asc, createdAt desc';
    }

    if (entity === 'delivery-orders' && sortPreset === 'work-queue') {
        return 'select(defined(pendingDriverStatus) => 0, 1) asc, select(status == "ARRIVED" => 0, status == "ON_DELIVERY" => 1, status == "HEADING_TO_PICKUP" => 2, status == "CREATED" => 3, status == "DELIVERED" => 4, status == "CANCELLED" => 5, 99) asc, date desc';
    }

    if (entity === 'driver-vouchers' && sortPreset === 'work-queue') {
        return 'select(status == "ISSUED" => 0, status == "DRAFT" => 1, status == "SETTLED" => 2, 99) asc, issuedDate desc';
    }

    if (entity === 'maintenances' && sortPreset === 'work-queue') {
        return 'select(status == "SCHEDULED" => 0, status == "DONE" => 1, status == "SKIPPED" => 2, 99) asc, coalesce(plannedDate, "9999-12-31") asc, plannedOdometer asc, _createdAt desc';
    }

    if (entity === 'incidents' && sortPreset === 'work-queue') {
        return 'select(status == "OPEN" => 0, status == "IN_PROGRESS" => 1, status == "RESOLVED" => 2, status == "CLOSED" => 3, 99) asc, dateTime desc';
    }

    return undefined;
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

async function getDashboardSummary(session: Session): Promise<DashboardSummary> {
    const client = getSanityClient();
    const [
        orderStats,
        doStats,
        unpaidNotas,
        notaPayments,
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
        client.fetch<Array<{ _id: string; totalAmount?: number; totalAdjustmentAmount?: number; netAmount?: number }>>(
            `*[_type == "freightNota" && status != "PAID"]{ _id, totalAmount, totalAdjustmentAmount, netAmount }`
        ),
        client.fetch<Array<{ invoiceRef?: string; amount?: number }>>(
            `*[_type == "payment" && defined(invoiceRef)]{ invoiceRef, amount }`
        ),
        client.fetch<Array<{ totalAmount?: number }>>(`*[_type == "driverBorongan" && status != "PAID"]{ totalAmount }`),
        client.fetch<Array<{ cashGiven?: number; totalIssuedAmount?: number }>>(
            `*[_type == "driverVoucher" && status != "SETTLED"]{ cashGiven, totalIssuedAmount }`
        ),
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
            totalAmount,
            totalAdjustmentAmount,
            netAmount
        }`),
    ]);

    const notaPaymentTotals = notaPayments.reduce<Record<string, number>>((acc, payment) => {
        if (typeof payment.invoiceRef === 'string' && payment.invoiceRef) {
            acc[payment.invoiceRef] = (acc[payment.invoiceRef] || 0) + (typeof payment.amount === 'number' ? payment.amount : 0);
        }
        return acc;
    }, {});
    const notaOutstanding = unpaidNotas.reduce((sum, nota) => {
        const grossAmount = typeof nota.totalAmount === 'number' ? nota.totalAmount : 0;
        const adjustmentAmount = typeof nota.totalAdjustmentAmount === 'number' ? nota.totalAdjustmentAmount : 0;
        const netAmount = typeof nota.netAmount === 'number' ? nota.netAmount : grossAmount - adjustmentAmount;
        const paidAmount = notaPaymentTotals[nota._id] || 0;
        return sum + Math.max(netAmount - paidAmount, 0);
    }, 0);
    const boronganOutstanding = unpaidBorongans.reduce(
        (sum, borongan) => sum + (typeof borongan.totalAmount === 'number' ? borongan.totalAmount : 0),
        0
    );
    const voucherIssued = openVouchers.reduce(
        (sum, voucher) => sum + getDriverVoucherIssuedAmount(voucher),
        0
    );
    const canSeeFinancialTotals = session.role === 'OWNER' || session.role === 'FINANCE';

    return {
        orderStats,
        doStats,
        notaStats: {
            unpaid: unpaidNotas.length,
            totalOutstanding: canSeeFinancialTotals ? notaOutstanding : 0,
        },
        boronganStats: {
            unpaid: unpaidBorongans.length,
            totalOutstanding: canSeeFinancialTotals ? boronganOutstanding : 0,
        },
        voucherStats: {
            unsettled: openVouchers.length,
            totalIssued: canSeeFinancialTotals ? voucherIssued : 0,
        },
        fleetStats,
        recentOrders,
        recentNotas,
    };
}

async function getCustomersSummary(ids: string[] = []) {
    const client = getSanityClient();
    const [totalCustomers, totalProducts, customersWithCustomPrefix, customersWithProductsRaw, productRefs] = await Promise.all([
        client.fetch<number>(`count(*[_type == "customer"])`),
        client.fetch<number>(`count(*[_type == "customerProduct"])`),
        client.fetch<number>(`count(*[_type == "customer" && defined(deliveryOrderPrefix) && deliveryOrderPrefix != "" && deliveryOrderPrefix != "SJ"])`),
        client.fetch<string[]>(`array::unique(*[_type == "customerProduct" && defined(customerRef)].customerRef)`),
        ids.length > 0
            ? client.fetch<Array<{ customerRef?: string }>>(
                `*[_type == "customerProduct" && customerRef in $ids]{ customerRef }`,
                { ids }
            )
            : Promise.resolve([]),
    ]);

    const productCounts = productRefs.reduce<Record<string, number>>((acc, product) => {
        if (!product.customerRef) return acc;
        acc[product.customerRef] = (acc[product.customerRef] || 0) + 1;
        return acc;
    }, {});

    const customersWithProducts = Array.isArray(customersWithProductsRaw) ? customersWithProductsRaw.length : 0;

    return {
        totalCustomers,
        totalProducts,
        customersWithCustomPrefix,
        customersNeedingCatalog: Math.max(totalCustomers - customersWithProducts, 0),
        productCounts,
    };
}

type VehicleTireSummary = {
    filled: number;
    expected: number;
    missing: number;
};

function buildVehicleTireSummary(
    vehicle: Pick<Vehicle, '_id' | 'vehicleType' | 'serviceName'>,
    tireEvents: Array<Pick<TireEvent, 'vehicleRef' | 'status' | 'holderType' | 'slotCode' | 'posisi' | 'vehiclePlate' | 'externalPartyName' | 'externalPlateNumber'>>
): VehicleTireSummary {
    const activeSlotCodes = Array.from(
        new Set(
            tireEvents
                .filter(event => event.vehicleRef === vehicle._id && ['IN_USE', 'SPARE'].includes(resolveTireAssetStatus(event)))
                .map(event => resolveTireSlotCode(event) || '')
                .filter(Boolean)
        )
    );
    const layout = getSuggestedVehicleTireLayout(vehicle.vehicleType, vehicle.serviceName, activeSlotCodes);
    const filled = activeSlotCodes.length;
    const expected = layout.allSlots.length;
    return {
        filled,
        expected,
        missing: Math.max(expected - filled, 0),
    };
}

async function getVehiclesSummary(ids: string[] = []) {
    const client = getSanityClient();
    const [vehicles, tireEvents] = await Promise.all([
        client.fetch<Array<Pick<Vehicle, '_id' | 'status' | 'vehicleType' | 'serviceName'>>>(
            `*[_type == "vehicle"]{ _id, status, vehicleType, serviceName }`
        ),
        client.fetch<Array<Pick<TireEvent, 'vehicleRef' | 'status' | 'holderType' | 'slotCode' | 'posisi' | 'vehiclePlate' | 'externalPartyName' | 'externalPlateNumber'>>>(
            `*[_type == "tireEvent" && defined(vehicleRef)]{
                vehicleRef,
                status,
                holderType,
                slotCode,
                posisi,
                vehiclePlate,
                externalPartyName,
                externalPlateNumber
            }`
        ),
    ]);

    const vehicleMap = new Map(vehicles.map(vehicle => [vehicle._id, vehicle]));
    const tireSummaries = ids.reduce<Record<string, VehicleTireSummary>>((acc, id) => {
        const vehicle = vehicleMap.get(id);
        if (!vehicle) return acc;
        acc[id] = buildVehicleTireSummary(vehicle, tireEvents);
        return acc;
    }, {});

    const totalVehicles = vehicles.length;
    const activeVehicleCount = vehicles.filter(vehicle => vehicle.status === 'ACTIVE').length;
    const incompleteTireCount = vehicles.reduce((sum, vehicle) => {
        const summary = buildVehicleTireSummary(vehicle, tireEvents);
        return sum + (summary.missing > 0 ? 1 : 0);
    }, 0);

    return {
        totalVehicles,
        activeVehicleCount,
        nonOperationalCount: Math.max(totalVehicles - activeVehicleCount, 0),
        incompleteTireCount,
        tireSummaries,
    };
}

async function getExpensesSummary(session: Session, search = '') {
    const client = getSanityClient();
    const [expenseRows, vehicleRows] = await Promise.all([
        client.fetch<Array<Pick<Expense, 'amount' | 'categoryName' | 'privacyLevel' | 'note' | 'description' | 'relatedVehicleRef' | 'relatedVehiclePlate'>>>(
            `*[_type == "expense"]{
                amount,
                categoryName,
                privacyLevel,
                note,
                description,
                relatedVehicleRef,
                relatedVehiclePlate
            }`
        ),
        client.fetch<Array<Pick<Vehicle, '_id' | 'plateNumber'>>>(`*[_type == "vehicle"]{ _id, plateNumber }`),
    ]);

    const visibleExpenses = filterExpensesByRole(expenseRows as Expense[], session.role);
    const vehicleMap = new Map(vehicleRows.map(vehicle => [vehicle._id, vehicle.plateNumber || '']));
    const query = search.trim().toLowerCase();
    const filteredExpenses = !query
        ? visibleExpenses
        : visibleExpenses.filter(expense => {
            const vehicleLabel =
                expense.relatedVehiclePlate ||
                (expense.relatedVehicleRef ? vehicleMap.get(expense.relatedVehicleRef) : '') ||
                '';
            return (
                expense.note?.toLowerCase().includes(query) ||
                expense.description?.toLowerCase().includes(query) ||
                expense.categoryName?.toLowerCase().includes(query) ||
                vehicleLabel.toLowerCase().includes(query)
            );
        });

    const grandTotal = filteredExpenses.reduce((sum, expense) => sum + (typeof expense.amount === 'number' ? expense.amount : 0), 0);
    const categoryTotals = Object.entries(
        filteredExpenses.reduce<Record<string, number>>((acc, expense) => {
            const key = expense.categoryName || 'Lainnya';
            acc[key] = (acc[key] || 0) + (typeof expense.amount === 'number' ? expense.amount : 0);
            return acc;
        }, {})
    )
        .sort((left, right) => right[1] - left[1])
        .map(([name, total]) => ({ name, total }));

    return {
        grandTotal,
        transactionCount: filteredExpenses.length,
        avgAmount: filteredExpenses.length > 0 ? grandTotal / filteredExpenses.length : 0,
        categoryTotals,
    };
}

async function getBankAccountsSummary() {
    const client = getSanityClient();
    const accounts = await client.fetch<Array<Pick<BankAccount, '_id' | 'accountType' | 'systemKey' | 'initialBalance' | 'currentBalance' | 'active'>>>(
        `*[_type == "bankAccount" && active != false]{
            _id,
            accountType,
            systemKey,
            initialBalance,
            currentBalance,
            active
        }`
    );

    const isCash = (account: Pick<BankAccount, 'accountType' | 'systemKey'>) =>
        account.accountType === 'CASH' || account.systemKey === 'cash-on-hand';

    const totalBalance = accounts.reduce((sum, account) => sum + (account.currentBalance || 0), 0);
    const totalInitial = accounts.reduce((sum, account) => sum + (account.initialBalance || 0), 0);
    const cashBalance = accounts.filter(isCash).reduce((sum, account) => sum + (account.currentBalance || 0), 0);
    const bankBalance = accounts.filter(account => !isCash(account)).reduce((sum, account) => sum + (account.currentBalance || 0), 0);

    return {
        totalAccounts: accounts.length,
        totalBalance,
        totalInitial,
        cashBalance,
        bankBalance,
    };
}

async function getAuditLogsSummary() {
    const client = getSanityClient();
    const today = new Date().toISOString().slice(0, 10);
    const [totalLogs, todayLogs, loginLogs, mutationLogs] = await Promise.all([
        client.fetch<number>(`count(*[_type == "auditLog"])`),
        client.fetch<number>(`count(*[_type == "auditLog" && (coalesce(timestamp, _createdAt)[0..9] == $today)])`, { today }),
        client.fetch<number>(`count(*[_type == "auditLog" && (action == "LOGIN" || action == "LOGOUT")])`),
        client.fetch<number>(`count(*[_type == "auditLog" && action in ["CREATE", "UPDATE", "DELETE"]])`),
    ]);

    return {
        totalLogs,
        todayLogs,
        loginLogs,
        mutationLogs,
    };
}

async function getBoronganSummary(search = '', status = '') {
    const client = getSanityClient();
    const items = await client.fetch<Array<Pick<DriverBorongan, '_id' | 'boronganNumber' | 'driverName' | 'status' | 'totalAmount'>>>(
        `*[_type == "driverBorongan"]{
            _id,
            boronganNumber,
            driverName,
            status,
            totalAmount
        }`
    );

    const query = search.trim().toLowerCase();
    const filtered = items.filter(item => {
        const matchesSearch = !query ||
            item.boronganNumber?.toLowerCase().includes(query) ||
            item.driverName?.toLowerCase().includes(query);
        const matchesStatus = !status || item.status === status;
        return matchesSearch && matchesStatus;
    });

    return {
        totalAmount: filtered.reduce((sum, item) => sum + (item.totalAmount || 0), 0),
        unpaidCount: filtered.filter(item => item.status === 'UNPAID').length,
        paidCount: filtered.filter(item => item.status === 'PAID').length,
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
        if (!hasPermission(session.role, 'driverBorongans', 'view')) {
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
            const forbiddenModuleMutation = forbidModuleAccess(session, entity, getMutationPermissionAction(action));
            if (forbiddenModuleMutation) {
                return forbiddenModuleMutation;
            }
        }

        const forbidden = forbidOwnerOnlyEntity(session, entity);
        if (forbidden) return forbidden;

        if (LEGACY_READ_ONLY_ENTITIES.has(entity)) {
            return NextResponse.json(
                { error: 'Invoice legacy sudah dibekukan. Gunakan Nota Ongkos untuk workflow tagihan aktif.' },
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
