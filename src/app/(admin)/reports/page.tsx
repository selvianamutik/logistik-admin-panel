'use client';

import { useState, useEffect, useMemo } from 'react';
import { TrendingUp, TrendingDown, BarChart3, FileDown, Printer, ArrowRightLeft, DollarSign, Wallet, Landmark, ChevronLeft, ChevronRight } from 'lucide-react';
import { formatCurrency, formatDate } from '@/lib/utils';
import { exportToExcel } from '@/lib/export';
import type { Expense, Invoice, Payment, BankAccount, BankTransaction, CompanyProfile } from '@/lib/types';

type Tab = 'pnl' | 'cashflow';

export default function ReportsPage() {
    const [tab, setTab] = useState<Tab>('pnl');
    const [payments, setPayments] = useState<Payment[]>([]);
    const [expenses, setExpenses] = useState<Expense[]>([]);
    const [invoices, setInvoices] = useState<Invoice[]>([]);
    const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
    const [bankTransactions, setBankTransactions] = useState<BankTransaction[]>([]);
    const [company, setCompany] = useState<CompanyProfile | null>(null);
    const [loading, setLoading] = useState(true);
    const [showPrint, setShowPrint] = useState(false);

    // Month selector
    const now = new Date();
    const [month, setMonth] = useState(now.getMonth());
    const [year, setYear] = useState(now.getFullYear());
    const [periodMode, setPeriodMode] = useState<'month' | 'year' | 'all'>('month');

    const monthNames = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

    useEffect(() => {
        Promise.all([
            fetch('/api/data?entity=payments').then(r => r.json()),
            fetch('/api/data?entity=expenses').then(r => r.json()),
            fetch('/api/data?entity=invoices').then(r => r.json()),
            fetch('/api/data?entity=bank-accounts').then(r => r.json()),
            fetch('/api/data?entity=bank-transactions').then(r => r.json()),
            fetch('/api/data?entity=company').then(r => r.json()),
        ]).then(([pay, exp, inv, ba, bt, co]) => {
            setPayments(pay.data || []);
            setExpenses(exp.data || []);
            setInvoices(inv.data || []);
            setBankAccounts((ba.data || []).filter((a: BankAccount) => a.active !== false));
            setBankTransactions(bt.data || []);
            setCompany(co.data || null);
            setLoading(false);
        });
    }, []);

    // Filter by period
    const inPeriod = (dateStr: string) => {
        if (periodMode === 'all') return true;
        const d = new Date(dateStr);
        if (periodMode === 'year') return d.getFullYear() === year;
        return d.getMonth() === month && d.getFullYear() === year;
    };

    const periodLabel = periodMode === 'all' ? 'Semua Periode' : periodMode === 'year' ? `Tahun ${year}` : `${monthNames[month]} ${year}`;

    // Filtered data
    const filteredPayments = useMemo(() => payments.filter(p => inPeriod(p.date)), [payments, month, year, periodMode]);
    const filteredExpenses = useMemo(() => expenses.filter(e => inPeriod(e.date)), [expenses, month, year, periodMode]);
    const filteredBankTx = useMemo(() => bankTransactions.filter(t => inPeriod(t.date)), [bankTransactions, month, year, periodMode]);

    // P&L calculations
    const totalRevenue = filteredPayments.reduce((s, p) => s + p.amount, 0);
    const totalExpense = filteredExpenses.reduce((s, e) => s + e.amount, 0);
    const netProfit = totalRevenue - totalExpense;

    // Expense by category
    const expByCategory: Record<string, number> = {};
    filteredExpenses.forEach(e => {
        const cat = e.categoryName || 'Lainnya';
        expByCategory[cat] = (expByCategory[cat] || 0) + e.amount;
    });
    const sortedCategories = Object.entries(expByCategory).sort(([, a], [, b]) => b - a);

    // Cash flow per bank
    const cashFlowByBank: Record<string, { bankName: string; inflow: number; outflow: number; txCount: number }> = {};
    filteredBankTx.forEach(tx => {
        const bank = bankAccounts.find(a => a._id === tx.bankAccountRef);
        const bName = bank?.bankName || 'Unknown';
        if (!cashFlowByBank[tx.bankAccountRef]) cashFlowByBank[tx.bankAccountRef] = { bankName: bName, inflow: 0, outflow: 0, txCount: 0 };
        const entry = cashFlowByBank[tx.bankAccountRef];
        entry.txCount++;
        if (tx.type === 'CREDIT' || tx.type === 'TRANSFER_IN') entry.inflow += tx.amount;
        else entry.outflow += tx.amount;
    });

    // Invoice stats
    const totalInvoiced = invoices.filter(i => inPeriod(i.issueDate)).reduce((s, i) => s + i.totalAmount, 0);
    const totalOutstanding = invoices.filter(i => i.status !== 'PAID' && inPeriod(i.issueDate)).reduce((s, i) => s + i.totalAmount, 0);

    const companyName = company?.name || 'LOGISTIK';
    const companyLogo = company?.logoUrl || '';
    const fmtN = (n: number) => new Intl.NumberFormat('id-ID').format(n);

    const prevPeriod = () => {
        if (periodMode === 'year') { setYear(y => y - 1); return; }
        if (month === 0) { setMonth(11); setYear(y => y - 1); } else { setMonth(m => m - 1); }
    };
    const nextPeriod = () => {
        if (periodMode === 'year') { setYear(y => y + 1); return; }
        if (month === 11) { setMonth(0); setYear(y => y + 1); } else { setMonth(m => m + 1); }
    };

    const handleExportExcel = () => {
        if (tab === 'pnl') {
            const rows = [
                ...filteredPayments.map(p => ({ tipe: 'Pendapatan', tanggal: p.date, deskripsi: p.note || 'Pembayaran Invoice', jumlah: p.amount })),
                ...filteredExpenses.map(e => ({ tipe: 'Pengeluaran', tanggal: e.date, deskripsi: e.note || e.categoryName || '-', jumlah: -e.amount })),
            ];
            exportToExcel(rows as unknown as Record<string, unknown>[], [
                { header: 'Tipe', key: 'tipe', width: 15 },
                { header: 'Tanggal', key: 'tanggal', width: 15 },
                { header: 'Deskripsi', key: 'deskripsi', width: 35 },
                { header: 'Jumlah', key: 'jumlah', width: 18 },
            ], `laba-rugi-${periodLabel.replace(/\s/g, '-')}`, 'Laba Rugi');
        } else {
            const rows = filteredBankTx.map(tx => ({
                bank: bankAccounts.find(a => a._id === tx.bankAccountRef)?.bankName || '-',
                tanggal: tx.date,
                tipe: tx.type,
                deskripsi: tx.description,
                jumlah: tx.amount,
                saldo: tx.balanceAfter,
            }));
            exportToExcel(rows as unknown as Record<string, unknown>[], [
                { header: 'Bank', key: 'bank', width: 15 },
                { header: 'Tanggal', key: 'tanggal', width: 15 },
                { header: 'Tipe', key: 'tipe', width: 15 },
                { header: 'Deskripsi', key: 'deskripsi', width: 30 },
                { header: 'Jumlah', key: 'jumlah', width: 18 },
                { header: 'Saldo', key: 'saldo', width: 18 },
            ], `arus-kas-${periodLabel.replace(/\s/g, '-')}`, 'Arus Kas');
        }
    };

    const handlePrint = () => {
        const w = window.open('', '_blank');
        if (!w) return;
        const isPnl = tab === 'pnl';
        w.document.write(`<!DOCTYPE html><html><head><title>${isPnl ? 'Laba Rugi' : 'Arus Kas'} — ${companyName}</title><style>
            body { font-family: 'Segoe UI', sans-serif; padding: 2rem; color: #1e293b; max-width: 800px; margin: 0 auto; }
            .hdr { display: flex; align-items: center; gap: 1rem; margin-bottom: 1.5rem; padding-bottom: 1rem; border-bottom: 2px solid #1e293b; }
            .hdr img { height: 48px; width: auto; }
            .co { font-size: 1.3rem; font-weight: 800; } .sub { color: #64748b; font-size: 0.85rem; }
            .stats { display: flex; gap: 1.5rem; margin-bottom: 1.5rem; }
            .stat { flex: 1; text-align: center; padding: 0.75rem; background: #f8fafc; border-radius: 8px; }
            .stat-l { font-size: 0.7rem; color: #64748b; text-transform: uppercase; }
            .stat-v { font-size: 1.15rem; font-weight: 700; margin-top: 0.2rem; }
            table { width: 100%; border-collapse: collapse; } th, td { padding: 0.5rem 0.6rem; text-align: left; border-bottom: 1px solid #e2e8f0; font-size: 0.82rem; }
            th { background: #f1f5f9; font-weight: 600; font-size: 0.72rem; text-transform: uppercase; }
            .r { text-align: right; } .b { font-weight: 700; } .s { color: #16a34a; } .d { color: #dc2626; }
            .footer { margin-top: 1.5rem; font-size: 0.72rem; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 0.5rem; }
            @media print { body { padding: 0.5rem; } }
        </style></head><body>
            <div class="hdr">
                ${companyLogo ? `<img src="${companyLogo}" />` : ''}
                <div><div class="co">${companyName}</div><div class="sub">${isPnl ? 'Laporan Laba Rugi' : 'Laporan Arus Kas'} — ${periodLabel}</div></div>
                <div style="margin-left:auto;text-align:right;font-size:0.72rem;color:#94a3b8">Dicetak:<br/>${new Date().toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' })}</div>
            </div>
            ${isPnl ? `
                <div class="stats">
                    <div class="stat"><div class="stat-l">Pendapatan</div><div class="stat-v s">${fmtN(totalRevenue)}</div></div>
                    <div class="stat"><div class="stat-l">Pengeluaran</div><div class="stat-v d">${fmtN(totalExpense)}</div></div>
                    <div class="stat"><div class="stat-l">Laba/Rugi Bersih</div><div class="stat-v ${netProfit >= 0 ? 's' : 'd'}">${netProfit >= 0 ? '+' : ''}${fmtN(netProfit)}</div></div>
                </div>
                <table><thead><tr><th>Kategori</th><th class="r">Jumlah</th><th class="r">%</th></tr></thead>
                <tbody>
                    <tr class="b"><td>PENDAPATAN</td><td class="r s">${fmtN(totalRevenue)}</td><td class="r">100%</td></tr>
                    <tr><td style="padding-left:1.5rem">Pembayaran Invoice (${filteredPayments.length}x)</td><td class="r">${fmtN(totalRevenue)}</td><td class="r">100%</td></tr>
                    <tr class="b" style="border-top:2px solid #e2e8f0"><td>PENGELUARAN</td><td class="r d">${fmtN(totalExpense)}</td><td class="r">100%</td></tr>
                    ${sortedCategories.map(([cat, amt]) => `<tr><td style="padding-left:1.5rem">${cat}</td><td class="r">${fmtN(amt)}</td><td class="r">${totalExpense > 0 ? ((amt / totalExpense) * 100).toFixed(1) : 0}%</td></tr>`).join('')}
                    <tr class="b" style="border-top:2px solid #1e293b"><td>LABA / RUGI BERSIH</td><td class="r ${netProfit >= 0 ? 's' : 'd'}">${netProfit >= 0 ? '+' : ''}${fmtN(netProfit)}</td><td></td></tr>
                </tbody></table>
            ` : `
                <div class="stats">
                    ${Object.entries(cashFlowByBank).map(([, v]) => `<div class="stat"><div class="stat-l">${v.bankName}</div><div class="stat-v s">+${fmtN(v.inflow)}</div><div style="font-size:0.72rem;color:#dc2626">-${fmtN(v.outflow)}</div></div>`).join('')}
                </div>
                <table><thead><tr><th>Bank</th><th>Tanggal</th><th>Tipe</th><th>Deskripsi</th><th class="r">Jumlah</th><th class="r">Saldo</th></tr></thead>
                <tbody>${filteredBankTx.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).map(tx => {
            const isIn = tx.type === 'CREDIT' || tx.type === 'TRANSFER_IN';
            return `<tr><td>${bankAccounts.find(a => a._id === tx.bankAccountRef)?.bankName || '-'}</td><td>${tx.date ? new Date(tx.date).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }) : '-'}</td><td>${tx.type}</td><td>${tx.description}</td><td class="r ${isIn ? 's' : 'd'} b">${isIn ? '+' : '-'}${fmtN(tx.amount)}</td><td class="r b">${fmtN(tx.balanceAfter)}</td></tr>`;
        }).join('')}</tbody></table>
            `}
            <div class="footer">${companyName} • ${periodLabel}</div>
        </body></html>`);
        w.document.close();
        setTimeout(() => w.print(), 300);
    };

    if (loading) return <div><div className="skeleton skeleton-title" /><div className="skeleton skeleton-card" style={{ height: 200 }} /></div>;

    return (
        <div>
            {/* Header */}
            <div className="page-header">
                <div className="page-header-left">
                    <h1 className="page-title">Laporan Keuangan</h1>
                    <p className="page-subtitle">Laba rugi dan arus kas per periode</p>
                </div>
                <div className="page-actions" style={{ flexWrap: 'wrap' }}>
                    <button className="btn btn-secondary btn-sm" onClick={handleExportExcel}><FileDown size={15} /> Excel</button>
                    <button className="btn btn-secondary btn-sm" onClick={() => setShowPrint(true)}><Printer size={15} /> Print</button>
                </div>
            </div>

            {/* Tabs + Period Selector */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.75rem' }}>
                <div className="tabs" style={{ borderBottom: 'none', marginBottom: 0 }}>
                    <button className={`tab ${tab === 'pnl' ? 'active' : ''}`} onClick={() => setTab('pnl')}>
                        <DollarSign size={14} style={{ marginRight: 4 }} /> Laba Rugi
                    </button>
                    <button className={`tab ${tab === 'cashflow' ? 'active' : ''}`} onClick={() => setTab('cashflow')}>
                        <ArrowRightLeft size={14} style={{ marginRight: 4 }} /> Arus Kas
                    </button>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <select className="form-select" style={{ width: 'auto', fontSize: '0.78rem', padding: '0.35rem 0.5rem' }} value={periodMode} onChange={e => setPeriodMode(e.target.value as 'month' | 'year' | 'all')}>
                        <option value="month">Bulanan</option>
                        <option value="year">Tahunan</option>
                        <option value="all">Semua</option>
                    </select>
                    {periodMode !== 'all' && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', background: 'var(--color-gray-50)', borderRadius: '0.4rem', padding: '0.2rem 0.3rem' }}>
                            <button className="btn btn-ghost btn-sm" onClick={prevPeriod} style={{ padding: '0.2rem' }}><ChevronLeft size={16} /></button>
                            <span style={{ fontSize: '0.78rem', fontWeight: 600, minWidth: 110, textAlign: 'center' }}>{periodLabel}</span>
                            <button className="btn btn-ghost btn-sm" onClick={nextPeriod} style={{ padding: '0.2rem' }}><ChevronRight size={16} /></button>
                        </div>
                    )}
                </div>
            </div>

            {/* ─── LABA RUGI TAB ─── */}
            {tab === 'pnl' && (
                <div>
                    {/* KPI Cards */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
                        <div className="card" style={{ overflow: 'hidden' }}>
                            <div className="card-body" style={{ padding: '1.1rem' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.7rem', color: 'var(--text-muted, #64748b)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.25rem' }}>
                                    <TrendingUp size={14} style={{ color: 'var(--color-success)' }} /> Pendapatan
                                </div>
                                <div style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--color-success)' }}>{formatCurrency(totalRevenue)}</div>
                                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{filteredPayments.length} pembayaran</div>
                            </div>
                        </div>
                        <div className="card" style={{ overflow: 'hidden' }}>
                            <div className="card-body" style={{ padding: '1.1rem' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.7rem', color: 'var(--text-muted, #64748b)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.25rem' }}>
                                    <TrendingDown size={14} style={{ color: 'var(--color-danger)' }} /> Pengeluaran
                                </div>
                                <div style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--color-danger)' }}>{formatCurrency(totalExpense)}</div>
                                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{filteredExpenses.length} transaksi</div>
                            </div>
                        </div>
                        <div className="card" style={{ background: netProfit >= 0 ? 'linear-gradient(135deg, #059669, #10b981)' : 'linear-gradient(135deg, #dc2626, #ef4444)', color: '#fff', overflow: 'hidden', position: 'relative' }}>
                            <div style={{ position: 'absolute', right: -15, top: -15, width: 70, height: 70, borderRadius: '50%', background: 'rgba(255,255,255,0.08)' }} />
                            <div className="card-body" style={{ padding: '1.1rem', position: 'relative' }}>
                                <div style={{ fontSize: '0.7rem', opacity: 0.8, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.25rem' }}>Laba Bersih</div>
                                <div style={{ fontSize: '1.4rem', fontWeight: 700 }}>{netProfit >= 0 ? '+' : ''}{formatCurrency(netProfit)}</div>
                                <div style={{ fontSize: '0.7rem', opacity: 0.7 }}>Margin: {totalRevenue > 0 ? ((netProfit / totalRevenue) * 100).toFixed(1) : '0'}%</div>
                            </div>
                        </div>
                        <div className="card" style={{ overflow: 'hidden' }}>
                            <div className="card-body" style={{ padding: '1.1rem' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.7rem', color: 'var(--text-muted, #64748b)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.25rem' }}>
                                    <Wallet size={14} /> Invoice Outstanding
                                </div>
                                <div style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--color-warning)' }}>{formatCurrency(totalOutstanding)}</div>
                                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Total diterbitkan: {formatCurrency(totalInvoiced)}</div>
                            </div>
                        </div>
                    </div>

                    {/* P&L Detail */}
                    <div className="detail-grid">
                        <div className="card">
                            <div className="card-header"><span className="card-header-title">Laporan Laba Rugi</span></div>
                            <div className="card-body" style={{ padding: 0 }}>
                                {/* Revenue */}
                                <div style={{ padding: '0.75rem 1rem', background: 'rgba(5,150,105,0.05)', borderBottom: '1px solid var(--color-gray-100)' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, color: 'var(--color-success)' }}>
                                        <span>PENDAPATAN</span><span>{formatCurrency(totalRevenue)}</span>
                                    </div>
                                </div>
                                <div style={{ padding: '0.5rem 1rem 0.5rem 2rem', borderBottom: '1px solid var(--color-gray-100)', fontSize: '0.82rem' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                        <span>Pembayaran Invoice ({filteredPayments.length}x)</span>
                                        <span style={{ fontWeight: 600 }}>{formatCurrency(totalRevenue)}</span>
                                    </div>
                                </div>

                                {/* Expenses */}
                                <div style={{ padding: '0.75rem 1rem', background: 'rgba(220,38,38,0.05)', borderBottom: '1px solid var(--color-gray-100)' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, color: 'var(--color-danger)' }}>
                                        <span>PENGELUARAN</span><span>{formatCurrency(totalExpense)}</span>
                                    </div>
                                </div>
                                {sortedCategories.map(([cat, amt]) => (
                                    <div key={cat} style={{ padding: '0.5rem 1rem 0.5rem 2rem', borderBottom: '1px solid var(--color-gray-100)', fontSize: '0.82rem' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                            <span>{cat}</span>
                                            <div style={{ display: 'flex', gap: '1.5rem' }}>
                                                <span style={{ fontWeight: 600 }}>{formatCurrency(amt)}</span>
                                                <span style={{ color: 'var(--color-gray-400)', fontSize: '0.72rem', minWidth: 40, textAlign: 'right' }}>{totalExpense > 0 ? ((amt / totalExpense) * 100).toFixed(1) : 0}%</span>
                                            </div>
                                        </div>
                                    </div>
                                ))}

                                {/* Net */}
                                <div style={{ padding: '1rem', background: 'var(--color-gray-50)', borderTop: '2px solid var(--color-gray-300)' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: '1rem' }}>
                                        <span>LABA / RUGI BERSIH</span>
                                        <span style={{ color: netProfit >= 0 ? 'var(--color-success)' : 'var(--color-danger)' }}>{netProfit >= 0 ? '+' : ''}{formatCurrency(netProfit)}</span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Expense Breakdown */}
                        <div className="card">
                            <div className="card-header"><span className="card-header-title">Pengeluaran per Kategori</span></div>
                            <div className="card-body">
                                {sortedCategories.length === 0 ? (
                                    <div style={{ textAlign: 'center', color: 'var(--color-gray-400)', padding: '2rem 0' }}>Tidak ada pengeluaran</div>
                                ) : sortedCategories.map(([cat, amt]) => {
                                    const pct = totalExpense > 0 ? (amt / totalExpense) * 100 : 0;
                                    return (
                                        <div key={cat} style={{ marginBottom: '0.75rem' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', marginBottom: '0.2rem' }}>
                                                <span style={{ fontWeight: 500 }}>{cat}</span>
                                                <span style={{ fontWeight: 600 }}>{formatCurrency(amt)}</span>
                                            </div>
                                            <div style={{ height: 6, background: 'var(--color-gray-100)', borderRadius: 3, overflow: 'hidden' }}>
                                                <div style={{ height: '100%', width: `${pct}%`, background: 'linear-gradient(90deg, var(--color-danger), #f87171)', borderRadius: 3, transition: 'width 0.3s' }} />
                                            </div>
                                            <div style={{ fontSize: '0.68rem', color: 'var(--color-gray-400)', marginTop: '0.1rem' }}>{pct.toFixed(1)}%</div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* ─── ARUS KAS TAB ─── */}
            {tab === 'cashflow' && (
                <div>
                    {/* Per bank summary */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
                        {bankAccounts.map(acc => {
                            const cf = cashFlowByBank[acc._id] || { inflow: 0, outflow: 0, txCount: 0 };
                            return (
                                <div key={acc._id} className="card" style={{ overflow: 'hidden' }}>
                                    <div className="card-body" style={{ padding: '1rem' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.6rem' }}>
                                            <Landmark size={16} style={{ color: 'var(--color-primary)' }} />
                                            <div style={{ fontWeight: 700, fontSize: '0.85rem' }}>{acc.bankName}</div>
                                        </div>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', marginBottom: '0.3rem' }}>
                                            <span style={{ color: 'var(--color-success)' }}>↑ Masuk</span>
                                            <span style={{ fontWeight: 600, color: 'var(--color-success)' }}>+{formatCurrency(cf.inflow)}</span>
                                        </div>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', marginBottom: '0.3rem' }}>
                                            <span style={{ color: 'var(--color-danger)' }}>↓ Keluar</span>
                                            <span style={{ fontWeight: 600, color: 'var(--color-danger)' }}>-{formatCurrency(cf.outflow)}</span>
                                        </div>
                                        <div style={{ borderTop: '1px solid var(--color-gray-100)', marginTop: '0.3rem', paddingTop: '0.3rem', display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem' }}>
                                            <span style={{ fontWeight: 600 }}>Saldo</span>
                                            <span style={{ fontWeight: 700 }}>{formatCurrency(acc.currentBalance || 0)}</span>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    {/* Transaction list */}
                    <div className="card">
                        <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span className="card-header-title">Transaksi Arus Kas</span>
                            <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{filteredBankTx.length} transaksi</span>
                        </div>
                        <div className="table-wrapper" style={{ overflowX: 'auto' }}>
                            <table style={{ minWidth: 650 }}>
                                <thead><tr><th>Tanggal</th><th>Bank</th><th>Tipe</th><th>Deskripsi</th><th style={{ textAlign: 'right' }}>Jumlah</th><th style={{ textAlign: 'right' }}>Saldo</th></tr></thead>
                                <tbody>
                                    {filteredBankTx.length === 0 ? (
                                        <tr><td colSpan={6} style={{ textAlign: 'center', padding: '2.5rem 1rem', color: 'var(--color-gray-400)' }}>Tidak ada transaksi dalam periode ini</td></tr>
                                    ) : filteredBankTx.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).map(tx => {
                                        const isIn = tx.type === 'CREDIT' || tx.type === 'TRANSFER_IN';
                                        const bank = bankAccounts.find(a => a._id === tx.bankAccountRef);
                                        return (
                                            <tr key={tx._id}>
                                                <td style={{ whiteSpace: 'nowrap', fontSize: '0.82rem' }}>{formatDate(tx.date)}</td>
                                                <td style={{ fontWeight: 600, fontSize: '0.82rem' }}>{bank?.bankName || '-'}</td>
                                                <td><span className={`badge badge-${isIn ? 'success' : 'danger'}`} style={{ fontSize: '0.65rem' }}>{isIn ? 'Masuk' : 'Keluar'}</span></td>
                                                <td style={{ fontSize: '0.82rem' }}>{tx.description}</td>
                                                <td style={{ textAlign: 'right', fontWeight: 700, color: isIn ? 'var(--color-success)' : 'var(--color-danger)', whiteSpace: 'nowrap' }}>{isIn ? '+' : '-'}{formatCurrency(tx.amount)}</td>
                                                <td style={{ textAlign: 'right', fontWeight: 600, whiteSpace: 'nowrap' }}>{formatCurrency(tx.balanceAfter)}</td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            )}

            {/* Print Preview Modal */}
            {showPrint && (
                <div className="modal-overlay" onClick={() => setShowPrint(false)}>
                    <div className="modal modal-xl" onClick={e => e.stopPropagation()} style={{ maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
                        <div className="modal-header">
                            <h3 className="modal-title">Print Preview — {tab === 'pnl' ? 'Laba Rugi' : 'Arus Kas'}</h3>
                            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                <button className="btn btn-primary btn-sm" onClick={handlePrint}><Printer size={14} /> Print</button>
                                <button className="modal-close" onClick={() => setShowPrint(false)}>×</button>
                            </div>
                        </div>
                        <div style={{ flex: 1, overflow: 'auto', padding: '1.5rem' }}>
                            {/* Company header */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem', paddingBottom: '0.75rem', borderBottom: '2px solid var(--color-gray-800, #1e293b)' }}>
                                {companyLogo && <img src={companyLogo} alt="Logo" style={{ height: 40, width: 'auto', objectFit: 'contain' }} />}
                                <div style={{ flex: 1 }}>
                                    <div style={{ fontWeight: 800, fontSize: '1.1rem' }}>{companyName}</div>
                                    <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{tab === 'pnl' ? 'Laporan Laba Rugi' : 'Laporan Arus Kas'} — {periodLabel}</div>
                                </div>
                                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textAlign: 'right' }}>Dicetak:<br />{new Date().toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' })}</div>
                            </div>

                            {tab === 'pnl' ? (
                                <div>
                                    {/* Stats preview */}
                                    <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem' }}>
                                        {[{ l: 'Pendapatan', v: formatCurrency(totalRevenue), c: 'var(--color-success)' }, { l: 'Pengeluaran', v: formatCurrency(totalExpense), c: 'var(--color-danger)' }, { l: 'Laba Bersih', v: `${netProfit >= 0 ? '+' : ''}${formatCurrency(netProfit)}`, c: netProfit >= 0 ? 'var(--color-success)' : 'var(--color-danger)' }].map(s => (
                                            <div key={s.l} style={{ flex: 1, textAlign: 'center', padding: '0.6rem', background: 'var(--color-gray-50)', borderRadius: '0.4rem' }}>
                                                <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>{s.l}</div>
                                                <div style={{ fontWeight: 700, fontSize: '1rem', color: s.c }}>{s.v}</div>
                                            </div>
                                        ))}
                                    </div>
                                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                                        <thead><tr style={{ background: 'var(--color-gray-50)' }}><th style={{ padding: '0.5rem', textAlign: 'left', fontWeight: 600, fontSize: '0.72rem', textTransform: 'uppercase', borderBottom: '2px solid var(--color-gray-200)' }}>Kategori</th><th style={{ padding: '0.5rem', textAlign: 'right', fontWeight: 600, fontSize: '0.72rem', textTransform: 'uppercase', borderBottom: '2px solid var(--color-gray-200)' }}>Jumlah</th></tr></thead>
                                        <tbody>
                                            <tr style={{ fontWeight: 700, color: 'var(--color-success)' }}><td style={{ padding: '0.5rem' }}>PENDAPATAN</td><td style={{ padding: '0.5rem', textAlign: 'right' }}>{formatCurrency(totalRevenue)}</td></tr>
                                            <tr><td style={{ padding: '0.35rem 0.5rem 0.35rem 1.5rem' }}>Pembayaran Invoice ({filteredPayments.length}x)</td><td style={{ padding: '0.35rem 0.5rem', textAlign: 'right' }}>{formatCurrency(totalRevenue)}</td></tr>
                                            <tr style={{ fontWeight: 700, color: 'var(--color-danger)', borderTop: '1px solid var(--color-gray-200)' }}><td style={{ padding: '0.5rem' }}>PENGELUARAN</td><td style={{ padding: '0.5rem', textAlign: 'right' }}>{formatCurrency(totalExpense)}</td></tr>
                                            {sortedCategories.map(([cat, amt]) => (
                                                <tr key={cat}><td style={{ padding: '0.35rem 0.5rem 0.35rem 1.5rem' }}>{cat}</td><td style={{ padding: '0.35rem 0.5rem', textAlign: 'right' }}>{formatCurrency(amt)}</td></tr>
                                            ))}
                                            <tr style={{ fontWeight: 700, borderTop: '2px solid var(--color-gray-800, #1e293b)' }}><td style={{ padding: '0.6rem 0.5rem' }}>LABA / RUGI BERSIH</td><td style={{ padding: '0.6rem 0.5rem', textAlign: 'right', color: netProfit >= 0 ? 'var(--color-success)' : 'var(--color-danger)' }}>{netProfit >= 0 ? '+' : ''}{formatCurrency(netProfit)}</td></tr>
                                        </tbody>
                                    </table>
                                </div>
                            ) : (
                                <div>
                                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                                        <thead><tr style={{ background: 'var(--color-gray-50)' }}>
                                            {['Bank', 'Tanggal', 'Tipe', 'Deskripsi', 'Jumlah', 'Saldo'].map(h => (
                                                <th key={h} style={{ padding: '0.5rem', textAlign: h === 'Jumlah' || h === 'Saldo' ? 'right' : 'left', fontWeight: 600, fontSize: '0.7rem', textTransform: 'uppercase', borderBottom: '2px solid var(--color-gray-200)' }}>{h}</th>
                                            ))}
                                        </tr></thead>
                                        <tbody>
                                            {filteredBankTx.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).map(tx => {
                                                const isIn = tx.type === 'CREDIT' || tx.type === 'TRANSFER_IN';
                                                return (
                                                    <tr key={tx._id} style={{ borderBottom: '1px solid var(--color-gray-100)' }}>
                                                        <td style={{ padding: '0.4rem 0.5rem' }}>{bankAccounts.find(a => a._id === tx.bankAccountRef)?.bankName || '-'}</td>
                                                        <td style={{ padding: '0.4rem 0.5rem' }}>{formatDate(tx.date)}</td>
                                                        <td style={{ padding: '0.4rem 0.5rem' }}>{isIn ? 'Masuk' : 'Keluar'}</td>
                                                        <td style={{ padding: '0.4rem 0.5rem' }}>{tx.description}</td>
                                                        <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right', fontWeight: 600, color: isIn ? 'var(--color-success)' : 'var(--color-danger)' }}>{isIn ? '+' : '-'}{formatCurrency(tx.amount)}</td>
                                                        <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right', fontWeight: 600 }}>{formatCurrency(tx.balanceAfter)}</td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                            <div style={{ marginTop: '1rem', fontSize: '0.72rem', color: 'var(--text-muted)', borderTop: '1px solid var(--color-gray-200)', paddingTop: '0.5rem' }}>
                                {companyName} • {periodLabel}
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
