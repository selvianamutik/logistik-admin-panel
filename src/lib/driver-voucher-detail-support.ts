import { escapePrintHtml } from './print';
import type { DriverVoucher, DriverVoucherDisbursement, DriverVoucherItem } from './types';
import { getBusinessDateValue } from './business-date';
import { parseFormattedNumberish } from './formatted-number';
import { formatCurrency, formatDate, getDriverVoucherInitialCash, getDriverVoucherIssuedAmount, getDriverVoucherOperationalBalance, getDriverVoucherTopUpAmount } from './utils';

export const DRIVER_VOUCHER_STATUS_MAP: Record<string, { label: string; cls: string }> = {
    DRAFT: { label: 'Draft', cls: 'badge-gray' },
    ISSUED: { label: 'Diberikan', cls: 'badge-blue' },
    SETTLED: { label: 'Selesai', cls: 'badge-green' },
};

export const DRIVER_VOUCHER_EXPENSE_CATEGORIES = ['BBM / Solar', 'Tol & Parkir', 'Parkir', 'Makan', 'Menginap', 'Bongkar Muat', 'Perbaikan', 'Lain-lain'];

export type DriverVoucherItemFormState = {
    expenseDate: string;
    category: string;
    description: string;
    amount: number;
};

export type DriverVoucherTopUpFormState = {
    date: string;
    bankAccountRef: string;
    amount: number;
    note: string;
};

export function createDefaultDriverVoucherItemForm(): DriverVoucherItemFormState {
    return {
        expenseDate: getBusinessDateValue(),
        category: 'BBM / Solar',
        description: '',
        amount: 0,
    };
}

export function createDefaultDriverVoucherTopUpForm(issueBankRef = ''): DriverVoucherTopUpFormState {
    return {
        date: getBusinessDateValue(),
        bankAccountRef: issueBankRef,
        amount: 0,
        note: '',
    };
}

export function sortDriverVoucherDisbursements(disbursements: DriverVoucherDisbursement[]) {
    return [...disbursements].sort((a, b) => `${b.date}-${b.kind}`.localeCompare(`${a.date}-${a.kind}`));
}

export function sortDriverVoucherItems(items: DriverVoucherItem[]) {
    return [...items].sort((a, b) => `${b.expenseDate || ''}-${b._id}`.localeCompare(`${a.expenseDate || ''}-${a._id}`));
}

export function buildDriverVoucherDetailSummary(voucher: DriverVoucher | null, items: DriverVoucherItem[]) {
    const operationalSpent = items.reduce(
        (sum, item) => sum + parseFormattedNumberish(item.amount || 0, { maxFractionDigits: 0 }),
        0
    );
    const driverFeeAmount = parseFormattedNumberish(voucher?.driverFeeAmount || 0, { maxFractionDigits: 0 });
    const totalClaimAmount = operationalSpent + driverFeeAmount;
    const initialCashGiven = getDriverVoucherInitialCash(voucher || {});
    const totalIssuedAmount = getDriverVoucherIssuedAmount(voucher || {});
    const topUpAmount = getDriverVoucherTopUpAmount(voucher || {});
    const operationalBalance = getDriverVoucherOperationalBalance({
        ...(voucher || {}),
        totalSpent: operationalSpent,
    });
    const balance = totalIssuedAmount - totalClaimAmount;
    const isSettled = voucher?.status === 'SETTLED';
    const statusConfig = DRIVER_VOUCHER_STATUS_MAP[voucher?.status || ''] || { label: voucher?.status || '-', cls: 'badge-gray' };
    const settlementLabel = balance > 0
        ? 'Driver mengembalikan net settlement akhir ke rekening atau kas perusahaan'
        : balance < 0
            ? 'Perusahaan masih perlu menambah pembayaran akhir ke supir'
            : 'Tidak ada net settlement akhir';
    const settlementPrimaryLabel = balance > 0
        ? 'Selesaikan & Catat Pengembalian Akhir'
        : balance < 0
            ? 'Selesaikan & Tambah Bayar Akhir'
            : 'Selesaikan Trip';

    return {
        operationalSpent,
        operationalBalance,
        driverFeeAmount,
        totalClaimAmount,
        initialCashGiven,
        totalIssuedAmount,
        topUpAmount,
        balance,
        isSettled,
        statusConfig,
        settlementLabel,
        settlementPrimaryLabel,
    };
}

export function buildDriverVoucherPrintHtml(params: {
    voucher: DriverVoucher;
    items: DriverVoucherItem[];
    disbursements: DriverVoucherDisbursement[];
    summary: ReturnType<typeof buildDriverVoucherDetailSummary>;
}) {
    const { voucher, items, disbursements, summary } = params;
    const {
        operationalSpent,
        operationalBalance,
        driverFeeAmount,
        totalClaimAmount,
        initialCashGiven,
        totalIssuedAmount,
        topUpAmount,
        balance,
    } = summary;

    const disbursementSection = disbursements.length > 0 ? `
        <div style="margin-bottom:16px">
            <div style="font-weight:700;margin-bottom:8px">Riwayat Pencairan Uang Jalan</div>
            <table>
                <thead>
                    <tr><th>No</th><th>Tanggal</th><th>Jenis</th><th>Sumber Dana</th><th>Catatan</th><th class="r">Jumlah</th></tr>
                </thead>
                <tbody>
                    ${disbursements.map((item, index) => `
                        <tr>
                            <td>${index + 1}</td>
                            <td>${escapePrintHtml(formatDate(item.date))}</td>
                            <td>${escapePrintHtml(item.kind === 'INITIAL' ? 'Uang Jalan Awal' : 'Top Up Uang Jalan')}</td>
                            <td>${escapePrintHtml(item.bankAccountName || '-')}</td>
                            <td>${escapePrintHtml(item.note || '-')}</td>
                            <td class="r">${escapePrintHtml(formatCurrency(item.amount))}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    ` : '';

    return `
        <div style="margin-bottom:16px">
            <table style="width:100%;border:none">
                <tbody>
                    <tr><td style="border:none;padding:2px 8px;width:130px;font-weight:600">No. Bon</td><td style="border:none;padding:2px 8px">${escapePrintHtml(voucher.bonNumber)}</td><td style="border:none;padding:2px 8px;width:130px;font-weight:600">Tanggal</td><td style="border:none;padding:2px 8px">${escapePrintHtml(formatDate(voucher.issuedDate || ''))}</td></tr>
                    <tr><td style="border:none;padding:2px 8px;font-weight:600">Supir</td><td style="border:none;padding:2px 8px">${escapePrintHtml(voucher.driverName || '-')}</td><td style="border:none;padding:2px 8px;font-weight:600">Kendaraan</td><td style="border:none;padding:2px 8px">${escapePrintHtml(voucher.vehiclePlate || '-')}</td></tr>
                    <tr><td style="border:none;padding:2px 8px;font-weight:600">No. DO Internal</td><td style="border:none;padding:2px 8px">${escapePrintHtml(voucher.doNumber || '-')}</td><td style="border:none;padding:2px 8px;font-weight:600">Rute</td><td style="border:none;padding:2px 8px">${escapePrintHtml(voucher.route || '-')}</td></tr>
                    <tr><td style="border:none;padding:2px 8px;font-weight:600">Uang Jalan Awal</td><td style="border:none;padding:2px 8px;font-weight:700;font-size:1.05em">${escapePrintHtml(formatCurrency(initialCashGiven))}</td><td style="border:none;padding:2px 8px;font-weight:600">Top Up Uang Jalan</td><td style="border:none;padding:2px 8px">${escapePrintHtml(formatCurrency(topUpAmount))}</td></tr>
                    <tr><td style="border:none;padding:2px 8px;font-weight:600">Total Uang Diberikan</td><td style="border:none;padding:2px 8px;font-weight:700">${escapePrintHtml(formatCurrency(totalIssuedAmount))}</td><td style="border:none;padding:2px 8px;font-weight:600">Rekening Sumber</td><td style="border:none;padding:2px 8px">${escapePrintHtml(voucher.issueBankName || '-')}</td></tr>
                    <tr><td style="border:none;padding:2px 8px;font-weight:600">Biaya Perjalanan</td><td style="border:none;padding:2px 8px">${escapePrintHtml(formatCurrency(operationalSpent))}</td><td style="border:none;padding:2px 8px;font-weight:600">Sisa Bon Operasional</td><td style="border:none;padding:2px 8px">${escapePrintHtml(formatCurrency(operationalBalance))}</td></tr>
                    <tr><td style="border:none;padding:2px 8px;font-weight:600">Upah Trip Snapshot DO</td><td style="border:none;padding:2px 8px">${escapePrintHtml(formatCurrency(driverFeeAmount))}</td><td style="border:none;padding:2px 8px;font-weight:600">Net Settlement Akhir</td><td style="border:none;padding:2px 8px">${escapePrintHtml(formatCurrency(balance))}</td></tr>
                    <tr><td style="border:none;padding:2px 8px;font-weight:600">Status</td><td style="border:none;padding:2px 8px">${escapePrintHtml(DRIVER_VOUCHER_STATUS_MAP[voucher.status || '']?.label || voucher.status)}</td><td style="border:none;padding:2px 8px;font-weight:600">Rekening Settlement</td><td style="border:none;padding:2px 8px">${escapePrintHtml(voucher.settlementBankName || '-')}</td></tr>
                </tbody>
            </table>
        </div>
        ${disbursementSection}
        <table>
            <thead><tr><th>No</th><th>Tanggal</th><th>Kategori</th><th>Deskripsi</th><th class="r">Jumlah</th></tr></thead>
            <tbody>
                ${items.map((item, index) => `
                    <tr>
                        <td>${index + 1}</td>
                        <td>${escapePrintHtml(item.expenseDate ? formatDate(item.expenseDate) : '-')}</td>
                        <td class="b">${escapePrintHtml(item.category)}</td>
                        <td>${escapePrintHtml(item.description || '-')}</td>
                        <td class="r">${escapePrintHtml(formatCurrency(item.amount))}</td>
                    </tr>
                `).join('')}
                <tr style="border-top:2px solid #1e293b"><td colspan="4" class="r b">Total Biaya Perjalanan</td><td class="r b">${escapePrintHtml(formatCurrency(operationalSpent))}</td></tr>
                <tr><td colspan="4" class="r b">Sisa Bon Operasional</td><td class="r">${escapePrintHtml(formatCurrency(operationalBalance))}</td></tr>
                <tr><td colspan="4" class="r b">Upah Trip</td><td class="r">${escapePrintHtml(formatCurrency(driverFeeAmount))}</td></tr>
                <tr><td colspan="4" class="r b">Total Hak Trip</td><td class="r">${escapePrintHtml(formatCurrency(totalClaimAmount))}</td></tr>
                <tr><td colspan="4" class="r b">Uang Jalan Awal</td><td class="r">${escapePrintHtml(formatCurrency(initialCashGiven))}</td></tr>
                <tr><td colspan="4" class="r b">Top Up Uang Jalan</td><td class="r">${escapePrintHtml(formatCurrency(topUpAmount))}</td></tr>
                <tr><td colspan="4" class="r b">Total Uang Diberikan</td><td class="r">${escapePrintHtml(formatCurrency(totalIssuedAmount))}</td></tr>
                <tr style="border-top:2px solid #1e293b"><td colspan="4" class="r b">${escapePrintHtml(balance >= 0 ? 'Net Settlement Akhir (Kembali ke Perusahaan)' : 'Net Settlement Akhir (Tambah Bayar ke Supir)')}</td><td class="r b" style="color:${balance < 0 ? '#ef4444' : '#16a34a'}">${escapePrintHtml(formatCurrency(Math.abs(balance)))}</td></tr>
            </tbody>
        </table>
        <div style="margin-top:40px;display:flex;justify-content:space-between">
            <div style="text-align:center;width:200px"><div style="margin-bottom:60px">Supir,</div><div style="border-top:1px solid #333;padding-top:4px">(${escapePrintHtml(voucher.driverName || '________________')})</div></div>
            <div style="text-align:center;width:200px"><div style="margin-bottom:60px">Mengetahui,</div><div style="border-top:1px solid #333;padding-top:4px">(________________)</div></div>
        </div>
    `;
}
