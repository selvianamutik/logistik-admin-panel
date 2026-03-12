'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useToast } from '../../layout';
import { ArrowLeft, Printer, DollarSign, Landmark, Trash2, FileDown } from 'lucide-react';
import { buildFreightNotaPrintDocument, fetchCompanyProfile, formatFreightNotaDisplayNumber, openBrandedPrint } from '@/lib/print';
import { exportFreightNotaDetail } from '@/lib/export';
import { formatDate, formatCurrency } from '@/lib/utils';
import type { FreightNota, FreightNotaItem, Payment, BankAccount, CompanyProfile } from '@/lib/types';

const STATUS_MAP: Record<string, { label: string; color: string }> = {
    UNPAID: { label: 'Belum Lunas', color: 'danger' },
    PARTIAL: { label: 'Sebagian', color: 'warning' },
    PAID: { label: 'Lunas', color: 'success' },
};

export default function NotaDetailPage() {
    const params = useParams();
    const router = useRouter();
    const { addToast } = useToast();
    const notaId = params.id as string;
    const [nota, setNota] = useState<FreightNota | null>(null);
    const [items, setItems] = useState<FreightNotaItem[]>([]);
    const [payments, setPayments] = useState<Payment[]>([]);
    const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
    const [company, setCompany] = useState<CompanyProfile | null>(null);
    const [loading, setLoading] = useState(true);
    const [showPayModal, setShowPayModal] = useState(false);
    const [paying, setPaying] = useState(false);
    const [payAmount, setPayAmount] = useState(0);
    const [payMethod, setPayMethod] = useState('TRANSFER');
    const [payDate, setPayDate] = useState(new Date().toISOString().split('T')[0]);
    const [payNote, setPayNote] = useState('');
    const [payBankRef, setPayBankRef] = useState('');

    useEffect(() => {
        const fetchEntity = async <T,>(url: string) => {
            const res = await fetch(url);
            const result = await res.json();
            if (!res.ok) {
                throw new Error(result.error || 'Gagal memuat detail nota');
            }
            return result.data as T;
        };

        const loadNotaDetail = async () => {
            setLoading(true);
            try {
                const [notaData, notaItems, paymentRows, accounts, companyData] = await Promise.all([
                    fetchEntity<FreightNota | null>(`/api/data?entity=freight-notas&id=${notaId}`),
                    fetchEntity<FreightNotaItem[]>(`/api/data?entity=freight-nota-items&filter=${encodeURIComponent(JSON.stringify({ notaRef: notaId }))}`),
                    fetchEntity<Payment[]>(`/api/data?entity=payments&filter=${encodeURIComponent(JSON.stringify({ invoiceRef: notaId }))}`),
                    fetchEntity<BankAccount[]>('/api/data?entity=bank-accounts'),
                    fetchCompanyProfile(),
                ]);

                setNota(notaData);
                setItems(notaItems || []);
                setPayments(paymentRows || []);
                setBankAccounts((accounts || []).filter(account => account.active !== false));
                setCompany(companyData);
            } catch (error) {
                addToast('error', error instanceof Error ? error.message : 'Gagal memuat detail nota');
            } finally {
                setLoading(false);
            }
        };

        void loadNotaDetail();
    }, [addToast, notaId]);

    const totalPaid = payments.reduce((s, p) => s + p.amount, 0);
    const remaining = (nota?.totalAmount || 0) - totalPaid;
    const paidPercent = Math.min(100, (totalPaid / (nota?.totalAmount || 1)) * 100);

    const handleAddPayment = async () => {
        if (payAmount <= 0) { addToast('error', 'Nominal harus lebih dari 0'); return; }
        if (payAmount > remaining) { addToast('error', 'Nominal melebihi sisa tagihan'); return; }
        if (payMethod === 'TRANSFER' && !payBankRef) { addToast('error', 'Pilih rekening bank untuk transfer'); return; }
        setPaying(true);
        try {
            const res = await fetch('/api/data', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    entity: 'payments',
                    data: { invoiceRef: nota?._id, date: payDate, amount: payAmount, method: payMethod, note: payNote, bankAccountRef: payBankRef || undefined }
                }),
            });
            const result = await res.json();
            if (!res.ok) {
                addToast('error', result.error || 'Gagal');
                return;
            }
            addToast('success', 'Pembayaran dicatat');
            setShowPayModal(false);
            window.location.reload();
        } catch {
            addToast('error', 'Gagal');
        } finally {
            setPaying(false);
        }
    };

    const handlePrint = async () => {
        if (!nota) return;
        try {
            const resolvedCompany = company ?? await fetchCompanyProfile();
            setCompany(resolvedCompany);
            const doc = buildFreightNotaPrintDocument({ nota, items, company: resolvedCompany });
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
            addToast('error', 'Gagal menyiapkan dokumen cetak');
        }
    };

    const handleDelete = async () => {
        if (!confirm('Hapus nota ini?')) return;
        const res = await fetch('/api/data', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ entity: 'freight-notas', action: 'delete', data: { id: notaId } })
        });
        const result = await res.json();
        if (!res.ok) {
            addToast('error', result.error || 'Gagal menghapus nota');
            return;
        }
        addToast('success', 'Nota dihapus');
        router.push('/invoices');
    };

    const handleExportExcel = async () => {
        if (!nota) return;
        try {
            const resolvedCompany = company ?? await fetchCompanyProfile();
            setCompany(resolvedCompany);
            await exportFreightNotaDetail(nota, items, resolvedCompany);
            addToast('success', 'Excel nota berhasil di-download');
        } catch {
            addToast('error', 'Gagal menyiapkan Excel nota');
        }
    };

    if (loading) return <div><div className="skeleton skeleton-title" /><div className="skeleton skeleton-card" style={{ height: 200 }} /></div>;
    if (!nota) return <div className="empty-state"><div className="empty-state-title">Nota tidak ditemukan</div></div>;

    const statusConf = STATUS_MAP[nota.status] || { label: nota.status, color: 'secondary' };
    const displayNotaNumber = formatFreightNotaDisplayNumber(nota, company);

    return (
        <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
                <button className="btn-back" onClick={() => router.push('/invoices')}><ArrowLeft size={16} /></button>
                <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
                        <h1 style={{ fontSize: '1.25rem', fontWeight: 700, margin: 0 }}>{displayNotaNumber}</h1>
                        <span className={`badge badge-${statusConf.color}`}><span className="badge-dot" /> {statusConf.label}</span>
                    </div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                        Nomor sistem: {nota.notaNumber}
                    </div>
                </div>
                <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                    {nota.status !== 'PAID' && <button className="btn btn-success btn-sm" onClick={() => setShowPayModal(true)}><DollarSign size={14} /> Bayar</button>}
                    <button className="btn btn-secondary btn-sm" onClick={handleExportExcel}><FileDown size={14} /> Excel</button>
                    <button className="btn btn-secondary btn-sm" onClick={handlePrint}><Printer size={14} /> Cetak Nota</button>
                    <button className="btn btn-secondary btn-sm" onClick={handleDelete}><Trash2 size={14} /></button>
                </div>
            </div>

            <div className="detail-grid">
                <div>
                    {/* Info Nota */}
                    <div className="card">
                        <div className="card-header"><span className="card-header-title">Detail Nota</span></div>
                        <div className="card-body">
                            <div className="detail-row">
                                <div className="detail-item"><div className="detail-label">No. Cetak Nota</div><div className="detail-value font-mono">{displayNotaNumber}</div></div>
                                <div className="detail-item"><div className="detail-label">Tanggal</div><div className="detail-value">{formatDate(nota.issueDate)}</div></div>
                            </div>
                            <div className="detail-row">
                                <div className="detail-item"><div className="detail-label">Customer</div><div className="detail-value font-semibold">{nota.customerName}</div></div>
                                <div className="detail-item"><div className="detail-label">Jatuh Tempo</div><div className="detail-value">{nota.dueDate ? formatDate(nota.dueDate) : '-'}</div></div>
                            </div>
                            <div className="detail-row">
                                <div className="detail-item"><div className="detail-label">No. Sistem</div><div className="detail-value font-mono">{nota.notaNumber}</div></div>
                                <div className="detail-item"><div className="detail-label">Total Collie</div><div className="detail-value">{nota.totalCollie || 0}</div></div>
                            </div>
                            <div className="detail-row">
                                <div className="detail-item"><div className="detail-label">Total Berat</div><div className="detail-value">{(nota.totalWeightKg || 0).toLocaleString('id')} kg</div></div>
                                <div className="detail-item" />
                            </div>
                        </div>
                    </div>

                    {/* Items Table */}
                    <div className="card" style={{ marginTop: '1rem' }}>
                        <div className="card-header"><span className="card-header-title">Perincian Ongkos Angkut</span></div>
                        <div className="table-wrapper" style={{ overflowX: 'auto' }}>
                            <table style={{ minWidth: 800 }}>
                                <thead><tr><th>NO.TRUCK</th><th>TGL</th><th>NO.SJ</th><th>DARI</th><th>TUJUAN</th><th>BARANG</th><th>COLLIE</th><th>BERAT KG</th><th>TARIP</th><th style={{ textAlign: 'right' }}>UANG RP</th><th>KET</th></tr></thead>
                                <tbody>
                                    {items.map(it => (
                                        <tr key={it._id}>
                                            <td className="font-mono">{it.vehiclePlate || '-'}</td>
                                            <td className="text-muted">{formatDate(it.date)}</td>
                                            <td>{it.noSJ}</td>
                                            <td>{it.dari}</td>
                                            <td>{it.tujuan}</td>
                                            <td>{it.barang || '-'}</td>
                                            <td>{it.collie || '-'}</td>
                                            <td>{(it.beratKg || 0).toLocaleString('id')}</td>
                                            <td>{(it.tarip || 0).toLocaleString('id')}</td>
                                            <td style={{ textAlign: 'right', fontWeight: 600 }}>{formatCurrency(it.uangRp)}</td>
                                            <td className="text-muted">{it.ket || '-'}</td>
                                        </tr>
                                    ))}
                                    <tr style={{ background: 'var(--color-bg-secondary)', fontWeight: 700, borderTop: '2px solid var(--color-border)' }}>
                                        <td colSpan={6} style={{ textAlign: 'right' }}>Jumlah</td>
                                        <td>{nota.totalCollie || 0}</td>
                                        <td>{(nota.totalWeightKg || 0).toLocaleString('id')}</td>
                                        <td></td>
                                        <td style={{ textAlign: 'right', color: 'var(--color-danger)' }}>{formatCurrency(nota.totalAmount)}</td>
                                        <td></td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>

                {/* Right: payment */}
                <div>
                    <div className="card" style={{ overflow: 'hidden' }}>
                        <div style={{ background: 'linear-gradient(135deg, var(--color-primary) 0%, #7c3aed 100%)', color: '#fff', padding: '1.25rem' }}>
                            <div style={{ fontSize: '0.72rem', opacity: 0.8, textTransform: 'uppercase', marginBottom: '0.25rem' }}>Total Ongkos</div>
                            <div style={{ fontSize: '1.75rem', fontWeight: 700 }}>{formatCurrency(nota.totalAmount)}</div>
                        </div>
                        <div className="card-body">
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                                <div><div style={{ fontSize: '0.7rem', color: 'var(--color-gray-400)', textTransform: 'uppercase' }}>Sudah Dibayar</div><div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--color-success)' }}>{formatCurrency(totalPaid)}</div></div>
                                <div style={{ textAlign: 'right' }}><div style={{ fontSize: '0.7rem', color: 'var(--color-gray-400)', textTransform: 'uppercase' }}>Sisa</div><div style={{ fontSize: '1.1rem', fontWeight: 700, color: remaining > 0 ? 'var(--color-danger)' : 'var(--color-success)' }}>{formatCurrency(remaining)}</div></div>
                            </div>
                            <div className="progress-bar" style={{ marginBottom: '0.5rem' }}>
                                <div className={`progress-bar-fill ${paidPercent >= 100 ? 'success' : ''}`} style={{ width: `${paidPercent}%` }} />
                            </div>
                            <div style={{ fontSize: '0.72rem', color: 'var(--color-gray-400)', marginBottom: '1rem' }}>{paidPercent.toFixed(0)}% terbayar</div>
                            {nota.status !== 'PAID' && <button className="btn btn-success" style={{ width: '100%' }} onClick={() => setShowPayModal(true)}><DollarSign size={16} /> Tambah Pembayaran</button>}
                        </div>
                    </div>

                    {/* Payment history */}
                    <div className="card" style={{ marginTop: '1rem' }}>
                        <div className="card-header"><span className="card-header-title">Riwayat Pembayaran</span></div>
                        <div className="card-body" style={{ padding: payments.length === 0 ? '2rem 1.5rem' : 0 }}>
                            {payments.length === 0 ? (
                                <div style={{ textAlign: 'center', color: 'var(--color-gray-400)' }}>
                                    <div
                                        style={{
                                            fontSize: '1.5rem',
                                            opacity: 0.3,
                                            marginBottom: '0.25rem',
                                            display: 'flex',
                                            justifyContent: 'center',
                                        }}
                                    >
                                        <DollarSign size={22} />
                                    </div>
                                    <div style={{ fontSize: '0.82rem' }}>Belum ada pembayaran</div>
                                </div>
                            ) : payments.map((p, i) => (
                                <div key={p._id} style={{ padding: '0.75rem 1rem', borderBottom: i < payments.length - 1 ? '1px solid var(--color-gray-100)' : 'none' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.2rem' }}>
                                        <div style={{ fontSize: '0.82rem', fontWeight: 600 }}>{formatDate(p.date)}</div>
                                        <div style={{ fontSize: '0.92rem', fontWeight: 700, color: 'var(--color-success)' }}>+{formatCurrency(p.amount)}</div>
                                    </div>
                                    <div style={{ display: 'flex', gap: '0.5rem', fontSize: '0.72rem', color: 'var(--color-gray-400)' }}>
                                        <span className={`badge badge-${p.method === 'CASH' ? 'warning' : 'info'}`} style={{ fontSize: '0.62rem' }}>{p.method}</span>
                                        {p.bankAccountName && <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}><Landmark size={10} /> {p.bankAccountName}</span>}
                                        {p.note && <span>| {p.note}</span>}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
            {/* Pay Modal */}
            {showPayModal && (
                <div className="modal-overlay" onClick={() => setShowPayModal(false)}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header"><h3 className="modal-title">Tambah Pembayaran</h3><button className="modal-close" onClick={() => setShowPayModal(false)} disabled={paying}>&times;</button></div>
                        <div className="modal-body">
                            <div style={{ background: 'var(--color-gray-50)', borderRadius: '0.5rem', padding: '0.75rem 1rem', marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <div><div style={{ fontSize: '0.68rem', color: 'var(--color-gray-400)', textTransform: 'uppercase' }}>Sisa Tagihan</div><div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--color-danger)' }}>{formatCurrency(remaining)}</div></div>
                                <button className="btn btn-sm btn-ghost" onClick={() => setPayAmount(remaining)} style={{ fontSize: '0.72rem' }} disabled={paying}>Bayar penuh</button>
                            </div>
                            <div className="form-group"><label className="form-label">Tanggal</label><input type="date" className="form-input" value={payDate} onChange={e => setPayDate(e.target.value)} disabled={paying} /></div>
                            <div className="form-group"><label className="form-label">Nominal (Rp)</label><input type="number" className="form-input" value={payAmount || ''} onChange={e => setPayAmount(Number(e.target.value))} disabled={paying} /></div>
                            <div className="form-row">
                                <div className="form-group"><label className="form-label">Metode</label>
                                    <select className="form-select" value={payMethod} onChange={e => setPayMethod(e.target.value)} disabled={paying}>
                                        <option value="TRANSFER">Transfer</option><option value="CASH">Tunai</option><option value="OTHER">Lainnya</option>
                                    </select>
                                </div>
                                <div className="form-group"><label className="form-label">Rekening</label>
                                    <select className="form-select" value={payBankRef} onChange={e => setPayBankRef(e.target.value)} disabled={paying}>
                                        <option value="">{payMethod === 'CASH' ? '-- Otomatis ke Kas Tunai --' : '-- Pilih --'}</option>
                                        {bankAccounts.map(a => <option key={a._id} value={a._id}>{a.bankName} - {a.accountNumber}{a.accountType === 'CASH' ? ' (Kas Tunai)' : ''}</option>)}
                                    </select>
                                </div>
                            </div>
                            <div style={{ background: 'var(--color-gray-50)', borderRadius: '0.5rem', padding: '0.75rem 1rem', fontSize: '0.78rem', color: 'var(--color-gray-600)', marginBottom: '1rem' }}>
                                {payMethod === 'TRANSFER'
                                    ? 'Transfer akan mengurangi sisa tagihan, mencatat pendapatan, dan menambah saldo rekening yang dipilih.'
                                    : payMethod === 'CASH'
                                        ? 'Tunai tetap mengurangi sisa tagihan dan mencatat pendapatan. Jika rekening dibiarkan kosong, sistem otomatis mem-posting ke akun Kas Tunai.'
                                        : 'Metode lain tetap mengurangi sisa tagihan dan mencatat pendapatan. Mutasi bank hanya dibuat jika rekening dipilih.'}
                            </div>
                            <div className="form-group"><label className="form-label">Catatan</label><textarea className="form-textarea" rows={2} value={payNote} onChange={e => setPayNote(e.target.value)} disabled={paying} /></div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setShowPayModal(false)} disabled={paying}>Batal</button>
                            <button className="btn btn-success" onClick={handleAddPayment} disabled={paying}><DollarSign size={16} /> {paying ? 'Memproses...' : 'Simpan Pembayaran'}</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
