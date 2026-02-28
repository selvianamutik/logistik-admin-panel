'use client';

import { useState, useEffect } from 'react';
import { useApp } from '../layout';
import {
    Package, Truck, FileText, AlertTriangle, Wrench, DollarSign,
    TrendingUp, Clock, BarChart3, ArrowUpRight
} from 'lucide-react';
import { formatCurrency, ORDER_STATUS_MAP, INVOICE_STATUS_MAP, INCIDENT_STATUS_MAP } from '@/lib/utils';
import Link from 'next/link';

interface DashboardData {
    orderStats: { total: number; open: number; partial: number; complete: number; onHold: number };
    doStats: { total: number; onDelivery: number };
    invoiceStats: { unpaid: number; totalOutstanding: number };
    fleetStats: { openIncidents: number; maintenanceDue: number };
    recentOrders: Array<{ _id: string; masterResi: string; customerName: string; status: string; createdAt: string }>;
    recentInvoices: Array<{ _id: string; invoiceNumber: string; customerName: string; status: string; totalAmount: number }>;
    expenses: { total: number };
    income: { total: number };
}

export default function DashboardPage() {
    const { user } = useApp();
    const [data, setData] = useState<DashboardData | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        async function load() {
            try {
                const [ordersRes, dosRes, invoicesRes, incidentsRes, maintsRes, expensesRes, incomesRes] = await Promise.all([
                    fetch('/api/data?entity=orders'),
                    fetch('/api/data?entity=delivery-orders'),
                    fetch('/api/data?entity=invoices'),
                    fetch('/api/data?entity=incidents'),
                    fetch('/api/data?entity=maintenances'),
                    fetch('/api/data?entity=expenses'),
                    fetch('/api/data?entity=incomes'),
                ]);

                const orders = (await ordersRes.json()).data || [];
                const dos = (await dosRes.json()).data || [];
                const invoices = (await invoicesRes.json()).data || [];
                const incidents = (await incidentsRes.json()).data || [];
                const maints = (await maintsRes.json()).data || [];
                const expenses = (await expensesRes.json()).data || [];
                const incomes = (await incomesRes.json()).data || [];

                setData({
                    orderStats: {
                        total: orders.length,
                        open: orders.filter((o: { status: string }) => o.status === 'OPEN').length,
                        partial: orders.filter((o: { status: string }) => o.status === 'PARTIAL').length,
                        complete: orders.filter((o: { status: string }) => o.status === 'COMPLETE').length,
                        onHold: orders.filter((o: { status: string }) => o.status === 'ON_HOLD').length,
                    },
                    doStats: {
                        total: dos.length,
                        onDelivery: dos.filter((d: { status: string }) => d.status === 'ON_DELIVERY').length,
                    },
                    invoiceStats: {
                        unpaid: invoices.filter((i: { status: string }) => i.status !== 'PAID').length,
                        totalOutstanding: invoices.filter((i: { status: string }) => i.status !== 'PAID')
                            .reduce((sum: number, i: { totalAmount: number }) => sum + (i.totalAmount || 0), 0),
                    },
                    fleetStats: {
                        openIncidents: incidents.filter((i: { status: string }) => i.status === 'OPEN' || i.status === 'IN_PROGRESS').length,
                        maintenanceDue: maints.filter((m: { status: string }) => m.status === 'SCHEDULED').length,
                    },
                    recentOrders: orders.slice(-5).reverse(),
                    recentInvoices: invoices.slice(-5).reverse(),
                    expenses: { total: expenses.reduce((sum: number, e: { amount: number }) => sum + e.amount, 0) },
                    income: { total: incomes.reduce((sum: number, i: { amount: number }) => sum + i.amount, 0) },
                });
            } catch (err) {
                console.error('Dashboard load error:', err);
            }
            setLoading(false);
        }
        load();
    }, []);

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
                            <div className="kpi-label">Invoice Belum Lunas</div>
                            <div className="kpi-value">{data.invoiceStats.unpaid}</div>
                            {isOwner && <div className="kpi-sub">{formatCurrency(data.invoiceStats.totalOutstanding)} outstanding</div>}
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

                {isOwner && (
                    <div className="kpi-card">
                        <div className="kpi-icon success"><DollarSign size={24} /></div>
                        <div className="kpi-content">
                            <div className="kpi-label">Pendapatan vs Pengeluaran</div>
                            <div className="kpi-value" style={{ fontSize: '1.125rem' }}>
                                <span style={{ color: 'var(--color-success)' }}>{formatCurrency(data.income.total)}</span>
                            </div>
                            <div className="kpi-sub" style={{ color: 'var(--color-danger)' }}>
                                Pengeluaran: {formatCurrency(data.expenses.total)}
                            </div>
                        </div>
                    </div>
                )}
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

                {/* Recent Invoices */}
                <div className="card">
                    <div className="card-header">
                        <span className="card-header-title">Invoice Terbaru</span>
                        <Link href="/invoices" className="btn btn-ghost btn-sm">
                            Lihat Semua <ArrowUpRight size={14} />
                        </Link>
                    </div>
                    <div className="table-wrapper">
                        <table>
                            <thead>
                                <tr>
                                    <th>No. Invoice</th>
                                    <th>Customer</th>
                                    <th>Status</th>
                                    {isOwner && <th>Jumlah</th>}
                                </tr>
                            </thead>
                            <tbody>
                                {data.recentInvoices.length === 0 ? (
                                    <tr><td colSpan={isOwner ? 4 : 3} className="text-center text-muted" style={{ padding: '2rem' }}>Belum ada invoice</td></tr>
                                ) : (
                                    data.recentInvoices.map(inv => (
                                        <tr key={inv._id}>
                                            <td>
                                                <Link href={`/invoices/${inv._id}`} className="font-medium">{inv.invoiceNumber}</Link>
                                            </td>
                                            <td>{inv.customerName}</td>
                                            <td>
                                                <span className={`badge badge-${INVOICE_STATUS_MAP[inv.status]?.color || 'gray'}`}>
                                                    {INVOICE_STATUS_MAP[inv.status]?.label || inv.status}
                                                </span>
                                            </td>
                                            {isOwner && <td className="font-medium">{formatCurrency(inv.totalAmount)}</td>}
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
                            {data.invoiceStats.unpaid > 0 && (
                                <li className="reminder-item">
                                    <div className="reminder-icon danger"><FileText size={16} /></div>
                                    <div>
                                        <strong>{data.invoiceStats.unpaid} invoice</strong> belum lunas ({formatCurrency(data.invoiceStats.totalOutstanding)})
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
                            {data.orderStats.onHold === 0 && data.invoiceStats.unpaid === 0 && data.fleetStats.maintenanceDue === 0 && data.fleetStats.openIncidents === 0 && (
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
