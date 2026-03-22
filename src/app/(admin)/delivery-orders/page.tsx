'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Search, Eye, Truck, FileDown, Printer } from 'lucide-react';
import { formatDate, formatDateTime, DO_STATUS_MAP, formatDeliveryOrderDisplayNumber } from '@/lib/utils';
import { exportToExcel } from '@/lib/export';
import { openBrandedPrint, fetchCompanyProfile } from '@/lib/print';
import type { DeliveryOrder, Service } from '@/lib/types';
import { useToast } from '../layout';

const DO_ACTION_PRIORITY: Record<string, number> = {
    ARRIVED: 0,
    ON_DELIVERY: 1,
    HEADING_TO_PICKUP: 2,
    CREATED: 3,
    DELIVERED: 4,
    CANCELLED: 5,
};

export default function DeliveryOrdersPage() {
    const router = useRouter();
    const { addToast } = useToast();
    const [items, setItems] = useState<DeliveryOrder[]>([]);
    const [services, setServices] = useState<Service[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState('');
    const [serviceFilter, setServiceFilter] = useState('');

    useEffect(() => {
        const loadDeliveryOrders = async () => {
            try {
                const res = await fetch('/api/data?entity=delivery-orders');
                const payload = await res.json();
                if (!res.ok) {
                    throw new Error(payload.error || 'Gagal memuat surat jalan');
                }
                setItems(payload.data || []);
                const serviceRes = await fetch('/api/data?entity=services');
                const servicePayload = await serviceRes.json();
                if (!serviceRes.ok) {
                    throw new Error(servicePayload.error || 'Gagal memuat kategori armada');
                }
                setServices(servicePayload.data || []);
            } catch (error) {
                addToast('error', error instanceof Error ? error.message : 'Gagal memuat surat jalan');
            } finally {
                setLoading(false);
            }
        };

        void loadDeliveryOrders();
    }, [addToast]);

    const getRequestedServiceLabel = (deliveryOrder: DeliveryOrder) => {
        const service = services.find(item => item._id === deliveryOrder.serviceRef);
        if (service) {
            return `${service.code} - ${service.name}`;
        }
        return deliveryOrder.serviceName || '-';
    };

    const getActualServiceLabel = (deliveryOrder: DeliveryOrder) => {
        if (deliveryOrder.vehicleServiceRef) {
            const service = services.find(item => item._id === deliveryOrder.vehicleServiceRef);
            if (service) {
                return `${service.code} - ${service.name}`;
            }
        }
        return deliveryOrder.vehicleServiceName || getRequestedServiceLabel(deliveryOrder);
    };

    const getServiceLabel = (deliveryOrder: DeliveryOrder) => {
        const requested = getRequestedServiceLabel(deliveryOrder);
        const actual = getActualServiceLabel(deliveryOrder);
        if (deliveryOrder.vehicleCategoryOverrideReason && actual !== requested) {
            return `${requested} -> ${actual}`;
        }
        return requested;
    };

    const availableServiceOptions = services.filter(service =>
        service.active !== false || items.some(deliveryOrder => deliveryOrder.serviceRef === service._id)
    );

    const filtered = items.filter(d => {
        const service = services.find(item => item._id === d.serviceRef);
        const m = !search
            || d.doNumber?.toLowerCase().includes(search.toLowerCase())
            || d.customerDoNumber?.toLowerCase().includes(search.toLowerCase())
            || d.customerName?.toLowerCase().includes(search.toLowerCase())
            || d.vehiclePlate?.toLowerCase().includes(search.toLowerCase())
            || d.driverName?.toLowerCase().includes(search.toLowerCase())
            || d.serviceName?.toLowerCase().includes(search.toLowerCase())
            || d.vehicleServiceName?.toLowerCase().includes(search.toLowerCase())
            || d.vehicleCategoryOverrideReason?.toLowerCase().includes(search.toLowerCase())
            || (d.actualDropPoints || []).some(point =>
                point.locationName?.toLowerCase().includes(search.toLowerCase())
                || point.locationAddress?.toLowerCase().includes(search.toLowerCase())
            )
            || service?.code?.toLowerCase().includes(search.toLowerCase());
        const s = !statusFilter || d.status === statusFilter;
        const c = !serviceFilter || d.serviceRef === serviceFilter || d.vehicleServiceRef === serviceFilter;
        return m && s && c;
    });

    const prioritizedDeliveryOrders = filtered
        .slice()
        .sort((a, b) => {
            if (a.pendingDriverStatus && !b.pendingDriverStatus) return -1;
            if (!a.pendingDriverStatus && b.pendingDriverStatus) return 1;
            const priorityDiff = (DO_ACTION_PRIORITY[a.status] ?? 99) - (DO_ACTION_PRIORITY[b.status] ?? 99);
            if (priorityDiff !== 0) return priorityDiff;
            return new Date(b.date).getTime() - new Date(a.date).getTime();
        });

    const queueCounts = {
        needApproval: items.filter(item => Boolean(item.pendingDriverStatus)).length,
        needCompletion: items.filter(item => item.status === 'ARRIVED').length,
        onRoad: items.filter(item => ['HEADING_TO_PICKUP', 'ON_DELIVERY'].includes(item.status)).length,
        waitingStart: items.filter(item => item.status === 'CREATED').length,
    };

    return (
        <div>
            <div className="page-header">
                <div className="page-header-left">
                    <h1 className="page-title">Surat Jalan</h1>
                    <p className="page-subtitle">Antrian trip pengiriman. Trip yang perlu dipantau atau diselesaikan tampil lebih dulu.</p>
                </div>
                <div className="page-actions">
                    <button className="btn btn-secondary btn-sm" onClick={() => {
                        exportToExcel(filtered as unknown as Record<string, unknown>[], [
                            { header: 'No. SJ Customer', key: 'customerDoNumber', width: 22 },
                            { header: 'No. DO', key: 'doNumber', width: 18 },
                            { header: 'Resi', key: 'masterResi', width: 18 },
                            { header: 'Customer', key: 'customerName', width: 25 },
                            { header: 'Kendaraan', key: 'vehiclePlate', width: 15 },
                            { header: 'Driver', key: 'driverName', width: 20 },
                            { header: 'Tanggal', key: 'date', width: 15 },
                            { header: 'Status', key: 'status', width: 15 },
                        ], `surat-jalan-${new Date().toISOString().split('T')[0]}`, 'Surat Jalan');
                    }}><FileDown size={15} /> Excel</button>
                    <button className="btn btn-secondary btn-sm" onClick={async () => {
                        const co = await fetchCompanyProfile();
                        openBrandedPrint({
                            title: 'Daftar Surat Jalan', company: co, bodyHtml: `
                            <table><thead><tr><th>No. SJ Customer</th><th>No. Internal</th><th>Resi</th><th>Customer</th><th>Kendaraan</th><th>Driver</th><th>Tanggal</th><th>Status</th><th>Drop Aktual</th></tr></thead>
                            <tbody>${filtered.map(d => `<tr><td class="b">${d.customerDoNumber || d.doNumber || '-'}</td><td>${d.doNumber}</td><td>${d.masterResi || '-'}</td><td>${d.customerName || '-'}</td><td>${d.vehiclePlate || '-'}</td><td>${d.driverName || '-'}</td><td>${formatDate(d.date)}</td><td>${DO_STATUS_MAP[d.status]?.label || d.status}</td><td>${d.actualDropPoints?.length ? `${d.actualDropPoints.length} titik` : '-'}</td></tr>`).join('')}</tbody></table>`
                        });
                    }}><Printer size={15} /> Print</button>
                </div>
            </div>
            <div className="kpi-grid" style={{ marginBottom: '1.5rem' }}>
                <div className="kpi-card">
                    <div className="kpi-icon warning"><Truck size={20} /></div>
                    <div className="kpi-content">
                        <div className="kpi-label">Menunggu Approval</div>
                        <div className="kpi-value">{queueCounts.needApproval}</div>
                    </div>
                </div>
                <div className="kpi-card">
                    <div className="kpi-icon warning"><Truck size={20} /></div>
                    <div className="kpi-content">
                        <div className="kpi-label">Perlu Diselesaikan</div>
                        <div className="kpi-value">{queueCounts.needCompletion}</div>
                    </div>
                </div>
                <div className="kpi-card">
                    <div className="kpi-icon info"><Truck size={20} /></div>
                    <div className="kpi-content">
                        <div className="kpi-label">Sedang Berjalan</div>
                        <div className="kpi-value">{queueCounts.onRoad}</div>
                    </div>
                </div>
                <div className="kpi-card">
                    <div className="kpi-icon success"><Truck size={20} /></div>
                    <div className="kpi-content">
                        <div className="kpi-label">Siap Berangkat</div>
                        <div className="kpi-value">{queueCounts.waitingStart}</div>
                    </div>
                </div>
            </div>
            <div className="table-container">
                <div className="table-toolbar">
                    <div className="table-toolbar-left">
                        <div className="table-search">
                            <Search size={16} className="table-search-icon" />
                            <input type="text" placeholder="Cari DO, customer, kendaraan, driver, kategori..." value={search} onChange={e => setSearch(e.target.value)} />
                        </div>
                        <select className="form-select" style={{ width: 'auto', minWidth: 180 }} value={serviceFilter} onChange={e => setServiceFilter(e.target.value)}>
                            <option value="">Semua Kategori</option>
                            {availableServiceOptions.map(service => <option key={service._id} value={service._id}>{service.code} - {service.name}</option>)}
                        </select>
                        <select className="form-select" style={{ width: 'auto', minWidth: 140 }} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
                            <option value="">Semua Status</option>
                            {Object.entries(DO_STATUS_MAP).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                        </select>
                    </div>
                </div>
                <div className="table-wrapper table-desktop-only">
                    <table>
                        <thead><tr><th>No. SJ Customer</th><th>No. Internal</th><th>Resi</th><th>Customer</th><th>Kategori</th><th>Kendaraan</th><th>Tanggal</th><th>Status</th><th>Approval Driver</th><th>Drop Aktual</th><th>Tracking</th><th>Aksi</th></tr></thead>
                        <tbody>
                            {loading ? [1, 2, 3].map(i => <tr key={i}>{[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(j => <td key={j}><div className="skeleton skeleton-text" /></td>)}</tr>) :
                                prioritizedDeliveryOrders.length === 0 ? (
                                    <tr><td colSpan={12}><div className="empty-state"><Truck size={48} className="empty-state-icon" /><div className="empty-state-title">Belum ada surat jalan</div><div className="empty-state-text">Buat surat jalan dari halaman detail order</div></div></td></tr>
                                ) : prioritizedDeliveryOrders.map(d => (
                                    <tr key={d._id}>
                                        <td><Link href={`/delivery-orders/${d._id}`} className="font-semibold" style={{ color: 'var(--color-primary)' }}>{formatDeliveryOrderDisplayNumber(d)}</Link></td>
                                        <td className="font-mono text-muted">{d.doNumber}</td>
                                        <td><Link href={`/orders/${d.orderRef}`} className="text-muted">{d.masterResi}</Link></td>
                                        <td>{d.customerName}</td>
                                        <td>
                                            <div>{getServiceLabel(d)}</div>
                                            {d.vehicleCategoryOverrideReason && (
                                                <div className="text-muted text-sm">Override tercatat</div>
                                            )}
                                        </td>
                                        <td>{d.vehiclePlate || '-'}</td>
                                        <td className="text-muted">{formatDate(d.date)}</td>
                                        <td><span className={`badge badge-${DO_STATUS_MAP[d.status]?.color}`}><span className="badge-dot" /> {DO_STATUS_MAP[d.status]?.label}</span></td>
                                        <td>
                                            {d.pendingDriverStatus ? (
                                                <div>
                                                    <span className={`badge badge-${DO_STATUS_MAP[d.pendingDriverStatus]?.color || 'warning'}`}>
                                                        <span className="badge-dot" /> {DO_STATUS_MAP[d.pendingDriverStatus]?.label || d.pendingDriverStatus}
                                                    </span>
                                                    <div className="text-muted text-sm">{d.pendingDriverStatusRequestedAt ? formatDateTime(d.pendingDriverStatusRequestedAt) : 'Menunggu approval'}</div>
                                                </div>
                                            ) : (
                                                <span className="text-muted text-sm">-</span>
                                            )}
                                        </td>
                                        <td>
                                            {d.actualDropPoints?.length ? (
                                                <div>
                                                    <div className="font-medium">{d.actualDropPoints.length} titik</div>
                                                    <div className="text-muted text-sm">{d.actualDropPoints[0]?.locationName || '-'}</div>
                                                </div>
                                            ) : (
                                                <span className="text-muted text-sm">Belum dicatat</span>
                                            )}
                                        </td>
                                        <td>
                                            {d.trackingState === 'ACTIVE' || d.trackingState === 'PAUSED' ? (
                                                <div>
                                                    <span className={`badge ${d.trackingState === 'ACTIVE' ? 'badge-info' : 'badge-warning'}`}>{d.trackingState}</span>
                                                    <div className="text-muted text-sm">{d.trackingLastSeenAt ? formatDateTime(d.trackingLastSeenAt) : 'Belum ada update'}</div>
                                                </div>
                                            ) : (
                                                <span className="text-muted text-sm">Belum aktif</span>
                                            )}
                                        </td>
                                        <td><button className="table-action-btn" onClick={() => router.push(`/delivery-orders/${d._id}`)}><Eye size={14} /> Buka Trip</button></td>
                                    </tr>
                                ))}
                        </tbody>
                    </table>
                </div>
                {!loading && (
                    <div className="mobile-record-list">
                        {prioritizedDeliveryOrders.length === 0 ? (
                            <div className="mobile-record-card">
                                <div className="mobile-record-title">Belum ada surat jalan</div>
                                <div className="mobile-record-subtitle">Buat surat jalan dari halaman detail order.</div>
                            </div>
                        ) : prioritizedDeliveryOrders.map(d => (
                            <div key={d._id} className="mobile-record-card">
                                <div className="mobile-record-header">
                                    <div>
                                        <div className="mobile-record-title">{formatDeliveryOrderDisplayNumber(d)}</div>
                                        <div className="mobile-record-subtitle">{d.customerName || '-'} • {formatDate(d.date)}</div>
                                    </div>
                                    <span className={`badge badge-${DO_STATUS_MAP[d.status]?.color}`}>
                                        <span className="badge-dot" /> {DO_STATUS_MAP[d.status]?.label}
                                    </span>
                                </div>
                                <div className="mobile-record-meta">
                                    <div className="mobile-record-kv">
                                        <span className="mobile-record-label">No. Internal</span>
                                        <span className="mobile-record-value">{d.doNumber || '-'}</span>
                                    </div>
                                    <div className="mobile-record-kv">
                                        <span className="mobile-record-label">Resi</span>
                                        <span className="mobile-record-value">{d.masterResi || '-'}</span>
                                    </div>
                                    <div className="mobile-record-kv">
                                        <span className="mobile-record-label">Kategori</span>
                                        <span className="mobile-record-value">
                                            {getServiceLabel(d)}
                                            {d.vehicleCategoryOverrideReason ? ' • Override tercatat' : ''}
                                        </span>
                                    </div>
                                    <div className="mobile-record-kv">
                                        <span className="mobile-record-label">Kendaraan</span>
                                        <span className="mobile-record-value">{d.vehiclePlate || '-'}</span>
                                    </div>
                                    <div className="mobile-record-kv">
                                        <span className="mobile-record-label">Tracking</span>
                                        <span className="mobile-record-value">
                                            {d.trackingState === 'ACTIVE' || d.trackingState === 'PAUSED'
                                                ? `${d.trackingState} • ${d.trackingLastSeenAt ? formatDateTime(d.trackingLastSeenAt) : 'Belum ada update'}`
                                                : 'Belum aktif'}
                                        </span>
                                    </div>
                                    <div className="mobile-record-kv">
                                        <span className="mobile-record-label">Drop Aktual</span>
                                        <span className="mobile-record-value">
                                            {d.actualDropPoints?.length
                                                ? `${d.actualDropPoints.length} titik • ${d.actualDropPoints[0]?.locationName || '-'}`
                                                : 'Belum dicatat'}
                                        </span>
                                    </div>
                                </div>
                                <div className="mobile-record-meta">
                                    <div className="mobile-record-kv">
                                        <span className="mobile-record-label">Approval Driver</span>
                                        <span className="mobile-record-value">
                                            {d.pendingDriverStatus
                                                ? `${DO_STATUS_MAP[d.pendingDriverStatus]?.label || d.pendingDriverStatus} • ${d.pendingDriverStatusRequestedAt ? formatDateTime(d.pendingDriverStatusRequestedAt) : 'Menunggu approval'}`
                                                : 'Tidak ada'}
                                        </span>
                                    </div>
                                </div>
                                <div className="mobile-record-actions">
                                    <button className="btn btn-secondary" onClick={() => router.push(`/delivery-orders/${d._id}`)}>
                                        <Eye size={14} /> Buka Trip
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
                {prioritizedDeliveryOrders.length > 0 && <div className="pagination"><div className="pagination-info">Menampilkan {prioritizedDeliveryOrders.length} surat jalan. Urutan dimulai dari trip yang paling perlu tindakan.</div></div>}
            </div>
        </div>
    );
}
