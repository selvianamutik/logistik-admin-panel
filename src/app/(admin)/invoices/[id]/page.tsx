'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useToast, useApp } from '../../layout';
import { ArrowLeft, Printer, FileDown, DollarSign } from 'lucide-react';
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
        ]).then(([inv, ii, pay]) => {
            setInvoice(inv.data);
            setItems((ii.data || []).filter((i: InvoiceItem) => i.invoiceRef === id));
            setPayments((pay.data || []).filter((p: Payment) => p.invoiceRef === id));
            setLoading(false);
        }).catch(() => setLoading(false));
        // Fetch bank accounts
        fetch('/api/data?entity=bank-accounts').then(r => r.json()).then(d => setBankAccounts((d.data || []).filter((a: BankAccount) => a.active !== false)));
    }, [params.id]);

    const totalPaid = payments.reduce((s, p) => s + p.amount, 0);
    const remaining = (invoice?.totalAmount || 0) - totalPaid;

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

    return (
        <div>
            <div className="page-header">
                <div className="page-header-left">
                    <button className="btn btn-ghost btn-sm mb-2" onClick={() => router.push('/invoices')}><ArrowLeft size={16} /> Kembali</button>
                    <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        {invoice.invoiceNumber}
                        <span className={`badge badge-${INVOICE_STATUS_MAP[invoice.status]?.color}`}><span className="badge-dot" /> {INVOICE_STATUS_MAP[invoice.status]?.label}</span>
                    </h1>
                </div>
                <div className="page-actions">
                    {invoice.status !== 'PAID' && (
                        <button className="btn btn-success" onClick={() => setShowPayModal(true)}><DollarSign size={16} /> Tambah Pembayaran</button>
                    )}
                    <button className="btn btn-secondary" onClick={async () => {
                        try {
                            const companyRes = await fetch('/api/data?entity=company');
                            const companyData = await companyRes.json();
                            generateInvoicePdf(invoice, items, payments, companyData.data as CompanyProfile);
                            addToast('success', 'PDF Invoice berhasil di-download');
                        } catch { addToast('error', 'Gagal membuat PDF'); }
                    }}><FileDown size={16} /> Export PDF</button>
                    <button className="btn btn-secondary" onClick={() => window.print()}><Printer size={16} /> Print</button>
                </div>
            </div>

            <div className="detail-grid">
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

                <div className="card">
                    <div className="card-header"><span className="card-header-title">Ringkasan Pembayaran</span></div>
                    <div className="card-body">
                        <div className="detail-row">
                            <div className="detail-item"><div className="detail-label">Total Invoice</div><div className="detail-value" style={{ fontSize: '1.25rem', fontWeight: 700 }}>{formatCurrency(invoice.totalAmount)}</div></div>
                        </div>
                        <div className="detail-row">
                            <div className="detail-item"><div className="detail-label">Sudah Dibayar</div><div className="detail-value" style={{ color: 'var(--color-success)', fontWeight: 600 }}>{formatCurrency(totalPaid)}</div></div>
                            <div className="detail-item"><div className="detail-label">Sisa</div><div className="detail-value" style={{ color: remaining > 0 ? 'var(--color-danger)' : 'var(--color-success)', fontWeight: 600 }}>{formatCurrency(remaining)}</div></div>
                        </div>
                        <div className="progress-bar mt-4"><div className="progress-bar-fill" style={{ width: `${Math.min(100, (totalPaid / (invoice.totalAmount || 1)) * 100)}%` }} /></div>
                        <div className="text-xs text-muted mt-2">Terbilang: {terbilang(invoice.totalAmount).trim()} rupiah</div>
                    </div>
                </div>
            </div>

            {/* Invoice Items */}
            <div className="card mt-6">
                <div className="card-header"><span className="card-header-title">Item Invoice</span></div>
                <div className="table-wrapper">
                    <table>
                        <thead><tr><th>Deskripsi</th><th>Qty</th><th>Harga</th><th className="text-right">Subtotal</th></tr></thead>
                        <tbody>
                            {items.map(item => (
                                <tr key={item._id}>
                                    <td>{item.description}</td><td>{item.qty || 1}</td><td>{formatCurrency(item.price)}</td>
                                    <td className="text-right font-medium">{formatCurrency(item.subtotal)}</td>
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

            {/* Payments */}
            <div className="card mt-6">
                <div className="card-header"><span className="card-header-title">Riwayat Pembayaran ({payments.length})</span></div>
                <div className="table-wrapper">
                    <table>
                        <thead><tr><th>Tanggal</th><th>Metode</th><th>Rekening</th><th>Jumlah</th><th>Catatan</th></tr></thead>
                        <tbody>
                            {payments.length === 0 ? <tr><td colSpan={5} className="text-center text-muted" style={{ padding: '2rem' }}>Belum ada pembayaran</td></tr> :
                                payments.map(p => (
                                    <tr key={p._id}>
                                        <td>{formatDate(p.date)}</td>
                                        <td>{PAYMENT_METHOD_MAP[p.method] || p.method}</td>
                                        <td className="text-muted">{p.bankAccountName || '-'}</td>
                                        <td className="font-medium" style={{ color: 'var(--color-success)' }}>{formatCurrency(p.amount)}</td>
                                        <td className="text-muted">{p.note || '-'}</td>
                                    </tr>
                                ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Payment Modal */}
            {showPayModal && (
                <div className="modal-overlay" onClick={() => setShowPayModal(false)}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header"><h3 className="modal-title">Tambah Pembayaran</h3><button className="modal-close" onClick={() => setShowPayModal(false)}>&times;</button></div>
                        <div className="modal-body">
                            <div className="form-group"><label className="form-label">Tanggal</label><input type="date" className="form-input" value={payDate} onChange={e => setPayDate(e.target.value)} /></div>
                            <div className="form-group"><label className="form-label">Nominal</label><input type="number" className="form-input" value={payAmount || ''} onChange={e => setPayAmount(Number(e.target.value))} placeholder={`Sisa: ${formatCurrency(remaining)}`} /></div>
                            <div className="form-group"><label className="form-label">Metode</label>
                                <select className="form-select" value={payMethod} onChange={e => setPayMethod(e.target.value)}>
                                    <option value="TRANSFER">Transfer</option><option value="CASH">Tunai</option><option value="OTHER">Lainnya</option>
                                </select>
                            </div>
                            <div className="form-group"><label className="form-label">Catatan</label><textarea className="form-textarea" rows={2} value={payNote} onChange={e => setPayNote(e.target.value)} /></div>
                            <div className="form-group"><label className="form-label">Masuk ke Rekening</label>
                                <select className="form-select" value={payBankRef} onChange={e => setPayBankRef(e.target.value)}>
                                    <option value="">-- Tidak dipilih --</option>
                                    {bankAccounts.map(a => <option key={a._id} value={a._id}>{a.bankName} - {a.accountNumber}</option>)}
                                </select>
                            </div>
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
