import { parseFormattedNumberish } from './formatted-number';

export type DeliveryCargoSummary = {
    qtyKoli: number;
    weightKg: number;
    volumeM3: number;
};

type DeliveryActualDropPointLike = {
    stopType?: string | null;
    deliveryOrderItemRef?: string | null;
    deliveryOrderItemRefs?: string[] | null;
    shipperReferenceNumber?: string | null;
    locationName?: string | null;
    locationAddress?: string | null;
    qtyKoli?: unknown;
    weightKg?: unknown;
    volumeM3?: unknown;
};

type DeliveryOrderCompletionLike = {
    status?: string | null;
    actualDropPoints?: DeliveryActualDropPointLike[] | null;
};

export type DeliveryOrderCompletionOutcome = {
    key: 'FULLY_DELIVERED' | 'PARTIALLY_DELIVERED' | 'HOLD_ONLY' | 'RETURN_ONLY' | 'NON_DELIVERY_MIXED' | 'UNKNOWN';
    label: string;
    color: string;
    billableCargo: DeliveryCargoSummary;
    nonBillableCargo: DeliveryCargoSummary;
    hasBillableCargo: boolean;
    hasNonBillableCargo: boolean;
};

const BILLABLE_ACTUAL_DROP_TYPES = new Set(['DROP', 'EXTRA_DROP']);
const HOLD_ACTUAL_DROP_TYPES = new Set(['HOLD', 'TRANSIT']);
const RETURN_ACTUAL_DROP_TYPES = new Set(['RETURN']);

function roundQuantity(value: number, fractionDigits = 3) {
    const factor = 10 ** fractionDigits;
    return Math.round(value * factor) / factor;
}

function createSummary(): DeliveryCargoSummary {
    return {
        qtyKoli: 0,
        weightKg: 0,
        volumeM3: 0,
    };
}

function addSummary(base: DeliveryCargoSummary, point: DeliveryActualDropPointLike) {
    return {
        qtyKoli: roundQuantity(base.qtyKoli + parseFormattedNumberish(point.qtyKoli || 0), 2),
        weightKg: roundQuantity(base.weightKg + parseFormattedNumberish(point.weightKg || 0), 2),
        volumeM3: roundQuantity(base.volumeM3 + parseFormattedNumberish(point.volumeM3 || 0, { maxFractionDigits: 3 }), 3),
    };
}

function normalizeStopType(value: unknown) {
    return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

function normalizeText(value: unknown) {
    return typeof value === 'string' ? value.trim() : '';
}

function hasSpecificItemReference(point: DeliveryActualDropPointLike) {
    return Boolean(
        normalizeText(point.deliveryOrderItemRef) ||
        (Array.isArray(point.deliveryOrderItemRefs) && point.deliveryOrderItemRefs.some(value => normalizeText(value)))
    );
}

function hasDeliveryOrderItemRef(point: DeliveryActualDropPointLike, deliveryOrderItemRef?: string) {
    const normalizedRef = normalizeText(deliveryOrderItemRef);
    if (!normalizedRef) {
        return true;
    }

    const refs = [
        normalizeText(point.deliveryOrderItemRef),
        ...(Array.isArray(point.deliveryOrderItemRefs)
            ? point.deliveryOrderItemRefs.map(item => normalizeText(item))
            : []),
    ].filter(Boolean);

    return refs.length === 0 || refs.includes(normalizedRef);
}

function hasCargo(summary: DeliveryCargoSummary) {
    return summary.qtyKoli > 0 || summary.weightKg > 0 || summary.volumeM3 > 0;
}

function summarizeByTypes(
    points: DeliveryActualDropPointLike[] | null | undefined,
    allowedTypes: Set<string>,
    options?: {
        shipperReferenceNumber?: string;
        deliveryOrderItemRef?: string;
        itemSpecificOnly?: boolean;
    }
) {
    const normalizedReference = normalizeText(options?.shipperReferenceNumber);
    const normalizedItemRef = normalizeText(options?.deliveryOrderItemRef);
    return (Array.isArray(points) ? points : [])
        .filter(point => allowedTypes.has(normalizeStopType(point.stopType)))
        .filter(point =>
            !normalizedReference ||
            normalizeText(point.shipperReferenceNumber) === normalizedReference
        )
        .filter(point => {
            if (!normalizedItemRef) {
                return true;
            }
            const pointHasItemRef =
                normalizeText(point.deliveryOrderItemRef) ||
                (Array.isArray(point.deliveryOrderItemRefs) && point.deliveryOrderItemRefs.some(value => normalizeText(value)));
            if (options?.itemSpecificOnly) {
                return Boolean(pointHasItemRef && hasDeliveryOrderItemRef(point, normalizedItemRef));
            }
            return hasDeliveryOrderItemRef(point, normalizedItemRef);
        })
        .reduce<DeliveryCargoSummary>((sum, point) => addSummary(sum, point), createSummary());
}

export function getDeliveryOrderBillableCargoSummary(
    deliveryOrder: DeliveryOrderCompletionLike | null | undefined,
    shipperReferenceNumber?: string,
    deliveryOrderItemRef?: string
) {
    return summarizeByTypes(deliveryOrder?.actualDropPoints, BILLABLE_ACTUAL_DROP_TYPES, {
        shipperReferenceNumber,
        deliveryOrderItemRef,
    });
}

export function getDeliveryOrderNonBillableCargoSummary(
    deliveryOrder: DeliveryOrderCompletionLike | null | undefined,
    shipperReferenceNumber?: string,
    deliveryOrderItemRef?: string
) {
    const holdSummary = summarizeByTypes(deliveryOrder?.actualDropPoints, HOLD_ACTUAL_DROP_TYPES, {
        shipperReferenceNumber,
        deliveryOrderItemRef,
    });
    const returnSummary = summarizeByTypes(deliveryOrder?.actualDropPoints, RETURN_ACTUAL_DROP_TYPES, {
        shipperReferenceNumber,
        deliveryOrderItemRef,
    });

    return {
        qtyKoli: roundQuantity(holdSummary.qtyKoli + returnSummary.qtyKoli, 2),
        weightKg: roundQuantity(holdSummary.weightKg + returnSummary.weightKg, 2),
        volumeM3: roundQuantity(holdSummary.volumeM3 + returnSummary.volumeM3, 3),
    };
}

export function getDeliveryOrderHoldCargoSummary(
    deliveryOrder: DeliveryOrderCompletionLike | null | undefined,
    shipperReferenceNumber?: string,
    deliveryOrderItemRef?: string
) {
    return summarizeByTypes(deliveryOrder?.actualDropPoints, HOLD_ACTUAL_DROP_TYPES, {
        shipperReferenceNumber,
        deliveryOrderItemRef,
    });
}

export function getDeliveryOrderReturnCargoSummary(
    deliveryOrder: DeliveryOrderCompletionLike | null | undefined,
    shipperReferenceNumber?: string,
    deliveryOrderItemRef?: string
) {
    return summarizeByTypes(deliveryOrder?.actualDropPoints, RETURN_ACTUAL_DROP_TYPES, {
        shipperReferenceNumber,
        deliveryOrderItemRef,
    });
}

export function isDeliveryOrderBillableDropType(stopType: unknown) {
    return BILLABLE_ACTUAL_DROP_TYPES.has(normalizeStopType(stopType));
}

export function isDeliveryOrderHoldDropType(stopType: unknown) {
    return HOLD_ACTUAL_DROP_TYPES.has(normalizeStopType(stopType));
}

export function isDeliveryOrderReturnDropType(stopType: unknown) {
    return RETURN_ACTUAL_DROP_TYPES.has(normalizeStopType(stopType));
}

export function hasDeliveryOrderBillableCargo(
    deliveryOrder: DeliveryOrderCompletionLike | null | undefined,
    shipperReferenceNumber?: string
) {
    return hasCargo(getDeliveryOrderBillableCargoSummary(deliveryOrder, shipperReferenceNumber));
}

export function hasDeliveryOrderItemSpecificDropMapping(
    deliveryOrder: DeliveryOrderCompletionLike | null | undefined,
    shipperReferenceNumber?: string
) {
    const normalizedReference = normalizeText(shipperReferenceNumber);
    return (Array.isArray(deliveryOrder?.actualDropPoints) ? deliveryOrder.actualDropPoints : [])
        .filter(point => !normalizedReference || normalizeText(point.shipperReferenceNumber) === normalizedReference)
        .some(point => hasSpecificItemReference(point));
}

export function hasDeliveryOrderItemSpecificBillableCargo(
    deliveryOrder: DeliveryOrderCompletionLike | null | undefined,
    shipperReferenceNumber?: string,
    deliveryOrderItemRef?: string
) {
    return hasCargo(summarizeByTypes(deliveryOrder?.actualDropPoints, BILLABLE_ACTUAL_DROP_TYPES, {
        shipperReferenceNumber,
        deliveryOrderItemRef,
        itemSpecificOnly: true,
    }));
}

export function getDeliveryOrderItemSpecificBillableCargoSummary(
    deliveryOrder: DeliveryOrderCompletionLike | null | undefined,
    shipperReferenceNumber?: string,
    deliveryOrderItemRef?: string
) {
    return summarizeByTypes(deliveryOrder?.actualDropPoints, BILLABLE_ACTUAL_DROP_TYPES, {
        shipperReferenceNumber,
        deliveryOrderItemRef,
        itemSpecificOnly: true,
    });
}

export function getDeliveryOrderActualDropDestinations(
    deliveryOrder: DeliveryOrderCompletionLike | null | undefined,
    options?: {
        shipperReferenceNumber?: string;
        billableOnly?: boolean;
        deliveryOrderItemRef?: string;
    }
) {
    const normalizedReference = normalizeText(options?.shipperReferenceNumber);
    const normalizedItemRef = normalizeText(options?.deliveryOrderItemRef);
    const points = Array.isArray(deliveryOrder?.actualDropPoints) ? deliveryOrder.actualDropPoints : [];

    return [
        ...new Set(
            points
                .filter(point => !options?.billableOnly || BILLABLE_ACTUAL_DROP_TYPES.has(normalizeStopType(point.stopType)))
                .filter(point =>
                    !normalizedReference ||
                    normalizeText(point.shipperReferenceNumber) === normalizedReference
                )
                .filter(point =>
                    !normalizedItemRef ||
                    hasDeliveryOrderItemRef(point, normalizedItemRef)
                )
                .map(point => normalizeText(point.locationAddress) || normalizeText(point.locationName))
                .filter((value): value is string => Boolean(value))
        ),
    ];
}

export function deriveDeliveryOrderCompletionOutcome(
    deliveryOrder: DeliveryOrderCompletionLike | null | undefined
): DeliveryOrderCompletionOutcome | null {
    const billableCargo = getDeliveryOrderBillableCargoSummary(deliveryOrder);
    const nonBillableCargo = getDeliveryOrderNonBillableCargoSummary(deliveryOrder);
    const hasBillableCargo = hasCargo(billableCargo);
    const hasNonBillableCargo = hasCargo(nonBillableCargo);
    const hasHoldCargo = hasCargo(summarizeByTypes(deliveryOrder?.actualDropPoints, HOLD_ACTUAL_DROP_TYPES));
    const hasReturnCargo = hasCargo(summarizeByTypes(deliveryOrder?.actualDropPoints, RETURN_ACTUAL_DROP_TYPES));

    if (!hasBillableCargo && !hasNonBillableCargo) {
        return null;
    }

    if (hasBillableCargo && !hasNonBillableCargo) {
        return {
            key: 'FULLY_DELIVERED',
            label: 'Terkirim Penuh',
            color: 'success',
            billableCargo,
            nonBillableCargo,
            hasBillableCargo,
            hasNonBillableCargo,
        };
    }

    if (hasBillableCargo && hasNonBillableCargo) {
        return {
            key: 'PARTIALLY_DELIVERED',
            label: 'Terkirim Sebagian',
            color: 'warning',
            billableCargo,
            nonBillableCargo,
            hasBillableCargo,
            hasNonBillableCargo,
        };
    }

    if (!hasBillableCargo && hasHoldCargo && !hasReturnCargo) {
        return {
            key: 'HOLD_ONLY',
            label: 'Hold / Inap',
            color: 'warning',
            billableCargo,
            nonBillableCargo,
            hasBillableCargo,
            hasNonBillableCargo,
        };
    }

    if (!hasBillableCargo && hasReturnCargo && !hasHoldCargo) {
        return {
            key: 'RETURN_ONLY',
            label: 'Retur',
            color: 'danger',
            billableCargo,
            nonBillableCargo,
            hasBillableCargo,
            hasNonBillableCargo,
        };
    }

    if (!hasBillableCargo && hasNonBillableCargo) {
        return {
            key: 'NON_DELIVERY_MIXED',
            label: 'Hold / Retur',
            color: 'warning',
            billableCargo,
            nonBillableCargo,
            hasBillableCargo,
            hasNonBillableCargo,
        };
    }

    return {
        key: 'UNKNOWN',
        label: 'Realisasi Campuran',
        color: 'primary',
        billableCargo,
        nonBillableCargo,
        hasBillableCargo,
        hasNonBillableCargo,
    };
}

export function getDeliveryOrderDisplayStatusMeta(
    deliveryOrder: DeliveryOrderCompletionLike | null | undefined
) {
    const status = normalizeText(deliveryOrder?.status).toUpperCase();
    if (status === 'DELIVERED') {
        const outcome = deriveDeliveryOrderCompletionOutcome(deliveryOrder);
        if (outcome) {
            return {
                label: outcome.label,
                color: outcome.color,
                tripClosed: true,
            };
        }
        return {
            label: 'Trip Selesai',
            color: 'success',
            tripClosed: true,
        };
    }

    switch (status) {
        case 'CREATED':
            return { label: 'Dibuat', color: 'gray', tripClosed: false };
        case 'HEADING_TO_PICKUP':
            return { label: 'Menuju Pickup', color: 'warning', tripClosed: false };
        case 'ON_DELIVERY':
            return { label: 'Dalam Pengiriman', color: 'info', tripClosed: false };
        case 'ARRIVED':
            return { label: 'Tiba di Tujuan', color: 'primary', tripClosed: false };
        case 'CANCELLED':
            return { label: 'Dibatalkan', color: 'danger', tripClosed: true };
        default:
            return {
                label: status || '-',
                color: 'gray',
                tripClosed: false,
            };
    }
}
