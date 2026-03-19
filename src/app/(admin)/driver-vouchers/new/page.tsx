'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '../../layout';
import { ArrowLeft, Save } from 'lucide-react';
import CurrencyInput from '@/components/CurrencyInput';
import type { BankAccount, Driver, DeliveryOrder, DriverVoucher, Order } from '@/lib/types';

export default function NewDriverVoucherPage() {
    const router = useRouter();
    const { addToast } = useToast();
    const [drivers, setDrivers] = useState<Driver[]>([]);
    const [dos, setDos] = useState<DeliveryOrder[]>([]);
    const [orders, setOrders] = useState<Order[]>([]);
    const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
    const [usedVoucherDoRefs, setUsedVoucherDoRefs] = useState<string[]>([]);
    const [usedBoronganDoRefs, setUsedBoronganDoRefs] = useState<string[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [form, setForm] = useState({
        deliveryOrderRef: '',
        issueBankRef: '',
        issuedDate: new Date().toISOString().split('T')[0],
        cashGiven: 0,
        notes: '',
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
            fetchEntity<Order[]>('/api/data?entity=orders'),
            fetchEntity<BankAccount[]>('/api/data?entity=bank-accounts'),
            fetchEntity<DriverVoucher[]>('/api/data?entity=driver-vouchers'),
            fetchEntity<Array<{ doRef?: string }>>('/api/data?entity=driver-borongan-items'),
        ]).then(([driverRows, deliveryOrders, orderRows, accountRows, voucherRows, boronganItemRows]) => {
            setDrivers((driverRows || []).filter((driver) => driver.active !== false));
            setDos((deliveryOrders || []).filter((deliveryOrder) => ['CREATED', 'HEADING_TO_PICKUP', 'ON_DELIVERY', 'ARRIVED'].includes(deliveryOrder.status)));
            setOrders(orderRows || []);
            setBankAccounts((accountRows || []).filter((account) => account.active !== false));
            setUsedVoucherDoRefs(
                (voucherRows || [])
                    .map(voucher => voucher.deliveryOrderRef)
                    .filter((value): value is string => Boolean(value))
            );
            setUsedBoronganDoRefs(
                (boronganItemRows || [])
                    .map(item => item.doRef)
                    .filter((value): value is string => Boolean(value))
            );
        }).catch(error => {
            addToast('error', error instanceof Error ? error.message : 'Gagal memuat form bon supir');
        }).finally(() => {
            setLoading(false);
        });
    }, [addToast]);

    const eligibleDos = dos
        .filter(deliveryOrder =>
            Boolean(deliveryOrder.driverRef) &&
            Boolean(deliveryOrder.vehicleRef || deliveryOrder.vehiclePlate) &&
            Number(deliveryOrder.taripBorongan || 0) > 0 &&
            !usedVoucherDoRefs.includes(deliveryOrder._id) &&
            !usedBoronganDoRefs.includes(deliveryOrder._id)
        )
        .sort((a, b) => (b.date || '').localeCompare(a.date || ''));

    const selectedDo = eligibleDos.find((deliveryOrder) => deliveryOrder._id === form.deliveryOrderRef)
        || dos.find((deliveryOrder) => deliveryOrder._id === form.deliveryOrderRef)
        || null;
    const selectedOrder = selectedDo?.orderRef
        ? orders.find((order) => order._id === selectedDo.orderRef)
        : null;
    const selectedDriver = selectedDo?.driverRef
        ? drivers.find((driver) => driver._id === selectedDo.driverRef)
        : null;
    const selectedDriverName = selectedDo?.driverName || selectedDriver?.name || '-';
    const selectedVehicleLabel = selectedDo?.vehiclePlate || '-';
    const selectedRoute = [
        selectedDo?.pickupAddress || selectedOrder?.pickupAddress,
        selectedDo?.receiverAddress || selectedOrder?.receiverAddress,
    ].filter(Boolean).join(' -> ') || '-';
    const selectedTripFee = Number(selectedDo?.taripBorongan || 0);

    const handleSave = async () => {
        if (!form.deliveryOrderRef) {
            addToast('error', 'Pilih DO / trip terlebih dahulu');
            return;
        }
        if (!form.cashGiven || form.cashGiven <= 0) {
            addToast('error', 'Nominal uang harus diisi');
            return;
        }
        if (!form.issueBankRef) {
            addToast('error', 'Pilih rekening sumber bon');
            return;
        }
        if (!selectedDo) {
            addToast('error', 'DO trip tidak valid atau sudah tidak bisa dipakai');
            return;
        }
        if (selectedTripFee <= 0) {
            addToast('error', 'Isi upah trip pada DO dulu sebelum membuat bon');
            return;
        }

        setSaving(true);

        const voucherData = {
            deliveryOrderRef: form.deliveryOrderRef,
            issuedDate: form.issuedDate,
            cashGiven: form.cashGiven,
            issueBankRef: form.issueBankRef,
            notes: form.notes || undefined,
        };

        try {
            const res = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ entity: 'driver-vouchers', data: voucherData }),
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

    if (loading) {
        return <div><div className="skeleton skeleton-title" /><div className="skeleton skeleton-card" style={{ height: 300 }} /></div>;
    }

    return (
        <div>
            <div className="page-header">
                <div className="page-header-left">
                    <button type="button" className="btn-back" onClick={() => router.push('/driver-vouchers')}><ArrowLeft size={16} /></button>
                    <h1 className="page-title">Buat Bon Supir Baru</h1>
                </div>
            </div>

            <div className="card">
                <div className="card-body">
                    <div className="form-section-title">Informasi Bon</div>
                    <div className="form-row">
                        <div className="form-group">
                            <label className="form-label">Surat Jalan / Trip <span className="required">*</span></label>
                            <select className="form-select" value={form.deliveryOrderRef} onChange={e => setForm({ ...form, deliveryOrderRef: e.target.value })}>
                                <option value="">Pilih DO trip operasional</option>
                                {eligibleDos.map(deliveryOrder => {
                                    const order = deliveryOrder.orderRef
                                        ? orders.find(item => item._id === deliveryOrder.orderRef)
                                        : null;
                                    const route = [
                                        deliveryOrder.pickupAddress || order?.pickupAddress,
                                        deliveryOrder.receiverAddress || order?.receiverAddress,
                                    ].filter(Boolean).join(' -> ');
                                    return (
                                        <option key={deliveryOrder._id} value={deliveryOrder._id}>
                                            {deliveryOrder.doNumber} | {deliveryOrder.driverName || drivers.find(driver => driver._id === deliveryOrder.driverRef)?.name || '-'} | {deliveryOrder.vehiclePlate || '-'}{route ? ` | ${route}` : ''}
                                        </option>
                                    );
                                })}
                            </select>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
                                Bon trip wajib tertaut ke 1 DO. Hanya DO operasional yang sudah punya supir, kendaraan, tarif trip, dan belum dipakai bon/borongan yang muncul di sini.
                            </div>
                        </div>
                        <div className="form-group">
                            <label className="form-label">Tanggal</label>
                            <input type="date" className="form-input" value={form.issuedDate} onChange={e => setForm({ ...form, issuedDate: e.target.value })} />
                        </div>
                    </div>
                    <div className="form-row">
                        <div className="form-group">
                            <label className="form-label">Supir Trip</label>
                            <input className="form-input" value={selectedDriverName} readOnly placeholder="Pilih DO untuk mengisi supir" />
                        </div>
                        <div className="form-group">
                            <label className="form-label">Kendaraan</label>
                            <input className="form-input" value={selectedVehicleLabel} readOnly placeholder="Pilih DO untuk mengisi kendaraan" />
                        </div>
                    </div>
                    <div className="form-row">
                        <div className="form-group">
                            <label className="form-label">Rute</label>
                            <input className="form-input" value={selectedRoute} readOnly placeholder="Pilih DO untuk mengisi rute" />
                        </div>
                        <div className="form-group">
                            <label className="form-label">Rekening / Kas Sumber <span className="required">*</span></label>
                            <select className="form-select" value={form.issueBankRef} onChange={e => setForm({ ...form, issueBankRef: e.target.value })}>
                                <option value="">Pilih rekening atau kas</option>
                                {bankAccounts.map(account => <option key={account._id} value={account._id}>{account.bankName} - {account.accountNumber}{account.accountType === 'CASH' ? ' (Kas Tunai)' : ''}</option>)}
                            </select>
                        </div>
                    </div>
                    <div className="form-row">
                        <div className="form-group">
                            <label className="form-label">Uang Jalan Awal <span className="required">*</span></label>
                            <CurrencyInput value={form.cashGiven} onValueChange={value => setForm({ ...form, cashGiven: value })} placeholder="Ketik uang jalan awal" />
                        </div>
                        <div className="form-group">
                            <label className="form-label">Upah Trip</label>
                            <CurrencyInput
                                placeholder="Pilih DO"
                                value={selectedTripFee}
                                onValueChange={() => {}}
                                readOnly
                            />
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
                                Upah trip mengikuti tarif pada DO dan tidak diisi manual dari bon. Jika nilainya 0, isi dulu tarif trip di detail DO.
                            </div>
                        </div>
                    </div>
                    <div className="card" style={{ marginTop: 'var(--space-4)', background: 'var(--color-bg-secondary)' }}>
                        <div className="card-body" style={{ padding: 'var(--space-4)' }}>
                            <div style={{ fontWeight: 700, marginBottom: '0.5rem' }}>Ringkasan Settlement</div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.75rem' }}>
                                <div><div className="text-muted" style={{ fontSize: '0.75rem' }}>Uang Jalan Awal</div><div style={{ fontWeight: 700 }}>Rp {form.cashGiven.toLocaleString('id-ID')}</div></div>
                                <div><div className="text-muted" style={{ fontSize: '0.75rem' }}>Upah Trip</div><div style={{ fontWeight: 700 }}>Rp {selectedTripFee.toLocaleString('id-ID')}</div></div>
                                <div><div className="text-muted" style={{ fontSize: '0.75rem' }}>Estimasi Selisih Awal</div><div style={{ fontWeight: 700, color: form.cashGiven - selectedTripFee >= 0 ? '#16a34a' : '#ef4444' }}>Rp {Math.abs(form.cashGiven - selectedTripFee).toLocaleString('id-ID')} {form.cashGiven - selectedTripFee >= 0 ? 'sisa' : 'kurang bayar'}</div></div>
                            </div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.75rem' }}>
                                Settlement trip dihitung dari uang jalan awal dibanding total biaya perjalanan aktual + upah trip DO.
                            </div>
                        </div>
                    </div>
                    <div className="form-group">
                        <label className="form-label">Catatan</label>
                        <textarea className="form-textarea" rows={2} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="Catatan tambahan..." />
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: 'var(--space-4)' }}>
                        <button type="button" className="btn btn-secondary" onClick={() => router.push('/driver-vouchers')}>Batal</button>
                        <button type="button" className="btn btn-primary" onClick={handleSave} disabled={saving}><Save size={16} /> {saving ? 'Menyimpan...' : 'Simpan & Terbitkan'}</button>
                    </div>
                </div>
            </div>
        </div>
    );
}
