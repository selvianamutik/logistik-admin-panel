'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Search, Eye, Truck, FileDown, Printer } from 'lucide-react';
import AppPagination from '@/components/AppPagination';
import SortableTableHeader, { type SortDirection } from '@/components/SortableTableHeader';
import { formatDate, formatDateTime, DO_STATUS_MAP, formatInternalDeliveryOrderNumber, formatShipperDeliveryOrderNumber } from '@/lib/utils';
import {
    buildDeliveryOrderExportRows,
    buildDeliveryOrdersPrintHtml,
    buildDeliveryOrdersQuery as buildDeliveryOrdersQueryString,
    getDeliveryOrderApprovalSummary,
    getDeliveryOrderDropSummary,
    getDeliveryOrderServiceLabel,
    getDeliveryOrderTrackingSummary,
    getNextDeliveryOrderAction,
    getSelectableDeliveryOrderServices,
} from '@/lib/delivery-order-page-support';
import { exportToExcel } from '@/lib/export';
import { openBrandedPrint, openPrintWindow, fetchCompanyProfile } from '@/lib/print';
import { DEFAULT_PAGE_SIZE } from '@/lib/pagination';
import { fetchAdminCollectionData } from '@/lib/api/admin-client';
import type { DeliveryOrder, Service } from '@/lib/types';
import { useApp, useToast } from '../layout';
import { hasPermission } from '@/lib/rbac';

export default function DeliveryOrdersPage() {
    const router = useRouter();
    const { user } = useApp();
    const { addToast } = useToast();
    const [items, setItems] = useState<DeliveryOrder[]>([]);
    const [services, setServices] = useState<Service[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState('');
    const [serviceFilter, setServiceFilter] = useState('');
    const [page, setPage] = useState(1);
    const [totalItems, setTotalItems] = useState(0);
    const [queueCounts, setQueueCounts] = useState({
        needApproval: 0,
        needCompletion: 0,
        onRoad: 0,
        waitingStart: 0,
    });
    const [dateSortDir, setDateSortDir] = useState<SortDirection | null>(null);
    const canViewServices = user ? hasPermission(user.role, 'services', 'view') : false;
    const canExportDeliveryOrders = user ? hasPermission(user.role, 'deliveryOrders', 'export') : false;
    const canPrintDeliveryOrders = user ? hasPermission(user.role, 'deliveryOrders', 'print') : false;

    useEffect(() => {
        setPage(1);
    }, [search, statusFilter, serviceFilter]);

    const buildDeliveryOrdersQuery = useCallback((targetPage = page, targetPageSize = DEFAULT_PAGE_SIZE) => (
        buildDeliveryOrdersQueryString({
            page: targetPage,
            pageSize: targetPageSize,
            search,
            statusFilter,
            serviceFilter,
            sortField: dateSortDir ? 'date' : undefined,
            sortDir: dateSortDir || undefined,
        })
    ), [dateSortDir, page, search, serviceFilter, statusFilter]);

    const fetchAllMatchingDeliveryOrders = useCallback(async () => {
        const pageSize = 200;
        let currentPage = 1;
        let total = 0;
        const allItems: DeliveryOrder[] = [];

        do {
            const res = await fetch(`/api/data?${buildDeliveryOrdersQuery(currentPage, pageSize)}`);
            const payload = await res.json();
            if (!res.ok) {
                throw new Error(payload.error || 'Gagal memuat surat jalan');
            }

            const nextItems = (payload.data || []) as DeliveryOrder[];
            total = payload.meta?.total || nextItems.length;
            allItems.push(...nextItems);
            if (nextItems.length === 0) break;
            currentPage += 1;
        } while (allItems.length < total);

        return allItems;
    }, [buildDeliveryOrdersQuery]);

    const loadDeliveryOrders = useCallback(async () => {
        setLoading(true);
        try {
            const [listRes, approvalRes, completionRes, onRoadRes, createdRes] = await Promise.all([
                fetch(`/api/data?${buildDeliveryOrdersQuery()}`),
                fetch('/api/data?entity=delivery-orders&countOnly=1&definedFields=pendingDriverStatus'),
                fetch(`/api/data?entity=delivery-orders&countOnly=1&filter=${encodeURIComponent(JSON.stringify({ status: 'ARRIVED' }))}`),
                fetch(`/api/data?entity=delivery-orders&countOnly=1&filter=${encodeURIComponent(JSON.stringify({ status: ['HEADING_TO_PICKUP', 'ON_DELIVERY'] }))}`),
                fetch(`/api/data?entity=delivery-orders&countOnly=1&filter=${encodeURIComponent(JSON.stringify({ status: 'CREATED' }))}`),
            ]);

            const [listPayload, approvalPayload, completionPayload, onRoadPayload, createdPayload] = await Promise.all([
                listRes.json(),
                approvalRes.json(),
                completionRes.json(),
                onRoadRes.json(),
                createdRes.json(),
            ]);

            let serviceRows: Service[] = [];
            if (canViewServices) {
                serviceRows = await fetchAdminCollectionData<Service[]>(
                    '/api/data?entity=services&sortField=code&sortDir=asc',
                    'Gagal memuat kategori armada'
                );
            }

            if (!listRes.ok) throw new Error(listPayload.error || 'Gagal memuat surat jalan');
            if (!approvalRes.ok) throw new Error(approvalPayload.error || 'Gagal memuat statistik surat jalan');
            if (!completionRes.ok) throw new Error(completionPayload.error || 'Gagal memuat statistik surat jalan');
            if (!onRoadRes.ok) throw new Error(onRoadPayload.error || 'Gagal memuat statistik surat jalan');
            if (!createdRes.ok) throw new Error(createdPayload.error || 'Gagal memuat statistik surat jalan');

            setItems(listPayload.data || []);
            setTotalItems(listPayload.meta?.total || 0);
            setServices(serviceRows || []);
            setQueueCounts({
                needApproval: approvalPayload.meta?.total || 0,
                needCompletion: completionPayload.meta?.total || 0,
                onRoad: onRoadPayload.meta?.total || 0,
                waitingStart: createdPayload.meta?.total || 0,
            });
        } catch (error) {
            addToast('error', error instanceof Error ? error.message : 'Gagal memuat surat jalan');
        } finally {
            setLoading(false);
        }
    }, [addToast, buildDeliveryOrdersQuery, canViewServices]);

    useEffect(() => {
        void loadDeliveryOrders();
    }, [loadDeliveryOrders]);

    const availableServiceOptions = useMemo(
        () => getSelectableDeliveryOrderServices({ services, serviceFilter, deliveryOrders: items }),
        [items, serviceFilter, services]
    );

    return (
        <div>
            <div className="page-header">
                <div className="page-header-left">
                    <h1 className="page-title">Surat Jalan</h1>
                </div>
                <div className="page-actions">
                    {canExportDeliveryOrders && <button className="btn btn-secondary btn-sm" onClick={async () => {
                        try {
                            const printableDeliveryOrders = await fetchAllMatchingDeliveryOrders();
                            await exportToExcel(buildDeliveryOrderExportRows(printableDeliveryOrders, services) as unknown as Record<string, unknown>[], [
                                { header: 'No. SJ Pengirim', key: 'customerDoNumber', width: 22 },
                                { header: 'No. DO Internal', key: 'doNumber', width: 18 },
                                { header: 'Resi', key: 'masterResi', width: 18 },
                                { header: 'Customer', key: 'customerName', width: 25 },
                                { header: 'Kategori', key: 'serviceLabel', width: 24 },
                                { header: 'Kendaraan', key: 'vehiclePlate', width: 15 },
                                { header: 'Driver', key: 'driverName', width: 20 },
                                { header: 'Tanggal', key: 'date', width: 15 },
                                { header: 'Status', key: 'status', width: 15 },
                                { header: 'Drop Aktual', key: 'actualDropPoints', width: 14 },
                            ], `surat-jalan-${new Date().toISOString().split('T')[0]}`, 'Surat Jalan');
                            addToast('success', 'Excel surat jalan berhasil di-download');
                        } catch (error) {
                            addToast('error', error instanceof Error ? error.message : 'Gagal menyiapkan Excel surat jalan');
                        }
                    }}><FileDown size={15} /> Excel</button>}
                    {canPrintDeliveryOrders && <button className="btn btn-secondary btn-sm" onClick={async () => {
                        const printWindow = openPrintWindow('Menyiapkan print surat jalan...');
                        if (!printWindow) {
                            addToast('error', 'Popup browser diblok. Izinkan pop-up lalu coba print lagi.');
                            return;
                        }
                        try {
                            const co = await fetchCompanyProfile().catch(() => null);
                            const printableDeliveryOrders = await fetchAllMatchingDeliveryOrders();
                            openBrandedPrint({
                                title: 'Daftar Surat Jalan', company: co, targetWindow: printWindow, bodyHtml: buildDeliveryOrdersPrintHtml(printableDeliveryOrders, services),
                            });
                        } catch (error) {
                            try {
                                printWindow.close();
                            } catch {}
                            addToast('error', error instanceof Error ? error.message : 'Gagal menyiapkan dokumen print surat jalan');
                        }
                    }}><Printer size={15} /> Print</button>}
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
                            <input type="text" placeholder="Cari DO, customer, kendaraan, driver, lokasi..." value={search} onChange={e => setSearch(e.target.value)} />
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
                        <thead><tr><th>No. SJ Pengirim</th><th>No. DO Internal</th><th>Resi</th><th>Customer</th><th>Kategori</th><th>Kendaraan</th><th><SortableTableHeader label="Tanggal" direction={dateSortDir} onToggle={() => setDateSortDir(current => current === 'desc' ? 'asc' : 'desc')} /></th><th>Status</th><th>Tindak Lanjut</th><th>Approval Driver</th><th>Drop Aktual</th><th>Tracking</th><th>Aksi</th></tr></thead>
                        <tbody>
                            {loading ? [1, 2, 3].map(i => <tr key={i}>{[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13].map(j => <td key={j}><div className="skeleton skeleton-text" /></td>)}</tr>) :
                                totalItems === 0 ? (
                                    <tr><td colSpan={13}><div className="empty-state"><Truck size={48} className="empty-state-icon" /><div className="empty-state-title">Belum ada surat jalan</div><div className="empty-state-text">Buat surat jalan dari halaman detail order</div></div></td></tr>
                                ) : items.map(d => (
                                    <tr key={d._id}>
                                        <td>{d.customerDoNumber ? <Link href={`/delivery-orders/${d._id}`} className="font-semibold" style={{ color: 'var(--color-primary)' }}>{formatShipperDeliveryOrderNumber(d)}</Link> : <span className="text-muted">-</span>}</td>
                                        <td className="font-mono text-muted"><Link href={`/delivery-orders/${d._id}`} style={{ color: 'inherit' }}>{d.doNumber}</Link></td>
                                        <td><Link href={`/orders/${d.orderRef}`} className="text-muted">{d.masterResi}</Link></td>
                                        <td>{d.customerName}</td>
                                        <td>
                                            <div>{getDeliveryOrderServiceLabel(d, services)}</div>
                                            {d.vehicleCategoryOverrideReason && (
                                                <div className="text-muted text-sm">Override tercatat</div>
                                            )}
                                        </td>
                                        <td>{d.vehiclePlate || '-'}</td>
                                        <td className="text-muted">{formatDate(d.date)}</td>
                                        <td><span className={`badge badge-${DO_STATUS_MAP[d.status]?.color}`}><span className="badge-dot" /> {DO_STATUS_MAP[d.status]?.label}</span></td>
                                        <td><span style={{ fontWeight: 500 }}>{getNextDeliveryOrderAction(d)}</span></td>
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
                        {totalItems === 0 ? (
                            <div className="mobile-record-card">
                                <div className="mobile-record-title">Belum ada surat jalan</div>
                                <div className="mobile-record-subtitle">Buat surat jalan dari halaman detail order.</div>
                            </div>
                        ) : items.map(d => (
                            <div key={d._id} className="mobile-record-card">
                                <div className="mobile-record-header">
                                    <div>
                                        <div className="mobile-record-title">{formatInternalDeliveryOrderNumber(d)}</div>
                                        <div className="mobile-record-subtitle">{d.customerName || '-'} | {formatDate(d.date)}</div>
                                    </div>
                                    <span className={`badge badge-${DO_STATUS_MAP[d.status]?.color}`}>
                                        <span className="badge-dot" /> {DO_STATUS_MAP[d.status]?.label}
                                    </span>
                                </div>
                                <div className="mobile-record-meta">
                                    <div className="mobile-record-kv">
                                        <span className="mobile-record-label">No. SJ Pengirim</span>
                                        <span className="mobile-record-value">{formatShipperDeliveryOrderNumber(d)}</span>
                                    </div>
                                    <div className="mobile-record-kv">
                                        <span className="mobile-record-label">No. DO Internal</span>
                                        <span className="mobile-record-value">{d.doNumber || '-'}</span>
                                    </div>
                                    <div className="mobile-record-kv">
                                        <span className="mobile-record-label">Resi</span>
                                        <span className="mobile-record-value">{d.masterResi || '-'}</span>
                                    </div>
                                    <div className="mobile-record-kv">
                                        <span className="mobile-record-label">Kategori</span>
                                        <span className="mobile-record-value">
                                            {getDeliveryOrderServiceLabel(d, services)}
                                            {d.vehicleCategoryOverrideReason ? ' | Override tercatat' : ''}
                                        </span>
                                    </div>
                                    <div className="mobile-record-kv">
                                        <span className="mobile-record-label">Kendaraan</span>
                                        <span className="mobile-record-value">{d.vehiclePlate || '-'}</span>
                                    </div>
                                    <div className="mobile-record-kv">
                                        <span className="mobile-record-label">Tindak Lanjut</span>
                                        <span className="mobile-record-value">{getNextDeliveryOrderAction(d)}</span>
                                    </div>
                                    <div className="mobile-record-kv">
                                        <span className="mobile-record-label">Tracking</span>
                                        <span className="mobile-record-value">{getDeliveryOrderTrackingSummary(d)}</span>
                                    </div>
                                    <div className="mobile-record-kv">
                                        <span className="mobile-record-label">Drop Aktual</span>
                                        <span className="mobile-record-value">{getDeliveryOrderDropSummary(d)}</span>
                                    </div>
                                </div>
                                <div className="mobile-record-meta">
                                    <div className="mobile-record-kv">
                                        <span className="mobile-record-label">Approval Driver</span>
                                        <span className="mobile-record-value">{getDeliveryOrderApprovalSummary(d)}</span>
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
                {totalItems > 0 && (
                    <AppPagination
                        page={page}
                        pageSize={DEFAULT_PAGE_SIZE}
                        totalItems={totalItems}
                        onPageChange={setPage}
                        info={({ startIndex, endIndex, totalItems }) => (
                            <>
                                Menampilkan {startIndex}-{endIndex} dari {totalItems} surat jalan. Urutan dimulai dari trip yang paling perlu tindakan.
                            </>
                        )}
                    />
                )}
            </div>
        </div>
    );
}
