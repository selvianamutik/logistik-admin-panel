'use client';

import { useState, useEffect } from 'react';
import { useApp, useToast } from '../layout';
import { Plus, Edit, Layers, Save, X } from 'lucide-react';
import type { Service } from '@/lib/types';

export default function ServicesPage() {
    const { user } = useApp();
    const { addToast } = useToast();
    const [items, setItems] = useState<Service[]>([]);
    const [loading, setLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const [editItem, setEditItem] = useState<Service | null>(null);
    const [form, setForm] = useState({ name: '', description: '', active: true });
    const isOwner = user?.role === 'OWNER';

    useEffect(() => {
        const loadServices = async () => {
            try {
                const res = await fetch('/api/data?entity=services');
                const payload = await res.json();
                if (!res.ok) {
                    throw new Error(payload.error || 'Gagal memuat layanan');
                }
                setItems(payload.data || []);
            } catch (error) {
                addToast('error', error instanceof Error ? error.message : 'Gagal memuat layanan');
            } finally {
                setLoading(false);
            }
        };

        void loadServices();
    }, [addToast]);

    const openNew = () => { setEditItem(null); setForm({ name: '', description: '', active: true }); setShowModal(true); };
    const openEdit = (s: Service) => { setEditItem(s); setForm({ name: s.name, description: s.description, active: s.active }); setShowModal(true); };

    const handleSave = async () => {
        if (!isOwner) { addToast('error', 'Hanya OWNER yang dapat mengubah layanan'); return; }
        if (!form.name) { addToast('error', 'Nama wajib'); return; }
        if (editItem) {
            const res = await fetch('/api/data', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entity: 'services', action: 'update', data: { id: editItem._id, updates: form } }) });
            const payload = await res.json();
            if (!res.ok) {
                addToast('error', payload.error || 'Gagal memperbarui layanan');
                return;
            }
            setItems(prev => prev.map(s => s._id === editItem._id ? payload.data as Service : s));
            addToast('success', 'Layanan diperbarui');
        } else {
            const res = await fetch('/api/data', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entity: 'services', data: form }) });
            const payload = await res.json();
            if (!res.ok) {
                addToast('error', payload.error || 'Gagal menambah layanan');
                return;
            }
            setItems(prev => [...prev, payload.data as Service]); addToast('success', 'Layanan ditambahkan');
        }
        setShowModal(false);
    };

    return (
        <div>
            <div className="page-header"><div className="page-header-left"><h1 className="page-title">Layanan</h1><p className="page-subtitle">Jenis layanan pengiriman</p></div>
                <div className="page-actions">{isOwner && <button className="btn btn-primary" onClick={openNew}><Plus size={18} /> Tambah Layanan</button>}</div></div>
            <div className="table-container"><div className="table-wrapper"><table>
                <thead><tr><th>Nama</th><th>Deskripsi</th><th>Status</th><th>Aksi</th></tr></thead>
                <tbody>
                    {loading ? [1, 2].map(i => <tr key={i}>{[1, 2, 3, 4].map(j => <td key={j}><div className="skeleton skeleton-text" /></td>)}</tr>) :
                        items.length === 0 ? <tr><td colSpan={4}><div className="empty-state"><Layers size={48} className="empty-state-icon" /><div className="empty-state-title">Belum ada layanan</div></div></td></tr> :
                            items.map(s => (
                                <tr key={s._id}><td className="font-semibold">{s.name}</td><td className="text-muted">{s.description}</td>
                                    <td><span className={`badge ${s.active ? 'badge-success' : 'badge-gray'}`}>{s.active ? 'Aktif' : 'Non-Aktif'}</span></td>
                                    <td>{isOwner ? <button className="table-action-btn" onClick={() => openEdit(s)}><Edit size={14} /> Edit</button> : <span className="text-muted">Read only</span>}</td></tr>
                            ))}
                </tbody>
            </table></div></div>
            {showModal && (
                <div className="modal-overlay" onClick={() => setShowModal(false)}><div className="modal" onClick={e => e.stopPropagation()}>
                    <div className="modal-header"><h3 className="modal-title">{editItem ? 'Edit' : 'Tambah'} Layanan</h3><button className="modal-close" onClick={() => setShowModal(false)}><X size={20} /></button></div>
                    <div className="modal-body">
                        <div className="form-group"><label className="form-label">Nama</label><input className="form-input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
                        <div className="form-group"><label className="form-label">Deskripsi</label><textarea className="form-textarea" rows={2} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></div>
                        <div className="form-group"><label className="form-checkbox"><input type="checkbox" checked={form.active} onChange={e => setForm({ ...form, active: e.target.checked })} /> Aktif</label></div>
                    </div>
                    <div className="modal-footer"><button className="btn btn-secondary" onClick={() => setShowModal(false)}>Batal</button><button className="btn btn-primary" onClick={handleSave}><Save size={16} /> Simpan</button></div>
                </div></div>
            )}
        </div>
    );
}
