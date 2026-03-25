'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '../../layout';
import { Save, Plus, X } from 'lucide-react';
import FormattedNumberInput from '@/components/FormattedNumberInput';
import PageBackButton from '@/components/PageBackButton';
import { fetchAdminCollectionData } from '@/lib/api/admin-client';
import type { Customer, CustomerPickupLocation, CustomerProduct, CustomerRecipient, Service } from '@/lib/types';
import {
    applyCustomerPickupSnapshot,
    applyCustomerRecipientSnapshot,
    applyCustomerProductToOrderItem,
    createDefaultOrderItemForm,
    findDefaultCustomerPickup,
    findDefaultCustomerRecipient,
    getDraftOrderItems,
    resetCustomerScopedOrderItems,
    sortCustomerPickups,
    sortCustomerRecipients,
    summarizeDraftOrderCargo,
    type OrderItemForm,
} from '@/lib/order-create-page-support';
import {
    formatCargoSummary,
    VOLUME_INPUT_UNIT_OPTIONS,
    WEIGHT_INPUT_UNIT_OPTIONS,
    type VolumeInputUnit,
    type WeightInputUnit,
} from '@/lib/measurement';

export default function NewOrderPage() {
    const router = useRouter();
    const { addToast } = useToast();
    const [customers, setCustomers] = useState<Customer[]>([]);
    const [customerProducts, setCustomerProducts] = useState<CustomerProduct[]>([]);
    const [customerRecipients, setCustomerRecipients] = useState<CustomerRecipient[]>([]);
    const [customerPickups, setCustomerPickups] = useState<CustomerPickupLocation[]>([]);
    const [customerScopedMastersLoaded, setCustomerScopedMastersLoaded] = useState(false);
    const [services, setServices] = useState<Service[]>([]);
    const [loading, setLoading] = useState(false);

    // Form state
    const [customerRef, setCustomerRef] = useState('');
    const [customerRecipientRef, setCustomerRecipientRef] = useState('');
    const [shouldAutoApplyDefaultRecipient, setShouldAutoApplyDefaultRecipient] = useState(false);
    const [saveRecipientToMaster, setSaveRecipientToMaster] = useState(false);
    const [saveRecipientAsDefault, setSaveRecipientAsDefault] = useState(false);
    const [recipientMasterLabel, setRecipientMasterLabel] = useState('');
    const [customerPickupRef, setCustomerPickupRef] = useState('');
    const [shouldAutoApplyDefaultPickup, setShouldAutoApplyDefaultPickup] = useState(false);
    const [savePickupToMaster, setSavePickupToMaster] = useState(false);
    const [savePickupAsDefault, setSavePickupAsDefault] = useState(false);
    const [pickupMasterLabel, setPickupMasterLabel] = useState('');
    const [serviceRef, setServiceRef] = useState('');
    const [receiverName, setReceiverName] = useState('');
    const [receiverPhone, setReceiverPhone] = useState('');
    const [receiverAddress, setReceiverAddress] = useState('');
    const [receiverCompany, setReceiverCompany] = useState('');
    const [pickupAddress, setPickupAddress] = useState('');
    const [notes, setNotes] = useState('');
    const [items, setItems] = useState<OrderItemForm[]>([createDefaultOrderItemForm()]);

    const draftItems = getDraftOrderItems(items);
    const draftCargo = summarizeDraftOrderCargo(items);
    const selectedCustomer = customers.find(customer => customer._id === customerRef) || null;
    const selectedService = services.find(service => service._id === serviceRef) || null;
    const sortedCustomerRecipients = sortCustomerRecipients(customerRecipients);
    const sortedCustomerPickups = sortCustomerPickups(customerPickups);

    useEffect(() => {
        Promise.all([
            fetchAdminCollectionData<Customer[]>('/api/data?entity=customers', 'Gagal memuat form order'),
            fetchAdminCollectionData<Service[]>('/api/data?entity=services', 'Gagal memuat form order'),
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
            setCustomerRecipients([]);
            setCustomerPickups([]);
            setCustomerScopedMastersLoaded(false);
            return;
        }

        let cancelled = false;
        setCustomerScopedMastersLoaded(false);
        const loadCustomerScopedMasters = async () => {
            try {
                const [productRows, recipientRows, pickupRows] = await Promise.all([
                    fetchAdminCollectionData<CustomerProduct[]>(
                        `/api/data?entity=customer-products&filter=${encodeURIComponent(JSON.stringify({ customerRef, active: true }))}`,
                        'Gagal memuat master customer'
                    ),
                    fetchAdminCollectionData<CustomerRecipient[]>(
                        `/api/data?entity=customer-recipients&filter=${encodeURIComponent(JSON.stringify({ customerRef, active: true }))}`,
                        'Gagal memuat master customer'
                    ),
                    fetchAdminCollectionData<CustomerPickupLocation[]>(
                        `/api/data?entity=customer-pickups&filter=${encodeURIComponent(JSON.stringify({ customerRef, active: true }))}`,
                        'Gagal memuat master customer'
                    ),
                ]);
                if (!cancelled) {
                    setCustomerProducts(productRows || []);
                    setCustomerRecipients(recipientRows || []);
                    setCustomerPickups(pickupRows || []);
                    setCustomerScopedMastersLoaded(true);
                }
            } catch (error) {
                if (!cancelled) {
                    setCustomerProducts([]);
                    setCustomerRecipients([]);
                    setCustomerPickups([]);
                    setCustomerScopedMastersLoaded(true);
                    addToast('error', error instanceof Error ? error.message : 'Gagal memuat master customer');
                }
            }
        };

        void loadCustomerScopedMasters();
        return () => {
            cancelled = true;
        };
    }, [addToast, customerRef]);

    useEffect(() => {
        if (!customerScopedMastersLoaded || !shouldAutoApplyDefaultRecipient || !customerRef || customerRecipientRef) {
            return;
        }
        const defaultRecipient = findDefaultCustomerRecipient(customerRecipients);
        if (!defaultRecipient) {
            setShouldAutoApplyDefaultRecipient(false);
            return;
        }
        const snapshot = applyCustomerRecipientSnapshot(defaultRecipient);
        setCustomerRecipientRef(defaultRecipient._id);
        setReceiverName(snapshot.receiverName);
        setReceiverPhone(snapshot.receiverPhone);
        setReceiverAddress(snapshot.receiverAddress);
        setReceiverCompany(snapshot.receiverCompany);
        setSaveRecipientToMaster(false);
        setSaveRecipientAsDefault(false);
        setRecipientMasterLabel('');
        setShouldAutoApplyDefaultRecipient(false);
    }, [customerRecipientRef, customerRecipients, customerRef, customerScopedMastersLoaded, shouldAutoApplyDefaultRecipient]);

    useEffect(() => {
        if (!customerScopedMastersLoaded || !shouldAutoApplyDefaultPickup || !customerRef || customerPickupRef) {
            return;
        }
        const defaultPickup = findDefaultCustomerPickup(customerPickups);
        if (!defaultPickup) {
            setShouldAutoApplyDefaultPickup(false);
            return;
        }
        const snapshot = applyCustomerPickupSnapshot(defaultPickup);
        setCustomerPickupRef(defaultPickup._id);
        setPickupAddress(snapshot.pickupAddress);
        setSavePickupToMaster(false);
        setSavePickupAsDefault(false);
        setPickupMasterLabel('');
        setShouldAutoApplyDefaultPickup(false);
    }, [customerPickupRef, customerPickups, customerRef, customerScopedMastersLoaded, shouldAutoApplyDefaultPickup]);

    const addItem = () => setItems(prev => [...prev, createDefaultOrderItemForm()]);
    const removeItem = (idx: number) => setItems(prev => prev.filter((_, i) => i !== idx));
    const updateItem = <K extends keyof OrderItemForm>(idx: number, field: K, value: OrderItemForm[K]) => {
        setItems(prev => prev.map((item, i) => i === idx ? { ...item, [field]: value } : item));
    };
    const handleCustomerChange = (nextCustomerRef: string) => {
        const selectedCustomer = customers.find(customer => customer._id === nextCustomerRef);
        setCustomerRef(nextCustomerRef);
        setCustomerRecipientRef('');
        setCustomerPickupRef('');
        setShouldAutoApplyDefaultRecipient(Boolean(nextCustomerRef));
        setShouldAutoApplyDefaultPickup(Boolean(nextCustomerRef));
        setSaveRecipientToMaster(false);
        setSaveRecipientAsDefault(false);
        setRecipientMasterLabel('');
        setSavePickupToMaster(false);
        setSavePickupAsDefault(false);
        setPickupMasterLabel('');
        setItems(prev => resetCustomerScopedOrderItems(prev));
        setPickupAddress(selectedCustomer?.address || '');
        setReceiverName('');
        setReceiverPhone('');
        setReceiverAddress('');
        setReceiverCompany('');
    };

    const handleCustomerRecipientChange = (nextRecipientRef: string) => {
        setShouldAutoApplyDefaultRecipient(false);
        setCustomerRecipientRef(nextRecipientRef);
        const recipient = customerRecipients.find(item => item._id === nextRecipientRef);
        const snapshot = applyCustomerRecipientSnapshot(recipient);
        setReceiverName(snapshot.receiverName);
        setReceiverPhone(snapshot.receiverPhone);
        setReceiverAddress(snapshot.receiverAddress);
        setReceiverCompany(snapshot.receiverCompany);
        setSaveRecipientToMaster(false);
        setSaveRecipientAsDefault(false);
        setRecipientMasterLabel('');
    };

    const handleCustomerPickupChange = (nextPickupRef: string) => {
        setShouldAutoApplyDefaultPickup(false);
        setCustomerPickupRef(nextPickupRef);
        const pickup = customerPickups.find(item => item._id === nextPickupRef);
        const snapshot = applyCustomerPickupSnapshot(pickup);
        setPickupAddress(snapshot.pickupAddress);
        setSavePickupToMaster(false);
        setSavePickupAsDefault(false);
        setPickupMasterLabel('');
    };

    const updateReceiverField = (field: 'receiverName' | 'receiverPhone' | 'receiverAddress' | 'receiverCompany', value: string) => {
        setShouldAutoApplyDefaultRecipient(false);
        if (customerRecipientRef) {
            setCustomerRecipientRef('');
        }
        if (field === 'receiverName') setReceiverName(value);
        if (field === 'receiverPhone') setReceiverPhone(value);
        if (field === 'receiverAddress') setReceiverAddress(value);
        if (field === 'receiverCompany') setReceiverCompany(value);
    };

    const updatePickupAddress = (value: string) => {
        setShouldAutoApplyDefaultPickup(false);
        if (customerPickupRef) {
            setCustomerPickupRef('');
        }
        setPickupAddress(value);
    };

    const applyCustomerProductSelection = (idx: number, nextProductRef: string) => {
        const selectedProduct = customerProducts.find(product => product._id === nextProductRef);
        setItems(prev => prev.map((item, i) => {
            if (i !== idx) {
                return item;
            }
            return applyCustomerProductToOrderItem(item, selectedProduct);
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
            let recipientRefForSubmit = customerRecipientRef;
            if (saveRecipientToMaster && !recipientRefForSubmit) {
                if (!recipientMasterLabel.trim()) {
                    addToast('error', 'Label master penerima wajib diisi jika ingin disimpan ke master');
                    setLoading(false);
                    return;
                }
                const recipientRes = await fetch('/api/data', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        entity: 'customer-recipients',
                        data: {
                            customerRef,
                            label: recipientMasterLabel,
                            receiverName,
                            receiverPhone,
                            receiverAddress,
                            receiverCompany,
                            active: true,
                            isDefault: saveRecipientAsDefault,
                        },
                    }),
                });
                const recipientData = await recipientRes.json();
                if (!recipientRes.ok) {
                    addToast('error', recipientData.error || 'Gagal menyimpan master penerima');
                    setLoading(false);
                    return;
                }
                recipientRefForSubmit = recipientData.data?._id || recipientData.id || '';
            }
            let pickupRefForSubmit = customerPickupRef;
            if (savePickupToMaster && !pickupRefForSubmit) {
                if (!pickupMasterLabel.trim()) {
                    addToast('error', 'Label master pickup wajib diisi jika ingin disimpan ke master');
                    setLoading(false);
                    return;
                }
                const pickupRes = await fetch('/api/data', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        entity: 'customer-pickups',
                        data: {
                            customerRef,
                            label: pickupMasterLabel,
                            pickupAddress,
                            active: true,
                            isDefault: savePickupAsDefault,
                        },
                    }),
                });
                const pickupData = await pickupRes.json();
                if (!pickupRes.ok) {
                    addToast('error', pickupData.error || 'Gagal menyimpan master pickup');
                    setLoading(false);
                    return;
                }
                pickupRefForSubmit = pickupData.data?._id || pickupData.id || '';
            }

            const res = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    entity: 'orders',
                    action: 'create-with-items',
                    data: {
                        customerRef, customerName: selCustomer?.name || '',
                        customerRecipientRef: recipientRefForSubmit,
                        customerPickupRef: pickupRefForSubmit,
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
                </div>
            </div>

            <form onSubmit={handleSubmit}>
                <div className="kpi-grid" style={{ marginBottom: '1.5rem' }}>
                    <div className="kpi-card">
                        <div className="kpi-content">
                            <div className="kpi-label">Customer</div>
                            <div className="kpi-value" style={{ fontSize: '1rem' }}>{selectedCustomer?.name || 'Belum dipilih'}</div>
                        </div>
                    </div>
                    <div className="kpi-card">
                        <div className="kpi-content">
                            <div className="kpi-label">Kategori Armada</div>
                            <div className="kpi-value" style={{ fontSize: '1rem' }}>{selectedService?.name || 'Opsional'}</div>
                        </div>
                    </div>
                    <div className="kpi-card">
                        <div className="kpi-content">
                            <div className="kpi-label">Draft Barang</div>
                            <div className="kpi-value">{draftItems.length} item</div>
                        </div>
                    </div>
                    <div className="kpi-card">
                        <div className="kpi-content">
                            <div className="kpi-label">Muatan Draft</div>
                            <div className="kpi-value" style={{ fontSize: '0.95rem' }}>
                                {draftItems.length > 0 ? formatCargoSummary(draftCargo) : 'Belum diisi'}
                            </div>
                        </div>
                    </div>
                </div>

                <div className="detail-grid">
                    {/* Customer / Pengirim */}
                    <div className="card">
                        <div className="card-header"><span className="card-header-title">Customer / Pengirim</span></div>
                        <div className="card-body">
                            <div className="form-group">
                                <label className="form-label">Customer / Pengirim / Penagih <span className="required">*</span></label>
                                <select className="form-select" value={customerRef} onChange={e => handleCustomerChange(e.target.value)} required>
                                    <option value="">Pilih customer</option>
                                    {customers.filter(c => c.active !== false).map(c => <option key={c._id} value={c._id}>{c.name}</option>)}
                                </select>
                            </div>
                            <div className="form-group">
                                <label className="form-label">Kategori Truk / Armada</label>
                                <select className="form-select" value={serviceRef} onChange={e => setServiceRef(e.target.value)}>
                                    <option value="">Pilih kategori armada</option>
                                    {services.filter(s => s.active !== false).map(s => <option key={s._id} value={s._id}>{s.code} - {s.name}</option>)}
                                </select>
                            </div>
                            {customerRef && (
                                <div className="form-group">
                                    <label className="form-label">Lokasi Ambil</label>
                                    <select className="form-select" value={customerPickupRef} onChange={e => handleCustomerPickupChange(e.target.value)}>
                                        <option value="">{customerPickups.length > 0 ? 'Pilih dari lokasi ambil customer (opsional)' : 'Belum ada lokasi ambil customer'}</option>
                                        {sortedCustomerPickups.map(pickup => (
                                            <option key={pickup._id} value={pickup._id}>
                                                {pickup.isDefault ? '[Default] ' : ''}{pickup.label}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            )}
                            <div className="form-group">
                                <label className="form-label">Alamat Ambil (Opsional)</label>
                                <input className="form-input" value={pickupAddress} onChange={e => updatePickupAddress(e.target.value)} placeholder="Alamat pengambilan barang" />
                            </div>
                            {customerRef && !customerPickupRef && (
                                <div style={{ display: 'grid', gap: '0.75rem', padding: '0.85rem 1rem', border: '1px solid var(--color-gray-200)', borderRadius: '0.75rem', background: 'var(--color-gray-50)' }}>
                                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                        <input type="checkbox" checked={savePickupToMaster} onChange={e => setSavePickupToMaster(e.target.checked)} />
                                        <span>Simpan lokasi ambil ini ke customer</span>
                                    </label>
                                    {savePickupToMaster && (
                                        <>
                                            <div className="form-group" style={{ marginBottom: 0 }}>
                                                <label className="form-label">Label Lokasi Ambil <span className="required">*</span></label>
                                                <input className="form-input" value={pickupMasterLabel} onChange={e => setPickupMasterLabel(e.target.value)} placeholder="Contoh: Gudang Gresik / Pabrik Waru" />
                                            </div>
                                            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                <input type="checkbox" checked={savePickupAsDefault} onChange={e => setSavePickupAsDefault(e.target.checked)} />
                                                <span>Jadikan lokasi ambil default customer</span>
                                            </label>
                                        </>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Tujuan / Penerima */}
                    <div className="card">
                        <div className="card-header"><span className="card-header-title">Tujuan / Penerima</span></div>
                        <div className="card-body">
                            {customerRef && (
                                <div className="form-group">
                                    <label className="form-label">Tujuan / Penerima</label>
                                    <select className="form-select" value={customerRecipientRef} onChange={e => handleCustomerRecipientChange(e.target.value)}>
                                        <option value="">{customerRecipients.length > 0 ? 'Pilih dari tujuan customer (opsional)' : 'Belum ada tujuan customer'}</option>
                                        {sortedCustomerRecipients.map(recipient => (
                                            <option key={recipient._id} value={recipient._id}>
                                                {recipient.isDefault ? '[Default] ' : ''}{recipient.label} - {recipient.receiverName}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            )}
                            <div className="form-group">
                                <label className="form-label">Nama Penerima <span className="required">*</span></label>
                                <input className="form-input" value={receiverName} onChange={e => updateReceiverField('receiverName', e.target.value)} required />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Telepon</label>
                                <input className="form-input" value={receiverPhone} onChange={e => updateReceiverField('receiverPhone', e.target.value)} />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Alamat Tujuan <span className="required">*</span></label>
                                <textarea className="form-textarea" rows={2} value={receiverAddress} onChange={e => updateReceiverField('receiverAddress', e.target.value)} required />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Perusahaan (Opsional)</label>
                                <input className="form-input" value={receiverCompany} onChange={e => updateReceiverField('receiverCompany', e.target.value)} />
                            </div>
                            {customerRef && !customerRecipientRef && (
                                <div style={{ display: 'grid', gap: '0.75rem', padding: '0.85rem 1rem', border: '1px solid var(--color-gray-200)', borderRadius: '0.75rem', background: 'var(--color-gray-50)' }}>
                                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                        <input type="checkbox" checked={saveRecipientToMaster} onChange={e => setSaveRecipientToMaster(e.target.checked)} />
                                        <span>Simpan tujuan ini ke customer</span>
                                    </label>
                                    {saveRecipientToMaster && (
                                        <>
                                            <div className="form-group" style={{ marginBottom: 0 }}>
                                                <label className="form-label">Label Tujuan <span className="required">*</span></label>
                                                <input className="form-input" value={recipientMasterLabel} onChange={e => setRecipientMasterLabel(e.target.value)} placeholder="Contoh: Gudang Gresik / Toko Cabang Waru" />
                                            </div>
                                            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                <input type="checkbox" checked={saveRecipientAsDefault} onChange={e => setSaveRecipientAsDefault(e.target.checked)} />
                                                <span>Jadikan tujuan default customer</span>
                                            </label>
                                        </>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Items */}
                <div className="card mt-6">
                    <div className="card-header">
                        <span className="card-header-title">Barang yang Dikirim</span>
                        <button type="button" className="btn btn-secondary btn-sm" onClick={addItem}>
                            <Plus size={14} /> Tambah Item
                        </button>
                    </div>
                    <div className="card-body">
                        {items.map((item, idx) => (
                            <div key={idx} style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 12, padding: 12, background: 'var(--color-gray-50)', borderRadius: 'var(--radius-md)' }}>
                                {customerRef && customerProducts.length > 0 && (
                                    <div style={{ flex: '1 1 260px' }}>
                                        <label className="form-label">Barang Customer</label>
                                        <select
                                            className="form-select"
                                            value={item.customerProductRef}
                                            onChange={e => applyCustomerProductSelection(idx, e.target.value)}
                                        >
                                            <option value="">Pilih dari master barang customer (opsional)</option>
                                            {customerProducts.map(product => (
                                                <option key={product._id} value={product._id}>
                                                    {product.code ? `${product.code} - ` : ''}{product.name}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                )}
                                <div style={{ flex: '2 1 280px' }}>
                                    <label className="form-label">Deskripsi</label>
                                    <input className="form-input" value={item.description} onChange={e => updateItem(idx, 'description', e.target.value)} placeholder="Nama/deskripsi barang" />
                                </div>
                                <div style={{ flex: '0 1 110px' }}>
                                    <label className="form-label">Koli (Opsional)</label>
                                    <FormattedNumberInput
                                        min={0}
                                        allowDecimal={false}
                                        value={item.qtyKoli}
                                        onValueChange={value => updateItem(idx, 'qtyKoli', value)}
                                    />
                                </div>
                                <div style={{ flex: '1 1 180px' }}>
                                    <label className="form-label">Berat</label>
                                    <div style={{ display: 'flex', gap: 8 }}>
                                        <FormattedNumberInput
                                            min={0}
                                            maxFractionDigits={item.weightInputUnit === 'TON' ? 3 : 2}
                                            value={item.weightInputValue}
                                            onValueChange={value => updateItem(idx, 'weightInputValue', value)}
                                        />
                                        <select className="form-select" value={item.weightInputUnit} onChange={e => updateItem(idx, 'weightInputUnit', e.target.value as WeightInputUnit)} style={{ width: 92 }}>
                                            {WEIGHT_INPUT_UNIT_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                                        </select>
                                    </div>
                                </div>
                                <div style={{ flex: '1 1 180px' }}>
                                    <label className="form-label">Volume</label>
                                    <div style={{ display: 'flex', gap: 8 }}>
                                        <FormattedNumberInput
                                            min={0}
                                            maxFractionDigits={item.volumeInputUnit === 'LITER' ? 0 : 3}
                                            value={item.volumeInputValue}
                                            onValueChange={value => updateItem(idx, 'volumeInputValue', value)}
                                        />
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
