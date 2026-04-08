'use client';

import Link from 'next/link';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useApp, useToast } from '../../layout';
import { Plus, Search, Disc3, CheckCircle, Warehouse, ExternalLink, History } from 'lucide-react';
import AppPagination from '@/components/AppPagination';
import SortableTableHeader, { type SortDirection } from '@/components/SortableTableHeader';
import { fetchAdminCollectionData, fetchAllAdminCollectionData } from '@/lib/api/admin-client';
import {
    buildTiresQuery,
    createDefaultTireForm,
    getSelectableInternalTireSlotOptions,
    getSelectableTireVehicleCategories,
    getSelectableTireVehiclesByCategory,
    getTireVehicleCategoryValue,
    resolveFleetTireEvents,
    TIRE_TYPES,
    type ResolvedFleetTireEvent,
    type TireFormState,
} from '@/lib/fleet-asset-page-support';
import { isTireTrackedWarehouseItem, WAREHOUSE_ITEM_TRACKING_MODE_LABELS } from '@/lib/inventory';
import { formatDate, TIRE_ASSET_STATUS_MAP } from '@/lib/utils';
import { DEFAULT_PAGE_SIZE } from '@/lib/pagination';
import {
    formatTireSlotLabel,
    getSuggestedVehicleTireLayout,
    resolveTireSlotCode,
    TIRE_HOLDER_TYPE_OPTIONS,
    TIRE_STATUS_OPTIONS,
    type TireAssetStatus,
    type TireHolderType,
} from '@/lib/tire-slots';
import { getTireHistoryActionColor, getTireHistoryActionLabel, getTireHistoryTransitionLabel } from '@/lib/tire-history';
import type { TireEvent, TireHistoryLog, Vehicle, WarehouseItem } from '@/lib/types';
import { hasPageAccess, hasPermission } from '@/lib/rbac';
import { formatDateTime } from '@/lib/utils';

export default function TiresPage() {
    const { user } = useApp();
    const { addToast } = useToast();
    const [events, setEvents] = useState<TireEvent[]>([]);
    const [allTireEvents, setAllTireEvents] = useState<TireEvent[]>([]);
    const [vehicles, setVehicles] = useState<Vehicle[]>([]);
    const [warehouseItems, setWarehouseItems] = useState<WarehouseItem[]>([]);
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
    const [form, setForm] = useState<TireFormState>(createDefaultTireForm());
    const [historyTarget, setHistoryTarget] = useState<ResolvedFleetTireEvent | null>(null);
    const [historyRows, setHistoryRows] = useState<TireHistoryLog[]>([]);
    const [loadingHistory, setLoadingHistory] = useState(false);
    const [dateSortDir, setDateSortDir] = useState<SortDirection | null>(null);
    const [vehicleCategoryFilter, setVehicleCategoryFilter] = useState('');
    const canCreateTires = user ? hasPermission(user.role, 'tires', 'create') : false;
    const canManageTires = user ? hasPermission(user.role, 'tires', 'update') : false;
    const canOpenPurchases = user ? hasPageAccess(user.role, 'purchases') : false;
    const canOpenItems = user ? hasPageAccess(user.role, 'warehouseItems') : false;
    const linkedWarehouseItemLocked = Boolean(editTarget?.linkedWarehouseItemRef || editTarget?.sourcePurchaseRef);

    useEffect(() => {
        setPage(1);
    }, [search, filterVehicle, filterStatus]);

    const buildCurrentTiresQuery = useCallback(
        (targetPage = page, targetPageSize = DEFAULT_PAGE_SIZE) =>
            buildTiresQuery({
                page: targetPage,
                pageSize: targetPageSize,
                search,
                filterVehicle,
                filterStatus,
                sortField: dateSortDir ? 'installDate' : undefined,
                sortDir: dateSortDir || undefined,
        }),
        [dateSortDir, filterStatus, filterVehicle, page, search]
    );

    const fetchAllMatchingTires = useCallback(async () => {
        const pageSize = 200;
        let currentPage = 1;
        let total = 0;
        const allItems: TireEvent[] = [];

        do {
            const res = await fetch(`/api/data?${buildCurrentTiresQuery(currentPage, pageSize)}`);
            const payload = await res.json();
            if (!res.ok) {
                throw new Error(payload.error || 'Gagal memuat data ban');
            }

            const nextItems = (payload.data || []) as TireEvent[];
            total = payload.meta?.total || nextItems.length;
            allItems.push(...nextItems);
            if (nextItems.length === 0) break;
            currentPage += 1;
        } while (allItems.length < total);

        return allItems;
    }, [buildCurrentTiresQuery]);

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

            const [tirePayload, vehiclePayload, matchingTires, allTireRows, warehouseItemRows] = await Promise.all([
                fetchEntity<TireEvent[]>(`/api/data?${buildCurrentTiresQuery()}`),
                fetchAdminCollectionData<Vehicle[]>('/api/data?entity=vehicles', 'Gagal memuat data ban'),
                fetchAllMatchingTires(),
                fetchAllAdminCollectionData<TireEvent>('/api/data?entity=tire-events', 'Gagal memuat data ban'),
                fetchAllAdminCollectionData<WarehouseItem>('/api/data?entity=warehouse-items&pageSize=200', 'Gagal memuat data ban'),
            ]);

            const nextCounts = matchingTires.reduce(
                (totals, tire) => {
                    const resolvedTire = resolveFleetTireEvents([tire])[0];
                    const slotCode = resolvedTire?.slotCode || '';
                    if (resolvedTire?.status === 'IN_USE' && slotCode.startsWith('SP')) {
                        totals.spare += 1;
                    } else if (resolvedTire?.status === 'IN_USE') {
                        totals.mounted += 1;
                    } else if (resolvedTire?.status === 'IN_WAREHOUSE') {
                        totals.warehouse += 1;
                    } else if (resolvedTire?.status === 'LOANED_OUT') {
                        totals.loaned += 1;
                    }
                    return totals;
                },
                { mounted: 0, spare: 0, warehouse: 0, loaned: 0 }
            );
            setEvents(tirePayload.data || []);
            setAllTireEvents(allTireRows || []);
            setFilteredTotalTires(tirePayload.meta?.total || 0);
            setVehicles(vehiclePayload || []);
            setWarehouseItems((warehouseItemRows || []).filter(item => item.active !== false));
            setMountedCount(nextCounts.mounted);
            setSpareCount(nextCounts.spare);
            setWarehouseCount(nextCounts.warehouse);
            setLoanedCount(nextCounts.loaned);
        } catch (error) {
            addToast('error', error instanceof Error ? error.message : 'Gagal memuat data ban');
        } finally {
            setLoading(false);
        }
    }, [addToast, buildCurrentTiresQuery, fetchAllMatchingTires]);

    useEffect(() => {
        void loadData();
    }, [loadData]);

    const resolvedEvents = resolveFleetTireEvents(events);
    const vehicleCategoryOptions = useMemo(
        () => getSelectableTireVehicleCategories(vehicles, editTarget),
        [editTarget, vehicles]
    );
    const selectableVehicles = useMemo(
        () => getSelectableTireVehiclesByCategory(vehicles, editTarget, vehicleCategoryFilter || undefined),
        [editTarget, vehicleCategoryFilter, vehicles]
    );
    const trackedTireItems = useMemo(
        () => warehouseItems.filter(item => isTireTrackedWarehouseItem(item)),
        [warehouseItems]
    );
    const selectedLinkedWarehouseItem = useMemo(
        () => trackedTireItems.find(item => item._id === form.linkedWarehouseItemRef) || null,
        [form.linkedWarehouseItemRef, trackedTireItems]
    );
    const selectedVehicle = useMemo(
        () => vehicles.find(vehicle => vehicle._id === form.vehicleRef) || null,
        [form.vehicleRef, vehicles]
    );
    const slotOptions = useMemo(
        () => getSelectableInternalTireSlotOptions({
            vehicle: selectedVehicle,
            tireEvents: allTireEvents,
            editTargetId: editTarget?._id,
        }),
        [allTireEvents, editTarget?._id, selectedVehicle]
    );
    const occupiedSlotCount = slotOptions.filter(option => option.occupied).length;
    const availableSlotCount = slotOptions.length - occupiedSlotCount;
    const selectedVehicleLayoutSummary = useMemo(() => {
        if (!selectedVehicle) {
            return null;
        }

        const vehicleTires = resolveFleetTireEvents(allTireEvents).filter(event =>
            event.vehicleRef === selectedVehicle._id &&
            event.holderType === 'INTERNAL_VEHICLE' &&
            event.status === 'IN_USE' &&
            Boolean(event.slotCode)
        );
        const layout = getSuggestedVehicleTireLayout(
            selectedVehicle.vehicleType,
            selectedVehicle.serviceName,
            vehicleTires.map(event => event.slotCode || '').filter(Boolean),
            selectedVehicle.tireLayoutConfig
        );
        const occupiedSlots = new Set(
            vehicleTires
                .filter(event => event._id !== editTarget?._id)
                .map(event => event.slotCode || '')
                .filter(Boolean)
        );

        return {
            roadTotal: layout.roadSlots.length,
            roadFilled: layout.roadSlots.filter(slotCode => occupiedSlots.has(slotCode)).length,
            spareTotal: layout.spareSlots.length,
            spareFilled: layout.spareSlots.filter(slotCode => occupiedSlots.has(slotCode)).length,
        };
    }, [allTireEvents, editTarget?._id, selectedVehicle]);

    const resetForm = () => setForm(createDefaultTireForm());

    const openAdd = () => {
        if (!canCreateTires) return;
        setEditTarget(null);
        setVehicleCategoryFilter('');
        resetForm();
        setShowModal(true);
    };

    const openEdit = (event: TireEvent) => {
        if (!canManageTires) return;
        const resolvedEvent = resolvedEvents.find(item => item._id === event._id);
        const holderType = resolvedEvent?.holderType || 'INTERNAL_VEHICLE';
        const status = resolvedEvent?.status || 'IN_USE';
        const slotCode = resolvedEvent?.slotCode || resolveTireSlotCode(event) || '';
        const nextVehicleCategory = event.vehicleRef
            ? getTireVehicleCategoryValue(vehicles.find(vehicle => vehicle._id === event.vehicleRef) || {
                _id: event.vehicleRef,
                serviceRef: undefined,
                serviceName: undefined,
                vehicleType: '',
            })
            : '';
        setEditTarget(event);
        setVehicleCategoryFilter(nextVehicleCategory);
        setForm({
            tireCode: event.tireCode || '',
            holderType,
            status,
            vehicleRef: event.vehicleRef || '',
            slotCode,
            linkedWarehouseItemRef: event.linkedWarehouseItemRef || '',
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

    const openHistory = async (event: ResolvedFleetTireEvent) => {
        setHistoryTarget(event);
        setHistoryRows([]);
        setLoadingHistory(true);
        try {
            const filter = encodeURIComponent(JSON.stringify({ tireEventRef: event._id }));
            const rows = await fetchAdminCollectionData<TireHistoryLog[]>(
                `/api/data?entity=tire-history-logs&filter=${filter}`,
                'Gagal memuat riwayat ban'
            );
            setHistoryRows(rows || []);
        } catch (error) {
            addToast('error', error instanceof Error ? error.message : 'Gagal memuat riwayat ban');
        } finally {
            setLoadingHistory(false);
        }
    };

    const updateForm = <K extends keyof TireFormState>(key: K, value: TireFormState[K]) => {
        setForm(prev => ({ ...prev, [key]: value }));
    };

    useEffect(() => {
        if (form.holderType !== 'INTERNAL_VEHICLE') {
            return;
        }

        const selectedVehicleStillVisible = selectableVehicles.some(vehicle => vehicle._id === form.vehicleRef);
        if (!selectedVehicleStillVisible && form.vehicleRef) {
            setForm(prev => ({ ...prev, vehicleRef: '', slotCode: '' }));
        }
    }, [form.holderType, form.vehicleRef, selectableVehicles]);

    useEffect(() => {
        if (form.holderType !== 'INTERNAL_VEHICLE') {
            return;
        }

        const preferredSlot = slotOptions.find(option => !option.disabled)?.value || slotOptions[0]?.value || '';
        if (!preferredSlot) {
            if (form.slotCode) {
                setForm(prev => ({ ...prev, slotCode: '' }));
            }
            return;
        }

        const activeSlotStillValid = slotOptions.some(option => option.value === form.slotCode && !option.disabled);
        if (!activeSlotStillValid && preferredSlot !== form.slotCode) {
            setForm(prev => ({ ...prev, slotCode: preferredSlot }));
        }
    }, [form.holderType, form.slotCode, slotOptions]);

    useEffect(() => {
        if (!selectedLinkedWarehouseItem) {
            return;
        }
        setForm(prev => {
            const nextBrand = prev.tireBrand || selectedLinkedWarehouseItem.tireBrandDefault || prev.tireBrand;
            const nextSize = prev.tireSize || selectedLinkedWarehouseItem.tireSizeDefault || prev.tireSize;
            const nextType = prev.tireType || selectedLinkedWarehouseItem.tireTypeDefault || prev.tireType;
            if (nextBrand === prev.tireBrand && nextSize === prev.tireSize && nextType === prev.tireType) {
                return prev;
            }
            return {
                ...prev,
                tireBrand: nextBrand,
                tireSize: nextSize,
                tireType: nextType,
            };
        });
    }, [selectedLinkedWarehouseItem]);

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
                linkedWarehouseItemRef: form.linkedWarehouseItemRef || undefined,
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
                </div>
                <div className="page-actions">
                    {canCreateTires && <button className="btn btn-primary" onClick={openAdd}><Plus size={16} /> Catat Ban</button>}
                </div>
            </div>

            <div className="kpi-grid" style={{ marginBottom: '1.5rem' }}>
                <div className="kpi-card"><div className="kpi-icon success"><CheckCircle size={20} /></div><div className="kpi-content"><div className="kpi-label">Terpasang</div><div className="kpi-value">{mountedCount}</div></div></div>
                <div className="kpi-card"><div className="kpi-icon info"><Disc3 size={20} /></div><div className="kpi-content"><div className="kpi-label">Serep</div><div className="kpi-value">{spareCount}</div></div></div>
                <div className="kpi-card"><div className="kpi-icon warning"><ExternalLink size={20} /></div><div className="kpi-content"><div className="kpi-label">Dipinjam Keluar</div><div className="kpi-value">{loanedCount}</div></div></div>
                <div className="kpi-card"><div className="kpi-icon primary"><Warehouse size={20} /></div><div className="kpi-content"><div className="kpi-label">Di Gudang</div><div className="kpi-value">{warehouseCount}</div></div></div>
            </div>

            <div className="info-banner" style={{ marginBottom: '1.5rem' }}>
                <div className="info-banner-title">Integrasi Ban dan Inventory</div>
                <div className="info-banner-text">
                    Harga pembelian ban dikelola di modul inventory dan pembelian supplier. Halaman ini fokus pada histori aset ban, posisi unit, dan pergerakan ban tanpa menampilkan harga.
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
                                <th>Sumber</th>
                                <th><SortableTableHeader label="Tgl Catat" direction={dateSortDir} onToggle={() => setDateSortDir(current => current === 'desc' ? 'asc' : 'desc')} /></th>
                                <th>Catatan</th>
                                <th></th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? [1, 2, 3].map(i => <tr key={i}>{[1, 2, 3, 4, 5, 6, 7, 8].map(j => <td key={j}><div className="skeleton skeleton-text" /></td>)}</tr>) :
                                filteredTotalTires === 0 ? (
                                    <tr><td colSpan={8}>
                                        <div className="empty-state">
                                            <Disc3 size={48} className="empty-state-icon" />
                                            <div className="empty-state-title">Belum ada ban tercatat</div>
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
                                        <td>
                                            {event.sourcePurchaseNumber ? (
                                                <div style={{ display: 'grid', gap: '0.2rem' }}>
                                                    <div className="text-sm">
                                                        {canOpenPurchases ? (
                                                            <Link href={`/inventory/purchases/${event.sourcePurchaseRef}`} style={{ color: 'var(--color-primary)' }}>
                                                                {event.sourcePurchaseNumber}
                                                            </Link>
                                                        ) : event.sourcePurchaseNumber}
                                                    </div>
                                                    <div className="text-muted text-sm">
                                                        {canOpenItems && event.linkedWarehouseItemRef ? (
                                                            <Link href={`/inventory/items/${event.linkedWarehouseItemRef}`} style={{ color: 'var(--color-primary)' }}>
                                                                {event.linkedWarehouseItemCode || event.linkedWarehouseItemName || '-'}
                                                            </Link>
                                                        ) : (event.linkedWarehouseItemCode || event.linkedWarehouseItemName || '-')}
                                                    </div>
                                                </div>
                                            ) : (
                                                <span className="text-muted">{event.linkedWarehouseItemCode || '-'}</span>
                                            )}
                                        </td>
                                        <td className="text-muted">{formatDate(event.installDate)}</td>
                                        <td className="text-muted">{event.notes || '-'}</td>
                                        <td>
                                            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                                                <button className="btn btn-secondary" style={{ padding: '4px 10px', fontSize: '0.75rem' }} onClick={() => openHistory(event)}>
                                                    <History size={13} /> Riwayat
                                                </button>
                                                {canManageTires && <button className="btn btn-secondary" style={{ padding: '4px 10px', fontSize: '0.75rem' }} onClick={() => openEdit(event)}>Edit</button>}
                                            </div>
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
                                    <div className="mobile-record-kv">
                                        <span className="mobile-record-label">Sumber</span>
                                        <span className="mobile-record-value">
                                            {event.sourcePurchaseNumber || event.linkedWarehouseItemCode || '-'}
                                        </span>
                                    </div>
                                    {event.notes && (
                                        <div className="mobile-record-kv">
                                            <span className="mobile-record-label">Catatan</span>
                                            <span className="mobile-record-value">{event.notes}</span>
                                        </div>
                                    )}
                                </div>
                                <div className="mobile-record-actions">
                                    <button className="btn btn-secondary" onClick={() => openHistory(event)}>Riwayat</button>
                                    {canManageTires && <button className="btn btn-secondary" onClick={() => openEdit(event)}>Edit</button>}
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

            {(canCreateTires || canManageTires) && showModal && (
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
                                    <label className="form-label">Master Barang Gudang</label>
                                    <select
                                        className="form-select"
                                        value={form.linkedWarehouseItemRef}
                                        onChange={e => updateForm('linkedWarehouseItemRef', e.target.value)}
                                        disabled={saving || linkedWarehouseItemLocked}
                                    >
                                        <option value="">Tidak dihubungkan</option>
                                        {trackedTireItems.map(item => (
                                            <option key={item._id} value={item._id}>
                                                {item.itemCode} - {item.name}
                                            </option>
                                        ))}
                                    </select>
                                    <div className="text-muted text-xs" style={{ marginTop: '0.35rem' }}>
                                        Pilih master barang jika ban ini harus sinkron ke stok gudang ban. Harga tetap dikelola di modul inventory.
                                    </div>
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Mode Tracking</label>
                                    <input
                                        className="form-input"
                                        value={selectedLinkedWarehouseItem ? WAREHOUSE_ITEM_TRACKING_MODE_LABELS[selectedLinkedWarehouseItem.trackingMode || 'STANDARD'] : 'Ban mandiri'}
                                        readOnly
                                    />
                                </div>
                            </div>

                            {editTarget?.sourcePurchaseNumber && (
                                <div className="info-banner" style={{ marginBottom: '1rem' }}>
                                    <div className="info-banner-title">Sumber Pembelian</div>
                                    <div className="info-banner-text">
                                        Ban ini terdaftar dari pembelian {editTarget.sourcePurchaseNumber}.
                                        {canOpenPurchases && editTarget.sourcePurchaseRef && (
                                            <>
                                                {' '}
                                                <Link href={`/inventory/purchases/${editTarget.sourcePurchaseRef}`} style={{ color: 'var(--color-primary)', fontWeight: 600 }}>
                                                    Buka pembelian
                                                </Link>
                                            </>
                                        )}
                                    </div>
                                </div>
                            )}

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
                                            if (nextHolderType !== 'INTERNAL_VEHICLE') {
                                                setVehicleCategoryFilter('');
                                            }
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
                                                    ? (prev.slotCode || '1L')
                                                    : '',
                                            }));
                                            if (nextStatus === 'IN_WAREHOUSE' || nextStatus === 'LOANED_OUT') {
                                                setVehicleCategoryFilter('');
                                            }
                                        }}
                                        disabled={saving}
                                    >
                                        {TIRE_STATUS_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                                    </select>
                                </div>
                            </div>

                            {selectedLinkedWarehouseItem && form.holderType === 'WAREHOUSE' && (
                                <div className="info-banner" style={{ marginBottom: '1rem' }}>
                                    <div className="info-banner-title">Sinkron Stok Gudang Ban</div>
                                    <div className="info-banner-text">
                                        Ban ini terhubung ke {selectedLinkedWarehouseItem.itemCode} - {selectedLinkedWarehouseItem.name}. Saat ban masuk gudang stok akan bertambah, dan saat ban keluar ke unit atau pihak luar stok akan berkurang otomatis.
                                    </div>
                                </div>
                            )}

                            {form.holderType === 'INTERNAL_VEHICLE' && (
                                <div className="form-row">
                                    <div className="form-group">
                                        <label className="form-label">Kategori Armada</label>
                                        <select
                                            className="form-select"
                                            value={vehicleCategoryFilter}
                                            onChange={e => {
                                                const nextCategory = e.target.value;
                                                setVehicleCategoryFilter(nextCategory);
                                                if (nextCategory && form.vehicleRef) {
                                                    const selectedVehicleValue = getTireVehicleCategoryValue(selectedVehicle || {
                                                        _id: '',
                                                        serviceRef: undefined,
                                                        serviceName: undefined,
                                                        vehicleType: '',
                                                    });
                                                    if (selectedVehicleValue !== nextCategory) {
                                                        setForm(prev => ({ ...prev, vehicleRef: '', slotCode: '' }));
                                                    }
                                                }
                                            }}
                                            disabled={saving}
                                        >
                                            <option value="">Semua kategori</option>
                                            {vehicleCategoryOptions.map(option => (
                                                <option key={option.value} value={option.value}>
                                                    {option.label} ({option.vehicleCount} unit)
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                    <div className="form-group">
                                        <label className="form-label">Kendaraan</label>
                                        <select
                                            className="form-select"
                                            value={form.vehicleRef}
                                            onChange={e => {
                                                const nextVehicleRef = e.target.value;
                                                const nextVehicle = selectableVehicles.find(vehicle => vehicle._id === nextVehicleRef) || null;
                                                if (nextVehicle) {
                                                    setVehicleCategoryFilter(getTireVehicleCategoryValue(nextVehicle));
                                                }
                                                setForm(prev => ({ ...prev, vehicleRef: nextVehicleRef, slotCode: '' }));
                                            }}
                                            disabled={saving}
                                        >
                                            <option value="">Pilih kendaraan</option>
                                            {selectableVehicles.map(vehicle => <option key={vehicle._id} value={vehicle._id}>{vehicle.plateNumber} - {vehicle.brandModel}</option>)}
                                        </select>
                                    </div>
                                </div>
                            )}

                            {form.holderType === 'INTERNAL_VEHICLE' && (
                                <div className="form-row">
                                    <div className="form-group">
                                        <label className="form-label">Slot Ban</label>
                                        <select
                                            className="form-select"
                                            value={form.slotCode}
                                            onChange={e => updateForm('slotCode', e.target.value)}
                                            disabled={saving || !selectedVehicle || slotOptions.length === 0}
                                        >
                                            {!selectedVehicle && <option value="">Pilih kendaraan dulu</option>}
                                            {slotOptions.map(option => (
                                                <option key={option.value} value={option.value} disabled={option.disabled}>
                                                    {option.label}
                                                </option>
                                            ))}
                                        </select>
                                        <div style={{ fontSize: '0.76rem', color: 'var(--color-gray-600)', marginTop: '0.4rem' }}>
                                            {selectedVehicle
                                                ? `${occupiedSlotCount}/${slotOptions.length} slot terisi, ${availableSlotCount} slot tersedia.`
                                                : 'Slot akan menyesuaikan jumlah roda kendaraan yang dipilih.'}
                                        </div>
                                    </div>
                                    <div className="form-group">
                                        <label className="form-label">Info Layout</label>
                                        <div style={{ border: '1px solid var(--color-gray-200)', borderRadius: '0.75rem', padding: '0.75rem 0.9rem', background: 'var(--color-gray-50)', minHeight: '100%' }}>
                                            <div className="font-medium" style={{ marginBottom: '0.35rem' }}>
                                                {selectedVehicle ? `${selectedVehicle.plateNumber} - ${selectedVehicle.serviceName || selectedVehicle.vehicleType || 'Tanpa kategori'}` : 'Pilih kendaraan'}
                                            </div>
                                            <div className="text-muted text-sm">
                                                {selectedVehicle
                                                    ? `Slot tampil otomatis mengikuti kategori/unit ini, dan tiap slot diberi status kosong atau terisi.`
                                                    : 'Pilih kendaraan agar jumlah slot mengikuti kategori armada.'}
                                            </div>
                                            {selectedVehicleLayoutSummary && (
                                                <div style={{ display: 'grid', gap: '0.2rem', marginTop: '0.55rem', fontSize: '0.76rem', color: 'var(--color-gray-700)' }}>
                                                    <div>Ban jalan: {selectedVehicleLayoutSummary.roadFilled}/{selectedVehicleLayoutSummary.roadTotal} slot terisi</div>
                                                    <div>Ban serep: {selectedVehicleLayoutSummary.spareFilled}/{selectedVehicleLayoutSummary.spareTotal} slot terisi</div>
                                                </div>
                                            )}
                                        </div>
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

            {historyTarget && (
                <div className="modal-overlay" onClick={() => { if (!loadingHistory) setHistoryTarget(null); }}>
                    <div className="modal modal-lg" onClick={event => event.stopPropagation()}>
                        <div className="modal-header">
                            <h3 className="modal-title">Riwayat Ban {historyTarget.tireCodeLabel}</h3>
                            <button className="modal-close" onClick={() => setHistoryTarget(null)}>&times;</button>
                        </div>
                        <div className="modal-body">
                            <div style={{ marginBottom: '1rem', color: 'var(--color-gray-600)' }}>
                                {historyTarget.tireBrand} | {historyTarget.tireSize} | {historyTarget.placementLabel}
                            </div>
                            <div style={{ display: 'grid', gap: '0.85rem' }}>
                                {loadingHistory ? (
                                    [1, 2, 3].map(item => <div key={item} className="skeleton skeleton-card" style={{ height: 72 }} />)
                                ) : historyRows.length === 0 ? (
                                    <div className="empty-state">
                                        <div className="empty-state-title">Belum ada riwayat ban</div>
                                        <div className="empty-state-text">Riwayat akan tercatat otomatis saat ban dibuat atau dipindahkan.</div>
                                    </div>
                                ) : historyRows.map(log => (
                                    <div key={log._id} style={{ border: '1px solid var(--color-gray-200)', borderRadius: '0.85rem', padding: '0.95rem 1rem', background: 'var(--color-gray-50)' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'flex-start', marginBottom: '0.4rem', flexWrap: 'wrap' }}>
                                            <span className={`badge badge-${getTireHistoryActionColor(log.actionType)}`}>
                                                <span className="badge-dot" /> {getTireHistoryActionLabel(log.actionType)}
                                            </span>
                                            <div className="text-muted text-sm">{formatDateTime(log.timestamp)}</div>
                                        </div>
                                        <div className="font-medium" style={{ marginBottom: '0.25rem' }}>{getTireHistoryTransitionLabel(log)}</div>
                                        <div className="text-muted text-sm" style={{ marginBottom: '0.25rem' }}>{log.note || '-'}</div>
                                        <div className="text-muted text-sm">Oleh: {log.actorUserName || '-'}</div>
                                    </div>
                                ))}
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setHistoryTarget(null)}>Tutup</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
