import { getBusinessDateValue } from '@/lib/business-date';
import {
    createDocument,
    getDocumentById,
    listDocumentsByFilter,
    updateDocument,
} from '@/lib/repositories/document-store';
import type {
    DriverVoucher,
    DriverVoucherItem,
    Expense,
    IncidentSettlementLine,
} from '@/lib/types';

import {
    normalizeCurrencyNumber,
    normalizeNumber,
    normalizeOptionalText,
} from './data-helpers';
import {
    computeDriverVoucherTotals,
    getDriverVoucherIssuedAmount,
} from './driver-workflow-support';

export function mapIncidentSettlementCategoryToVoucherCategory(category?: string) {
    switch (category) {
        case 'TOWING':
            return 'Towing / Evakuasi';
        case 'REPAIR':
        case 'SPAREPART':
        case 'TIRE':
            return 'Perbaikan Darurat Trip';
        case 'ACCOMMODATION':
            return 'Menginap Driver';
        case 'CARGO_HANDLING':
            return 'Bongkar Muat';
        default:
            return 'Lain-lain Trip';
    }
}

export async function findVoucherForIncidentDeliveryOrder(incident?: { relatedDeliveryOrderRef?: string }) {
    const relatedDeliveryOrderRef = normalizeOptionalText(incident?.relatedDeliveryOrderRef);
    if (!relatedDeliveryOrderRef) {
        return null;
    }
    const vouchers = await listDocumentsByFilter<DriverVoucher>('driverVoucher', {
        deliveryOrderRef: relatedDeliveryOrderRef,
    });
    return vouchers
        .filter(voucher => voucher.status !== 'SETTLED')
        .sort((left, right) => `${right.issuedDate || ''}-${right._id}`.localeCompare(`${left.issuedDate || ''}-${left._id}`))[0] ||
        null;
}

function buildIncidentVoucherItemDescription(params: {
    incidentNumber?: string;
    lineDescription?: string;
    expenseDescription?: string;
}) {
    return [
        params.incidentNumber ? `Insiden ${params.incidentNumber}` : 'Insiden driver',
        normalizeOptionalText(params.lineDescription) || normalizeOptionalText(params.expenseDescription),
    ].filter(Boolean).join(' - ');
}

async function recomputeVoucherOperationalTotals(voucher: DriverVoucher) {
    const items = await listDocumentsByFilter<DriverVoucherItem>('driverVoucherItem', {
        voucherRef: voucher._id,
    });
    const nextOperationalSpent = items.reduce(
        (sum, item) => sum + normalizeNumber(item.amount || 0, { maxFractionDigits: 0 }),
        0
    );
    const nextTotals = computeDriverVoucherTotals(
        getDriverVoucherIssuedAmount(voucher),
        nextOperationalSpent,
        normalizeNumber(voucher.driverFeeAmount || 0, { maxFractionDigits: 0 })
    );
    await updateDocument(voucher._id, {
        totalSpent: nextTotals.totalSpent,
        totalClaimAmount: nextTotals.totalClaimAmount,
        balance: nextTotals.balance,
        updatedAt: new Date().toISOString(),
    }, 'driverVoucher');
    return {
        ...voucher,
        totalSpent: nextTotals.totalSpent,
        totalClaimAmount: nextTotals.totalClaimAmount,
        balance: nextTotals.balance,
    };
}

export async function syncIncidentSettlementLineToDriverVoucherItem(params: {
    voucher: DriverVoucher;
    incident: { _id: string; incidentNumber?: string; relatedDeliveryOrderRef?: string };
    line: {
        _id: string;
        category?: string;
        date?: string;
        amount?: number;
        description?: string;
        note?: string;
        linkedDriverVoucherItemRef?: string;
        linkedExpenseRoute?: string;
    };
    expenseId: string;
    expenseDate: string;
    expenseDescription?: string;
}) {
    if (params.line.linkedDriverVoucherItemRef) {
        return params.line.linkedDriverVoucherItemRef;
    }
    const existingItems = await listDocumentsByFilter<DriverVoucherItem>('driverVoucherItem', {
        voucherRef: params.voucher._id,
    });
    const existingLinkedItem = existingItems.find(item =>
        item.relatedIncidentSettlementLineRef === params.line._id ||
        item.linkedExpenseRef === params.expenseId
    );
    if (existingLinkedItem) {
        return existingLinkedItem._id;
    }

    const voucherItemId = crypto.randomUUID();
    const amount = Math.max(normalizeCurrencyNumber(params.line.amount ?? 0), 0);
    const itemDoc: DriverVoucherItem = {
        _id: voucherItemId,
        _type: 'driverVoucherItem',
        voucherRef: params.voucher._id,
        expenseDate: params.expenseDate || params.line.date || getBusinessDateValue(),
        category: mapIncidentSettlementCategoryToVoucherCategory(params.line.category),
        description: buildIncidentVoucherItemDescription({
            incidentNumber: params.incident.incidentNumber,
            lineDescription: params.line.description,
            expenseDescription: params.expenseDescription,
        }),
        amount,
        relatedIncidentRef: params.incident._id,
        relatedIncidentSettlementLineRef: params.line._id,
        linkedExpenseRef: params.expenseId,
        source: 'INCIDENT',
    };
    await createDocument(itemDoc as unknown as { _type: string; [key: string]: unknown });
    await recomputeVoucherOperationalTotals(params.voucher);

    return voucherItemId;
}

function shouldSyncIncidentExpenseToDriverVoucher(params: {
    line: Pick<IncidentSettlementLine, 'linkedExpenseRoute'>;
    expense: Pick<Expense, 'bankAccountRef' | 'incidentExpenseRoute'>;
}) {
    const route = normalizeOptionalText(params.expense.incidentExpenseRoute || params.line.linkedExpenseRoute)?.toUpperCase();
    if (route === 'COMPANY_EXPENSE') {
        return false;
    }
    if (route === 'DRIVER_VOUCHER') {
        return !params.expense.bankAccountRef;
    }
    // Legacy posted incident expenses had no explicit route; no-bank rows were intended
    // to be pulled into the trip voucher by the old workflow.
    return !params.expense.bankAccountRef;
}

export async function syncPostedIncidentSettlementLinesToDriverVoucher(params: {
    voucher: DriverVoucher;
    deliveryOrderRef: string;
    issueDate?: string;
}) {
    const deliveryOrderRef = normalizeOptionalText(params.deliveryOrderRef);
    if (!deliveryOrderRef) {
        return { linkedCount: 0, skippedBankPaidCount: 0, voucher: params.voucher };
    }

    const incidents = await listDocumentsByFilter<{
        _id: string;
        incidentNumber?: string;
        relatedDeliveryOrderRef?: string;
    }>('incident', { relatedDeliveryOrderRef: deliveryOrderRef });
    if (incidents.length === 0) {
        return { linkedCount: 0, skippedBankPaidCount: 0, voucher: params.voucher };
    }

    let linkedCount = 0;
    let skippedBankPaidCount = 0;

    for (const incident of incidents) {
        const lines = await listDocumentsByFilter<IncidentSettlementLine>('incidentSettlementLine', {
            incidentRef: incident._id,
        });
        for (const line of lines) {
            if (line.status !== 'POSTED' || !line.linkedExpenseRef || line.linkedDriverVoucherItemRef) {
                continue;
            }

            const expense = await getDocumentById<Expense>(line.linkedExpenseRef, 'expense');
            if (!expense) {
                continue;
            }
            if (!shouldSyncIncidentExpenseToDriverVoucher({ line, expense })) {
                skippedBankPaidCount += 1;
                continue;
            }

            const linkedDriverVoucherItemRef = await syncIncidentSettlementLineToDriverVoucherItem({
                voucher: params.voucher,
                incident,
                line,
                expenseId: expense._id,
                expenseDate: expense.date || line.linkedExpenseDate || line.date || params.issueDate || getBusinessDateValue(),
                expenseDescription: expense.description,
            });
            const now = new Date().toISOString();
            await updateDocument(expense._id, {
                voucherRef: params.voucher._id,
                updatedAt: now,
            }, 'expense');
            await updateDocument(line._id, {
                linkedDriverVoucherItemRef,
                updatedAt: now,
            }, 'incidentSettlementLine');
            linkedCount += 1;
        }
    }

    const voucher = linkedCount > 0
        ? await getDocumentById<DriverVoucher>(params.voucher._id, 'driverVoucher')
        : params.voucher;
    return {
        linkedCount,
        skippedBankPaidCount,
        voucher: voucher || params.voucher,
    };
}
