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
    const [saving, setSaving] = useState(false);
    const [form, setForm] = useState({ code: '', name: '', description: '', active: true });
    const isOwner = user?.role === 'OWNER';
    const activeCount = items.filter(item => item.active !== false).length;
    const inactiveCount = items.filter(item => item.active === false).length;

    useEffect(() => {
        const loadServices = async () => {
            try {
                const res = await fetch('/api/data?entity=services');
                const payload = await res.json();
                if (!res.ok) {
                    throw new Error(payload.error || 'Gagal memuat kategori armada');
                }
                setItems(payload.data || []);
            } catch (error) {
                addToast('error', error instanceof Error ? error.message : 'Gagal memuat kategori armada');
            } finally {
                setLoading(false);
            }
        };

        void loadServices();
    }, [addToast]);

    const openNew = () => { setEditItem(null); setForm({ code: '', name: '', description: '', active: true }); setShowModal(true); };
    const openEdit = (s: Service) => { setEditItem(s); setForm({ code: s.code || '', name: s.name, description: s.description, active: s.active !== false }); setShowModal(true); };

    const handleSave = async () => {
        if (!isOwner) { addToast('error', 'Hanya OWNER yang dapat mengubah kategori armada'); return; }
        if (!form.code || !form.name) { addToast('error', 'Kode dan nama kategori wajib'); return; }
        setSaving(true);
        try {
            if (editItem) {
                const res = await fetch('/api/data', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entity: 'services', action: 'update', data: { id: editItem._id, updates: form } }) });
                const payload = await res.json();
                if (!res.ok) {
                    addToast('error', payload.error || 'Gagal memperbarui kategori armada');
                    return;
                }
                setItems(prev => prev.map(s => s._id === editItem._id ? payload.data as Service : s));
                addToast('success', 'Kategori armada diperbarui');
            } else {
                const res = await fetch('/api/data', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entity: 'services', data: form }) });
                const payload = await res.json();
                if (!res.ok) {
                    addToast('error', payload.error || 'Gagal menambah kategori armada');
                    return;
                }
                setItems(prev => [...prev, payload.data as Service]); addToast('success', 'Kategori armada ditambahkan');
            }
            setShowModal(false);
        } catch {
            addToast('error', editItem ? 'Gagal memperbarui kategori armada' : 'Gagal menambah kategori armada');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div>
            <div className="page-header"><div className="page-header-left"><h1 className="page-title">Kategori Truk / Armada</h1><p className="page-subtitle">Master kategori armada yang diminta customer pada order</p></div>
                <div className="page-actions">{isOwner && <button className="btn btn-primary" onClick={openNew}><Plus size={18} /> Tambah Kategori</button>}</div></div>
            <div style={{ background: 'var(--color-gray-50)', borderRadius: '0.75rem', padding: '1rem 1.1rem', border: '1px solid var(--color-gray-200)', marginBottom: 'var(--space-6)' }}>
                <div style={{ fontWeight: 600, marginBottom: '0.35rem' }}>Cara baca halaman ini</div>
                <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                    Halaman ini adalah master kategori armada yang diminta customer saat membuat order. Data di sini jarang berubah. Setelah kategori dibuat, kendaraan dan order akan mengikuti kategori tersebut.
                </div>
            </div>
            <div className="kpi-grid" style={{ marginBottom: '1.5rem' }}>
                <div className="kpi-card"><div className="kpi-content"><div className="kpi-label">Kategori Aktif</div><div className="kpi-value">{activeCount}</div></div></div>
                <div className="kpi-card"><div className="kpi-content"><div className="kpi-label">Kategori Nonaktif</div><div className="kpi-value">{inactiveCount}</div></div></div>
                <div className="kpi-card"><div className="kpi-content"><div className="kpi-label">Hak Ubah</div><div className="kpi-value">{isOwner ? 'OWNER' : 'Read only'}</div></div></div>
            </div>
            <div className="table-container"><div className="table-wrapper"><table>
                <thead><tr><th>Kode</th><th>Nama</th><th>Deskripsi</th><th>Status</th><th>Aksi</th></tr></thead>
                <tbody>
                    {loading ? [1, 2].map(i => <tr key={i}>{[1, 2, 3, 4, 5].map(j => <td key={j}><div className="skeleton skeleton-text" /></td>)}</tr>) :
                        items.length === 0 ? <tr><td colSpan={5}><div className="empty-state"><Layers size={48} className="empty-state-icon" /><div className="empty-state-title">Belum ada kategori armada</div></div></td></tr> :
                            items.map(s => (
                                <tr key={s._id}><td className="font-mono">{s.code}</td><td className="font-semibold">{s.name}</td><td className="text-muted">{s.description}</td>
                                    <td><span className={`badge ${s.active !== false ? 'badge-success' : 'badge-gray'}`}>{s.active !== false ? 'Aktif' : 'Non-Aktif'}</span></td>
                                    <td>{isOwner ? <button className="table-action-btn" onClick={() => openEdit(s)}><Edit size={14} /> Edit</button> : <span className="text-muted">Read only</span>}</td></tr>
                            ))}
                </tbody>
            </table></div></div>
            {showModal && (
                <div className="modal-overlay" onClick={() => { if (!saving) setShowModal(false); }}><div className="modal" onClick={e => e.stopPropagation()}>
                    <div className="modal-header"><h3 className="modal-title">{editItem ? 'Edit' : 'Tambah'} Kategori Armada</h3><button className="modal-close" onClick={() => setShowModal(false)} disabled={saving}><X size={20} /></button></div>
                    <div className="modal-body">
                        <div style={{ background: 'var(--color-gray-50)', borderRadius: '0.5rem', padding: '0.75rem 1rem', marginBottom: '1rem', fontSize: '0.8rem', color: 'var(--color-gray-600)' }}>
                            Pakai kode yang stabil karena prefix ini ikut dipakai untuk kode unit kendaraan, misalnya <strong>CDD-001</strong> atau <strong>FUS-001</strong>.
                        </div>
                        <div className="form-group">
                            <label className="form-label">Kode Kategori</label>
                            <input className="form-input" value={form.code} onChange={e => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="Contoh: CDD / FUS / CDB" />
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
                                Prefix ini dipakai untuk membentuk kode unit kendaraan, misalnya `CDD-001`.
                            </div>
                        </div>
                        <div className="form-group"><label className="form-label">Nama Kategori</label><input className="form-input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Contoh: CDD Box / Fuso / Tronton" /></div>
                        <div className="form-group"><label className="form-label">Deskripsi</label><textarea className="form-textarea" rows={2} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Digunakan untuk memfilter kendaraan saat membuat surat jalan" /></div>
                        <div className="form-group"><label className="form-checkbox"><input type="checkbox" checked={form.active} onChange={e => setForm({ ...form, active: e.target.checked })} /> Aktif</label></div>
                    </div>
                    <div className="modal-footer"><button className="btn btn-secondary" onClick={() => setShowModal(false)} disabled={saving}>Batal</button><button className="btn btn-primary" onClick={handleSave} disabled={saving}><Save size={16} /> {saving ? 'Menyimpan...' : 'Simpan'}</button></div>
                </div></div>
            )}
        </div>
    );
}
