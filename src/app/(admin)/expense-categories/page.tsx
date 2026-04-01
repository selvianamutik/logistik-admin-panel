'use client';

import { useCallback, useEffect, useState } from 'react';
import { useApp, useToast } from '../layout';
import { Plus, Edit, Tags, Save, Trash2, X } from 'lucide-react';
import AppPagination from '@/components/AppPagination';
import { DEFAULT_PAGE_SIZE } from '@/lib/pagination';
import type { ExpenseCategory } from '@/lib/types';

export default function ExpenseCategoriesPage() {
    const { user } = useApp();
    const { addToast } = useToast();
    const [items, setItems] = useState<ExpenseCategory[]>([]);
    const [loading, setLoading] = useState(true);
    const [page, setPage] = useState(1);
    const [totalItems, setTotalItems] = useState(0);
    const [inactiveCount, setInactiveCount] = useState(0);
    const [showModal, setShowModal] = useState(false);
    const [editItem, setEditItem] = useState<ExpenseCategory | null>(null);
    const [saving, setSaving] = useState(false);
    const [deleteId, setDeleteId] = useState<string | null>(null);
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [name, setName] = useState('');
    const isOwner = user?.role === 'OWNER';
    const activeCount = totalItems - inactiveCount;

    const loadCategories = useCallback(async () => {
        setLoading(true);
        try {
            const [listRes, inactiveRes] = await Promise.all([
                fetch(`/api/data?entity=expense-categories&page=${page}&pageSize=${DEFAULT_PAGE_SIZE}&sortField=name&sortDir=asc`),
                fetch(`/api/data?entity=expense-categories&countOnly=1&filter=${encodeURIComponent(JSON.stringify({ active: false }))}`),
            ]);
            const [listPayload, inactivePayload] = await Promise.all([listRes.json(), inactiveRes.json()]);

            if (!listRes.ok) {
                throw new Error(listPayload.error || 'Gagal memuat kategori biaya');
            }
            if (!inactiveRes.ok) {
                throw new Error(inactivePayload.error || 'Gagal memuat statistik kategori biaya');
            }

            setItems(listPayload.data || []);
            setTotalItems(listPayload.meta?.total || 0);
            setInactiveCount(inactivePayload.meta?.total || 0);
        } catch (error) {
            addToast('error', error instanceof Error ? error.message : 'Gagal memuat kategori biaya');
        } finally {
            setLoading(false);
        }
    }, [addToast, page]);

    useEffect(() => {
        void loadCategories();
    }, [loadCategories]);

    const openNew = () => { setEditItem(null); setName(''); setShowModal(true); };
    const openEdit = (c: ExpenseCategory) => { setEditItem(c); setName(c.name); setShowModal(true); };

    const handleDelete = async (id: string) => {
        if (!isOwner) { addToast('error', 'Hanya OWNER yang dapat menghapus kategori biaya'); return; }
        setDeletingId(id);
        try {
            const res = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ entity: 'expense-categories', action: 'delete', data: { id } }),
            });
            const payload = await res.json();
            if (!res.ok) {
                addToast('error', payload.error || 'Gagal menghapus kategori biaya');
                setDeleteId(null);
                return;
            }
            if (page > 1 && items.length === 1) {
                setPage(current => Math.max(1, current - 1));
            } else {
                await loadCategories();
            }
            setDeleteId(null);
            addToast('success', 'Kategori biaya dihapus');
        } catch {
            addToast('error', 'Gagal menghapus kategori biaya');
            setDeleteId(null);
        } finally {
            setDeletingId(current => current === id ? null : current);
        }
    };

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
                await loadCategories();
                addToast('success', 'Kategori diperbarui');
            } else {
                const res = await fetch('/api/data', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entity: 'expense-categories', data: { name, active: true } }) });
                const payload = await res.json();
                if (!res.ok) {
                    addToast('error', payload.error || 'Gagal menambah kategori biaya');
                    return;
                }
                if (page !== 1) {
                    setPage(1);
                } else {
                    await loadCategories();
                }
                addToast('success', 'Kategori ditambahkan');
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
            <div className="page-header"><div className="page-header-left"><h1 className="page-title">Kategori Biaya</h1></div>
                <div className="page-actions">{isOwner && <button className="btn btn-primary" onClick={openNew}><Plus size={18} /> Tambah Kategori</button>}</div></div>
            <div className="kpi-grid" style={{ marginBottom: '1.5rem' }}>
                <div className="kpi-card"><div className="kpi-content"><div className="kpi-label">Kategori Aktif</div><div className="kpi-value">{activeCount}</div></div></div>
                <div className="kpi-card"><div className="kpi-content"><div className="kpi-label">Kategori Nonaktif</div><div className="kpi-value">{inactiveCount}</div></div></div>
                <div className="kpi-card"><div className="kpi-content"><div className="kpi-label">Hak Ubah</div><div className="kpi-value">{isOwner ? 'OWNER' : 'Lihat saja'}</div></div></div>
            </div>
            <div className="table-container"><div className="table-wrapper"><table>
                <thead><tr><th>Nama Kategori</th><th>Status</th><th>Aksi</th></tr></thead>
                <tbody>
                    {loading ? [1, 2].map(i => <tr key={i}>{[1, 2, 3].map(j => <td key={j}><div className="skeleton skeleton-text" /></td>)}</tr>) :
                        totalItems === 0 ? <tr><td colSpan={3}><div className="empty-state"><Tags size={48} className="empty-state-icon" /><div className="empty-state-title">Belum ada kategori</div></div></td></tr> :
                            items.map(c => (
                                <tr key={c._id}><td className="font-semibold">{c.name}</td>
                                    <td><span className={`badge ${c.active !== false ? 'badge-success' : 'badge-gray'}`}>{c.active !== false ? 'Aktif' : 'Non-Aktif'}</span></td>
                                    <td>{isOwner ? <div className="table-actions"><button className="table-action-btn" onClick={() => openEdit(c)}><Edit size={14} /> Edit</button><button className="table-action-btn danger" onClick={() => setDeleteId(c._id)}><Trash2 size={14} /> Hapus</button></div> : <span className="text-muted">Lihat saja</span>}</td></tr>
                            ))}
                </tbody>
            </table></div>
                {totalItems > 0 && (
                    <AppPagination
                        page={page}
                        pageSize={DEFAULT_PAGE_SIZE}
                        totalItems={totalItems}
                        onPageChange={setPage}
                        info={({ startIndex, endIndex, totalItems }) => (
                            <>Menampilkan {startIndex}-{endIndex} dari {totalItems} kategori biaya</>
                        )}
                    />
                )}
            </div>
            {showModal && (
                <div className="modal-overlay" onClick={() => { if (!saving) setShowModal(false); }}><div className="modal" onClick={e => e.stopPropagation()}>
                    <div className="modal-header"><h3 className="modal-title">{editItem ? 'Edit' : 'Tambah'} Kategori</h3><button className="modal-close" onClick={() => setShowModal(false)} disabled={saving}><X size={20} /></button></div>
                    <div className="modal-body">
                        <div className="form-group"><label className="form-label">Nama Kategori</label><input className="form-input" value={name} onChange={e => setName(e.target.value)} autoFocus /></div>
                    </div>
                    <div className="modal-footer"><button className="btn btn-secondary" onClick={() => setShowModal(false)} disabled={saving}>Batal</button><button className="btn btn-primary" onClick={handleSave} disabled={saving}><Save size={16} /> {saving ? 'Menyimpan...' : 'Simpan'}</button></div>
                </div></div>
            )}
            {isOwner && deleteId && (
                <div className="modal-overlay" onClick={() => { if (deletingId !== deleteId) setDeleteId(null); }}><div className="modal" onClick={e => e.stopPropagation()}>
                    <div className="modal-header"><h3 className="modal-title">Hapus Kategori Biaya?</h3></div>
                    <div className="modal-body"><p>Kategori biaya akan dihapus permanen. Jika sudah dipakai di pengeluaran, sistem akan menolak penghapusan ini.</p></div>
                    <div className="modal-footer"><button className="btn btn-secondary" onClick={() => setDeleteId(null)} disabled={deletingId === deleteId}>Batal</button><button className="btn btn-danger" onClick={() => handleDelete(deleteId)} disabled={deletingId === deleteId}><Trash2 size={16} /> {deletingId === deleteId ? 'Menghapus...' : 'Hapus'}</button></div>
                </div></div>
            )}
        </div>
    );
}
