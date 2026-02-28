'use client';

import { useState, useEffect } from 'react';
import { useToast } from '../../../layout';
import { Plus, Edit, Trash2, UserCog, Save, X, RefreshCw } from 'lucide-react';
import type { User } from '@/lib/types';

export default function UsersPage() {
    const { addToast } = useToast();
    const [users, setUsers] = useState<User[]>([]);
    const [loading, setLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const [editUser, setEditUser] = useState<User | null>(null);
    const [form, setForm] = useState({ name: '', email: '', role: 'ADMIN' as 'OWNER' | 'ADMIN', password: '' });

    useEffect(() => { fetch('/api/data?entity=users').then(r => r.json()).then(d => { setUsers(d.data || []); setLoading(false); }); }, []);

    const openNew = () => { setEditUser(null); setForm({ name: '', email: '', role: 'ADMIN', password: '' }); setShowModal(true); };
    const openEdit = (u: User) => { setEditUser(u); setForm({ name: u.name, email: u.email, role: u.role, password: '' }); setShowModal(true); };

    const handleSave = async () => {
        if (!form.name || !form.email) { addToast('error', 'Nama dan email wajib'); return; }
        if (!editUser && !form.password) { addToast('error', 'Password wajib untuk user baru'); return; }
        if (editUser) {
            const updates: Record<string, unknown> = { name: form.name, email: form.email, role: form.role };
            if (form.password) updates.passwordHash = form.password;
            await fetch('/api/data', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entity: 'users', action: 'update', data: { id: editUser._id, updates } }) });
            setUsers(prev => prev.map(u => u._id === editUser._id ? { ...u, ...updates } as User : u));
            addToast('success', 'User diperbarui');
        } else {
            const res = await fetch('/api/data', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entity: 'users', data: { name: form.name, email: form.email, role: form.role, password: form.password } }) });
            const d = await res.json();
            setUsers(prev => [...prev, d.data]);
            addToast('success', 'User ditambahkan');
        }
        setShowModal(false);
    };

    const toggleActive = async (u: User) => {
        await fetch('/api/data', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entity: 'users', action: 'update', data: { id: u._id, updates: { active: !u.active } } }) });
        setUsers(prev => prev.map(x => x._id === u._id ? { ...x, active: !x.active } : x));
        addToast('success', `User ${!u.active ? 'diaktifkan' : 'dinonaktifkan'}`);
    };

    return (
        <div>
            <div className="page-header"><div className="page-header-left"><h1 className="page-title">User Management</h1><p className="page-subtitle">Kelola user internal sistem</p></div>
                <div className="page-actions"><button className="btn btn-primary" onClick={openNew}><Plus size={18} /> Tambah User</button></div></div>
            <div className="table-container">
                <div className="table-wrapper">
                    <table>
                        <thead><tr><th>Nama</th><th>Email</th><th>Role</th><th>Status</th><th>Aksi</th></tr></thead>
                        <tbody>
                            {loading ? [1, 2].map(i => <tr key={i}>{[1, 2, 3, 4, 5].map(j => <td key={j}><div className="skeleton skeleton-text" /></td>)}</tr>) :
                                users.map(u => (
                                    <tr key={u._id}>
                                        <td className="font-semibold">{u.name}</td><td>{u.email}</td>
                                        <td><span className={`badge ${u.role === 'OWNER' ? 'badge-purple' : 'badge-info'}`}>{u.role}</span></td>
                                        <td><span className={`badge ${u.active ? 'badge-success' : 'badge-gray'}`}>{u.active ? 'Aktif' : 'Non-Aktif'}</span></td>
                                        <td><div className="table-actions">
                                            <button className="table-action-btn" onClick={() => openEdit(u)}><Edit size={14} /> Edit</button>
                                            <button className="table-action-btn" onClick={() => toggleActive(u)}><RefreshCw size={14} /> {u.active ? 'Nonaktifkan' : 'Aktifkan'}</button>
                                        </div></td>
                                    </tr>
                                ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {showModal && (
                <div className="modal-overlay" onClick={() => setShowModal(false)}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header"><h3 className="modal-title">{editUser ? 'Edit User' : 'Tambah User'}</h3><button className="modal-close" onClick={() => setShowModal(false)}><X size={20} /></button></div>
                        <div className="modal-body">
                            <div className="form-group"><label className="form-label">Nama <span className="required">*</span></label><input className="form-input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
                            <div className="form-group"><label className="form-label">Email <span className="required">*</span></label><input className="form-input" type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></div>
                            <div className="form-group"><label className="form-label">Role</label>
                                <select className="form-select" value={form.role} onChange={e => setForm({ ...form, role: e.target.value as 'OWNER' | 'ADMIN' })}>
                                    <option value="ADMIN">ADMIN</option><option value="OWNER">OWNER</option>
                                </select>
                            </div>
                            <div className="form-group"><label className="form-label">{editUser ? 'Reset Password (kosongkan jika tidak diubah)' : 'Password *'}</label><input className="form-input" type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} /></div>
                        </div>
                        <div className="modal-footer"><button className="btn btn-secondary" onClick={() => setShowModal(false)}>Batal</button><button className="btn btn-primary" onClick={handleSave}><Save size={16} /> Simpan</button></div>
                    </div>
                </div>
            )}
        </div>
    );
}
