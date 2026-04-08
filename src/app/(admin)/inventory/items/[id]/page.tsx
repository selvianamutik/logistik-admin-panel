'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { History, Receipt } from 'lucide-react';

import PageBackButton from '@/components/PageBackButton';
import { fetchAdminData, fetchAllAdminCollectionData } from '@/lib/api/admin-client';
import {
  formatInventoryQuantity,
  isTireTrackedWarehouseItem,
  PURCHASE_STATUS_LABELS,
  STOCK_MOVEMENT_SOURCE_LABELS,
  STOCK_MOVEMENT_TYPE_LABELS,
  WAREHOUSE_ITEM_TRACKING_MODE_LABELS,
} from '@/lib/inventory';
import { hasPageAccess } from '@/lib/rbac';
import type { Maintenance, Purchase, PurchaseItem, StockMovement, Supplier, TireEvent, WarehouseItem } from '@/lib/types';
import { formatCurrency, formatDate } from '@/lib/utils';

import { useApp, useToast } from '../../../layout';

function getStockBadge(item: WarehouseItem) {
  const stock = Number(item.currentStockQty || 0);
  const min = Number(item.minStockQty || 0);
  if (item.active === false) return { label: 'Nonaktif', className: 'badge-gray' };
  if (stock <= 0) return { label: 'Habis', className: 'badge-danger' };
  if (min > 0 && stock <= min) return { label: 'Menipis', className: 'badge-warning' };
  return { label: 'Aman', className: 'badge-success' };
}

function getPurchaseStatusBadge(status?: Purchase['status']) {
  if (status === 'PAID') return 'badge-success';
  if (status === 'CANCELLED') return 'badge-gray';
  if (status === 'PARTIALLY_PAID' || status === 'PARTIALLY_RECEIVED') return 'badge-warning';
  return 'badge-info';
}

type MaintenanceUsageRow = {
  maintenanceId: string;
  completedDate?: string;
  type?: string;
  vehicleRef?: string;
  vehiclePlate?: string;
  quantity: number;
  subtotalCost: number;
  note?: string;
};

export default function WarehouseItemDetailPage() {
  const params = useParams();
  const { user } = useApp();
  const { addToast } = useToast();
  const itemId = params.id as string;

  const [item, setItem] = useState<WarehouseItem | null>(null);
  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const [purchaseItems, setPurchaseItems] = useState<PurchaseItem[]>([]);
  const [purchasesById, setPurchasesById] = useState<Record<string, Purchase>>({});
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [maintenancesById, setMaintenancesById] = useState<Record<string, Maintenance>>({});
  const [linkedTires, setLinkedTires] = useState<TireEvent[]>([]);
  const [loading, setLoading] = useState(true);

  const canOpenSuppliers = user ? hasPageAccess(user.role, 'suppliers') : false;
  const canOpenPurchases = user ? hasPageAccess(user.role, 'purchases') : false;
  const canOpenVehicles = user ? hasPageAccess(user.role, 'vehicles') : false;
  const canOpenMaintenance = user ? hasPageAccess(user.role, 'maintenance') : false;
  const canOpenTires = user ? hasPageAccess(user.role, 'tires') : false;

  const loadItemDetail = useCallback(async () => {
    setLoading(true);
    try {
      const itemData = await fetchAdminData<WarehouseItem | null>(`/api/data?entity=warehouse-items&id=${itemId}`, 'Gagal memuat barang gudang');
      if (!itemData) {
        setItem(null);
        return;
      }

      const [supplierRow, purchaseItemRows, movementRows, tireRows] = await Promise.all([
        itemData.defaultSupplierRef
          ? fetchAdminData<Supplier | null>(`/api/data?entity=suppliers&id=${itemData.defaultSupplierRef}`, 'Gagal memuat supplier').catch(() => null)
          : Promise.resolve(null),
        fetchAllAdminCollectionData<PurchaseItem>(
          `/api/data?entity=purchase-items&filter=${encodeURIComponent(JSON.stringify({ warehouseItemRef: itemId }))}`,
          'Gagal memuat histori pembelian barang gudang'
        ),
        fetchAllAdminCollectionData<StockMovement>(
          `/api/data?entity=stock-movements&filter=${encodeURIComponent(JSON.stringify({ warehouseItemRef: itemId }))}&sortField=movementDate&sortDir=desc`,
          'Gagal memuat mutasi stok barang gudang',
          200
        ),
        canOpenTires && isTireTrackedWarehouseItem(itemData)
          ? fetchAllAdminCollectionData<TireEvent>(
              `/api/data?entity=tire-events&filter=${encodeURIComponent(JSON.stringify({ linkedWarehouseItemRef: itemId }))}&sortField=installDate&sortDir=desc`,
              'Gagal memuat ban terhubung',
              200
            )
          : Promise.resolve([]),
      ]);

      const purchaseRefs = Array.from(new Set((purchaseItemRows || []).map((row) => row.purchaseRef).filter(Boolean)));
      const purchaseEntries = await Promise.all(
        purchaseRefs.map(async (purchaseRef) => {
          const purchase = await fetchAdminData<Purchase | null>(`/api/data?entity=purchases&id=${purchaseRef}`, 'Gagal memuat pembelian').catch(() => null);
          return purchase ? [purchaseRef, purchase] as const : null;
        })
      );

      const maintenanceRefs = canOpenMaintenance
        ? Array.from(
            new Set(
              (movementRows || [])
                .filter((row) => row.sourceType === 'MAINTENANCE_USAGE' && typeof row.sourceRef === 'string' && row.sourceRef.trim())
                .map((row) => row.sourceRef as string)
            )
          )
        : [];

      const maintenanceEntries = await Promise.all(
        maintenanceRefs.map(async (maintenanceRef) => {
          const maintenance = await fetchAdminData<Maintenance | null>(`/api/data?entity=maintenances&id=${maintenanceRef}`, 'Gagal memuat maintenance').catch(() => null);
          return maintenance ? [maintenanceRef, maintenance] as const : null;
        })
      );

      setItem(itemData);
      setSupplier(supplierRow || null);
      setPurchaseItems((purchaseItemRows || []).sort((a, b) => `${b.purchaseRef || ''}-${b._id}`.localeCompare(`${a.purchaseRef || ''}-${a._id}`)));
      setMovements((movementRows || []).sort((a, b) => `${b.movementDate || ''}-${b._id}`.localeCompare(`${a.movementDate || ''}-${a._id}`)));
      setLinkedTires((tireRows || []).sort((a, b) => String(a.tireCode || '').localeCompare(String(b.tireCode || ''))));
      setPurchasesById(
        purchaseEntries.reduce<Record<string, Purchase>>((acc, entry) => {
          if (!entry) return acc;
          acc[entry[0]] = entry[1];
          return acc;
        }, {})
      );
      setMaintenancesById(
        maintenanceEntries.reduce<Record<string, Maintenance>>((acc, entry) => {
          if (!entry) return acc;
          acc[entry[0]] = entry[1];
          return acc;
        }, {})
      );
    } catch (error) {
      addToast('error', error instanceof Error ? error.message : 'Gagal memuat detail barang gudang');
    } finally {
      setLoading(false);
    }
  }, [addToast, canOpenMaintenance, canOpenTires, itemId]);

  useEffect(() => {
    void loadItemDetail();
  }, [loadItemDetail]);

  const stockBadge = useMemo(() => (item ? getStockBadge(item) : null), [item]);
  const totalInQty = useMemo(() => movements.filter((movement) => movement.type === 'IN').reduce((sum, movement) => sum + Number(movement.quantity || 0), 0), [movements]);
  const totalOutQty = useMemo(() => movements.filter((movement) => movement.type === 'OUT').reduce((sum, movement) => sum + Number(movement.quantity || 0), 0), [movements]);
  const lastMovementDate = movements[0]?.movementDate;

  const purchaseRows = useMemo(
    () =>
      purchaseItems
        .map((purchaseItem) => ({ purchaseItem, purchase: purchasesById[purchaseItem.purchaseRef] }))
        .filter((row) => row.purchase)
        .sort((a, b) => `${b.purchase?.orderDate || ''}-${b.purchase?.purchaseNumber || ''}`.localeCompare(`${a.purchase?.orderDate || ''}-${a.purchase?.purchaseNumber || ''}`)),
    [purchaseItems, purchasesById]
  );

  const openPurchaseCount = useMemo(
    () => new Set(purchaseRows.filter((row) => Number(row.purchase?.outstandingAmount || 0) > 0 && row.purchase?.status !== 'CANCELLED' && row.purchase?.status !== 'PAID').map((row) => row.purchase?._id)).size,
    [purchaseRows]
  );

  const maintenanceUsageRows = useMemo<MaintenanceUsageRow[]>(() => {
    if (!canOpenMaintenance) return [];
    const rows: MaintenanceUsageRow[] = [];
    Object.entries(maintenancesById).forEach(([maintenanceId, maintenance]) => {
      const relatedUsages = (maintenance.materialUsages || []).filter((usage) => usage.warehouseItemRef === itemId);
      if (relatedUsages.length === 0) return;
      rows.push({
          maintenanceId,
          completedDate: maintenance.completedDate,
          type: maintenance.type,
          vehicleRef: maintenance.vehicleRef,
          vehiclePlate: maintenance.vehiclePlate,
          quantity: relatedUsages.reduce((sum, usage) => sum + Number(usage.quantity || 0), 0),
          subtotalCost: relatedUsages.reduce((sum, usage) => sum + Number(usage.subtotalCost || 0), 0),
          note: relatedUsages.map((usage) => usage.note).filter(Boolean).join(' | ') || undefined,
      });
    });
    return rows.sort((a, b) => `${b.completedDate || ''}-${b.maintenanceId}`.localeCompare(`${a.completedDate || ''}-${a.maintenanceId}`));
  }, [canOpenMaintenance, itemId, maintenancesById]);

  const getMovementSourceMeta = (movement: StockMovement) => {
    const sourceLabel = STOCK_MOVEMENT_SOURCE_LABELS[movement.sourceType] || movement.sourceType;
    if (movement.sourceType === 'PURCHASE_RECEIPT' && movement.sourceRef) {
      const purchase = purchasesById[movement.sourceRef];
      return {
        primary: purchase?.purchaseNumber || movement.sourceNumber || sourceLabel,
        secondary: purchase?.supplierName || sourceLabel,
        href: canOpenPurchases ? `/inventory/purchases/${movement.sourceRef}` : undefined,
      };
    }
    if (movement.sourceType === 'MAINTENANCE_USAGE') {
      const maintenance = movement.sourceRef ? maintenancesById[movement.sourceRef] : undefined;
      return {
        primary: canOpenVehicles && maintenance?.vehiclePlate ? maintenance.vehiclePlate : 'Maintenance',
        secondary: maintenance?.type ? `${sourceLabel} | ${maintenance.type}` : sourceLabel,
        href: canOpenVehicles && maintenance?.vehicleRef ? `/fleet/vehicles/${maintenance.vehicleRef}?tab=maintenance` : undefined,
      };
    }
    if ((movement.sourceType === 'TIRE_DEPLOYMENT' || movement.sourceType === 'TIRE_RETURN') && canOpenTires) {
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

  if (loading) {
    return (
      <div>
        <div className="skeleton skeleton-title" />
        <div className="skeleton skeleton-card" style={{ height: 120 }} />
        <div className="skeleton skeleton-card" style={{ height: 280 }} />
      </div>
    );
  }

  if (!item) {
    return (
      <div className="card">
        <div className="card-body">Barang gudang tidak ditemukan</div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <div className="page-header-left">
          <PageBackButton href="/inventory/items" />
          <h1 className="page-title">Detail Barang Gudang</h1>
        </div>
      </div>

      <div className="kpi-grid" style={{ marginBottom: '1.5rem' }}>
        <div className="kpi-card"><div className="kpi-content"><div className="kpi-label">Stok Saat Ini</div><div className="kpi-value">{formatInventoryQuantity(item.currentStockQty || 0)} {item.unit}</div></div></div>
        <div className="kpi-card"><div className="kpi-content"><div className="kpi-label">Min. Stok</div><div className="kpi-value">{formatInventoryQuantity(item.minStockQty || 0)} {item.unit}</div></div></div>
        <div className="kpi-card"><div className="kpi-content"><div className="kpi-label">Total Masuk</div><div className="kpi-value">{formatInventoryQuantity(totalInQty)} {item.unit}</div></div></div>
        <div className="kpi-card"><div className="kpi-content"><div className="kpi-label">Total Keluar</div><div className="kpi-value">{formatInventoryQuantity(totalOutQty)} {item.unit}</div></div></div>
      </div>

      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <div className="card-header"><span className="card-header-title">{item.itemCode} - {item.name}</span></div>
        <div className="card-body">
          <div className="detail-grid">
            <div className="detail-row"><span className="detail-label">Kategori</span><span className="detail-value">{item.category || '-'}</span></div>
            <div className="detail-row"><span className="detail-label">Satuan</span><span className="detail-value">{item.unit}</span></div>
            <div className="detail-row"><span className="detail-label">Mode Tracking</span><span className="detail-value">{WAREHOUSE_ITEM_TRACKING_MODE_LABELS[item.trackingMode || 'STANDARD']}</span></div>
            <div className="detail-row"><span className="detail-label">Status Stok</span><span className="detail-value"><span className={`badge ${stockBadge?.className || 'badge-gray'}`}>{stockBadge?.label || '-'}</span></span></div>
            <div className="detail-row"><span className="detail-label">Supplier Default</span><span className="detail-value">{canOpenSuppliers && supplier ? <Link href={`/suppliers/${supplier._id}`} style={{ color: 'var(--color-primary)' }}>{supplier.name}</Link> : (item.defaultSupplierName || supplier?.name || '-')}</span></div>
            <div className="detail-row"><span className="detail-label">Harga Beli Default</span><span className="detail-value">{Number(item.defaultPurchasePrice || 0) > 0 ? formatCurrency(Number(item.defaultPurchasePrice || 0)) : '-'}</span></div>
            <div className="detail-row"><span className="detail-label">Pembelian Aktif</span><span className="detail-value">{openPurchaseCount}</span></div>
            <div className="detail-row"><span className="detail-label">Mutasi Terakhir</span><span className="detail-value">{lastMovementDate ? formatDate(lastMovementDate) : '-'}</span></div>
            {isTireTrackedWarehouseItem(item) && (
              <>
                <div className="detail-row"><span className="detail-label">Merk Ban Default</span><span className="detail-value">{item.tireBrandDefault || '-'}</span></div>
                <div className="detail-row"><span className="detail-label">Ukuran Ban Default</span><span className="detail-value">{item.tireSizeDefault || '-'}</span></div>
                <div className="detail-row"><span className="detail-label">Jenis Ban Default</span><span className="detail-value">{item.tireTypeDefault || '-'}</span></div>
                <div className="detail-row"><span className="detail-label">Ban Terhubung</span><span className="detail-value">{linkedTires.length}</span></div>
              </>
            )}
            <div className="detail-row"><span className="detail-label">Catatan</span><span className="detail-value">{item.notes || '-'}</span></div>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <div className="card-header"><span className="card-header-title">Pembelian Terkait</span></div>
        <div className="card-body">
          {purchaseRows.length === 0 ? (
            <div className="empty-state">
              <Receipt size={40} className="empty-state-icon" />
              <div className="empty-state-title">Belum ada pembelian untuk barang ini</div>
            </div>
          ) : (
            <>
              <div className="table-wrapper table-desktop-only">
                <table>
                  <thead><tr><th>Pembelian</th><th>Tanggal</th><th>Supplier</th><th>Qty Pesan</th><th>Qty Terima</th><th>Harga</th><th>Status</th></tr></thead>
                  <tbody>
                    {purchaseRows.map(({ purchaseItem, purchase }) => (
                      <tr key={purchaseItem._id}>
                        <td className="font-mono">{canOpenPurchases && purchase ? <Link href={`/inventory/purchases/${purchase._id}`} style={{ color: 'var(--color-primary)' }}>{purchase.purchaseNumber}</Link> : (purchase?.purchaseNumber || '-')}</td>
                        <td>{purchase?.orderDate ? formatDate(purchase.orderDate) : '-'}</td>
                        <td>{purchase?.supplierName || '-'}</td>
                        <td>{formatInventoryQuantity(purchaseItem.orderedQty)} {purchaseItem.itemUnit || item.unit}</td>
                        <td>{formatInventoryQuantity(purchaseItem.receivedQty || 0)} {purchaseItem.itemUnit || item.unit}</td>
                        <td>{formatCurrency(Number(purchaseItem.unitPrice || 0))}</td>
                        <td><span className={`badge ${getPurchaseStatusBadge(purchase?.status)}`}>{purchase?.status ? PURCHASE_STATUS_LABELS[purchase.status] : '-'}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mobile-record-list">
                {purchaseRows.map(({ purchaseItem, purchase }) => (
                  <div key={purchaseItem._id} className="mobile-record-card">
                    <div className="mobile-record-header">
                      <div>
                        <div className="mobile-record-title">{canOpenPurchases && purchase ? <Link href={`/inventory/purchases/${purchase._id}`} style={{ color: 'var(--color-primary)' }}>{purchase.purchaseNumber}</Link> : (purchase?.purchaseNumber || '-')}</div>
                        <div className="mobile-record-subtitle">{purchase?.supplierName || '-'}</div>
                      </div>
                      <span className={`badge ${getPurchaseStatusBadge(purchase?.status)}`}>{purchase?.status ? PURCHASE_STATUS_LABELS[purchase.status] : '-'}</span>
                    </div>
                    <div className="mobile-record-grid">
                      <div className="mobile-record-field"><span className="mobile-record-label">Tanggal</span><span className="mobile-record-value">{purchase?.orderDate ? formatDate(purchase.orderDate) : '-'}</span></div>
                      <div className="mobile-record-field"><span className="mobile-record-label">Qty Pesan</span><span className="mobile-record-value">{formatInventoryQuantity(purchaseItem.orderedQty)} {purchaseItem.itemUnit || item.unit}</span></div>
                      <div className="mobile-record-field"><span className="mobile-record-label">Qty Terima</span><span className="mobile-record-value">{formatInventoryQuantity(purchaseItem.receivedQty || 0)} {purchaseItem.itemUnit || item.unit}</span></div>
                      <div className="mobile-record-field"><span className="mobile-record-label">Harga</span><span className="mobile-record-value">{formatCurrency(Number(purchaseItem.unitPrice || 0))}</span></div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {canOpenMaintenance && maintenanceUsageRows.length > 0 && (
        <div className="card" style={{ marginBottom: '1.5rem' }}>
          <div className="card-header"><span className="card-header-title">Pemakaian di Maintenance</span></div>
          <div className="card-body">
            <div className="table-wrapper table-desktop-only">
              <table>
                <thead><tr><th>Tanggal</th><th>Kendaraan</th><th>Maintenance</th><th>Qty</th><th>Biaya Material</th><th>Catatan</th></tr></thead>
                <tbody>
                  {maintenanceUsageRows.map((row) => (
                    <tr key={row.maintenanceId}>
                      <td>{row.completedDate ? formatDate(row.completedDate) : '-'}</td>
                      <td>{canOpenVehicles && row.vehicleRef ? <Link href={`/fleet/vehicles/${row.vehicleRef}?tab=maintenance`} style={{ color: 'var(--color-primary)' }}>{row.vehiclePlate || '-'}</Link> : (row.vehiclePlate || '-')}</td>
                      <td>{row.type || 'Maintenance'}</td>
                      <td>{formatInventoryQuantity(row.quantity)} {item.unit}</td>
                      <td>{formatCurrency(row.subtotalCost)}</td>
                      <td>{row.note || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mobile-record-list">
              {maintenanceUsageRows.map((row) => (
                <div key={row.maintenanceId} className="mobile-record-card">
                  <div className="mobile-record-header">
                    <div>
                      <div className="mobile-record-title">{canOpenVehicles && row.vehicleRef ? <Link href={`/fleet/vehicles/${row.vehicleRef}?tab=maintenance`} style={{ color: 'var(--color-primary)' }}>{row.vehiclePlate || '-'}</Link> : (row.vehiclePlate || '-')}</div>
                      <div className="mobile-record-subtitle">{row.type || 'Maintenance'}</div>
                    </div>
                  </div>
                  <div className="mobile-record-grid">
                    <div className="mobile-record-field"><span className="mobile-record-label">Tanggal</span><span className="mobile-record-value">{row.completedDate ? formatDate(row.completedDate) : '-'}</span></div>
                    <div className="mobile-record-field"><span className="mobile-record-label">Qty</span><span className="mobile-record-value">{formatInventoryQuantity(row.quantity)} {item.unit}</span></div>
                    <div className="mobile-record-field mobile-record-field-full"><span className="mobile-record-label">Biaya Material</span><span className="mobile-record-value">{formatCurrency(row.subtotalCost)}</span></div>
                    {row.note ? <div className="mobile-record-field mobile-record-field-full"><span className="mobile-record-label">Catatan</span><span className="mobile-record-value">{row.note}</span></div> : null}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {isTireTrackedWarehouseItem(item) && linkedTires.length > 0 && (
        <div className="card" style={{ marginBottom: '1.5rem' }}>
          <div className="card-header"><span className="card-header-title">Ban Terhubung</span></div>
          <div className="card-body">
            <div className="table-wrapper table-desktop-only">
              <table>
                <thead><tr><th>Kode Ban</th><th>Status</th><th>Posisi</th><th>Tanggal</th></tr></thead>
                <tbody>
                  {linkedTires.map((tire) => (
                    <tr key={tire._id}>
                      <td>{canOpenTires ? <Link href={`/fleet/tires?q=${encodeURIComponent(tire.tireCode || '')}`} style={{ color: 'var(--color-primary)' }}>{tire.tireCode || '-'}</Link> : (tire.tireCode || '-')}</td>
                      <td>{tire.status || '-'}</td>
                      <td>{tire.posisi || '-'}</td>
                      <td>{formatDate(tire.sourceReceiveDate || tire.installDate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mobile-record-list">
              {linkedTires.map((tire) => (
                <div key={tire._id} className="mobile-record-card">
                  <div className="mobile-record-header">
                    <div>
                      <div className="mobile-record-title">{canOpenTires ? <Link href={`/fleet/tires?q=${encodeURIComponent(tire.tireCode || '')}`} style={{ color: 'var(--color-primary)' }}>{tire.tireCode || '-'}</Link> : (tire.tireCode || '-')}</div>
                      <div className="mobile-record-subtitle">{tire.posisi || '-'}</div>
                    </div>
                  </div>
                  <div className="mobile-record-grid">
                    <div className="mobile-record-field"><span className="mobile-record-label">Status</span><span className="mobile-record-value">{tire.status || '-'}</span></div>
                    <div className="mobile-record-field"><span className="mobile-record-label">Tanggal</span><span className="mobile-record-value">{formatDate(tire.sourceReceiveDate || tire.installDate)}</span></div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-header"><span className="card-header-title">Riwayat Mutasi Stok</span></div>
        <div className="card-body">
          {movements.length === 0 ? (
            <div className="empty-state">
              <History size={40} className="empty-state-icon" />
              <div className="empty-state-title">Belum ada mutasi stok</div>
            </div>
          ) : (
            <>
              <div className="table-wrapper table-desktop-only">
                <table>
                  <thead><tr><th>Tanggal</th><th>Mutasi</th><th>Sumber</th><th>Qty</th><th>Saldo Setelah</th><th>Catatan</th></tr></thead>
                  <tbody>
                    {movements.map((movement) => {
                      const source = getMovementSourceMeta(movement);
                      const signedQty = movement.type === 'OUT' ? `- ${formatInventoryQuantity(movement.quantity)}` : formatInventoryQuantity(movement.quantity);
                      const safeNote = movement.sourceType === 'MAINTENANCE_USAGE' && !canOpenVehicles
                        ? 'Pemakaian material maintenance'
                        : (movement.note || '-');
                      return (
                        <tr key={movement._id}>
                          <td>{formatDate(movement.movementDate)}</td>
                          <td>{STOCK_MOVEMENT_TYPE_LABELS[movement.type]}</td>
                          <td>{source.href ? <Link href={source.href} style={{ color: 'var(--color-primary)' }}>{source.primary}</Link> : source.primary}<div className="text-muted text-xs">{source.secondary}</div></td>
                          <td>{signedQty} {movement.unit || item.unit}</td>
                          <td>{formatInventoryQuantity(movement.balanceAfter || 0)} {movement.unit || item.unit}</td>
                          <td>{safeNote}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="mobile-record-list">
                {movements.map((movement) => {
                  const source = getMovementSourceMeta(movement);
                  const signedQty = movement.type === 'OUT' ? `- ${formatInventoryQuantity(movement.quantity)}` : formatInventoryQuantity(movement.quantity);
                  const safeNote = movement.sourceType === 'MAINTENANCE_USAGE' && !canOpenVehicles
                    ? 'Pemakaian material maintenance'
                    : (movement.note || '-');
                  return (
                    <div key={movement._id} className="mobile-record-card">
                      <div className="mobile-record-header">
                        <div>
                          <div className="mobile-record-title">{STOCK_MOVEMENT_TYPE_LABELS[movement.type]}</div>
                          <div className="mobile-record-subtitle">{formatDate(movement.movementDate)}</div>
                        </div>
                      </div>
                      <div className="mobile-record-grid">
                        <div className="mobile-record-field mobile-record-field-full">
                          <span className="mobile-record-label">Sumber</span>
                          <span className="mobile-record-value">{source.href ? <Link href={source.href} style={{ color: 'var(--color-primary)' }}>{source.primary}</Link> : source.primary}</span>
                          <div className="mobile-record-subtitle" style={{ marginTop: '0.25rem' }}>{source.secondary}</div>
                        </div>
                        <div className="mobile-record-field"><span className="mobile-record-label">Qty</span><span className="mobile-record-value">{signedQty} {movement.unit || item.unit}</span></div>
                        <div className="mobile-record-field"><span className="mobile-record-label">Saldo Setelah</span><span className="mobile-record-value">{formatInventoryQuantity(movement.balanceAfter || 0)} {movement.unit || item.unit}</span></div>
                        <div className="mobile-record-field mobile-record-field-full"><span className="mobile-record-label">Catatan</span><span className="mobile-record-value">{safeNote}</span></div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
