'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useToast } from '../../layout';
import { ArrowLeft, Plus, Save, X, CheckCircle, Printer, Trash2 } from 'lucide-react';
import { formatDate, formatCurrency } from '@/lib/utils';
import { openBrandedPrint, fetchCompanyProfile } from '@/lib/print';
import type { DriverVoucher, DriverVoucherItem } from '@/lib/types';

const STATUS_MAP: Record<string, { label: string; cls: string }> = {
    DRAFT: { label: 'Draft', cls: 'badge-gray' },
    ISSUED: { label: 'Diberikan', cls: 'badge-blue' },
    SETTLED: { label: 'Selesai', cls: 'badge-green' },
};

const EXPENSE_CATEGORIES = ['Solar/BBM', 'Tol', 'Parkir', 'Makan', 'Bongkar Muat', 'Perbaikan', 'Lain-lain'];

export default function DriverVoucherDetailPage() {
    const router = useRouter();
    const params = useParams();
    const { addToast } = useToast();
    const [voucher, setVoucher] = useState<DriverVoucher | null>(null);
    const [items, setItems] = useState<DriverVoucherItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [showAddItem, setShowAddItem] = useState(false);
    const [itemForm, setItemForm] = useState({ category: 'Solar/BBM', description: '', amount: 0 });

    useEffect(() => {
        let cancelled = false;
        Promise.all([
            fetch(`/api/data?entity=driver-vouchers&id=${params.id}`).then(r => r.json()),
            fetch(`/api/data?entity=driver-voucher-items&filter=${encodeURIComponent(JSON.stringify({ voucherRef: params.id }))}`).then(r => r.json()),
        ]).then(([vRes, iRes]) => {
            if (cancelled) return;
            setVoucher(vRes.data || null);
            setItems(iRes.data || []);
            setLoading(false);
        });
        return () => { cancelled = true; };
    }, [params.id]);

    const totalSpent = items.reduce((s, i) => s + i.amount, 0);
    const balance = (voucher?.cashGiven || 0) - totalSpent;

    const handleAddItem = async () => {
        if (!itemForm.amount || itemForm.amount <= 0) { addToast('error', 'Nominal harus diisi'); return; }
        const res = await fetch('/api/data', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ entity: 'driver-voucher-items', data: { ...itemForm, voucherRef: params.id } })
        });
        const d = await res.json();
        const newItems = [...items, d.data];
        setItems(newItems);
        const newTotal = newItems.reduce((s, i) => s + i.amount, 0);
        // Update voucher totals
        await fetch('/api/data', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ entity: 'driver-vouchers', action: 'update', data: { id: params.id, updates: { totalSpent: newTotal, balance: (voucher?.cashGiven || 0) - newTotal } } })
        });
        setVoucher(prev => prev ? { ...prev, totalSpent: newTotal, balance: (prev.cashGiven || 0) - newTotal } : null);
        addToast('success', 'Item pengeluaran ditambahkan');
        setShowAddItem(false);
        setItemForm({ category: 'Solar/BBM', description: '', amount: 0 });
    };

    const handleDeleteItem = async (itemId: string) => {
        await fetch('/api/data', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entity: 'driver-voucher-items', action: 'delete', data: { id: itemId } }) });
        const newItems = items.filter(i => i._id !== itemId);
        setItems(newItems);
        const newTotal = newItems.reduce((s, i) => s + i.amount, 0);
        await fetch('/api/data', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ entity: 'driver-vouchers', action: 'update', data: { id: params.id, updates: { totalSpent: newTotal, balance: (voucher?.cashGiven || 0) - newTotal } } })
        });
        setVoucher(prev => prev ? { ...prev, totalSpent: newTotal, balance: (prev.cashGiven || 0) - newTotal } : null);
        addToast('success', 'Item dihapus');
    };

    const handleSettle = async () => {
        if (!confirm('Selesaikan bon ini? Status akan berubah menjadi SELESAI dan tidak bisa diubah lagi.')) return;
        await fetch('/api/data', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                entity: 'driver-vouchers', action: 'update',
                data: { id: params.id, updates: { status: 'SETTLED', settledDate: new Date().toISOString(), totalSpent, balance } }
            })
        });
        setVoucher(prev => prev ? { ...prev, status: 'SETTLED', settledDate: new Date().toISOString() } : null);
        addToast('success', 'Bon supir telah diselesaikan');
    };

    const handlePrint = async () => {
        const co = await fetchCompanyProfile();
        openBrandedPrint({
            title: `Bon Supir ${voucher?.bonNumber}`, company: co, bodyHtml: `
            <div style="margin-bottom:16px">
                <table style="width:100%;border:none"><tbody>
                <tr><td style="border:none;padding:2px 8px;width:130px;font-weight:600">No. Bon</td><td style="border:none;padding:2px 8px">${voucher?.bonNumber}</td>
                    <td style="border:none;padding:2px 8px;width:130px;font-weight:600">Tanggal</td><td style="border:none;padding:2px 8px">${formatDate(voucher?.issuedDate || '')}</td></tr>
                <tr><td style="border:none;padding:2px 8px;font-weight:600">Supir</td><td style="border:none;padding:2px 8px">${voucher?.driverName || '-'}</td>
                    <td style="border:none;padding:2px 8px;font-weight:600">Kendaraan</td><td style="border:none;padding:2px 8px">${voucher?.vehiclePlate || '-'}</td></tr>
                <tr><td style="border:none;padding:2px 8px;font-weight:600">DO</td><td style="border:none;padding:2px 8px">${voucher?.doNumber || '-'}</td>
                    <td style="border:none;padding:2px 8px;font-weight:600">Rute</td><td style="border:none;padding:2px 8px">${voucher?.route || '-'}</td></tr>
                <tr><td style="border:none;padding:2px 8px;font-weight:600">Uang Diberikan</td><td style="border:none;padding:2px 8px;font-weight:700;font-size:1.05em">${formatCurrency(voucher?.cashGiven || 0)}</td>
                    <td style="border:none;padding:2px 8px;font-weight:600">Status</td><td style="border:none;padding:2px 8px">${STATUS_MAP[voucher?.status || '']?.label || voucher?.status}</td></tr>
                </tbody></table>
            </div>
            <table><thead><tr><th>No</th><th>Kategori</th><th>Deskripsi</th><th class="r">Jumlah</th></tr></thead>
            <tbody>${items.map((it, idx) => `<tr><td>${idx + 1}</td><td class="b">${it.category}</td><td>${it.description || '-'}</td><td class="r">${formatCurrency(it.amount)}</td></tr>`).join('')}
            <tr style="border-top:2px solid #1e293b"><td colspan="3" class="r b">Total Pengeluaran</td><td class="r b">${formatCurrency(totalSpent)}</td></tr>
            <tr><td colspan="3" class="r b">Uang Diberikan</td><td class="r">${formatCurrency(voucher?.cashGiven || 0)}</td></tr>
            <tr style="border-top:2px solid #1e293b"><td colspan="3" class="r b">${balance >= 0 ? 'Sisa Dikembalikan' : 'Kurang Bayar'}</td><td class="r b" style="color:${balance < 0 ? '#ef4444' : '#16a34a'}">${formatCurrency(Math.abs(balance))}</td></tr>
            </tbody></table>
            <div style="margin-top:40px;display:flex;justify-content:space-between">
                <div style="text-align:center;width:200px"><div style="margin-bottom:60px">Supir,</div><div style="border-top:1px solid #333;padding-top:4px">(${voucher?.driverName || '________________'})</div></div>
                <div style="text-align:center;width:200px"><div style="margin-bottom:60px">Mengetahui,</div><div style="border-top:1px solid #333;padding-top:4px">(________________)</div></div>
            </div>`
        });
    };

    if (loading || !voucher) return <div><div className="skeleton skeleton-title" /><div className="skeleton skeleton-card" style={{ height: 300 }} /></div>;

    const st = STATUS_MAP[voucher.status] || { label: voucher.status, cls: 'badge-gray' };
    const isSettled = voucher.status === 'SETTLED';

    return (
        <div>
            <div className="page-header">
                <div className="page-header-left" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <button className="btn-back" onClick={() => router.push('/driver-vouchers')}><ArrowLeft size={16} /></button>
                    <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
                            <h1 style={{ fontSize: '1.25rem', fontWeight: 700, margin: 0 }}>{voucher.bonNumber}</h1>
                            <span className={`badge ${st.cls}`}>● {st.label}</span>
                        </div>
                        <p className="page-subtitle" style={{ margin: 0 }}>{voucher.driverName} • {formatDate(voucher.issuedDate)}</p>
                    </div>
                </div>
                <div className="page-actions" style={{ flexWrap: 'wrap' }}>
                    {!isSettled && items.length > 0 && <button className="btn btn-primary" onClick={handleSettle}><CheckCircle size={16} /> Selesaikan Bon</button>}
                    <button className="btn btn-secondary btn-sm" onClick={handlePrint}><Printer size={15} /> Print Bon</button>
                </div>
            </div>

            {/* Info Cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 'var(--space-4)', marginBottom: 'var(--space-6)' }}>
                <div className="card"><div className="card-body" style={{ padding: 'var(--space-4)' }}>
                    <div className="text-muted" style={{ fontSize: '0.75rem', marginBottom: 2 }}>Uang Diberikan</div>
                    <div style={{ fontSize: '1.3rem', fontWeight: 700 }}>{formatCurrency(voucher.cashGiven)}</div>
                </div></div>
                <div className="card"><div className="card-body" style={{ padding: 'var(--space-4)' }}>
                    <div className="text-muted" style={{ fontSize: '0.75rem', marginBottom: 2 }}>Total Pengeluaran</div>
                    <div style={{ fontSize: '1.3rem', fontWeight: 700, color: '#ef4444' }}>{formatCurrency(totalSpent)}</div>
                </div></div>
                <div className="card"><div className="card-body" style={{ padding: 'var(--space-4)' }}>
                    <div className="text-muted" style={{ fontSize: '0.75rem', marginBottom: 2 }}>{balance >= 0 ? 'Sisa (Dikembalikan)' : 'Kurang Bayar'}</div>
                    <div style={{ fontSize: '1.3rem', fontWeight: 700, color: balance >= 0 ? '#16a34a' : '#ef4444' }}>{formatCurrency(Math.abs(balance))}</div>
                </div></div>
            </div>

            {/* Detail Info */}
            <div className="card" style={{ marginBottom: 'var(--space-6)' }}>
                <div className="card-header"><h3 className="card-title">Informasi Bon</h3></div>
                <div className="card-body">
                    <div className="detail-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 'var(--space-4)' }}>
                        <div><div className="text-muted" style={{ fontSize: '0.72rem', marginBottom: 2 }}>SUPIR</div><div className="font-medium">{voucher.driverName || '-'}</div></div>
                        <div><div className="text-muted" style={{ fontSize: '0.72rem', marginBottom: 2 }}>SURAT JALAN</div><div>{voucher.doNumber || '-'}</div></div>
                        <div><div className="text-muted" style={{ fontSize: '0.72rem', marginBottom: 2 }}>KENDARAAN</div><div>{voucher.vehiclePlate || '-'}</div></div>
                        <div><div className="text-muted" style={{ fontSize: '0.72rem', marginBottom: 2 }}>RUTE</div><div>{voucher.route || '-'}</div></div>
                        {voucher.notes && <div style={{ gridColumn: '1 / -1' }}><div className="text-muted" style={{ fontSize: '0.72rem', marginBottom: 2 }}>CATATAN</div><div>{voucher.notes}</div></div>}
                        {isSettled && voucher.settledDate && <div><div className="text-muted" style={{ fontSize: '0.72rem', marginBottom: 2 }}>TANGGAL SELESAI</div><div>{formatDate(voucher.settledDate)}</div></div>}
                    </div>
                </div>
            </div>

            {/* Expense Items */}
            <div className="card">
                <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h3 className="card-title">Detail Pengeluaran ({items.length})</h3>
                    {!isSettled && <button className="btn btn-primary btn-sm" onClick={() => setShowAddItem(true)}><Plus size={14} /> Tambah Item</button>}
                </div>
                <div className="card-body" style={{ padding: 0 }}>
                    <div className="table-wrapper">
                        <table>
                            <thead><tr><th>No</th><th>Kategori</th><th>Deskripsi</th><th>Jumlah</th>{!isSettled && <th>Aksi</th>}</tr></thead>
                            <tbody>
                                {items.length === 0 ? <tr><td colSpan={isSettled ? 4 : 5} style={{ textAlign: 'center', padding: 'var(--space-8)', color: 'var(--text-muted)' }}>Belum ada item pengeluaran</td></tr> :
                                    items.map((it, idx) => (
                                        <tr key={it._id}>
                                            <td>{idx + 1}</td>
                                            <td><span className="badge badge-gray">{it.category}</span></td>
                                            <td>{it.description || '-'}</td>
                                            <td className="font-medium">{formatCurrency(it.amount)}</td>
                                            {!isSettled && <td><button className="btn btn-ghost btn-sm" onClick={() => handleDeleteItem(it._id)}><Trash2 size={14} style={{ color: '#ef4444' }} /></button></td>}
                                        </tr>
                                    ))}
                                {items.length > 0 && <tr style={{ borderTop: '2px solid var(--border-color)', fontWeight: 700 }}><td colSpan={isSettled ? 3 : 3} style={{ textAlign: 'right' }}>TOTAL</td><td>{formatCurrency(totalSpent)}</td>{!isSettled && <td />}</tr>}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            {/* Add Item Modal */}
            {showAddItem && (
                <div className="modal-overlay" onClick={() => setShowAddItem(false)}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header"><h3 className="modal-title">Tambah Item Pengeluaran</h3><button className="modal-close" onClick={() => setShowAddItem(false)}><X size={20} /></button></div>
                        <div className="modal-body">
                            <div className="form-group">
                                <label className="form-label">Kategori</label>
                                <select className="form-select" value={itemForm.category} onChange={e => setItemForm({ ...itemForm, category: e.target.value })}>
                                    {EXPENSE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                                </select>
                            </div>
                            <div className="form-group">
                                <label className="form-label">Deskripsi</label>
                                <input className="form-input" value={itemForm.description} onChange={e => setItemForm({ ...itemForm, description: e.target.value })} placeholder="Keterangan pengeluaran..." />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Jumlah <span className="required">*</span></label>
                                <input type="number" className="form-input" value={itemForm.amount || ''} onChange={e => setItemForm({ ...itemForm, amount: Number(e.target.value) })} placeholder="0" />
                            </div>
                        </div>
                        <div className="modal-footer"><button className="btn btn-secondary" onClick={() => setShowAddItem(false)}>Batal</button><button className="btn btn-primary" onClick={handleAddItem}><Save size={16} /> Simpan</button></div>
                    </div>
                </div>
            )}
        </div>
    );
}
