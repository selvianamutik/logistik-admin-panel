'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { CreditCard, Edit, Package, Receipt, Save, X } from 'lucide-react';

import FormattedNumberInput from '@/components/FormattedNumberInput';
import PageBackButton from '@/components/PageBackButton';
import { fetchAdminData, fetchAllAdminCollectionData } from '@/lib/api/admin-client';
import { getBusinessDateValue } from '@/lib/business-date';
import {
  getDerivedPurchasePaymentStatus,
  getDerivedPurchaseReceiptStatus,
  getPurchasePaymentBadgeClass,
  getPurchaseReceiptBadgeClass,
  PURCHASE_PAYMENT_STATUS_LABELS,
  PURCHASE_RECEIPT_STATUS_LABELS,
} from '@/lib/inventory';
import { hasPageAccess, hasPermission } from '@/lib/rbac';
import {
  buildSupplierOwnerSummaryMap,
  buildSupplierRelatedItems,
  type SupplierRelatedItem,
} from '@/lib/supplier-purchase-support';
import type { Purchase, PurchaseItem, PurchasePayment, Supplier, WarehouseItem } from '@/lib/types';
import { formatCurrency, formatDate, formatQuantity } from '@/lib/utils';

import { useApp, useToast } from '../../layout';

type SupplierDetailTab = 'detail' | 'purchases' | 'payments' | 'items';

type SupplierFormState = {
  supplierCode: string;
  name: string;
  contactPerson: string;
  phone: string;
  address: string;
  defaultTermDays: number;
  notes: string;
  active: boolean;
};

const createDefaultForm = (supplier?: Partial<Supplier>): SupplierFormState => ({
  supplierCode: supplier?.supplierCode || '',
  name: supplier?.name || '',
  contactPerson: supplier?.contactPerson || '',
  phone: supplier?.phone || '',
  address: supplier?.address || '',
  defaultTermDays: typeof supplier?.defaultTermDays === 'number' ? supplier.defaultTermDays : 14,
  notes: supplier?.notes || '',
  active: supplier?.active !== false,
});

function PurchaseLifecycleBadges({ purchase }: { purchase: Purchase }) {
  const receiptStatus = getDerivedPurchaseReceiptStatus(purchase);
  const paymentStatus = getDerivedPurchasePaymentStatus(purchase);

  return (
    <div style={{ display: 'grid', gap: '0.35rem', justifyItems: 'start' }}>
      <span className={`badge ${getPurchaseReceiptBadgeClass(receiptStatus)}`}>
        Terima: {PURCHASE_RECEIPT_STATUS_LABELS[receiptStatus]}
      </span>
      <span className={`badge ${getPurchasePaymentBadgeClass(paymentStatus)}`}>
        Bayar: {PURCHASE_PAYMENT_STATUS_LABELS[paymentStatus]}
      </span>
    </div>
  );
}

export default function SupplierDetailPage() {
  const params = useParams();
  const { user } = useApp();
  const { addToast } = useToast();
  const supplierId = params.id as string;
  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [payments, setPayments] = useState<PurchasePayment[]>([]);
  const [items, setItems] = useState<SupplierRelatedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<SupplierDetailTab>('detail');
  const [showEditModal, setShowEditModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<SupplierFormState>(createDefaultForm());
  const canManage = user ? hasPermission(user.role, 'suppliers', 'create') || hasPermission(user.role, 'suppliers', 'update') : false;
  const canOpenPurchases = user ? hasPageAccess(user.role, 'purchases') : false;
  const canOpenItems = user ? hasPageAccess(user.role, 'warehouseItems') : false;
  const canOpenBankAccounts = user ? hasPageAccess(user.role, 'bankAccounts') : false;
  const today = getBusinessDateValue();

  const loadSupplierDetail = useCallback(async () => {
    setLoading(true);
    try {
      const supplierData = await fetchAdminData<Supplier | null>(`/api/data?entity=suppliers&id=${supplierId}`, 'Gagal memuat supplier');
      if (!supplierData) {
        setSupplier(null);
        return;
      }

      const [purchaseRows, paymentRows, defaultItemRows] = await Promise.all([
        fetchAllAdminCollectionData<Purchase>(`/api/data?entity=purchases&filter=${encodeURIComponent(JSON.stringify({ supplierRef: supplierId }))}&sortField=orderDate&sortDir=desc`, 'Gagal memuat pembelian supplier'),
        fetchAllAdminCollectionData<PurchasePayment>(`/api/data?entity=purchase-payments&filter=${encodeURIComponent(JSON.stringify({ supplierRef: supplierId }))}&sortField=date&sortDir=desc`, 'Gagal memuat pembayaran supplier'),
        fetchAllAdminCollectionData<WarehouseItem>(`/api/data?entity=warehouse-items&filter=${encodeURIComponent(JSON.stringify({ defaultSupplierRef: supplierId }))}&sortField=itemCode&sortDir=asc`, 'Gagal memuat barang gudang supplier'),
      ]);
      const purchaseIds = (purchaseRows || []).map((purchase) => purchase._id).filter(Boolean);
      const purchaseItemRows = purchaseIds.length > 0
        ? await fetchAllAdminCollectionData<PurchaseItem>(
          `/api/data?entity=purchase-items&filter=${encodeURIComponent(JSON.stringify({ purchaseRef: purchaseIds }))}&sortField=itemCode&sortDir=asc`,
          'Gagal memuat item pembelian supplier'
        )
        : [];
      const purchasedItemRefs = Array.from(new Set((purchaseItemRows || []).map((item) => item.warehouseItemRef).filter(Boolean)));
      const purchasedWarehouseItems = purchasedItemRefs.length > 0
        ? await fetchAllAdminCollectionData<WarehouseItem>(
          `/api/data?entity=warehouse-items&filter=${encodeURIComponent(JSON.stringify({ _id: purchasedItemRefs }))}&sortField=itemCode&sortDir=asc`,
          'Gagal memuat master barang pembelian supplier'
        )
        : [];
      const warehouseItems = Array.from(
        new Map(
          [...(defaultItemRows || []), ...(purchasedWarehouseItems || [])].map((item) => [item._id, item] as const),
        ).values(),
      );
      const relatedItems = buildSupplierRelatedItems(supplierId, purchaseRows || [], purchaseItemRows || [], warehouseItems);

      setSupplier(supplierData);
      setForm(createDefaultForm(supplierData));
      setPurchases((purchaseRows || []).sort((a, b) => String(b.orderDate || '').localeCompare(String(a.orderDate || ''))));
      setPayments((paymentRows || []).sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))));
      setItems(relatedItems);
    } catch (error) {
      addToast('error', error instanceof Error ? error.message : 'Gagal memuat detail supplier');
    } finally {
      setLoading(false);
    }
  }, [addToast, supplierId]);

  useEffect(() => { void loadSupplierDetail(); }, [loadSupplierDetail]);

  const supplierSummary = useMemo(
    () => buildSupplierOwnerSummaryMap(purchases, today)[supplierId] || {
      purchaseCount: 0,
      totalAmount: 0,
      outstandingAmount: 0,
      paidAmount: 0,
      overdueCount: 0,
      lastPurchaseDate: '',
    },
    [purchases, supplierId, today],
  );

  const outstandingTotal = supplierSummary.outstandingAmount;
  const totalPurchaseAmount = supplierSummary.totalAmount;
  const paidTotal = useMemo(
    () => payments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0),
    [payments]
  );
  const overdueCount = supplierSummary.overdueCount;
  const purchasedItemCount = useMemo(
    () => items.filter((item) => item.relationType !== 'DEFAULT').length,
    [items],
  );
  const defaultOnlyItemCount = useMemo(
    () => items.filter((item) => item.relationType === 'DEFAULT').length,
    [items],
  );

  const openEditModal = () => {
    if (!supplier || !canManage) return;
    setForm(createDefaultForm(supplier));
    setShowEditModal(true);
  };

  const closeEditModal = () => {
    if (saving) return;
    setShowEditModal(false);
    setForm(createDefaultForm(supplier || undefined));
  };

  const handleSave = async () => {
    if (!supplier || !canManage) {
      addToast('error', 'Anda tidak punya hak mengubah supplier');
      return;
    }
    if (!form.supplierCode || !form.name) {
      addToast('error', 'Kode dan nama supplier wajib diisi');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        supplierCode: form.supplierCode,
        name: form.name,
        contactPerson: form.contactPerson,
        phone: form.phone,
        address: form.address,
        defaultTermDays: form.defaultTermDays,
        notes: form.notes,
        active: form.active,
      };
      const res = await fetch('/api/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entity: 'suppliers',
          action: 'update',
          data: {
            id: supplier._id,
            updates: payload,
          },
        }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Gagal menyimpan supplier');
      addToast('success', 'Supplier diperbarui');
      setShowEditModal(false);
      await loadSupplierDetail();
    } catch (error) {
      addToast('error', error instanceof Error ? error.message : 'Gagal menyimpan supplier');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div>
        <div className="skeleton skeleton-title" />
        <div className="skeleton skeleton-card" style={{ height: 120 }} />
        <div className="skeleton skeleton-card" style={{ height: 260 }} />
      </div>
    );
  }

  if (!supplier) {
    return (
      <div className="card">
        <div className="card-body">Supplier tidak ditemukan</div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <div className="page-header-left">
          <PageBackButton href="/suppliers" />
          <h1 className="page-title">Detail Supplier</h1>
        </div>
      </div>

      <div className="segmented-tabs" aria-label="Menu supplier" style={{ marginBottom: '1.5rem' }}>
        <button type="button" className={`segmented-tab ${activeTab === 'detail' ? 'active' : ''}`} onClick={() => setActiveTab('detail')}>
          Detail
        </button>
        <button type="button" className={`segmented-tab ${activeTab === 'purchases' ? 'active' : ''}`} onClick={() => setActiveTab('purchases')}>
          Pembelian Supplier
        </button>
        <button type="button" className={`segmented-tab ${activeTab === 'payments' ? 'active' : ''}`} onClick={() => setActiveTab('payments')}>
          Pembayaran Supplier
        </button>
        <button type="button" className={`segmented-tab ${activeTab === 'items' ? 'active' : ''}`} onClick={() => setActiveTab('items')}>
          Barang Gudang Terkait
        </button>
      </div>

      <div className="kpi-grid" style={{ marginBottom: '1.5rem' }}>
        <div className="kpi-card">
          <div className="kpi-content">
            <div className="kpi-label">Outstanding</div>
            <div className="kpi-value">{formatCurrency(outstandingTotal)}</div>
            <div className="kpi-sub">{overdueCount} pembelian jatuh tempo</div>
          </div>
        </div>
        <div className="kpi-card">
          <div className="kpi-content">
            <div className="kpi-label">Dokumen Pembelian</div>
            <div className="kpi-value">{supplierSummary.purchaseCount}</div>
            <div className="kpi-sub">{formatCurrency(totalPurchaseAmount)} total pembelian</div>
          </div>
        </div>
        <div className="kpi-card">
          <div className="kpi-content">
            <div className="kpi-label">Pembelian Terakhir</div>
            <div className="kpi-value">{supplierSummary.lastPurchaseDate ? formatDate(supplierSummary.lastPurchaseDate) : '-'}</div>
            <div className="kpi-sub">{formatCurrency(supplierSummary.paidAmount)} sudah dibayar</div>
          </div>
        </div>
        <div className="kpi-card">
          <div className="kpi-content">
            <div className="kpi-label">Barang Terkait</div>
            <div className="kpi-value">{items.length}</div>
            <div className="kpi-sub">{purchasedItemCount} pernah dibeli, {defaultOnlyItemCount} hanya default</div>
          </div>
        </div>
      </div>

      {activeTab === 'detail' && (
      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem' }}>
          <span className="card-header-title">{supplier.supplierCode} - {supplier.name}</span>
          {canManage && (
            <button type="button" className="btn btn-secondary" onClick={openEditModal}>
              <Edit size={16} /> Edit
            </button>
          )}
        </div>
        <div className="card-body">
          <div className="detail-grid">
            <div className="detail-row">
              <span className="detail-label">PIC</span>
              <span className="detail-value">{supplier.contactPerson || '-'}</span>
            </div>
            <div className="detail-row">
              <span className="detail-label">Telepon</span>
              <span className="detail-value">{supplier.phone || '-'}</span>
            </div>
            <div className="detail-row">
              <span className="detail-label">Termin Default</span>
              <span className="detail-value">{supplier.defaultTermDays || 0} hari</span>
            </div>
            <div className="detail-row">
              <span className="detail-label">Status</span>
              <span className="detail-value">
                <span className={`badge ${supplier.active !== false ? 'badge-success' : 'badge-gray'}`}>
                  {supplier.active !== false ? 'Aktif' : 'Nonaktif'}
                </span>
              </span>
            </div>
            <div className="detail-row">
              <span className="detail-label">Alamat</span>
              <span className="detail-value">{supplier.address || '-'}</span>
            </div>
            <div className="detail-row">
              <span className="detail-label">Catatan</span>
              <span className="detail-value">{supplier.notes || '-'}</span>
            </div>
            <div className="detail-row">
              <span className="detail-label">Total Pembelian</span>
              <span className="detail-value">{formatCurrency(totalPurchaseAmount)}</span>
            </div>
            <div className="detail-row">
              <span className="detail-label">Total Dibayar</span>
              <span className="detail-value">{formatCurrency(paidTotal)}</span>
            </div>
          </div>
        </div>
      </div>
      )}

      {activeTab === 'purchases' && (
      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <div className="card-header">
          <span className="card-header-title">Pembelian Supplier</span>
        </div>
        <div className="card-body">
          {purchases.length === 0 ? (
            <div className="empty-state">
              <Receipt size={40} className="empty-state-icon" />
              <div className="empty-state-title">Belum ada pembelian supplier</div>
            </div>
          ) : (
            <>
              <div className="table-wrapper table-desktop-only">
                <table>
                  <thead>
                    <tr>
                      <th>Nomor</th>
                      <th>Tanggal</th>
                      <th>Jatuh Tempo</th>
                      <th>Total</th>
                      <th>Outstanding</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {purchases.map((purchase) => (
                      <tr key={purchase._id}>
                        <td className="font-mono">
                          {canOpenPurchases ? (
                            <Link href={`/inventory/purchases/${purchase._id}`} style={{ color: 'var(--color-primary)' }}>
                              {purchase.purchaseNumber}
                            </Link>
                          ) : purchase.purchaseNumber}
                        </td>
                        <td>{formatDate(purchase.orderDate)}</td>
                        <td>{purchase.dueDate ? formatDate(purchase.dueDate) : '-'}</td>
                        <td>{formatCurrency(Number(purchase.totalAmount || 0))}</td>
                        <td>{formatCurrency(Number(purchase.outstandingAmount || 0))}</td>
                        <td>
                          <PurchaseLifecycleBadges purchase={purchase} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mobile-record-list">
                {purchases.map((purchase) => (
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
                        <div className="mobile-record-subtitle">{formatDate(purchase.orderDate)}</div>
                      </div>
                      <PurchaseLifecycleBadges purchase={purchase} />
                    </div>
                    <div className="mobile-record-grid">
                      <div className="mobile-record-field">
                        <span className="mobile-record-label">Jatuh Tempo</span>
                        <span className="mobile-record-value">{purchase.dueDate ? formatDate(purchase.dueDate) : '-'}</span>
                      </div>
                      <div className="mobile-record-field">
                        <span className="mobile-record-label">Total</span>
                        <span className="mobile-record-value">{formatCurrency(Number(purchase.totalAmount || 0))}</span>
                      </div>
                      <div className="mobile-record-field mobile-record-field-full">
                        <span className="mobile-record-label">Outstanding</span>
                        <span className="mobile-record-value">{formatCurrency(Number(purchase.outstandingAmount || 0))}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
      )}

      {activeTab === 'payments' && (
      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <div className="card-header">
          <span className="card-header-title">Pembayaran Supplier</span>
        </div>
        <div className="card-body">
          {payments.length === 0 ? (
            <div className="empty-state">
              <CreditCard size={40} className="empty-state-icon" />
              <div className="empty-state-title">Belum ada pembayaran supplier</div>
            </div>
          ) : (
            <>
              <div className="table-wrapper table-desktop-only">
                <table>
                  <thead>
                    <tr>
                      <th>Tanggal</th>
                      <th>Pembelian</th>
                      <th>Rekening</th>
                      <th>Nominal</th>
                      <th>Catatan</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payments.map((payment) => (
                      <tr key={payment._id}>
                        <td>{formatDate(payment.date)}</td>
                        <td className="font-mono">
                          {canOpenPurchases && payment.purchaseRef ? (
                            <Link href={`/inventory/purchases/${payment.purchaseRef}`} style={{ color: 'var(--color-primary)' }}>
                              {payment.purchaseNumber || '-'}
                            </Link>
                          ) : (payment.purchaseNumber || '-')}
                        </td>
                        <td>
                          {canOpenBankAccounts && payment.bankAccountRef ? (
                            <Link href={`/bank-accounts/${payment.bankAccountRef}`} style={{ color: 'var(--color-primary)' }}>
                              {payment.bankAccountName || '-'}
                            </Link>
                          ) : (payment.bankAccountName || '-')}
                        </td>
                        <td>{formatCurrency(Number(payment.amount || 0))}</td>
                        <td>{payment.note || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mobile-record-list">
                {payments.map((payment) => (
                  <div key={payment._id} className="mobile-record-card">
                    <div className="mobile-record-header">
                      <div>
                        <div className="mobile-record-title">{formatDate(payment.date)}</div>
                        <div className="mobile-record-subtitle">
                          {canOpenPurchases && payment.purchaseRef ? (
                            <Link href={`/inventory/purchases/${payment.purchaseRef}`} style={{ color: 'var(--color-primary)' }}>
                              {payment.purchaseNumber || '-'}
                            </Link>
                          ) : (payment.purchaseNumber || '-')}
                        </div>
                      </div>
                    </div>
                    <div className="mobile-record-grid">
                      <div className="mobile-record-field">
                        <span className="mobile-record-label">Rekening</span>
                        <span className="mobile-record-value">
                          {canOpenBankAccounts && payment.bankAccountRef ? (
                            <Link href={`/bank-accounts/${payment.bankAccountRef}`} style={{ color: 'var(--color-primary)' }}>
                              {payment.bankAccountName || '-'}
                            </Link>
                          ) : (payment.bankAccountName || '-')}
                        </span>
                      </div>
                      <div className="mobile-record-field">
                        <span className="mobile-record-label">Nominal</span>
                        <span className="mobile-record-value">{formatCurrency(Number(payment.amount || 0))}</span>
                      </div>
                      <div className="mobile-record-field mobile-record-field-full">
                        <span className="mobile-record-label">Catatan</span>
                        <span className="mobile-record-value">{payment.note || '-'}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
      )}

      {activeTab === 'items' && (
      <div className="card">
        <div className="card-header">
          <span className="card-header-title">Barang Gudang Terkait</span>
        </div>
        <div className="card-body">
          {items.length === 0 ? (
            <div className="empty-state">
              <Package size={40} className="empty-state-icon" />
              <div className="empty-state-title">Belum ada barang default atau riwayat pembelian untuk supplier ini</div>
            </div>
          ) : (
            <>
              <div className="text-muted" style={{ marginBottom: '1rem', lineHeight: 1.6 }}>
                Barang di bawah ini diambil dari dua sumber: master barang yang memakai supplier ini sebagai default, dan item yang benar-benar pernah dibeli dari supplier ini.
              </div>
              <div className="table-wrapper table-desktop-only">
                <table>
                  <thead>
                    <tr>
                      <th>Kode</th>
                      <th>Barang</th>
                      <th>Relasi</th>
                      <th>Qty Diterima</th>
                      <th>Stok</th>
                      <th>Pembelian Terakhir</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item) => (
                      <tr key={item._id}>
                        <td className="font-mono">
                          {canOpenItems ? (
                            <Link href={`/inventory/items/${item._id}`} style={{ color: 'var(--color-primary)' }}>
                              {item.itemCode}
                            </Link>
                          ) : item.itemCode}
                        </td>
                        <td>{item.name}</td>
                        <td>
                          <span className={`badge ${item.relationType === 'DEFAULT' ? 'badge-info' : item.relationType === 'PURCHASED' ? 'badge-warning' : 'badge-success'}`}>
                            {item.relationType === 'DEFAULT' ? 'Default' : item.relationType === 'PURCHASED' ? 'Dibeli' : 'Default + Dibeli'}
                          </span>
                        </td>
                        <td>{formatQuantity(item.totalReceivedQty)} {item.unit}</td>
                        <td>{formatQuantity(item.currentStockQty)} {item.unit}</td>
                        <td>{item.lastPurchaseDate ? formatDate(item.lastPurchaseDate) : '-'}</td>
                        <td>
                          <span className={`badge ${item.active ? 'badge-success' : 'badge-gray'}`}>
                            {item.active ? 'Aktif' : 'Nonaktif'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mobile-record-list">
                {items.map((item) => (
                  <div key={item._id} className="mobile-record-card">
                    <div className="mobile-record-header">
                      <div>
                        <div className="mobile-record-title">
                          {canOpenItems ? (
                            <Link href={`/inventory/items/${item._id}`} style={{ color: 'var(--color-primary)' }}>
                              {item.name}
                            </Link>
                          ) : item.name}
                        </div>
                        <div className="mobile-record-subtitle">{item.itemCode}</div>
                      </div>
                      <span className={`badge ${item.active ? 'badge-success' : 'badge-gray'}`}>
                        {item.active ? 'Aktif' : 'Nonaktif'}
                      </span>
                    </div>
                    <div className="mobile-record-grid">
                      <div className="mobile-record-field">
                        <span className="mobile-record-label">Relasi</span>
                        <span className="mobile-record-value">
                          {item.relationType === 'DEFAULT' ? 'Default' : item.relationType === 'PURCHASED' ? 'Dibeli' : 'Default + Dibeli'}
                        </span>
                      </div>
                      <div className="mobile-record-field">
                        <span className="mobile-record-label">Qty Diterima</span>
                        <span className="mobile-record-value">{formatQuantity(item.totalReceivedQty)} {item.unit}</span>
                      </div>
                      <div className="mobile-record-field">
                        <span className="mobile-record-label">Stok</span>
                        <span className="mobile-record-value">{formatQuantity(item.currentStockQty)} {item.unit}</span>
                      </div>
                      <div className="mobile-record-field">
                        <span className="mobile-record-label">Pembelian Terakhir</span>
                        <span className="mobile-record-value">{item.lastPurchaseDate ? formatDate(item.lastPurchaseDate) : '-'}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
      )}

      {showEditModal && (
        <div className="modal-overlay" onClick={closeEditModal}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">Edit Supplier</h3>
              <button className="modal-close" onClick={closeEditModal} disabled={saving}>
                <X size={20} />
              </button>
            </div>
            <div className="modal-body">
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Kode Supplier</label>
                  <input className="form-input" value={form.supplierCode} onChange={(event) => setForm((current) => ({ ...current, supplierCode: event.target.value }))} />
                </div>
                <div className="form-group">
                  <label className="form-label">Nama Supplier</label>
                  <input className="form-input" value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">PIC</label>
                  <input className="form-input" value={form.contactPerson} onChange={(event) => setForm((current) => ({ ...current, contactPerson: event.target.value }))} />
                </div>
                <div className="form-group">
                  <label className="form-label">Telepon</label>
                  <input className="form-input" value={form.phone} onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))} />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Termin Default (hari)</label>
                  <FormattedNumberInput allowDecimal={false} min={0} value={form.defaultTermDays} onValueChange={(value) => setForm((current) => ({ ...current, defaultTermDays: value }))} />
                </div>
                <div className="form-group">
                  <label className="form-label">Status</label>
                  <select className="form-select" value={form.active ? 'active' : 'inactive'} onChange={(event) => setForm((current) => ({ ...current, active: event.target.value === 'active' }))}>
                    <option value="active">Aktif</option>
                    <option value="inactive">Nonaktif</option>
                  </select>
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Alamat</label>
                <textarea className="form-textarea" rows={3} value={form.address} onChange={(event) => setForm((current) => ({ ...current, address: event.target.value }))} />
              </div>
              <div className="form-group">
                <label className="form-label">Catatan</label>
                <textarea className="form-textarea" rows={3} value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={closeEditModal} disabled={saving}>Batal</button>
              <button className="btn btn-primary" onClick={() => void handleSave()} disabled={saving}>
                <Save size={16} /> {saving ? 'Menyimpan...' : 'Simpan'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
