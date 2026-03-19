'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Search, Plus, FileText, Printer, FileDown } from 'lucide-react';
import { formatDate, formatCurrency, getReceivableNetAmount, PAYMENT_METHOD_MAP } from '@/lib/utils';
import { buildFreightNotaPrintDocument, openBrandedPrint, fetchCompanyProfile, formatFreightNotaDisplayNumber } from '@/lib/print';
import { exportFreightNotaDetail, exportInvoices } from '@/lib/export';
import type { BankAccount, CompanyProfile, FreightNota, FreightNotaItem, Payment } from '@/lib/types';

import { useToast } from '../layout';

const STATUS_MAP: Record<string, { label: string; color: string }> = {
    UNPAID: { label: 'Belum Lunas', color: 'danger' },
    PARTIAL: { label: 'Sebagian', color: 'warning' },
    PAID: { label: 'Lunas', color: 'success' },
};

export default function NotaListPage() {
    const router = useRouter();
    const { addToast } = useToast();
    const [items, setItems] = useState<FreightNota[]>([]);
    const [payments, setPayments] = useState<Payment[]>([]);
    const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
    const [company, setCompany] = useState<CompanyProfile | null>(null);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState('');
    const [showReceiptModal, setShowReceiptModal] = useState(false);
    const [receiving, setReceiving] = useState(false);
    const [receiptCustomerRef, setReceiptCustomerRef] = useState('');
    const [receiptDate, setReceiptDate] = useState(new Date().toISOString().split('T')[0]);
    const [receiptMethod, setReceiptMethod] = useState('TRANSFER');
    const [receiptAmount, setReceiptAmount] = useState(0);
    const [receiptNote, setReceiptNote] = useState('');
    const [receiptBankRef, setReceiptBankRef] = useState('');
    const [receiptAllocations, setReceiptAllocations] = useState<Record<string, number>>({});

    useEffect(() => {
        const fetchNotas = async () => {
            const res = await fetch('/api/data?entity=freight-notas');
            const payload = await res.json();
            if (!res.ok) {
                throw new Error(payload.error || 'Gagal memuat nota ongkos');
            }
            return payload.data as FreightNota[];
        };

        const fetchPayments = async () => {
            const res = await fetch('/api/data?entity=payments');
            const payload = await res.json();
            if (!res.ok) {
                throw new Error(payload.error || 'Gagal memuat pembayaran');
            }
            return payload.data as Payment[];
        };

        const fetchBankAccounts = async () => {
            const res = await fetch('/api/data?entity=bank-accounts');
            const payload = await res.json();
            if (!res.ok) {
                throw new Error(payload.error || 'Gagal memuat rekening');
            }
            return payload.data as BankAccount[];
        };

        Promise.all([
            fetchNotas(),
            fetchPayments(),
            fetchBankAccounts(),
            fetchCompanyProfile(),
        ]).then(([notaRows, paymentRows, bankRows, companyPayload]) => {
            setItems(notaRows || []);
            setPayments(paymentRows || []);
            setBankAccounts((bankRows || []).filter(account => account.active !== false));
            setCompany(companyPayload);
        }).catch(error => {
            addToast('error', error instanceof Error ? error.message : 'Gagal memuat nota ongkos');
        }).finally(() => {
            setLoading(false);
        });
    }, [addToast]);

    const paymentTotalsByInvoice = payments.reduce<Record<string, number>>((acc, payment) => {
        acc[payment.invoiceRef] = (acc[payment.invoiceRef] || 0) + payment.amount;
        return acc;
    }, {});

    const getNotaRemaining = (nota: FreightNota) =>
        Math.max(getReceivableNetAmount(nota) - (paymentTotalsByInvoice[nota._id] || 0), 0);

    const receiptCustomerOptions = Array.from(
        items.reduce<Map<string, { ref: string; name: string }>>((map, nota) => {
            const remaining = getNotaRemaining(nota);
            const key = nota.customerRef || nota.customerName;
            if (!key || remaining <= 0) return map;
            if (!map.has(key)) {
                map.set(key, { ref: nota.customerRef || nota.customerName, name: nota.customerName });
            }
            return map;
        }, new Map()).values()
    ).sort((a, b) => a.name.localeCompare(b.name));

    const receiptOpenNotas = items
        .filter(nota => (nota.customerRef || nota.customerName) === receiptCustomerRef)
        .map(nota => ({
            nota,
            paidAmount: paymentTotalsByInvoice[nota._id] || 0,
            netAmount: getReceivableNetAmount(nota),
            remainingAmount: getNotaRemaining(nota),
        }))
        .filter(item => item.remainingAmount > 0)
        .sort((a, b) => a.nota.issueDate.localeCompare(b.nota.issueDate));

    const totalAllocated = Object.values(receiptAllocations).reduce((sum, amount) => sum + amount, 0);

    const resetReceiptModal = () => {
        setReceiptCustomerRef('');
        setReceiptDate(new Date().toISOString().split('T')[0]);
        setReceiptMethod('TRANSFER');
        setReceiptAmount(0);
        setReceiptNote('');
        setReceiptBankRef('');
        setReceiptAllocations({});
    };

    const openReceiptModal = () => {
        resetReceiptModal();
        setShowReceiptModal(true);
    };

    const updateReceiptAllocation = (notaId: string, amount: number) => {
        setReceiptAllocations(prev => {
            const next = { ...prev };
            if (!Number.isFinite(amount) || amount <= 0) {
                delete next[notaId];
            } else {
                next[notaId] = amount;
            }
            return next;
        });
    };

    const handleCreateCustomerReceipt = async () => {
        const allocations = receiptOpenNotas
            .map(item => ({
                invoiceRef: item.nota._id,
                amount: receiptAllocations[item.nota._id] || 0,
            }))
            .filter(item => item.amount > 0);

        if (!receiptCustomerRef) {
            addToast('error', 'Pilih customer dulu');
            return;
        }
        if (allocations.length === 0) {
            addToast('error', 'Minimal 1 nota harus dialokasikan');
            return;
        }
        if (receiptAmount <= 0) {
            addToast('error', 'Total penerimaan harus lebih dari 0');
            return;
        }
        if (Math.abs(totalAllocated - receiptAmount) > 0.00001) {
            addToast('error', 'Total alokasi harus sama dengan total penerimaan');
            return;
        }
        if (receiptMethod === 'TRANSFER' && !receiptBankRef) {
            addToast('error', 'Pilih rekening untuk transfer');
            return;
        }

        setReceiving(true);
        try {
            const res = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    entity: 'customer-receipts',
                    data: {
                        customerRef: receiptCustomerRef,
                        date: receiptDate,
                        totalAmount: receiptAmount,
                        method: receiptMethod,
                        note: receiptNote,
                        bankAccountRef: receiptBankRef || undefined,
                        allocations,
                    },
                }),
            });
            const payload = await res.json();
            if (!res.ok) {
                addToast('error', payload.error || 'Gagal mencatat penerimaan');
                return;
            }
            addToast('success', 'Penerimaan customer berhasil dicatat');
            setShowReceiptModal(false);
            resetReceiptModal();
            setLoading(true);
            const [notaRows, paymentRows, bankRows, companyPayload] = await Promise.all([
                fetch('/api/data?entity=freight-notas').then(async res => {
                    const payload = await res.json();
                    if (!res.ok) throw new Error(payload.error || 'Gagal memuat nota ongkos');
                    return payload.data as FreightNota[];
                }),
                fetch('/api/data?entity=payments').then(async res => {
                    const payload = await res.json();
                    if (!res.ok) throw new Error(payload.error || 'Gagal memuat pembayaran');
                    return payload.data as Payment[];
                }),
                fetch('/api/data?entity=bank-accounts').then(async res => {
                    const payload = await res.json();
                    if (!res.ok) throw new Error(payload.error || 'Gagal memuat rekening');
                    return payload.data as BankAccount[];
                }),
                fetchCompanyProfile(),
            ]);
            setItems(notaRows || []);
            setPayments(paymentRows || []);
            setBankAccounts((bankRows || []).filter(account => account.active !== false));
            setCompany(companyPayload);
        } catch (error) {
            addToast('error', error instanceof Error ? error.message : 'Gagal mencatat penerimaan');
        } finally {
            setLoading(false);
            setReceiving(false);
        }
    };

    const filtered = items.filter(n => {
        const query = search.toLowerCase();
        const displayNumber = formatFreightNotaDisplayNumber(n, company).toLowerCase();
        const m = !search ||
            n.notaNumber?.toLowerCase().includes(query) ||
            n.customerName?.toLowerCase().includes(query) ||
            displayNumber.includes(query);
        const s = !statusFilter || n.status === statusFilter;
        return m && s;
    });

    const grandTotal = filtered.reduce((sum, nota) => sum + getReceivableNetAmount(nota), 0);

    const fetchNotaItems = async (notaId: string) => {
        const response = await fetch(`/api/data?entity=freight-nota-items&filter=${encodeURIComponent(JSON.stringify({ notaRef: notaId }))}`);
        const payload = await response.json();
        if (!response.ok) {
            throw new Error(payload.error || 'Gagal memuat item nota');
        }
        return (payload.data || []) as FreightNotaItem[];
    };

    const handlePrintNota = async (nota: FreightNota) => {
        try {
            const [resolvedCompany, notaItems] = await Promise.all([
                company ? Promise.resolve(company) : fetchCompanyProfile(),
                fetchNotaItems(nota._id),
            ]);
            setCompany(resolvedCompany);
            const doc = buildFreightNotaPrintDocument({ nota, items: notaItems, company: resolvedCompany });
            openBrandedPrint({
                title: doc.title,
                subtitle: doc.subtitle,
                company: resolvedCompany,
                bodyHtml: doc.bodyHtml,
                extraStyles: doc.extraStyles,
                showCompanyHeader: doc.showCompanyHeader,
                showFooter: doc.showFooter,
            });
        } catch {
            addToast('error', 'Gagal menyiapkan cetak nota');
        }
    };

    const handleExportNota = async (nota: FreightNota) => {
        try {
            const [resolvedCompany, notaItems] = await Promise.all([
                company ? Promise.resolve(company) : fetchCompanyProfile(),
                fetchNotaItems(nota._id),
            ]);
            setCompany(resolvedCompany);
            await exportFreightNotaDetail(nota, notaItems, resolvedCompany);
            addToast('success', 'Excel nota berhasil di-download');
        } catch {
            addToast('error', 'Gagal menyiapkan Excel nota');
        }
    };

    return (
        <div>
            <div className="page-header">
                <div className="page-header-left">
                    <h1 className="page-title">Nota Ongkos Angkut</h1>
                    <p className="page-subtitle">Tagihan ongkos angkut ke customer. Satu nota dapat memuat beberapa SJ/DO untuk customer yang sama, bisa dipotong klaim, dan bisa dibayar lewat 1 receipt untuk beberapa nota.</p>
                </div>
                <div className="page-actions">
                    <button className="btn btn-success" onClick={openReceiptModal}><Plus size={18} /> Terima Pembayaran</button>
                    <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => exportInvoices(filtered as unknown as Record<string, unknown>[])}
                    >
                        <FileDown size={15} /> Excel
                    </button>
                    <button className="btn btn-secondary btn-sm" onClick={async () => {
                        const co = company ?? await fetchCompanyProfile();
                        setCompany(co);
                        openBrandedPrint({
                            title: 'Daftar Nota Ongkos Angkut', company: co, bodyHtml: `
                            <table><thead><tr><th>No. Nota</th><th>Customer</th><th>Tanggal</th><th>Total Collie</th><th>Total Berat</th><th class="r">Tagihan Netto</th><th>Status</th></tr></thead>
                            <tbody>${filtered.map(n => `<tr><td><div class="b">${formatFreightNotaDisplayNumber(n, co)}</div><div style="font-size:11px;color:#64748b">${n.notaNumber}</div></td><td>${n.customerName}</td><td>${formatDate(n.issueDate)}</td><td>${n.totalCollie || 0}</td><td>${n.totalWeightKg || 0} kg</td><td class="r b">${formatCurrency(getReceivableNetAmount(n))}</td><td>${STATUS_MAP[n.status]?.label || n.status}</td></tr>`).join('')}
                            <tr style="border-top:2px solid #1e293b"><td colspan="5" class="r b">TOTAL</td><td class="r b">${formatCurrency(grandTotal)}</td><td></td></tr></tbody></table>`
                        });
                    }}><Printer size={15} /> Print</button>
                    <button className="btn btn-primary" onClick={() => router.push('/invoices/new')}><Plus size={18} /> Buat Nota</button>
                </div>
            </div>

            {/* KPI */}
            <div className="kpi-grid" style={{ marginBottom: '1.5rem' }}>
                <div className="kpi-card">
                    <div className="kpi-icon danger"><FileText size={20} /></div>
                    <div className="kpi-content">
                        <div className="kpi-label">Total Netto</div>
                        <div className="kpi-value" style={{ fontSize: '1.05rem', color: 'var(--color-danger)' }}>{formatCurrency(grandTotal)}</div>
                    </div>
                </div>
                <div className="kpi-card">
                    <div className="kpi-icon warning"><FileText size={20} /></div>
                    <div className="kpi-content">
                        <div className="kpi-label">Belum Lunas</div>
                        <div className="kpi-value">{filtered.filter(n => n.status !== 'PAID').length}</div>
                    </div>
                </div>
                <div className="kpi-card">
                    <div className="kpi-icon success"><FileText size={20} /></div>
                    <div className="kpi-content">
                        <div className="kpi-label">Lunas</div>
                        <div className="kpi-value">{filtered.filter(n => n.status === 'PAID').length}</div>
                    </div>
                </div>
            </div>

            <div className="table-container">
                <div className="table-toolbar">
                    <div className="table-toolbar-left">
                        <div className="table-search"><Search size={16} className="table-search-icon" /><input placeholder="Cari nota, customer..." value={search} onChange={e => setSearch(e.target.value)} /></div>
                        <select className="form-select" style={{ width: 'auto', minWidth: 140 }} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
                            <option value="">Semua Status</option>
                            {Object.entries(STATUS_MAP).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                        </select>
                    </div>
                </div>
                <div className="table-wrapper">
                    <table>
                        <thead><tr><th>No. Nota</th><th>Customer</th><th>Tanggal</th><th>Total Collie</th><th>Total Berat</th><th>Tagihan Netto</th><th>Status</th><th>Aksi</th></tr></thead>
                        <tbody>
                            {loading ? [1, 2, 3].map(i => <tr key={i}>{[1, 2, 3, 4, 5, 6, 7, 8].map(j => <td key={j}><div className="skeleton skeleton-text" /></td>)}</tr>) :
                                filtered.length === 0 ? (
                                    <tr><td colSpan={8}><div className="empty-state"><FileText size={48} className="empty-state-icon" /><div className="empty-state-title">Belum ada nota</div><div className="empty-state-text">Klik tombol &quot;Buat Nota&quot; untuk membuat nota baru</div></div></td></tr>
                                ) : filtered.map(n => (
                                    <tr key={n._id}>
                                        <td>
                                            <button
                                                type="button"
                                                className="btn btn-ghost btn-sm"
                                                style={{ padding: 0, textAlign: 'left', color: 'var(--color-primary)' }}
                                                onClick={() => router.push(`/invoices/${n._id}`)}
                                            >
                                                <div className="font-semibold">{formatFreightNotaDisplayNumber(n, company)}</div>
                                                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{n.notaNumber}</div>
                                            </button>
                                        </td>
                                        <td>{n.customerName}</td>
                                        <td className="text-muted">{formatDate(n.issueDate)}</td>
                                        <td>{n.totalCollie || 0}</td>
                                        <td>{(n.totalWeightKg || 0).toLocaleString('id')} kg</td>
                                        <td>
                                            <div className="font-semibold">{formatCurrency(getReceivableNetAmount(n))}</div>
                                            {(n.totalAdjustmentAmount || 0) > 0 && <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Bruto {formatCurrency(n.totalAmount)}</div>}
                                        </td>
                                        <td><span className={`badge badge-${STATUS_MAP[n.status]?.color}`}><span className="badge-dot" /> {STATUS_MAP[n.status]?.label}</span></td>
                                        <td>
                                            <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                                                <button className="table-action-btn" onClick={() => router.push(`/invoices/${n._id}`)}>Lihat</button>
                                                <button className="table-action-btn" onClick={() => void handleExportNota(n)}><FileDown size={13} /> Excel</button>
                                                <button className="table-action-btn" onClick={() => void handlePrintNota(n)}><Printer size={13} /> Cetak</button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                        </tbody>
                    </table>
                </div>
                {filtered.length > 0 && <div className="pagination"><div className="pagination-info">Menampilkan {filtered.length} nota | Total: <strong style={{ color: 'var(--color-danger)' }}>{formatCurrency(grandTotal)}</strong></div></div>}
            </div>
            {showReceiptModal && (
                <div className="modal-overlay" onClick={() => { if (!receiving) setShowReceiptModal(false); }}>
                    <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 980 }}>
                        <div className="modal-header">
                            <h3 className="modal-title">Terima Pembayaran Customer</h3>
                            <button className="modal-close" onClick={() => setShowReceiptModal(false)} disabled={receiving}>&times;</button>
                        </div>
                        <div className="modal-body">
                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label">Customer</label>
                                    <select className="form-select" value={receiptCustomerRef} onChange={e => { setReceiptCustomerRef(e.target.value); setReceiptAllocations({}); setReceiptAmount(0); }} disabled={receiving}>
                                        <option value="">-- Pilih customer --</option>
                                        {receiptCustomerOptions.map(option => <option key={option.ref} value={option.ref}>{option.name}</option>)}
                                    </select>
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Tanggal Receipt</label>
                                    <input type="date" className="form-input" value={receiptDate} onChange={e => setReceiptDate(e.target.value)} disabled={receiving} />
                                </div>
                            </div>
                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label">Metode</label>
                                    <select className="form-select" value={receiptMethod} onChange={e => setReceiptMethod(e.target.value)} disabled={receiving}>
                                        {Object.entries(PAYMENT_METHOD_MAP).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                                    </select>
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Rekening / Kas</label>
                                    <select className="form-select" value={receiptBankRef} onChange={e => setReceiptBankRef(e.target.value)} disabled={receiving}>
                                        <option value="">{receiptMethod === 'CASH' ? '-- Otomatis ke Kas Tunai --' : '-- Pilih --'}</option>
                                        {bankAccounts.map(account => <option key={account._id} value={account._id}>{account.bankName} - {account.accountNumber}{account.accountType === 'CASH' ? ' (Kas Tunai)' : ''}</option>)}
                                    </select>
                                </div>
                            </div>
                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label">Total Penerimaan (Rp)</label>
                                    <input type="number" className="form-input" value={receiptAmount || ''} onChange={e => setReceiptAmount(Number(e.target.value))} disabled={receiving} />
                                </div>
                                <div className="form-group" style={{ alignSelf: 'end' }}>
                                    <button className="btn btn-secondary" type="button" onClick={() => setReceiptAmount(totalAllocated)} disabled={receiving || totalAllocated <= 0}>Samakan Dengan Total Alokasi</button>
                                </div>
                            </div>
                            <div className="form-group">
                                <label className="form-label">Catatan</label>
                                <textarea className="form-textarea" rows={2} value={receiptNote} onChange={e => setReceiptNote(e.target.value)} disabled={receiving} placeholder="Contoh: Transfer gabungan invoice Arwana batch 1" />
                            </div>
                            <div style={{ background: 'var(--color-gray-50)', borderRadius: '0.5rem', padding: '0.75rem 1rem', fontSize: '0.78rem', color: 'var(--color-gray-600)', marginBottom: '1rem' }}>
                                Satu receipt mewakili satu uang masuk nyata di bank/kas. Setelah itu jumlah receipt dialokasikan ke beberapa nota customer yang sama.
                            </div>
                            <div className="table-wrapper" style={{ overflowX: 'auto' }}>
                                <table style={{ minWidth: 720 }}>
                                    <thead><tr><th>No. Nota</th><th>Tgl</th><th>Netto</th><th>Sudah Dibayar</th><th>Sisa</th><th>Alokasi Receipt</th></tr></thead>
                                    <tbody>
                                        {receiptCustomerRef ? (
                                            receiptOpenNotas.length === 0 ? (
                                                <tr><td colSpan={6}><div className="empty-state"><div className="empty-state-title">Tidak ada nota terbuka</div><div className="empty-state-text">Customer ini tidak punya sisa tagihan netto.</div></div></td></tr>
                                            ) : receiptOpenNotas.map(item => (
                                                <tr key={item.nota._id}>
                                                    <td>
                                                        <div className="font-semibold">{formatFreightNotaDisplayNumber(item.nota, company)}</div>
                                                        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{item.nota.notaNumber}</div>
                                                    </td>
                                                    <td>{formatDate(item.nota.issueDate)}</td>
                                                    <td>{formatCurrency(item.netAmount)}</td>
                                                    <td>{formatCurrency(item.paidAmount)}</td>
                                                    <td>
                                                        <div className="font-semibold">{formatCurrency(item.remainingAmount)}</div>
                                                        <button className="table-action-btn" type="button" onClick={() => updateReceiptAllocation(item.nota._id, item.remainingAmount)} disabled={receiving}>Isi penuh</button>
                                                    </td>
                                                    <td><input type="number" className="form-input" value={receiptAllocations[item.nota._id] || ''} onChange={e => updateReceiptAllocation(item.nota._id, Number(e.target.value))} disabled={receiving} /></td>
                                                </tr>
                                            ))
                                        ) : (
                                            <tr><td colSpan={6}><div className="empty-state"><div className="empty-state-title">Pilih customer</div><div className="empty-state-text">Daftar nota akan muncul setelah customer dipilih.</div></div></td></tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '1rem', gap: '1rem', flexWrap: 'wrap' }}>
                                <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Total alokasi: <strong>{formatCurrency(totalAllocated)}</strong></div>
                                <div style={{ fontSize: '0.85rem', color: Math.abs(totalAllocated - receiptAmount) <= 0.00001 ? 'var(--color-success)' : 'var(--color-danger)' }}>
                                    {Math.abs(totalAllocated - receiptAmount) <= 0.00001 ? 'Total alokasi sudah cocok dengan receipt' : 'Total alokasi harus sama dengan total receipt'}
                                </div>
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setShowReceiptModal(false)} disabled={receiving}>Batal</button>
                            <button className="btn btn-success" onClick={() => void handleCreateCustomerReceipt()} disabled={receiving}>{receiving ? 'Memproses...' : 'Simpan Receipt'}</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
