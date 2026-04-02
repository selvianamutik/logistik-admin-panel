import { parseFormattedNumberish } from './formatted-number';
import { deriveReceivableStatus, getReceivableNetAmount } from './utils';
import type {
    CustomerOverpayment,
    CustomerOverpaymentRefund,
    CustomerReceipt,
    FreightNota,
} from './types';

function parseWholeMoneyLike(value: unknown) {
    return Math.max(parseFormattedNumberish(value ?? 0, { maxFractionDigits: 0 }), 0);
}

export function getCustomerOverpaymentRefundTotals(
    refunds: Array<Pick<CustomerOverpaymentRefund, 'sourceType' | 'sourceReceiptRef' | 'sourceInvoiceRef' | 'amount'>>
) {
    const receiptRefundsByRef = refunds.reduce<Record<string, number>>((acc, refund) => {
        if (refund.sourceType !== 'RECEIPT_UNAPPLIED' || !refund.sourceReceiptRef) return acc;
        acc[refund.sourceReceiptRef] = (acc[refund.sourceReceiptRef] || 0) + parseWholeMoneyLike(refund.amount);
        return acc;
    }, {});

    const invoiceRefundsByRef = refunds.reduce<Record<string, number>>((acc, refund) => {
        if (refund.sourceType !== 'INVOICE_OVERPAID' || !refund.sourceInvoiceRef) return acc;
        acc[refund.sourceInvoiceRef] = (acc[refund.sourceInvoiceRef] || 0) + parseWholeMoneyLike(refund.amount);
        return acc;
    }, {});

    return {
        receiptRefundsByRef,
        invoiceRefundsByRef,
    };
}

export function getFreightNotaPaymentTotals(
    paymentRows: Array<{ invoiceRef?: string; amount?: unknown }>
) {
    return paymentRows.reduce<Record<string, number>>((acc, payment) => {
        if (!payment.invoiceRef) return acc;
        acc[payment.invoiceRef] = (acc[payment.invoiceRef] || 0) + parseWholeMoneyLike(payment.amount);
        return acc;
    }, {});
}

export function applyDerivedCustomerReceiptOverpaymentState<
    T extends {
        _id: string;
        totalAmount?: number | string | null;
        allocatedAmount?: number | string | null;
        unappliedAmount?: number | string | null;
    }
>(
    receipts: T[],
    receiptRefundsByRef: Record<string, number>
) {
    return receipts.map(receipt => {
        const unappliedAmount = parseWholeMoneyLike(receipt.unappliedAmount);
        const refundedOverpaymentAmount = Math.min(receiptRefundsByRef[receipt._id] || 0, unappliedAmount);
        const openOverpaymentAmount = Math.max(unappliedAmount - refundedOverpaymentAmount, 0);
        return {
            ...receipt,
            refundedOverpaymentAmount,
            openOverpaymentAmount,
            overpaymentStatus: openOverpaymentAmount > 0 ? 'OPEN' : refundedOverpaymentAmount > 0 ? 'REFUNDED' : undefined,
        };
    });
}

export function applyDerivedFreightNotaReceivableState<
    T extends {
        _id: string;
        status?: string;
        totalAmount?: string | number | null;
        totalAdjustmentAmount?: string | number | null;
        netAmount?: string | number | null;
        issueDate?: string;
        _createdAt?: string;
    }
>(
    notas: T[],
    paymentTotalsByInvoice: Record<string, number>,
    invoiceRefundsByRef: Record<string, number> = {}
) {
    return notas.map(nota => {
        const rawPaidAmount = paymentTotalsByInvoice[nota._id] || 0;
        const refundedOverpaymentAmount = Math.min(invoiceRefundsByRef[nota._id] || 0, rawPaidAmount);
        const effectivePaidAmount = Math.max(rawPaidAmount - refundedOverpaymentAmount, 0);
        const netAmount = getReceivableNetAmount(nota);
        const remainingAmount = Math.max(netAmount - effectivePaidAmount, 0);
        const openOverpaymentAmount = Math.max(effectivePaidAmount - netAmount, 0);
        return {
            ...nota,
            status: deriveReceivableStatus(nota, effectivePaidAmount),
            totalPaidEffective: effectivePaidAmount,
            refundedOverpaymentAmount,
            openOverpaymentAmount,
            remainingAmount,
        };
    });
}

export function buildCustomerOverpaymentCases(params: {
    receipts: Array<
        Pick<
            CustomerReceipt,
            '_id' | 'receiptNumber' | 'customerRef' | 'customerName' | 'date' | 'unappliedAmount'
        > & {
            refundedOverpaymentAmount?: number | string | null;
            openOverpaymentAmount?: number | string | null;
        }
    >;
    notas: Array<
        Pick<
            FreightNota,
            '_id' | 'notaNumber' | 'customerRef' | 'customerName' | 'issueDate' | 'totalAmount' | 'totalAdjustmentAmount' | 'netAmount'
        > & {
            totalPaidEffective?: number | string | null;
            refundedOverpaymentAmount?: number | string | null;
            openOverpaymentAmount?: number | string | null;
        }
    >;
    paymentTotalsByInvoice: Record<string, number>;
    invoiceRefundsByRef: Record<string, number>;
    receiptRefundsByRef: Record<string, number>;
    invoiceDetectedDatesByRef?: Record<string, string>;
}) {
    const receiptCases = params.receipts.reduce<CustomerOverpayment[]>((acc, receipt) => {
            const rawAmount = parseWholeMoneyLike(receipt.unappliedAmount);
            const refundedAmount = Math.min(params.receiptRefundsByRef[receipt._id] || 0, rawAmount);
            const remainingAmount = Math.max(rawAmount - refundedAmount, 0);
            if (rawAmount <= 0 && refundedAmount <= 0) return acc;
            acc.push({
                _id: `receipt:${receipt._id}`,
                _type: 'customerOverpayment',
                sourceType: 'RECEIPT_UNAPPLIED',
                status: remainingAmount > 0 ? 'OPEN' : 'REFUNDED',
                customerRef: receipt.customerRef,
                customerName: receipt.customerName || '-',
                sourceReceiptRef: receipt._id,
                sourceReceiptNumber: receipt.receiptNumber,
                detectedDate: receipt.date,
                amount: rawAmount,
                refundedAmount,
                remainingAmount,
                sourceLabel: receipt.receiptNumber || receipt._id,
                sourceDescription: 'Sisa penerimaan customer belum dialokasikan ke nota.',
            });
            return acc;
        }, []);

    const invoiceCases = params.notas.reduce<CustomerOverpayment[]>((acc, nota) => {
            const rawPaidAmount = params.paymentTotalsByInvoice[nota._id] || 0;
            const netAmount = getReceivableNetAmount(nota);
            const rawOverpaymentAmount = Math.max(rawPaidAmount - netAmount, 0);
            const refundedAmount = Math.min(params.invoiceRefundsByRef[nota._id] || 0, rawOverpaymentAmount);
            const remainingAmount = Math.max(rawOverpaymentAmount - refundedAmount, 0);
            if (rawOverpaymentAmount <= 0 && refundedAmount <= 0) return acc;
            acc.push({
                _id: `invoice:${nota._id}`,
                _type: 'customerOverpayment',
                sourceType: 'INVOICE_OVERPAID',
                status: remainingAmount > 0 ? 'OPEN' : 'REFUNDED',
                customerRef: nota.customerRef,
                customerName: nota.customerName || '-',
                sourceInvoiceRef: nota._id,
                sourceInvoiceNumber: nota.notaNumber,
                detectedDate: params.invoiceDetectedDatesByRef?.[nota._id] || nota.issueDate || '',
                amount: rawOverpaymentAmount,
                refundedAmount,
                remainingAmount,
                sourceLabel: nota.notaNumber || nota._id,
                sourceDescription: 'Pembayaran melebihi tagihan final setelah klaim/potongan.',
            });
            return acc;
        }, []);

    return [...receiptCases, ...invoiceCases];
}

export function sortCustomerOverpaymentCases(
    items: CustomerOverpayment[],
    sortField?: string,
    sortDir?: 'asc' | 'desc',
    sortPreset?: string | null
) {
    if (sortPreset === 'work-queue') {
        const statusRank: Record<CustomerOverpayment['status'], number> = {
            OPEN: 0,
            REFUNDED: 1,
        };
        return [...items].sort((left, right) => {
            const leftRank = statusRank[left.status];
            const rightRank = statusRank[right.status];
            if (leftRank !== rightRank) return leftRank - rightRank;
            if (left.detectedDate !== right.detectedDate) {
                return left.detectedDate.localeCompare(right.detectedDate);
            }
            return right.remainingAmount - left.remainingAmount;
        });
    }

    if (!sortField) {
        return items;
    }

    const direction = sortDir === 'asc' ? 1 : -1;
    return [...items].sort((left, right) => {
        const leftValue = (left as unknown as Record<string, unknown>)[sortField];
        const rightValue = (right as unknown as Record<string, unknown>)[sortField];
        const leftNumber = parseFormattedNumberish(leftValue as string | number | undefined | null, { maxFractionDigits: 0 });
        const rightNumber = parseFormattedNumberish(rightValue as string | number | undefined | null, { maxFractionDigits: 0 });

        if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
            if (leftNumber === rightNumber) return 0;
            return leftNumber > rightNumber ? direction : -direction;
        }

        const leftText = String(leftValue ?? '');
        const rightText = String(rightValue ?? '');
        return leftText.localeCompare(rightText) * direction;
    });
}
