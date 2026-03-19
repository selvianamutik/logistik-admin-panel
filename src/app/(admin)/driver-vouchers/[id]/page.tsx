'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, CheckCircle, Plus, Printer, Save, Trash2, X } from 'lucide-react';

import CurrencyInput from '@/components/CurrencyInput';
import { useToast } from '../../layout';
import { fetchCompanyProfile, openBrandedPrint } from '@/lib/print';
import type { BankAccount, DriverVoucher, DriverVoucherItem } from '@/lib/types';
import { formatCurrency, formatDate } from '@/lib/utils';

const STATUS_MAP: Record<string, { label: string; cls: string }> = {
    DRAFT: { label: 'Draft', cls: 'badge-gray' },
    ISSUED: { label: 'Diberikan', cls: 'badge-blue' },
    SETTLED: { label: 'Selesai', cls: 'badge-green' },
};

const EXPENSE_CATEGORIES = ['BBM / Solar', 'Tol & Parkir', 'Parkir', 'Makan', 'Menginap', 'Bongkar Muat', 'Perbaikan', 'Lain-lain'];

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
    const [savingItem, setSavingItem] = useState(false);
    const [deletingItemId, setDeletingItemId] = useState<string | null>(null);
    const [repairingIssueLedger, setRepairingIssueLedger] = useState(false);
    const [itemForm, setItemForm] = useState({
        expenseDate: new Date().toISOString().slice(0, 10),
        category: 'BBM / Solar',
        description: '',
        amount: 0,
    });
    const [settlementDate, setSettlementDate] = useState(new Date().toISOString().slice(0, 10));
    const [settlementBankRef, setSettlementBankRef] = useState('');
    const [issueBankRepairRef, setIssueBankRepairRef] = useState('');

    const loadVoucherDetail = useCallback(async () => {
        const fetchEntity = async <T,>(url: string) => {
            const res = await fetch(url);
            const payload = await res.json();
            if (!res.ok) {
                throw new Error(payload.error || 'Gagal memuat detail bon supir');
            }
            return payload.data as T;
        };

        setLoading(true);
        try {
            const [voucherData, voucherItems, accounts] = await Promise.all([
                fetchEntity<DriverVoucher | null>(`/api/data?entity=driver-vouchers&id=${params.id}`),
                fetchEntity<DriverVoucherItem[]>(`/api/data?entity=driver-voucher-items&filter=${encodeURIComponent(JSON.stringify({ voucherRef: params.id }))}`),
                fetchEntity<BankAccount[]>('/api/data?entity=bank-accounts'),
            ]);
            setVoucher(voucherData || null);
            setItems(voucherItems || []);
            setBankAccounts((accounts || []).filter((account) => account.active !== false));
            setIssueBankRepairRef(voucherData?.issueBankRef || '');
        } catch (error) {
            addToast('error', error instanceof Error ? error.message : 'Gagal memuat detail bon supir');
        } finally {
            setLoading(false);
        }
    }, [addToast, params.id]);

    useEffect(() => {
        void loadVoucherDetail();
    }, [loadVoucherDetail]);

    const operationalSpent = items.reduce((sum, item) => sum + item.amount, 0);
    const driverFeeAmount = voucher?.driverFeeAmount || 0;
    const totalClaimAmount = operationalSpent + driverFeeAmount;
    const balance = (voucher?.cashGiven || 0) - totalClaimAmount;
    const isSettled = voucher?.status === 'SETTLED';

    const handleAddItem = async () => {
        if (!itemForm.amount || itemForm.amount <= 0) {
            addToast('error', 'Nominal harus diisi');
            return;
        }

        setSavingItem(true);
        try {
            const res = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    entity: 'driver-voucher-items',
                    data: {
                        voucherRef: params.id,
                        expenseDate: itemForm.expenseDate,
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
            setItems(prev => [...prev, result.data].sort((a, b) => (a.expenseDate || '').localeCompare(b.expenseDate || '')));
            if (result.voucher) {
                setVoucher(result.voucher);
            }
            addToast('success', 'Item pengeluaran ditambahkan');
            setShowAddItem(false);
            setItemForm({
                expenseDate: new Date().toISOString().slice(0, 10),
                category: 'BBM / Solar',
                description: '',
                amount: 0,
            });
        } catch {
            addToast('error', 'Gagal menambah item');
        } finally {
            setSavingItem(false);
        }
    };

    const handleDeleteItem = async (itemId: string) => {
        setDeletingItemId(itemId);
        try {
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
        } catch {
            addToast('error', 'Gagal menghapus item');
        } finally {
            setDeletingItemId(current => current === itemId ? null : current);
        }
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
        if (items.length === 0 && driverFeeAmount <= 0) {
            addToast('error', 'Isi biaya perjalanan atau upah supir sebelum settlement');
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
                <tr><td style="border:none;padding:2px 8px;font-weight:600">Uang Jalan Awal</td><td style="border:none;padding:2px 8px;font-weight:700;font-size:1.05em">${formatCurrency(voucher?.cashGiven || 0)}</td>
                    <td style="border:none;padding:2px 8px;font-weight:600">Rekening Sumber</td><td style="border:none;padding:2px 8px">${voucher?.issueBankName || '-'}</td></tr>
                <tr><td style="border:none;padding:2px 8px;font-weight:600">Upah Trip</td><td style="border:none;padding:2px 8px">${formatCurrency(driverFeeAmount)}</td>
                    <td style="border:none;padding:2px 8px;font-weight:600">Biaya Perjalanan</td><td style="border:none;padding:2px 8px">${formatCurrency(operationalSpent)}</td></tr>
                <tr><td style="border:none;padding:2px 8px;font-weight:600">Status</td><td style="border:none;padding:2px 8px">${STATUS_MAP[voucher?.status || '']?.label || voucher?.status}</td>
                    <td style="border:none;padding:2px 8px;font-weight:600">Rekening Settlement</td><td style="border:none;padding:2px 8px">${voucher?.settlementBankName || '-'}</td></tr>
                </tbody></table>
            </div>
            <table><thead><tr><th>No</th><th>Tanggal</th><th>Kategori</th><th>Deskripsi</th><th class="r">Jumlah</th></tr></thead>
            <tbody>${items.map((item, index) => `<tr><td>${index + 1}</td><td>${item.expenseDate ? formatDate(item.expenseDate) : '-'}</td><td class="b">${item.category}</td><td>${item.description || '-'}</td><td class="r">${formatCurrency(item.amount)}</td></tr>`).join('')}
            <tr style="border-top:2px solid #1e293b"><td colspan="4" class="r b">Total Biaya Perjalanan</td><td class="r b">${formatCurrency(operationalSpent)}</td></tr>
            <tr><td colspan="4" class="r b">Upah Trip</td><td class="r">${formatCurrency(driverFeeAmount)}</td></tr>
            <tr><td colspan="4" class="r b">Total Hak Trip</td><td class="r">${formatCurrency(totalClaimAmount)}</td></tr>
            <tr><td colspan="4" class="r b">Uang Jalan Awal</td><td class="r">${formatCurrency(voucher?.cashGiven || 0)}</td></tr>
            <tr style="border-top:2px solid #1e293b"><td colspan="4" class="r b">${balance >= 0 ? 'Sisa Dikembalikan' : 'Tambahan Bayar ke Supir'}</td><td class="r b" style="color:${balance < 0 ? '#ef4444' : '#16a34a'}">${formatCurrency(Math.abs(balance))}</td></tr>
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
    const settlementLabel = balance > 0 ? 'Sisa akan kembali ke rekening atau kas perusahaan' : balance < 0 ? 'Perusahaan masih perlu menambah pembayaran ke supir' : 'Tidak ada selisih';

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
                    {!isSettled && (items.length > 0 || driverFeeAmount > 0) && <button className="btn btn-primary" onClick={openSettleModal}><CheckCircle size={16} /> Selesaikan Bon</button>}
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
                                <label className="form-label">Rekening / Kas Sumber</label>
                                <select className="form-select" value={issueBankRepairRef} onChange={event => setIssueBankRepairRef(event.target.value)}>
                                    <option value="">Pilih rekening atau kas</option>
                                    {bankAccounts.map(account => <option key={account._id} value={account._id}>{account.bankName} - {account.accountNumber}{account.accountType === 'CASH' ? ' (Kas Tunai)' : ''}</option>)}
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
                    <div className="text-muted" style={{ fontSize: '0.75rem', marginBottom: 2 }}>Uang Jalan Awal</div>
                    <div style={{ fontSize: '1.3rem', fontWeight: 700 }}>{formatCurrency(voucher.cashGiven)}</div>
                </div></div>
                <div className="card"><div className="card-body" style={{ padding: 'var(--space-4)' }}>
                    <div className="text-muted" style={{ fontSize: '0.75rem', marginBottom: 2 }}>Biaya Perjalanan</div>
                    <div style={{ fontSize: '1.3rem', fontWeight: 700, color: '#ef4444' }}>{formatCurrency(operationalSpent)}</div>
                </div></div>
                <div className="card"><div className="card-body" style={{ padding: 'var(--space-4)' }}>
                    <div className="text-muted" style={{ fontSize: '0.75rem', marginBottom: 2 }}>Upah Trip</div>
                    <div style={{ fontSize: '1.3rem', fontWeight: 700 }}>{formatCurrency(driverFeeAmount)}</div>
                </div></div>
                <div className="card"><div className="card-body" style={{ padding: 'var(--space-4)' }}>
                    <div className="text-muted" style={{ fontSize: '0.75rem', marginBottom: 2 }}>Total Hak Trip</div>
                    <div style={{ fontSize: '1.3rem', fontWeight: 700 }}>{formatCurrency(totalClaimAmount)}</div>
                </div></div>
                <div className="card"><div className="card-body" style={{ padding: 'var(--space-4)' }}>
                    <div className="text-muted" style={{ fontSize: '0.75rem', marginBottom: 2 }}>{balance >= 0 ? 'Sisa (Dikembalikan)' : 'Tambahan Bayar'}</div>
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
                        <div><div className="text-muted" style={{ fontSize: '0.72rem', marginBottom: 2 }}>UPAH TRIP</div><div>{formatCurrency(driverFeeAmount)}</div></div>
                        <div><div className="text-muted" style={{ fontSize: '0.72rem', marginBottom: 2 }}>REKENING SUMBER</div><div>{voucher.issueBankName || '-'}</div></div>
                        {voucher.notes && <div style={{ gridColumn: '1 / -1' }}><div className="text-muted" style={{ fontSize: '0.72rem', marginBottom: 2 }}>CATATAN</div><div>{voucher.notes}</div></div>}
                        {isSettled && voucher.settledDate && <div><div className="text-muted" style={{ fontSize: '0.72rem', marginBottom: 2 }}>TANGGAL SELESAI</div><div>{formatDate(voucher.settledDate)}</div></div>}
                        {isSettled && <div><div className="text-muted" style={{ fontSize: '0.72rem', marginBottom: 2 }}>REKENING SETTLEMENT</div><div>{voucher.settlementBankName || '-'}</div></div>}
                    </div>
                </div>
            </div>

            <div className="card">
                <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h3 className="card-title">Biaya Perjalanan Aktual ({items.length})</h3>
                    {!isSettled && <button className="btn btn-primary btn-sm" onClick={() => setShowAddItem(true)}><Plus size={14} /> Tambah Biaya</button>}
                </div>
                <div className="card-body" style={{ padding: 0 }}>
                    <div className="table-wrapper">
                        <table>
                            <thead><tr><th>No</th><th>Tanggal</th><th>Kategori</th><th>Deskripsi</th><th>Jumlah</th>{!isSettled && <th>Aksi</th>}</tr></thead>
                            <tbody>
                                {items.length === 0 ? (
                                    <tr><td colSpan={isSettled ? 5 : 6} style={{ textAlign: 'center', padding: 'var(--space-8)', color: 'var(--text-muted)' }}>Belum ada biaya perjalanan aktual</td></tr>
                                ) : (
                                    items.map((item, index) => (
                                        <tr key={item._id}>
                                            <td>{index + 1}</td>
                                            <td>{item.expenseDate ? formatDate(item.expenseDate) : '-'}</td>
                                            <td><span className="badge badge-gray">{item.category}</span></td>
                                            <td>{item.description || '-'}</td>
                                            <td className="font-medium">{formatCurrency(item.amount)}</td>
                                            {!isSettled && <td><button className="btn btn-ghost btn-sm" onClick={() => handleDeleteItem(item._id)} disabled={deletingItemId === item._id}><Trash2 size={14} style={{ color: '#ef4444' }} /></button></td>}
                                        </tr>
                                    ))
                                )}
                                {items.length > 0 && <tr style={{ borderTop: '2px solid var(--border-color)', fontWeight: 700 }}><td colSpan={4} style={{ textAlign: 'right' }}>TOTAL BIAYA PERJALANAN</td><td>{formatCurrency(operationalSpent)}</td>{!isSettled && <td />}</tr>}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            {showAddItem && (
                <div className="modal-overlay" onClick={() => { if (!savingItem) setShowAddItem(false); }}>
                    <div className="modal" onClick={event => event.stopPropagation()}>
                        <div className="modal-header"><h3 className="modal-title">Tambah Biaya Perjalanan</h3><button className="modal-close" onClick={() => setShowAddItem(false)} disabled={savingItem}><X size={20} /></button></div>
                        <div className="modal-body">
                            <div className="form-group">
                                <label className="form-label">Tanggal Biaya</label>
                                <input type="date" className="form-input" value={itemForm.expenseDate} onChange={event => setItemForm({ ...itemForm, expenseDate: event.target.value })} />
                            </div>
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
                                <CurrencyInput value={itemForm.amount} onValueChange={value => setItemForm({ ...itemForm, amount: value })} placeholder="Ketik nominal biaya" />
                            </div>
                        </div>
                        <div className="modal-footer"><button className="btn btn-secondary" onClick={() => setShowAddItem(false)} disabled={savingItem}>Batal</button><button className="btn btn-primary" onClick={handleAddItem} disabled={savingItem}><Save size={16} /> {savingItem ? 'Menyimpan...' : 'Simpan'}</button></div>
                    </div>
                </div>
            )}

            {showSettleModal && (
                <div className="modal-overlay" onClick={() => { if (!settling) setShowSettleModal(false); }}>
                    <div className="modal" onClick={event => event.stopPropagation()}>
                        <div className="modal-header"><h3 className="modal-title">Settlement Bon Supir</h3><button className="modal-close" onClick={() => setShowSettleModal(false)} disabled={settling}><X size={20} /></button></div>
                        <div className="modal-body">
                            <div className="form-group">
                                <label className="form-label">Tanggal Settlement</label>
                                <input type="date" className="form-input" value={settlementDate} onChange={event => setSettlementDate(event.target.value)} disabled={settling} />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Rekening / Kas Settlement {balance !== 0 ? <span className="required">*</span> : null}</label>
                                <select className="form-select" value={settlementBankRef} onChange={event => setSettlementBankRef(event.target.value)} disabled={settling}>
                                    <option value="">Pilih rekening atau kas</option>
                                    {bankAccounts.map(account => <option key={account._id} value={account._id}>{account.bankName} - {account.accountNumber}{account.accountType === 'CASH' ? ' (Kas Tunai)' : ''}</option>)}
                                </select>
                                <div className="text-muted" style={{ fontSize: '0.78rem', marginTop: '0.35rem' }}>{settlementLabel}</div>
                            </div>
                            <div style={{ background: 'var(--color-bg-secondary)', borderRadius: '0.6rem', padding: '0.85rem 1rem' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.35rem' }}><span>Biaya Perjalanan</span><strong>{formatCurrency(operationalSpent)}</strong></div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.35rem' }}><span>Upah Trip</span><strong>{formatCurrency(driverFeeAmount)}</strong></div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.35rem' }}><span>Total Hak Trip</span><strong>{formatCurrency(totalClaimAmount)}</strong></div>
                                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>{balance >= 0 ? 'Sisa Dikembalikan' : 'Tambahan Bayar ke Supir'}</span><strong style={{ color: balance >= 0 ? '#16a34a' : '#ef4444' }}>{formatCurrency(Math.abs(balance))}</strong></div>
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setShowSettleModal(false)} disabled={settling}>Batal</button>
                            <button className="btn btn-primary" onClick={handleSettle} disabled={settling}><CheckCircle size={16} /> {settling ? 'Memproses...' : 'Selesaikan Bon'}</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
