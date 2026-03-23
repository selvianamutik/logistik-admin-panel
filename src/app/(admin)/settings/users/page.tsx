'use client';

import { useState, useEffect } from 'react';
import { useToast } from '../../layout';
import { Plus, Edit, Save, X, RefreshCw } from 'lucide-react';
import type { User } from '@/lib/types';
import { INTERNAL_USER_ROLE_OPTIONS, type InternalUserRole } from '@/lib/rbac';

type InternalUser = User & { role: InternalUserRole };

const getUserNextAction = (user: InternalUser) => {
    if (user.active === false) return 'Aktifkan bila user dipakai lagi';
    if (user.role === 'OWNER') return 'Pastikan akun owner tetap aman';
    if (user.role === 'FINANCE') return 'Siap dipakai tim finance';
    if (user.role === 'ARMADA') return 'Siap dipakai tim armada';
    return 'Siap dipakai tim operasional';
};

const ROLE_LABELS: Record<InternalUserRole, string> = {
    OWNER: 'OWNER',
    OPERASIONAL: 'OPERASIONAL',
    FINANCE: 'FINANCE',
    ARMADA: 'ARMADA',
};

export default function UsersPage() {
    const { addToast } = useToast();
    const [users, setUsers] = useState<InternalUser[]>([]);
    const [loading, setLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const [editUser, setEditUser] = useState<InternalUser | null>(null);
    const [saving, setSaving] = useState(false);
    const [togglingUserId, setTogglingUserId] = useState<string | null>(null);
    const [form, setForm] = useState({ name: '', email: '', role: 'OPERASIONAL' as InternalUserRole, password: '' });
    const activeUsers = users.filter(user => user.active !== false).length;
    const inactiveUsers = users.filter(user => user.active === false).length;
    const ownerUsers = users.filter(user => user.role === 'OWNER').length;
    const operationalUsers = users.filter(user => user.role === 'OPERASIONAL').length;
    const financeUsers = users.filter(user => user.role === 'FINANCE').length;
    const armadaUsers = users.filter(user => user.role === 'ARMADA').length;

    useEffect(() => {
        const loadUsers = async () => {
            try {
                const res = await fetch('/api/data?entity=users');
                const payload = await res.json();
                if (!res.ok) {
                    throw new Error(payload.error || 'Gagal memuat data user');
                }
                setUsers((payload.data || []).filter((item: User): item is InternalUser => item.role !== 'DRIVER'));
            } catch (error) {
                addToast('error', error instanceof Error ? error.message : 'Gagal memuat data user');
            } finally {
                setLoading(false);
            }
        };

        void loadUsers();
    }, [addToast]);

    const openNew = () => { setEditUser(null); setForm({ name: '', email: '', role: 'OPERASIONAL', password: '' }); setShowModal(true); };
    const openEdit = (u: InternalUser) => { setEditUser(u); setForm({ name: u.name, email: u.email, role: u.role, password: '' }); setShowModal(true); };

    const handleSave = async () => {
        if (!form.name || !form.email) { addToast('error', 'Nama dan email wajib'); return; }
        if (!editUser && !form.password) { addToast('error', 'Password wajib untuk user baru'); return; }
        if (form.password && form.password.length < 8) { addToast('error', 'Password minimal 8 karakter'); return; }
        setSaving(true);
        try {
            if (editUser) {
                const updates: Record<string, unknown> = { name: form.name, email: form.email, role: form.role };
                if (form.password) updates.password = form.password;
                const res = await fetch('/api/data', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ entity: 'users', action: 'update', data: { id: editUser._id, updates } }),
                });
                const payload = await res.json();
                if (!res.ok) {
                    addToast('error', payload.error || 'Gagal memperbarui user');
                    return;
                }
                setUsers(prev => prev.map(u => u._id === editUser._id ? payload.data as InternalUser : u));
                addToast('success', 'User diperbarui');
            } else {
                const res = await fetch('/api/data', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ entity: 'users', data: { name: form.name, email: form.email, role: form.role, password: form.password } }),
                });
                const payload = await res.json();
                if (!res.ok) {
                    addToast('error', payload.error || 'Gagal menambah user');
                    return;
                }
                setUsers(prev => [...prev, payload.data as InternalUser]);
                addToast('success', 'User ditambahkan');
            }
            setShowModal(false);
        } catch {
            addToast('error', editUser ? 'Gagal memperbarui user' : 'Gagal menambah user');
        } finally {
            setSaving(false);
        }
    };

    const toggleActive = async (u: User) => {
        const currentlyActive = u.active !== false;
        setTogglingUserId(u._id);
        try {
            const res = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ entity: 'users', action: 'update', data: { id: u._id, updates: { active: !currentlyActive } } }),
            });
            const payload = await res.json();
            if (!res.ok) {
                addToast('error', payload.error || 'Gagal memperbarui status user');
                return;
            }
            setUsers(prev => prev.map(x => x._id === u._id ? payload.data as InternalUser : x));
            addToast('success', `User ${currentlyActive ? 'dinonaktifkan' : 'diaktifkan'}`);
        } catch {
            addToast('error', 'Gagal memperbarui status user');
        } finally {
            setTogglingUserId(current => current === u._id ? null : current);
        }
    };

    return (
        <div>
            <div className="page-header"><div className="page-header-left"><h1 className="page-title">User Management</h1><p className="page-subtitle">Kelola user internal sistem</p></div>
                <div className="page-actions"><button className="btn btn-primary" onClick={openNew}><Plus size={18} /> Tambah User</button></div></div>

            <div className="kpi-grid" style={{ marginBottom: '1.5rem' }}>
                <div className="kpi-card"><div className="kpi-content"><div className="kpi-label">User Aktif</div><div className="kpi-value">{activeUsers}</div></div></div>
                <div className="kpi-card"><div className="kpi-content"><div className="kpi-label">User Nonaktif</div><div className="kpi-value">{inactiveUsers}</div></div></div>
                <div className="kpi-card"><div className="kpi-content"><div className="kpi-label">Owner</div><div className="kpi-value">{ownerUsers}</div></div></div>
                <div className="kpi-card"><div className="kpi-content"><div className="kpi-label">Operasional</div><div className="kpi-value">{operationalUsers}</div></div></div>
                <div className="kpi-card"><div className="kpi-content"><div className="kpi-label">Finance</div><div className="kpi-value">{financeUsers}</div></div></div>
                <div className="kpi-card"><div className="kpi-content"><div className="kpi-label">Armada</div><div className="kpi-value">{armadaUsers}</div></div></div>
            </div>

            <div className="table-container">
                <div className="table-wrapper table-desktop-only">
                    <table>
                        <thead><tr><th>Nama</th><th>Email</th><th>Role</th><th>Status</th><th>Tindak Lanjut</th><th>Aksi</th></tr></thead>
                        <tbody suppressHydrationWarning>
                            {loading ? [1, 2].map(i => <tr key={i}>{[1, 2, 3, 4, 5, 6].map(j => <td key={j}><div className="skeleton skeleton-text" /></td>)}</tr>) :
                                users.map(u => (
                                    <tr key={u._id}>
                                        <td className="font-semibold">{u.name}</td><td>{u.email}</td>
                                        <td><span className={`badge ${u.role === 'OWNER' ? 'badge-purple' : 'badge-info'}`}>{ROLE_LABELS[u.role]}</span></td>
                                        <td><span className={`badge ${u.active !== false ? 'badge-success' : 'badge-gray'}`}>{u.active !== false ? 'Aktif' : 'Non-Aktif'}</span></td>
                                        <td>{getUserNextAction(u)}</td>
                                        <td><div className="table-actions">
                                            <button className="table-action-btn" onClick={() => openEdit(u)} disabled={togglingUserId === u._id}><Edit size={14} /> Edit</button>
                                            <button className="table-action-btn" onClick={() => toggleActive(u)} disabled={togglingUserId === u._id}><RefreshCw size={14} /> {togglingUserId === u._id ? 'Menyimpan...' : (u.active !== false ? 'Nonaktifkan' : 'Aktifkan')}</button>
                                        </div></td>
                                    </tr>
                                ))}
                        </tbody>
                    </table>
                </div>
                {!loading && (
                    <div className="mobile-record-list">
                        {users.length === 0 ? (
                            <div className="mobile-record-card">
                                <div className="mobile-record-title">Belum ada user internal</div>
                                <div className="mobile-record-subtitle">Tambahkan user admin atau owner baru untuk akses internal sistem.</div>
                            </div>
                        ) : users.map(u => (
                            <div key={u._id} className="mobile-record-card">
                                <div className="mobile-record-header">
                                    <div>
                                        <div className="mobile-record-title">{u.name}</div>
                                        <div className="mobile-record-subtitle">{u.email}</div>
                                    </div>
                                    <span className={`badge ${u.active !== false ? 'badge-success' : 'badge-gray'}`}>{u.active !== false ? 'Aktif' : 'Non-Aktif'}</span>
                                </div>
                                <div className="mobile-record-meta">
                                    <div className="mobile-record-kv">
                                        <span className="mobile-record-label">Role</span>
                                        <span className="mobile-record-value">{ROLE_LABELS[u.role]}</span>
                                    </div>
                                    <div className="mobile-record-kv">
                                        <span className="mobile-record-label">Tindak Lanjut</span>
                                        <span className="mobile-record-value">{getUserNextAction(u)}</span>
                                    </div>
                                </div>
                                <div className="mobile-record-actions">
                                    <button className="btn btn-secondary" onClick={() => openEdit(u)} disabled={togglingUserId === u._id}>
                                        <Edit size={14} /> Edit
                                    </button>
                                    <button className="btn btn-secondary" onClick={() => toggleActive(u)} disabled={togglingUserId === u._id}>
                                        <RefreshCw size={14} /> {togglingUserId === u._id ? 'Menyimpan...' : (u.active !== false ? 'Nonaktifkan' : 'Aktifkan')}
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {showModal && (
                <div className="modal-overlay" onClick={() => { if (!saving) setShowModal(false); }}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header"><h3 className="modal-title">{editUser ? 'Edit User' : 'Tambah User'}</h3><button className="modal-close" onClick={() => setShowModal(false)} disabled={saving}><X size={20} /></button></div>
                        <div className="modal-body">
                            <div className="form-group"><label className="form-label">Nama <span className="required">*</span></label><input className="form-input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
                            <div className="form-group"><label className="form-label">Email <span className="required">*</span></label><input className="form-input" type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></div>
                            <div className="form-group"><label className="form-label">Role</label>
                                <select className="form-select" value={form.role} onChange={e => setForm({ ...form, role: e.target.value as InternalUserRole })}>
                                    {INTERNAL_USER_ROLE_OPTIONS.map(role => (
                                        <option key={role} value={role}>{ROLE_LABELS[role]}</option>
                                    ))}
                                </select>
                            </div>
                            <div className="form-group"><label className="form-label">{editUser ? 'Reset Password (kosongkan jika tidak diubah)' : 'Password *'}</label><input className="form-input" type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} /><div className="form-hint">Minimal 8 karakter</div></div>
                        </div>
                        <div className="modal-footer"><button className="btn btn-secondary" onClick={() => setShowModal(false)} disabled={saving}>Batal</button><button className="btn btn-primary" onClick={handleSave} disabled={saving}><Save size={16} /> {saving ? 'Menyimpan...' : 'Simpan'}</button></div>
                    </div>
                </div>
            )}
        </div>
    );
}
