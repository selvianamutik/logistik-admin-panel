import { getReceivableNetAmount } from './utils';
import { parseFormattedNumberish } from './formatted-number';

export interface DashboardData {
    orderStats: { total: number; open: number; partial: number; complete: number; onHold: number };
    doStats: { total: number; onDelivery: number };
    notaStats: { unpaid: number; totalOutstanding: number };
    boronganStats: { unpaid: number; totalOutstanding: number };
    voucherStats: { unsettled: number; totalIssued: number };
    fleetStats: { openIncidents: number; maintenanceDue: number };
    recentOrders: Array<{ _id: string; masterResi: string; customerName: string; status: string; createdAt: string }>;
    recentNotas: Array<{
        _id: string;
        notaNumber: string;
        customerName: string;
        status: string;
        totalAmount: number;
        totalAdjustmentAmount?: number;
        pph23Enabled?: boolean;
        pph23RatePercent?: number;
        pph23BaseMode?: 'BEFORE_CLAIM' | 'AFTER_CLAIM';
        pph23Amount?: number;
        netAmount?: number;
    }>;
}

export function getRecentOrderAction(status: string) {
    switch (status) {
        case 'OPEN':
            return 'Buat trip pertama';
        case 'PARTIAL':
            return 'Lanjutkan sisa pengiriman';
        case 'ON_HOLD':
            return 'Cek alasan hold';
        case 'COMPLETE':
            return 'Siap ditagih / arsip';
        default:
            return 'Buka detail order';
    }
}

export function getRecentNotaAction(nota: DashboardData['recentNotas'][number]) {
    if (nota.status === 'UNPAID') return 'Tagih atau catat penerimaan';
    if (nota.status === 'PARTIAL') return 'Follow up sisa pembayaran invoice';
    return parseFormattedNumberish(nota.totalAdjustmentAmount || 0, { maxFractionDigits: 0 }) > 0
        ? 'Arsip + cek potongan invoice'
        : 'Arsip / cetak';
}

export function getDashboardNotaNetAmount(nota: DashboardData['recentNotas'][number]) {
    return getReceivableNetAmount(nota);
}
