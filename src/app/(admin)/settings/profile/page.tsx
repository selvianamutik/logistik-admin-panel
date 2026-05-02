'use client';

import { useState } from 'react';
import { useApp, useToast } from '../../layout';
import { Lock, Save } from 'lucide-react';

export default function ProfilePage() {
    const { user, setUser } = useApp();
    const { addToast } = useToast();
    const [name, setName] = useState(user?.name || '');
    const [profileLoading, setProfileLoading] = useState(false);
    const [currentPw, setCurrentPw] = useState('');
    const [newPw, setNewPw] = useState('');
    const [confirmPw, setConfirmPw] = useState('');
    const [passwordLoading, setPasswordLoading] = useState(false);

    const handleProfileSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const trimmedName = name.trim();
        if (!trimmedName) {
            addToast('error', 'Nama wajib diisi');
            return;
        }
        if (!user?._id) {
            addToast('error', 'Session user tidak valid');
            return;
        }

        setProfileLoading(true);
        try {
            const res = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ entity: 'users', action: 'update', data: { id: user._id, updates: { name: trimmedName } } }),
            });
            const payload = await res.json();
            if (!res.ok) {
                throw new Error(payload.error || 'Gagal memperbarui profil');
            }
            if (payload.data && user) {
                setUser({ ...user, name: payload.data.name });
                setName(payload.data.name || trimmedName);
            }
            addToast('success', 'Profil berhasil diperbarui');
        } catch (error) {
            addToast('error', error instanceof Error ? error.message : 'Gagal memperbarui profil');
        }
        setProfileLoading(false);
    };

    const handlePasswordSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!user?._id) {
            addToast('error', 'Session user tidak valid');
            return;
        }
        if (newPw.length < 8) {
            addToast('error', 'Password minimal 8 karakter');
            return;
        }
        if (newPw !== confirmPw) {
            addToast('error', 'Konfirmasi password tidak cocok');
            return;
        }

        setPasswordLoading(true);
        try {
            const res = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    entity: 'users',
                    action: 'update',
                    data: {
                        id: user._id,
                        currentPassword: currentPw,
                        updates: { password: newPw },
                    },
                }),
            });
            const payload = await res.json();
            if (!res.ok) {
                throw new Error(payload.error || 'Gagal mengubah password');
            }
            addToast('success', 'Password berhasil diubah');
            setCurrentPw('');
            setNewPw('');
            setConfirmPw('');
        } catch (error) {
            addToast('error', error instanceof Error ? error.message : 'Gagal mengubah password');
        }
        setPasswordLoading(false);
    };

    return (
        <div>
            <div className="page-header"><div className="page-header-left"><h1 className="page-title">Akun Saya</h1></div></div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 520px))', gap: 24, alignItems: 'start' }}>
                <div className="card">
                    <div className="card-body">
                        <form onSubmit={handleProfileSubmit}>
                            <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 20 }}>Profil</h2>
                            <div className="form-group"><label className="form-label">Nama</label><input className="form-input" value={name} onChange={e => setName(e.target.value)} required /></div>
                            <div className="form-group"><label className="form-label">Email</label><input className="form-input" value={user?.email || ''} disabled /><div className="form-hint">Dikelola dari User Management</div></div>
                            <div className="form-group"><label className="form-label">Role</label><input className="form-input" value={user?.role || ''} disabled /></div>
                            <button type="submit" className="btn btn-primary" disabled={profileLoading}><Save size={16} /> {profileLoading ? 'Menyimpan...' : 'Simpan Profil'}</button>
                        </form>
                    </div>
                </div>
                <div className="card">
                    <div className="card-body">
                        <form onSubmit={handlePasswordSubmit}>
                            <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 20 }}>Keamanan</h2>
                            <input
                                type="email"
                                value={user?.email || ''}
                                autoComplete="username"
                                readOnly
                                tabIndex={-1}
                                aria-hidden="true"
                                style={{ position: 'absolute', opacity: 0, pointerEvents: 'none', height: 0, width: 0 }}
                            />
                            <div className="form-group"><label className="form-label">Password Saat Ini</label><input type="password" className="form-input" value={currentPw} onChange={e => setCurrentPw(e.target.value)} autoComplete="current-password" required /></div>
                            <div className="form-group"><label className="form-label">Password Baru</label><input type="password" className="form-input" value={newPw} onChange={e => setNewPw(e.target.value)} autoComplete="new-password" required /><div className="form-hint">Minimal 8 karakter</div></div>
                            <div className="form-group"><label className="form-label">Konfirmasi Password Baru</label><input type="password" className="form-input" value={confirmPw} onChange={e => setConfirmPw(e.target.value)} autoComplete="new-password" required /></div>
                            <button type="submit" className="btn btn-primary" disabled={passwordLoading}><Lock size={16} /> {passwordLoading ? 'Menyimpan...' : 'Ubah Password'}</button>
                        </form>
                    </div>
                </div>
            </div>
        </div>
    );
}
