'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useToast } from '../../layout';
import { Truck, FileText, Edit, Eye } from 'lucide-react';
import CurrencyInput from '@/components/CurrencyInput';
import FormattedNumberInput from '@/components/FormattedNumberInput';
import { formatDate, formatCurrency, formatNumber, getReceivableNetAmount, ORDER_STATUS_MAP, ITEM_STATUS_MAP, DO_STATUS_MAP, INVOICE_STATUS_MAP, formatDeliveryOrderDisplayNumber } from '@/lib/utils';
import { formatCargoSummary, formatVolumeDisplay } from '@/lib/measurement';
import { calculateWeightPortion, getOrderItemProgress, roundQuantity } from '@/lib/order-item-progress';
import type { Order, OrderItem, DeliveryOrder, DeliveryOrderItem, Driver, FreightNota, FreightNotaItem, Vehicle } from '@/lib/types';
import PageBackButton from '@/components/PageBackButton';

type SelectedShipmentMap = Record<string, {
    qtyKoli: string;
    holdRemaining: boolean;
    holdReason: string;
    holdLocation: string;
}>;

type CargoAggregate = {
    qtyKoli: number;
    weightKg: number;
    volumeM3: number;
};

function createCargoAggregate(): CargoAggregate {
    return {
        qtyKoli: 0,
        weightKg: 0,
        volumeM3: 0,
    };
}

function addCargoAggregate(base: CargoAggregate, next: Partial<CargoAggregate>) {
    return {
        qtyKoli: roundQuantity(base.qtyKoli + Number(next.qtyKoli || 0)),
        weightKg: roundQuantity(base.weightKg + Number(next.weightKg || 0)),
        volumeM3: roundQuantity(base.volumeM3 + Number(next.volumeM3 || 0), 3),
    };
}

function getPlannedDoItemCargo(doItem: DeliveryOrderItem): CargoAggregate {
    return {
        qtyKoli: Number(doItem.orderItemQtyKoli || 0),
        weightKg: Number(doItem.orderItemWeight || 0),
        volumeM3: Number(doItem.orderItemVolumeM3 || 0),
    };
}

function getActualDoItemCargo(doItem: DeliveryOrderItem): CargoAggregate {
    return {
        qtyKoli: Number(doItem.actualQtyKoli ?? doItem.orderItemQtyKoli ?? 0),
        weightKg: Number(doItem.actualWeightKg ?? doItem.orderItemWeight ?? 0),
        volumeM3: Number(doItem.actualVolumeM3 ?? doItem.orderItemVolumeM3 ?? 0),
    };
}

function formatProgressLine(label: string, qtyKoli: number, weight: number) {
    if (qtyKoli <= 0 && weight <= 0) {
        return null;
    }
    return `${label}: ${formatNumber(qtyKoli)} koli / ${formatNumber(roundQuantity(weight))} kg`;
}

export default function OrderDetailPage() {
    const params = useParams();
    const router = useRouter();
    const { addToast } = useToast();
    const orderId = params.id as string;
    const [order, setOrder] = useState<Order | null>(null);
    const [items, setItems] = useState<OrderItem[]>([]);
    const [dos, setDos] = useState<DeliveryOrder[]>([]);
    const [doItems, setDoItems] = useState<DeliveryOrderItem[]>([]);
    const [notas, setNotas] = useState<FreightNota[]>([]);
    const [loading, setLoading] = useState(true);
    const [showDOModal, setShowDOModal] = useState(false);
    const [creatingDO, setCreatingDO] = useState(false);
    // DO form
    const [doDate, setDoDate] = useState(new Date().toISOString().split('T')[0]);
    const [doVehicle, setDoVehicle] = useState('');
    const [doDriver, setDoDriver] = useState('');
    const [doTripFee, setDoTripFee] = useState(0);
    const [doVehicleOverrideReason, setDoVehicleOverrideReason] = useState('');
    const [doNotes, setDoNotes] = useState('');
    const [selectedShipments, setSelectedShipments] = useState<SelectedShipmentMap>({});
    const [vehicles, setVehicles] = useState<Array<Pick<Vehicle, '_id' | 'unitCode' | 'plateNumber' | 'serviceRef' | 'serviceName'>>>([]);
    const [drivers, setDrivers] = useState<Driver[]>([]);
    const [showHoldModal, setShowHoldModal] = useState(false);
    const [holdingItem, setHoldingItem] = useState<OrderItem | null>(null);
    const [holdQtyKoli, setHoldQtyKoli] = useState('');
    const [holdReason, setHoldReason] = useState('');
    const [holdLocation, setHoldLocation] = useState('');
    const [savingHold, setSavingHold] = useState(false);

    const loadOrderDetail = useCallback(async () => {
        const fetchEntity = async <T,>(url: string) => {
            const res = await fetch(url);
            const result = await res.json();
            if (!res.ok) {
                throw new Error(result.error || 'Gagal memuat detail order');
            }
            return result.data as T;
        };

        setLoading(true);
        try {
            const [orderData, itemData, deliveryOrders, vehicleData, driverData] = await Promise.all([
                fetchEntity<Order | null>(`/api/data?entity=orders&id=${orderId}`),
                fetchEntity<OrderItem[]>(`/api/data?entity=order-items&filter=${encodeURIComponent(JSON.stringify({ orderRef: orderId }))}`),
                fetchEntity<DeliveryOrder[]>(`/api/data?entity=delivery-orders&filter=${encodeURIComponent(JSON.stringify({ orderRef: orderId }))}`),
                fetchEntity<Array<Pick<Vehicle, '_id' | 'unitCode' | 'plateNumber' | 'serviceRef' | 'serviceName'>>>(`/api/data?entity=vehicles&filter=${encodeURIComponent(JSON.stringify({ status: ['ACTIVE', 'IN_SERVICE'] }))}`),
                fetchEntity<Driver[]>('/api/data?entity=drivers'),
            ]);
            const deliveryOrderIds = (deliveryOrders || []).map(item => item._id);
            const [deliveryOrderItems, notaItems] = await Promise.all([
                deliveryOrderIds.length > 0
                    ? fetchEntity<DeliveryOrderItem[]>(`/api/data?entity=delivery-order-items&filter=${encodeURIComponent(JSON.stringify({ deliveryOrderRef: deliveryOrderIds }))}`)
                    : Promise.resolve([] as DeliveryOrderItem[]),
                deliveryOrderIds.length > 0
                    ? fetchEntity<FreightNotaItem[]>(`/api/data?entity=freight-nota-items&filter=${encodeURIComponent(JSON.stringify({ doRef: deliveryOrderIds }))}`)
                    : Promise.resolve([] as FreightNotaItem[]),
            ]);
            const notaIds = [...new Set((notaItems || []).map(item => item.notaRef).filter(Boolean))];
            const orderNotas = notaIds.length > 0
                ? await fetchEntity<FreightNota[]>(`/api/data?entity=freight-notas&filter=${encodeURIComponent(JSON.stringify({ _id: notaIds }))}`)
                : [];

            setOrder(orderData);
            setItems(itemData || []);
            setDos(deliveryOrders || []);
            setDoItems(deliveryOrderItems);
            setNotas(orderNotas || []);
            setVehicles(vehicleData || []);
            setDrivers((driverData || []).filter(driver => driver.active !== false));
        } catch (error) {
            addToast('error', error instanceof Error ? error.message : 'Gagal memuat detail order');
        } finally {
            setLoading(false);
        }
    }, [addToast, orderId]);

    useEffect(() => {
        void loadOrderDetail();
    }, [loadOrderDetail]);

    const sortedVehicles = vehicles
        .slice()
        .sort((left, right) => {
            const leftMatches = order?.serviceRef && left.serviceRef === order.serviceRef ? 1 : 0;
            const rightMatches = order?.serviceRef && right.serviceRef === order.serviceRef ? 1 : 0;
            if (leftMatches !== rightMatches) {
                return rightMatches - leftMatches;
            }
            const leftLabel = `${left.unitCode || ''} ${left.plateNumber || ''}`.trim();
            const rightLabel = `${right.unitCode || ''} ${right.plateNumber || ''}`.trim();
            return leftLabel.localeCompare(rightLabel, 'id');
        });
    const selectedVehicleData = vehicles.find(vehicle => vehicle._id === doVehicle);
    const vehicleCategoryMismatch = Boolean(
        order?.serviceRef &&
        selectedVehicleData &&
        selectedVehicleData.serviceRef !== order.serviceRef
    );
    const vehicleMissingCategory = Boolean(
        order?.serviceRef &&
        selectedVehicleData &&
        !selectedVehicleData.serviceRef
    );
    const requiresVehicleOverrideReason = vehicleCategoryMismatch || vehicleMissingCategory;

    useEffect(() => {
        if (!requiresVehicleOverrideReason && doVehicleOverrideReason) {
            setDoVehicleOverrideReason('');
        }
    }, [requiresVehicleOverrideReason, doVehicleOverrideReason]);

    const activeAssignmentByItemId = doItems.reduce<Record<string, DeliveryOrder | undefined>>((acc, doi) => {
        const activeDeliveryOrder = dos.find(d => d._id === doi.deliveryOrderRef && ['CREATED', 'HEADING_TO_PICKUP', 'ON_DELIVERY', 'ARRIVED'].includes(d.status));
        if (activeDeliveryOrder && doi.orderItemRef) {
            acc[doi.orderItemRef] = activeDeliveryOrder;
        }
        return acc;
    }, {});
    const doItemByOrderItemId = doItems.reduce<Record<string, DeliveryOrderItem | undefined>>((acc, doi) => {
        if (doi.orderItemRef && activeAssignmentByItemId[doi.orderItemRef]) {
            acc[doi.orderItemRef] = doi;
        }
        return acc;
    }, {});
    const itemProgressById = items.reduce<Record<string, ReturnType<typeof getOrderItemProgress>>>((acc, item) => {
        acc[item._id] = getOrderItemProgress(item);
        return acc;
    }, {});
    const deliveredActualCargoByItemId = doItems.reduce<Record<string, CargoAggregate>>((acc, doItem) => {
        const deliveryOrder = dos.find(item => item._id === doItem.deliveryOrderRef);
        if (!deliveryOrder || deliveryOrder.status !== 'DELIVERED' || !doItem.orderItemRef) {
            return acc;
        }
        const current = acc[doItem.orderItemRef] || createCargoAggregate();
        acc[doItem.orderItemRef] = addCargoAggregate(current, getActualDoItemCargo(doItem));
        return acc;
    }, {});
    const activePlannedCargoByItemId = doItems.reduce<Record<string, CargoAggregate>>((acc, doItem) => {
        const deliveryOrder = dos.find(item => item._id === doItem.deliveryOrderRef);
        if (!deliveryOrder || !['CREATED', 'HEADING_TO_PICKUP', 'ON_DELIVERY', 'ARRIVED'].includes(deliveryOrder.status) || !doItem.orderItemRef) {
            return acc;
        }
        const current = acc[doItem.orderItemRef] || createCargoAggregate();
        acc[doItem.orderItemRef] = addCargoAggregate(current, getPlannedDoItemCargo(doItem));
        return acc;
    }, {});

    const availableItems = items.filter(item => {
        const progress = itemProgressById[item._id];
        return progress.pendingQtyKoli > 0 && progress.assignedQtyKoli <= 0;
    });
    const totalQtyKoli = items.reduce((sum, item) => sum + itemProgressById[item._id].totalQtyKoli, 0);
    const deliveredQtyKoli = items.reduce((sum, item) => sum + itemProgressById[item._id].deliveredQtyKoli, 0);
    const assignedQtyKoli = items.reduce((sum, item) => sum + itemProgressById[item._id].assignedQtyKoli, 0);
    const holdQtyTotal = items.reduce((sum, item) => sum + itemProgressById[item._id].heldQtyKoli, 0);
    const pendingQtyTotal = items.reduce((sum, item) => sum + itemProgressById[item._id].pendingQtyKoli, 0);
    const totalOrderCargo = items.reduce((sum, item) => addCargoAggregate(sum, {
        qtyKoli: item.qtyKoli,
        weightKg: item.weight,
        volumeM3: item.volume,
    }), createCargoAggregate());
    const totalDeliveredActualCargo = Object.values(deliveredActualCargoByItemId).reduce(
        (sum, cargo) => addCargoAggregate(sum, cargo),
        createCargoAggregate()
    );
    const totalActivePlannedCargo = Object.values(activePlannedCargoByItemId).reduce(
        (sum, cargo) => addCargoAggregate(sum, cargo),
        createCargoAggregate()
    );
    const doPlannedCargoById = doItems.reduce<Record<string, CargoAggregate>>((acc, doItem) => {
        const current = acc[doItem.deliveryOrderRef] || createCargoAggregate();
        acc[doItem.deliveryOrderRef] = addCargoAggregate(current, getPlannedDoItemCargo(doItem));
        return acc;
    }, {});
    const doActualCargoById = doItems.reduce<Record<string, CargoAggregate>>((acc, doItem) => {
        const current = acc[doItem.deliveryOrderRef] || createCargoAggregate();
        acc[doItem.deliveryOrderRef] = addCargoAggregate(current, getActualDoItemCargo(doItem));
        return acc;
    }, {});
    const deliveredDoCount = dos.filter(d => d.status === 'DELIVERED').length;
    const progress = totalQtyKoli > 0 ? Math.round((deliveredQtyKoli / totalQtyKoli) * 100) : 0;

    const handleCreateDO = async () => {
        const selectedItems = availableItems
            .filter(item => selectedShipments[item._id])
            .map(item => {
                const progress = itemProgressById[item._id];
                const selection = selectedShipments[item._id];
                const qtyKoli = Number(selection.qtyKoli || 0);
                return {
                    orderItemRef: item._id,
                    qtyKoli,
                    holdRemaining: selection.holdRemaining && qtyKoli < progress.pendingQtyKoli,
                    holdReason: selection.holdReason.trim(),
                    holdLocation: selection.holdLocation.trim(),
                };
            })
            .filter(item => Number.isFinite(item.qtyKoli) && item.qtyKoli > 0);

        if (selectedItems.length === 0) {
            addToast('error', 'Pilih minimal 1 item untuk surat jalan');
            return;
        }
        if (requiresVehicleOverrideReason && !doVehicleOverrideReason.trim()) {
            addToast('error', 'Isi alasan override armada jika trip ini memakai kendaraan dengan kategori berbeda');
            return;
        }
        setCreatingDO(true);
        try {
            const selVeh = vehicles.find(v => v._id === doVehicle);
            const selDriver = drivers.find(driver => driver._id === doDriver);
            const doRes = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    entity: 'delivery-orders',
                    action: 'create-with-items',
                    data: {
                        orderRef: order?._id,
                        items: selectedItems,
                        masterResi: order?.masterResi,
                        vehicleRef: doVehicle || undefined,
                        vehiclePlate: selVeh?.plateNumber || '',
                        vehicleCategoryOverrideReason: requiresVehicleOverrideReason ? doVehicleOverrideReason.trim() : undefined,
                        driverRef: doDriver || undefined,
                        driverName: selDriver?.name || '',
                        taripBorongan: doTripFee > 0 ? doTripFee : undefined,
                        date: doDate,
                        notes: doNotes,
                        customerName: order?.customerName,
                        receiverName: order?.receiverName,
                        receiverAddress: order?.receiverAddress,
                    }
                }),
            });
            const doData = await doRes.json();
            if (!doRes.ok) {
                addToast('error', doData.error || 'Gagal membuat surat jalan');
                return;
            }

            addToast('success', `Surat Jalan dibuat: ${formatDeliveryOrderDisplayNumber(doData.data || {})}${doData.data?.customerDoNumber ? ` (${doData.data?.doNumber || ''})` : ''}`);
            setShowDOModal(false);
            setSelectedShipments({});
            setDoVehicle('');
            setDoDriver('');
            setDoTripFee(0);
            setDoVehicleOverrideReason('');
            setDoNotes('');
            setDoDate(new Date().toISOString().split('T')[0]);
            await loadOrderDetail();
        } catch {
            addToast('error', 'Gagal membuat surat jalan');
        } finally {
            setCreatingDO(false);
        }
    };

    const openHoldModal = (item: OrderItem) => {
        const progress = itemProgressById[item._id];
        setHoldingItem(item);
        setHoldQtyKoli(String(progress.pendingQtyKoli || ''));
        setHoldReason('');
        setHoldLocation('');
        setShowHoldModal(true);
    };

    const saveHoldQuantity = async () => {
        if (!holdingItem) {
            return;
        }
        setSavingHold(true);
        try {
            const res = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    entity: 'order-items',
                    action: 'set-hold-quantity',
                    data: {
                        id: holdingItem._id,
                        holdQtyKoli: Number(holdQtyKoli),
                        holdReason,
                        holdLocation,
                    },
                }),
            });
            const result = await res.json();
            if (!res.ok) {
                addToast('error', result.error || 'Gagal menyimpan hold qty');
                return;
            }
            addToast('success', 'Sisa qty item berhasil di-hold');
            setShowHoldModal(false);
            setHoldingItem(null);
            setHoldQtyKoli('');
            setHoldReason('');
            setHoldLocation('');
            await loadOrderDetail();
        } catch {
            addToast('error', 'Gagal menyimpan hold qty');
        } finally {
            setSavingHold(false);
        }
    };

    const releaseHoldQuantity = async (item: OrderItem) => {
        try {
            const res = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ entity: 'order-items', action: 'release-hold', data: { id: item._id } }),
            });
            const result = await res.json();
            if (!res.ok) {
                addToast('error', result.error || 'Gagal melepas hold item');
                return;
            }
            addToast('success', 'Hold item berhasil dilepas');
            await loadOrderDetail();
        } catch {
            addToast('error', 'Gagal melepas hold item');
        }
    };

    if (loading) {
        return <div><div className="skeleton skeleton-title" /><div className="skeleton skeleton-card" style={{ height: 200 }} /></div>;
    }

    if (!order) {
        return <div className="empty-state"><div className="empty-state-title">Order tidak ditemukan</div></div>;
    }

    return (
        <div>
            <div className="page-header">
                <div className="page-header-left" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                    <PageBackButton href="/orders" />
                    <div>
                        <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                            {order.masterResi}
                            <span className={`badge badge-${ORDER_STATUS_MAP[order.status]?.color || 'gray'}`}>
                                <span className="badge-dot" /> {ORDER_STATUS_MAP[order.status]?.label}
                            </span>
                        </h1>
                        <p className="page-subtitle">Detail pengirim, penerima, dan pengiriman</p>
                    </div>
                </div>
                <div className="page-actions">
                    <button className="btn btn-primary" onClick={() => { setSelectedShipments({}); setShowDOModal(true); }} disabled={availableItems.length === 0}>
                        <Truck size={16} /> Buat Surat Jalan
                    </button>
                    <button className="btn btn-secondary" onClick={() => router.push('/invoices/new')}>
                        <FileText size={16} /> Buat Nota
                    </button>
                    <button
                        className="btn btn-ghost"
                        onClick={() => router.push(`/orders/${order._id}/edit`)}
                        title={dos.length > 0 ? 'Order ini sudah punya surat jalan. Hanya catatan yang bisa diubah.' : 'Edit order'}
                    >
                        <Edit size={16} /> Edit
                    </button>
                </div>
            </div>

            {/* Progress Bar */}
            <div className="card mb-6">
                <div className="card-body">
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 'var(--font-size-sm)' }}>
                        <span className="font-semibold">Progress Pengiriman Aktual</span>
                        <span className="text-muted">{formatNumber(deliveredQtyKoli)}/{formatNumber(totalQtyKoli)} koli terkirim ({progress}%)</span>
                    </div>
                    <div className="progress-bar">
                        <div className={`progress-bar-fill ${progress === 100 ? 'success' : ''}`} style={{ width: `${progress}%` }} />
                    </div>
                    <div style={{ display: 'flex', gap: 16, marginTop: 8, fontSize: 'var(--font-size-xs)', color: 'var(--color-gray-500)' }}>
                        <span style={{ color: 'var(--color-success)' }}>{formatNumber(deliveredQtyKoli)} Terkirim</span>
                        <span style={{ color: 'var(--color-primary)' }}>{formatNumber(assignedQtyKoli)} Dalam DO</span>
                        <span style={{ color: 'var(--color-warning)' }}>{formatNumber(holdQtyTotal)} Ditahan</span>
                        <span>{formatNumber(pendingQtyTotal)} Pending</span>
                    </div>
                    <div style={{ marginTop: 8, fontSize: '0.76rem', color: 'var(--text-muted)' }}>
                        DO aktif masih memakai muatan rencana. Begitu DO selesai, realisasi akhir mengikuti muatan aktual yang difinalkan admin.
                    </div>
                </div>
            </div>

            <div className="detail-grid" style={{ marginBottom: '1.5rem' }}>
                <div className="card">
                    <div className="card-header"><span className="card-header-title">Target Order Saat Ini</span></div>
                    <div className="card-body">
                        <div className="detail-value" style={{ fontSize: '1.1rem', fontWeight: 700 }}>
                            {formatCargoSummary({
                                qtyKoli: totalOrderCargo.qtyKoli,
                                weightKg: totalOrderCargo.weightKg,
                                volumeM3: totalOrderCargo.volumeM3,
                            })}
                        </div>
                        <div className="text-muted text-sm" style={{ marginTop: '0.35rem' }}>
                            Mengikuti target order yang tersimpan saat ini.
                        </div>
                    </div>
                </div>
                <div className="card">
                    <div className="card-header"><span className="card-header-title">Aktual Terkirim</span></div>
                    <div className="card-body">
                        <div className="detail-value" style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--color-success)' }}>
                            {formatCargoSummary({
                                qtyKoli: totalDeliveredActualCargo.qtyKoli,
                                weightKg: totalDeliveredActualCargo.weightKg,
                                volumeM3: totalDeliveredActualCargo.volumeM3,
                            })}
                        </div>
                        <div className="text-muted text-sm" style={{ marginTop: '0.35rem' }}>
                            Diambil dari muatan aktual DO yang sudah `Delivered`.
                        </div>
                    </div>
                </div>
                <div className="card">
                    <div className="card-header"><span className="card-header-title">Rencana dalam DO Aktif</span></div>
                    <div className="card-body">
                        <div className="detail-value" style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--color-primary)' }}>
                            {assignedQtyKoli > 0
                                ? formatCargoSummary({
                                    qtyKoli: totalActivePlannedCargo.qtyKoli,
                                    weightKg: totalActivePlannedCargo.weightKg,
                                    volumeM3: totalActivePlannedCargo.volumeM3,
                                })
                                : '-'}
                        </div>
                        <div className="text-muted text-sm" style={{ marginTop: '0.35rem' }}>
                            Ini masih estimasi proporsional dari target order sampai DO tersebut diselesaikan.
                        </div>
                    </div>
                </div>
            </div>

            {/* Order Info */}
            <div className="detail-grid">
                <div className="card">
                    <div className="card-header"><span className="card-header-title">Informasi Order</span></div>
                    <div className="card-body">
                        <div className="detail-row">
                            <div className="detail-item"><div className="detail-label">Master Resi</div><div className="detail-value font-mono">{order.masterResi}</div></div>
                            <div className="detail-item"><div className="detail-label">Tanggal</div><div className="detail-value">{formatDate(order.createdAt)}</div></div>
                        </div>
                        <div className="detail-row">
                            <div className="detail-item"><div className="detail-label">Customer / Pengirim / Penagih</div><div className="detail-value">{order.customerName}</div></div>
                            <div className="detail-item"><div className="detail-label">Kategori Truk / Armada</div><div className="detail-value">{order.serviceName || '-'}</div></div>
                        </div>
                        <div className="mt-2"><div className="detail-label">Alamat Pickup</div><div className="detail-value">{order.pickupAddress || '-'}</div></div>
                        {order.notes && <div className="mt-2"><div className="detail-label">Catatan</div><div className="detail-value">{order.notes}</div></div>}
                    </div>
                </div>

                <div className="card">
                    <div className="card-header"><span className="card-header-title">Penerima</span></div>
                    <div className="card-body">
                        <div className="detail-row">
                            <div className="detail-item"><div className="detail-label">Nama</div><div className="detail-value">{order.receiverName}</div></div>
                            <div className="detail-item"><div className="detail-label">Telepon</div><div className="detail-value">{order.receiverPhone}</div></div>
                        </div>
                        <div><div className="detail-label">Alamat</div><div className="detail-value">{order.receiverAddress}</div></div>
                        {order.receiverCompany && <div className="mt-2"><div className="detail-label">Perusahaan</div><div className="detail-value">{order.receiverCompany}</div></div>}
                    </div>
                </div>
            </div>

            {/* Items */}
            <div className="card mt-6">
                <div className="card-header">
                    <span className="card-header-title">Item / Koli ({items.length})</span>
                </div>
                <div className="table-wrapper">
                    <table>
                        <thead><tr><th>Deskripsi</th><th>Koli</th><th>Muatan</th><th>Progress</th><th>Status</th><th>Aksi</th></tr></thead>
                        <tbody>
                            {items.map(item => {
                                const activeAssignment = activeAssignmentByItemId[item._id];
                                const doItem = doItemByOrderItemId[item._id];
                                const progressInfo = itemProgressById[item._id];
                                const deliveredActualCargo = deliveredActualCargoByItemId[item._id] || createCargoAggregate();
                                const activePlannedCargo = activePlannedCargoByItemId[item._id] || createCargoAggregate();
                                const progressLines = [
                                    formatProgressLine('Aktual terkirim', deliveredActualCargo.qtyKoli, deliveredActualCargo.weightKg),
                                    formatProgressLine('Rencana dalam DO', activePlannedCargo.qtyKoli, activePlannedCargo.weightKg),
                                    formatProgressLine('Hold', progressInfo.heldQtyKoli, progressInfo.heldWeight),
                                    formatProgressLine('Sisa siap kirim', progressInfo.pendingQtyKoli, progressInfo.pendingWeight),
                                ].filter((line): line is string => Boolean(line));
                                return (
                                <tr key={item._id}>
                                    <td>
                                        <div className="font-medium">{item.description}</div>
                                        {(item.customerProductCode || item.customerProductName) && (
                                            <div className="text-muted text-sm" style={{ marginTop: '0.2rem' }}>
                                                {item.customerProductCode ? `${item.customerProductCode} - ` : ''}{item.customerProductName || 'Master barang customer'}
                                            </div>
                                        )}
                                    </td>
                                    <td>
                                        <div className="font-medium">{item.qtyKoli}</div>
                                        <div className="text-muted text-sm">
                                            Aktual terkirim: {formatNumber(deliveredActualCargo.qtyKoli)}
                                        </div>
                                    </td>
                                    <td>
                                        <div className="text-muted text-xs">Target / order</div>
                                        <div className="font-medium">
                                            {formatCargoSummary({
                                                qtyKoli: item.qtyKoli,
                                                weightKg: item.weight,
                                                weightInputValue: item.weightInputValue,
                                                weightInputUnit: item.weightInputUnit,
                                                volumeM3: item.volume,
                                                volumeInputValue: item.volumeInputValue,
                                                volumeInputUnit: item.volumeInputUnit,
                                            })}
                                        </div>
                                        <div className="text-muted text-xs" style={{ marginTop: '0.35rem' }}>Aktual terkirim</div>
                                        <div className="font-medium" style={{ color: deliveredActualCargo.qtyKoli > 0 ? 'var(--color-success)' : 'var(--color-gray-500)' }}>
                                            {deliveredActualCargo.qtyKoli > 0
                                                ? formatCargoSummary({
                                                    qtyKoli: deliveredActualCargo.qtyKoli,
                                                    weightKg: deliveredActualCargo.weightKg,
                                                    volumeM3: deliveredActualCargo.volumeM3,
                                                })
                                                : 'Belum ada realisasi'}
                                        </div>
                                        {activePlannedCargo.qtyKoli > 0 && (
                                            <>
                                                <div className="text-muted text-xs" style={{ marginTop: '0.35rem' }}>Dalam DO aktif</div>
                                                <div className="font-medium" style={{ color: 'var(--color-primary)' }}>
                                                    {formatCargoSummary({
                                                        qtyKoli: activePlannedCargo.qtyKoli,
                                                        weightKg: activePlannedCargo.weightKg,
                                                        volumeM3: activePlannedCargo.volumeM3,
                                                    })}
                                                </div>
                                            </>
                                        )}
                                    </td>
                                    <td>
                                        <div style={{ display: 'grid', gap: '0.25rem', minWidth: 220 }}>
                                            {progressLines.map(line => (
                                                <div key={line} style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>{line}</div>
                                            ))}
                                            {item.holdReason && (
                                                <div style={{ fontSize: '0.76rem', color: 'var(--color-warning-dark)' }}>
                                                    Alasan hold: {item.holdReason}{item.holdLocation ? ` (${item.holdLocation})` : ''}
                                                </div>
                                            )}
                                        </div>
                                    </td>
                                    <td>
                                        <span className={`badge badge-${ITEM_STATUS_MAP[item.status]?.color || 'gray'}`}>
                                            <span className="badge-dot" /> {ITEM_STATUS_MAP[item.status]?.label}
                                        </span>
                                    </td>
                                    <td>
                                        <div className="table-actions">
                                            {progressInfo.pendingQtyKoli > 0 && (
                                                <button className="table-action-btn" onClick={() => openHoldModal(item)}>
                                                    {activeAssignment ? 'Tahan Sisa' : 'Set Hold'}
                                                </button>
                                            )}
                                            {progressInfo.heldQtyKoli > 0 && (
                                                <button className="table-action-btn" onClick={() => void releaseHoldQuantity(item)}>Lepas Hold</button>
                                            )}
                                            {activeAssignment && (
                                                <Link href={`/delivery-orders/${activeAssignment._id}`} className="table-action-btn" title="Item ini sudah masuk surat jalan aktif">
                                                    <Eye size={14} /> {activeAssignment.doNumber || 'Lihat DO'}{doItem?.orderItemQtyKoli ? ` (${formatNumber(doItem.orderItemQtyKoli)} koli)` : ''}
                                                </Link>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* DOs */}
            <div className="card mt-6">
                <div className="card-header"><span className="card-header-title">Surat Jalan ({dos.length})</span></div>
                <div className="table-wrapper">
                    <table>
                        <thead><tr><th>No. DO</th><th>Tanggal</th><th>Kendaraan</th><th>Muatan</th><th>Status</th><th>Aksi</th></tr></thead>
                        <tbody>
                            {dos.length === 0 ? (
                                <tr><td colSpan={6} className="text-center text-muted" style={{ padding: '2rem' }}>Belum ada surat jalan</td></tr>
                            ) : dos.map(d => (
                                <tr key={d._id}>
                                    <td><Link href={`/delivery-orders/${d._id}`} className="font-semibold" style={{ color: 'var(--color-primary)' }}>{formatDeliveryOrderDisplayNumber(d)}</Link><div className="text-muted text-sm font-mono">{d.doNumber}</div></td>
                                    <td>{formatDate(d.date)}</td>
                                    <td>{d.vehiclePlate || '-'}</td>
                                    <td>
                                        <div className="font-medium">
                                            {formatCargoSummary(
                                                d.status === 'DELIVERED'
                                                    ? {
                                                        qtyKoli: doActualCargoById[d._id]?.qtyKoli,
                                                        weightKg: doActualCargoById[d._id]?.weightKg,
                                                        volumeM3: doActualCargoById[d._id]?.volumeM3,
                                                    }
                                                    : {
                                                        qtyKoli: doPlannedCargoById[d._id]?.qtyKoli,
                                                        weightKg: doPlannedCargoById[d._id]?.weightKg,
                                                        volumeM3: doPlannedCargoById[d._id]?.volumeM3,
                                                    }
                                            )}
                                        </div>
                                        <div className="text-muted text-sm">
                                            {d.status === 'DELIVERED' ? 'Aktual final' : 'Rencana Trip (estimasi)'}
                                        </div>
                                    </td>
                                    <td><span className={`badge badge-${DO_STATUS_MAP[d.status]?.color}`}><span className="badge-dot" /> {DO_STATUS_MAP[d.status]?.label}</span></td>
                                    <td><Link href={`/delivery-orders/${d._id}`} className="table-action-btn"><Eye size={14} /> Lihat</Link></td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Notas */}
            <div className="card mt-6">
                <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'center' }}>
                    <span className="card-header-title">Nota Ongkos ({notas.length})</span>
                    <span className="text-muted" style={{ fontSize: '0.78rem' }}>Nota dibuat dari DO yang sudah selesai dikirim</span>
                </div>
                <div className="table-wrapper">
                    <table>
                        <thead><tr><th>No. Nota</th><th>Tanggal</th><th>Total</th><th>Status</th><th>Aksi</th></tr></thead>
                        <tbody>
                            {notas.length === 0 ? (
                                <tr>
                                    <td colSpan={5} className="text-center text-muted" style={{ padding: '2rem' }}>
                                        {deliveredDoCount === 0 ? 'Belum ada DO selesai yang bisa ditagihkan' : 'Belum ada nota untuk order ini'}
                                    </td>
                                </tr>
                            ) : notas.map(nota => (
                                <tr key={nota._id}>
                                    <td><Link href={`/invoices/${nota._id}`} className="font-semibold" style={{ color: 'var(--color-primary)' }}>{nota.notaNumber}</Link></td>
                                    <td>{formatDate(nota.issueDate)}</td>
                                    <td className="font-medium">{formatCurrency(getReceivableNetAmount(nota))}</td>
                                    <td><span className={`badge badge-${INVOICE_STATUS_MAP[nota.status]?.color}`}><span className="badge-dot" /> {INVOICE_STATUS_MAP[nota.status]?.label}</span></td>
                                    <td><Link href={`/invoices/${nota._id}`} className="table-action-btn"><Eye size={14} /> Lihat</Link></td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Create DO Modal */}
            {showDOModal && (
                <div className="modal-overlay" onClick={() => { if (!creatingDO) setShowDOModal(false); }}>
                    <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3 className="modal-title">Buat Surat Jalan</h3>
                            <button className="modal-close" onClick={() => setShowDOModal(false)} disabled={creatingDO}>&times;</button>
                        </div>
                        <div className="modal-body">
                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label">Tanggal</label>
                                    <input type="date" className="form-input" value={doDate} onChange={e => setDoDate(e.target.value)} disabled={creatingDO} />
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Kendaraan</label>
                                    <select className="form-select" value={doVehicle} onChange={e => setDoVehicle(e.target.value)} disabled={creatingDO}>
                                        <option value="">Pilih kendaraan</option>
                                        {sortedVehicles.map(v => <option key={v._id} value={v._id}>{v.unitCode ? `${v.unitCode} - ` : ''}{v.plateNumber}{v.serviceName ? ` (${v.serviceName})` : ' (Kategori belum diisi)'}</option>)}
                                    </select>
                                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
                                        {order.serviceRef
                                            ? `Kendaraan yang cocok dengan kategori ${order.serviceName || '-'} ditampilkan lebih dulu. Trip parsial tetap boleh memakai armada lain jika memang diperlukan, tapi alasannya wajib dicatat.`
                                            : 'Order ini belum punya kategori armada, jadi semua kendaraan operasional tetap tersedia.'}
                                    </div>
                                </div>
                            </div>
                            {requiresVehicleOverrideReason && (
                                <div
                                    style={{
                                        background: 'var(--color-warning-light)',
                                        border: '1px solid rgba(234, 179, 8, 0.35)',
                                        borderRadius: '0.75rem',
                                        padding: '0.85rem 1rem',
                                        marginBottom: '1rem',
                                    }}
                                >
                                    <div style={{ fontWeight: 600, color: 'var(--color-warning-dark)', marginBottom: '0.35rem' }}>
                                        Armada aktual berbeda dari armada order
                                    </div>
                                    <div style={{ fontSize: '0.8rem', color: 'var(--color-warning-dark)', marginBottom: '0.75rem' }}>
                                        Order meminta <strong>{order.serviceName || '-'}</strong>, tetapi trip ini memakai <strong>{selectedVehicleData?.serviceName || 'kendaraan tanpa kategori'}</strong>.
                                        Ini boleh untuk pengiriman parsial, asalkan alasannya dicatat.
                                    </div>
                                    <div className="form-group" style={{ marginBottom: 0 }}>
                                        <label className="form-label">Alasan Override Armada</label>
                                        <textarea
                                            className="form-textarea"
                                            rows={2}
                                            value={doVehicleOverrideReason}
                                            onChange={e => setDoVehicleOverrideReason(e.target.value)}
                                            placeholder="Mis. sisa muatan lebih besar, armada awal tidak tersedia, atau permintaan customer berubah"
                                            disabled={creatingDO}
                                        />
                                    </div>
                                </div>
                            )}
                            <div className="form-group">
                                <label className="form-label">Supir</label>
                                <select className="form-select" value={doDriver} onChange={e => setDoDriver(e.target.value)} disabled={creatingDO}>
                                    <option value="">-- Opsional, pilih supir --</option>
                                    {drivers.map(driver => <option key={driver._id} value={driver._id}>{driver.name}{driver.phone ? ` - ${driver.phone}` : ''}</option>)}
                                </select>
                            </div>
                            <div className="form-group">
                                <label className="form-label">Upah Trip</label>
                                <CurrencyInput
                                    value={doTripFee}
                                    onValueChange={setDoTripFee}
                                    placeholder="Ketik upah trip bila sudah diketahui"
                                    disabled={creatingDO}
                                />
                                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
                                    Isi kalau nominal upah trip sudah diketahui supaya DO bisa langsung muncul saat terbitkan Uang Jalan Trip. Kalau belum, tetap bisa diisi nanti dari form Uang Jalan Trip.
                                </div>
                            </div>
                            <div className="form-group">
                                <label className="form-label">Catatan</label>
                                <textarea className="form-textarea" rows={2} value={doNotes} onChange={e => setDoNotes(e.target.value)} placeholder="Catatan opsional..." disabled={creatingDO} />
                            </div>
                            <div className="form-section-title">Pilih Item untuk DO</div>
                            <div style={{ background: 'var(--color-gray-50)', borderRadius: '0.5rem', padding: '0.75rem 1rem', marginBottom: '1rem', fontSize: '0.8rem', color: 'var(--color-gray-600)' }}>
                                Untuk pengiriman normal, cukup pilih kendaraan, supir, centang item yang jalan, lalu cek koli kirim. Opsi tahan sisa hanya dipakai kalau ada barang yang belum bisa lanjut.
                            </div>
                            {availableItems.length === 0 ? (
                                <p className="text-muted text-sm">Semua item sudah masuk surat jalan</p>
                            ) : (
                                <div style={{ border: '1px solid var(--color-gray-200)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
                                    <table>
                                        <thead><tr><th style={{ width: 40 }}></th><th>Item</th><th>Progress</th><th>Kirim Koli</th><th>Tahan Sisa (Opsional)</th></tr></thead>
                                        <tbody>
                                            {availableItems.map(item => {
                                                const selection = selectedShipments[item._id];
                                                const progressInfo = itemProgressById[item._id];
                                                const selectedQty = Number(selection?.qtyKoli || 0);
                                                const shippedWeightPreview = selectedQty > 0
                                                    ? calculateWeightPortion(progressInfo.totalWeight, progressInfo.totalQtyKoli, selectedQty)
                                                    : 0;
                                                const remainingAfterShipment = roundQuantity(Math.max(progressInfo.pendingQtyKoli - selectedQty, 0));
                                                return (
                                                    <tr key={item._id}>
                                                        <td>
                                                            <input
                                                                type="checkbox"
                                                                checked={Boolean(selection)}
                                                                disabled={creatingDO}
                                                                onChange={e => {
                                                                    if (e.target.checked) {
                                                                        setSelectedShipments(prev => ({
                                                                            ...prev,
                                                                            [item._id]: {
                                                                                qtyKoli: String(progressInfo.pendingQtyKoli),
                                                                                holdRemaining: false,
                                                                                holdReason: '',
                                                                                holdLocation: '',
                                                                            },
                                                                        }));
                                                                    } else {
                                                                        setSelectedShipments(prev => {
                                                                            const next = { ...prev };
                                                                            delete next[item._id];
                                                                            return next;
                                                                        });
                                                                    }
                                                                }}
                                                            />
                                                        </td>
                                                        <td>
                                                            <div className="font-medium">{item.description}</div>
                                                            {(item.customerProductCode || item.customerProductName) && (
                                                                <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
                                                                    {item.customerProductCode ? `${item.customerProductCode} - ` : ''}{item.customerProductName || 'Master barang customer'}
                                                                </div>
                                                            )}
                                                            <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>
                                                                Total {formatCargoSummary({
                                                                    qtyKoli: progressInfo.totalQtyKoli,
                                                                    weightKg: item.weight,
                                                                    weightInputValue: item.weightInputValue,
                                                                    weightInputUnit: item.weightInputUnit,
                                                                    volumeM3: item.volume,
                                                                    volumeInputValue: item.volumeInputValue,
                                                                    volumeInputUnit: item.volumeInputUnit,
                                                                })}
                                                            </div>
                                                        </td>
                                                        <td style={{ minWidth: 180 }}>
                                                            <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)', display: 'grid', gap: '0.2rem' }}>
                                                                <div>Terkirim: {formatNumber(progressInfo.deliveredQtyKoli)} koli</div>
                                                                <div>Ditahan: {formatNumber(progressInfo.heldQtyKoli)} koli</div>
                                                                <div>Siap kirim: {formatNumber(progressInfo.pendingQtyKoli)} koli</div>
                                                            </div>
                                                        </td>
                                                        <td style={{ minWidth: 180 }}>
                                                            <FormattedNumberInput
                                                                min={0}
                                                                maxFractionDigits={2}
                                                                value={Number(selection?.qtyKoli || 0)}
                                                                disabled={!selection || creatingDO}
                                                                onValueChange={value => {
                                                                    setSelectedShipments(prev => ({
                                                                        ...prev,
                                                                        [item._id]: {
                                                                            ...(prev[item._id] || {
                                                                                holdRemaining: false,
                                                                                holdReason: '',
                                                                                holdLocation: '',
                                                                            }),
                                                                            qtyKoli: String(value),
                                                                        },
                                                                    }));
                                                                }}
                                                            />
                                                            {selection && (
                                                                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                                                                    Perkiraan berat kirim: {formatNumber(shippedWeightPreview)} kg
                                                                    {((item.volumeInputValue || 0) > 0 || (item.volume || 0) > 0) && (
                                                                        <> | Volume referensi: {formatVolumeDisplay({
                                                                            volumeM3: item.volume,
                                                                            volumeInputValue: item.volumeInputValue,
                                                                            volumeInputUnit: item.volumeInputUnit,
                                                                            includeCanonical: true,
                                                                        })}</>
                                                                    )}
                                                                </div>
                                                            )}
                                                        </td>
                                                        <td style={{ minWidth: 220 }}>
                                                            {selection ? (
                                                                <div style={{ display: 'grid', gap: '0.4rem' }}>
                                                                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.82rem' }}>
                                                                        <input
                                                                            type="checkbox"
                                                                            checked={selection.holdRemaining}
                                                                            disabled={creatingDO || remainingAfterShipment <= 0}
                                                                            onChange={e => {
                                                                                setSelectedShipments(prev => ({
                                                                                    ...prev,
                                                                                    [item._id]: {
                                                                                        ...prev[item._id],
                                                                                        holdRemaining: e.target.checked,
                                                                                    },
                                                                                }));
                                                                            }}
                                                                        />
                                                                        Tahan sisa {formatNumber(remainingAfterShipment)} koli
                                                                    </label>
                                                                    {selection.holdRemaining && remainingAfterShipment > 0 && (
                                                                        <>
                                                                            <input
                                                                                className="form-input"
                                                                                placeholder="Alasan hold, mis. gudang tujuan penuh"
                                                                                value={selection.holdReason}
                                                                                disabled={creatingDO}
                                                                                onChange={e => {
                                                                                    const value = e.target.value;
                                                                                    setSelectedShipments(prev => ({
                                                                                        ...prev,
                                                                                        [item._id]: {
                                                                                            ...prev[item._id],
                                                                                            holdReason: value,
                                                                                        },
                                                                                    }));
                                                                                }}
                                                                            />
                                                                            <input
                                                                                className="form-input"
                                                                                placeholder="Lokasi hold, mis. gudang transit"
                                                                                value={selection.holdLocation}
                                                                                disabled={creatingDO}
                                                                                onChange={e => {
                                                                                    const value = e.target.value;
                                                                                    setSelectedShipments(prev => ({
                                                                                        ...prev,
                                                                                        [item._id]: {
                                                                                            ...prev[item._id],
                                                                                            holdLocation: value,
                                                                                        },
                                                                                    }));
                                                                                }}
                                                                            />
                                                                        </>
                                                                    )}
                                                                    {!selection.holdRemaining && remainingAfterShipment > 0 && (
                                                                        <span className="text-muted text-sm">Biarkan kosong kalau seluruh sisa bisa lanjut di trip berikutnya tanpa hold.</span>
                                                                    )}
                                                                </div>
                                                            ) : (
                                                                <span className="text-muted text-sm">-</span>
                                                            )}
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setShowDOModal(false)} disabled={creatingDO}>Batal</button>
                            <button className="btn btn-primary" onClick={handleCreateDO} disabled={Object.keys(selectedShipments).length === 0 || creatingDO}>
                                <Truck size={16} /> {creatingDO ? 'Membuat Surat Jalan...' : `Buat Surat Jalan (${Object.keys(selectedShipments).length} item)`}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {showHoldModal && holdingItem && (
                <div className="modal-overlay" onClick={() => { if (!savingHold) { setShowHoldModal(false); setHoldingItem(null); } }}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3 className="modal-title">Tahan Qty Item</h3>
                            <button className="modal-close" onClick={() => { setShowHoldModal(false); setHoldingItem(null); }} disabled={savingHold}>&times;</button>
                        </div>
                        <div className="modal-body">
                            <div className="form-group">
                                <label className="form-label">Item</label>
                                <div className="detail-value">{holdingItem.description}</div>
                            </div>
                            <div className="form-group">
                                <label className="form-label">Qty hold (koli)</label>
                                <FormattedNumberInput
                                    min={0}
                                    maxFractionDigits={2}
                                    value={Number(holdQtyKoli || 0)}
                                    onValueChange={value => setHoldQtyKoli(String(value))}
                                    disabled={savingHold}
                                />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Alasan hold</label>
                                <input className="form-input" value={holdReason} onChange={e => setHoldReason(e.target.value)} disabled={savingHold} placeholder="Mis. gudang tujuan penuh" />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Lokasi hold</label>
                                <input className="form-input" value={holdLocation} onChange={e => setHoldLocation(e.target.value)} disabled={savingHold} placeholder="Mis. gudang transit Surabaya" />
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => { setShowHoldModal(false); setHoldingItem(null); }} disabled={savingHold}>Batal</button>
                            <button className="btn btn-primary" onClick={() => void saveHoldQuantity()} disabled={savingHold}>
                                {savingHold ? 'Menyimpan Hold...' : 'Simpan Hold'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
