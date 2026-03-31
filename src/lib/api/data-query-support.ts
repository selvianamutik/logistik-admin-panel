import type { ApiSession } from '@/lib/api/data-helpers';
import { filterExpensesByRole, hasPageAccess, hasPermission } from '@/lib/rbac';
import {
    getSanityClient,
} from '@/lib/sanity';
import { getSuggestedVehicleTireLayout, resolveTireAssetStatus, resolveTireSlotCode } from '@/lib/tire-slots';
import { parseFormattedNumberish } from '@/lib/formatted-number';
import type {
    BankAccount,
    CustomerReceipt,
    DriverBorongan,
    Expense,
    FreightNota,
    Payment,
    TireEvent,
    Vehicle,
} from '@/lib/types';
import { deriveReceivableStatus, getDriverVoucherIssuedAmount, getReceivableNetAmount, getReceivableRemainingAmount } from '@/lib/utils';

function parseWholeMoneyLike(value: unknown) {
    return Math.max(parseFormattedNumberish(value ?? 0, { maxFractionDigits: 0 }), 0);
}

function getFreightNotaPaymentTotals(paymentRows: Array<{ invoiceRef?: string; amount?: unknown }>) {
    return paymentRows.reduce<Record<string, number>>((acc, payment) => {
        if (!payment.invoiceRef) return acc;
        acc[payment.invoiceRef] = (acc[payment.invoiceRef] || 0) + parseWholeMoneyLike(payment.amount);
        return acc;
    }, {});
}

function applyDerivedFreightNotaStatus<T extends {
    _id: string;
    status?: string;
    totalAmount?: string | number | null;
    totalAdjustmentAmount?: string | number | null;
    netAmount?: string | number | null;
    issueDate?: string;
    _createdAt?: string;
}>(
    notas: T[],
    paymentTotalsByInvoice: Record<string, number>
) {
    return notas.map(nota => ({
        ...nota,
        status: deriveReceivableStatus(nota, paymentTotalsByInvoice[nota._id] || 0),
    }));
}

function matchesScalarFilter(actualValue: unknown, expectedValue: unknown) {
    if (Array.isArray(expectedValue)) {
        return expectedValue.includes(actualValue as never);
    }
    return actualValue === expectedValue;
}

function matchesFreightNotaFilter(
    nota: Record<string, unknown>,
    filterObj: Record<string, unknown>,
    orFilters: Array<{ fields: string[]; value: string | number | boolean }>,
    definedFields: string[],
    search: string,
    searchFields: string[]
) {
    const matchesSearch =
        !search ||
        searchFields.length === 0 ||
        searchFields.some(field => {
            const value = nota[field];
            return typeof value === 'string' && value.toLowerCase().includes(search);
        });

    if (!matchesSearch) return false;

    const matchesFilter = Object.entries(filterObj).every(([key, expectedValue]) =>
        matchesScalarFilter(nota[key], expectedValue)
    );
    if (!matchesFilter) return false;

    const matchesDefinedFields = definedFields.every(field => {
        const value = nota[field];
        return value !== undefined && value !== null && value !== '';
    });
    if (!matchesDefinedFields) return false;

    const matchesOrFilters = orFilters.every(orFilter =>
        orFilter.fields.some(field => matchesScalarFilter(nota[field], orFilter.value))
    );

    return matchesOrFilters;
}

function compareFreightNotaValues(left: unknown, right: unknown, direction: 'asc' | 'desc') {
    const leftNumber = parseFormattedNumberish(left as string | number | undefined | null);
    const rightNumber = parseFormattedNumberish(right as string | number | undefined | null);
    const canCompareAsNumber = Number.isFinite(leftNumber) && Number.isFinite(rightNumber);
    const multiplier = direction === 'asc' ? 1 : -1;

    if (canCompareAsNumber) {
        if (leftNumber === rightNumber) return 0;
        return leftNumber > rightNumber ? multiplier : -multiplier;
    }

    const leftText = typeof left === 'string' ? left : String(left ?? '');
    const rightText = typeof right === 'string' ? right : String(right ?? '');
    return leftText.localeCompare(rightText) * multiplier;
}

export async function getFreightNotaList(params: {
    filterObj?: Record<string, unknown>;
    orFilters?: Array<{ fields: string[]; value: string | number | boolean }>;
    definedFields?: string[];
    search?: string;
    searchFields?: string[];
    page?: number;
    pageSize?: number;
    sortField?: string;
    sortDir?: 'asc' | 'desc';
    sortPreset?: string | null;
    countOnly?: boolean;
}) {
    const client = getSanityClient();
    const [notaRows, paymentRows] = await Promise.all([
        client.fetch<Array<FreightNota & { _createdAt?: string }>>(`*[_type == "freightNota"]`),
        client.fetch<Array<{ invoiceRef?: string; amount?: unknown }>>(`*[_type == "payment" && defined(invoiceRef)]{ invoiceRef, amount }`),
    ]);

    const paymentTotalsByInvoice = getFreightNotaPaymentTotals(paymentRows);
    const search = params.search?.trim().toLowerCase() || '';
    const filterObj = params.filterObj ?? {};
    const orFilters = params.orFilters ?? [];
    const definedFields = params.definedFields ?? [];
    const searchFields = (params.searchFields ?? []).map(field => field.trim()).filter(Boolean);
    const withDerivedStatus = applyDerivedFreightNotaStatus(notaRows, paymentTotalsByInvoice);

    let filtered = withDerivedStatus.filter(nota =>
            matchesFreightNotaFilter(
            nota as unknown as Record<string, unknown>,
            filterObj,
            orFilters,
            definedFields,
            search,
            searchFields
        )
    );

    if (params.sortPreset === 'work-queue') {
        const statusRank: Record<string, number> = { UNPAID: 0, PARTIAL: 1, PAID: 2 };
        filtered = [...filtered].sort((left, right) => {
            const leftRank = statusRank[left.status] ?? 99;
            const rightRank = statusRank[right.status] ?? 99;
            if (leftRank !== rightRank) return leftRank - rightRank;
            const dateCompare = (left.issueDate || '').localeCompare(right.issueDate || '');
            if (dateCompare !== 0) return dateCompare;
            return (right._createdAt || '').localeCompare(left._createdAt || '');
        });
    } else if (params.sortField) {
        const direction = params.sortDir === 'asc' ? 'asc' : 'desc';
        const sortField = params.sortField;
        filtered = [...filtered].sort((left, right) => {
            const leftValue = sortField === 'status' ? left.status : (left as unknown as Record<string, unknown>)[sortField];
            const rightValue = sortField === 'status' ? right.status : (right as unknown as Record<string, unknown>)[sortField];
            return compareFreightNotaValues(leftValue, rightValue, direction);
        });
    }

    const total = filtered.length;
    if (params.countOnly) {
        return { items: [] as FreightNota[], total };
    }

    if (!params.page || !params.pageSize) {
        return { items: filtered, total };
    }

    const offset = Math.max(params.page - 1, 0) * Math.max(params.pageSize, 1);
    return {
        items: filtered.slice(offset, offset + params.pageSize),
        total,
    };
}

export async function getFreightNotaById(id: string) {
    const client = getSanityClient();
    const [nota, paymentRows] = await Promise.all([
        client.fetch<(FreightNota & { _createdAt?: string }) | null>(
            `*[_type == "freightNota" && _id == $id][0]`,
            { id }
        ),
        client.fetch<Array<{ invoiceRef?: string; amount?: unknown }>>(
            `*[_type == "payment" && invoiceRef == $id]{ invoiceRef, amount }`,
            { id }
        ),
    ]);

    if (!nota) return null;
    const paymentTotalsByInvoice = getFreightNotaPaymentTotals(paymentRows);
    return applyDerivedFreightNotaStatus([nota], paymentTotalsByInvoice)[0];
}

export type DashboardSummary = {
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

export function getListSortClause(entity: string, sortPreset?: string | null) {
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

    if (entity === 'freight-notas' && sortPreset === 'work-queue') {
        return 'select(status == "UNPAID" => 0, status == "PARTIAL" => 1, status == "PAID" => 2, 99) asc, issueDate asc, _createdAt desc';
    }

    if (entity === 'maintenances' && sortPreset === 'work-queue') {
        return 'select(status == "SCHEDULED" => 0, status == "DONE" => 1, status == "SKIPPED" => 2, 99) asc, coalesce(plannedDate, "9999-12-31") asc, plannedOdometer asc, _createdAt desc';
    }

    if (entity === 'incidents' && sortPreset === 'work-queue') {
        return 'select(status == "OPEN" => 0, status == "IN_PROGRESS" => 1, status == "RESOLVED" => 2, status == "CLOSED" => 3, 99) asc, dateTime desc';
    }

    return undefined;
}

export async function getDashboardSummary(session: ApiSession): Promise<DashboardSummary> {
    const client = getSanityClient();
    const canViewOrders = hasPageAccess(session.role, 'orders');
    const canViewInvoices = hasPermission(session.role, 'freightNotas', 'view');
    const canViewTripCash = hasPermission(session.role, 'driverVouchers', 'view');
    const canViewFleet = hasPermission(session.role, 'incidents', 'view') || hasPermission(session.role, 'maintenance', 'view');
    const canSeeBorongan = hasPermission(session.role, 'driverBorongans', 'view');
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
        canViewOrders
            ? client.fetch<DashboardSummary['orderStats']>(`{
                "total": count(*[_type == "order"]),
                "open": count(*[_type == "order" && status == "OPEN"]),
                "partial": count(*[_type == "order" && status == "PARTIAL"]),
                "complete": count(*[_type == "order" && status == "COMPLETE"]),
                "onHold": count(*[_type == "order" && status == "ON_HOLD"])
            }`)
            : Promise.resolve({ total: 0, open: 0, partial: 0, complete: 0, onHold: 0 }),
        client.fetch<DashboardSummary['doStats']>(`{
            "total": count(*[_type == "deliveryOrder"]),
            "onDelivery": count(*[_type == "deliveryOrder" && status == "ON_DELIVERY"])
        }`),
        canViewInvoices
            ? client.fetch<Array<Pick<FreightNota, '_id' | 'status' | 'totalAmount' | 'totalAdjustmentAmount' | 'netAmount'>>>(
                `*[_type == "freightNota"]{ _id, status, totalAmount, totalAdjustmentAmount, netAmount }`
            )
            : Promise.resolve([]),
        canViewInvoices
            ? client.fetch<Array<{ invoiceRef?: string; amount?: number }>>(
                `*[_type == "payment" && defined(invoiceRef)]{ invoiceRef, amount }`
            )
            : Promise.resolve([]),
        canSeeBorongan
            ? client.fetch<Array<{ totalAmount?: number }>>(`*[_type == "driverBorongan" && status != "PAID"]{ totalAmount }`)
            : Promise.resolve([]),
        canViewTripCash
            ? client.fetch<Array<{ cashGiven?: number; totalIssuedAmount?: number }>>(
                `*[_type == "driverVoucher" && status != "SETTLED"]{ cashGiven, totalIssuedAmount }`
            )
            : Promise.resolve([]),
        canViewFleet
            ? client.fetch<DashboardSummary['fleetStats']>(`{
                "openIncidents": count(*[_type == "incident" && (status == "OPEN" || status == "IN_PROGRESS")]),
                "maintenanceDue": count(*[_type == "maintenance" && status == "SCHEDULED"])
            }`)
            : Promise.resolve({ openIncidents: 0, maintenanceDue: 0 }),
        canViewOrders
            ? client.fetch<DashboardSummary['recentOrders']>(`*[_type == "order"] | order(_createdAt desc)[0...5]{
                _id,
                masterResi,
                customerName,
                status,
                createdAt
            }`)
            : Promise.resolve([]),
        canViewInvoices
            ? client.fetch<DashboardSummary['recentNotas']>(`*[_type == "freightNota"] | order(_createdAt desc)[0...5]{
                _id,
                notaNumber,
                customerName,
                status,
                totalAmount,
                totalAdjustmentAmount,
                netAmount
            }`)
            : Promise.resolve([]),
    ]);

    const notaPaymentTotals = getFreightNotaPaymentTotals(notaPayments);
    const derivedUnpaidNotas = applyDerivedFreightNotaStatus(unpaidNotas, notaPaymentTotals).filter(nota => nota.status !== 'PAID');
    const recentNotasWithDerivedStatus = applyDerivedFreightNotaStatus(recentNotas, notaPaymentTotals);
    const notaOutstanding = derivedUnpaidNotas.reduce((sum, nota) => {
        const paidAmount = notaPaymentTotals[nota._id] || 0;
        return sum + Math.max(getReceivableNetAmount(nota) - paidAmount, 0);
    }, 0);
    const boronganOutstanding = unpaidBorongans.reduce(
        (sum, borongan) => sum + parseWholeMoneyLike(borongan.totalAmount),
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
            unpaid: canViewInvoices ? derivedUnpaidNotas.length : 0,
            totalOutstanding: canViewInvoices && canSeeFinancialTotals ? notaOutstanding : 0,
        },
        boronganStats: {
            unpaid: canSeeBorongan ? unpaidBorongans.length : 0,
            totalOutstanding: canSeeBorongan ? boronganOutstanding : 0,
        },
        voucherStats: {
            unsettled: canViewTripCash ? openVouchers.length : 0,
            totalIssued: canViewTripCash && canSeeFinancialTotals ? voucherIssued : 0,
        },
        fleetStats,
        recentOrders,
        recentNotas: recentNotasWithDerivedStatus,
    };
}

export async function getCustomersSummary(ids: string[] = []) {
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

export async function getVehiclesSummary(ids: string[] = []) {
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

export async function getExpensesSummary(session: ApiSession, search = '') {
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

    const grandTotal = filteredExpenses.reduce((sum, expense) => sum + parseWholeMoneyLike(expense.amount), 0);
    const categoryTotals = Object.entries(
        filteredExpenses.reduce<Record<string, number>>((acc, expense) => {
            const key = expense.categoryName || 'Lainnya';
            acc[key] = (acc[key] || 0) + parseWholeMoneyLike(expense.amount);
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

export async function getBankAccountsSummary() {
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

    const totalBalance = accounts.reduce((sum, account) => sum + parseWholeMoneyLike(account.currentBalance), 0);
    const totalInitial = accounts.reduce((sum, account) => sum + parseWholeMoneyLike(account.initialBalance), 0);
    const cashBalance = accounts.filter(isCash).reduce((sum, account) => sum + parseWholeMoneyLike(account.currentBalance), 0);
    const bankBalance = accounts.filter(account => !isCash(account)).reduce((sum, account) => sum + parseWholeMoneyLike(account.currentBalance), 0);

    return {
        totalAccounts: accounts.length,
        totalBalance,
        totalInitial,
        cashBalance,
        bankBalance,
    };
}

export async function getAuditLogsSummary() {
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

export async function getBoronganSummary(search = '', status = '') {
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
        totalAmount: filtered.reduce((sum, item) => sum + parseWholeMoneyLike(item.totalAmount), 0),
        unpaidCount: filtered.filter(item => item.status === 'UNPAID').length,
        paidCount: filtered.filter(item => item.status === 'PAID').length,
    };
}

export async function getDriverBoronganDoRefsSummary() {
    const client = getSanityClient();
    const rows = await client.fetch<Array<{ doRef?: string }>>(
        `*[_type == "driverBoronganItem" && defined(doRef)]{ doRef }`
    );

    return {
        doRefs: Array.from(
            new Set(
                rows
                    .map(item => item.doRef)
                    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
            )
        ),
    };
}

export type FreightNotasSummary = {
    filteredNetTotal: number;
    filteredOutstandingTotal: number;
    unpaidCount: number;
    partialCount: number;
    paidCount: number;
    customerCreditTotal: number;
};

function matchesFreightNotaSearch(nota: Pick<FreightNota, 'notaNumber' | 'customerName'>, search: string) {
    if (!search) return true;
    const query = search.trim().toLowerCase();
    if (!query) return true;

    return (
        nota.notaNumber?.toLowerCase().includes(query) ||
        nota.customerName?.toLowerCase().includes(query)
    );
}

export async function getFreightNotasSummary(search = '', status = ''): Promise<FreightNotasSummary> {
    const client = getSanityClient();
    const [notaRows, paymentRows, receiptRows] = await Promise.all([
        client.fetch<Array<Pick<FreightNota, '_id' | 'notaNumber' | 'customerName' | 'status' | 'totalAmount' | 'totalAdjustmentAmount' | 'netAmount'>>>(
            `*[_type == "freightNota"]{
                _id,
                notaNumber,
                customerName,
                status,
                totalAmount,
                totalAdjustmentAmount,
                netAmount
            }`
        ),
        client.fetch<Array<Pick<Payment, 'invoiceRef' | 'amount'>>>(
            `*[_type == "payment" && defined(invoiceRef)]{
                invoiceRef,
                amount
            }`
        ),
        client.fetch<Array<Pick<CustomerReceipt, 'unappliedAmount'>>>(
            `*[_type == "customerReceipt" && defined(unappliedAmount) && unappliedAmount > 0]{
                unappliedAmount
            }`
        ),
    ]);

    const paymentTotalsByInvoice = getFreightNotaPaymentTotals(paymentRows);
    const notasWithDerivedStatus = applyDerivedFreightNotaStatus(notaRows, paymentTotalsByInvoice);
    const filteredNotas = notasWithDerivedStatus.filter(nota => {
        const matchesSearch = matchesFreightNotaSearch(nota, search);
        const matchesStatus = !status || nota.status === status;
        return matchesSearch && matchesStatus;
    });

    return {
        filteredNetTotal: filteredNotas.reduce((sum, nota) => sum + getReceivableNetAmount(nota), 0),
        filteredOutstandingTotal: filteredNotas.reduce(
            (sum, nota) => sum + getReceivableRemainingAmount(nota, paymentTotalsByInvoice[nota._id] || 0),
            0
        ),
        unpaidCount: notasWithDerivedStatus.filter(nota => nota.status === 'UNPAID').length,
        partialCount: notasWithDerivedStatus.filter(nota => nota.status === 'PARTIAL').length,
        paidCount: notasWithDerivedStatus.filter(nota => nota.status === 'PAID').length,
        customerCreditTotal: receiptRows.reduce(
            (sum, receipt) => sum + parseWholeMoneyLike(receipt.unappliedAmount),
            0
        ),
    };
}
