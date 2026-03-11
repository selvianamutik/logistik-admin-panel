'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, ArrowRightLeft, FileDown, Printer, TrendingDown, TrendingUp } from 'lucide-react';

import { useToast } from '../../layout';
import { exportToExcel } from '@/lib/export';
import { fetchCompanyProfile, openBrandedPrint } from '@/lib/print';
import type { BankAccount, BankTransaction } from '@/lib/types';

const BANK_LOGOS: Record<string, { logo: string; color: string; gradient: string }> = {
    CASH: { color: '#14532d', gradient: 'linear-gradient(135deg, #14532d 0%, #16a34a 100%)', logo: '' },
    BCA: { color: '#003b7b', gradient: 'linear-gradient(135deg, #003b7b 0%, #0060c7 100%)', logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5c/Bank_Central_Asia.svg/200px-Bank_Central_Asia.svg.png' },
    MANDIRI: { color: '#003868', gradient: 'linear-gradient(135deg, #003868 0%, #005ba5 100%)', logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ad/Bank_Mandiri_logo_2016.svg/200px-Bank_Mandiri_logo_2016.svg.png' },
    BRI: { color: '#00529c', gradient: 'linear-gradient(135deg, #00529c 0%, #0078d4 100%)', logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/68/BANK_BRI_logo.svg/200px-Bank_BRI_logo.svg.png' },
    BNI: { color: '#e35205', gradient: 'linear-gradient(135deg, #e35205 0%, #f97316 100%)', logo: 'https://upload.wikimedia.org/wikipedia/id/thumb/5/55/BNI_logo.svg/200px-BNI_logo.svg.png' },
    BSI: { color: '#00a650', gradient: 'linear-gradient(135deg, #00a650 0%, #22c55e 100%)', logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/84/Bank_Syariah_Indonesia.svg/200px-Bank_Syariah_Indonesia.svg.png' },
    DEFAULT: { color: '#6b7280', gradient: 'linear-gradient(135deg, #374151 0%, #6b7280 100%)', logo: '' },
};

function isCashAccount(account: Pick<BankAccount, 'accountType' | 'systemKey'>) {
    return account.accountType === 'CASH' || account.systemKey === 'cash-on-hand';
}

function getBankInfo(name: string) {
    const key = Object.keys(BANK_LOGOS).find(bank => bank !== 'DEFAULT' && name.toUpperCase().includes(bank));
    return BANK_LOGOS[key || 'DEFAULT'];
}

function BankDetailLogo({ name, size = 48 }: { name: string; size?: number }) {
    const info = getBankInfo(name);
    const [err, setErr] = useState(false);

    if (info.logo && !err) {
        return (
            <div style={{ width: size, height: size, borderRadius: '0.6rem', background: '#fff', border: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, overflow: 'hidden', padding: size * 0.08 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={info.logo} alt={name} style={{ width: '100%', height: '100%', objectFit: 'contain' }} onError={() => setErr(true)} />
            </div>
        );
    }

    return (
        <div style={{ width: size, height: size, borderRadius: '0.6rem', background: info.gradient, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 800, fontSize: size * 0.32, flexShrink: 0, boxShadow: `0 2px 8px ${info.color}40` }}>
            {name.slice(0, 3).toUpperCase()}
        </div>
    );
}

export default function BankAccountDetailPage() {
    const params = useParams();
    const router = useRouter();
    const { addToast } = useToast();
    const accountId = params.id as string;
    const [account, setAccount] = useState<BankAccount | null>(null);
    const [transactions, setTransactions] = useState<BankTransaction[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchEntity = async <T,>(url: string) => {
            const res = await fetch(url);
            const result = await res.json();
            if (!res.ok) {
                throw new Error(result.error || 'Gagal memuat detail rekening');
            }
            return result.data as T;
        };

        const loadAccountDetail = async () => {
            setLoading(true);
            try {
                const [accountData, transactionData] = await Promise.all([
                    fetchEntity<BankAccount | null>(`/api/data?entity=bank-accounts&id=${accountId}`),
                    fetchEntity<BankTransaction[]>(`/api/data?entity=bank-transactions&filter=${encodeURIComponent(JSON.stringify({ bankAccountRef: accountId }))}`),
                ]);
                setAccount(accountData);
                setTransactions(
                    (transactionData || []).sort(
                        (a, b) =>
                            new Date(b.date || b._createdAt || '').getTime() -
                            new Date(a.date || a._createdAt || '').getTime()
                    )
                );
            } catch (error) {
                addToast('error', error instanceof Error ? error.message : 'Gagal memuat detail rekening');
            } finally {
                setLoading(false);
            }
        };

        void loadAccountDetail();
    }, [accountId, addToast]);

    const fmt = (n: number) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(n);
    const fmtN = (n: number) => new Intl.NumberFormat('id-ID').format(n);
    const fmtDate = (d: string) => {
        try {
            return new Date(d).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
        } catch {
            return d;
        }
    };

    const typeConfig: Record<string, { label: string; badge: string; sign: string; icon: ReactNode }> = {
        CREDIT: { label: 'Masuk', badge: 'badge-success', sign: '+', icon: <TrendingUp size={14} /> },
        DEBIT: { label: 'Keluar', badge: 'badge-danger', sign: '-', icon: <TrendingDown size={14} /> },
        TRANSFER_IN: { label: 'Transfer Masuk', badge: 'badge-success', sign: '+', icon: <ArrowRightLeft size={14} /> },
        TRANSFER_OUT: { label: 'Transfer Keluar', badge: 'badge-danger', sign: '-', icon: <ArrowRightLeft size={14} /> },
    };

    const handleExportExcel = () => {
        exportToExcel(
            transactions as unknown as Record<string, unknown>[],
            [
                { header: 'Tanggal', key: 'date', width: 15 },
                { header: 'Tipe', key: 'type', width: 15 },
                { header: 'Deskripsi', key: 'description', width: 35 },
                { header: 'Jumlah', key: 'amount', width: 18 },
                { header: 'Saldo Setelah', key: 'balanceAfter', width: 18 },
            ],
            `mutasi-${account?.bankName || 'akun'}-${new Date().toISOString().split('T')[0]}`,
            'Transaksi'
        );
    };

    if (loading) {
        return <div><div className="skeleton skeleton-title" /><div className="skeleton skeleton-card" style={{ height: 120 }} /><div className="skeleton skeleton-card" style={{ height: 300 }} /></div>;
    }

    if (!account) {
        return <div className="card"><div className="card-body">Rekening tidak ditemukan</div></div>;
    }

    const cashAccount = isCashAccount(account);
    const bankInfo = cashAccount ? BANK_LOGOS.CASH : getBankInfo(account.bankName);
    const totalIn = transactions.filter(tx => tx.type === 'CREDIT' || tx.type === 'TRANSFER_IN').reduce((sum, tx) => sum + tx.amount, 0);
    const totalOut = transactions.filter(tx => tx.type === 'DEBIT' || tx.type === 'TRANSFER_OUT').reduce((sum, tx) => sum + tx.amount, 0);

    const handlePrint = async () => {
        try {
            const company = await fetchCompanyProfile();
            const rows = transactions.length === 0
                ? '<tr><td colspan="5" class="c">Belum ada transaksi</td></tr>'
                : transactions.map(tx => {
                    const cfg = typeConfig[tx.type] || typeConfig.CREDIT;
                    return `<tr><td>${fmtDate(tx.date)}</td><td>${cfg.label}</td><td>${tx.description}</td><td class="r ${cfg.sign === '+' ? 's' : 'd'} b">${cfg.sign}${fmtN(tx.amount)}</td><td class="r b">${fmtN(tx.balanceAfter)}</td></tr>`;
                }).join('');

            openBrandedPrint({
                title: cashAccount ? `Mutasi Kas ${account.bankName}` : `Mutasi Rekening ${account.bankName}`,
                subtitle: `${account.accountNumber} - a.n. ${account.accountHolder}`,
                company,
                bodyHtml: `
                    <div class="stats-row">
                        <div class="stat-box"><div class="stat-label">Saldo Saat Ini</div><div class="stat-value">${fmtN(account.currentBalance || 0)}</div></div>
                        <div class="stat-box"><div class="stat-label">Total Masuk</div><div class="stat-value s">${fmtN(totalIn)}</div></div>
                        <div class="stat-box"><div class="stat-label">Total Keluar</div><div class="stat-value d">${fmtN(totalOut)}</div></div>
                    </div>
                    <table>
                        <thead>
                            <tr><th>Tanggal</th><th>Tipe</th><th>Deskripsi</th><th class="r">Jumlah</th><th class="r">Saldo</th></tr>
                        </thead>
                        <tbody>${rows}</tbody>
                    </table>
                `,
            });
        } catch {
            addToast('error', 'Gagal menyiapkan dokumen print rekening');
        }
    };

    return (
        <div>
            <div className="page-header">
                <div className="page-header-left" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <button className="btn-back" onClick={() => router.push('/bank-accounts')}><ArrowLeft size={16} /></button>
                    <BankDetailLogo name={account.bankName} size={44} />
                    <div>
                        <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                            {account.bankName}
                            {cashAccount && <span className="badge badge-success">Kas Tunai</span>}
                        </h1>
                        <p className="page-subtitle" style={{ fontFamily: 'var(--font-mono, monospace)', letterSpacing: '0.03em' }}>{account.accountNumber} - a.n. {account.accountHolder}</p>
                    </div>
                </div>
                <div className="page-actions" style={{ flexWrap: 'wrap' }}>
                    <button className="btn btn-secondary btn-sm" onClick={handleExportExcel}><FileDown size={15} /> Excel</button>
                    <button className="btn btn-secondary btn-sm" onClick={handlePrint}><Printer size={15} /> Print</button>
                </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
                <div className="card" style={{ background: bankInfo.gradient, color: '#fff', overflow: 'hidden', position: 'relative' }}>
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
                                    <div style={{ fontSize: '2rem', marginBottom: '0.5rem', opacity: 0.3 }}>-</div>
                                    <div>Belum ada transaksi</div>
                                </td></tr>
                            ) : transactions.map(tx => {
                                const cfg = typeConfig[tx.type] || typeConfig.CREDIT;
                                const isPositive = tx.type === 'CREDIT' || tx.type === 'TRANSFER_IN';
                                return (
                                    <tr key={tx._id} style={{ transition: 'background 0.1s' }}
                                        onMouseEnter={event => (event.currentTarget.style.background = 'var(--bg-secondary, #f8fafc)')}
                                        onMouseLeave={event => (event.currentTarget.style.background = '')}>
                                        <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(tx.date)}</td>
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
        </div>
    );
}
