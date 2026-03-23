'use client';

import { useState } from 'react';
import { useToast, useApp } from '../../layout';
import { Lock } from 'lucide-react';

export default function PasswordPage() {
    const { addToast } = useToast();
    const { user } = useApp();
    const [currentPw, setCurrentPw] = useState('');
    const [newPw, setNewPw] = useState('');
    const [confirmPw, setConfirmPw] = useState('');
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (newPw.length < 8) { addToast('error', 'Password minimal 8 karakter'); return; }
        if (newPw !== confirmPw) { addToast('error', 'Konfirmasi password tidak cocok'); return; }
        setLoading(true);
        try {
            const res = await fetch('/api/data', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    entity: 'users',
                    action: 'update',
                    data: {
                        id: user?._id,
                        currentPassword: currentPw,
                        updates: { password: newPw },
                    }
                }),
            });
            const payload = await res.json();
            if (!res.ok) {
                throw new Error(payload.error || 'Gagal mengubah password');
            }
            addToast('success', 'Password berhasil diubah');
            setCurrentPw(''); setNewPw(''); setConfirmPw('');
        } catch (error) { addToast('error', error instanceof Error ? error.message : 'Gagal mengubah password'); }
        setLoading(false);
    };

    return (
        <div>
            <div className="page-header"><div className="page-header-left"><h1 className="page-title">Ubah Password</h1><p className="page-subtitle">Perbarui password akun Anda</p></div></div>
            <div style={{ background: 'var(--color-gray-50)', borderRadius: '0.75rem', padding: '1rem 1.1rem', border: '1px solid var(--color-gray-200)', marginBottom: 'var(--space-6)', maxWidth: 520 }}>
                <div style={{ fontWeight: 600, marginBottom: '0.35rem' }}>Kapan halaman ini dipakai</div>
                <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                    Gunakan halaman ini jika kamu memang ingin mengganti password akunmu sendiri. Untuk reset akun user lain, gunakan <strong>User Management</strong>.
                </div>
            </div>
            <div className="card" style={{ maxWidth: 520 }}>
                <div className="card-body">
                    <form onSubmit={handleSubmit}>
                        <div className="form-group"><label className="form-label">Password Saat Ini</label><input type="password" className="form-input" value={currentPw} onChange={e => setCurrentPw(e.target.value)} required /></div>
                        <div className="form-group"><label className="form-label">Password Baru</label><input type="password" className="form-input" value={newPw} onChange={e => setNewPw(e.target.value)} required /><div className="form-hint">Minimal 8 karakter</div></div>
                        <div className="form-group"><label className="form-label">Konfirmasi Password Baru</label><input type="password" className="form-input" value={confirmPw} onChange={e => setConfirmPw(e.target.value)} required /></div>
                        <button type="submit" className="btn btn-primary" disabled={loading}><Lock size={16} /> {loading ? 'Menyimpan...' : 'Ubah Password'}</button>
                    </form>
                </div>
            </div>
        </div>
    );
}
