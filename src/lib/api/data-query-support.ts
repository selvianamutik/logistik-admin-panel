import type { ApiSession } from '@/lib/api/data-helpers';
import { addDaysToDateValue, getBusinessCalendarDateParts, getBusinessDateValue } from '@/lib/business-date';
import {
    EMPLOYEE_ATTENDANCE_PERIOD_LABELS,
    getEmployeeAttendancePeriodRange,
    isDateWithinEmployeeAttendanceRange,
    normalizeEmployeeAttendanceStatus,
    type EmployeeAttendancePeriod,
} from '@/lib/employee-attendance';
import { filterExpensesByRole, hasPageAccess, hasPermission } from '@/lib/rbac';
import {
    getSanityClient,
} from '@/lib/sanity';
import { getSuggestedVehicleTireLayout, resolveTireAssetStatus, resolveTireSlotCode } from '@/lib/tire-slots';
import { parseFormattedNumberish } from '@/lib/formatted-number';
import {
    applyDerivedCustomerReceiptOverpaymentState,
    applyDerivedFreightNotaReceivableState,
    buildCustomerOverpaymentCases,
    getCustomerOverpaymentRefundTotals,
    getFreightNotaPaymentTotals,
    sortCustomerOverpaymentCases,
} from '@/lib/customer-overpayments';
import type {
    BankAccount,
    BankTransaction,
    CustomerOverpayment,
    CustomerOverpaymentRefund,
    CustomerReceipt,
    DriverBorongan,
    DriverBoronganItem,
    DriverVoucherDisbursement,
    DriverVoucherItem,
    DriverVoucher,
    Expense,
    FreightNota,
    Employee,
    EmployeeAttendanceRecord,
    Payment,
    TireEvent,
    AuditLog,
    UserRole,
    Vehicle,
} from '@/lib/types';
import { getDriverVoucherFinancialSummary, getDriverVoucherIssuedAmount, getReceivableNetAmount } from '@/lib/utils';

function parseWholeMoneyLike(value: unknown) {
    return Math.max(parseFormattedNumberish(value ?? 0, { maxFractionDigits: 0 }), 0);
}

function normalizeTextSearch(value: unknown) {
    return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function sortEmployeeAttendanceRecords(
    rows: EmployeeAttendanceRecord[],
    sortField?: string,
    sortDir?: 'asc' | 'desc',
) {
    const direction = sortDir === 'asc' ? 1 : -1;
    const field = sortField || 'date';

    return [...rows].sort((left, right) => {
        if (field === 'status') {
            return String(left.status || '').localeCompare(String(right.status || '')) * direction;
        }
        if (field === 'employeeCode') {
            return String(left.employeeCode || '').localeCompare(String(right.employeeCode || '')) * direction;
        }
        if (field === 'employeeName') {
            return String(left.employeeName || '').localeCompare(String(right.employeeName || '')) * direction;
        }
        if (field === 'division') {
            return String(left.division || '').localeCompare(String(right.division || '')) * direction;
        }
        if (field === 'checkInTime') {
            return String(left.checkInTime || '').localeCompare(String(right.checkInTime || '')) * direction;
        }
        const dateCompare = String(left.date || '').localeCompare(String(right.date || '')) * direction;
        if (dateCompare !== 0) return dateCompare;
        return String(left.employeeName || '').localeCompare(String(right.employeeName || '')) * direction;
    });
}

function buildNormalizedAttendanceRecord(
    record: EmployeeAttendanceRecord,
    employeesById: Map<string, Employee>,
) {
    const employee = record.employeeRef ? employeesById.get(record.employeeRef) : undefined;
    return {
        ...record,
        employeeCode: record.employeeCode || employee?.employeeCode || '',
        employeeName: record.employeeName || employee?.name || '',
        position: record.position || employee?.position || '',
        division: record.division || employee?.division || '',
    };
}

async function getEmployeeAttendanceDataset() {
    const [employees, attendanceRows] = await Promise.all([
        getSanityClient().fetch<Employee[]>(
            `*[_type == "employee"] | order(active desc, employeeCode asc, name asc)`
        ),
        getSanityClient().fetch<EmployeeAttendanceRecord[]>(
            `*[_type == "employeeAttendanceRecord"]`
        ),
    ]);

    const employeesById = new Map(employees.map(employee => [employee._id, employee]));
    const normalizedRows = attendanceRows.map(record => buildNormalizedAttendanceRecord(record, employeesById));

    return {
        employees,
        employeesById,
        attendanceRows: normalizedRows,
    };
}

function filterEmployeeAttendanceRecords(
    rows: EmployeeAttendanceRecord[],
    params: Pick<EmployeeAttendanceListParams, 'search' | 'searchFields' | 'period' | 'date' | 'status' | 'employeeRef'>,
) {
    const search = normalizeTextSearch(params.search);
    const searchableFields = (params.searchFields || []).map(field => field.trim()).filter(Boolean);
    const period = normalizeEmployeeAttendancePeriod(params.period);
    const anchorDate = params.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date) ? params.date : getBusinessDateValue();
    const range = getEmployeeAttendancePeriodRange(period, anchorDate);
    const status = normalizeEmployeeAttendanceStatus(params.status);
    const employeeRef = typeof params.employeeRef === 'string' ? params.employeeRef.trim() : '';
    const fields = searchableFields.length > 0
        ? searchableFields
        : ['employeeCode', 'employeeName', 'division', 'position', 'note', 'date'];

    return rows.filter(record => {
        if (!isDateWithinEmployeeAttendanceRange(record.date, range)) {
            return false;
        }
        if (status && record.status !== status) {
            return false;
        }
        if (employeeRef && record.employeeRef !== employeeRef) {
            return false;
        }
        if (!search) {
            return true;
        }

        return fields.some(field => {
            const value = (record as unknown as Record<string, unknown>)[field];
            return typeof value === 'string' && value.toLowerCase().includes(search);
        });
    });
}

function normalizeBusinessDateValue(value: string | undefined) {
    if (!value) return '';
    const parts = getBusinessCalendarDateParts(value);
    return parts ? `${parts.year}-${parts.month}-${parts.day}` : '';
}

function buildInvoiceOverpaymentDetectedDateMap(
    rows: Array<{ invoiceRef?: string; date?: string; editedAt?: string }>
) {
    return rows.reduce<Record<string, string>>((acc, row) => {
        if (!row.invoiceRef) return acc;
        const candidate = normalizeBusinessDateValue(row.editedAt) || normalizeBusinessDateValue(row.date);
        if (!candidate) return acc;
        if (!acc[row.invoiceRef] || candidate > acc[row.invoiceRef]) {
            acc[row.invoiceRef] = candidate;
        }
        return acc;
    }, {});
}

function normalizeAuditActorRole(value: unknown): UserRole | undefined {
    return value === 'OWNER' || value === 'OPERASIONAL' || value === 'FINANCE' || value === 'ARMADA' || value === 'DRIVER' || value === 'ADMIN'
        ? value
        : undefined;
}

function inferAuditActorRoleFromIdentity(input: {
    actorUserRef?: unknown;
    actorUserEmail?: unknown;
    entityRef?: unknown;
}) {
    const ref = typeof input.actorUserRef === 'string'
        ? input.actorUserRef.trim().toLowerCase()
        : typeof input.entityRef === 'string'
            ? input.entityRef.trim().toLowerCase()
            : '';
    const email = typeof input.actorUserEmail === 'string' ? input.actorUserEmail.trim().toLowerCase() : '';
    const identity = `${ref} ${email}`;

    if (identity.includes('user-owner-') || email.startsWith('owner@')) return 'OWNER' satisfies UserRole;
    if (identity.includes('user-admin-') || email.startsWith('admin@')) return 'OPERASIONAL' satisfies UserRole;
    if (identity.includes('user-finance-') || email.startsWith('finance@')) return 'FINANCE' satisfies UserRole;
    if (identity.includes('user-armada-') || email.startsWith('armada@')) return 'ARMADA' satisfies UserRole;
    if (identity.includes('user-driver-') || email.startsWith('driver.')) return 'DRIVER' satisfies UserRole;
    return undefined;
}

function inferAuditActorEmailFromRef(actorUserRef: unknown, entityRef?: unknown) {
    const ref = typeof actorUserRef === 'string'
        ? actorUserRef.trim().toLowerCase()
        : typeof entityRef === 'string'
            ? entityRef.trim().toLowerCase()
            : '';
    if (ref.includes('user-owner-')) return 'owner@company.local';
    if (ref.includes('user-admin-')) return 'admin@company.local';
    if (ref.includes('user-finance-')) return 'finance@company.local';
    if (ref.includes('user-armada-')) return 'armada@company.local';
    return undefined;
}

export type AuditLogPeriod = 'today' | 'yesterday' | 'last7days' | 'thisMonth' | 'thisYear' | 'all';

function normalizeAuditLogPeriod(value?: string | null): AuditLogPeriod {
    if (
        value === 'today' ||
        value === 'yesterday' ||
        value === 'last7days' ||
        value === 'thisMonth' ||
        value === 'thisYear' ||
        value === 'all'
    ) {
        return value;
    }
    return 'today';
}

function getAuditLogBusinessDateValue(log: Pick<AuditLog, 'timestamp' | '_createdAt'>) {
    const parts = getBusinessCalendarDateParts(log.timestamp || log._createdAt || '');
    return parts ? `${parts.year}-${parts.month}-${parts.day}` : '';
}

function matchesAuditLogPeriod(
    log: Pick<AuditLog, 'timestamp' | '_createdAt'>,
    period: AuditLogPeriod,
    today: string
) {
    if (period === 'all') return true;

    const businessDate = getAuditLogBusinessDateValue(log);
    if (!businessDate) return false;

    if (period === 'today') return businessDate === today;
    if (period === 'yesterday') return businessDate === addDaysToDateValue(today, -1);
    if (period === 'last7days') return businessDate >= addDaysToDateValue(today, -6) && businessDate <= today;
    if (period === 'thisMonth') return businessDate.slice(0, 7) === today.slice(0, 7);
    if (period === 'thisYear') return businessDate.slice(0, 4) === today.slice(0, 4);
    return true;
}

function sortAuditLogs(logs: AuditLog[], sortField?: string, sortDir?: 'asc' | 'desc') {
    const field = sortField?.trim() || 'timestamp';
    const direction = sortDir === 'asc' ? 'asc' : 'desc';
    const multiplier = direction === 'asc' ? 1 : -1;

    return [...logs].sort((left, right) => {
        const leftValue = (left as unknown as Record<string, unknown>)[field];
        const rightValue = (right as unknown as Record<string, unknown>)[field];

        if (typeof leftValue === 'string' && typeof rightValue === 'string') {
            return leftValue.localeCompare(rightValue) * multiplier;
        }

        const fallbackLeft = (left.timestamp || left._createdAt || '');
        const fallbackRight = (right.timestamp || right._createdAt || '');
        return fallbackLeft.localeCompare(fallbackRight) * multiplier;
    });
}

async function getFilteredAuditLogs(params: {
    search?: string;
    searchFields?: string[];
    sortField?: string;
    sortDir?: 'asc' | 'desc';
    period?: string | null;
}) {
    const client = getSanityClient();
    const [rawLogs, users] = await Promise.all([
        client.fetch<Array<AuditLog & { _createdAt?: string }>>(`*[_type == "auditLog"]`),
        client.fetch<Array<{ _id: string; name?: string; email?: string; role?: string }>>(
            `*[_type == "user"]{ _id, name, email, role }`
        ),
    ]);
    const search = params.search?.trim().toLowerCase() || '';
    const searchFields = (params.searchFields ?? []).map(field => field.trim()).filter(Boolean);
    const searchableFields = searchFields.length > 0
        ? searchFields
        : ['changesSummary', 'actorUserName', 'actorUserRole', 'actorUserEmail', 'actorUserRef', 'entityType', 'entityRef', 'action'];
    const today = getBusinessDateValue();
    const period = normalizeAuditLogPeriod(params.period);
    const usersById = new Map(users.map(user => [user._id, user]));

    const normalizedLogs = rawLogs.map(log => {
        const actor = log.actorUserRef ? usersById.get(log.actorUserRef) : undefined;
        const actorEmail = log.actorUserEmail || actor?.email || inferAuditActorEmailFromRef(log.actorUserRef, log.entityRef);
        const actorRole =
            normalizeAuditActorRole(log.actorUserRole)
            || normalizeAuditActorRole(actor?.role)
            || inferAuditActorRoleFromIdentity({
                actorUserRef: log.actorUserRef,
                actorUserEmail: actorEmail,
                entityRef: log.entityRef,
            });
        return {
            ...log,
            actorUserName: log.actorUserName || actor?.name,
            actorUserEmail: actorEmail,
            actorUserRole: actorRole,
        };
    });

    const filtered = normalizedLogs.filter(log => {
        if (!matchesAuditLogPeriod(log, period, today)) {
            return false;
        }

        if (!search) {
            return true;
        }

        return searchableFields.some(field => {
            const value = (log as unknown as Record<string, unknown>)[field];
            return typeof value === 'string' && value.toLowerCase().includes(search);
        });
    });

    return sortAuditLogs(filtered, params.sortField, params.sortDir);
}

export async function getAuditLogList(params: {
    search?: string;
    searchFields?: string[];
    page?: number;
    pageSize?: number;
    sortField?: string;
    sortDir?: 'asc' | 'desc';
    period?: string | null;
    countOnly?: boolean;
}) {
    const filtered = await getFilteredAuditLogs(params);
    const total = filtered.length;

    if (params.countOnly) {
        return { items: [] as AuditLog[], total };
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

export async function getAuditLogsSummary(params?: {
    search?: string;
    searchFields?: string[];
    period?: string | null;
}) {
    const logs = await getFilteredAuditLogs({
        search: params?.search,
        searchFields: params?.searchFields,
        period: params?.period,
    });

    const loginLogs = logs.filter(log => log.action === 'LOGIN' || log.action === 'LOGOUT').length;
    const mutationLogs = logs.filter(log => log.action === 'CREATE' || log.action === 'UPDATE' || log.action === 'DELETE').length;
    const actorCount = new Set(
        logs
            .map(log => log.actorUserRef || log.actorUserName || '')
            .filter(Boolean)
    ).size;

    return {
        totalLogs: logs.length,
        loginLogs,
        mutationLogs,
        actorCount,
        period: normalizeAuditLogPeriod(params?.period),
    };
}

type EmployeeAttendanceListParams = {
    search?: string;
    searchFields?: string[];
    page?: number;
    pageSize?: number;
    sortField?: string;
    sortDir?: 'asc' | 'desc';
    period?: string | null;
    date?: string | null;
    status?: string | null;
    employeeRef?: string | null;
    countOnly?: boolean;
};

function normalizeEmployeeAttendancePeriod(value?: string | null): EmployeeAttendancePeriod {
    if (value === 'today' || value === 'thisWeek' || value === 'thisMonth' || value === 'thisYear') {
        return value;
    }
    return 'today';
}

export async function getEmployeeAttendanceList(params: EmployeeAttendanceListParams) {
    const { attendanceRows } = await getEmployeeAttendanceDataset();
    const filtered = filterEmployeeAttendanceRecords(attendanceRows, params);
    const sorted = sortEmployeeAttendanceRecords(filtered, params.sortField, params.sortDir);
    const total = sorted.length;
    if (params.countOnly) {
        return { items: [] as EmployeeAttendanceRecord[], total };
    }

    if (!params.page || !params.pageSize) {
        return { items: sorted, total };
    }

    const offset = Math.max(params.page - 1, 0) * Math.max(params.pageSize, 1);
    return {
        items: sorted.slice(offset, offset + params.pageSize),
        total,
    };
}

export async function getEmployeeAttendanceSummary(params?: {
    search?: string;
    searchFields?: string[];
    period?: string | null;
    date?: string | null;
    status?: string | null;
    employeeRef?: string | null;
}) {
    const { employees, attendanceRows } = await getEmployeeAttendanceDataset();
    const period = normalizeEmployeeAttendancePeriod(params?.period);
    const anchorDate = params?.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date) ? params.date : getBusinessDateValue();
    const range = getEmployeeAttendancePeriodRange(period, anchorDate);
    const records = filterEmployeeAttendanceRecords(attendanceRows, {
        search: params?.search,
        searchFields: params?.searchFields,
        period,
        date: anchorDate,
        status: params?.status,
        employeeRef: params?.employeeRef,
    });
    const activeEmployees = employees.filter(employee => employee.active !== false);
    const activeEmployeeRefSet = new Set(activeEmployees.map(employee => employee._id));
    const recordedActiveEmployeeRefs = new Set(
        records
            .map(record => record.employeeRef)
            .filter((employeeRef): employeeRef is string => Boolean(employeeRef) && activeEmployeeRefSet.has(employeeRef))
    );
    const pendingEmployees = period === 'today'
        ? activeEmployees
            .filter(employee => !recordedActiveEmployeeRefs.has(employee._id))
            .map(employee => ({
                _id: employee._id,
                employeeCode: employee.employeeCode,
                name: employee.name,
                division: employee.division,
                position: employee.position,
            }))
        : [];
    const unrecordedEmployeeCount = Math.max(activeEmployees.length - recordedActiveEmployeeRefs.size, 0);

    return {
        period,
        periodLabel: EMPLOYEE_ATTENDANCE_PERIOD_LABELS[period],
        startDate: range.startDate,
        endDate: range.endDate,
        activeEmployeeCount: activeEmployees.length,
        recordedEmployeeCount: recordedActiveEmployeeRefs.size,
        unrecordedEmployeeCount,
        totalRecords: records.length,
        presentCount: records.filter(record => record.status === 'HADIR').length,
        permissionCount: records.filter(record => record.status === 'IZIN').length,
        sickCount: records.filter(record => record.status === 'SAKIT').length,
        leaveCount: records.filter(record => record.status === 'CUTI').length,
        absentCount: records.filter(record => record.status === 'ALPHA').length,
        offCount: records.filter(record => record.status === 'LIBUR').length,
        pendingEmployees,
    };
}

export function applyDerivedFreightNotaStatus<T extends {
    _id: string;
    status?: string;
    totalAmount?: string | number | null;
    totalAdjustmentAmount?: string | number | null;
    netAmount?: string | number | null;
    issueDate?: string;
    _createdAt?: string;
}>(
    notas: T[],
    paymentTotalsByInvoice: Record<string, number>,
    invoiceRefundsByRef: Record<string, number> = {}
) {
    return applyDerivedFreightNotaReceivableState(notas, paymentTotalsByInvoice, invoiceRefundsByRef);
}

export function applyDerivedDriverVoucherFinancials<T extends {
    initialCashGiven?: number | string | null;
    topUpCount?: number | string | null;
    cashGiven?: number | string | null;
    totalIssuedAmount?: number | string | null;
    totalSpent?: number | string | null;
    driverFeeAmount?: number | string | null;
    totalClaimAmount?: number | string | null;
    balance?: number | string | null;
    status?: string | null;
    settledDate?: string | null;
    settledBy?: string | null;
    settlementBankRef?: string | null;
    settlementBankName?: string | null;
}>(vouchers: T[]) {
    return vouchers.map(voucher => {
        const summary = getDriverVoucherFinancialSummary(voucher);
        const hasSettlementMarker = Boolean(
            voucher.settledDate ||
            voucher.settledBy ||
            voucher.settlementBankRef ||
            voucher.settlementBankName
        );
        return {
            ...voucher,
            initialCashGiven: summary.initialCashGiven,
            totalIssuedAmount: summary.totalIssuedAmount,
            totalSpent: summary.totalSpent,
            driverFeeAmount: summary.driverFeeAmount,
            totalClaimAmount: summary.totalClaimAmount,
            balance: summary.balance,
            status: hasSettlementMarker
                ? 'SETTLED'
                : summary.totalIssuedAmount > 0
                    ? 'ISSUED'
                    : 'DRAFT',
        };
    });
}

export function applyDerivedDriverVoucherLedger<
    T extends {
        _id: string;
        initialCashGiven?: number | string | null;
        topUpCount?: number | string | null;
        cashGiven?: number | string | null;
        totalIssuedAmount?: number | string | null;
        totalSpent?: number | string | null;
        driverFeeAmount?: number | string | null;
        totalClaimAmount?: number | string | null;
        balance?: number | string | null;
        status?: string | null;
        settledDate?: string | null;
        settledBy?: string | null;
        settlementBankRef?: string | null;
        settlementBankName?: string | null;
    }
>(
    vouchers: T[],
    disbursementRows: Array<Pick<DriverVoucherDisbursement, 'voucherRef' | 'amount' | 'kind'>>,
    itemRows: Array<Pick<DriverVoucherItem, 'voucherRef' | 'amount'>>
) {
    const disbursementTotalsByVoucher = disbursementRows.reduce<Record<string, { initialCashGiven: number; totalIssuedAmount: number; topUpCount: number }>>(
        (acc, row) => {
            if (!row.voucherRef) return acc;
            const current = acc[row.voucherRef] || { initialCashGiven: 0, totalIssuedAmount: 0, topUpCount: 0 };
            const amount = parseWholeMoneyLike(row.amount);
            current.totalIssuedAmount += amount;
            if (row.kind === 'INITIAL') {
                current.initialCashGiven += amount;
            }
            if (row.kind === 'TOP_UP' && amount > 0) {
                current.topUpCount += 1;
            }
            acc[row.voucherRef] = current;
            return acc;
        },
        {}
    );

    const spentByVoucher = itemRows.reduce<Record<string, number>>((acc, row) => {
        if (!row.voucherRef) return acc;
        acc[row.voucherRef] = (acc[row.voucherRef] || 0) + parseWholeMoneyLike(row.amount);
        return acc;
    }, {});

    return vouchers.map(voucher => {
        const fallback = getDriverVoucherFinancialSummary(voucher);
        const derivedDisbursement = disbursementTotalsByVoucher[voucher._id];
        const derivedTotalSpent = spentByVoucher[voucher._id];
        const initialCashGiven = derivedDisbursement ? derivedDisbursement.initialCashGiven : fallback.initialCashGiven;
        const totalIssuedAmount = derivedDisbursement ? derivedDisbursement.totalIssuedAmount : fallback.totalIssuedAmount;
        const totalSpent = derivedTotalSpent !== undefined ? derivedTotalSpent : fallback.totalSpent;
        const topUpCount = derivedDisbursement ? derivedDisbursement.topUpCount : Math.max(parseFormattedNumberish(voucher.topUpCount ?? 0, { maxFractionDigits: 0 }), 0);
        const driverFeeAmount = Math.max(parseFormattedNumberish(voucher.driverFeeAmount ?? fallback.driverFeeAmount, { maxFractionDigits: 0 }), 0);
        const hasSettlementMarker = Boolean(
            voucher.settledDate ||
            voucher.settledBy ||
            voucher.settlementBankRef ||
            voucher.settlementBankName
        );
        const summary = getDriverVoucherFinancialSummary({
            initialCashGiven,
            cashGiven: initialCashGiven,
            totalIssuedAmount,
            totalSpent,
            driverFeeAmount,
        });

        return {
            ...voucher,
            cashGiven: initialCashGiven,
            initialCashGiven,
            totalIssuedAmount: summary.totalIssuedAmount,
            topUpCount,
            totalSpent: summary.totalSpent,
            driverFeeAmount: summary.driverFeeAmount,
            totalClaimAmount: summary.totalClaimAmount,
            balance: summary.balance,
            status: hasSettlementMarker
                ? 'SETTLED'
                : summary.totalIssuedAmount > 0
                    ? 'ISSUED'
                    : 'DRAFT',
        };
    });
}

function getSignedBankTransactionDelta(type: BankTransaction['type'] | undefined, amount: unknown) {
    const numericAmount = parseWholeMoneyLike(amount);
    if (type === 'DEBIT' || type === 'TRANSFER_OUT') {
        return -numericAmount;
    }
    return numericAmount;
}

export function applyDerivedBankAccountBalances<
    T extends {
        _id: string;
        initialBalance?: number | string | null;
        currentBalance?: number | string | null;
    }
>(
    accounts: T[],
    transactionRows: Array<Pick<BankTransaction, 'bankAccountRef' | 'type' | 'amount'>>
) {
    const deltasByAccount = transactionRows.reduce<Record<string, number>>((acc, tx) => {
        if (!tx.bankAccountRef) return acc;
        acc[tx.bankAccountRef] = (acc[tx.bankAccountRef] || 0) + getSignedBankTransactionDelta(tx.type, tx.amount);
        return acc;
    }, {});

    return accounts.map(account => {
        const initialBalance = parseFormattedNumberish(account.initialBalance ?? 0, { maxFractionDigits: 0 });
        return {
            ...account,
            initialBalance,
            currentBalance: initialBalance + (deltasByAccount[account._id] || 0),
        };
    });
}

export function applyDerivedDriverBoronganTotals<
    T extends {
        _id: string;
        totalAmount?: number | string | null;
        totalCollie?: number | string | null;
        totalWeightKg?: number | string | null;
        totalBeratKg?: number | string | null;
        totalUangJalan?: number | string | null;
        status?: string | null;
        paidDate?: string | null;
        paidMethod?: string | null;
        paidBankRef?: string | null;
        paidBankName?: string | null;
        paidBankNumber?: string | null;
    }
>(
    borongans: T[],
    boronganItems: Array<Pick<DriverBoronganItem, 'boronganRef' | 'collie' | 'beratKg' | 'uangRp'>>
) {
    const totalsByBorongan = boronganItems.reduce<Record<string, { totalAmount: number; totalCollie: number; totalWeightKg: number }>>(
        (acc, item) => {
            if (!item.boronganRef) return acc;
            const current = acc[item.boronganRef] || { totalAmount: 0, totalCollie: 0, totalWeightKg: 0 };
            current.totalAmount += parseWholeMoneyLike(item.uangRp);
            current.totalCollie += Math.max(parseFormattedNumberish(item.collie ?? 0, { maxFractionDigits: 2 }), 0);
            current.totalWeightKg += Math.max(parseFormattedNumberish(item.beratKg ?? 0, { maxFractionDigits: 3 }), 0);
            acc[item.boronganRef] = current;
            return acc;
        },
        {}
    );

    return borongans.map(borongan => {
        const derived = totalsByBorongan[borongan._id];
        const hasPaymentMarker = Boolean(
            borongan.paidDate ||
            borongan.paidMethod ||
            borongan.paidBankRef ||
            borongan.paidBankName ||
            borongan.paidBankNumber
        );
        if (!derived) {
            const normalizedTotalAmount = parseWholeMoneyLike(borongan.totalAmount);
            const normalizedTotalWeightKg = Math.max(
                parseFormattedNumberish(borongan.totalWeightKg ?? borongan.totalBeratKg ?? 0, { maxFractionDigits: 3 }),
                0
            );
            return {
                ...borongan,
                totalAmount: normalizedTotalAmount,
                totalCollie: Math.max(parseFormattedNumberish(borongan.totalCollie ?? 0, { maxFractionDigits: 2 }), 0),
                totalWeightKg: normalizedTotalWeightKg,
                totalBeratKg: normalizedTotalWeightKg,
                totalUangJalan: normalizedTotalAmount,
                status: hasPaymentMarker ? 'PAID' : 'UNPAID',
            };
        }
        return {
            ...borongan,
            totalAmount: derived.totalAmount,
            totalCollie: derived.totalCollie,
            totalWeightKg: derived.totalWeightKg,
            totalBeratKg: derived.totalWeightKg,
            totalUangJalan: derived.totalAmount,
            status: hasPaymentMarker ? 'PAID' : 'UNPAID',
        };
    });
}

export function applyDerivedCustomerReceiptAllocations<
    T extends {
        _id: string;
        totalAmount?: number | string | null;
        allocatedAmount?: number | string | null;
        unappliedAmount?: number | string | null;
        allocationCount?: number | string | null;
    }
>(
    receipts: T[],
    allocationRows: Array<Pick<Payment, 'receiptRef' | 'amount'>>
) {
    const totalsByReceipt = allocationRows.reduce<Record<string, { allocatedAmount: number; allocationCount: number }>>(
        (acc, row) => {
            if (!row.receiptRef) return acc;
            const current = acc[row.receiptRef] || { allocatedAmount: 0, allocationCount: 0 };
            current.allocatedAmount += parseWholeMoneyLike(row.amount);
            current.allocationCount += 1;
            acc[row.receiptRef] = current;
            return acc;
        },
        {}
    );

    return receipts.map(receipt => {
        const totalAmount = parseWholeMoneyLike(receipt.totalAmount);
        const derived = totalsByReceipt[receipt._id] || { allocatedAmount: 0, allocationCount: 0 };
        const unappliedAmount = Math.max(totalAmount - derived.allocatedAmount, 0);
        return {
            ...receipt,
            totalAmount,
            allocatedAmount: derived.allocatedAmount,
            unappliedAmount,
            allocationCount: derived.allocationCount,
        };
    });
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
    const [notaRows, paymentRows, refundRows] = await Promise.all([
        client.fetch<Array<FreightNota & { _createdAt?: string }>>(`*[_type == "freightNota"]`),
        client.fetch<Array<{ invoiceRef?: string; amount?: unknown }>>(`*[_type == "payment" && defined(invoiceRef)]{ invoiceRef, amount }`),
        client.fetch<Array<Pick<CustomerOverpaymentRefund, 'sourceType' | 'sourceInvoiceRef' | 'amount'>>>(
            `*[_type == "customerOverpaymentRefund" && sourceType == "INVOICE_OVERPAID"]{
                sourceType,
                sourceInvoiceRef,
                amount
            }`
        ),
    ]);

    const paymentTotalsByInvoice = getFreightNotaPaymentTotals(paymentRows);
    const { invoiceRefundsByRef } = getCustomerOverpaymentRefundTotals(refundRows);
    const search = params.search?.trim().toLowerCase() || '';
    const filterObj = params.filterObj ?? {};
    const orFilters = params.orFilters ?? [];
    const definedFields = params.definedFields ?? [];
    const searchFields = (params.searchFields ?? []).map(field => field.trim()).filter(Boolean);
    const withDerivedStatus = applyDerivedFreightNotaStatus(notaRows, paymentTotalsByInvoice, invoiceRefundsByRef);

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
    const [nota, paymentRows, refundRows] = await Promise.all([
        client.fetch<(FreightNota & { _createdAt?: string }) | null>(
            `*[_type == "freightNota" && _id == $id][0]`,
            { id }
        ),
        client.fetch<Array<{ invoiceRef?: string; amount?: unknown }>>(
            `*[_type == "payment" && invoiceRef == $id]{ invoiceRef, amount }`,
            { id }
        ),
        client.fetch<Array<Pick<CustomerOverpaymentRefund, 'sourceType' | 'sourceInvoiceRef' | 'amount'>>>(
            `*[_type == "customerOverpaymentRefund" && sourceType == "INVOICE_OVERPAID" && sourceInvoiceRef == $id]{
                sourceType,
                sourceInvoiceRef,
                amount
            }`,
            { id }
        ),
    ]);

    if (!nota) return null;
    const paymentTotalsByInvoice = getFreightNotaPaymentTotals(paymentRows);
    const { invoiceRefundsByRef } = getCustomerOverpaymentRefundTotals(refundRows);
    return applyDerivedFreightNotaStatus([nota], paymentTotalsByInvoice, invoiceRefundsByRef)[0];
}

export async function getDriverVoucherById(id: string) {
    const client = getSanityClient();
    const [voucher, disbursements, items] = await Promise.all([
        client.fetch<DriverVoucher | null>(
            `*[_type == "driverVoucher" && _id == $id][0]`,
            { id }
        ),
        client.fetch<Array<Pick<DriverVoucherDisbursement, 'voucherRef' | 'amount' | 'kind'>>>(
            `*[_type == "driverVoucherDisbursement" && voucherRef == $id]{ voucherRef, amount, kind }`,
            { id }
        ),
        client.fetch<Array<Pick<DriverVoucherItem, 'voucherRef' | 'amount'>>>(
            `*[_type == "driverVoucherItem" && voucherRef == $id]{ voucherRef, amount }`,
            { id }
        ),
    ]);
    if (!voucher) return null;
    return applyDerivedDriverVoucherLedger([voucher], disbursements, items)[0];
}

export async function getDeliveryOrderTripCashLink(deliveryOrderRef: string) {
    const client = getSanityClient();
    const voucher = await client.fetch<DriverVoucher | null>(
        `*[_type == "driverVoucher" && deliveryOrderRef == $deliveryOrderRef] | order(issuedDate desc, _createdAt desc)[0]{
            _id,
            bonNumber,
            deliveryOrderRef,
            issuedDate,
            cashGiven,
            initialCashGiven,
            totalIssuedAmount,
            topUpCount,
            driverFeeAmount,
            totalClaimAmount,
            totalSpent,
            balance,
            status,
            settledDate,
            settledBy,
            settlementBankRef,
            settlementBankName
        }`,
        { deliveryOrderRef }
    );

    if (!voucher) return null;

    const [disbursements, items] = await Promise.all([
        client.fetch<Array<Pick<DriverVoucherDisbursement, 'voucherRef' | 'amount' | 'kind'>>>(
            `*[_type == "driverVoucherDisbursement" && voucherRef == $id]{ voucherRef, amount, kind }`,
            { id: voucher._id }
        ),
        client.fetch<Array<Pick<DriverVoucherItem, 'voucherRef' | 'amount'>>>(
            `*[_type == "driverVoucherItem" && voucherRef == $id]{ voucherRef, amount }`,
            { id: voucher._id }
        ),
    ]);

    const derivedVoucher = applyDerivedDriverVoucherLedger([voucher], disbursements, items)[0];

    return {
        hasVoucher: true,
        voucherId: derivedVoucher._id,
        bonNumber: derivedVoucher.bonNumber,
        status: derivedVoucher.status,
        issuedDate: derivedVoucher.issuedDate,
    };
}

function matchesDriverVoucherFilter(
    voucher: Record<string, unknown>,
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
            const value = voucher[field];
            return typeof value === 'string' && value.toLowerCase().includes(search);
        });

    if (!matchesSearch) return false;

    const matchesFilter = Object.entries(filterObj).every(([key, expectedValue]) =>
        matchesScalarFilter(voucher[key], expectedValue)
    );
    if (!matchesFilter) return false;

    const matchesDefinedFields = definedFields.every(field => {
        const value = voucher[field];
        return value !== undefined && value !== null && value !== '';
    });
    if (!matchesDefinedFields) return false;

    return orFilters.every(orFilter =>
        orFilter.fields.some(field => matchesScalarFilter(voucher[field], orFilter.value))
    );
}

function compareDriverVoucherValues(left: unknown, right: unknown, direction: 'asc' | 'desc') {
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

export async function getDriverVoucherList(params: {
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
    const [voucherRows, disbursementRows, itemRows] = await Promise.all([
        client.fetch<DriverVoucher[]>(`*[_type == "driverVoucher"]`),
        client.fetch<Array<Pick<DriverVoucherDisbursement, 'voucherRef' | 'amount' | 'kind'>>>(
            `*[_type == "driverVoucherDisbursement"]{ voucherRef, amount, kind }`
        ),
        client.fetch<Array<Pick<DriverVoucherItem, 'voucherRef' | 'amount'>>>(
            `*[_type == "driverVoucherItem"]{ voucherRef, amount }`
        ),
    ]);

    const search = params.search?.trim().toLowerCase() || '';
    const filterObj = params.filterObj ?? {};
    const orFilters = params.orFilters ?? [];
    const definedFields = params.definedFields ?? [];
    const searchFields = (params.searchFields ?? []).map(field => field.trim()).filter(Boolean);
    let filtered = applyDerivedDriverVoucherLedger(voucherRows, disbursementRows, itemRows).filter(voucher =>
        matchesDriverVoucherFilter(
            voucher as unknown as Record<string, unknown>,
            filterObj,
            orFilters,
            definedFields,
            search,
            searchFields
        )
    );

    if (params.sortPreset === 'work-queue') {
        const statusRank: Record<string, number> = { ISSUED: 0, DRAFT: 1, SETTLED: 2 };
        filtered = [...filtered].sort((left, right) => {
            const leftRank = statusRank[left.status || ''] ?? 99;
            const rightRank = statusRank[right.status || ''] ?? 99;
            if (leftRank !== rightRank) return leftRank - rightRank;
            return (right.issuedDate || '').localeCompare(left.issuedDate || '');
        });
    } else if (params.sortField) {
        const direction = params.sortDir === 'asc' ? 'asc' : 'desc';
        const sortField = params.sortField;
        filtered = [...filtered].sort((left, right) => {
            const leftValue = (left as unknown as Record<string, unknown>)[sortField];
            const rightValue = (right as unknown as Record<string, unknown>)[sortField];
            return compareDriverVoucherValues(leftValue, rightValue, direction);
        });
    }

    const total = filtered.length;
    if (params.countOnly) {
        return { items: [] as DriverVoucher[], total };
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

export async function getDriverBoronganById(id: string) {
    const client = getSanityClient();
    const [borongan, items] = await Promise.all([
        client.fetch<DriverBorongan | null>(
            `*[_type == "driverBorongan" && _id == $id][0]`,
            { id }
        ),
        client.fetch<Array<Pick<DriverBoronganItem, 'boronganRef' | 'collie' | 'beratKg' | 'uangRp'>>>(
            `*[_type == "driverBoronganItem" && boronganRef == $id]{ boronganRef, collie, beratKg, uangRp }`,
            { id }
        ),
    ]);

    if (!borongan) return null;
    return applyDerivedDriverBoronganTotals([borongan], items)[0];
}

export async function getDriverBoronganList(params: {
    filterObj?: Record<string, unknown>;
    orFilters?: Array<{ fields: string[]; value: string | number | boolean }>;
    definedFields?: string[];
    search?: string;
    searchFields?: string[];
    page?: number;
    pageSize?: number;
    sortField?: string;
    sortDir?: 'asc' | 'desc';
    countOnly?: boolean;
}) {
    const client = getSanityClient();
    const [docs, itemTotals] = await Promise.all([
        client.fetch<DriverBorongan[]>(`*[_type == "driverBorongan"]`),
        client.fetch<Array<Pick<DriverBoronganItem, 'boronganRef' | 'collie' | 'beratKg' | 'uangRp'>>>(
            `*[_type == "driverBoronganItem"]{ boronganRef, collie, beratKg, uangRp }`
        ),
    ]);

    const query = params.search?.trim().toLowerCase() || '';
    const filterObj = params.filterObj ?? {};
    const orFilters = params.orFilters ?? [];
    const definedFields = params.definedFields ?? [];
    const searchFields = (params.searchFields ?? []).map(field => field.trim()).filter(Boolean);
    const withDerivedTotals = applyDerivedDriverBoronganTotals(docs, itemTotals);

    let filtered = withDerivedTotals.filter(item => {
        const matchesSearch =
            !query ||
            searchFields.length === 0 ||
            searchFields.some(field => {
                const value = (item as unknown as Record<string, unknown>)[field];
                return typeof value === 'string' && value.toLowerCase().includes(query);
            });
        if (!matchesSearch) return false;

        const matchesFilter = Object.entries(filterObj).every(([key, expectedValue]) =>
            matchesScalarFilter((item as unknown as Record<string, unknown>)[key], expectedValue)
        );
        if (!matchesFilter) return false;

        const matchesDefinedFields = definedFields.every(field => {
            const value = (item as unknown as Record<string, unknown>)[field];
            return value !== undefined && value !== null && value !== '';
        });
        if (!matchesDefinedFields) return false;

        const matchesOrFilters = orFilters.every(orFilter =>
            orFilter.fields.some(field => matchesScalarFilter((item as unknown as Record<string, unknown>)[field], orFilter.value))
        );

        return matchesOrFilters;
    });

    if (params.sortField) {
        const direction = params.sortDir === 'asc' ? 'asc' : 'desc';
        const sortField = params.sortField;
        filtered = [...filtered].sort((left, right) =>
            compareFreightNotaValues(
                (left as unknown as Record<string, unknown>)[sortField],
                (right as unknown as Record<string, unknown>)[sortField],
                direction
            )
        );
    }

    const total = filtered.length;
    if (params.countOnly) {
        return { items: [] as DriverBorongan[], total };
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

export async function getCustomerReceiptById(id: string) {
    const client = getSanityClient();
    const [receipt, payments, refundRows] = await Promise.all([
        client.fetch<CustomerReceipt | null>(
            `*[_type == "customerReceipt" && _id == $id][0]`,
            { id }
        ),
        client.fetch<Array<Pick<Payment, 'receiptRef' | 'amount'>>>(
            `*[_type == "payment" && receiptRef == $id]{ receiptRef, amount }`,
            { id }
        ),
        client.fetch<Array<Pick<CustomerOverpaymentRefund, 'sourceType' | 'sourceReceiptRef' | 'amount'>>>(
            `*[_type == "customerOverpaymentRefund" && sourceType == "RECEIPT_UNAPPLIED" && sourceReceiptRef == $id]{
                sourceType,
                sourceReceiptRef,
                amount
            }`,
            { id }
        ),
    ]);

    if (!receipt) return null;
    const { receiptRefundsByRef } = getCustomerOverpaymentRefundTotals(refundRows);
    return applyDerivedCustomerReceiptOverpaymentState(
        applyDerivedCustomerReceiptAllocations([receipt], payments),
        receiptRefundsByRef
    )[0];
}

export async function getCustomerReceiptList(params: {
    filterObj?: Record<string, unknown>;
    orFilters?: Array<{ fields: string[]; value: string | number | boolean }>;
    definedFields?: string[];
    search?: string;
    searchFields?: string[];
    page?: number;
    pageSize?: number;
    sortField?: string;
    sortDir?: 'asc' | 'desc';
    countOnly?: boolean;
}) {
    const client = getSanityClient();
    const [docs, payments, refundRows] = await Promise.all([
        client.fetch<CustomerReceipt[]>(`*[_type == "customerReceipt"]`),
        client.fetch<Array<Pick<Payment, 'receiptRef' | 'amount'>>>(
            `*[_type == "payment" && defined(receiptRef)]{ receiptRef, amount }`
        ),
        client.fetch<Array<Pick<CustomerOverpaymentRefund, 'sourceType' | 'sourceReceiptRef' | 'amount'>>>(
            `*[_type == "customerOverpaymentRefund" && sourceType == "RECEIPT_UNAPPLIED"]{
                sourceType,
                sourceReceiptRef,
                amount
            }`
        ),
    ]);

    const query = params.search?.trim().toLowerCase() || '';
    const filterObj = params.filterObj ?? {};
    const orFilters = params.orFilters ?? [];
    const definedFields = params.definedFields ?? [];
    const searchFields = (params.searchFields ?? []).map(field => field.trim()).filter(Boolean);
    const { receiptRefundsByRef } = getCustomerOverpaymentRefundTotals(refundRows);
    const withDerivedAllocations = applyDerivedCustomerReceiptOverpaymentState(
        applyDerivedCustomerReceiptAllocations(docs, payments),
        receiptRefundsByRef
    );

    let filtered = withDerivedAllocations.filter(item => {
        const matchesSearch =
            !query ||
            searchFields.length === 0 ||
            searchFields.some(field => {
                const value = (item as unknown as Record<string, unknown>)[field];
                return typeof value === 'string' && value.toLowerCase().includes(query);
            });
        if (!matchesSearch) return false;

        const matchesFilter = Object.entries(filterObj).every(([key, expectedValue]) =>
            matchesScalarFilter((item as unknown as Record<string, unknown>)[key], expectedValue)
        );
        if (!matchesFilter) return false;

        const matchesDefinedFields = definedFields.every(field => {
            const value = (item as unknown as Record<string, unknown>)[field];
            return value !== undefined && value !== null && value !== '';
        });
        if (!matchesDefinedFields) return false;

        const matchesOrFilters = orFilters.every(orFilter =>
            orFilter.fields.some(field => matchesScalarFilter((item as unknown as Record<string, unknown>)[field], orFilter.value))
        );

        return matchesOrFilters;
    });

    if (params.sortField) {
        const direction = params.sortDir === 'asc' ? 'asc' : 'desc';
        const sortField = params.sortField;
        filtered = [...filtered].sort((left, right) =>
            compareFreightNotaValues(
                (left as unknown as Record<string, unknown>)[sortField],
                (right as unknown as Record<string, unknown>)[sortField],
                direction
            )
        );
    }

    const total = filtered.length;
    if (params.countOnly) {
        return { items: [] as CustomerReceipt[], total };
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

export async function getCustomerOverpaymentById(id: string) {
    const client = getSanityClient();
    const [receipts, notas, payments, refunds, invoiceAdjustments] = await Promise.all([
        client.fetch<CustomerReceipt[]>(`*[_type == "customerReceipt"]`),
        client.fetch<FreightNota[]>(`*[_type == "freightNota"]`),
        client.fetch<Array<Pick<Payment, 'invoiceRef' | 'receiptRef' | 'amount'>>>(
            `*[_type == "payment"]{ invoiceRef, receiptRef, amount }`
        ),
        client.fetch<CustomerOverpaymentRefund[]>(
            `*[_type == "customerOverpaymentRefund"]`
        ),
        client.fetch<Array<{ invoiceRef?: string; date?: string; editedAt?: string }>>(
            `*[_type == "invoiceAdjustment" && (!defined(status) || status != "VOID") && defined(invoiceRef)]{
                invoiceRef,
                date,
                editedAt
            }`
        ),
    ]);

    const paymentTotalsByInvoice = getFreightNotaPaymentTotals(payments);
    const { receiptRefundsByRef, invoiceRefundsByRef } = getCustomerOverpaymentRefundTotals(refunds);
    const invoiceDetectedDatesByRef = buildInvoiceOverpaymentDetectedDateMap(invoiceAdjustments);
    const receiptRows = applyDerivedCustomerReceiptOverpaymentState(
        applyDerivedCustomerReceiptAllocations(receipts, payments),
        receiptRefundsByRef
    );
    const notaRows = applyDerivedFreightNotaReceivableState(notas, paymentTotalsByInvoice, invoiceRefundsByRef);
    const item = buildCustomerOverpaymentCases({
        receipts: receiptRows,
        notas: notaRows,
        paymentTotalsByInvoice,
        receiptRefundsByRef,
        invoiceRefundsByRef,
        invoiceDetectedDatesByRef,
    }).find(entry => entry._id === id);

    return item || null;
}

export async function getCustomerOverpaymentList(params: {
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
    const [receipts, notas, payments, refunds, invoiceAdjustments] = await Promise.all([
        client.fetch<CustomerReceipt[]>(`*[_type == "customerReceipt"]`),
        client.fetch<FreightNota[]>(`*[_type == "freightNota"]`),
        client.fetch<Array<Pick<Payment, 'invoiceRef' | 'receiptRef' | 'amount'>>>(
            `*[_type == "payment"]{ invoiceRef, receiptRef, amount }`
        ),
        client.fetch<CustomerOverpaymentRefund[]>(`*[_type == "customerOverpaymentRefund"]`),
        client.fetch<Array<{ invoiceRef?: string; date?: string; editedAt?: string }>>(
            `*[_type == "invoiceAdjustment" && (!defined(status) || status != "VOID") && defined(invoiceRef)]{
                invoiceRef,
                date,
                editedAt
            }`
        ),
    ]);

    const query = params.search?.trim().toLowerCase() || '';
    const filterObj = params.filterObj ?? {};
    const orFilters = params.orFilters ?? [];
    const definedFields = params.definedFields ?? [];
    const searchFields = (params.searchFields ?? []).map(field => field.trim()).filter(Boolean);
    const paymentTotalsByInvoice = getFreightNotaPaymentTotals(payments);
    const { receiptRefundsByRef, invoiceRefundsByRef } = getCustomerOverpaymentRefundTotals(refunds);
    const invoiceDetectedDatesByRef = buildInvoiceOverpaymentDetectedDateMap(invoiceAdjustments);
    const receiptRows = applyDerivedCustomerReceiptOverpaymentState(
        applyDerivedCustomerReceiptAllocations(receipts, payments),
        receiptRefundsByRef
    );
    const notaRows = applyDerivedFreightNotaReceivableState(notas, paymentTotalsByInvoice, invoiceRefundsByRef);
    const cases = buildCustomerOverpaymentCases({
        receipts: receiptRows,
        notas: notaRows,
        paymentTotalsByInvoice,
        receiptRefundsByRef,
        invoiceRefundsByRef,
        invoiceDetectedDatesByRef,
    });

    const searchableFields = searchFields.length > 0
        ? searchFields
        : ['customerName', 'sourceLabel', 'sourceDescription', 'sourceInvoiceNumber', 'sourceReceiptNumber'];

    let filtered = cases.filter(item => {
        const matchesSearch =
            !query ||
            searchableFields.some(field => {
                const value = (item as unknown as Record<string, unknown>)[field];
                return typeof value === 'string' && value.toLowerCase().includes(query);
            });
        if (!matchesSearch) return false;

        const matchesFilter = Object.entries(filterObj).every(([key, expectedValue]) =>
            matchesScalarFilter((item as unknown as Record<string, unknown>)[key], expectedValue)
        );
        if (!matchesFilter) return false;

        const matchesDefinedFields = definedFields.every(field => {
            const value = (item as unknown as Record<string, unknown>)[field];
            return value !== undefined && value !== null && value !== '';
        });
        if (!matchesDefinedFields) return false;

        return orFilters.every(orFilter =>
            orFilter.fields.some(field => matchesScalarFilter((item as unknown as Record<string, unknown>)[field], orFilter.value))
        );
    });

    filtered = sortCustomerOverpaymentCases(filtered, params.sortField, params.sortDir, params.sortPreset);

    const total = filtered.length;
    if (params.countOnly) {
        return { items: [] as CustomerOverpayment[], total };
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
        borongans,
        boronganItems,
        vouchers,
        voucherDisbursements,
        voucherItems,
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
            ? client.fetch<Array<Pick<DriverBorongan, '_id' | 'status' | 'totalAmount' | 'totalCollie' | 'totalWeightKg' | 'paidDate' | 'paidMethod' | 'paidBankRef' | 'paidBankName' | 'paidBankNumber'>>>(
                `*[_type == "driverBorongan"]{
                    _id,
                    status,
                    totalAmount,
                    totalCollie,
                    totalWeightKg,
                    paidDate,
                    paidMethod,
                    paidBankRef,
                    paidBankName,
                    paidBankNumber
                }`
            )
            : Promise.resolve([]),
        canSeeBorongan
            ? client.fetch<Array<Pick<DriverBoronganItem, 'boronganRef' | 'collie' | 'beratKg' | 'uangRp'>>>(
                `*[_type == "driverBoronganItem" && defined(boronganRef)]{
                    boronganRef,
                    collie,
                    beratKg,
                    uangRp
                }`
            )
            : Promise.resolve([]),
        canViewTripCash
            ? client.fetch<Array<Pick<DriverVoucher, '_id' | 'status' | 'settledDate' | 'settledBy' | 'settlementBankRef' | 'settlementBankName' | 'cashGiven' | 'initialCashGiven' | 'topUpCount' | 'totalIssuedAmount' | 'totalSpent' | 'driverFeeAmount' | 'totalClaimAmount' | 'balance'>>>(
                `*[_type == "driverVoucher"]{
                    _id,
                    status,
                    settledDate,
                    settledBy,
                    settlementBankRef,
                    settlementBankName,
                    cashGiven,
                    initialCashGiven,
                    topUpCount,
                    totalIssuedAmount,
                    totalSpent,
                    driverFeeAmount,
                    totalClaimAmount,
                    balance
                }`
            )
            : Promise.resolve([]),
        canViewTripCash
            ? client.fetch<Array<Pick<DriverVoucherDisbursement, 'voucherRef' | 'amount' | 'kind'>>>(
                `*[_type == "driverVoucherDisbursement" && defined(voucherRef)]{
                    voucherRef,
                    amount,
                    kind
                }`
            )
            : Promise.resolve([]),
        canViewTripCash
            ? client.fetch<Array<Pick<DriverVoucherItem, 'voucherRef' | 'amount'>>>(
                `*[_type == "driverVoucherItem" && defined(voucherRef)]{
                    voucherRef,
                    amount
                }`
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
    const unpaidBorongansWithDerivedTotals = applyDerivedDriverBoronganTotals(borongans, boronganItems)
        .filter(borongan => borongan.status !== 'PAID');
    const openVouchersWithDerivedFinancials = applyDerivedDriverVoucherLedger(vouchers, voucherDisbursements, voucherItems)
        .filter(voucher => voucher.status !== 'SETTLED');
    const notaOutstanding = derivedUnpaidNotas.reduce((sum, nota) => {
        const paidAmount = notaPaymentTotals[nota._id] || 0;
        return sum + Math.max(getReceivableNetAmount(nota) - paidAmount, 0);
    }, 0);
    const boronganOutstanding = unpaidBorongansWithDerivedTotals.reduce(
        (sum, borongan) => sum + parseWholeMoneyLike(borongan.totalAmount),
        0
    );
    const voucherIssued = openVouchersWithDerivedFinancials.reduce(
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
            unpaid: canSeeBorongan ? unpaidBorongansWithDerivedTotals.length : 0,
            totalOutstanding: canSeeBorongan ? boronganOutstanding : 0,
        },
        voucherStats: {
            unsettled: canViewTripCash ? openVouchersWithDerivedFinancials.length : 0,
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
    vehicle: Pick<Vehicle, '_id' | 'vehicleType' | 'serviceName' | 'tireLayoutConfig'>,
    tireEvents: Array<Pick<TireEvent, 'vehicleRef' | 'status' | 'holderType' | 'slotCode' | 'posisi' | 'vehiclePlate' | 'externalPartyName' | 'externalPlateNumber'>>
): VehicleTireSummary {
    const activeSlotCodes = Array.from(
        new Set(
            tireEvents
                .filter(event => event.vehicleRef === vehicle._id && resolveTireAssetStatus(event) === 'IN_USE')
                .map(event => resolveTireSlotCode(event) || '')
                .filter(Boolean)
        )
    );
    const layout = getSuggestedVehicleTireLayout(vehicle.vehicleType, vehicle.serviceName, activeSlotCodes, vehicle.tireLayoutConfig);
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
        client.fetch<Array<Pick<Vehicle, '_id' | 'status' | 'vehicleType' | 'serviceName' | 'tireLayoutConfig'>>>(
            `*[_type == "vehicle"]{ _id, status, vehicleType, serviceName, tireLayoutConfig }`
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
    const [accounts, transactionRows] = await Promise.all([
        client.fetch<Array<Pick<BankAccount, '_id' | 'accountType' | 'systemKey' | 'initialBalance' | 'currentBalance' | 'active'>>>(
            `*[_type == "bankAccount" && active != false]{
                _id,
                accountType,
                systemKey,
                initialBalance,
                currentBalance,
                active
            }`
        ),
        client.fetch<Array<Pick<BankTransaction, 'bankAccountRef' | 'type' | 'amount'>>>(
            `*[_type == "bankTransaction" && defined(bankAccountRef)]{
                bankAccountRef,
                type,
                amount
            }`
        ),
    ]);
    const accountsWithDerivedBalances = applyDerivedBankAccountBalances(accounts, transactionRows);

    const isCash = (account: Pick<BankAccount, 'accountType' | 'systemKey'>) =>
        account.accountType === 'CASH' || account.systemKey === 'cash-on-hand';

    const totalBalance = accountsWithDerivedBalances.reduce((sum, account) => sum + parseWholeMoneyLike(account.currentBalance), 0);
    const totalInitial = accountsWithDerivedBalances.reduce((sum, account) => sum + parseWholeMoneyLike(account.initialBalance), 0);
    const cashBalance = accountsWithDerivedBalances.filter(isCash).reduce((sum, account) => sum + parseWholeMoneyLike(account.currentBalance), 0);
    const bankBalance = accountsWithDerivedBalances.filter(account => !isCash(account)).reduce((sum, account) => sum + parseWholeMoneyLike(account.currentBalance), 0);

    return {
        totalAccounts: accountsWithDerivedBalances.length,
        totalBalance,
        totalInitial,
        cashBalance,
        bankBalance,
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

