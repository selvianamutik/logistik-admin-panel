'use client';

import { useState, useEffect } from 'react';
import { useApp, useToast } from '../layout';
import {
    Package, Truck, FileText, AlertTriangle, Wrench, DollarSign,
    TrendingUp, Clock, ArrowUpRight
} from 'lucide-react';
import { formatCurrency, formatDate, getReceivableNetAmount, ORDER_STATUS_MAP, INVOICE_STATUS_MAP } from '@/lib/utils';
import Link from 'next/link';

interface DashboardData {
    orderStats: { total: number; open: number; partial: number; complete: number; onHold: number };
    doStats: { total: number; onDelivery: number };
    notaStats: { unpaid: number; totalOutstanding: number };
    boronganStats: { unpaid: number; totalOutstanding: number };
    voucherStats: { unsettled: number; totalIssued: number };
    fleetStats: { openIncidents: number; maintenanceDue: number };
    recentOrders: Array<{ _id: string; masterResi: string; customerName: string; status: string; createdAt: string }>;
    recentNotas: Array<{ _id: string; notaNumber: string; customerName: string; status: string; totalAmount: number; totalAdjustmentAmount?: number; netAmount?: number }>;
}

const getRecentOrderAction = (status: string) => {
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
};

const getRecentNotaAction = (nota: DashboardData['recentNotas'][number]) => {
    if (nota.status === 'UNPAID') return 'Tagih atau catat receipt';
    if (nota.status === 'PARTIAL') return 'Follow up sisa pembayaran';
    return (nota.totalAdjustmentAmount || 0) > 0 ? 'Arsip + cek potongan' : 'Arsip / cetak';
};

export default function DashboardPage() {
    const { user } = useApp();
    const { addToast } = useToast();
    const [data, setData] = useState<DashboardData | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);

    useEffect(() => {
        async function load() {
            setLoading(true);
            setLoadError(null);
            try {
                const res = await fetch('/api/data?entity=dashboard-summary');
                const payload = await res.json();
                if (!res.ok) {
                    throw new Error(payload.error || 'Gagal memuat dashboard');
                }

                setData(payload.data);
            } catch (err) {
                console.error('Dashboard load error:', err);
                const message = err instanceof Error ? err.message : 'Gagal memuat dashboard';
                setLoadError(message);
                addToast('error', message);
            } finally {
                setLoading(false);
            }
        }
        void load();
    }, [addToast]);

    if (loading) {
        return (
            <div>
                <div className="page-header">
                    <div className="page-header-left">
                        <div className="skeleton skeleton-title" />
                        <div className="skeleton skeleton-text short" />
                    </div>
                </div>
                <div className="kpi-grid">
                    {[1, 2, 3, 4, 5, 6].map(i => <div key={i} className="skeleton skeleton-card" />)}
                </div>
            </div>
        );
    }

    if (!data) {
        return (
            <div>
                <div className="page-header">
                    <div className="page-header-left">
                        <h1 className="page-title">Dashboard</h1>
                        <p className="page-subtitle">Ringkasan operasional harian dan tindak lanjut utama.</p>
                    </div>
                </div>
                <div className="card">
                    <div className="card-body" style={{ display: 'grid', gap: '0.9rem' }}>
                        <div style={{ fontWeight: 600 }}>Dashboard belum bisa dimuat</div>
                        <div className="text-muted">{loadError || 'Terjadi gangguan saat memuat ringkasan dashboard.'}</div>
                        <div>
                            <button
                                type="button"
                                className="btn btn-primary"
                                onClick={() => window.location.reload()}
                            >
                                Coba Muat Ulang
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        );
    }
    const isOwner = user?.role === 'OWNER';

    return (
        <div>
            <div className="page-header">
                <div className="page-header-left">
                    <h1 className="page-title">Dashboard</h1>
                    <p className="page-subtitle">Pantau order, pengiriman, piutang, armada, dan kas yang perlu ditindaklanjuti hari ini.</p>
                </div>
            </div>

            <div style={{ background: 'var(--color-gray-50)', borderRadius: '0.75rem', padding: '1rem 1.1rem', border: '1px solid var(--color-gray-200)', marginBottom: 'var(--space-6)' }}>
                <div style={{ fontWeight: 600, marginBottom: '0.35rem' }}>Cara baca dashboard ini</div>
                <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                    Halaman ini bukan laporan lengkap. Fokuskan dulu ke kartu yang angkanya masih tinggi, lalu buka daftar terkait untuk menindaklanjuti order, trip, tagihan, atau armada yang perlu perhatian hari ini.
                </div>
            </div>

            {/* KPI Cards */}
            <div className="kpi-grid">
                <Link href="/orders" style={{ textDecoration: 'none' }}>
                    <div className="kpi-card">
                        <div className="kpi-icon primary"><Package size={24} /></div>
                        <div className="kpi-content">
                            <div className="kpi-label">Total Order</div>
                            <div className="kpi-value">{data.orderStats.total}</div>
                            <div className="kpi-sub">{data.orderStats.open} belum terkirim, {data.orderStats.partial} sebagian terkirim</div>
                        </div>
                    </div>
                </Link>

                <Link href="/delivery-orders" style={{ textDecoration: 'none' }}>
                    <div className="kpi-card">
                        <div className="kpi-icon info"><Truck size={24} /></div>
                        <div className="kpi-content">
                            <div className="kpi-label">DO Dalam Pengiriman</div>
                            <div className="kpi-value">{data.doStats.onDelivery}</div>
                            <div className="kpi-sub">{data.doStats.total} total surat jalan</div>
                        </div>
                    </div>
                </Link>

                <Link href="/invoices" style={{ textDecoration: 'none' }}>
                    <div className="kpi-card">
                        <div className="kpi-icon warning"><FileText size={24} /></div>
                        <div className="kpi-content">
                            <div className="kpi-label">Nota Belum Lunas</div>
                            <div className="kpi-value">{data.notaStats.unpaid}</div>
                            {isOwner && <div className="kpi-sub">{formatCurrency(data.notaStats.totalOutstanding)} piutang aktif</div>}
                        </div>
                    </div>
                </Link>

                <Link href="/fleet/incidents" style={{ textDecoration: 'none' }}>
                    <div className="kpi-card">
                        <div className="kpi-icon danger"><AlertTriangle size={24} /></div>
                        <div className="kpi-content">
                            <div className="kpi-label">Insiden Open</div>
                            <div className="kpi-value">{data.fleetStats.openIncidents}</div>
                            <div className="kpi-sub">Perlu penanganan</div>
                        </div>
                    </div>
                </Link>

                <Link href="/fleet/maintenance" style={{ textDecoration: 'none' }}>
                    <div className="kpi-card">
                        <div className="kpi-icon info"><Wrench size={24} /></div>
                        <div className="kpi-content">
                            <div className="kpi-label">Servis Due</div>
                            <div className="kpi-value">{data.fleetStats.maintenanceDue}</div>
                            <div className="kpi-sub">Maintenance terjadwal</div>
                        </div>
                    </div>
                </Link>

                <Link href="/driver-vouchers" style={{ textDecoration: 'none' }}>
                    <div className="kpi-card">
                        <div className="kpi-icon success"><DollarSign size={24} /></div>
                        <div className="kpi-content">
                            <div className="kpi-label">Uang Jalan Trip Belum Settle</div>
                            <div className="kpi-value">{data.voucherStats.unsettled}</div>
                            {isOwner && <div className="kpi-sub">{formatCurrency(data.voucherStats.totalIssued)} uang jalan dicairkan</div>}
                        </div>
                    </div>
                </Link>
            </div>

            {/* Tables */}
            <div className="chart-grid">
                {/* Recent Orders */}
                <div className="card">
                    <div className="card-header">
                        <span className="card-header-title">Order Terbaru</span>
                        <Link href="/orders" className="btn btn-ghost btn-sm">
                            Lihat Semua <ArrowUpRight size={14} />
                        </Link>
                    </div>
                    <div className="table-wrapper table-desktop-only">
                        <table>
                            <thead>
                                <tr>
                                    <th>Resi</th>
                                    <th>Customer</th>
                                    <th>Status</th>
                                    <th>Tindak Lanjut</th>
                                </tr>
                            </thead>
                            <tbody>
                                {data.recentOrders.length === 0 ? (
                                    <tr><td colSpan={4} className="text-center text-muted" style={{ padding: '2rem' }}>Belum ada order</td></tr>
                                ) : (
                                    data.recentOrders.map(order => (
                                        <tr key={order._id}>
                                            <td>
                                                <Link href={`/orders/${order._id}`} className="font-medium">{order.masterResi}</Link>
                                            </td>
                                            <td>{order.customerName}</td>
                                            <td>
                                                <span className={`badge badge-${ORDER_STATUS_MAP[order.status]?.color || 'gray'}`}>
                                                    {ORDER_STATUS_MAP[order.status]?.label || order.status}
                                                </span>
                                            </td>
                                            <td>{getRecentOrderAction(order.status)}</td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                    <div className="mobile-record-list">
                        {data.recentOrders.length === 0 ? (
                            <div className="mobile-record-card">
                                <div className="mobile-record-title">Belum ada order</div>
                                <div className="mobile-record-subtitle">Order baru akan muncul di sini untuk dipantau cepat.</div>
                            </div>
                        ) : (
                            data.recentOrders.map(order => (
                                <div key={order._id} className="mobile-record-card">
                                    <div className="mobile-record-header">
                                        <div>
                                            <div className="mobile-record-title">{order.masterResi}</div>
                                            <div className="mobile-record-subtitle">{order.customerName} | {formatDate(order.createdAt)}</div>
                                        </div>
                                        <span className={`badge badge-${ORDER_STATUS_MAP[order.status]?.color || 'gray'}`}>
                                            {ORDER_STATUS_MAP[order.status]?.label || order.status}
                                        </span>
                                    </div>
                                    <div className="mobile-record-actions">
                                        <div className="mobile-record-kv" style={{ width: '100%' }}>
                                            <span className="mobile-record-label">Tindak Lanjut</span>
                                            <span className="mobile-record-value">{getRecentOrderAction(order.status)}</span>
                                        </div>
                                        <Link href={`/orders/${order._id}`} className="btn btn-sm btn-secondary">
                                            Lihat Detail
                                        </Link>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>

                {/* Recent Notas */}
                <div className="card">
                    <div className="card-header">
                        <span className="card-header-title">Nota Terbaru</span>
                        <Link href="/invoices" className="btn btn-ghost btn-sm">
                            Lihat Semua <ArrowUpRight size={14} />
                        </Link>
                    </div>
                    <div className="table-wrapper table-desktop-only">
                        <table>
                            <thead>
                                <tr>
                                    <th>No. Nota</th>
                                    <th>Customer</th>
                                    <th>Status</th>
                                    <th>Tindak Lanjut</th>
                                    {isOwner && <th>Jumlah</th>}
                                </tr>
                            </thead>
                            <tbody>
                                {data.recentNotas.length === 0 ? (
                                    <tr><td colSpan={isOwner ? 5 : 4} className="text-center text-muted" style={{ padding: '2rem' }}>Belum ada nota</td></tr>
                                ) : (
                                    data.recentNotas.map(nota => (
                                        <tr key={nota._id}>
                                            <td>
                                                <Link href={`/invoices/${nota._id}`} className="font-medium">{nota.notaNumber}</Link>
                                            </td>
                                            <td>{nota.customerName}</td>
                                            <td>
                                                <span className={`badge badge-${INVOICE_STATUS_MAP[nota.status]?.color || 'gray'}`}>
                                                    {INVOICE_STATUS_MAP[nota.status]?.label || nota.status}
                                                </span>
                                            </td>
                                            <td>{getRecentNotaAction(nota)}</td>
                                            {isOwner && <td className="font-medium">{formatCurrency(getReceivableNetAmount(nota))}</td>}
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                    <div className="mobile-record-list">
                        {data.recentNotas.length === 0 ? (
                            <div className="mobile-record-card">
                                <div className="mobile-record-title">Belum ada nota</div>
                                <div className="mobile-record-subtitle">Nota ongkos terbaru akan muncul di sini.</div>
                            </div>
                        ) : (
                            data.recentNotas.map(nota => (
                                <div key={nota._id} className="mobile-record-card">
                                    <div className="mobile-record-header">
                                        <div>
                                            <div className="mobile-record-title">{nota.notaNumber}</div>
                                            <div className="mobile-record-subtitle">{nota.customerName}</div>
                                        </div>
                                        <span className={`badge badge-${INVOICE_STATUS_MAP[nota.status]?.color || 'gray'}`}>
                                            {INVOICE_STATUS_MAP[nota.status]?.label || nota.status}
                                        </span>
                                    </div>
                                    {isOwner && (
                                        <div className="mobile-record-meta">
                                            <div className="mobile-record-kv">
                                                <span className="mobile-record-label">Tagihan Netto</span>
                                                <span className="mobile-record-value">{formatCurrency(getReceivableNetAmount(nota))}</span>
                                            </div>
                                        </div>
                                    )}
                                    <div className="mobile-record-meta">
                                        <div className="mobile-record-kv">
                                            <span className="mobile-record-label">Tindak Lanjut</span>
                                            <span className="mobile-record-value">{getRecentNotaAction(nota)}</span>
                                        </div>
                                    </div>
                                    <div className="mobile-record-actions">
                                        <Link href={`/invoices/${nota._id}`} className="btn btn-sm btn-secondary">
                                            Lihat Detail
                                        </Link>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </div>

            {/* Reminders */}
            {isOwner && (
                <div className="card mt-6">
                    <div className="card-header">
                        <span className="card-header-title">Tindak Lanjut Hari Ini</span>
                    </div>
                    <div className="card-body">
                        <ul className="reminder-list">
                            {data.orderStats.onHold > 0 && (
                                <li className="reminder-item">
                                    <div className="reminder-icon warning"><Clock size={16} /></div>
                                    <div>
                                        <strong>{data.orderStats.onHold} order</strong> masih tertahan dan perlu keputusan lanjut
                                    </div>
                                </li>
                            )}
                            {data.notaStats.unpaid > 0 && (
                                <li className="reminder-item">
                                    <div className="reminder-icon danger"><FileText size={16} /></div>
                                    <div>
                                        <strong>{data.notaStats.unpaid} nota</strong> masih menunggu pelunasan ({formatCurrency(data.notaStats.totalOutstanding)})
                                    </div>
                                </li>
                            )}
                            {data.voucherStats.unsettled > 0 && (
                                <li className="reminder-item">
                                    <div className="reminder-icon info"><DollarSign size={16} /></div>
                                    <div>
                                        <strong>{data.voucherStats.unsettled} trip</strong> masih menunggu settlement uang jalan{isOwner ? ` (${formatCurrency(data.voucherStats.totalIssued)} sudah dicairkan)` : ''}
                                    </div>
                                </li>
                            )}
                            {data.fleetStats.maintenanceDue > 0 && (
                                <li className="reminder-item">
                                    <div className="reminder-icon info"><Wrench size={16} /></div>
                                    <div>
                                        <strong>{data.fleetStats.maintenanceDue} kendaraan</strong> perlu servis
                                    </div>
                                </li>
                            )}
                            {data.fleetStats.openIncidents > 0 && (
                                <li className="reminder-item">
                                    <div className="reminder-icon danger"><AlertTriangle size={16} /></div>
                                    <div>
                                        <strong>{data.fleetStats.openIncidents} insiden</strong> masih terbuka
                                    </div>
                                </li>
                            )}
                            {data.orderStats.onHold === 0 &&
                                data.notaStats.unpaid === 0 &&
                                data.voucherStats.unsettled === 0 &&
                                data.fleetStats.maintenanceDue === 0 &&
                                data.fleetStats.openIncidents === 0 && (
                                <li className="reminder-item">
                                    <div className="reminder-icon" style={{ background: 'var(--color-success-light)', color: 'var(--color-success)' }}>
                                        <TrendingUp size={16} />
                                    </div>
                                    <div>Operasional cukup aman. Tidak ada tindak lanjut mendesak saat ini.</div>
                                </li>
                            )}
                        </ul>
                    </div>
                </div>
            )}
        </div>
    );
}
