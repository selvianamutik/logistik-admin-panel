import type { InvoiceAdjustmentKind, Payment } from '@/lib/types';

import {
    normalizeNumber,
    normalizeOptionalText,
    normalizeText,
} from './data-helpers';

export type NormalizedFreightNotaRow = {
    doRef?: string;
    doNumber?: string;
    vehiclePlate?: string;
    date: string;
    noSJ: string;
    dari: string;
    tujuan: string;
    barang?: string;
    collie?: number;
    beratKg: number;
    tarip: number;
    uangRp: number;
    ket?: string;
};

export type FreightNotaOrderSource = {
    _id: string;
    customerRef?: unknown;
    pickupAddress?: string;
    receiverAddress?: string;
};

export type FreightNotaDeliveryOrderItemSource = {
    deliveryOrderRef?: string;
    orderItemDescription?: string;
    orderItemQtyKoli?: number;
    orderItemWeight?: number;
    actualQtyKoli?: number;
    actualWeightKg?: number;
};

export type ReceivableDoc = Record<string, unknown> & {
    _id: string;
    _rev?: string;
    _type: 'freightNota' | 'invoice';
    totalAmount?: number;
    totalAdjustmentAmount?: number;
    netAmount?: number;
    customerRef?: unknown;
    customerName?: string;
    notaNumber?: string;
    invoiceNumber?: string;
};

export type InvoiceAdjustmentDoc = {
    _id: string;
    _rev?: string;
    invoiceRef?: string;
    amount?: number;
    status?: string;
};

export type ReceivableSnapshot = {
    doc: ReceivableDoc;
    grossAmount: number;
    totalAdjustmentAmount: number;
    netAmount: number;
    totalPaid: number;
    remainingAmount: number;
    creditAmount: number;
    customerRef?: string;
    customerName: string;
    label: string;
};

export type CustomerReceiptAllocationInput = {
    invoiceRef: string;
    amount: number;
    note?: string;
};

export const INVOICE_ADJUSTMENT_KIND_SET = new Set<InvoiceAdjustmentKind>([
    'DAMAGE_CLAIM',
    'SHORTAGE_CLAIM',
    'DISCOUNT',
    'PENALTY',
    'OTHER',
]);

export function summarizeDeliveryOrderItems(items: FreightNotaDeliveryOrderItemSource[]) {
    const descriptions = [
        ...new Set(
            items
                .map(item => normalizeOptionalText(item.orderItemDescription))
                .filter((value): value is string => Boolean(value))
        ),
    ];
    const collie = items.reduce(
        (sum, item) => sum + normalizeNumber(item.actualQtyKoli ?? item.orderItemQtyKoli ?? 0),
        0
    );
    const beratKg = items.reduce(
        (sum, item) => sum + normalizeNumber(item.actualWeightKg ?? item.orderItemWeight ?? 0),
        0
    );

    return {
        barang: descriptions.join(', '),
        collie,
        beratKg,
    };
}

export function isFreightNotaRowEmpty(row: Record<string, unknown>) {
    return (
        !normalizeOptionalText(row.doRef) &&
        !normalizeText(row.noSJ) &&
        !normalizeText(row.tujuan) &&
        !normalizeText(row.barang) &&
        normalizeNumber(row.collie || 0) === 0 &&
        normalizeNumber(row.beratKg || 0) === 0 &&
        normalizeNumber(row.tarip || 0) === 0
    );
}

export function deriveBillingStatus(netAmount: number, totalPaid: number) {
    if (totalPaid >= netAmount) return 'PAID';
    if (totalPaid > 0) return 'PARTIAL';
    return 'UNPAID';
}

export function buildReceivablePatch(
    snapshot: Pick<ReceivableSnapshot, 'grossAmount'>,
    totalPaid: number,
    totalAdjustmentAmount: number
) {
    const nextAdjustment = Math.max(totalAdjustmentAmount, 0);
    const nextNetAmount = Math.max(snapshot.grossAmount - nextAdjustment, 0);
    return {
        status: deriveBillingStatus(nextNetAmount, totalPaid),
        totalAdjustmentAmount: nextAdjustment,
        netAmount: nextNetAmount,
    };
}

export function computeReceivableSnapshot(
    doc: ReceivableDoc,
    allPayments: Payment[],
    approvedAdjustments: InvoiceAdjustmentDoc[]
): ReceivableSnapshot {
    const grossAmount = Math.max(normalizeNumber(doc.totalAmount || 0), 0);
    const totalPaid = allPayments.reduce((sum, item) => sum + normalizeNumber(item.amount || 0), 0);
    const totalAdjustmentAmount = approvedAdjustments.reduce(
        (sum, item) => sum + normalizeNumber(item.amount || 0),
        0
    );
    const netAmount = Math.max(grossAmount - totalAdjustmentAmount, 0);
    const customerRef =
        typeof doc.customerRef === 'string'
            ? doc.customerRef
            : doc.customerRef && typeof doc.customerRef === 'object' && '_ref' in doc.customerRef
                ? normalizeOptionalText((doc.customerRef as { _ref?: unknown })._ref) || undefined
                : undefined;
    const customerName = normalizeText(doc.customerName) || '-';
    const label =
        normalizeText(doc.notaNumber) ||
        normalizeText(doc.invoiceNumber) ||
        doc._id;

    return {
        doc,
        grossAmount,
        totalAdjustmentAmount,
        netAmount,
        totalPaid,
        remainingAmount: Math.max(netAmount - totalPaid, 0),
        creditAmount: Math.max(totalPaid - netAmount, 0),
        customerRef,
        customerName,
        label,
    };
}
