'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '../../layout';
import { ArrowLeft, Plus, Trash2, Save } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import type { Customer, DeliveryOrder, Order } from '@/lib/types';

interface NotaItemRow {
    id: string;
    doRef: string;
    doNumber: string;
    vehiclePlate: string;
    date: string;
    noSJ: string;
    dari: string;
    tujuan: string;
    barang: string;
    collie: number;
    beratKg: number;
    tarip: number;
    uangRp: number;
    ket: string;
}

export default function NewNotaPage() {
    const router = useRouter();
    const { addToast } = useToast();
    const [customers, setCustomers] = useState<Customer[]>([]);
    const [deliveryOrders, setDeliveryOrders] = useState<DeliveryOrder[]>([]);
    const [orders, setOrders] = useState<Order[]>([]);
    const [saving, setSaving] = useState(false);

    const [customerRef, setCustomerRef] = useState('');
    const [customerName, setCustomerName] = useState('');
    const [issueDate, setIssueDate] = useState(new Date().toISOString().split('T')[0]);
    const [dueDate, setDueDate] = useState('');
    const [notes, setNotes] = useState('');
    const [rows, setRows] = useState<NotaItemRow[]>([newRow()]);

    function newRow(doData?: DeliveryOrder): NotaItemRow {
        return {
            id: Math.random().toString(36).slice(2),
            doRef: doData?._id || '',
            doNumber: doData?.doNumber || '',
            vehiclePlate: doData?.vehiclePlate || '',
            date: doData?.date || new Date().toISOString().split('T')[0],
            noSJ: doData?.doNumber || '',
            dari: '',
            tujuan: doData?.receiverAddress || '',
            barang: '',
            collie: 0,
            beratKg: 0,
            tarip: 0,
            uangRp: 0,
            ket: '',
        };
    }

    useEffect(() => {
        Promise.all([
            fetch('/api/data?entity=customers').then(r => r.json()),
            fetch('/api/data?entity=delivery-orders').then(r => r.json()),
            fetch('/api/data?entity=orders').then(r => r.json()),
        ]).then(([cust, dos, ords]) => {
            setCustomers(cust.data || []);
            setDeliveryOrders((dos.data || []).filter((d: DeliveryOrder) => d.status === 'DELIVERED'));
            setOrders(ords.data || []);
        });
    }, []);

    const updateRow = (id: string, field: keyof NotaItemRow, value: string | number) => {
        setRows(prev => prev.map(r => {
            if (r.id !== id) return r;
            const updated = { ...r, [field]: value };
            // Auto-calc uangRp
            if (field === 'beratKg' || field === 'tarip') {
                updated.uangRp = updated.beratKg * updated.tarip;
            }
            return updated;
        }));
    };

    const addDORow = (doId: string) => {
        const doData = deliveryOrders.find(d => d._id === doId);
        if (doData) setRows(prev => [...prev, newRow(doData)]);
    };

    const removeRow = (id: string) => setRows(prev => prev.filter(r => r.id !== id));

    const totalCollie = rows.reduce((s, r) => s + (r.collie || 0), 0);
    const totalBerat = rows.reduce((s, r) => s + (r.beratKg || 0), 0);
    const totalAmount = rows.reduce((s, r) => s + (r.uangRp || 0), 0);

    const handleSave = async () => {
        if (!customerName) { addToast('error', 'Nama customer wajib diisi'); return; }
        if (rows.length === 0) { addToast('error', 'Minimal 1 baris perjalanan'); return; }
        setSaving(true);
        try {
            // Create nota header
            const notaRes = await fetch('/api/data', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    entity: 'freight-notas',
                    data: {
                        customerRef: customerRef || undefined,
                        customerName,
                        issueDate,
                        dueDate: dueDate || undefined,
                        status: 'UNPAID',
                        totalAmount,
                        totalCollie,
                        totalWeightKg: totalBerat,
                        notes: notes || undefined,
                    }
                })
            });
            const notaData = await notaRes.json();
            const notaId = notaData.data._id;

            // Create nota items
            await Promise.all(rows.map(r => fetch('/api/data', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    entity: 'freight-nota-items',
                    data: {
                        notaRef: notaId,
                        doRef: r.doRef || undefined,
                        doNumber: r.doNumber || undefined,
                        vehiclePlate: r.vehiclePlate || undefined,
                        date: r.date,
                        noSJ: r.noSJ,
                        dari: r.dari,
                        tujuan: r.tujuan,
                        barang: r.barang || undefined,
                        collie: r.collie || undefined,
                        beratKg: r.beratKg,
                        tarip: r.tarip,
                        uangRp: r.uangRp,
                        ket: r.ket || undefined,
                    }
                })
            })));

            addToast('success', 'Nota berhasil dibuat');
            router.push(`/invoices/${notaId}`);
        } catch {
            addToast('error', 'Gagal membuat nota');
        }
        setSaving(false);
    };

    // Filter DOs: jika ada customer dipilih, cari order milik customer tsb,
    // lalu filter DO berdasarkan orderRef. Lebih reliable dari string customerName.
    const customerOrderIds = customerRef
        ? new Set(orders.filter(o => o.customerRef === customerRef).map(o => o._id))
        : null;

    const customerDOs = customerOrderIds
        ? deliveryOrders.filter(d => customerOrderIds.has(d.orderRef || ''))
        : deliveryOrders;

    // DOs yang tidak cocok customer masih bisa ditambah manual (tampilkan semua di dropdown, tapi pisahkan)
    const otherDOs = customerOrderIds
        ? deliveryOrders.filter(d => !customerOrderIds.has(d.orderRef || ''))
        : [];

    return (
        <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.25rem' }}>
                <button className="btn-back" onClick={() => router.push('/invoices')}><ArrowLeft size={16} /></button>
                <h1 style={{ fontSize: '1.25rem', fontWeight: 700, margin: 0 }}>Buat Nota Ongkos Angkut</h1>
            </div>

            <div className="detail-grid">
                {/* Left: Form */}
                <div>
                    <div className="card">
                        <div className="card-header"><span className="card-header-title">Info Nota</span></div>
                        <div className="card-body">
                            <div className="form-group">
                                <label className="form-label">Customer <span className="required">*</span></label>
                                <select className="form-select" value={customerRef} onChange={e => {
                                    const selId = e.target.value;
                                    setCustomerRef(selId);
                                    const cust = customers.find(c => c._id === selId);
                                    setCustomerName(cust?.name || '');
                                }}>
                                    <option value="">-- Pilih Customer --</option>
                                    {customers.map(c => <option key={c._id} value={c._id}>{c.name}</option>)}
                                </select>
                            </div>
                            {!customerRef && (
                                <div className="form-group">
                                    <label className="form-label">Atau ketik nama customer</label>
                                    <input className="form-input" value={customerName} onChange={e => setCustomerName(e.target.value)} placeholder="Nama perusahaan..." />
                                </div>
                            )}
                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label">Tanggal Nota</label>
                                    <input type="date" className="form-input" value={issueDate} onChange={e => setIssueDate(e.target.value)} />
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Jatuh Tempo</label>
                                    <input type="date" className="form-input" value={dueDate} onChange={e => setDueDate(e.target.value)} />
                                </div>
                            </div>
                            <div className="form-group">
                                <label className="form-label">Catatan</label>
                                <textarea className="form-textarea" rows={2} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Opsional..." />
                            </div>
                        </div>
                    </div>

                    {/* Add from DO */}
                    <div className="card" style={{ marginTop: '1rem' }}>
                        <div className="card-header"><span className="card-header-title">Tambah dari Surat Jalan</span></div>
                        <div className="card-body">
                            <select className="form-select" onChange={e => { if (e.target.value) { addDORow(e.target.value); e.target.value = ''; } }}>
                                <option value="">-- Pilih DO yang selesai --</option>
                                {customerDOs.length > 0 && (
                                    <optgroup label={customerRef ? `✓ DO milik ${customerName} (${customerDOs.length})` : `Semua DO Selesai`}>
                                        {customerDOs.map(d => <option key={d._id} value={d._id}>{d.doNumber} — {d.vehiclePlate || '-'} — {d.receiverAddress || '-'}</option>)}
                                    </optgroup>
                                )}
                                {otherDOs.length > 0 && (
                                    <optgroup label={`DO Customer Lain (${otherDOs.length})`}>
                                        {otherDOs.map(d => <option key={d._id} value={d._id}>{d.doNumber} — {d.vehiclePlate || '-'} — {d.receiverAddress || '-'}</option>)}
                                    </optgroup>
                                )}
                            </select>
                        </div>
                    </div>
                </div>

                {/* Right: Summary */}
                <div>
                    <div className="card" style={{ overflow: 'hidden' }}>
                        <div style={{ background: 'linear-gradient(135deg, var(--color-primary) 0%, #7c3aed 100%)', color: '#fff', padding: '1.25rem' }}>
                            <div style={{ fontSize: '0.72rem', opacity: 0.8, textTransform: 'uppercase', marginBottom: '0.25rem' }}>Total Ongkos Angkut</div>
                            <div style={{ fontSize: '1.75rem', fontWeight: 700 }}>{formatCurrency(totalAmount)}</div>
                        </div>
                        <div className="card-body">
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem', fontSize: '0.85rem' }}>
                                <span className="text-muted">Total Collie</span><strong>{totalCollie}</strong>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem', fontSize: '0.85rem' }}>
                                <span className="text-muted">Total Berat</span><strong>{totalBerat.toLocaleString('id')} kg</strong>
                            </div>
                            <button className="btn btn-primary" style={{ width: '100%' }} onClick={handleSave} disabled={saving}>
                                <Save size={16} /> {saving ? 'Menyimpan...' : 'Simpan Nota'}
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            {/* Items Table */}
            <div className="card" style={{ marginTop: '1.5rem' }}>
                <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span className="card-header-title">Perincian Perjalanan</span>
                    <button className="btn btn-secondary btn-sm" onClick={() => setRows(prev => [...prev, newRow()])}>
                        <Plus size={14} /> Tambah Baris
                    </button>
                </div>
                <div className="table-wrapper" style={{ overflowX: 'auto' }}>
                    <table style={{ minWidth: 900 }}>
                        <thead>
                            <tr>
                                <th style={{ minWidth: 80 }}>NO.TRUCK</th>
                                <th style={{ minWidth: 90 }}>TANGGAL</th>
                                <th style={{ minWidth: 120 }}>NO.SJ</th>
                                <th style={{ minWidth: 100 }}>DARI</th>
                                <th style={{ minWidth: 120 }}>TUJUAN</th>
                                <th style={{ minWidth: 100 }}>BARANG</th>
                                <th style={{ minWidth: 70 }}>COLLIE</th>
                                <th style={{ minWidth: 80 }}>BERAT KG</th>
                                <th style={{ minWidth: 90 }}>TARIP</th>
                                <th style={{ minWidth: 110 }}>UANG RP</th>
                                <th style={{ minWidth: 80 }}>KET</th>
                                <th style={{ width: 36 }}></th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map(r => (
                                <tr key={r.id}>
                                    <td><input className="form-input" style={{ minWidth: 75 }} value={r.vehiclePlate} onChange={e => updateRow(r.id, 'vehiclePlate', e.target.value)} placeholder="Plat..." /></td>
                                    <td><input type="date" className="form-input" value={r.date} onChange={e => updateRow(r.id, 'date', e.target.value)} /></td>
                                    <td><input className="form-input" value={r.noSJ} onChange={e => updateRow(r.id, 'noSJ', e.target.value)} placeholder="No. SJ..." /></td>
                                    <td><input className="form-input" value={r.dari} onChange={e => updateRow(r.id, 'dari', e.target.value)} placeholder="Dari..." /></td>
                                    <td><input className="form-input" value={r.tujuan} onChange={e => updateRow(r.id, 'tujuan', e.target.value)} placeholder="Tujuan..." /></td>
                                    <td><input className="form-input" value={r.barang} onChange={e => updateRow(r.id, 'barang', e.target.value)} placeholder="Barang..." /></td>
                                    <td><input type="number" className="form-input" value={r.collie || ''} onChange={e => updateRow(r.id, 'collie', Number(e.target.value))} /></td>
                                    <td><input type="number" className="form-input" value={r.beratKg || ''} onChange={e => updateRow(r.id, 'beratKg', Number(e.target.value))} /></td>
                                    <td><input type="number" className="form-input" value={r.tarip || ''} onChange={e => updateRow(r.id, 'tarip', Number(e.target.value))} /></td>
                                    <td style={{ fontWeight: 600, color: 'var(--color-primary)' }}>{formatCurrency(r.uangRp)}</td>
                                    <td><input className="form-input" value={r.ket} onChange={e => updateRow(r.id, 'ket', e.target.value)} /></td>
                                    <td><button className="table-action-btn danger" onClick={() => removeRow(r.id)}><Trash2 size={13} /></button></td>
                                </tr>
                            ))}
                            {/* Totals row */}
                            <tr style={{ background: 'var(--color-bg-secondary)', fontWeight: 700, borderTop: '2px solid var(--color-border)' }}>
                                <td colSpan={6} style={{ textAlign: 'right', paddingRight: '0.75rem' }}>Jumlah</td>
                                <td>{totalCollie}</td>
                                <td>{totalBerat.toLocaleString('id')}</td>
                                <td></td>
                                <td style={{ color: 'var(--color-danger)' }}>{formatCurrency(totalAmount)}</td>
                                <td colSpan={2}></td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
