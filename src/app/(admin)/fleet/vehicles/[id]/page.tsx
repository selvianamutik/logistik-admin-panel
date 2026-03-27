'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useApp, useToast } from '../../../layout';
import { Car, Wrench, AlertTriangle, Truck, Edit, Plus, Disc3, Warehouse, ExternalLink, Save } from 'lucide-react';
import {
    VEHICLE_STATUS_MAP,
    MAINTENANCE_STATUS_MAP,
    INCIDENT_STATUS_MAP,
    DO_STATUS_MAP,
    TIRE_ASSET_STATUS_MAP,
    formatDate,
    formatCurrency,
} from '@/lib/utils';
import {
    formatTireSlotLabel,
    resolveTireSlotCode,
} from '@/lib/tire-slots';
import type { Vehicle, Maintenance, Incident, DeliveryOrder, TireEvent, Expense } from '@/lib/types';
import PageBackButton from '@/components/PageBackButton';
import { fetchAllAdminCollectionData } from '@/lib/api/admin-client';
import { hasPermission } from '@/lib/rbac';
import {
    buildVehicleTireDetailState,
    createDefaultVehicleTireForm,
    getVehicleTabs,
    type NormalizedVehicleTireRow,
    type VehicleTireFormState,
    VEHICLE_TIRE_TYPE_OPTIONS,
} from '@/lib/vehicle-detail-page-support';

export default function VehicleDetailPage() {
    const params = useParams();
    const router = useRouter();
    const searchParams = useSearchParams();
    const { user } = useApp();
    const { addToast } = useToast();
    const vehicleId = params.id as string;
    const [vehicle, setVehicle] = useState<Vehicle | null>(null);
    const [maints, setMaints] = useState<Maintenance[]>([]);
    const [incidents, setIncidents] = useState<Incident[]>([]);
    const [dos, setDos] = useState<DeliveryOrder[]>([]);
    const [tireEvents, setTireEvents] = useState<TireEvent[]>([]);
    const [allTireEvents, setAllTireEvents] = useState<TireEvent[]>([]);
    const [expenses, setExpenses] = useState<Expense[]>([]);
    const [loading, setLoading] = useState(true);
    const [tab, setTab] = useState('profil');
    const [showTireModal, setShowTireModal] = useState(false);
    const [tireForm, setTireForm] = useState<VehicleTireFormState>(createDefaultVehicleTireForm());
    const [editingTire, setEditingTire] = useState<TireEvent | null>(null);
    const [savingTire, setSavingTire] = useState(false);
    const isOwner = user?.role === 'OWNER';
    const canManageVehicle = user ? hasPermission(user.role, 'vehicles', 'update') : false;
    const canCreateMaintenance = user ? hasPermission(user.role, 'maintenance', 'create') : false;
    const canCreateIncident = user ? hasPermission(user.role, 'incidents', 'create') : false;
    const canManageTires = user ? hasPermission(user.role, 'tires', 'update') : false;
    const canViewVehicleExpenses = user ? hasPermission(user.role, 'expenses', 'view') : false;
    const vehicleTabs = getVehicleTabs(isOwner);

    const loadVehicleDetail = useCallback(async () => {
        setLoading(true);
        try {
            const vehicleFilter = encodeURIComponent(JSON.stringify({ vehicleRef: vehicleId }));
            const expenseFilter = encodeURIComponent(JSON.stringify({ relatedVehicleRef: vehicleId }));
            const [vehicleData, maintenanceRows, incidentRows, doRows, tireRows, allTireRows, expenseRows] = await Promise.all([
                fetch(`/api/data?entity=vehicles&id=${vehicleId}`).then(async res => {
                    const payload = await res.json();
                    if (!res.ok) throw new Error(payload.error || 'Gagal memuat kendaraan');
                    return payload.data as Vehicle | null;
                }),
                fetchAllAdminCollectionData<Maintenance>(`/api/data?entity=maintenances&filter=${vehicleFilter}`, 'Gagal memuat maintenance'),
                fetchAllAdminCollectionData<Incident>(`/api/data?entity=incidents&filter=${vehicleFilter}`, 'Gagal memuat insiden'),
                fetchAllAdminCollectionData<DeliveryOrder>(`/api/data?entity=delivery-orders&filter=${vehicleFilter}`, 'Gagal memuat riwayat DO'),
                fetchAllAdminCollectionData<TireEvent>(`/api/data?entity=tire-events&filter=${vehicleFilter}`, 'Gagal memuat catatan ban'),
                fetchAllAdminCollectionData<TireEvent>('/api/data?entity=tire-events', 'Gagal memuat master ban'),
                canViewVehicleExpenses
                    ? fetchAllAdminCollectionData<Expense>(`/api/data?entity=expenses&filter=${expenseFilter}`, 'Gagal memuat biaya kendaraan')
                    : Promise.resolve([] as Expense[]),
            ]);

            setVehicle(vehicleData);
            setMaints(maintenanceRows || []);
            setIncidents(incidentRows || []);
            setDos(doRows || []);
            setTireEvents(tireRows || []);
            setAllTireEvents(allTireRows || []);
            setExpenses(expenseRows || []);
        } catch (error) {
            addToast('error', error instanceof Error ? error.message : 'Gagal memuat detail kendaraan');
        } finally {
            setLoading(false);
        }
    }, [addToast, canViewVehicleExpenses, vehicleId]);

    useEffect(() => {
        void loadVehicleDetail();
    }, [loadVehicleDetail]);

    useEffect(() => {
        const requestedTab = searchParams.get('tab');
        if (requestedTab && vehicleTabs.includes(requestedTab)) {
            setTab(requestedTab);
            return;
        }
        setTab('profil');
    }, [searchParams, vehicleTabs]);

    if (loading) return <div><div className="skeleton skeleton-title" /><div className="skeleton skeleton-card" style={{ height: 300 }} /></div>;
    if (!vehicle) return <div className="empty-state"><div className="empty-state-title">Kendaraan tidak ditemukan</div></div>;

    const totalExpenses = expenses.reduce((s, e) => s + e.amount, 0);
    const activeDeliveryOrder = dos.find(deliveryOrder => ['CREATED', 'HEADING_TO_PICKUP', 'ON_DELIVERY', 'ARRIVED'].includes(deliveryOrder.status));
    const {
        normalizedAllTireRows,
        layout,
        mountedSlots,
        spareSlots,
        filledSlotCount,
        emptySlotCount,
        externalAuditTires,
        selectedRegisteredTire,
        tireSelectionLocked,
        availableRegisteredTires,
    } = buildVehicleTireDetailState({
        vehicle,
        tireEvents,
        allTireEvents,
        tireForm,
        editingTire,
    });

    const updateTireForm = <K extends keyof VehicleTireFormState>(key: K, value: VehicleTireFormState[K]) => {
        setTireForm(prev => ({ ...prev, [key]: value }));
    };

    const closeTireModal = () => {
        if (savingTire) return;
        setShowTireModal(false);
        setEditingTire(null);
        setTireForm(createDefaultVehicleTireForm(layout.allSlots[0] || '1L'));
    };

    const openNewTire = (slotCode: string) => {
        setEditingTire(null);
        setTireForm(createDefaultVehicleTireForm(slotCode));
        setShowTireModal(true);
    };

    const openVehicleMaintenance = () => {
        router.push(`/fleet/maintenance?vehicleRef=${vehicle._id}&open=1`);
    };

    const openVehicleIncident = () => {
        const params = new URLSearchParams({ vehicleRef: vehicle._id, open: '1' });
        if (activeDeliveryOrder?._id) {
            params.set('deliveryOrderRef', activeDeliveryOrder._id);
        }
        router.push(`/fleet/incidents?${params.toString()}`);
    };

    const openEditTire = (event: TireEvent) => {
        const resolvedSlot = resolveTireSlotCode(event) || layout.allSlots[0] || '1L';
        setEditingTire(event);
        setTireForm({
            registeredTireId: event._id,
            tireCode: event.tireCode || '',
            slotCode: resolvedSlot,
            tireType: event.tireType,
            tireBrand: event.tireBrand,
            tireSize: event.tireSize,
            installDate: event.installDate,
            notes: event.notes || '',
        });
        setShowTireModal(true);
    };

    const handleRegisteredTireChange = (registeredTireId: string) => {
        if (!registeredTireId) {
            setTireForm(prev => ({
                ...createDefaultVehicleTireForm(prev.slotCode),
                slotCode: prev.slotCode,
                installDate: prev.installDate,
            }));
            return;
        }

        const pickedTire = normalizedAllTireRows.find(row => row._id === registeredTireId);
        if (!pickedTire) {
            return;
        }

        setTireForm(prev => ({
            ...prev,
            registeredTireId,
            tireCode: pickedTire.tireCode || '',
            tireType: pickedTire.tireType,
            tireBrand: pickedTire.tireBrand,
            tireSize: pickedTire.tireSize,
        }));
    };

    const handleTabChange = (nextTab: string) => {
        setTab(nextTab);
        const nextParams = new URLSearchParams(searchParams.toString());
        if (nextTab === 'profil') {
            nextParams.delete('tab');
        } else {
            nextParams.set('tab', nextTab);
        }
        const nextQuery = nextParams.toString();
        router.replace(nextQuery ? `/fleet/vehicles/${vehicleId}?${nextQuery}` : `/fleet/vehicles/${vehicleId}`, { scroll: false });
    };

    const handleSaveTire = async () => {
        if (!tireForm.tireCode.trim()) { addToast('error', 'Isi kode ban'); return; }
        if (!tireForm.tireBrand.trim()) { addToast('error', 'Isi merk/tipe ban'); return; }
        if (!tireForm.tireSize.trim()) { addToast('error', 'Isi ukuran ban'); return; }
        if (!tireForm.slotCode.trim()) { addToast('error', 'Pilih slot ban'); return; }

        const normalizedSlotCode = tireForm.slotCode.trim().toUpperCase();
        const payload = {
            tireCode: tireForm.tireCode.trim().toUpperCase().replace(/\s+/g, '-'),
            holderType: 'INTERNAL_VEHICLE',
            status: normalizedSlotCode.startsWith('SP') ? 'SPARE' : 'IN_USE',
            vehicleRef: vehicle._id,
            slotCode: normalizedSlotCode,
            tireType: tireForm.tireType,
            tireBrand: tireForm.tireBrand.trim(),
            tireSize: tireForm.tireSize.trim(),
            installDate: tireForm.installDate,
            notes: tireForm.notes.trim() || undefined,
        };

        setSavingTire(true);
        try {
            const targetTireId = editingTire?._id || tireForm.registeredTireId;
            const res = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(
                    targetTireId
                        ? { entity: 'tire-events', action: 'update', data: { id: targetTireId, updates: payload } }
                        : { entity: 'tire-events', data: payload }
                ),
            });
            const result = await res.json();
            if (!res.ok) {
                addToast('error', result.error || 'Gagal menyimpan ban');
                return;
            }
            addToast('success', targetTireId ? 'Ban pada unit berhasil diperbarui' : 'Ban berhasil dipasang ke unit');
            closeTireModal();
            await loadVehicleDetail();
        } catch {
            addToast('error', 'Gagal menyimpan ban');
        } finally {
            setSavingTire(false);
        }
    };

    const renderSlotCard = (slotCode: string, event?: NormalizedVehicleTireRow) => (
        <div
            key={slotCode}
            style={{
                border: '1px solid var(--color-gray-200)',
                borderRadius: '0.9rem',
                padding: '1rem',
                display: 'grid',
                gap: '0.65rem',
                background: event ? 'var(--color-white)' : 'var(--color-gray-50)',
            }}
        >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'flex-start' }}>
                <div>
                    <div style={{ fontWeight: 700 }}>{slotCode}</div>
                    <div className="text-muted text-sm">{formatTireSlotLabel(slotCode)}</div>
                </div>
                <span className={`badge badge-${event ? (TIRE_ASSET_STATUS_MAP[event.status]?.color || 'gray') : 'gray'}`}>
                    <span className="badge-dot" /> {event ? (TIRE_ASSET_STATUS_MAP[event.status]?.label || event.status) : 'Belum Diisi'}
                </span>
            </div>

            {event ? (
                <>
                    <div>
                        <div className="font-medium">{event.tireCodeLabel}</div>
                        <div className="text-muted text-sm">{event.tireBrand} • {event.tireSize}</div>
                        <div className="text-muted text-sm">{event.tireType} • dicatat {formatDate(event.installDate)}</div>
                    </div>
                    <div className="text-muted text-sm">{event.notes || 'Belum ada catatan tambahan.'}</div>
                    {canManageTires && <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                        <button className="btn btn-secondary" type="button" onClick={() => openEditTire(event)}>
                            <Edit size={14} /> Edit Ban
                        </button>
                    </div>}
                </>
            ) : (
                <>
                    {canManageTires && <div>
                        <button className="btn btn-primary" type="button" onClick={() => openNewTire(slotCode)}>
                            <Plus size={14} /> Isi Slot
                        </button>
                    </div>}
                </>
            )}
        </div>
    );

    return (
        <div>
            <div className="page-header">
                <div className="page-header-left">
                    <PageBackButton href="/fleet/vehicles" />
                    <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        {vehicle.plateNumber}
                        <span className={`badge badge-${VEHICLE_STATUS_MAP[vehicle.status]?.color}`}><span className="badge-dot" /> {VEHICLE_STATUS_MAP[vehicle.status]?.label}</span>
                    </h1>
                    <p className="page-subtitle">{vehicle.brandModel} - {vehicle.unitCode}</p>
                </div>
                <div className="page-actions">
                    {canCreateMaintenance && <button className="btn btn-secondary" onClick={openVehicleMaintenance}>
                        <Wrench size={16} /> Jadwalkan Servis
                    </button>}
                    {canCreateIncident && <button className="btn btn-secondary" onClick={openVehicleIncident}>
                        <AlertTriangle size={16} /> Laporkan Insiden
                    </button>}
                    {canManageVehicle && <button className="btn btn-secondary" onClick={() => router.push(`/fleet/vehicles/${vehicle._id}/edit`)}>
                        <Edit size={16} /> Edit Kendaraan
                    </button>}
                </div>
            </div>

            <div className="tabs">
                {vehicleTabs.map(t => (
                    <button key={t} className={`tab ${tab === t ? 'active' : ''}`} onClick={() => handleTabChange(t)}>
                        {t === 'profil' ? 'Profil' : t === 'do' ? 'Riwayat DO' : t === 'maintenance' ? 'Maintenance' : t === 'ban' ? 'Ban' : t === 'insiden' ? 'Insiden' : 'Biaya'}
                    </button>
                ))}
            </div>

            {tab === 'profil' && (
                <div className="card">
                    <div className="card-body">
                        <div className="detail-grid">
                            <div>
                                <div className="detail-row"><div className="detail-item"><div className="detail-label">Kode Unit</div><div className="detail-value font-mono">{vehicle.unitCode}</div></div><div className="detail-item"><div className="detail-label">Plat Nomor</div><div className="detail-value font-semibold">{vehicle.plateNumber}</div></div></div>
                                <div className="detail-row"><div className="detail-item"><div className="detail-label">Tipe</div><div className="detail-value">{vehicle.vehicleType}</div></div><div className="detail-item"><div className="detail-label">Tahun</div><div className="detail-value">{vehicle.year}</div></div></div>
                                <div className="detail-row"><div className="detail-item"><div className="detail-label">Kategori Truk / Armada</div><div className="detail-value">{vehicle.serviceName || '-'}</div></div><div className="detail-item"><div className="detail-label">Base</div><div className="detail-value">{vehicle.base || '-'}</div></div></div>
                                <div className="detail-row"><div className="detail-item"><div className="detail-label">Merk/Model</div><div className="detail-value">{vehicle.brandModel}</div></div><div className="detail-item"><div className="detail-label">Kapasitas (kg)</div><div className="detail-value">{vehicle.capacityKg || '-'}</div></div></div>
                                <div className="detail-row"><div className="detail-item"><div className="detail-label">Kapasitas Vol (m3)</div><div className="detail-value">{vehicle.capacityVolume || '-'}</div></div><div className="detail-item"><div className="detail-label">Tanggal Update</div><div className="detail-value">{formatDate(vehicle.lastOdometerAt)}</div></div></div>
                                {isOwner && <div className="detail-row"><div className="detail-item"><div className="detail-label">No. Rangka</div><div className="detail-value font-mono">{vehicle.chassisNumber || '-'}</div></div><div className="detail-item"><div className="detail-label">No. Mesin</div><div className="detail-value font-mono">{vehicle.engineNumber || '-'}</div></div></div>}
                                <div className="detail-row"><div className="detail-item"><div className="detail-label">Odometer Terakhir</div><div className="detail-value">{vehicle.lastOdometer ? `${vehicle.lastOdometer.toLocaleString()} km` : '-'}</div></div><div className="detail-item"><div className="detail-label">Catatan</div><div className="detail-value">{vehicle.notes || '-'}</div></div></div>
                            </div>
                            <div>
                                {activeDeliveryOrder && (
                                    <div style={{ marginBottom: '1rem', padding: '0.9rem 1rem', borderRadius: '0.8rem', border: '1px solid var(--color-primary-soft)', background: 'var(--color-primary-surface)' }}>
                                        <div className="text-muted text-sm">Trip Aktif Kendaraan</div>
                                        <div className="font-medium" style={{ marginTop: '0.2rem' }}>
                                            {activeDeliveryOrder.customerDoNumber || activeDeliveryOrder.doNumber} - {activeDeliveryOrder.customerName}
                                        </div>
                                        <div className="text-muted text-sm" style={{ marginTop: '0.25rem' }}>
                                            Status {DO_STATUS_MAP[activeDeliveryOrder.status]?.label || activeDeliveryOrder.status}. Gunakan tombol servis atau insiden di atas jika ada kejadian pada trip ini.
                                        </div>
                                    </div>
                                )}
                                <div className="kpi-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
                                    <div className="kpi-card"><div className="kpi-icon info"><Truck size={20} /></div><div className="kpi-content"><div className="kpi-label">Total DO</div><div className="kpi-value">{dos.length}</div></div></div>
                                    <div className="kpi-card"><div className="kpi-icon warning"><Wrench size={20} /></div><div className="kpi-content"><div className="kpi-label">Maintenance</div><div className="kpi-value">{maints.length}</div></div></div>
                                    <div className="kpi-card"><div className="kpi-icon danger"><AlertTriangle size={20} /></div><div className="kpi-content"><div className="kpi-label">Insiden</div><div className="kpi-value">{incidents.length}</div></div></div>
                                    <div className="kpi-card"><div className="kpi-icon success"><Disc3 size={20} /></div><div className="kpi-content"><div className="kpi-label">Slot Ban Terisi</div><div className="kpi-value">{filledSlotCount}/{layout.allSlots.length}</div></div></div>
                                    {isOwner && <div className="kpi-card"><div className="kpi-icon primary"><Car size={20} /></div><div className="kpi-content"><div className="kpi-label">Total Biaya</div><div className="kpi-value" style={{ fontSize: '1rem' }}>{formatCurrency(totalExpenses)}</div></div></div>}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {tab === 'do' && (
                <div className="card">
                    <div className="card-header">
                        <div>
                            <span className="card-header-title">Riwayat Trip Unit</span>
                        </div>
                    </div>
                    <div className="card-body">
                        <div className="table-wrapper table-desktop-only"><table>
                            <thead><tr><th>No. DO</th><th>Tanggal</th><th>Customer</th><th>Status</th></tr></thead>
                            <tbody>{dos.length === 0 ? <tr><td colSpan={4} className="text-center text-muted" style={{ padding: '2rem' }}>Belum ada riwayat DO</td></tr> : dos.map(d => (
                                <tr key={d._id}><td><a href={`/delivery-orders/${d._id}`} className="font-semibold" style={{ color: 'var(--color-primary)' }}>{d.customerDoNumber || d.doNumber}</a></td><td>{formatDate(d.date)}</td><td>{d.customerName}</td><td><span className={`badge badge-${DO_STATUS_MAP[d.status]?.color}`}>{DO_STATUS_MAP[d.status]?.label}</span></td></tr>
                            ))}</tbody>
                        </table></div>
                        <div className="mobile-record-list">
                            {dos.length === 0 ? (
                                <div className="mobile-record-card">
                                    <div className="mobile-record-title">Belum ada riwayat trip</div>
                                </div>
                            ) : dos.map(d => (
                                <div key={d._id} className="mobile-record-card">
                                    <div className="mobile-record-header">
                                        <div>
                                            <div className="mobile-record-title">{d.customerDoNumber || d.doNumber}</div>
                                            <div className="mobile-record-subtitle">{d.customerName}</div>
                                        </div>
                                        <span className={`badge badge-${DO_STATUS_MAP[d.status]?.color}`}>{DO_STATUS_MAP[d.status]?.label}</span>
                                    </div>
                                    <div className="mobile-record-meta">
                                        <div className="mobile-record-kv">
                                            <span className="mobile-record-label">Tanggal</span>
                                            <span className="mobile-record-value">{formatDate(d.date)}</span>
                                        </div>
                                        <div className="mobile-record-kv">
                                            <span className="mobile-record-label">Driver</span>
                                            <span className="mobile-record-value">{d.driverName || '-'}</span>
                                        </div>
                                    </div>
                                    <div className="mobile-record-actions">
                                        <button className="btn btn-secondary" onClick={() => router.push(`/delivery-orders/${d._id}`)}>Lihat Trip</button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {tab === 'maintenance' && (
                <div className="card">
                    <div className="card-header" style={{ justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
                        <div>
                            <span className="card-header-title">Servis & Maintenance</span>
                        </div>
                        {canCreateMaintenance && <button className="btn btn-primary" onClick={openVehicleMaintenance}>
                            <Plus size={16} /> Jadwalkan Servis
                        </button>}
                    </div>
                    <div className="card-body">
                        <div className="table-wrapper table-desktop-only"><table>
                            <thead><tr><th>Tipe</th><th>Jadwal</th><th>Status</th><th>Odometer</th><th>Vendor</th></tr></thead>
                            <tbody>{maints.length === 0 ? <tr><td colSpan={5} className="text-center text-muted" style={{ padding: '2rem' }}>Belum ada maintenance</td></tr> : maints.map(m => (
                                <tr key={m._id}><td>{m.type}</td><td>{m.scheduleType === 'DATE' ? formatDate(m.plannedDate) : `${(m.plannedOdometer || 0).toLocaleString()} km`}</td><td><span className={`badge badge-${MAINTENANCE_STATUS_MAP[m.status]?.color}`}>{MAINTENANCE_STATUS_MAP[m.status]?.label}</span></td><td>{m.odometerAtService ? `${m.odometerAtService.toLocaleString()} km` : '-'}</td><td>{m.vendor || '-'}</td></tr>
                            ))}</tbody>
                        </table></div>
                        <div className="mobile-record-list">
                            {maints.length === 0 ? (
                                <div className="mobile-record-card">
                                    <div className="mobile-record-title">Belum ada jadwal maintenance</div>
                                </div>
                            ) : maints.map(m => (
                                <div key={m._id} className="mobile-record-card">
                                    <div className="mobile-record-header">
                                        <div>
                                            <div className="mobile-record-title">{m.type}</div>
                                            <div className="mobile-record-subtitle">{m.scheduleType === 'DATE' ? formatDate(m.plannedDate) : `${(m.plannedOdometer || 0).toLocaleString()} km`}</div>
                                        </div>
                                        <span className={`badge badge-${MAINTENANCE_STATUS_MAP[m.status]?.color}`}>{MAINTENANCE_STATUS_MAP[m.status]?.label}</span>
                                    </div>
                                    <div className="mobile-record-meta">
                                        <div className="mobile-record-kv">
                                            <span className="mobile-record-label">Vendor</span>
                                            <span className="mobile-record-value">{m.vendor || '-'}</span>
                                        </div>
                                        <div className="mobile-record-kv">
                                            <span className="mobile-record-label">Odometer</span>
                                            <span className="mobile-record-value">{m.odometerAtService ? `${m.odometerAtService.toLocaleString()} km` : '-'}</span>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {tab === 'ban' && (
                <div style={{ display: 'grid', gap: '1rem' }}>
                    <div className="card">
                        <div className="card-body">
                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
                                <div style={{ display: 'grid', gap: '0.35rem' }}>
                                    <div className="form-section-title" style={{ marginBottom: 0 }}>Layout Ban Unit</div>
                                </div>
                                <button className="btn btn-secondary" type="button" onClick={() => router.push('/fleet/tires')}>
                                    <ExternalLink size={14} /> Audit Semua Ban
                                </button>
                            </div>
                        </div>
                    </div>

                    <div className="kpi-grid">
                        <div className="kpi-card"><div className="kpi-icon success"><Disc3 size={20} /></div><div className="kpi-content"><div className="kpi-label">Slot Terisi</div><div className="kpi-value">{filledSlotCount}</div></div></div>
                        <div className="kpi-card"><div className="kpi-icon warning"><AlertTriangle size={20} /></div><div className="kpi-content"><div className="kpi-label">Slot Belum Diisi</div><div className="kpi-value">{emptySlotCount}</div></div></div>
                        <div className="kpi-card"><div className="kpi-icon info"><Car size={20} /></div><div className="kpi-content"><div className="kpi-label">Serep Unit</div><div className="kpi-value">{spareSlots.filter(slot => Boolean(slot.event)).length}</div></div></div>
                        <div className="kpi-card"><div className="kpi-icon primary"><Warehouse size={20} /></div><div className="kpi-content"><div className="kpi-label">Catatan Audit Lain</div><div className="kpi-value">{externalAuditTires.length}</div></div></div>
                    </div>

                    <div className="card">
                        <div className="card-header"><span className="card-header-title">Posisi Jalan</span></div>
                        <div className="card-body">
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
                                {mountedSlots.map(slot => renderSlotCard(slot.slotCode, slot.event))}
                            </div>
                        </div>
                    </div>

                    <div className="card">
                        <div className="card-header"><span className="card-header-title">Serep Unit</span></div>
                        <div className="card-body">
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
                                {spareSlots.map(slot => renderSlotCard(slot.slotCode, slot.event))}
                            </div>
                        </div>
                    </div>

                    {externalAuditTires.length > 0 && (
                        <div className="card">
                            <div className="card-header"><span className="card-header-title">Catatan Audit Ban di Luar Slot Unit</span></div>
                            <div className="card-body">
                                <div className="table-wrapper">
                                    <table>
                                        <thead><tr><th>Kode Ban</th><th>Lokasi Saat Ini</th><th>Status</th><th>Merk & Ukuran</th><th>Tanggal</th><th>Catatan</th></tr></thead>
                                        <tbody>
                                            {externalAuditTires.map(te => (
                                                <tr key={te._id}>
                                                    <td>
                                                        <div className="font-medium">{te.tireCodeLabel}</div>
                                                        <div className="text-muted text-sm">{te.tireType}</div>
                                                    </td>
                                                    <td>{te.placementLabel}</td>
                                                    <td><span className={`badge badge-${TIRE_ASSET_STATUS_MAP[te.status]?.color || 'gray'}`}>{TIRE_ASSET_STATUS_MAP[te.status]?.label || te.status}</span></td>
                                                    <td><div className="font-medium">{te.tireBrand}</div><div className="font-mono text-sm">{te.tireSize}</div></td>
                                                    <td>{formatDate(te.installDate)}</td>
                                                    <td>{te.notes || '-'}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {tab === 'insiden' && (
                <div className="card">
                    <div className="card-header" style={{ justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
                        <div>
                            <span className="card-header-title">Insiden Kendaraan</span>
                            <div className="text-muted text-sm" style={{ marginTop: '0.25rem' }}>Kalau ada kendala di perjalanan atau di pool, laporkan langsung dari halaman unit ini.</div>
                        </div>
                        {canCreateIncident && <button className="btn btn-danger" onClick={openVehicleIncident}>
                            <AlertTriangle size={16} /> Laporkan Insiden
                        </button>}
                    </div>
                    <div className="card-body">
                        <div className="table-wrapper table-desktop-only"><table>
                            <thead><tr><th>No.</th><th>Tanggal</th><th>Tipe</th><th>Lokasi</th><th>Status</th></tr></thead>
                            <tbody>{incidents.length === 0 ? <tr><td colSpan={5} className="text-center text-muted" style={{ padding: '2rem' }}>Tidak ada insiden</td></tr> : incidents.map(i => (
                                <tr key={i._id}><td><a href={`/fleet/incidents/${i._id}`} className="font-semibold" style={{ color: 'var(--color-primary)' }}>{i.incidentNumber}</a></td><td>{formatDate(i.dateTime)}</td><td>{i.incidentType}</td><td>{i.locationText}</td><td><span className={`badge badge-${INCIDENT_STATUS_MAP[i.status]?.color}`}>{INCIDENT_STATUS_MAP[i.status]?.label}</span></td></tr>
                            ))}</tbody>
                        </table></div>
                        <div className="mobile-record-list">
                            {incidents.length === 0 ? (
                                <div className="mobile-record-card">
                                    <div className="mobile-record-title">Tidak ada insiden</div>
                                </div>
                            ) : incidents.map(i => (
                                <div key={i._id} className="mobile-record-card">
                                    <div className="mobile-record-header">
                                        <div>
                                            <div className="mobile-record-title">{i.incidentNumber}</div>
                                            <div className="mobile-record-subtitle">{formatDate(i.dateTime)} - {i.locationText || '-'}</div>
                                        </div>
                                        <span className={`badge badge-${INCIDENT_STATUS_MAP[i.status]?.color}`}>{INCIDENT_STATUS_MAP[i.status]?.label}</span>
                                    </div>
                                    <div className="mobile-record-meta">
                                        <div className="mobile-record-kv">
                                            <span className="mobile-record-label">Tipe</span>
                                            <span className="mobile-record-value">{i.incidentType}</span>
                                        </div>
                                        <div className="mobile-record-kv">
                                            <span className="mobile-record-label">DO Terkait</span>
                                            <span className="mobile-record-value">{i.relatedDONumber || '-'}</span>
                                        </div>
                                    </div>
                                    <div className="mobile-record-actions">
                                        <button className="btn btn-secondary" onClick={() => router.push(`/fleet/incidents/${i._id}`)}>Lihat Insiden</button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {tab === 'biaya' && isOwner && (
                <div className="card"><div className="table-wrapper"><table>
                    <thead><tr><th>Tanggal</th><th>Kategori</th><th>Deskripsi</th><th>Jumlah</th></tr></thead>
                    <tbody>{expenses.length === 0 ? <tr><td colSpan={4} className="text-center text-muted" style={{ padding: '2rem' }}>Belum ada pengeluaran</td></tr> : expenses.map(e => (
                        <tr key={e._id}><td>{formatDate(e.date)}</td><td>{e.categoryName}</td><td>{e.note || e.description}</td><td className="font-medium">{formatCurrency(e.amount)}</td></tr>
                    ))}</tbody>
                </table></div></div>
            )}

            {canManageTires && showTireModal && (
                <div className="modal-overlay" onClick={closeTireModal}>
                    <div className="modal modal-lg" onClick={event => event.stopPropagation()}>
                        <div className="modal-header">
                            <h3 className="modal-title">{editingTire ? `Edit Ban ${tireForm.slotCode}` : `Isi Slot ${tireForm.slotCode}`}</h3>
                            <button className="modal-close" onClick={closeTireModal} disabled={savingTire}>&times;</button>
                        </div>
                        <div className="modal-body">
                            <div style={{ display: 'grid', gap: '1rem' }}>
                                <div style={{ padding: '0.85rem 1rem', borderRadius: '0.75rem', background: 'var(--color-gray-50)', border: '1px solid var(--color-gray-200)' }}>
                                    <div className="text-muted text-sm">Unit</div>
                                    <div className="font-medium">{vehicle.plateNumber} - {vehicle.unitCode}</div>
                                </div>

                                <div className="form-row">
                                    <div className="form-group">
                                        <label className="form-label">Slot Ban</label>
                                        <select className="form-select" value={tireForm.slotCode} onChange={e => updateTireForm('slotCode', e.target.value)} disabled={savingTire}>
                                            {layout.allSlots.map(slotCode => (
                                                <option key={slotCode} value={slotCode}>{slotCode} - {formatTireSlotLabel(slotCode)}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div className="form-group">
                                        <label className="form-label">Ban Terdaftar</label>
                                        <select
                                            className="form-select"
                                            value={tireForm.registeredTireId}
                                            onChange={e => handleRegisteredTireChange(e.target.value)}
                                            disabled={savingTire || Boolean(editingTire)}
                                        >
                                            <option value="">Input ban baru</option>
                                            {availableRegisteredTires.map(registeredTire => (
                                                <option key={registeredTire._id} value={registeredTire._id}>
                                                    {registeredTire.tireCodeLabel} - {registeredTire.tireBrand} {registeredTire.tireSize} ({registeredTire.placementLabel})
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                </div>

                                {selectedRegisteredTire && (
                                    <div style={{ padding: '0.85rem 1rem', borderRadius: '0.75rem', background: 'var(--color-gray-50)', border: '1px solid var(--color-gray-200)' }}>
                                        <div className="text-muted text-sm">Ban Terpilih</div>
                                        <div className="font-medium">{selectedRegisteredTire.tireCodeLabel} - {selectedRegisteredTire.tireBrand} {selectedRegisteredTire.tireSize}</div>
                                        <div className="text-muted text-sm" style={{ marginTop: '0.25rem' }}>
                                            Posisi terakhir: {selectedRegisteredTire.placementLabel}
                                        </div>
                                    </div>
                                )}

                                <div className="form-row">
                                    <div className="form-group">
                                        <label className="form-label">Kode Ban</label>
                                        <input className="form-input" value={tireForm.tireCode} onChange={e => updateTireForm('tireCode', e.target.value.toUpperCase())} placeholder="cth: BAN-0012" disabled={savingTire || tireSelectionLocked} />
                                    </div>
                                </div>

                                <div className="form-row">
                                    <div className="form-group">
                                        <label className="form-label">Jenis Ban</label>
                                        <select className="form-select" value={tireForm.tireType} onChange={e => updateTireForm('tireType', e.target.value as VehicleTireFormState['tireType'])} disabled={savingTire || tireSelectionLocked}>
                                            {VEHICLE_TIRE_TYPE_OPTIONS.map(type => <option key={type} value={type}>{type}</option>)}
                                        </select>
                                    </div>
                                    <div className="form-group">
                                        <label className="form-label">Tanggal Catat</label>
                                        <input type="date" className="form-input" value={tireForm.installDate} onChange={e => updateTireForm('installDate', e.target.value)} disabled={savingTire} />
                                    </div>
                                </div>

                                <div className="form-row">
                                    <div className="form-group">
                                        <label className="form-label">Merk / Model Ban</label>
                                        <input className="form-input" value={tireForm.tireBrand} onChange={e => updateTireForm('tireBrand', e.target.value)} placeholder="cth: Bridgestone R150" disabled={savingTire || tireSelectionLocked} />
                                    </div>
                                    <div className="form-group">
                                        <label className="form-label">Ukuran</label>
                                        <input className="form-input" value={tireForm.tireSize} onChange={e => updateTireForm('tireSize', e.target.value)} placeholder="cth: 11.00-20 / 295-80R22.5" disabled={savingTire || tireSelectionLocked} />
                                    </div>
                                </div>

                                <div className="form-group">
                                    <label className="form-label">Catatan</label>
                                    <textarea className="form-textarea" rows={3} value={tireForm.notes} onChange={e => updateTireForm('notes', e.target.value)} placeholder="Mis. ban baru, hasil rotasi, kondisi khusus, atau alasan pindah slot." disabled={savingTire} />
                                </div>
                            </div>
                        </div>
                        <div className="modal-footer" style={{ justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' }}>
                            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                                <button type="button" className="btn btn-secondary" onClick={closeTireModal} disabled={savingTire}>Batal</button>
                                <button type="button" className="btn btn-primary" onClick={handleSaveTire} disabled={savingTire}>
                                    <Save size={16} /> {savingTire ? 'Menyimpan...' : editingTire ? 'Simpan Perubahan' : 'Pasang Ban'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
