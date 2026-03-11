'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '../../layout';
import { ArrowLeft, Save, Plus, X } from 'lucide-react';
import type { Customer, Service } from '@/lib/types';

export default function NewOrderPage() {
    const router = useRouter();
    const { addToast } = useToast();
    const [customers, setCustomers] = useState<Customer[]>([]);
    const [services, setServices] = useState<Service[]>([]);
    const [loading, setLoading] = useState(false);

    // Form state
    const [customerRef, setCustomerRef] = useState('');
    const [serviceRef, setServiceRef] = useState('');
    const [receiverName, setReceiverName] = useState('');
    const [receiverPhone, setReceiverPhone] = useState('');
    const [receiverAddress, setReceiverAddress] = useState('');
    const [receiverCompany, setReceiverCompany] = useState('');
    const [pickupAddress, setPickupAddress] = useState('');
    const [notes, setNotes] = useState('');
    const [items, setItems] = useState([{ description: '', qtyKoli: 1, weight: 0, volume: 0, value: 0 }]);

    useEffect(() => {
        Promise.all([
            fetch('/api/data?entity=customers').then(r => r.json()),
            fetch('/api/data?entity=services').then(r => r.json()),
        ]).then(([c, s]) => {
            setCustomers(c.data || []);
            setServices(s.data || []);
        });
    }, []);

    const addItem = () => setItems(prev => [...prev, { description: '', qtyKoli: 1, weight: 0, volume: 0, value: 0 }]);
    const removeItem = (idx: number) => setItems(prev => prev.filter((_, i) => i !== idx));
    const updateItem = (idx: number, field: string, value: string | number) => {
        setItems(prev => prev.map((item, i) => i === idx ? { ...item, [field]: value } : item));
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!customerRef || !receiverName || !receiverAddress) {
            addToast('error', 'Mohon lengkapi data wajib');
            return;
        }
        const validItems = items.filter(item => item.description.trim());
        if (validItems.length === 0) {
            addToast('error', 'Minimal 1 item order wajib diisi');
            return;
        }
        setLoading(true);

        try {
            const selCustomer = customers.find(c => c._id === customerRef);
            const selService = services.find(s => s._id === serviceRef);

            const res = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    entity: 'orders',
                    action: 'create-with-items',
                    data: {
                        customerRef, customerName: selCustomer?.name || '',
                        receiverName, receiverPhone, receiverAddress, receiverCompany,
                        pickupAddress, serviceRef, serviceName: selService?.name || '',
                        notes,
                        items: validItems,
                    },
                }),
            });

            const orderData = await res.json();
            if (!res.ok) {
                addToast('error', orderData.error || 'Gagal membuat order');
                return;
            }
            const orderId = orderData.data?._id || orderData.id;

            addToast('success', `Order dibuat: ${orderData.data?.masterResi || ''}`);
            router.push(`/orders/${orderId}`);
        } catch {
            addToast('error', 'Gagal membuat order');
        }
        setLoading(false);
    };

    return (
        <div>
            <div className="page-header">
                <div className="page-header-left">
                    <button className="btn-back" onClick={() => router.push('/orders')}>
                        <ArrowLeft size={16} />
                    </button>
                    <h1 className="page-title">Buat Order Baru</h1>
                    <p className="page-subtitle">Isi data pengiriman dan item barang</p>
                </div>
            </div>

            <form onSubmit={handleSubmit}>
                <div className="detail-grid">
                    {/* Pengirim */}
                    <div className="card">
                        <div className="card-header"><span className="card-header-title">Data Pengirim</span></div>
                        <div className="card-body">
                            <div className="form-group">
                                <label className="form-label">Customer Pengirim <span className="required">*</span></label>
                                <select className="form-select" value={customerRef} onChange={e => setCustomerRef(e.target.value)} required>
                                    <option value="">Pilih customer</option>
                                    {customers.filter(c => c.active).map(c => <option key={c._id} value={c._id}>{c.name}</option>)}
                                </select>
                            </div>
                            <div className="form-group">
                                <label className="form-label">Layanan</label>
                                <select className="form-select" value={serviceRef} onChange={e => setServiceRef(e.target.value)}>
                                    <option value="">Pilih layanan</option>
                                    {services.filter(s => s.active).map(s => <option key={s._id} value={s._id}>{s.name}</option>)}
                                </select>
                            </div>
                            <div className="form-group">
                                <label className="form-label">Alamat Pickup (Opsional)</label>
                                <input className="form-input" value={pickupAddress} onChange={e => setPickupAddress(e.target.value)} placeholder="Alamat pengambilan barang" />
                            </div>
                        </div>
                    </div>

                    {/* Penerima */}
                    <div className="card">
                        <div className="card-header"><span className="card-header-title">Data Penerima</span></div>
                        <div className="card-body">
                            <div className="form-group">
                                <label className="form-label">Nama Penerima <span className="required">*</span></label>
                                <input className="form-input" value={receiverName} onChange={e => setReceiverName(e.target.value)} required />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Telepon</label>
                                <input className="form-input" value={receiverPhone} onChange={e => setReceiverPhone(e.target.value)} />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Alamat Tujuan <span className="required">*</span></label>
                                <textarea className="form-textarea" rows={2} value={receiverAddress} onChange={e => setReceiverAddress(e.target.value)} required />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Perusahaan (Opsional)</label>
                                <input className="form-input" value={receiverCompany} onChange={e => setReceiverCompany(e.target.value)} />
                            </div>
                        </div>
                    </div>
                </div>

                {/* Items */}
                <div className="card mt-6">
                    <div className="card-header">
                        <span className="card-header-title">Item / Koli</span>
                        <button type="button" className="btn btn-secondary btn-sm" onClick={addItem}>
                            <Plus size={14} /> Tambah Item
                        </button>
                    </div>
                    <div className="card-body">
                        {items.map((item, idx) => (
                            <div key={idx} style={{ display: 'flex', gap: 12, alignItems: 'flex-end', marginBottom: 12, padding: 12, background: 'var(--color-gray-50)', borderRadius: 'var(--radius-md)' }}>
                                <div style={{ flex: 3 }}>
                                    <label className="form-label">Deskripsi</label>
                                    <input className="form-input" value={item.description} onChange={e => updateItem(idx, 'description', e.target.value)} placeholder="Nama/deskripsi barang" />
                                </div>
                                <div style={{ flex: 1 }}>
                                    <label className="form-label">Koli</label>
                                    <input className="form-input" type="number" min={1} value={item.qtyKoli} onChange={e => updateItem(idx, 'qtyKoli', Number(e.target.value))} />
                                </div>
                                <div style={{ flex: 1 }}>
                                    <label className="form-label">Berat (kg)</label>
                                    <input className="form-input" type="number" min={0} value={item.weight} onChange={e => updateItem(idx, 'weight', Number(e.target.value))} />
                                </div>
                                <div style={{ flex: 1 }}>
                                    <label className="form-label">Volume (m3)</label>
                                    <input className="form-input" type="number" min={0} step={0.01} value={item.volume} onChange={e => updateItem(idx, 'volume', Number(e.target.value))} />
                                </div>
                                {items.length > 1 && (
                                    <button type="button" className="btn btn-ghost btn-icon-only" onClick={() => removeItem(idx)} style={{ marginBottom: 4 }}>
                                        <X size={18} />
                                    </button>
                                )}
                            </div>
                        ))}
                    </div>
                </div>

                {/* Notes & Submit */}
                <div className="card mt-6">
                    <div className="card-body">
                        <div className="form-group">
                            <label className="form-label">Catatan Internal</label>
                            <textarea className="form-textarea" rows={3} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Catatan opsional..." />
                        </div>
                    </div>
                    <div className="card-footer">
                        <button type="button" className="btn btn-secondary" onClick={() => router.push('/orders')}>Batal</button>
                        <button type="submit" className="btn btn-primary" disabled={loading}>
                            <Save size={16} /> {loading ? 'Menyimpan...' : 'Simpan Order'}
                        </button>
                    </div>
                </div>
            </form>
        </div>
    );
}
