'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { CreditCard, Package, Receipt } from 'lucide-react';

import PageBackButton from '@/components/PageBackButton';
import { fetchAdminData, fetchAllAdminCollectionData } from '@/lib/api/admin-client';
import { getBusinessDateValue } from '@/lib/business-date';
import { PURCHASE_STATUS_LABELS } from '@/lib/inventory';
import { hasPageAccess } from '@/lib/rbac';
import type { Purchase, PurchasePayment, Supplier, WarehouseItem } from '@/lib/types';
import { formatCurrency, formatDate } from '@/lib/utils';

import { useApp, useToast } from '../../layout';

function getPurchaseStatusBadge(status: Purchase['status']) {
  if (status === 'PAID') return 'badge-success';
  if (status === 'CANCELLED') return 'badge-gray';
  if (status === 'PARTIALLY_PAID' || status === 'PARTIALLY_RECEIVED') return 'badge-warning';
  return 'badge-info';
}

export default function SupplierDetailPage() {
  const params = useParams();
  const { user } = useApp();
  const { addToast } = useToast();
  const supplierId = params.id as string;
  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [payments, setPayments] = useState<PurchasePayment[]>([]);
  const [items, setItems] = useState<WarehouseItem[]>([]);
  const [loading, setLoading] = useState(true);
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

      const [purchaseRows, paymentRows, itemRows] = await Promise.all([
        fetchAllAdminCollectionData<Purchase>(`/api/data?entity=purchases&filter=${encodeURIComponent(JSON.stringify({ supplierRef: supplierId }))}&sortField=orderDate&sortDir=desc`, 'Gagal memuat pembelian supplier'),
        fetchAllAdminCollectionData<PurchasePayment>(`/api/data?entity=purchase-payments&filter=${encodeURIComponent(JSON.stringify({ supplierRef: supplierId }))}&sortField=date&sortDir=desc`, 'Gagal memuat pembayaran supplier'),
        fetchAllAdminCollectionData<WarehouseItem>(`/api/data?entity=warehouse-items&filter=${encodeURIComponent(JSON.stringify({ defaultSupplierRef: supplierId }))}&sortField=itemCode&sortDir=asc`, 'Gagal memuat barang gudang supplier'),
      ]);

      setSupplier(supplierData);
      setPurchases((purchaseRows || []).sort((a, b) => String(b.orderDate || '').localeCompare(String(a.orderDate || ''))));
      setPayments((paymentRows || []).sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))));
      setItems((itemRows || []).sort((a, b) => String(a.itemCode || '').localeCompare(String(b.itemCode || ''))));
    } catch (error) {
      addToast('error', error instanceof Error ? error.message : 'Gagal memuat detail supplier');
    } finally {
      setLoading(false);
    }
  }, [addToast, supplierId]);

  useEffect(() => { void loadSupplierDetail(); }, [loadSupplierDetail]);

  const openPurchases = useMemo(
    () => purchases.filter((purchase) => purchase.status !== 'PAID' && purchase.status !== 'CANCELLED' && Number(purchase.outstandingAmount || 0) > 0),
    [purchases]
  );
  const outstandingTotal = useMemo(
    () => purchases.reduce((sum, purchase) => sum + Number(purchase.outstandingAmount || 0), 0),
    [purchases]
  );
  const totalPurchaseAmount = useMemo(
    () => purchases.reduce((sum, purchase) => sum + Number(purchase.totalAmount || 0), 0),
    [purchases]
  );
  const paidTotal = useMemo(
    () => payments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0),
    [payments]
  );
  const overdueCount = useMemo(
    () => openPurchases.filter((purchase) => purchase.dueDate && purchase.dueDate < today).length,
    [openPurchases, today]
  );

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

      <div className="kpi-grid" style={{ marginBottom: '1.5rem' }}>
        <div className="kpi-card">
          <div className="kpi-content">
            <div className="kpi-label">Outstanding</div>
            <div className="kpi-value">{formatCurrency(outstandingTotal)}</div>
          </div>
        </div>
        <div className="kpi-card">
          <div className="kpi-content">
            <div className="kpi-label">Pembelian Aktif</div>
            <div className="kpi-value">{openPurchases.length}</div>
          </div>
        </div>
        <div className="kpi-card">
          <div className="kpi-content">
            <div className="kpi-label">Jatuh Tempo</div>
            <div className="kpi-value">{overdueCount}</div>
          </div>
        </div>
        <div className="kpi-card">
          <div className="kpi-content">
            <div className="kpi-label">Barang Default</div>
            <div className="kpi-value">{items.length}</div>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <div className="card-header">
          <span className="card-header-title">{supplier.supplierCode} - {supplier.name}</span>
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
                          <span className={`badge ${getPurchaseStatusBadge(purchase.status)}`}>
                            {PURCHASE_STATUS_LABELS[purchase.status]}
                          </span>
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
                      <span className={`badge ${getPurchaseStatusBadge(purchase.status)}`}>
                        {PURCHASE_STATUS_LABELS[purchase.status]}
                      </span>
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

      <div className="card">
        <div className="card-header">
          <span className="card-header-title">Barang Gudang Terkait</span>
        </div>
        <div className="card-body">
          {items.length === 0 ? (
            <div className="empty-state">
              <Package size={40} className="empty-state-icon" />
              <div className="empty-state-title">Belum ada barang gudang yang memakai supplier ini sebagai default</div>
            </div>
          ) : (
            <>
              <div className="table-wrapper table-desktop-only">
                <table>
                  <thead>
                    <tr>
                      <th>Kode</th>
                      <th>Barang</th>
                      <th>Stok</th>
                      <th>Min. Stok</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item) => (
                      <tr key={item._id}>
                        <td className="font-mono">
                          {canOpenItems ? (
                            <Link href={`/inventory/items?q=${encodeURIComponent(item.itemCode || item.name || '')}`} style={{ color: 'var(--color-primary)' }}>
                              {item.itemCode}
                            </Link>
                          ) : item.itemCode}
                        </td>
                        <td>{item.name}</td>
                        <td>{item.currentStockQty || 0} {item.unit}</td>
                        <td>{item.minStockQty || 0} {item.unit}</td>
                        <td>
                          <span className={`badge ${item.active !== false ? 'badge-success' : 'badge-gray'}`}>
                            {item.active !== false ? 'Aktif' : 'Nonaktif'}
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
                            <Link href={`/inventory/items?q=${encodeURIComponent(item.itemCode || item.name || '')}`} style={{ color: 'var(--color-primary)' }}>
                              {item.name}
                            </Link>
                          ) : item.name}
                        </div>
                        <div className="mobile-record-subtitle">{item.itemCode}</div>
                      </div>
                      <span className={`badge ${item.active !== false ? 'badge-success' : 'badge-gray'}`}>
                        {item.active !== false ? 'Aktif' : 'Nonaktif'}
                      </span>
                    </div>
                    <div className="mobile-record-grid">
                      <div className="mobile-record-field">
                        <span className="mobile-record-label">Stok</span>
                        <span className="mobile-record-value">{item.currentStockQty || 0} {item.unit}</span>
                      </div>
                      <div className="mobile-record-field">
                        <span className="mobile-record-label">Min. Stok</span>
                        <span className="mobile-record-value">{item.minStockQty || 0} {item.unit}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
