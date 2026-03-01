'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useToast, useApp } from '../../layout';
import { ArrowLeft, Printer, FileDown, DollarSign, Landmark, TrendingUp } from 'lucide-react';
import { formatDate, formatCurrency, INVOICE_STATUS_MAP, PAYMENT_METHOD_MAP, terbilang } from '@/lib/utils';
import { generateInvoicePdf } from '@/lib/pdf/invoiceTemplate';
import type { Invoice, InvoiceItem, Payment, CompanyProfile, BankAccount } from '@/lib/types';

export default function InvoiceDetailPage() {
    const params = useParams();
    const router = useRouter();
    const { addToast } = useToast();
    useApp();
    const [invoice, setInvoice] = useState<Invoice | null>(null);
    const [items, setItems] = useState<InvoiceItem[]>([]);
    const [payments, setPayments] = useState<Payment[]>([]);
    const [loading, setLoading] = useState(true);
    const [showPayModal, setShowPayModal] = useState(false);
    const [payAmount, setPayAmount] = useState(0);
    const [payMethod, setPayMethod] = useState('TRANSFER');
    const [payDate, setPayDate] = useState(new Date().toISOString().split('T')[0]);
    const [payNote, setPayNote] = useState('');
    const [payBankRef, setPayBankRef] = useState('');
    const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);

    useEffect(() => {
        const id = params.id as string;
        Promise.all([
            fetch(`/api/data?entity=invoices&id=${id}`).then(r => r.json()),
            fetch(`/api/data?entity=invoice-items`).then(r => r.json()),
            fetch(`/api/data?entity=payments`).then(r => r.json()),
            fetch('/api/data?entity=bank-accounts').then(r => r.json()),
        ]).then(([inv, ii, pay, ba]) => {
            setInvoice(inv.data);
            setItems((ii.data || []).filter((i: InvoiceItem) => i.invoiceRef === id));
            setPayments((pay.data || []).filter((p: Payment) => p.invoiceRef === id));
            setBankAccounts((ba.data || []).filter((a: BankAccount) => a.active !== false));
            setLoading(false);
        }).catch(() => setLoading(false));
    }, [params.id]);

    const totalPaid = payments.reduce((s, p) => s + p.amount, 0);
    const remaining = (invoice?.totalAmount || 0) - totalPaid;
    const paidPercent = Math.min(100, (totalPaid / (invoice?.totalAmount || 1)) * 100);

    const handleAddPayment = async () => {
        if (payAmount <= 0) { addToast('error', 'Nominal harus lebih dari 0'); return; }
        try {
            await fetch('/api/data', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ entity: 'payments', data: { invoiceRef: invoice?._id, date: payDate, amount: payAmount, method: payMethod, note: payNote, bankAccountRef: payBankRef || undefined } }),
            });
            addToast('success', 'Pembayaran dicatat');
            setShowPayModal(false);
            window.location.reload();
        } catch { addToast('error', 'Gagal'); }
    };

    if (loading) return <div><div className="skeleton skeleton-title" /><div className="skeleton skeleton-card" style={{ height: 200 }} /></div>;
    if (!invoice) return <div className="empty-state"><div className="empty-state-title">Invoice tidak ditemukan</div></div>;

    const statusConf = INVOICE_STATUS_MAP[invoice.status] || { label: invoice.status, color: 'secondary' };

    return (
        <div>
            {/* Compact Header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
                <button className="btn-back" onClick={() => router.push('/invoices')}><ArrowLeft size={16} /></button>
                <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
                        <h1 style={{ fontSize: '1.25rem', fontWeight: 700, margin: 0 }}>{invoice.invoiceNumber}</h1>
                        <span className={`badge badge-${statusConf.color}`}><span className="badge-dot" /> {statusConf.label}</span>
                    </div>
                </div>
                <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                    {invoice.status !== 'PAID' && (
                        <button className="btn btn-success btn-sm" onClick={() => setShowPayModal(true)}><DollarSign size={14} /> Bayar</button>
                    )}
                    <button className="btn btn-secondary btn-sm" onClick={async () => {
                        try {
                            const companyRes = await fetch('/api/data?entity=company');
                            const companyData = await companyRes.json();
                            generateInvoicePdf(invoice, items, payments, companyData.data as CompanyProfile);
                            addToast('success', 'PDF berhasil di-download');
                        } catch { addToast('error', 'Gagal membuat PDF'); }
                    }}><FileDown size={14} /> PDF</button>
                    <button className="btn btn-secondary btn-sm" onClick={() => window.print()}><Printer size={14} /></button>
                </div>
            </div>

            {/* 2-Column Layout */}
            <div className="detail-grid">
                {/* LEFT: Invoice Info */}
                <div>
                    <div className="card">
                        <div className="card-header"><span className="card-header-title">Detail Invoice</span></div>
                        <div className="card-body">
                            <div className="detail-row">
                                <div className="detail-item"><div className="detail-label">No. Invoice</div><div className="detail-value font-mono">{invoice.invoiceNumber}</div></div>
                                <div className="detail-item"><div className="detail-label">Mode</div><div className="detail-value">{invoice.mode}</div></div>
                            </div>
                            <div className="detail-row">
                                <div className="detail-item"><div className="detail-label">Tanggal Terbit</div><div className="detail-value">{formatDate(invoice.issueDate)}</div></div>
                                <div className="detail-item"><div className="detail-label">Jatuh Tempo</div><div className="detail-value">{formatDate(invoice.dueDate)}</div></div>
                            </div>
                            <div className="detail-row">
                                <div className="detail-item"><div className="detail-label">Customer</div><div className="detail-value">{invoice.customerName}</div></div>
                                <div className="detail-item"><div className="detail-label">Resi</div><div className="detail-value"><Link href={`/orders/${invoice.orderRef}`}>{invoice.masterResi}</Link></div></div>
                            </div>
                        </div>
                    </div>

                    {/* Invoice Items */}
                    <div className="card mt-6">
                        <div className="card-header"><span className="card-header-title">Item Invoice</span></div>
                        <div className="table-wrapper">
                            <table>
                                <thead><tr><th>Deskripsi</th><th style={{ textAlign: 'center' }}>Qty</th><th style={{ textAlign: 'right' }}>Harga</th><th style={{ textAlign: 'right' }}>Subtotal</th></tr></thead>
                                <tbody>
                                    {items.map(item => (
                                        <tr key={item._id}>
                                            <td>{item.description}</td>
                                            <td style={{ textAlign: 'center' }}>{item.qty || 1}</td>
                                            <td style={{ textAlign: 'right' }}>{formatCurrency(item.price)}</td>
                                            <td style={{ textAlign: 'right', fontWeight: 600 }}>{formatCurrency(item.subtotal)}</td>
                                        </tr>
                                    ))}
                                    <tr style={{ background: 'var(--color-gray-50)' }}>
                                        <td colSpan={3} className="text-right font-bold">Total</td>
                                        <td className="text-right font-bold">{formatCurrency(invoice.totalAmount)}</td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>

                {/* RIGHT: Payment Summary + History */}
                <div>
                    {/* Payment Summary Card */}
                    <div className="card" style={{ overflow: 'hidden' }}>
                        <div style={{ background: 'linear-gradient(135deg, var(--color-primary) 0%, #7c3aed 100%)', color: '#fff', padding: '1.25rem' }}>
                            <div style={{ fontSize: '0.72rem', opacity: 0.8, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.25rem' }}>Total Invoice</div>
                            <div style={{ fontSize: '1.75rem', fontWeight: 700 }}>{formatCurrency(invoice.totalAmount)}</div>
                            <div style={{ fontSize: '0.78rem', opacity: 0.7, marginTop: '0.15rem' }}>Terbilang: {terbilang(invoice.totalAmount).trim()} rupiah</div>
                        </div>
                        <div className="card-body">
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                                <div>
                                    <div style={{ fontSize: '0.7rem', color: 'var(--color-gray-400)', textTransform: 'uppercase' }}>Sudah Dibayar</div>
                                    <div style={{ fontSize: '1.15rem', fontWeight: 700, color: 'var(--color-success)' }}>{formatCurrency(totalPaid)}</div>
                                </div>
                                <div style={{ textAlign: 'right' }}>
                                    <div style={{ fontSize: '0.7rem', color: 'var(--color-gray-400)', textTransform: 'uppercase' }}>Sisa</div>
                                    <div style={{ fontSize: '1.15rem', fontWeight: 700, color: remaining > 0 ? 'var(--color-danger)' : 'var(--color-success)' }}>{formatCurrency(remaining)}</div>
                                </div>
                            </div>
                            <div className="progress-bar" style={{ marginBottom: '0.5rem' }}>
                                <div className={`progress-bar-fill ${paidPercent >= 100 ? 'success' : ''}`} style={{ width: `${paidPercent}%` }} />
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', color: 'var(--color-gray-400)' }}>
                                <span>{paidPercent.toFixed(0)}% terbayar</span>
                                <span>{payments.length} pembayaran</span>
                            </div>
                        </div>
                    </div>

                    {/* Payment History */}
                    <div className="card mt-6">
                        <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span className="card-header-title">Riwayat Pembayaran</span>
                            {invoice.status !== 'PAID' && (
                                <button className="btn btn-success btn-sm" onClick={() => setShowPayModal(true)} style={{ fontSize: '0.72rem', padding: '0.3rem 0.6rem' }}>
                                    <DollarSign size={12} /> Tambah
                                </button>
                            )}
                        </div>
                        <div className="card-body" style={{ padding: payments.length === 0 ? '2rem 1.5rem' : 0 }}>
                            {payments.length === 0 ? (
                                <div style={{ textAlign: 'center', color: 'var(--color-gray-400)' }}>
                                    <div style={{ fontSize: '1.5rem', opacity: 0.3, marginBottom: '0.25rem' }}>💰</div>
                                    <div style={{ fontSize: '0.82rem' }}>Belum ada pembayaran</div>
                                </div>
                            ) : (
                                <div>
                                    {payments.map((p, i) => (
                                        <div key={p._id} style={{ padding: '0.75rem 1rem', borderBottom: i < payments.length - 1 ? '1px solid var(--color-gray-100)' : 'none' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.2rem' }}>
                                                <div style={{ fontSize: '0.82rem', fontWeight: 600 }}>{formatDate(p.date)}</div>
                                                <div style={{ fontSize: '0.92rem', fontWeight: 700, color: 'var(--color-success)' }}>+{formatCurrency(p.amount)}</div>
                                            </div>
                                            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', fontSize: '0.72rem', color: 'var(--color-gray-400)' }}>
                                                <span className={`badge badge-${p.method === 'CASH' ? 'warning' : 'info'}`} style={{ fontSize: '0.62rem' }}>{PAYMENT_METHOD_MAP[p.method] || p.method}</span>
                                                {p.bankAccountName && (
                                                    <Link href={`/bank-accounts/${p.bankAccountRef}`} style={{ display: 'flex', alignItems: 'center', gap: '0.2rem', color: 'var(--color-primary)', textDecoration: 'none', fontWeight: 500 }}>
                                                        <Landmark size={10} /> {p.bankAccountName}
                                                    </Link>
                                                )}
                                                {p.note && <span>· {p.note}</span>}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* Payment Modal */}
            {showPayModal && (
                <div className="modal-overlay" onClick={() => setShowPayModal(false)}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3 className="modal-title">Tambah Pembayaran</h3>
                            <button className="modal-close" onClick={() => setShowPayModal(false)}>&times;</button>
                        </div>
                        <div className="modal-body">
                            <div style={{ background: 'var(--color-gray-50)', borderRadius: '0.5rem', padding: '0.75rem 1rem', marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <div><div style={{ fontSize: '0.68rem', color: 'var(--color-gray-400)', textTransform: 'uppercase' }}>Sisa Tagihan</div>
                                    <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--color-danger)' }}>{formatCurrency(remaining)}</div></div>
                                <button className="btn btn-sm btn-ghost" onClick={() => setPayAmount(remaining)} style={{ fontSize: '0.72rem' }}>Bayar penuh</button>
                            </div>
                            <div className="form-group"><label className="form-label">Tanggal</label><input type="date" className="form-input" value={payDate} onChange={e => setPayDate(e.target.value)} /></div>
                            <div className="form-group"><label className="form-label">Nominal (Rp)</label><input type="number" className="form-input" value={payAmount || ''} onChange={e => setPayAmount(Number(e.target.value))} placeholder={`Sisa: ${formatCurrency(remaining)}`} /></div>
                            <div className="form-row">
                                <div className="form-group"><label className="form-label">Metode</label>
                                    <select className="form-select" value={payMethod} onChange={e => setPayMethod(e.target.value)}>
                                        <option value="TRANSFER">Transfer</option><option value="CASH">Tunai</option><option value="OTHER">Lainnya</option>
                                    </select>
                                </div>
                                <div className="form-group"><label className="form-label">Masuk ke Rekening</label>
                                    <select className="form-select" value={payBankRef} onChange={e => setPayBankRef(e.target.value)}>
                                        <option value="">-- Pilih rekening --</option>
                                        {bankAccounts.map(a => <option key={a._id} value={a._id}>{a.bankName} - {a.accountNumber}</option>)}
                                    </select>
                                </div>
                            </div>
                            <div className="form-group"><label className="form-label">Catatan</label><textarea className="form-textarea" rows={2} value={payNote} onChange={e => setPayNote(e.target.value)} placeholder="Opsional..." /></div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setShowPayModal(false)}>Batal</button>
                            <button className="btn btn-success" onClick={handleAddPayment}><DollarSign size={16} /> Simpan Pembayaran</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
