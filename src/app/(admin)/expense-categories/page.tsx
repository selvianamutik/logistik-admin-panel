'use client';

import { useState, useEffect } from 'react';
import { useToast } from '../layout';
import { Plus, Edit, Tags, Save, X } from 'lucide-react';
import type { ExpenseCategory } from '@/lib/types';

export default function ExpenseCategoriesPage() {
    const { addToast } = useToast();
    const [items, setItems] = useState<ExpenseCategory[]>([]);
    const [loading, setLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const [editItem, setEditItem] = useState<ExpenseCategory | null>(null);
    const [name, setName] = useState('');

    useEffect(() => { fetch('/api/data?entity=expense-categories').then(r => r.json()).then(d => { setItems(d.data || []); setLoading(false); }); }, []);

    const openNew = () => { setEditItem(null); setName(''); setShowModal(true); };
    const openEdit = (c: ExpenseCategory) => { setEditItem(c); setName(c.name); setShowModal(true); };

    const handleSave = async () => {
        if (!name) { addToast('error', 'Nama wajib'); return; }
        if (editItem) {
            await fetch('/api/data', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entity: 'expense-categories', action: 'update', data: { id: editItem._id, updates: { name } } }) });
            setItems(prev => prev.map(c => c._id === editItem._id ? { ...c, name } : c));
            addToast('success', 'Kategori diperbarui');
        } else {
            const res = await fetch('/api/data', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entity: 'expense-categories', data: { name, active: true } }) });
            const d = await res.json(); setItems(prev => [...prev, d.data]); addToast('success', 'Kategori ditambahkan');
        }
        setShowModal(false);
    };

    return (
        <div>
            <div className="page-header"><div className="page-header-left"><h1 className="page-title">Kategori Biaya</h1><p className="page-subtitle">Kelola kategori pengeluaran</p></div>
                <div className="page-actions"><button className="btn btn-primary" onClick={openNew}><Plus size={18} /> Tambah Kategori</button></div></div>
            <div className="table-container"><div className="table-wrapper"><table>
                <thead><tr><th>Nama Kategori</th><th>Status</th><th>Aksi</th></tr></thead>
                <tbody>
                    {loading ? [1, 2].map(i => <tr key={i}>{[1, 2, 3].map(j => <td key={j}><div className="skeleton skeleton-text" /></td>)}</tr>) :
                        items.length === 0 ? <tr><td colSpan={3}><div className="empty-state"><Tags size={48} className="empty-state-icon" /><div className="empty-state-title">Belum ada kategori</div></div></td></tr> :
                            items.map(c => (
                                <tr key={c._id}><td className="font-semibold">{c.name}</td>
                                    <td><span className={`badge ${c.active ? 'badge-success' : 'badge-gray'}`}>{c.active ? 'Aktif' : 'Non-Aktif'}</span></td>
                                    <td><button className="table-action-btn" onClick={() => openEdit(c)}><Edit size={14} /> Edit</button></td></tr>
                            ))}
                </tbody>
            </table></div></div>
            {showModal && (
                <div className="modal-overlay" onClick={() => setShowModal(false)}><div className="modal" onClick={e => e.stopPropagation()}>
                    <div className="modal-header"><h3 className="modal-title">{editItem ? 'Edit' : 'Tambah'} Kategori</h3><button className="modal-close" onClick={() => setShowModal(false)}><X size={20} /></button></div>
                    <div className="modal-body"><div className="form-group"><label className="form-label">Nama Kategori</label><input className="form-input" value={name} onChange={e => setName(e.target.value)} autoFocus /></div></div>
                    <div className="modal-footer"><button className="btn btn-secondary" onClick={() => setShowModal(false)}>Batal</button><button className="btn btn-primary" onClick={handleSave}><Save size={16} /> Simpan</button></div>
                </div></div>
            )}
        </div>
    );
}
