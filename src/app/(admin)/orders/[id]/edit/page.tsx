'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useToast } from '../../../layout';
import { ArrowLeft, Save } from 'lucide-react';
import type { Order, Customer, Service, DeliveryOrder } from '@/lib/types';

export default function OrderEditPage() {
    const params = useParams();
    const router = useRouter();
    const { addToast } = useToast();
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [customers, setCustomers] = useState<Customer[]>([]);
    const [services, setServices] = useState<Service[]>([]);
    const [hasDeliveryOrders, setHasDeliveryOrders] = useState(false);
    const [form, setForm] = useState({
        customerRef: '', customerName: '',
        receiverName: '', receiverPhone: '', receiverAddress: '', receiverCompany: '',
        pickupAddress: '',
        serviceRef: '', serviceName: '',
        notes: ''
    });

    const syncPickupAddressForCustomer = (nextCustomerRef: string, previousForm: typeof form) => {
        const nextCustomer = customers.find(customer => customer._id === nextCustomerRef);
        const previousCustomer = customers.find(customer => customer._id === previousForm.customerRef);
        const previousCustomerAddress = previousCustomer?.address?.trim() || '';
        const currentPickup = previousForm.pickupAddress.trim();

        if (!currentPickup || (previousCustomerAddress && currentPickup === previousCustomerAddress)) {
            return nextCustomer?.address || '';
        }

        return previousForm.pickupAddress;
    };

    useEffect(() => {
        const id = params.id as string;
        const fetchEntity = async <T,>(url: string) => {
            const res = await fetch(url);
            const payload = await res.json();
            if (!res.ok) {
                throw new Error(payload.error || 'Gagal memuat form edit order');
            }
            return payload.data as T;
        };

        Promise.all([
            fetchEntity<Order | null>(`/api/data?entity=orders&id=${id}`),
            fetchEntity<Customer[]>('/api/data?entity=customers'),
            fetchEntity<Service[]>('/api/data?entity=services'),
            fetchEntity<DeliveryOrder[]>(`/api/data?entity=delivery-orders&filter=${encodeURIComponent(JSON.stringify({ orderRef: id }))}`),
        ]).then(([order, customerRows, serviceRows, deliveryOrders]) => {
            if (order) {
                setForm({
                    customerRef: order.customerRef, customerName: order.customerName || '',
                    receiverName: order.receiverName, receiverPhone: order.receiverPhone,
                    receiverAddress: order.receiverAddress, receiverCompany: order.receiverCompany || '',
                    pickupAddress: order.pickupAddress || '',
                    serviceRef: order.serviceRef, serviceName: order.serviceName || '',
                    notes: order.notes || ''
                });
            }
            setCustomers((customerRows || []).filter(customer => customer.active !== false || customer._id === order?.customerRef));
            setServices((serviceRows || []).filter(service => service.active !== false || service._id === order?.serviceRef));
            setHasDeliveryOrders((deliveryOrders || []).length > 0);
        }).catch(error => {
            addToast('error', error instanceof Error ? error.message : 'Gagal memuat form edit order');
        }).finally(() => {
            setLoading(false);
        });
    }, [addToast, params.id]);

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!form.receiverName || !form.receiverAddress) {
            addToast('error', 'Nama dan alamat penerima wajib');
            return;
        }
        setSaving(true);
        try {
            const res = await fetch('/api/data', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    entity: 'orders', action: 'update',
                    data: { id: params.id, updates: form }
                }),
            });
            const payload = await res.json();
            if (!res.ok) {
                throw new Error(payload.error || 'Gagal menyimpan perubahan order');
            }
            addToast('success', 'Order berhasil diperbarui');
            router.push(`/orders/${params.id}`);
        } catch (error) {
            addToast('error', error instanceof Error ? error.message : 'Gagal menyimpan');
        } finally {
            setSaving(false);
        }
    };

    if (loading) return <div><div className="skeleton skeleton-title" /><div className="skeleton skeleton-card" style={{ height: 300 }} /></div>;

    return (
        <div>
            <div className="page-header">
                <div className="page-header-left">
                    <button className="btn-back" onClick={() => router.push(`/orders/${params.id}`)}><ArrowLeft size={16} /></button>
                    <h1 className="page-title">Edit Order</h1>
                </div>
            </div>

            <form onSubmit={handleSave}>
                <div className="detail-grid">
                    <div className="card">
                        <div className="card-header"><span className="card-header-title">Informasi Order</span></div>
                        <div className="card-body">
                            {hasDeliveryOrders && (
                                <div className="alert alert-warning" style={{ marginBottom: '1rem' }}>
                                    Order ini sudah punya surat jalan. Field utama dikunci agar customer, layanan, dan penerima tetap konsisten dengan dokumen turunannya. Hanya catatan yang masih bisa diubah.
                                </div>
                            )}
                            <div className="form-group">
                                <label className="form-label">Customer</label>
                                <select className="form-select" value={form.customerRef} onChange={e => {
                                    const cust = customers.find(c => c._id === e.target.value);
                                    setForm(prev => ({
                                        ...prev,
                                        customerRef: e.target.value,
                                        customerName: cust?.name || '',
                                        pickupAddress: syncPickupAddressForCustomer(e.target.value, prev),
                                    }));
                                }} disabled={hasDeliveryOrders}>
                                    <option value="">Pilih Customer</option>
                                    {customers.map(c => <option key={c._id} value={c._id}>{c.name}</option>)}
                                </select>
                            </div>
                            <div className="form-group">
                                <label className="form-label">Layanan</label>
                                <select className="form-select" value={form.serviceRef} onChange={e => {
                                    const svc = services.find(s => s._id === e.target.value);
                                    setForm({ ...form, serviceRef: e.target.value, serviceName: svc?.name || '' });
                                }} disabled={hasDeliveryOrders}>
                                    <option value="">Pilih Layanan</option>
                                    {services.map(s => <option key={s._id} value={s._id}>{s.name}</option>)}
                                </select>
                            </div>
                            <div className="form-group">
                                <label className="form-label">Alamat Pickup</label>
                                <textarea className="form-textarea" rows={2} value={form.pickupAddress} onChange={e => setForm({ ...form, pickupAddress: e.target.value })} disabled={hasDeliveryOrders} />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Catatan</label>
                                <textarea className="form-textarea" rows={3} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
                            </div>
                        </div>
                    </div>

                    <div className="card">
                        <div className="card-header"><span className="card-header-title">Informasi Penerima</span></div>
                        <div className="card-body">
                            <div className="form-row">
                                <div className="form-group"><label className="form-label">Nama Penerima <span className="required">*</span></label>
                                    <input className="form-input" value={form.receiverName} onChange={e => setForm({ ...form, receiverName: e.target.value })} disabled={hasDeliveryOrders} />
                                </div>
                                <div className="form-group"><label className="form-label">Telepon</label>
                                    <input className="form-input" value={form.receiverPhone} onChange={e => setForm({ ...form, receiverPhone: e.target.value })} disabled={hasDeliveryOrders} />
                                </div>
                            </div>
                            <div className="form-group"><label className="form-label">Perusahaan Penerima</label>
                                <input className="form-input" value={form.receiverCompany} onChange={e => setForm({ ...form, receiverCompany: e.target.value })} disabled={hasDeliveryOrders} />
                            </div>
                            <div className="form-group"><label className="form-label">Alamat Penerima <span className="required">*</span></label>
                                <textarea className="form-textarea" rows={3} value={form.receiverAddress} onChange={e => setForm({ ...form, receiverAddress: e.target.value })} disabled={hasDeliveryOrders} />
                            </div>
                        </div>
                    </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 24 }}>
                    <button type="button" className="btn btn-secondary" onClick={() => router.push(`/orders/${params.id}`)}>Batal</button>
                    <button type="submit" className="btn btn-primary" disabled={saving}><Save size={16} /> {saving ? 'Menyimpan...' : 'Simpan Perubahan'}</button>
                </div>
            </form>
        </div>
    );
}
