'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useToast } from '../../layout';
import { Truck, FileText, Edit, Eye, Plus, X } from 'lucide-react';
import FormattedNumberInput from '@/components/FormattedNumberInput';
import { parseFormattedNumberish } from '@/lib/formatted-number';
import { fetchAdminCollectionData, fetchAdminData } from '@/lib/api/admin-client';
import { getBusinessDateValue } from '@/lib/business-date';
import { formatDate, formatCurrency, formatNumber, getReceivableNetAmount, ORDER_STATUS_MAP, ITEM_STATUS_MAP, DO_STATUS_MAP, INVOICE_STATUS_MAP, formatInternalDeliveryOrderNumber } from '@/lib/utils';
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
    getAvailableVehicles,
    hasCargoAggregate,
    shouldRequireVehicleOverrideReason,
    sortOrderDetailVehicles,
    type SelectedShipmentMap,
    summarizeSelectedShipments,
} from '@/lib/order-detail-support';
import {
    applyCustomerProductToOrderItem,
    createDefaultOrderItemForm,
    getDraftOrderItems,
    summarizeDraftOrderCargo,
    updateOrderItemVolumeUnit,
    updateOrderItemWeightUnit,
    type OrderItemForm,
} from '@/lib/order-create-page-support';
import { resolveOrderCargoEntryMode } from '@/lib/order-cargo-entry-mode';
import { buildServiceCapacityRangeMap, formatCapacityRangeLabel } from '@/lib/service-capacity-support';
import type { Customer, CustomerProduct, Order, OrderItem, DeliveryOrder, DeliveryOrderItem, FreightNota, FreightNotaItem, Vehicle } from '@/lib/types';
import PageBackButton from '@/components/PageBackButton';
import { hasPageAccess, hasPermission } from '@/lib/rbac';
import { useApp } from '../../layout';

function getDeliveryOrderShipperReferenceNumbers(
    deliveryOrder: Pick<DeliveryOrder, 'customerDoNumber' | 'shipperReferences'>
) {
    const references =
        Array.isArray(deliveryOrder.shipperReferences)
            ? deliveryOrder.shipperReferences
                .map(reference => reference.referenceNumber?.trim())
                .filter((value): value is string => Boolean(value))
            : [];

    if (references.length === 0 && deliveryOrder.customerDoNumber?.trim()) {
        references.push(deliveryOrder.customerDoNumber.trim());
    }

    return Array.from(new Set(references));
}

function formatDeliveryOrderShipperReferencePreview(
    deliveryOrder: Pick<DeliveryOrder, 'customerDoNumber' | 'shipperReferences'>,
    limit: number = 2
) {
    const references = getDeliveryOrderShipperReferenceNumbers(deliveryOrder);
    if (references.length === 0) {
        return null;
    }
    if (references.length <= limit) {
        return references.join(', ');
    }
    return `${references.slice(0, limit).join(', ')} +${references.length - limit} lagi`;
}

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
    const [selectedOrderTripPlanKey, setSelectedOrderTripPlanKey] = useState('');
    const [creatingDO, setCreatingDO] = useState(false);
    const [customerProducts, setCustomerProducts] = useState<CustomerProduct[]>([]);
    // DO form
    const [doDate, setDoDate] = useState(getBusinessDateValue());
    const [doCustomerDoNumber, setDoCustomerDoNumber] = useState('');
    const [doVehicle, setDoVehicle] = useState('');
    const [doVehicleOverrideReason, setDoVehicleOverrideReason] = useState('');
    const [doNotes, setDoNotes] = useState('');
    const [doReceiverName, setDoReceiverName] = useState('');
    const [doReceiverPhone, setDoReceiverPhone] = useState('');
    const [doReceiverAddress, setDoReceiverAddress] = useState('');
    const [doReceiverCompany, setDoReceiverCompany] = useState('');
    const [selectedPickupStopKeys, setSelectedPickupStopKeys] = useState<string[]>([]);
    const [shipperReferenceFormat, setShipperReferenceFormat] = useState('SJ');
    const [selectedShipments, setSelectedShipments] = useState<SelectedShipmentMap>({});
    const [directCargoItems, setDirectCargoItems] = useState<OrderItemForm[]>([createDefaultOrderItemForm()]);
    const [vehicles, setVehicles] = useState<Array<Pick<Vehicle, '_id' | 'unitCode' | 'plateNumber' | 'serviceRef' | 'serviceName' | 'capacityMin' | 'capacityMax' | 'capacityKg'>>>([]);
    const [busyVehicleIds, setBusyVehicleIds] = useState<string[]>([]);
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
    const canOpenCustomerPage = user ? hasPageAccess(user.role, 'customers') : false;
    const canOpenVehiclePage = user ? hasPageAccess(user.role, 'vehicles') : false;

    const loadOrderDetail = useCallback(async () => {
        setLoading(true);
        try {
            const [orderData, itemData, deliveryOrders, vehicleData, activeDeliveryOrders] = await Promise.all([
                fetchAdminData<Order | null>(`/api/data?entity=orders&id=${orderId}`, 'Gagal memuat detail order'),
                fetchAdminCollectionData<OrderItem[]>(`/api/data?entity=order-items&filter=${encodeURIComponent(JSON.stringify({ orderRef: orderId }))}`, 'Gagal memuat detail order'),
                fetchAdminCollectionData<DeliveryOrder[]>(`/api/data?entity=delivery-orders&filter=${encodeURIComponent(JSON.stringify({ orderRef: orderId }))}`, 'Gagal memuat detail order'),
                fetchAdminCollectionData<Array<Pick<Vehicle, '_id' | 'unitCode' | 'plateNumber' | 'serviceRef' | 'serviceName' | 'capacityMin' | 'capacityMax' | 'capacityKg'>>>(`/api/data?entity=vehicles&filter=${encodeURIComponent(JSON.stringify({ status: ['ACTIVE', 'IN_SERVICE'] }))}`, 'Gagal memuat detail order'),
                fetchAdminCollectionData<Array<Pick<DeliveryOrder, '_id' | 'vehicleRef' | 'driverRef' | 'status'>>>(`/api/data?entity=delivery-orders&filter=${encodeURIComponent(JSON.stringify({ status: ['CREATED', 'HEADING_TO_PICKUP', 'ON_DELIVERY', 'ARRIVED'] }))}`, 'Gagal memuat detail order'),
            ]);
            const deliveryOrderIds = (deliveryOrders || []).map(item => item._id);
            const [deliveryOrderItems, notaItems, customerData, customerProductData] = await Promise.all([
                deliveryOrderIds.length > 0
                    ? fetchAdminCollectionData<DeliveryOrderItem[]>(`/api/data?entity=delivery-order-items&filter=${encodeURIComponent(JSON.stringify({ deliveryOrderRef: deliveryOrderIds }))}`, 'Gagal memuat detail order')
                    : Promise.resolve([] as DeliveryOrderItem[]),
                deliveryOrderIds.length > 0
                    ? fetchAdminCollectionData<FreightNotaItem[]>(`/api/data?entity=freight-nota-items&filter=${encodeURIComponent(JSON.stringify({ doRef: deliveryOrderIds }))}`, 'Gagal memuat detail order')
                    : Promise.resolve([] as FreightNotaItem[]),
                orderData?.customerRef
                    ? fetchAdminData<Pick<Customer, 'deliveryOrderPrefix'> | null>(`/api/data?entity=customers&id=${orderData.customerRef}`, 'Gagal memuat detail order')
                    : Promise.resolve(null),
                orderData?.customerRef
                    ? fetchAdminCollectionData<CustomerProduct[]>(
                        `/api/data?entity=customer-products&filter=${encodeURIComponent(JSON.stringify({ customerRef: orderData.customerRef, active: true }))}`,
                        'Gagal memuat detail order'
                    )
                    : Promise.resolve([] as CustomerProduct[]),
            ]);
            const notaIds = [...new Set((notaItems || []).map(item => item.notaRef).filter(Boolean))];
            const orderNotas = notaIds.length > 0
                ? await fetchAdminCollectionData<FreightNota[]>(`/api/data?entity=freight-notas&filter=${encodeURIComponent(JSON.stringify({ _id: notaIds }))}`, 'Gagal memuat detail order')
                : [];

            setOrder(orderData);
            setItems(itemData || []);
            setDos([...(deliveryOrders || [])].sort((a, b) => `${b.date || ''}-${b._id}`.localeCompare(`${a.date || ''}-${a._id}`)));
            setDoItems(deliveryOrderItems);
            setNotas([...(orderNotas || [])].sort((a, b) => `${b.issueDate || ''}-${b._id}`.localeCompare(`${a.issueDate || ''}-${a._id}`)));
            setShipperReferenceFormat((customerData?.deliveryOrderPrefix || 'SJ').toUpperCase());
            setCustomerProducts((customerProductData || []).filter(product => product.active !== false));
            const { busyVehicleIds: nextBusyVehicleIds } = buildBusyAssignmentIds(activeDeliveryOrders || []);
            setVehicles(vehicleData || []);
            setBusyVehicleIds(nextBusyVehicleIds);
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
    const serviceCapacityRangeMap = buildServiceCapacityRangeMap(
        order?.serviceRef ? [{ _id: order.serviceRef, _type: 'service', code: '', name: order.serviceName || '', description: '', active: true }] : [],
        vehicles
    );
    const requestedServiceCapacityLabel = order?.serviceRef
        ? serviceCapacityRangeMap[order.serviceRef] || 'Kapasitas belum diisi'
        : 'Kategori order belum diisi';
    const internalDoPreviewPeriod = /^\d{4}-\d{2}-\d{2}$/.test(doDate)
        ? `${doDate.slice(8, 10)}${doDate.slice(5, 7)}${doDate.slice(0, 4)}`
        : 'ddmmyyyy';
    const normalizedShipperReferenceFormat = shipperReferenceFormat.trim().toUpperCase() || 'SJ';
    const shipperReferenceExample = `${normalizedShipperReferenceFormat}/27032026/001`;

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

    const updateDirectCargoItem = <K extends keyof OrderItemForm>(idx: number, field: K, value: OrderItemForm[K]) => {
        setDirectCargoItems(prev => prev.map((item, i) => (i === idx ? { ...item, [field]: value } : item)));
    };

    const addDirectCargoItem = () => {
        setDirectCargoItems(prev => [...prev, createDefaultOrderItemForm(selectedPickupStopKeys[0] || '')]);
    };

    const removeDirectCargoItem = (idx: number) => {
        setDirectCargoItems(prev => {
            const next = prev.filter((_, i) => i !== idx);
            return next.length > 0 ? next : [createDefaultOrderItemForm(selectedPickupStopKeys[0] || '')];
        });
    };

    const applyDirectCargoProductSelection = (idx: number, nextProductRef: string) => {
        const selectedProduct = customerProducts.find(product => product._id === nextProductRef);
        setDirectCargoItems(prev => prev.map((item, i) => (
            i === idx ? applyCustomerProductToOrderItem(item, selectedProduct) : item
        )));
    };

    const openCreateDOModal = (tripPlanKey?: string) => {
        const tripPlan = orderTripPlans.find(plan => plan._key === tripPlanKey) || null;
        const defaultPickupStopKey = tripPlan?.pickupStopKeys[0] || resolvedOrderPickupStops[0]?._key || '';
        setSelectedShipments({});
        setDirectCargoItems([createDefaultOrderItemForm(defaultPickupStopKey)]);
        setSelectedPickupStopKeys(
            tripPlan?.pickupStopKeys && tripPlan.pickupStopKeys.length > 0
                ? tripPlan.pickupStopKeys
                : resolvedOrderPickupStops.map(stop => stop._key)
        );
        setDoReceiverName(order?.receiverName || '');
        setDoReceiverPhone(order?.receiverPhone || '');
        setDoReceiverAddress(order?.receiverAddress || '');
        setDoReceiverCompany(order?.receiverCompany || '');
        setDoDate(tripPlan?.date || getBusinessDateValue());
        setDoVehicle(tripPlan?.vehicleRef || '');
        setDoVehicleOverrideReason(tripPlan?.vehicleCategoryOverrideReason || '');
        setDoNotes(tripPlan?.notes || '');
        setSelectedOrderTripPlanKey(tripPlan?._key || '');
        setDoCustomerDoNumber('');
        if (!doCustomerDoNumber.trim() && normalizedShipperReferenceFormat !== 'SJ') {
            setDoCustomerDoNumber(normalizedShipperReferenceFormat);
        }
        setShowDOModal(true);
    };

    const clearSelectedShipments = () => {
        setSelectedShipments({});
    };

    const {
        totals: selectedShipmentTotals,
        itemCount: selectedShipmentItemCount,
        holdCount: selectedHoldCount,
    } = summarizeSelectedShipments(availableItems, selectedShipments, itemProgressById);
    const isHeaderOnlyOrder = resolveOrderCargoEntryMode(order, items) === 'DELIVERY_ORDER';
    const orderPickupStops = (order?.pickupStops || [])
        .map((stop, index) => {
            const pickupAddress = stop.pickupAddress?.trim();
            if (!pickupAddress) {
                return null;
            }
            return {
                _key: stop._key || `pickup-stop-${index + 1}`,
                sequence: stop.sequence || index + 1,
                pickupLabel: stop.pickupLabel || '',
                pickupAddress,
                notes: stop.notes || '',
            };
        })
        .filter((stop): stop is { _key: string; sequence: number; pickupLabel: string; pickupAddress: string; notes: string } => Boolean(stop))
        .sort((left, right) => left.sequence - right.sequence);
    const resolvedOrderPickupStops =
        orderPickupStops.length > 0
            ? orderPickupStops
            : order?.pickupAddress
                ? [{
                    _key: 'pickup-stop-1',
                    sequence: 1,
                    pickupLabel: '',
                    pickupAddress: order.pickupAddress,
                    notes: '',
                }]
                : [];
    const orderTripPlans = ((order?.tripPlans || []) as NonNullable<Order['tripPlans']>)
        .map((plan, index) => ({
            ...plan,
            _key: plan._key || `order-trip-${index + 1}`,
            sequence: plan.sequence || index + 1,
            pickupStopKeys: Array.isArray(plan.pickupStopKeys) ? plan.pickupStopKeys.filter(Boolean) : [],
        }))
        .filter(plan => plan.vehicleRef && plan.driverRef && plan.issueBankRef && Number(plan.cashGiven || 0) > 0)
        .sort((left, right) => left.sequence - right.sequence);
    const selectedOrderTripPlan = orderTripPlans.find(plan => plan._key === selectedOrderTripPlanKey) || null;
    const effectiveDoVehicleRef = selectedOrderTripPlan?.vehicleRef || doVehicle;
    const selectedVehicleData = vehicles.find(vehicle => vehicle._id === effectiveDoVehicleRef);
    const selectedVehicleCapacityLabel = selectedVehicleData
        ? formatCapacityRangeLabel(selectedVehicleData)
        : 'Belum dipilih';
    const requiresVehicleOverrideReason = !selectedOrderTripPlan && shouldRequireVehicleOverrideReason(order, selectedVehicleData);
    const deliveryOrderById = new Map(dos.map(deliveryOrder => [deliveryOrder._id, deliveryOrder]));
    const hasPlannedTrips = orderTripPlans.length > 0;
    useEffect(() => {
        if (!requiresVehicleOverrideReason && doVehicleOverrideReason) {
            setDoVehicleOverrideReason('');
        }
    }, [requiresVehicleOverrideReason, doVehicleOverrideReason]);

    useEffect(() => {
        if (!selectedOrderTripPlan && doVehicle && busyVehicleIds.includes(doVehicle)) {
            setDoVehicle('');
            setDoVehicleOverrideReason('');
        }
    }, [busyVehicleIds, doVehicle, selectedOrderTripPlan]);
    const canCreateDeliveryOrder = availableItems.length > 0 || isHeaderOnlyOrder;
    const draftDirectCargoItems = getDraftOrderItems(directCargoItems);
    const directCargoSummary = summarizeDraftOrderCargo(directCargoItems);
    const selectedTripPickupStops = resolvedOrderPickupStops.filter(stop => selectedPickupStopKeys.includes(stop._key));
    const headerOnlyDeliveredMatchesTotal =
        isHeaderOnlyOrder &&
        totalDeliveredActualCargo.qtyKoli === totalOrderCargo.qtyKoli &&
        totalDeliveredActualCargo.weightKg === totalOrderCargo.weightKg &&
        totalDeliveredActualCargo.volumeM3 === totalOrderCargo.volumeM3;
    const progressSummaryLabel = hasCargoAggregate(totalOrderCargo)
        ? headerOnlyDeliveredMatchesTotal
            ? `${formatCargoSummary({
                qtyKoli: totalDeliveredActualCargo.qtyKoli,
                weightKg: totalDeliveredActualCargo.weightKg,
                volumeM3: totalDeliveredActualCargo.volumeM3,
            })} (${progress}%)`
            : `${formatCargoSummary({
                qtyKoli: totalDeliveredActualCargo.qtyKoli,
                weightKg: totalDeliveredActualCargo.weightKg,
                volumeM3: totalDeliveredActualCargo.volumeM3,
            })} / ${formatCargoSummary({
                qtyKoli: totalOrderCargo.qtyKoli,
                weightKg: totalOrderCargo.weightKg,
                volumeM3: totalOrderCargo.volumeM3,
            })} (${progress}%)`
        : 'Belum ada muatan tercatat';

    const handleCreateDO = async () => {
        const selectedItems = isHeaderOnlyOrder
            ? []
            : buildCreateDeliveryOrderItems(
                availableItems,
                selectedShipments,
                itemProgressById
            );

        if (!effectiveDoVehicleRef) {
            addToast('error', 'Pilih kendaraan sebelum membuat surat jalan');
            return;
        }
        if (resolvedOrderPickupStops.length > 0 && selectedPickupStopKeys.length === 0) {
            addToast('error', 'Pilih minimal 1 titik pickup untuk trip ini');
            return;
        }
        if (isHeaderOnlyOrder && draftDirectCargoItems.length > 0) {
            const defaultShipperReference = doCustomerDoNumber.trim().toUpperCase();
            const invalidReferenceRow = draftDirectCargoItems.findIndex(item => !(item.shipperReferenceNumber.trim() || defaultShipperReference));
            if (invalidReferenceRow >= 0) {
                addToast('error', `No. SJ pengirim wajib diisi pada barang baris ${invalidReferenceRow + 1}`);
                return;
            }
            const invalidPickupRow = draftDirectCargoItems.findIndex(item => {
                const resolvedPickupStopKey = item.pickupStopKey || (selectedTripPickupStops.length === 1 ? selectedTripPickupStops[0]._key : '');
                return resolvedOrderPickupStops.length > 0 && !resolvedPickupStopKey;
            });
            if (invalidPickupRow >= 0) {
                addToast('error', `Titik pickup wajib dipilih pada barang baris ${invalidPickupRow + 1}`);
                return;
            }
            const outOfScopePickupRow = draftDirectCargoItems.findIndex(item => {
                const resolvedPickupStopKey = item.pickupStopKey || (selectedTripPickupStops.length === 1 ? selectedTripPickupStops[0]._key : '');
                return Boolean(
                    resolvedPickupStopKey &&
                    selectedPickupStopKeys.length > 0 &&
                    !selectedPickupStopKeys.includes(resolvedPickupStopKey)
                );
            });
            if (outOfScopePickupRow >= 0) {
                addToast('error', `Titik pickup pada barang baris ${outOfScopePickupRow + 1} belum dicentang di trip ini`);
                return;
            }
        }
        if (!isHeaderOnlyOrder && selectedItems.length === 0) {
            addToast('error', 'Pilih minimal 1 item untuk surat jalan');
            return;
        }
        if (requiresVehicleOverrideReason && !doVehicleOverrideReason.trim()) {
            addToast('error', 'Isi alasan override armada jika trip ini memakai kendaraan dengan kategori berbeda');
            return;
        }
        const selVeh = vehicles.find(v => v._id === effectiveDoVehicleRef);
        const defaultShipperReference = doCustomerDoNumber.trim().toUpperCase() || undefined;
        const deliveryOrderPayload = (isHeaderOnlyOrder
            ? {
                orderRef: order?._id,
                orderTripPlanKey: selectedOrderTripPlan?._key,
                masterResi: order?.masterResi,
                customerDoNumber: defaultShipperReference,
                pickupStopKeys: selectedPickupStopKeys,
                vehicleRef: effectiveDoVehicleRef || undefined,
                vehiclePlate: selVeh?.plateNumber || '',
                driverRef: selectedOrderTripPlan?.driverRef || undefined,
                vehicleCategoryOverrideReason: selectedOrderTripPlan?.vehicleCategoryOverrideReason || (requiresVehicleOverrideReason ? doVehicleOverrideReason.trim() : undefined),
                tripRouteRateRef: selectedOrderTripPlan?.tripRouteRateRef || undefined,
                tripOriginArea: selectedOrderTripPlan?.tripOriginArea || undefined,
                tripDestinationArea: selectedOrderTripPlan?.tripDestinationArea || undefined,
                taripBorongan: selectedOrderTripPlan?.taripBorongan,
                issueBankRef: selectedOrderTripPlan?.issueBankRef || undefined,
                cashGiven: selectedOrderTripPlan?.cashGiven,
                date: doDate,
                notes: doNotes,
                customerName: order?.customerName,
                receiverName: doReceiverName.trim() || undefined,
                receiverPhone: doReceiverPhone.trim() || undefined,
                receiverAddress: doReceiverAddress.trim() || undefined,
                receiverCompany: doReceiverCompany.trim() || undefined,
                cargoItems: draftDirectCargoItems.map(item => ({
                    ...item,
                    shipperReferenceNumber: item.shipperReferenceNumber.trim().toUpperCase() || defaultShipperReference,
                    pickupStopKey: item.pickupStopKey || (selectedTripPickupStops.length === 1 ? selectedTripPickupStops[0]._key : ''),
                })),
            }
            : buildCreateDeliveryOrderRequestData({
                order,
                items: selectedItems,
                customerDoNumber: doCustomerDoNumber,
                pickupStopKeys: selectedPickupStopKeys,
                vehicleRef: effectiveDoVehicleRef,
                selectedVehicle: selVeh,
                date: doDate,
                notes: doNotes,
                requiresVehicleOverrideReason,
                vehicleOverrideReason: doVehicleOverrideReason,
                receiverName: doReceiverName,
                receiverPhone: doReceiverPhone,
                receiverAddress: doReceiverAddress,
                receiverCompany: doReceiverCompany,
            })) as Record<string, unknown>;
        if (selectedOrderTripPlan) {
            deliveryOrderPayload.orderTripPlanKey = selectedOrderTripPlan._key;
            deliveryOrderPayload.driverRef = selectedOrderTripPlan.driverRef;
            deliveryOrderPayload.tripRouteRateRef = selectedOrderTripPlan.tripRouteRateRef || undefined;
            deliveryOrderPayload.tripOriginArea = selectedOrderTripPlan.tripOriginArea || undefined;
            deliveryOrderPayload.tripDestinationArea = selectedOrderTripPlan.tripDestinationArea || undefined;
            deliveryOrderPayload.taripBorongan = selectedOrderTripPlan.taripBorongan;
            deliveryOrderPayload.issueBankRef = selectedOrderTripPlan.issueBankRef;
            deliveryOrderPayload.cashGiven = selectedOrderTripPlan.cashGiven;
            deliveryOrderPayload.vehicleCategoryOverrideReason = selectedOrderTripPlan.vehicleCategoryOverrideReason || undefined;
        }

        setCreatingDO(true);
        try {
            const doRes = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    entity: 'delivery-orders',
                    action: 'create-with-items',
                    data: deliveryOrderPayload,
                }),
            });
            const doData = await doRes.json();
            if (!doRes.ok) {
                addToast('error', doData.error || 'Gagal membuat surat jalan');
                return;
            }

            const createdShipperReferences = getDeliveryOrderShipperReferenceNumbers(doData.data || {});
            addToast(
                'success',
                `Trip dibuat: ${formatInternalDeliveryOrderNumber(doData.data || {})}${createdShipperReferences.length > 0 ? ` | ${createdShipperReferences.length} SJ: ${formatDeliveryOrderShipperReferencePreview(doData.data || {}, 3)}` : ''}${isHeaderOnlyOrder && draftDirectCargoItems.length === 0 ? ' | Barang menyusul' : ''}`
            );
            setShowDOModal(false);
            setSelectedShipments({});
            setDirectCargoItems([createDefaultOrderItemForm()]);
            setDoCustomerDoNumber('');
            setDoVehicle('');
            setDoVehicleOverrideReason('');
            setDoNotes('');
            setDoReceiverName('');
            setDoReceiverPhone('');
            setDoReceiverAddress('');
            setDoReceiverCompany('');
            setDoDate(getBusinessDateValue());
            setSelectedOrderTripPlanKey('');
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
                        holdQtyKoli: parseFormattedNumberish(holdQtyKoli),
                        holdWeightInputValue: holdWeightInputValue.trim()
                            ? parseFormattedNumberish(holdWeightInputValue, {
                                maxFractionDigits: holdWeightInputUnit === 'TON' ? 3 : 2,
                            })
                            : 0,
                        holdWeightInputUnit,
                        holdVolumeInputValue: holdVolumeInputValue.trim()
                            ? parseFormattedNumberish(holdVolumeInputValue, {
                                maxFractionDigits: holdVolumeInputUnit === 'LITER' ? 0 : 3,
                            })
                            : 0,
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
                    {!hasPlannedTrips && (
                        <button className="btn btn-primary" onClick={() => openCreateDOModal()} disabled={!canCreateDeliveryOrder}>
                            <Truck size={16} /> {isHeaderOnlyOrder && dos.length > 0 ? 'Tambah Surat Jalan' : 'Buat Surat Jalan'}
                        </button>
                    )}
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
                    {isHeaderOnlyOrder && (
                        <div style={{ marginBottom: '0.85rem', padding: '0.85rem 1rem', borderRadius: '0.75rem', border: '1px solid var(--color-gray-200)', background: 'var(--color-gray-50)', fontSize: '0.82rem', color: 'var(--color-gray-700)' }}>
                            {dos.length > 0
                                ? 'Order ini memakai flow header booking. Manifest barang tersimpan per Surat Jalan, bukan di header order.'
                                : 'Order ini masih berupa header booking. Barang, koli, dan berat akan dicatat saat Surat Jalan pertama dibuat.'}
                        </div>
                    )}
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 'var(--font-size-sm)' }}>
                        <span className="font-semibold">Progress Pengiriman Aktual</span>
                        <span className="text-muted">{progressSummaryLabel}</span>
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
                    <div className="card-header"><span className="card-header-title">{isHeaderOnlyOrder ? 'Muatan Tercatat di DO' : 'Target Order Saat Ini'}</span></div>
                    <div className="card-body">
                        <div className="detail-value" style={{ fontSize: '1.1rem', fontWeight: 700 }}>
                            {hasCargoAggregate(totalOrderCargo)
                                ? formatCargoSummary({
                                    qtyKoli: totalOrderCargo.qtyKoli,
                                    weightKg: totalOrderCargo.weightKg,
                                    volumeM3: totalOrderCargo.volumeM3,
                                })
                                : 'Belum dicatat'}
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
                            <div className="detail-item"><div className="detail-label">Customer / Pengirim / Penagih</div><div className="detail-value">{canOpenCustomerPage && order.customerRef ? <Link href={`/customers/${order.customerRef}`}>{order.customerName}</Link> : order.customerName}</div></div>
                            <div className="detail-item"><div className="detail-label">Kategori Truk / Armada</div><div className="detail-value">{order.serviceName || '-'}</div></div>
                        </div>
                        <div className="mt-2">
                            <div className="detail-label">Titik Pickup</div>
                            {resolvedOrderPickupStops.length === 0 ? (
                                <div className="detail-value">-</div>
                            ) : (
                                <div style={{ display: 'grid', gap: '0.65rem' }}>
                                    {resolvedOrderPickupStops.map((pickupStop, index) => (
                                        <div key={pickupStop._key} style={{ padding: '0.8rem 0.9rem', borderRadius: '0.75rem', border: '1px solid var(--color-gray-200)', background: 'var(--color-gray-50)' }}>
                                            <div className="detail-label">Pickup {index + 1}{pickupStop.pickupLabel ? ` · ${pickupStop.pickupLabel}` : ''}</div>
                                            <div className="detail-value">{pickupStop.pickupAddress}</div>
                                            {pickupStop.notes && <div className="text-muted text-sm" style={{ marginTop: '0.35rem' }}>{pickupStop.notes}</div>}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                        {order.notes && <div className="mt-2"><div className="detail-label">Catatan</div><div className="detail-value">{order.notes}</div></div>}
                    </div>
                </div>

                <div className="card">
                    <div className="card-header"><span className="card-header-title">Tujuan Surat Jalan</span></div>
                    <div className="card-body">
                        <div style={{ background: 'var(--color-gray-50)', borderRadius: '0.75rem', padding: '1rem 1.1rem', fontSize: '0.85rem', color: 'var(--color-gray-700)', border: '1px solid var(--color-gray-200)' }}>
                            Tujuan/penerima tidak lagi melekat di order. Field ini sekarang diisi langsung di Surat Jalan supaya setiap trip bisa fleksibel, editable, dan tidak mengunci header resi.
                        </div>
                        {(order.receiverName || order.receiverAddress || order.receiverCompany) && (
                            <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--color-gray-200)' }}>
                                <div className="detail-label" style={{ marginBottom: '0.5rem' }}>Snapshot lama pada order</div>
                                <div className="detail-row">
                                    <div className="detail-item"><div className="detail-label">Nama</div><div className="detail-value">{order.receiverName || '-'}</div></div>
                                    <div className="detail-item"><div className="detail-label">Telepon</div><div className="detail-value">{order.receiverPhone || '-'}</div></div>
                                </div>
                                <div><div className="detail-label">Alamat</div><div className="detail-value">{order.receiverAddress || '-'}</div></div>
                                {order.receiverCompany && <div className="mt-2"><div className="detail-label">Perusahaan</div><div className="detail-value">{order.receiverCompany}</div></div>}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {hasPlannedTrips && (
                <div className="card mt-6">
                    <div className="card-header">
                        <span className="card-header-title">Rencana Trip ({orderTripPlans.length})</span>
                    </div>
                    <div className="card-body" style={{ display: 'grid', gap: '1rem' }}>
                        {orderTripPlans.map(tripPlan => {
                            const linkedDeliveryOrder = tripPlan.linkedDeliveryOrderRef ? deliveryOrderById.get(tripPlan.linkedDeliveryOrderRef) : undefined;
                            const tripPlanPickupStops = resolvedOrderPickupStops.filter(stop => tripPlan.pickupStopKeys.includes(stop._key));
                            const linkedShipperReferenceCount = linkedDeliveryOrder ? getDeliveryOrderShipperReferenceNumbers(linkedDeliveryOrder).length : 0;
                            const linkedShipperReferencePreview = linkedDeliveryOrder ? formatDeliveryOrderShipperReferencePreview(linkedDeliveryOrder, 3) : null;
                            const canInputSuratJalan =
                                !linkedDeliveryOrder || linkedDeliveryOrder.status === 'CANCELLED';
                            return (
                                <div
                                    key={tripPlan._key}
                                    style={{
                                        display: 'grid',
                                        gap: '0.85rem',
                                        padding: '1rem',
                                        border: '1px solid var(--color-gray-200)',
                                        borderRadius: '0.9rem',
                                        background: 'var(--color-gray-50)',
                                    }}
                                >
                                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
                                        <div style={{ fontWeight: 700 }}>Trip {tripPlan.sequence}</div>
                                        {linkedDeliveryOrder ? (
                                            <span className={`badge badge-${DO_STATUS_MAP[linkedDeliveryOrder.status]?.color || 'gray'}`}>
                                                <span className="badge-dot" /> {linkedDeliveryOrder.status === 'CANCELLED' ? 'Bisa dibuat ulang' : `Sudah jadi DO ${formatInternalDeliveryOrderNumber(linkedDeliveryOrder)}`}
                                            </span>
                                        ) : (
                                            <span className="badge badge-blue"><span className="badge-dot" /> Siap input Surat Jalan</span>
                                        )}
                                    </div>
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.75rem' }}>
                                        <div>
                                            <div className="detail-label">Kendaraan</div>
                                            <div className="detail-value">{tripPlan.vehiclePlate || '-'}</div>
                                        </div>
                                        <div>
                                            <div className="detail-label">Supir</div>
                                            <div className="detail-value">{tripPlan.driverName || '-'}</div>
                                        </div>
                                        <div>
                                            <div className="detail-label">Upah Trip</div>
                                            <div className="detail-value">{formatCurrency(tripPlan.taripBorongan || 0)}</div>
                                        </div>
                                        <div>
                                            <div className="detail-label">Uang Jalan Awal</div>
                                            <div className="detail-value">{formatCurrency(tripPlan.cashGiven || 0)}</div>
                                        </div>
                                    </div>
                                    {linkedDeliveryOrder && (
                                        <div style={{ padding: '0.8rem 0.9rem', borderRadius: '0.75rem', background: 'var(--color-white)', border: '1px solid var(--color-gray-200)' }}>
                                            <div className="detail-label">SJ Pengirim</div>
                                            <div className="detail-value">
                                                {linkedShipperReferenceCount > 0 ? `${formatNumber(linkedShipperReferenceCount)} SJ tercatat` : 'Belum ada SJ pengirim'}
                                            </div>
                                            {linkedShipperReferencePreview && (
                                                <div className="text-muted text-sm font-mono" style={{ marginTop: '0.25rem', wordBreak: 'break-word' }}>
                                                    {linkedShipperReferencePreview}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                    <div>
                                        <div className="detail-label">Pickup Trip</div>
                                        <div style={{ display: 'grid', gap: '0.45rem', marginTop: '0.45rem' }}>
                                            {(tripPlanPickupStops.length > 0 ? tripPlanPickupStops : resolvedOrderPickupStops).map((pickupStop, index) => (
                                                <div key={`${tripPlan._key}-${pickupStop._key}`} style={{ padding: '0.7rem 0.85rem', borderRadius: '0.75rem', background: 'var(--color-white)', border: '1px solid var(--color-gray-200)' }}>
                                                    <div className="detail-label">Pickup {index + 1}{pickupStop.pickupLabel ? ` · ${pickupStop.pickupLabel}` : ''}</div>
                                                    <div className="detail-value">{pickupStop.pickupAddress}</div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                                        <div className="text-muted text-sm">
                                            {tripPlan.tripOriginArea || tripPlan.tripDestinationArea
                                                ? `${tripPlan.tripOriginArea || '-'} → ${tripPlan.tripDestinationArea || '-'}`
                                                : 'Area trip belum diisi'}
                                        </div>
                                        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                                            {linkedDeliveryOrder && (
                                                <Link href={`/delivery-orders/${linkedDeliveryOrder._id}`} className="btn btn-secondary btn-sm">
                                                    <Eye size={14} /> Kelola Trip / SJ
                                                </Link>
                                            )}
                                            {canInputSuratJalan && (
                                                <button type="button" className="btn btn-primary btn-sm" onClick={() => openCreateDOModal(tripPlan._key)}>
                                                    <Truck size={14} /> {linkedDeliveryOrder?.status === 'CANCELLED' ? 'Buat Ulang Surat Jalan' : 'Input Surat Jalan'}
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* Items */}
            <div className="card mt-6">
                <div className="card-header">
                    <span className="card-header-title">{isHeaderOnlyOrder ? `Barang / Manifest DO (${dos.length})` : `Item / Koli (${items.length})`}</span>
                </div>
                {isHeaderOnlyOrder ? (
                    <div className="card-body">
                        <div style={{ padding: '1rem 1.1rem', borderRadius: '0.75rem', background: 'var(--color-gray-50)', border: '1px solid var(--color-gray-200)', fontSize: '0.85rem', color: 'var(--color-gray-700)' }}>
                            {dos.length > 0
                                ? 'Order ini tidak menyimpan item target di header. Lihat detail Surat Jalan untuk manifest barang, koli, dan muatan yang sudah dicatat admin.'
                                : 'Belum ada item target di order ini. Barang akan dicatat saat admin membuat Surat Jalan berdasarkan dokumen dari pengirim.'}
                        </div>
                    </div>
                ) : (
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
                )}
            </div>

            {/* DOs */}
            <div className="card mt-6" id="order-surat-jalan-section">
                <div className="card-header"><span className="card-header-title">Trip / DO Internal ({dos.length})</span></div>
                <div className="table-wrapper">
                    <table>
                        <thead><tr><th>Trip / DO Internal</th><th>SJ Pengirim</th><th>Tanggal</th><th>Kendaraan</th><th>Muatan</th><th>Status</th><th>Aksi</th></tr></thead>
                        <tbody>
                            {dos.length === 0 ? (
                                <tr><td colSpan={7} className="text-center text-muted" style={{ padding: '2rem' }}>Belum ada trip / DO internal</td></tr>
                            ) : dos.map(d => {
                                const shipperReferenceNumbers = getDeliveryOrderShipperReferenceNumbers(d);
                                const shipperReferencePreview = formatDeliveryOrderShipperReferencePreview(d, 3);
                                return (
                                <tr key={d._id}>
                                    <td>
                                        <Link href={`/delivery-orders/${d._id}`} className="font-semibold" style={{ color: 'var(--color-primary)' }}>
                                            {formatInternalDeliveryOrderNumber(d)}
                                        </Link>
                                        <div className="text-muted text-sm">
                                            {d.driverName || '-'}{d.vehiclePlate ? ` / ${d.vehiclePlate}` : ''}
                                        </div>
                                    </td>
                                    <td>
                                        {shipperReferenceNumbers.length > 0 ? (
                                            <div style={{ display: 'grid', gap: '0.2rem' }}>
                                                <div className="font-medium">{formatNumber(shipperReferenceNumbers.length)} SJ pengirim</div>
                                                <div className="text-muted text-sm font-mono" style={{ wordBreak: 'break-word' }}>
                                                    {shipperReferencePreview}
                                                </div>
                                            </div>
                                        ) : (
                                            <span className="text-muted text-sm">Belum diinput</span>
                                        )}
                                    </td>
                                    <td>{formatDate(d.date)}</td>
                                    <td>{canOpenVehiclePage && d.vehicleRef ? <Link href={`/fleet/vehicles/${d.vehicleRef}`} style={{ color: 'var(--color-primary)' }}>{d.vehiclePlate || '-'}</Link> : (d.vehiclePlate || '-')}</td>
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
                                );
                            })}
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
                <div className="modal-overlay" onClick={() => { if (!creatingDO) { setShowDOModal(false); setSelectedOrderTripPlanKey(''); } }}>
                    <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3 className="modal-title">{selectedOrderTripPlan ? `Input Surat Jalan Trip ${selectedOrderTripPlan.sequence}` : 'Buat Surat Jalan'}</h3>
                            <button className="modal-close" onClick={() => { setShowDOModal(false); setSelectedOrderTripPlanKey(''); }} disabled={creatingDO}>&times;</button>
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
                                        Format referensi customer: <strong>{normalizedShipperReferenceFormat}</strong>. Kalau SJ pengirim belum turun, field ini boleh dikosongkan dulu lalu diisi belakangan, misalnya <strong>{shipperReferenceExample}</strong>.
                                    </div>
                                </div>
                            </div>
                            {selectedOrderTripPlan && (
                                <div style={{ display: 'grid', gap: '0.75rem', marginBottom: '1rem' }}>
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.75rem' }}>
                                        <div style={{ border: '1px solid var(--color-gray-200)', borderRadius: '0.75rem', padding: '0.85rem 1rem', background: 'var(--color-white)' }}>
                                            <div className="text-muted text-sm">Kendaraan</div>
                                            <div className="font-semibold" style={{ marginTop: '0.2rem' }}>{selectedOrderTripPlan.vehiclePlate || '-'}</div>
                                        </div>
                                        <div style={{ border: '1px solid var(--color-gray-200)', borderRadius: '0.75rem', padding: '0.85rem 1rem', background: 'var(--color-white)' }}>
                                            <div className="text-muted text-sm">Supir</div>
                                            <div className="font-semibold" style={{ marginTop: '0.2rem' }}>{selectedOrderTripPlan.driverName || '-'}</div>
                                        </div>
                                        <div style={{ border: '1px solid var(--color-gray-200)', borderRadius: '0.75rem', padding: '0.85rem 1rem', background: 'var(--color-white)' }}>
                                            <div className="text-muted text-sm">Upah Trip</div>
                                            <div className="font-semibold" style={{ marginTop: '0.2rem' }}>{formatCurrency(selectedOrderTripPlan.taripBorongan || 0)}</div>
                                        </div>
                                        <div style={{ border: '1px solid var(--color-gray-200)', borderRadius: '0.75rem', padding: '0.85rem 1rem', background: 'var(--color-white)' }}>
                                            <div className="text-muted text-sm">Uang Jalan Awal</div>
                                            <div className="font-semibold" style={{ marginTop: '0.2rem' }}>{formatCurrency(selectedOrderTripPlan.cashGiven || 0)}</div>
                                        </div>
                                    </div>
                                    <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                                        Armada, supir, upah trip, dan uang jalan sudah melekat di order. Di langkah ini admin tinggal input nomor Surat Jalan pengirim dan barangnya.
                                    </div>
                                </div>
                            )}
                            {!selectedOrderTripPlan && resolvedOrderPickupStops.length > 0 && (
                                <div className="form-group">
                                    <label className="form-label">Titik Pickup untuk Trip Ini</label>
                                    <div style={{ display: 'grid', gap: '0.75rem' }}>
                                        {resolvedOrderPickupStops.map((pickupStop, index) => {
                                            const checked = selectedPickupStopKeys.includes(pickupStop._key);
                                            return (
                                                <label
                                                    key={pickupStop._key}
                                                    style={{
                                                        display: 'grid',
                                                        gap: '0.25rem',
                                                        padding: '0.85rem 1rem',
                                                        borderRadius: '0.75rem',
                                                        border: checked ? '1px solid var(--color-primary)' : '1px solid var(--color-gray-200)',
                                                        background: checked ? 'var(--color-primary-50)' : 'var(--color-gray-50)',
                                                        cursor: creatingDO ? 'default' : 'pointer',
                                                    }}
                                                >
                                                    <span style={{ display: 'flex', alignItems: 'center', gap: '0.55rem' }}>
                                                        <input
                                                            type="checkbox"
                                                            checked={checked}
                                                            disabled={creatingDO}
                                                            onChange={event => {
                                                                setSelectedPickupStopKeys(previous => (
                                                                    event.target.checked
                                                                        ? [...previous, pickupStop._key]
                                                                        : previous.filter(value => value !== pickupStop._key)
                                                                ));
                                                            }}
                                                        />
                                                        <span style={{ fontWeight: 600 }}>Pickup {index + 1}{pickupStop.pickupLabel ? ` · ${pickupStop.pickupLabel}` : ''}</span>
                                                    </span>
                                                    <span className="text-muted text-sm">{pickupStop.pickupAddress}</span>
                                                    {pickupStop.notes && <span className="text-muted text-sm">{pickupStop.notes}</span>}
                                                </label>
                                            );
                                        })}
                                    </div>
                                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
                                        Satu order bisa punya banyak titik pickup. Surat Jalan ini hanya memakai pickup yang benar-benar dibawa truck ini.
                                    </div>
                                </div>
                            )}
                            {!selectedOrderTripPlan && (
                                <div className="form-row">
                                    <div className="form-group">
                                        <label className="form-label">Kendaraan</label>
                                        <select className="form-select" value={doVehicle} onChange={e => setDoVehicle(e.target.value)} disabled={creatingDO}>
                                            <option value="">Pilih kendaraan</option>
                                            {availableVehicles.map(vehicle => (
                                                <option key={vehicle._id} value={vehicle._id}>
                                                    {vehicle.unitCode ? `${vehicle.unitCode} - ` : ''}{vehicle.plateNumber}
                                                    {vehicle.serviceName ? ` (${vehicle.serviceName})` : ' (Kategori belum diisi)'} | {formatCapacityRangeLabel(vehicle)}
                                                </option>
                                            ))}
                                        </select>
                                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
                                            {availableVehicles.length === 0
                                                ? 'Tidak ada kendaraan kosong. Semua kendaraan operasional sedang dipakai DO aktif atau belum selesai.'
                                                : order.serviceRef
                                                    ? `Order meminta kategori ${order.serviceName || '-'} dengan kisaran muatan ${requestedServiceCapacityLabel}. Kendaraan kosong yang cocok ditampilkan lebih dulu, tetapi override tetap boleh jika alasannya dicatat.`
                                                    : 'Hanya kendaraan yang sedang kosong yang ditampilkan. Order ini belum punya kategori armada, jadi semua kendaraan operasional yang tidak sedang dipakai tetap tersedia.'}
                                        </div>
                                        {selectedVehicleData && (
                                            <div style={{ fontSize: '0.75rem', color: 'var(--color-primary-700)', marginTop: '0.35rem', fontWeight: 600 }}>
                                                Kendaraan terpilih: {selectedVehicleCapacityLabel}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}
                            {!selectedOrderTripPlan && requiresVehicleOverrideReason && (
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
                            <div className="form-section-title">Tujuan / Penerima Surat Jalan</div>
                            <div style={{ background: 'var(--color-gray-50)', borderRadius: '0.75rem', padding: '0.85rem 1rem', marginBottom: '1rem', fontSize: '0.82rem', color: 'var(--color-gray-700)', border: '1px solid var(--color-gray-200)' }}>
                                Field ini opsional saat surat jalan awal diterbitkan. Jika dokumen tujuan belum turun, admin atau driver bisa melengkapinya belakangan dari detail Surat Jalan.
                            </div>
                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label">Nama Penerima / PIC</label>
                                    <input
                                        className="form-input"
                                        value={doReceiverName}
                                        onChange={e => setDoReceiverName(e.target.value)}
                                        placeholder="Opsional, isi jika sudah diketahui"
                                        disabled={creatingDO}
                                    />
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Telepon</label>
                                    <input
                                        className="form-input"
                                        value={doReceiverPhone}
                                        onChange={e => setDoReceiverPhone(e.target.value)}
                                        placeholder="Opsional"
                                        disabled={creatingDO}
                                    />
                                </div>
                            </div>
                            <div className="form-group">
                                <label className="form-label">Perusahaan Penerima</label>
                                <input
                                    className="form-input"
                                    value={doReceiverCompany}
                                    onChange={e => setDoReceiverCompany(e.target.value)}
                                    placeholder="Opsional"
                                    disabled={creatingDO}
                                />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Alamat Tujuan</label>
                                <textarea
                                    className="form-textarea"
                                    rows={2}
                                    value={doReceiverAddress}
                                    onChange={e => setDoReceiverAddress(e.target.value)}
                                    placeholder="Opsional, boleh dilengkapi setelah Surat Jalan terbit"
                                    disabled={creatingDO}
                                />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Catatan</label>
                                <textarea className="form-textarea" rows={2} value={doNotes} onChange={e => setDoNotes(e.target.value)} placeholder="Catatan opsional..." disabled={creatingDO} />
                            </div>
                            <div className="form-section-title">{isHeaderOnlyOrder ? 'Input Barang Surat Jalan' : 'Pilih Item untuk DO'}</div>
                            {isHeaderOnlyOrder ? (
                                <>
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.75rem', marginBottom: '1rem' }}>
                                        <div style={{ border: '1px solid var(--color-gray-200)', borderRadius: '0.75rem', padding: '0.85rem 1rem', background: 'var(--color-white)' }}>
                                            <div className="text-muted text-sm">Barang dicatat</div>
                                            <div className="font-semibold" style={{ fontSize: '1.1rem', marginTop: '0.2rem' }}>{draftDirectCargoItems.length} item</div>
                                        </div>
                                        <div style={{ border: '1px solid var(--color-gray-200)', borderRadius: '0.75rem', padding: '0.85rem 1rem', background: 'var(--color-white)' }}>
                                            <div className="text-muted text-sm">Muatan rencana</div>
                                            <div className="font-semibold" style={{ fontSize: '0.95rem', marginTop: '0.2rem' }}>
                                                {draftDirectCargoItems.length > 0 ? formatCargoSummary(directCargoSummary) : 'Belum ada barang'}
                                            </div>
                                        </div>
                                    </div>
                                    <div style={{ background: 'var(--color-gray-50)', borderRadius: '0.75rem', padding: '0.85rem 1rem', marginBottom: '1rem', fontSize: '0.82rem', color: 'var(--color-gray-700)', border: '1px solid var(--color-gray-200)' }}>
                                        Karena order ini masih berupa header booking, barang boleh diisi sekarang atau menyusul setelah Surat Jalan terbit. Jika barang diisi sekarang, setiap baris harus jelas berasal dari titik pickup mana dan memakai nomor SJ pengirim yang mana.
                                    </div>
                                    <div style={{ display: 'grid', gap: '0.85rem' }}>
                                        {directCargoItems.map((item, idx) => (
                                            <div key={`direct-cargo-${idx}`} style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap', padding: 12, background: 'var(--color-gray-50)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-gray-200)' }}>
                                                {resolvedOrderPickupStops.length > 0 && (
                                                    <div style={{ flex: '1 1 220px' }}>
                                                        <label className="form-label">Titik Pickup</label>
                                                        <select
                                                            className="form-select"
                                                            value={item.pickupStopKey}
                                                            onChange={e => updateDirectCargoItem(idx, 'pickupStopKey', e.target.value)}
                                                            disabled={creatingDO}
                                                        >
                                                            <option value="">Pilih titik pickup</option>
                                                            {selectedTripPickupStops.map((pickupStop, pickupIndex) => (
                                                                <option key={pickupStop._key} value={pickupStop._key}>
                                                                    {`Pickup ${pickupIndex + 1}${pickupStop.pickupLabel ? ` - ${pickupStop.pickupLabel}` : ''}`}
                                                                </option>
                                                            ))}
                                                        </select>
                                                    </div>
                                                )}
                                                <div style={{ flex: '1 1 220px' }}>
                                                    <label className="form-label">No. SJ Pengirim</label>
                                                    <input
                                                        className="form-input"
                                                        value={item.shipperReferenceNumber}
                                                        onChange={e => updateDirectCargoItem(idx, 'shipperReferenceNumber', e.target.value.toUpperCase())}
                                                        placeholder={doCustomerDoNumber.trim() ? `Kosong = ikut ${doCustomerDoNumber.trim().toUpperCase()}` : 'Isi nomor SJ pengirim'}
                                                        disabled={creatingDO}
                                                    />
                                                </div>
                                                <div style={{ flex: '1 1 240px' }}>
                                                    <label className="form-label">Barang Customer</label>
                                                    <select
                                                        className="form-select"
                                                        value={item.customerProductRef}
                                                        onChange={e => applyDirectCargoProductSelection(idx, e.target.value)}
                                                        disabled={creatingDO || !order.customerRef}
                                                    >
                                                        <option value="">{customerProducts.length > 0 ? 'Pilih dari master barang customer (opsional)' : 'Belum ada master barang customer'}</option>
                                                        {customerProducts.map(product => (
                                                            <option key={product._id} value={product._id}>
                                                                {product.code ? `${product.code} - ` : ''}{product.name}
                                                            </option>
                                                        ))}
                                                    </select>
                                                </div>
                                                <div style={{ flex: '2 1 260px' }}>
                                                    <label className="form-label">Deskripsi Barang</label>
                                                    <input
                                                        className="form-input"
                                                        value={item.description}
                                                        onChange={e => updateDirectCargoItem(idx, 'description', e.target.value)}
                                                        placeholder="Mis. Oli Diesel 10W-40 / Beras 50 kg / Keramik"
                                                        disabled={creatingDO}
                                                    />
                                                </div>
                                                <div style={{ flex: '0 1 110px' }}>
                                                    <label className="form-label">Koli</label>
                                                    <FormattedNumberInput
                                                        min={0}
                                                        allowDecimal={false}
                                                        value={item.qtyKoli}
                                                        onValueChange={value => updateDirectCargoItem(idx, 'qtyKoli', value)}
                                                        disabled={creatingDO}
                                                    />
                                                </div>
                                                <div style={{ flex: '1 1 180px' }}>
                                                    <label className="form-label">Berat</label>
                                                    <div style={{ display: 'flex', gap: 8 }}>
                                                        <FormattedNumberInput
                                                            min={0}
                                                            maxFractionDigits={item.weightInputUnit === 'TON' ? 3 : 2}
                                                            value={item.weightInputValue}
                                                            onValueChange={value => updateDirectCargoItem(idx, 'weightInputValue', value)}
                                                            disabled={creatingDO}
                                                        />
                                                        <select
                                                            className="form-select"
                                                            value={item.weightInputUnit}
                                                            onChange={e => setDirectCargoItems(prev => prev.map((entry, i) => (
                                                                i === idx ? updateOrderItemWeightUnit(entry, e.target.value as WeightInputUnit) : entry
                                                            )))}
                                                            style={{ width: 92 }}
                                                            disabled={creatingDO}
                                                        >
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
                                                            onValueChange={value => updateDirectCargoItem(idx, 'volumeInputValue', value)}
                                                            disabled={creatingDO}
                                                        />
                                                        <select
                                                            className="form-select"
                                                            value={item.volumeInputUnit}
                                                            onChange={e => setDirectCargoItems(prev => prev.map((entry, i) => (
                                                                i === idx ? updateOrderItemVolumeUnit(entry, e.target.value as VolumeInputUnit) : entry
                                                            )))}
                                                            style={{ width: 92 }}
                                                            disabled={creatingDO}
                                                        >
                                                            {VOLUME_INPUT_UNIT_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                                                        </select>
                                                    </div>
                                                </div>
                                                {directCargoItems.length > 1 && (
                                                    <button type="button" className="btn btn-ghost btn-icon-only" onClick={() => removeDirectCargoItem(idx)} disabled={creatingDO} style={{ marginBottom: 4 }}>
                                                        <X size={18} />
                                                    </button>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', marginTop: '1rem' }}>
                                        <div className="text-muted text-sm">
                                            Kalau manifest belum final, Surat Jalan tetap boleh dibuat dulu. Barang bisa ditambahkan lagi setelah driver menerima tugas.
                                        </div>
                                        <button type="button" className="btn btn-secondary btn-sm" onClick={addDirectCargoItem} disabled={creatingDO}>
                                            <Plus size={14} /> Tambah Barang
                                        </button>
                                    </div>
                                </>
                            ) : (
                                <>
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
                                                const selectedQty = parseFormattedNumberish(selection?.qtyKoli || 0, { maxFractionDigits: 2 });
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
                                                                        value={parseFormattedNumberish(selection?.qtyKoli || 0, { maxFractionDigits: 2 })}
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
                                                                                            value={parseFormattedNumberish(selection.weightInputValue || 0, {
                                                                                                maxFractionDigits: (selection.weightInputUnit || 'KG') === 'TON' ? 3 : 2,
                                                                                            })}
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
                                                                                            value={parseFormattedNumberish(selection.volumeInputValue || 0, {
                                                                                                maxFractionDigits: (selection.volumeInputUnit || 'M3') === 'LITER' ? 0 : 3,
                                                                                            })}
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
                                </>
                            )}
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => { setShowDOModal(false); setSelectedOrderTripPlanKey(''); }} disabled={creatingDO}>Batal</button>
                            <button
                                className="btn btn-primary"
                                onClick={handleCreateDO}
                                disabled={creatingDO || (!isHeaderOnlyOrder && Object.keys(selectedShipments).length === 0)}
                            >
                                <Truck size={16} /> {creatingDO
                                    ? 'Membuat Surat Jalan...'
                                    : selectedOrderTripPlan
                                        ? (draftDirectCargoItems.length > 0 ? `Input Surat Jalan (${draftDirectCargoItems.length} barang)` : 'Input Surat Jalan (barang menyusul)')
                                        : isHeaderOnlyOrder
                                            ? (draftDirectCargoItems.length > 0 ? `Buat Surat Jalan (${draftDirectCargoItems.length} barang)` : 'Buat Surat Jalan (barang menyusul)')
                                            : `Buat Surat Jalan (${Object.keys(selectedShipments).length} item)`}
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
                                        value={parseFormattedNumberish(holdQtyKoli || 0, { maxFractionDigits: 2 })}
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
                                                    value={parseFormattedNumberish(holdWeightInputValue || 0, {
                                                        maxFractionDigits: holdWeightInputUnit === 'TON' ? 3 : 2,
                                                    })}
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
                                                    value={parseFormattedNumberish(holdVolumeInputValue || 0, {
                                                        maxFractionDigits: holdVolumeInputUnit === 'LITER' ? 0 : 3,
                                                    })}
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
