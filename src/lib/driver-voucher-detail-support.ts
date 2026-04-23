import { escapePrintHtml } from './print';
import type { DriverVoucher, DriverVoucherDisbursement, DriverVoucherItem } from './types';
import { getBusinessDateValue } from './business-date';
import { parseFormattedNumberish } from './formatted-number';
import { formatCurrency, formatDate, getDriverVoucherInitialCash, getDriverVoucherIssuedAmount, getDriverVoucherOperationalBalance, getDriverVoucherTopUpAmount } from './utils';
import { formatDriverVoucherRouteForDisplay } from './driver-voucher-route';

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

function getDisbursementKindSortValue(kind: DriverVoucherDisbursement['kind']) {
    return kind === 'INITIAL' ? 0 : 1;
}

export function sortDriverVoucherDisbursementsChronologically(disbursements: DriverVoucherDisbursement[]) {
    return [...disbursements].sort((a, b) => {
        const dateCompare = String(a.date || '').localeCompare(String(b.date || ''));
        if (dateCompare !== 0) return dateCompare;

        const kindCompare = getDisbursementKindSortValue(a.kind) - getDisbursementKindSortValue(b.kind);
        if (kindCompare !== 0) return kindCompare;

        return String(a._id || '').localeCompare(String(b._id || ''));
    });
}

export function sortDriverVoucherDisbursements(disbursements: DriverVoucherDisbursement[]) {
    return sortDriverVoucherDisbursementsChronologically(disbursements);
}

export function sortDriverVoucherItems(items: DriverVoucherItem[]) {
    return [...items].sort((a, b) => `${b.expenseDate || ''}-${b._id}`.localeCompare(`${a.expenseDate || ''}-${a._id}`));
}

export function formatDriverVoucherBonLabel(sequence: number) {
    if (sequence === 1) return 'Bon Pertama';
    if (sequence === 2) return 'Bon Kedua';
    if (sequence === 3) return 'Bon Ketiga';
    return `Bon Ke-${sequence}`;
}

export function getDriverVoucherDisbursementLabel(
    disbursement: DriverVoucherDisbursement,
    disbursements: DriverVoucherDisbursement[]
) {
    const ordered = sortDriverVoucherDisbursementsChronologically(disbursements);
    const index = ordered.findIndex(item => item._id === disbursement._id);
    return formatDriverVoucherBonLabel(index >= 0 ? index + 1 : 1);
}

export function buildDriverVoucherCashBreakdown(
    disbursements: DriverVoucherDisbursement[],
    summary: Pick<ReturnType<typeof buildDriverVoucherDetailSummary>, 'initialCashGiven' | 'topUpAmount'>
) {
    const ordered = sortDriverVoucherDisbursementsChronologically(disbursements);
    if (ordered.length > 0) {
        return ordered
            .map((item, index) => `${formatDriverVoucherBonLabel(index + 1)} ${formatCurrency(item.amount)}`)
            .join(' | ');
    }

    return `Bon Pertama ${formatCurrency(summary.initialCashGiven)}${summary.topUpAmount > 0 ? ` | Bon Tambahan ${formatCurrency(summary.topUpAmount)}` : ''}`;
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
    const routeLabel = formatDriverVoucherRouteForDisplay(voucher.route) || voucher.route || '-';
    const printedDisbursements = sortDriverVoucherDisbursementsChronologically(disbursements);
    const settlementDirectionLabel = balance > 0
        ? 'Driver Mengembalikan ke Perusahaan'
        : balance < 0
            ? 'Perusahaan Tambah Bayar ke Supir'
            : 'Nihil';
    const settlementColor = balance < 0 ? '#dc2626' : balance > 0 ? '#16a34a' : '#1e293b';
    const statusLabel = DRIVER_VOUCHER_STATUS_MAP[voucher.status || '']?.label || voucher.status || '-';

    const disbursementSection = printedDisbursements.length > 0 ? `
        <div style="margin-top:16px">
            <div class="section-title">Riwayat Bon / Uang Jalan</div>
            <table>
                <thead>
                    <tr><th>No</th><th>Tanggal</th><th>Jenis</th><th>Sumber Dana</th><th>Catatan</th><th class="r">Jumlah</th></tr>
                </thead>
                <tbody>
                    ${printedDisbursements.map((item, index) => `
                        <tr>
                            <td>${index + 1}</td>
                            <td>${escapePrintHtml(formatDate(item.date))}</td>
                            <td>${escapePrintHtml(formatDriverVoucherBonLabel(index + 1))}</td>
                            <td>${escapePrintHtml(item.bankAccountName || '-')}</td>
                            <td>${escapePrintHtml(item.note || '-')}</td>
                            <td class="r">${escapePrintHtml(formatCurrency(item.amount))}</td>
                        </tr>
                    `).join('')}
                    <tr style="border-top:2px solid #1e293b">
                        <td colspan="5" class="r b">Total Uang Jalan Diberikan</td>
                        <td class="r b">${escapePrintHtml(formatCurrency(totalIssuedAmount))}</td>
                    </tr>
                </tbody>
            </table>
        </div>
    ` : totalIssuedAmount > 0 ? `
        <div style="margin-top:16px">
            <div class="section-title">Riwayat Bon / Uang Jalan</div>
            <table>
                <thead>
                    <tr><th>No</th><th>Tanggal</th><th>Jenis</th><th>Sumber Dana</th><th>Catatan</th><th class="r">Jumlah</th></tr>
                </thead>
                <tbody>
                    <tr>
                        <td>1</td>
                        <td>${escapePrintHtml(formatDate(voucher.issuedDate || ''))}</td>
                        <td>Bon Pertama</td>
                        <td>${escapePrintHtml(voucher.issueBankName || '-')}</td>
                        <td>Riwayat detail belum tersedia</td>
                        <td class="r">${escapePrintHtml(formatCurrency(initialCashGiven || totalIssuedAmount))}</td>
                    </tr>
                    ${topUpAmount > 0 ? `
                        <tr>
                            <td>2</td>
                            <td>${escapePrintHtml(formatDate(voucher.issuedDate || ''))}</td>
                            <td>Bon Tambahan</td>
                            <td>${escapePrintHtml(voucher.issueBankName || '-')}</td>
                            <td>Riwayat detail belum tersedia</td>
                            <td class="r">${escapePrintHtml(formatCurrency(topUpAmount))}</td>
                        </tr>
                    ` : ''}
                    <tr style="border-top:2px solid #1e293b">
                        <td colspan="5" class="r b">Total Uang Jalan Diberikan</td>
                        <td class="r b">${escapePrintHtml(formatCurrency(totalIssuedAmount))}</td>
                    </tr>
                </tbody>
            </table>
        </div>
    ` : `
        <div style="margin-top:16px">
            <div class="section-title">Riwayat Bon / Uang Jalan</div>
            <div style="border:1px solid #e2e8f0;background:#f8fafc;border-radius:8px;padding:10px 12px;color:#64748b">
                Belum ada riwayat pencairan uang jalan.
            </div>
        </div>
    `;

    const expenseSection = items.length > 0 ? `
        <div style="margin-top:16px">
            <div class="section-title">Biaya Lain-lain Aktual</div>
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
                    <tr style="border-top:2px solid #1e293b">
                        <td colspan="4" class="r b">Total Biaya Lain-lain</td>
                        <td class="r b">${escapePrintHtml(formatCurrency(operationalSpent))}</td>
                    </tr>
                </tbody>
            </table>
        </div>
    ` : `
        <div style="margin-top:16px">
            <div class="section-title">Biaya Lain-lain Aktual</div>
            <div style="border:1px solid #e2e8f0;background:#f8fafc;border-radius:8px;padding:10px 12px;color:#64748b">
                Belum ada biaya lain-lain aktual yang dicatat.
            </div>
        </div>
    `;

    return `
        <div class="stats-row" style="margin-bottom:16px">
            <div class="stat-box">
                <div class="stat-label">Total Bon Diberikan</div>
                <div class="stat-value">${escapePrintHtml(formatCurrency(totalIssuedAmount))}</div>
            </div>
            <div class="stat-box">
                <div class="stat-label">Biaya Lain-lain</div>
                <div class="stat-value d">${escapePrintHtml(formatCurrency(operationalSpent))}</div>
            </div>
            <div class="stat-box">
                <div class="stat-label">Upah Borongan</div>
                <div class="stat-value">${escapePrintHtml(formatCurrency(driverFeeAmount))}</div>
            </div>
            <div class="stat-box">
                <div class="stat-label">Net Settlement</div>
                <div class="stat-value" style="color:${settlementColor}">${escapePrintHtml(formatCurrency(Math.abs(balance)))}</div>
            </div>
        </div>

        <div class="section-title">Informasi Trip</div>
        <div style="margin-bottom:12px">
            <table style="width:100%;border:none;margin-top:0">
                <tbody>
                    <tr><td style="border:none;padding:2px 8px;width:130px;font-weight:600">No. Bon</td><td style="border:none;padding:2px 8px">${escapePrintHtml(voucher.bonNumber)}</td><td style="border:none;padding:2px 8px;width:130px;font-weight:600">Tanggal</td><td style="border:none;padding:2px 8px">${escapePrintHtml(formatDate(voucher.issuedDate || ''))}</td></tr>
                    <tr><td style="border:none;padding:2px 8px;font-weight:600">Supir</td><td style="border:none;padding:2px 8px">${escapePrintHtml(voucher.driverName || '-')}</td><td style="border:none;padding:2px 8px;font-weight:600">Kendaraan</td><td style="border:none;padding:2px 8px">${escapePrintHtml(voucher.vehiclePlate || '-')}</td></tr>
                    <tr><td style="border:none;padding:2px 8px;font-weight:600">No. DO Internal</td><td style="border:none;padding:2px 8px">${escapePrintHtml(voucher.doNumber || '-')}</td><td style="border:none;padding:2px 8px;font-weight:600">Rute</td><td style="border:none;padding:2px 8px">${escapePrintHtml(routeLabel)}</td></tr>
                    <tr><td style="border:none;padding:2px 8px;font-weight:600">Status</td><td style="border:none;padding:2px 8px">${escapePrintHtml(statusLabel)}</td><td style="border:none;padding:2px 8px;font-weight:600">Rekening Sumber</td><td style="border:none;padding:2px 8px">${escapePrintHtml(voucher.issueBankName || '-')}</td></tr>
                    <tr><td style="border:none;padding:2px 8px;font-weight:600">Rekening Settlement</td><td style="border:none;padding:2px 8px">${escapePrintHtml(voucher.settlementBankName || '-')}</td><td style="border:none;padding:2px 8px;font-weight:600">Catatan</td><td style="border:none;padding:2px 8px">${escapePrintHtml(voucher.notes || '-')}</td></tr>
                </tbody>
            </table>
        </div>
        ${disbursementSection}
        ${expenseSection}
        <div style="margin-top:16px">
            <div class="section-title">Ringkasan Settlement</div>
            <table>
            <tbody>
                <tr><td class="b">Bon Pertama</td><td class="r">${escapePrintHtml(formatCurrency(initialCashGiven))}</td></tr>
                <tr><td class="b">Bon Tambahan</td><td class="r">${escapePrintHtml(formatCurrency(topUpAmount))}</td></tr>
                <tr style="border-top:2px solid #1e293b"><td class="b">Total Uang Jalan Diberikan</td><td class="r b">${escapePrintHtml(formatCurrency(totalIssuedAmount))}</td></tr>
                <tr><td>Dikurangi Biaya Lain-lain Aktual</td><td class="r">(${escapePrintHtml(formatCurrency(operationalSpent))})</td></tr>
                <tr><td>Sisa Bon Operasional</td><td class="r">${escapePrintHtml(formatCurrency(operationalBalance))}</td></tr>
                <tr><td>Dikurangi Upah Borongan</td><td class="r">(${escapePrintHtml(formatCurrency(driverFeeAmount))})</td></tr>
                <tr><td>Total Dipertanggungjawabkan + Upah</td><td class="r">${escapePrintHtml(formatCurrency(totalClaimAmount))}</td></tr>
                <tr style="border-top:2px solid #1e293b">
                    <td class="b">${escapePrintHtml(settlementDirectionLabel)}</td>
                    <td class="r b" style="color:${settlementColor}">${escapePrintHtml(formatCurrency(Math.abs(balance)))}</td>
                </tr>
            </tbody>
            </table>
        </div>
        <div style="margin-top:40px;display:flex;justify-content:space-between">
            <div style="text-align:center;width:200px"><div style="margin-bottom:60px">Supir,</div><div style="border-top:1px solid #333;padding-top:4px">(${escapePrintHtml(voucher.driverName || '________________')})</div></div>
            <div style="text-align:center;width:200px"><div style="margin-bottom:60px">Mengetahui,</div><div style="border-top:1px solid #333;padding-top:4px">(________________)</div></div>
        </div>
    `;
}
