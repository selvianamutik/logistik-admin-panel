'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useToast } from '../../layout';
import { Plus, Search, Eye, AlertTriangle, X } from 'lucide-react';
import AppPagination from '@/components/AppPagination';
import FormattedNumberInput from '@/components/FormattedNumberInput';
import { formatDateTime, INCIDENT_STATUS_MAP, URGENCY_MAP, INCIDENT_TYPE_MAP } from '@/lib/utils';
import { DEFAULT_PAGE_SIZE, paginateItems } from '@/lib/pagination';
import type { Incident, Vehicle, DeliveryOrder } from '@/lib/types';

type IncidentFormState = {
    vehicleRef: string;
    incidentType: Incident['incidentType'];
    urgency: Incident['urgency'];
    locationText: string;
    odometer: number;
    description: string;
    dateTime: string;
    relatedDeliveryOrderRef: string;
};

function getDefaultIncidentDateTime() {
    return new Date().toISOString().slice(0, 16);
}

function createDefaultIncidentForm(vehicle?: Vehicle | null, deliveryOrder?: DeliveryOrder | null): IncidentFormState {
    return {
        vehicleRef: deliveryOrder?.vehicleRef || vehicle?._id || '',
        incidentType: 'OTHER',
        urgency: 'MEDIUM',
        locationText: deliveryOrder?.receiverAddress || '',
        odometer: typeof vehicle?.lastOdometer === 'number' ? vehicle.lastOdometer : 0,
        description: '',
        dateTime: getDefaultIncidentDateTime(),
        relatedDeliveryOrderRef: deliveryOrder?._id || '',
    };
}

function getIncidentNextAction(item: Incident) {
    if (item.status === 'OPEN') {
        return 'Tangani segera dan cek kondisi unit, driver, serta trip terkait';
    }
    if (item.status === 'IN_PROGRESS') {
        return 'Lanjutkan penanganan lalu perbarui status sampai selesai';
    }
    if (item.status === 'RESOLVED') {
        return 'Verifikasi hasil penanganan lalu tutup insiden bila sudah aman';
    }
    return 'Arsip; buka lagi hanya jika ada tindak lanjut tambahan';
}

export default function IncidentsPage() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const { addToast } = useToast();
    const [items, setItems] = useState<Incident[]>([]);
    const [vehicles, setVehicles] = useState<Vehicle[]>([]);
    const [dos, setDos] = useState<DeliveryOrder[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [vehicleFilter, setVehicleFilter] = useState('');
    const [statusFilter, setStatusFilter] = useState('');
    const [page, setPage] = useState(1);
    const [showModal, setShowModal] = useState(false);
    const [saving, setSaving] = useState(false);
    const [prefillApplied, setPrefillApplied] = useState(false);
    const [form, setForm] = useState<IncidentFormState>(createDefaultIncidentForm());

    useEffect(() => {
        const fetchEntity = async <T,>(url: string) => {
            const res = await fetch(url);
            const payload = await res.json();
            if (!res.ok) {
                throw new Error(payload.error || 'Gagal memuat insiden');
            }
            return payload.data as T;
        };

        Promise.all([
            fetchEntity<Incident[]>('/api/data?entity=incidents'),
            fetchEntity<Vehicle[]>('/api/data?entity=vehicles'),
            fetchEntity<DeliveryOrder[]>('/api/data?entity=delivery-orders'),
        ]).then(([incidentRows, vehicleRows, deliveryOrders]) => {
            setItems(incidentRows || []);
            setVehicles((vehicleRows || []).filter(vehicle => vehicle.status !== 'SOLD'));
            setDos(deliveryOrders || []);
        }).catch(error => {
            addToast('error', error instanceof Error ? error.message : 'Gagal memuat insiden');
        }).finally(() => {
            setLoading(false);
        });
    }, [addToast]);

    useEffect(() => {
        if (loading || prefillApplied) {
            return;
        }

        const requestedVehicleRef = searchParams.get('vehicleRef') || '';
        const requestedDeliveryOrderRef = searchParams.get('deliveryOrderRef') || '';
        const shouldOpen = searchParams.get('open') === '1';

        const selectedDeliveryOrder = requestedDeliveryOrderRef
            ? dos.find(deliveryOrder => deliveryOrder._id === requestedDeliveryOrderRef) || null
            : null;
        const selectedVehicle = requestedVehicleRef
            ? vehicles.find(vehicle => vehicle._id === requestedVehicleRef) || null
            : selectedDeliveryOrder?.vehicleRef
                ? vehicles.find(vehicle => vehicle._id === selectedDeliveryOrder.vehicleRef) || null
                : null;

        if (selectedVehicle) {
            setVehicleFilter(selectedVehicle._id);
        }
        if (selectedVehicle || selectedDeliveryOrder) {
            setForm(createDefaultIncidentForm(selectedVehicle, selectedDeliveryOrder));
        }
        if (shouldOpen) {
            setShowModal(true);
        }
        setPrefillApplied(true);
    }, [dos, loading, prefillApplied, searchParams, vehicles]);

    useEffect(() => {
        setPage(1);
    }, [search, vehicleFilter, statusFilter]);

    const handleRelatedDOChange = (deliveryOrderRef: string) => {
        const deliveryOrder = dos.find(item => item._id === deliveryOrderRef);
        setForm(prev => ({
            ...prev,
            relatedDeliveryOrderRef: deliveryOrderRef,
            vehicleRef: deliveryOrderRef ? (deliveryOrder?.vehicleRef || '') : prev.vehicleRef,
            locationText: prev.locationText || deliveryOrder?.receiverAddress || '',
        }));
    };

    const handleVehicleChange = (vehicleRef: string) => {
        const selectedVehicle = vehicles.find(vehicle => vehicle._id === vehicleRef) || null;
        setForm(prev => {
            const relatedDeliveryOrder = prev.relatedDeliveryOrderRef
                ? dos.find(item => item._id === prev.relatedDeliveryOrderRef)
                : undefined;
            const nextRelatedDeliveryOrderRef =
                relatedDeliveryOrder && relatedDeliveryOrder.vehicleRef && relatedDeliveryOrder.vehicleRef !== vehicleRef
                    ? ''
                    : prev.relatedDeliveryOrderRef;

            return {
                ...prev,
                vehicleRef,
                relatedDeliveryOrderRef: nextRelatedDeliveryOrderRef,
                odometer: prev.odometer || selectedVehicle?.lastOdometer || 0,
            };
        });
    };

    const selectableVehicleIds = new Set(vehicles.map(vehicle => vehicle._id));
    const selectableDos = dos.filter(deliveryOrder => !deliveryOrder.vehicleRef || selectableVehicleIds.has(deliveryOrder.vehicleRef));
    const filteredDos = form.vehicleRef
        ? selectableDos.filter(deliveryOrder => !deliveryOrder.vehicleRef || deliveryOrder.vehicleRef === form.vehicleRef)
        : selectableDos;
    const selectedVehicle = vehicles.find(vehicle => vehicle._id === form.vehicleRef) || null;
    const selectedRelatedDO = dos.find(deliveryOrder => deliveryOrder._id === form.relatedDeliveryOrderRef) || null;

    const openIncidentModal = (vehicle?: Vehicle | null, deliveryOrder?: DeliveryOrder | null) => {
        setForm(createDefaultIncidentForm(vehicle, deliveryOrder));
        setShowModal(true);
    };

    const closeIncidentModal = () => {
        if (saving) return;
        const filteredVehicle = vehicles.find(vehicle => vehicle._id === vehicleFilter) || null;
        setShowModal(false);
        setForm(createDefaultIncidentForm(filteredVehicle));
    };

    const filtered = items
        .filter(item => {
            const matchesSearch =
                !search
                || item.incidentNumber?.toLowerCase().includes(search.toLowerCase())
                || item.vehiclePlate?.toLowerCase().includes(search.toLowerCase())
                || item.driverName?.toLowerCase().includes(search.toLowerCase())
                || item.relatedDONumber?.toLowerCase().includes(search.toLowerCase())
                || item.locationText?.toLowerCase().includes(search.toLowerCase());
            const matchesVehicle = !vehicleFilter || item.vehicleRef === vehicleFilter;
            const matchesStatus = !statusFilter || item.status === statusFilter;
            return matchesSearch && matchesVehicle && matchesStatus;
        })
        .sort((left, right) => {
            const statusRank = (status: Incident['status']) => {
                if (status === 'OPEN') return 0;
                if (status === 'IN_PROGRESS') return 1;
                if (status === 'RESOLVED') return 2;
                return 3;
            };
            const byStatus = statusRank(left.status) - statusRank(right.status);
            if (byStatus !== 0) return byStatus;
            return right.dateTime.localeCompare(left.dateTime);
        });
    const paginatedIncidents = paginateItems(filtered, page, DEFAULT_PAGE_SIZE);

    const handleSave = async () => {
        if ((!form.vehicleRef && !form.relatedDeliveryOrderRef) || !form.description) {
            addToast('error', 'Kendaraan atau DO terkait serta deskripsi wajib');
            return;
        }
        const veh = vehicles.find(v => v._id === form.vehicleRef);
        const doData = dos.find(d => d._id === form.relatedDeliveryOrderRef);
        setSaving(true);
        try {
            const res = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ entity: 'incidents', data: { ...form, vehiclePlate: veh?.plateNumber, relatedDONumber: doData?.doNumber } }),
            });
            const result = await res.json();
            if (!res.ok) {
                addToast('error', result.error || 'Gagal membuat insiden');
                return;
            }
            setItems(prev => [...prev, result.data]);
            setForm(createDefaultIncidentForm(vehicleFilter ? vehicles.find(vehicle => vehicle._id === vehicleFilter) || null : null));
            addToast('success', `Insiden dilaporkan: ${result.data?.incidentNumber || ''}`);
            setShowModal(false);
        } catch {
            addToast('error', 'Gagal membuat insiden');
        } finally {
            setSaving(false);
        }
    };

    const openIncidentCount = items.filter(item => item.status === 'OPEN').length;
    const progressIncidentCount = items.filter(item => item.status === 'IN_PROGRESS').length;
    const resolvedIncidentCount = items.filter(item => item.status === 'RESOLVED').length;

    return (
        <div>
            <div className="page-header">
                <div className="page-header-left">
                    <h1 className="page-title">Insiden Kendaraan</h1>
                    <p className="page-subtitle">Antrian insiden armada yang perlu ditangani, diverifikasi, atau diarsipkan.</p>
                </div>
                <div className="page-actions">
                    <button className="btn btn-primary" onClick={() => openIncidentModal(vehicleFilter ? vehicles.find(vehicle => vehicle._id === vehicleFilter) || null : null)}>
                        <Plus size={18} /> Laporkan Insiden
                    </button>
                </div>
            </div>
            <div className="kpi-grid" style={{ marginBottom: '1.5rem' }}>
                <div className="kpi-card"><div className="kpi-icon danger"><AlertTriangle size={20} /></div><div className="kpi-content"><div className="kpi-label">Terbuka</div><div className="kpi-value">{openIncidentCount}</div></div></div>
                <div className="kpi-card"><div className="kpi-icon warning"><AlertTriangle size={20} /></div><div className="kpi-content"><div className="kpi-label">Ditangani</div><div className="kpi-value">{progressIncidentCount}</div></div></div>
                <div className="kpi-card"><div className="kpi-icon success"><AlertTriangle size={20} /></div><div className="kpi-content"><div className="kpi-label">Selesai</div><div className="kpi-value">{resolvedIncidentCount}</div></div></div>
            </div>

            <div className="table-container">
                <div className="table-toolbar">
                    <div className="table-toolbar-left">
                        <div className="table-search">
                            <Search size={16} className="table-search-icon" />
                            <input placeholder="Cari nomor, kendaraan, supir, DO, lokasi..." value={search} onChange={e => setSearch(e.target.value)} />
                        </div>
                        <select className="form-select" style={{ width: 'auto', minWidth: 180 }} value={vehicleFilter} onChange={e => setVehicleFilter(e.target.value)}>
                            <option value="">Semua Kendaraan</option>
                            {vehicles.map(vehicle => <option key={vehicle._id} value={vehicle._id}>{vehicle.plateNumber} - {vehicle.brandModel}</option>)}
                        </select>
                        <select className="form-select" style={{ width: 'auto', minWidth: 160 }} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
                            <option value="">Semua Status</option>
                            {Object.entries(INCIDENT_STATUS_MAP).map(([key, meta]) => <option key={key} value={key}>{meta.label}</option>)}
                        </select>
                    </div>
                </div>
                <div className="table-wrapper table-desktop-only">
                    <table>
                        <thead><tr><th>No.</th><th>Waktu</th><th>Kendaraan</th><th>Supir</th><th>DO</th><th>Tipe</th><th>Lokasi</th><th>Urgency</th><th>Status</th><th>Tindak Lanjut</th><th>Aksi</th></tr></thead>
                        <tbody>
                            {loading ? [1, 2].map(i => <tr key={i}>{[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map(j => <td key={j}><div className="skeleton skeleton-text" /></td>)}</tr>) :
                                paginatedIncidents.totalItems === 0 ? <tr><td colSpan={11}><div className="empty-state"><AlertTriangle size={48} className="empty-state-icon" /><div className="empty-state-title">Tidak ada insiden</div></div></td></tr> :
                                    paginatedIncidents.items.map(item => (
                                        <tr key={item._id}>
                                            <td><Link href={`/fleet/incidents/${item._id}`} className="font-semibold" style={{ color: 'var(--color-primary)' }}>{item.incidentNumber}</Link></td>
                                            <td className="text-muted" style={{ whiteSpace: 'nowrap' }}>{formatDateTime(item.dateTime)}</td>
                                            <td>{item.vehicleRef ? <Link href={`/fleet/vehicles/${item.vehicleRef}`} style={{ color: 'var(--color-primary)' }}>{item.vehiclePlate || '-'}</Link> : (item.vehiclePlate || '-')}</td>
                                            <td>{item.driverName || '-'}</td>
                                            <td>{item.relatedDONumber || '-'}</td>
                                            <td>{INCIDENT_TYPE_MAP[item.incidentType] || item.incidentType}</td>
                                            <td>{item.locationText}</td>
                                            <td><span className={`badge badge-${URGENCY_MAP[item.urgency]?.color}`}>{URGENCY_MAP[item.urgency]?.label}</span></td>
                                            <td><span className={`badge badge-${INCIDENT_STATUS_MAP[item.status]?.color}`}><span className="badge-dot" /> {INCIDENT_STATUS_MAP[item.status]?.label}</span></td>
                                            <td>{getIncidentNextAction(item)}</td>
                                            <td><button className="table-action-btn" onClick={() => router.push(`/fleet/incidents/${item._id}`)}><Eye size={14} /> Lihat</button></td>
                                        </tr>
                                    ))}
                        </tbody>
                    </table>
                </div>
                {!loading && (
                    <div className="mobile-record-list">
                        {paginatedIncidents.totalItems === 0 ? (
                            <div className="mobile-record-card">
                                <div className="mobile-record-title">Tidak ada insiden</div>
                                <div className="mobile-record-subtitle">Laporan insiden kendaraan akan muncul di sini.</div>
                            </div>
                        ) : paginatedIncidents.items.map(item => (
                            <div key={item._id} className="mobile-record-card">
                                <div className="mobile-record-header">
                                    <div>
                                        <div className="mobile-record-title">{item.incidentNumber}</div>
                                        <div className="mobile-record-subtitle">{item.vehiclePlate || '-'} / {formatDateTime(item.dateTime)}</div>
                                    </div>
                                    <span className={`badge badge-${INCIDENT_STATUS_MAP[item.status]?.color}`}>
                                        <span className="badge-dot" /> {INCIDENT_STATUS_MAP[item.status]?.label}
                                    </span>
                                </div>
                                <div className="mobile-record-meta">
                                    <div className="mobile-record-kv">
                                        <span className="mobile-record-label">Supir</span>
                                        <span className="mobile-record-value">{item.driverName || '-'}</span>
                                    </div>
                                    <div className="mobile-record-kv">
                                        <span className="mobile-record-label">DO</span>
                                        <span className="mobile-record-value">{item.relatedDONumber || '-'}</span>
                                    </div>
                                    <div className="mobile-record-kv">
                                        <span className="mobile-record-label">Tipe</span>
                                        <span className="mobile-record-value">{INCIDENT_TYPE_MAP[item.incidentType] || item.incidentType}</span>
                                    </div>
                                    <div className="mobile-record-kv">
                                        <span className="mobile-record-label">Lokasi</span>
                                        <span className="mobile-record-value">{item.locationText || '-'}</span>
                                    </div>
                                    <div className="mobile-record-kv">
                                        <span className="mobile-record-label">Urgency</span>
                                        <span className="mobile-record-value">{URGENCY_MAP[item.urgency]?.label || item.urgency}</span>
                                    </div>
                                    <div className="mobile-record-kv">
                                        <span className="mobile-record-label">Tindak Lanjut</span>
                                        <span className="mobile-record-value">{getIncidentNextAction(item)}</span>
                                    </div>
                                </div>
                                <div className="mobile-record-actions">
                                    {item.vehicleRef && (
                                        <button className="btn btn-secondary" onClick={() => router.push(`/fleet/vehicles/${item.vehicleRef}`)}>
                                            Unit
                                        </button>
                                    )}
                                    <button className="btn btn-secondary" onClick={() => router.push(`/fleet/incidents/${item._id}`)}>
                                        <Eye size={14} /> Lihat
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
                {paginatedIncidents.totalItems > 0 && (
                    <AppPagination
                        page={paginatedIncidents.currentPage}
                        pageSize={DEFAULT_PAGE_SIZE}
                        totalItems={paginatedIncidents.totalItems}
                        onPageChange={setPage}
                        info={({ startIndex, endIndex, totalItems }) => (
                            <>Menampilkan {startIndex}-{endIndex} dari {totalItems} insiden</>
                        )}
                    />
                )}
            </div>

            {showModal && (
                <div className="modal-overlay" onClick={closeIncidentModal}>
                    <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
                        <div className="modal-header"><h3 className="modal-title">Laporkan Insiden</h3><button className="modal-close" onClick={closeIncidentModal} disabled={saving}><X size={20} /></button></div>
                        <div className="modal-body">
                            <div className="form-row">
                                <div className="form-group"><label className="form-label">Kendaraan <span className="required">*</span></label>
                                    <select className="form-select" value={form.vehicleRef} onChange={e => handleVehicleChange(e.target.value)} disabled={Boolean(form.relatedDeliveryOrderRef)}><option value="">Pilih</option>{vehicles.map(v => <option key={v._id} value={v._id}>{v.plateNumber}</option>)}</select>
                                    {form.relatedDeliveryOrderRef && (
                                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
                                            Kendaraan mengikuti DO terkait. Hapus pilihan DO dulu jika ingin mengganti kendaraan.
                                        </div>
                                    )}
                                </div>
                                <div className="form-group"><label className="form-label">Waktu Insiden</label><input type="datetime-local" className="form-input" value={form.dateTime} onChange={e => setForm({ ...form, dateTime: e.target.value })} /></div>
                            </div>
                            {(selectedVehicle || selectedRelatedDO) && (
                                <div style={{ padding: '0.85rem 1rem', borderRadius: '0.75rem', background: 'var(--color-gray-50)', border: '1px solid var(--color-gray-200)', marginBottom: '1rem' }}>
                                    <div className="text-muted text-sm">Konteks unit</div>
                                    <div className="font-medium">
                                        {selectedVehicle?.plateNumber || selectedRelatedDO?.vehiclePlate || '-'}
                                        {selectedVehicle?.brandModel ? ` - ${selectedVehicle.brandModel}` : ''}
                                    </div>
                                    <div className="text-muted text-sm" style={{ marginTop: '0.25rem' }}>
                                        {selectedRelatedDO
                                            ? `DO ${selectedRelatedDO.customerDoNumber || selectedRelatedDO.doNumber || '-'} / driver ${selectedRelatedDO.driverName || '-'}`
                                            : `Odometer terakhir ${typeof selectedVehicle?.lastOdometer === 'number' ? `${selectedVehicle.lastOdometer.toLocaleString()} km` : 'belum diisi'}`}
                                    </div>
                                </div>
                            )}
                            <div className="form-row">
                                <div className="form-group"><label className="form-label">Tipe Insiden</label>
                                    <select className="form-select" value={form.incidentType} onChange={e => setForm({ ...form, incidentType: e.target.value as Incident['incidentType'] })}>
                                        {Object.entries(INCIDENT_TYPE_MAP).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                                    </select></div>
                                <div className="form-group"><label className="form-label">Urgency</label>
                                    <select className="form-select" value={form.urgency} onChange={e => setForm({ ...form, urgency: e.target.value as Incident['urgency'] })}>
                                        {Object.entries(URGENCY_MAP).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                                    </select></div>
                            </div>
                            <div className="form-row">
                                <div className="form-group"><label className="form-label">Lokasi</label><input className="form-input" value={form.locationText} onChange={e => setForm({ ...form, locationText: e.target.value })} placeholder="Tol Cikampek KM 45..." /></div>
                                <div className="form-group"><label className="form-label">Odometer</label><FormattedNumberInput allowDecimal={false} value={form.odometer} onValueChange={value => setForm({ ...form, odometer: value })} /></div>
                            </div>
                            <div className="form-group"><label className="form-label">DO Terkait (Opsional)</label>
                                <select className="form-select" value={form.relatedDeliveryOrderRef} onChange={e => handleRelatedDOChange(e.target.value)}><option value="">- Tidak ada -</option>{filteredDos.map(deliveryOrder => <option key={deliveryOrder._id} value={deliveryOrder._id}>{deliveryOrder.customerDoNumber || deliveryOrder.doNumber}</option>)}</select></div>
                            <div className="form-group"><label className="form-label">Kronologi / Deskripsi <span className="required">*</span></label><textarea className="form-textarea" rows={4} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Jelaskan kronologi insiden secara detail..." /></div>
                        </div>
                        <div className="modal-footer"><button className="btn btn-secondary" onClick={closeIncidentModal} disabled={saving}>Batal</button><button className="btn btn-danger" onClick={handleSave} disabled={saving}><AlertTriangle size={16} /> {saving ? 'Menyimpan...' : 'Laporkan Insiden'}</button></div>
                    </div>
                </div>
            )}
        </div>
    );
}
