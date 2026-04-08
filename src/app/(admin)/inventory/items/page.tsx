'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ArrowDownCircle, ArrowUpCircle, Edit, FileDown, History, Package, Plus, RefreshCw, Save, Search, X } from 'lucide-react';

import AppPagination from '@/components/AppPagination';
import CurrencyInput from '@/components/CurrencyInput';
import { fetchAllAdminCollectionData } from '@/lib/api/admin-client';
import { getBusinessDateValue } from '@/lib/business-date';
import { exportToExcel } from '@/lib/export';
import {
  formatInventoryQuantity,
  INVENTORY_UNIT_OPTIONS,
  isTireTrackedWarehouseItem,
  STOCK_MOVEMENT_SOURCE_LABELS,
  STOCK_MOVEMENT_TYPE_LABELS,
  WAREHOUSE_ITEM_TRACKING_MODE_LABELS,
  WAREHOUSE_ITEM_TRACKING_MODE_OPTIONS,
} from '@/lib/inventory';
import { DEFAULT_PAGE_SIZE } from '@/lib/pagination';
import { hasPageAccess, hasPermission } from '@/lib/rbac';
import type { Maintenance, StockMovement, Supplier, WarehouseItem } from '@/lib/types';
import { formatCurrency, formatDate } from '@/lib/utils';

import { useApp, useToast } from '../../layout';

type ItemFormState = {
  itemCode: string;
  name: string;
  category: string;
  unit: WarehouseItem['unit'];
  trackingMode: NonNullable<WarehouseItem['trackingMode']>;
  minStockQty: string;
  defaultSupplierRef: string;
  defaultPurchasePrice: number;
  tireTypeDefault: string;
  tireBrandDefault: string;
  tireSizeDefault: string;
  notes: string;
  active: boolean;
};

type MovementFormState = {
  movementDate: string;
  sourceType: 'MANUAL_IN' | 'MANUAL_OUT';
  quantity: string;
  note: string;
};

const createItemForm = (item?: Partial<WarehouseItem>): ItemFormState => ({
  itemCode: item?.itemCode || '',
  name: item?.name || '',
  category: item?.category || '',
  unit: item?.unit || 'PCS',
  trackingMode: item?.trackingMode || 'STANDARD',
  minStockQty: item?.minStockQty !== undefined ? String(item.minStockQty) : '',
  defaultSupplierRef: item?.defaultSupplierRef || '',
  defaultPurchasePrice: typeof item?.defaultPurchasePrice === 'number' ? item.defaultPurchasePrice : 0,
  tireTypeDefault: item?.tireTypeDefault || 'Tubeless',
  tireBrandDefault: item?.tireBrandDefault || '',
  tireSizeDefault: item?.tireSizeDefault || '',
  notes: item?.notes || '',
  active: item?.active !== false,
});

const createMovementForm = (sourceType: 'MANUAL_IN' | 'MANUAL_OUT' = 'MANUAL_IN'): MovementFormState => ({
  movementDate: getBusinessDateValue(),
  sourceType,
  quantity: '',
  note: '',
});

const TIRE_TYPE_OPTIONS = ['Tubeless', 'Tube Type', 'Solid'] as const;

function getStockBadge(item: WarehouseItem) {
  const stock = Number(item.currentStockQty || 0);
  const min = Number(item.minStockQty || 0);
  if (item.active === false) return { label: 'Nonaktif', className: 'badge-gray' };
  if (stock <= 0) return { label: 'Habis', className: 'badge-danger' };
  if (min > 0 && stock <= min) return { label: 'Menipis', className: 'badge-warning' };
  return { label: 'Aman', className: 'badge-success' };
}

export default function WarehouseItemsPage() {
  const searchParams = useSearchParams();
  const { user } = useApp();
  const { addToast } = useToast();
  const [items, setItems] = useState<WarehouseItem[]>([]);
  const [allItems, setAllItems] = useState<WarehouseItem[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState(searchParams.get('q') || '');
  const [page, setPage] = useState(1);
  const [filteredTotal, setFilteredTotal] = useState(0);
  const [showModal, setShowModal] = useState(false);
  const [showMovementModal, setShowMovementModal] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [editItem, setEditItem] = useState<WarehouseItem | null>(null);
  const [movementItem, setMovementItem] = useState<WarehouseItem | null>(null);
  const [historyItem, setHistoryItem] = useState<WarehouseItem | null>(null);
  const [historyRows, setHistoryRows] = useState<StockMovement[]>([]);
  const [historyMaintenancesById, setHistoryMaintenancesById] = useState<Record<string, Pick<Maintenance, '_id' | 'vehicleRef' | 'vehiclePlate' | 'type'>>>({});
  const [saving, setSaving] = useState(false);
  const [savingMovement, setSavingMovement] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [form, setForm] = useState<ItemFormState>(createItemForm());
  const [movementForm, setMovementForm] = useState<MovementFormState>(createMovementForm());

  const canManage = user ? hasPermission(user.role, 'warehouseItems', 'create') || hasPermission(user.role, 'warehouseItems', 'update') : false;
  const canExport = user ? hasPermission(user.role, 'warehouseItems', 'export') : false;
  const canOpenSuppliers = user ? hasPageAccess(user.role, 'suppliers') : false;
  const canOpenPurchasePage = user ? hasPageAccess(user.role, 'purchases') : false;
  const canOpenVehiclePage = user ? hasPageAccess(user.role, 'vehicles') : false;
  const canOpenTirePage = user ? hasPageAccess(user.role, 'tires') : false;
  const canOpenItemDetail = user ? hasPageAccess(user.role, 'warehouseItems') : false;
  const activeSuppliers = useMemo(() => suppliers.filter((supplier) => supplier.active !== false), [suppliers]);
  const activeItemCount = allItems.filter((item) => item.active !== false).length;
  const lowStockCount = allItems.filter((item) => {
    const stock = Number(item.currentStockQty || 0);
    return item.active !== false && Number(item.minStockQty || 0) > 0 && stock > 0 && stock <= Number(item.minStockQty || 0);
  }).length;
  const outOfStockCount = allItems.filter((item) => item.active !== false && Number(item.currentStockQty || 0) <= 0).length;

  const buildQuery = useCallback((targetPage = page, targetPageSize = DEFAULT_PAGE_SIZE) => {
    const params = new URLSearchParams({ entity: 'warehouse-items', page: String(targetPage), pageSize: String(targetPageSize), sortField: 'itemCode', sortDir: 'asc' });
    if (search.trim()) {
      params.set('q', search.trim());
      params.set('searchFields', 'itemCode,name,category,defaultSupplierName,notes');
    }
    return params.toString();
  }, [page, search]);

  const loadItems = useCallback(async () => {
    setLoading(true);
    try {
      const [listRes, itemRows, supplierRows] = await Promise.all([
        fetch(`/api/data?${buildQuery()}`),
        fetchAllAdminCollectionData<WarehouseItem>('/api/data?entity=warehouse-items&pageSize=200', 'Gagal memuat barang gudang', 200),
        fetchAllAdminCollectionData<Supplier>('/api/data?entity=suppliers&pageSize=200', 'Gagal memuat supplier', 200),
      ]);
      const payload = await listRes.json();
      if (!listRes.ok) throw new Error(payload.error || 'Gagal memuat barang gudang');
      setItems((payload.data || []) as WarehouseItem[]);
      setFilteredTotal(payload.meta?.total || 0);
      setAllItems(itemRows || []);
      setSuppliers(supplierRows || []);
    } catch (error) {
      addToast('error', error instanceof Error ? error.message : 'Gagal memuat barang gudang');
    } finally {
      setLoading(false);
    }
  }, [addToast, buildQuery]);

  useEffect(() => { void loadItems(); }, [loadItems]);
  useEffect(() => { setPage(1); }, [search]);
  useEffect(() => {
    const nextSearch = searchParams.get('q') || '';
    setSearch((current) => current === nextSearch ? current : nextSearch);
  }, [searchParams]);

  const closeModal = () => { if (!saving) { setShowModal(false); setEditItem(null); setForm(createItemForm()); } };
  const closeMovementModal = () => { if (!savingMovement) { setShowMovementModal(false); setMovementItem(null); setMovementForm(createMovementForm()); } };
  const closeHistoryModal = () => { if (!loadingHistory) { setShowHistoryModal(false); setHistoryItem(null); setHistoryRows([]); setHistoryMaintenancesById({}); } };
  const openCreate = () => { setEditItem(null); setForm(createItemForm()); setShowModal(true); };
  const openEdit = (item: WarehouseItem) => { setEditItem(item); setForm(createItemForm(item)); setShowModal(true); };
  const openMovement = (item: WarehouseItem, sourceType: 'MANUAL_IN' | 'MANUAL_OUT') => { setMovementItem(item); setMovementForm(createMovementForm(sourceType)); setShowMovementModal(true); };
  const openHistory = async (item: WarehouseItem) => {
    setHistoryItem(item);
    setHistoryRows([]);
    setHistoryMaintenancesById({});
    setShowHistoryModal(true);
    setLoadingHistory(true);
    try {
      const rows = await fetchAllAdminCollectionData<StockMovement>(
        `/api/data?entity=stock-movements&filter=${encodeURIComponent(JSON.stringify({ warehouseItemRef: item._id }))}&pageSize=100&sortField=movementDate&sortDir=desc`,
        'Gagal memuat riwayat mutasi stok',
        100
      );
      setHistoryRows(rows || []);

      if (!canOpenVehiclePage) {
        setHistoryMaintenancesById({});
        return;
      }

      const maintenanceRefs = Array.from(
        new Set(
          (rows || [])
            .filter((row) => row.sourceType === 'MAINTENANCE_USAGE' && typeof row.sourceRef === 'string' && row.sourceRef.trim())
            .map((row) => row.sourceRef as string)
        )
      );

      if (maintenanceRefs.length === 0) {
        setHistoryMaintenancesById({});
        return;
      }

      const maintenanceEntries = await Promise.all(
        maintenanceRefs.map(async (maintenanceRef) => {
          const res = await fetch(`/api/data?entity=maintenances&id=${maintenanceRef}`);
          const payload = await res.json();
          if (!res.ok || !payload?.data?._id) {
            return null;
          }
          const maintenance = payload.data as Maintenance;
          return [maintenanceRef, {
            _id: maintenance._id,
            vehicleRef: maintenance.vehicleRef,
            vehiclePlate: maintenance.vehiclePlate,
            type: maintenance.type,
          }] as const;
        })
      );

      setHistoryMaintenancesById(
        maintenanceEntries.reduce<Record<string, Pick<Maintenance, '_id' | 'vehicleRef' | 'vehiclePlate' | 'type'>>>((acc, entry) => {
          if (!entry) return acc;
          acc[entry[0]] = entry[1];
          return acc;
        }, {})
      );
    } catch (error) {
      addToast('error', error instanceof Error ? error.message : 'Gagal memuat riwayat mutasi stok');
      setHistoryRows([]);
      setHistoryMaintenancesById({});
    } finally {
      setLoadingHistory(false);
    }
  };

  const getMovementSourceMeta = (movement: StockMovement) => {
    const sourceLabel = STOCK_MOVEMENT_SOURCE_LABELS[movement.sourceType];
    if (movement.sourceType === 'PURCHASE_RECEIPT' && movement.sourceRef) {
      return {
        primary: movement.sourceNumber || sourceLabel,
        secondary: sourceLabel,
        href: canOpenPurchasePage ? `/inventory/purchases/${movement.sourceRef}` : undefined,
      };
    }
    if (movement.sourceType === 'MAINTENANCE_USAGE') {
      const maintenance = movement.sourceRef ? historyMaintenancesById[movement.sourceRef] : undefined;
      return {
        primary: canOpenVehiclePage && maintenance?.vehiclePlate ? maintenance.vehiclePlate : 'Maintenance',
        secondary: maintenance?.type ? `${sourceLabel} • ${maintenance.type}` : sourceLabel,
        href: maintenance?.vehicleRef && canOpenVehiclePage ? `/fleet/vehicles/${maintenance.vehicleRef}?tab=maintenance` : undefined,
      };
    }
    if ((movement.sourceType === 'TIRE_DEPLOYMENT' || movement.sourceType === 'TIRE_RETURN') && canOpenTirePage) {
      return {
        primary: movement.sourceNumber || sourceLabel,
        secondary: sourceLabel,
        href: '/fleet/tires',
      };
    }
    return {
      primary: movement.sourceNumber || sourceLabel,
      secondary: sourceLabel,
      href: undefined,
    };
  };

  const handleSave = async () => {
    if (!canManage) return addToast('error', 'Anda tidak punya hak mengubah barang gudang');
    if (!form.itemCode || !form.name || !form.unit) return addToast('error', 'Kode, nama barang, dan satuan wajib diisi');
    setSaving(true);
    try {
      const payload = {
        itemCode: form.itemCode,
        name: form.name,
        category: form.category,
        unit: form.unit,
        trackingMode: form.trackingMode,
        minStockQty: form.minStockQty,
        defaultSupplierRef: form.defaultSupplierRef || undefined,
        defaultPurchasePrice: form.defaultPurchasePrice,
        tireTypeDefault: form.trackingMode === 'TIRE_ASSET' ? form.tireTypeDefault : undefined,
        tireBrandDefault: form.trackingMode === 'TIRE_ASSET' ? form.tireBrandDefault : undefined,
        tireSizeDefault: form.trackingMode === 'TIRE_ASSET' ? form.tireSizeDefault : undefined,
        notes: form.notes,
        active: form.active,
      };
      const res = await fetch('/api/data', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(editItem ? { entity: 'warehouse-items', action: 'update', data: { id: editItem._id, updates: payload } } : { entity: 'warehouse-items', data: payload }) });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Gagal menyimpan barang gudang');
      addToast('success', editItem ? 'Barang gudang diperbarui' : 'Barang gudang ditambahkan');
      closeModal();
      if (!editItem && page !== 1) {
        setPage(1);
      } else {
        await loadItems();
      }
    } catch (error) {
      addToast('error', error instanceof Error ? error.message : 'Gagal menyimpan barang gudang');
    } finally {
      setSaving(false);
    }
  };

  const handleStockMovement = async () => {
    if (!canManage || !movementItem) return addToast('error', 'Anda tidak punya hak mencatat mutasi stok');
    if (isTireTrackedWarehouseItem(movementItem)) return addToast('error', 'Mutasi stok ban tertracking dikelola lewat modul Ban dan pembelian supplier');
    if (!movementForm.quantity || Number(movementForm.quantity) <= 0) return addToast('error', 'Qty mutasi stok wajib diisi');
    setSavingMovement(true);
    try {
      const res = await fetch('/api/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entity: 'stock-movements', data: { warehouseItemRef: movementItem._id, movementDate: movementForm.movementDate, sourceType: movementForm.sourceType, quantity: movementForm.quantity, note: movementForm.note || undefined } }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Gagal mencatat mutasi stok');
      addToast('success', movementForm.sourceType === 'MANUAL_OUT' ? 'Stok keluar dicatat' : 'Stok masuk dicatat');
      closeMovementModal();
      await loadItems();
    } catch (error) {
      addToast('error', error instanceof Error ? error.message : 'Gagal mencatat mutasi stok');
    } finally {
      setSavingMovement(false);
    }
  };

  const toggleActive = async (item: WarehouseItem) => {
    if (!canManage) return addToast('error', 'Anda tidak punya hak mengubah status barang gudang');
    setTogglingId(item._id);
    try {
      const res = await fetch('/api/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entity: 'warehouse-items', action: 'update', data: { id: item._id, updates: { active: item.active === false } } }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Gagal memperbarui status barang gudang');
      addToast('success', item.active === false ? 'Barang gudang diaktifkan' : 'Barang gudang dinonaktifkan');
      await loadItems();
    } catch (error) {
      addToast('error', error instanceof Error ? error.message : 'Gagal memperbarui status barang gudang');
    } finally {
      setTogglingId((current) => current === item._id ? null : current);
    }
  };

  const handleExport = async () => {
    if (!canExport) return;
    try {
      await exportToExcel(
        allItems.map((item) => ({
          kode: item.itemCode,
          nama: item.name,
          kategori: item.category || '-',
          trackingMode: WAREHOUSE_ITEM_TRACKING_MODE_LABELS[item.trackingMode || 'STANDARD'],
          satuan: item.unit,
          stokSaatIni: Number(item.currentStockQty || 0),
          stokMinimum: Number(item.minStockQty || 0),
          supplierDefault: item.defaultSupplierName || '-',
          hargaBeliDefault: Number(item.defaultPurchasePrice || 0),
          tireBrandDefault: item.tireBrandDefault || '-',
          tireSizeDefault: item.tireSizeDefault || '-',
          tireTypeDefault: item.tireTypeDefault || '-',
          status: item.active !== false ? 'Aktif' : 'Nonaktif',
          catatan: item.notes || '',
        })),
        [
          { header: 'Kode Barang', key: 'kode', width: 18 },
          { header: 'Nama Barang', key: 'nama', width: 28 },
          { header: 'Kategori', key: 'kategori', width: 18 },
          { header: 'Mode Tracking', key: 'trackingMode', width: 18 },
          { header: 'Satuan', key: 'satuan', width: 12 },
          { header: 'Stok Saat Ini', key: 'stokSaatIni', width: 14 },
          { header: 'Stok Minimum', key: 'stokMinimum', width: 14 },
          { header: 'Supplier Default', key: 'supplierDefault', width: 24 },
          { header: 'Harga Beli Default', key: 'hargaBeliDefault', width: 18 },
          { header: 'Merk Ban Default', key: 'tireBrandDefault', width: 24 },
          { header: 'Ukuran Ban Default', key: 'tireSizeDefault', width: 20 },
          { header: 'Jenis Ban Default', key: 'tireTypeDefault', width: 16 },
          { header: 'Status', key: 'status', width: 12 },
          { header: 'Catatan', key: 'catatan', width: 30 },
        ],
        `barang-gudang-${getBusinessDateValue()}`,
        'Barang Gudang',
        { title: 'Master Barang Gudang', subtitle: `Total data: ${allItems.length}`, metadata: [{ label: 'Barang Aktif', value: activeItemCount }, { label: 'Barang Menipis', value: lowStockCount }, { label: 'Barang Habis', value: outOfStockCount }] },
      );
      addToast('success', 'Excel barang gudang berhasil di-download');
    } catch (error) {
      addToast('error', error instanceof Error ? error.message : 'Gagal menyiapkan Excel barang gudang');
    }
  };

  return (
    <div>
      <div className="page-header">
        <div className="page-header-left"><h1 className="page-title">Barang Gudang</h1></div>
        <div className="page-actions">
          {canExport && <button className="btn btn-secondary" onClick={() => void handleExport()}><FileDown size={18} /> Excel</button>}
          {canManage && <button className="btn btn-primary" onClick={openCreate}><Plus size={18} /> Tambah Barang</button>}
        </div>
      </div>

      <div className="kpi-grid" style={{ marginBottom: '1.5rem' }}>
        <div className="kpi-card"><div className="kpi-content"><div className="kpi-label">Barang Aktif</div><div className="kpi-value">{activeItemCount}</div></div></div>
        <div className="kpi-card"><div className="kpi-content"><div className="kpi-label">Stok Menipis</div><div className="kpi-value">{lowStockCount}</div></div></div>
        <div className="kpi-card"><div className="kpi-content"><div className="kpi-label">Stok Habis</div><div className="kpi-value">{outOfStockCount}</div></div></div>
        <div className="kpi-card"><div className="kpi-content"><div className="kpi-label">Hak Kelola</div><div className="kpi-value">{canManage ? 'Aktif' : 'Lihat Saja'}</div></div></div>
      </div>

      <div className="table-container">
        <div className="table-toolbar">
          <div className="table-toolbar-left">
            <div className="table-search">
              <Search size={16} className="table-search-icon" />
              <input className="table-search-input" placeholder="Cari kode barang, nama, kategori, supplier..." value={search} onChange={(event) => setSearch(event.target.value)} />
            </div>
          </div>
        </div>

        <div className="table-wrapper table-desktop-only">
          <table>
            <thead>
              <tr><th>Kode</th><th>Barang</th><th>Mode</th><th>Supplier Default</th><th>Stok</th><th>Min. Stok</th><th>Harga Beli</th><th>Status</th><th>Aksi</th></tr>
            </thead>
            <tbody>
              {loading ? [1, 2, 3].map((index) => (
                <tr key={index}>{[1, 2, 3, 4, 5, 6, 7, 8, 9].map((cell) => <td key={cell}><div className="skeleton skeleton-text" /></td>)}</tr>
              )) : filteredTotal === 0 ? (
                <tr><td colSpan={9}><div className="empty-state"><Package size={48} className="empty-state-icon" /><div className="empty-state-title">Belum ada master barang gudang</div></div></td></tr>
              ) : items.map((item) => {
                const badge = getStockBadge(item);
                return (
                  <tr key={item._id}>
                    <td className="font-mono">
                      {canOpenItemDetail ? (
                        <Link href={`/inventory/items/${item._id}`} style={{ color: 'var(--color-primary)' }}>
                          {item.itemCode}
                        </Link>
                      ) : item.itemCode}
                    </td>
                    <td>
                      <div className="font-semibold">
                        {canOpenItemDetail ? (
                          <Link href={`/inventory/items/${item._id}`} style={{ color: 'var(--color-primary)' }}>
                            {item.name}
                          </Link>
                        ) : item.name}
                      </div>
                      <div className="text-muted text-xs">{item.category || 'Tanpa kategori'} | {item.unit}</div>
                    </td>
                    <td>
                      <span className={`badge ${isTireTrackedWarehouseItem(item) ? 'badge-info' : 'badge-gray'}`}>
                        {WAREHOUSE_ITEM_TRACKING_MODE_LABELS[item.trackingMode || 'STANDARD']}
                      </span>
                    </td>
                    <td>
                      {canOpenSuppliers && item.defaultSupplierRef ? (
                        <Link href={`/suppliers/${item.defaultSupplierRef}`} style={{ color: 'var(--color-primary)' }}>
                          {item.defaultSupplierName || '-'}
                        </Link>
                      ) : (item.defaultSupplierName || '-')}
                    </td>
                    <td>{formatInventoryQuantity(item.currentStockQty || 0)} {item.unit}</td>
                    <td>{formatInventoryQuantity(item.minStockQty || 0)} {item.unit}</td>
                    <td>{Number(item.defaultPurchasePrice || 0) > 0 ? formatCurrency(Number(item.defaultPurchasePrice || 0)) : '-'}</td>
                    <td><span className={`badge ${badge.className}`}>{badge.label}</span></td>
                    <td>
                      <div className="table-actions">
                        {canManage ? (
                          <>
                            <button className="table-action-btn" onClick={() => openEdit(item)}><Edit size={14} /> Edit</button>
                            <button className="table-action-btn" onClick={() => void openHistory(item)}><History size={14} /> Riwayat</button>
                            {!isTireTrackedWarehouseItem(item) && <button className="table-action-btn" onClick={() => openMovement(item, 'MANUAL_IN')}><ArrowDownCircle size={14} /> Masuk</button>}
                            {!isTireTrackedWarehouseItem(item) && <button className="table-action-btn" onClick={() => openMovement(item, 'MANUAL_OUT')}><ArrowUpCircle size={14} /> Keluar</button>}
                            <button className="table-action-btn" onClick={() => toggleActive(item)} disabled={togglingId === item._id}><RefreshCw size={14} />{togglingId === item._id ? 'Menyimpan...' : item.active !== false ? 'Nonaktifkan' : 'Aktifkan'}</button>
                          </>
                        ) : <button className="table-action-btn" onClick={() => void openHistory(item)}><History size={14} /> Riwayat</button>}
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
            {filteredTotal === 0 ? (
              <div className="mobile-record-card"><div className="mobile-record-title">Belum ada master barang gudang</div><div className="mobile-record-subtitle">Tambahkan barang sebelum membuat pembelian supplier.</div></div>
            ) : items.map((item) => {
              const badge = getStockBadge(item);
              return (
                <div key={item._id} className="mobile-record-card">
                  <div className="mobile-record-header">
                    <div>
                      <div className="mobile-record-title">
                        {canOpenItemDetail ? (
                          <Link href={`/inventory/items/${item._id}`} style={{ color: 'var(--color-primary)' }}>
                            {item.name}
                          </Link>
                        ) : item.name}
                      </div>
                      <div className="mobile-record-subtitle">{item.itemCode} | {item.unit}</div>
                    </div>
                    <span className={`badge ${badge.className}`}>{badge.label}</span>
                  </div>
                  <div className="mobile-record-grid">
                    <div className="mobile-record-field"><span className="mobile-record-label">Kategori</span><span className="mobile-record-value">{item.category || '-'}</span></div>
                    <div className="mobile-record-field"><span className="mobile-record-label">Mode</span><span className="mobile-record-value">{WAREHOUSE_ITEM_TRACKING_MODE_LABELS[item.trackingMode || 'STANDARD']}</span></div>
                    <div className="mobile-record-field">
                      <span className="mobile-record-label">Supplier</span>
                      <span className="mobile-record-value">
                        {canOpenSuppliers && item.defaultSupplierRef ? (
                          <Link href={`/suppliers/${item.defaultSupplierRef}`} style={{ color: 'var(--color-primary)' }}>
                            {item.defaultSupplierName || '-'}
                          </Link>
                        ) : (item.defaultSupplierName || '-')}
                      </span>
                    </div>
                    <div className="mobile-record-field"><span className="mobile-record-label">Stok</span><span className="mobile-record-value">{formatInventoryQuantity(item.currentStockQty || 0)} {item.unit}</span></div>
                    <div className="mobile-record-field"><span className="mobile-record-label">Min. Stok</span><span className="mobile-record-value">{formatInventoryQuantity(item.minStockQty || 0)} {item.unit}</span></div>
                    <div className="mobile-record-field mobile-record-field-full"><span className="mobile-record-label">Harga Beli Default</span><span className="mobile-record-value">{Number(item.defaultPurchasePrice || 0) > 0 ? formatCurrency(Number(item.defaultPurchasePrice || 0)) : '-'}</span></div>
                    {isTireTrackedWarehouseItem(item) && (
                      <div className="mobile-record-field mobile-record-field-full"><span className="mobile-record-label">Default Ban</span><span className="mobile-record-value">{item.tireBrandDefault || '-'} | {item.tireSizeDefault || '-'} | {item.tireTypeDefault || '-'}</span></div>
                    )}
                  </div>
                  {canManage && (
                    <div className="mobile-record-actions">
                      <button className="btn btn-secondary" onClick={() => openEdit(item)}><Edit size={14} /> Edit</button>
                      <button className="btn btn-secondary" onClick={() => void openHistory(item)}><History size={14} /> Riwayat</button>
                      {!isTireTrackedWarehouseItem(item) && <button className="btn btn-secondary" onClick={() => openMovement(item, 'MANUAL_IN')}><ArrowDownCircle size={14} /> Masuk</button>}
                      {!isTireTrackedWarehouseItem(item) && <button className="btn btn-secondary" onClick={() => openMovement(item, 'MANUAL_OUT')}><ArrowUpCircle size={14} /> Keluar</button>}
                      <button className="btn btn-secondary" onClick={() => toggleActive(item)} disabled={togglingId === item._id}><RefreshCw size={14} />{togglingId === item._id ? 'Menyimpan...' : item.active !== false ? 'Nonaktifkan' : 'Aktifkan'}</button>
                    </div>
                  )}
                  {!canManage && (
                    <div className="mobile-record-actions">
                      <button className="btn btn-secondary" onClick={() => void openHistory(item)}><History size={14} /> Riwayat</button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {filteredTotal > 0 && (
          <AppPagination
            page={page}
            pageSize={DEFAULT_PAGE_SIZE}
            totalItems={filteredTotal}
            onPageChange={setPage}
            info={({ startIndex, endIndex, totalItems }) => <>Menampilkan {startIndex}-{endIndex} dari {totalItems} barang gudang</>}
          />
        )}
      </div>

      {showModal && (
        <div className="modal-backdrop" onClick={closeModal}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div><div className="modal-title">{editItem ? 'Edit Barang Gudang' : 'Tambah Barang Gudang'}</div><div className="modal-subtitle">Kelola master barang untuk pembelian dan pergerakan stok gudang.</div></div>
              <button className="icon-btn" onClick={closeModal} disabled={saving}><X size={18} /></button>
            </div>
            <div className="modal-body">
              <div className="form-row"><div className="form-group"><label className="form-label">Kode Barang</label><input className="form-input" value={form.itemCode} onChange={(event) => setForm((current) => ({ ...current, itemCode: event.target.value }))} /></div><div className="form-group"><label className="form-label">Nama Barang</label><input className="form-input" value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} /></div></div>
              <div className="form-row"><div className="form-group"><label className="form-label">Kategori</label><input className="form-input" value={form.category} onChange={(event) => setForm((current) => ({ ...current, category: event.target.value }))} /></div><div className="form-group"><label className="form-label">Mode Tracking</label><select className="form-select" value={form.trackingMode} onChange={(event) => setForm((current) => ({ ...current, trackingMode: event.target.value as ItemFormState['trackingMode'], unit: event.target.value === 'TIRE_ASSET' && current.unit !== 'PCS' && current.unit !== 'UNIT' ? 'PCS' : current.unit }))}>{WAREHOUSE_ITEM_TRACKING_MODE_OPTIONS.map((option) => <option key={option} value={option}>{WAREHOUSE_ITEM_TRACKING_MODE_LABELS[option]}</option>)}</select></div></div>
              <div className="form-row"><div className="form-group"><label className="form-label">Satuan</label><select className="form-select" value={form.unit} onChange={(event) => setForm((current) => ({ ...current, unit: event.target.value as WarehouseItem['unit'] }))}>{INVENTORY_UNIT_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}</select></div><div className="form-group"><label className="form-label">Min. Stok</label><input type="number" min={0} step={form.trackingMode === 'TIRE_ASSET' ? '1' : '0.001'} className="form-input" value={form.minStockQty} onChange={(event) => setForm((current) => ({ ...current, minStockQty: event.target.value }))} /></div></div>
              <div className="form-row"><div className="form-group"><label className="form-label">Supplier Default</label><select className="form-select" value={form.defaultSupplierRef} onChange={(event) => setForm((current) => ({ ...current, defaultSupplierRef: event.target.value }))}><option value="">-- Tidak dipilih --</option>{activeSuppliers.map((supplier) => <option key={supplier._id} value={supplier._id}>{supplier.supplierCode} - {supplier.name}</option>)}</select></div><div className="form-group"><label className="form-label">Harga Beli Default (Rp)</label><CurrencyInput value={form.defaultPurchasePrice} onValueChange={(value) => setForm((current) => ({ ...current, defaultPurchasePrice: value }))} placeholder="Ketik harga beli default" /></div></div>
              <div className="form-row"><div className="form-group"><label className="form-label">Status</label><select className="form-select" value={form.active ? 'active' : 'inactive'} onChange={(event) => setForm((current) => ({ ...current, active: event.target.value === 'active' }))}><option value="active">Aktif</option><option value="inactive">Nonaktif</option></select></div></div>
              {form.trackingMode === 'TIRE_ASSET' && (
                <>
                  <div className="info-banner" style={{ marginBottom: '1rem' }}>
                    <div className="info-banner-title">Barang Gudang Ban Tertracking</div>
                    <div className="info-banner-text">
                      Barang ini dipakai sebagai master ban individual. Penerimaan pembelian akan otomatis membuat kartu ban satu per satu, dan perpindahan ban ke unit akan mengurangi stok gudang otomatis.
                    </div>
                  </div>
                  <div className="form-row">
                    <div className="form-group"><label className="form-label">Jenis Ban Default</label><select className="form-select" value={form.tireTypeDefault} onChange={(event) => setForm((current) => ({ ...current, tireTypeDefault: event.target.value }))}>{TIRE_TYPE_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}</select></div>
                    <div className="form-group"><label className="form-label">Merk Ban Default</label><input className="form-input" value={form.tireBrandDefault} onChange={(event) => setForm((current) => ({ ...current, tireBrandDefault: event.target.value }))} /></div>
                  </div>
                  <div className="form-row">
                    <div className="form-group"><label className="form-label">Ukuran Ban Default</label><input className="form-input" value={form.tireSizeDefault} onChange={(event) => setForm((current) => ({ ...current, tireSizeDefault: event.target.value }))} /></div>
                    <div className="form-group"><label className="form-label">Petunjuk</label><input className="form-input" value="Harga ban tidak ditampilkan di modul Ban" readOnly /></div>
                  </div>
                </>
              )}
              <div className="form-group"><label className="form-label">Catatan</label><textarea className="form-textarea" rows={3} value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} /></div>
            </div>
            <div className="modal-footer"><button className="btn btn-secondary" onClick={closeModal} disabled={saving}>Batal</button><button className="btn btn-primary" onClick={handleSave} disabled={saving}><Save size={16} /> {saving ? 'Menyimpan...' : 'Simpan'}</button></div>
          </div>
        </div>
      )}

      {showMovementModal && movementItem && (
        <div className="modal-backdrop" onClick={closeMovementModal}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div><div className="modal-title">{movementForm.sourceType === 'MANUAL_OUT' ? 'Catat Stok Keluar' : 'Catat Stok Masuk'}</div><div className="modal-subtitle">{movementItem.itemCode} - {movementItem.name}</div></div>
              <button className="icon-btn" onClick={closeMovementModal} disabled={savingMovement}><X size={18} /></button>
            </div>
            <div className="modal-body">
              <div className="form-row"><div className="form-group"><label className="form-label">Tanggal Mutasi</label><input type="date" className="form-input" value={movementForm.movementDate} onChange={(event) => setMovementForm((current) => ({ ...current, movementDate: event.target.value }))} /></div><div className="form-group"><label className="form-label">Qty</label><input type="number" min={0} step="0.001" className="form-input" value={movementForm.quantity} onChange={(event) => setMovementForm((current) => ({ ...current, quantity: event.target.value }))} /></div></div>
              <div className="form-group"><label className="form-label">Catatan</label><textarea className="form-textarea" rows={3} value={movementForm.note} onChange={(event) => setMovementForm((current) => ({ ...current, note: event.target.value }))} placeholder="Contoh: dipakai ke lapangan atau stok tambahan supplier." /></div>
              <div className="info-banner" style={{ marginTop: '0.5rem' }}><div className="info-banner-title">Stok Saat Ini</div><div className="info-banner-text">{formatInventoryQuantity(movementItem.currentStockQty || 0)} {movementItem.unit}</div></div>
            </div>
            <div className="modal-footer"><button className="btn btn-secondary" onClick={closeMovementModal} disabled={savingMovement}>Batal</button><button className="btn btn-primary" onClick={handleStockMovement} disabled={savingMovement}><Save size={16} /> {savingMovement ? 'Menyimpan...' : 'Simpan Mutasi'}</button></div>
          </div>
        </div>
      )}

      {showHistoryModal && historyItem && (
        <div className="modal-backdrop" onClick={closeHistoryModal}>
          <div
            className="modal modal-lg"
            style={{ width: 'min(48rem, calc(100vw - 1rem))' }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-header">
              <div>
                <div className="modal-title">Riwayat Mutasi Stok</div>
                <div className="modal-subtitle">{historyItem.itemCode} - {historyItem.name}</div>
              </div>
              <button className="icon-btn" onClick={closeHistoryModal} disabled={loadingHistory}><X size={18} /></button>
            </div>
            <div className="modal-body">
              <div className="info-banner" style={{ marginBottom: '1rem' }}>
                <div className="info-banner-title">Stok Saat Ini</div>
                <div className="info-banner-text">{formatInventoryQuantity(historyItem.currentStockQty || 0)} {historyItem.unit} • Menampilkan hingga 100 mutasi terbaru.</div>
              </div>

              <div className="table-wrapper table-desktop-only">
                <table>
                  <thead>
                    <tr>
                      <th>Tanggal</th>
                      <th>Mutasi</th>
                      <th>Sumber</th>
                      <th>Qty</th>
                      <th>Saldo Setelah</th>
                      <th>Catatan</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loadingHistory ? (
                      [1, 2, 3].map((index) => (
                        <tr key={index}>{[1, 2, 3, 4, 5, 6].map((cell) => <td key={cell}><div className="skeleton skeleton-text" /></td>)}</tr>
                      ))
                    ) : historyRows.length === 0 ? (
                      <tr>
                        <td colSpan={6}>
                          <div className="empty-state">
                            <History size={40} className="empty-state-icon" />
                            <div className="empty-state-title">Belum ada mutasi stok</div>
                          </div>
                        </td>
                      </tr>
                    ) : historyRows.map((movement) => {
                      const sourceMeta = getMovementSourceMeta(movement);
                      const safeNote = movement.sourceType === 'MAINTENANCE_USAGE' && !canOpenVehiclePage
                        ? 'Pemakaian material maintenance'
                        : (movement.note || '-');
                      return (
                        <tr key={movement._id}>
                          <td>{formatDate(movement.movementDate)}</td>
                          <td>
                            <span className={`badge ${movement.type === 'OUT' ? 'badge-warning' : 'badge-success'}`}>
                              {STOCK_MOVEMENT_TYPE_LABELS[movement.type]}
                            </span>
                          </td>
                          <td>
                            <div className="font-medium">
                              {sourceMeta.href ? (
                                <Link href={sourceMeta.href} style={{ color: 'var(--color-primary)' }}>{sourceMeta.primary}</Link>
                              ) : sourceMeta.primary}
                            </div>
                            <div className="text-muted text-xs">{sourceMeta.secondary}</div>
                          </td>
                          <td>{formatInventoryQuantity(movement.quantity)} {movement.unit || historyItem.unit}</td>
                          <td>{movement.balanceAfter !== undefined ? `${formatInventoryQuantity(movement.balanceAfter)} ${movement.unit || historyItem.unit}` : '-'}</td>
                          <td>{safeNote}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {!loadingHistory && (
                <div className="mobile-record-list">
                  {historyRows.length === 0 ? (
                    <div className="mobile-record-card">
                      <div className="mobile-record-title">Belum ada mutasi stok</div>
                    </div>
                  ) : historyRows.map((movement) => {
                    const sourceMeta = getMovementSourceMeta(movement);
                    const safeNote = movement.sourceType === 'MAINTENANCE_USAGE' && !canOpenVehiclePage
                      ? 'Pemakaian material maintenance'
                      : (movement.note || '-');
                    return (
                      <div key={movement._id} className="mobile-record-card">
                        <div className="mobile-record-header">
                          <div>
                            <div className="mobile-record-title">{formatDate(movement.movementDate)}</div>
                            <div className="mobile-record-subtitle">{sourceMeta.secondary}</div>
                          </div>
                          <span className={`badge ${movement.type === 'OUT' ? 'badge-warning' : 'badge-success'}`}>
                            {STOCK_MOVEMENT_TYPE_LABELS[movement.type]}
                          </span>
                        </div>
                        <div className="mobile-record-grid">
                          <div className="mobile-record-field mobile-record-field-full">
                            <span className="mobile-record-label">Sumber</span>
                            <span className="mobile-record-value">
                              {sourceMeta.href ? (
                                <Link href={sourceMeta.href} style={{ color: 'var(--color-primary)' }}>{sourceMeta.primary}</Link>
                              ) : sourceMeta.primary}
                            </span>
                          </div>
                          <div className="mobile-record-field">
                            <span className="mobile-record-label">Qty</span>
                            <span className="mobile-record-value">{formatInventoryQuantity(movement.quantity)} {movement.unit || historyItem.unit}</span>
                          </div>
                          <div className="mobile-record-field">
                            <span className="mobile-record-label">Saldo Setelah</span>
                            <span className="mobile-record-value">{movement.balanceAfter !== undefined ? `${formatInventoryQuantity(movement.balanceAfter)} ${movement.unit || historyItem.unit}` : '-'}</span>
                          </div>
                          <div className="mobile-record-field mobile-record-field-full">
                            <span className="mobile-record-label">Catatan</span>
                            <span className="mobile-record-value">{safeNote}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={closeHistoryModal} disabled={loadingHistory}>Tutup</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
