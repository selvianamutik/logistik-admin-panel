import type { ApiSession } from '@/lib/api/data-helpers';
import { getBusinessCalendarDateParts, getBusinessDateValue } from '@/lib/business-date';
import { filterExpensesByRole, hasPageAccess, hasPermission } from '@/lib/rbac';
import {
    getSanityClient,
} from '@/lib/sanity';
import { getSuggestedVehicleTireLayout, resolveTireAssetStatus, resolveTireSlotCode } from '@/lib/tire-slots';
import { parseFormattedNumberish } from '@/lib/formatted-number';
import type {
    BankAccount,
    BankTransaction,
    CustomerReceipt,
    DriverBorongan,
    DriverBoronganItem,
    DriverVoucherDisbursement,
    DriverVoucherItem,
    DriverVoucher,
    Expense,
    FreightNota,
    Payment,
    TireEvent,
    Vehicle,
} from '@/lib/types';
import { deriveReceivableStatus, getDriverVoucherFinancialSummary, getDriverVoucherIssuedAmount, getReceivableNetAmount } from '@/lib/utils';

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
    paymentTotalsByInvoice: Record<string, number>
) {
    return notas.map(nota => ({
        ...nota,
        status: deriveReceivableStatus(nota, paymentTotalsByInvoice[nota._id] || 0),
    }));
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
    const [receipt, payments] = await Promise.all([
        client.fetch<CustomerReceipt | null>(
            `*[_type == "customerReceipt" && _id == $id][0]`,
            { id }
        ),
        client.fetch<Array<Pick<Payment, 'receiptRef' | 'amount'>>>(
            `*[_type == "payment" && receiptRef == $id]{ receiptRef, amount }`,
            { id }
        ),
    ]);

    if (!receipt) return null;
    return applyDerivedCustomerReceiptAllocations([receipt], payments)[0];
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
    const [docs, payments] = await Promise.all([
        client.fetch<CustomerReceipt[]>(`*[_type == "customerReceipt"]`),
        client.fetch<Array<Pick<Payment, 'receiptRef' | 'amount'>>>(
            `*[_type == "payment" && defined(receiptRef)]{ receiptRef, amount }`
        ),
    ]);

    const query = params.search?.trim().toLowerCase() || '';
    const filterObj = params.filterObj ?? {};
    const orFilters = params.orFilters ?? [];
    const definedFields = params.definedFields ?? [];
    const searchFields = (params.searchFields ?? []).map(field => field.trim()).filter(Boolean);
    const withDerivedAllocations = applyDerivedCustomerReceiptAllocations(docs, payments);

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
    vehicle: Pick<Vehicle, '_id' | 'vehicleType' | 'serviceName'>,
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

export async function getAuditLogsSummary() {
    const client = getSanityClient();
    const today = getBusinessDateValue();
    const logs = await client.fetch<Array<{ timestamp?: string; _createdAt?: string; action?: string }>>(
        `*[_type == "auditLog"]{
            timestamp,
            _createdAt,
            action
        }`
    );

    const todayLogs = logs.filter(log => {
        const businessDate = getBusinessCalendarDateParts(log.timestamp || log._createdAt || '');
        return businessDate ? `${businessDate.year}-${businessDate.month}-${businessDate.day}` === today : false;
    }).length;
    const loginLogs = logs.filter(log => log.action === 'LOGIN' || log.action === 'LOGOUT').length;
    const mutationLogs = logs.filter(log => log.action === 'CREATE' || log.action === 'UPDATE' || log.action === 'DELETE').length;

    return {
        totalLogs: logs.length,
        todayLogs,
        loginLogs,
        mutationLogs,
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

