'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useToast } from '../../../layout';
import { Plus, Save, X } from 'lucide-react';
import FormattedNumberInput from '@/components/FormattedNumberInput';
import PageBackButton from '@/components/PageBackButton';
import { fetchAdminData } from '@/lib/api/admin-client';
import type { Order, Customer, CustomerPickupLocation, CustomerProduct, CustomerRecipient, Service, DeliveryOrder, OrderItem } from '@/lib/types';
import {
    formatCargoSummary,
    VOLUME_INPUT_UNIT_OPTIONS,
    WEIGHT_INPUT_UNIT_OPTIONS,
    type VolumeInputUnit,
    type WeightInputUnit,
} from '@/lib/measurement';
import {
    applyCustomerPickupSnapshot,
    applyCustomerRecipientSnapshot,
    applyCustomerProductToOrderItem,
    createDefaultOrderItemForm,
    findDefaultCustomerPickup,
    findDefaultCustomerRecipient,
    sortCustomerPickups,
    sortCustomerRecipients,
    type OrderItemForm,
} from '@/lib/order-create-page-support';
import {
    buildOrderEditForm,
    getOrderEditItems,
    hasOrderItemOperationalProgress,
    resolvePickupAddressForCustomer,
    summarizeOrderEditTargetCargo,
    type OrderEditFormState,
} from '@/lib/order-edit-page-support';

export default function OrderEditPage() {
    const params = useParams();
    const router = useRouter();
    const { addToast } = useToast();
    const orderId = params.id as string;
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [customers, setCustomers] = useState<Customer[]>([]);
    const [customerProducts, setCustomerProducts] = useState<CustomerProduct[]>([]);
    const [customerRecipients, setCustomerRecipients] = useState<CustomerRecipient[]>([]);
    const [customerPickups, setCustomerPickups] = useState<CustomerPickupLocation[]>([]);
    const [services, setServices] = useState<Service[]>([]);
    const [hasDeliveryOrders, setHasDeliveryOrders] = useState(false);
    const [hasOperationalProgress, setHasOperationalProgress] = useState(false);
    const [shouldAutoApplyDefaultRecipient, setShouldAutoApplyDefaultRecipient] = useState(false);
    const [shouldAutoApplyDefaultPickup, setShouldAutoApplyDefaultPickup] = useState(false);
    const [revisionReason, setRevisionReason] = useState('');
    const [form, setForm] = useState<OrderEditFormState>(buildOrderEditForm(null));
    const [items, setItems] = useState<OrderItemForm[]>([createDefaultOrderItemForm()]);

    useEffect(() => {
        Promise.all([
            fetchAdminData<Order | null>(`/api/data?entity=orders&id=${orderId}`, 'Gagal memuat form edit order'),
            fetchAdminData<Customer[]>('/api/data?entity=customers', 'Gagal memuat form edit order'),
            fetchAdminData<Service[]>('/api/data?entity=services', 'Gagal memuat form edit order'),
            fetchAdminData<DeliveryOrder[]>(`/api/data?entity=delivery-orders&filter=${encodeURIComponent(JSON.stringify({ orderRef: orderId }))}`, 'Gagal memuat form edit order'),
            fetchAdminData<OrderItem[]>(`/api/data?entity=order-items&filter=${encodeURIComponent(JSON.stringify({ orderRef: orderId }))}`, 'Gagal memuat form edit order'),
        ]).then(([order, customerRows, serviceRows, deliveryOrders, orderItems]) => {
            setForm(buildOrderEditForm(order));
            setItems(getOrderEditItems(orderItems || []));
            setCustomers((customerRows || []).filter(customer => customer.active !== false || customer._id === order?.customerRef));
            setServices((serviceRows || []).filter(service => service.active !== false || service._id === order?.serviceRef));
            setHasDeliveryOrders((deliveryOrders || []).length > 0);
            setHasOperationalProgress(hasOrderItemOperationalProgress(orderItems || []));
        }).catch(error => {
            addToast('error', error instanceof Error ? error.message : 'Gagal memuat form edit order');
        }).finally(() => {
            setLoading(false);
        });
    }, [addToast, orderId]);

    useEffect(() => {
        if (!form.customerRef) {
            setCustomerProducts([]);
            setCustomerRecipients([]);
            setCustomerPickups([]);
            return;
        }

        let cancelled = false;
        const loadCustomerScopedMasters = async () => {
            try {
                const [products, recipients, pickups] = await Promise.all([
                    fetchAdminData<CustomerProduct[]>(
                        `/api/data?entity=customer-products&filter=${encodeURIComponent(JSON.stringify({ customerRef: form.customerRef, active: true }))}`,
                        'Gagal memuat master customer'
                    ),
                    fetchAdminData<CustomerRecipient[]>(
                        `/api/data?entity=customer-recipients&filter=${encodeURIComponent(JSON.stringify({ customerRef: form.customerRef, active: true }))}`,
                        'Gagal memuat master customer'
                    ),
                    fetchAdminData<CustomerPickupLocation[]>(
                        `/api/data?entity=customer-pickups&filter=${encodeURIComponent(JSON.stringify({ customerRef: form.customerRef, active: true }))}`,
                        'Gagal memuat master customer'
                    ),
                ]);
                if (!cancelled) {
                    setCustomerProducts(products || []);
                    setCustomerRecipients(recipients || []);
                    setCustomerPickups(pickups || []);
                }
            } catch (error) {
                if (!cancelled) {
                    setCustomerProducts([]);
                    setCustomerRecipients([]);
                    setCustomerPickups([]);
                    addToast('error', error instanceof Error ? error.message : 'Gagal memuat master customer');
                }
            }
        };

        void loadCustomerScopedMasters();
        return () => {
            cancelled = true;
        };
    }, [addToast, form.customerRef]);

    useEffect(() => {
        if (!shouldAutoApplyDefaultRecipient || !form.customerRef || form.customerRecipientRef) {
            return;
        }
        const defaultRecipient = findDefaultCustomerRecipient(customerRecipients);
        if (!defaultRecipient) {
            setShouldAutoApplyDefaultRecipient(false);
            return;
        }
        const snapshot = applyCustomerRecipientSnapshot(defaultRecipient);
        setForm(prev => ({
            ...prev,
            customerRecipientRef: defaultRecipient._id,
            receiverName: snapshot.receiverName,
            receiverPhone: snapshot.receiverPhone,
            receiverAddress: snapshot.receiverAddress,
            receiverCompany: snapshot.receiverCompany,
            saveRecipientToMaster: false,
            saveRecipientAsDefault: false,
            recipientMasterLabel: '',
        }));
        setShouldAutoApplyDefaultRecipient(false);
    }, [customerRecipients, form.customerRecipientRef, form.customerRef, shouldAutoApplyDefaultRecipient]);

    useEffect(() => {
        if (!shouldAutoApplyDefaultPickup || !form.customerRef || form.customerPickupRef) {
            return;
        }
        const defaultPickup = findDefaultCustomerPickup(customerPickups);
        if (!defaultPickup) {
            setShouldAutoApplyDefaultPickup(false);
            return;
        }
        const snapshot = applyCustomerPickupSnapshot(defaultPickup);
        setForm(prev => ({
            ...prev,
            customerPickupRef: defaultPickup._id,
            pickupAddress: snapshot.pickupAddress,
            savePickupToMaster: false,
            savePickupAsDefault: false,
            pickupMasterLabel: '',
        }));
        setShouldAutoApplyDefaultPickup(false);
    }, [customerPickups, form.customerPickupRef, form.customerRef, shouldAutoApplyDefaultPickup]);

    const updateItem = <K extends keyof OrderItemForm>(idx: number, field: K, value: OrderItemForm[K]) => {
        setItems(prev => prev.map((item, i) => i === idx ? { ...item, [field]: value } : item));
    };

    const addItem = () => setItems(prev => [...prev, createDefaultOrderItemForm()]);
    const removeItem = (idx: number) => {
        setItems(prev => {
            const next = prev.filter((_, i) => i !== idx);
            return next.length > 0 ? next : [createDefaultOrderItemForm()];
        });
    };

    const handleCustomerChange = (nextCustomerRef: string) => {
        const nextCustomer = customers.find(customer => customer._id === nextCustomerRef);
        setForm(prev => ({
            ...prev,
            customerRef: nextCustomerRef,
            customerName: nextCustomer?.name || '',
            customerRecipientRef: '',
            customerPickupRef: '',
            pickupAddress: resolvePickupAddressForCustomer({
                nextCustomerRef,
                previousCustomerRef: prev.customerRef,
                previousPickupAddress: prev.pickupAddress,
                customers,
            }),
            receiverName: '',
            receiverPhone: '',
            receiverAddress: '',
            receiverCompany: '',
            savePickupToMaster: false,
            savePickupAsDefault: false,
            pickupMasterLabel: '',
            saveRecipientToMaster: false,
            saveRecipientAsDefault: false,
            recipientMasterLabel: '',
        }));
        setShouldAutoApplyDefaultRecipient(Boolean(nextCustomerRef));
        setShouldAutoApplyDefaultPickup(Boolean(nextCustomerRef));
        setItems(prev => prev.map(item => ({
            ...item,
            customerProductRef: '',
        })));
    };

    const handleCustomerRecipientChange = (nextRecipientRef: string) => {
        setShouldAutoApplyDefaultRecipient(false);
        const recipient = customerRecipients.find(item => item._id === nextRecipientRef);
        const snapshot = applyCustomerRecipientSnapshot(recipient);
        setForm(prev => ({
            ...prev,
            customerRecipientRef: nextRecipientRef,
            receiverName: snapshot.receiverName,
            receiverPhone: snapshot.receiverPhone,
            receiverAddress: snapshot.receiverAddress,
            receiverCompany: snapshot.receiverCompany,
            saveRecipientToMaster: false,
            saveRecipientAsDefault: false,
            recipientMasterLabel: '',
        }));
    };

    const handleCustomerPickupChange = (nextPickupRef: string) => {
        setShouldAutoApplyDefaultPickup(false);
        const pickup = customerPickups.find(item => item._id === nextPickupRef);
        const snapshot = applyCustomerPickupSnapshot(pickup);
        setForm(prev => ({
            ...prev,
            customerPickupRef: nextPickupRef,
            pickupAddress: snapshot.pickupAddress,
            savePickupToMaster: false,
            savePickupAsDefault: false,
            pickupMasterLabel: '',
        }));
    };

    const updateReceiverField = (field: 'receiverName' | 'receiverPhone' | 'receiverAddress' | 'receiverCompany', value: string) => {
        setShouldAutoApplyDefaultRecipient(false);
        setForm(prev => ({
            ...prev,
            customerRecipientRef: prev.customerRecipientRef ? '' : prev.customerRecipientRef,
            [field]: value,
        }));
    };

    const updatePickupAddress = (value: string) => {
        setShouldAutoApplyDefaultPickup(false);
        setForm(prev => ({
            ...prev,
            customerPickupRef: prev.customerPickupRef ? '' : prev.customerPickupRef,
            pickupAddress: value,
        }));
    };

    const applyCustomerProductSelection = (idx: number, nextProductRef: string) => {
        const selectedProduct = customerProducts.find(product => product._id === nextProductRef);
        setItems(prev => prev.map((item, i) => (
            i === idx ? applyCustomerProductToOrderItem(item, selectedProduct) : item
        )));
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
            let recipientRefForSubmit = form.customerRecipientRef;
            if (!isRevisionMode && form.saveRecipientToMaster && !recipientRefForSubmit) {
                if (!form.recipientMasterLabel.trim()) {
                    addToast('error', 'Label master penerima wajib diisi jika ingin disimpan ke master');
                    setSaving(false);
                    return;
                }
                const recipientRes = await fetch('/api/data', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        entity: 'customer-recipients',
                        data: {
                            customerRef: form.customerRef,
                            label: form.recipientMasterLabel,
                            receiverName: form.receiverName,
                            receiverPhone: form.receiverPhone,
                            receiverAddress: form.receiverAddress,
                            receiverCompany: form.receiverCompany,
                            active: true,
                            isDefault: form.saveRecipientAsDefault,
                        },
                    }),
                });
                const recipientPayload = await recipientRes.json();
                if (!recipientRes.ok) {
                    throw new Error(recipientPayload.error || 'Gagal menyimpan master penerima');
                }
                recipientRefForSubmit = recipientPayload.data?._id || recipientPayload.id || '';
            }
            let pickupRefForSubmit = form.customerPickupRef;
            if (!isRevisionMode && form.savePickupToMaster && !pickupRefForSubmit) {
                if (!form.pickupMasterLabel.trim()) {
                    addToast('error', 'Label master pickup wajib diisi jika ingin disimpan ke master');
                    setSaving(false);
                    return;
                }
                const pickupRes = await fetch('/api/data', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        entity: 'customer-pickups',
                        data: {
                            customerRef: form.customerRef,
                            label: form.pickupMasterLabel,
                            pickupAddress: form.pickupAddress,
                            active: true,
                            isDefault: form.savePickupAsDefault,
                        },
                    }),
                });
                const pickupPayload = await pickupRes.json();
                if (!pickupRes.ok) {
                    throw new Error(pickupPayload.error || 'Gagal menyimpan master pickup');
                }
                pickupRefForSubmit = pickupPayload.data?._id || pickupPayload.id || '';
            }
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
                : { id: orderId, ...form, customerRecipientRef: recipientRefForSubmit, customerPickupRef: pickupRefForSubmit, items: validItems };

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
    const targetCargo = summarizeOrderEditTargetCargo(items);
    const selectedCustomer = customers.find(customer => customer._id === form.customerRef) || null;
    const selectedService = services.find(service => service._id === form.serviceRef) || null;
    const sortedCustomerRecipients = sortCustomerRecipients(customerRecipients);
    const sortedCustomerPickups = sortCustomerPickups(customerPickups);

    return (
        <div>
            <div className="page-header">
                <div className="page-header-left">
                    <PageBackButton href={`/orders/${orderId}`} />
                    <h1 className="page-title">{isRevisionMode ? 'Revisi Order / Resi' : 'Edit Order'}</h1>
                </div>
            </div>

            <div style={{ background: isRevisionMode ? 'rgba(245, 158, 11, 0.08)' : 'var(--color-gray-50)', borderRadius: '0.75rem', padding: '1rem 1.1rem', border: isRevisionMode ? '1px solid rgba(245, 158, 11, 0.35)' : '1px solid var(--color-gray-200)', marginBottom: 'var(--space-6)' }}>
                <div style={{ fontWeight: 600, marginBottom: '0.35rem', color: isRevisionMode ? '#92400e' : 'inherit' }}>
                    {isRevisionMode ? 'Mode revisi target order' : 'Mode edit order biasa'}
                </div>
            </div>

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
                        <div className="kpi-label">Item</div>
                        <div className="kpi-value">{items.length} item</div>
                    </div>
                </div>
                <div className="kpi-card">
                    <div className="kpi-content">
                        <div className="kpi-label">{isRevisionMode ? 'Target Revisi' : 'Muatan Target'}</div>
                        <div className="kpi-value" style={{ fontSize: '0.95rem' }}>{formatCargoSummary(targetCargo)}</div>
                    </div>
                </div>
            </div>

            <form onSubmit={handleSave}>
                <div className="detail-grid">
                    <div className="card">
                        <div className="card-header"><span className="card-header-title">Customer / Pengirim</span></div>
                        <div className="card-body">
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
                                <label className="form-label">Lokasi Ambil</label>
                                <select className="form-select" value={form.customerPickupRef} onChange={e => handleCustomerPickupChange(e.target.value)} disabled={isRevisionMode || !form.customerRef}>
                                    <option value="">{form.customerRef ? (customerPickups.length > 0 ? 'Pilih dari lokasi ambil customer (opsional)' : 'Belum ada lokasi ambil customer') : 'Pilih customer dulu'}</option>
                                    {sortedCustomerPickups.map(pickup => (
                                        <option key={pickup._id} value={pickup._id}>
                                            {pickup.isDefault ? '[Default] ' : ''}{pickup.label}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div className="form-group">
                                <label className="form-label">Alamat Ambil</label>
                                <textarea className="form-textarea" rows={2} value={form.pickupAddress} onChange={e => updatePickupAddress(e.target.value)} disabled={isRevisionMode} />
                            </div>
                            {!isRevisionMode && form.customerRef && !form.customerPickupRef && (
                                <div style={{ display: 'grid', gap: '0.75rem', padding: '0.85rem 1rem', border: '1px solid var(--color-gray-200)', borderRadius: '0.75rem', background: 'var(--color-gray-50)' }}>
                                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                        <input
                                            type="checkbox"
                                            checked={form.savePickupToMaster}
                                            onChange={e => setForm(prev => ({ ...prev, savePickupToMaster: e.target.checked }))}
                                        />
                                        <span>Simpan lokasi ambil ini ke customer</span>
                                    </label>
                                    {form.savePickupToMaster && (
                                        <>
                                            <div className="form-group" style={{ marginBottom: 0 }}>
                                                <label className="form-label">Label Lokasi Ambil <span className="required">*</span></label>
                                                <input
                                                    className="form-input"
                                                    value={form.pickupMasterLabel}
                                                    onChange={e => setForm(prev => ({ ...prev, pickupMasterLabel: e.target.value }))}
                                                    placeholder="Contoh: Gudang Gresik / Pabrik Waru"
                                                />
                                            </div>
                                            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                <input
                                                    type="checkbox"
                                                    checked={form.savePickupAsDefault}
                                                    onChange={e => setForm(prev => ({ ...prev, savePickupAsDefault: e.target.checked }))}
                                                />
                                                <span>Jadikan lokasi ambil default customer</span>
                                            </label>
                                        </>
                                    )}
                                </div>
                            )}
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
                        <div className="card-header"><span className="card-header-title">Tujuan / Penerima</span></div>
                        <div className="card-body">
                            <div className="form-group">
                                <label className="form-label">Tujuan / Penerima</label>
                                <select
                                    className="form-select"
                                    value={form.customerRecipientRef}
                                    onChange={e => handleCustomerRecipientChange(e.target.value)}
                                    disabled={isRevisionMode || !form.customerRef}
                                >
                                    <option value="">
                                        {form.customerRef
                                            ? (customerRecipients.length > 0 ? 'Pilih dari tujuan customer (opsional)' : 'Belum ada tujuan customer')
                                            : 'Pilih customer dulu'}
                                    </option>
                                    {sortedCustomerRecipients.map(recipient => (
                                        <option key={recipient._id} value={recipient._id}>
                                            {recipient.isDefault ? '[Default] ' : ''}{recipient.label} - {recipient.receiverName}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label">Nama Penerima <span className="required">*</span></label>
                                    <input className="form-input" value={form.receiverName} onChange={e => updateReceiverField('receiverName', e.target.value)} disabled={isRevisionMode} />
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Telepon</label>
                                    <input className="form-input" value={form.receiverPhone} onChange={e => updateReceiverField('receiverPhone', e.target.value)} disabled={isRevisionMode} />
                                </div>
                            </div>
                            <div className="form-group">
                                <label className="form-label">Perusahaan Penerima</label>
                                <input className="form-input" value={form.receiverCompany} onChange={e => updateReceiverField('receiverCompany', e.target.value)} disabled={isRevisionMode} />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Alamat Penerima <span className="required">*</span></label>
                                <textarea className="form-textarea" rows={3} value={form.receiverAddress} onChange={e => updateReceiverField('receiverAddress', e.target.value)} disabled={isRevisionMode} />
                            </div>
                            {!isRevisionMode && form.customerRef && !form.customerRecipientRef && (
                                <div style={{ display: 'grid', gap: '0.75rem', padding: '0.85rem 1rem', border: '1px solid var(--color-gray-200)', borderRadius: '0.75rem', background: 'var(--color-gray-50)' }}>
                                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                        <input
                                            type="checkbox"
                                            checked={form.saveRecipientToMaster}
                                            onChange={e => setForm(prev => ({ ...prev, saveRecipientToMaster: e.target.checked }))}
                                        />
                                        <span>Simpan tujuan ini ke customer</span>
                                    </label>
                                    {form.saveRecipientToMaster && (
                                        <>
                                            <div className="form-group" style={{ marginBottom: 0 }}>
                                                <label className="form-label">Label Tujuan <span className="required">*</span></label>
                                                <input
                                                    className="form-input"
                                                    value={form.recipientMasterLabel}
                                                    onChange={e => setForm(prev => ({ ...prev, recipientMasterLabel: e.target.value }))}
                                                    placeholder="Contoh: Gudang Gresik / Toko Cabang Waru"
                                                />
                                            </div>
                                            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                <input
                                                    type="checkbox"
                                                    checked={form.saveRecipientAsDefault}
                                                    onChange={e => setForm(prev => ({ ...prev, saveRecipientAsDefault: e.target.checked }))}
                                                />
                                                <span>Jadikan tujuan default customer</span>
                                            </label>
                                        </>
                                    )}
                                </div>
                            )}
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
                        <div style={{ background: 'var(--color-gray-50)', borderRadius: '0.5rem', padding: '0.75rem 1rem', marginBottom: '1rem', fontSize: '0.8rem', color: 'var(--color-gray-600)' }}>
                            {isRevisionMode
                                ? 'Di mode revisi, nama barang dan master barang customer tetap mengikuti histori awal. Yang kamu koreksi di sini hanya target koli, berat, dan volume.'
                                : 'Gunakan master barang customer kalau tersedia supaya deskripsi dan muatan default terisi otomatis.'}
                        </div>
                        {items.map((item, idx) => (
                            <div key={item.id || idx} style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 12, padding: 12, background: 'var(--color-gray-50)', borderRadius: 'var(--radius-md)' }}>
                                {isRevisionMode ? (
                                    <div style={{ flex: '2 1 320px', display: 'grid', gap: '0.35rem' }}>
                                        <label className="form-label">Item</label>
                                        <div style={{ border: '1px solid var(--color-gray-200)', borderRadius: '0.65rem', padding: '0.8rem 0.9rem', background: 'var(--color-white)' }}>
                                            <div className="font-medium">{item.description || '-'}</div>
                                            <div className="text-muted text-sm">
                                                {item.customerProductRef
                                                    ? `Master barang customer terhubung dan identitas item dikunci saat revisi.`
                                                    : 'Item ini tidak memakai master barang customer. Deskripsi tetap dikunci saat revisi.'}
                                            </div>
                                        </div>
                                    </div>
                                ) : (
                                    <>
                                        <div style={{ flex: '1 1 260px' }}>
                                            <label className="form-label">Barang Customer</label>
                                            <select
                                                className="form-select"
                                                value={item.customerProductRef}
                                                onChange={e => applyCustomerProductSelection(idx, e.target.value)}
                                                disabled={!form.customerRef}
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
                                            <input className="form-input" value={item.description} onChange={e => updateItem(idx, 'description', e.target.value)} placeholder="Nama/deskripsi barang" />
                                        </div>
                                    </>
                                )}
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
