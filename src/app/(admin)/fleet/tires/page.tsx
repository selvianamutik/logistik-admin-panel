'use client';

import { useState, useEffect, useCallback } from 'react';
import { useToast } from '../../layout';
import { Plus, Search, Disc3, CheckCircle, Warehouse, ExternalLink } from 'lucide-react';
import AppPagination from '@/components/AppPagination';
import { formatDate, TIRE_ASSET_STATUS_MAP } from '@/lib/utils';
import { DEFAULT_PAGE_SIZE } from '@/lib/pagination';
import {
    formatTireSlotLabel,
    INTERNAL_TIRE_SLOT_CODES,
    resolveTireAssetStatus,
    resolveTireHolderType,
    resolveTirePlacementLabel,
    resolveTireSlotCode,
    TIRE_HOLDER_TYPE_OPTIONS,
    TIRE_STATUS_OPTIONS,
    type TireAssetStatus,
    type TireHolderType,
} from '@/lib/tire-slots';
import type { TireEvent, Vehicle } from '@/lib/types';

const TIRE_TYPES = ['Tubeless', 'Tube Type', 'Solid'] as const;

type TireFormState = {
    tireCode: string;
    holderType: TireHolderType;
    status: TireAssetStatus;
    vehicleRef: string;
    slotCode: string;
    tireType: 'Tubeless' | 'Tube Type' | 'Solid';
    tireBrand: string;
    tireSize: string;
    installDate: string;
    notes: string;
    externalPartyName: string;
    externalPlateNumber: string;
};

const DEFAULT_FORM: TireFormState = {
    tireCode: '',
    holderType: 'INTERNAL_VEHICLE',
    status: 'IN_USE',
    vehicleRef: '',
    slotCode: '1L',
    tireType: 'Tubeless',
    tireBrand: '',
    tireSize: '',
    installDate: new Date().toISOString().split('T')[0],
    notes: '',
    externalPartyName: '',
    externalPlateNumber: '',
};

export default function TiresPage() {
    const { addToast } = useToast();
    const [events, setEvents] = useState<TireEvent[]>([]);
    const [vehicles, setVehicles] = useState<Vehicle[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [filterVehicle, setFilterVehicle] = useState('');
    const [filterStatus, setFilterStatus] = useState<'all' | TireAssetStatus>('all');
    const [page, setPage] = useState(1);
    const [filteredTotalTires, setFilteredTotalTires] = useState(0);
    const [mountedCount, setMountedCount] = useState(0);
    const [spareCount, setSpareCount] = useState(0);
    const [warehouseCount, setWarehouseCount] = useState(0);
    const [loanedCount, setLoanedCount] = useState(0);
    const [showModal, setShowModal] = useState(false);
    const [editTarget, setEditTarget] = useState<TireEvent | null>(null);
    const [saving, setSaving] = useState(false);
    const [form, setForm] = useState<TireFormState>(DEFAULT_FORM);

    useEffect(() => {
        setPage(1);
    }, [search, filterVehicle, filterStatus]);

    const buildTiresQuery = useCallback((targetPage = page, targetPageSize = DEFAULT_PAGE_SIZE) => {
        const params = new URLSearchParams({
            entity: 'tire-events',
            page: String(targetPage),
            pageSize: String(targetPageSize),
        });

        if (search.trim()) {
            params.set('q', search.trim());
            params.set('searchFields', 'tireCode,tireBrand,tireSize,vehiclePlate,notes,externalPartyName,externalPlateNumber,slotCode,slotLabel,posisi');
        }

        const filterObj: Record<string, string> = {};
        if (filterVehicle) {
            filterObj.vehicleRef = filterVehicle;
        }
        if (filterStatus !== 'all') {
            filterObj.status = filterStatus;
        }
        if (Object.keys(filterObj).length > 0) {
            params.set('filter', JSON.stringify(filterObj));
        }

        return params.toString();
    }, [filterStatus, filterVehicle, page, search]);

    const loadData = useCallback(async () => {
        setLoading(true);
        try {
            const fetchEntity = async <T,>(url: string) => {
                const res = await fetch(url);
                const payload = await res.json();
                if (!res.ok) {
                    throw new Error(payload.error || 'Gagal memuat data ban');
                }
                return payload as { data: T; meta?: { total?: number } };
            };

            const [tirePayload, vehiclePayload, mountedPayload, sparePayload, warehousePayload, loanedPayload] = await Promise.all([
                fetchEntity<TireEvent[]>(`/api/data?${buildTiresQuery()}`),
                fetchEntity<Vehicle[]>('/api/data?entity=vehicles'),
                fetchEntity<TireEvent[]>('/api/data?entity=tire-events&countOnly=1&filter=' + encodeURIComponent(JSON.stringify({ status: 'IN_USE' }))),
                fetchEntity<TireEvent[]>('/api/data?entity=tire-events&countOnly=1&filter=' + encodeURIComponent(JSON.stringify({ status: 'SPARE' }))),
                fetchEntity<TireEvent[]>('/api/data?entity=tire-events&countOnly=1&filter=' + encodeURIComponent(JSON.stringify({ status: 'IN_WAREHOUSE' }))),
                fetchEntity<TireEvent[]>('/api/data?entity=tire-events&countOnly=1&filter=' + encodeURIComponent(JSON.stringify({ status: 'LOANED_OUT' }))),
            ]);
            setEvents(tirePayload.data || []);
            setFilteredTotalTires(tirePayload.meta?.total || 0);
            setVehicles(vehiclePayload.data || []);
            setMountedCount(mountedPayload.meta?.total || 0);
            setSpareCount(sparePayload.meta?.total || 0);
            setWarehouseCount(warehousePayload.meta?.total || 0);
            setLoanedCount(loanedPayload.meta?.total || 0);
        } catch (error) {
            addToast('error', error instanceof Error ? error.message : 'Gagal memuat data ban');
        } finally {
            setLoading(false);
        }
    }, [addToast, buildTiresQuery]);

    useEffect(() => {
        void loadData();
    }, [loadData]);

    const selectableVehicles = vehicles.filter(vehicle => vehicle.status !== 'SOLD' || vehicle._id === editTarget?.vehicleRef);
    const internalSlots = INTERNAL_TIRE_SLOT_CODES.filter(code => form.status === 'SPARE' ? code.startsWith('SP') : !code.startsWith('SP'));
    const resolvedEvents = events.map(event => {
        const holderType = resolveTireHolderType(event);
        const status = resolveTireAssetStatus(event);
        const slotCode = resolveTireSlotCode(event);
        const slotLabel = slotCode ? formatTireSlotLabel(slotCode) : undefined;
        return {
            ...event,
            holderType,
            status,
            tireCodeLabel: event.tireCode?.trim() || 'Belum dikodekan',
            slotCode,
            slotLabel,
            placementLabel: resolveTirePlacementLabel({ ...event, holderType, status, slotCode }),
        };
    });

    const resetForm = () => setForm({ ...DEFAULT_FORM, installDate: new Date().toISOString().split('T')[0] });

    const openAdd = () => {
        setEditTarget(null);
        resetForm();
        setShowModal(true);
    };

    const openEdit = (event: TireEvent) => {
        const holderType = resolveTireHolderType(event);
        const status = resolveTireAssetStatus(event);
        const slotCode = resolveTireSlotCode(event) || '';
        setEditTarget(event);
        setForm({
            tireCode: event.tireCode || '',
            holderType,
            status,
            vehicleRef: event.vehicleRef || '',
            slotCode,
            tireType: event.tireType,
            tireBrand: event.tireBrand,
            tireSize: event.tireSize,
            installDate: event.installDate,
            notes: event.notes || '',
            externalPartyName: event.externalPartyName || '',
            externalPlateNumber: event.externalPlateNumber || '',
        });
        setShowModal(true);
    };

    const updateForm = <K extends keyof TireFormState>(key: K, value: TireFormState[K]) => {
        setForm(prev => ({ ...prev, [key]: value }));
    };

    const handleSave = async () => {
        if (!form.tireCode) { addToast('error', 'Isi kode ban'); return; }
        if (!form.tireBrand) { addToast('error', 'Isi merk/tipe ban'); return; }
        if (!form.tireSize) { addToast('error', 'Isi ukuran ban'); return; }
        if (form.holderType === 'INTERNAL_VEHICLE' && !form.vehicleRef) { addToast('error', 'Pilih kendaraan'); return; }
        if (form.holderType === 'INTERNAL_VEHICLE' && !form.slotCode) { addToast('error', 'Pilih slot ban'); return; }
        if (form.holderType === 'EXTERNAL_VEHICLE' && !form.externalPartyName && !form.externalPlateNumber) {
            addToast('error', 'Isi nama pihak luar atau plat luar');
            return;
        }

        setSaving(true);
        try {
            const vehicle = vehicles.find(item => item._id === form.vehicleRef);
            const payload = {
                ...form,
                vehiclePlate: vehicle?.plateNumber,
                slotLabel: form.slotCode ? formatTireSlotLabel(form.slotCode) : undefined,
            };

            if (editTarget) {
                const res = await fetch('/api/data', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ entity: 'tire-events', action: 'update', data: { id: editTarget._id, updates: payload } }),
                });
                const result = await res.json();
                if (!res.ok) {
                    addToast('error', result.error || 'Gagal memperbarui data ban');
                    return;
                }
                addToast('success', 'Data ban berhasil diperbarui');
            } else {
                const res = await fetch('/api/data', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ entity: 'tire-events', data: payload }),
                });
                const result = await res.json();
                if (!res.ok) {
                    addToast('error', result.error || 'Gagal mencatat ban');
                    return;
                }
                addToast('success', 'Ban berhasil dicatat');
            }
            setShowModal(false);
            resetForm();
            if (page !== 1) {
                setPage(1);
            } else {
                await loadData();
            }
        } catch {
            addToast('error', 'Gagal menyimpan data ban');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div>
            <div className="page-header">
                <div className="page-header-left">
                    <h1 className="page-title">Audit Semua Ban</h1>
                    <p className="page-subtitle">Pantau ban lintas kendaraan, gudang, dan pinjam keluar. Pengisian slot unit sebaiknya dilakukan dari detail kendaraan.</p>
                </div>
                <div className="page-actions">
                    <button className="btn btn-primary" onClick={openAdd}><Plus size={16} /> Catat Ban</button>
                </div>
            </div>

            <div className="kpi-grid" style={{ marginBottom: '1.5rem' }}>
                <div className="kpi-card"><div className="kpi-icon success"><CheckCircle size={20} /></div><div className="kpi-content"><div className="kpi-label">Terpasang</div><div className="kpi-value">{mountedCount}</div></div></div>
                <div className="kpi-card"><div className="kpi-icon info"><Disc3 size={20} /></div><div className="kpi-content"><div className="kpi-label">Serep</div><div className="kpi-value">{spareCount}</div></div></div>
                <div className="kpi-card"><div className="kpi-icon warning"><ExternalLink size={20} /></div><div className="kpi-content"><div className="kpi-label">Dipinjam Keluar</div><div className="kpi-value">{loanedCount}</div></div></div>
                <div className="kpi-card"><div className="kpi-icon primary"><Warehouse size={20} /></div><div className="kpi-content"><div className="kpi-label">Di Gudang</div><div className="kpi-value">{warehouseCount}</div></div></div>
            </div>

            <div className="card" style={{ marginBottom: '1.5rem' }}>
                <div className="card-body">
                    <div className="text-muted">
                        Untuk melengkapi ban per unit secara berurutan seperti depan kiri, kanan, dan serep, buka dulu halaman detail kendaraan. Halaman ini dipakai untuk audit seluruh ban, termasuk gudang dan pinjam keluar. Riwayat ban tidak dihapus; ubah lokasi atau statusnya jika ban pindah.
                    </div>
                </div>
            </div>

            <div className="table-container">
                <div className="table-toolbar">
                    <div className="table-toolbar-left">
                        <div className="table-search">
                            <Search size={16} className="table-search-icon" />
                            <input type="text" placeholder="Cari kode ban, plat, lokasi, merk..." value={search} onChange={e => setSearch(e.target.value)} />
                        </div>
                        <select className="form-select" style={{ width: 'auto' }} value={filterVehicle} onChange={e => setFilterVehicle(e.target.value)}>
                            <option value="">Semua Kendaraan</option>
                            {vehicles.map(vehicle => <option key={vehicle._id} value={vehicle._id}>{vehicle.plateNumber}</option>)}
                        </select>
                        <select className="form-select" style={{ width: 'auto' }} value={filterStatus} onChange={e => setFilterStatus(e.target.value as 'all' | TireAssetStatus)}>
                            <option value="all">Semua Status</option>
                            {TIRE_STATUS_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                        </select>
                    </div>
                </div>
                <div className="table-wrapper table-desktop-only">
                    <table>
                        <thead>
                            <tr>
                                <th>Kode Ban</th>
                                <th>Lokasi Saat Ini</th>
                                <th>Status</th>
                                <th>Merk & Ukuran</th>
                                <th>Tgl Catat</th>
                                <th>Catatan</th>
                                <th></th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? [1, 2, 3].map(i => <tr key={i}>{[1, 2, 3, 4, 5, 6, 7].map(j => <td key={j}><div className="skeleton skeleton-text" /></td>)}</tr>) :
                                filteredTotalTires === 0 ? (
                                    <tr><td colSpan={7}>
                                        <div className="empty-state">
                                            <Disc3 size={48} className="empty-state-icon" />
                                            <div className="empty-state-title">Belum ada ban tercatat</div>
                                            <div className="empty-state-text">Tambahkan ban per kode unik agar perpindahan antar unit dan pinjam keluar bisa dilacak.</div>
                                        </div>
                                    </td></tr>
                                ) : resolvedEvents.map(event => (
                                    <tr key={event._id}>
                                        <td>
                                            <div className="font-medium">{event.tireCodeLabel}</div>
                                            <div className="text-muted text-sm">{event.tireType}</div>
                                        </td>
                                        <td>
                                            <div className="font-medium">{event.placementLabel}</div>
                                            {event.slotCode && <div className="text-muted text-sm">{event.slotCode} - {event.slotLabel || formatTireSlotLabel(event.slotCode)}</div>}
                                        </td>
                                        <td>
                                            <span className={`badge badge-${TIRE_ASSET_STATUS_MAP[event.status]?.color || 'gray'}`}>
                                                <span className="badge-dot" /> {TIRE_ASSET_STATUS_MAP[event.status]?.label || event.status}
                                            </span>
                                        </td>
                                        <td>
                                            <div className="font-medium">{event.tireBrand}</div>
                                            <div className="font-mono text-sm">{event.tireSize}</div>
                                        </td>
                                        <td className="text-muted">{formatDate(event.installDate)}</td>
                                        <td className="text-muted">{event.notes || '-'}</td>
                                        <td>
                                            <button className="btn btn-secondary" style={{ padding: '4px 10px', fontSize: '0.75rem' }} onClick={() => openEdit(event)}>Edit</button>
                                        </td>
                                    </tr>
                                ))}
                        </tbody>
                    </table>
                </div>
                {!loading && (
                    <div className="mobile-record-list">
                        {filteredTotalTires === 0 ? (
                            <div className="mobile-record-card">
                                <div className="mobile-record-title">Belum ada ban tercatat</div>
                                <div className="mobile-record-subtitle">Tambahkan ban per kode unik agar perpindahan antar unit dan pinjam keluar bisa dilacak.</div>
                            </div>
                        ) : resolvedEvents.map(event => (
                            <div key={event._id} className="mobile-record-card">
                                <div className="mobile-record-header">
                                    <div>
                                        <div className="mobile-record-title">{event.tireCodeLabel}</div>
                                        <div className="mobile-record-subtitle">{event.tireBrand} | {event.tireSize}</div>
                                    </div>
                                    <span className={`badge badge-${TIRE_ASSET_STATUS_MAP[event.status]?.color || 'gray'}`}>
                                        <span className="badge-dot" /> {TIRE_ASSET_STATUS_MAP[event.status]?.label || event.status}
                                    </span>
                                </div>
                                <div className="mobile-record-meta">
                                    <div className="mobile-record-kv">
                                        <span className="mobile-record-label">Lokasi Saat Ini</span>
                                        <span className="mobile-record-value">{event.placementLabel}</span>
                                    </div>
                                    {event.slotCode && (
                                        <div className="mobile-record-kv">
                                            <span className="mobile-record-label">Slot</span>
                                            <span className="mobile-record-value">{event.slotCode} - {event.slotLabel || formatTireSlotLabel(event.slotCode)}</span>
                                        </div>
                                    )}
                                    <div className="mobile-record-kv">
                                        <span className="mobile-record-label">Tanggal Catat</span>
                                        <span className="mobile-record-value">{formatDate(event.installDate)}</span>
                                    </div>
                                    {event.notes && (
                                        <div className="mobile-record-kv">
                                            <span className="mobile-record-label">Catatan</span>
                                            <span className="mobile-record-value">{event.notes}</span>
                                        </div>
                                    )}
                                </div>
                                <div className="mobile-record-actions">
                                    <button className="btn btn-secondary" onClick={() => openEdit(event)}>Edit</button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
                {filteredTotalTires > 0 && (
                    <AppPagination
                        page={page}
                        pageSize={DEFAULT_PAGE_SIZE}
                        totalItems={filteredTotalTires}
                        onPageChange={setPage}
                        info={({ startIndex, endIndex, totalItems }) => (
                            <>
                                Menampilkan {startIndex}-{endIndex} dari {totalItems} ban | {mountedCount} terpasang | {spareCount} serep | {loanedCount} dipinjam | {warehouseCount} gudang
                            </>
                        )}
                    />
                )}
            </div>

            {showModal && (
                <div className="modal-overlay" onClick={() => { if (!saving) setShowModal(false); }}>
                    <div className="modal modal-lg" onClick={event => event.stopPropagation()}>
                        <div className="modal-header">
                            <h3 className="modal-title">{editTarget ? 'Edit Ban' : 'Catat Ban'}</h3>
                            <button className="modal-close" onClick={() => setShowModal(false)} disabled={saving}>&times;</button>
                        </div>
                        <div className="modal-body">
                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label">Kode Ban</label>
                                    <input className="form-input" value={form.tireCode} onChange={e => updateForm('tireCode', e.target.value.toUpperCase())} placeholder="cth: BAN-0001" disabled={saving} />
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Jenis Ban</label>
                                    <select className="form-select" value={form.tireType} onChange={e => updateForm('tireType', e.target.value as TireFormState['tireType'])} disabled={saving}>
                                        {TIRE_TYPES.map(type => <option key={type} value={type}>{type}</option>)}
                                    </select>
                                </div>
                            </div>

                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label">Lokasi Holder</label>
                                    <select
                                        className="form-select"
                                        value={form.holderType}
                                        onChange={e => {
                                            const nextHolderType = e.target.value as TireHolderType;
                                            const nextStatus = nextHolderType === 'WAREHOUSE'
                                                ? 'IN_WAREHOUSE'
                                                : nextHolderType === 'EXTERNAL_VEHICLE'
                                                    ? 'LOANED_OUT'
                                                    : (form.status === 'IN_WAREHOUSE' || form.status === 'LOANED_OUT' ? 'IN_USE' : form.status);
                                            setForm(prev => ({
                                                ...prev,
                                                holderType: nextHolderType,
                                                status: nextStatus,
                                                vehicleRef: nextHolderType === 'INTERNAL_VEHICLE' ? prev.vehicleRef : '',
                                                slotCode: nextHolderType === 'INTERNAL_VEHICLE' ? prev.slotCode : '',
                                                externalPartyName: nextHolderType === 'EXTERNAL_VEHICLE' ? prev.externalPartyName : '',
                                                externalPlateNumber: nextHolderType === 'EXTERNAL_VEHICLE' ? prev.externalPlateNumber : '',
                                            }));
                                        }}
                                        disabled={saving}
                                    >
                                        {TIRE_HOLDER_TYPE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                                    </select>
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Status</label>
                                    <select
                                        className="form-select"
                                        value={form.status}
                                        onChange={e => {
                                            const nextStatus = e.target.value as TireAssetStatus;
                                            setForm(prev => ({
                                                ...prev,
                                                status: nextStatus,
                                                holderType: nextStatus === 'IN_WAREHOUSE'
                                                    ? 'WAREHOUSE'
                                                    : nextStatus === 'LOANED_OUT'
                                                        ? 'EXTERNAL_VEHICLE'
                                                        : 'INTERNAL_VEHICLE',
                                                slotCode: nextStatus === 'IN_USE'
                                                    ? (prev.slotCode && !prev.slotCode.startsWith('SP') ? prev.slotCode : '1L')
                                                    : nextStatus === 'SPARE'
                                                        ? (prev.slotCode && prev.slotCode.startsWith('SP') ? prev.slotCode : 'SP1')
                                                        : '',
                                            }));
                                        }}
                                        disabled={saving}
                                    >
                                        {TIRE_STATUS_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                                    </select>
                                </div>
                            </div>

                            {form.holderType === 'INTERNAL_VEHICLE' && (
                                <div className="form-row">
                                    <div className="form-group">
                                        <label className="form-label">Kendaraan</label>
                                        <select className="form-select" value={form.vehicleRef} onChange={e => updateForm('vehicleRef', e.target.value)} disabled={saving}>
                                            <option value="">Pilih kendaraan</option>
                                            {selectableVehicles.map(vehicle => <option key={vehicle._id} value={vehicle._id}>{vehicle.plateNumber} - {vehicle.brandModel}</option>)}
                                        </select>
                                    </div>
                                    <div className="form-group">
                                        <label className="form-label">Slot Ban</label>
                                        <select className="form-select" value={form.slotCode} onChange={e => updateForm('slotCode', e.target.value)} disabled={saving}>
                                            {internalSlots.map(code => <option key={code} value={code}>{code} - {formatTireSlotLabel(code)}</option>)}
                                        </select>
                                    </div>
                                </div>
                            )}

                            {form.holderType === 'EXTERNAL_VEHICLE' && (
                                <div className="form-row">
                                    <div className="form-group">
                                        <label className="form-label">Nama Pihak Luar</label>
                                        <input className="form-input" value={form.externalPartyName} onChange={e => updateForm('externalPartyName', e.target.value)} disabled={saving} />
                                    </div>
                                    <div className="form-group">
                                        <label className="form-label">Plat / Identitas Unit</label>
                                        <input className="form-input" value={form.externalPlateNumber} onChange={e => updateForm('externalPlateNumber', e.target.value.toUpperCase())} disabled={saving} />
                                    </div>
                                </div>
                            )}

                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label">Merk / Model</label>
                                    <input className="form-input" value={form.tireBrand} onChange={e => updateForm('tireBrand', e.target.value)} disabled={saving} />
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Ukuran</label>
                                    <input className="form-input" value={form.tireSize} onChange={e => updateForm('tireSize', e.target.value)} placeholder="295/80R22.5" disabled={saving} />
                                </div>
                            </div>

                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label">Tanggal Catat</label>
                                    <input type="date" className="form-input" value={form.installDate} onChange={e => updateForm('installDate', e.target.value)} disabled={saving} />
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Catatan</label>
                                    <input className="form-input" value={form.notes} onChange={e => updateForm('notes', e.target.value)} disabled={saving} />
                                </div>
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setShowModal(false)} disabled={saving}>Batal</button>
                            <button className="btn btn-primary" onClick={handleSave} disabled={saving}>{saving ? 'Menyimpan...' : 'Simpan'}</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
