'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Search, Truck } from 'lucide-react';
import AppPagination from '@/components/AppPagination';
import { DEFAULT_PAGE_SIZE } from '@/lib/pagination';
import { fetchAllAdminCollectionData } from '@/lib/api/admin-client';
import { DO_STATUS_MAP, formatDate } from '@/lib/utils';
import type { Trip } from '@/lib/trip-document-types';
import { hasPageAccess } from '@/lib/rbac';
import { useApp, useToast } from '../layout';

function matchesTripSearch(trip: Trip, search: string) {
    const needle = search.trim().toLowerCase();
    if (!needle) return true;
    return [
        trip.tripNumber,
        trip.masterResi,
        trip.customerName,
        trip.vehiclePlate,
        trip.driverName,
        trip.tripOriginArea,
        trip.tripDestinationArea,
        trip.pickupAddress,
        trip.receiverAddress,
    ].some(value => String(value || '').toLowerCase().includes(needle));
}

export default function TripsPage() {
    const { user } = useApp();
    const { addToast } = useToast();
    const [items, setItems] = useState<Trip[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState('');
    const [page, setPage] = useState(1);
    const canOpenSourceOrderPage = user ? hasPageAccess(user.role, 'orders') : false;

    const loadTrips = useCallback(async () => {
        setLoading(true);
        try {
            const rows = await fetchAllAdminCollectionData<Trip>(
                '/api/data?entity=trips&sortPreset=work-queue',
                'Gagal memuat trip'
            );
            setItems(rows || []);
        } catch (error) {
            addToast('error', error instanceof Error ? error.message : 'Gagal memuat trip');
        } finally {
            setLoading(false);
        }
    }, [addToast]);

    useEffect(() => {
        void loadTrips();
    }, [loadTrips]);

    useEffect(() => {
        setPage(1);
    }, [search, statusFilter]);

    const filteredItems = useMemo(
        () => items.filter(item => (!statusFilter || item.status === statusFilter) && matchesTripSearch(item, search)),
        [items, search, statusFilter]
    );
    const pageItems = filteredItems.slice((page - 1) * DEFAULT_PAGE_SIZE, page * DEFAULT_PAGE_SIZE);
    const activeTripCount = items.filter(item => ['CREATED', 'HEADING_TO_PICKUP', 'ON_DELIVERY', 'ARRIVED'].includes(item.status)).length;
    const pendingApprovalCount = items.filter(item => item.pendingDriverStatus).length;
    const completedCount = items.filter(item => item.status === 'DELIVERED').length;

    return (
        <div>
            <div className="page-header">
                <div className="page-header-left">
                    <h1 className="page-title">Trip</h1>
                </div>
            </div>

            <div className="kpi-grid" style={{ marginBottom: '1.5rem' }}>
                <div className="kpi-card">
                    <div className="kpi-icon info"><Truck size={20} /></div>
                    <div className="kpi-content">
                        <div className="kpi-label">Trip Aktif</div>
                        <div className="kpi-value">{activeTripCount}</div>
                    </div>
                </div>
                <div className="kpi-card">
                    <div className="kpi-icon warning"><Truck size={20} /></div>
                    <div className="kpi-content">
                        <div className="kpi-label">Approval Driver</div>
                        <div className="kpi-value">{pendingApprovalCount}</div>
                    </div>
                </div>
                <div className="kpi-card">
                    <div className="kpi-icon success"><Truck size={20} /></div>
                    <div className="kpi-content">
                        <div className="kpi-label">Selesai</div>
                        <div className="kpi-value">{completedCount}</div>
                    </div>
                </div>
            </div>

            <div className="table-container">
                <div className="table-toolbar">
                    <div className="table-toolbar-left">
                        <div className="table-search">
                            <Search size={16} className="table-search-icon" />
                            <input placeholder="Cari trip, resi, customer, kendaraan, driver..." value={search} onChange={event => setSearch(event.target.value)} />
                        </div>
                        <select className="form-select" style={{ width: 'auto', minWidth: 150 }} value={statusFilter} onChange={event => setStatusFilter(event.target.value)}>
                            <option value="">Semua Status</option>
                            {Object.entries(DO_STATUS_MAP).map(([key, value]) => <option key={key} value={key}>{value.label}</option>)}
                        </select>
                    </div>
                </div>
                <div className="table-wrapper table-desktop-only">
                    <table>
                        <thead>
                            <tr>
                                <th>No. Trip</th>
                                <th>Order / Resi</th>
                                <th>Customer</th>
                                <th>Rute</th>
                                <th>Armada</th>
                                <th>Driver</th>
                                <th>Tanggal</th>
                                <th>SJ</th>
                                <th>Status</th>
                                <th>Aksi</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? [1, 2, 3].map(row => (
                                <tr key={row}>{[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(cell => <td key={cell}><div className="skeleton skeleton-text" /></td>)}</tr>
                            )) : pageItems.length === 0 ? (
                                <tr>
                                    <td colSpan={10}>
                                        <div className="empty-state">
                                            <Truck size={48} className="empty-state-icon" />
                                            <div className="empty-state-title">Belum ada trip</div>
                                            <div className="empty-state-text">Trip dibuat dari order / resi.</div>
                                        </div>
                                    </td>
                                </tr>
                            ) : pageItems.map(item => {
                                const statusMeta = DO_STATUS_MAP[item.status];
                                return (
                                    <tr key={item._id}>
                                        <td><Link className="font-semibold" style={{ color: 'var(--color-primary)' }} href={`/trips/${item._id}`}>{item.tripNumber}</Link></td>
                                        <td>{canOpenSourceOrderPage ? <Link href={`/orders/${item.orderRef}`}>{item.masterResi || '-'}</Link> : (item.masterResi || '-')}</td>
                                        <td>{item.customerName || '-'}</td>
                                        <td>{item.tripOriginArea && item.tripDestinationArea ? `${item.tripOriginArea} -> ${item.tripDestinationArea}` : `${item.pickupAddress || '-'} -> ${item.receiverAddress || '-'}`}</td>
                                        <td>{item.vehiclePlate || '-'}</td>
                                        <td>{item.driverName || '-'}</td>
                                        <td>{formatDate(item.date)}</td>
                                        <td>{item.shipperReferenceCount} SJ</td>
                                        <td><span className={`badge badge-${statusMeta?.color || 'gray'}`}><span className="badge-dot" /> {statusMeta?.label || item.status}</span></td>
                                        <td><Link className="table-action-btn" href={`/trips/${item._id}`}>Lihat</Link></td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
                <div className="mobile-card-list">
                    {pageItems.map(item => {
                        const statusMeta = DO_STATUS_MAP[item.status];
                        return (
                            <div className="mobile-data-card" key={item._id}>
                                <div className="mobile-card-header">
                                    <Link className="mobile-card-title" href={`/trips/${item._id}`}>{item.tripNumber}</Link>
                                    <span className={`badge badge-${statusMeta?.color || 'gray'}`}><span className="badge-dot" /> {statusMeta?.label || item.status}</span>
                                </div>
                                <div className="mobile-card-body">
                                    <div><strong>{item.masterResi || '-'}</strong> | {item.customerName || '-'}</div>
                                    <div>{item.vehiclePlate || '-'} | {item.driverName || '-'}</div>
                                    <div>{formatDate(item.date)} | {item.shipperReferenceCount} SJ</div>
                                </div>
                            </div>
                        );
                    })}
                </div>
                <AppPagination page={page} totalItems={filteredItems.length} pageSize={DEFAULT_PAGE_SIZE} onPageChange={setPage} />
            </div>
        </div>
    );
}
