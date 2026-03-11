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
            <div className="card" style={{ maxWidth: 520 }}>
                <div className="card-body">
                    <form onSubmit={handleSubmit}>
                        <div className="form-group"><label className="form-label">Nama</label><input className="form-input" value={name} onChange={e => setName(e.target.value)} required /></div>
                        <div className="form-group"><label className="form-label">Email</label><input className="form-input" value={user?.email || ''} disabled /><div className="form-hint">Email tidak dapat diubah</div></div>
                        <div className="form-group"><label className="form-label">Role</label><input className="form-input" value={user?.role || ''} disabled /></div>
                        <button type="submit" className="btn btn-primary" disabled={loading}><Save size={16} /> {loading ? 'Menyimpan...' : 'Simpan'}</button>
                    </form>
                </div>
            </div>
        </div>
    );
}
