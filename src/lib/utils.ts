/* ============================================================
   LOGISTIK — Utility Functions
   ============================================================ */

import { format, parseISO } from 'date-fns';
import { id as localeId } from 'date-fns/locale';

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
        return format(parseISO(dateStr), 'dd/MM/yyyy HH:mm', { locale: localeId });
    } catch {
        return dateStr;
    }
}

// ── Currency formatting ──
export function formatCurrency(amount: number | undefined): string {
    if (amount === undefined || amount === null) return '-';
    return new Intl.NumberFormat('id-ID', {
        style: 'currency',
        currency: 'IDR',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
    }).format(amount);
}

export function formatNumber(num: number | undefined): string {
    if (num === undefined || num === null) return '-';
    return new Intl.NumberFormat('id-ID').format(num);
}

// ── Status labels & colors ──
export const ORDER_STATUS_MAP: Record<string, { label: string; color: string }> = {
    OPEN: { label: 'Open', color: 'info' },
    PARTIAL: { label: 'Partial', color: 'warning' },
    COMPLETE: { label: 'Selesai', color: 'success' },
    ON_HOLD: { label: 'Ditahan', color: 'purple' },
    CANCELLED: { label: 'Dibatalkan', color: 'danger' },
};

export const ITEM_STATUS_MAP: Record<string, { label: string; color: string }> = {
    PENDING: { label: 'Pending', color: 'gray' },
    ON_DELIVERY: { label: 'Dikirim', color: 'info' },
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
