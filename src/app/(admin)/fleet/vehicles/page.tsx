'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus, Search, Eye, Edit, Car, FileDown, Printer } from 'lucide-react';
import AppPagination from '@/components/AppPagination';

import { useToast } from '../../layout';
import { VEHICLE_STATUS_MAP, formatDate } from '@/lib/utils';
import { exportVehicles } from '@/lib/export';
import { fetchCompanyProfile, openBrandedPrint } from '@/lib/print';
import { DEFAULT_PAGE_SIZE, paginateItems } from '@/lib/pagination';
import { getSuggestedVehicleTireLayout, resolveTireAssetStatus, resolveTireSlotCode } from '@/lib/tire-slots';
import type { Service, TireEvent, Vehicle } from '@/lib/types';

export default function VehiclesPage() {
    const router = useRouter();
    const { addToast } = useToast();
    const [items, setItems] = useState<Vehicle[]>([]);
    const [services, setServices] = useState<Service[]>([]);
    const [tireEvents, setTireEvents] = useState<TireEvent[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState('');
    const [serviceFilter, setServiceFilter] = useState('');
    const [page, setPage] = useState(1);

    useEffect(() => {
        const loadVehicles = async () => {
            try {
                const res = await fetch('/api/data?entity=vehicles');
                const payload = await res.json();
                if (!res.ok) {
                    throw new Error(payload.error || 'Gagal memuat data kendaraan');
                }
                const serviceRes = await fetch('/api/data?entity=services');
                const tireRes = await fetch('/api/data?entity=tire-events');
                const [servicePayload, tirePayload] = await Promise.all([serviceRes.json(), tireRes.json()]);
                if (!serviceRes.ok) {
                    throw new Error(servicePayload.error || 'Gagal memuat kategori armada');
                }
                if (!tireRes.ok) {
                    throw new Error(tirePayload.error || 'Gagal memuat ringkasan ban');
                }
                setItems(payload.data || []);
                setServices(servicePayload.data || []);
                setTireEvents(tirePayload.data || []);
            } catch (error) {
                addToast('error', error instanceof Error ? error.message : 'Gagal memuat data kendaraan');
            } finally {
                setLoading(false);
            }
        };

        void loadVehicles();
    }, [addToast]);

    useEffect(() => {
        setPage(1);
    }, [search, statusFilter, serviceFilter]);

    const getServiceLabel = (vehicle: Vehicle) => {
        const service = services.find(item => item._id === vehicle.serviceRef);
        if (service) {
            return `${service.code} - ${service.name}`;
        }
        return vehicle.serviceName || '-';
    };

    const availableServiceOptions = services.filter(service =>
        service.active !== false || items.some(vehicle => vehicle.serviceRef === service._id)
    );

    const filtered = items.filter(vehicle => {
        const service = services.find(item => item._id === vehicle.serviceRef);
        const matchesSearch = !search
            || vehicle.plateNumber?.toLowerCase().includes(search.toLowerCase())
            || vehicle.brandModel?.toLowerCase().includes(search.toLowerCase())
            || vehicle.unitCode?.toLowerCase().includes(search.toLowerCase())
            || vehicle.serviceName?.toLowerCase().includes(search.toLowerCase())
            || service?.code?.toLowerCase().includes(search.toLowerCase());
        const matchesStatus = !statusFilter || vehicle.status === statusFilter;
        const matchesService = !serviceFilter || vehicle.serviceRef === serviceFilter;
        return matchesSearch && matchesStatus && matchesService;
    });
    const paginatedVehicles = paginateItems(filtered, page, DEFAULT_PAGE_SIZE);

    const buildTireSummary = (vehicle: Vehicle) => {
        const activeSlotCodes = tireEvents
            .filter(event => event.vehicleRef === vehicle._id && ['IN_USE', 'SPARE'].includes(resolveTireAssetStatus(event)))
            .map(event => resolveTireSlotCode(event) || '')
            .filter(Boolean);
        const layout = getSuggestedVehicleTireLayout(vehicle.vehicleType, vehicle.serviceName, activeSlotCodes);
        const filled = new Set(activeSlotCodes).size;
        const expected = layout.allSlots.length;
        return {
            filled,
            expected,
            missing: Math.max(expected - filled, 0),
        };
    };

    const tireSummaryByVehicle = new Map<string, { filled: number; expected: number; missing: number }>();
    filtered.forEach(vehicle => {
        tireSummaryByVehicle.set(vehicle._id, buildTireSummary(vehicle));
    });

    const getVehicleNextAction = (vehicle: Vehicle) => {
        const summary = tireSummaryByVehicle.get(vehicle._id);
        if (vehicle.status !== 'ACTIVE') {
            return 'Cek status unit sebelum dipakai untuk trip baru';
        }
        if (summary && summary.missing > 0) {
            return `Lengkapi ${summary.missing} slot ban yang masih kosong`;
        }
        return 'Siap dipakai; buka profil unit bila perlu servis atau insiden';
    };

    const activeVehicleCount = items.filter(vehicle => vehicle.status === 'ACTIVE').length;
    const incompleteTireCount = items.filter(vehicle => buildTireSummary(vehicle).missing > 0).length;
    const nonOperationalCount = items.filter(vehicle => vehicle.status !== 'ACTIVE').length;

    return (
        <div>
            <div className="page-header">
                <div className="page-header-left">
                    <h1 className="page-title">Kendaraan</h1>
                    <p className="page-subtitle">Pantau unit siap jalan, kelengkapan ban, dan buka profil unit bila perlu servis atau insiden.</p>
                </div>
                <div className="page-actions">
                    <button className="btn btn-secondary btn-sm" onClick={() => exportVehicles(filtered as unknown as Record<string, unknown>[])}>
                        <FileDown size={15} /> Excel
                    </button>
                    <button className="btn btn-secondary btn-sm" onClick={async () => {
                        const company = await fetchCompanyProfile();
                        openBrandedPrint({
                            title: 'Daftar Kendaraan',
                            company,
                            bodyHtml: `
                            <table><thead><tr><th>Kode</th><th>Plat Nomor</th><th>Merk/Model</th><th>Kategori</th><th>Tipe</th><th>Tahun</th><th>Status</th><th>Odometer</th><th>Tgl Update</th></tr></thead>
                            <tbody>${filtered.map(vehicle => `<tr><td class="b">${vehicle.unitCode || '-'}</td><td>${vehicle.plateNumber}</td><td>${vehicle.brandModel}</td><td>${vehicle.serviceName || '-'}</td><td>${vehicle.vehicleType}</td><td>${vehicle.year}</td><td>${VEHICLE_STATUS_MAP[vehicle.status]?.label || vehicle.status}</td><td class="r">${vehicle.lastOdometer ? `${vehicle.lastOdometer.toLocaleString('id-ID')} km` : '-'}</td><td>${formatDate(vehicle.lastOdometerAt)}</td></tr>`).join('')}</tbody></table>`,
                        });
                    }}>
                        <Printer size={15} /> Print
                    </button>
                    <Link href="/fleet/vehicles/new" className="btn btn-primary"><Plus size={18} /> Tambah Kendaraan</Link>
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
                                paginatedVehicles.totalItems === 0 ? <tr><td colSpan={11}><div className="empty-state"><Car size={48} className="empty-state-icon" /><div className="empty-state-title">Belum ada kendaraan</div></div></td></tr> :
                                    paginatedVehicles.items.map(vehicle => {
                                        const summary = tireSummaryByVehicle.get(vehicle._id);
                                        return (
                                            <tr key={vehicle._id}>
                                                <td className="font-mono text-muted">{vehicle.unitCode}</td>
                                                <td className="font-semibold">{vehicle.plateNumber}</td>
                                                <td>{vehicle.brandModel}</td>
                                                <td>{getServiceLabel(vehicle)}</td>
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
                                                <td>{getVehicleNextAction(vehicle)}</td>
                                                <td>{vehicle.lastOdometer ? `${vehicle.lastOdometer.toLocaleString()} km` : '-'}</td>
                                                <td><div className="table-actions">
                                                    <button className="table-action-btn" onClick={() => router.push(`/fleet/vehicles/${vehicle._id}`)}><Eye size={14} /> Lihat</button>
                                                    <button className="table-action-btn" onClick={() => router.push(`/fleet/vehicles/${vehicle._id}/edit`)}><Edit size={14} /> Edit</button>
                                                </div></td>
                                            </tr>
                                        );
                                    })}
                        </tbody>
                    </table>
                </div>
                {!loading && (
                    <div className="mobile-record-list">
                        {paginatedVehicles.totalItems === 0 ? (
                            <div className="mobile-record-card">
                                <div className="mobile-record-title">Belum ada kendaraan</div>
                                <div className="mobile-record-subtitle">Tambahkan kendaraan untuk mulai mengelola armada.</div>
                            </div>
                        ) : paginatedVehicles.items.map(vehicle => {
                            const summary = tireSummaryByVehicle.get(vehicle._id);
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
                                            <span className="mobile-record-value">{getServiceLabel(vehicle)}</span>
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
                                            <span className="mobile-record-value">{getVehicleNextAction(vehicle)}</span>
                                        </div>
                                        <div className="mobile-record-kv">
                                            <span className="mobile-record-label">Tahun</span>
                                            <span className="mobile-record-value">{vehicle.year}</span>
                                        </div>
                                        <div className="mobile-record-kv">
                                            <span className="mobile-record-label">Odometer</span>
                                            <span className="mobile-record-value">{vehicle.lastOdometer ? `${vehicle.lastOdometer.toLocaleString()} km` : '-'}</span>
                                        </div>
                                    </div>
                                    <div className="mobile-record-actions">
                                        <button className="btn btn-secondary" onClick={() => router.push(`/fleet/vehicles/${vehicle._id}`)}>
                                            <Eye size={14} /> Lihat
                                        </button>
                                        <button className="btn btn-secondary" onClick={() => router.push(`/fleet/vehicles/${vehicle._id}/edit`)}>
                                            <Edit size={14} /> Edit
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
                {paginatedVehicles.totalItems > 0 && (
                    <AppPagination
                        page={paginatedVehicles.currentPage}
                        pageSize={DEFAULT_PAGE_SIZE}
                        totalItems={paginatedVehicles.totalItems}
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
