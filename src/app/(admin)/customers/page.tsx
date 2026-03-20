'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useToast } from '../layout';
import { Plus, Search, Edit, Trash2, Users, Save, X, FileDown, Printer } from 'lucide-react';

import { exportToExcel } from '@/lib/export';
import { openBrandedPrint, fetchCompanyProfile } from '@/lib/print';
import type { Customer, CustomerProduct } from '@/lib/types';

export default function CustomersPage() {
    const { addToast } = useToast();
    const [items, setItems] = useState<Customer[]>([]);
    const [customerProductCounts, setCustomerProductCounts] = useState<Record<string, number>>({});
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [showModal, setShowModal] = useState(false);
    const [saving, setSaving] = useState(false);
    const [editItem, setEditItem] = useState<Customer | null>(null);
    const [form, setForm] = useState({ name: '', address: '', contactPerson: '', phone: '', email: '', defaultPaymentTerm: 14, npwp: '', deliveryOrderPrefix: 'SJ' });
    const [deleteId, setDeleteId] = useState<string | null>(null);
    const [deletingId, setDeletingId] = useState<string | null>(null);

    useEffect(() => {
        const fetchEntity = async <T,>(url: string) => {
            const res = await fetch(url);
            const payload = await res.json();
            if (!res.ok) {
                throw new Error(payload.error || 'Gagal memuat customer');
            }
            return payload.data as T;
        };

        const loadCustomers = async () => {
            try {
                const [customers, products] = await Promise.all([
                    fetchEntity<Customer[]>('/api/data?entity=customers'),
                    fetchEntity<CustomerProduct[]>('/api/data?entity=customer-products'),
                ]);
                setItems(customers || []);
                setCustomerProductCounts(
                    (products || []).reduce<Record<string, number>>((acc, product) => {
                        if (!product.customerRef) return acc;
                        acc[product.customerRef] = (acc[product.customerRef] || 0) + 1;
                        return acc;
                    }, {})
                );
            } catch (error) {
                addToast('error', error instanceof Error ? error.message : 'Gagal memuat customer');
            } finally {
                setLoading(false);
            }
        };

        void loadCustomers();
    }, [addToast]);

    const filtered = items.filter(c =>
        !search ||
        c.name?.toLowerCase().includes(search.toLowerCase()) ||
        c.contactPerson?.toLowerCase().includes(search.toLowerCase()) ||
        c.deliveryOrderPrefix?.toLowerCase().includes(search.toLowerCase())
    );

    const openNew = () => {
        setEditItem(null);
        setForm({ name: '', address: '', contactPerson: '', phone: '', email: '', defaultPaymentTerm: 14, npwp: '', deliveryOrderPrefix: 'SJ' });
        setShowModal(true);
    };

    const openEdit = (customer: Customer) => {
        setEditItem(customer);
        setForm({
            name: customer.name,
            address: customer.address,
            contactPerson: customer.contactPerson,
            phone: customer.phone,
            email: customer.email,
            defaultPaymentTerm: customer.defaultPaymentTerm,
            npwp: customer.npwp || '',
            deliveryOrderPrefix: customer.deliveryOrderPrefix || 'SJ',
        });
        setShowModal(true);
    };

    const handleSave = async () => {
        if (!form.name) {
            addToast('error', 'Nama customer wajib diisi');
            return;
        }

        setSaving(true);
        try {
            if (editItem) {
                const res = await fetch('/api/data', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        entity: 'customers',
                        action: 'update',
                        data: { id: editItem._id, updates: { ...form, active: true } },
                    }),
                });
                const result = await res.json();
                if (!res.ok) {
                    addToast('error', result.error || 'Gagal memperbarui customer');
                    return;
                }
                setItems(prev => prev.map(customer => customer._id === editItem._id ? { ...customer, ...form } : customer));
                addToast('success', 'Customer diperbarui');
            } else {
                const res = await fetch('/api/data', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ entity: 'customers', data: { ...form, active: true } }),
                });
                const result = await res.json();
                if (!res.ok) {
                    addToast('error', result.error || 'Gagal menambahkan customer');
                    return;
                }
                setItems(prev => [...prev, result.data]);
                addToast('success', 'Customer ditambahkan');
            }
            setShowModal(false);
        } catch {
            addToast('error', editItem ? 'Gagal memperbarui customer' : 'Gagal menambahkan customer');
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (id: string) => {
        setDeletingId(id);
        try {
            const res = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ entity: 'customers', action: 'delete', data: { id } }),
            });
            const result = await res.json();
            if (!res.ok) {
                addToast('error', result.error || 'Gagal menghapus customer');
                setDeleteId(null);
                return;
            }
            setItems(prev => prev.filter(customer => customer._id !== id));
            setDeleteId(null);
            addToast('success', 'Customer dihapus');
        } catch {
            addToast('error', 'Gagal menghapus customer');
            setDeleteId(null);
        } finally {
            setDeletingId(current => current === id ? null : current);
        }
    };

    return (
        <div>
            <div className="page-header">
                <div className="page-header-left">
                    <h1 className="page-title">Customer</h1>
                    <p className="page-subtitle">Kelola pelanggan, prefix surat jalan, dan master barang per customer</p>
                </div>
                <div className="page-actions">
                    <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => {
                            exportToExcel(filtered as unknown as Record<string, unknown>[], [
                                { header: 'Nama', key: 'name', width: 25 },
                                { header: 'Kontak', key: 'contactPerson', width: 20 },
                                { header: 'Telepon', key: 'phone', width: 18 },
                                { header: 'Email', key: 'email', width: 25 },
                                { header: 'Alamat', key: 'address', width: 35 },
                                { header: 'Prefix SJ', key: 'deliveryOrderPrefix', width: 12 },
                            ], `customer-${new Date().toISOString().split('T')[0]}`, 'Customer');
                        }}
                    >
                        <FileDown size={15} /> Excel
                    </button>
                    <button
                        className="btn btn-secondary btn-sm"
                        onClick={async () => {
                            const company = await fetchCompanyProfile();
                            openBrandedPrint({
                                title: 'Daftar Customer',
                                company,
                                bodyHtml: `
                                <table>
                                    <thead>
                                        <tr>
                                            <th>Nama</th>
                                            <th>Kontak</th>
                                            <th>Telepon</th>
                                            <th>Email</th>
                                            <th>Alamat</th>
                                            <th>Prefix SJ</th>
                                            <th>Master Barang</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        ${filtered.map(customer => `<tr>
                                            <td class="b">${customer.name}</td>
                                            <td>${customer.contactPerson || '-'}</td>
                                            <td>${customer.phone || '-'}</td>
                                            <td>${customer.email || '-'}</td>
                                            <td>${customer.address || '-'}</td>
                                            <td>${customer.deliveryOrderPrefix || 'SJ'}</td>
                                            <td>${customerProductCounts[customer._id] || 0} barang</td>
                                        </tr>`).join('')}
                                    </tbody>
                                </table>`,
                            });
                        }}
                    >
                        <Printer size={15} /> Print
                    </button>
                    <button className="btn btn-primary" onClick={openNew}>
                        <Plus size={18} /> Tambah Customer
                    </button>
                </div>
            </div>

            <div className="table-container">
                <div className="table-toolbar">
                    <div className="table-toolbar-left">
                        <div className="table-search">
                            <Search size={16} className="table-search-icon" />
                            <input type="text" placeholder="Cari customer, PIC, prefix SJ..." value={search} onChange={event => setSearch(event.target.value)} />
                        </div>
                    </div>
                </div>

                <div className="table-wrapper table-desktop-only">
                    <table>
                        <thead>
                            <tr>
                                <th>Nama</th>
                                <th>PIC</th>
                                <th>Telepon</th>
                                <th>Email</th>
                                <th>Prefix SJ</th>
                                <th>Master Barang</th>
                                <th>Termin</th>
                                <th>Aksi</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                [1, 2, 3].map(i => (
                                    <tr key={i}>
                                        {[1, 2, 3, 4, 5, 6, 7, 8].map(j => (
                                            <td key={j}><div className="skeleton skeleton-text" /></td>
                                        ))}
                                    </tr>
                                ))
                            ) : filtered.length === 0 ? (
                                <tr>
                                    <td colSpan={8}>
                                        <div className="empty-state">
                                            <Users size={48} className="empty-state-icon" />
                                            <div className="empty-state-title">Belum ada customer</div>
                                        </div>
                                    </td>
                                </tr>
                            ) : (
                                filtered.map(customer => (
                                    <tr key={customer._id}>
                                        <td className="font-semibold">
                                            <Link href={`/customers/${customer._id}`} style={{ color: 'var(--color-primary)' }}>
                                                {customer.name}
                                            </Link>
                                        </td>
                                        <td>{customer.contactPerson}</td>
                                        <td>{customer.phone}</td>
                                        <td className="text-muted">{customer.email}</td>
                                        <td className="font-mono">{customer.deliveryOrderPrefix || 'SJ'}</td>
                                        <td><span className="badge badge-info">{customerProductCounts[customer._id] || 0} barang</span></td>
                                        <td>{customer.defaultPaymentTerm} hari</td>
                                        <td>
                                            <div className="table-actions">
                                                <Link href={`/customers/${customer._id}`} className="table-action-btn">Detail</Link>
                                                <button className="table-action-btn" onClick={() => openEdit(customer)}><Edit size={14} /> Edit</button>
                                                <button className="table-action-btn danger" onClick={() => setDeleteId(customer._id)}><Trash2 size={14} /> Hapus</button>
                                            </div>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>

                {!loading && (
                    <div className="mobile-record-list">
                        {filtered.length === 0 ? (
                            <div className="mobile-record-card">
                                <div className="mobile-record-title">Belum ada customer</div>
                                <div className="mobile-record-subtitle">Tambahkan customer baru untuk mulai membuat order, surat jalan, dan master barang khusus customer.</div>
                                <div className="mobile-record-actions">
                                    <button className="btn btn-primary" onClick={openNew}>
                                        <Plus size={16} /> Tambah Customer
                                    </button>
                                </div>
                            </div>
                        ) : filtered.map(customer => (
                            <div key={customer._id} className="mobile-record-card">
                                <div className="mobile-record-header">
                                    <div>
                                        <div className="mobile-record-title">{customer.name}</div>
                                        <div className="mobile-record-subtitle">{customer.contactPerson || '-'} | {customer.phone || '-'}</div>
                                    </div>
                                    <span className="badge badge-info">{customer.deliveryOrderPrefix || 'SJ'}</span>
                                </div>
                                <div className="mobile-record-meta">
                                    <div className="mobile-record-kv">
                                        <span className="mobile-record-label">Email</span>
                                        <span className="mobile-record-value">{customer.email || '-'}</span>
                                    </div>
                                    <div className="mobile-record-kv">
                                        <span className="mobile-record-label">Master Barang</span>
                                        <span className="mobile-record-value">{customerProductCounts[customer._id] || 0} barang</span>
                                    </div>
                                    <div className="mobile-record-kv">
                                        <span className="mobile-record-label">Termin</span>
                                        <span className="mobile-record-value">{customer.defaultPaymentTerm} hari</span>
                                    </div>
                                </div>
                                <div className="mobile-record-actions">
                                    <Link href={`/customers/${customer._id}`} className="btn btn-secondary">Detail & Barang</Link>
                                    <button className="btn btn-secondary" onClick={() => openEdit(customer)}>
                                        <Edit size={14} /> Edit
                                    </button>
                                    <button className="btn btn-danger" onClick={() => setDeleteId(customer._id)}>
                                        <Trash2 size={14} /> Hapus
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {showModal && (
                <div className="modal-overlay" onClick={() => { if (!saving) setShowModal(false); }}>
                    <div className="modal modal-lg" onClick={event => event.stopPropagation()}>
                        <div className="modal-header">
                            <h3 className="modal-title">{editItem ? 'Edit Customer' : 'Tambah Customer'}</h3>
                            <button className="modal-close" onClick={() => setShowModal(false)} disabled={saving}><X size={20} /></button>
                        </div>
                        <div className="modal-body">
                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label">Nama <span className="required">*</span></label>
                                    <input className="form-input" value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} />
                                </div>
                                <div className="form-group">
                                    <label className="form-label">PIC</label>
                                    <input className="form-input" value={form.contactPerson} onChange={event => setForm({ ...form, contactPerson: event.target.value })} />
                                </div>
                            </div>
                            <div className="form-group">
                                <label className="form-label">Alamat</label>
                                <textarea className="form-textarea" rows={2} value={form.address} onChange={event => setForm({ ...form, address: event.target.value })} />
                            </div>
                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label">Telepon</label>
                                    <input className="form-input" value={form.phone} onChange={event => setForm({ ...form, phone: event.target.value })} />
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Email</label>
                                    <input className="form-input" type="email" value={form.email} onChange={event => setForm({ ...form, email: event.target.value })} />
                                </div>
                            </div>
                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label">Termin Pembayaran (hari)</label>
                                    <input className="form-input" type="number" value={form.defaultPaymentTerm} onChange={event => setForm({ ...form, defaultPaymentTerm: Number(event.target.value) })} />
                                </div>
                                <div className="form-group">
                                    <label className="form-label">NPWP</label>
                                    <input className="form-input" value={form.npwp} onChange={event => setForm({ ...form, npwp: event.target.value })} />
                                </div>
                            </div>
                            <div className="form-group">
                                <label className="form-label">Prefix Surat Jalan Customer</label>
                                <input className="form-input" value={form.deliveryOrderPrefix} onChange={event => setForm({ ...form, deliveryOrderPrefix: event.target.value.toUpperCase() })} placeholder="Contoh: SJ / BK / ARW" />
                                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
                                    Nomor surat jalan customer akan terbentuk seperti `{form.deliveryOrderPrefix || 'SJ'}-202603-001`.
                                </div>
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setShowModal(false)} disabled={saving}>Batal</button>
                            <button className="btn btn-primary" onClick={handleSave} disabled={saving}><Save size={16} /> {saving ? 'Menyimpan...' : 'Simpan'}</button>
                        </div>
                    </div>
                </div>
            )}

            {deleteId && (
                <div className="modal-overlay" onClick={() => { if (!deletingId) setDeleteId(null); }}>
                    <div className="modal" onClick={event => event.stopPropagation()}>
                        <div className="modal-header"><h3 className="modal-title">Konfirmasi Hapus</h3></div>
                        <div className="modal-body"><p>Apakah Anda yakin ingin menghapus customer ini?</p></div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setDeleteId(null)} disabled={deletingId === deleteId}>Batal</button>
                            <button className="btn btn-danger" onClick={() => handleDelete(deleteId)} disabled={deletingId === deleteId}>
                                <Trash2 size={16} /> {deletingId === deleteId ? 'Menghapus...' : 'Hapus'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
