'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useToast } from '../../layout';
import { ArrowLeft, Printer, CheckCircle, Trash2 } from 'lucide-react';
import { formatDate, formatCurrency } from '@/lib/utils';
import type { DriverBorongan, DriverBoronganItem, BankAccount } from '@/lib/types';

const STATUS_MAP: Record<string, { label: string; color: string }> = {
    UNPAID: { label: 'Belum Dibayar', color: 'danger' },
    PAID: { label: 'Sudah Dibayar', color: 'success' },
};

export default function BoronganDetailPage() {
    const params = useParams();
    const router = useRouter();
    const { addToast } = useToast();
    const [borong, setBorong] = useState<DriverBorongan | null>(null);
    const [items, setItems] = useState<DriverBoronganItem[]>([]);
    const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
    const [loading, setLoading] = useState(true);

    // Payment modal state
    const [showPayModal, setShowPayModal] = useState(false);
    const [payDate, setPayDate] = useState(new Date().toISOString().split('T')[0]);
    const [payMethod, setPayMethod] = useState('CASH');
    const [payBankRef, setPayBankRef] = useState('');
    const [payNote, setPayNote] = useState('');
    const [paying, setPaying] = useState(false);

    useEffect(() => {
        const id = params.id as string;
        Promise.all([
            fetch(`/api/data?entity=driver-borongans&id=${id}`).then(r => r.json()),
            fetch(`/api/data?entity=driver-borogan-items`).then(r => r.json()),
            fetch(`/api/data?entity=bank-accounts`).then(r => r.json()),
        ]).then(([b, bi, ba]) => {
            setBorong(b.data);
            setItems((bi.data || []).filter((i: DriverBoronganItem) => i.boronganRef === id));
            setBankAccounts((ba.data || []).filter((a: BankAccount) => a.active !== false));
            setLoading(false);
        }).catch(() => setLoading(false));
    }, [params.id]);

    const handleMarkPaid = async () => {
        if (!borong) return;
        setPaying(true);
        try {
            // 1. Update borongan status
            await fetch('/api/data', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    entity: 'driver-borongans', action: 'update',
                    data: { id: borong._id, updates: { status: 'PAID', paidDate: payDate, paidMethod: payMethod, paidBankRef: payBankRef || undefined } }
                })
            });

            // 2. Create expense record (pengeluaran kas)
            await fetch('/api/data', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    entity: 'expenses',
                    data: {
                        date: payDate, amount: borong.totalAmount,
                        description: `Upah borongan supir ${borong.driverName} — ${borong.boronganNumber}`,
                        paymentMethod: payMethod,
                        bankAccountRef: payBankRef || undefined,
                        note: payNote || undefined,
                        boronganRef: borong._id,
                    }
                })
            });

            addToast('success', 'Pembayaran borongan berhasil dicatat');
            setShowPayModal(false);
            window.location.reload();
        } catch {
            addToast('error', 'Gagal mencatat pembayaran');
        }
        setPaying(false);
    };

    const handleDelete = async () => {
        if (!confirm('Hapus slip borongan ini?')) return;
        await fetch('/api/data', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ entity: 'driver-borongans', action: 'delete', data: { id: borong?._id } })
        });
        addToast('success', 'Slip dihapus');
        router.push('/borongan');
    };

    const handlePrint = () => {
        const printContent = document.getElementById('borong-print-area')?.innerHTML;
        if (!printContent) return;
        const w = window.open('', '_blank');
        if (!w) return;
        w.document.write(`<!DOCTYPE html><html><head><title>${borong?.boronganNumber}</title>
        <style>
            body { font-family: Arial, sans-serif; font-size: 10px; margin: 20px; color: #000; }
            h2 { font-size: 13px; margin: 0; }
            .sub { font-size: 9px; margin: 1px 0; }
            .header-grid { display: flex; justify-content: space-between; margin-bottom: 8px; }
            table { width: 100%; border-collapse: collapse; margin-top: 8px; }
            th { background: #1a1a2e; color: white; padding: 4px 5px; text-align: left; font-size: 9px; }
            td { padding: 3px 5px; border: 1px solid #ccc; font-size: 9px; }
            tr:nth-child(even) { background: #f5f5f5; }
            .total-row { background: #eee !important; font-weight: bold; }
            .right { text-align: right; }
            .bold { font-weight: bold; }
        </style></head><body>${printContent}</body></html>`);
        w.document.close();
        w.print();
    };

    if (loading) return <div><div className="skeleton skeleton-title" /><div className="skeleton skeleton-card" style={{ height: 200 }} /></div>;
    if (!borong) return <div className="empty-state"><div className="empty-state-title">Slip tidak ditemukan</div></div>;

    const statusConf = STATUS_MAP[borong.status] || { label: borong.status, color: 'secondary' };

    return (
        <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem' }}>
                <button className="btn-back" onClick={() => router.push('/borongan')}><ArrowLeft size={16} /></button>
                <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
                        <h1 style={{ fontSize: '1.25rem', fontWeight: 700, margin: 0 }}>{borong.boronganNumber}</h1>
                        <span className={`badge badge-${statusConf.color}`}><span className="badge-dot" /> {statusConf.label}</span>
                    </div>
                </div>
                <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                    {borong.status === 'UNPAID' && (
                        <button className="btn btn-success btn-sm" onClick={() => setShowPayModal(true)}>
                            <CheckCircle size={14} /> Bayar Borongan
                        </button>
                    )}
                    <button className="btn btn-secondary btn-sm" onClick={handlePrint}><Printer size={14} /> Cetak Slip</button>
                    <button className="btn btn-secondary btn-sm" onClick={handleDelete}><Trash2 size={14} /></button>
                </div>
            </div>

            <div className="detail-grid">
                <div>
                    {/* Info */}
                    <div className="card">
                        <div className="card-header"><span className="card-header-title">Detail Slip Borongan</span></div>
                        <div className="card-body">
                            <div className="detail-row">
                                <div className="detail-item"><div className="detail-label">No. Slip</div><div className="detail-value font-mono">{borong.boronganNumber}</div></div>
                                <div className="detail-item"><div className="detail-label">Supir</div><div className="detail-value font-semibold">{borong.driverName}</div></div>
                            </div>
                            <div className="detail-row">
                                <div className="detail-item"><div className="detail-label">Periode</div><div className="detail-value">{formatDate(borong.periodStart)} — {formatDate(borong.periodEnd)}</div></div>
                                <div className="detail-item"><div className="detail-label">Status</div><div className="detail-value"><span className={`badge badge-${statusConf.color}`}>{statusConf.label}</span></div></div>
                            </div>
                            <div className="detail-row">
                                <div className="detail-item"><div className="detail-label">Total Collie</div><div className="detail-value">{borong.totalCollie || 0}</div></div>
                                <div className="detail-item"><div className="detail-label">Total Berat</div><div className="detail-value">{(borong.totalWeightKg || 0).toLocaleString('id')} kg</div></div>
                            </div>
                            {borong.paidDate && (
                                <div className="detail-row">
                                    <div className="detail-item"><div className="detail-label">Tanggal Bayar</div><div className="detail-value">{formatDate(borong.paidDate)}</div></div>
                                    <div className="detail-item"><div className="detail-label">Metode</div><div className="detail-value">{(borong as unknown as Record<string,string>).paidMethod || '-'}</div></div>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Table */}
                    <div className="card" style={{ marginTop: '1rem' }}>
                        <div className="card-header"><span className="card-header-title">Perincian Perjalanan</span></div>
                        <div className="table-wrapper" style={{ overflowX: 'auto' }}>
                            <table style={{ minWidth: 700 }}>
                                <thead><tr><th>NO.TRUCK</th><th>TGL</th><th>NO.SJ</th><th>TUJUAN</th><th>BARANG</th><th>COLLIE</th><th>BERAT KG</th><th>TARIP</th><th style={{ textAlign: 'right' }}>UANG RP</th><th>KET</th></tr></thead>
                                <tbody>
                                    {items.map(it => (
                                        <tr key={it._id}>
                                            <td className="font-mono">{it.vehiclePlate || '-'}</td>
                                            <td className="text-muted">{formatDate(it.date)}</td>
                                            <td>{it.noSJ}</td>
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
                                        <td colSpan={5} style={{ textAlign: 'right' }}>Jumlah</td>
                                        <td>{borong.totalCollie || 0}</td>
                                        <td>{(borong.totalWeightKg || 0).toLocaleString('id')}</td>
                                        <td></td>
                                        <td style={{ textAlign: 'right', color: 'var(--color-danger)' }}>{formatCurrency(borong.totalAmount)}</td>
                                        <td></td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>

                {/* Right: Total summary */}
                <div>
                    <div className="card" style={{ overflow: 'hidden' }}>
                        <div style={{ background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)', color: '#fff', padding: '1.25rem' }}>
                            <div style={{ fontSize: '0.72rem', opacity: 0.8, textTransform: 'uppercase', marginBottom: '0.25rem' }}>Total Upah Borongan</div>
                            <div style={{ fontSize: '1.75rem', fontWeight: 700 }}>{formatCurrency(borong.totalAmount)}</div>
                        </div>
                        <div className="card-body">
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem', fontSize: '0.85rem' }}>
                                <span className="text-muted">Jumlah Perjalanan</span><strong>{items.length}</strong>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem', fontSize: '0.85rem' }}>
                                <span className="text-muted">Total Collie</span><strong>{borong.totalCollie || 0}</strong>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem', fontSize: '0.85rem' }}>
                                <span className="text-muted">Total Berat</span><strong>{(borong.totalWeightKg || 0).toLocaleString('id')} kg</strong>
                            </div>
                            {borong.status === 'UNPAID' && (
                                <button className="btn btn-success" style={{ width: '100%' }} onClick={() => setShowPayModal(true)}>
                                    <CheckCircle size={16} /> Bayar Borongan Supir
                                </button>
                            )}
                            {borong.status === 'PAID' && (
                                <div style={{ textAlign: 'center', color: 'var(--color-success)', fontWeight: 600, fontSize: '0.9rem', padding: '0.5rem' }}>
                                    ✓ Sudah Dibayar {borong.paidDate ? `(${formatDate(borong.paidDate)})` : ''}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* Hidden print area */}
            <div id="borong-print-area" style={{ display: 'none' }}>
                <div className="header-grid">
                    <div>
                        <h2>SLIP BORONGAN SUPIR</h2>
                        <div className="sub bold">No: {borong.boronganNumber}</div>
                        <div className="sub">Supir: {borong.driverName}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                        <div className="sub">Periode: {formatDate(borong.periodStart)} s/d {formatDate(borong.periodEnd)}</div>
                        <div className="sub">Status: {statusConf.label}</div>
                    </div>
                </div>
                <table>
                    <thead><tr><th>NO.TRUCK</th><th>TANGGAL</th><th>NO. SJ</th><th>TUJUAN</th><th>BARANG</th><th>COLLIE</th><th>BERAT KG</th><th>TARIP</th><th>UANG RP.</th><th>KET</th></tr></thead>
                    <tbody>
                        {items.map((it, idx) => (
                            <tr key={idx}>
                                <td className="bold">{it.vehiclePlate || '-'}</td>
                                <td>{formatDate(it.date)}</td>
                                <td>{it.noSJ}</td>
                                <td>{it.tujuan}</td>
                                <td>{it.barang || '-'}</td>
                                <td>{it.collie || '-'}</td>
                                <td>{(it.beratKg || 0).toLocaleString('id')}</td>
                                <td>{(it.tarip || 0).toLocaleString('id')}</td>
                                <td className="right">{it.uangRp.toLocaleString('id')}</td>
                                <td>{it.ket || '-'}</td>
                            </tr>
                        ))}
                        <tr className="total-row">
                            <td colSpan={5} className="right bold">Jumlah</td>
                            <td className="bold">{borong.totalCollie || 0}</td>
                            <td className="bold">{(borong.totalWeightKg || 0).toLocaleString('id')}</td>
                            <td></td>
                            <td className="right bold">{borong.totalAmount.toLocaleString('id')}</td>
                            <td></td>
                        </tr>
                    </tbody>
                </table>
                {borong.notes && <div style={{ marginTop: 10, fontSize: 9 }}>Catatan: {borong.notes}</div>}
            </div>

            {/* Payment Modal */}
            {showPayModal && (
                <div className="modal-overlay" onClick={() => setShowPayModal(false)}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3 className="modal-title">Bayar Upah Borongan</h3>
                            <button className="modal-close" onClick={() => setShowPayModal(false)}>&times;</button>
                        </div>
                        <div className="modal-body">
                            {/* Summary */}
                            <div style={{ background: 'var(--color-warning-light)', borderRadius: '0.5rem', padding: '0.75rem 1rem', marginBottom: '1rem' }}>
                                <div style={{ fontSize: '0.72rem', color: 'var(--color-warning)', textTransform: 'uppercase', fontWeight: 600 }}>Total yang akan dibayar ke {borong.driverName}</div>
                                <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--color-warning)' }}>{formatCurrency(borong.totalAmount)}</div>
                                <div style={{ fontSize: '0.75rem', color: 'var(--color-gray-500)', marginTop: '0.25rem' }}>⚠ Pengeluaran ini akan tercatat dan mengurangi saldo rekening bank yang dipilih</div>
                            </div>

                            <div className="form-group">
                                <label className="form-label">Tanggal Bayar</label>
                                <input type="date" className="form-input" value={payDate} onChange={e => setPayDate(e.target.value)} />
                            </div>
                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label">Metode Pembayaran</label>
                                    <select className="form-select" value={payMethod} onChange={e => setPayMethod(e.target.value)}>
                                        <option value="CASH">Tunai</option>
                                        <option value="TRANSFER">Transfer</option>
                                        <option value="OTHER">Lainnya</option>
                                    </select>
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Rekening Bank <span style={{ fontSize: '0.7rem', color: 'var(--color-gray-400)' }}>(opsional, untuk debit)</span></label>
                                    <select className="form-select" value={payBankRef} onChange={e => setPayBankRef(e.target.value)}>
                                        <option value="">-- Tanpa Rekening --</option>
                                        {bankAccounts.map(a => (
                                            <option key={a._id} value={a._id}>
                                                {a.bankName} - {a.accountNumber} (Saldo: {formatCurrency(a.currentBalance || 0)})
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            </div>
                            <div className="form-group">
                                <label className="form-label">Catatan</label>
                                <textarea className="form-textarea" rows={2} value={payNote} onChange={e => setPayNote(e.target.value)} placeholder="Opsional..." />
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setShowPayModal(false)}>Batal</button>
                            <button className="btn btn-success" onClick={handleMarkPaid} disabled={paying}>
                                <CheckCircle size={16} /> {paying ? 'Memproses...' : 'Konfirmasi Pembayaran'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
