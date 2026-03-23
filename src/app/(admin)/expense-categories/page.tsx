'use client';

import { useState, useEffect } from 'react';
import { useApp, useToast } from '../layout';
import { Plus, Edit, Tags, Save, X } from 'lucide-react';
import type { ExpenseCategory } from '@/lib/types';

export default function ExpenseCategoriesPage() {
    const { user } = useApp();
    const { addToast } = useToast();
    const [items, setItems] = useState<ExpenseCategory[]>([]);
    const [loading, setLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const [editItem, setEditItem] = useState<ExpenseCategory | null>(null);
    const [saving, setSaving] = useState(false);
    const [name, setName] = useState('');
    const isOwner = user?.role === 'OWNER';
    const activeCount = items.filter(item => item.active !== false).length;
    const inactiveCount = items.filter(item => item.active === false).length;

    useEffect(() => {
        const loadCategories = async () => {
            try {
                const res = await fetch('/api/data?entity=expense-categories');
                const payload = await res.json();
                if (!res.ok) {
                    throw new Error(payload.error || 'Gagal memuat kategori biaya');
                }
                setItems(payload.data || []);
            } catch (error) {
                addToast('error', error instanceof Error ? error.message : 'Gagal memuat kategori biaya');
            } finally {
                setLoading(false);
            }
        };

        void loadCategories();
    }, [addToast]);

    const openNew = () => { setEditItem(null); setName(''); setShowModal(true); };
    const openEdit = (c: ExpenseCategory) => { setEditItem(c); setName(c.name); setShowModal(true); };

    const handleSave = async () => {
        if (!isOwner) { addToast('error', 'Hanya OWNER yang dapat mengubah kategori biaya'); return; }
        if (!name) { addToast('error', 'Nama wajib'); return; }
        setSaving(true);
        try {
            if (editItem) {
                const res = await fetch('/api/data', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entity: 'expense-categories', action: 'update', data: { id: editItem._id, updates: { name } } }) });
                const payload = await res.json();
                if (!res.ok) {
                    addToast('error', payload.error || 'Gagal memperbarui kategori biaya');
                    return;
                }
                setItems(prev => prev.map(c => c._id === editItem._id ? payload.data as ExpenseCategory : c));
                addToast('success', 'Kategori diperbarui');
            } else {
                const res = await fetch('/api/data', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entity: 'expense-categories', data: { name, active: true } }) });
                const payload = await res.json();
                if (!res.ok) {
                    addToast('error', payload.error || 'Gagal menambah kategori biaya');
                    return;
                }
                setItems(prev => [...prev, payload.data as ExpenseCategory]); addToast('success', 'Kategori ditambahkan');
            }
            setShowModal(false);
        } catch {
            addToast('error', editItem ? 'Gagal memperbarui kategori biaya' : 'Gagal menambah kategori biaya');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div>
            <div className="page-header"><div className="page-header-left"><h1 className="page-title">Kategori Biaya</h1><p className="page-subtitle">Kelola kategori pengeluaran</p></div>
                <div className="page-actions">{isOwner && <button className="btn btn-primary" onClick={openNew}><Plus size={18} /> Tambah Kategori</button>}</div></div>
            <div style={{ background: 'var(--color-gray-50)', borderRadius: '0.75rem', padding: '1rem 1.1rem', border: '1px solid var(--color-gray-200)', marginBottom: 'var(--space-6)' }}>
                <div style={{ fontWeight: 600, marginBottom: '0.35rem' }}>Cara baca halaman ini</div>
                <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                    Halaman ini adalah master kategori biaya untuk membantu pengeluaran dicatat dengan rapi. Tambahkan kategori baru hanya jika memang belum ada kategori yang cocok.
                </div>
            </div>
            <div className="kpi-grid" style={{ marginBottom: '1.5rem' }}>
                <div className="kpi-card"><div className="kpi-content"><div className="kpi-label">Kategori Aktif</div><div className="kpi-value">{activeCount}</div></div></div>
                <div className="kpi-card"><div className="kpi-content"><div className="kpi-label">Kategori Nonaktif</div><div className="kpi-value">{inactiveCount}</div></div></div>
                <div className="kpi-card"><div className="kpi-content"><div className="kpi-label">Hak Ubah</div><div className="kpi-value">{isOwner ? 'OWNER' : 'Read only'}</div></div></div>
            </div>
            <div className="table-container"><div className="table-wrapper"><table>
                <thead><tr><th>Nama Kategori</th><th>Status</th><th>Aksi</th></tr></thead>
                <tbody>
                    {loading ? [1, 2].map(i => <tr key={i}>{[1, 2, 3].map(j => <td key={j}><div className="skeleton skeleton-text" /></td>)}</tr>) :
                        items.length === 0 ? <tr><td colSpan={3}><div className="empty-state"><Tags size={48} className="empty-state-icon" /><div className="empty-state-title">Belum ada kategori</div></div></td></tr> :
                            items.map(c => (
                                <tr key={c._id}><td className="font-semibold">{c.name}</td>
                                    <td><span className={`badge ${c.active !== false ? 'badge-success' : 'badge-gray'}`}>{c.active !== false ? 'Aktif' : 'Non-Aktif'}</span></td>
                                    <td>{isOwner ? <button className="table-action-btn" onClick={() => openEdit(c)}><Edit size={14} /> Edit</button> : <span className="text-muted">Read only</span>}</td></tr>
                            ))}
                </tbody>
            </table></div></div>
            {showModal && (
                <div className="modal-overlay" onClick={() => { if (!saving) setShowModal(false); }}><div className="modal" onClick={e => e.stopPropagation()}>
                    <div className="modal-header"><h3 className="modal-title">{editItem ? 'Edit' : 'Tambah'} Kategori</h3><button className="modal-close" onClick={() => setShowModal(false)} disabled={saving}><X size={20} /></button></div>
                    <div className="modal-body">
                        <div style={{ background: 'var(--color-gray-50)', borderRadius: '0.5rem', padding: '0.75rem 1rem', marginBottom: '1rem', fontSize: '0.8rem', color: 'var(--color-gray-600)' }}>
                            Pilih nama kategori yang mudah dipahami operasional, misalnya <strong>Solar</strong>, <strong>Tol</strong>, <strong>Parkir</strong>, atau <strong>Servis Kendaraan</strong>.
                        </div>
                        <div className="form-group"><label className="form-label">Nama Kategori</label><input className="form-input" value={name} onChange={e => setName(e.target.value)} autoFocus /></div>
                    </div>
                    <div className="modal-footer"><button className="btn btn-secondary" onClick={() => setShowModal(false)} disabled={saving}>Batal</button><button className="btn btn-primary" onClick={handleSave} disabled={saving}><Save size={16} /> {saving ? 'Menyimpan...' : 'Simpan'}</button></div>
                </div></div>
            )}
        </div>
    );
}
