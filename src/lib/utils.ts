/* ============================================================
   LOGISTIK — Utility Functions
   ============================================================ */

import { format, parseISO } from 'date-fns';
import { id as localeId } from 'date-fns/locale';
import { parseFormattedNumberish } from './formatted-number';

const JAKARTA_TIME_ZONE = 'Asia/Jakarta';

// ── Date formatting ──
export function formatDate(dateStr: string | undefined, fmt: string = 'dd/MM/yyyy'): string {
    if (!dateStr) return '-';
    try {
        return format(parseISO(dateStr), fmt, { locale: localeId });
    } catch {
        return dateStr;
    }
}

export function formatDateTime(dateStr: string | undefined): string {
    if (!dateStr) return '-';
    try {
        const parsed = parseISO(dateStr);
        return `${new Intl.DateTimeFormat('id-ID', {
            timeZone: JAKARTA_TIME_ZONE,
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
        }).format(parsed).replace('.', ':')} WIB`;
    } catch {
        return dateStr;
    }
}

// ── Currency formatting ──
export function formatCurrency(amount: number | string | undefined | null): string {
    if (amount === undefined || amount === null) return '-';
    const numeric = parseFormattedNumberish(amount, { maxFractionDigits: 0 });
    if (!Number.isFinite(numeric)) return '-';
    return new Intl.NumberFormat('id-ID', {
        style: 'currency',
        currency: 'IDR',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
    }).format(numeric);
}

export function formatNumber(num: number | string | undefined | null): string {
    if (num === undefined || num === null) return '-';
    const numeric = parseFormattedNumberish(num);
    if (!Number.isFinite(numeric)) return '-';
    return new Intl.NumberFormat('id-ID').format(numeric);
}

export function formatQuantity(
    value: number | string | undefined | null,
    maxFractionDigits: number = 2
): string {
    if (value === undefined || value === null || value === '') return '-';
    const numeric = parseFormattedNumberish(value, { maxFractionDigits });
    if (!Number.isFinite(numeric)) return '-';
    return new Intl.NumberFormat('id-ID', {
        minimumFractionDigits: 0,
        maximumFractionDigits: maxFractionDigits,
    }).format(numeric);
}

export function formatInternalDeliveryOrderNumber(value: {
    customerDoNumber?: string | null;
    doNumber?: string | null;
}) {
    return value.doNumber || '-';
}

export function formatShipperDeliveryOrderNumber(value: {
    customerDoNumber?: string | null;
}) {
    return value.customerDoNumber || '-';
}

export function getReceivableNetAmount(value: {
    totalAmount?: number | string | null;
    totalAdjustmentAmount?: number | string | null;
    netAmount?: number | string | null;
}) {
    const hasGrossAmount = value.totalAmount !== undefined && value.totalAmount !== null && value.totalAmount !== '';
    const grossAmount =
        hasGrossAmount
            ? Math.max(parseFormattedNumberish(value.totalAmount), 0)
            : 0;
    const adjustmentAmount =
        value.totalAdjustmentAmount !== undefined && value.totalAdjustmentAmount !== null
            ? Math.max(parseFormattedNumberish(value.totalAdjustmentAmount), 0)
            : 0;
    const storedNetAmount =
        value.netAmount !== undefined && value.netAmount !== null
            ? Math.max(parseFormattedNumberish(value.netAmount), 0)
            : undefined;

    const computedNetAmount = Math.max(grossAmount - adjustmentAmount, 0);
    if (hasGrossAmount) {
        return computedNetAmount;
    }

    return Math.max(storedNetAmount ?? computedNetAmount, 0);
}

export function deriveReceivableStatus(
    value: {
        totalAmount?: number | string | null;
        totalAdjustmentAmount?: number | string | null;
        netAmount?: number | string | null;
    },
    totalPaid?: number | string | null
): 'UNPAID' | 'PARTIAL' | 'PAID' {
    const paidAmount =
        totalPaid !== undefined && totalPaid !== null
            ? Math.max(parseFormattedNumberish(totalPaid, { maxFractionDigits: 0 }), 0)
            : 0;
    const netAmount = getReceivableNetAmount(value);

    if (paidAmount >= netAmount) return 'PAID';
    if (paidAmount > 0) return 'PARTIAL';
    return 'UNPAID';
}

export function getReceivableRemainingAmount(
    value: {
        totalAmount?: number | string | null;
        totalAdjustmentAmount?: number | string | null;
        netAmount?: number | string | null;
    },
    totalPaid?: number | string | null
) {
    const paidAmount =
        totalPaid !== undefined && totalPaid !== null
            ? Math.max(parseFormattedNumberish(totalPaid), 0)
            : 0;

    return Math.max(getReceivableNetAmount(value) - paidAmount, 0);
}

export function getDriverVoucherInitialCash(value: {
    initialCashGiven?: number | string | null;
    cashGiven?: number | string | null;
}) {
    const initialCash = parseFormattedNumberish(value.initialCashGiven ?? 0, { maxFractionDigits: 0 });
    if (Number.isFinite(initialCash) && initialCash > 0) return initialCash;
    const cashGiven = parseFormattedNumberish(value.cashGiven ?? 0, { maxFractionDigits: 0 });
    if (Number.isFinite(cashGiven) && cashGiven > 0) return cashGiven;
    return 0;
}

export function getDriverVoucherIssuedAmount(value: {
    totalIssuedAmount?: number | string | null;
    cashGiven?: number | string | null;
}) {
    const totalIssuedAmount = parseFormattedNumberish(value.totalIssuedAmount ?? 0, { maxFractionDigits: 0 });
    if (Number.isFinite(totalIssuedAmount) && totalIssuedAmount > 0) return totalIssuedAmount;
    const cashGiven = parseFormattedNumberish(value.cashGiven ?? 0, { maxFractionDigits: 0 });
    if (Number.isFinite(cashGiven) && cashGiven > 0) return cashGiven;
    return 0;
}

export function getDriverVoucherFinancialSummary(value: {
    initialCashGiven?: number | string | null;
    cashGiven?: number | string | null;
    totalIssuedAmount?: number | string | null;
    totalSpent?: number | string | null;
    driverFeeAmount?: number | string | null;
}) {
    const initialCashGiven = getDriverVoucherInitialCash(value);
    const totalIssuedAmount = getDriverVoucherIssuedAmount(value);
    const totalSpent = Math.max(parseFormattedNumberish(value.totalSpent ?? 0, { maxFractionDigits: 0 }), 0);
    const driverFeeAmount = Math.max(parseFormattedNumberish(value.driverFeeAmount ?? 0, { maxFractionDigits: 0 }), 0);
    const topUpAmount = Math.max(totalIssuedAmount - initialCashGiven, 0);
    const operationalBalance = totalIssuedAmount - totalSpent;
    const totalClaimAmount = totalSpent + driverFeeAmount;
    const balance = totalIssuedAmount - totalClaimAmount;

    return {
        initialCashGiven,
        totalIssuedAmount,
        totalSpent,
        driverFeeAmount,
        topUpAmount,
        operationalBalance,
        totalClaimAmount,
        balance,
    };
}

export function getDriverVoucherTopUpAmount(value: {
    initialCashGiven?: number | string | null;
    totalIssuedAmount?: number | string | null;
    cashGiven?: number | string | null;
}) {
    return getDriverVoucherFinancialSummary(value).topUpAmount;
}

export function getDriverVoucherOperationalBalance(value: {
    initialCashGiven?: number | string | null;
    totalIssuedAmount?: number | string | null;
    cashGiven?: number | string | null;
    totalSpent?: number | string | null;
}) {
    return getDriverVoucherFinancialSummary(value).operationalBalance;
}

// ── Status labels & colors ──
export const ORDER_STATUS_MAP: Record<string, { label: string; color: string }> = {
    OPEN: { label: 'Belum Terkirim', color: 'info' },
    PARTIAL: { label: 'Sebagian Terkirim', color: 'warning' },
    COMPLETE: { label: 'Selesai', color: 'success' },
    ON_HOLD: { label: 'Ditahan', color: 'purple' },
    CANCELLED: { label: 'Dibatalkan', color: 'danger' },
};

export const ITEM_STATUS_MAP: Record<string, { label: string; color: string }> = {
    PENDING: { label: 'Pending', color: 'gray' },
    ASSIGNED: { label: 'Dalam DO Aktif', color: 'primary' },
    ON_DELIVERY: { label: 'Dalam Pengiriman', color: 'info' },
    PARTIAL: { label: 'Sebagian Terkirim', color: 'warning' },
    DELIVERED: { label: 'Terkirim', color: 'success' },
    HOLD: { label: 'Ditahan', color: 'warning' },
    RETURNED: { label: 'Retur', color: 'danger' },
};

export const DO_STATUS_MAP: Record<string, { label: string; color: string }> = {
    CREATED: { label: 'Dibuat', color: 'gray' },
    HEADING_TO_PICKUP: { label: 'Menuju Pickup', color: 'warning' },
    ON_DELIVERY: { label: 'Dalam Pengiriman', color: 'info' },
    ARRIVED: { label: 'Tiba di Tujuan', color: 'primary' },
    DELIVERED: { label: 'Terkirim', color: 'success' },
    CANCELLED: { label: 'Dibatalkan', color: 'danger' },
    DRIVER_REQUESTED_DELIVERED: { label: 'Driver Ajukan Selesai', color: 'warning' },
    DRIVER_REQUEST_REJECTED: { label: 'Permintaan Driver Ditolak', color: 'danger' },
};

export const DO_ACTUAL_DROP_TYPE_MAP: Record<string, { label: string; color: string }> = {
    DROP: { label: 'Drop', color: 'success' },
    HOLD: { label: 'Hold / Inap', color: 'warning' },
    TRANSIT: { label: 'Transit', color: 'info' },
    EXTRA_DROP: { label: 'Extra Drop', color: 'primary' },
    RETURN: { label: 'Retur / Kembali', color: 'danger' },
};

export const INVOICE_STATUS_MAP: Record<string, { label: string; color: string }> = {
    UNPAID: { label: 'Belum Bayar', color: 'danger' },
    PARTIAL: { label: 'Sebagian', color: 'warning' },
    PAID: { label: 'Lunas', color: 'success' },
};

export const INCIDENT_STATUS_MAP: Record<string, { label: string; color: string }> = {
    OPEN: { label: 'Open', color: 'danger' },
    IN_PROGRESS: { label: 'Dalam Proses', color: 'warning' },
    RESOLVED: { label: 'Selesai', color: 'success' },
    CLOSED: { label: 'Ditutup', color: 'gray' },
};

export const MAINTENANCE_STATUS_MAP: Record<string, { label: string; color: string }> = {
    SCHEDULED: { label: 'Dijadwalkan', color: 'info' },
    DONE: { label: 'Selesai', color: 'success' },
    SKIPPED: { label: 'Dilewati', color: 'gray' },
};

export const VEHICLE_STATUS_MAP: Record<string, { label: string; color: string }> = {
    ACTIVE: { label: 'Aktif', color: 'success' },
    IN_SERVICE: { label: 'Servis', color: 'warning' },
    OUT_OF_SERVICE: { label: 'Non-Aktif', color: 'danger' },
    SOLD: { label: 'Terjual', color: 'gray' },
};

export const URGENCY_MAP: Record<string, { label: string; color: string }> = {
    LOW: { label: 'Rendah', color: 'info' },
    MEDIUM: { label: 'Sedang', color: 'warning' },
    HIGH: { label: 'Tinggi', color: 'danger' },
};

export const INCIDENT_TYPE_MAP: Record<string, string> = {
    BLOWOUT_TIRE: 'Ban Meletus',
    ENGINE_TROUBLE: 'Masalah Mesin',
    ACCIDENT_MINOR: 'Kecelakaan Ringan',
    ACCIDENT_MAJOR: 'Kecelakaan Berat',
    OTHER: 'Lainnya',
};

export const TIRE_POSITION_MAP: Record<string, string> = {
    FRONT_LEFT: 'Depan Kiri',
    FRONT_RIGHT: 'Depan Kanan',
    REAR_LEFT: 'Belakang Kiri',
    REAR_RIGHT: 'Belakang Kanan',
    SPARE: 'Cadangan',
};

export const TIRE_ASSET_STATUS_MAP: Record<string, { label: string; color: string }> = {
    IN_USE: { label: 'Terpasang', color: 'success' },
    SPARE: { label: 'Serep', color: 'info' },
    IN_WAREHOUSE: { label: 'Di Gudang', color: 'gray' },
    LOANED_OUT: { label: 'Dipinjam Keluar', color: 'warning' },
    SCRAPPED: { label: 'Afkir', color: 'danger' },
};

export const TIRE_ACTION_MAP: Record<string, string> = {
    PATCH: 'Tambal',
    REPLACE_NEW: 'Ganti Baru',
    ROTATE: 'Rotasi',
    VULCANIZE: 'Vulkanisir',
};

export const PAYMENT_METHOD_MAP: Record<string, string> = {
    TRANSFER: 'Transfer',
    CASH: 'Tunai',
    OTHER: 'Lainnya',
};

export const INVOICE_ADJUSTMENT_KIND_MAP: Record<string, string> = {
    DAMAGE_CLAIM: 'Klaim Barang Rusak',
    SHORTAGE_CLAIM: 'Klaim Barang Kurang',
    DISCOUNT: 'Diskon',
    PENALTY: 'Penalty',
    OTHER: 'Potongan Lainnya',
};

// ── Terbilang (number to Indonesian words) ──
export function terbilang(angka: number): string {
    const satuan = ['', 'satu', 'dua', 'tiga', 'empat', 'lima', 'enam', 'tujuh', 'delapan', 'sembilan', 'sepuluh', 'sebelas'];

    if (angka < 12) return satuan[angka];
    if (angka < 20) return terbilang(angka - 10) + ' belas';
    if (angka < 100) return terbilang(Math.floor(angka / 10)) + ' puluh ' + terbilang(angka % 10);
    if (angka < 200) return 'seratus ' + terbilang(angka - 100);
    if (angka < 1000) return terbilang(Math.floor(angka / 100)) + ' ratus ' + terbilang(angka % 100);
    if (angka < 2000) return 'seribu ' + terbilang(angka - 1000);
    if (angka < 1000000) return terbilang(Math.floor(angka / 1000)) + ' ribu ' + terbilang(angka % 1000);
    if (angka < 1000000000) return terbilang(Math.floor(angka / 1000000)) + ' juta ' + terbilang(angka % 1000000);
    if (angka < 1000000000000) return terbilang(Math.floor(angka / 1000000000)) + ' miliar ' + terbilang(angka % 1000000000);
    return terbilang(Math.floor(angka / 1000000000000)) + ' triliun ' + terbilang(angka % 1000000000000);
}

// ── Truncate text ──
export function truncateText(text: string, maxLength: number = 50): string {
    if (text.length <= maxLength) return text;
    return text.slice(0, maxLength) + '...';
}

// ── Generate simple ID ──
export function simpleId(): string {
    return Math.random().toString(36).substring(2, 11);
}
