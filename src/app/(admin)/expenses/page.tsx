'use client';

import { useState, useEffect } from 'react';
import { useToast, useApp } from '../layout';
import { Plus, Search, Wallet, Save, X, FileDown, Printer } from 'lucide-react';
import { formatDate, formatCurrency } from '@/lib/utils';
import { exportExpenses } from '@/lib/export';
import { openBrandedPrint, fetchCompanyProfile } from '@/lib/print';
import type { Expense, ExpenseCategory } from '@/lib/types';

export default function ExpensesPage() {
    const { addToast } = useToast();
    const { user } = useApp();
    const [items, setItems] = useState<Expense[]>([]);
    const [categories, setCategories] = useState<ExpenseCategory[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [showModal, setShowModal] = useState(false);
    const [form, setForm] = useState({ categoryRef: '', date: new Date().toISOString().split('T')[0], amount: 0, note: '', description: '', privacyLevel: 'internal' as 'internal' | 'ownerOnly' });

    useEffect(() => {
        Promise.all([fetch('/api/data?entity=expenses').then(r => r.json()), fetch('/api/data?entity=expense-categories').then(r => r.json())]).then(([e, c]) => { setItems(e.data || []); setCategories(c.data || []); setLoading(false); });
    }, []);

    const isOwner = user?.role === 'OWNER';
    const filtered = items.filter(e => !search || e.note?.toLowerCase().includes(search.toLowerCase()) || e.categoryName?.toLowerCase().includes(search.toLowerCase()));

    const handleSave = async () => {
        if (!form.categoryRef || !form.amount) { addToast('error', 'Kategori dan nominal wajib'); return; }
        const cat = categories.find(c => c._id === form.categoryRef);
        const res = await fetch('/api/data', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entity: 'expenses', data: { ...form, categoryName: cat?.name || '' } }) });
        const d = await res.json();
        if (!res.ok) {
            addToast('error', d.error || 'Gagal mencatat pengeluaran');
            return;
        }
        setItems(prev => [...prev, d.data]);
        addToast('success', 'Pengeluaran dicatat');
        setShowModal(false);
        setForm({ categoryRef: '', date: new Date().toISOString().split('T')[0], amount: 0, note: '', description: '', privacyLevel: 'internal' });
    };

    // Compute totals per category for breakdown
    const categoryTotals = filtered.reduce<Record<string, number>>((acc, e) => {
        const cat = e.categoryName || 'Lainnya';
        acc[cat] = (acc[cat] || 0) + e.amount;
        return acc;
    }, {});
    const grandTotal = filtered.reduce((s, e) => s + e.amount, 0);
    const avgAmount = filtered.length > 0 ? grandTotal / filtered.length : 0;

    return (
        <div>
            <div className="page-header"><div className="page-header-left"><h1 className="page-title">Pengeluaran</h1><p className="page-subtitle">Kelola catatan pengeluaran</p></div>
                <div className="page-actions" style={{ flexWrap: 'wrap' }}>
                    <button className="btn btn-secondary btn-sm" onClick={() => exportExpenses(filtered as unknown as Record<string, unknown>[])}><FileDown size={15} /> Excel</button>
                    <button className="btn btn-secondary btn-sm" onClick={async () => {
                        const co = await fetchCompanyProfile();
                        openBrandedPrint({
                            title: 'Daftar Pengeluaran', company: co, bodyHtml: `
                            <table><thead><tr><th>Tanggal</th><th>Kategori</th><th>Deskripsi</th><th class="r">Jumlah</th></tr></thead>
                            <tbody>${filtered.map(e => `<tr><td>${formatDate(e.date)}</td><td class="b">${e.categoryName || '-'}</td><td>${e.note || e.description || '-'}</td><td class="r b">${formatCurrency(e.amount)}</td></tr>`).join('')}
                            <tr style="border-top:2px solid #1e293b"><td colspan="3" class="r b">TOTAL</td><td class="r b">${formatCurrency(filtered.reduce((s, e) => s + e.amount, 0))}</td></tr></tbody></table>`
                        });
                    }}><Printer size={15} /> Print</button>
                    <button className="btn btn-primary" onClick={() => setShowModal(true)}><Plus size={18} /> Tambah Pengeluaran</button>
                </div></div>

            {/* KPI Summary */}
            <div className="kpi-grid" style={{ marginBottom: '1.5rem' }}>
                <div className="kpi-card">
                    <div className="kpi-icon danger"><Wallet size={20} /></div>
                    <div className="kpi-content">
                        <div className="kpi-label">Total Pengeluaran</div>
                        <div className="kpi-value" style={{ fontSize: '1.1rem', color: 'var(--color-danger)' }}>{formatCurrency(grandTotal)}</div>
                    </div>
                </div>
                <div className="kpi-card">
                    <div className="kpi-icon info"><Search size={20} /></div>
                    <div className="kpi-content">
                        <div className="kpi-label">Jumlah Transaksi</div>
                        <div className="kpi-value">{filtered.length}</div>
                    </div>
                </div>
                <div className="kpi-card">
                    <div className="kpi-icon warning"><Wallet size={20} /></div>
                    <div className="kpi-content">
                        <div className="kpi-label">Rata-rata / Transaksi</div>
                        <div className="kpi-value" style={{ fontSize: '1rem' }}>{formatCurrency(Math.round(avgAmount))}</div>
                    </div>
                </div>
            </div>

            {/* Category Breakdown */}
            {!loading && Object.keys(categoryTotals).length > 1 && (
                <div className="card" style={{ marginBottom: '1rem', padding: '0.875rem 1rem' }}>
                    <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Breakdown per Kategori</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                        {Object.entries(categoryTotals).sort((a, b) => b[1] - a[1]).map(([cat, total]) => (
                            <div key={cat} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)', borderRadius: 8, padding: '0.4rem 0.75rem' }}>
                                <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-text-primary)' }}>{cat}</span>
                                <span style={{ fontSize: '0.8rem', color: 'var(--color-danger)', fontWeight: 700 }}>{formatCurrency(total)}</span>
                                <span style={{ fontSize: '0.72rem', color: 'var(--color-text-secondary)' }}>({grandTotal > 0 ? Math.round((total / grandTotal) * 100) : 0}%)</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            <div className="table-container">
                <div className="table-toolbar"><div className="table-toolbar-left"><div className="table-search"><Search size={16} className="table-search-icon" /><input placeholder="Cari..." value={search} onChange={e => setSearch(e.target.value)} /></div></div></div>
                <div className="table-wrapper">
                    <table>
                        <thead><tr><th>Tanggal</th><th>Kategori</th><th>Deskripsi</th><th>Jumlah</th>{isOwner && <th>Privacy</th>}</tr></thead>
                        <tbody>
                            {loading ? [1, 2, 3].map(i => <tr key={i}>{[1, 2, 3, 4].map(j => <td key={j}><div className="skeleton skeleton-text" /></td>)}</tr>) :
                                filtered.length === 0 ? <tr><td colSpan={isOwner ? 5 : 4}><div className="empty-state"><Wallet size={48} className="empty-state-icon" /><div className="empty-state-title">Belum ada pengeluaran</div></div></td></tr> :
                                    filtered.map(e => (
                                        <tr key={e._id}>
                                            <td className="text-muted">{formatDate(e.date)}</td>
                                            <td><span className="badge badge-gray">{e.categoryName}</span></td>
                                            <td>{e.note || e.description}</td>
                                            <td className="font-medium">{formatCurrency(e.amount)}</td>
                                            {isOwner && <td><span className={`badge ${e.privacyLevel === 'ownerOnly' ? 'badge-purple' : 'badge-info'}`}>{e.privacyLevel === 'ownerOnly' ? 'Owner Only' : 'Internal'}</span></td>}
                                        </tr>
                                    ))}
                            {/* Total row */}
                            {!loading && filtered.length > 0 && (
                                <tr style={{ background: 'var(--color-bg-secondary)', borderTop: '2px solid var(--color-border)' }}>
                                    <td colSpan={isOwner ? 3 : 3} className="font-semibold" style={{ textAlign: 'right', color: 'var(--color-text-secondary)', fontSize: '0.85rem' }}>TOTAL</td>
                                    <td className="font-semibold" style={{ color: 'var(--color-danger)', fontSize: '1rem' }}>{formatCurrency(grandTotal)}</td>
                                    {isOwner && <td />}
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
                {filtered.length > 0 && <div className="pagination"><div className="pagination-info">Menampilkan {filtered.length} transaksi | Total: <strong style={{ color: 'var(--color-danger)' }}>{formatCurrency(grandTotal)}</strong></div></div>}
            </div>


            {showModal && (
                <div className="modal-overlay" onClick={() => setShowModal(false)}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header"><h3 className="modal-title">Tambah Pengeluaran</h3><button className="modal-close" onClick={() => setShowModal(false)}><X size={20} /></button></div>
                        <div className="modal-body">
                            <div className="form-group"><label className="form-label">Kategori <span className="required">*</span></label>
                                <select className="form-select" value={form.categoryRef} onChange={e => setForm({ ...form, categoryRef: e.target.value })}>
                                    <option value="">Pilih kategori</option>{categories.filter(c => c.active).map(c => <option key={c._id} value={c._id}>{c.name}</option>)}
                                </select>
                            </div>
                            <div className="form-row">
                                <div className="form-group"><label className="form-label">Tanggal</label><input type="date" className="form-input" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} /></div>
                                <div className="form-group"><label className="form-label">Nominal <span className="required">*</span></label><input type="number" className="form-input" value={form.amount || ''} onChange={e => setForm({ ...form, amount: Number(e.target.value) })} /></div>
                            </div>
                            <div className="form-group"><label className="form-label">Catatan/Deskripsi</label><textarea className="form-textarea" rows={2} value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} /></div>
                            {isOwner && <div className="form-group"><label className="form-label">Privacy Level</label>
                                <select className="form-select" value={form.privacyLevel} onChange={e => setForm({ ...form, privacyLevel: e.target.value as 'internal' | 'ownerOnly' })}>
                                    <option value="internal">Internal</option><option value="ownerOnly">Owner Only</option>
                                </select>
                            </div>}
                        </div>
                        <div className="modal-footer"><button className="btn btn-secondary" onClick={() => setShowModal(false)}>Batal</button><button className="btn btn-primary" onClick={handleSave}><Save size={16} /> Simpan</button></div>
                    </div>
                </div>
            )}
        </div>
    );
}
