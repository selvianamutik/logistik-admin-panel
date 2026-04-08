'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowRight, Package, Receipt, Truck } from 'lucide-react';

import { fetchAllAdminCollectionData } from '@/lib/api/admin-client';
import { getBusinessDateValue } from '@/lib/business-date';
import { formatInventoryQuantity, PURCHASE_STATUS_LABELS } from '@/lib/inventory';
import { hasPageAccess } from '@/lib/rbac';
import type { Purchase, Supplier, WarehouseItem } from '@/lib/types';
import { formatCurrency, formatDate } from '@/lib/utils';

import { useApp, useToast } from '../layout';

type InventoryModuleCard = {
  href: string;
  title: string;
  description: string;
  icon: typeof Package;
};

const MODULES: InventoryModuleCard[] = [
  {
    href: '/suppliers',
    title: 'Supplier',
    description: 'Kelola pemasok aktif, termin default, dan data kontak pembelian.',
    icon: Truck,
  },
  {
    href: '/inventory/items',
    title: 'Barang Gudang',
    description: 'Pantau stok, stok minimum, supplier default, mutasi stok manual, dan master ban tertracking.',
    icon: Package,
  },
  {
    href: '/inventory/purchases',
    title: 'Pembelian',
    description: 'Buat pembelian supplier, terima barang, bayar supplier, dan cek outstanding.',
    icon: Receipt,
  },
];

function canOpenModule(role: NonNullable<ReturnType<typeof useApp>['user']>['role'], href: string) {
  if (href === '/suppliers') return hasPageAccess(role, 'suppliers');
  if (href === '/inventory/items') return hasPageAccess(role, 'warehouseItems');
  if (href === '/inventory/purchases') return hasPageAccess(role, 'purchases');
  return false;
}

export default function InventoryOverviewPage() {
  const { user } = useApp();
  const { addToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [items, setItems] = useState<WarehouseItem[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const today = getBusinessDateValue();

  const allowedModules = useMemo(
    () => MODULES.filter((module) => (user ? canOpenModule(user.role, module.href) : false)),
    [user],
  );
  const canOpenSuppliers = user ? hasPageAccess(user.role, 'suppliers') : false;
  const canOpenItems = user ? hasPageAccess(user.role, 'warehouseItems') : false;
  const canOpenPurchases = user ? hasPageAccess(user.role, 'purchases') : false;

  useEffect(() => {
    async function loadOverview() {
      if (!user) return;
      setLoading(true);
      try {
        const [purchaseRows, itemRows, supplierRows] = await Promise.all([
          canOpenPurchases
            ? fetchAllAdminCollectionData<Purchase>('/api/data?entity=purchases&sortField=orderDate&sortDir=desc', 'Gagal memuat pembelian inventory')
            : Promise.resolve([]),
          canOpenItems
            ? fetchAllAdminCollectionData<WarehouseItem>('/api/data?entity=warehouse-items&sortField=itemCode&sortDir=asc', 'Gagal memuat barang gudang')
            : Promise.resolve([]),
          canOpenSuppliers
            ? fetchAllAdminCollectionData<Supplier>('/api/data?entity=suppliers&sortField=supplierCode&sortDir=asc', 'Gagal memuat supplier')
            : Promise.resolve([]),
        ]);
        setPurchases(purchaseRows || []);
        setItems(itemRows || []);
        setSuppliers(supplierRows || []);
      } catch (error) {
        addToast('error', error instanceof Error ? error.message : 'Gagal memuat ringkasan inventory');
      } finally {
        setLoading(false);
      }
    }

    void loadOverview();
  }, [addToast, canOpenItems, canOpenPurchases, canOpenSuppliers, user]);

  const outstandingPurchases = useMemo(
    () => purchases.filter((purchase) => purchase.status !== 'PAID' && purchase.status !== 'CANCELLED' && Number(purchase.outstandingAmount || 0) > 0),
    [purchases],
  );
  const overduePurchases = useMemo(
    () => outstandingPurchases.filter((purchase) => purchase.dueDate && purchase.dueDate < today),
    [outstandingPurchases, today],
  );
  const outstandingAmount = useMemo(
    () => outstandingPurchases.reduce((sum, purchase) => sum + Number(purchase.outstandingAmount || 0), 0),
    [outstandingPurchases],
  );
  const activeSuppliers = useMemo(
    () => suppliers.filter((supplier) => supplier.active !== false).length,
    [suppliers],
  );
  const lowStockItems = useMemo(
    () => items.filter((item) => {
      if (item.active === false) return false;
      const current = Number(item.currentStockQty || 0);
      const min = Number(item.minStockQty || 0);
      return min > 0 && current <= min;
    }),
    [items],
  );
  const outOfStockItems = useMemo(
    () => items.filter((item) => item.active !== false && Number(item.currentStockQty || 0) <= 0),
    [items],
  );
  const itemsNeedingAction = useMemo(
    () => lowStockItems
      .slice()
      .sort((a, b) => Number(a.currentStockQty || 0) - Number(b.currentStockQty || 0))
      .slice(0, 5),
    [lowStockItems],
  );
  const purchasesNeedingAction = useMemo(
    () => overduePurchases
      .slice()
      .sort((a, b) => String(a.dueDate || '').localeCompare(String(b.dueDate || '')))
      .slice(0, 5),
    [overduePurchases],
  );

  return (
    <div>
      <div className="page-header">
        <div className="page-header-left">
          <h1 className="page-title">Inventory</h1>
        </div>
      </div>

      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <div className="card-body">
          <div className="text-muted" style={{ maxWidth: 760, lineHeight: 1.7 }}>
            Pusat pembelian supplier dan stok gudang. Mulai dari master supplier, barang gudang,
            sampai pembelian yang terhubung ke penerimaan barang, pembayaran supplier, dan arus kas bank/kas.
          </div>
        </div>
      </div>

      <div className="kpi-grid" style={{ marginBottom: '1.5rem' }}>
        <div className="kpi-card">
          <div className="kpi-content">
            <div className="kpi-label">Outstanding Pembelian</div>
            <div className="kpi-value">{formatCurrency(outstandingAmount)}</div>
          </div>
        </div>
        <div className="kpi-card">
          <div className="kpi-content">
            <div className="kpi-label">Jatuh Tempo Supplier</div>
            <div className="kpi-value">{overduePurchases.length}</div>
          </div>
        </div>
        <div className="kpi-card">
          <div className="kpi-content">
            <div className="kpi-label">Stok Menipis</div>
            <div className="kpi-value">{lowStockItems.length}</div>
          </div>
        </div>
        <div className="kpi-card">
          <div className="kpi-content">
            <div className="kpi-label">Supplier Aktif</div>
            <div className="kpi-value">{activeSuppliers}</div>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
        <div className="card">
          <div className="card-header">
            <span className="card-header-title">Perlu Ditindaklanjuti</span>
          </div>
          <div className="card-body">
            {loading ? (
              <div className="skeleton skeleton-text" style={{ height: 120 }} />
            ) : purchasesNeedingAction.length === 0 ? (
              <div className="empty-state">
                <Receipt size={36} className="empty-state-icon" />
                <div className="empty-state-title">Tidak ada pembelian jatuh tempo</div>
              </div>
            ) : (
              <div className="mobile-record-list" style={{ display: 'grid' }}>
                {purchasesNeedingAction.map((purchase) => (
                  <div key={purchase._id} className="mobile-record-card">
                    <div className="mobile-record-header">
                      <div>
                        <div className="mobile-record-title">
                          {canOpenPurchases ? (
                            <Link href={`/inventory/purchases/${purchase._id}`} style={{ color: 'var(--color-primary)' }}>
                              {purchase.purchaseNumber}
                            </Link>
                          ) : purchase.purchaseNumber}
                        </div>
                        <div className="mobile-record-subtitle">
                          {canOpenSuppliers && purchase.supplierRef ? (
                            <Link href={`/suppliers/${purchase.supplierRef}`} style={{ color: 'var(--color-primary)' }}>
                              {purchase.supplierName || '-'}
                            </Link>
                          ) : (purchase.supplierName || '-')}
                        </div>
                      </div>
                      <span className="badge badge-warning">{PURCHASE_STATUS_LABELS[purchase.status]}</span>
                    </div>
                    <div className="mobile-record-grid">
                      <div className="mobile-record-field">
                        <span className="mobile-record-label">Jatuh Tempo</span>
                        <span className="mobile-record-value">{purchase.dueDate ? formatDate(purchase.dueDate) : '-'}</span>
                      </div>
                      <div className="mobile-record-field">
                        <span className="mobile-record-label">Outstanding</span>
                        <span className="mobile-record-value">{formatCurrency(Number(purchase.outstandingAmount || 0))}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <span className="card-header-title">Stok Perlu Perhatian</span>
          </div>
          <div className="card-body">
            {loading ? (
              <div className="skeleton skeleton-text" style={{ height: 120 }} />
            ) : itemsNeedingAction.length === 0 ? (
              <div className="empty-state">
                <Package size={36} className="empty-state-icon" />
                <div className="empty-state-title">Tidak ada stok menipis</div>
              </div>
            ) : (
              <div className="mobile-record-list" style={{ display: 'grid' }}>
                {itemsNeedingAction.map((item) => (
                  <div key={item._id} className="mobile-record-card">
                    <div className="mobile-record-header">
                      <div>
                        <div className="mobile-record-title">
                          {canOpenItems ? (
                            <Link href={`/inventory/items?q=${encodeURIComponent(item.itemCode || item.name || '')}`} style={{ color: 'var(--color-primary)' }}>
                              {item.name}
                            </Link>
                          ) : item.name}
                        </div>
                        <div className="mobile-record-subtitle">{item.itemCode}</div>
                      </div>
                      <span className={`badge ${Number(item.currentStockQty || 0) <= 0 ? 'badge-danger' : 'badge-warning'}`}>
                        {Number(item.currentStockQty || 0) <= 0 ? 'Stok Habis' : 'Stok Menipis'}
                      </span>
                    </div>
                    <div className="mobile-record-grid">
                      <div className="mobile-record-field">
                        <span className="mobile-record-label">Stok</span>
                        <span className="mobile-record-value">{formatInventoryQuantity(item.currentStockQty || 0)} {item.unit}</span>
                      </div>
                      <div className="mobile-record-field">
                        <span className="mobile-record-label">Min. Stok</span>
                        <span className="mobile-record-value">{formatInventoryQuantity(item.minStockQty || 0)} {item.unit}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {outOfStockItems.length > 0 && (
        <div className="info-banner" style={{ marginBottom: '1.5rem' }}>
          <div className="info-banner-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <AlertTriangle size={16} />
            Ada {outOfStockItems.length} barang gudang dengan stok habis
          </div>
          <div className="info-banner-text">
            Prioritaskan pembelian ulang atau penyesuaian stok untuk item yang sudah 0 agar operasional tidak terputus.
          </div>
        </div>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          gap: '1rem',
        }}
      >
        {allowedModules.map((module) => {
          const Icon = module.icon;
          return (
            <Link
              key={module.href}
              href={module.href}
              className="card"
              style={{
                textDecoration: 'none',
                color: 'inherit',
                border: '1px solid var(--color-border)',
                transition: 'transform 0.2s ease, box-shadow 0.2s ease',
              }}
            >
              <div className="card-body" style={{ display: 'grid', gap: '0.9rem' }}>
                <div
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 14,
                    display: 'grid',
                    placeItems: 'center',
                    background: 'var(--color-primary-50)',
                    color: 'var(--color-primary)',
                  }}
                >
                  <Icon size={22} />
                </div>
                <div>
                  <div className="font-semibold" style={{ fontSize: '1.05rem', marginBottom: '0.35rem' }}>
                    {module.title}
                  </div>
                  <div className="text-muted" style={{ lineHeight: 1.6 }}>
                    {module.description}
                  </div>
                </div>
                <div
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 8,
                    color: 'var(--color-primary)',
                    fontWeight: 600,
                  }}
                >
                  Buka modul
                  <ArrowRight size={16} />
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
