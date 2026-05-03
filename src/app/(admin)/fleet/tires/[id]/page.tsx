'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Edit, History, Truck, Warehouse } from 'lucide-react';

import FormattedNumberInput from '@/components/FormattedNumberInput';
import PageBackButton from '@/components/PageBackButton';
import { fetchAdminCollectionData, fetchAdminData } from '@/lib/api/admin-client';
import { resolveFleetTireEvents, TIRE_TYPES } from '@/lib/fleet-asset-page-support';
import { hasPageAccess, hasPermission } from '@/lib/rbac';
import { getTireHistoryActionColor, getTireHistoryActionLabel, getTireHistoryTransitionLabel } from '@/lib/tire-history';
import { formatTireSlotLabel } from '@/lib/tire-slots';
import { TIRE_ASSET_STATUS_MAP, formatDate, formatDateTime, formatQuantity } from '@/lib/utils';
import { useApp, useToast } from '../../../layout';
import type { TireEvent, TireHistoryLog, Vehicle, WarehouseItem } from '@/lib/types';

type TireDetailEditForm = {
    tireCode: string;
    tireType: TireEvent['tireType'];
    tireBrand: string;
    tireSize: string;
    installDate: string;
    replaceDate: string;
    accumulatedKm: number;
    notes: string;
};

export default function TireDetailPage() {
    const params = useParams();
    const router = useRouter();
    const { user } = useApp();
    const { addToast } = useToast();
    const tireId = params.id as string;
    const [loading, setLoading] = useState(true);
    const [tire, setTire] = useState<TireEvent | null>(null);
    const [vehicle, setVehicle] = useState<Vehicle | null>(null);
    const [warehouseItem, setWarehouseItem] = useState<WarehouseItem | null>(null);
    const [historyRows, setHistoryRows] = useState<TireHistoryLog[]>([]);
    const [showEditModal, setShowEditModal] = useState(false);
    const [savingEdit, setSavingEdit] = useState(false);
    const [editForm, setEditForm] = useState<TireDetailEditForm>({
        tireCode: '',
        tireType: 'Tubeless',
        tireBrand: '',
        tireSize: '',
        installDate: '',
        replaceDate: '',
        accumulatedKm: 0,
        notes: '',
    });
    const canOpenVehicles = user ? hasPageAccess(user.role, 'vehicles') : false;
    const canOpenItems = user ? hasPageAccess(user.role, 'warehouseItems') : false;
    const canManageTires = user ? hasPermission(user.role, 'tires', 'update') : false;

    const reloadHistory = async () => {
        const historyFilter = encodeURIComponent(JSON.stringify({ tireEventRef: tireId }));
        const rows = await fetchAdminCollectionData<TireHistoryLog[]>(
            `/api/data?entity=tire-history-logs&filter=${historyFilter}&sortField=timestamp&sortDir=desc`,
            'Gagal memuat riwayat ban'
        );
        setHistoryRows(rows || []);
    };

    useEffect(() => {
        const loadDetail = async () => {
            setLoading(true);
            try {
                const tireData = await fetchAdminData<TireEvent | null>(`/api/data?entity=tire-events&id=${tireId}`, 'Ban tidak ditemukan');
                if (!tireData) {
                    throw new Error('Ban tidak ditemukan');
                }
                const historyFilter = encodeURIComponent(JSON.stringify({ tireEventRef: tireId }));
                const [vehicleData, warehouseItemData, historyData] = await Promise.all([
                    tireData.vehicleRef
                        ? fetchAdminData<Vehicle | null>(`/api/data?entity=vehicles&id=${tireData.vehicleRef}`, 'Gagal memuat kendaraan ban')
                        : Promise.resolve(null),
                    tireData.linkedWarehouseItemRef
                        ? fetchAdminData<WarehouseItem | null>(`/api/data?entity=warehouse-items&id=${tireData.linkedWarehouseItemRef}`, 'Gagal memuat item gudang ban')
                        : Promise.resolve(null),
                    fetchAdminCollectionData<TireHistoryLog[]>(
                        `/api/data?entity=tire-history-logs&filter=${historyFilter}&sortField=timestamp&sortDir=desc`,
                        'Gagal memuat riwayat ban'
                    ),
                ]);
                setTire(tireData);
                setVehicle(vehicleData);
                setWarehouseItem(warehouseItemData);
                setHistoryRows(historyData || []);
            } catch (error) {
                addToast('error', error instanceof Error ? error.message : 'Gagal memuat detail ban');
                router.push('/fleet/tires');
            } finally {
                setLoading(false);
            }
        };

        void loadDetail();
    }, [addToast, router, tireId]);

    if (loading) {
        return <div><div className="skeleton skeleton-title" /><div className="skeleton skeleton-card" style={{ height: 260 }} /></div>;
    }
    if (!tire) {
        return <div className="empty-state"><div className="empty-state-title">Ban tidak ditemukan</div></div>;
    }

    const resolvedTire = resolveFleetTireEvents([tire])[0];
    const statusMeta = TIRE_ASSET_STATUS_MAP[resolvedTire.status];
    const placementLabel = resolvedTire.placementLabel || '-';
    const slotLabel = resolvedTire.slotCode ? `${resolvedTire.slotCode} - ${resolvedTire.slotLabel || formatTireSlotLabel(resolvedTire.slotCode)}` : '-';

    const openEditModal = () => {
        setEditForm({
            tireCode: tire.tireCode || '',
            tireType: tire.tireType || 'Tubeless',
            tireBrand: tire.tireBrand || '',
            tireSize: tire.tireSize || '',
            installDate: tire.installDate || '',
            replaceDate: tire.replaceDate || '',
            accumulatedKm: tire.accumulatedKm || 0,
            notes: tire.notes || '',
        });
        setShowEditModal(true);
    };

    const saveEdit = async () => {
        if (!editForm.tireCode.trim()) {
            addToast('error', 'Kode ban wajib diisi');
            return;
        }
        if (!editForm.tireBrand.trim() || !editForm.tireSize.trim()) {
            addToast('error', 'Merk dan ukuran ban wajib diisi');
            return;
        }
        setSavingEdit(true);
        try {
            const res = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    entity: 'tire-events',
                    action: 'update',
                    data: {
                        id: tire._id,
                        updates: {
                            tireCode: editForm.tireCode,
                            tireType: editForm.tireType,
                            tireBrand: editForm.tireBrand,
                            tireSize: editForm.tireSize,
                            installDate: editForm.installDate,
                            replaceDate: editForm.replaceDate || undefined,
                            accumulatedKm: editForm.accumulatedKm,
                            notes: editForm.notes,
                        },
                    },
                }),
            });
            const payload = await res.json();
            if (!res.ok) {
                throw new Error(payload.error || 'Gagal memperbarui ban');
            }
            const updatedTire = payload.data as TireEvent | undefined;
            if (updatedTire) {
                setTire(updatedTire);
            } else {
                const refreshed = await fetchAdminData<TireEvent | null>(`/api/data?entity=tire-events&id=${tire._id}`, 'Gagal memuat ulang ban');
                if (refreshed) setTire(refreshed);
            }
            await reloadHistory();
            setShowEditModal(false);
            addToast('success', 'Ban diperbarui');
        } catch (error) {
            addToast('error', error instanceof Error ? error.message : 'Gagal memperbarui ban');
        } finally {
            setSavingEdit(false);
        }
    };

    return (
        <div>
            <div className="page-header">
                <div className="page-header-left">
                    <PageBackButton href="/fleet/tires" />
                    <div>
                        <h1 className="page-title">{resolvedTire.tireCodeLabel}</h1>
                        <div className="text-muted">Detail aset ban dan riwayat pergerakan</div>
                    </div>
                </div>
                <div className="page-actions">
                    <button className="btn btn-secondary" type="button" onClick={() => router.push('/fleet/tires')}>
                        <ArrowLeft size={16} /> Daftar Ban
                    </button>
                    {canManageTires && (
                        <button className="btn btn-primary" type="button" onClick={openEditModal}>
                            <Edit size={16} /> Edit
                        </button>
                    )}
                </div>
            </div>

            <div className="kpi-grid" style={{ marginBottom: '1.5rem' }}>
                <div className="kpi-card"><div className="kpi-icon success"><History size={20} /></div><div className="kpi-content"><div className="kpi-label">Km Ban</div><div className="kpi-value">{formatQuantity(tire.accumulatedKm || 0, 0)} km</div></div></div>
                <div className="kpi-card"><div className="kpi-icon info"><Truck size={20} /></div><div className="kpi-content"><div className="kpi-label">Odometer Unit Terakhir</div><div className="kpi-value">{tire.lastOdometerKm ? `${formatQuantity(tire.lastOdometerKm, 0)} km` : '-'}</div></div></div>
                <div className="kpi-card"><div className="kpi-icon primary"><Warehouse size={20} /></div><div className="kpi-content"><div className="kpi-label">Status</div><div className="kpi-value">{statusMeta?.label || resolvedTire.status}</div></div></div>
            </div>

            <div className="detail-grid">
                <div className="card">
                    <div className="card-header"><span className="card-header-title">Profil Ban</span></div>
                    <div className="card-body">
                        <div className="detail-row"><div className="detail-item"><div className="detail-label">Kode Ban</div><div className="detail-value font-mono">{resolvedTire.tireCodeLabel}</div></div><div className="detail-item"><div className="detail-label">Status</div><div className="detail-value"><span className={`badge badge-${statusMeta?.color || 'gray'}`}>{statusMeta?.label || resolvedTire.status}</span></div></div></div>
                        <div className="detail-row"><div className="detail-item"><div className="detail-label">Merk</div><div className="detail-value">{tire.tireBrand}</div></div><div className="detail-item"><div className="detail-label">Ukuran</div><div className="detail-value font-mono">{tire.tireSize}</div></div></div>
                        <div className="detail-row"><div className="detail-item"><div className="detail-label">Tipe</div><div className="detail-value">{tire.tireType}</div></div><div className="detail-item"><div className="detail-label">Tanggal Catat</div><div className="detail-value">{formatDate(tire.installDate)}</div></div></div>
                        <div className="detail-row"><div className="detail-item"><div className="detail-label">Lokasi Saat Ini</div><div className="detail-value">{placementLabel}</div></div><div className="detail-item"><div className="detail-label">Slot</div><div className="detail-value">{slotLabel}</div></div></div>
                        <div className="detail-row"><div className="detail-item"><div className="detail-label">Kilometer Pemakaian</div><div className="detail-value">{formatQuantity(tire.accumulatedKm || 0, 0)} km</div></div><div className="detail-item"><div className="detail-label">Update Km Terakhir</div><div className="detail-value">{formatDateTime(tire.lastKmUpdateAt)}</div></div></div>
                        <div className="detail-row"><div className="detail-item"><div className="detail-label">Catatan</div><div className="detail-value">{tire.notes || '-'}</div></div><div className="detail-item"><div className="detail-label">Tanggal Ganti</div><div className="detail-value">{formatDate(tire.replaceDate)}</div></div></div>
                    </div>
                </div>

                <div className="card">
                    <div className="card-header"><span className="card-header-title">Relasi</span></div>
                    <div className="card-body">
                        <div className="detail-row"><div className="detail-item"><div className="detail-label">Kendaraan</div><div className="detail-value">{vehicle ? (canOpenVehicles ? <Link href={`/fleet/vehicles/${vehicle._id}`}>{vehicle.plateNumber}</Link> : vehicle.plateNumber) : tire.vehiclePlate || '-'}</div></div><div className="detail-item"><div className="detail-label">Kategori Unit</div><div className="detail-value">{vehicle?.serviceName || '-'}</div></div></div>
                        <div className="detail-row"><div className="detail-item"><div className="detail-label">Item Gudang</div><div className="detail-value">{warehouseItem ? (canOpenItems ? <Link href={`/inventory/items/${warehouseItem._id}`}>{warehouseItem.itemCode || warehouseItem.name}</Link> : warehouseItem.itemCode || warehouseItem.name) : tire.linkedWarehouseItemCode || tire.linkedWarehouseItemName || '-'}</div></div><div className="detail-item"><div className="detail-label">Sumber Pembelian</div><div className="detail-value">{tire.sourcePurchaseNumber || '-'}</div></div></div>
                        <div className="detail-row"><div className="detail-item"><div className="detail-label">Pihak Luar</div><div className="detail-value">{tire.externalPartyName || '-'}</div></div><div className="detail-item"><div className="detail-label">Plat Luar</div><div className="detail-value">{tire.externalPlateNumber || '-'}</div></div></div>
                    </div>
                </div>
            </div>

            <div className="card" style={{ marginTop: '1.5rem' }}>
                <div className="card-header"><span className="card-header-title">Riwayat Ban</span></div>
                <div className="card-body">
                    {historyRows.length === 0 ? (
                        <div className="empty-state"><div className="empty-state-title">Belum ada riwayat</div></div>
                    ) : (
                        <div className="table-wrapper">
                            <table>
                                <thead><tr><th>Waktu</th><th>Aksi</th><th>Perubahan</th><th>Odometer</th><th>Catatan</th><th>User</th></tr></thead>
                                <tbody>
                                    {historyRows.map(row => (
                                        <tr key={row._id}>
                                            <td>{formatDateTime(row.timestamp)}</td>
                                            <td><span className={`badge badge-${getTireHistoryActionColor(row.actionType)}`}>{getTireHistoryActionLabel(row.actionType)}</span></td>
                                            <td>{getTireHistoryTransitionLabel(row)}</td>
                                            <td>{typeof row.distanceKm === 'number' ? `${formatQuantity(row.distanceKm, 0)} km` : '-'}</td>
                                            <td>{row.note || '-'}</td>
                                            <td>{row.actorUserName || '-'}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            </div>

            {showEditModal && (
                <div className="modal-overlay" onClick={() => { if (!savingEdit) setShowEditModal(false); }}>
                    <div className="modal" onClick={event => event.stopPropagation()}>
                        <div className="modal-header">
                            <h3 className="modal-title">Edit Ban</h3>
                            <button className="modal-close" onClick={() => setShowEditModal(false)} disabled={savingEdit}>&times;</button>
                        </div>
                        <div className="modal-body">
                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label">Kode Ban</label>
                                    <input className="form-input" value={editForm.tireCode} onChange={event => setEditForm(current => ({ ...current, tireCode: event.target.value.toUpperCase() }))} disabled={savingEdit} />
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Jenis Ban</label>
                                    <select className="form-select" value={editForm.tireType} onChange={event => setEditForm(current => ({ ...current, tireType: event.target.value as TireEvent['tireType'] }))} disabled={savingEdit}>
                                        {TIRE_TYPES.map(type => <option key={type} value={type}>{type}</option>)}
                                    </select>
                                </div>
                            </div>
                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label">Merk / Model</label>
                                    <input className="form-input" value={editForm.tireBrand} onChange={event => setEditForm(current => ({ ...current, tireBrand: event.target.value }))} disabled={savingEdit} />
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Ukuran</label>
                                    <input className="form-input" value={editForm.tireSize} onChange={event => setEditForm(current => ({ ...current, tireSize: event.target.value }))} disabled={savingEdit} />
                                </div>
                            </div>
                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label">Tanggal Catat</label>
                                    <input type="date" className="form-input" value={editForm.installDate} onChange={event => setEditForm(current => ({ ...current, installDate: event.target.value }))} disabled={savingEdit} />
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Tanggal Ganti</label>
                                    <input type="date" className="form-input" value={editForm.replaceDate} onChange={event => setEditForm(current => ({ ...current, replaceDate: event.target.value }))} disabled={savingEdit} />
                                </div>
                            </div>
                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label">Kilometer Pemakaian</label>
                                    <FormattedNumberInput allowDecimal={false} value={editForm.accumulatedKm} onValueChange={value => setEditForm(current => ({ ...current, accumulatedKm: value }))} disabled={savingEdit} />
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Catatan</label>
                                    <input className="form-input" value={editForm.notes} onChange={event => setEditForm(current => ({ ...current, notes: event.target.value }))} disabled={savingEdit} />
                                </div>
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setShowEditModal(false)} disabled={savingEdit}>Batal</button>
                            <button className="btn btn-primary" onClick={() => void saveEdit()} disabled={savingEdit}>{savingEdit ? 'Menyimpan...' : 'Simpan'}</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
