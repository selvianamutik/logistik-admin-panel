import { formatFormattedNumberValue, parseFormattedNumberish } from '@/components/FormattedNumberInput.helpers';
import {
    convertKgToWeightInputValue,
    convertM3ToVolumeInputValue,
    convertVolumeToM3,
    convertWeightToKg,
    getWeightInputFractionDigits,
} from '@/lib/measurement';
import type {
    ActualCargoDraft,
    ActualDropDraft,
} from '@/lib/delivery-order-detail-support';
import type {
    DeliveryOrder,
    DeliveryOrderItem,
} from '@/lib/types';

export type ActualDropItemValueDraft = Pick<
    ActualDropDraft,
    'qtyKoli' | 'weightInputValue' | 'weightInputUnit' | 'volumeInputValue' | 'volumeInputUnit'
>;

export type ActualCargoItemValueDraft = Pick<
    ActualCargoDraft,
    'actualQtyKoli' | 'actualWeightInputValue' | 'actualWeightInputUnit' | 'actualVolumeInputValue' | 'actualVolumeInputUnit'
>;

export type CargoSummary = {
    qtyKoli: number;
    weightKg: number;
    volumeM3: number;
};

export const ACTUAL_DROP_ITEM_VALUE_KEY_SEPARATOR = '::item::';

export function buildActualDropItemValueKey(draftKey: string, deliveryOrderItemRef: string) {
    return `${draftKey}${ACTUAL_DROP_ITEM_VALUE_KEY_SEPARATOR}${deliveryOrderItemRef}`;
}

export function parseActualDropItemValueKey(valueKey: string) {
    const separatorIndex = valueKey.indexOf(ACTUAL_DROP_ITEM_VALUE_KEY_SEPARATOR);
    if (separatorIndex < 0) {
        return null;
    }
    return {
        draftKey: valueKey.slice(0, separatorIndex),
        deliveryOrderItemRef: valueKey.slice(separatorIndex + ACTUAL_DROP_ITEM_VALUE_KEY_SEPARATOR.length),
    };
}

export function pickActualDropItemValues(drop: ActualDropDraft): ActualDropItemValueDraft {
    return {
        qtyKoli: drop.qtyKoli,
        weightInputValue: drop.weightInputValue,
        weightInputUnit: drop.weightInputUnit,
        volumeInputValue: drop.volumeInputValue,
        volumeInputUnit: drop.volumeInputUnit,
    };
}

export function hasActualDropItemValues(values: ActualDropItemValueDraft) {
    const qtyKoli = parseFormattedNumberish(values.qtyKoli || 0, { maxFractionDigits: 2 });
    const weightKg = convertWeightToKg(
        parseFormattedNumberish(values.weightInputValue || 0, {
            maxFractionDigits: getWeightInputFractionDigits(values.weightInputUnit),
        }),
        values.weightInputUnit
    );
    const volumeM3 = convertVolumeToM3(
        parseFormattedNumberish(values.volumeInputValue || 0, {
            maxFractionDigits: values.volumeInputUnit === 'LITER' ? 0 : 3,
        }),
        values.volumeInputUnit
    );
    return qtyKoli > 0 || weightKg > 0 || volumeM3 > 0;
}

export function hasActualDropItemInput(values: ActualDropItemValueDraft) {
    return (
        values.qtyKoli.trim() !== '' ||
        values.weightInputValue.trim() !== '' ||
        values.volumeInputValue.trim() !== ''
    );
}

export function hasDeliveryOrderItemActualCargo(item: Pick<DeliveryOrderItem, 'actualQtyKoli' | 'actualWeightKg' | 'actualVolumeM3'>) {
    return (
        (item.actualQtyKoli || 0) > 0 ||
        (item.actualWeightKg || 0) > 0 ||
        (item.actualVolumeM3 || 0) > 0
    );
}

export function hasCargoSummaryValue(summary: CargoSummary) {
    return summary.qtyKoli > 0 || summary.weightKg > 0 || summary.volumeM3 > 0;
}

export function summarizeActualDropItemValues(values: ActualDropItemValueDraft): CargoSummary {
    return {
        qtyKoli: parseFormattedNumberish(values.qtyKoli || 0, { maxFractionDigits: 2 }),
        weightKg: convertWeightToKg(
            parseFormattedNumberish(values.weightInputValue || 0, {
                maxFractionDigits: getWeightInputFractionDigits(values.weightInputUnit),
            }),
            values.weightInputUnit
        ),
        volumeM3: convertVolumeToM3(
            parseFormattedNumberish(values.volumeInputValue || 0, {
                maxFractionDigits: values.volumeInputUnit === 'LITER' ? 0 : 3,
            }),
            values.volumeInputUnit
        ),
    };
}

export function subtractCargoSummary(left: CargoSummary, right: CargoSummary): CargoSummary {
    return {
        qtyKoli: Math.max(left.qtyKoli - right.qtyKoli, 0),
        weightKg: Math.max(left.weightKg - right.weightKg, 0),
        volumeM3: Math.max(left.volumeM3 - right.volumeM3, 0),
    };
}

export function summarizeActualCargoDraftAsCargoSummary(item: ActualCargoDraft): CargoSummary {
    const actualWeightInputValue = parseFormattedNumberish(item.actualWeightInputValue || 0, {
        maxFractionDigits: getWeightInputFractionDigits(item.actualWeightInputUnit),
    });
    const actualVolumeInputValue = parseFormattedNumberish(item.actualVolumeInputValue || 0, {
        maxFractionDigits: item.actualVolumeInputUnit === 'LITER' ? 0 : 3,
    });
    return {
        qtyKoli: parseFormattedNumberish(item.actualQtyKoli || 0, { maxFractionDigits: 2 }),
        weightKg: convertWeightToKg(actualWeightInputValue, item.actualWeightInputUnit),
        volumeM3: convertVolumeToM3(actualVolumeInputValue, item.actualVolumeInputUnit),
    };
}

export function formatItemCodeNameLabel(code: string, name: string, fallback: string) {
    const cleanCode = code.trim();
    const cleanName = name.trim();
    if (cleanCode && cleanName) return `${cleanCode} - ${cleanName}`;
    return cleanName || cleanCode || fallback;
}

function normalizeActualDropGroupText(value?: string) {
    return (value || '').trim();
}

export function formatActualDropDraftNumber(value: number | undefined, maxFractionDigits: number) {
    return value !== undefined
        ? formatFormattedNumberValue(value, true, maxFractionDigits, true)
        : '';
}

export function buildDriverReviewActualDropHydration(
    sourceDropPoints: DeliveryOrder['pendingDriverActualDropPoints'] | DeliveryOrder['actualDropPoints'] | undefined,
    actualCargoItems: ActualCargoDraft[] = []
) {
    const points = Array.isArray(sourceDropPoints) ? sourceDropPoints : [];
    const groupedDrafts: ActualDropDraft[] = [];
    const itemValueMap: Record<string, ActualDropItemValueDraft> = {};
    const groupIndexByKey = new Map<string, number>();

    points.forEach((point, index) => {
        const pointItemRefs = [
            point.deliveryOrderItemRef,
            ...(Array.isArray(point.deliveryOrderItemRefs) ? point.deliveryOrderItemRefs : []),
        ].map(item => normalizeActualDropGroupText(item)).filter(Boolean);
        const hasItemSpecificAllocation = pointItemRefs.length > 0;
        const actualDropGroupKey = normalizeActualDropGroupText(point.actualDropGroupKey);
        const groupKey = actualDropGroupKey
            ? `driver-group:${actualDropGroupKey}`
            : [
                point.stopType || 'DROP',
                hasItemSpecificAllocation ? '' : normalizeActualDropGroupText(point.shipperReferenceKey),
                hasItemSpecificAllocation ? '' : normalizeActualDropGroupText(point.shipperReferenceNumber).toUpperCase(),
                normalizeActualDropGroupText(point.billingCustomerRef),
                normalizeActualDropGroupText(point.billingCustomerName),
                normalizeActualDropGroupText(point.originLocationName),
                normalizeActualDropGroupText(point.originLocationAddress),
                normalizeActualDropGroupText(point.locationName),
                normalizeActualDropGroupText(point.locationAddress),
                normalizeActualDropGroupText(point.note),
            ].join('|');
        let groupIndex = groupIndexByKey.get(groupKey);
        if (groupIndex === undefined) {
            const draftKey = actualDropGroupKey || point._key || `driver-drop-${groupedDrafts.length + 1}`;
            groupIndex = groupedDrafts.length;
            groupIndexByKey.set(groupKey, groupIndex);
            groupedDrafts.push({
                draftKey,
                actualDropGroupKey: actualDropGroupKey || undefined,
                stopType: point.stopType || 'DROP',
                deliveryOrderItemRef: '',
                shipperReferenceKey: point.shipperReferenceKey || '',
                shipperReferenceNumber: point.shipperReferenceNumber || '',
                billingCustomerRef: point.billingCustomerRef || '',
                billingCustomerName: point.billingCustomerName || '',
                originLocationName: point.originLocationName || '',
                originLocationAddress: point.originLocationAddress || '',
                locationName: point.locationName || '',
                locationAddress: point.locationAddress || '',
                qtyKoli: '',
                weightInputValue: '',
                weightInputUnit: point.weightInputUnit || 'KG',
                volumeInputValue: '',
                volumeInputUnit: point.volumeInputUnit || 'M3',
                note: point.note || '',
            });
        }

        const draft = groupedDrafts[groupIndex];
        const pointValues: ActualDropItemValueDraft = {
            qtyKoli: formatActualDropDraftNumber(point.qtyKoli, 2),
            weightInputValue: point.weightInputValue !== undefined
                ? formatActualDropDraftNumber(point.weightInputValue, getWeightInputFractionDigits(point.weightInputUnit || 'KG'))
                : point.weightKg !== undefined
                    ? formatActualDropDraftNumber(point.weightKg, 2)
                    : '',
            weightInputUnit: point.weightInputUnit || draft.weightInputUnit || 'KG',
            volumeInputValue: point.volumeInputValue !== undefined
                ? formatActualDropDraftNumber(point.volumeInputValue, (point.volumeInputUnit || 'M3') === 'LITER' ? 0 : 3)
                : point.volumeM3 !== undefined
                    ? formatActualDropDraftNumber(point.volumeM3, 3)
                    : '',
            volumeInputUnit: point.volumeInputUnit || draft.volumeInputUnit || 'M3',
        };
        if (point.deliveryOrderItemRef && hasActualDropItemValues(pointValues)) {
            itemValueMap[buildActualDropItemValueKey(draft.draftKey, point.deliveryOrderItemRef)] = pointValues;
        }
        if (!point.deliveryOrderItemRef && hasActualDropItemValues(pointValues)) {
            const pointReferenceKey = normalizeActualDropGroupText(point.shipperReferenceKey);
            const pointReferenceNumber = normalizeActualDropGroupText(point.shipperReferenceNumber).toUpperCase();
            actualCargoItems
                .filter(item => {
                    const itemReferenceKey = normalizeActualDropGroupText(item.shipperReferenceKey);
                    const itemReferenceNumber = normalizeActualDropGroupText(item.shipperReferenceNumber).toUpperCase();
                    return (
                        (!pointReferenceKey && !pointReferenceNumber) ||
                        (pointReferenceKey && itemReferenceKey === pointReferenceKey) ||
                        (pointReferenceNumber && itemReferenceNumber === pointReferenceNumber)
                    );
                })
                .forEach(item => {
                    const itemValues: ActualDropItemValueDraft = {
                        qtyKoli: item.actualQtyKoli,
                        weightInputValue: item.actualWeightInputValue,
                        weightInputUnit: item.actualWeightInputUnit,
                        volumeInputValue: item.actualVolumeInputValue,
                        volumeInputUnit: item.actualVolumeInputUnit,
                    };
                    if (hasActualDropItemValues(itemValues)) {
                        itemValueMap[buildActualDropItemValueKey(draft.draftKey, item.deliveryOrderItemRef)] = itemValues;
                    }
                });
        }

        const currentQtyKoli = parseFormattedNumberish(draft.qtyKoli || 0, { maxFractionDigits: 2 });
        const currentWeightKg = convertWeightToKg(
            parseFormattedNumberish(draft.weightInputValue || 0, {
                maxFractionDigits: getWeightInputFractionDigits(draft.weightInputUnit),
            }),
            draft.weightInputUnit
        );
        const currentVolumeM3 = convertVolumeToM3(
            parseFormattedNumberish(draft.volumeInputValue || 0, {
                maxFractionDigits: draft.volumeInputUnit === 'LITER' ? 0 : 3,
            }),
            draft.volumeInputUnit
        );
        const nextQtyKoli = currentQtyKoli + parseFormattedNumberish(pointValues.qtyKoli || 0, { maxFractionDigits: 2 });
        const nextWeightKg = currentWeightKg + convertWeightToKg(
            parseFormattedNumberish(pointValues.weightInputValue || 0, {
                maxFractionDigits: getWeightInputFractionDigits(pointValues.weightInputUnit),
            }),
            pointValues.weightInputUnit
        );
        const nextVolumeM3 = currentVolumeM3 + convertVolumeToM3(
            parseFormattedNumberish(pointValues.volumeInputValue || 0, {
                maxFractionDigits: pointValues.volumeInputUnit === 'LITER' ? 0 : 3,
            }),
            pointValues.volumeInputUnit
        );
        groupedDrafts[groupIndex] = {
            ...draft,
            qtyKoli: formatActualDropDraftNumber(nextQtyKoli > 0 ? nextQtyKoli : undefined, 2),
            weightInputValue: formatActualDropDraftNumber(
                nextWeightKg > 0 ? convertKgToWeightInputValue(nextWeightKg, draft.weightInputUnit) : undefined,
                getWeightInputFractionDigits(draft.weightInputUnit)
            ),
            volumeInputValue: formatActualDropDraftNumber(
                nextVolumeM3 > 0 ? convertM3ToVolumeInputValue(nextVolumeM3, draft.volumeInputUnit) : undefined,
                draft.volumeInputUnit === 'LITER' ? 0 : 3
            ),
            deliveryOrderItemRef: draft.deliveryOrderItemRef || point.deliveryOrderItemRef || '',
            draftKey: draft.draftKey || point._key || `${index + 1}`,
        };
    });

    return { groupedDrafts, itemValueMap };
}
