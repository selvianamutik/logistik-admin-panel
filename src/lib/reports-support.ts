import type {
    BankAccount,
    BankTransaction,
    DriverVoucher,
    Expense,
    FreightNota,
    Payment,
} from './types';
import {
    getDriverVoucherIssuedAmount,
    getReceivableRemainingAmount,
} from './utils';

export type ReportPeriodMode = 'month' | 'year' | 'all';

export type CashFlowByBankEntry = {
    bankName: string;
    inflow: number;
    outflow: number;
};

export type ReportsSnapshot = {
    filteredPayments: Payment[];
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
        const date = new Date(dateStr);
        if (periodMode === 'year') return date.getFullYear() === year;
        return date.getFullYear() === year && date.getMonth() === month;
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
    const filteredExpenses = expenses.filter(item => inPeriod(item.date));
    const filteredBankTx = bankTransactions.filter(item => inPeriod(item.date));
    const sortedFilteredBankTx = [...filteredBankTx].sort(
        (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
    );
    const totalRevenue = filteredPayments.reduce((sum, item) => sum + item.amount, 0);
    const totalExpense = filteredExpenses.reduce((sum, item) => sum + item.amount, 0);
    const netProfit = totalRevenue - totalExpense;
    const paymentTotalsByInvoice = payments.reduce<Record<string, number>>(
        (acc, payment) => {
            acc[payment.invoiceRef] = (acc[payment.invoiceRef] || 0) + payment.amount;
            return acc;
        },
        {}
    );
    const totalNotaIssued = freightNotas
        .filter(item => inPeriod(item.issueDate))
        .reduce((sum, item) => sum + item.totalAmount, 0);
    const totalNotaOutstanding = freightNotas
        .filter(item => item.status !== 'PAID' && inPeriod(item.issueDate))
        .reduce(
            (sum, item) =>
                sum + getReceivableRemainingAmount(item, paymentTotalsByInvoice[item._id]),
            0
        );
    const openDriverVouchers = driverVouchers
        .filter(item => item.status !== 'SETTLED')
        .sort((a, b) => b.issuedDate.localeCompare(a.issuedDate));
    const openVoucherCash = openDriverVouchers.reduce(
        (sum, item) => sum + getDriverVoucherIssuedAmount(item),
        0
    );
    const openVoucherOperationalSpent = openDriverVouchers.reduce(
        (sum, item) => sum + (item.totalSpent || 0),
        0
    );
    const openVoucherDriverFees = openDriverVouchers.reduce(
        (sum, item) => sum + (item.driverFeeAmount || 0),
        0
    );
    const openVoucherClaims = openDriverVouchers.reduce(
        (sum, item) =>
            sum +
            (item.totalClaimAmount ||
                (item.totalSpent || 0) + (item.driverFeeAmount || 0)),
        0
    );
    const openVoucherReturn = openDriverVouchers.reduce(
        (sum, item) => sum + Math.max(item.balance || 0, 0),
        0
    );
    const openVoucherShortage = openDriverVouchers.reduce(
        (sum, item) => sum + Math.abs(Math.min(item.balance || 0, 0)),
        0
    );
    const expenseByCategory = filteredExpenses.reduce<Record<string, number>>(
        (acc, item) => {
            acc[item.categoryName || 'Lainnya'] =
                (acc[item.categoryName || 'Lainnya'] || 0) + item.amount;
            return acc;
        },
        {}
    );
    const sortedCategories = Object.entries(expenseByCategory).sort(
        ([, a], [, b]) => b - a
    );
    const cashFlowByBank = filteredBankTx.reduce<Record<string, CashFlowByBankEntry>>(
        (acc, item) => {
            const bankName =
                allBankAccounts.find(account => account._id === item.bankAccountRef)
                    ?.bankName || 'Unknown';
            if (!acc[item.bankAccountRef]) {
                acc[item.bankAccountRef] = { bankName, inflow: 0, outflow: 0 };
            }
            if (item.type === 'CREDIT' || item.type === 'TRANSFER_IN') {
                acc[item.bankAccountRef].inflow += item.amount;
            } else {
                acc[item.bankAccountRef].outflow += item.amount;
            }
            return acc;
        },
        {}
    );

    return {
        filteredPayments,
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

export function buildProfitLossExportRows(
    filteredPayments: Payment[],
    filteredExpenses: Expense[]
) {
    return [
        ...filteredPayments.map(item => ({
            tipe: 'Pendapatan',
            tanggal: item.date,
            deskripsi: item.note || 'Pembayaran customer',
            jumlah: item.amount,
        })),
        ...filteredExpenses.map(item => ({
            tipe: 'Pengeluaran',
            tanggal: item.date,
            deskripsi: item.note || item.categoryName || '-',
            jumlah: -item.amount,
        })),
    ];
}

export function buildCashflowExportRows(
    sortedFilteredBankTx: BankTransaction[],
    allBankAccounts: BankAccount[]
) {
    return sortedFilteredBankTx.map(item => ({
        bank:
            allBankAccounts.find(account => account._id === item.bankAccountRef)
                ?.bankName || '-',
        tanggal: item.date,
        tipe: item.type,
        deskripsi: item.description,
        jumlah: item.amount,
        saldo: item.balanceAfter,
    }));
}
