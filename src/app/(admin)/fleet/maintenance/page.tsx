'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useToast } from '../../layout';
import { Plus, Search, Wrench, Save, X } from 'lucide-react';
import AppPagination from '@/components/AppPagination';
import FormattedNumberInput from '@/components/FormattedNumberInput';
import {
    buildMaintenanceQuery,
    createDefaultMaintenanceForm,
    getTodayDate,
    getMaintenanceNextAction,
    type MaintenanceFormState,
} from '@/lib/fleet-queue-page-support';
import { formatDate, MAINTENANCE_STATUS_MAP } from '@/lib/utils';
import { DEFAULT_PAGE_SIZE } from '@/lib/pagination';
import type { Maintenance, Vehicle } from '@/lib/types';

export default function MaintenancePage() {
    const searchParams = useSearchParams();
    const { addToast } = useToast();
    const [items, setItems] = useState<Maintenance[]>([]);
    const [vehicles, setVehicles] = useState<Vehicle[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [vehicleFilter, setVehicleFilter] = useState('');
    const [statusFilter, setStatusFilter] = useState('');
    const [page, setPage] = useState(1);
    const [filteredTotalMaintenance, setFilteredTotalMaintenance] = useState(0);
    const [scheduledCount, setScheduledCount] = useState(0);
    const [completedCount, setCompletedCount] = useState(0);
    const [skippedCount, setSkippedCount] = useState(0);
    const [showModal, setShowModal] = useState(false);
    const [saving, setSaving] = useState(false);
    const [updatingId, setUpdatingId] = useState<string | null>(null);
    const [prefillApplied, setPrefillApplied] = useState(false);
    const [form, setForm] = useState<MaintenanceFormState>(createDefaultMaintenanceForm());

    useEffect(() => {
        setPage(1);
    }, [search, vehicleFilter, statusFilter]);

    const buildCurrentMaintenanceQuery = useCallback(
        (targetPage = page, targetPageSize = DEFAULT_PAGE_SIZE) =>
            buildMaintenanceQuery({
                page: targetPage,
                pageSize: targetPageSize,
                search,
                vehicleFilter,
                statusFilter,
            }),
        [page, search, vehicleFilter, statusFilter]
    );

    const loadMaintenance = useCallback(async () => {
        setLoading(true);
        try {
            const fetchEntity = async <T,>(url: string) => {
                const res = await fetch(url);
                const payload = await res.json();
                if (!res.ok) {
                    throw new Error(payload.error || 'Gagal memuat maintenance');
                }
                return payload as { data: T; meta?: { total?: number } };
            };

            const [listPayload, vehiclePayload, scheduledPayload, completedPayload, skippedPayload] = await Promise.all([
                fetchEntity<Maintenance[]>(`/api/data?${buildCurrentMaintenanceQuery()}`),
                fetchEntity<Vehicle[]>('/api/data?entity=vehicles'),
                fetchEntity<Maintenance[]>('/api/data?entity=maintenances&countOnly=1&filter=' + encodeURIComponent(JSON.stringify({ status: 'SCHEDULED' }))),
                fetchEntity<Maintenance[]>('/api/data?entity=maintenances&countOnly=1&filter=' + encodeURIComponent(JSON.stringify({ status: 'DONE' }))),
                fetchEntity<Maintenance[]>('/api/data?entity=maintenances&countOnly=1&filter=' + encodeURIComponent(JSON.stringify({ status: 'SKIPPED' }))),
            ]);

            setItems(listPayload.data || []);
            setFilteredTotalMaintenance(listPayload.meta?.total || 0);
            setVehicles(((vehiclePayload.data || []) as Vehicle[]).filter(vehicle => vehicle.status !== 'SOLD'));
            setScheduledCount(scheduledPayload.meta?.total || 0);
            setCompletedCount(completedPayload.meta?.total || 0);
            setSkippedCount(skippedPayload.meta?.total || 0);
        } catch (error) {
            addToast('error', error instanceof Error ? error.message : 'Gagal memuat maintenance');
        } finally {
            setLoading(false);
        }
    }, [addToast, buildCurrentMaintenanceQuery]);

    useEffect(() => {
        void loadMaintenance();
    }, [loadMaintenance]);

    useEffect(() => {
        if (loading || prefillApplied) {
            return;
        }

        const requestedVehicleRef = searchParams.get('vehicleRef') || '';
        const shouldOpen = searchParams.get('open') === '1';
        if (!requestedVehicleRef) {
            setPrefillApplied(true);
            return;
        }

        const selectedVehicle = vehicles.find(vehicle => vehicle._id === requestedVehicleRef);
        if (!selectedVehicle) {
            setPrefillApplied(true);
            return;
        }

        setVehicleFilter(selectedVehicle._id);
        setForm(createDefaultMaintenanceForm(selectedVehicle));
        if (shouldOpen) {
            setShowModal(true);
        }
        setPrefillApplied(true);
    }, [loading, prefillApplied, searchParams, vehicles]);

    const openScheduleModal = (vehicle?: Vehicle | null) => {
        setForm(createDefaultMaintenanceForm(vehicle));
        setShowModal(true);
    };

    const closeScheduleModal = () => {
        if (saving) return;
        const filteredVehicle = vehicles.find(vehicle => vehicle._id === vehicleFilter);
        setShowModal(false);
        setForm(createDefaultMaintenanceForm(filteredVehicle || null));
    };

    const selectedVehicle = vehicles.find(vehicle => vehicle._id === form.vehicleRef);

    const handleSave = async () => {
        if (!form.vehicleRef || !form.type) {
            addToast('error', 'Kendaraan dan tipe wajib');
            return;
        }
        const vehicle = vehicles.find(item => item._id === form.vehicleRef);
        setSaving(true);
        try {
            const res = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ entity: 'maintenances', data: { ...form, vehiclePlate: vehicle?.plateNumber, status: 'SCHEDULED' } }),
            });
            const payload = await res.json();
            if (!res.ok) {
                addToast('error', payload.error || 'Gagal menjadwalkan maintenance');
                return;
            }
            setForm(createDefaultMaintenanceForm(vehicleFilter ? vehicles.find(item => item._id === vehicleFilter) || null : null));
            addToast('success', 'Maintenance dijadwalkan');
            setShowModal(false);
            if (page !== 1) {
                setPage(1);
            } else {
                await loadMaintenance();
            }
        } catch {
            addToast('error', 'Gagal menjadwalkan maintenance');
        } finally {
            setSaving(false);
        }
    };

    const updateStatus = async (id: string, status: string) => {
        setUpdatingId(id);
        try {
            const res = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    entity: 'maintenances',
                    action: 'update',
                    data: { id, updates: { status, completedDate: new Date().toISOString().split('T')[0] } },
                }),
            });
            const payload = await res.json();
            if (!res.ok) {
                addToast('error', payload.error || 'Gagal memperbarui maintenance');
                return;
            }
            await loadMaintenance();
            addToast('success', `Status maintenance diubah ke ${MAINTENANCE_STATUS_MAP[status]?.label}`);
        } catch {
            addToast('error', 'Gagal memperbarui maintenance');
        } finally {
            setUpdatingId(current => current === id ? null : current);
        }
    };

    return (
        <div>
            <div className="page-header"><div className="page-header-left"><h1 className="page-title">Maintenance</h1><p className="page-subtitle">Antrian servis kendaraan yang perlu dikerjakan, dilewati, atau diarsipkan.</p></div>
                <div className="page-actions"><button className="btn btn-primary" onClick={() => openScheduleModal(vehicleFilter ? vehicles.find(vehicle => vehicle._id === vehicleFilter) || null : null)}><Plus size={18} /> Jadwalkan Servis</button></div></div>
            <div className="kpi-grid" style={{ marginBottom: '1.5rem' }}>
                <div className="kpi-card"><div className="kpi-icon warning"><Wrench size={20} /></div><div className="kpi-content"><div className="kpi-label">Terjadwal</div><div className="kpi-value">{scheduledCount}</div></div></div>
                <div className="kpi-card"><div className="kpi-icon success"><Wrench size={20} /></div><div className="kpi-content"><div className="kpi-label">Selesai</div><div className="kpi-value">{completedCount}</div></div></div>
                <div className="kpi-card"><div className="kpi-icon info"><Wrench size={20} /></div><div className="kpi-content"><div className="kpi-label">Dilewati</div><div className="kpi-value">{skippedCount}</div></div></div>
            </div>
            <div className="table-container">
                <div className="table-toolbar"><div className="table-toolbar-left"><div className="table-search"><Search size={16} className="table-search-icon" /><input placeholder="Cari kendaraan atau tipe servis..." value={search} onChange={e => setSearch(e.target.value)} /></div><select className="form-select" style={{ width: 'auto', minWidth: 180 }} value={vehicleFilter} onChange={e => setVehicleFilter(e.target.value)}><option value="">Semua Kendaraan</option>{vehicles.map(vehicle => <option key={vehicle._id} value={vehicle._id}>{vehicle.plateNumber} - {vehicle.brandModel}</option>)}</select><select className="form-select" style={{ width: 'auto', minWidth: 150 }} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}><option value="">Semua Status</option>{Object.entries(MAINTENANCE_STATUS_MAP).map(([key, meta]) => <option key={key} value={key}>{meta.label}</option>)}</select></div></div>
                <div className="table-wrapper table-desktop-only">
                    <table>
                        <thead><tr><th>Kendaraan</th><th>Tipe Servis</th><th>Jadwal</th><th>Status</th><th>Tindak Lanjut</th><th>Aksi</th></tr></thead>
                        <tbody>
                            {loading ? [1, 2, 3].map(i => <tr key={i}>{[1, 2, 3, 4, 5, 6].map(j => <td key={j}><div className="skeleton skeleton-text" /></td>)}</tr>) :
                                filteredTotalMaintenance === 0 ? <tr><td colSpan={6}><div className="empty-state"><Wrench size={48} className="empty-state-icon" /><div className="empty-state-title">Belum ada jadwal maintenance</div></div></td></tr> :
                                    items.map(item => (
                                        <tr key={item._id}>
                                            <td><Link href={`/fleet/vehicles/${item.vehicleRef}`} className="font-semibold" style={{ color: 'var(--color-primary)' }}>{item.vehiclePlate}</Link></td>
                                            <td>{item.type}</td>
                                            <td>{item.scheduleType === 'DATE' ? formatDate(item.plannedDate) : `${(item.plannedOdometer || 0).toLocaleString()} km`}</td>
                                            <td><span className={`badge badge-${MAINTENANCE_STATUS_MAP[item.status]?.color}`}><span className="badge-dot" /> {MAINTENANCE_STATUS_MAP[item.status]?.label}</span></td>
                                            <td>{getMaintenanceNextAction(item)}</td>
                                            <td><div className="table-actions">
                                                {item.status === 'SCHEDULED' && <><button className="table-action-btn" onClick={() => updateStatus(item._id, 'DONE')} disabled={updatingId === item._id}>{updatingId === item._id ? 'Menyimpan...' : 'Selesai'}</button><button className="table-action-btn" onClick={() => updateStatus(item._id, 'SKIPPED')} disabled={updatingId === item._id}>{updatingId === item._id ? 'Menyimpan...' : 'Lewati'}</button></>}
                                            </div></td>
                                        </tr>
                                    ))}
                        </tbody>
                    </table>
                </div>
                {!loading && (
                    <div className="mobile-record-list">
                        {filteredTotalMaintenance === 0 ? (
                            <div className="mobile-record-card">
                                <div className="mobile-record-title">Belum ada jadwal maintenance</div>
                                <div className="mobile-record-subtitle">Buat jadwal servis untuk mengingatkan perawatan armada.</div>
                            </div>
                        ) : items.map(item => (
                            <div key={item._id} className="mobile-record-card">
                                <div className="mobile-record-header">
                                    <div>
                                        <div className="mobile-record-title">{item.vehiclePlate || '-'}</div>
                                        <div className="mobile-record-subtitle">{item.type}</div>
                                    </div>
                                    <span className={`badge badge-${MAINTENANCE_STATUS_MAP[item.status]?.color}`}>
                                        <span className="badge-dot" /> {MAINTENANCE_STATUS_MAP[item.status]?.label}
                                    </span>
                                </div>
                                <div className="mobile-record-meta">
                                    <div className="mobile-record-kv">
                                        <span className="mobile-record-label">Jadwal</span>
                                        <span className="mobile-record-value">{item.scheduleType === 'DATE' ? formatDate(item.plannedDate) : `${(item.plannedOdometer || 0).toLocaleString()} km`}</span>
                                    </div>
                                    <div className="mobile-record-kv">
                                        <span className="mobile-record-label">Tindak Lanjut</span>
                                        <span className="mobile-record-value">{getMaintenanceNextAction(item)}</span>
                                    </div>
                                    {item.notes && (
                                        <div className="mobile-record-kv">
                                            <span className="mobile-record-label">Catatan</span>
                                            <span className="mobile-record-value">{item.notes}</span>
                                        </div>
                                    )}
                                </div>
                                {item.status === 'SCHEDULED' && (
                                    <div className="mobile-record-actions">
                                        <button className="btn btn-secondary" onClick={() => window.location.assign(`/fleet/vehicles/${item.vehicleRef}`)}>
                                            Lihat Unit
                                        </button>
                                        <button className="btn btn-secondary" onClick={() => updateStatus(item._id, 'DONE')} disabled={updatingId === item._id}>
                                            {updatingId === item._id ? 'Menyimpan...' : 'Selesai'}
                                        </button>
                                        <button className="btn btn-secondary" onClick={() => updateStatus(item._id, 'SKIPPED')} disabled={updatingId === item._id}>
                                            {updatingId === item._id ? 'Menyimpan...' : 'Lewati'}
                                        </button>
                                    </div>
                                )}
                                {item.status !== 'SCHEDULED' && (
                                    <div className="mobile-record-actions">
                                        <button className="btn btn-secondary" onClick={() => window.location.assign(`/fleet/vehicles/${item.vehicleRef}`)}>
                                            Lihat Unit
                                        </button>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}
                {filteredTotalMaintenance > 0 && (
                    <AppPagination
                        page={page}
                        pageSize={DEFAULT_PAGE_SIZE}
                        totalItems={filteredTotalMaintenance}
                        onPageChange={setPage}
                        info={({ startIndex, endIndex, totalItems }) => (
                            <>Menampilkan {startIndex}-{endIndex} dari {totalItems} jadwal maintenance</>
                        )}
                    />
                )}
            </div>
            {showModal && (
                <div className="modal-overlay" onClick={closeScheduleModal}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header"><h3 className="modal-title">Jadwalkan Maintenance</h3><button className="modal-close" onClick={closeScheduleModal} disabled={saving}><X size={20} /></button></div>
                        <div className="modal-body">
                            <div className="form-group"><label className="form-label">Kendaraan <span className="required">*</span></label>
                                <select className="form-select" value={form.vehicleRef} onChange={e => setForm({ ...form, vehicleRef: e.target.value })} disabled={saving}><option value="">Pilih</option>{vehicles.map(vehicle => <option key={vehicle._id} value={vehicle._id}>{vehicle.plateNumber} - {vehicle.brandModel}</option>)}</select></div>
                            {selectedVehicle && (
                                <div style={{ padding: '0.85rem 1rem', borderRadius: '0.75rem', background: 'var(--color-gray-50)', border: '1px solid var(--color-gray-200)', marginBottom: '1rem' }}>
                                    <div className="text-muted text-sm">Unit yang dipilih</div>
                                    <div className="font-medium">{selectedVehicle.plateNumber} - {selectedVehicle.brandModel}</div>
                                    <div className="text-muted text-sm" style={{ marginTop: '0.25rem' }}>
                                        Odometer terakhir {typeof selectedVehicle.lastOdometer === 'number' ? `${selectedVehicle.lastOdometer.toLocaleString()} km` : 'belum diisi'}.
                                    </div>
                                </div>
                            )}
                            <div className="form-group"><label className="form-label">Tipe Servis <span className="required">*</span></label>
                                <select className="form-select" value={form.type} onChange={e => setForm({ ...form, type: e.target.value })} disabled={saving}>
                                    <option value="">Pilih</option><option>Servis Berkala</option><option>Ganti Oli</option><option>Ganti Rem</option><option>Ganti Ban</option><option>Spooring</option><option>Lainnya</option>
                                </select></div>
                            <div className="form-group"><label className="form-label">Jadwal Berdasarkan</label>
                                <select className="form-select" value={form.scheduleType} onChange={e => setForm(prev => ({ ...prev, scheduleType: e.target.value as 'DATE' | 'ODOMETER', plannedDate: prev.plannedDate || getTodayDate(), plannedOdometer: prev.plannedOdometer || selectedVehicle?.lastOdometer || 0 }))} disabled={saving}>
                                    <option value="DATE">Tanggal</option><option value="ODOMETER">Odometer</option>
                                </select></div>
                            {form.scheduleType === 'DATE' ? <div className="form-group"><label className="form-label">Tanggal</label><input type="date" className="form-input" value={form.plannedDate} onChange={e => setForm({ ...form, plannedDate: e.target.value })} disabled={saving} /></div> :
                                <div className="form-group"><label className="form-label">Odometer (km)</label><FormattedNumberInput allowDecimal={false} value={form.plannedOdometer} onValueChange={value => setForm({ ...form, plannedOdometer: value })} disabled={saving} /></div>}
                            <div className="form-group"><label className="form-label">Catatan</label><textarea className="form-textarea" rows={2} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} disabled={saving} /></div>
                        </div>
                        <div className="modal-footer"><button className="btn btn-secondary" onClick={closeScheduleModal} disabled={saving}>Batal</button><button className="btn btn-primary" onClick={handleSave} disabled={saving}><Save size={16} /> {saving ? 'Menyimpan...' : 'Simpan'}</button></div>
                    </div>
                </div>
            )}
        </div>
    );
}
