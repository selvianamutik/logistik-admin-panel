'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useToast } from '../../../layout';
import { Plus, Save, X } from 'lucide-react';
import FormattedNumberInput from '@/components/FormattedNumberInput';
import PageBackButton from '@/components/PageBackButton';
import type { Order, Customer, CustomerProduct, Service, DeliveryOrder, OrderItem } from '@/lib/types';
import {
    convertKgToWeightInputValue,
    convertM3ToVolumeInputValue,
    VOLUME_INPUT_UNIT_OPTIONS,
    WEIGHT_INPUT_UNIT_OPTIONS,
    type VolumeInputUnit,
    type WeightInputUnit,
} from '@/lib/measurement';

type OrderItemForm = {
    id?: string;
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
    qtyKoli: 0,
    weightInputValue: 0,
    weightInputUnit: 'KG',
    volumeInputValue: 0,
    volumeInputUnit: 'M3',
    value: 0,
};

export default function OrderEditPage() {
    const params = useParams();
    const router = useRouter();
    const { addToast } = useToast();
    const orderId = params.id as string;
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [customers, setCustomers] = useState<Customer[]>([]);
    const [customerProducts, setCustomerProducts] = useState<CustomerProduct[]>([]);
    const [services, setServices] = useState<Service[]>([]);
    const [hasDeliveryOrders, setHasDeliveryOrders] = useState(false);
    const [hasOperationalProgress, setHasOperationalProgress] = useState(false);
    const [revisionReason, setRevisionReason] = useState('');
    const [form, setForm] = useState({
        customerRef: '', customerName: '',
        receiverName: '', receiverPhone: '', receiverAddress: '', receiverCompany: '',
        pickupAddress: '',
        serviceRef: '', serviceName: '',
        notes: ''
    });
    const [items, setItems] = useState<OrderItemForm[]>([{ ...DEFAULT_ITEM }]);

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
        const fetchEntity = async <T,>(url: string) => {
            const res = await fetch(url);
            const payload = await res.json();
            if (!res.ok) {
                throw new Error(payload.error || 'Gagal memuat form edit order');
            }
            return payload.data as T;
        };

        Promise.all([
            fetchEntity<Order | null>(`/api/data?entity=orders&id=${orderId}`),
            fetchEntity<Customer[]>('/api/data?entity=customers'),
            fetchEntity<Service[]>('/api/data?entity=services'),
            fetchEntity<DeliveryOrder[]>(`/api/data?entity=delivery-orders&filter=${encodeURIComponent(JSON.stringify({ orderRef: orderId }))}`),
            fetchEntity<OrderItem[]>(`/api/data?entity=order-items&filter=${encodeURIComponent(JSON.stringify({ orderRef: orderId }))}`),
        ]).then(([order, customerRows, serviceRows, deliveryOrders, orderItems]) => {
            if (order) {
                setForm({
                    customerRef: order.customerRef,
                    customerName: order.customerName || '',
                    receiverName: order.receiverName,
                    receiverPhone: order.receiverPhone,
                    receiverAddress: order.receiverAddress,
                    receiverCompany: order.receiverCompany || '',
                    pickupAddress: order.pickupAddress || '',
                    serviceRef: order.serviceRef,
                    serviceName: order.serviceName || '',
                    notes: order.notes || '',
                });
            }

            const mappedItems = (orderItems || []).map<OrderItemForm>(item => ({
                id: item._id,
                customerProductRef: item.customerProductRef || '',
                description: item.description || '',
                qtyKoli: typeof item.qtyKoli === 'number' ? item.qtyKoli : 0,
                weightInputValue:
                    typeof item.weightInputValue === 'number' && item.weightInputValue > 0
                        ? item.weightInputValue
                        : typeof item.weight === 'number' && item.weight > 0
                            ? convertKgToWeightInputValue(item.weight, item.weightInputUnit || 'KG')
                            : 0,
                weightInputUnit: item.weightInputUnit || 'KG',
                volumeInputValue:
                    typeof item.volumeInputValue === 'number' && item.volumeInputValue > 0
                        ? item.volumeInputValue
                        : typeof item.volume === 'number' && item.volume > 0
                            ? convertM3ToVolumeInputValue(item.volume, item.volumeInputUnit || 'M3')
                            : 0,
                volumeInputUnit: item.volumeInputUnit || 'M3',
                value: item.value || 0,
            }));

            setItems(mappedItems.length > 0 ? mappedItems : [{ ...DEFAULT_ITEM }]);
            setCustomers((customerRows || []).filter(customer => customer.active !== false || customer._id === order?.customerRef));
            setServices((serviceRows || []).filter(service => service.active !== false || service._id === order?.serviceRef));
            setHasDeliveryOrders((deliveryOrders || []).length > 0);
            setHasOperationalProgress((orderItems || []).some(item =>
                Number(item.deliveredQtyKoli || 0) > 0 ||
                Number(item.assignedQtyKoli || 0) > 0 ||
                Number(item.heldQtyKoli || 0) > 0 ||
                Number(item.deliveredWeight || 0) > 0 ||
                Number(item.assignedWeight || 0) > 0 ||
                Number(item.heldWeight || 0) > 0 ||
                Number(item.deliveredVolume || 0) > 0 ||
                Number(item.assignedVolume || 0) > 0 ||
                Number(item.heldVolume || 0) > 0
            ));
        }).catch(error => {
            addToast('error', error instanceof Error ? error.message : 'Gagal memuat form edit order');
        }).finally(() => {
            setLoading(false);
        });
    }, [addToast, orderId]);

    useEffect(() => {
        if (!form.customerRef) {
            setCustomerProducts([]);
            return;
        }

        let cancelled = false;
        const loadCustomerProducts = async () => {
            try {
                const res = await fetch(`/api/data?entity=customer-products&filter=${encodeURIComponent(JSON.stringify({ customerRef: form.customerRef, active: true }))}`);
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
    }, [addToast, form.customerRef]);

    const updateItem = <K extends keyof OrderItemForm>(idx: number, field: K, value: OrderItemForm[K]) => {
        setItems(prev => prev.map((item, i) => i === idx ? { ...item, [field]: value } : item));
    };

    const addItem = () => setItems(prev => [...prev, { ...DEFAULT_ITEM }]);
    const removeItem = (idx: number) => {
        setItems(prev => {
            const next = prev.filter((_, i) => i !== idx);
            return next.length > 0 ? next : [{ ...DEFAULT_ITEM }];
        });
    };

    const handleCustomerChange = (nextCustomerRef: string) => {
        const nextCustomer = customers.find(customer => customer._id === nextCustomerRef);
        setForm(prev => ({
            ...prev,
            customerRef: nextCustomerRef,
            customerName: nextCustomer?.name || '',
            pickupAddress: syncPickupAddressForCustomer(nextCustomerRef, prev),
        }));
        setItems(prev => prev.map(item => ({
            ...item,
            customerProductRef: '',
        })));
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

            const nextWeightUnit = selectedProduct.defaultWeightInputUnit || item.weightInputUnit || 'KG';
            const nextVolumeUnit = selectedProduct.defaultVolumeInputUnit || item.volumeInputUnit || 'M3';
            const nextWeightValue =
                typeof selectedProduct.defaultWeightInputValue === 'number' && selectedProduct.defaultWeightInputValue > 0
                    ? selectedProduct.defaultWeightInputValue
                    : typeof selectedProduct.defaultWeight === 'number' && selectedProduct.defaultWeight > 0
                        ? convertKgToWeightInputValue(selectedProduct.defaultWeight, nextWeightUnit)
                        : 0;
            const nextVolumeValue =
                typeof selectedProduct.defaultVolumeInputValue === 'number' && selectedProduct.defaultVolumeInputValue > 0
                    ? selectedProduct.defaultVolumeInputValue
                    : typeof selectedProduct.defaultVolume === 'number' && selectedProduct.defaultVolume > 0
                        ? convertM3ToVolumeInputValue(selectedProduct.defaultVolume, nextVolumeUnit)
                        : 0;

            return {
                ...item,
                customerProductRef: selectedProduct._id,
                description: selectedProduct.description || selectedProduct.name || item.description,
                qtyKoli: selectedProduct.defaultQtyKoli ?? item.qtyKoli ?? 0,
                weightInputValue: nextWeightValue,
                weightInputUnit: nextWeightUnit,
                volumeInputValue: nextVolumeValue,
                volumeInputUnit: nextVolumeUnit,
            };
        }));
    };

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        const isRevisionMode = hasDeliveryOrders || hasOperationalProgress;
        if (!form.receiverName || !form.receiverAddress) {
            addToast('error', 'Nama dan alamat penerima wajib');
            return;
        }

        const validItems = items.filter(item => item.description.trim() || item.customerProductRef);
        if (!isRevisionMode && validItems.length === 0) {
            addToast('error', 'Minimal 1 item order wajib diisi');
            return;
        }
        if (isRevisionMode && !revisionReason.trim()) {
            addToast('error', 'Alasan revisi order wajib diisi');
            return;
        }

        setSaving(true);
        try {
            const action = isRevisionMode ? 'revise-targets' : 'update-with-items';
            const payloadData = isRevisionMode
                ? {
                    id: orderId,
                    notes: form.notes,
                    revisionReason,
                    items: items.map(item => ({
                        id: item.id,
                        qtyKoli: item.qtyKoli,
                        weightInputValue: item.weightInputValue,
                        weightInputUnit: item.weightInputUnit,
                        volumeInputValue: item.volumeInputValue,
                        volumeInputUnit: item.volumeInputUnit,
                    })),
                }
                : { id: orderId, ...form, items: validItems };

            const res = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    entity: 'orders',
                    action,
                    data: payloadData,
                }),
            });
            const payload = await res.json();
            if (!res.ok) {
                throw new Error(payload.error || 'Gagal menyimpan perubahan order');
            }
            addToast('success', isRevisionMode ? 'Target order berhasil direvisi' : 'Order berhasil diperbarui');
            router.push(`/orders/${orderId}`);
        } catch (error) {
            addToast('error', error instanceof Error ? error.message : 'Gagal menyimpan');
        } finally {
            setSaving(false);
        }
    };

    if (loading) return <div><div className="skeleton skeleton-title" /><div className="skeleton skeleton-card" style={{ height: 300 }} /></div>;

    const isRevisionMode = hasDeliveryOrders || hasOperationalProgress;

    return (
        <div>
            <div className="page-header">
                <div className="page-header-left">
                    <PageBackButton href={`/orders/${orderId}`} />
                    <h1 className="page-title">{isRevisionMode ? 'Revisi Order / Resi' : 'Edit Order'}</h1>
                </div>
            </div>

            <form onSubmit={handleSave}>
                <div className="detail-grid">
                    <div className="card">
                        <div className="card-header"><span className="card-header-title">Informasi Order</span></div>
                        <div className="card-body">
                            {isRevisionMode && (
                                <div className="alert alert-warning" style={{ marginBottom: '1rem' }}>
                                    Order ini sudah punya progress operasional. Data utama dan identitas item tetap dikunci. Yang bisa direvisi di sini hanya target koli, berat, volume, dan catatan order agar histori trip yang sudah terjadi tidak ikut berubah diam-diam.
                                </div>
                            )}
                            <div className="form-group">
                                <label className="form-label">Customer / Pengirim / Penagih</label>
                                <select className="form-select" value={form.customerRef} onChange={e => handleCustomerChange(e.target.value)} disabled={isRevisionMode}>
                                    <option value="">Pilih Customer</option>
                                    {customers.map(c => <option key={c._id} value={c._id}>{c.name}</option>)}
                                </select>
                            </div>
                            <div className="form-group">
                                <label className="form-label">Kategori Truk / Armada</label>
                                <select className="form-select" value={form.serviceRef} onChange={e => {
                                    const svc = services.find(s => s._id === e.target.value);
                                    setForm(prev => ({ ...prev, serviceRef: e.target.value, serviceName: svc?.name || '' }));
                                }} disabled={isRevisionMode}>
                                    <option value="">Pilih kategori armada</option>
                                    {services.map(s => <option key={s._id} value={s._id}>{s.code} - {s.name}</option>)}
                                </select>
                            </div>
                            <div className="form-group">
                                <label className="form-label">Alamat Pickup</label>
                                <textarea className="form-textarea" rows={2} value={form.pickupAddress} onChange={e => setForm(prev => ({ ...prev, pickupAddress: e.target.value }))} disabled={isRevisionMode} />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Catatan</label>
                                <textarea className="form-textarea" rows={3} value={form.notes} onChange={e => setForm(prev => ({ ...prev, notes: e.target.value }))} />
                            </div>
                            {isRevisionMode && (
                                <div className="form-group">
                                    <label className="form-label">Alasan Revisi <span className="required">*</span></label>
                                    <textarea
                                        className="form-textarea"
                                        rows={3}
                                        value={revisionReason}
                                        onChange={e => setRevisionReason(e.target.value)}
                                        placeholder="Mis. hasil loading aktual berbeda, salah input target awal, atau hasil timbang final berubah"
                                    />
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="card">
                        <div className="card-header"><span className="card-header-title">Informasi Penerima</span></div>
                        <div className="card-body">
                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label">Nama Penerima <span className="required">*</span></label>
                                    <input className="form-input" value={form.receiverName} onChange={e => setForm(prev => ({ ...prev, receiverName: e.target.value }))} disabled={isRevisionMode} />
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Telepon</label>
                                    <input className="form-input" value={form.receiverPhone} onChange={e => setForm(prev => ({ ...prev, receiverPhone: e.target.value }))} disabled={isRevisionMode} />
                                </div>
                            </div>
                            <div className="form-group">
                                <label className="form-label">Perusahaan Penerima</label>
                                <input className="form-input" value={form.receiverCompany} onChange={e => setForm(prev => ({ ...prev, receiverCompany: e.target.value }))} disabled={isRevisionMode} />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Alamat Penerima <span className="required">*</span></label>
                                <textarea className="form-textarea" rows={3} value={form.receiverAddress} onChange={e => setForm(prev => ({ ...prev, receiverAddress: e.target.value }))} disabled={isRevisionMode} />
                            </div>
                        </div>
                    </div>
                </div>

                <div className="card mt-6">
                    <div className="card-header">
                        <span className="card-header-title">{isRevisionMode ? 'Target Item / Koli / Muatan' : 'Item / Koli'}</span>
                        <button type="button" className="btn btn-secondary btn-sm" onClick={addItem} disabled={isRevisionMode}>
                            <Plus size={14} /> Tambah Item
                        </button>
                    </div>
                    <div className="card-body">
                        {items.map((item, idx) => (
                            <div key={item.id || idx} style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 12, padding: 12, background: 'var(--color-gray-50)', borderRadius: 'var(--radius-md)' }}>
                                <div style={{ flex: '1 1 260px' }}>
                                    <label className="form-label">Barang Customer</label>
                                    <select
                                        className="form-select"
                                        value={item.customerProductRef}
                                        onChange={e => applyCustomerProductSelection(idx, e.target.value)}
                                        disabled={isRevisionMode || !form.customerRef}
                                    >
                                        <option value="">{form.customerRef ? 'Pilih dari master barang customer (opsional)' : 'Pilih customer dulu'}</option>
                                        {customerProducts.map(product => (
                                            <option key={product._id} value={product._id}>
                                                {product.code ? `${product.code} - ` : ''}{product.name}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                                <div style={{ flex: '2 1 280px' }}>
                                    <label className="form-label">Deskripsi</label>
                                    <input className="form-input" value={item.description} onChange={e => updateItem(idx, 'description', e.target.value)} placeholder="Nama/deskripsi barang" disabled={isRevisionMode} />
                                </div>
                                <div style={{ flex: '0 1 110px' }}>
                                    <label className="form-label">{isRevisionMode ? 'Target Koli (Opsional)' : 'Koli (Opsional)'}</label>
                                    <FormattedNumberInput min={0} allowDecimal={false} value={item.qtyKoli} onValueChange={value => updateItem(idx, 'qtyKoli', value)} disabled={false} />
                                </div>
                                <div style={{ flex: '1 1 180px' }}>
                                    <label className="form-label">{isRevisionMode ? 'Target Berat' : 'Berat'}</label>
                                    <div style={{ display: 'flex', gap: 8 }}>
                                        <FormattedNumberInput min={0} maxFractionDigits={item.weightInputUnit === 'TON' ? 3 : 2} value={item.weightInputValue} onValueChange={value => updateItem(idx, 'weightInputValue', value)} disabled={false} />
                                        <select className="form-select" value={item.weightInputUnit} onChange={e => updateItem(idx, 'weightInputUnit', e.target.value as WeightInputUnit)} style={{ width: 92 }} disabled={false}>
                                            {WEIGHT_INPUT_UNIT_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                                        </select>
                                    </div>
                                </div>
                                <div style={{ flex: '1 1 180px' }}>
                                    <label className="form-label">{isRevisionMode ? 'Target Volume' : 'Volume'}</label>
                                    <div style={{ display: 'flex', gap: 8 }}>
                                        <FormattedNumberInput min={0} maxFractionDigits={item.volumeInputUnit === 'LITER' ? 0 : 3} value={item.volumeInputValue} onValueChange={value => updateItem(idx, 'volumeInputValue', value)} disabled={false} />
                                        <select className="form-select" value={item.volumeInputUnit} onChange={e => updateItem(idx, 'volumeInputUnit', e.target.value as VolumeInputUnit)} style={{ width: 92 }} disabled={false}>
                                            {VOLUME_INPUT_UNIT_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                                        </select>
                                    </div>
                                </div>
                                {items.length > 1 && (
                                    <button type="button" className="btn btn-ghost btn-icon-only" onClick={() => removeItem(idx)} style={{ marginBottom: 4 }} disabled={isRevisionMode}>
                                        <X size={18} />
                                    </button>
                                )}
                            </div>
                        ))}
                    </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 24 }}>
                    <button type="button" className="btn btn-secondary" onClick={() => router.push(`/orders/${orderId}`)}>Batal</button>
                    <button type="submit" className="btn btn-primary" disabled={saving}><Save size={16} /> {saving ? 'Menyimpan...' : (isRevisionMode ? 'Simpan Revisi' : 'Simpan Perubahan')}</button>
                </div>
            </form>
        </div>
    );
}
