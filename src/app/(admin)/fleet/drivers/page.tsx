'use client';

import { useState, useEffect } from 'react';
import { useToast } from '../../layout';
import { Plus, Search, UserCircle, Save, X, Edit2, ToggleLeft, ToggleRight, Smartphone } from 'lucide-react';
import { formatDateTime } from '@/lib/utils';
import type { Driver, User } from '@/lib/types';

type DriverMobileAccount = Pick<User, '_id' | 'name' | 'email' | 'active' | 'driverRef' | 'driverName' | 'lastLoginAt'>;

export default function DriversPage() {
    const { addToast } = useToast();
    const [items, setItems] = useState<Driver[]>([]);
    const [accounts, setAccounts] = useState<DriverMobileAccount[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [showModal, setShowModal] = useState(false);
    const [showAccessModal, setShowAccessModal] = useState(false);
    const [editId, setEditId] = useState<string | null>(null);
    const [accessDriver, setAccessDriver] = useState<Driver | null>(null);
    const [form, setForm] = useState({ name: '', phone: '', licenseNumber: '', ktpNumber: '', simExpiry: '', address: '', active: true });
    const [accountForm, setAccountForm] = useState({ accountId: '', name: '', email: '', password: '', active: true });

    useEffect(() => {
        const loadDrivers = async () => {
            try {
                const [driverRes, accountRes] = await Promise.all([
                    fetch('/api/data?entity=drivers'),
                    fetch('/api/driver/accounts'),
                ]);

                const driverPayload = await driverRes.json();
                const accountPayload = await accountRes.json();

                if (!driverRes.ok) {
                    throw new Error(driverPayload.error || 'Gagal memuat data supir');
                }
                if (!accountRes.ok) {
                    throw new Error(accountPayload.error || 'Gagal memuat akses mobile driver');
                }

                setItems(driverPayload.data || []);
                setAccounts(accountPayload.data || []);
            } catch (error) {
                addToast('error', error instanceof Error ? error.message : 'Gagal memuat data supir');
            } finally {
                setLoading(false);
            }
        };

        void loadDrivers();
    }, [addToast]);

    const filtered = items.filter(d => !search || d.name.toLowerCase().includes(search.toLowerCase()) || d.phone.includes(search) || d.licenseNumber.toLowerCase().includes(search.toLowerCase()));
    const accountByDriverRef = new Map(accounts.filter(account => account.driverRef).map(account => [account.driverRef as string, account]));

    const handleSave = async () => {
        if (!form.name || !form.phone) { addToast('error', 'Nama dan no. HP wajib diisi'); return; }
        try {
            const res = await fetch('/api/data', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(editId
                    ? { entity: 'drivers', action: 'update', data: { id: editId, updates: form } }
                    : { entity: 'drivers', data: form })
            });
            const d = await res.json();
            if (!res.ok) {
                addToast('error', d.error || 'Gagal menyimpan data supir');
                return;
            }
            if (editId) {
                setItems(prev => prev.map(i => i._id === editId ? d.data : i));
                addToast('success', 'Supir diperbarui');
            } else {
                setItems(prev => [...prev, d.data]);
                addToast('success', 'Supir ditambahkan');
            }
            closeModal();
        } catch {
            addToast('error', 'Gagal menyimpan data supir');
        }
    };

    const toggleActive = async (driver: Driver) => {
        try {
            const res = await fetch('/api/data', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entity: 'drivers', action: 'update', data: { id: driver._id, updates: { active: !driver.active } } }) });
            const d = await res.json();
            if (!res.ok) {
                addToast('error', d.error || 'Gagal memperbarui status supir');
                return;
            }
            setItems(prev => prev.map(i => i._id === driver._id ? d.data : i));
            addToast('success', driver.active ? 'Supir dinon-aktifkan' : 'Supir diaktifkan');
        } catch {
            addToast('error', 'Gagal memperbarui status supir');
        }
    };

    const openAccessModal = (driver: Driver) => {
        const existingAccount = accountByDriverRef.get(driver._id);
        setAccessDriver(driver);
        setAccountForm({
            accountId: existingAccount?._id || '',
            name: existingAccount?.name || driver.name,
            email: existingAccount?.email || '',
            password: '',
            active: existingAccount?.active ?? true,
        });
        setShowAccessModal(true);
    };

    const closeAccessModal = () => {
        setShowAccessModal(false);
        setAccessDriver(null);
        setAccountForm({ accountId: '', name: '', email: '', password: '', active: true });
    };

    const saveDriverAccess = async () => {
        if (!accessDriver) {
            addToast('error', 'Data supir tidak ditemukan');
            return;
        }
        if (!accountForm.name || !accountForm.email) {
            addToast('error', 'Nama dan email akun driver wajib diisi');
            return;
        }
        if (!accountForm.accountId && accountForm.password.length < 8) {
            addToast('error', 'Password minimal 8 karakter untuk akun driver baru');
            return;
        }
        if (accountForm.password && accountForm.password.length < 8) {
            addToast('error', 'Password minimal 8 karakter');
            return;
        }

        try {
            const res = await fetch('/api/driver/accounts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: accountForm.accountId ? 'update' : 'create',
                    id: accountForm.accountId || undefined,
                    driverRef: accessDriver._id,
                    name: accountForm.name,
                    email: accountForm.email,
                    password: accountForm.password || undefined,
                    active: accountForm.active,
                }),
            });
            const payload = await res.json();
            if (!res.ok) {
                addToast('error', payload.error || 'Gagal menyimpan akses mobile driver');
                return;
            }

            setAccounts(prev => {
                const next = prev.filter(item => item._id !== payload.data._id);
                return [...next, payload.data as DriverMobileAccount].sort((a, b) => a.name.localeCompare(b.name));
            });
            addToast('success', accountForm.accountId ? 'Akses mobile driver diperbarui' : 'Akun mobile driver dibuat');
            closeAccessModal();
        } catch {
            addToast('error', 'Gagal menyimpan akses mobile driver');
        }
    };

    const openEdit = (d: Driver) => {
        setEditId(d._id);
        setForm({ name: d.name, phone: d.phone, licenseNumber: d.licenseNumber, ktpNumber: d.ktpNumber || '', simExpiry: d.simExpiry || '', address: d.address || '', active: d.active });
        setShowModal(true);
    };
    const closeModal = () => { setShowModal(false); setEditId(null); setForm({ name: '', phone: '', licenseNumber: '', ktpNumber: '', simExpiry: '', address: '', active: true }); };

    return (
        <div>
            <div className="page-header"><div className="page-header-left"><h1 className="page-title">Supir</h1><p className="page-subtitle">Kelola data supir perusahaan</p></div>
                <div className="page-actions">
                    <button className="btn btn-primary" onClick={() => { setEditId(null); setShowModal(true); }}><Plus size={18} /> Tambah Supir</button>
                </div></div>
            <div className="table-container">
                <div className="table-toolbar"><div className="table-toolbar-left"><div className="table-search"><Search size={16} className="table-search-icon" /><input placeholder="Cari nama, HP, SIM..." value={search} onChange={e => setSearch(e.target.value)} /></div></div></div>
                <div className="table-wrapper">
                    <table>
                        <thead><tr><th>Nama</th><th>No. HP</th><th>No. SIM</th><th>SIM Berlaku</th><th>Akses Mobile</th><th>Status</th><th>Aksi</th></tr></thead>
                        <tbody>
                            {loading ? [1, 2, 3].map(i => <tr key={i}>{[1, 2, 3, 4, 5, 6, 7].map(j => <td key={j}><div className="skeleton skeleton-text" /></td>)}</tr>) :
                                filtered.length === 0 ? <tr><td colSpan={7}><div className="empty-state"><UserCircle size={48} className="empty-state-icon" /><div className="empty-state-title">Belum ada supir</div></div></td></tr> :
                                    filtered.map(d => (
                                        (() => {
                                            const account = accountByDriverRef.get(d._id);
                                            return (
                                        <tr key={d._id}>
                                            <td className="font-medium">{d.name}</td>
                                            <td>{d.phone}</td>
                                            <td>{d.licenseNumber || '-'}</td>
                                            <td className="text-muted">{d.simExpiry || '-'}</td>
                                            <td>
                                                {account ? (
                                                    <div>
                                                        <div className="font-medium" style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                                                            <Smartphone size={14} /> {account.email}
                                                        </div>
                                                        <div className="text-muted text-sm">
                                                            {account.active ? 'Aktif' : 'Non-aktif'}
                                                            {account.lastLoginAt ? ` | Login terakhir ${formatDateTime(account.lastLoginAt)}` : ' | Belum pernah login'}
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <span className="text-muted">Belum ada akun mobile</span>
                                                )}
                                            </td>
                                            <td><span className={`badge ${d.active ? 'badge-green' : 'badge-gray'}`}>{d.active ? 'Aktif' : 'Non-aktif'}</span></td>
                                            <td>
                                                <div style={{ display: 'flex', gap: '0.25rem' }}>
                                                    <button className="btn btn-ghost btn-sm" onClick={() => openEdit(d)} title="Edit"><Edit2 size={14} /></button>
                                                    <button className="btn btn-ghost btn-sm" onClick={() => openAccessModal(d)} title="Atur akses mobile">
                                                        <Smartphone size={14} />
                                                    </button>
                                                    <button className="btn btn-ghost btn-sm" onClick={() => toggleActive(d)} title={d.active ? 'Nonaktifkan' : 'Aktifkan'}>
                                                        {d.active ? <ToggleRight size={14} className="text-green" /> : <ToggleLeft size={14} />}
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                            );
                                        })()
                                    ))}
                        </tbody>
                    </table>
                </div>
                {filtered.length > 0 && <div className="pagination"><div className="pagination-info">Menampilkan {filtered.length} dari {items.length} supir</div></div>}
            </div>

            {showModal && (
                <div className="modal-overlay" onClick={closeModal}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header"><h3 className="modal-title">{editId ? 'Edit Supir' : 'Tambah Supir'}</h3><button className="modal-close" onClick={closeModal}><X size={20} /></button></div>
                        <div className="modal-body">
                            <div className="form-row">
                                <div className="form-group"><label className="form-label">Nama <span className="required">*</span></label><input className="form-input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
                                <div className="form-group"><label className="form-label">No. HP <span className="required">*</span></label><input className="form-input" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} /></div>
                            </div>
                            <div className="form-row">
                                <div className="form-group"><label className="form-label">No. SIM</label><input className="form-input" value={form.licenseNumber} onChange={e => setForm({ ...form, licenseNumber: e.target.value })} /></div>
                                <div className="form-group"><label className="form-label">SIM Berlaku Sampai</label><input type="date" className="form-input" value={form.simExpiry} onChange={e => setForm({ ...form, simExpiry: e.target.value })} /></div>
                            </div>
                            <div className="form-row">
                                <div className="form-group"><label className="form-label">No. KTP</label><input className="form-input" value={form.ktpNumber} onChange={e => setForm({ ...form, ktpNumber: e.target.value })} /></div>
                            </div>
                            <div className="form-group"><label className="form-label">Alamat</label><textarea className="form-textarea" rows={2} value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} /></div>
                        </div>
                        <div className="modal-footer"><button className="btn btn-secondary" onClick={closeModal}>Batal</button><button className="btn btn-primary" onClick={handleSave}><Save size={16} /> Simpan</button></div>
                    </div>
                </div>
            )}

            {showAccessModal && accessDriver && (
                <div className="modal-overlay" onClick={closeAccessModal}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3 className="modal-title">Akses Mobile Driver</h3>
                            <button className="modal-close" onClick={closeAccessModal}><X size={20} /></button>
                        </div>
                        <div className="modal-body">
                            <div className="form-group">
                                <label className="form-label">Supir</label>
                                <input className="form-input" value={accessDriver.name} disabled />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Nama Akun Driver <span className="required">*</span></label>
                                <input className="form-input" value={accountForm.name} onChange={e => setAccountForm({ ...accountForm, name: e.target.value })} />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Email Login Driver <span className="required">*</span></label>
                                <input className="form-input" type="email" value={accountForm.email} onChange={e => setAccountForm({ ...accountForm, email: e.target.value })} placeholder="contoh: driver.andi@company.local" />
                            </div>
                            <div className="form-group">
                                <label className="form-label">{accountForm.accountId ? 'Reset Password (opsional)' : 'Password Awal *'}</label>
                                <input className="form-input" type="password" value={accountForm.password} onChange={e => setAccountForm({ ...accountForm, password: e.target.value })} />
                                <div className="form-hint">Minimal 8 karakter. Driver login dari halaman <code>/driver/login</code>.</div>
                            </div>
                            <label className="checkbox-label" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <input type="checkbox" checked={accountForm.active} onChange={e => setAccountForm({ ...accountForm, active: e.target.checked })} />
                                Akun mobile aktif
                            </label>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={closeAccessModal}>Batal</button>
                            <button className="btn btn-primary" onClick={saveDriverAccess}><Save size={16} /> Simpan Akses</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
