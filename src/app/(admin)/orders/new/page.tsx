'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '../../layout';
import { Save } from 'lucide-react';
import PageBackButton from '@/components/PageBackButton';
import { fetchAdminCollectionData } from '@/lib/api/admin-client';
import { buildServiceCapacityRangeMap } from '@/lib/service-capacity-support';
import type { Customer, CustomerPickupLocation, CustomerRecipient, Service, Vehicle } from '@/lib/types';
import {
    applyCustomerPickupSnapshot,
    applyCustomerRecipientSnapshot,
    findDefaultCustomerPickup,
    findDefaultCustomerRecipient,
    sortCustomerPickups,
    sortCustomerRecipients,
} from '@/lib/order-create-page-support';

export default function NewOrderPage() {
    const router = useRouter();
    const { addToast } = useToast();
    const [customers, setCustomers] = useState<Customer[]>([]);
    const [customerRecipients, setCustomerRecipients] = useState<CustomerRecipient[]>([]);
    const [customerPickups, setCustomerPickups] = useState<CustomerPickupLocation[]>([]);
    const [customerScopedMastersLoaded, setCustomerScopedMastersLoaded] = useState(false);
    const [services, setServices] = useState<Service[]>([]);
    const [vehicles, setVehicles] = useState<Array<Pick<Vehicle, '_id' | 'serviceRef' | 'capacityMin' | 'capacityMax' | 'capacityKg'>>>([]);
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
    const selectedCustomer = customers.find(customer => customer._id === customerRef) || null;
    const selectedService = services.find(service => service._id === serviceRef) || null;
    const sortedCustomerRecipients = sortCustomerRecipients(customerRecipients);
    const sortedCustomerPickups = sortCustomerPickups(customerPickups);
    const serviceCapacityRangeMap = buildServiceCapacityRangeMap(services, vehicles);
    const selectedServiceCapacityLabel = selectedService ? serviceCapacityRangeMap[selectedService._id] || 'Kapasitas belum diisi' : 'Belum dipilih';

    useEffect(() => {
        Promise.all([
            fetchAdminCollectionData<Customer[]>('/api/data?entity=customers', 'Gagal memuat form order'),
            fetchAdminCollectionData<Service[]>('/api/data?entity=services', 'Gagal memuat form order'),
            fetchAdminCollectionData<Array<Pick<Vehicle, '_id' | 'serviceRef' | 'capacityMin' | 'capacityMax' | 'capacityKg'>>>(
                `/api/data?entity=vehicles&filter=${encodeURIComponent(JSON.stringify({ status: ['ACTIVE', 'IN_SERVICE'] }))}`,
                'Gagal memuat form order'
            ),
        ]).then(([customerRows, serviceRows, vehicleRows]) => {
            setCustomers((customerRows || []).filter(customer => customer.active !== false));
            setServices((serviceRows || []).filter(service => service.active !== false));
            setVehicles(vehicleRows || []);
        }).catch(error => {
            addToast('error', error instanceof Error ? error.message : 'Gagal memuat form order');
        });
    }, [addToast]);

    useEffect(() => {
        if (!customerRef) {
            setCustomerRecipients([]);
            setCustomerPickups([]);
            setCustomerScopedMastersLoaded(false);
            return;
        }

        let cancelled = false;
        setCustomerScopedMastersLoaded(false);
        const loadCustomerScopedMasters = async () => {
            try {
                const [recipientRows, pickupRows] = await Promise.all([
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
                    setCustomerRecipients(recipientRows || []);
                    setCustomerPickups(pickupRows || []);
                    setCustomerScopedMastersLoaded(true);
                }
            } catch (error) {
                if (!cancelled) {
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

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!customerRef || !receiverName || !receiverAddress) {
            addToast('error', 'Mohon lengkapi data wajib');
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
                        items: [],
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
                            <div className="text-muted text-sm" style={{ marginTop: '0.25rem' }}>{selectedServiceCapacityLabel}</div>
                        </div>
                    </div>
                    <div className="kpi-card">
                        <div className="kpi-content">
                            <div className="kpi-label">Tujuan</div>
                            <div className="kpi-value" style={{ fontSize: '1rem' }}>{receiverName || 'Belum diisi'}</div>
                        </div>
                    </div>
                    <div className="kpi-card">
                        <div className="kpi-content">
                            <div className="kpi-label">Input Barang</div>
                            <div className="kpi-value" style={{ fontSize: '0.95rem' }}>
                                Di Surat Jalan
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
                                    {services.filter(s => s.active !== false).map(service => (
                                        <option key={service._id} value={service._id}>
                                            {service.code} - {service.name} ({serviceCapacityRangeMap[service._id] || 'Kapasitas belum diisi'})
                                        </option>
                                    ))}
                                </select>
                                <div className="text-muted text-sm" style={{ marginTop: '0.35rem' }}>
                                    {selectedService
                                        ? `Kategori ${selectedService.name} memuat kisaran ${selectedServiceCapacityLabel}.`
                                        : 'Pilih kategori armada untuk melihat kisaran muatan per layanan.'}
                                </div>
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

                <div className="card mt-6">
                    <div className="card-header">
                        <span className="card-header-title">Workflow Barang & Armada</span>
                    </div>
                    <div className="card-body">
                        <div className="info-banner">
                            <div className="info-banner-title">Order sekarang hanya menyimpan booking utama</div>
                            <div className="info-banner-text">
                                Barang, truck, driver, collie, dan muatan akan dicatat saat membuat Surat Jalan. Jalur ini menjaga order tetap ringan dan manifest pengiriman tetap mengikuti DO yang benar-benar jalan.
                            </div>
                        </div>
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
