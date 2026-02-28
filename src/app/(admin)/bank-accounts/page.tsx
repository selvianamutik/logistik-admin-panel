'use client';

import { useState, useEffect, useCallback } from 'react';
import { useToast } from '../layout';
import { Plus, Edit, Trash2, ArrowRightLeft, Landmark, TrendingUp, TrendingDown, Eye } from 'lucide-react';
import Link from 'next/link';
import type { BankAccount } from '@/lib/types';

export default function BankAccountsPage() {
    const { addToast } = useToast();
    const [accounts, setAccounts] = useState<BankAccount[]>([]);
    const [loading, setLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const [showTransfer, setShowTransfer] = useState(false);
    const [editAccount, setEditAccount] = useState<BankAccount | null>(null);
    const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
    const [form, setForm] = useState({ bankName: '', accountNumber: '', accountHolder: '', initialBalance: 0, notes: '' });
    const [transferForm, setTransferForm] = useState({ fromAccountRef: '', toAccountRef: '', amount: 0, date: new Date().toISOString().slice(0, 10), note: '' });

    const loadAccounts = useCallback(() => {
        fetch('/api/data?entity=bank-accounts').then(r => r.json()).then(d => {
            setAccounts((d.data || []).filter((a: BankAccount) => a.active !== false));
            setLoading(false);
        });
    }, []);

    useEffect(() => { loadAccounts(); }, [loadAccounts]);

    const openNew = () => { setEditAccount(null); setForm({ bankName: '', accountNumber: '', accountHolder: '', initialBalance: 0, notes: '' }); setShowModal(true); };
    const openEdit = (a: BankAccount) => { setEditAccount(a); setForm({ bankName: a.bankName, accountNumber: a.accountNumber, accountHolder: a.accountHolder, initialBalance: a.initialBalance, notes: a.notes || '' }); setShowModal(true); };

    const handleSave = async () => {
        if (!form.bankName || !form.accountNumber) { addToast('error', 'Nama bank dan nomor rekening wajib'); return; }
        if (editAccount) {
            await fetch('/api/data', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entity: 'bank-accounts', action: 'update', data: { id: editAccount._id, updates: { bankName: form.bankName, accountNumber: form.accountNumber, accountHolder: form.accountHolder, notes: form.notes } } }) });
            addToast('success', 'Rekening diperbarui');
        } else {
            await fetch('/api/data', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entity: 'bank-accounts', data: { ...form, active: true } }) });
            addToast('success', 'Rekening ditambahkan');
        }
        setShowModal(false);
        loadAccounts();
    };

    const handleDelete = async (id: string) => {
        await fetch('/api/data', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entity: 'bank-accounts', action: 'update', data: { id, updates: { active: false } } }) });
        setAccounts(prev => prev.filter(a => a._id !== id));
        setDeleteConfirm(null);
        addToast('success', 'Rekening dihapus');
    };

    const handleTransfer = async () => {
        if (!transferForm.fromAccountRef || !transferForm.toAccountRef || transferForm.amount <= 0) { addToast('error', 'Lengkapi data transfer'); return; }
        if (transferForm.fromAccountRef === transferForm.toAccountRef) { addToast('error', 'Rekening sumber dan tujuan tidak boleh sama'); return; }
        await fetch('/api/data', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entity: 'bank-transactions', data: { action: 'transfer', fromAccountRef: transferForm.fromAccountRef, toAccountRef: transferForm.toAccountRef, amount: transferForm.amount, date: transferForm.date } }) });
        setShowTransfer(false);
        setTransferForm({ fromAccountRef: '', toAccountRef: '', amount: 0, date: new Date().toISOString().slice(0, 10), note: '' });
        addToast('success', 'Transfer berhasil');
        loadAccounts();
    };

    const fmt = (n: number) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(n);
    const totalBalance = accounts.reduce((sum, a) => sum + (a.currentBalance || 0), 0);

    return (
        <div>
            <div className="page-header">
                <div className="page-header-left">
                    <h1 className="page-title">Rekening Bank</h1>
                    <p className="page-subtitle">Kelola rekening bank dan tracking saldo</p>
                </div>
                <div className="page-actions">
                    <button className="btn btn-secondary" onClick={() => setShowTransfer(true)}><ArrowRightLeft size={16} /> Transfer</button>
                    <button className="btn btn-primary" onClick={openNew}><Plus size={18} /> Tambah Rekening</button>
                </div>
            </div>

            {/* Total Balance Card */}
            <div className="card mb-6" style={{ background: 'linear-gradient(135deg, var(--primary) 0%, var(--primary-dark) 100%)', color: '#fff' }}>
                <div className="card-body" style={{ padding: '1.5rem' }}>
                    <div style={{ fontSize: '0.85rem', opacity: 0.8, marginBottom: '0.25rem' }}>Total Saldo Semua Rekening</div>
                    <div style={{ fontSize: '2rem', fontWeight: 700 }}>{fmt(totalBalance)}</div>
                    <div style={{ fontSize: '0.8rem', opacity: 0.7, marginTop: '0.25rem' }}>{accounts.length} rekening aktif</div>
                </div>
            </div>

            {/* Account Cards Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: '1rem' }}>
                {loading ? [1, 2, 3].map(i => (
                    <div key={i} className="card"><div className="card-body"><div className="skeleton skeleton-title" /><div className="skeleton skeleton-text" /><div className="skeleton skeleton-text" /></div></div>
                )) : accounts.map(acc => (
                    <div key={acc._id} className="card" style={{ position: 'relative' }}>
                        <div className="card-body" style={{ padding: '1.25rem' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
                                <div style={{ width: 40, height: 40, borderRadius: '0.5rem', background: 'var(--primary-light)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                    <Landmark size={20} style={{ color: 'var(--primary)' }} />
                                </div>
                                <div>
                                    <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>{acc.bankName}</div>
                                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{acc.accountNumber}</div>
                                </div>
                            </div>
                            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>a.n. {acc.accountHolder}</div>
                            <div style={{ fontSize: '1.5rem', fontWeight: 700, color: (acc.currentBalance || 0) >= 0 ? 'var(--success)' : 'var(--danger)', margin: '0.5rem 0' }}>{fmt(acc.currentBalance || 0)}</div>
                            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
                                <Link href={`/bank-accounts/${acc._id}`} className="btn btn-sm btn-secondary" style={{ fontSize: '0.75rem', padding: '0.35rem 0.6rem' }}><Eye size={14} /> Detail</Link>
                                <button className="btn btn-sm btn-secondary" style={{ fontSize: '0.75rem', padding: '0.35rem 0.6rem' }} onClick={() => openEdit(acc)}><Edit size={14} /> Edit</button>
                                <button className="btn btn-sm btn-danger" style={{ fontSize: '0.75rem', padding: '0.35rem 0.6rem' }} onClick={() => setDeleteConfirm(acc._id)}><Trash2 size={14} /></button>
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            {/* Add/Edit Modal */}
            {showModal && (
                <div className="modal-overlay" onClick={() => setShowModal(false)}>
                    <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 500 }}>
                        <div className="modal-header"><h3 className="modal-title">{editAccount ? 'Edit Rekening' : 'Tambah Rekening'}</h3><button className="modal-close" onClick={() => setShowModal(false)}>×</button></div>
                        <div className="modal-body">
                            <div className="form-group"><label className="form-label">Nama Bank <span className="required">*</span></label><input className="form-input" placeholder="BCA, Mandiri, BRI..." value={form.bankName} onChange={e => setForm({ ...form, bankName: e.target.value })} /></div>
                            <div className="form-row">
                                <div className="form-group"><label className="form-label">Nomor Rekening <span className="required">*</span></label><input className="form-input" placeholder="1234567890" value={form.accountNumber} onChange={e => setForm({ ...form, accountNumber: e.target.value })} /></div>
                                <div className="form-group"><label className="form-label">Atas Nama</label><input className="form-input" value={form.accountHolder} onChange={e => setForm({ ...form, accountHolder: e.target.value })} /></div>
                            </div>
                            {!editAccount && (
                                <div className="form-group"><label className="form-label">Saldo Awal</label><input className="form-input" type="number" value={form.initialBalance} onChange={e => setForm({ ...form, initialBalance: Number(e.target.value) })} /></div>
                            )}
                            <div className="form-group"><label className="form-label">Catatan</label><textarea className="form-textarea" rows={2} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></div>
                        </div>
                        <div className="modal-footer"><button className="btn btn-secondary" onClick={() => setShowModal(false)}>Batal</button><button className="btn btn-primary" onClick={handleSave}>Simpan</button></div>
                    </div>
                </div>
            )}

            {/* Transfer Modal */}
            {showTransfer && (
                <div className="modal-overlay" onClick={() => setShowTransfer(false)}>
                    <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 500 }}>
                        <div className="modal-header"><h3 className="modal-title"><ArrowRightLeft size={18} /> Transfer Antar Rekening</h3><button className="modal-close" onClick={() => setShowTransfer(false)}>×</button></div>
                        <div className="modal-body">
                            <div className="form-group">
                                <label className="form-label">Dari Rekening <span className="required">*</span></label>
                                <select className="form-select" value={transferForm.fromAccountRef} onChange={e => setTransferForm({ ...transferForm, fromAccountRef: e.target.value })}>
                                    <option value="">-- Pilih --</option>
                                    {accounts.map(a => <option key={a._id} value={a._id}>{a.bankName} - {a.accountNumber} ({fmt(a.currentBalance || 0)})</option>)}
                                </select>
                            </div>
                            <div style={{ textAlign: 'center', padding: '0.5rem 0' }}><TrendingDown size={20} style={{ color: 'var(--danger)' }} /> → <TrendingUp size={20} style={{ color: 'var(--success)' }} /></div>
                            <div className="form-group">
                                <label className="form-label">Ke Rekening <span className="required">*</span></label>
                                <select className="form-select" value={transferForm.toAccountRef} onChange={e => setTransferForm({ ...transferForm, toAccountRef: e.target.value })}>
                                    <option value="">-- Pilih --</option>
                                    {accounts.filter(a => a._id !== transferForm.fromAccountRef).map(a => <option key={a._id} value={a._id}>{a.bankName} - {a.accountNumber} ({fmt(a.currentBalance || 0)})</option>)}
                                </select>
                            </div>
                            <div className="form-row">
                                <div className="form-group"><label className="form-label">Jumlah <span className="required">*</span></label><input className="form-input" type="number" value={transferForm.amount || ''} onChange={e => setTransferForm({ ...transferForm, amount: Number(e.target.value) })} /></div>
                                <div className="form-group"><label className="form-label">Tanggal</label><input className="form-input" type="date" value={transferForm.date} onChange={e => setTransferForm({ ...transferForm, date: e.target.value })} /></div>
                            </div>
                        </div>
                        <div className="modal-footer"><button className="btn btn-secondary" onClick={() => setShowTransfer(false)}>Batal</button><button className="btn btn-primary" onClick={handleTransfer}><ArrowRightLeft size={16} /> Transfer</button></div>
                    </div>
                </div>
            )}

            {/* Delete Confirm Modal */}
            {deleteConfirm && (
                <div className="modal-overlay" onClick={() => setDeleteConfirm(null)}>
                    <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 400 }}>
                        <div className="modal-header"><h3 className="modal-title">Hapus Rekening?</h3></div>
                        <div className="modal-body"><p>Rekening akan dinonaktifkan. Data transaksi tetap tersimpan.</p></div>
                        <div className="modal-footer"><button className="btn btn-secondary" onClick={() => setDeleteConfirm(null)}>Batal</button><button className="btn btn-danger" onClick={() => handleDelete(deleteConfirm)}>Hapus</button></div>
                    </div>
                </div>
            )}
        </div>
    );
}
