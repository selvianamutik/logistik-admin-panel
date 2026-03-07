'use client';

import { useState, useEffect, useCallback } from 'react';
import { useToast } from '../layout';
import { Plus, Edit, Trash2, ArrowRightLeft, TrendingUp, TrendingDown, Eye, FileDown, Printer } from 'lucide-react';
import Link from 'next/link';
import { exportToExcel } from '@/lib/export';
import type { BankAccount, CompanyProfile } from '@/lib/types';

// ── Bank presets with real logo URLs and colors ──
const BANK_PRESETS: Record<string, { label: string; color: string; gradient: string; logo: string }> = {
    BCA: { label: 'BCA', color: '#003b7b', gradient: 'linear-gradient(135deg, #003b7b 0%, #0060c7 100%)', logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5c/Bank_Central_Asia.svg/200px-Bank_Central_Asia.svg.png' },
    Mandiri: { label: 'Mandiri', color: '#003868', gradient: 'linear-gradient(135deg, #003868 0%, #005ba5 100%)', logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ad/Bank_Mandiri_logo_2016.svg/200px-Bank_Mandiri_logo_2016.svg.png' },
    BRI: { label: 'BRI', color: '#00529c', gradient: 'linear-gradient(135deg, #00529c 0%, #0078d4 100%)', logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/68/BANK_BRI_logo.svg/200px-BANK_BRI_logo.svg.png' },
    BNI: { label: 'BNI', color: '#e35205', gradient: 'linear-gradient(135deg, #e35205 0%, #f97316 100%)', logo: 'https://upload.wikimedia.org/wikipedia/id/thumb/5/55/BNI_logo.svg/200px-BNI_logo.svg.png' },
    BSI: { label: 'BSI', color: '#00a650', gradient: 'linear-gradient(135deg, #00a650 0%, #22c55e 100%)', logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/84/Bank_Syariah_Indonesia.svg/200px-Bank_Syariah_Indonesia.svg.png' },
    CIMB: { label: 'CIMB Niaga', color: '#6d0e0e', gradient: 'linear-gradient(135deg, #6d0e0e 0%, #dc2626 100%)', logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e9/CIMB_Niaga_logo.svg/200px-CIMB_Niaga_logo.svg.png' },
    Permata: { label: 'PermataBank', color: '#003f2d', gradient: 'linear-gradient(135deg, #003f2d 0%, #059669 100%)', logo: 'https://upload.wikimedia.org/wikipedia/id/thumb/0/0f/PermataBank_logo.svg/200px-PermataBank_logo.svg.png' },
    Danamon: { label: 'Danamon', color: '#002d62', gradient: 'linear-gradient(135deg, #002d62 0%, #1d4ed8 100%)', logo: 'https://upload.wikimedia.org/wikipedia/id/thumb/4/4e/Bank_Danamon_logo.svg/200px-Bank_Danamon_logo.svg.png' },
    Mega: { label: 'Bank Mega', color: '#003478', gradient: 'linear-gradient(135deg, #003478 0%, #2563eb 100%)', logo: 'https://upload.wikimedia.org/wikipedia/id/thumb/c/ca/Logo_Bank_Mega.svg/200px-Logo_Bank_Mega.svg.png' },
    OCBC: { label: 'OCBC NISP', color: '#e60012', gradient: 'linear-gradient(135deg, #e60012 0%, #f43f5e 100%)', logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/53/OCBC_Bank_logo.svg/200px-OCBC_Bank_logo.svg.png' },
    Jago: { label: 'Bank Jago', color: '#fbbf24', gradient: 'linear-gradient(135deg, #78350f 0%, #d97706 100%)', logo: 'https://upload.wikimedia.org/wikipedia/id/thumb/c/cb/Logo_Bank_Jago.svg/200px-Logo_Bank_Jago.svg.png' },
    Jenius: { label: 'Jenius/BTPN', color: '#00b4d8', gradient: 'linear-gradient(135deg, #0e7490 0%, #06b6d4 100%)', logo: 'https://upload.wikimedia.org/wikipedia/id/thumb/b/b4/BTPN_Syariah_Logo.svg/200px-BTPN_Syariah_Logo.svg.png' },
    OTHER: { label: 'Lainnya', color: '#6b7280', gradient: 'linear-gradient(135deg, #374151 0%, #6b7280 100%)', logo: '' },
};

function getBankPreset(bankName: string) {
    const key = Object.keys(BANK_PRESETS).find(k => k !== 'OTHER' && bankName.toUpperCase().includes(k.toUpperCase()));
    return { ...(BANK_PRESETS[key || 'OTHER']), key: key || 'OTHER' };
}

function BankLogo({ name, size = 36 }: { name: string; size?: number }) {
    const preset = getBankPreset(name);
    const [imgErr, setImgErr] = useState(false);
    const initials = name.slice(0, 3).toUpperCase();
    if (preset.logo && !imgErr) {
        return (
            <div style={{ width: size, height: size, borderRadius: '0.5rem', background: '#fff', border: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, overflow: 'hidden', padding: size * 0.08 }}>
                <img src={preset.logo} alt={name} style={{ width: '100%', height: '100%', objectFit: 'contain' }} onError={() => setImgErr(true)} />
            </div>
        );
    }
    return (
        <div style={{
            width: size, height: size, borderRadius: '0.5rem', background: preset.gradient,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#fff', fontWeight: 800, fontSize: size * 0.32, letterSpacing: '-0.02em',
            flexShrink: 0, boxShadow: `0 2px 8px ${preset.color}40`
        }}>{initials}</div>
    );
}

export default function BankAccountsPage() {
    const { addToast } = useToast();
    const [accounts, setAccounts] = useState<BankAccount[]>([]);
    const [company, setCompany] = useState<CompanyProfile | null>(null);
    const [loading, setLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const [showTransfer, setShowTransfer] = useState(false);
    const [editAccount, setEditAccount] = useState<BankAccount | null>(null);
    const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
    const [showPrint, setShowPrint] = useState(false);
    const [form, setForm] = useState({ bankName: '', accountNumber: '', accountHolder: '', initialBalance: 0, notes: '' });
    const [transferForm, setTransferForm] = useState({ fromAccountRef: '', toAccountRef: '', amount: 0, date: new Date().toISOString().slice(0, 10) });

    const loadAccounts = useCallback(() => {
        fetch('/api/data?entity=bank-accounts').then(r => r.json()).then(d => {
            setAccounts((d.data || []).filter((a: BankAccount) => a.active !== false));
            setLoading(false);
        });
    }, []);

    useEffect(() => {
        loadAccounts();
        fetch('/api/data?entity=company').then(r => r.json()).then(d => setCompany(d.data || null));
    }, [loadAccounts]);

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
        setTransferForm({ fromAccountRef: '', toAccountRef: '', amount: 0, date: new Date().toISOString().slice(0, 10) });
        addToast('success', 'Transfer berhasil');
        loadAccounts();
    };

    const handleExportExcel = () => {
        exportToExcel(accounts as unknown as Record<string, unknown>[], [
            { header: 'Bank', key: 'bankName', width: 18 },
            { header: 'No. Rekening', key: 'accountNumber', width: 20 },
            { header: 'Atas Nama', key: 'accountHolder', width: 25 },
            { header: 'Saldo Awal', key: 'initialBalance', width: 18 },
            { header: 'Saldo Saat Ini', key: 'currentBalance', width: 18 },
        ], `rekening-bank-${new Date().toISOString().split('T')[0]}`, 'Rekening Bank');
        addToast('success', 'Excel berhasil di-download');
    };

    const fmt = (n: number) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(n);
    const fmtN = (n: number) => new Intl.NumberFormat('id-ID').format(n);
    const totalBalance = accounts.reduce((sum, a) => sum + (a.currentBalance || 0), 0);
    const totalInitial = accounts.reduce((sum, a) => sum + (a.initialBalance || 0), 0);
    const companyName = company?.name || 'LOGISTIK';
    const companyLogo = company?.logoUrl || '';

    const printHeader = (title: string) => `
        <div style="display:flex;align-items:center;gap:1rem;margin-bottom:1.5rem;padding-bottom:1rem;border-bottom:2px solid #1e293b">
            ${companyLogo ? `<img src="${companyLogo}" style="height:48px;width:auto;object-fit:contain" />` : ''}
            <div>
                <div style="font-size:1.3rem;font-weight:800;color:#1e293b">${companyName}</div>
                <div style="font-size:0.85rem;color:#64748b">${title}</div>
            </div>
            <div style="margin-left:auto;text-align:right;font-size:0.75rem;color:#94a3b8">Dicetak: ${new Date().toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' })}</div>
        </div>`;

    return (
        <div>
            {/* Header */}
            <div className="page-header">
                <div className="page-header-left">
                    <h1 className="page-title">Rekening Bank</h1>
                    <p className="page-subtitle">Kelola rekening bank dan tracking saldo real-time</p>
                </div>
                <div className="page-actions" style={{ flexWrap: 'wrap' }}>
                    <button className="btn btn-secondary btn-sm" onClick={handleExportExcel}><FileDown size={15} /> Excel</button>
                    <button className="btn btn-secondary btn-sm" onClick={() => setShowPrint(true)}><Printer size={15} /> Print</button>
                    <button className="btn btn-secondary" onClick={() => setShowTransfer(true)}><ArrowRightLeft size={16} /> Transfer</button>
                    <button className="btn btn-primary" onClick={openNew}><Plus size={18} /> Tambah</button>
                </div>
            </div>

            {/* Summary Stats */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
                <div className="card" style={{ background: 'linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-hover) 100%)', color: '#fff', overflow: 'hidden', position: 'relative' }}>
                    <div style={{ position: 'absolute', right: -20, top: -20, width: 100, height: 100, borderRadius: '50%', background: 'rgba(255,255,255,0.08)' }} />
                    <div className="card-body" style={{ padding: '1.25rem', position: 'relative' }}>
                        <div style={{ fontSize: '0.75rem', opacity: 0.8, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.35rem' }}>Total Saldo</div>
                        <div style={{ fontSize: '1.75rem', fontWeight: 700 }}>{fmt(totalBalance)}</div>
                    </div>
                </div>
                <div className="card" style={{ overflow: 'hidden', position: 'relative' }}>
                    <div className="card-body" style={{ padding: '1.25rem' }}>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.35rem' }}>Saldo Awal</div>
                        <div style={{ fontSize: '1.5rem', fontWeight: 700 }}>{fmt(totalInitial)}</div>
                    </div>
                </div>
                <div className="card" style={{ overflow: 'hidden', position: 'relative' }}>
                    <div className="card-body" style={{ padding: '1.25rem' }}>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.35rem' }}>Perubahan</div>
                        <div style={{ fontSize: '1.5rem', fontWeight: 700, color: totalBalance - totalInitial >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                            {totalBalance - totalInitial >= 0 ? '+' : ''}{fmt(totalBalance - totalInitial)}
                        </div>
                    </div>
                </div>
            </div>

            {/* Account Cards Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1rem' }}>
                {loading ? [1, 2, 3].map(i => (
                    <div key={i} className="card"><div className="card-body"><div className="skeleton skeleton-title" /><div className="skeleton skeleton-text" /><div className="skeleton skeleton-text" /></div></div>
                )) : accounts.map(acc => {
                    const preset = getBankPreset(acc.bankName);
                    const diff = (acc.currentBalance || 0) - (acc.initialBalance || 0);
                    return (
                        <div key={acc._id} className="card" style={{ overflow: 'hidden', transition: 'transform 0.15s, box-shadow 0.15s', cursor: 'default' }}
                            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.transform = 'translateY(-2px)'; (e.currentTarget as HTMLElement).style.boxShadow = '0 8px 25px rgba(0,0,0,0.1)'; }}
                            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.transform = ''; (e.currentTarget as HTMLElement).style.boxShadow = ''; }}>
                            <div style={{ height: 4, background: preset.gradient }} />
                            <div className="card-body" style={{ padding: '1.25rem' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
                                    <BankLogo name={acc.bankName} size={44} />
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ fontWeight: 700, fontSize: '1rem', lineHeight: 1.2 }}>{acc.bankName}</div>
                                        <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono, monospace)', letterSpacing: '0.03em' }}>{acc.accountNumber}</div>
                                    </div>
                                </div>
                                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                                    <span style={{ opacity: 0.6 }}>a.n.</span> {acc.accountHolder}
                                </div>
                                <div style={{ background: 'var(--bg-secondary, #f8fafc)', borderRadius: '0.5rem', padding: '0.75rem 1rem', marginBottom: '0.75rem' }}>
                                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.2rem' }}>Saldo</div>
                                    <div style={{ fontSize: '1.4rem', fontWeight: 700, color: (acc.currentBalance || 0) >= 0 ? 'var(--text-primary, #1e293b)' : 'var(--danger)' }}>{fmt(acc.currentBalance || 0)}</div>
                                    <div style={{ fontSize: '0.72rem', color: diff >= 0 ? 'var(--success)' : 'var(--danger)', marginTop: '0.15rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                                        {diff >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                                        {diff >= 0 ? '+' : ''}{fmt(diff)} dari saldo awal
                                    </div>
                                </div>
                                <div style={{ display: 'flex', gap: '0.4rem' }}>
                                    <Link href={`/bank-accounts/${acc._id}`} className="btn btn-sm btn-secondary" style={{ flex: 1, fontSize: '0.75rem', padding: '0.4rem 0.5rem', justifyContent: 'center' }}><Eye size={13} /> Detail</Link>
                                    <button className="btn btn-sm btn-secondary" style={{ fontSize: '0.75rem', padding: '0.4rem 0.5rem' }} onClick={() => openEdit(acc)}><Edit size={13} /></button>
                                    <button className="btn btn-sm" style={{ fontSize: '0.75rem', padding: '0.4rem 0.5rem', color: 'var(--danger)', border: '1px solid var(--danger)', background: 'transparent' }} onClick={() => setDeleteConfirm(acc._id)}><Trash2 size={13} /></button>
                                </div>
                            </div>
                        </div>
                    );
                })}
                {!loading && (
                    <div className="card" style={{ border: '2px dashed var(--border-color)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 200, transition: 'border-color 0.2s, background 0.2s' }}
                        onClick={openNew}
                        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--primary)'; (e.currentTarget as HTMLElement).style.background = 'var(--primary-light, rgba(79,70,229,0.04))'; }}
                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--border-color)'; (e.currentTarget as HTMLElement).style.background = ''; }}>
                        <div style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                            <Plus size={32} style={{ marginBottom: '0.5rem', opacity: 0.5 }} />
                            <div style={{ fontSize: '0.85rem', fontWeight: 500 }}>Tambah Rekening</div>
                        </div>
                    </div>
                )}
            </div>

            {/* Add/Edit Modal */}
            {showModal && (
                <div className="modal-overlay" onClick={() => setShowModal(false)}>
                    <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 520 }}>
                        <div className="modal-header"><h3 className="modal-title">{editAccount ? 'Edit Rekening' : 'Tambah Rekening Baru'}</h3><button className="modal-close" onClick={() => setShowModal(false)}>×</button></div>
                        <div className="modal-body">
                            <div className="form-group">
                                <label className="form-label">Jenis Bank <span className="required">*</span></label>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.4rem', marginBottom: '0.5rem' }}>
                                    {Object.entries(BANK_PRESETS).filter(([k]) => k !== 'OTHER').map(([key, preset]) => (
                                        <button key={key} type="button" onClick={() => setForm({ ...form, bankName: preset.label })}
                                            style={{
                                                padding: '0.45rem 0.25rem', borderRadius: '0.5rem', border: form.bankName === preset.label ? `2px solid ${preset.color}` : '1px solid var(--border-color)',
                                                background: form.bankName === preset.label ? `${preset.color}10` : 'var(--bg-primary)', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.25rem', transition: 'all 0.15s', fontSize: '0.65rem', fontWeight: 600, color: 'var(--text-primary)'
                                            }}>
                                            <BankLogo name={key} size={28} />
                                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}>{preset.label}</span>
                                        </button>
                                    ))}
                                </div>
                                <input className="form-input" placeholder="Atau ketik nama bank manual..." value={form.bankName} onChange={e => setForm({ ...form, bankName: e.target.value })} style={{ fontSize: '0.85rem' }} />
                            </div>
                            <div className="form-row">
                                <div className="form-group"><label className="form-label">Nomor Rekening <span className="required">*</span></label><input className="form-input" placeholder="1234567890" value={form.accountNumber} onChange={e => setForm({ ...form, accountNumber: e.target.value })} style={{ fontFamily: 'var(--font-mono, monospace)', letterSpacing: '0.05em' }} /></div>
                                <div className="form-group"><label className="form-label">Atas Nama</label><input className="form-input" value={form.accountHolder} onChange={e => setForm({ ...form, accountHolder: e.target.value })} /></div>
                            </div>
                            {!editAccount && (
                                <div className="form-group"><label className="form-label">Saldo Awal (Rp)</label><input className="form-input" type="number" value={form.initialBalance || ''} onChange={e => setForm({ ...form, initialBalance: Number(e.target.value) })} placeholder="0" /></div>
                            )}
                            <div className="form-group"><label className="form-label">Catatan</label><textarea className="form-textarea" rows={2} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="Catatan opsional..." /></div>
                        </div>
                        <div className="modal-footer"><button className="btn btn-secondary" onClick={() => setShowModal(false)}>Batal</button><button className="btn btn-primary" onClick={handleSave}>Simpan</button></div>
                    </div>
                </div>
            )}

            {/* Transfer Modal */}
            {showTransfer && (
                <div className="modal-overlay" onClick={() => setShowTransfer(false)}>
                    <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 500 }}>
                        <div className="modal-header"><h3 className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><ArrowRightLeft size={18} /> Transfer Antar Rekening</h3><button className="modal-close" onClick={() => setShowTransfer(false)}>×</button></div>
                        <div className="modal-body">
                            <div className="form-group">
                                <label className="form-label">Dari Rekening <span className="required">*</span></label>
                                <select className="form-select" value={transferForm.fromAccountRef} onChange={e => setTransferForm({ ...transferForm, fromAccountRef: e.target.value })}>
                                    <option value="">-- Pilih sumber --</option>
                                    {accounts.map(a => <option key={a._id} value={a._id}>{a.bankName} - {a.accountNumber} ({fmt(a.currentBalance || 0)})</option>)}
                                </select>
                            </div>
                            <div style={{ textAlign: 'center', padding: '0.35rem 0', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', color: 'var(--text-muted)' }}>
                                <div style={{ flex: 1, height: 1, background: 'var(--border-color)' }} />
                                <TrendingDown size={16} style={{ color: 'var(--danger)' }} />
                                <span style={{ fontSize: '0.75rem' }}>→</span>
                                <TrendingUp size={16} style={{ color: 'var(--success)' }} />
                                <div style={{ flex: 1, height: 1, background: 'var(--border-color)' }} />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Ke Rekening <span className="required">*</span></label>
                                <select className="form-select" value={transferForm.toAccountRef} onChange={e => setTransferForm({ ...transferForm, toAccountRef: e.target.value })}>
                                    <option value="">-- Pilih tujuan --</option>
                                    {accounts.filter(a => a._id !== transferForm.fromAccountRef).map(a => <option key={a._id} value={a._id}>{a.bankName} - {a.accountNumber} ({fmt(a.currentBalance || 0)})</option>)}
                                </select>
                            </div>
                            <div className="form-row">
                                <div className="form-group"><label className="form-label">Jumlah (Rp) <span className="required">*</span></label><input className="form-input" type="number" value={transferForm.amount || ''} onChange={e => setTransferForm({ ...transferForm, amount: Number(e.target.value) })} placeholder="0" /></div>
                                <div className="form-group"><label className="form-label">Tanggal</label><input className="form-input" type="date" value={transferForm.date} onChange={e => setTransferForm({ ...transferForm, date: e.target.value })} /></div>
                            </div>
                        </div>
                        <div className="modal-footer"><button className="btn btn-secondary" onClick={() => setShowTransfer(false)}>Batal</button><button className="btn btn-primary" onClick={handleTransfer}><ArrowRightLeft size={16} /> Transfer</button></div>
                    </div>
                </div>
            )}

            {/* Delete Confirm */}
            {deleteConfirm && (
                <div className="modal-overlay" onClick={() => setDeleteConfirm(null)}>
                    <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 400 }}>
                        <div className="modal-header"><h3 className="modal-title">Hapus Rekening?</h3></div>
                        <div className="modal-body"><p>Rekening akan dinonaktifkan. Data transaksi tetap tersimpan.</p></div>
                        <div className="modal-footer"><button className="btn btn-secondary" onClick={() => setDeleteConfirm(null)}>Batal</button><button className="btn btn-danger" onClick={() => handleDelete(deleteConfirm)}>Hapus</button></div>
                    </div>
                </div>
            )}

            {/* Print Preview Modal */}
            {showPrint && (
                <div className="modal-overlay" onClick={() => setShowPrint(false)}>
                    <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 800, maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
                        <div className="modal-header">
                            <h3 className="modal-title">Print Preview — Rekening Bank</h3>
                            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                <button className="btn btn-primary btn-sm" onClick={() => {
                                    const w = window.open('', '_blank');
                                    if (!w) return;
                                    w.document.write(`<!DOCTYPE html><html><head><title>Rekening Bank — ${companyName}</title><style>
                                        body { font-family: 'Segoe UI', sans-serif; padding: 2rem; color: #1e293b; max-width: 900px; margin: 0 auto; }
                                        table { width: 100%; border-collapse: collapse; margin-top: 1rem; } th, td { padding: 0.6rem 0.75rem; text-align: left; border-bottom: 1px solid #e2e8f0; font-size: 0.85rem; }
                                        th { background: #f1f5f9; font-weight: 600; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.03em; }
                                        .r { text-align: right; } .b { font-weight: 700; } .s { color: #16a34a; } .d { color: #dc2626; }
                                        .footer { margin-top: 1.5rem; font-size: 0.72rem; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 0.75rem; }
                                        @media print { body { padding: 0.5rem; } }
                                    </style></head><body>
                                        ${printHeader('Laporan Rekening Bank')}
                                        <table><thead><tr><th>Bank</th><th>No. Rekening</th><th>Atas Nama</th><th class="r">Saldo Awal</th><th class="r">Saldo Saat Ini</th><th class="r">Perubahan</th></tr></thead>
                                        <tbody>${accounts.map(a => {
                                        const d = (a.currentBalance || 0) - (a.initialBalance || 0);
                                        return `<tr><td class="b">${a.bankName}</td><td>${a.accountNumber}</td><td>${a.accountHolder}</td><td class="r">${fmtN(a.initialBalance || 0)}</td><td class="r b">${fmtN(a.currentBalance || 0)}</td><td class="r ${d >= 0 ? 's' : 'd'}">${d >= 0 ? '+' : ''}${fmtN(d)}</td></tr>`;
                                    }).join('')}
                                        <tr style="background:#f1f5f9;font-weight:700"><td colspan="3">TOTAL</td><td class="r">${fmtN(totalInitial)}</td><td class="r">${fmtN(totalBalance)}</td><td class="r ${totalBalance - totalInitial >= 0 ? 's' : 'd'}">${totalBalance - totalInitial >= 0 ? '+' : ''}${fmtN(totalBalance - totalInitial)}</td></tr>
                                        </tbody></table>
                                        <div class="footer">${companyName} • ${accounts.length} rekening aktif</div>
                                    </body></html>`);
                                    w.document.close();
                                    setTimeout(() => { w.print(); }, 300);
                                }}><Printer size={14} /> Print</button>
                                <button className="modal-close" onClick={() => setShowPrint(false)}>×</button>
                            </div>
                        </div>
                        <div style={{ flex: 1, overflow: 'auto', padding: '1.5rem' }}>
                            {/* Preview company header */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem', paddingBottom: '0.75rem', borderBottom: '2px solid var(--border-color)' }}>
                                {companyLogo && <img src={companyLogo} alt="Logo" style={{ height: 40, width: 'auto', objectFit: 'contain' }} />}
                                <div style={{ flex: 1 }}>
                                    <div style={{ fontWeight: 800, fontSize: '1.1rem' }}>{companyName}</div>
                                    <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Laporan Rekening Bank</div>
                                </div>
                                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textAlign: 'right' }}>Dicetak:<br />{new Date().toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' })}</div>
                            </div>

                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                                <thead><tr style={{ background: 'var(--bg-secondary)' }}>
                                    {['Bank', 'No. Rekening', 'Atas Nama', 'Saldo Awal', 'Saldo Saat Ini', 'Perubahan'].map((h, i) => (
                                        <th key={h} style={{ padding: '0.5rem 0.6rem', textAlign: i >= 3 ? 'right' : 'left', fontWeight: 600, fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.03em', borderBottom: '2px solid var(--border-color)' }}>{h}</th>
                                    ))}
                                </tr></thead>
                                <tbody>
                                    {accounts.map(a => {
                                        const d = (a.currentBalance || 0) - (a.initialBalance || 0);
                                        return (
                                            <tr key={a._id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                                                <td style={{ padding: '0.5rem 0.6rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.4rem' }}><BankLogo name={a.bankName} size={22} /> {a.bankName}</td>
                                                <td style={{ padding: '0.5rem 0.6rem', fontFamily: 'monospace' }}>{a.accountNumber}</td>
                                                <td style={{ padding: '0.5rem 0.6rem' }}>{a.accountHolder}</td>
                                                <td style={{ padding: '0.5rem 0.6rem', textAlign: 'right' }}>{fmt(a.initialBalance || 0)}</td>
                                                <td style={{ padding: '0.5rem 0.6rem', textAlign: 'right', fontWeight: 700 }}>{fmt(a.currentBalance || 0)}</td>
                                                <td style={{ padding: '0.5rem 0.6rem', textAlign: 'right', color: d >= 0 ? 'var(--success)' : 'var(--danger)' }}>{d >= 0 ? '+' : ''}{fmt(d)}</td>
                                            </tr>
                                        );
                                    })}
                                    <tr style={{ background: 'var(--bg-secondary)', fontWeight: 700 }}>
                                        <td colSpan={3} style={{ padding: '0.6rem', textAlign: 'right' }}>TOTAL</td>
                                        <td style={{ padding: '0.6rem', textAlign: 'right' }}>{fmt(totalInitial)}</td>
                                        <td style={{ padding: '0.6rem', textAlign: 'right' }}>{fmt(totalBalance)}</td>
                                        <td style={{ padding: '0.6rem', textAlign: 'right', color: totalBalance - totalInitial >= 0 ? 'var(--success)' : 'var(--danger)' }}>{totalBalance - totalInitial >= 0 ? '+' : ''}{fmt(totalBalance - totalInitial)}</td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
