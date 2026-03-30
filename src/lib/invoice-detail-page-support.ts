import { parseFormattedNumberish } from './formatted-number';
import { getReceivableNetAmount } from './utils';
import type { BankAccount, FreightNota, InvoiceAdjustment, Payment } from './types';

export const INVOICE_DETAIL_STATUS_MAP: Record<string, { label: string; color: string }> = {
    UNPAID: { label: 'Belum Lunas', color: 'danger' },
    PARTIAL: { label: 'Sebagian', color: 'warning' },
    PAID: { label: 'Lunas', color: 'success' },
};

export function sortInvoiceAdjustments(adjustments: InvoiceAdjustment[]) {
    return [...adjustments].sort((a, b) => b.date.localeCompare(a.date));
}

export function buildInvoiceDetailSummary(params: {
    nota: FreightNota | null;
    payments: Payment[];
    adjustments: InvoiceAdjustment[];
}) {
    const totalPaid = params.payments.reduce(
        (sum, payment) => sum + parseFormattedNumberish(payment.amount || 0, { maxFractionDigits: 0 }),
        0
    );
    const grossAmount = parseFormattedNumberish(params.nota?.totalAmount || 0, { maxFractionDigits: 0 });
    const totalAdjustmentAmount =
        params.nota?.totalAdjustmentAmount !== undefined && params.nota?.totalAdjustmentAmount !== null
            ? parseFormattedNumberish(params.nota.totalAdjustmentAmount, { maxFractionDigits: 0 })
            : params.adjustments
                .filter(item => item.status === 'APPROVED')
                .reduce((sum, item) => sum + parseFormattedNumberish(item.amount || 0, { maxFractionDigits: 0 }), 0);
    const netAmount = params.nota ? getReceivableNetAmount(params.nota) : 0;
    const remaining = Math.max(netAmount - totalPaid, 0);
    const creditAmount = Math.max(totalPaid - netAmount, 0);
    const paidPercent = netAmount > 0 ? Math.min(100, (Math.min(totalPaid, netAmount) / netAmount) * 100) : totalPaid > 0 ? 100 : 0;

    return {
        totalPaid,
        grossAmount,
        totalAdjustmentAmount,
        netAmount,
        remaining,
        creditAmount,
        paidPercent,
    };
}

export function buildBankAccountMap(bankAccounts: BankAccount[]) {
    return new Map(bankAccounts.map(account => [account._id, account]));
}

export function resolvePaymentAccountLabel(payment: Payment, accountMap: Map<string, BankAccount>) {
    const matchedAccount = payment.bankAccountRef ? accountMap.get(payment.bankAccountRef) : undefined;

    if (payment.bankAccountName) {
        return `${payment.bankAccountName}${payment.bankAccountNumber || matchedAccount?.accountNumber ? ` - ${payment.bankAccountNumber || matchedAccount?.accountNumber}` : ''}`;
    }

    if (matchedAccount) {
        return `${matchedAccount.bankName} - ${matchedAccount.accountNumber}`;
    }

    if (payment.method === 'CASH') {
        return 'Kas / rekening tidak tercatat';
    }

    return '';
}
