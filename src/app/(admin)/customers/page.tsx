'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useToast } from '../layout';
import { Plus, Search, Edit, Trash2, Users, Save, X, FileDown, Printer } from 'lucide-react';
import { exportToExcel } from '@/lib/export';
import { openBrandedPrint, fetchCompanyProfile } from '@/lib/print';
import type { Customer } from '@/lib/types';

export default function CustomersPage() {
    const { addToast } = useToast();
    const [items, setItems] = useState<Customer[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [showModal, setShowModal] = useState(false);
    const [saving, setSaving] = useState(false);
    const [editItem, setEditItem] = useState<Customer | null>(null);
    const [form, setForm] = useState({ name: '', address: '', contactPerson: '', phone: '', email: '', defaultPaymentTerm: 14, npwp: '', deliveryOrderPrefix: 'SJ' });
    const [deleteId, setDeleteId] = useState<string | null>(null);
    const [deletingId, setDeletingId] = useState<string | null>(null);

    useEffect(() => {
        const loadCustomers = async () => {
            try {
                const res = await fetch('/api/data?entity=customers');
                const payload = await res.json();
                if (!res.ok) {
                    throw new Error(payload.error || 'Gagal memuat customer');
                }
                setItems(payload.data || []);
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

    const openNew = () => { setEditItem(null); setForm({ name: '', address: '', contactPerson: '', phone: '', email: '', defaultPaymentTerm: 14, npwp: '', deliveryOrderPrefix: 'SJ' }); setShowModal(true); };
    const openEdit = (c: Customer) => { setEditItem(c); setForm({ name: c.name, address: c.address, contactPerson: c.contactPerson, phone: c.phone, email: c.email, defaultPaymentTerm: c.defaultPaymentTerm, npwp: c.npwp || '', deliveryOrderPrefix: c.deliveryOrderPrefix || 'SJ' }); setShowModal(true); };

    const handleSave = async () => {
        if (!form.name) { addToast('error', 'Nama customer wajib diisi'); return; }
        setSaving(true);
        try {
            if (editItem) {
                const res = await fetch('/api/data', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entity: 'customers', action: 'update', data: { id: editItem._id, updates: { ...form, active: true } } }) });
                const result = await res.json();
                if (!res.ok) { addToast('error', result.error || 'Gagal memperbarui customer'); return; }
                setItems(prev => prev.map(c => c._id === editItem._id ? { ...c, ...form } : c));
                addToast('success', 'Customer diperbarui');
            } else {
                const res = await fetch('/api/data', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entity: 'customers', data: { ...form, active: true } }) });
                const d = await res.json();
                if (!res.ok) { addToast('error', d.error || 'Gagal menambahkan customer'); return; }
                setItems(prev => [...prev, d.data]);
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
            const res = await fetch('/api/data', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entity: 'customers', action: 'delete', data: { id } }) });
            const result = await res.json();
            if (!res.ok) { addToast('error', result.error || 'Gagal menghapus customer'); setDeleteId(null); return; }
            setItems(prev => prev.filter(c => c._id !== id)); setDeleteId(null); addToast('success', 'Customer dihapus');
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
                    <p className="page-subtitle">Kelola data pelanggan</p>
                </div>
                <div className="page-actions">
                    <button className="btn btn-secondary btn-sm" onClick={() => {
                        exportToExcel(filtered as unknown as Record<string, unknown>[], [
                            { header: 'Nama', key: 'name', width: 25 },
                            { header: 'Kontak', key: 'contactPerson', width: 20 },
                            { header: 'Telepon', key: 'phone', width: 18 },
                            { header: 'Email', key: 'email', width: 25 },
                            { header: 'Alamat', key: 'address', width: 35 },
                            { header: 'Prefix SJ', key: 'deliveryOrderPrefix', width: 12 },
                        ], `customer-${new Date().toISOString().split('T')[0]}`, 'Customer');
                    }}><FileDown size={15} /> Excel</button>
                    <button className="btn btn-secondary btn-sm" onClick={async () => {
                        const co = await fetchCompanyProfile();
                        openBrandedPrint({
                            title: 'Daftar Customer', company: co, bodyHtml: `
                            <table><thead><tr><th>Nama</th><th>Kontak</th><th>Telepon</th><th>Email</th><th>Alamat</th><th>Prefix SJ</th></tr></thead>
                            <tbody>${filtered.map(c => `<tr><td class="b">${c.name}</td><td>${c.contactPerson || '-'}</td><td>${c.phone || '-'}</td><td>${c.email || '-'}</td><td>${c.address || '-'}</td><td>${c.deliveryOrderPrefix || 'SJ'}</td></tr>`).join('')}</tbody></table>`
                        });
                    }}><Printer size={15} /> Print</button>
                    <button className="btn btn-primary" onClick={openNew}><Plus size={18} /> Tambah Customer</button></div>
            </div>
            <div className="table-container">
                <div className="table-toolbar"><div className="table-toolbar-left"><div className="table-search"><Search size={16} className="table-search-icon" /><input type="text" placeholder="Cari customer, PIC, prefix SJ..." value={search} onChange={e => setSearch(e.target.value)} /></div></div></div>
                <div className="table-wrapper table-desktop-only">
                    <table>
                        <thead><tr><th>Nama</th><th>PIC</th><th>Telepon</th><th>Email</th><th>Prefix SJ</th><th>Termin</th><th>Aksi</th></tr></thead>
                        <tbody>
                            {loading ? [1, 2, 3].map(i => <tr key={i}>{[1, 2, 3, 4, 5, 6, 7].map(j => <td key={j}><div className="skeleton skeleton-text" /></td>)}</tr>) :
                                filtered.length === 0 ? <tr><td colSpan={7}><div className="empty-state"><Users size={48} className="empty-state-icon" /><div className="empty-state-title">Belum ada customer</div></div></td></tr> :
                                    filtered.map(c => (
                                        <tr key={c._id}>
                                            <td className="font-semibold"><Link href={`/customers/${c._id}`} style={{ color: 'var(--color-primary)' }}>{c.name}</Link></td><td>{c.contactPerson}</td><td>{c.phone}</td><td className="text-muted">{c.email}</td><td className="font-mono">{c.deliveryOrderPrefix || 'SJ'}</td><td>{c.defaultPaymentTerm} hari</td>
                                            <td><div className="table-actions">
                                                <button className="table-action-btn" onClick={() => openEdit(c)}><Edit size={14} /> Edit</button>
                                                <button className="table-action-btn danger" onClick={() => setDeleteId(c._id)}><Trash2 size={14} /> Hapus</button>
                                            </div></td>
                                        </tr>
                                    ))}
                        </tbody>
                    </table>
                </div>
                {!loading && (
                    <div className="mobile-record-list">
                        {filtered.length === 0 ? (
                            <div className="mobile-record-card">
                                <div className="mobile-record-title">Belum ada customer</div>
                                <div className="mobile-record-subtitle">Tambahkan customer baru untuk mulai membuat order dan surat jalan.</div>
                                <div className="mobile-record-actions">
                                    <button className="btn btn-primary" onClick={openNew}>
                                        <Plus size={16} /> Tambah Customer
                                    </button>
                                </div>
                            </div>
                        ) : filtered.map(c => (
                            <div key={c._id} className="mobile-record-card">
                                <div className="mobile-record-header">
                                    <div>
                                        <div className="mobile-record-title">{c.name}</div>
                                        <div className="mobile-record-subtitle">{c.contactPerson || '-'} • {c.phone || '-'}</div>
                                    </div>
                                    <span className="badge badge-info">{c.deliveryOrderPrefix || 'SJ'}</span>
                                </div>
                                <div className="mobile-record-meta">
                                    <div className="mobile-record-kv">
                                        <span className="mobile-record-label">Email</span>
                                        <span className="mobile-record-value">{c.email || '-'}</span>
                                    </div>
                                    <div className="mobile-record-kv">
                                        <span className="mobile-record-label">Termin</span>
                                        <span className="mobile-record-value">{c.defaultPaymentTerm} hari</span>
                                    </div>
                                </div>
                                <div className="mobile-record-actions">
                                    <Link href={`/customers/${c._id}`} className="btn btn-secondary">
                                        Detail
                                    </Link>
                                    <button className="btn btn-secondary" onClick={() => openEdit(c)}>
                                        <Edit size={14} /> Edit
                                    </button>
                                    <button className="btn btn-danger" onClick={() => setDeleteId(c._id)}>
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
                    <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
                        <div className="modal-header"><h3 className="modal-title">{editItem ? 'Edit Customer' : 'Tambah Customer'}</h3><button className="modal-close" onClick={() => setShowModal(false)} disabled={saving}><X size={20} /></button></div>
                        <div className="modal-body">
                            <div className="form-row">
                                <div className="form-group"><label className="form-label">Nama <span className="required">*</span></label><input className="form-input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
                                <div className="form-group"><label className="form-label">PIC</label><input className="form-input" value={form.contactPerson} onChange={e => setForm({ ...form, contactPerson: e.target.value })} /></div>
                            </div>
                            <div className="form-group"><label className="form-label">Alamat</label><textarea className="form-textarea" rows={2} value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} /></div>
                            <div className="form-row">
                                <div className="form-group"><label className="form-label">Telepon</label><input className="form-input" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} /></div>
                                <div className="form-group"><label className="form-label">Email</label><input className="form-input" type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></div>
                            </div>
                            <div className="form-row">
                                <div className="form-group"><label className="form-label">Termin Pembayaran (hari)</label><input className="form-input" type="number" value={form.defaultPaymentTerm} onChange={e => setForm({ ...form, defaultPaymentTerm: Number(e.target.value) })} /></div>
                                <div className="form-group"><label className="form-label">NPWP</label><input className="form-input" value={form.npwp} onChange={e => setForm({ ...form, npwp: e.target.value })} /></div>
                            </div>
                            <div className="form-group">
                                <label className="form-label">Prefix Surat Jalan Customer</label>
                                <input className="form-input" value={form.deliveryOrderPrefix} onChange={e => setForm({ ...form, deliveryOrderPrefix: e.target.value.toUpperCase() })} placeholder="Contoh: SJ / BK / ARW" />
                                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
                                    Nomor surat jalan customer akan terbentuk seperti `{form.deliveryOrderPrefix || 'SJ'}-202603-001`.
                                </div>
                            </div>
                        </div>
                        <div className="modal-footer"><button className="btn btn-secondary" onClick={() => setShowModal(false)} disabled={saving}>Batal</button><button className="btn btn-primary" onClick={handleSave} disabled={saving}><Save size={16} /> {saving ? 'Menyimpan...' : 'Simpan'}</button></div>
                    </div>
                </div>
            )}
            {deleteId && (
                <div className="modal-overlay" onClick={() => { if (!deletingId) setDeleteId(null); }}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header"><h3 className="modal-title">Konfirmasi Hapus</h3></div>
                        <div className="modal-body"><p>Apakah Anda yakin ingin menghapus customer ini?</p></div>
                        <div className="modal-footer"><button className="btn btn-secondary" onClick={() => setDeleteId(null)} disabled={deletingId === deleteId}>Batal</button><button className="btn btn-danger" onClick={() => handleDelete(deleteId!)} disabled={deletingId === deleteId}><Trash2 size={16} /> {deletingId === deleteId ? 'Menghapus...' : 'Hapus'}</button></div>
                    </div>
                </div>
            )}
        </div>
    );
}
