'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus, Search, Eye, Edit, Car, FileDown, Printer } from 'lucide-react';
import AppPagination from '@/components/AppPagination';
import { fetchAdminCollectionData } from '@/lib/api/admin-client';

import { useApp, useToast } from '../../layout';
import {
    buildVehiclePrintHtml,
    buildVehiclesQuery,
    getAvailableVehicleServiceOptions,
    getVehicleNextAction,
    getVehicleServiceLabel,
    type VehicleTireSummary,
} from '@/lib/fleet-vehicle-page-support';
import { VEHICLE_STATUS_MAP } from '@/lib/utils';
import { exportVehicles } from '@/lib/export';
import { fetchCompanyProfile, openBrandedPrint } from '@/lib/print';
import { DEFAULT_PAGE_SIZE } from '@/lib/pagination';
import type { Service, Vehicle } from '@/lib/types';
import { hasPermission } from '@/lib/rbac';

export default function VehiclesPage() {
    const router = useRouter();
    const { user } = useApp();
    const { addToast } = useToast();
    const [items, setItems] = useState<Vehicle[]>([]);
    const [services, setServices] = useState<Service[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState('');
    const [serviceFilter, setServiceFilter] = useState('');
    const [page, setPage] = useState(1);
    const [filteredTotalVehicles, setFilteredTotalVehicles] = useState(0);
    const [activeVehicleCount, setActiveVehicleCount] = useState(0);
    const [incompleteTireCount, setIncompleteTireCount] = useState(0);
    const [nonOperationalCount, setNonOperationalCount] = useState(0);
    const [tireSummaryByVehicle, setTireSummaryByVehicle] = useState<Record<string, VehicleTireSummary>>({});
    const canCreateVehicle = hasPermission(user?.role ?? 'OWNER', 'vehicles', 'create');
    const canManageVehicle = hasPermission(user?.role ?? 'OWNER', 'vehicles', 'update');
    const canExportVehicles = hasPermission(user?.role ?? 'OWNER', 'vehicles', 'export');
    const canPrintVehicles = hasPermission(user?.role ?? 'OWNER', 'vehicles', 'print');

    useEffect(() => {
        setPage(1);
    }, [search, statusFilter, serviceFilter]);

    const buildCurrentVehiclesQuery = useCallback(
        (targetPage = page, targetPageSize = DEFAULT_PAGE_SIZE) =>
            buildVehiclesQuery({
                page: targetPage,
                pageSize: targetPageSize,
                search,
                statusFilter,
                serviceFilter,
            }),
        [page, search, statusFilter, serviceFilter]
    );

    const fetchAllMatchingVehicles = useCallback(async () => {
        const pageSize = 200;
        let currentPage = 1;
        let total = 0;
        const allItems: Vehicle[] = [];

        do {
            const res = await fetch(`/api/data?${buildCurrentVehiclesQuery(currentPage, pageSize)}`);
            const payload = await res.json();
            if (!res.ok) {
                throw new Error(payload.error || 'Gagal memuat data kendaraan');
            }

            const nextItems = (payload.data || []) as Vehicle[];
            total = payload.meta?.total || nextItems.length;
            allItems.push(...nextItems);
            if (nextItems.length === 0) break;
            currentPage += 1;
        } while (allItems.length < total);

        return allItems;
    }, [buildCurrentVehiclesQuery]);

    const loadVehicles = useCallback(async () => {
        setLoading(true);
        try {
            const [listRes, serviceRes] = await Promise.all([
                fetch(`/api/data?${buildCurrentVehiclesQuery()}`),
                fetchAdminCollectionData<Service[]>('/api/data?entity=services', 'Gagal memuat kategori armada'),
            ]);
            const listPayload = await listRes.json();

            if (!listRes.ok) {
                throw new Error(listPayload.error || 'Gagal memuat data kendaraan');
            }

            const vehicles = (listPayload.data || []) as Vehicle[];
            const idsParam = vehicles.map(vehicle => vehicle._id).join(',');
            const summaryRes = await fetch(`/api/data?entity=vehicles-summary${idsParam ? `&ids=${encodeURIComponent(idsParam)}` : ''}`);
            const summaryPayload = await summaryRes.json();
            if (!summaryRes.ok) {
                throw new Error(summaryPayload.error || 'Gagal memuat ringkasan kendaraan');
            }

            setItems(vehicles);
            setServices(serviceRes || []);
            setFilteredTotalVehicles(listPayload.meta?.total || 0);
            setActiveVehicleCount(summaryPayload.data?.activeVehicleCount || 0);
            setIncompleteTireCount(summaryPayload.data?.incompleteTireCount || 0);
            setNonOperationalCount(summaryPayload.data?.nonOperationalCount || 0);
            setTireSummaryByVehicle(summaryPayload.data?.tireSummaries || {});
        } catch (error) {
            addToast('error', error instanceof Error ? error.message : 'Gagal memuat data kendaraan');
        } finally {
            setLoading(false);
        }
    }, [addToast, buildCurrentVehiclesQuery]);

    useEffect(() => {
        void loadVehicles();
    }, [loadVehicles]);

    const availableServiceOptions = getAvailableVehicleServiceOptions({
        services,
        serviceFilter,
        vehicles: items,
    });

    return (
        <div>
            <div className="page-header">
                <div className="page-header-left">
                    <h1 className="page-title">Kendaraan</h1>
                </div>
                <div className="page-actions">
                    {canExportVehicles && <button
                        className="btn btn-secondary btn-sm"
                        onClick={async () => exportVehicles(await fetchAllMatchingVehicles() as unknown as Record<string, unknown>[])}
                    >
                        <FileDown size={15} /> Excel
                    </button>}
                    {canPrintVehicles && <button
                        className="btn btn-secondary btn-sm"
                        onClick={async () => {
                            const company = await fetchCompanyProfile();
                            const printableVehicles = await fetchAllMatchingVehicles();
                            openBrandedPrint({
                                title: 'Daftar Kendaraan',
                                company,
                                bodyHtml: buildVehiclePrintHtml(printableVehicles, services),
                            });
                        }}
                    >
                        <Printer size={15} /> Print
                    </button>}
                    {canCreateVehicle && <Link href="/fleet/vehicles/new" className="btn btn-primary"><Plus size={18} /> Tambah Kendaraan</Link>}
                </div>
            </div>

            <div className="kpi-grid" style={{ marginBottom: '1.5rem' }}>
                <div className="kpi-card"><div className="kpi-icon success"><Car size={20} /></div><div className="kpi-content"><div className="kpi-label">Siap Dipakai</div><div className="kpi-value">{activeVehicleCount}</div></div></div>
                <div className="kpi-card"><div className="kpi-icon warning"><Car size={20} /></div><div className="kpi-content"><div className="kpi-label">Ban Belum Lengkap</div><div className="kpi-value">{incompleteTireCount}</div></div></div>
                <div className="kpi-card"><div className="kpi-icon info"><Car size={20} /></div><div className="kpi-content"><div className="kpi-label">Perlu Cek Status</div><div className="kpi-value">{nonOperationalCount}</div></div></div>
            </div>

            <div className="table-container">
                <div className="table-toolbar">
                    <div className="table-toolbar-left">
                        <div className="table-search"><Search size={16} className="table-search-icon" /><input placeholder="Cari kode unit, plat, merk, kategori..." value={search} onChange={event => setSearch(event.target.value)} /></div>
                        <select className="form-select" style={{ width: 'auto', minWidth: 180 }} value={serviceFilter} onChange={event => setServiceFilter(event.target.value)}>
                            <option value="">Semua Kategori</option>
                            {availableServiceOptions.map(service => <option key={service._id} value={service._id}>{service.code} - {service.name}</option>)}
                        </select>
                        <select className="form-select" style={{ width: 'auto', minWidth: 140 }} value={statusFilter} onChange={event => setStatusFilter(event.target.value)}>
                            <option value="">Semua Status</option>
                            {Object.entries(VEHICLE_STATUS_MAP).map(([key, meta]) => <option key={key} value={key}>{meta.label}</option>)}
                        </select>
                    </div>
                </div>
                <div className="table-wrapper table-desktop-only">
                    <table>
                        <thead><tr><th>Kode</th><th>Plat Nomor</th><th>Merk/Model</th><th>Kategori Armada</th><th>Tipe</th><th>Ban Unit</th><th>Tahun</th><th>Status</th><th>Tindak Lanjut</th><th>Odometer</th><th>Aksi</th></tr></thead>
                        <tbody>
                            {loading ? [1, 2, 3].map(i => <tr key={i}>{[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map(j => <td key={j}><div className="skeleton skeleton-text" /></td>)}</tr>) :
                                filteredTotalVehicles === 0 ? <tr><td colSpan={11}><div className="empty-state"><Car size={48} className="empty-state-icon" /><div className="empty-state-title">Belum ada kendaraan</div></div></td></tr> :
                                    items.map(vehicle => {
                                        const summary = tireSummaryByVehicle[vehicle._id];
                                        return (
                                            <tr key={vehicle._id}>
                                                <td className="font-mono text-muted">{vehicle.unitCode}</td>
                                                <td className="font-semibold">{vehicle.plateNumber}</td>
                                                <td>{vehicle.brandModel}</td>
                                                <td>{getVehicleServiceLabel(vehicle, services)}</td>
                                                <td>{vehicle.vehicleType}</td>
                                                <td>
                                                    {summary ? (
                                                        <div>
                                                            <div className="font-medium">{summary.filled}/{summary.expected} slot</div>
                                                            <div className="text-muted text-sm">{summary.missing > 0 ? `Kurang ${summary.missing}` : 'Lengkap'}</div>
                                                        </div>
                                                    ) : '-'}
                                                </td>
                                                <td>{vehicle.year}</td>
                                                <td><span className={`badge badge-${VEHICLE_STATUS_MAP[vehicle.status]?.color}`}><span className="badge-dot" /> {VEHICLE_STATUS_MAP[vehicle.status]?.label}</span></td>
                                                <td>{getVehicleNextAction(vehicle, tireSummaryByVehicle)}</td>
                                                <td>{vehicle.lastOdometer ? `${vehicle.lastOdometer.toLocaleString('id-ID')} km` : '-'}</td>
                                                <td><div className="table-actions">
                                                    <button className="table-action-btn" onClick={() => router.push(`/fleet/vehicles/${vehicle._id}`)}><Eye size={14} /> Lihat</button>
                                                    {canManageVehicle && <button className="table-action-btn" onClick={() => router.push(`/fleet/vehicles/${vehicle._id}/edit`)}><Edit size={14} /> Edit</button>}
                                                </div></td>
                                            </tr>
                                        );
                                    })}
                        </tbody>
                    </table>
                </div>
                {!loading && (
                    <div className="mobile-record-list">
                        {filteredTotalVehicles === 0 ? (
                            <div className="mobile-record-card">
                                <div className="mobile-record-title">Belum ada kendaraan</div>
                                <div className="mobile-record-subtitle">Tambahkan kendaraan untuk mulai mengelola armada.</div>
                            </div>
                        ) : items.map(vehicle => {
                            const summary = tireSummaryByVehicle[vehicle._id];
                            return (
                                <div key={vehicle._id} className="mobile-record-card">
                                    <div className="mobile-record-header">
                                        <div>
                                            <div className="mobile-record-title">{vehicle.plateNumber}</div>
                                            <div className="mobile-record-subtitle">{vehicle.brandModel}</div>
                                        </div>
                                        <span className={`badge badge-${VEHICLE_STATUS_MAP[vehicle.status]?.color}`}>
                                            <span className="badge-dot" /> {VEHICLE_STATUS_MAP[vehicle.status]?.label}
                                        </span>
                                    </div>
                                    <div className="mobile-record-meta">
                                        <div className="mobile-record-kv">
                                            <span className="mobile-record-label">Kode Unit</span>
                                            <span className="mobile-record-value">{vehicle.unitCode || '-'}</span>
                                        </div>
                                        <div className="mobile-record-kv">
                                            <span className="mobile-record-label">Kategori Armada</span>
                                            <span className="mobile-record-value">{getVehicleServiceLabel(vehicle, services)}</span>
                                        </div>
                                        <div className="mobile-record-kv">
                                            <span className="mobile-record-label">Tipe</span>
                                            <span className="mobile-record-value">{vehicle.vehicleType}</span>
                                        </div>
                                        <div className="mobile-record-kv">
                                            <span className="mobile-record-label">Ban Unit</span>
                                            <span className="mobile-record-value">
                                                {summary ? `${summary.filled}/${summary.expected} slot${summary.missing > 0 ? ` - kurang ${summary.missing}` : ' - lengkap'}` : '-'}
                                            </span>
                                        </div>
                                        <div className="mobile-record-kv">
                                            <span className="mobile-record-label">Tindak Lanjut</span>
                                            <span className="mobile-record-value">{getVehicleNextAction(vehicle, tireSummaryByVehicle)}</span>
                                        </div>
                                        <div className="mobile-record-kv">
                                            <span className="mobile-record-label">Tahun</span>
                                            <span className="mobile-record-value">{vehicle.year}</span>
                                        </div>
                                        <div className="mobile-record-kv">
                                            <span className="mobile-record-label">Odometer</span>
                                            <span className="mobile-record-value">{vehicle.lastOdometer ? `${vehicle.lastOdometer.toLocaleString('id-ID')} km` : '-'}</span>
                                        </div>
                                    </div>
                                    <div className="mobile-record-actions">
                                        <button className="btn btn-secondary" onClick={() => router.push(`/fleet/vehicles/${vehicle._id}`)}>
                                            <Eye size={14} /> Lihat
                                        </button>
                                        {canManageVehicle && <button className="btn btn-secondary" onClick={() => router.push(`/fleet/vehicles/${vehicle._id}/edit`)}>
                                            <Edit size={14} /> Edit
                                        </button>}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
                {filteredTotalVehicles > 0 && (
                    <AppPagination
                        page={page}
                        pageSize={DEFAULT_PAGE_SIZE}
                        totalItems={filteredTotalVehicles}
                        onPageChange={setPage}
                        info={({ startIndex, endIndex, totalItems }) => (
                            <>Menampilkan {startIndex}-{endIndex} dari {totalItems} kendaraan</>
                        )}
                    />
                )}
            </div>
        </div>
    );
}
