'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Landmark, TrendingUp, TrendingDown, ArrowRightLeft } from 'lucide-react';
import type { BankAccount, BankTransaction } from '@/lib/types';

export default function BankAccountDetailPage() {
    const { id } = useParams();
    const router = useRouter();
    const [account, setAccount] = useState<BankAccount | null>(null);
    const [transactions, setTransactions] = useState<BankTransaction[]>([]);
    const [loading, setLoading] = useState(true);

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
    const fmtDate = (d: string) => { try { return new Date(d).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }); } catch { return d; } };

    const getTypeIcon = (type: string) => {
        switch (type) {
            case 'CREDIT': return <TrendingUp size={16} style={{ color: 'var(--success)' }} />;
            case 'DEBIT': return <TrendingDown size={16} style={{ color: 'var(--danger)' }} />;
            case 'TRANSFER_IN': return <ArrowRightLeft size={16} style={{ color: 'var(--success)' }} />;
            case 'TRANSFER_OUT': return <ArrowRightLeft size={16} style={{ color: 'var(--danger)' }} />;
            default: return null;
        }
    };

    const getTypeLabel = (type: string) => {
        switch (type) {
            case 'CREDIT': return 'Masuk';
            case 'DEBIT': return 'Keluar';
            case 'TRANSFER_IN': return 'Transfer Masuk';
            case 'TRANSFER_OUT': return 'Transfer Keluar';
            default: return type;
        }
    };

    if (loading) return <div><div className="skeleton skeleton-title" /><div className="skeleton skeleton-card" style={{ height: 200 }} /><div className="skeleton skeleton-card" style={{ height: 300 }} /></div>;
    if (!account) return <div className="card"><div className="card-body">Rekening tidak ditemukan</div></div>;

    const totalIn = transactions.filter(t => t.type === 'CREDIT' || t.type === 'TRANSFER_IN').reduce((s, t) => s + t.amount, 0);
    const totalOut = transactions.filter(t => t.type === 'DEBIT' || t.type === 'TRANSFER_OUT').reduce((s, t) => s + t.amount, 0);

    return (
        <div>
            <div className="page-header">
                <div className="page-header-left">
                    <button className="btn btn-secondary btn-sm" onClick={() => router.push('/bank-accounts')} style={{ marginRight: '0.75rem' }}><ArrowLeft size={16} /></button>
                    <div>
                        <h1 className="page-title">{account.bankName}</h1>
                        <p className="page-subtitle">{account.accountNumber} — a.n. {account.accountHolder}</p>
                    </div>
                </div>
            </div>

            {/* Summary Cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
                <div className="card">
                    <div className="card-body" style={{ padding: '1rem', textAlign: 'center' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                            <Landmark size={18} style={{ color: 'var(--primary)' }} />
                            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Saldo Saat Ini</span>
                        </div>
                        <div style={{ fontSize: '1.5rem', fontWeight: 700, color: (account.currentBalance || 0) >= 0 ? 'var(--success)' : 'var(--danger)' }}>{fmt(account.currentBalance || 0)}</div>
                    </div>
                </div>
                <div className="card">
                    <div className="card-body" style={{ padding: '1rem', textAlign: 'center' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                            <TrendingUp size={18} style={{ color: 'var(--success)' }} />
                            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Total Masuk</span>
                        </div>
                        <div style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--success)' }}>{fmt(totalIn)}</div>
                    </div>
                </div>
                <div className="card">
                    <div className="card-body" style={{ padding: '1rem', textAlign: 'center' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                            <TrendingDown size={18} style={{ color: 'var(--danger)' }} />
                            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Total Keluar</span>
                        </div>
                        <div style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--danger)' }}>{fmt(totalOut)}</div>
                    </div>
                </div>
            </div>

            {/* Transaction History */}
            <div className="card">
                <div className="card-header"><span className="card-header-title">Riwayat Transaksi ({transactions.length})</span></div>
                <div className="table-wrapper">
                    <table>
                        <thead>
                            <tr><th>Tanggal</th><th>Tipe</th><th>Deskripsi</th><th style={{ textAlign: 'right' }}>Jumlah</th><th style={{ textAlign: 'right' }}>Saldo Setelah</th></tr>
                        </thead>
                        <tbody suppressHydrationWarning>
                            {transactions.length === 0 ? (
                                <tr><td colSpan={5} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>Belum ada transaksi</td></tr>
                            ) : transactions.map(tx => (
                                <tr key={tx._id}>
                                    <td>{fmtDate(tx.date)}</td>
                                    <td>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                            {getTypeIcon(tx.type)}
                                            <span className={`badge ${tx.type === 'CREDIT' || tx.type === 'TRANSFER_IN' ? 'badge-success' : 'badge-danger'}`} style={{ fontSize: '0.7rem' }}>
                                                {getTypeLabel(tx.type)}
                                            </span>
                                        </div>
                                    </td>
                                    <td>{tx.description}</td>
                                    <td style={{ textAlign: 'right', fontWeight: 600, color: tx.type === 'CREDIT' || tx.type === 'TRANSFER_IN' ? 'var(--success)' : 'var(--danger)' }}>
                                        {tx.type === 'CREDIT' || tx.type === 'TRANSFER_IN' ? '+' : '-'}{fmt(tx.amount)}
                                    </td>
                                    <td style={{ textAlign: 'right', fontWeight: 500 }}>{fmt(tx.balanceAfter)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
