'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useToast } from '../../../layout';
import { ArrowLeft, Save } from 'lucide-react';
import type { Order, Customer, Service } from '@/lib/types';

export default function OrderEditPage() {
    const params = useParams();
    const router = useRouter();
    const { addToast } = useToast();
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [customers, setCustomers] = useState<Customer[]>([]);
    const [services, setServices] = useState<Service[]>([]);
    const [form, setForm] = useState({
        customerRef: '', customerName: '',
        receiverName: '', receiverPhone: '', receiverAddress: '', receiverCompany: '',
        serviceRef: '', serviceName: '',
        notes: ''
    });

    useEffect(() => {
        const id = params.id as string;
        Promise.all([
            fetch(`/api/data?entity=orders&id=${id}`).then(r => r.json()),
            fetch('/api/data?entity=customers').then(r => r.json()),
            fetch('/api/data?entity=services').then(r => r.json()),
        ]).then(([orderRes, custRes, svcRes]) => {
            const order = orderRes.data as Order;
            if (order) {
                setForm({
                    customerRef: order.customerRef, customerName: order.customerName || '',
                    receiverName: order.receiverName, receiverPhone: order.receiverPhone,
                    receiverAddress: order.receiverAddress, receiverCompany: order.receiverCompany || '',
                    serviceRef: order.serviceRef, serviceName: order.serviceName || '',
                    notes: order.notes || ''
                });
            }
            setCustomers(custRes.data || []);
            setServices(svcRes.data || []);
            setLoading(false);
        }).catch(() => setLoading(false));
    }, [params.id]);

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!form.receiverName || !form.receiverAddress) {
            addToast('error', 'Nama dan alamat penerima wajib');
            return;
        }
        setSaving(true);
        try {
            await fetch('/api/data', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    entity: 'orders', action: 'update',
                    data: { id: params.id, updates: form }
                }),
            });
            addToast('success', 'Order berhasil diperbarui');
            router.push(`/orders/${params.id}`);
        } catch { addToast('error', 'Gagal menyimpan'); }
        setSaving(false);
    };

    if (loading) return <div><div className="skeleton skeleton-title" /><div className="skeleton skeleton-card" style={{ height: 300 }} /></div>;

    return (
        <div>
            <div className="page-header">
                <div className="page-header-left">
                    <button className="btn btn-ghost btn-sm mb-2" onClick={() => router.push(`/orders/${params.id}`)}><ArrowLeft size={16} /> Kembali</button>
                    <h1 className="page-title">Edit Order</h1>
                </div>
            </div>

            <form onSubmit={handleSave}>
                <div className="detail-grid">
                    <div className="card">
                        <div className="card-header"><span className="card-header-title">Informasi Order</span></div>
                        <div className="card-body">
                            <div className="form-group">
                                <label className="form-label">Customer</label>
                                <select className="form-select" value={form.customerRef} onChange={e => {
                                    const cust = customers.find(c => c._id === e.target.value);
                                    setForm({ ...form, customerRef: e.target.value, customerName: cust?.name || '' });
                                }}>
                                    <option value="">Pilih Customer</option>
                                    {customers.map(c => <option key={c._id} value={c._id}>{c.name}</option>)}
                                </select>
                            </div>
                            <div className="form-group">
                                <label className="form-label">Layanan</label>
                                <select className="form-select" value={form.serviceRef} onChange={e => {
                                    const svc = services.find(s => s._id === e.target.value);
                                    setForm({ ...form, serviceRef: e.target.value, serviceName: svc?.name || '' });
                                }}>
                                    <option value="">Pilih Layanan</option>
                                    {services.map(s => <option key={s._id} value={s._id}>{s.name}</option>)}
                                </select>
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
                                    <input className="form-input" value={form.receiverName} onChange={e => setForm({ ...form, receiverName: e.target.value })} />
                                </div>
                                <div className="form-group"><label className="form-label">Telepon</label>
                                    <input className="form-input" value={form.receiverPhone} onChange={e => setForm({ ...form, receiverPhone: e.target.value })} />
                                </div>
                            </div>
                            <div className="form-group"><label className="form-label">Perusahaan Penerima</label>
                                <input className="form-input" value={form.receiverCompany} onChange={e => setForm({ ...form, receiverCompany: e.target.value })} />
                            </div>
                            <div className="form-group"><label className="form-label">Alamat Penerima <span className="required">*</span></label>
                                <textarea className="form-textarea" rows={3} value={form.receiverAddress} onChange={e => setForm({ ...form, receiverAddress: e.target.value })} />
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
