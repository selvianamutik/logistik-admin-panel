'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useToast } from '../../layout';
import { Edit, Package, DollarSign, Plus, Save, Trash2, X } from 'lucide-react';
import CollapsibleCard from '@/components/CollapsibleCard';
import FormattedNumberInput from '@/components/FormattedNumberInput';
import { fetchAdminData } from '@/lib/api/admin-client';
import { formatDate, formatCurrency, getReceivableNetAmount } from '@/lib/utils';
import { formatCargoSummary, VOLUME_INPUT_UNIT_OPTIONS, WEIGHT_INPUT_UNIT_OPTIONS, type VolumeInputUnit, type WeightInputUnit } from '@/lib/measurement';
import type { Customer, CustomerProduct, CustomerRecipient, Order, FreightNota } from '@/lib/types';
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

type CustomerRecipientForm = {
    label: string;
    receiverName: string;
    receiverPhone: string;
    receiverAddress: string;
    receiverCompany: string;
    notes: string;
    active: boolean;
    isDefault: boolean;
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

const DEFAULT_RECIPIENT_FORM: CustomerRecipientForm = {
    label: '',
    receiverName: '',
    receiverPhone: '',
    receiverAddress: '',
    receiverCompany: '',
    notes: '',
    active: true,
    isDefault: false,
};

export default function CustomerDetailPage() {
    const params = useParams();
    const { addToast } = useToast();
    const customerId = params.id as string;
    const [customer, setCustomer] = useState<Customer | null>(null);
    const [customerProducts, setCustomerProducts] = useState<CustomerProduct[]>([]);
    const [customerRecipients, setCustomerRecipients] = useState<CustomerRecipient[]>([]);
    const [orders, setOrders] = useState<Order[]>([]);
    const [notas, setNotas] = useState<FreightNota[]>([]);
    const [loading, setLoading] = useState(true);
    const [editing, setEditing] = useState(false);
    const [saving, setSaving] = useState(false);
    const [showProductModal, setShowProductModal] = useState(false);
    const [savingProduct, setSavingProduct] = useState(false);
    const [deletingProductId, setDeletingProductId] = useState<string | null>(null);
    const [editProduct, setEditProduct] = useState<CustomerProduct | null>(null);
    const [showRecipientModal, setShowRecipientModal] = useState(false);
    const [savingRecipient, setSavingRecipient] = useState(false);
    const [deletingRecipientId, setDeletingRecipientId] = useState<string | null>(null);
    const [editRecipient, setEditRecipient] = useState<CustomerRecipient | null>(null);
    const [form, setForm] = useState({ name: '', address: '', contactPerson: '', phone: '', email: '', npwp: '', deliveryOrderPrefix: 'SJ' });
    const [productForm, setProductForm] = useState<CustomerProductForm>(DEFAULT_PRODUCT_FORM);
    const [recipientForm, setRecipientForm] = useState<CustomerRecipientForm>(DEFAULT_RECIPIENT_FORM);

    useEffect(() => {
        const loadCustomerDetail = async () => {
            setLoading(true);
            try {
                const [cust, productRows, recipientRows, customerOrders, customerNotas] = await Promise.all([
                    fetchAdminData<Customer | null>(`/api/data?entity=customers&id=${customerId}`, 'Gagal memuat data customer'),
                    fetchAdminData<CustomerProduct[]>(`/api/data?entity=customer-products&filter=${encodeURIComponent(JSON.stringify({ customerRef: customerId }))}`, 'Gagal memuat data customer'),
                    fetchAdminData<CustomerRecipient[]>(`/api/data?entity=customer-recipients&filter=${encodeURIComponent(JSON.stringify({ customerRef: customerId }))}`, 'Gagal memuat data customer'),
                    fetchAdminData<Order[]>(`/api/data?entity=orders&filter=${encodeURIComponent(JSON.stringify({ customerRef: customerId }))}`, 'Gagal memuat data customer'),
                    fetchAdminData<FreightNota[]>(`/api/data?entity=freight-notas&filter=${encodeURIComponent(JSON.stringify({ customerRef: customerId }))}`, 'Gagal memuat data customer'),
                ]);

                setCustomer(cust);
                setCustomerProducts(productRows || []);
                setCustomerRecipients(recipientRows || []);
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

    const openNewRecipient = () => {
        setEditRecipient(null);
        setRecipientForm({ ...DEFAULT_RECIPIENT_FORM, isDefault: customerRecipients.length === 0 });
        setShowRecipientModal(true);
    };

    const openEditRecipient = (recipient: CustomerRecipient) => {
        setEditRecipient(recipient);
        setRecipientForm({
            label: recipient.label || '',
            receiverName: recipient.receiverName || '',
            receiverPhone: recipient.receiverPhone || '',
            receiverAddress: recipient.receiverAddress || '',
            receiverCompany: recipient.receiverCompany || '',
            notes: recipient.notes || '',
            active: recipient.active !== false,
            isDefault: recipient.isDefault === true,
        });
        setShowRecipientModal(true);
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

    const handleSaveRecipient = async () => {
        if (!recipientForm.label.trim() || !recipientForm.receiverName.trim() || !recipientForm.receiverAddress.trim()) {
            addToast('error', 'Label, nama penerima, dan alamat wajib diisi');
            return;
        }

        setSavingRecipient(true);
        try {
            const payload = {
                customerRef: customerId,
                ...recipientForm,
            };
            const res = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(
                    editRecipient
                        ? { entity: 'customer-recipients', action: 'update', data: { id: editRecipient._id, updates: payload } }
                        : { entity: 'customer-recipients', data: payload }
                ),
            });
            const result = await res.json();
            if (!res.ok) {
                addToast('error', result.error || 'Gagal menyimpan master penerima');
                return;
            }

            const savedRecipient = result.data as CustomerRecipient;
            setCustomerRecipients(prev => {
                const next = editRecipient
                    ? prev.map(item => item._id === editRecipient._id ? savedRecipient : item)
                    : [savedRecipient, ...prev];
                return savedRecipient.isDefault ? next.map(item => item._id === savedRecipient._id ? item : { ...item, isDefault: false }) : next;
            });
            setShowRecipientModal(false);
            addToast('success', editRecipient ? 'Master penerima diperbarui' : 'Master penerima ditambahkan');
        } catch {
            addToast('error', 'Gagal menyimpan master penerima');
        } finally {
            setSavingRecipient(false);
        }
    };

    const handleDeleteRecipient = async (recipientId: string) => {
        setDeletingRecipientId(recipientId);
        try {
            const res = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ entity: 'customer-recipients', action: 'delete', data: { id: recipientId } }),
            });
            const result = await res.json();
            if (!res.ok) {
                addToast('error', result.error || 'Gagal menghapus master penerima');
                return;
            }
            setCustomerRecipients(prev => prev.filter(item => item._id !== recipientId));
            addToast('success', 'Master penerima dihapus');
        } catch {
            addToast('error', 'Gagal menghapus master penerima');
        } finally {
            setDeletingRecipientId(null);
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
    const sortedRecipients = [...customerRecipients].sort((a, b) => {
        if (Boolean(a.isDefault) !== Boolean(b.isDefault)) {
            return a.isDefault ? -1 : 1;
        }
        return (a.label || '').localeCompare(b.label || '');
    });

    return (
        <div>
            <div className="page-header">
                <div className="page-header-left" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                    <PageBackButton href="/customers" />
                    <div>
                        <h1 className="page-title">{customer.name}</h1>
                    </div>
                </div>
                <div className="page-actions">
                    {!editing && <button className="btn btn-secondary" onClick={openNewProduct}><Plus size={16} /> Tambah Barang</button>}
                    {!editing && <button className="btn btn-primary" onClick={() => setEditing(true)}><Edit size={16} /> Edit</button>}
                </div>
            </div>

            <div style={{ display: 'grid', gap: 'var(--space-6)' }}>
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
                title={`Master Penerima (${customerRecipients.length})`}
                defaultOpen
            >
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '0.75rem' }}>
                    <button className="btn btn-primary btn-sm" onClick={openNewRecipient}>
                        <Plus size={14} /> Tambah Penerima
                    </button>
                </div>
                <div className="table-wrapper table-desktop-only">
                    <table>
                        <thead><tr><th>Label</th><th>Penerima</th><th>Status</th><th>Aksi</th></tr></thead>
                        <tbody>
                            {customerRecipients.length === 0 ? (
                                <tr><td colSpan={4} className="text-center text-muted" style={{ padding: '2rem' }}>Belum ada master penerima untuk customer ini</td></tr>
                            ) : (
                                sortedRecipients.map(recipient => (
                                    <tr key={recipient._id}>
                                        <td>
                                            <div style={{ fontWeight: 600, display: 'flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
                                                <span>{recipient.label}</span>
                                                {recipient.isDefault && <span className="badge badge-info">Default</span>}
                                            </div>
                                            {recipient.notes && (
                                                <div className="text-muted" style={{ fontSize: '0.75rem', marginTop: '0.25rem' }}>{recipient.notes}</div>
                                            )}
                                        </td>
                                        <td>
                                            <div style={{ fontWeight: 600 }}>{recipient.receiverName}</div>
                                            {recipient.receiverCompany && (
                                                <div className="text-muted" style={{ fontSize: '0.82rem', marginTop: '0.2rem' }}>{recipient.receiverCompany}</div>
                                            )}
                                            <div className="text-muted" style={{ fontSize: '0.82rem', marginTop: '0.2rem' }}>{recipient.receiverAddress}</div>
                                            {recipient.receiverPhone && (
                                                <div className="text-muted" style={{ fontSize: '0.75rem', marginTop: '0.25rem' }}>{recipient.receiverPhone}</div>
                                            )}
                                        </td>
                                        <td><span className={`badge ${recipient.active !== false ? 'badge-green' : 'badge-gray'}`}>{recipient.active !== false ? 'Aktif' : 'Nonaktif'}</span></td>
                                        <td>
                                            <div className="table-actions">
                                                <button className="table-action-btn" onClick={() => openEditRecipient(recipient)}><Edit size={14} /> Edit</button>
                                                <button className="table-action-btn danger" onClick={() => handleDeleteRecipient(recipient._id)} disabled={deletingRecipientId === recipient._id}>
                                                    <Trash2 size={14} /> {deletingRecipientId === recipient._id ? 'Menghapus...' : 'Hapus'}
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
                    {customerRecipients.length === 0 ? (
                        <div className="mobile-record-card">
                            <div className="mobile-record-title">Belum ada master penerima</div>
                            <div className="mobile-record-actions">
                                <button className="btn btn-primary" onClick={openNewRecipient}>
                                    <Plus size={16} /> Tambah Penerima
                                </button>
                            </div>
                        </div>
                    ) : sortedRecipients.map(recipient => (
                        <div key={recipient._id} className="mobile-record-card">
                            <div className="mobile-record-header">
                                <div>
                                    <div className="mobile-record-title">{recipient.label}</div>
                                    <div className="mobile-record-subtitle">{recipient.receiverName}</div>
                                </div>
                                <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                                    {recipient.isDefault && <span className="badge badge-info">Default</span>}
                                    <span className={`badge ${recipient.active !== false ? 'badge-green' : 'badge-gray'}`}>{recipient.active !== false ? 'Aktif' : 'Nonaktif'}</span>
                                </div>
                            </div>
                            <div className="mobile-record-meta">
                                <div className="mobile-record-kv">
                                    <span className="mobile-record-label">Alamat</span>
                                    <span className="mobile-record-value">{recipient.receiverAddress}</span>
                                </div>
                                <div className="mobile-record-kv">
                                    <span className="mobile-record-label">Kontak</span>
                                    <span className="mobile-record-value">{recipient.receiverCompany || recipient.receiverPhone || '-'}</span>
                                </div>
                            </div>
                            <div className="mobile-record-actions">
                                <button className="btn btn-secondary" onClick={() => openEditRecipient(recipient)}>
                                    <Edit size={14} /> Edit
                                </button>
                                <button className="btn btn-danger" onClick={() => handleDeleteRecipient(recipient._id)} disabled={deletingRecipientId === recipient._id}>
                                    <Trash2 size={14} /> {deletingRecipientId === recipient._id ? 'Menghapus...' : 'Hapus'}
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            </CollapsibleCard>

            <CollapsibleCard
                title={`Master Barang Customer (${customerProducts.length})`}
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

            <CollapsibleCard title={`Order Terbaru (${orders.length})`}>
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

            <CollapsibleCard title={`Nota Ongkos (${notas.length})`}>
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

            {showRecipientModal && (
                <div className="modal-overlay" onClick={() => { if (!savingRecipient) setShowRecipientModal(false); }}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3 className="modal-title">{editRecipient ? 'Edit Master Penerima' : 'Tambah Master Penerima'}</h3>
                            <button className="modal-close" onClick={() => setShowRecipientModal(false)} disabled={savingRecipient}><X size={20} /></button>
                        </div>
                        <div className="modal-body">
                            <div className="form-group">
                                <label className="form-label">Label Lokasi / Tujuan <span className="required">*</span></label>
                                <input className="form-input" value={recipientForm.label} onChange={e => setRecipientForm(prev => ({ ...prev, label: e.target.value }))} placeholder="Contoh: Gudang Gresik / Plant 2" />
                            </div>
                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label">Nama Penerima <span className="required">*</span></label>
                                    <input className="form-input" value={recipientForm.receiverName} onChange={e => setRecipientForm(prev => ({ ...prev, receiverName: e.target.value }))} />
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Telepon</label>
                                    <input className="form-input" value={recipientForm.receiverPhone} onChange={e => setRecipientForm(prev => ({ ...prev, receiverPhone: e.target.value }))} />
                                </div>
                            </div>
                            <div className="form-group">
                                <label className="form-label">Perusahaan Penerima</label>
                                <input className="form-input" value={recipientForm.receiverCompany} onChange={e => setRecipientForm(prev => ({ ...prev, receiverCompany: e.target.value }))} />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Alamat Penerima <span className="required">*</span></label>
                                <textarea className="form-textarea" rows={3} value={recipientForm.receiverAddress} onChange={e => setRecipientForm(prev => ({ ...prev, receiverAddress: e.target.value }))} />
                            </div>
                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label">Status</label>
                                    <select className="form-select" value={recipientForm.active ? 'ACTIVE' : 'INACTIVE'} onChange={e => setRecipientForm(prev => ({ ...prev, active: e.target.value === 'ACTIVE', isDefault: e.target.value === 'ACTIVE' ? prev.isDefault : false }))}>
                                        <option value="ACTIVE">Aktif</option>
                                        <option value="INACTIVE">Nonaktif</option>
                                    </select>
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Default</label>
                                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.65rem' }}>
                                        <input type="checkbox" checked={recipientForm.isDefault} onChange={e => setRecipientForm(prev => ({ ...prev, isDefault: e.target.checked, active: e.target.checked ? true : prev.active }))} />
                                        <span>Jadikan penerima default customer</span>
                                    </label>
                                </div>
                            </div>
                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label">Catatan</label>
                                    <input className="form-input" value={recipientForm.notes} onChange={e => setRecipientForm(prev => ({ ...prev, notes: e.target.value }))} placeholder="Opsional" />
                                </div>
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setShowRecipientModal(false)} disabled={savingRecipient}>Batal</button>
                            <button className="btn btn-primary" onClick={handleSaveRecipient} disabled={savingRecipient}><Save size={16} /> {savingRecipient ? 'Menyimpan...' : 'Simpan'}</button>
                        </div>
                    </div>
                </div>
            )}

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
