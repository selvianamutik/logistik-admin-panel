'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '../../layout';
import { ArrowLeft, Save } from 'lucide-react';
import type { BankAccount, Driver, DeliveryOrder, Vehicle } from '@/lib/types';

export default function NewDriverVoucherPage() {
    const router = useRouter();
    const { addToast } = useToast();
    const [drivers, setDrivers] = useState<Driver[]>([]);
    const [dos, setDos] = useState<DeliveryOrder[]>([]);
    const [vehicles, setVehicles] = useState<Vehicle[]>([]);
    const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [form, setForm] = useState({
        driverRef: '', deliveryOrderRef: '', vehicleRef: '', route: '', issueBankRef: '',
        issuedDate: new Date().toISOString().split('T')[0], cashGiven: 0, notes: ''
    });

    useEffect(() => {
        const fetchEntity = async <T,>(url: string) => {
            const res = await fetch(url);
            const payload = await res.json();
            if (!res.ok) {
                throw new Error(payload.error || 'Gagal memuat form bon supir');
            }
            return payload.data as T;
        };

        Promise.all([
            fetchEntity<Driver[]>('/api/data?entity=drivers'),
            fetchEntity<DeliveryOrder[]>('/api/data?entity=delivery-orders'),
            fetchEntity<Vehicle[]>('/api/data?entity=vehicles'),
            fetchEntity<BankAccount[]>('/api/data?entity=bank-accounts'),
        ]).then(([driverRows, deliveryOrders, vehicleRows, accountRows]) => {
            setDrivers((driverRows || []).filter((x) => x.active));
            setDos(deliveryOrders || []);
            setVehicles((vehicleRows || []).filter((x) => x.status === 'ACTIVE'));
            setBankAccounts((accountRows || []).filter((x) => x.active !== false));
        }).catch(error => {
            addToast('error', error instanceof Error ? error.message : 'Gagal memuat form bon supir');
        }).finally(() => {
            setLoading(false);
        });
    }, [addToast]);

    // Auto-fill vehicle/driver when DO selected
    const handleDOChange = (doId: string) => {
        const doItem = dos.find(d => d._id === doId);
        setForm(prev => ({
            ...prev,
            deliveryOrderRef: doId,
            vehicleRef: doItem?.vehicleRef || prev.vehicleRef,
            driverRef: doItem?.driverRef || prev.driverRef,
        }));
    };

    const handleSave = async () => {
        if (!form.driverRef) { addToast('error', 'Pilih supir terlebih dahulu'); return; }
        if (!form.cashGiven || form.cashGiven <= 0) { addToast('error', 'Nominal uang harus diisi'); return; }
        if (!form.issueBankRef) { addToast('error', 'Pilih rekening sumber bon'); return; }
        setSaving(true);

        const driver = drivers.find(d => d._id === form.driverRef);
        const doItem = dos.find(d => d._id === form.deliveryOrderRef);
        const vehicle = vehicles.find(v => v._id === form.vehicleRef);
        const issueBank = bankAccounts.find(b => b._id === form.issueBankRef);

        const voucherData = {
            driverRef: form.driverRef,
            driverName: driver?.name || '',
            deliveryOrderRef: form.deliveryOrderRef || undefined,
            doNumber: doItem?.doNumber || undefined,
            vehicleRef: form.vehicleRef || undefined,
            vehiclePlate: vehicle?.plateNumber || undefined,
            route: form.route || undefined,
            issuedDate: form.issuedDate,
            cashGiven: form.cashGiven,
            issueBankRef: form.issueBankRef,
            issueBankName: issueBank?.bankName || undefined,
            totalSpent: 0,
            balance: form.cashGiven,
            status: 'ISSUED',
            notes: form.notes || undefined,
        };

        try {
            const res = await fetch('/api/data', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ entity: 'driver-vouchers', data: voucherData })
            });
            const result = await res.json();
            if (!res.ok) {
                addToast('error', result.error || 'Gagal membuat bon supir');
                setSaving(false);
                return;
            }

            addToast('success', `Bon ${result.data?.bonNumber || ''} berhasil dibuat`);
            router.push(`/driver-vouchers/${result.data._id}`);
        } catch {
            addToast('error', 'Gagal membuat bon supir');
            setSaving(false);
            return;
        }
    };

    if (loading) return <div><div className="skeleton skeleton-title" /><div className="skeleton skeleton-card" style={{ height: 300 }} /></div>;

    return (
        <div>
            <div className="page-header">
                <div className="page-header-left">
                    <button className="btn-back" onClick={() => router.push('/driver-vouchers')}><ArrowLeft size={16} /></button>
                    <h1 className="page-title">Buat Bon Supir Baru</h1>
                </div>
            </div>

            <div className="card">
                <div className="card-body">
                    <div className="form-section-title">Informasi Bon</div>
                    <div className="form-row">
                        <div className="form-group">
                            <label className="form-label">Supir <span className="required">*</span></label>
                            <select className="form-select" value={form.driverRef} onChange={e => setForm({ ...form, driverRef: e.target.value })}>
                                <option value="">Pilih supir</option>
                                {drivers.map(d => <option key={d._id} value={d._id}>{d.name} - {d.phone}</option>)}
                            </select>
                        </div>
                        <div className="form-group">
                            <label className="form-label">Tanggal</label>
                            <input type="date" className="form-input" value={form.issuedDate} onChange={e => setForm({ ...form, issuedDate: e.target.value })} />
                        </div>
                    </div>
                    <div className="form-row">
                        <div className="form-group">
                            <label className="form-label">Surat Jalan (DO)</label>
                            <select className="form-select" value={form.deliveryOrderRef} onChange={e => handleDOChange(e.target.value)}>
                                <option value="">-- Opsional --</option>
                                {dos.map(d => <option key={d._id} value={d._id}>{d.doNumber} {d.driverName ? `(${d.driverName})` : ''}</option>)}
                            </select>
                        </div>
                        <div className="form-group">
                            <label className="form-label">Kendaraan</label>
                            <select className="form-select" value={form.vehicleRef} onChange={e => setForm({ ...form, vehicleRef: e.target.value })}>
                                <option value="">-- Opsional --</option>
                                {vehicles.map(v => <option key={v._id} value={v._id}>{v.plateNumber} - {v.brandModel}</option>)}
                            </select>
                        </div>
                    </div>
                    <div className="form-row">
                        <div className="form-group">
                            <label className="form-label">Rute</label>
                            <input className="form-input" placeholder="Contoh: Jakarta → Surabaya" value={form.route} onChange={e => setForm({ ...form, route: e.target.value })} />
                        </div>
                        <div className="form-group">
                            <label className="form-label">Rekening / Kas Sumber <span className="required">*</span></label>
                            <select className="form-select" value={form.issueBankRef} onChange={e => setForm({ ...form, issueBankRef: e.target.value })}>
                                <option value="">Pilih rekening atau kas</option>
                                {bankAccounts.map(b => <option key={b._id} value={b._id}>{b.bankName} - {b.accountNumber}{b.accountType === 'CASH' ? ' (Kas Tunai)' : ''}</option>)}
                            </select>
                        </div>
                    </div>
                    <div className="form-row">
                        <div className="form-group">
                            <label className="form-label">Uang Diberikan <span className="required">*</span></label>
                            <input type="number" className="form-input" placeholder="0" value={form.cashGiven || ''} onChange={e => setForm({ ...form, cashGiven: Number(e.target.value) })} />
                        </div>
                    </div>
                    <div className="form-group">
                        <label className="form-label">Catatan</label>
                        <textarea className="form-textarea" rows={2} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="Catatan tambahan..." />
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: 'var(--space-4)' }}>
                        <button className="btn btn-secondary" onClick={() => router.push('/driver-vouchers')}>Batal</button>
                        <button className="btn btn-primary" onClick={handleSave} disabled={saving}><Save size={16} /> {saving ? 'Menyimpan...' : 'Simpan & Terbitkan'}</button>
                    </div>
                </div>
            </div>
        </div>
    );
}
