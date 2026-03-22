'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useToast } from '../../layout';
import { Edit, Package, DollarSign, Plus, Save, Trash2, X } from 'lucide-react';
import CollapsibleCard from '@/components/CollapsibleCard';
import FormattedNumberInput from '@/components/FormattedNumberInput';
import { formatDate, formatCurrency, getReceivableNetAmount } from '@/lib/utils';
import { formatCargoSummary, VOLUME_INPUT_UNIT_OPTIONS, WEIGHT_INPUT_UNIT_OPTIONS, type VolumeInputUnit, type WeightInputUnit } from '@/lib/measurement';
import type { Customer, CustomerProduct, Order, FreightNota } from '@/lib/types';
import PageBackButton from '@/components/PageBackButton';

type CustomerProductForm = {
    code: string;
    name: string;
    description: string;
    defaultQtyKoli: number;
    defaultWeightInputValue: number;
    defaultWeightInputUnit: WeightInputUnit;
    defaultVolumeInputValue: number;
    defaultVolumeInputUnit: VolumeInputUnit;
    notes: string;
    active: boolean;
};

const DEFAULT_PRODUCT_FORM: CustomerProductForm = {
    code: '',
    name: '',
    description: '',
    defaultQtyKoli: 1,
    defaultWeightInputValue: 0,
    defaultWeightInputUnit: 'KG',
    defaultVolumeInputValue: 0,
    defaultVolumeInputUnit: 'M3',
    notes: '',
    active: true,
};

export default function CustomerDetailPage() {
    const params = useParams();
    const { addToast } = useToast();
    const customerId = params.id as string;
    const [customer, setCustomer] = useState<Customer | null>(null);
    const [customerProducts, setCustomerProducts] = useState<CustomerProduct[]>([]);
    const [orders, setOrders] = useState<Order[]>([]);
    const [notas, setNotas] = useState<FreightNota[]>([]);
    const [loading, setLoading] = useState(true);
    const [editing, setEditing] = useState(false);
    const [saving, setSaving] = useState(false);
    const [showProductModal, setShowProductModal] = useState(false);
    const [savingProduct, setSavingProduct] = useState(false);
    const [deletingProductId, setDeletingProductId] = useState<string | null>(null);
    const [editProduct, setEditProduct] = useState<CustomerProduct | null>(null);
    const [form, setForm] = useState({ name: '', address: '', contactPerson: '', phone: '', email: '', npwp: '', deliveryOrderPrefix: 'SJ' });
    const [productForm, setProductForm] = useState<CustomerProductForm>(DEFAULT_PRODUCT_FORM);

    useEffect(() => {
        const fetchEntity = async <T,>(url: string) => {
            const res = await fetch(url);
            const result = await res.json();
            if (!res.ok) {
                throw new Error(result.error || 'Gagal memuat data customer');
            }
            return result.data as T;
        };

        const loadCustomerDetail = async () => {
            setLoading(true);
            try {
                const [cust, productRows, customerOrders, customerNotas] = await Promise.all([
                    fetchEntity<Customer | null>(`/api/data?entity=customers&id=${customerId}`),
                    fetchEntity<CustomerProduct[]>(`/api/data?entity=customer-products&filter=${encodeURIComponent(JSON.stringify({ customerRef: customerId }))}`),
                    fetchEntity<Order[]>(`/api/data?entity=orders&filter=${encodeURIComponent(JSON.stringify({ customerRef: customerId }))}`),
                    fetchEntity<FreightNota[]>(`/api/data?entity=freight-notas&filter=${encodeURIComponent(JSON.stringify({ customerRef: customerId }))}`),
                ]);

                setCustomer(cust);
                setCustomerProducts(productRows || []);
                setOrders(customerOrders || []);
                setNotas(customerNotas || []);
                if (cust) {
                    setForm({
                        name: cust.name,
                        address: cust.address,
                        contactPerson: cust.contactPerson,
                        phone: cust.phone,
                        email: cust.email,
                        npwp: cust.npwp || '',
                        deliveryOrderPrefix: cust.deliveryOrderPrefix || 'SJ',
                    });
                }
            } catch (error) {
                addToast('error', error instanceof Error ? error.message : 'Gagal memuat data customer');
            } finally {
                setLoading(false);
            }
        };

        void loadCustomerDetail();
    }, [addToast, customerId]);

    const openNewProduct = () => {
        setEditProduct(null);
        setProductForm(DEFAULT_PRODUCT_FORM);
        setShowProductModal(true);
    };

    const openEditProduct = (product: CustomerProduct) => {
        setEditProduct(product);
        setProductForm({
            code: product.code || '',
            name: product.name || '',
            description: product.description || '',
            defaultQtyKoli: product.defaultQtyKoli || 1,
            defaultWeightInputValue: product.defaultWeightInputValue || 0,
            defaultWeightInputUnit: product.defaultWeightInputUnit || 'KG',
            defaultVolumeInputValue: product.defaultVolumeInputValue || 0,
            defaultVolumeInputUnit: product.defaultVolumeInputUnit || 'M3',
            notes: product.notes || '',
            active: product.active !== false,
        });
        setShowProductModal(true);
    };

    const handleSaveProduct = async () => {
        if (!productForm.name.trim()) {
            addToast('error', 'Nama barang customer wajib diisi');
            return;
        }

        setSavingProduct(true);
        try {
            const payload = {
                customerRef: customerId,
                ...productForm,
            };
            const res = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(
                    editProduct
                        ? { entity: 'customer-products', action: 'update', data: { id: editProduct._id, updates: payload } }
                        : { entity: 'customer-products', data: payload }
                ),
            });
            const result = await res.json();
            if (!res.ok) {
                addToast('error', result.error || 'Gagal menyimpan barang customer');
                return;
            }

            const savedProduct = result.data as CustomerProduct;
            setCustomerProducts(prev =>
                editProduct
                    ? prev.map(item => item._id === editProduct._id ? savedProduct : item)
                    : [savedProduct, ...prev]
            );
            setShowProductModal(false);
            addToast('success', editProduct ? 'Barang customer diperbarui' : 'Barang customer ditambahkan');
        } catch {
            addToast('error', 'Gagal menyimpan barang customer');
        } finally {
            setSavingProduct(false);
        }
    };

    const handleDeleteProduct = async (productId: string) => {
        setDeletingProductId(productId);
        try {
            const res = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ entity: 'customer-products', action: 'delete', data: { id: productId } }),
            });
            const result = await res.json();
            if (!res.ok) {
                addToast('error', result.error || 'Gagal menghapus barang customer');
                return;
            }
            setCustomerProducts(prev => prev.filter(item => item._id !== productId));
            addToast('success', 'Barang customer dihapus');
        } catch {
            addToast('error', 'Gagal menghapus barang customer');
        } finally {
            setDeletingProductId(null);
        }
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            const res = await fetch('/api/data', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ entity: 'customers', action: 'update', data: { id: customerId, updates: form } }),
            });
            const result = await res.json();
            if (!res.ok) {
                addToast('error', result.error || 'Gagal menyimpan perubahan customer');
                return;
            }
            setCustomer(prev => prev ? { ...prev, ...form } : prev);
            setEditing(false);
            addToast('success', 'Customer berhasil diperbarui');
        } catch { addToast('error', 'Gagal menyimpan'); }
        finally { setSaving(false); }
    };

    if (loading) return <div><div className="skeleton skeleton-title" /><div className="skeleton skeleton-card" style={{ height: 200 }} /></div>;
    if (!customer) return <div className="empty-state"><div className="empty-state-title">Customer tidak ditemukan</div></div>;

    const activeOrderCount = orders.filter(order => !['COMPLETE', 'CANCELLED'].includes(order.status)).length;
    const activeNotaCount = notas.filter(nota => nota.status !== 'PAID').length;
    const totalNotaNetAmount = notas.reduce((sum, nota) => sum + getReceivableNetAmount(nota), 0);

    return (
        <div>
            <div className="page-header">
                <div className="page-header-left" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                    <PageBackButton href="/customers" />
                    <div>
                        <h1 className="page-title">{customer.name}</h1>
                        <p className="page-subtitle">Kelola profil customer, barang langganan, dan cek histori singkat order serta nota.</p>
                    </div>
                </div>
                <div className="page-actions">
                    {!editing && <button className="btn btn-secondary" onClick={openNewProduct}><Plus size={16} /> Tambah Barang</button>}
                    {!editing && <button className="btn btn-primary" onClick={() => setEditing(true)}><Edit size={16} /> Edit</button>}
                </div>
            </div>

            <div style={{ display: 'grid', gap: 'var(--space-6)' }}>
            <div style={{ background: 'var(--color-gray-50)', borderRadius: '0.75rem', padding: '1rem 1.1rem', border: '1px solid var(--color-gray-200)' }}>
                <div style={{ fontWeight: 600, marginBottom: '0.25rem' }}>Yang paling sering dipakai di halaman ini</div>
                <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                    Untuk kerja harian, bagian utama biasanya hanya <strong>Master Barang Customer</strong>. Histori order dan nota di bawah cukup dibuka saat perlu cek cepat.
                </div>
            </div>
            <div
                className="detail-grid"
                style={{
                    gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
                    alignItems: 'start',
                }}
            >
                <div className="card">
                    <div className="card-header"><span className="card-header-title">Informasi Customer</span></div>
                    <div className="card-body">
                        {editing ? (
                            <>
                                <div className="form-group"><label className="form-label">Nama</label><input className="form-input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
                                <div className="form-group"><label className="form-label">Alamat</label><textarea className="form-textarea" rows={2} value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} /></div>
                                <div className="form-row">
                                    <div className="form-group"><label className="form-label">Contact Person</label><input className="form-input" value={form.contactPerson} onChange={e => setForm({ ...form, contactPerson: e.target.value })} /></div>
                                    <div className="form-group"><label className="form-label">Telepon</label><input className="form-input" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} /></div>
                                </div>
                                <div className="form-row">
                                    <div className="form-group"><label className="form-label">Email</label><input className="form-input" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></div>
                                    <div className="form-group"><label className="form-label">NPWP</label><input className="form-input" value={form.npwp} onChange={e => setForm({ ...form, npwp: e.target.value })} /></div>
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Prefix Surat Jalan Customer</label>
                                    <input className="form-input" value={form.deliveryOrderPrefix} onChange={e => setForm({ ...form, deliveryOrderPrefix: e.target.value.toUpperCase() })} />
                                </div>
                                <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
                                    <button className="btn btn-secondary" onClick={() => setEditing(false)} disabled={saving}>Batal</button>
                                    <button className="btn btn-primary" onClick={handleSave} disabled={saving}>{saving ? 'Menyimpan...' : 'Simpan'}</button>
                                </div>
                            </>
                        ) : (
                            <>
                                <div className="detail-row">
                                    <div className="detail-item"><div className="detail-label">Nama</div><div className="detail-value font-medium">{customer.name}</div></div>
                                    <div className="detail-item"><div className="detail-label">Contact Person</div><div className="detail-value">{customer.contactPerson}</div></div>
                                </div>
                                <div className="detail-row">
                                    <div className="detail-item"><div className="detail-label">Telepon</div><div className="detail-value">{customer.phone}</div></div>
                                    <div className="detail-item"><div className="detail-label">Email</div><div className="detail-value">{customer.email}</div></div>
                                </div>
                                <div className="detail-row">
                                    <div className="detail-item"><div className="detail-label">Prefix Surat Jalan</div><div className="detail-value font-mono">{customer.deliveryOrderPrefix || 'SJ'}</div></div>
                                    <div className="detail-item"><div className="detail-label">Counter SJ Saat Ini</div><div className="detail-value">{customer.deliveryOrderCounter || 0}</div></div>
                                </div>
                                <div className="detail-item mt-2"><div className="detail-label">Alamat</div><div className="detail-value">{customer.address}</div></div>
                                {customer.npwp && <div className="detail-item mt-2"><div className="detail-label">NPWP</div><div className="detail-value font-mono">{customer.npwp}</div></div>}
                            </>
                        )}
                    </div>
                </div>

                <div className="card">
                    <div className="card-header"><span className="card-header-title">Ringkasan Kerja</span></div>
                    <div className="card-body">
                        <div className="responsive-stat-grid">
                            <div className="kpi-card"><div className="kpi-icon" style={{ background: 'var(--color-primary-light)' }}><Package size={20} /></div><div className="kpi-value">{activeOrderCount}</div><div className="kpi-label">Order Aktif</div></div>
                            <div className="kpi-card"><div className="kpi-icon" style={{ background: 'var(--color-success-light)' }}><DollarSign size={20} /></div><div className="kpi-value">{activeNotaCount}</div><div className="kpi-label">Nota Belum Lunas</div></div>
                            <div className="kpi-card"><div className="kpi-icon" style={{ background: 'var(--color-warning-light)' }}><Package size={20} /></div><div className="kpi-value">{customerProducts.length}</div><div className="kpi-label">Master Barang</div></div>
                        </div>
                        <div style={{ marginTop: '0.85rem', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                            Total nilai nota customer ini saat ini: <strong style={{ color: 'var(--color-gray-800)' }}>{formatCurrency(totalNotaNetAmount)}</strong>
                        </div>
                    </div>
                </div>
            </div>

            <CollapsibleCard
                title={`Master Barang Customer (${customerProducts.length})`}
                subtitle="Bagian ini paling sering dipakai untuk mempercepat input order customer ini."
                defaultOpen
            >
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '0.75rem' }}>
                    <button className="btn btn-primary btn-sm" onClick={openNewProduct}>
                        <Plus size={14} /> Tambah Barang
                    </button>
                </div>
                <div className="table-wrapper table-desktop-only">
                    <table>
                        <thead><tr><th>Kode</th><th>Nama Barang</th><th>Default Muatan</th><th>Status</th><th>Aksi</th></tr></thead>
                        <tbody>
                            {customerProducts.length === 0 ? (
                                <tr><td colSpan={5} className="text-center text-muted" style={{ padding: '2rem' }}>Belum ada master barang untuk customer ini</td></tr>
                            ) : (
                                customerProducts.map(product => (
                                    <tr key={product._id}>
                                        <td className="font-mono">{product.code || '-'}</td>
                                        <td>
                                            <div style={{ fontWeight: 600 }}>{product.name}</div>
                                            {product.description && product.description !== product.name && (
                                                <div className="text-muted" style={{ fontSize: '0.82rem', marginTop: '0.2rem' }}>{product.description}</div>
                                            )}
                                            {product.notes && (
                                                <div className="text-muted" style={{ fontSize: '0.75rem', marginTop: '0.25rem' }}>{product.notes}</div>
                                            )}
                                        </td>
                                        <td>{formatCargoSummary({
                                            qtyKoli: product.defaultQtyKoli,
                                            weightKg: product.defaultWeight,
                                            weightInputValue: product.defaultWeightInputValue,
                                            weightInputUnit: product.defaultWeightInputUnit,
                                            volumeM3: product.defaultVolume,
                                            volumeInputValue: product.defaultVolumeInputValue,
                                            volumeInputUnit: product.defaultVolumeInputUnit,
                                        })}</td>
                                        <td><span className={`badge ${product.active !== false ? 'badge-green' : 'badge-gray'}`}>{product.active !== false ? 'Aktif' : 'Nonaktif'}</span></td>
                                        <td>
                                            <div className="table-actions">
                                                <button className="table-action-btn" onClick={() => openEditProduct(product)}><Edit size={14} /> Edit</button>
                                                <button className="table-action-btn danger" onClick={() => handleDeleteProduct(product._id)} disabled={deletingProductId === product._id}>
                                                    <Trash2 size={14} /> {deletingProductId === product._id ? 'Menghapus...' : 'Hapus'}
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
                <div className="mobile-record-list">
                    {customerProducts.length === 0 ? (
                        <div className="mobile-record-card">
                            <div className="mobile-record-title">Belum ada master barang</div>
                            <div className="mobile-record-subtitle">Tambahkan barang langganan customer ini agar form order bisa autofill lebih cepat.</div>
                            <div className="mobile-record-actions">
                                <button className="btn btn-primary" onClick={openNewProduct}>
                                    <Plus size={16} /> Tambah Barang
                                </button>
                            </div>
                        </div>
                    ) : customerProducts.map(product => (
                        <div key={product._id} className="mobile-record-card">
                            <div className="mobile-record-header">
                                <div>
                                    <div className="mobile-record-title">{product.name}</div>
                                    <div className="mobile-record-subtitle">{product.code || 'Tanpa kode'}</div>
                                </div>
                                <span className={`badge ${product.active !== false ? 'badge-green' : 'badge-gray'}`}>{product.active !== false ? 'Aktif' : 'Nonaktif'}</span>
                            </div>
                            <div className="mobile-record-meta">
                                <div className="mobile-record-kv">
                                    <span className="mobile-record-label">Muatan Default</span>
                                    <span className="mobile-record-value">{formatCargoSummary({
                                        qtyKoli: product.defaultQtyKoli,
                                        weightKg: product.defaultWeight,
                                        weightInputValue: product.defaultWeightInputValue,
                                        weightInputUnit: product.defaultWeightInputUnit,
                                        volumeM3: product.defaultVolume,
                                        volumeInputValue: product.defaultVolumeInputValue,
                                        volumeInputUnit: product.defaultVolumeInputUnit,
                                    })}</span>
                                </div>
                                <div className="mobile-record-kv">
                                    <span className="mobile-record-label">Catatan</span>
                                    <span className="mobile-record-value">{product.notes || product.description || '-'}</span>
                                </div>
                            </div>
                            <div className="mobile-record-actions">
                                <button className="btn btn-secondary" onClick={() => openEditProduct(product)}>
                                    <Edit size={14} /> Edit
                                </button>
                                <button className="btn btn-danger" onClick={() => handleDeleteProduct(product._id)} disabled={deletingProductId === product._id}>
                                    <Trash2 size={14} /> {deletingProductId === product._id ? 'Menghapus...' : 'Hapus'}
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            </CollapsibleCard>

            <CollapsibleCard
                title={`Order Terbaru (${orders.length})`}
                subtitle="Buka jika perlu cek cepat order customer ini tanpa masuk ke menu order."
            >
                <div className="table-wrapper table-desktop-only">
                    <table>
                        <thead><tr><th>Resi</th><th>Penerima</th><th>Status</th><th>Tanggal</th></tr></thead>
                        <tbody>
                            {orders.length === 0 ? <tr><td colSpan={4} className="text-center text-muted" style={{ padding: '2rem' }}>Belum ada order</td></tr> :
                                orders.slice(0, 10).map(o => (
                                    <tr key={o._id}>
                                        <td><Link href={`/orders/${o._id}`} style={{ color: 'var(--color-primary)' }}>{o.masterResi}</Link></td>
                                        <td>{o.receiverName}</td>
                                        <td>{o.status}</td>
                                        <td className="text-muted">{formatDate(o.createdAt)}</td>
                                    </tr>
                                ))}
                        </tbody>
                    </table>
                </div>
                <div className="mobile-record-list">
                    {orders.length === 0 ? (
                        <div className="mobile-record-card">
                            <div className="mobile-record-title">Belum ada order</div>
                            <div className="mobile-record-subtitle">Customer ini belum punya order yang tercatat.</div>
                        </div>
                    ) : orders.slice(0, 10).map(order => (
                        <div key={order._id} className="mobile-record-card">
                            <div className="mobile-record-header">
                                <div>
                                    <div className="mobile-record-title">{order.masterResi}</div>
                                    <div className="mobile-record-subtitle">{order.receiverName}</div>
                                </div>
                                <span className="badge badge-info">{order.status}</span>
                            </div>
                            <div className="mobile-record-meta">
                                <div className="mobile-record-kv">
                                    <span className="mobile-record-label">Tanggal</span>
                                    <span className="mobile-record-value">{formatDate(order.createdAt)}</span>
                                </div>
                            </div>
                            <div className="mobile-record-actions">
                                <Link href={`/orders/${order._id}`} className="btn btn-secondary">Lihat Order</Link>
                            </div>
                        </div>
                    ))}
                </div>
            </CollapsibleCard>

            <CollapsibleCard
                title={`Nota Ongkos (${notas.length})`}
                subtitle="Buka jika perlu cek tagihan customer ini tanpa masuk ke menu tagihan."
            >
                <div className="table-wrapper table-desktop-only">
                    <table>
                        <thead><tr><th>No. Nota</th><th>Total</th><th>Status</th><th>Jatuh Tempo</th></tr></thead>
                        <tbody>
                            {notas.length === 0 ? <tr><td colSpan={4} className="text-center text-muted" style={{ padding: '2rem' }}>Belum ada nota</td></tr> :
                                notas.map(nota => (
                                    <tr key={nota._id}>
                                        <td><Link href={`/invoices/${nota._id}`} style={{ color: 'var(--color-primary)' }}>{nota.notaNumber}</Link></td>
                                        <td className="font-medium">{formatCurrency(getReceivableNetAmount(nota))}</td>
                                        <td>{nota.status}</td>
                                        <td className="text-muted">{formatDate(nota.dueDate)}</td>
                                    </tr>
                                ))}
                        </tbody>
                    </table>
                </div>
                <div className="mobile-record-list">
                    {notas.length === 0 ? (
                        <div className="mobile-record-card">
                            <div className="mobile-record-title">Belum ada nota</div>
                            <div className="mobile-record-subtitle">Tagihan customer ini akan muncul di sini setelah DO selesai dan nota dibuat.</div>
                        </div>
                    ) : notas.map(nota => (
                        <div key={nota._id} className="mobile-record-card">
                            <div className="mobile-record-header">
                                <div>
                                    <div className="mobile-record-title">{nota.notaNumber}</div>
                                    <div className="mobile-record-subtitle">Jatuh tempo {formatDate(nota.dueDate)}</div>
                                </div>
                                <span className="badge badge-info">{nota.status}</span>
                            </div>
                            <div className="mobile-record-meta">
                                <div className="mobile-record-kv">
                                    <span className="mobile-record-label">Tagihan Netto</span>
                                    <span className="mobile-record-value">{formatCurrency(getReceivableNetAmount(nota))}</span>
                                </div>
                            </div>
                            <div className="mobile-record-actions">
                                <Link href={`/invoices/${nota._id}`} className="btn btn-secondary">Lihat Nota</Link>
                            </div>
                        </div>
                    ))}
                </div>
            </CollapsibleCard>
            </div>

            {showProductModal && (
                <div className="modal-overlay" onClick={() => { if (!savingProduct) setShowProductModal(false); }}>
                    <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3 className="modal-title">{editProduct ? 'Edit Barang Customer' : 'Tambah Barang Customer'}</h3>
                            <button className="modal-close" onClick={() => setShowProductModal(false)} disabled={savingProduct}><X size={20} /></button>
                        </div>
                        <div className="modal-body">
                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label">Kode Barang</label>
                                    <input className="form-input" value={productForm.code} onChange={e => setProductForm(prev => ({ ...prev, code: e.target.value.toUpperCase() }))} placeholder="Contoh: KRM-4040" />
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Nama Barang <span className="required">*</span></label>
                                    <input className="form-input" value={productForm.name} onChange={e => setProductForm(prev => ({ ...prev, name: e.target.value }))} placeholder="Contoh: Keramik 40x40" />
                                </div>
                            </div>
                            <div className="form-group">
                                <label className="form-label">Deskripsi Default</label>
                                <textarea className="form-textarea" rows={2} value={productForm.description} onChange={e => setProductForm(prev => ({ ...prev, description: e.target.value }))} placeholder="Deskripsi item yang akan otomatis masuk ke order" />
                            </div>
                                <div className="form-row">
                                    <div className="form-group">
                                        <label className="form-label">Default Koli</label>
                                        <FormattedNumberInput min={0} allowDecimal={false} value={productForm.defaultQtyKoli} onValueChange={value => setProductForm(prev => ({ ...prev, defaultQtyKoli: value }))} />
                                    </div>
                                <div className="form-group">
                                    <label className="form-label">Status</label>
                                    <select className="form-select" value={productForm.active ? 'ACTIVE' : 'INACTIVE'} onChange={e => setProductForm(prev => ({ ...prev, active: e.target.value === 'ACTIVE' }))}>
                                        <option value="ACTIVE">Aktif</option>
                                        <option value="INACTIVE">Nonaktif</option>
                                    </select>
                                </div>
                            </div>
                                <div className="form-row">
                                    <div className="form-group">
                                        <label className="form-label">Default Berat</label>
                                        <div style={{ display: 'flex', gap: 8 }}>
                                        <FormattedNumberInput min={0} maxFractionDigits={2} value={productForm.defaultWeightInputValue} onValueChange={value => setProductForm(prev => ({ ...prev, defaultWeightInputValue: value }))} />
                                        <select className="form-select" value={productForm.defaultWeightInputUnit} onChange={e => setProductForm(prev => ({ ...prev, defaultWeightInputUnit: e.target.value as WeightInputUnit }))} style={{ width: 100 }}>
                                            {WEIGHT_INPUT_UNIT_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                                        </select>
                                    </div>
                                </div>
                                    <div className="form-group">
                                        <label className="form-label">Default Volume</label>
                                        <div style={{ display: 'flex', gap: 8 }}>
                                        <FormattedNumberInput min={0} maxFractionDigits={2} value={productForm.defaultVolumeInputValue} onValueChange={value => setProductForm(prev => ({ ...prev, defaultVolumeInputValue: value }))} />
                                        <select className="form-select" value={productForm.defaultVolumeInputUnit} onChange={e => setProductForm(prev => ({ ...prev, defaultVolumeInputUnit: e.target.value as VolumeInputUnit }))} style={{ width: 100 }}>
                                            {VOLUME_INPUT_UNIT_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                                        </select>
                                    </div>
                                </div>
                            </div>
                            <div className="form-group">
                                <label className="form-label">Catatan Internal</label>
                                <textarea className="form-textarea" rows={2} value={productForm.notes} onChange={e => setProductForm(prev => ({ ...prev, notes: e.target.value }))} placeholder="Catatan handling / catatan internal" />
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setShowProductModal(false)} disabled={savingProduct}>Batal</button>
                            <button className="btn btn-primary" onClick={handleSaveProduct} disabled={savingProduct}><Save size={16} /> {savingProduct ? 'Menyimpan...' : 'Simpan'}</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
