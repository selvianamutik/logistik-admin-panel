import { parseFormattedNumberish } from '@/components/FormattedNumberInput.helpers';
import { getReceivableNetAmount } from './utils';
import { calculatePph23Summary } from './pph23';
import type { BankAccount, FreightNota, InvoiceAdjustment, Payment } from './types';

export const INVOICE_DETAIL_STATUS_MAP: Record<string, { label: string; color: string }> = {
    UNPAID: { label: 'Belum Lunas', color: 'danger' },
    PARTIAL: { label: 'Sebagian', color: 'warning' },
    PAID: { label: 'Lunas', color: 'success' },
    VOID: { label: 'Dibatalkan', color: 'secondary' },
};

export function sortInvoiceAdjustments(adjustments: InvoiceAdjustment[]) {
    return [...adjustments].sort((a, b) => b.date.localeCompare(a.date));
}

export function buildInvoiceDetailSummary(params: {
    nota: FreightNota | null;
    payments: Payment[];
    adjustments: InvoiceAdjustment[];
}) {
    const totalPaidRaw = params.payments.reduce(
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
    const pph23Summary = calculatePph23Summary({
        grossAmount,
        claimAmount: totalAdjustmentAmount,
        enabled: params.nota?.pph23Enabled,
        ratePercent: params.nota?.pph23RatePercent,
        baseMode: params.nota?.pph23BaseMode,
    });
    const netAmount = params.nota ? getReceivableNetAmount(params.nota) : 0;
    const refundedOverpaymentAmount = parseFormattedNumberish(params.nota?.refundedOverpaymentAmount || 0, { maxFractionDigits: 0 });
    const totalPaid =
        params.nota?.totalPaidEffective !== undefined && params.nota?.totalPaidEffective !== null
            ? parseFormattedNumberish(params.nota.totalPaidEffective, { maxFractionDigits: 0 })
            : Math.max(totalPaidRaw - refundedOverpaymentAmount, 0);
    const remaining = Math.max(netAmount - totalPaid, 0);
    const creditAmount =
        params.nota?.openOverpaymentAmount !== undefined && params.nota?.openOverpaymentAmount !== null
            ? parseFormattedNumberish(params.nota.openOverpaymentAmount, { maxFractionDigits: 0 })
            : Math.max(totalPaid - netAmount, 0);
    const paidPercent = netAmount > 0 ? Math.min(100, (Math.min(totalPaid, netAmount) / netAmount) * 100) : totalPaid > 0 ? 100 : 0;

    return {
        totalPaidRaw,
        totalPaid,
        refundedOverpaymentAmount,
        grossAmount,
        totalAdjustmentAmount,
        pph23Enabled: pph23Summary.enabled,
        pph23RatePercent: pph23Summary.ratePercent,
        pph23BaseMode: pph23Summary.baseMode,
        pph23BaseAmount: pph23Summary.baseAmount,
        pph23Amount: pph23Summary.amount,
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
