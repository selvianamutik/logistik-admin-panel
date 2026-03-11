'use client';

import { useState, useEffect } from 'react';
import { useApp, useToast } from '../layout';
import {
    Package, Truck, FileText, AlertTriangle, Wrench, DollarSign,
    TrendingUp, Clock, ArrowUpRight
} from 'lucide-react';
import { formatCurrency, ORDER_STATUS_MAP, INVOICE_STATUS_MAP } from '@/lib/utils';
import Link from 'next/link';

interface DashboardData {
    orderStats: { total: number; open: number; partial: number; complete: number; onHold: number };
    doStats: { total: number; onDelivery: number };
    notaStats: { unpaid: number; totalOutstanding: number };
    boronganStats: { unpaid: number; totalOutstanding: number };
    voucherStats: { unsettled: number; totalIssued: number };
    fleetStats: { openIncidents: number; maintenanceDue: number };
    recentOrders: Array<{ _id: string; masterResi: string; customerName: string; status: string; createdAt: string }>;
    recentNotas: Array<{ _id: string; notaNumber: string; customerName: string; status: string; totalAmount: number }>;
}

export default function DashboardPage() {
    const { user } = useApp();
    const { addToast } = useToast();
    const [data, setData] = useState<DashboardData | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        async function load() {
            try {
                const res = await fetch('/api/data?entity=dashboard-summary');
                const payload = await res.json();
                if (!res.ok) {
                    throw new Error(payload.error || 'Gagal memuat dashboard');
                }

                setData(payload.data);
            } catch (err) {
                console.error('Dashboard load error:', err);
                addToast('error', err instanceof Error ? err.message : 'Gagal memuat dashboard');
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

    if (!data) return null;
    const isOwner = user?.role === 'OWNER';

    return (
        <div>
            <div className="page-header">
                <div className="page-header-left">
                    <h1 className="page-title">Dashboard</h1>
                    <p className="page-subtitle">Selamat datang, {user?.name}</p>
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
                            <div className="kpi-sub">{data.orderStats.open} open, {data.orderStats.partial} partial</div>
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
                            {isOwner && <div className="kpi-sub">{formatCurrency(data.notaStats.totalOutstanding)} outstanding</div>}
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

                <Link href="/borongan" style={{ textDecoration: 'none' }}>
                    <div className="kpi-card">
                        <div className="kpi-icon success"><DollarSign size={24} /></div>
                        <div className="kpi-content">
                            <div className="kpi-label">Borongan Belum Dibayar</div>
                            <div className="kpi-value">{data.boronganStats.unpaid}</div>
                            {isOwner && <div className="kpi-sub">{formatCurrency(data.boronganStats.totalOutstanding)} outstanding</div>}
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
                    <div className="table-wrapper">
                        <table>
                            <thead>
                                <tr>
                                    <th>Resi</th>
                                    <th>Customer</th>
                                    <th>Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                {data.recentOrders.length === 0 ? (
                                    <tr><td colSpan={3} className="text-center text-muted" style={{ padding: '2rem' }}>Belum ada order</td></tr>
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
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
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
                    <div className="table-wrapper">
                        <table>
                            <thead>
                                <tr>
                                    <th>No. Nota</th>
                                    <th>Customer</th>
                                    <th>Status</th>
                                    {isOwner && <th>Jumlah</th>}
                                </tr>
                            </thead>
                            <tbody>
                                {data.recentNotas.length === 0 ? (
                                    <tr><td colSpan={isOwner ? 4 : 3} className="text-center text-muted" style={{ padding: '2rem' }}>Belum ada nota</td></tr>
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
                                            {isOwner && <td className="font-medium">{formatCurrency(nota.totalAmount)}</td>}
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            {/* Reminders */}
            {isOwner && (
                <div className="card mt-6">
                    <div className="card-header">
                        <span className="card-header-title">Pengingat</span>
                    </div>
                    <div className="card-body">
                        <ul className="reminder-list">
                            {data.orderStats.onHold > 0 && (
                                <li className="reminder-item">
                                    <div className="reminder-icon warning"><Clock size={16} /></div>
                                    <div>
                                        <strong>{data.orderStats.onHold} order</strong> dengan status ON HOLD
                                    </div>
                                </li>
                            )}
                            {data.notaStats.unpaid > 0 && (
                                <li className="reminder-item">
                                    <div className="reminder-icon danger"><FileText size={16} /></div>
                                    <div>
                                        <strong>{data.notaStats.unpaid} nota</strong> belum lunas ({formatCurrency(data.notaStats.totalOutstanding)})
                                    </div>
                                </li>
                            )}
                            {data.boronganStats.unpaid > 0 && (
                                <li className="reminder-item">
                                    <div className="reminder-icon warning"><DollarSign size={16} /></div>
                                    <div>
                                        <strong>{data.boronganStats.unpaid} slip borongan</strong> belum dibayar ({formatCurrency(data.boronganStats.totalOutstanding)})
                                    </div>
                                </li>
                            )}
                            {data.voucherStats.unsettled > 0 && (
                                <li className="reminder-item">
                                    <div className="reminder-icon info"><DollarSign size={16} /></div>
                                    <div>
                                        <strong>{data.voucherStats.unsettled} bon supir</strong> belum settle{isOwner ? ` (${formatCurrency(data.voucherStats.totalIssued)} kas keluar)` : ''}
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
                                data.boronganStats.unpaid === 0 &&
                                data.voucherStats.unsettled === 0 &&
                                data.fleetStats.maintenanceDue === 0 &&
                                data.fleetStats.openIncidents === 0 && (
                                <li className="reminder-item">
                                    <div className="reminder-icon" style={{ background: 'var(--color-success-light)', color: 'var(--color-success)' }}>
                                        <TrendingUp size={16} />
                                    </div>
                                    <div>Semua dalam kondisi baik. Tidak ada pengingat.</div>
                                </li>
                            )}
                        </ul>
                    </div>
                </div>
            )}
        </div>
    );
}
