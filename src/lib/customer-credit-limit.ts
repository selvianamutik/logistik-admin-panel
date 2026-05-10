import { parseFormattedNumberish } from '@/components/FormattedNumberInput.helpers';
import type { Customer, FreightNota } from '@/lib/types';
import { getReceivableNetAmount } from '@/lib/utils';

type CreditCustomer = Pick<Customer, 'creditLimitAmount'> | null | undefined;
type CreditNota = Pick<FreightNota, 'status' | 'totalAmount' | 'totalAdjustmentAmount' | 'pph23Enabled' | 'pph23RatePercent' | 'pph23BaseMode' | 'pph23Amount' | 'netAmount' | 'totalPaidEffective'>;

export type CustomerCreditUsage = {
    limitAmount: number;
    outstandingAmount: number;
    availableAmount: number | null;
    activeInvoiceCount: number;
    isLimited: boolean;
    isBlocked: boolean;
};

function normalizeMoney(value: unknown) {
    const amount = parseFormattedNumberish(value ?? 0, { allowDecimal: false, maxFractionDigits: 0 });
    return Number.isFinite(amount) ? Math.max(Math.round(amount), 0) : 0;
}

export function getCustomerCreditLimitAmount(customer: CreditCustomer) {
    return normalizeMoney(customer?.creditLimitAmount);
}

export function getFreightNotaOutstandingAmount(nota: CreditNota) {
    if (nota.status === 'VOID' || nota.status === 'PAID') {
        return 0;
    }
    const netAmount = normalizeMoney(getReceivableNetAmount(nota));
    const paidAmount = normalizeMoney(nota.totalPaidEffective);
    return Math.max(netAmount - paidAmount, 0);
}

export function summarizeCustomerCreditUsage(customer: CreditCustomer, notas: CreditNota[] = []): CustomerCreditUsage {
    const limitAmount = getCustomerCreditLimitAmount(customer);
    const outstandingRows = notas
        .map(nota => getFreightNotaOutstandingAmount(nota))
        .filter(amount => amount > 0);
    const outstandingAmount = outstandingRows.reduce((sum, amount) => sum + amount, 0);
    const isLimited = limitAmount > 0;

    return {
        limitAmount,
        outstandingAmount,
        availableAmount: isLimited ? Math.max(limitAmount - outstandingAmount, 0) : null,
        activeInvoiceCount: outstandingRows.length,
        isLimited,
        isBlocked: isLimited && outstandingAmount >= limitAmount,
    };
}

export function formatCreditLimitCurrency(amount: number) {
    return `Rp ${normalizeMoney(amount).toLocaleString('id-ID')}`;
}

export function formatCustomerCreditBlockMessage(customerName: string | undefined, usage: CustomerCreditUsage) {
    return `Customer ${customerName || 'ini'} sudah mencapai limit piutang (${formatCreditLimitCurrency(usage.outstandingAmount)} / ${formatCreditLimitCurrency(usage.limitAmount)}). Catat pembayaran invoice atau naikkan limit sebelum membuat order baru.`;
}
