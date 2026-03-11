'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, CheckCircle, Plus, Printer, Save, Trash2, X } from 'lucide-react';

import { useToast } from '../../layout';
import { fetchCompanyProfile, openBrandedPrint } from '@/lib/print';
import type { BankAccount, DriverVoucher, DriverVoucherItem } from '@/lib/types';
import { formatCurrency, formatDate } from '@/lib/utils';

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
    const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
    const [loading, setLoading] = useState(true);
    const [showAddItem, setShowAddItem] = useState(false);
    const [showSettleModal, setShowSettleModal] = useState(false);
    const [settling, setSettling] = useState(false);
    const [repairingIssueLedger, setRepairingIssueLedger] = useState(false);
    const [itemForm, setItemForm] = useState({ category: 'Solar/BBM', description: '', amount: 0 });
    const [settlementDate, setSettlementDate] = useState(new Date().toISOString().slice(0, 10));
    const [settlementBankRef, setSettlementBankRef] = useState('');
    const [issueBankRepairRef, setIssueBankRepairRef] = useState('');

    useEffect(() => {
        let cancelled = false;

        Promise.all([
            fetch(`/api/data?entity=driver-vouchers&id=${params.id}`).then(r => r.json()),
            fetch(`/api/data?entity=driver-voucher-items&filter=${encodeURIComponent(JSON.stringify({ voucherRef: params.id }))}`).then(r => r.json()),
            fetch('/api/data?entity=bank-accounts').then(r => r.json()),
        ]).then(([voucherRes, itemRes, bankRes]) => {
            if (cancelled) return;
            setVoucher(voucherRes.data || null);
            setItems(itemRes.data || []);
            setBankAccounts((bankRes.data || []).filter((account: BankAccount) => account.active !== false));
            setIssueBankRepairRef(voucherRes.data?.issueBankRef || '');
            setLoading(false);
        }).catch(() => {
            if (!cancelled) setLoading(false);
        });

        return () => { cancelled = true; };
    }, [params.id]);

    const totalSpent = items.reduce((sum, item) => sum + item.amount, 0);
    const balance = (voucher?.cashGiven || 0) - totalSpent;
    const isSettled = voucher?.status === 'SETTLED';

    const handleAddItem = async () => {
        if (!itemForm.amount || itemForm.amount <= 0) {
            addToast('error', 'Nominal harus diisi');
            return;
        }

        const res = await fetch('/api/data', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                entity: 'driver-voucher-items',
                data: {
                    voucherRef: params.id,
                    category: itemForm.category,
                    description: itemForm.description,
                    amount: itemForm.amount,
                },
            }),
        });
        const result = await res.json();
        if (!res.ok) {
            addToast('error', result.error || 'Gagal menambah item');
            return;
        }

        setItems(prev => [...prev, result.data]);
        if (result.voucher) {
            setVoucher(result.voucher);
        }
        addToast('success', 'Item pengeluaran ditambahkan');
        setShowAddItem(false);
        setItemForm({ category: 'Solar/BBM', description: '', amount: 0 });
    };

    const handleDeleteItem = async (itemId: string) => {
        const res = await fetch('/api/data', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                entity: 'driver-voucher-items',
                action: 'delete',
                data: { id: itemId },
            }),
        });
        const result = await res.json();
        if (!res.ok) {
            addToast('error', result.error || 'Gagal menghapus item');
            return;
        }

        setItems(prev => prev.filter(item => item._id !== itemId));
        if (result.voucher) {
            setVoucher(result.voucher);
        }
        addToast('success', 'Item dihapus');
    };

    const handleRepairIssueLedger = async () => {
        if (!voucher) return;
        if (!issueBankRepairRef) {
            addToast('error', 'Pilih rekening sumber untuk rekonsiliasi');
            return;
        }

        setRepairingIssueLedger(true);
        const res = await fetch('/api/data', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                entity: 'driver-vouchers',
                action: 'repair-issue-ledger',
                data: {
                    id: voucher._id,
                    issueBankRef: issueBankRepairRef,
                },
            }),
        });
        const result = await res.json();
        setRepairingIssueLedger(false);

        if (!res.ok) {
            addToast('error', result.error || 'Gagal merekonsiliasi pencairan bon');
            return;
        }

        setVoucher(result.data);
        addToast('success', 'Pencairan bon berhasil direkonsiliasi');
    };

    const openSettleModal = () => {
        if (!voucher) return;
        setSettlementDate(new Date().toISOString().slice(0, 10));
        setSettlementBankRef(voucher.issueBankRef || '');
        setShowSettleModal(true);
    };

    const handleSettle = async () => {
        if (!voucher) return;
        if (items.length === 0) {
            addToast('error', 'Tambahkan minimal satu item sebelum settlement');
            return;
        }
        if (balance !== 0 && !settlementBankRef) {
            addToast('error', 'Pilih rekening settlement untuk selisih bon');
            return;
        }

        setSettling(true);
        const res = await fetch('/api/data', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                entity: 'driver-vouchers',
                action: 'settle',
                data: {
                    id: params.id,
                    date: settlementDate,
                    settlementBankRef: settlementBankRef || undefined,
                },
            }),
        });
        const result = await res.json();
        setSettling(false);

        if (!res.ok) {
            addToast('error', result.error || 'Gagal menyelesaikan bon');
            return;
        }

        setVoucher(result.data);
        setShowSettleModal(false);
        addToast('success', 'Bon supir telah diselesaikan');
    };

    const handlePrint = async () => {
        const company = await fetchCompanyProfile();
        openBrandedPrint({
            title: `Bon Supir ${voucher?.bonNumber}`,
            company,
            bodyHtml: `
            <div style="margin-bottom:16px">
                <table style="width:100%;border:none"><tbody>
                <tr><td style="border:none;padding:2px 8px;width:130px;font-weight:600">No. Bon</td><td style="border:none;padding:2px 8px">${voucher?.bonNumber}</td>
                    <td style="border:none;padding:2px 8px;width:130px;font-weight:600">Tanggal</td><td style="border:none;padding:2px 8px">${formatDate(voucher?.issuedDate || '')}</td></tr>
                <tr><td style="border:none;padding:2px 8px;font-weight:600">Supir</td><td style="border:none;padding:2px 8px">${voucher?.driverName || '-'}</td>
                    <td style="border:none;padding:2px 8px;font-weight:600">Kendaraan</td><td style="border:none;padding:2px 8px">${voucher?.vehiclePlate || '-'}</td></tr>
                <tr><td style="border:none;padding:2px 8px;font-weight:600">DO</td><td style="border:none;padding:2px 8px">${voucher?.doNumber || '-'}</td>
                    <td style="border:none;padding:2px 8px;font-weight:600">Rute</td><td style="border:none;padding:2px 8px">${voucher?.route || '-'}</td></tr>
                <tr><td style="border:none;padding:2px 8px;font-weight:600">Uang Diberikan</td><td style="border:none;padding:2px 8px;font-weight:700;font-size:1.05em">${formatCurrency(voucher?.cashGiven || 0)}</td>
                    <td style="border:none;padding:2px 8px;font-weight:600">Rekening Sumber</td><td style="border:none;padding:2px 8px">${voucher?.issueBankName || '-'}</td></tr>
                <tr><td style="border:none;padding:2px 8px;font-weight:600">Status</td><td style="border:none;padding:2px 8px">${STATUS_MAP[voucher?.status || '']?.label || voucher?.status}</td>
                    <td style="border:none;padding:2px 8px;font-weight:600">Rekening Settlement</td><td style="border:none;padding:2px 8px">${voucher?.settlementBankName || '-'}</td></tr>
                </tbody></table>
            </div>
            <table><thead><tr><th>No</th><th>Kategori</th><th>Deskripsi</th><th class="r">Jumlah</th></tr></thead>
            <tbody>${items.map((item, index) => `<tr><td>${index + 1}</td><td class="b">${item.category}</td><td>${item.description || '-'}</td><td class="r">${formatCurrency(item.amount)}</td></tr>`).join('')}
            <tr style="border-top:2px solid #1e293b"><td colspan="3" class="r b">Total Pengeluaran</td><td class="r b">${formatCurrency(totalSpent)}</td></tr>
            <tr><td colspan="3" class="r b">Uang Diberikan</td><td class="r">${formatCurrency(voucher?.cashGiven || 0)}</td></tr>
            <tr style="border-top:2px solid #1e293b"><td colspan="3" class="r b">${balance >= 0 ? 'Sisa Dikembalikan' : 'Kurang Bayar'}</td><td class="r b" style="color:${balance < 0 ? '#ef4444' : '#16a34a'}">${formatCurrency(Math.abs(balance))}</td></tr>
            </tbody></table>
            <div style="margin-top:40px;display:flex;justify-content:space-between">
                <div style="text-align:center;width:200px"><div style="margin-bottom:60px">Supir,</div><div style="border-top:1px solid #333;padding-top:4px">(${voucher?.driverName || '________________'})</div></div>
                <div style="text-align:center;width:200px"><div style="margin-bottom:60px">Mengetahui,</div><div style="border-top:1px solid #333;padding-top:4px">(________________)</div></div>
            </div>`,
        });
    };

    if (loading || !voucher) {
        return <div><div className="skeleton skeleton-title" /><div className="skeleton skeleton-card" style={{ height: 300 }} /></div>;
    }

    const statusConfig = STATUS_MAP[voucher.status] || { label: voucher.status, cls: 'badge-gray' };
    const settlementLabel = balance > 0 ? 'Sisa akan kembali ke rekening' : balance < 0 ? 'Tambahan pembayaran diperlukan' : 'Tidak ada selisih';

    return (
        <div>
            <div className="page-header">
                <div className="page-header-left" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <button className="btn-back" onClick={() => router.push('/driver-vouchers')}><ArrowLeft size={16} /></button>
                    <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
                            <h1 style={{ fontSize: '1.25rem', fontWeight: 700, margin: 0 }}>{voucher.bonNumber}</h1>
                            <span className={`badge ${statusConfig.cls}`}>* {statusConfig.label}</span>
                        </div>
                        <p className="page-subtitle" style={{ margin: 0 }}>{voucher.driverName} | {formatDate(voucher.issuedDate)}</p>
                    </div>
                </div>
                <div className="page-actions" style={{ flexWrap: 'wrap' }}>
                    {!isSettled && items.length > 0 && <button className="btn btn-primary" onClick={openSettleModal}><CheckCircle size={16} /> Selesaikan Bon</button>}
                    <button className="btn btn-secondary btn-sm" onClick={handlePrint}><Printer size={15} /> Print Bon</button>
                </div>
            </div>

            {!voucher.issueBankRef && (
                <div className="card" style={{ marginBottom: '1rem', border: '1px solid #f59e0b', background: 'rgba(245,158,11,0.08)' }}>
                    <div className="card-body" style={{ padding: '1rem' }}>
                        <div style={{ fontWeight: 700, marginBottom: '0.35rem', color: '#92400e' }}>Bon legacy belum direkonsiliasi</div>
                        <div style={{ fontSize: '0.82rem', color: '#92400e', marginBottom: '0.85rem' }}>
                            Bon ini belum punya rekening sumber dan belum membentuk mutasi pencairan. Pilih rekening yang benar lalu posting pencairan agar laporan kas konsisten.
                        </div>
                        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                            <div className="form-group" style={{ minWidth: 260, marginBottom: 0 }}>
                                <label className="form-label">Rekening Sumber</label>
                                <select className="form-select" value={issueBankRepairRef} onChange={event => setIssueBankRepairRef(event.target.value)}>
                                    <option value="">Pilih rekening</option>
                                    {bankAccounts.map(account => <option key={account._id} value={account._id}>{account.bankName} - {account.accountNumber}</option>)}
                                </select>
                            </div>
                            <button className="btn btn-primary" onClick={handleRepairIssueLedger} disabled={repairingIssueLedger}>
                                <CheckCircle size={16} /> {repairingIssueLedger ? 'Memproses...' : 'Posting Pencairan Legacy'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

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

            <div className="card" style={{ marginBottom: 'var(--space-6)' }}>
                <div className="card-header"><h3 className="card-title">Informasi Bon</h3></div>
                <div className="card-body">
                    <div className="detail-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 'var(--space-4)' }}>
                        <div><div className="text-muted" style={{ fontSize: '0.72rem', marginBottom: 2 }}>SUPIR</div><div className="font-medium">{voucher.driverName || '-'}</div></div>
                        <div><div className="text-muted" style={{ fontSize: '0.72rem', marginBottom: 2 }}>SURAT JALAN</div><div>{voucher.doNumber || '-'}</div></div>
                        <div><div className="text-muted" style={{ fontSize: '0.72rem', marginBottom: 2 }}>KENDARAAN</div><div>{voucher.vehiclePlate || '-'}</div></div>
                        <div><div className="text-muted" style={{ fontSize: '0.72rem', marginBottom: 2 }}>RUTE</div><div>{voucher.route || '-'}</div></div>
                        <div><div className="text-muted" style={{ fontSize: '0.72rem', marginBottom: 2 }}>REKENING SUMBER</div><div>{voucher.issueBankName || '-'}</div></div>
                        {voucher.notes && <div style={{ gridColumn: '1 / -1' }}><div className="text-muted" style={{ fontSize: '0.72rem', marginBottom: 2 }}>CATATAN</div><div>{voucher.notes}</div></div>}
                        {isSettled && voucher.settledDate && <div><div className="text-muted" style={{ fontSize: '0.72rem', marginBottom: 2 }}>TANGGAL SELESAI</div><div>{formatDate(voucher.settledDate)}</div></div>}
                        {isSettled && <div><div className="text-muted" style={{ fontSize: '0.72rem', marginBottom: 2 }}>REKENING SETTLEMENT</div><div>{voucher.settlementBankName || '-'}</div></div>}
                    </div>
                </div>
            </div>

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
                                {items.length === 0 ? (
                                    <tr><td colSpan={isSettled ? 4 : 5} style={{ textAlign: 'center', padding: 'var(--space-8)', color: 'var(--text-muted)' }}>Belum ada item pengeluaran</td></tr>
                                ) : (
                                    items.map((item, index) => (
                                        <tr key={item._id}>
                                            <td>{index + 1}</td>
                                            <td><span className="badge badge-gray">{item.category}</span></td>
                                            <td>{item.description || '-'}</td>
                                            <td className="font-medium">{formatCurrency(item.amount)}</td>
                                            {!isSettled && <td><button className="btn btn-ghost btn-sm" onClick={() => handleDeleteItem(item._id)}><Trash2 size={14} style={{ color: '#ef4444' }} /></button></td>}
                                        </tr>
                                    ))
                                )}
                                {items.length > 0 && <tr style={{ borderTop: '2px solid var(--border-color)', fontWeight: 700 }}><td colSpan={3} style={{ textAlign: 'right' }}>TOTAL</td><td>{formatCurrency(totalSpent)}</td>{!isSettled && <td />}</tr>}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            {showAddItem && (
                <div className="modal-overlay" onClick={() => setShowAddItem(false)}>
                    <div className="modal" onClick={event => event.stopPropagation()}>
                        <div className="modal-header"><h3 className="modal-title">Tambah Item Pengeluaran</h3><button className="modal-close" onClick={() => setShowAddItem(false)}><X size={20} /></button></div>
                        <div className="modal-body">
                            <div className="form-group">
                                <label className="form-label">Kategori</label>
                                <select className="form-select" value={itemForm.category} onChange={event => setItemForm({ ...itemForm, category: event.target.value })}>
                                    {EXPENSE_CATEGORIES.map(category => <option key={category} value={category}>{category}</option>)}
                                </select>
                            </div>
                            <div className="form-group">
                                <label className="form-label">Deskripsi</label>
                                <input className="form-input" value={itemForm.description} onChange={event => setItemForm({ ...itemForm, description: event.target.value })} placeholder="Keterangan pengeluaran..." />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Jumlah <span className="required">*</span></label>
                                <input type="number" className="form-input" value={itemForm.amount || ''} onChange={event => setItemForm({ ...itemForm, amount: Number(event.target.value) })} placeholder="0" />
                            </div>
                        </div>
                        <div className="modal-footer"><button className="btn btn-secondary" onClick={() => setShowAddItem(false)}>Batal</button><button className="btn btn-primary" onClick={handleAddItem}><Save size={16} /> Simpan</button></div>
                    </div>
                </div>
            )}

            {showSettleModal && (
                <div className="modal-overlay" onClick={() => setShowSettleModal(false)}>
                    <div className="modal" onClick={event => event.stopPropagation()}>
                        <div className="modal-header"><h3 className="modal-title">Settlement Bon Supir</h3><button className="modal-close" onClick={() => setShowSettleModal(false)}><X size={20} /></button></div>
                        <div className="modal-body">
                            <div className="form-group">
                                <label className="form-label">Tanggal Settlement</label>
                                <input type="date" className="form-input" value={settlementDate} onChange={event => setSettlementDate(event.target.value)} />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Rekening Settlement {balance !== 0 ? <span className="required">*</span> : null}</label>
                                <select className="form-select" value={settlementBankRef} onChange={event => setSettlementBankRef(event.target.value)}>
                                    <option value="">Pilih rekening</option>
                                    {bankAccounts.map(account => <option key={account._id} value={account._id}>{account.bankName} - {account.accountNumber}</option>)}
                                </select>
                                <div className="text-muted" style={{ fontSize: '0.78rem', marginTop: '0.35rem' }}>{settlementLabel}</div>
                            </div>
                            <div style={{ background: 'var(--color-bg-secondary)', borderRadius: '0.6rem', padding: '0.85rem 1rem' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.4rem' }}><span>Total Pengeluaran</span><strong>{formatCurrency(totalSpent)}</strong></div>
                                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>{balance >= 0 ? 'Sisa Dikembalikan' : 'Kurang Bayar'}</span><strong style={{ color: balance >= 0 ? '#16a34a' : '#ef4444' }}>{formatCurrency(Math.abs(balance))}</strong></div>
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setShowSettleModal(false)}>Batal</button>
                            <button className="btn btn-primary" onClick={handleSettle} disabled={settling}><CheckCircle size={16} /> {settling ? 'Memproses...' : 'Selesaikan Bon'}</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
