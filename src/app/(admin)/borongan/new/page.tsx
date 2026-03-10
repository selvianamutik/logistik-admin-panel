'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '../../layout';
import { ArrowLeft, Plus, Trash2, Save } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import type { Driver, DeliveryOrder } from '@/lib/types';

interface BoronganRow {
    id: string;
    doRef: string;
    doNumber: string;
    vehiclePlate: string;
    date: string;
    noSJ: string;
    tujuan: string;
    barang: string;
    collie: number;
    beratKg: number;
    tarip: number;
    uangRp: number;
    ket: string;
}

export default function NewBoronganPage() {
    const router = useRouter();
    const { addToast } = useToast();
    const [drivers, setDrivers] = useState<Driver[]>([]);
    const [deliveryOrders, setDeliveryOrders] = useState<DeliveryOrder[]>([]);
    const [saving, setSaving] = useState(false);

    const [driverRef, setDriverRef] = useState('');
    const [driverName, setDriverName] = useState('');
    const [periodStart, setPeriodStart] = useState(new Date().toISOString().split('T')[0]);
    const [periodEnd, setPeriodEnd] = useState(new Date().toISOString().split('T')[0]);
    const [notes, setNotes] = useState('');
    const [rows, setRows] = useState<BoronganRow[]>([newRow()]);

    function newRow(doData?: DeliveryOrder): BoronganRow {
        const tarip = doData?.taripBorongan || 0;
        const beratKg = 0;
        return {
            id: Math.random().toString(36).slice(2),
            doRef: doData?._id || '',
            doNumber: doData?.doNumber || '',
            vehiclePlate: doData?.vehiclePlate || '',
            date: doData?.date || new Date().toISOString().split('T')[0],
            noSJ: doData?.doNumber || '',
            tujuan: doData?.receiverAddress || '',
            barang: '',
            collie: 0,
            beratKg,
            tarip,               // ← auto-filled from DO's taripBorongan (set pre-departure)
            uangRp: beratKg * tarip,
            ket: doData?.keteranganBorongan || '',
        };
    }

    useEffect(() => {
        Promise.all([
            fetch('/api/data?entity=drivers').then(r => r.json()),
            fetch('/api/data?entity=delivery-orders').then(r => r.json()),
        ]).then(([drv, dos]) => {
            setDrivers(drv.data || []);
            setDeliveryOrders((dos.data || []).filter((d: DeliveryOrder) => d.status === 'DELIVERED'));
        });
    }, []);

    const updateRow = (id: string, field: keyof BoronganRow, value: string | number) => {
        setRows(prev => prev.map(r => {
            if (r.id !== id) return r;
            const updated = { ...r, [field]: value };
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
        if (!driverName) { addToast('error', 'Nama supir wajib diisi'); return; }
        setSaving(true);
        try {
            const res = await fetch('/api/data', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    entity: 'driver-borongans',
                    data: {
                        driverRef: driverRef || undefined,
                        driverName,
                        periodStart,
                        periodEnd,
                        status: 'UNPAID',
                        totalAmount,
                        totalCollie,
                        totalWeightKg: totalBerat,
                        notes: notes || undefined,
                    }
                })
            });
            const d = await res.json();
            const boronganId = d.data._id;

            await Promise.all(rows.map(r => fetch('/api/data', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    entity: 'driver-borogan-items',
                    data: {
                        boronganRef: boronganId,
                        doRef: r.doRef || undefined,
                        doNumber: r.doNumber || undefined,
                        vehiclePlate: r.vehiclePlate || undefined,
                        date: r.date,
                        noSJ: r.noSJ,
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

            addToast('success', 'Slip borongan berhasil dibuat');
            router.push(`/borongan/${boronganId}`);
        } catch {
            addToast('error', 'Gagal membuat slip borongan');
        }
        setSaving(false);
    };

    const driverDOs = driverRef
        ? deliveryOrders.filter(d => d.driverRef === driverRef)
        : deliveryOrders;

    return (
        <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.25rem' }}>
                <button className="btn-back" onClick={() => router.push('/borongan')}><ArrowLeft size={16} /></button>
                <h1 style={{ fontSize: '1.25rem', fontWeight: 700, margin: 0 }}>Buat Slip Borongan Supir</h1>
            </div>

            <div className="detail-grid">
                <div>
                    <div className="card">
                        <div className="card-header"><span className="card-header-title">Info Supir & Periode</span></div>
                        <div className="card-body">
                            <div className="form-group">
                                <label className="form-label">Supir <span className="required">*</span></label>
                                <select className="form-select" value={driverRef} onChange={e => {
                                    setDriverRef(e.target.value);
                                    const drv = drivers.find(d => d._id === e.target.value);
                                    setDriverName(drv?.name || '');
                                }}>
                                    <option value="">-- Pilih Supir --</option>
                                    {drivers.map(d => <option key={d._id} value={d._id}>{d.name}</option>)}
                                </select>
                            </div>
                            {!driverRef && (
                                <div className="form-group">
                                    <label className="form-label">Atau ketik nama supir</label>
                                    <input className="form-input" value={driverName} onChange={e => setDriverName(e.target.value)} placeholder="Nama supir..." />
                                </div>
                            )}
                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label">Periode Mulai</label>
                                    <input type="date" className="form-input" value={periodStart} onChange={e => setPeriodStart(e.target.value)} />
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Periode Akhir</label>
                                    <input type="date" className="form-input" value={periodEnd} onChange={e => setPeriodEnd(e.target.value)} />
                                </div>
                            </div>
                            <div className="form-group">
                                <label className="form-label">Catatan</label>
                                <textarea className="form-textarea" rows={2} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Opsional..." />
                            </div>
                        </div>
                    </div>

                    <div className="card" style={{ marginTop: '1rem' }}>
                        <div className="card-header"><span className="card-header-title">Tambah dari Surat Jalan</span></div>
                        <div className="card-body">
                            <select className="form-select" onChange={e => { if (e.target.value) { addDORow(e.target.value); e.target.value = ''; } }}>
                                <option value="">-- Pilih DO yang selesai --</option>
                                {driverDOs.map(d => <option key={d._id} value={d._id}>{d.doNumber} — {d.receiverAddress || '-'}</option>)}
                            </select>
                        </div>
                    </div>
                </div>

                <div>
                    <div className="card" style={{ overflow: 'hidden' }}>
                        <div style={{ background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)', color: '#fff', padding: '1.25rem' }}>
                            <div style={{ fontSize: '0.72rem', opacity: 0.8, textTransform: 'uppercase', marginBottom: '0.25rem' }}>Total Upah Borongan</div>
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
                                <Save size={16} /> {saving ? 'Menyimpan...' : 'Simpan Slip Borongan'}
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
                    <table style={{ minWidth: 800 }}>
                        <thead>
                            <tr>
                                <th>NO.TRUCK</th><th>TANGGAL</th><th>NO.SJ</th><th>TUJUAN</th><th>BARANG</th>
                                <th>COLLIE</th><th>BERAT KG</th><th>TARIP</th><th>UANG RP</th><th>KET</th><th style={{ width: 36 }}></th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map(r => (
                                <tr key={r.id}>
                                    <td><input className="form-input" style={{ minWidth: 75 }} value={r.vehiclePlate} onChange={e => updateRow(r.id, 'vehiclePlate', e.target.value)} placeholder="Plat..." /></td>
                                    <td><input type="date" className="form-input" value={r.date} onChange={e => updateRow(r.id, 'date', e.target.value)} /></td>
                                    <td><input className="form-input" value={r.noSJ} onChange={e => updateRow(r.id, 'noSJ', e.target.value)} placeholder="No. SJ..." /></td>
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
                            <tr style={{ background: 'var(--color-bg-secondary)', fontWeight: 700, borderTop: '2px solid var(--color-border)' }}>
                                <td colSpan={5} style={{ textAlign: 'right', paddingRight: '0.75rem' }}>Jumlah</td>
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
