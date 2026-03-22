'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus, Search, Eye, Edit, Car, FileDown, Printer } from 'lucide-react';
import { useToast } from '../../layout';
import { VEHICLE_STATUS_MAP, formatDate } from '@/lib/utils';
import { exportVehicles } from '@/lib/export';
import { fetchCompanyProfile, openBrandedPrint } from '@/lib/print';
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

    const filtered = items.filter(v => {
        const service = services.find(item => item._id === v.serviceRef);
        const m = !search
            || v.plateNumber?.toLowerCase().includes(search.toLowerCase())
            || v.brandModel?.toLowerCase().includes(search.toLowerCase())
            || v.unitCode?.toLowerCase().includes(search.toLowerCase())
            || v.serviceName?.toLowerCase().includes(search.toLowerCase())
            || service?.code?.toLowerCase().includes(search.toLowerCase());
        const s = !statusFilter || v.status === statusFilter;
        const c = !serviceFilter || v.serviceRef === serviceFilter;
        return m && s && c;
    });

    const tireSummaryByVehicle = new Map<string, { filled: number; expected: number; missing: number }>();
    filtered.forEach(vehicle => {
        const activeSlotCodes = tireEvents
            .filter(event => event.vehicleRef === vehicle._id && ['IN_USE', 'SPARE'].includes(resolveTireAssetStatus(event)))
            .map(event => resolveTireSlotCode(event) || '')
            .filter(Boolean);
        const layout = getSuggestedVehicleTireLayout(vehicle.vehicleType, vehicle.serviceName, activeSlotCodes);
        const filled = new Set(activeSlotCodes).size;
        const expected = layout.allSlots.length;
        tireSummaryByVehicle.set(vehicle._id, {
            filled,
            expected,
            missing: Math.max(expected - filled, 0),
        });
    });

    return (
        <div>
            <div className="page-header">
                <div className="page-header-left"><h1 className="page-title">Kendaraan</h1><p className="page-subtitle">Kelola armada kendaraan perusahaan</p></div>
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
                            <tbody>${filtered.map(v => `<tr><td class="b">${v.unitCode || '-'}</td><td>${v.plateNumber}</td><td>${v.brandModel}</td><td>${v.serviceName || '-'}</td><td>${v.vehicleType}</td><td>${v.year}</td><td>${VEHICLE_STATUS_MAP[v.status]?.label || v.status}</td><td class="r">${v.lastOdometer ? `${v.lastOdometer.toLocaleString('id-ID')} km` : '-'}</td><td>${formatDate(v.lastOdometerAt)}</td></tr>`).join('')}</tbody></table>`,
                        });
                    }}>
                        <Printer size={15} /> Print
                    </button>
                    <Link href="/fleet/vehicles/new" className="btn btn-primary"><Plus size={18} /> Tambah Kendaraan</Link>
                </div>
            </div>
            <div className="table-container">
                <div className="table-toolbar">
                    <div className="table-toolbar-left">
                        <div className="table-search"><Search size={16} className="table-search-icon" /><input placeholder="Cari kode unit, plat, merk, kategori..." value={search} onChange={e => setSearch(e.target.value)} /></div>
                        <select className="form-select" style={{ width: 'auto', minWidth: 180 }} value={serviceFilter} onChange={e => setServiceFilter(e.target.value)}>
                            <option value="">Semua Kategori</option>
                            {availableServiceOptions.map(service => <option key={service._id} value={service._id}>{service.code} - {service.name}</option>)}
                        </select>
                        <select className="form-select" style={{ width: 'auto', minWidth: 140 }} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
                            <option value="">Semua Status</option>
                            {Object.entries(VEHICLE_STATUS_MAP).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                        </select>
                    </div>
                </div>
                <div className="table-wrapper table-desktop-only">
                            <table>
                                <thead><tr><th>Kode</th><th>Plat Nomor</th><th>Merk/Model</th><th>Kategori Armada</th><th>Tipe</th><th>Ban Unit</th><th>Tahun</th><th>Status</th><th>Odometer</th><th>Aksi</th></tr></thead>
                        <tbody>
                            {loading ? [1, 2, 3].map(i => <tr key={i}>{[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(j => <td key={j}><div className="skeleton skeleton-text" /></td>)}</tr>) :
                                filtered.length === 0 ? <tr><td colSpan={10}><div className="empty-state"><Car size={48} className="empty-state-icon" /><div className="empty-state-title">Belum ada kendaraan</div></div></td></tr> :
                                    filtered.map(v => (
                                        <tr key={v._id}>
                                            <td className="font-mono text-muted">{v.unitCode}</td>
                                            <td className="font-semibold">{v.plateNumber}</td>
                                            <td>{v.brandModel}</td>
                                            <td>{getServiceLabel(v)}</td>
                                            <td>{v.vehicleType}</td>
                                            <td>
                                                {(() => {
                                                    const summary = tireSummaryByVehicle.get(v._id);
                                                    if (!summary) return '-';
                                                    return (
                                                        <div>
                                                            <div className="font-medium">{summary.filled}/{summary.expected} slot</div>
                                                            <div className="text-muted text-sm">
                                                                {summary.missing > 0 ? `Kurang ${summary.missing}` : 'Lengkap'}
                                                            </div>
                                                        </div>
                                                    );
                                                })()}
                                            </td>
                                            <td>{v.year}</td>
                                            <td><span className={`badge badge-${VEHICLE_STATUS_MAP[v.status]?.color}`}><span className="badge-dot" /> {VEHICLE_STATUS_MAP[v.status]?.label}</span></td>
                                            <td>{v.lastOdometer ? `${v.lastOdometer.toLocaleString()} km` : '-'}</td>
                                            <td><div className="table-actions">
                                                <button className="table-action-btn" onClick={() => router.push(`/fleet/vehicles/${v._id}`)}><Eye size={14} /> Lihat</button>
                                                <button className="table-action-btn" onClick={() => router.push(`/fleet/vehicles/${v._id}/edit`)}><Edit size={14} /> Edit</button>
                                            </div></td>
                                        </tr>
                                    ))}
                        </tbody>
                    </table>
                </div>
                {!loading && (
                    <div className="mobile-record-list">
                        {filtered.length === 0 ? (
                            <div className="mobile-record-card">
                                <div className="mobile-record-title">Belum ada kendaraan</div>
                                <div className="mobile-record-subtitle">Tambahkan kendaraan untuk mulai mengelola armada.</div>
                            </div>
                        ) : filtered.map(v => (
                            <div key={v._id} className="mobile-record-card">
                                <div className="mobile-record-header">
                                    <div>
                                        <div className="mobile-record-title">{v.plateNumber}</div>
                                        <div className="mobile-record-subtitle">{v.brandModel}</div>
                                    </div>
                                    <span className={`badge badge-${VEHICLE_STATUS_MAP[v.status]?.color}`}>
                                        <span className="badge-dot" /> {VEHICLE_STATUS_MAP[v.status]?.label}
                                    </span>
                                </div>
                                <div className="mobile-record-meta">
                                    <div className="mobile-record-kv">
                                        <span className="mobile-record-label">Kode Unit</span>
                                        <span className="mobile-record-value">{v.unitCode || '-'}</span>
                                    </div>
                                    <div className="mobile-record-kv">
                                        <span className="mobile-record-label">Kategori Armada</span>
                                        <span className="mobile-record-value">{getServiceLabel(v)}</span>
                                    </div>
                                    <div className="mobile-record-kv">
                                        <span className="mobile-record-label">Tipe</span>
                                        <span className="mobile-record-value">{v.vehicleType}</span>
                                    </div>
                                    <div className="mobile-record-kv">
                                        <span className="mobile-record-label">Ban Unit</span>
                                        <span className="mobile-record-value">
                                            {(() => {
                                                const summary = tireSummaryByVehicle.get(v._id);
                                                return summary ? `${summary.filled}/${summary.expected} slot${summary.missing > 0 ? ` • kurang ${summary.missing}` : ' • lengkap'}` : '-';
                                            })()}
                                        </span>
                                    </div>
                                    <div className="mobile-record-kv">
                                        <span className="mobile-record-label">Tahun</span>
                                        <span className="mobile-record-value">{v.year}</span>
                                    </div>
                                    <div className="mobile-record-kv">
                                        <span className="mobile-record-label">Odometer</span>
                                        <span className="mobile-record-value">{v.lastOdometer ? `${v.lastOdometer.toLocaleString()} km` : '-'}</span>
                                    </div>
                                </div>
                                <div className="mobile-record-actions">
                                    <button className="btn btn-secondary" onClick={() => router.push(`/fleet/vehicles/${v._id}`)}>
                                        <Eye size={14} /> Lihat
                                    </button>
                                    <button className="btn btn-secondary" onClick={() => router.push(`/fleet/vehicles/${v._id}/edit`)}>
                                        <Edit size={14} /> Edit
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
                {filtered.length > 0 && <div className="pagination"><div className="pagination-info">Menampilkan {filtered.length} kendaraan</div></div>}
            </div>
        </div>
    );
}
