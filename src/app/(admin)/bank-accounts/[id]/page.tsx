'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, TrendingUp, TrendingDown, ArrowRightLeft, FileDown, Printer } from 'lucide-react';
import { exportToExcel } from '@/lib/export';
import type { BankAccount, BankTransaction } from '@/lib/types';

// ── Bank colors (copied from list page for consistency) ──
const BANK_COLORS: Record<string, { gradient: string; color: string }> = {
    BCA: { color: '#003b7b', gradient: 'linear-gradient(135deg, #003b7b 0%, #0060c7 100%)' },
    MANDIRI: { color: '#003868', gradient: 'linear-gradient(135deg, #003868 0%, #005ba5 100%)' },
    BRI: { color: '#00529c', gradient: 'linear-gradient(135deg, #00529c 0%, #0078d4 100%)' },
    BNI: { color: '#e35205', gradient: 'linear-gradient(135deg, #e35205 0%, #f97316 100%)' },
    BSI: { color: '#00a650', gradient: 'linear-gradient(135deg, #00a650 0%, #22c55e 100%)' },
    DEFAULT: { color: '#6b7280', gradient: 'linear-gradient(135deg, #374151 0%, #6b7280 100%)' },
};

function getBankColor(name: string) {
    const key = Object.keys(BANK_COLORS).find(k => name.toUpperCase().includes(k));
    return BANK_COLORS[key || 'DEFAULT'];
}

export default function BankAccountDetailPage() {
    const { id } = useParams();
    const router = useRouter();
    const [account, setAccount] = useState<BankAccount | null>(null);
    const [transactions, setTransactions] = useState<BankTransaction[]>([]);
    const [loading, setLoading] = useState(true);
    const [showPrint, setShowPrint] = useState(false);

    useEffect(() => {
        Promise.all([
            fetch(`/api/data?entity=bank-accounts&id=${id}`).then(r => r.json()),
            fetch(`/api/data?entity=bank-transactions&filter=${encodeURIComponent(JSON.stringify({ bankAccountRef: id }))}`).then(r => r.json()),
        ]).then(([accRes, txRes]) => {
            setAccount(accRes.data);
            setTransactions((txRes.data || []).sort((a: BankTransaction, b: BankTransaction) => new Date(b.date || b._createdAt || '').getTime() - new Date(a.date || a._createdAt || '').getTime()));
            setLoading(false);
        });
    }, [id]);

    const fmt = (n: number) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(n);
    const fmtNum = (n: number) => new Intl.NumberFormat('id-ID').format(n);
    const fmtDate = (d: string) => { try { return new Date(d).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }); } catch { return d; } };
    const fmtDateLong = (d: string) => { try { return new Date(d).toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' }); } catch { return d; } };

    const typeConfig: Record<string, { label: string; badge: string; sign: string; icon: React.ReactNode }> = {
        CREDIT: { label: 'Masuk', badge: 'badge-success', sign: '+', icon: <TrendingUp size={14} /> },
        DEBIT: { label: 'Keluar', badge: 'badge-danger', sign: '-', icon: <TrendingDown size={14} /> },
        TRANSFER_IN: { label: 'Transfer Masuk', badge: 'badge-success', sign: '+', icon: <ArrowRightLeft size={14} /> },
        TRANSFER_OUT: { label: 'Transfer Keluar', badge: 'badge-danger', sign: '-', icon: <ArrowRightLeft size={14} /> },
    };

    const handleExportExcel = () => {
        exportToExcel(transactions as unknown as Record<string, unknown>[], [
            { header: 'Tanggal', key: 'date', width: 15 },
            { header: 'Tipe', key: 'type', width: 15 },
            { header: 'Deskripsi', key: 'description', width: 35 },
            { header: 'Jumlah', key: 'amount', width: 18 },
            { header: 'Saldo Setelah', key: 'balanceAfter', width: 18 },
        ], `transaksi-${account?.bankName || 'bank'}-${new Date().toISOString().split('T')[0]}`, 'Transaksi');
    };

    const handlePrint = () => {
        if (!account) return;
        const bankColor = getBankColor(account.bankName);
        const w = window.open('', '_blank');
        if (!w) return;
        w.document.write(`<!DOCTYPE html><html><head><title>Mutasi ${account.bankName}</title><style>
            body { font-family: 'Segoe UI', sans-serif; padding: 2rem; color: #1e293b; max-width: 800px; margin: 0 auto; }
            .hdr { display: flex; align-items: center; gap: 1rem; margin-bottom: 1.5rem; padding-bottom: 1rem; border-bottom: 2px solid #e2e8f0; }
            .logo { width: 48px; height: 48px; border-radius: 10px; background: ${bankColor.gradient}; color: #fff; font-weight: 800; font-size: 16px; display: flex; align-items: center; justify-content: center; }
            h2 { margin: 0; } .sub { color: #64748b; font-size: 0.85rem; }
            .stats { display: flex; gap: 2rem; margin-bottom: 1.5rem; }
            .stat { flex: 1; text-align: center; padding: 0.75rem; background: #f8fafc; border-radius: 8px; }
            .stat-label { font-size: 0.7rem; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; }
            .stat-value { font-size: 1.25rem; font-weight: 700; margin-top: 0.2rem; }
            table { width: 100%; border-collapse: collapse; } th, td { padding: 0.5rem 0.6rem; text-align: left; border-bottom: 1px solid #e2e8f0; font-size: 0.82rem; }
            th { background: #f1f5f9; font-weight: 600; font-size: 0.72rem; text-transform: uppercase; }
            .r { text-align: right; } .b { font-weight: 700; } .s { color: #16a34a; } .d { color: #dc2626; }
            .footer { margin-top: 1.5rem; font-size: 0.72rem; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 0.5rem; }
            @media print { body { padding: 0.5rem; } .no-print { display: none !important; } }
        </style></head><body>
            <div class="hdr"><div class="logo">${account.bankName.slice(0, 3).toUpperCase()}</div><div><h2>Mutasi Rekening ${account.bankName}</h2><div class="sub">${account.accountNumber} — a.n. ${account.accountHolder} | Dicetak: ${new Date().toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' })}</div></div></div>
            <div class="stats">
                <div class="stat"><div class="stat-label">Saldo Saat Ini</div><div class="stat-value">${fmtNum(account.currentBalance || 0)}</div></div>
                <div class="stat"><div class="stat-label">Total Masuk</div><div class="stat-value s">${fmtNum(totalIn)}</div></div>
                <div class="stat"><div class="stat-label">Total Keluar</div><div class="stat-value d">${fmtNum(totalOut)}</div></div>
            </div>
            <table><thead><tr><th>Tanggal</th><th>Tipe</th><th>Deskripsi</th><th class="r">Jumlah</th><th class="r">Saldo</th></tr></thead>
            <tbody>${transactions.map(tx => {
            const cfg = typeConfig[tx.type] || typeConfig.CREDIT;
            return `<tr><td>${fmtDate(tx.date)}</td><td>${cfg.label}</td><td>${tx.description}</td><td class="r ${cfg.sign === '+' ? 's' : 'd'} b">${cfg.sign}${fmtNum(tx.amount)}</td><td class="r b">${fmtNum(tx.balanceAfter)}</td></tr>`;
        }).join('')}</tbody></table>
            <div class="footer">LOGISTIK Admin Panel • ${transactions.length} transaksi</div>
        </body></html>`);
        w.document.close();
        setTimeout(() => { w.print(); }, 300);
    };

    if (loading) return <div><div className="skeleton skeleton-title" /><div className="skeleton skeleton-card" style={{ height: 120 }} /><div className="skeleton skeleton-card" style={{ height: 300 }} /></div>;
    if (!account) return <div className="card"><div className="card-body">Rekening tidak ditemukan</div></div>;

    const bankColor = getBankColor(account.bankName);
    const totalIn = transactions.filter(t => t.type === 'CREDIT' || t.type === 'TRANSFER_IN').reduce((s, t) => s + t.amount, 0);
    const totalOut = transactions.filter(t => t.type === 'DEBIT' || t.type === 'TRANSFER_OUT').reduce((s, t) => s + t.amount, 0);

    return (
        <div>
            {/* Header with bank branding */}
            <div className="page-header">
                <div className="page-header-left" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <button className="btn btn-secondary btn-sm" onClick={() => router.push('/bank-accounts')}><ArrowLeft size={16} /></button>
                    <div style={{ width: 44, height: 44, borderRadius: '0.6rem', background: bankColor.gradient, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 800, fontSize: 15, flexShrink: 0, boxShadow: `0 2px 8px ${bankColor.color}40` }}>
                        {account.bankName.slice(0, 3).toUpperCase()}
                    </div>
                    <div>
                        <h1 className="page-title">{account.bankName}</h1>
                        <p className="page-subtitle" style={{ fontFamily: 'var(--font-mono, monospace)', letterSpacing: '0.03em' }}>{account.accountNumber} — a.n. {account.accountHolder}</p>
                    </div>
                </div>
                <div className="page-actions" style={{ flexWrap: 'wrap' }}>
                    <button className="btn btn-secondary btn-sm" onClick={handleExportExcel}><FileDown size={15} /> Excel</button>
                    <button className="btn btn-secondary btn-sm" onClick={() => setShowPrint(true)}><Printer size={15} /> Print</button>
                </div>
            </div>

            {/* Summary Cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
                <div className="card" style={{ background: bankColor.gradient, color: '#fff', overflow: 'hidden', position: 'relative' }}>
                    <div style={{ position: 'absolute', right: -15, top: -15, width: 80, height: 80, borderRadius: '50%', background: 'rgba(255,255,255,0.08)' }} />
                    <div className="card-body" style={{ padding: '1.1rem', position: 'relative' }}>
                        <div style={{ fontSize: '0.7rem', opacity: 0.8, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.25rem' }}>Saldo Saat Ini</div>
                        <div style={{ fontSize: '1.5rem', fontWeight: 700 }}>{fmt(account.currentBalance || 0)}</div>
                    </div>
                </div>
                <div className="card" style={{ overflow: 'hidden' }}>
                    <div className="card-body" style={{ padding: '1.1rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.25rem' }}>
                            <TrendingUp size={14} style={{ color: 'var(--success)' }} /> Total Masuk
                        </div>
                        <div style={{ fontSize: '1.35rem', fontWeight: 700, color: 'var(--success)' }}>{fmt(totalIn)}</div>
                    </div>
                </div>
                <div className="card" style={{ overflow: 'hidden' }}>
                    <div className="card-body" style={{ padding: '1.1rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.25rem' }}>
                            <TrendingDown size={14} style={{ color: 'var(--danger)' }} /> Total Keluar
                        </div>
                        <div style={{ fontSize: '1.35rem', fontWeight: 700, color: 'var(--danger)' }}>{fmt(totalOut)}</div>
                    </div>
                </div>
                <div className="card" style={{ overflow: 'hidden' }}>
                    <div className="card-body" style={{ padding: '1.1rem' }}>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.25rem' }}>Transaksi</div>
                        <div style={{ fontSize: '1.35rem', fontWeight: 700 }}>{transactions.length}</div>
                    </div>
                </div>
            </div>

            {/* Transaction History */}
            <div className="card">
                <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span className="card-header-title">Riwayat Transaksi</span>
                    <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{transactions.length} transaksi</span>
                </div>
                <div className="table-wrapper" style={{ overflowX: 'auto' }}>
                    <table style={{ minWidth: 600 }}>
                        <thead>
                            <tr><th>Tanggal</th><th>Tipe</th><th>Deskripsi</th><th style={{ textAlign: 'right' }}>Jumlah</th><th style={{ textAlign: 'right' }}>Saldo Setelah</th></tr>
                        </thead>
                        <tbody suppressHydrationWarning>
                            {transactions.length === 0 ? (
                                <tr><td colSpan={5} style={{ textAlign: 'center', padding: '3rem 1rem', color: 'var(--text-muted)' }}>
                                    <div style={{ fontSize: '2rem', marginBottom: '0.5rem', opacity: 0.3 }}>📋</div>
                                    <div>Belum ada transaksi</div>
                                </td></tr>
                            ) : transactions.map(tx => {
                                const cfg = typeConfig[tx.type] || typeConfig.CREDIT;
                                const isPositive = tx.type === 'CREDIT' || tx.type === 'TRANSFER_IN';
                                return (
                                    <tr key={tx._id} style={{ transition: 'background 0.1s' }}
                                        onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-secondary, #f8fafc)')}
                                        onMouseLeave={e => (e.currentTarget.style.background = '')}>
                                        <td style={{ whiteSpace: 'nowrap' }}>
                                            <div style={{ fontSize: '0.85rem' }}>{fmtDate(tx.date)}</div>
                                        </td>
                                        <td>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                                                <span style={{ color: isPositive ? 'var(--success)' : 'var(--danger)', display: 'flex' }}>{cfg.icon}</span>
                                                <span className={`badge ${cfg.badge}`} style={{ fontSize: '0.68rem' }}>{cfg.label}</span>
                                            </div>
                                        </td>
                                        <td>{tx.description}</td>
                                        <td style={{ textAlign: 'right', fontWeight: 700, fontFamily: 'var(--font-mono, monospace)', color: isPositive ? 'var(--success)' : 'var(--danger)', whiteSpace: 'nowrap' }}>
                                            {cfg.sign}{fmt(tx.amount)}
                                        </td>
                                        <td style={{ textAlign: 'right', fontWeight: 600, fontFamily: 'var(--font-mono, monospace)', whiteSpace: 'nowrap' }}>{fmt(tx.balanceAfter)}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Print Preview Modal */}
            {showPrint && (
                <div className="modal-overlay" onClick={() => setShowPrint(false)}>
                    <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 800, maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
                        <div className="modal-header">
                            <h3 className="modal-title">Print Preview — Mutasi {account.bankName}</h3>
                            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                <button className="btn btn-primary btn-sm" onClick={handlePrint}><Printer size={14} /> Print</button>
                                <button className="modal-close" onClick={() => setShowPrint(false)}>×</button>
                            </div>
                        </div>
                        <div style={{ flex: 1, overflow: 'auto', padding: '1.5rem' }}>
                            {/* Preview header */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem', paddingBottom: '0.75rem', borderBottom: '2px solid var(--border-color)' }}>
                                <div style={{ width: 40, height: 40, borderRadius: '0.5rem', background: bankColor.gradient, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 800, fontSize: 14 }}>{account.bankName.slice(0, 3).toUpperCase()}</div>
                                <div>
                                    <div style={{ fontWeight: 700, fontSize: '1rem' }}>Mutasi Rekening {account.bankName}</div>
                                    <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{account.accountNumber} — a.n. {account.accountHolder} | Dicetak: {fmtDateLong(new Date().toISOString())}</div>
                                </div>
                            </div>

                            {/* Preview stats */}
                            <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem' }}>
                                <div style={{ flex: 1, textAlign: 'center', padding: '0.6rem', background: 'var(--bg-secondary)', borderRadius: '0.4rem' }}>
                                    <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Saldo</div>
                                    <div style={{ fontWeight: 700, fontSize: '1rem' }}>{fmt(account.currentBalance || 0)}</div>
                                </div>
                                <div style={{ flex: 1, textAlign: 'center', padding: '0.6rem', background: 'var(--bg-secondary)', borderRadius: '0.4rem' }}>
                                    <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Total Masuk</div>
                                    <div style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--success)' }}>{fmt(totalIn)}</div>
                                </div>
                                <div style={{ flex: 1, textAlign: 'center', padding: '0.6rem', background: 'var(--bg-secondary)', borderRadius: '0.4rem' }}>
                                    <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Total Keluar</div>
                                    <div style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--danger)' }}>{fmt(totalOut)}</div>
                                </div>
                            </div>

                            {/* Preview table */}
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                                <thead><tr style={{ background: 'var(--bg-secondary)' }}>
                                    {['Tanggal', 'Tipe', 'Deskripsi', 'Jumlah', 'Saldo'].map(h => (
                                        <th key={h} style={{ padding: '0.5rem 0.6rem', textAlign: h === 'Jumlah' || h === 'Saldo' ? 'right' : 'left', fontWeight: 600, fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.03em', borderBottom: '2px solid var(--border-color)' }}>{h}</th>
                                    ))}
                                </tr></thead>
                                <tbody>
                                    {transactions.map(tx => {
                                        const cfg = typeConfig[tx.type] || typeConfig.CREDIT;
                                        const isPositive = tx.type === 'CREDIT' || tx.type === 'TRANSFER_IN';
                                        return (
                                            <tr key={tx._id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                                                <td style={{ padding: '0.45rem 0.6rem' }}>{fmtDate(tx.date)}</td>
                                                <td style={{ padding: '0.45rem 0.6rem' }}>{cfg.label}</td>
                                                <td style={{ padding: '0.45rem 0.6rem' }}>{tx.description}</td>
                                                <td style={{ padding: '0.45rem 0.6rem', textAlign: 'right', fontWeight: 600, color: isPositive ? 'var(--success)' : 'var(--danger)' }}>{cfg.sign}{fmt(tx.amount)}</td>
                                                <td style={{ padding: '0.45rem 0.6rem', textAlign: 'right', fontWeight: 600 }}>{fmt(tx.balanceAfter)}</td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                            <div style={{ marginTop: '1rem', fontSize: '0.72rem', color: 'var(--text-muted)', borderTop: '1px solid var(--border-color)', paddingTop: '0.5rem' }}>
                                LOGISTIK Admin Panel • {transactions.length} transaksi
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
