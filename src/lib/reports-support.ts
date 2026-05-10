import type {
    BankAccount,
    BankTransaction,
    CustomerOverpaymentRefund,
    DriverVoucher,
    Expense,
    FreightNota,
    Payment,
} from './types';
import { getBusinessCalendarDateParts, parseBusinessDateValue } from './business-date';
import { parseFormattedNumberish } from '@/components/FormattedNumberInput.helpers';
import {
    getDriverVoucherFinancialSummary,
    getReceivableRemainingAmount,
} from './utils';

function parseWholeMoneyLike(value: unknown) {
    return Math.max(parseFormattedNumberish(value ?? 0, { maxFractionDigits: 0 }), 0);
}

function isInvoiceOverpaymentRefund(item: Pick<CustomerOverpaymentRefund, 'sourceType'>) {
    return item.sourceType === 'INVOICE_OVERPAID';
}

function getDateSortTime(value?: string) {
    if (!value) return 0;

    const parsedDateValue = parseBusinessDateValue(value);
    if (parsedDateValue) {
        return Date.UTC(
            Number(parsedDateValue.year),
            Number(parsedDateValue.month) - 1,
            Number(parsedDateValue.day),
        );
    }

    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

export type ReportPeriodMode = 'month' | 'year' | 'all';

export type CashFlowByBankEntry = {
    bankName: string;
    bankAccountNumber?: string;
    inflow: number;
    outflow: number;
};

export type ReportsSnapshot = {
    filteredPayments: Payment[];
    filteredOverpaymentRefunds: CustomerOverpaymentRefund[];
    filteredExpenses: Expense[];
    filteredBankTx: BankTransaction[];
    sortedFilteredBankTx: BankTransaction[];
    totalRevenue: number;
    totalExpense: number;
    netProfit: number;
    paymentTotalsByInvoice: Record<string, number>;
    totalNotaIssued: number;
    totalNotaOutstanding: number;
    openDriverVouchers: DriverVoucher[];
    openVoucherCash: number;
    openVoucherOperationalSpent: number;
    openVoucherDriverFees: number;
    openVoucherClaims: number;
    openVoucherReturn: number;
    openVoucherShortage: number;
    expenseByCategory: Record<string, number>;
    sortedCategories: Array<[string, number]>;
    cashFlowByBank: Record<string, CashFlowByBankEntry>;
};

export function createPeriodMatcher(
    periodMode: ReportPeriodMode,
    month: number,
    year: number
) {
    return (dateStr: string) => {
        if (periodMode === 'all') return true;
        const parts = getBusinessCalendarDateParts(dateStr);
        if (!parts) return false;
        const itemYear = Number(parts.year);
        const itemMonth = Number(parts.month) - 1;
        if (periodMode === 'year') return itemYear === year;
        return itemYear === year && itemMonth === month;
    };
}

export function buildPeriodLabel(
    periodMode: ReportPeriodMode,
    month: number,
    year: number,
    monthNames: string[]
) {
    return periodMode === 'all'
        ? 'Semua Periode'
        : periodMode === 'year'
            ? `Tahun ${year}`
            : `${monthNames[month]} ${year}`;
}

export function buildReportsSnapshot(params: {
    payments: Payment[];
    overpaymentRefunds: CustomerOverpaymentRefund[];
    expenses: Expense[];
    freightNotas: FreightNota[];
    driverVouchers: DriverVoucher[];
    allBankAccounts: BankAccount[];
    bankTransactions: BankTransaction[];
    periodMode: ReportPeriodMode;
    month: number;
    year: number;
}) : ReportsSnapshot {
    const {
        payments,
        overpaymentRefunds,
        expenses,
        freightNotas,
        driverVouchers,
        allBankAccounts,
        bankTransactions,
        periodMode,
        month,
        year,
    } = params;

    const inPeriod = createPeriodMatcher(periodMode, month, year);
    const filteredPayments = payments.filter(item => inPeriod(item.date));
    const filteredOverpaymentRefunds = overpaymentRefunds.filter(
        item => isInvoiceOverpaymentRefund(item) && inPeriod(item.date)
    );
    const filteredExpenses = expenses.filter(item => inPeriod(item.date));
    const filteredBankTx = bankTransactions.filter(item => inPeriod(item.date));
    const sortedFilteredBankTx = [...filteredBankTx].sort(
        (a, b) =>
            getDateSortTime(b.date) - getDateSortTime(a.date) ||
            String(b._createdAt || '').localeCompare(String(a._createdAt || '')) ||
            String(b._id).localeCompare(String(a._id))
    );
    const totalRevenue =
        filteredPayments.reduce((sum, item) => sum + parseWholeMoneyLike(item.amount), 0)
        - filteredOverpaymentRefunds.reduce((sum, item) => sum + parseWholeMoneyLike(item.amount), 0);
    const totalExpense = filteredExpenses.reduce((sum, item) => sum + parseWholeMoneyLike(item.amount), 0);
    const netProfit = totalRevenue - totalExpense;
    const paymentTotalsByInvoice = payments.reduce<Record<string, number>>(
        (acc, payment) => {
            acc[payment.invoiceRef] = (acc[payment.invoiceRef] || 0) + parseWholeMoneyLike(payment.amount);
            return acc;
        },
        {}
    );
    const invoiceRefundTotals = overpaymentRefunds.reduce<Record<string, number>>((acc, refund) => {
        if (refund.sourceType !== 'INVOICE_OVERPAID' || !refund.sourceInvoiceRef) return acc;
        acc[refund.sourceInvoiceRef] = (acc[refund.sourceInvoiceRef] || 0) + parseWholeMoneyLike(refund.amount);
        return acc;
    }, {});
    const activeFreightNotas = freightNotas.filter(item => item.status !== 'VOID');
    const totalNotaIssued = activeFreightNotas
        .filter(item => inPeriod(item.issueDate))
        .reduce((sum, item) => sum + parseWholeMoneyLike(item.totalAmount), 0);
    const totalNotaOutstanding = activeFreightNotas
        .filter(item => item.status !== 'PAID' && inPeriod(item.issueDate))
        .reduce(
            (sum, item) =>
                sum + getReceivableRemainingAmount(item, Math.max((paymentTotalsByInvoice[item._id] || 0) - (invoiceRefundTotals[item._id] || 0), 0)),
            0
        );
    const openDriverVouchers = driverVouchers
        .filter(item => item.status !== 'SETTLED' && inPeriod(item.issuedDate))
        .sort((a, b) => b.issuedDate.localeCompare(a.issuedDate));
    const openVoucherCash = openDriverVouchers.reduce(
        (sum, item) => sum + getDriverVoucherFinancialSummary(item).totalIssuedAmount,
        0
    );
    const openVoucherOperationalSpent = openDriverVouchers.reduce(
        (sum, item) => sum + getDriverVoucherFinancialSummary(item).totalSpent,
        0
    );
    const openVoucherDriverFees = openDriverVouchers.reduce(
        (sum, item) => sum + getDriverVoucherFinancialSummary(item).driverFeeAmount,
        0
    );
    const openVoucherClaims = openDriverVouchers.reduce(
        (sum, item) => sum + getDriverVoucherFinancialSummary(item).totalClaimAmount,
        0
    );
    const openVoucherReturn = openDriverVouchers.reduce(
        (sum, item) => sum + Math.max(getDriverVoucherFinancialSummary(item).balance, 0),
        0
    );
    const openVoucherShortage = openDriverVouchers.reduce(
        (sum, item) => sum + Math.abs(Math.min(getDriverVoucherFinancialSummary(item).balance, 0)),
        0
    );
    const expenseByCategory = filteredExpenses.reduce<Record<string, number>>(
        (acc, item) => {
            acc[item.categoryName || 'Lainnya'] =
                (acc[item.categoryName || 'Lainnya'] || 0) + parseWholeMoneyLike(item.amount);
            return acc;
        },
        {}
    );
    const sortedCategories = Object.entries(expenseByCategory).sort(
        ([, a], [, b]) => b - a
    );
    const cashFlowByBank = filteredBankTx.reduce<Record<string, CashFlowByBankEntry>>(
        (acc, item) => {
            const currentAccount = allBankAccounts.find(account => account._id === item.bankAccountRef);
            const bankName = item.bankAccountName || currentAccount?.bankName || 'Unknown';
            const bankAccountNumber = item.bankAccountNumber || currentAccount?.accountNumber;
            if (!acc[item.bankAccountRef]) {
                acc[item.bankAccountRef] = { bankName, bankAccountNumber, inflow: 0, outflow: 0 };
            }
            if (item.type === 'CREDIT' || item.type === 'TRANSFER_IN') {
                acc[item.bankAccountRef].inflow += parseWholeMoneyLike(item.amount);
            } else {
                acc[item.bankAccountRef].outflow += parseWholeMoneyLike(item.amount);
            }
            return acc;
        },
        {}
    );

    return {
        filteredPayments,
        filteredOverpaymentRefunds,
        filteredExpenses,
        filteredBankTx,
        sortedFilteredBankTx,
        totalRevenue,
        totalExpense,
        netProfit,
        paymentTotalsByInvoice,
        totalNotaIssued,
        totalNotaOutstanding,
        openDriverVouchers,
        openVoucherCash,
        openVoucherOperationalSpent,
        openVoucherDriverFees,
        openVoucherClaims,
        openVoucherReturn,
        openVoucherShortage,
        expenseByCategory,
        sortedCategories,
        cashFlowByBank,
    };
}

export function resolveBankTransactionAccountLabel(
    transaction: Pick<BankTransaction, 'bankAccountRef' | 'bankAccountName' | 'bankAccountNumber'>,
    allBankAccounts: Array<Pick<BankAccount, '_id' | 'bankName' | 'accountNumber'>>
) {
    const currentAccount = allBankAccounts.find(account => account._id === transaction.bankAccountRef);
    const bankName = transaction.bankAccountName || currentAccount?.bankName || '-';
    const bankAccountNumber = transaction.bankAccountNumber || currentAccount?.accountNumber;
    return bankAccountNumber ? `${bankName} - ${bankAccountNumber}` : bankName;
}

export function resolveBankTransactionAccountName(
    transaction: Pick<BankTransaction, 'bankAccountRef' | 'bankAccountName'>,
    allBankAccounts: Array<Pick<BankAccount, '_id' | 'bankName'>>
) {
    return transaction.bankAccountName
        || allBankAccounts.find(account => account._id === transaction.bankAccountRef)?.bankName
        || '-';
}

export function buildProfitLossExportRows(
    filteredPayments: Payment[],
    filteredExpenses: Expense[],
    filteredOverpaymentRefunds: CustomerOverpaymentRefund[] = []
) {
    const revenueRefundRows = filteredOverpaymentRefunds.filter(isInvoiceOverpaymentRefund);
    return [
        ...filteredPayments.map(item => ({
            tipe: 'Pendapatan',
            tanggal: item.date,
            deskripsi: item.note || 'Pembayaran customer',
            jumlah: parseWholeMoneyLike(item.amount),
        })),
        ...revenueRefundRows.map(item => ({
            tipe: 'Refund Kelebihan Bayar',
            tanggal: item.date,
            deskripsi: `Refund kelebihan bayar invoice ${item.sourceInvoiceNumber || item.sourceInvoiceRef || '-'}`,
            jumlah: -parseWholeMoneyLike(item.amount),
        })),
        ...filteredExpenses.map(item => ({
            tipe: 'Pengeluaran',
            tanggal: item.date,
            deskripsi: item.note || item.categoryName || '-',
            jumlah: -parseWholeMoneyLike(item.amount),
        })),
    ];
}

export function buildCashflowExportRows(
    sortedFilteredBankTx: BankTransaction[],
    allBankAccounts: BankAccount[]
) {
    return sortedFilteredBankTx.map(item => ({
        bank: resolveBankTransactionAccountLabel(item, allBankAccounts),
        tanggal: item.date,
        tipe: item.type,
        deskripsi: item.description,
        jumlah: parseWholeMoneyLike(item.amount),
        saldo: parseWholeMoneyLike(item.balanceAfter),
    }));
}
