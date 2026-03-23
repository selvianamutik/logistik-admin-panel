'use client';

import { useState } from 'react';
import { useApp, useToast } from '../../layout';
import { Save } from 'lucide-react';

export default function ProfilePage() {
    const { user, setUser } = useApp();
    const { addToast } = useToast();
    const [name, setName] = useState(user?.name || '');
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        try {
            const res = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ entity: 'users', action: 'update', data: { id: user?._id, updates: { name } } }),
            });
            const payload = await res.json();
            if (!res.ok) {
                throw new Error(payload.error || 'Gagal memperbarui profil');
            }
            if (payload.data && user) {
                setUser({ ...user, name: payload.data.name });
            }
            addToast('success', 'Profil berhasil diperbarui');
        } catch (error) {
            addToast('error', error instanceof Error ? error.message : 'Gagal memperbarui profil');
        }
        setLoading(false);
    };

    return (
        <div>
            <div className="page-header"><div className="page-header-left"><h1 className="page-title">Profil Saya</h1><p className="page-subtitle">Kelola informasi akun Anda</p></div></div>
            <div style={{ background: 'var(--color-gray-50)', borderRadius: '0.75rem', padding: '1rem 1.1rem', border: '1px solid var(--color-gray-200)', marginBottom: 'var(--space-6)', maxWidth: 520 }}>
                <div style={{ fontWeight: 600, marginBottom: '0.35rem' }}>Yang bisa diubah di halaman ini</div>
                <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                    Halaman ini hanya untuk memperbarui nama profil sendiri. Email dan role tetap dikelola dari pengaturan user oleh admin/owner.
                </div>
            </div>
            <div className="card" style={{ maxWidth: 520 }}>
                <div className="card-body">
                    <form onSubmit={handleSubmit}>
                        <div className="form-group"><label className="form-label">Nama</label><input className="form-input" value={name} onChange={e => setName(e.target.value)} required /></div>
                        <div className="form-group"><label className="form-label">Email</label><input className="form-input" value={user?.email || ''} disabled /><div className="form-hint">Dikelola dari User Management</div></div>
                        <div className="form-group"><label className="form-label">Role</label><input className="form-input" value={user?.role || ''} disabled /></div>
                        <button type="submit" className="btn btn-primary" disabled={loading}><Save size={16} /> {loading ? 'Menyimpan...' : 'Simpan'}</button>
                    </form>
                </div>
            </div>
        </div>
    );
}
