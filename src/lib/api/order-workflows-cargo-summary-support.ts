import {
    getDeliveryOrderBillableCargoSummary,
    getDeliveryOrderNonBillableCargoSummary,
} from '@/lib/delivery-order-completion';
import {
    convertVolumeToM3,
    convertWeightToKg,
    getWeightInputFractionDigits,
} from '@/lib/measurement';
import { roundQuantity } from '@/lib/order-item-progress';
import { parseSuratJalanDocumentId } from '@/lib/trip-document-mappers';
import type { DeliveryOrder, DeliveryOrderItem } from '@/lib/types';

import { normalizeNumber, normalizeOptionalText } from './data-helpers';
import {
    normalizeDeliveryActualDropPoints,
    summarizeActualCargoInputs,
    type DeliveryOrderItemCargoSnapshot,
    type NormalizedActualCargoInput,
} from './order-workflow-support';
import { getDeliveryOrderSuratJalanIdentity } from './order-workflows-surat-jalan-support';

function hasCargoProgressPart(part: { qtyKoli: number; weight: number; volume: number }) {
    return part.qtyKoli > 0 || part.weight > 0 || part.volume > 0;
}

function ratioOrFallback(value: number, total: number, fallback: number) {
    if (total > 0) {
        return Math.min(Math.max(value / total, 0), 1);
    }
    return fallback;
}

export function preferDerivedActualCargoInputs(
    current: Map<string, NormalizedActualCargoInput>,
    derived: Map<string, NormalizedActualCargoInput> | null
) {
    if (!derived || derived.size === 0) {
        return current;
    }
    return new Map([
        ...current,
        ...derived,
    ]);
}

export function getAmbiguousActualDropMappingMessage(
    actualDropPoints: ReturnType<typeof normalizeDeliveryActualDropPoints> | undefined,
    doItems: DeliveryOrderItemCargoSnapshot[]
) {
    const points = actualDropPoints || [];
    if (points.length <= 1 || doItems.length <= 1) {
        return null;
    }

    const billableTypes = new Set(['DROP', 'EXTRA_DROP']);
    const nonBillableTypes = new Set(['HOLD', 'TRANSIT', 'RETURN']);
    const itemGroups = doItems.reduce<Map<string, DeliveryOrderItemCargoSnapshot[]>>((acc, item) => {
        const key = normalizeOptionalText(item.shipperReferenceKey) || normalizeOptionalText(item.shipperReferenceNumber) || 'TANPA-SJ';
        const current = acc.get(key) || [];
        current.push(item);
        acc.set(key, current);
        return acc;
    }, new Map());

    const dropMatchesItem = (
        point: ReturnType<typeof normalizeDeliveryActualDropPoints>[number],
        item: DeliveryOrderItemCargoSnapshot
    ) => {
        const itemRef = normalizeOptionalText(point.deliveryOrderItemRef);
        const itemRefs = Array.isArray(point.deliveryOrderItemRefs)
            ? point.deliveryOrderItemRefs.map(ref => normalizeOptionalText(ref)).filter(Boolean)
            : [];
        if (itemRef || itemRefs.length > 0) {
            return itemRef === item._id || itemRefs.includes(item._id);
        }

        const pointReferenceKey = normalizeOptionalText(point.shipperReferenceKey);
        const pointReferenceNumber = normalizeOptionalText(point.shipperReferenceNumber);
        if (!pointReferenceKey && !pointReferenceNumber) {
            return true;
        }

        return (
            (pointReferenceKey && pointReferenceKey === normalizeOptionalText(item.shipperReferenceKey)) ||
            (pointReferenceNumber && pointReferenceNumber === normalizeOptionalText(item.shipperReferenceNumber))
        );
    };

    for (const [groupKey, groupItems] of itemGroups.entries()) {
        if (groupItems.length <= 1) {
            continue;
        }

        const groupDrops = points.filter(point => groupItems.some(item => dropMatchesItem(point, item)));
        const hasBillable = groupDrops.some(point => billableTypes.has(point.stopType));
        const hasNonBillable = groupDrops.some(point => nonBillableTypes.has(point.stopType));
        if (!hasBillable || !hasNonBillable) {
            continue;
        }

        const hasAmbiguousDrop = groupDrops.some(point => {
            const itemRef = normalizeOptionalText(point.deliveryOrderItemRef);
            const itemRefs = Array.isArray(point.deliveryOrderItemRefs)
                ? point.deliveryOrderItemRefs.map(ref => normalizeOptionalText(ref)).filter(Boolean)
                : [];
            if (itemRef || itemRefs.length > 0) {
                return false;
            }
            return doItems.filter(item => dropMatchesItem(point, item)).length > 1;
        });
        if (hasAmbiguousDrop) {
            const groupLabel = groupKey === 'TANPA-SJ'
                ? 'SJ ini'
                : `SJ ${groupItems[0]?.shipperReferenceNumber || groupKey}`;
            return `${groupLabel} punya campuran drop dan hold/return. Pilih barang spesifik untuk setiap titik sebelum finalisasi agar status dan invoice per barang tidak salah.`;
        }
    }

    return null;
}

export function splitActualCargoForOrderProgress(params: {
    actualQtyKoli: number;
    actualWeight: number;
    actualVolume: number;
    deliveryOrderItemRef?: string;
    shipperReferenceNumber?: string;
    actualDropPoints?: ReturnType<typeof normalizeDeliveryActualDropPoints>;
}) {
    const actual = {
        qtyKoli: params.actualQtyKoli,
        weight: params.actualWeight,
        volume: params.actualVolume,
    };
    const empty = { qtyKoli: 0, weight: 0, volume: 0 };
    const deliveryOrderSnapshot = { actualDropPoints: params.actualDropPoints || [] };
    const referenceNumber = normalizeOptionalText(params.shipperReferenceNumber);
    const deliveryOrderItemRef = normalizeOptionalText(params.deliveryOrderItemRef);
    const billable = getDeliveryOrderBillableCargoSummary(deliveryOrderSnapshot, referenceNumber, deliveryOrderItemRef);
    const nonBillable = getDeliveryOrderNonBillableCargoSummary(deliveryOrderSnapshot, referenceNumber, deliveryOrderItemRef);
    const billablePart = {
        qtyKoli: billable.qtyKoli,
        weight: billable.weightKg,
        volume: billable.volumeM3,
    };
    const nonBillablePart = {
        qtyKoli: nonBillable.qtyKoli,
        weight: nonBillable.weightKg,
        volume: nonBillable.volumeM3,
    };
    const hasBillable = hasCargoProgressPart(billablePart);
    const hasNonBillable = hasCargoProgressPart(nonBillablePart);

    if (!hasBillable && !hasNonBillable) {
        return { delivered: actual, held: empty };
    }
    if (hasBillable && !hasNonBillable) {
        return { delivered: actual, held: empty };
    }
    if (!hasBillable && hasNonBillable) {
        return { delivered: empty, held: actual };
    }

    const total = {
        qtyKoli: roundQuantity(billablePart.qtyKoli + nonBillablePart.qtyKoli),
        weight: roundQuantity(billablePart.weight + nonBillablePart.weight),
        volume: roundQuantity(billablePart.volume + nonBillablePart.volume, 3),
    };
    const fallbackRatio = ratioOrFallback(
        billablePart.qtyKoli || billablePart.weight || billablePart.volume,
        total.qtyKoli || total.weight || total.volume,
        0
    );
    const delivered = {
        qtyKoli: roundQuantity(actual.qtyKoli * ratioOrFallback(billablePart.qtyKoli, total.qtyKoli, fallbackRatio)),
        weight: roundQuantity(actual.weight * ratioOrFallback(billablePart.weight, total.weight, fallbackRatio)),
        volume: roundQuantity(actual.volume * ratioOrFallback(billablePart.volume, total.volume, fallbackRatio), 3),
    };

    return {
        delivered,
        held: {
            qtyKoli: roundQuantity(Math.max(actual.qtyKoli - delivered.qtyKoli, 0)),
            weight: roundQuantity(Math.max(actual.weight - delivered.weight, 0)),
            volume: roundQuantity(Math.max(actual.volume - delivered.volume, 0), 3),
        },
    };
}

function createDeliveryCargoSummary() {
    return { qtyKoli: 0, weightKg: 0, volumeM3: 0 };
}

function addDeliveryCargoSummary(
    left: { qtyKoli: number; weightKg: number; volumeM3: number },
    right: { qtyKoli: number; weightKg: number; volumeM3: number }
) {
    return {
        qtyKoli: roundQuantity(left.qtyKoli + right.qtyKoli),
        weightKg: roundQuantity(left.weightKg + right.weightKg),
        volumeM3: roundQuantity(left.volumeM3 + right.volumeM3, 3),
    };
}

export function hasDeliveryCargoSummary(summary: { qtyKoli: number; weightKg: number; volumeM3: number }) {
    return summary.qtyKoli > 0 || summary.weightKg > 0 || summary.volumeM3 > 0;
}

export function summarizeSuratJalanActualCargo(
    deliveryOrder: DeliveryOrder,
    allDeliveryOrderItems: Array<Pick<DeliveryOrderItem, '_id' | 'shipperReferenceKey' | 'shipperReferenceNumber'>>,
    record: { _id: string; referenceKey?: string; suratJalanNumber?: string },
    summarizeReference: (
        deliveryOrder: DeliveryOrder,
        shipperReferenceNumber?: string,
        deliveryOrderItemRef?: string
    ) => { qtyKoli: number; weightKg: number; volumeM3: number }
) {
    const parsedReferenceKey = (() => {
        try {
            return parseSuratJalanDocumentId(record._id).referenceKey;
        } catch {
            return '';
        }
    })();
    const recordNumber = normalizeOptionalText(record.suratJalanNumber)?.toUpperCase();
    const recordItems = allDeliveryOrderItems.filter(item =>
        getDeliveryOrderSuratJalanIdentity({
            deliveryOrderId: deliveryOrder._id,
            shipperReferenceKey: item.shipperReferenceKey,
            shipperReferenceNumber: item.shipperReferenceNumber,
        }) === record._id ||
        Boolean(
            (record.referenceKey && item.shipperReferenceKey === record.referenceKey) ||
            (parsedReferenceKey && parsedReferenceKey !== 'primary' && item.shipperReferenceKey === parsedReferenceKey) ||
            (recordNumber && normalizeOptionalText(item.shipperReferenceNumber)?.toUpperCase() === recordNumber)
        )
    );
    const itemSpecificSummary = recordItems.reduce(
        (sum, item) => addDeliveryCargoSummary(sum, summarizeReference(deliveryOrder, undefined, item._id)),
        createDeliveryCargoSummary()
    );

    return hasDeliveryCargoSummary(itemSpecificSummary)
        ? itemSpecificSummary
        : summarizeReference(deliveryOrder, record.suratJalanNumber);
}

export function summarizeActualDropPointCargo(
    actualDropPoints: DeliveryOrder['actualDropPoints'] | ReturnType<typeof normalizeDeliveryActualDropPoints> | undefined,
    options?: { billableOnly?: boolean }
) {
    return (actualDropPoints || [])
        .filter(point => !options?.billableOnly || point.stopType === 'DROP' || point.stopType === 'EXTRA_DROP')
        .reduce(
            (sum, point) => addDeliveryCargoSummary(sum, {
                qtyKoli: normalizeNumber(point.qtyKoli ?? 0, { maxFractionDigits: 2 }),
                weightKg: normalizeNumber(point.weightKg ?? 0, { maxFractionDigits: 2 }) > 0
                    ? normalizeNumber(point.weightKg ?? 0, { maxFractionDigits: 2 })
                    : convertWeightToKg(
                        normalizeNumber(point.weightInputValue ?? 0, { maxFractionDigits: getWeightInputFractionDigits(point.weightInputUnit) }),
                        point.weightInputUnit || 'KG'
                    ),
                volumeM3: normalizeNumber(point.volumeM3 ?? 0, { maxFractionDigits: 3 }) > 0
                    ? normalizeNumber(point.volumeM3 ?? 0, { maxFractionDigits: 3 })
                    : convertVolumeToM3(
                        normalizeNumber(point.volumeInputValue ?? 0, { maxFractionDigits: point.volumeInputUnit === 'LITER' ? 0 : 3 }),
                        point.volumeInputUnit || 'M3'
                    ),
            }),
            createDeliveryCargoSummary()
        );
}

export const BILLABLE_PROGRESS_DROP_TYPES = new Set(['DROP', 'EXTRA_DROP']);
export const NON_BILLABLE_PROGRESS_DROP_TYPES = new Set(['HOLD', 'TRANSIT', 'RETURN']);

export function summarizeActualDropPointCargoForOrderItem(
    actualDropPoints: DeliveryOrder['actualDropPoints'] | ReturnType<typeof normalizeDeliveryActualDropPoints> | undefined,
    itemRefs: Set<string>,
    allowedTypes: Set<string>,
    shipperReferenceNumber?: string,
    doItems: DeliveryOrderItemCargoSnapshot[] = []
) {
    const normalizedReferenceNumber = normalizeOptionalText(shipperReferenceNumber)?.toUpperCase();
    const doItemById = new Map(doItems.map(item => [item._id, item]));
    const getPointCargo = (point: NonNullable<DeliveryOrder['actualDropPoints']>[number]) => ({
        qtyKoli: normalizeNumber(point.qtyKoli ?? 0, { maxFractionDigits: 2 }),
        weightKg: normalizeNumber(point.weightKg ?? 0, { maxFractionDigits: 2 }) > 0
            ? normalizeNumber(point.weightKg ?? 0, { maxFractionDigits: 2 })
            : convertWeightToKg(
                normalizeNumber(point.weightInputValue ?? 0, { maxFractionDigits: getWeightInputFractionDigits(point.weightInputUnit) }),
                point.weightInputUnit || 'KG'
            ),
        volumeM3: normalizeNumber(point.volumeM3 ?? 0, { maxFractionDigits: 3 }) > 0
            ? normalizeNumber(point.volumeM3 ?? 0, { maxFractionDigits: 3 })
            : convertVolumeToM3(
                normalizeNumber(point.volumeInputValue ?? 0, { maxFractionDigits: point.volumeInputUnit === 'LITER' ? 0 : 3 }),
                point.volumeInputUnit || 'M3'
            ),
    });
    const getItemCargoBase = (
        item: DeliveryOrderItemCargoSnapshot | undefined,
        field: 'qtyKoli' | 'weightKg' | 'volumeM3',
        nonBillable: boolean
    ) => {
        if (!item) {
            return 0;
        }
        if (nonBillable) {
            if (field === 'qtyKoli') return normalizeNumber(item.heldQtyKoli ?? 0, { maxFractionDigits: 2 });
            if (field === 'weightKg') return normalizeNumber(item.heldWeight ?? 0, { maxFractionDigits: 2 });
            return normalizeNumber(item.heldVolume ?? 0, { maxFractionDigits: 3 });
        }
        if (field === 'qtyKoli') return normalizeNumber(item.actualQtyKoli ?? item.orderItemQtyKoli ?? item.shippedQtyKoli ?? 0, { maxFractionDigits: 2 });
        if (field === 'weightKg') return normalizeNumber(item.actualWeightKg ?? item.orderItemWeight ?? item.shippedWeight ?? 0, { maxFractionDigits: 2 });
        return normalizeNumber(item.actualVolumeM3 ?? item.orderItemVolumeM3 ?? 0, { maxFractionDigits: 3 });
    };
    const allocatePointCargo = (
        point: NonNullable<DeliveryOrder['actualDropPoints']>[number],
        pointRefs: string[],
        matchedRefs: string[]
    ) => {
        const pointCargo = getPointCargo(point);
        if (pointRefs.length <= 1 || matchedRefs.length === pointRefs.length) {
            return pointCargo;
        }

        const nonBillable = NON_BILLABLE_PROGRESS_DROP_TYPES.has(point.stopType);
        const ratioFor = (field: 'qtyKoli' | 'weightKg' | 'volumeM3') => {
            const total = pointRefs.reduce((sum, ref) => sum + getItemCargoBase(doItemById.get(ref), field, nonBillable), 0);
            const matched = matchedRefs.reduce((sum, ref) => sum + getItemCargoBase(doItemById.get(ref), field, nonBillable), 0);
            if (total > 0) {
                return matched / total;
            }
            return matchedRefs.length / pointRefs.length;
        };

        return {
            qtyKoli: pointCargo.qtyKoli * ratioFor('qtyKoli'),
            weightKg: pointCargo.weightKg * ratioFor('weightKg'),
            volumeM3: pointCargo.volumeM3 * ratioFor('volumeM3'),
        };
    };
    return (actualDropPoints || [])
        .filter(point => allowedTypes.has(point.stopType))
        .reduce(
            (sum, point) => {
                const pointRefs = [
                    normalizeOptionalText(point.deliveryOrderItemRef),
                    ...((Array.isArray(point.deliveryOrderItemRefs) ? point.deliveryOrderItemRefs : [])
                        .map(ref => normalizeOptionalText(ref))
                        .filter((ref): ref is string => Boolean(ref))),
                ].filter((ref): ref is string => Boolean(ref));
                if (pointRefs.length > 0) {
                    const matchedRefs = pointRefs.filter(ref => itemRefs.has(ref));
                    return matchedRefs.length > 0
                        ? addDeliveryCargoSummary(sum, allocatePointCargo(point, pointRefs, matchedRefs))
                        : sum;
                }

                const pointReferenceNumber = normalizeOptionalText(point.shipperReferenceNumber)?.toUpperCase();
                return normalizedReferenceNumber && pointReferenceNumber === normalizedReferenceNumber
                    ? addDeliveryCargoSummary(sum, getPointCargo(point))
                    : sum;
            },
            createDeliveryCargoSummary()
        );
}

export function getActualDropTotalMismatchMessage(
    actualCargoByDoItemId: Map<string, NormalizedActualCargoInput>,
    actualDropPoints: ReturnType<typeof normalizeDeliveryActualDropPoints> | undefined,
    options?: { billableOnly?: boolean }
) {
    const actualCargoTotals = summarizeActualCargoInputs(actualCargoByDoItemId);
    const actualDropTotals = summarizeActualDropPointCargo(actualDropPoints, options);
    const dropLabel = options?.billableOnly ? 'titik drop terkirim' : 'titik realisasi';
    if (actualCargoTotals.qtyKoli > 0 && Math.abs(actualDropTotals.qtyKoli - actualCargoTotals.qtyKoli) > 0.01) {
        return `Total qty ${dropLabel} harus sama dengan qty aktual muatan.`;
    }
    if (actualCargoTotals.weightKg > 0 && Math.abs(actualDropTotals.weightKg - actualCargoTotals.weightKg) > 0.01) {
        return `Total berat ${dropLabel} harus sama dengan berat aktual muatan.`;
    }
    if (actualCargoTotals.volumeM3 > 0 && Math.abs(actualDropTotals.volumeM3 - actualCargoTotals.volumeM3) > 0.001) {
        return `Total volume ${dropLabel} harus sama dengan volume aktual muatan.`;
    }
    return null;
}
