import { computeDeliveryOrderOvertonage } from '@/lib/delivery-order-overtonage';
import { listDocumentsByFilter } from '@/lib/repositories/document-store';
import type { DeliveryOrder, DeliveryOrderItem, FreightNotaItem, Order, TrackingLog } from '@/lib/types';

import { summarizeDeliveryOrderItems, type FreightNotaDeliveryOrderItemSource } from './finance-workflow-support';
import { extractRefId, normalizeCurrencyNumber, normalizeNumber, normalizeOptionalText } from './data-helpers';

type DeliveryOrderResponseSource = DeliveryOrder & {
    _updatedAt?: string;
};

type DeliveryOrderTrackingLogSource = Pick<TrackingLog, 'refRef' | 'status' | 'timestamp' | 'userRef' | 'userName'>;

type DeliveryOrderServiceSource = {
    _id: string;
    maxPayloadKg?: number;
    overtonaseDriverRatePerKg?: number;
};

type DeliveryOrderVehicleSource = {
    _id: string;
    capacityKg?: number;
};

type FreightNotaDeliveryOrderSource = Pick<
    DeliveryOrder,
    | '_id'
    | 'orderRef'
    | 'doNumber'
    | 'customerDoNumber'
    | 'vehiclePlate'
    | 'date'
    | 'pickupAddress'
    | 'receiverAddress'
    | 'actualDropPoints'
    | 'shipperReferences'
>;

type FreightNotaDeliveryOrderItemResponseSource = FreightNotaDeliveryOrderItemSource & {
    _id?: string;
    shipperReferenceNumber?: string;
};

type FreightNotaOrderResponseSource = Pick<Order, '_id' | 'pickupAddress' | 'receiverAddress' | 'customerRef' | 'customerName'>;

type ActualCargoSummary = {
    qtyKoli: number;
    weightKg: number;
    volumeM3: number;
};

function roundQuantity(value: number, maxFractionDigits = 3) {
    if (!Number.isFinite(value)) return 0;
    const multiplier = 10 ** maxFractionDigits;
    return Math.round(value * multiplier) / multiplier;
}

function buildActualCargoSummary(items: Array<Pick<DeliveryOrderItem, 'actualQtyKoli' | 'actualWeightKg' | 'actualVolumeM3'>>) {
    return items.reduce<ActualCargoSummary>(
        (sum, item) => ({
            qtyKoli: roundQuantity(sum.qtyKoli + normalizeNumber(item.actualQtyKoli ?? 0), 2),
            weightKg: roundQuantity(sum.weightKg + normalizeNumber(item.actualWeightKg ?? 0), 2),
            volumeM3: roundQuantity(sum.volumeM3 + normalizeNumber(item.actualVolumeM3 ?? 0), 3),
        }),
        { qtyKoli: 0, weightKg: 0, volumeM3: 0 },
    );
}

function buildFallbackActualDropPoint(deliveryOrder: DeliveryOrderResponseSource, totals: ActualCargoSummary) {
    if (
        totals.qtyKoli <= 0 &&
        totals.weightKg <= 0 &&
        totals.volumeM3 <= 0 &&
        !normalizeOptionalText(deliveryOrder.receiverAddress) &&
        !normalizeOptionalText(deliveryOrder.receiverName) &&
        !normalizeOptionalText(deliveryOrder.receiverCompany)
    ) {
        return undefined;
    }

    return {
        _key: `derived-drop-${deliveryOrder._id}`,
        sequence: 1,
        stopType: 'DROP' as const,
        locationName:
            normalizeOptionalText(deliveryOrder.receiverCompany)
            || normalizeOptionalText(deliveryOrder.receiverName)
            || 'Tujuan Tagihan',
        locationAddress: normalizeOptionalText(deliveryOrder.receiverAddress),
        qtyKoli: totals.qtyKoli > 0 ? totals.qtyKoli : undefined,
        weightKg: totals.weightKg > 0 ? totals.weightKg : undefined,
        volumeM3: totals.volumeM3 > 0 ? totals.volumeM3 : undefined,
    };
}

function resolveDeliveredTimestamp(
    deliveryOrder: DeliveryOrderResponseSource,
    trackingLogs: DeliveryOrderTrackingLogSource[]
) {
    if (normalizeOptionalText(deliveryOrder.cargoFinalizedAt)) {
        return deliveryOrder.cargoFinalizedAt;
    }

    if (deliveryOrder.status !== 'DELIVERED') {
        return deliveryOrder.cargoFinalizedAt;
    }

    const deliveredLog = [...trackingLogs]
        .filter(item => item.status === 'DELIVERED' && normalizeOptionalText(item.timestamp))
        .sort((left, right) => String(right.timestamp || '').localeCompare(String(left.timestamp || '')))[0];

    return (
        normalizeOptionalText(deliveredLog?.timestamp)
        || normalizeOptionalText(deliveryOrder.trackingStoppedAt)
        || normalizeOptionalText(deliveryOrder.trackingLastSeenAt)
        || normalizeOptionalText(deliveryOrder._updatedAt)
        || (normalizeOptionalText(deliveryOrder.podReceivedDate) ? `${deliveryOrder.podReceivedDate}T00:00:00.000Z` : undefined)
    );
}

function resolveDeliveredTrackingLog(trackingLogs: DeliveryOrderTrackingLogSource[]) {
    return [...trackingLogs]
        .filter(item => item.status === 'DELIVERED' && normalizeOptionalText(item.timestamp))
        .sort((left, right) => String(right.timestamp || '').localeCompare(String(left.timestamp || '')))[0];
}

function getActualDropDestinationForShipperReference(
    deliveryOrder: FreightNotaDeliveryOrderSource,
    shipperReferenceNumber?: string
) {
    const normalizedReferenceNumber = normalizeOptionalText(shipperReferenceNumber);
    if (!normalizedReferenceNumber) {
        return undefined;
    }

    const destinations = (deliveryOrder.actualDropPoints || [])
        .filter(point => {
            const normalizedStopType = normalizeOptionalText(point.stopType)?.toUpperCase();
            return normalizedStopType === 'DROP' || normalizedStopType === 'EXTRA_DROP';
        })
        .filter(point => normalizeOptionalText(point.shipperReferenceNumber) === normalizedReferenceNumber)
        .map(point => normalizeOptionalText(point.locationAddress) || normalizeOptionalText(point.locationName))
        .filter((value): value is string => Boolean(value));

    return destinations.length > 0 ? [...new Set(destinations)].join(', ') : undefined;
}

function resolveFreightNotaNoSj(
    item: FreightNotaItem,
    deliveryOrder: FreightNotaDeliveryOrderSource | undefined,
    linkedItems: FreightNotaDeliveryOrderItemResponseSource[],
) {
    const currentNoSj = normalizeOptionalText(item.noSJ);
    const doNumber = normalizeOptionalText(deliveryOrder?.doNumber);
    if (currentNoSj && currentNoSj !== doNumber) {
        return currentNoSj;
    }

    const uniqueItemReferences = [
        ...new Set(
            linkedItems
                .map(linkedItem => normalizeOptionalText(linkedItem.shipperReferenceNumber))
                .filter((value): value is string => Boolean(value)),
        ),
    ];
    if (uniqueItemReferences.length === 1) {
        return uniqueItemReferences[0];
    }

    return (
        normalizeOptionalText(deliveryOrder?.customerDoNumber)
        || normalizeOptionalText(deliveryOrder?.shipperReferences?.[0]?.referenceNumber)
        || currentNoSj
        || doNumber
        || ''
    );
}

export async function deriveDeliveryOrdersForResponse(deliveryOrders: DeliveryOrderResponseSource[]) {
    if (deliveryOrders.length === 0) {
        return deliveryOrders;
    }

    const deliveryOrderIds = deliveryOrders.map(item => item._id).filter(Boolean);
    const serviceRefs = [
        ...new Set(
            deliveryOrders
                .map(item => extractRefId(item.serviceRef))
                .filter((value): value is string => Boolean(value)),
        ),
    ];
    const vehicleRefs = [
        ...new Set(
            deliveryOrders
                .map(item => extractRefId(item.vehicleRef))
                .filter((value): value is string => Boolean(value)),
        ),
    ];

    const [deliveryOrderItems, trackingLogs, services, vehicles] = await Promise.all([
        listDocumentsByFilter<DeliveryOrderItem>('deliveryOrderItem', { deliveryOrderRef: deliveryOrderIds }),
        listDocumentsByFilter<DeliveryOrderTrackingLogSource>('trackingLog', { refType: 'DO', refRef: deliveryOrderIds }),
        serviceRefs.length > 0
            ? listDocumentsByFilter<DeliveryOrderServiceSource>('service', { _id: serviceRefs })
            : Promise.resolve([]),
        vehicleRefs.length > 0
            ? listDocumentsByFilter<DeliveryOrderVehicleSource>('vehicle', { _id: vehicleRefs })
            : Promise.resolve([]),
    ]);

    const itemsByDeliveryOrderRef = new Map<string, DeliveryOrderItem[]>();
    for (const item of deliveryOrderItems) {
        const deliveryOrderRef = normalizeOptionalText(item.deliveryOrderRef);
        if (!deliveryOrderRef) continue;
        const current = itemsByDeliveryOrderRef.get(deliveryOrderRef) || [];
        current.push(item);
        itemsByDeliveryOrderRef.set(deliveryOrderRef, current);
    }

    const trackingLogsByDeliveryOrderRef = new Map<string, DeliveryOrderTrackingLogSource[]>();
    for (const log of trackingLogs) {
        const deliveryOrderRef = normalizeOptionalText(log.refRef);
        if (!deliveryOrderRef) continue;
        const current = trackingLogsByDeliveryOrderRef.get(deliveryOrderRef) || [];
        current.push(log);
        trackingLogsByDeliveryOrderRef.set(deliveryOrderRef, current);
    }

    const serviceMap = new Map(services.map(item => [item._id, item]));
    const vehicleMap = new Map(vehicles.map(item => [item._id, item]));

    return deliveryOrders.map(deliveryOrder => {
        const linkedItems = itemsByDeliveryOrderRef.get(deliveryOrder._id) || [];
        const linkedTrackingLogs = trackingLogsByDeliveryOrderRef.get(deliveryOrder._id) || [];
        const deliveredTrackingLog = resolveDeliveredTrackingLog(linkedTrackingLogs);
        const actualTotals = buildActualCargoSummary(linkedItems);
        const actualTotalWeightKg =
            normalizeNumber(deliveryOrder.actualTotalWeightKg, { maxFractionDigits: 2 }) > 0
                ? normalizeNumber(deliveryOrder.actualTotalWeightKg, { maxFractionDigits: 2 })
                : actualTotals.weightKg > 0
                    ? actualTotals.weightKg
                    : undefined;
        const fallbackDropPoint = buildFallbackActualDropPoint(deliveryOrder, actualTotals);
        const actualDropPoints =
            Array.isArray(deliveryOrder.actualDropPoints) && deliveryOrder.actualDropPoints.length > 0
                ? deliveryOrder.actualDropPoints
                : fallbackDropPoint && deliveryOrder.status === 'DELIVERED'
                    ? [fallbackDropPoint]
                    : deliveryOrder.actualDropPoints;

        const service = extractRefId(deliveryOrder.serviceRef)
            ? serviceMap.get(extractRefId(deliveryOrder.serviceRef) as string)
            : undefined;
        const vehicle = extractRefId(deliveryOrder.vehicleRef)
            ? vehicleMap.get(extractRefId(deliveryOrder.vehicleRef) as string)
            : undefined;
        const serviceMaxPayloadKg =
            normalizeNumber(deliveryOrder.serviceMaxPayloadKg, { maxFractionDigits: 2 }) > 0
                ? normalizeNumber(deliveryOrder.serviceMaxPayloadKg, { maxFractionDigits: 2 })
                : normalizeNumber(service?.maxPayloadKg, { maxFractionDigits: 2 }) > 0
                    ? normalizeNumber(service?.maxPayloadKg, { maxFractionDigits: 2 })
                    : undefined;
        const vehicleCapacityKg =
            normalizeNumber(deliveryOrder.vehicleCapacityKg, { maxFractionDigits: 2 }) > 0
                ? normalizeNumber(deliveryOrder.vehicleCapacityKg, { maxFractionDigits: 2 })
                : normalizeNumber(vehicle?.capacityKg, { maxFractionDigits: 2 }) > 0
                    ? normalizeNumber(vehicle?.capacityKg, { maxFractionDigits: 2 })
                    : undefined;
        const derivedOvertonage =
            actualTotalWeightKg && actualTotalWeightKg > 0
                ? computeDeliveryOrderOvertonage({
                    actualTotalWeightKg,
                    serviceMaxPayloadKg,
                    vehicleCapacityKg,
                    baseTripFee: normalizeCurrencyNumber(deliveryOrder.baseTaripBorongan ?? deliveryOrder.taripBorongan ?? 0),
                    overtonaseDriverRatePerKg:
                        normalizeCurrencyNumber(deliveryOrder.overtonaseDriverRatePerKg ?? service?.overtonaseDriverRatePerKg ?? 0),
                })
                : null;

        return {
            ...deliveryOrder,
            actualTotalWeightKg,
            actualDropPoints,
            cargoFinalizedAt: resolveDeliveredTimestamp(deliveryOrder, linkedTrackingLogs),
            cargoFinalizedBy:
                normalizeOptionalText(deliveryOrder.cargoFinalizedBy)
                || normalizeOptionalText(deliveredTrackingLog?.userRef),
            cargoFinalizedByName:
                normalizeOptionalText(deliveryOrder.cargoFinalizedByName)
                || normalizeOptionalText(deliveredTrackingLog?.userName),
            serviceMaxPayloadKg:
                normalizeNumber(deliveryOrder.serviceMaxPayloadKg, { maxFractionDigits: 2 }) > 0
                    ? normalizeNumber(deliveryOrder.serviceMaxPayloadKg, { maxFractionDigits: 2 })
                    : derivedOvertonage?.serviceMaxPayloadKg,
            vehicleCapacityKg:
                normalizeNumber(deliveryOrder.vehicleCapacityKg, { maxFractionDigits: 2 }) > 0
                    ? normalizeNumber(deliveryOrder.vehicleCapacityKg, { maxFractionDigits: 2 })
                    : derivedOvertonage?.vehicleCapacityKg,
            overtonaseWeightKg:
                normalizeNumber(deliveryOrder.overtonaseWeightKg, { maxFractionDigits: 2 }) > 0
                    ? normalizeNumber(deliveryOrder.overtonaseWeightKg, { maxFractionDigits: 2 })
                    : derivedOvertonage?.overtonaseWeightKg,
            overtonaseDriverRatePerKg:
                normalizeCurrencyNumber(deliveryOrder.overtonaseDriverRatePerKg ?? 0) > 0
                    ? normalizeCurrencyNumber(deliveryOrder.overtonaseDriverRatePerKg ?? 0)
                    : derivedOvertonage?.overtonaseDriverRatePerKg,
            overtonaseDriverAmount:
                normalizeCurrencyNumber(deliveryOrder.overtonaseDriverAmount ?? 0) > 0
                    ? normalizeCurrencyNumber(deliveryOrder.overtonaseDriverAmount ?? 0)
                    : derivedOvertonage?.overtonaseDriverAmount,
            vehicleCapacityExceededKg:
                normalizeNumber(deliveryOrder.vehicleCapacityExceededKg, { maxFractionDigits: 2 }) > 0
                    ? normalizeNumber(deliveryOrder.vehicleCapacityExceededKg, { maxFractionDigits: 2 })
                    : derivedOvertonage?.vehicleCapacityExceededKg,
        };
    });
}

export async function deriveFreightNotaItemsForResponse(items: FreightNotaItem[]) {
    if (items.length === 0) {
        return items;
    }

    const doRefs = [
        ...new Set(
            items
                .map(item => normalizeOptionalText(item.doRef))
                .filter((value): value is string => Boolean(value)),
        ),
    ];
    const deliveryOrderItemRefs = [
        ...new Set(
            items.flatMap(item => {
                const refs = Array.isArray(item.deliveryOrderItemRefs) && item.deliveryOrderItemRefs.length > 0
                    ? item.deliveryOrderItemRefs
                    : item.deliveryOrderItemRef
                        ? [item.deliveryOrderItemRef]
                        : [];
                return refs
                    .map(value => normalizeOptionalText(value))
                    .filter((value): value is string => Boolean(value));
            }),
        ),
    ];

    const [deliveryOrders, deliveryOrderItems] = await Promise.all([
        doRefs.length > 0
            ? listDocumentsByFilter<FreightNotaDeliveryOrderSource>('deliveryOrder', { _id: doRefs })
            : Promise.resolve([]),
        doRefs.length > 0 || deliveryOrderItemRefs.length > 0
            ? listDocumentsByFilter<FreightNotaDeliveryOrderItemResponseSource>('deliveryOrderItem', {})
            : Promise.resolve([]),
    ]);

    const relevantDeliveryOrderItems = deliveryOrderItems.filter(item => {
        const itemId = normalizeOptionalText(item._id);
        const deliveryOrderRef = normalizeOptionalText(item.deliveryOrderRef);
        return (
            (itemId ? deliveryOrderItemRefs.includes(itemId) : false) ||
            (deliveryOrderRef ? doRefs.includes(deliveryOrderRef) : false)
        );
    });

    const orderRefs = [
        ...new Set(
            deliveryOrders
                .map(item => extractRefId(item.orderRef))
                .filter((value): value is string => Boolean(value)),
        ),
    ];
    const orders = orderRefs.length > 0
        ? await listDocumentsByFilter<FreightNotaOrderResponseSource>('order', { _id: orderRefs })
        : [];

    const deliveryOrderMap = new Map(deliveryOrders.map(item => [item._id, item]));
    const orderMap = new Map(orders.map(item => [item._id, item]));
    const deliveryOrderItemsByRef = new Map<string, FreightNotaDeliveryOrderItemResponseSource[]>();
    const deliveryOrderItemById = new Map<string, FreightNotaDeliveryOrderItemResponseSource>();
    for (const item of relevantDeliveryOrderItems) {
        const itemId = normalizeOptionalText(item._id);
        if (itemId) {
            deliveryOrderItemById.set(itemId, item);
        }
        const deliveryOrderRef = normalizeOptionalText(item.deliveryOrderRef);
        if (!deliveryOrderRef) continue;
        const current = deliveryOrderItemsByRef.get(deliveryOrderRef) || [];
        current.push(item);
        deliveryOrderItemsByRef.set(deliveryOrderRef, current);
    }

    return items.map(item => {
        const deliveryOrder = normalizeOptionalText(item.doRef)
            ? deliveryOrderMap.get(item.doRef as string)
            : undefined;
        if (!deliveryOrder) {
            return item;
        }

        const linkedOrder = extractRefId(deliveryOrder.orderRef)
            ? orderMap.get(extractRefId(deliveryOrder.orderRef) as string)
            : undefined;
        const rowItemRefs =
            Array.isArray(item.deliveryOrderItemRefs) && item.deliveryOrderItemRefs.length > 0
                ? item.deliveryOrderItemRefs
                : item.deliveryOrderItemRef
                    ? [item.deliveryOrderItemRef]
                    : [];
        const linkedItems = rowItemRefs
            .map(ref => deliveryOrderItemById.get(ref))
            .filter((value): value is FreightNotaDeliveryOrderItemResponseSource => Boolean(value));
        const itemSummary = linkedItems.length > 0
            ? summarizeDeliveryOrderItems(linkedItems)
            : summarizeDeliveryOrderItems(deliveryOrderItemsByRef.get(deliveryOrder._id) || []);
        const resolvedNoSj = resolveFreightNotaNoSj(item, deliveryOrder, linkedItems);
        const matchedShipperReference = (deliveryOrder.shipperReferences || []).find(reference =>
            normalizeOptionalText(reference.referenceNumber) === resolvedNoSj
        );

        return {
            ...item,
            doNumber: normalizeOptionalText(item.doNumber) || normalizeOptionalText(deliveryOrder.doNumber) || item.doNumber,
            noSJ: resolvedNoSj || item.noSJ,
            customerRef: normalizeOptionalText(item.customerRef) || normalizeOptionalText(linkedOrder?.customerRef) || item.customerRef,
            customerName: normalizeOptionalText(item.customerName) || normalizeOptionalText(linkedOrder?.customerName) || item.customerName,
            vehiclePlate: normalizeOptionalText(item.vehiclePlate) || normalizeOptionalText(deliveryOrder.vehiclePlate) || item.vehiclePlate,
            date: normalizeOptionalText(item.date) || normalizeOptionalText(deliveryOrder.date) || item.date,
            dari:
                normalizeOptionalText(item.dari)
                || normalizeOptionalText(deliveryOrder.pickupAddress)
                || normalizeOptionalText(linkedOrder?.pickupAddress)
                || item.dari,
            tujuan:
                (normalizeOptionalText(item.noSJ) === normalizeOptionalText(deliveryOrder.doNumber) || !normalizeOptionalText(item.tujuan))
                    ? (
                        normalizeOptionalText(matchedShipperReference?.receiverAddress)
                        || getActualDropDestinationForShipperReference(deliveryOrder, resolvedNoSj)
                        || normalizeOptionalText(item.tujuan)
                        || normalizeOptionalText(deliveryOrder.receiverAddress)
                        || normalizeOptionalText(linkedOrder?.receiverAddress)
                        || item.tujuan
                    )
                    : item.tujuan,
            barang: normalizeOptionalText(item.barang) || itemSummary.barang || item.barang,
            collie:
                normalizeNumber(item.collie ?? 0) > 0
                    ? normalizeNumber(item.collie ?? 0)
                    : itemSummary.collie > 0
                        ? itemSummary.collie
                        : item.collie,
            beratKg:
                normalizeNumber(item.beratKg ?? 0) > 0
                    ? normalizeNumber(item.beratKg ?? 0)
                    : itemSummary.beratKg > 0
                        ? itemSummary.beratKg
                        : item.beratKg,
        };
    });
}
