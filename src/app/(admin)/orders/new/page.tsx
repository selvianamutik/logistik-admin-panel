'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Save, X } from 'lucide-react';

import PageBackButton from '@/components/PageBackButton';
import { fetchAdminCollectionData } from '@/lib/api/admin-client';
import { buildServiceCapacityRangeMap } from '@/lib/service-capacity-support';
import type { Customer, CustomerPickupLocation, Service, Vehicle } from '@/lib/types';
import {
    applyCustomerPickupToStop,
    createDefaultPickupStopForm,
    findDefaultCustomerPickup,
    getDraftPickupStops,
    sortCustomerPickups,
    summarizePickupStopList,
    type PickupStopForm,
} from '@/lib/order-create-page-support';
import { useToast } from '../../layout';

export default function NewOrderPage() {
    const router = useRouter();
    const { addToast } = useToast();
    const [customers, setCustomers] = useState<Customer[]>([]);
    const [customerPickups, setCustomerPickups] = useState<CustomerPickupLocation[]>([]);
    const [customerScopedMastersLoaded, setCustomerScopedMastersLoaded] = useState(false);
    const [services, setServices] = useState<Service[]>([]);
    const [vehicles, setVehicles] = useState<Array<Pick<Vehicle, '_id' | 'serviceRef' | 'capacityMin' | 'capacityMax' | 'capacityKg'>>>([]);
    const [loading, setLoading] = useState(false);

    const [customerRef, setCustomerRef] = useState('');
    const [serviceRef, setServiceRef] = useState('');
    const [pickupStops, setPickupStops] = useState<PickupStopForm[]>([createDefaultPickupStopForm()]);
    const [shouldAutoApplyDefaultPickup, setShouldAutoApplyDefaultPickup] = useState(false);
    const [notes, setNotes] = useState('');

    const selectedCustomer = customers.find(customer => customer._id === customerRef) || null;
    const selectedService = services.find(service => service._id === serviceRef) || null;
    const sortedCustomerPickups = sortCustomerPickups(customerPickups);
    const serviceCapacityRangeMap = buildServiceCapacityRangeMap(services, vehicles);
    const selectedServiceCapacityLabel = selectedService ? serviceCapacityRangeMap[selectedService._id] || 'Kapasitas belum diisi' : 'Belum dipilih';
    const pickupSummary = summarizePickupStopList(pickupStops);

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
            setCustomerPickups([]);
            setCustomerScopedMastersLoaded(false);
            return;
        }

        let cancelled = false;
        setCustomerScopedMastersLoaded(false);
        const loadCustomerScopedMasters = async () => {
            try {
                const pickupRows = await fetchAdminCollectionData<CustomerPickupLocation[]>(
                    `/api/data?entity=customer-pickups&filter=${encodeURIComponent(JSON.stringify({ customerRef, active: true }))}`,
                    'Gagal memuat master customer'
                );
                if (!cancelled) {
                    setCustomerPickups(pickupRows || []);
                    setCustomerScopedMastersLoaded(true);
                }
            } catch (error) {
                if (!cancelled) {
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
        if (!customerScopedMastersLoaded || !shouldAutoApplyDefaultPickup || !customerRef || pickupStops.length === 0) {
            return;
        }
        const defaultPickup = findDefaultCustomerPickup(customerPickups);
        if (!defaultPickup) {
            setShouldAutoApplyDefaultPickup(false);
            return;
        }
        setPickupStops(previous => previous.map((stop, index) => (
            index === 0 ? applyCustomerPickupToStop(stop, defaultPickup) : stop
        )));
        setShouldAutoApplyDefaultPickup(false);
    }, [customerPickups, customerRef, customerScopedMastersLoaded, pickupStops.length, shouldAutoApplyDefaultPickup]);

    const handleCustomerChange = (nextCustomerRef: string) => {
        const nextCustomer = customers.find(customer => customer._id === nextCustomerRef);
        setCustomerRef(nextCustomerRef);
        setPickupStops([createDefaultPickupStopForm(nextCustomer?.address || '')]);
        setShouldAutoApplyDefaultPickup(Boolean(nextCustomerRef));
    };

    const updatePickupStop = <K extends keyof PickupStopForm>(index: number, field: K, value: PickupStopForm[K]) => {
        setPickupStops(previous => previous.map((stop, stopIndex) => (
            stopIndex === index ? { ...stop, [field]: value } : stop
        )));
    };

    const handlePickupStopMasterChange = (index: number, nextPickupRef: string) => {
        const selectedPickup = customerPickups.find(item => item._id === nextPickupRef);
        setPickupStops(previous => previous.map((stop, stopIndex) => (
            stopIndex === index
                ? applyCustomerPickupToStop(
                    {
                        ...stop,
                        customerPickupRef: nextPickupRef,
                    },
                    selectedPickup
                )
                : stop
        )));
    };

    const handlePickupStopAddressChange = (index: number, value: string) => {
        setPickupStops(previous => previous.map((stop, stopIndex) => (
            stopIndex === index
                ? {
                    ...stop,
                    customerPickupRef: '',
                    pickupLabel: stop.customerPickupRef ? '' : stop.pickupLabel,
                    pickupAddress: value,
                }
                : stop
        )));
    };

    const addPickupStop = () => {
        setPickupStops(previous => [...previous, createDefaultPickupStopForm()]);
    };

    const removePickupStop = (index: number) => {
        setPickupStops(previous => {
            const nextStops = previous.filter((_, stopIndex) => stopIndex !== index);
            return nextStops.length > 0 ? nextStops : [createDefaultPickupStopForm(selectedCustomer?.address || '')];
        });
    };

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!customerRef) {
            addToast('error', 'Customer wajib dipilih');
            return;
        }

        const draftPickupStops = getDraftPickupStops(pickupStops);
        if (draftPickupStops.length === 0) {
            addToast('error', 'Minimal 1 titik pickup wajib diisi');
            return;
        }

        setLoading(true);
        try {
            const selectedCustomerRow = customers.find(customer => customer._id === customerRef);
            const selectedServiceRow = services.find(service => service._id === serviceRef);
            const payloadPickupStops = draftPickupStops.map((stop, index) => ({
                _key: stop.id,
                sequence: index + 1,
                customerPickupRef: stop.customerPickupRef || undefined,
                pickupLabel: stop.pickupLabel.trim() || undefined,
                pickupAddress: stop.pickupAddress.trim(),
                notes: stop.notes.trim() || undefined,
            }));

            const response = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    entity: 'orders',
                    action: 'create-with-items',
                    data: {
                        customerRef,
                        customerName: selectedCustomerRow?.name || '',
                        customerPickupRef: payloadPickupStops[0]?.customerPickupRef,
                        pickupAddress: payloadPickupStops[0]?.pickupAddress || '',
                        pickupStops: payloadPickupStops,
                        serviceRef,
                        serviceName: selectedServiceRow?.name || '',
                        notes,
                        items: [],
                    },
                }),
            });

            const orderData = await response.json();
            if (!response.ok) {
                addToast('error', orderData.error || 'Gagal membuat order');
                return;
            }

            const orderId = orderData.data?._id || orderData.id;
            addToast('success', `Order dibuat: ${orderData.data?.masterResi || ''}`);
            router.push(`/orders/${orderId}`);
        } catch (error) {
            addToast('error', error instanceof Error ? error.message : 'Gagal membuat order');
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
                            <div className="kpi-label">Pickup</div>
                            <div className="kpi-value" style={{ fontSize: '1rem' }}>{pickupSummary}</div>
                        </div>
                    </div>
                    <div className="kpi-card">
                        <div className="kpi-content">
                            <div className="kpi-label">Barang</div>
                            <div className="kpi-value" style={{ fontSize: '0.95rem' }}>Di Surat Jalan</div>
                        </div>
                    </div>
                </div>

                <div className="detail-grid">
                    <div className="card">
                        <div className="card-header"><span className="card-header-title">Customer / Pengirim</span></div>
                        <div className="card-body">
                            <div className="form-group">
                                <label className="form-label">Customer / Pengirim / Penagih <span className="required">*</span></label>
                                <select className="form-select" value={customerRef} onChange={event => handleCustomerChange(event.target.value)} required>
                                    <option value="">Pilih customer</option>
                                    {customers.map(customer => <option key={customer._id} value={customer._id}>{customer.name}</option>)}
                                </select>
                            </div>
                            <div className="form-group">
                                <label className="form-label">Kategori Truk / Armada</label>
                                <select className="form-select" value={serviceRef} onChange={event => setServiceRef(event.target.value)}>
                                    <option value="">Pilih kategori armada</option>
                                    {services.map(service => (
                                        <option key={service._id} value={service._id}>
                                            {service.code} - {service.name} ({serviceCapacityRangeMap[service._id] || 'Kapasitas belum diisi'})
                                        </option>
                                    ))}
                                </select>
                                {selectedService && (
                                    <div className="text-muted text-sm" style={{ marginTop: '0.35rem' }}>
                                        {selectedServiceCapacityLabel}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    <div className="card">
                        <div className="card-header"><span className="card-header-title">Titik Pickup Order</span></div>
                        <div className="card-body" style={{ display: 'grid', gap: '0.9rem' }}>
                            {pickupStops.map((stop, index) => (
                                <div
                                    key={stop.id}
                                    style={{
                                        display: 'grid',
                                        gap: '0.85rem',
                                        padding: '1rem',
                                        border: '1px solid var(--color-gray-200)',
                                        borderRadius: '0.9rem',
                                        background: 'var(--color-gray-50)',
                                    }}
                                >
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                                        <div style={{ fontWeight: 600 }}>Pickup {index + 1}</div>
                                        {pickupStops.length > 1 && (
                                            <button type="button" className="btn btn-ghost btn-icon-only" onClick={() => removePickupStop(index)} title="Hapus pickup">
                                                <X size={16} />
                                            </button>
                                        )}
                                    </div>
                                    {customerRef && (
                                        <div className="form-group" style={{ marginBottom: 0 }}>
                                            <label className="form-label">Master Pickup Customer</label>
                                            <select
                                                className="form-select"
                                                value={stop.customerPickupRef}
                                                onChange={event => handlePickupStopMasterChange(index, event.target.value)}
                                            >
                                                <option value="">{customerPickups.length > 0 ? 'Pilih master pickup' : 'Belum ada master pickup customer'}</option>
                                                {sortedCustomerPickups.map(pickup => (
                                                    <option key={pickup._id} value={pickup._id}>
                                                        {pickup.isDefault ? '[Default] ' : ''}{pickup.label}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                    )}
                                    <div className="form-group" style={{ marginBottom: 0 }}>
                                        <label className="form-label">Alamat Pickup <span className="required">*</span></label>
                                        <textarea
                                            className="form-textarea"
                                            rows={2}
                                            value={stop.pickupAddress}
                                            onChange={event => handlePickupStopAddressChange(index, event.target.value)}
                                            placeholder="Alamat lokasi pengambilan barang"
                                        />
                                    </div>
                                    <div className="form-group" style={{ marginBottom: 0 }}>
                                        <label className="form-label">Catatan Pickup</label>
                                        <input
                                            className="form-input"
                                            value={stop.notes}
                                            onChange={event => updatePickupStop(index, 'notes', event.target.value)}
                                            placeholder="Catatan pickup"
                                        />
                                    </div>
                                </div>
                            ))}
                            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
                                <button type="button" className="btn btn-secondary btn-sm" onClick={addPickupStop}>
                                    <Plus size={14} /> Tambah Pickup
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="card mt-6">
                    <div className="card-body">
                        <div className="form-group">
                            <label className="form-label">Catatan Internal</label>
                            <textarea
                                className="form-textarea"
                                rows={3}
                                value={notes}
                                onChange={event => setNotes(event.target.value)}
                                placeholder="Catatan opsional..."
                            />
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
