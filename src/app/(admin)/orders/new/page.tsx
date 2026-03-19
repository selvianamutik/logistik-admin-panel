'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '../../layout';
import { Save, Plus, X } from 'lucide-react';
import PageBackButton from '@/components/PageBackButton';
import type { Customer, CustomerProduct, Service } from '@/lib/types';
import {
    VOLUME_INPUT_UNIT_OPTIONS,
    WEIGHT_INPUT_UNIT_OPTIONS,
    type VolumeInputUnit,
    type WeightInputUnit,
} from '@/lib/measurement';

type OrderItemForm = {
    customerProductRef: string;
    description: string;
    qtyKoli: number;
    weightInputValue: number;
    weightInputUnit: WeightInputUnit;
    volumeInputValue: number;
    volumeInputUnit: VolumeInputUnit;
    value: number;
};

const DEFAULT_ITEM: OrderItemForm = {
    customerProductRef: '',
    description: '',
    qtyKoli: 1,
    weightInputValue: 0,
    weightInputUnit: 'KG',
    volumeInputValue: 0,
    volumeInputUnit: 'M3',
    value: 0,
};

export default function NewOrderPage() {
    const router = useRouter();
    const { addToast } = useToast();
    const [customers, setCustomers] = useState<Customer[]>([]);
    const [customerProducts, setCustomerProducts] = useState<CustomerProduct[]>([]);
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
    const [items, setItems] = useState<OrderItemForm[]>([{ ...DEFAULT_ITEM }]);

    useEffect(() => {
        const fetchEntity = async <T,>(url: string) => {
            const res = await fetch(url);
            const payload = await res.json();
            if (!res.ok) {
                throw new Error(payload.error || 'Gagal memuat form order');
            }
            return payload.data as T;
        };

        Promise.all([
            fetchEntity<Customer[]>('/api/data?entity=customers'),
            fetchEntity<Service[]>('/api/data?entity=services'),
        ]).then(([customerRows, serviceRows]) => {
            setCustomers((customerRows || []).filter(customer => customer.active !== false));
            setServices((serviceRows || []).filter(service => service.active !== false));
        }).catch(error => {
            addToast('error', error instanceof Error ? error.message : 'Gagal memuat form order');
        });
    }, [addToast]);

    useEffect(() => {
        if (!customerRef) {
            setCustomerProducts([]);
            return;
        }

        let cancelled = false;
        const loadCustomerProducts = async () => {
            try {
                const res = await fetch(`/api/data?entity=customer-products&filter=${encodeURIComponent(JSON.stringify({ customerRef, active: true }))}`);
                const payload = await res.json();
                if (!res.ok) {
                    throw new Error(payload.error || 'Gagal memuat master barang customer');
                }
                if (!cancelled) {
                    setCustomerProducts(payload.data || []);
                }
            } catch (error) {
                if (!cancelled) {
                    setCustomerProducts([]);
                    addToast('error', error instanceof Error ? error.message : 'Gagal memuat master barang customer');
                }
            }
        };

        void loadCustomerProducts();
        return () => {
            cancelled = true;
        };
    }, [addToast, customerRef]);

    const addItem = () => setItems(prev => [...prev, { ...DEFAULT_ITEM }]);
    const removeItem = (idx: number) => setItems(prev => prev.filter((_, i) => i !== idx));
    const updateItem = <K extends keyof OrderItemForm>(idx: number, field: K, value: OrderItemForm[K]) => {
        setItems(prev => prev.map((item, i) => i === idx ? { ...item, [field]: value } : item));
    };
    const handleCustomerChange = (nextCustomerRef: string) => {
        const selectedCustomer = customers.find(customer => customer._id === nextCustomerRef);
        const previousCustomer = customers.find(customer => customer._id === customerRef);
        const previousCustomerAddress = previousCustomer?.address?.trim() || '';

        setCustomerRef(nextCustomerRef);
        setItems(prev => prev.map(item => (
            item.customerProductRef
                ? { ...DEFAULT_ITEM }
                : item
        )));
        setPickupAddress(previous => {
            const currentPickup = previous.trim();
            if (!currentPickup || (previousCustomerAddress && currentPickup === previousCustomerAddress)) {
                return selectedCustomer?.address || '';
            }
            return previous;
        });
    };

    const applyCustomerProductSelection = (idx: number, nextProductRef: string) => {
        const selectedProduct = customerProducts.find(product => product._id === nextProductRef);
        setItems(prev => prev.map((item, i) => {
            if (i !== idx) {
                return item;
            }
            if (!selectedProduct) {
                return { ...item, customerProductRef: '' };
            }
            return {
                ...item,
                customerProductRef: selectedProduct._id,
                description: selectedProduct.description || selectedProduct.name || item.description,
                qtyKoli: selectedProduct.defaultQtyKoli || item.qtyKoli || 1,
                weightInputValue: selectedProduct.defaultWeightInputValue || item.weightInputValue || 0,
                weightInputUnit: selectedProduct.defaultWeightInputUnit || item.weightInputUnit,
                volumeInputValue: selectedProduct.defaultVolumeInputValue || item.volumeInputValue || 0,
                volumeInputUnit: selectedProduct.defaultVolumeInputUnit || item.volumeInputUnit,
            };
        }));
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
        } finally {
            setLoading(false);
        }
    };

    return (
        <div>
            <div className="page-header">
                <div className="page-header-left">
                    <PageBackButton href="/orders" />
                    <h1 className="page-title">Buat Order Baru</h1>
                    <p className="page-subtitle">Isi data pengirim, penerima, dan item barang</p>
                </div>
            </div>

            <form onSubmit={handleSubmit}>
                <div className="detail-grid">
                    {/* Pengirim */}
                    <div className="card">
                        <div className="card-header"><span className="card-header-title">Data Pengirim</span></div>
                        <div className="card-body">
                            <div className="form-group">
                                <label className="form-label">Customer / Pengirim / Penagih <span className="required">*</span></label>
                                <select className="form-select" value={customerRef} onChange={e => handleCustomerChange(e.target.value)} required>
                                    <option value="">Pilih customer</option>
                                    {customers.filter(c => c.active !== false).map(c => <option key={c._id} value={c._id}>{c.name}</option>)}
                                </select>
                                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
                                    Ini adalah pihak pengirim atau perusahaan yang order jasa dan nantinya ditagih pada nota.
                                </div>
                            </div>
                            <div className="form-group">
                                <label className="form-label">Kategori Truk / Armada</label>
                                <select className="form-select" value={serviceRef} onChange={e => setServiceRef(e.target.value)}>
                                    <option value="">Pilih kategori armada</option>
                                    {services.filter(s => s.active !== false).map(s => <option key={s._id} value={s._id}>{s.code} - {s.name}</option>)}
                                </select>
                                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
                                    Pilih kategori armada yang diminta customer. Kendaraan saat membuat surat jalan akan difilter mengikuti kategori ini.
                                </div>
                            </div>
                            <div className="form-group">
                                <label className="form-label">Alamat Pickup (Opsional)</label>
                                <input className="form-input" value={pickupAddress} onChange={e => setPickupAddress(e.target.value)} placeholder="Alamat pengambilan barang" />
                                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
                                    Otomatis diisi dari alamat customer saat customer dipilih, tapi masih bisa kamu ubah bila titik pickup berbeda.
                                </div>
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
                            <div key={idx} style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 12, padding: 12, background: 'var(--color-gray-50)', borderRadius: 'var(--radius-md)' }}>
                                <div style={{ flex: '1 1 260px' }}>
                                    <label className="form-label">Barang Customer</label>
                                    <select
                                        className="form-select"
                                        value={item.customerProductRef}
                                        onChange={e => applyCustomerProductSelection(idx, e.target.value)}
                                        disabled={!customerRef}
                                    >
                                        <option value="">{customerRef ? 'Pilih dari master barang customer (opsional)' : 'Pilih customer dulu'}</option>
                                        {customerProducts.map(product => (
                                            <option key={product._id} value={product._id}>
                                                {product.code ? `${product.code} - ` : ''}{product.name}
                                            </option>
                                        ))}
                                    </select>
                                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
                                        {customerRef
                                            ? customerProducts.length > 0
                                                ? 'Pilih template barang customer agar deskripsi dan default muatan terisi otomatis. Tetap bisa diedit bila real lapangan berbeda.'
                                                : 'Customer ini belum punya master barang. Kamu tetap bisa isi item manual.'
                                            : 'Pilih customer dulu untuk menampilkan master barang per customer.'}
                                    </div>
                                </div>
                                <div style={{ flex: '2 1 280px' }}>
                                    <label className="form-label">Deskripsi</label>
                                    <input className="form-input" value={item.description} onChange={e => updateItem(idx, 'description', e.target.value)} placeholder="Nama/deskripsi barang" />
                                </div>
                                <div style={{ flex: '0 1 110px' }}>
                                    <label className="form-label">Koli</label>
                                    <input className="form-input" type="number" min={1} value={item.qtyKoli} onChange={e => updateItem(idx, 'qtyKoli', Number(e.target.value))} />
                                </div>
                                <div style={{ flex: '1 1 180px' }}>
                                    <label className="form-label">Berat</label>
                                    <div style={{ display: 'flex', gap: 8 }}>
                                        <input className="form-input" type="number" min={0} step="0.01" value={item.weightInputValue} onChange={e => updateItem(idx, 'weightInputValue', Number(e.target.value))} />
                                        <select className="form-select" value={item.weightInputUnit} onChange={e => updateItem(idx, 'weightInputUnit', e.target.value as WeightInputUnit)} style={{ width: 92 }}>
                                            {WEIGHT_INPUT_UNIT_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                                        </select>
                                    </div>
                                </div>
                                <div style={{ flex: '1 1 180px' }}>
                                    <label className="form-label">Volume</label>
                                    <div style={{ display: 'flex', gap: 8 }}>
                                        <input className="form-input" type="number" min={0} step="0.01" value={item.volumeInputValue} onChange={e => updateItem(idx, 'volumeInputValue', Number(e.target.value))} />
                                        <select className="form-select" value={item.volumeInputUnit} onChange={e => updateItem(idx, 'volumeInputUnit', e.target.value as VolumeInputUnit)} style={{ width: 92 }}>
                                            {VOLUME_INPUT_UNIT_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                                        </select>
                                    </div>
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
