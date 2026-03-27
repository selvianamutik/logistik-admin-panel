'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useToast } from '../../layout';
import { Truck, FileText, Edit, Eye } from 'lucide-react';
import CurrencyInput from '@/components/CurrencyInput';
import FormattedNumberInput from '@/components/FormattedNumberInput';
import { fetchAdminCollectionData, fetchAdminData } from '@/lib/api/admin-client';
import { formatDate, formatCurrency, formatNumber, getReceivableNetAmount, ORDER_STATUS_MAP, ITEM_STATUS_MAP, DO_STATUS_MAP, INVOICE_STATUS_MAP, formatInternalDeliveryOrderNumber, formatShipperDeliveryOrderNumber } from '@/lib/utils';
import {
    formatCargoSummary,
    formatVolumeDisplay,
    VOLUME_INPUT_UNIT_OPTIONS,
    WEIGHT_INPUT_UNIT_OPTIONS,
    type VolumeInputUnit,
    type WeightInputUnit,
} from '@/lib/measurement';
import { calculateWeightPortion, roundQuantity } from '@/lib/order-item-progress';
import {
    buildBusyAssignmentIds,
    buildCreateDeliveryOrderItems,
    buildCreateDeliveryOrderRequestData,
    buildDefaultShipmentSelection,
    buildHoldFormState,
    buildOrderDetailMetrics,
    buildSelectedNonKoliCargo,
    createCargoAggregate,
    formatProgressLine,
    getAvailableDrivers,
    getAvailableVehicles,
    hasCargoAggregate,
    shouldRequireVehicleOverrideReason,
    sortOrderDetailVehicles,
    type SelectedShipmentMap,
    summarizeSelectedShipments,
} from '@/lib/order-detail-support';
import type { Order, OrderItem, DeliveryOrder, DeliveryOrderItem, Driver, FreightNota, FreightNotaItem, Vehicle } from '@/lib/types';
import PageBackButton from '@/components/PageBackButton';
import { hasPermission } from '@/lib/rbac';
import { useApp } from '../../layout';

export default function OrderDetailPage() {
    const params = useParams();
    const router = useRouter();
    const { user } = useApp();
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
    const [doCustomerDoNumber, setDoCustomerDoNumber] = useState('');
    const [doVehicle, setDoVehicle] = useState('');
    const [doDriver, setDoDriver] = useState('');
    const [doTripFee, setDoTripFee] = useState(0);
    const [doVehicleOverrideReason, setDoVehicleOverrideReason] = useState('');
    const [doNotes, setDoNotes] = useState('');
    const [selectedShipments, setSelectedShipments] = useState<SelectedShipmentMap>({});
    const [vehicles, setVehicles] = useState<Array<Pick<Vehicle, '_id' | 'unitCode' | 'plateNumber' | 'serviceRef' | 'serviceName'>>>([]);
    const [busyVehicleIds, setBusyVehicleIds] = useState<string[]>([]);
    const [busyDriverIds, setBusyDriverIds] = useState<string[]>([]);
    const [drivers, setDrivers] = useState<Driver[]>([]);
    const [showHoldModal, setShowHoldModal] = useState(false);
    const [holdingItem, setHoldingItem] = useState<OrderItem | null>(null);
    const [holdQtyKoli, setHoldQtyKoli] = useState('');
    const [holdWeightInputValue, setHoldWeightInputValue] = useState('');
    const [holdWeightInputUnit, setHoldWeightInputUnit] = useState<WeightInputUnit>('KG');
    const [holdVolumeInputValue, setHoldVolumeInputValue] = useState('');
    const [holdVolumeInputUnit, setHoldVolumeInputUnit] = useState<VolumeInputUnit>('M3');
    const [holdReason, setHoldReason] = useState('');
    const [holdLocation, setHoldLocation] = useState('');
    const [savingHold, setSavingHold] = useState(false);
    const canCreateInvoice = user ? hasPermission(user.role, 'freightNotas', 'create') : false;

    const loadOrderDetail = useCallback(async () => {
        setLoading(true);
        try {
            const [orderData, itemData, deliveryOrders, vehicleData, driverData, activeDeliveryOrders] = await Promise.all([
                fetchAdminData<Order | null>(`/api/data?entity=orders&id=${orderId}`, 'Gagal memuat detail order'),
                fetchAdminCollectionData<OrderItem[]>(`/api/data?entity=order-items&filter=${encodeURIComponent(JSON.stringify({ orderRef: orderId }))}`, 'Gagal memuat detail order'),
                fetchAdminCollectionData<DeliveryOrder[]>(`/api/data?entity=delivery-orders&filter=${encodeURIComponent(JSON.stringify({ orderRef: orderId }))}`, 'Gagal memuat detail order'),
                fetchAdminCollectionData<Array<Pick<Vehicle, '_id' | 'unitCode' | 'plateNumber' | 'serviceRef' | 'serviceName'>>>(`/api/data?entity=vehicles&filter=${encodeURIComponent(JSON.stringify({ status: ['ACTIVE', 'IN_SERVICE'] }))}`, 'Gagal memuat detail order'),
                fetchAdminCollectionData<Driver[]>('/api/data?entity=drivers', 'Gagal memuat detail order'),
                fetchAdminCollectionData<Array<Pick<DeliveryOrder, '_id' | 'vehicleRef' | 'driverRef' | 'status'>>>(`/api/data?entity=delivery-orders&filter=${encodeURIComponent(JSON.stringify({ status: ['CREATED', 'HEADING_TO_PICKUP', 'ON_DELIVERY', 'ARRIVED'] }))}`, 'Gagal memuat detail order'),
            ]);
            const deliveryOrderIds = (deliveryOrders || []).map(item => item._id);
            const [deliveryOrderItems, notaItems] = await Promise.all([
                deliveryOrderIds.length > 0
                    ? fetchAdminCollectionData<DeliveryOrderItem[]>(`/api/data?entity=delivery-order-items&filter=${encodeURIComponent(JSON.stringify({ deliveryOrderRef: deliveryOrderIds }))}`, 'Gagal memuat detail order')
                    : Promise.resolve([] as DeliveryOrderItem[]),
                deliveryOrderIds.length > 0
                    ? fetchAdminCollectionData<FreightNotaItem[]>(`/api/data?entity=freight-nota-items&filter=${encodeURIComponent(JSON.stringify({ doRef: deliveryOrderIds }))}`, 'Gagal memuat detail order')
                    : Promise.resolve([] as FreightNotaItem[]),
            ]);
            const notaIds = [...new Set((notaItems || []).map(item => item.notaRef).filter(Boolean))];
            const orderNotas = notaIds.length > 0
                ? await fetchAdminCollectionData<FreightNota[]>(`/api/data?entity=freight-notas&filter=${encodeURIComponent(JSON.stringify({ _id: notaIds }))}`, 'Gagal memuat detail order')
                : [];

            setOrder(orderData);
            setItems(itemData || []);
            setDos(deliveryOrders || []);
            setDoItems(deliveryOrderItems);
            setNotas(orderNotas || []);
            const { busyVehicleIds: nextBusyVehicleIds, busyDriverIds: nextBusyDriverIds } = buildBusyAssignmentIds(activeDeliveryOrders || []);
            setVehicles(vehicleData || []);
            setBusyVehicleIds(nextBusyVehicleIds);
            setBusyDriverIds(nextBusyDriverIds);
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

    const sortedVehicles = sortOrderDetailVehicles(vehicles, order);
    const availableVehicles = getAvailableVehicles(sortedVehicles, busyVehicleIds);
    const availableDrivers = getAvailableDrivers(drivers, busyDriverIds);
    const selectedVehicleData = vehicles.find(vehicle => vehicle._id === doVehicle);
    const requiresVehicleOverrideReason = shouldRequireVehicleOverrideReason(order, selectedVehicleData);
    const internalDoPreviewPeriod = /^\d{4}-\d{2}-\d{2}$/.test(doDate)
        ? `${doDate.slice(8, 10)}${doDate.slice(5, 7)}${doDate.slice(0, 4)}`
        : 'ddmmyyyy';

    useEffect(() => {
        if (!requiresVehicleOverrideReason && doVehicleOverrideReason) {
            setDoVehicleOverrideReason('');
        }
    }, [requiresVehicleOverrideReason, doVehicleOverrideReason]);

    useEffect(() => {
        if (doVehicle && busyVehicleIds.includes(doVehicle)) {
            setDoVehicle('');
            setDoVehicleOverrideReason('');
        }
    }, [busyVehicleIds, doVehicle]);

    useEffect(() => {
        if (doDriver && busyDriverIds.includes(doDriver)) {
            setDoDriver('');
        }
    }, [busyDriverIds, doDriver]);

    const {
        activeAssignmentByItemId,
        doItemByOrderItemId,
        itemProgressById,
        deliveredActualCargoByItemId,
        activePlannedCargoByItemId,
        availableItems,
        totalOrderCargo,
        totalHeldCargo,
        totalPendingCargo,
        totalDeliveredActualCargo,
        totalActivePlannedCargo,
        doPlannedCargoById,
        doActualCargoById,
        progress,
        deliveredDoCount,
    } = buildOrderDetailMetrics(items, dos, doItems);

    const createDefaultShipmentSelection = useCallback(
        (item: OrderItem): SelectedShipmentMap[string] => buildDefaultShipmentSelection(item, itemProgressById[item._id]),
        [itemProgressById]
    );

    const selectAllAvailableItems = () => {
        const nextSelections: SelectedShipmentMap = {};
        for (const item of availableItems) {
            nextSelections[item._id] = createDefaultShipmentSelection(item);
        }
        setSelectedShipments(nextSelections);
    };

    const clearSelectedShipments = () => {
        setSelectedShipments({});
    };

    const {
        totals: selectedShipmentTotals,
        itemCount: selectedShipmentItemCount,
        holdCount: selectedHoldCount,
    } = summarizeSelectedShipments(availableItems, selectedShipments, itemProgressById);

    const handleCreateDO = async () => {
        const selectedItems = buildCreateDeliveryOrderItems(
            availableItems,
            selectedShipments,
            itemProgressById
        );

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
                    data: buildCreateDeliveryOrderRequestData({
                        order,
                        items: selectedItems,
                        customerDoNumber: doCustomerDoNumber,
                        vehicleRef: doVehicle,
                        selectedVehicle: selVeh,
                        driverRef: doDriver,
                        selectedDriver: selDriver,
                        taripBorongan: doTripFee,
                        date: doDate,
                        notes: doNotes,
                        requiresVehicleOverrideReason,
                        vehicleOverrideReason: doVehicleOverrideReason,
                    }),
                }),
            });
            const doData = await doRes.json();
            if (!doRes.ok) {
                addToast('error', doData.error || 'Gagal membuat surat jalan');
                return;
            }

            addToast(
                'success',
                `Surat Jalan dibuat: ${formatInternalDeliveryOrderNumber(doData.data || {})}${doData.data?.customerDoNumber ? ` | SJ Pengirim ${formatShipperDeliveryOrderNumber(doData.data || {})}` : ''}`
            );
            setShowDOModal(false);
            setSelectedShipments({});
            setDoCustomerDoNumber('');
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
        const nextHoldState = buildHoldFormState(item, progress);
        setHoldingItem(item);
        setHoldQtyKoli(nextHoldState.holdQtyKoli);
        setHoldWeightInputValue(nextHoldState.holdWeightInputValue);
        setHoldWeightInputUnit(nextHoldState.holdWeightInputUnit);
        setHoldVolumeInputValue(nextHoldState.holdVolumeInputValue);
        setHoldVolumeInputUnit(nextHoldState.holdVolumeInputUnit);
        setHoldReason(nextHoldState.holdReason);
        setHoldLocation(nextHoldState.holdLocation);
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
                        holdWeightInputValue: holdWeightInputValue.trim() ? Number(holdWeightInputValue) : 0,
                        holdWeightInputUnit,
                        holdVolumeInputValue: holdVolumeInputValue.trim() ? Number(holdVolumeInputValue) : 0,
                        holdVolumeInputUnit,
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
            addToast('success', 'Sisa item berhasil di-hold');
            setShowHoldModal(false);
            setHoldingItem(null);
            setHoldQtyKoli('');
            setHoldWeightInputValue('');
            setHoldWeightInputUnit('KG');
            setHoldVolumeInputValue('');
            setHoldVolumeInputUnit('M3');
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
                    </div>
                </div>
                <div className="page-actions">
                    <button className="btn btn-primary" onClick={() => { setSelectedShipments({}); setShowDOModal(true); }} disabled={availableItems.length === 0}>
                        <Truck size={16} /> Buat Surat Jalan
                    </button>
                    {canCreateInvoice && (
                        <button className="btn btn-secondary" onClick={() => router.push('/invoices/new')}>
                            <FileText size={16} /> Buat Nota
                        </button>
                    )}
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
                        <span className="text-muted">
                            {formatCargoSummary({
                                qtyKoli: totalDeliveredActualCargo.qtyKoli,
                                weightKg: totalDeliveredActualCargo.weightKg,
                                volumeM3: totalDeliveredActualCargo.volumeM3,
                            })}
                            {' / '}
                            {formatCargoSummary({
                                qtyKoli: totalOrderCargo.qtyKoli,
                                weightKg: totalOrderCargo.weightKg,
                                volumeM3: totalOrderCargo.volumeM3,
                            })}{' '}
                            ({progress}%)
                        </span>
                    </div>
                    <div className="progress-bar">
                        <div className={`progress-bar-fill ${progress === 100 ? 'success' : ''}`} style={{ width: `${progress}%` }} />
                    </div>
                    <div style={{ display: 'flex', gap: 16, marginTop: 8, fontSize: 'var(--font-size-xs)', color: 'var(--color-gray-500)' }}>
                        <span style={{ color: 'var(--color-success)' }}>
                            {formatCargoSummary({
                                qtyKoli: totalDeliveredActualCargo.qtyKoli,
                                weightKg: totalDeliveredActualCargo.weightKg,
                                volumeM3: totalDeliveredActualCargo.volumeM3,
                            })} terkirim
                        </span>
                        <span style={{ color: 'var(--color-primary)' }}>
                            {formatCargoSummary({
                                qtyKoli: totalActivePlannedCargo.qtyKoli,
                                weightKg: totalActivePlannedCargo.weightKg,
                                volumeM3: totalActivePlannedCargo.volumeM3,
                            })} dalam DO
                        </span>
                        <span style={{ color: 'var(--color-warning)' }}>
                            {formatCargoSummary({
                                qtyKoli: totalHeldCargo.qtyKoli,
                                weightKg: totalHeldCargo.weightKg,
                                volumeM3: totalHeldCargo.volumeM3,
                            })} ditahan
                        </span>
                        <span>
                            {formatCargoSummary({
                                qtyKoli: totalPendingCargo.qtyKoli,
                                weightKg: totalPendingCargo.weightKg,
                                volumeM3: totalPendingCargo.volumeM3,
                            })} pending
                        </span>
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
                    </div>
                </div>
                <div className="card">
                    <div className="card-header"><span className="card-header-title">Rencana dalam DO Aktif</span></div>
                    <div className="card-body">
                        <div className="detail-value" style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--color-primary)' }}>
                            {hasCargoAggregate(totalActivePlannedCargo)
                                ? formatCargoSummary({
                                    qtyKoli: totalActivePlannedCargo.qtyKoli,
                                    weightKg: totalActivePlannedCargo.weightKg,
                                    volumeM3: totalActivePlannedCargo.volumeM3,
                                })
                                : '-'}
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
                                const usesQtyBasis = progressInfo.totalQtyKoli > 0;
                                const progressLines = [
                                    formatProgressLine('Aktual terkirim', deliveredActualCargo),
                                    formatProgressLine('Rencana dalam DO', activePlannedCargo),
                                    formatProgressLine('Hold', {
                                        qtyKoli: progressInfo.heldQtyKoli,
                                        weightKg: progressInfo.heldWeight,
                                        volumeM3: progressInfo.heldVolume,
                                    }),
                                    formatProgressLine('Sisa siap kirim', {
                                        qtyKoli: progressInfo.pendingQtyKoli,
                                        weightKg: progressInfo.pendingWeight,
                                        volumeM3: progressInfo.pendingVolume,
                                    }),
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
                                        <div className="font-medium">{item.qtyKoli > 0 ? item.qtyKoli : '-'}</div>
                                        <div className="text-muted text-sm">
                                            Aktual terkirim: {deliveredActualCargo.qtyKoli > 0 ? formatNumber(deliveredActualCargo.qtyKoli) : '-'}
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
                                        <div className="font-medium" style={{ color: hasCargoAggregate(deliveredActualCargo) ? 'var(--color-success)' : 'var(--color-gray-500)' }}>
                                            {hasCargoAggregate(deliveredActualCargo)
                                                ? formatCargoSummary({
                                                    qtyKoli: deliveredActualCargo.qtyKoli,
                                                    weightKg: deliveredActualCargo.weightKg,
                                                    volumeM3: deliveredActualCargo.volumeM3,
                                                })
                                                : 'Belum ada realisasi'}
                                        </div>
                                        {hasCargoAggregate(activePlannedCargo) && (
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
                                            {((usesQtyBasis && progressInfo.pendingQtyKoli > 0) || (!usesQtyBasis && (progressInfo.pendingWeight > 0 || progressInfo.pendingVolume > 0))) && (
                                                <button className="table-action-btn" onClick={() => openHoldModal(item)}>
                                                    {activeAssignment ? 'Tahan Sisa' : 'Set Hold'}
                                                </button>
                                            )}
                                            {((usesQtyBasis && progressInfo.heldQtyKoli > 0) || (!usesQtyBasis && (progressInfo.heldWeight > 0 || progressInfo.heldVolume > 0))) && (
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
                                    <td><Link href={`/delivery-orders/${d._id}`} className="font-semibold" style={{ color: 'var(--color-primary)' }}>{formatInternalDeliveryOrderNumber(d)}</Link>{d.customerDoNumber && <div className="text-muted text-sm font-mono">{formatShipperDeliveryOrderNumber(d)}</div>}</td>
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
                                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
                                        No. DO internal akan otomatis memakai format tanggal <strong>{internalDoPreviewPeriod}</strong>.
                                    </div>
                                </div>
                                <div className="form-group">
                                    <label className="form-label">No. SJ Pengirim</label>
                                    <input
                                        className="form-input"
                                        value={doCustomerDoNumber}
                                        onChange={e => setDoCustomerDoNumber(e.target.value.toUpperCase())}
                                        placeholder="Isi sesuai surat jalan dari pengirim"
                                        disabled={creatingDO}
                                    />
                                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
                                        Diisi manual mengikuti nomor SJ dari pengirim. Jika belum ada, boleh dikosongkan dulu.
                                    </div>
                                </div>
                            </div>
                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label">Kendaraan</label>
                                    <select className="form-select" value={doVehicle} onChange={e => setDoVehicle(e.target.value)} disabled={creatingDO}>
                                        <option value="">Pilih kendaraan</option>
                                        {availableVehicles.map(v => <option key={v._id} value={v._id}>{v.unitCode ? `${v.unitCode} - ` : ''}{v.plateNumber}{v.serviceName ? ` (${v.serviceName})` : ' (Kategori belum diisi)'}</option>)}
                                    </select>
                                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
                                        {availableVehicles.length === 0
                                            ? 'Tidak ada kendaraan kosong. Semua kendaraan operasional sedang dipakai DO aktif atau belum selesai.'
                                            : order.serviceRef
                                                ? `Kendaraan kosong yang cocok dengan kategori ${order.serviceName || '-'} ditampilkan lebih dulu. Trip parsial tetap boleh memakai armada lain jika memang diperlukan, tapi alasannya wajib dicatat.`
                                                : 'Hanya kendaraan yang sedang kosong yang ditampilkan. Order ini belum punya kategori armada, jadi semua kendaraan operasional yang tidak sedang dipakai tetap tersedia.'}
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
                                    {availableDrivers.map(driver => <option key={driver._id} value={driver._id}>{driver.name}{driver.phone ? ` - ${driver.phone}` : ''}</option>)}
                                </select>
                                {availableDrivers.length === 0 && (
                                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
                                        Tidak ada supir kosong. Semua supir aktif sedang dipakai DO yang belum selesai.
                                    </div>
                                )}
                            </div>
                            <div className="form-group">
                                <label className="form-label">Upah Trip</label>
                                <CurrencyInput
                                    value={doTripFee}
                                    onValueChange={setDoTripFee}
                                    placeholder="Ketik upah trip bila sudah diketahui"
                                    disabled={creatingDO}
                                />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Catatan</label>
                                <textarea className="form-textarea" rows={2} value={doNotes} onChange={e => setDoNotes(e.target.value)} placeholder="Catatan opsional..." disabled={creatingDO} />
                            </div>
                            <div className="form-section-title">Pilih Item untuk DO</div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.75rem', marginBottom: '1rem' }}>
                                <div style={{ border: '1px solid var(--color-gray-200)', borderRadius: '0.75rem', padding: '0.85rem 1rem', background: 'var(--color-white)' }}>
                                    <div className="text-muted text-sm">Item dipilih</div>
                                    <div className="font-semibold" style={{ fontSize: '1.1rem', marginTop: '0.2rem' }}>{selectedShipmentItemCount} item</div>
                                </div>
                                <div style={{ border: '1px solid var(--color-gray-200)', borderRadius: '0.75rem', padding: '0.85rem 1rem', background: 'var(--color-white)' }}>
                                    <div className="text-muted text-sm">Muatan trip ini</div>
                                    <div className="font-semibold" style={{ fontSize: '0.95rem', marginTop: '0.2rem' }}>
                                        {selectedShipmentItemCount > 0 ? formatCargoSummary(selectedShipmentTotals) : 'Belum ada item dipilih'}
                                    </div>
                                </div>
                                <div style={{ border: '1px solid var(--color-gray-200)', borderRadius: '0.75rem', padding: '0.85rem 1rem', background: 'var(--color-white)' }}>
                                    <div className="text-muted text-sm">Item ditahan</div>
                                    <div className="font-semibold" style={{ fontSize: '1.1rem', marginTop: '0.2rem' }}>{selectedHoldCount} item</div>
                                </div>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.9rem' }}>
                                <div className="text-muted text-sm">
                                    {selectedShipmentItemCount > 0
                                        ? 'Trip ini sudah siap dibuat. Koreksi hanya item yang memang perlu parsial atau hold.'
                                        : 'Belum ada item dipilih. Untuk trip normal, gunakan pilih semua yang siap jalan.'}
                                </div>
                                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                                    <button type="button" className="btn btn-secondary btn-sm" onClick={selectAllAvailableItems} disabled={creatingDO || availableItems.length === 0}>
                                        Pilih Semua Siap Jalan
                                    </button>
                                    <button type="button" className="btn btn-secondary btn-sm" onClick={clearSelectedShipments} disabled={creatingDO || selectedShipmentItemCount === 0}>
                                        Kosongkan Pilihan
                                    </button>
                                </div>
                            </div>
                            {availableItems.length === 0 ? (
                                <p className="text-muted text-sm">Semua item sudah masuk surat jalan</p>
                            ) : (
                                <div style={{ border: '1px solid var(--color-gray-200)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
                                    <table>
                                        <thead><tr><th style={{ width: 40 }}></th><th>Item</th><th>Progress</th><th>Rencana Kirim</th><th>Tahan Sisa (Opsional)</th></tr></thead>
                                        <tbody>
                                            {availableItems.map(item => {
                                                const selection = selectedShipments[item._id];
                                                const progressInfo = itemProgressById[item._id];
                                                const usesQtyBasis = progressInfo.totalQtyKoli > 0;
                                                const selectedQty = Number(selection?.qtyKoli || 0);
                                                const shippedWeightPreview = selectedQty > 0
                                                    ? calculateWeightPortion(progressInfo.totalWeight, progressInfo.totalQtyKoli, selectedQty)
                                                    : 0;
                                                const selectedNonKoliCargo = buildSelectedNonKoliCargo(selection);
                                                const plannedNonKoliCargo = selection
                                                    ? selectedNonKoliCargo
                                                    : {
                                                        qtyKoli: 0,
                                                        weightKg: progressInfo.pendingWeight,
                                                        volumeM3: progressInfo.pendingVolume,
                                                    };
                                                const remainingAfterShipment = roundQuantity(Math.max(progressInfo.pendingQtyKoli - selectedQty, 0));
                                                const remainingNonKoliCargo = {
                                                    qtyKoli: 0,
                                                    weightKg: roundQuantity(Math.max(progressInfo.pendingWeight - selectedNonKoliCargo.weightKg, 0)),
                                                    volumeM3: roundQuantity(Math.max(progressInfo.pendingVolume - selectedNonKoliCargo.volumeM3, 0), 3),
                                                };
                                                const hasNonKoliRemaining = hasCargoAggregate(remainingNonKoliCargo);
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
                                [item._id]: createDefaultShipmentSelection(item),
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
                                                                <div>
                                                                    Terkirim:{' '}
                                                                    {formatCargoSummary({
                                                                        qtyKoli: progressInfo.deliveredQtyKoli,
                                                                        weightKg: progressInfo.deliveredWeight,
                                                                        volumeM3: progressInfo.deliveredVolume,
                                                                    })}
                                                                </div>
                                                                <div>
                                                                    Ditahan:{' '}
                                                                    {formatCargoSummary({
                                                                        qtyKoli: progressInfo.heldQtyKoli,
                                                                        weightKg: progressInfo.heldWeight,
                                                                        volumeM3: progressInfo.heldVolume,
                                                                    })}
                                                                </div>
                                                                <div>
                                                                    Siap kirim:{' '}
                                                                    {formatCargoSummary({
                                                                        qtyKoli: progressInfo.pendingQtyKoli,
                                                                        weightKg: progressInfo.pendingWeight,
                                                                        volumeM3: progressInfo.pendingVolume,
                                                                    })}
                                                                </div>
                                                            </div>
                                                        </td>
                                                        <td style={{ minWidth: 180 }}>
                                                            {usesQtyBasis ? (
                                                                <>
                                                                    <FormattedNumberInput
                                                                        min={0}
                                                                        maxFractionDigits={2}
                                                                        value={Number(selection?.qtyKoli || 0)}
                                                                        disabled={!selection || creatingDO}
                                                                onValueChange={value => {
                                                                            setSelectedShipments(prev => ({
                                                                                ...prev,
                                                                                [item._id]: {
                                    ...(prev[item._id] || createDefaultShipmentSelection(item)),
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
                                                                </>
                                                            ) : (
                                                                <div style={{ display: 'grid', gap: '0.35rem' }}>
                                                                    {selection ? (
                                                                        <>
                                                                            {progressInfo.pendingWeight > 0 && (
                                                                                <div className="form-group" style={{ marginBottom: 0 }}>
                                                                                    <label className="form-label">Berat Kirim</label>
                                                                                    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 92px', gap: '0.5rem' }}>
                                                                                        <FormattedNumberInput
                                                                                            min={0}
                                                                                            maxFractionDigits={(selection.weightInputUnit || 'KG') === 'TON' ? 3 : 2}
                                                                                            value={Number(selection.weightInputValue || 0)}
                                                                                            disabled={!selection || creatingDO}
                                                                                            onValueChange={value => {
                                                                                                setSelectedShipments(prev => ({
                                                                                                    ...prev,
                                                                                                    [item._id]: {
                                                                                                        ...prev[item._id],
                                                                                                        weightInputValue: String(value),
                                                                                                    },
                                                                                                }));
                                                                                            }}
                                                                                        />
                                                                                        <select
                                                                                            className="form-select"
                                                                                            value={selection.weightInputUnit || 'KG'}
                                                                                            disabled={creatingDO}
                                                                                            onChange={e => {
                                                                                                setSelectedShipments(prev => ({
                                                                                                    ...prev,
                                                                                                    [item._id]: {
                                                                                                        ...prev[item._id],
                                                                                                        weightInputUnit: e.target.value as WeightInputUnit,
                                                                                                    },
                                                                                                }));
                                                                                            }}
                                                                                        >
                                                                                            {WEIGHT_INPUT_UNIT_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                                                                                        </select>
                                                                                    </div>
                                                                                </div>
                                                                            )}
                                                                            {progressInfo.pendingVolume > 0 && (
                                                                                <div className="form-group" style={{ marginBottom: 0 }}>
                                                                                    <label className="form-label">Volume Kirim</label>
                                                                                    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 92px', gap: '0.5rem' }}>
                                                                                        <FormattedNumberInput
                                                                                            min={0}
                                                                                            maxFractionDigits={(selection.volumeInputUnit || 'M3') === 'LITER' ? 0 : 3}
                                                                                            value={Number(selection.volumeInputValue || 0)}
                                                                                            disabled={!selection || creatingDO}
                                                                                            onValueChange={value => {
                                                                                                setSelectedShipments(prev => ({
                                                                                                    ...prev,
                                                                                                    [item._id]: {
                                                                                                        ...prev[item._id],
                                                                                                        volumeInputValue: String(value),
                                                                                                    },
                                                                                                }));
                                                                                            }}
                                                                                        />
                                                                                        <select
                                                                                            className="form-select"
                                                                                            value={selection.volumeInputUnit || 'M3'}
                                                                                            disabled={creatingDO}
                                                                                            onChange={e => {
                                                                                                setSelectedShipments(prev => ({
                                                                                                    ...prev,
                                                                                                    [item._id]: {
                                                                                                        ...prev[item._id],
                                                                                                        volumeInputUnit: e.target.value as VolumeInputUnit,
                                                                                                    },
                                                                                                }));
                                                                                            }}
                                                                                        >
                                                                                            {VOLUME_INPUT_UNIT_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                                                                                        </select>
                                                                                    </div>
                                                                                </div>
                                                                            )}
                                                                            <div className="detail-value" style={{ color: 'var(--color-primary)' }}>
                                                                                Yang ikut trip ini: {formatCargoSummary(plannedNonKoliCargo)}
                                                                            </div>
                                                                        </>
                                                                    ) : (
                                                                        <>
                                                                            <div className="detail-value">Centang item untuk isi berat/volume yang ikut trip ini</div>
                                                                            <div className="text-muted text-sm">
                                                                                Item ini tidak memakai basis koli, jadi parsialnya dihitung dari berat dan/atau volume.
                                                                            </div>
                                                                        </>
                                                                    )}
                                                                </div>
                                                            )}
                                                        </td>
                                                        <td style={{ minWidth: 220 }}>
                                                            {selection ? (
                                                                <div style={{ display: 'grid', gap: '0.4rem' }}>
                                                                    {usesQtyBasis ? (
                                                                        <>
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
                                                                        </>
                                                                    ) : (
                                                                        <>
                                                                            <label style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.82rem' }}>
                                                                                <input
                                                                                    type="checkbox"
                                                                                    checked={selection.holdRemaining}
                                                                                    disabled={creatingDO || !hasNonKoliRemaining}
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
                                                                                {hasNonKoliRemaining
                                                                                    ? `Tahan sisa ${formatCargoSummary(remainingNonKoliCargo)}`
                                                                                    : 'Semua sisa ikut trip ini'}
                                                                            </label>
                                                                            {selection.holdRemaining && hasNonKoliRemaining && (
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
                                                                            {!selection.holdRemaining && hasNonKoliRemaining && (
                                                                                <span className="text-muted text-sm">Biarkan kosong kalau sisa berat/volume lanjut di trip berikutnya tanpa hold.</span>
                                                                            )}
                                                                        </>
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
                            <h3 className="modal-title">Tahan Sisa Item</h3>
                            <button className="modal-close" onClick={() => { setShowHoldModal(false); setHoldingItem(null); }} disabled={savingHold}>&times;</button>
                        </div>
                        <div className="modal-body">
                            {(() => {
                                const progress = itemProgressById[holdingItem._id];
                                const usesQtyBasis = progress.totalQtyKoli > 0;
                                return (
                                    <>
                            <div className="form-group">
                                <label className="form-label">Item</label>
                                <div className="detail-value">{holdingItem.description}</div>
                            </div>
                            {usesQtyBasis ? (
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
                            ) : (
                                <>
                                    {progress.pendingWeight > 0 && (
                                        <div className="form-group">
                                            <label className="form-label">Berat Hold</label>
                                            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 92px', gap: '0.5rem' }}>
                                                <FormattedNumberInput
                                                    min={0}
                                                    maxFractionDigits={holdWeightInputUnit === 'TON' ? 3 : 2}
                                                    value={Number(holdWeightInputValue || 0)}
                                                    onValueChange={value => setHoldWeightInputValue(String(value))}
                                                    disabled={savingHold}
                                                />
                                                <select className="form-select" value={holdWeightInputUnit} onChange={e => setHoldWeightInputUnit(e.target.value as WeightInputUnit)} disabled={savingHold}>
                                                    {WEIGHT_INPUT_UNIT_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                                                </select>
                                            </div>
                                        </div>
                                    )}
                                    {progress.pendingVolume > 0 && (
                                        <div className="form-group">
                                            <label className="form-label">Volume Hold</label>
                                            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 92px', gap: '0.5rem' }}>
                                                <FormattedNumberInput
                                                    min={0}
                                                    maxFractionDigits={holdVolumeInputUnit === 'LITER' ? 0 : 3}
                                                    value={Number(holdVolumeInputValue || 0)}
                                                    onValueChange={value => setHoldVolumeInputValue(String(value))}
                                                    disabled={savingHold}
                                                />
                                                <select className="form-select" value={holdVolumeInputUnit} onChange={e => setHoldVolumeInputUnit(e.target.value as VolumeInputUnit)} disabled={savingHold}>
                                                    {VOLUME_INPUT_UNIT_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                                                </select>
                                            </div>
                                        </div>
                                    )}
                                </>
                            )}
                            <div className="form-group">
                                <label className="form-label">Alasan hold</label>
                                <input className="form-input" value={holdReason} onChange={e => setHoldReason(e.target.value)} disabled={savingHold} placeholder="Mis. gudang tujuan penuh" />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Lokasi hold</label>
                                <input className="form-input" value={holdLocation} onChange={e => setHoldLocation(e.target.value)} disabled={savingHold} placeholder="Mis. gudang transit Surabaya" />
                            </div>
                                    </>
                                );
                            })()}
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
