'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Plus, Save, Search, Trash2, Wrench, X } from 'lucide-react';

import AppPagination from '@/components/AppPagination';
import FormattedNumberInput from '@/components/FormattedNumberInput';
import { fetchAdminCollectionData } from '@/lib/api/admin-client';
import {
    buildMaintenanceQuery,
    createDefaultMaintenanceForm,
    getMaintenanceNextAction,
    getTodayDate,
    type MaintenanceFormState,
} from '@/lib/fleet-queue-page-support';
import {
    createDefaultMaintenanceCompletionForm,
    createEmptyMaintenanceMaterialLine,
    getMaintenanceMaterialOverflowCount,
    getMaintenanceMaterialPreview,
    getMaintenanceRecordedCost,
    type MaintenanceCompletionFormState,
    type MaintenanceMaterialOption,
} from '@/lib/maintenance';
import { DEFAULT_PAGE_SIZE } from '@/lib/pagination';
import { hasPageAccess, hasPermission } from '@/lib/rbac';
import type { Maintenance, Vehicle } from '@/lib/types';
import { formatCurrency, formatDate, formatQuantity, MAINTENANCE_STATUS_MAP } from '@/lib/utils';
import { useApp, useToast } from '../../layout';

export default function MaintenancePage() {
    const searchParams = useSearchParams();
    const { user } = useApp();
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
    const [showScheduleModal, setShowScheduleModal] = useState(false);
    const [showCompleteModal, setShowCompleteModal] = useState(false);
    const [savingSchedule, setSavingSchedule] = useState(false);
    const [savingCompletion, setSavingCompletion] = useState(false);
    const [updatingId, setUpdatingId] = useState<string | null>(null);
    const [prefillApplied, setPrefillApplied] = useState(false);
    const [form, setForm] = useState<MaintenanceFormState>(createDefaultMaintenanceForm());
    const [completeTarget, setCompleteTarget] = useState<Maintenance | null>(null);
    const [completeForm, setCompleteForm] = useState<MaintenanceCompletionFormState>(createDefaultMaintenanceCompletionForm());
    const [materialOptions, setMaterialOptions] = useState<MaintenanceMaterialOption[]>([]);
    const [loadingMaterialOptions, setLoadingMaterialOptions] = useState(false);
    const canCreateMaintenance = user ? hasPermission(user.role, 'maintenance', 'create') : false;
    const canUpdateMaintenance = user ? hasPermission(user.role, 'maintenance', 'update') : false;
    const canViewMaintenanceCost = user?.role === 'OWNER';
    const canOpenWarehouseItems = user ? hasPageAccess(user.role, 'warehouseItems') : false;

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

    const fetchAllMatchingMaintenance = useCallback(async () => {
        const pageSize = 200;
        let currentPage = 1;
        let total = 0;
        const allItems: Maintenance[] = [];

        do {
            const res = await fetch(`/api/data?${buildCurrentMaintenanceQuery(currentPage, pageSize)}`);
            const payload = await res.json();
            if (!res.ok) throw new Error(payload.error || 'Gagal memuat maintenance');
            const nextItems = (payload.data || []) as Maintenance[];
            total = payload.meta?.total || nextItems.length;
            allItems.push(...nextItems);
            if (nextItems.length === 0) break;
            currentPage += 1;
        } while (allItems.length < total);

        return allItems;
    }, [buildCurrentMaintenanceQuery]);

    const loadMaintenance = useCallback(async () => {
        setLoading(true);
        try {
            const fetchEntity = async <T,>(url: string) => {
                const res = await fetch(url);
                const payload = await res.json();
                if (!res.ok) throw new Error(payload.error || 'Gagal memuat maintenance');
                return payload as { data: T; meta?: { total?: number } };
            };

            const [listPayload, vehiclePayload, matchingMaintenance] = await Promise.all([
                fetchEntity<Maintenance[]>(`/api/data?${buildCurrentMaintenanceQuery()}`),
                fetchAdminCollectionData<Vehicle[]>('/api/data?entity=vehicles', 'Gagal memuat maintenance'),
                fetchAllMatchingMaintenance(),
            ]);

            const nextCounts = matchingMaintenance.reduce(
                (totals, maintenance) => {
                    if (maintenance.status === 'SCHEDULED') totals.scheduled += 1;
                    else if (maintenance.status === 'DONE') totals.done += 1;
                    else if (maintenance.status === 'SKIPPED') totals.skipped += 1;
                    return totals;
                },
                { scheduled: 0, done: 0, skipped: 0 }
            );

            setItems(listPayload.data || []);
            setFilteredTotalMaintenance(listPayload.meta?.total || 0);
            setVehicles((vehiclePayload || []).filter(vehicle => vehicle.status !== 'SOLD'));
            setScheduledCount(nextCounts.scheduled);
            setCompletedCount(nextCounts.done);
            setSkippedCount(nextCounts.skipped);
        } catch (error) {
            addToast('error', error instanceof Error ? error.message : 'Gagal memuat maintenance');
        } finally {
            setLoading(false);
        }
    }, [addToast, buildCurrentMaintenanceQuery, fetchAllMatchingMaintenance]);

    const loadMaterialOptions = useCallback(async () => {
        setLoadingMaterialOptions(true);
        try {
            const res = await fetch('/api/data?entity=maintenance-material-options');
            const payload = await res.json();
            if (!res.ok) throw new Error(payload.error || 'Gagal memuat opsi material maintenance');
            setMaterialOptions((payload.data || []) as MaintenanceMaterialOption[]);
        } catch (error) {
            setMaterialOptions([]);
            addToast('error', error instanceof Error ? error.message : 'Gagal memuat opsi material maintenance');
        } finally {
            setLoadingMaterialOptions(false);
        }
    }, [addToast]);

    useEffect(() => {
        void loadMaintenance();
    }, [loadMaintenance]);

    useEffect(() => {
        if (loading || prefillApplied) return;
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
        if (shouldOpen) setShowScheduleModal(true);
        setPrefillApplied(true);
    }, [loading, prefillApplied, searchParams, vehicles]);

    const selectedVehicle = vehicles.find(vehicle => vehicle._id === form.vehicleRef);
    const selectedCompleteVehicle = completeTarget ? vehicles.find(vehicle => vehicle._id === completeTarget.vehicleRef) || null : null;
    const tableColumnCount = canViewMaintenanceCost ? 7 : 6;

    const openScheduleModal = (vehicle?: Vehicle | null) => {
        setForm(createDefaultMaintenanceForm(vehicle));
        setShowScheduleModal(true);
    };

    const closeScheduleModal = () => {
        if (savingSchedule) return;
        const filteredVehicle = vehicles.find(vehicle => vehicle._id === vehicleFilter);
        setShowScheduleModal(false);
        setForm(createDefaultMaintenanceForm(filteredVehicle || null));
    };

    const openCompleteModal = async (item: Maintenance) => {
        const vehicle = vehicles.find(row => row._id === item.vehicleRef) || null;
        setCompleteTarget(item);
        setCompleteForm(createDefaultMaintenanceCompletionForm(vehicle));
        setMaterialOptions([]);
        setShowCompleteModal(true);
        await loadMaterialOptions();
    };

    const resetCompleteModalState = () => {
        setShowCompleteModal(false);
        setCompleteTarget(null);
        setCompleteForm(createDefaultMaintenanceCompletionForm());
        setMaterialOptions([]);
    };

    const closeCompleteModal = () => {
        if (savingCompletion) return;
        resetCompleteModalState();
    };

    const handleSave = async () => {
        if (!form.vehicleRef || !form.type) {
            addToast('error', 'Kendaraan dan tipe wajib');
            return;
        }
        const vehicle = vehicles.find(item => item._id === form.vehicleRef);
        setSavingSchedule(true);
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
            setShowScheduleModal(false);
            if (page !== 1) setPage(1);
            else await loadMaintenance();
        } catch {
            addToast('error', 'Gagal menjadwalkan maintenance');
        } finally {
            setSavingSchedule(false);
        }
    };

    const skipMaintenance = async (id: string) => {
        setUpdatingId(id);
        try {
            const res = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ entity: 'maintenances', action: 'update', data: { id, updates: { status: 'SKIPPED', completedDate: getTodayDate() } } }),
            });
            const payload = await res.json();
            if (!res.ok) {
                addToast('error', payload.error || 'Gagal memperbarui maintenance');
                return;
            }
            await loadMaintenance();
            addToast('success', 'Maintenance ditandai dilewati');
        } catch {
            addToast('error', 'Gagal memperbarui maintenance');
        } finally {
            setUpdatingId(current => current === id ? null : current);
        }
    };

    const updateCompletionLine = (index: number, updates: Partial<MaintenanceCompletionFormState['materials'][number]>) => {
        setCompleteForm((current) => ({
            ...current,
            materials: current.materials.map((line, lineIndex) => (lineIndex === index ? { ...line, ...updates } : line)),
        }));
    };

    const addCompletionLine = () => {
        setCompleteForm((current) => ({ ...current, materials: [...current.materials, createEmptyMaintenanceMaterialLine()] }));
    };

    const removeCompletionLine = (index: number) => {
        setCompleteForm((current) => ({ ...current, materials: current.materials.filter((_, lineIndex) => lineIndex !== index) }));
    };

    const handleCompleteMaintenance = async () => {
        if (!completeTarget) return;
        try {
            const cleanedMaterials = completeForm.materials
                .filter((line) => line.warehouseItemRef || line.quantity > 0 || line.note.trim())
                .map((line, index) => {
                    if (!line.warehouseItemRef) throw new Error(`Pilih barang gudang pada material #${index + 1}`);
                    if (!Number.isFinite(line.quantity) || line.quantity <= 0) throw new Error(`Qty material #${index + 1} tidak valid`);
                    return { warehouseItemRef: line.warehouseItemRef, quantity: line.quantity, note: line.note.trim() || undefined };
                });

            setSavingCompletion(true);
            const res = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    entity: 'maintenances',
                    action: 'complete-with-materials',
                    data: {
                        maintenanceRef: completeTarget._id,
                        completedDate: completeForm.completedDate,
                        odometerAtService: completeForm.odometerAtService || undefined,
                        vendor: completeForm.vendor.trim() || undefined,
                        completionNotes: completeForm.completionNotes.trim() || undefined,
                        materials: cleanedMaterials,
                    },
                }),
            });
            const payload = await res.json();
            if (!res.ok) {
                addToast('error', payload.error || 'Gagal menyelesaikan maintenance');
                return;
            }
            await loadMaintenance();
            addToast('success', 'Maintenance selesai dan material gudang berhasil dicatat');
            resetCompleteModalState();
        } catch (error) {
            addToast('error', error instanceof Error ? error.message : 'Gagal menyelesaikan maintenance');
        } finally {
            setSavingCompletion(false);
        }
    };

    const renderMaterialUsage = (item: Maintenance) => {
        if (item.status !== 'DONE') {
            return <span>Belum dicatat</span>;
        }

        const materialPreview = getMaintenanceMaterialPreview(item);
        if (materialPreview.length === 0) {
            return <span className="text-muted text-sm">Tanpa material gudang</span>;
        }

        const overflowCount = getMaintenanceMaterialOverflowCount(item);
        return (
            <div style={{ display: 'grid', gap: '0.2rem' }}>
                {materialPreview.map((usage) => {
                    const usageLabel = `${usage.displayLabel} ${formatQuantity(usage.quantity, 3)} ${usage.unit}`;
                    return canOpenWarehouseItems ? (
                        <Link
                            key={`${item._id}-${usage.warehouseItemRef}`}
                            href={`/inventory/items/${usage.warehouseItemRef}`}
                            className="text-sm font-medium"
                            style={{ color: 'var(--color-primary)', wordBreak: 'break-word' }}
                        >
                            {usageLabel}
                        </Link>
                    ) : (
                        <span key={`${item._id}-${usage.warehouseItemRef}`} className="text-sm" style={{ wordBreak: 'break-word' }}>
                            {usageLabel}
                        </span>
                    );
                })}
                {overflowCount > 0 && <div className="text-muted text-xs">+{overflowCount} material lain</div>}
            </div>
        );
    };

    return (
        <div>
            <div className="page-header">
                <div className="page-header-left"><h1 className="page-title">Maintenance</h1></div>
                <div className="page-actions">
                    {canCreateMaintenance && (
                        <button className="btn btn-primary" onClick={() => openScheduleModal(vehicleFilter ? vehicles.find(vehicle => vehicle._id === vehicleFilter) || null : null)}>
                            <Plus size={18} /> Jadwalkan Servis
                        </button>
                    )}
                </div>
            </div>

            <div className="kpi-grid" style={{ marginBottom: '1.5rem' }}>
                <div className="kpi-card"><div className="kpi-icon warning"><Wrench size={20} /></div><div className="kpi-content"><div className="kpi-label">Terjadwal</div><div className="kpi-value">{scheduledCount}</div></div></div>
                <div className="kpi-card"><div className="kpi-icon success"><Wrench size={20} /></div><div className="kpi-content"><div className="kpi-label">Selesai</div><div className="kpi-value">{completedCount}</div></div></div>
                <div className="kpi-card"><div className="kpi-icon info"><Wrench size={20} /></div><div className="kpi-content"><div className="kpi-label">Dilewati</div><div className="kpi-value">{skippedCount}</div></div></div>
            </div>

            <div className="table-container">
                <div className="table-toolbar">
                    <div className="table-toolbar-left">
                        <div className="table-search"><Search size={16} className="table-search-icon" /><input placeholder="Cari kendaraan atau tipe servis..." value={search} onChange={e => setSearch(e.target.value)} /></div>
                        <select className="form-select" style={{ width: 'auto', minWidth: 180 }} value={vehicleFilter} onChange={e => setVehicleFilter(e.target.value)}>
                            <option value="">Semua Kendaraan</option>
                            {vehicles.map(vehicle => <option key={vehicle._id} value={vehicle._id}>{vehicle.plateNumber} - {vehicle.brandModel}</option>)}
                        </select>
                        <select className="form-select" style={{ width: 'auto', minWidth: 150 }} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
                            <option value="">Semua Status</option>
                            {Object.entries(MAINTENANCE_STATUS_MAP).map(([key, meta]) => <option key={key} value={key}>{meta.label}</option>)}
                        </select>
                    </div>
                </div>

                <div className="table-wrapper table-desktop-only">
                    <table>
                        <thead>
                            <tr>
                                <th>Kendaraan</th>
                                <th>Tipe Servis</th>
                                <th>Jadwal</th>
                                <th>Status</th>
                                <th>Material Gudang</th>
                                {canViewMaintenanceCost && <th>Biaya Internal</th>}
                                <th>Aksi</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? [1, 2, 3].map(i => <tr key={i}>{Array.from({ length: tableColumnCount }).map((_, j) => <td key={j}><div className="skeleton skeleton-text" /></td>)}</tr>) :
                                filteredTotalMaintenance === 0 ? <tr><td colSpan={tableColumnCount}><div className="empty-state"><Wrench size={48} className="empty-state-icon" /><div className="empty-state-title">Belum ada jadwal maintenance</div></div></td></tr> :
                                    items.map(item => {
                                        return (
                                            <tr key={item._id}>
                                                <td><Link href={`/fleet/vehicles/${item.vehicleRef}`} className="font-semibold" style={{ color: 'var(--color-primary)' }}>{item.vehiclePlate}</Link></td>
                                                <td><div className="font-medium">{item.type}</div><div className="text-muted text-sm">{getMaintenanceNextAction(item)}</div></td>
                                                <td>{item.scheduleType === 'DATE' ? formatDate(item.plannedDate) : `${formatQuantity(item.plannedOdometer || 0, 0)} km`}</td>
                                                <td><span className={`badge badge-${MAINTENANCE_STATUS_MAP[item.status]?.color}`}><span className="badge-dot" /> {MAINTENANCE_STATUS_MAP[item.status]?.label}</span></td>
                                                <td>{renderMaterialUsage(item)}</td>
                                                {canViewMaintenanceCost && <td>{item.status === 'DONE' ? formatCurrency(getMaintenanceRecordedCost(item)) : '-'}</td>}
                                                <td>
                                                    <div className="table-actions">
                                                        {canUpdateMaintenance && item.status === 'SCHEDULED' && (
                                                            <>
                                                                <button className="table-action-btn" onClick={() => void openCompleteModal(item)} disabled={updatingId === item._id || savingCompletion}>Selesai</button>
                                                                <button className="table-action-btn" onClick={() => void skipMaintenance(item._id)} disabled={updatingId === item._id}>{updatingId === item._id ? 'Menyimpan...' : 'Lewati'}</button>
                                                            </>
                                                        )}
                                                        {item.status !== 'SCHEDULED' && <Link href={`/fleet/vehicles/${item.vehicleRef}?tab=maintenance`} className="table-action-btn">Lihat Unit</Link>}
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })}
                        </tbody>
                    </table>
                </div>

                {!loading && (
                    <div className="mobile-record-list">
                        {filteredTotalMaintenance === 0 ? (
                            <div className="mobile-record-card"><div className="mobile-record-title">Belum ada jadwal maintenance</div></div>
                        ) : items.map(item => {
                            return (
                                <div key={item._id} className="mobile-record-card">
                                    <div className="mobile-record-header">
                                        <div><div className="mobile-record-title">{item.vehiclePlate || '-'}</div><div className="mobile-record-subtitle">{item.type}</div></div>
                                        <span className={`badge badge-${MAINTENANCE_STATUS_MAP[item.status]?.color}`}><span className="badge-dot" /> {MAINTENANCE_STATUS_MAP[item.status]?.label}</span>
                                    </div>
                                    <div className="mobile-record-meta">
                                        <div className="mobile-record-kv"><span className="mobile-record-label">Jadwal</span><span className="mobile-record-value">{item.scheduleType === 'DATE' ? formatDate(item.plannedDate) : `${formatQuantity(item.plannedOdometer || 0, 0)} km`}</span></div>
                                        <div className="mobile-record-kv"><span className="mobile-record-label">Tindak Lanjut</span><span className="mobile-record-value">{getMaintenanceNextAction(item)}</span></div>
                                        <div className="mobile-record-kv"><span className="mobile-record-label">Material Gudang</span><div className="mobile-record-value">{renderMaterialUsage(item)}</div></div>
                                        {canViewMaintenanceCost && item.status === 'DONE' && <div className="mobile-record-kv"><span className="mobile-record-label">Biaya Internal</span><span className="mobile-record-value">{formatCurrency(getMaintenanceRecordedCost(item))}</span></div>}
                                        {item.notes && <div className="mobile-record-kv"><span className="mobile-record-label">Catatan Jadwal</span><span className="mobile-record-value">{item.notes}</span></div>}
                                    </div>
                                    <div className="mobile-record-actions">
                                        <button className="btn btn-secondary" onClick={() => window.location.assign(`/fleet/vehicles/${item.vehicleRef}?tab=maintenance`)}>Lihat Unit</button>
                                        {canUpdateMaintenance && item.status === 'SCHEDULED' && (
                                            <>
                                                <button className="btn btn-secondary" onClick={() => void openCompleteModal(item)} disabled={savingCompletion}>Selesai</button>
                                                <button className="btn btn-secondary" onClick={() => void skipMaintenance(item._id)} disabled={updatingId === item._id}>{updatingId === item._id ? 'Menyimpan...' : 'Lewati'}</button>
                                            </>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}

                {filteredTotalMaintenance > 0 && (
                    <AppPagination
                        page={page}
                        pageSize={DEFAULT_PAGE_SIZE}
                        totalItems={filteredTotalMaintenance}
                        onPageChange={setPage}
                        info={({ startIndex, endIndex, totalItems }) => <>Menampilkan {startIndex}-{endIndex} dari {totalItems} jadwal maintenance</>}
                    />
                )}
            </div>
            {canCreateMaintenance && showScheduleModal && (
                <div className="modal-overlay" onClick={closeScheduleModal}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header"><h3 className="modal-title">Jadwalkan Maintenance</h3><button className="modal-close" onClick={closeScheduleModal} disabled={savingSchedule}><X size={20} /></button></div>
                        <div className="modal-body">
                            <div className="form-group"><label className="form-label">Kendaraan <span className="required">*</span></label><select className="form-select" value={form.vehicleRef} onChange={e => setForm({ ...form, vehicleRef: e.target.value })} disabled={savingSchedule}><option value="">Pilih</option>{vehicles.map(vehicle => <option key={vehicle._id} value={vehicle._id}>{vehicle.plateNumber} - {vehicle.brandModel}</option>)}</select></div>
                            {selectedVehicle && (
                                <div style={{ padding: '0.85rem 1rem', borderRadius: '0.75rem', background: 'var(--color-gray-50)', border: '1px solid var(--color-gray-200)', marginBottom: '1rem' }}>
                                    <div className="text-muted text-sm">Unit yang dipilih</div>
                                    <div className="font-medium">{selectedVehicle.plateNumber} - {selectedVehicle.brandModel}</div>
                                    <div className="text-muted text-sm" style={{ marginTop: '0.25rem' }}>Odometer terakhir {selectedVehicle.lastOdometer ? `${formatQuantity(selectedVehicle.lastOdometer, 0)} km` : 'belum diisi'}.</div>
                                </div>
                            )}
                            <div className="form-group"><label className="form-label">Tipe Servis <span className="required">*</span></label><select className="form-select" value={form.type} onChange={e => setForm({ ...form, type: e.target.value })} disabled={savingSchedule}><option value="">Pilih</option><option>Servis Berkala</option><option>Ganti Oli</option><option>Ganti Rem</option><option>Ganti Ban</option><option>Spooring</option><option>Lainnya</option></select></div>
                            <div className="form-group"><label className="form-label">Jadwal Berdasarkan</label><select className="form-select" value={form.scheduleType} onChange={e => setForm(prev => ({ ...prev, scheduleType: e.target.value as 'DATE' | 'ODOMETER', plannedDate: prev.plannedDate || getTodayDate(), plannedOdometer: prev.plannedOdometer || selectedVehicle?.lastOdometer || 0 }))} disabled={savingSchedule}><option value="DATE">Tanggal</option><option value="ODOMETER">Odometer</option></select></div>
                            {form.scheduleType === 'DATE'
                                ? <div className="form-group"><label className="form-label">Tanggal</label><input type="date" className="form-input" value={form.plannedDate} onChange={e => setForm({ ...form, plannedDate: e.target.value })} disabled={savingSchedule} /></div>
                                : <div className="form-group"><label className="form-label">Odometer (km)</label><FormattedNumberInput allowDecimal={false} value={form.plannedOdometer} onValueChange={value => setForm({ ...form, plannedOdometer: value })} disabled={savingSchedule} /></div>}
                            <div className="form-group"><label className="form-label">Catatan</label><textarea className="form-textarea" rows={2} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} disabled={savingSchedule} /></div>
                        </div>
                        <div className="modal-footer"><button className="btn btn-secondary" onClick={closeScheduleModal} disabled={savingSchedule}>Batal</button><button className="btn btn-primary" onClick={handleSave} disabled={savingSchedule}><Save size={16} /> {savingSchedule ? 'Menyimpan...' : 'Simpan'}</button></div>
                    </div>
                </div>
            )}
            {canUpdateMaintenance && showCompleteModal && completeTarget && (
                <div className="modal-overlay" onClick={closeCompleteModal}>
                    <div className="modal modal-lg" onClick={event => event.stopPropagation()}>
                        <div className="modal-header"><h3 className="modal-title">Selesaikan Maintenance</h3><button className="modal-close" onClick={closeCompleteModal} disabled={savingCompletion}><X size={20} /></button></div>
                        <div className="modal-body">
                            <div style={{ padding: '0.9rem 1rem', borderRadius: '0.8rem', background: 'var(--color-gray-50)', border: '1px solid var(--color-gray-200)', marginBottom: '1rem', display: 'grid', gap: '0.35rem' }}>
                                <div className="text-muted text-sm">Maintenance yang diproses</div>
                                <div className="font-medium">{completeTarget.vehiclePlate || selectedCompleteVehicle?.plateNumber || '-'} • {completeTarget.type}</div>
                                <div className="text-muted text-sm">Jadwal {completeTarget.scheduleType === 'DATE' ? formatDate(completeTarget.plannedDate) : `${formatQuantity(completeTarget.plannedOdometer || 0, 0)} km`}</div>
                                {selectedCompleteVehicle?.lastOdometer ? <div className="text-muted text-sm">Odometer terakhir unit {formatQuantity(selectedCompleteVehicle.lastOdometer, 0)} km</div> : null}
                            </div>

                            <div className="form-row">
                                <div className="form-group"><label className="form-label">Tanggal Selesai</label><input type="date" className="form-input" value={completeForm.completedDate} onChange={event => setCompleteForm(current => ({ ...current, completedDate: event.target.value }))} disabled={savingCompletion} /></div>
                                <div className="form-group"><label className="form-label">Odometer Servis (km)</label><FormattedNumberInput allowDecimal={false} value={completeForm.odometerAtService} onValueChange={(value) => setCompleteForm(current => ({ ...current, odometerAtService: value }))} disabled={savingCompletion} zeroAsEmpty /></div>
                            </div>

                            <div className="form-group"><label className="form-label">Vendor / Bengkel</label><input className="form-input" value={completeForm.vendor} onChange={event => setCompleteForm(current => ({ ...current, vendor: event.target.value }))} placeholder="Opsional" disabled={savingCompletion} /></div>
                            <div className="form-group"><label className="form-label">Catatan Penyelesaian</label><textarea className="form-textarea" rows={3} value={completeForm.completionNotes} onChange={event => setCompleteForm(current => ({ ...current, completionNotes: event.target.value }))} placeholder="Contoh: ganti oli mesin dan filter, unit kembali siap jalan." disabled={savingCompletion} /></div>

                            <div className="form-section-title" style={{ marginBottom: '0.75rem' }}>Material Gudang Terpakai</div>
                            <div className="info-banner" style={{ marginBottom: '1rem' }}>
                                <div className="info-banner-title">Aturan Biaya Maintenance</div>
                                <div className="info-banner-text">Material gudang akan mengurangi stok saat maintenance diselesaikan. Saldo bank tidak berubah di sini karena cashflow supplier sudah dicatat saat pembayaran pembelian.</div>
                            </div>

                            {loadingMaterialOptions ? (
                                <div className="text-muted">Memuat opsi material gudang...</div>
                            ) : (
                                <>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
                                        <div className="text-muted text-sm">Pilih barang umum aktif yang stoknya tersedia. Ban tertracking tetap dikelola dari modul Ban.</div>
                                        <button type="button" className="btn btn-secondary" onClick={addCompletionLine} disabled={savingCompletion || materialOptions.length === 0}><Plus size={16} /> Tambah Material</button>
                                    </div>

                                    {materialOptions.length === 0 && (
                                        <div className="info-banner" style={{ marginBottom: '1rem' }}>
                                            <div className="info-banner-title">Belum Ada Material Gudang Aktif</div>
                                            <div className="info-banner-text">Maintenance tetap bisa diselesaikan tanpa material gudang jika memang pengerjaan ini tidak memakai stok.</div>
                                        </div>
                                    )}

                                    {completeForm.materials.length === 0 ? (
                                        <div style={{ border: '1px dashed var(--color-gray-300)', borderRadius: '0.85rem', padding: '1rem', background: 'var(--color-gray-50)' }}>
                                            <div className="font-medium">Belum ada material gudang</div>
                                            <div className="text-muted text-sm" style={{ marginTop: '0.2rem' }}>Simpan langsung jika maintenance ini hanya mencatat penyelesaian tanpa pemakaian stok.</div>
                                        </div>
                                    ) : (
                                        <div style={{ display: 'grid', gap: '0.85rem' }}>
                                            {completeForm.materials.map((line, index) => {
                                                const selectedOption = materialOptions.find(option => option._id === line.warehouseItemRef);
                                                return (
                                                    <div key={`${line.warehouseItemRef}-${index}`} style={{ border: '1px solid var(--color-gray-200)', borderRadius: '0.9rem', padding: '1rem', display: 'grid', gap: '0.85rem', background: 'var(--color-white)' }}>
                                                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
                                                            <div className="font-medium">Material #{index + 1}</div>
                                                            <button type="button" className="btn btn-secondary" onClick={() => removeCompletionLine(index)} disabled={savingCompletion}><Trash2 size={14} /> Hapus</button>
                                                        </div>
                                                        <div className="form-row">
                                                            <div className="form-group"><label className="form-label">Barang Gudang</label><select className="form-select" value={line.warehouseItemRef} onChange={event => updateCompletionLine(index, { warehouseItemRef: event.target.value })} disabled={savingCompletion}><option value="">Pilih barang</option>{materialOptions.map((option) => <option key={option._id} value={option._id}>{option.itemCode} - {option.name}</option>)}</select></div>
                                                            <div className="form-group"><label className="form-label">Qty Pakai</label><FormattedNumberInput value={line.quantity} onValueChange={(value) => updateCompletionLine(index, { quantity: value })} maxFractionDigits={3} disabled={savingCompletion} zeroAsEmpty /></div>
                                                        </div>
                                                        <div className="form-group"><label className="form-label">Catatan Material</label><input className="form-input" value={line.note} onChange={event => updateCompletionLine(index, { note: event.target.value })} placeholder="Opsional" disabled={savingCompletion} /></div>
                                                        {selectedOption && <div style={{ display: 'grid', gap: '0.25rem', padding: '0.85rem 1rem', borderRadius: '0.8rem', background: 'var(--color-gray-50)', border: '1px solid var(--color-gray-200)' }}><div className="font-medium">{selectedOption.itemCode} - {selectedOption.name}</div><div className="text-muted text-sm">{selectedOption.category || 'Tanpa kategori'} • stok tersedia {formatQuantity(selectedOption.currentStockQty, 3)} {selectedOption.unit}</div></div>}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                        <div className="modal-footer"><button className="btn btn-secondary" onClick={closeCompleteModal} disabled={savingCompletion}>Batal</button><button className="btn btn-primary" onClick={handleCompleteMaintenance} disabled={savingCompletion}><Save size={16} /> {savingCompletion ? 'Menyimpan...' : 'Selesaikan Maintenance'}</button></div>
                    </div>
                </div>
            )}
        </div>
    );
}
