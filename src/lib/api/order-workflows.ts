import { NextResponse } from 'next/server';

import { getBusinessDateValue } from '@/lib/business-date';
import {
    calculateWeightPortion,
    calculateVolumePortion,
    deriveOrderItemStatusFromProgress,
    getOrderItemProgress,
    roundQuantity,
} from '@/lib/order-item-progress';
import { resolveCompanyLogoUrl } from '@/lib/branding';
import { isSupabaseBackendEnabled } from '@/lib/data-backend';
import {
    createDocument,
    deleteDocument,
    getCompanyProfile,
    getDocumentById,
    getNextNumber,
    listDocumentsByFilter,
    updateDocument,
} from '@/lib/repositories/document-store';

import {
    assertIsoDate,
    extractRefId,
    isMutationConflictError,
    isPlainObject,
    normalizeCurrencyNumber,
    normalizeNumber,
    normalizeOptionalText,
    normalizeText,
    type ApiSession,
} from './data-helpers';
import {
    convertKgToWeightInputValue,
    convertM3ToVolumeInputValue,
    convertVolumeToM3,
    convertWeightToKg,
    getWeightInputFractionDigits,
    type VolumeInputUnit,
    type WeightInputUnit,
} from '@/lib/measurement';
import {
    DO_STATUS_TRANSITIONS,
    DRIVER_APPROVAL_REQUESTABLE_DO_STATUSES,
    buildDriverRequestedTrackingStatus,
    deriveOrderStatusFromItems,
    type DeliveryOrderItemCargoSnapshot,
    normalizeOrderItemsInput,
    normalizeCustomerDoPrefix,
    normalizeDeliveryActualDropPoints,
    normalizeDeliveryOrderActualCargoInputs,
    normalizeDeliveryOrderSelections,
    resolvePayloadVolumeInputUnit,
    resolvePayloadWeightInputUnit,
    resolveOrderPartyData,
    resolveOrderPickupData,
    resolveOrderRecipientData,
    summarizeActualCargoInputs,
    summarizeSelection,
    type NormalizedActualCargoInput,
    type NormalizedOrderItemInput,
    type OrderItemProgressSnapshot,
    type OrderItemStatusSummary,
    type ResolvedCustomerPickupData,
    type ResolvedCustomerRecipientData,
    type ResolvedOrderPartyData,
} from './order-workflow-support';
import { resolveOrderCargoEntryMode } from '@/lib/order-cargo-entry-mode';
import { getTripRouteOvertonaseRatePerKg } from '@/lib/trip-route-rate-support';
import { resolveTripRouteRateSelection } from './generic-workflow-support';
import { computeDriverVoucherTotals } from './driver-workflow-support';
import {
    aggregateTripStatusFromSuratJalanStatuses,
    mapDeliveryOrderToSuratJalanRecords,
    mapDeliveryOrderToTripRecord,
    parseSuratJalanDocumentId,
} from '@/lib/trip-document-mappers';

const MANUAL_DO_STATUSES = ['CREATED', 'HEADING_TO_PICKUP', 'ON_DELIVERY', 'ARRIVED', 'DELIVERED', 'CANCELLED'] as const;

function getDeliveryOrderSuratJalanIdentity(params: {
    deliveryOrderId: string;
    shipperReferenceKey?: string | null;
    shipperReferenceNumber?: string | null;
}) {
    return `${params.deliveryOrderId}:${params.shipperReferenceKey || params.shipperReferenceNumber || 'primary'}`;
}

function normalizeSelectedSuratJalanRefs(data: Record<string, unknown>, deliveryOrderId: string) {
    return Array.from(
        new Set(
            (Array.isArray(data.targetSuratJalanRefs) ? data.targetSuratJalanRefs : [])
                .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
                .map(value => value.trim())
                .filter(value => value === `${deliveryOrderId}:primary` || value.startsWith(`${deliveryOrderId}:`))
        )
    );
}

async function ensureTripRecordForSuratJalanWrites(deliveryOrder: { _id: string; _type?: unknown; orderRef?: unknown; date?: unknown }) {
    const completeDeliveryOrder =
        deliveryOrder._type === 'deliveryOrder' && typeof deliveryOrder.orderRef === 'string' && typeof deliveryOrder.date === 'string'
            ? deliveryOrder as DeliveryOrder
            : await getDocumentById<DeliveryOrder>(deliveryOrder._id, 'deliveryOrder');
    if (!completeDeliveryOrder) {
        throw new Error('Trip tidak ditemukan');
    }

    for (let attempt = 0; attempt < 3; attempt += 1) {
        const persistedTripRecord = await getDocumentById<{ _id: string }>(deliveryOrder._id, 'trip');
        if (persistedTripRecord) {
            return;
        }
        try {
            await createDocument({ ...mapDeliveryOrderToTripRecord(completeDeliveryOrder) });
            return;
        } catch (error) {
            if (!isMutationConflictError(error)) {
                throw error;
            }
        }
        await new Promise(resolve => setTimeout(resolve, 75 * (attempt + 1)));
    }
    throw new Error('Trip relasional belum siap untuk penulisan surat jalan');
}

function buildAutoFinalizeBatchRawDropPoints(
    deliveryOrderId: string,
    deliveryOrder: {
        receiverName?: string;
        receiverCompany?: string;
        receiverAddress?: string;
        shipperReferences?: Array<{
            _key?: string;
            referenceNumber?: string;
            receiverName?: string;
            receiverCompany?: string;
            receiverAddress?: string;
        }>;
    },
    doItems: DeliveryOrderItemCargoSnapshot[],
    actualCargoByDoItemId: Map<string, NormalizedActualCargoInput>,
    selectedSuratJalanRefs: Set<string>
) {
    const shipperReferences = Array.isArray(deliveryOrder.shipperReferences) ? deliveryOrder.shipperReferences : [];
    const groupedItems = doItems.reduce<Map<string, DeliveryOrderItemCargoSnapshot[]>>((acc, item) => {
        const suratJalanRef = getDeliveryOrderSuratJalanIdentity({
            deliveryOrderId,
            shipperReferenceKey: item.shipperReferenceKey,
            shipperReferenceNumber: item.shipperReferenceNumber,
        });
        const current = acc.get(suratJalanRef) || [];
        current.push(item);
        acc.set(suratJalanRef, current);
        return acc;
    }, new Map());

    return [...groupedItems.entries()].flatMap(([suratJalanRef, items]) => {
        const matchedReference = shipperReferences.find(reference =>
            suratJalanRef === getDeliveryOrderSuratJalanIdentity({
                deliveryOrderId,
                shipperReferenceKey: reference._key,
                shipperReferenceNumber: reference.referenceNumber,
            })
        ) || null;

        const totals = items.reduce((sum, item) => {
            const actual = actualCargoByDoItemId.get(item._id);
            if (!actual) {
                return sum;
            }
            return {
                qtyKoli: roundQuantity(sum.qtyKoli + normalizeNumber(actual.actualQtyKoli)),
                weightKg: roundQuantity(sum.weightKg + normalizeNumber(actual.actualWeightKg)),
                volumeM3: roundQuantity(sum.volumeM3 + normalizeNumber(actual.actualVolumeM3 ?? 0), 3),
            };
        }, { qtyKoli: 0, weightKg: 0, volumeM3: 0 });

        if (totals.qtyKoli <= 0 && totals.weightKg <= 0 && totals.volumeM3 <= 0) {
            return [];
        }

        const isSelected = selectedSuratJalanRefs.has(suratJalanRef);
        const targetName = matchedReference?.referenceNumber
            ? `Tujuan final ${matchedReference.referenceNumber}`
            : 'Tujuan Invoice';
        const targetAddress = '';

        return [{
            stopType: isSelected ? 'DROP' : 'HOLD',
            deliveryOrderItemRefs: items.map(item => item._id),
            shipperReferenceKey: matchedReference?._key || items[0]?.shipperReferenceKey,
            shipperReferenceNumber: matchedReference?.referenceNumber || items[0]?.shipperReferenceNumber,
            locationName: targetName,
            locationAddress: targetAddress,
            qtyKoli: totals.qtyKoli > 0 ? totals.qtyKoli : undefined,
            weightKg: totals.weightKg > 0 ? totals.weightKg : undefined,
            volumeM3: totals.volumeM3 > 0 ? totals.volumeM3 : undefined,
            note: isSelected ? 'Finalisasi batch SJ terpilih' : 'Menunggu batch SJ berikutnya',
        }];
    });
}
import { computeDeliveryOrderOvertonage } from '@/lib/delivery-order-overtonage';
import {
    getDeliveryOrderBillableCargoSummary,
    getDeliveryOrderHoldCargoSummary,
    getDeliveryOrderNonBillableCargoSummary,
    getDeliveryOrderReturnCargoSummary,
} from '@/lib/delivery-order-completion';
import type { CompanyProfile, DeliveryOrder, DeliveryOrderItem, DOStatus, OrderPickupStop, OrderTripPlan } from '@/lib/types';

type AuditLogFn = (
    session: Pick<ApiSession, '_id' | 'name'>,
    action: string,
    entityType: string,
    entityRef: string,
    summary: string
) => void | Promise<void>;

async function releaseDriverTrackingLockIfOwned(driverRef: unknown, deliveryOrderRef: string, timestamp: string) {
    const driverId = extractRefId(driverRef);
    if (!driverId) {
        return;
    }

    const driver = await getDocumentById<{ _id: string; _rev?: string; activeTrackingDeliveryOrderRef?: unknown }>(driverId, 'driver');
    if (!driver || (!driver._rev && !isSupabaseBackendEnabled())) {
        return;
    }

    if (extractRefId(driver.activeTrackingDeliveryOrderRef) !== deliveryOrderRef) {
        return;
    }

    await updateDocument(driverId, {
        activeTrackingDeliveryOrderRef: null,
        activeTrackingUpdatedAt: timestamp,
    }, 'driver');
}

function buildOrderItemDraftDocument(
    orderRef: string,
    item: NormalizedOrderItemInput,
    itemId: string = crypto.randomUUID(),
    extras?: Record<string, unknown>
) {
    return {
        _id: itemId,
        _type: 'orderItem',
        orderRef,
        entrySource: 'ORDER',
        customerProductRef: item.customerProductRef,
        customerProductCode: item.customerProductCode,
        customerProductName: item.customerProductName,
        description: item.description,
        qtyKoli: item.qtyKoli,
        weight: item.weight,
        volume: item.volume,
        weightInputValue: item.weightInputValue,
        weightInputUnit: item.weightInputUnit,
        volumeInputValue: item.volumeInputValue,
        volumeInputUnit: item.volumeInputUnit,
        value: item.value,
        deliveredQtyKoli: 0,
        deliveredWeight: 0,
        deliveredVolume: 0,
        assignedQtyKoli: 0,
        assignedWeight: 0,
        assignedVolume: 0,
        heldQtyKoli: 0,
        heldWeight: 0,
        heldVolume: 0,
        status: 'PENDING',
        ...extras,
    };
}

function hasCargoProgressPart(part: { qtyKoli: number; weight: number; volume: number }) {
    return part.qtyKoli > 0 || part.weight > 0 || part.volume > 0;
}

function ratioOrFallback(value: number, total: number, fallback: number) {
    if (total > 0) {
        return Math.min(Math.max(value / total, 0), 1);
    }
    return fallback;
}

function splitActualCargoForOrderProgress(params: {
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

function hasDeliveryCargoSummary(summary: { qtyKoli: number; weightKg: number; volumeM3: number }) {
    return summary.qtyKoli > 0 || summary.weightKg > 0 || summary.volumeM3 > 0;
}

function summarizeSuratJalanActualCargo(
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

function getActualCargoOverPlanMessages(
    doItems: DeliveryOrderItemCargoSnapshot[],
    actualCargoByDoItemId: Map<string, NormalizedActualCargoInput>
) {
    const messages: string[] = [];

    for (const item of doItems) {
        const actualCargo = actualCargoByDoItemId.get(item._id);
        if (!actualCargo) {
            continue;
        }

        const label = item.shipperReferenceNumber || item._id;
        const plannedQtyKoli = roundQuantity(normalizeNumber(item.shippedQtyKoli ?? item.orderItemQtyKoli ?? 0));
        const plannedWeight = roundQuantity(normalizeNumber(item.shippedWeight ?? item.orderItemWeight ?? 0));
        const plannedVolume = roundQuantity(normalizeNumber(item.orderItemVolumeM3 ?? 0), 3);
        const itemMessages: string[] = [];

        if (plannedQtyKoli > 0 && actualCargo.actualQtyKoli - plannedQtyKoli > 0.01) {
            itemMessages.push(`koli ${plannedQtyKoli} -> ${actualCargo.actualQtyKoli}`);
        }
        if (plannedWeight > 0 && actualCargo.actualWeightKg - plannedWeight > 0.01) {
            itemMessages.push(`berat ${plannedWeight} kg -> ${actualCargo.actualWeightKg} kg`);
        }
        if (plannedVolume > 0 && normalizeNumber(actualCargo.actualVolumeM3 ?? 0) - plannedVolume > 0.001) {
            itemMessages.push(`volume ${plannedVolume} m3 -> ${roundQuantity(normalizeNumber(actualCargo.actualVolumeM3 ?? 0), 3)} m3`);
        }

        if (itemMessages.length > 0) {
            messages.push(`${label}: ${itemMessages.join(', ')}`);
        }
    }

    return messages;
}

function getAmbiguousActualDropMappingMessage(
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

function normalizeDeliveryOrderShipperReferencesForUpdate(
    deliveryOrder: {
        pickupStops?: Array<{
            _key?: string;
            pickupAddress?: string;
        }>;
        shipperReferences?: Array<{
            _key?: string;
            sequence?: number;
            referenceNumber?: string;
            pickupStopKey?: string;
            pickupAddress?: string;
            billingCustomerRef?: string;
            billingCustomerName?: string;
            receiverName?: string;
            receiverPhone?: string;
            receiverAddress?: string;
            receiverCompany?: string;
            notes?: string;
        }>;
    },
    rawShipperReferences: unknown,
) {
    const requestedReferences = Array.isArray(rawShipperReferences) ? rawShipperReferences : [];
    if (requestedReferences.length === 0) {
        return undefined;
    }

    const pickupStopByKey = new Map(
        (deliveryOrder.pickupStops || [])
            .map(stop => [normalizeOptionalText(stop._key), stop] as const)
            .filter((entry): entry is [string, NonNullable<typeof entry[1]>] => Boolean(entry[0]))
    );
    const existingReferences = Array.isArray(deliveryOrder.shipperReferences)
        ? deliveryOrder.shipperReferences
        : [];

    const seenReferenceNumbers = new Set<string>();
    const usedExistingReferenceIndexes = new Set<number>();
    const usedReferenceKeys = new Set<string>();
    const normalizedReferences = requestedReferences
        .filter(isPlainObject)
        .map((reference, index) => {
            const referenceNumber = normalizeText(reference.referenceNumber).toUpperCase();
            if (!referenceNumber) {
                throw new Error(`No. SJ pengirim wajib diisi pada SJ ${index + 1}`);
            }
            if (seenReferenceNumbers.has(referenceNumber)) {
                throw new Error(`No. SJ pengirim ${referenceNumber} duplikat dalam daftar SJ`);
            }
            seenReferenceNumbers.add(referenceNumber);

            const requestedReferenceKey = normalizeOptionalText(reference._key);
            const findExistingReference = () => {
                const byRequestedKeyIndex = requestedReferenceKey
                    ? existingReferences.findIndex((item, candidateIndex) =>
                        !usedExistingReferenceIndexes.has(candidateIndex) &&
                        normalizeOptionalText(item._key) === requestedReferenceKey &&
                        (
                            normalizeOptionalText(item.referenceNumber)?.toUpperCase() === referenceNumber ||
                            !normalizeOptionalText(item.referenceNumber)
                        )
                    )
                    : -1;
                if (byRequestedKeyIndex >= 0) {
                    return { reference: existingReferences[byRequestedKeyIndex], index: byRequestedKeyIndex };
                }

                const byNumberIndex = existingReferences.findIndex((item, candidateIndex) =>
                    !usedExistingReferenceIndexes.has(candidateIndex) &&
                    normalizeOptionalText(item.referenceNumber)?.toUpperCase() === referenceNumber
                );
                if (byNumberIndex >= 0) {
                    return { reference: existingReferences[byNumberIndex], index: byNumberIndex };
                }

                if (existingReferences[index] && !usedExistingReferenceIndexes.has(index)) {
                    return { reference: existingReferences[index], index };
                }

                return { reference: undefined, index: -1 };
            };
            const existingReferenceMatch = findExistingReference();
            const existingReference = existingReferenceMatch.reference;
            if (existingReferenceMatch.index >= 0) {
                usedExistingReferenceIndexes.add(existingReferenceMatch.index);
            }
            let resolvedReferenceKey =
                requestedReferenceKey ||
                normalizeOptionalText(existingReference?._key) ||
                crypto.randomUUID();
            if (usedReferenceKeys.has(resolvedReferenceKey)) {
                resolvedReferenceKey = crypto.randomUUID();
            }
            usedReferenceKeys.add(resolvedReferenceKey);

            const requestedPickupStopKey = normalizeOptionalText(reference.pickupStopKey);
            const resolvedPickupStopKey =
                requestedPickupStopKey
                || normalizeOptionalText(existingReference?.pickupStopKey)
                || ((deliveryOrder.pickupStops?.length || 0) === 1
                    ? normalizeOptionalText(deliveryOrder.pickupStops?.[0]?._key)
                    : undefined);
            const pickupStop = resolvedPickupStopKey ? pickupStopByKey.get(resolvedPickupStopKey) : undefined;
            const hasReferenceField = (field: string) => Object.prototype.hasOwnProperty.call(reference, field);

            return {
                _key: resolvedReferenceKey,
                sequence: index + 1,
                referenceNumber,
                pickupStopKey: resolvedPickupStopKey,
                pickupAddress:
                    normalizeOptionalText(pickupStop?.pickupAddress)
                    || normalizeOptionalText(existingReference?.pickupAddress),
                billingCustomerRef:
                    hasReferenceField('billingCustomerRef')
                        ? normalizeOptionalText(reference.billingCustomerRef)
                        : normalizeOptionalText(existingReference?.billingCustomerRef),
                billingCustomerName:
                    hasReferenceField('billingCustomerName')
                        ? normalizeOptionalText(reference.billingCustomerName)
                        : normalizeOptionalText(existingReference?.billingCustomerName),
                receiverName:
                    hasReferenceField('receiverName')
                        ? normalizeOptionalText(reference.receiverName)
                        : normalizeOptionalText(existingReference?.receiverName),
                receiverPhone:
                    hasReferenceField('receiverPhone')
                        ? normalizeOptionalText(reference.receiverPhone)
                        : normalizeOptionalText(existingReference?.receiverPhone),
                receiverAddress:
                    hasReferenceField('receiverAddress')
                        ? normalizeOptionalText(reference.receiverAddress)
                        : normalizeOptionalText(existingReference?.receiverAddress),
                receiverCompany:
                    hasReferenceField('receiverCompany')
                        ? normalizeOptionalText(reference.receiverCompany)
                        : normalizeOptionalText(existingReference?.receiverCompany),
                notes:
                    normalizeOptionalText(reference.notes)
                    || normalizeOptionalText(existingReference?.notes),
            };
        });

    return normalizedReferences;
}

function areDeliveryOrderShipperReferencesEquivalent(
    left: Array<{
        referenceNumber?: string;
        pickupStopKey?: string;
        billingCustomerRef?: string;
        billingCustomerName?: string;
        receiverName?: string;
        receiverPhone?: string;
        receiverAddress?: string;
        receiverCompany?: string;
        notes?: string;
    }> | undefined,
    right: Array<{
        referenceNumber?: string;
        pickupStopKey?: string;
        billingCustomerRef?: string;
        billingCustomerName?: string;
        receiverName?: string;
        receiverPhone?: string;
        receiverAddress?: string;
        receiverCompany?: string;
        notes?: string;
    }> | undefined,
) {
    const normalizeReferences = (value: typeof left) =>
        (Array.isArray(value) ? value : [])
            .map((reference, index) => ({
                sequence: index + 1,
                referenceNumber: normalizeOptionalText(reference.referenceNumber)?.toUpperCase() || '',
                pickupStopKey: normalizeOptionalText(reference.pickupStopKey) || '',
                billingCustomerRef: normalizeOptionalText(reference.billingCustomerRef) || '',
                billingCustomerName: normalizeOptionalText(reference.billingCustomerName) || '',
                receiverName: normalizeOptionalText(reference.receiverName) || '',
                receiverPhone: normalizeOptionalText(reference.receiverPhone) || '',
                receiverAddress: normalizeOptionalText(reference.receiverAddress) || '',
                receiverCompany: normalizeOptionalText(reference.receiverCompany) || '',
                notes: normalizeOptionalText(reference.notes) || '',
            }))
            .filter(reference => reference.referenceNumber.length > 0);

    const normalizedLeft = normalizeReferences(left);
    const normalizedRight = normalizeReferences(right);

    return JSON.stringify(normalizedLeft) === JSON.stringify(normalizedRight);
}

function resolveDeliveryOrderCargoItemContext(
    item: Pick<NormalizedOrderItemInput, 'pickupStopKey' | 'shipperReferenceNumber'>,
    deliveryOrder: {
        pickupStops?: Array<{
            _key?: string;
            orderPickupStopKey?: string;
            pickupAddress?: string;
        }>;
        shipperReferences?: Array<{
            _key?: string;
            referenceNumber?: string;
            pickupStopKey?: string;
            pickupAddress?: string;
        }>;
    }
) {
    const requestedPickupStopKey = normalizeOptionalText(item.pickupStopKey);
    const requestedReferenceNumber = normalizeOptionalText(item.shipperReferenceNumber)?.toUpperCase();
    const pickupStops = Array.isArray(deliveryOrder.pickupStops) ? deliveryOrder.pickupStops : [];
    const shipperReferences = Array.isArray(deliveryOrder.shipperReferences) ? deliveryOrder.shipperReferences : [];

    const matchedReference =
        shipperReferences.find(reference =>
            requestedReferenceNumber &&
            normalizeOptionalText(reference.referenceNumber)?.toUpperCase() === requestedReferenceNumber
        ) ||
        shipperReferences.find(reference =>
            requestedPickupStopKey &&
            normalizeOptionalText(reference.pickupStopKey) === requestedPickupStopKey
        );
    const resolvedPickupStopKey =
        normalizeOptionalText(matchedReference?.pickupStopKey) ||
        requestedPickupStopKey ||
        (pickupStops.length === 1 ? normalizeOptionalText(pickupStops[0]?._key) : undefined);
    const matchedPickupStop =
        pickupStops.find(stop =>
            resolvedPickupStopKey &&
            (
                normalizeOptionalText(stop._key) === resolvedPickupStopKey ||
                normalizeOptionalText(stop.orderPickupStopKey) === resolvedPickupStopKey
            )
        ) ||
        pickupStops.find(stop =>
            requestedPickupStopKey &&
            (
                normalizeOptionalText(stop._key) === requestedPickupStopKey ||
                normalizeOptionalText(stop.orderPickupStopKey) === requestedPickupStopKey
            )
        );

    return {
        pickupStopKey: normalizeOptionalText(matchedPickupStop?._key) || resolvedPickupStopKey,
        pickupAddress:
            normalizeOptionalText(matchedPickupStop?.pickupAddress) ||
            normalizeOptionalText(matchedReference?.pickupAddress),
        shipperReferenceKey: normalizeOptionalText(matchedReference?._key),
        shipperReferenceNumber:
            normalizeOptionalText(matchedReference?.referenceNumber) ||
            requestedReferenceNumber,
    };
}

export async function syncOrderStatusFromItems(orderRef: string, session: ApiSession, addAuditLog: AuditLogFn) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
        const order = await getDocumentById<{ _id: string; _rev?: string; status?: string }>(orderRef, 'order');
        if (!order || order.status === 'CANCELLED') {
            return;
        }

        const items = await listDocumentsByFilter<OrderItemStatusSummary>('orderItem', { orderRef });
        const nextStatus = deriveOrderStatusFromItems(items);

        if (order.status === nextStatus) {
            return;
        }

        try {
            await updateDocument(orderRef, { status: nextStatus }, 'order');
            await addAuditLog(
                session,
                'UPDATE',
                'orders',
                orderRef,
                `Order auto-${nextStatus}: sinkronisasi dari ${items.length} item`
            );
            return;
        } catch (error) {
            if (isMutationConflictError(error)) {
                continue;
            }
            throw error;
        }
    }
}

export async function handleOrderItemHoldSet(
    session: ApiSession,
    data: Record<string, unknown>,
    addAuditLog: AuditLogFn
) {
    const id = typeof data.id === 'string' ? data.id : '';
    const holdQtyKoli = normalizeNumber(data.holdQtyKoli);
    let holdWeightInputUnit: WeightInputUnit;
    let holdVolumeInputUnit: VolumeInputUnit;
    try {
        holdWeightInputUnit = resolvePayloadWeightInputUnit(data.holdWeightInputUnit, 'Satuan berat hold');
        holdVolumeInputUnit = resolvePayloadVolumeInputUnit(data.holdVolumeInputUnit, 'Satuan volume hold');
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Satuan hold tidak valid' },
            { status: 400 }
        );
    }
    const holdWeightInputValue = roundQuantity(normalizeNumber(data.holdWeightInputValue, {
        maxFractionDigits: getWeightInputFractionDigits(holdWeightInputUnit),
    }), getWeightInputFractionDigits(holdWeightInputUnit));
    const holdVolumeInputValue = roundQuantity(normalizeNumber(data.holdVolumeInputValue, {
        maxFractionDigits: holdVolumeInputUnit === 'LITER' ? 0 : 3,
    }), holdVolumeInputUnit === 'LITER' ? 0 : 3);
    const holdReason = normalizeOptionalText(data.holdReason);
    const holdLocation = normalizeOptionalText(data.holdLocation);

    if (!id) {
        return NextResponse.json({ error: 'Item order tidak valid' }, { status: 400 });
    }
    if (!holdReason) {
        return NextResponse.json({ error: 'Alasan hold wajib diisi' }, { status: 400 });
    }

    const orderItem = await getDocumentById<OrderItemProgressSnapshot & { _rev?: string }>(id, 'orderItem');
    if (!orderItem) {
        return NextResponse.json({ error: 'Item order tidak ditemukan' }, { status: 404 });
    }
    if (!isSupabaseBackendEnabled() && !orderItem._rev) {
        return NextResponse.json({ error: 'Revisi item order tidak tersedia. Refresh lalu coba lagi.' }, { status: 409 });
    }

    const progress = getOrderItemProgress(orderItem);
    if (progress.totalQtyKoli <= 0) {
        const holdWeight = holdWeightInputValue > 0 ? roundQuantity(convertWeightToKg(holdWeightInputValue, holdWeightInputUnit)) : 0;
        const holdVolume = holdVolumeInputValue > 0 ? roundQuantity(convertVolumeToM3(holdVolumeInputValue, holdVolumeInputUnit), 3) : 0;
        if (progress.pendingWeight > 0 && holdWeight <= 0) {
            return NextResponse.json({ error: 'Berat hold wajib diisi untuk item non-koli' }, { status: 400 });
        }
        if (progress.pendingVolume > 0 && holdVolume <= 0) {
            return NextResponse.json({ error: 'Volume hold wajib diisi untuk item non-koli' }, { status: 400 });
        }
        if (holdWeight <= 0 && holdVolume <= 0) {
            return NextResponse.json({ error: 'Muatan hold tidak valid' }, { status: 400 });
        }
        if (holdWeight - progress.pendingWeight > 0.00001) {
            return NextResponse.json({ error: 'Berat hold melebihi sisa berat yang siap dikirim' }, { status: 409 });
        }
        if (holdVolume - progress.pendingVolume > 0.00001) {
            return NextResponse.json({ error: 'Volume hold melebihi sisa volume yang siap dikirim' }, { status: 409 });
        }

        const updates = {
            heldWeight: roundQuantity(progress.heldWeight + holdWeight),
            heldVolume: roundQuantity(progress.heldVolume + holdVolume, 3),
            holdReason,
            holdLocation: holdLocation || undefined,
            status: deriveOrderItemStatusFromProgress({
                ...progress,
                heldWeight: roundQuantity(progress.heldWeight + holdWeight),
                heldVolume: roundQuantity(progress.heldVolume + holdVolume, 3),
                pendingWeight: roundQuantity(Math.max(progress.pendingWeight - holdWeight, 0)),
                pendingVolume: roundQuantity(Math.max(progress.pendingVolume - holdVolume, 0), 3),
            }),
        };

        let updated: unknown;
        try {
            updated = await updateDocument(id, {
                ...updates,
                holdLocation: holdLocation || undefined,
            }, 'orderItem');
        } catch (error) {
            if (isMutationConflictError(error)) {
                return NextResponse.json(
                    { error: 'Item order berubah karena ada update lain. Refresh lalu coba lagi.' },
                    { status: 409 }
                );
            }
            throw error;
        }
        const orderRef = extractRefId(orderItem.orderRef);
        if (orderRef) {
            await syncOrderStatusFromItems(orderRef, session, addAuditLog);
        }
        await addAuditLog(
            session,
            'UPDATE',
            'order-items',
            id,
            `Item order hold ${[
                holdWeight > 0 ? `${roundQuantity(holdWeight)} kg` : null,
                holdVolume > 0 ? `${roundQuantity(holdVolume, 3)} m3` : null,
            ].filter(Boolean).join(' / ')}${holdLocation ? ` di ${holdLocation}` : ''}: ${holdReason}`
        );

        return NextResponse.json({ data: updated });
    }
    if (!Number.isFinite(holdQtyKoli) || holdQtyKoli <= 0) {
        return NextResponse.json({ error: 'Jumlah koli hold tidak valid' }, { status: 400 });
    }
    if (progress.pendingQtyKoli <= 0) {
        return NextResponse.json({ error: 'Tidak ada sisa qty yang bisa ditahan' }, { status: 409 });
    }
    if (holdQtyKoli > progress.pendingQtyKoli) {
        return NextResponse.json({ error: 'Jumlah hold melebihi sisa qty yang siap dikirim' }, { status: 409 });
    }

    const holdWeight = calculateWeightPortion(progress.totalWeight, progress.totalQtyKoli, holdQtyKoli);
    const updates = {
        heldQtyKoli: roundQuantity(progress.heldQtyKoli + holdQtyKoli),
        heldWeight: roundQuantity(progress.heldWeight + holdWeight),
        holdReason,
        holdLocation: holdLocation || undefined,
        status: deriveOrderItemStatusFromProgress({
            ...progress,
            heldQtyKoli: roundQuantity(progress.heldQtyKoli + holdQtyKoli),
            heldWeight: roundQuantity(progress.heldWeight + holdWeight),
            pendingQtyKoli: roundQuantity(Math.max(progress.pendingQtyKoli - holdQtyKoli, 0)),
            pendingWeight: roundQuantity(Math.max(progress.pendingWeight - holdWeight, 0)),
        }),
    };

    let updated: unknown;
    try {
        updated = await updateDocument(id, {
            ...updates,
            holdLocation: holdLocation || undefined,
        }, 'orderItem');
    } catch (error) {
        if (isMutationConflictError(error)) {
            return NextResponse.json(
                { error: 'Item order berubah karena ada update lain. Refresh lalu coba lagi.' },
                { status: 409 }
            );
        }
        throw error;
    }
    const orderRef = extractRefId(orderItem.orderRef);
    if (orderRef) {
        await syncOrderStatusFromItems(orderRef, session, addAuditLog);
    }
    await addAuditLog(
        session,
        'UPDATE',
        'order-items',
        id,
        `Item order hold ${holdQtyKoli} koli${holdLocation ? ` di ${holdLocation}` : ''}: ${holdReason}`
    );

    return NextResponse.json({ data: updated });
}

export async function handleOrderItemHoldRelease(
    session: ApiSession,
    data: Record<string, unknown>,
    addAuditLog: AuditLogFn
) {
    const id = typeof data.id === 'string' ? data.id : '';
    if (!id) {
        return NextResponse.json({ error: 'Item order tidak valid' }, { status: 400 });
    }

    const orderItem = await getDocumentById<OrderItemProgressSnapshot & { _rev?: string }>(id, 'orderItem');
    if (!orderItem) {
        return NextResponse.json({ error: 'Item order tidak ditemukan' }, { status: 404 });
    }
    if (!isSupabaseBackendEnabled() && !orderItem._rev) {
        return NextResponse.json({ error: 'Revisi item order tidak tersedia. Refresh lalu coba lagi.' }, { status: 409 });
    }

    const progress = getOrderItemProgress(orderItem);
    if (progress.totalQtyKoli <= 0) {
        if (progress.heldWeight <= 0 && progress.heldVolume <= 0) {
            return NextResponse.json({ error: 'Item ini tidak punya hold aktif' }, { status: 409 });
        }
        const updates = {
            heldWeight: 0,
            heldVolume: 0,
            holdReason: undefined,
            holdLocation: undefined,
            status: deriveOrderItemStatusFromProgress({
                ...progress,
                heldWeight: 0,
                heldVolume: 0,
                pendingWeight: roundQuantity(progress.pendingWeight + progress.heldWeight),
                pendingVolume: roundQuantity(progress.pendingVolume + progress.heldVolume, 3),
            }),
        };
        let updated: unknown;
        try {
            updated = await updateDocument(id, updates, 'orderItem');
        } catch (error) {
            if (isMutationConflictError(error)) {
                return NextResponse.json(
                    { error: 'Item order berubah karena ada update lain. Refresh lalu coba lagi.' },
                    { status: 409 }
                );
            }
            throw error;
        }

        const orderRef = extractRefId(orderItem.orderRef);
        if (orderRef) {
            await syncOrderStatusFromItems(orderRef, session, addAuditLog);
        }
        await addAuditLog(
            session,
            'UPDATE',
            'order-items',
            id,
            `Hold item order dilepas${orderItem.holdLocation ? ` dari ${orderItem.holdLocation}` : ''}`
        );

        return NextResponse.json({ data: updated });
    }
    if (progress.heldQtyKoli <= 0) {
        return NextResponse.json({ error: 'Item ini tidak punya qty hold aktif' }, { status: 409 });
    }

    const updates = {
        heldQtyKoli: 0,
        heldWeight: 0,
        holdReason: undefined,
        holdLocation: undefined,
        status: deriveOrderItemStatusFromProgress({
            ...progress,
            heldQtyKoli: 0,
            heldWeight: 0,
            pendingQtyKoli: roundQuantity(progress.pendingQtyKoli + progress.heldQtyKoli),
            pendingWeight: roundQuantity(progress.pendingWeight + progress.heldWeight),
        }),
    };
    let updated: unknown;
    try {
        updated = await updateDocument(id, updates, 'orderItem');
    } catch (error) {
        if (isMutationConflictError(error)) {
            return NextResponse.json(
                { error: 'Item order berubah karena ada update lain. Refresh lalu coba lagi.' },
                { status: 409 }
            );
        }
        throw error;
    }

    const orderRef = extractRefId(orderItem.orderRef);
    if (orderRef) {
        await syncOrderStatusFromItems(orderRef, session, addAuditLog);
    }
    await addAuditLog(
        session,
        'UPDATE',
        'order-items',
        id,
        `Release hold item order ${progress.heldQtyKoli} koli`
    );

    return NextResponse.json({ data: updated });
}

export async function handleOrderCreate(
    session: ApiSession,
    data: Record<string, unknown>,
    addAuditLog: AuditLogFn
) {
    const customerRef = normalizeText(data.customerRef);
    const serviceRef = normalizeOptionalText(data.serviceRef);
    const customerRecipientRef = normalizeOptionalText(data.customerRecipientRef);
    const customerPickupRef = normalizeOptionalText(data.customerPickupRef);
    if (!customerRef) {
        return NextResponse.json({ error: 'Customer, penerima, dan alamat tujuan wajib diisi' }, { status: 400 });
    }

    let customer: ResolvedOrderPartyData['customer'];
    let service: ResolvedOrderPartyData['service'];
    let serviceName: string | undefined;
    let customerRecipient: ResolvedCustomerRecipientData | null = null;
    let customerPickup: ResolvedCustomerPickupData | null = null;
    let items: NormalizedOrderItemInput[];
    let pickupStops: OrderPickupStop[] = [];
    let tripPlans: OrderTripPlan[] = [];
    try {
        const party = await resolveOrderPartyData(customerRef, serviceRef);
        customer = party.customer;
        service = party.service;
        serviceName = party.serviceName;
        customerRecipient = await resolveOrderRecipientData(customerRef, customerRecipientRef);
        customerPickup = await resolveOrderPickupData(customerRef, customerPickupRef);
        items = await normalizeOrderItemsInput(customerRef, Array.isArray(data.items) ? data.items : [], {
            allowEmpty: true,
        });
        pickupStops = normalizeOrderPickupStopsInput(
            Array.isArray(data.pickupStops) ? data.pickupStops : [],
            normalizeOptionalText(data.pickupAddress) || normalizeOptionalText(customerPickup?.pickupAddress) || customer.address
        );
        tripPlans = await normalizeOrderTripPlansInput(
            Array.isArray(data.tripDrafts) ? data.tripDrafts : [],
            pickupStops,
            serviceRef
        );
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Data order tidak valid';
        const status = message.includes('tidak ditemukan') ? 404 : message.includes('tidak aktif') ? 409 : 400;
        return NextResponse.json({ error: message }, { status });
    }
    const firstTripDestination = normalizeOptionalText(tripPlans[0]?.tripDestinationArea);
    const firstPickupAddress = normalizeOptionalText(pickupStops[0]?.pickupAddress);
    const receiverName =
        normalizeText(data.receiverName) ||
        normalizeOptionalText(customerRecipient?.receiverName) ||
        (tripPlans.length > 0 ? customer.name || 'Tujuan trip' : '');
    const receiverAddress =
        normalizeText(data.receiverAddress) ||
        normalizeOptionalText(customerRecipient?.receiverAddress) ||
        firstTripDestination ||
        (tripPlans.length > 0 ? firstPickupAddress || customer.address || '' : '');
    if (!receiverName || !receiverAddress) {
        return NextResponse.json({ error: 'Customer, penerima, dan alamat tujuan wajib diisi' }, { status: 400 });
    }
    if (tripPlans.length > 0 && pickupStops.length === 0) {
        return NextResponse.json({ error: 'Minimal 1 titik pickup wajib diisi' }, { status: 400 });
    }
    if (!customer._rev && !isSupabaseBackendEnabled()) {
        return NextResponse.json({ error: 'Revisi customer tidak tersedia. Refresh lalu coba lagi.' }, { status: 409 });
    }
    if (serviceRef && !service?._rev && !isSupabaseBackendEnabled()) {
        return NextResponse.json({ error: 'Revisi kategori armada tidak tersedia. Refresh lalu coba lagi.' }, { status: 409 });
    }
    if (customerRecipientRef && !customerRecipient?._rev && !isSupabaseBackendEnabled()) {
        return NextResponse.json({ error: 'Revisi master penerima tidak tersedia. Refresh lalu coba lagi.' }, { status: 409 });
    }
    if (customerPickupRef && !customerPickup?._rev && !isSupabaseBackendEnabled()) {
        return NextResponse.json({ error: 'Revisi master pickup tidak tersedia. Refresh lalu coba lagi.' }, { status: 409 });
    }

    const orderId = crypto.randomUUID();
    const masterResi = await getNextNumber('resi');
    const createdAt = new Date().toISOString();
    const orderDoc = {
        _id: orderId,
        _type: 'order',
        cargoEntryMode: items.length === 0 ? 'DELIVERY_ORDER' : 'ORDER',
        customerRef,
        customerName: customer.name,
        customerRecipientRef: customerRecipientRef || undefined,
        customerPickupRef: customerPickupRef || undefined,
        receiverName,
        receiverPhone: normalizeOptionalText(data.receiverPhone) || normalizeOptionalText(customerRecipient?.receiverPhone) || '',
        receiverAddress,
        receiverCompany: normalizeOptionalText(data.receiverCompany) || normalizeOptionalText(customerRecipient?.receiverCompany),
        pickupAddress: normalizeOptionalText(data.pickupAddress) || normalizeOptionalText(customerPickup?.pickupAddress) || customer.address || undefined,
        pickupStops,
        tripPlans,
        serviceRef: serviceRef || undefined,
        serviceName: serviceName || undefined,
        notes: normalizeOptionalText(data.notes),
        masterResi,
        status: 'OPEN',
        createdAt,
        createdBy: session._id,
    };

    try {
        await createDocument(orderDoc);
        await Promise.all([
            ...items.map(item => createDocument(buildOrderItemDraftDocument(orderId, item))),
        ]);
    } catch (error) {
        const errorCode = isPlainObject(error) && typeof error.code === 'string' ? error.code : '';
        const errorMessage = error instanceof Error ? error.message : '';
        if (errorCode === '23503' || /foreign key/i.test(errorMessage)) {
            return NextResponse.json(
                { error: 'Data master order tidak valid atau sudah berubah. Pilih ulang customer, kategori armada, pickup, kendaraan, supir, dan kas/bank lalu simpan lagi.' },
                { status: 409 }
            );
        }
        if (isMutationConflictError(error)) {
            return NextResponse.json(
                { error: 'Order, customer, barang customer, tujuan, pickup, atau kategori armada berubah karena ada update lain. Refresh lalu coba lagi.' },
                { status: 409 }
            );
        }
        throw error;
    }
    await addAuditLog(
        session,
        'CREATE',
        'orders',
        orderId,
        `Created orders: ${masterResi}${items.length > 0 ? ` (${items.length} item target)` : ' (header booking tanpa item)'}`
    );
    return NextResponse.json({ data: orderDoc, id: orderId, plannedTrips: tripPlans });
}

export async function handleOrderUpdateWithItems(
    session: ApiSession,
    data: Record<string, unknown>,
    addAuditLog: AuditLogFn
) {
    const id = normalizeText(data.id);
    const customerRef = normalizeText(data.customerRef);
    const serviceRef = normalizeOptionalText(data.serviceRef);
    const customerRecipientRef = normalizeOptionalText(data.customerRecipientRef);
    const customerPickupRef = normalizeOptionalText(data.customerPickupRef);

    if (!id || !customerRef) {
        return NextResponse.json({ error: 'Order, customer, penerima, dan alamat tujuan wajib diisi' }, { status: 400 });
    }

    const order = await getDocumentById<{
        _id: string;
        _rev?: string;
        masterResi?: string;
        cargoEntryMode?: 'ORDER' | 'DELIVERY_ORDER';
        receiverName?: string;
        receiverAddress?: string;
        pickupAddress?: string;
    }>(id, 'order');
    if (!order) {
        return NextResponse.json({ error: 'Order tidak ditemukan' }, { status: 404 });
    }
    if (!order._rev && !isSupabaseBackendEnabled()) {
        return NextResponse.json({ error: 'Revisi order tidak tersedia. Refresh lalu coba lagi.' }, { status: 409 });
    }
    if (order.cargoEntryMode === 'DELIVERY_ORDER') {
        return NextResponse.json(
            { error: 'Order ini memakai flow header booking. Edit header order lewat workflow header booking, bukan edit item order.' },
            { status: 409 }
        );
    }

    const relatedDeliveryOrder = (await listDocumentsByFilter<{ _id: string }>('deliveryOrder', { orderRef: id }))[0] || null;
    if (relatedDeliveryOrder) {
        return NextResponse.json({ error: 'Order yang sudah punya surat jalan tidak boleh mengubah item atau koli lagi' }, { status: 409 });
    }

    const existingItems = await listDocumentsByFilter<{
        _id: string;
        _rev?: string;
        description?: string;
        status?: string;
        deliveredQtyKoli?: number;
        deliveredWeight?: number;
        deliveredVolume?: number;
        assignedQtyKoli?: number;
        assignedWeight?: number;
        assignedVolume?: number;
        heldQtyKoli?: number;
        heldWeight?: number;
        heldVolume?: number;
    }>('orderItem', { orderRef: id });
    const hasOperationalProgress = existingItems.some(item =>
        normalizeNumber(item.deliveredQtyKoli) > 0 ||
        normalizeNumber(item.deliveredWeight) > 0 ||
        normalizeNumber(item.deliveredVolume) > 0 ||
        normalizeNumber(item.assignedQtyKoli) > 0 ||
        normalizeNumber(item.assignedWeight) > 0 ||
        normalizeNumber(item.assignedVolume) > 0 ||
        normalizeNumber(item.heldQtyKoli) > 0 ||
        normalizeNumber(item.heldWeight) > 0 ||
        normalizeNumber(item.heldVolume) > 0
    );
    if (hasOperationalProgress) {
        return NextResponse.json(
            { error: 'Order yang sudah punya progress parsial/hold harus diedit lewat workflow item order, bukan edit massal' },
            { status: 409 }
        );
    }

    let customer: ResolvedOrderPartyData['customer'];
    let service: ResolvedOrderPartyData['service'];
    let serviceName: string | undefined;
    let customerRecipient: ResolvedCustomerRecipientData | null = null;
    let customerPickup: ResolvedCustomerPickupData | null = null;
    let items: NormalizedOrderItemInput[];
    try {
        const party = await resolveOrderPartyData(customerRef, serviceRef);
        customer = party.customer;
        service = party.service;
        serviceName = party.serviceName;
        customerRecipient = await resolveOrderRecipientData(customerRef, customerRecipientRef);
        customerPickup = await resolveOrderPickupData(customerRef, customerPickupRef);
        items = await normalizeOrderItemsInput(customerRef, Array.isArray(data.items) ? data.items : [], {
            allowEmpty: true,
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Data order tidak valid';
        const status = message.includes('tidak ditemukan') ? 404 : message.includes('tidak aktif') ? 409 : 400;
        return NextResponse.json({ error: message }, { status });
    }
    if (items.length === 0 && existingItems.length > 0) {
        return NextResponse.json(
            { error: 'Order lama yang sudah punya item target tidak boleh dikosongkan. Barang tetap mengikuti histori order ini.' },
            { status: 409 }
        );
    }

    const receiverName =
        normalizeText(data.receiverName) ||
        normalizeText(order.receiverName) ||
        normalizeOptionalText(customerRecipient?.receiverName) ||
        customer.name ||
        '';
    const receiverAddress =
        normalizeText(data.receiverAddress) ||
        normalizeText(order.receiverAddress) ||
        normalizeOptionalText(customerRecipient?.receiverAddress) ||
        normalizeOptionalText(data.pickupAddress) ||
        normalizeOptionalText(order.pickupAddress) ||
        customer.address ||
        '';
    if (!receiverName || !receiverAddress) {
        return NextResponse.json({ error: 'Order, customer, dan pickup wajib diisi' }, { status: 400 });
    }
    if (!isSupabaseBackendEnabled() && existingItems.some(item => !item._rev)) {
        return NextResponse.json({ error: 'Revisi item order tidak tersedia. Refresh lalu coba lagi.' }, { status: 409 });
    }
    if (!customer._rev && !isSupabaseBackendEnabled()) {
        return NextResponse.json({ error: 'Revisi customer tidak tersedia. Refresh lalu coba lagi.' }, { status: 409 });
    }
    if (serviceRef && !service?._rev && !isSupabaseBackendEnabled()) {
        return NextResponse.json({ error: 'Revisi kategori armada tidak tersedia. Refresh lalu coba lagi.' }, { status: 409 });
    }
    if (customerRecipientRef && !customerRecipient?._rev && !isSupabaseBackendEnabled()) {
        return NextResponse.json({ error: 'Revisi master penerima tidak tersedia. Refresh lalu coba lagi.' }, { status: 409 });
    }
    if (customerPickupRef && !customerPickup?._rev && !isSupabaseBackendEnabled()) {
        return NextResponse.json({ error: 'Revisi master pickup tidak tersedia. Refresh lalu coba lagi.' }, { status: 409 });
    }

    const mutationTimestamp = new Date().toISOString();
    try {
        const touchPromises: Array<Promise<unknown>> = [
            updateDocument(customer._id, { updatedAt: mutationTimestamp }, 'customer'),
            updateDocument(id, {
            cargoEntryMode: 'ORDER',
            customerRef,
            customerName: customer.name,
            customerRecipientRef: customerRecipientRef || undefined,
            customerPickupRef: customerPickupRef || undefined,
            receiverName,
            receiverPhone: normalizeOptionalText(data.receiverPhone) || normalizeOptionalText(customerRecipient?.receiverPhone) || '',
            receiverAddress,
            receiverCompany: normalizeOptionalText(data.receiverCompany) || normalizeOptionalText(customerRecipient?.receiverCompany),
            pickupAddress: normalizeOptionalText(data.pickupAddress) || normalizeOptionalText(customerPickup?.pickupAddress) || customer.address || undefined,
            serviceRef: serviceRef || '',
            serviceName,
            notes: normalizeOptionalText(data.notes),
            }, 'order'),
        ];
        if (serviceRef && service?._id) {
            touchPromises.push(updateDocument(service._id, { updatedAt: mutationTimestamp }, 'service'));
        }
        const seenProductRefs = new Set<string>();
        for (const item of items) {
            if (!item.customerProductRef || seenProductRefs.has(item.customerProductRef)) {
                continue;
            }
            touchPromises.push(updateDocument(item.customerProductRef, { updatedAt: mutationTimestamp }, 'customerProduct'));
            seenProductRefs.add(item.customerProductRef);
        }
        if (customerRecipientRef && customerRecipient?._id) {
            touchPromises.push(updateDocument(customerRecipient._id, { updatedAt: mutationTimestamp }, 'customerRecipient'));
        }
        if (customerPickupRef && customerPickup?._id) {
            touchPromises.push(updateDocument(customerPickup._id, { updatedAt: mutationTimestamp }, 'customerPickupLocation'));
        }
        await Promise.all(touchPromises);
        await Promise.all(existingItems.map(existingItem => deleteDocument(existingItem._id, 'orderItem')));
        await Promise.all(items.map(item => createDocument(buildOrderItemDraftDocument(id, item))));
    } catch (error) {
        if (isMutationConflictError(error)) {
            return NextResponse.json(
                { error: 'Data order, customer, barang customer, tujuan, pickup, kategori armada, atau item target berubah karena ada update lain. Refresh lalu coba lagi.' },
                { status: 409 }
            );
        }
        throw error;
    }
    await addAuditLog(
        session,
        'UPDATE',
        'orders',
        id,
        `Update order ${order.masterResi || id}${items.length > 0 ? ` dengan ${items.length} item` : ' sebagai header booking tanpa item'}`
    );

    const updatedOrder = await getDocumentById(id, 'order');
    return NextResponse.json({ data: updatedOrder, id });
}

export async function handleOrderHeaderBookingUpdate(
    session: ApiSession,
    data: Record<string, unknown>,
    addAuditLog: AuditLogFn
) {
    const id = normalizeText(data.id);
    const customerRef = normalizeText(data.customerRef);
    const serviceRef = normalizeOptionalText(data.serviceRef);
    const customerRecipientRef = normalizeOptionalText(data.customerRecipientRef);
    const customerPickupRef = normalizeOptionalText(data.customerPickupRef);
    const notes = normalizeOptionalText(data.notes);

    if (!id || !customerRef) {
        return NextResponse.json({ error: 'Order, customer, penerima, dan alamat tujuan wajib diisi' }, { status: 400 });
    }

    const order = await getDocumentById<{
        _createdAt?: string;
        _id: string;
        _rev?: string;
        createdAt?: string;
        masterResi?: string;
        cargoEntryMode?: 'ORDER' | 'DELIVERY_ORDER';
        customerRef?: string;
        customerRecipientRef?: string;
        customerPickupRef?: string;
        receiverName?: string;
        receiverPhone?: string;
        receiverAddress?: string;
        receiverCompany?: string;
        pickupAddress?: string;
        pickupStops?: OrderPickupStop[];
        tripPlans?: OrderTripPlan[];
        serviceRef?: string;
        notes?: string;
    }>(id, 'order');
    if (!order) {
        return NextResponse.json({ error: 'Order tidak ditemukan' }, { status: 404 });
    }
    if (order.cargoEntryMode !== 'DELIVERY_ORDER') {
        return NextResponse.json(
            { error: 'Order ini masih memakai flow item target di order. Gunakan edit order biasa.' },
            { status: 409 }
        );
    }

    const relatedDeliveryOrder = (await listDocumentsByFilter<{ _id: string }>('deliveryOrder', { orderRef: id }))[0] || null;

    if (relatedDeliveryOrder) {
        const hasChanged = (field: string, currentValue: unknown, normalizer: (value: unknown) => string | undefined = normalizeOptionalText) => (
            Object.prototype.hasOwnProperty.call(data, field) && (normalizer(currentValue) || '') !== (normalizer(data[field]) || '')
        );
        const attemptedHeaderChanges =
            hasChanged('customerRef', order.customerRef, normalizeText) ||
            hasChanged('serviceRef', order.serviceRef) ||
            hasChanged('customerRecipientRef', order.customerRecipientRef) ||
            hasChanged('customerPickupRef', order.customerPickupRef) ||
            hasChanged('receiverName', order.receiverName, normalizeText) ||
            hasChanged('receiverPhone', order.receiverPhone) ||
            hasChanged('receiverAddress', order.receiverAddress, normalizeText) ||
            hasChanged('receiverCompany', order.receiverCompany) ||
            hasChanged('pickupAddress', order.pickupAddress) ||
            Object.prototype.hasOwnProperty.call(data, 'pickupStops');

        if (attemptedHeaderChanges) {
            return NextResponse.json(
                { error: 'Order header booking yang sudah punya Surat Jalan hanya boleh mengubah catatan umum.' },
                { status: 409 }
            );
        }

        if (!order._rev && !isSupabaseBackendEnabled()) {
            return NextResponse.json({ error: 'Revisi order tidak tersedia. Refresh lalu coba lagi.' }, { status: 409 });
        }

        let updatedOrder: unknown;
        try {
            updatedOrder = await updateDocument(id, { notes }, 'order');
        } catch (error) {
            if (isMutationConflictError(error)) {
                return NextResponse.json(
                    { error: 'Header booking berubah karena ada update lain. Refresh lalu coba lagi.' },
                    { status: 409 }
                );
            }
            throw error;
        }
        await addAuditLog(
            session,
            'UPDATE',
            'orders',
            id,
            `Update header booking ${order.masterResi || id}: catatan umum diperbarui setelah Surat Jalan terbit`
        );
        return NextResponse.json({ data: updatedOrder, id });
    }

    let customer: ResolvedOrderPartyData['customer'];
    let service: ResolvedOrderPartyData['service'];
    let serviceName: string | undefined;
    let customerRecipient: ResolvedCustomerRecipientData | null = null;
    let customerPickup: ResolvedCustomerPickupData | null = null;
    try {
        const party = await resolveOrderPartyData(customerRef, serviceRef);
        customer = party.customer;
        service = party.service;
        serviceName = party.serviceName;
        customerRecipient = await resolveOrderRecipientData(customerRef, customerRecipientRef);
        customerPickup = await resolveOrderPickupData(customerRef, customerPickupRef);
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Data order tidak valid';
        const status = message.includes('tidak ditemukan') ? 404 : message.includes('tidak aktif') ? 409 : 400;
        return NextResponse.json({ error: message }, { status });
    }

    const receiverName =
        normalizeText(data.receiverName) ||
        normalizeText(order.receiverName) ||
        normalizeOptionalText(customerRecipient?.receiverName) ||
        customer.name ||
        '';
    const receiverAddress =
        normalizeText(data.receiverAddress) ||
        normalizeText(order.receiverAddress) ||
        normalizeOptionalText(customerRecipient?.receiverAddress) ||
        normalizeOptionalText(data.pickupAddress) ||
        normalizeOptionalText(order.pickupAddress) ||
        customer.address ||
        '';
    if (!receiverName || !receiverAddress) {
        return NextResponse.json({ error: 'Order, customer, dan pickup wajib diisi' }, { status: 400 });
    }

    if (!order._rev && !isSupabaseBackendEnabled()) {
        return NextResponse.json({ error: 'Revisi order tidak tersedia. Refresh lalu coba lagi.' }, { status: 409 });
    }
    if (!customer._rev && !isSupabaseBackendEnabled()) {
        return NextResponse.json({ error: 'Revisi customer tidak tersedia. Refresh lalu coba lagi.' }, { status: 409 });
    }
    if (serviceRef && !service?._rev && !isSupabaseBackendEnabled()) {
        return NextResponse.json({ error: 'Revisi kategori armada tidak tersedia. Refresh lalu coba lagi.' }, { status: 409 });
    }
    if (customerRecipientRef && !customerRecipient?._rev && !isSupabaseBackendEnabled()) {
        return NextResponse.json({ error: 'Revisi master penerima tidak tersedia. Refresh lalu coba lagi.' }, { status: 409 });
    }
    if (customerPickupRef && !customerPickup?._rev && !isSupabaseBackendEnabled()) {
        return NextResponse.json({ error: 'Revisi master pickup tidak tersedia. Refresh lalu coba lagi.' }, { status: 409 });
    }

    const pickupStops = normalizeOrderPickupStopsInput(
        Array.isArray(data.pickupStops) ? data.pickupStops : [],
        normalizeOptionalText(data.pickupAddress) || normalizeOptionalText(order.pickupAddress) || normalizeOptionalText(customerPickup?.pickupAddress) || customer.address
    );
    if (pickupStops.length === 0) {
        return NextResponse.json({ error: 'Minimal 1 titik pickup wajib diisi' }, { status: 400 });
    }
    const pickupStopKeys = pickupStops.map(stop => stop._key).filter((key): key is string => Boolean(key));
    const currentTripPlans = Array.isArray(order.tripPlans) ? order.tripPlans : [];
    const nextTripPlans = currentTripPlans.map(plan => {
        const existingKeys = Array.isArray(plan.pickupStopKeys) ? plan.pickupStopKeys : [];
        const validKeys = existingKeys.filter(key => pickupStopKeys.includes(key));
        const nextKeys = currentTripPlans.length === 1
            ? pickupStopKeys
            : validKeys.length > 0
                ? validKeys
                : pickupStopKeys.slice(0, 1);
        return { ...plan, pickupStopKeys: nextKeys };
    });

    let updatedOrder: unknown;
    try {
        const mutationTimestamp = new Date().toISOString();
        await updateDocument(customer._id, { updatedAt: mutationTimestamp }, 'customer');
        if (serviceRef && service?._id) {
            await updateDocument(service._id, { updatedAt: mutationTimestamp }, 'service');
        }
        if (customerRecipientRef && customerRecipient?._id) {
            await updateDocument(customerRecipient._id, { updatedAt: mutationTimestamp }, 'customerRecipient');
        }
        if (customerPickupRef && customerPickup?._id) {
            await updateDocument(customerPickup._id, { updatedAt: mutationTimestamp }, 'customerPickupLocation');
        }
        updatedOrder = await updateDocument(id, {
            cargoEntryMode: 'DELIVERY_ORDER',
            customerRef,
            customerName: customer.name,
            customerRecipientRef: customerRecipientRef || undefined,
            customerPickupRef: pickupStops[0]?.customerPickupRef || customerPickupRef || undefined,
            receiverName: receiverName || normalizeText(order.receiverName) || customer.name,
            receiverPhone: normalizeOptionalText(data.receiverPhone) || normalizeOptionalText(order.receiverPhone) || normalizeOptionalText(customerRecipient?.receiverPhone) || '',
            receiverAddress: receiverAddress || normalizeText(order.receiverAddress) || normalizeOptionalText(customer.address),
            receiverCompany: normalizeOptionalText(data.receiverCompany) || normalizeOptionalText(order.receiverCompany) || normalizeOptionalText(customerRecipient?.receiverCompany),
            pickupAddress: pickupStops[0]?.pickupAddress || normalizeOptionalText(data.pickupAddress) || normalizeOptionalText(customerPickup?.pickupAddress) || customer.address || undefined,
            pickupStops,
            tripPlans: nextTripPlans.length > 0 ? nextTripPlans : undefined,
            serviceRef: serviceRef || '',
            serviceName,
            notes,
        }, 'order');
    } catch (error) {
        if (isMutationConflictError(error)) {
            return NextResponse.json(
                { error: 'Header booking, customer, tujuan, pickup, atau kategori armada berubah karena ada update lain. Refresh lalu coba lagi.' },
                { status: 409 }
            );
        }
        throw error;
    }

    await addAuditLog(
        session,
        'UPDATE',
        'orders',
        id,
        `Update header booking ${order.masterResi || id}: customer, tujuan, armada, atau catatan diperbarui`
    );
    return NextResponse.json({ data: updatedOrder, id });
}

export async function handleOrderTripPlanAppend(
    session: ApiSession,
    data: Record<string, unknown>,
    addAuditLog: AuditLogFn
) {
    const id = normalizeText(data.id);
    if (!id) {
        return NextResponse.json({ error: 'Order tidak valid' }, { status: 400 });
    }

    const order = await getDocumentById<{
        _id: string;
        _rev?: string;
        masterResi?: string;
        cargoEntryMode?: 'ORDER' | 'DELIVERY_ORDER';
        customerRef?: string;
        customerPickupRef?: string;
        pickupAddress?: string;
        pickupStops?: OrderPickupStop[];
        tripPlans?: OrderTripPlan[];
        serviceRef?: string;
    }>(id, 'order');
    if (!order) {
        return NextResponse.json({ error: 'Order tidak ditemukan' }, { status: 404 });
    }
    if (order.cargoEntryMode !== 'DELIVERY_ORDER') {
        return NextResponse.json(
            { error: 'Tambah rencana trip hanya berlaku untuk order header booking.' },
            { status: 409 }
        );
    }
    if (!order._rev && !isSupabaseBackendEnabled()) {
        return NextResponse.json({ error: 'Revisi order tidak tersedia. Refresh lalu coba lagi.' }, { status: 409 });
    }

    const requestedCustomerRef = normalizeOptionalText(data.customerRef);
    const orderCustomerRef = normalizeText(order.customerRef);
    if (!orderCustomerRef) {
        return NextResponse.json({ error: 'Customer order tidak valid' }, { status: 409 });
    }
    if (requestedCustomerRef && requestedCustomerRef !== orderCustomerRef) {
        return NextResponse.json({ error: 'Customer order tidak boleh diganti saat menambah trip.' }, { status: 409 });
    }

    const currentOrderPickupStops = normalizeOrderPickupStopsInput(
        Array.isArray(order.pickupStops) ? order.pickupStops : [],
        order.pickupAddress
    ).map((stop, index) => ({
        ...stop,
        sequence: index + 1,
    }));
    if (currentOrderPickupStops.length === 0) {
        return NextResponse.json({ error: 'Order belum punya titik pickup yang bisa dipakai untuk trip.' }, { status: 409 });
    }

    const requestedPickupStopKeys = Array.isArray(data.pickupStopKeys)
        ? data.pickupStopKeys.map(key => normalizeOptionalText(key)).filter((key): key is string => Boolean(key))
        : [];
    const extraPickupRefs = [
        ...new Set([
            ...requestedPickupStopKeys
                .filter(key => key.startsWith('customer-pickup:'))
                .map(key => key.replace('customer-pickup:', '')),
            ...(Array.isArray(data.extraPickupRefs)
                ? data.extraPickupRefs.map(ref => normalizeOptionalText(ref)).filter((ref): ref is string => Boolean(ref))
                : []),
        ]),
    ];
    const extraPickupDocs = extraPickupRefs.length > 0
        ? await listDocumentsByFilter<{
            _id: string;
            customerRef?: unknown;
            label?: string;
            pickupAddress?: string;
            notes?: string;
            active?: boolean;
        }>('customerPickupLocation', { _id: extraPickupRefs })
        : [];
    if (extraPickupDocs.length !== extraPickupRefs.length) {
        return NextResponse.json({ error: 'Sebagian master pickup tambahan tidak ditemukan' }, { status: 404 });
    }
    const invalidExtraPickup = extraPickupDocs.find(pickup =>
        extractRefId(pickup.customerRef) !== orderCustomerRef ||
        pickup.active === false ||
        !normalizeOptionalText(pickup.pickupAddress)
    );
    if (invalidExtraPickup) {
        return NextResponse.json({ error: 'Master pickup tambahan tidak aktif atau tidak sesuai customer order' }, { status: 409 });
    }

    const orderPickupByMasterRef = new Map(
        currentOrderPickupStops
            .map(stop => [normalizeOptionalText(stop.customerPickupRef), stop] as const)
            .filter(([customerPickupRef]) => Boolean(customerPickupRef))
    );
    const orderPickupByAddress = new Map(
        currentOrderPickupStops
            .map(stop => [normalizeText(stop.pickupAddress).toLowerCase(), stop] as const)
            .filter(([pickupAddress]) => Boolean(pickupAddress))
    );
    const pickupStopKeyAlias = new Map<string, string>();
    const extraOrderPickupStops: OrderPickupStop[] = [];
    for (const pickup of extraPickupDocs) {
        const pickupAddress = normalizeText(pickup.pickupAddress);
        const existingStop =
            orderPickupByMasterRef.get(pickup._id) ||
            orderPickupByAddress.get(pickupAddress.toLowerCase());
        if (existingStop?._key) {
            pickupStopKeyAlias.set(`customer-pickup:${pickup._id}`, existingStop._key);
            continue;
        }

        const newStop: OrderPickupStop = {
            _key: crypto.randomUUID(),
            sequence: currentOrderPickupStops.length + extraOrderPickupStops.length + 1,
            customerPickupRef: pickup._id,
            pickupLabel: normalizeOptionalText(pickup.label),
            pickupAddress,
            notes: normalizeOptionalText(pickup.notes),
        };
        extraOrderPickupStops.push(newStop);
        orderPickupByMasterRef.set(pickup._id, newStop);
        orderPickupByAddress.set(pickupAddress.toLowerCase(), newStop);
        pickupStopKeyAlias.set(`customer-pickup:${pickup._id}`, newStop._key || '');
    }

    const effectiveOrderPickupStops = [...currentOrderPickupStops, ...extraOrderPickupStops]
        .map((stop, index) => ({
            ...stop,
            sequence: index + 1,
        }));
    const remapPickupStopKey = (key: unknown) => {
        const normalizedKey = normalizeOptionalText(key);
        return normalizedKey ? pickupStopKeyAlias.get(normalizedKey) || normalizedKey : undefined;
    };
    const nextTripPayload = {
        ...data,
        _key: crypto.randomUUID(),
        pickupStopKeys: requestedPickupStopKeys
            .map(remapPickupStopKey)
            .filter((key): key is string => Boolean(key && !key.startsWith('customer-pickup:'))),
    };

    let normalizedNewTripPlans: OrderTripPlan[];
    try {
        normalizedNewTripPlans = await normalizeOrderTripPlansInput(
            [nextTripPayload],
            effectiveOrderPickupStops,
            normalizeOptionalText(order.serviceRef) || undefined
        );
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Data trip tidak valid';
        const status = message.includes('tidak ditemukan') ? 404 : message.includes('tidak aktif') ? 409 : 400;
        return NextResponse.json({ error: message }, { status });
    }

    const currentTripPlans = Array.isArray(order.tripPlans) ? order.tripPlans : [];
    const nextTripPlans = [...currentTripPlans, ...normalizedNewTripPlans].map((plan, index) => ({
        ...plan,
        sequence: index + 1,
    }));

    let updatedOrder: unknown;
    try {
        updatedOrder = await updateDocument(id, {
            pickupStops: effectiveOrderPickupStops,
            pickupAddress: effectiveOrderPickupStops[0]?.pickupAddress || order.pickupAddress,
            customerPickupRef: effectiveOrderPickupStops[0]?.customerPickupRef || order.customerPickupRef,
            tripPlans: nextTripPlans,
        }, 'order');
    } catch (error) {
        if (isMutationConflictError(error)) {
            return NextResponse.json(
                { error: 'Rencana trip order berubah karena ada update lain. Refresh lalu coba lagi.' },
                { status: 409 }
            );
        }
        throw error;
    }

    const createdTripPlan = nextTripPlans[nextTripPlans.length - 1];
    await addAuditLog(
        session,
        'UPDATE',
        'orders',
        id,
        `Tambah rencana trip pada ${order.masterResi || id}: ${createdTripPlan.vehiclePlate || createdTripPlan.vehicleRef} / ${createdTripPlan.driverName || createdTripPlan.driverRef}`
    );
    return NextResponse.json({ data: updatedOrder, id, tripPlan: createdTripPlan });
}

export async function handleOrderTripPlanUpdate(
    session: ApiSession,
    data: Record<string, unknown>,
    addAuditLog: AuditLogFn
) {
    const id = normalizeText(data.id);
    const tripPlanKey = normalizeText(data.tripPlanKey);
    if (!id || !tripPlanKey) {
        return NextResponse.json({ error: 'Rencana trip tidak valid' }, { status: 400 });
    }

    const order = await getDocumentById<{
        _id: string;
        _rev?: string;
        masterResi?: string;
        cargoEntryMode?: 'ORDER' | 'DELIVERY_ORDER';
        customerRef?: string;
        customerPickupRef?: string;
        pickupAddress?: string;
        pickupStops?: OrderPickupStop[];
        tripPlans?: OrderTripPlan[];
        serviceRef?: string;
    }>(id, 'order');
    if (!order) {
        return NextResponse.json({ error: 'Order tidak ditemukan' }, { status: 404 });
    }
    if (order.cargoEntryMode !== 'DELIVERY_ORDER') {
        return NextResponse.json(
            { error: 'Edit rencana trip hanya berlaku untuk order header booking.' },
            { status: 409 }
        );
    }
    if (!order._rev && !isSupabaseBackendEnabled()) {
        return NextResponse.json({ error: 'Revisi order tidak tersedia. Refresh lalu coba lagi.' }, { status: 409 });
    }

    const currentTripPlans = Array.isArray(order.tripPlans) ? order.tripPlans : [];
    const existingTripPlan = currentTripPlans.find(plan => normalizeOptionalText(plan._key) === tripPlanKey) || null;
    if (!existingTripPlan) {
        return NextResponse.json({ error: 'Rencana trip tidak ditemukan. Refresh lalu coba lagi.' }, { status: 404 });
    }
    if (existingTripPlan.linkedDeliveryOrderRef) {
        return NextResponse.json(
            { error: 'Rencana trip yang sudah punya SJ tidak bisa diedit dari detail order.' },
            { status: 409 }
        );
    }

    const requestedCustomerRef = normalizeOptionalText(data.customerRef);
    const orderCustomerRef = normalizeText(order.customerRef);
    if (!orderCustomerRef) {
        return NextResponse.json({ error: 'Customer order tidak valid' }, { status: 409 });
    }
    if (requestedCustomerRef && requestedCustomerRef !== orderCustomerRef) {
        return NextResponse.json({ error: 'Customer order tidak boleh diganti saat mengubah trip.' }, { status: 409 });
    }

    const currentOrderPickupStops = normalizeOrderPickupStopsInput(
        Array.isArray(order.pickupStops) ? order.pickupStops : [],
        order.pickupAddress
    ).map((stop, index) => ({
        ...stop,
        sequence: index + 1,
    }));
    if (currentOrderPickupStops.length === 0) {
        return NextResponse.json({ error: 'Order belum punya titik pickup yang bisa dipakai untuk trip.' }, { status: 409 });
    }

    const requestedPickupStopKeys = Array.isArray(data.pickupStopKeys)
        ? data.pickupStopKeys.map(key => normalizeOptionalText(key)).filter((key): key is string => Boolean(key))
        : [];
    const extraPickupRefs = [
        ...new Set([
            ...requestedPickupStopKeys
                .filter(key => key.startsWith('customer-pickup:'))
                .map(key => key.replace('customer-pickup:', '')),
            ...(Array.isArray(data.extraPickupRefs)
                ? data.extraPickupRefs.map(ref => normalizeOptionalText(ref)).filter((ref): ref is string => Boolean(ref))
                : []),
        ]),
    ];
    const extraPickupDocs = extraPickupRefs.length > 0
        ? await listDocumentsByFilter<{
            _id: string;
            customerRef?: unknown;
            label?: string;
            pickupAddress?: string;
            notes?: string;
            active?: boolean;
        }>('customerPickupLocation', { _id: extraPickupRefs })
        : [];
    if (extraPickupDocs.length !== extraPickupRefs.length) {
        return NextResponse.json({ error: 'Sebagian master pickup tambahan tidak ditemukan' }, { status: 404 });
    }
    const invalidExtraPickup = extraPickupDocs.find(pickup =>
        extractRefId(pickup.customerRef) !== orderCustomerRef ||
        pickup.active === false ||
        !normalizeOptionalText(pickup.pickupAddress)
    );
    if (invalidExtraPickup) {
        return NextResponse.json({ error: 'Master pickup tambahan tidak aktif atau tidak sesuai customer order' }, { status: 409 });
    }

    const orderPickupByMasterRef = new Map(
        currentOrderPickupStops
            .map(stop => [normalizeOptionalText(stop.customerPickupRef), stop] as const)
            .filter(([customerPickupRef]) => Boolean(customerPickupRef))
    );
    const orderPickupByAddress = new Map(
        currentOrderPickupStops
            .map(stop => [normalizeText(stop.pickupAddress).toLowerCase(), stop] as const)
            .filter(([pickupAddress]) => Boolean(pickupAddress))
    );
    const pickupStopKeyAlias = new Map<string, string>();
    const extraOrderPickupStops: OrderPickupStop[] = [];
    for (const pickup of extraPickupDocs) {
        const pickupAddress = normalizeText(pickup.pickupAddress);
        const existingStop =
            orderPickupByMasterRef.get(pickup._id) ||
            orderPickupByAddress.get(pickupAddress.toLowerCase());
        if (existingStop?._key) {
            pickupStopKeyAlias.set(`customer-pickup:${pickup._id}`, existingStop._key);
            continue;
        }

        const newStop: OrderPickupStop = {
            _key: crypto.randomUUID(),
            sequence: currentOrderPickupStops.length + extraOrderPickupStops.length + 1,
            customerPickupRef: pickup._id,
            pickupLabel: normalizeOptionalText(pickup.label),
            pickupAddress,
            notes: normalizeOptionalText(pickup.notes),
        };
        extraOrderPickupStops.push(newStop);
        orderPickupByMasterRef.set(pickup._id, newStop);
        orderPickupByAddress.set(pickupAddress.toLowerCase(), newStop);
        pickupStopKeyAlias.set(`customer-pickup:${pickup._id}`, newStop._key || '');
    }

    const effectiveOrderPickupStops = [...currentOrderPickupStops, ...extraOrderPickupStops]
        .map((stop, index) => ({
            ...stop,
            sequence: index + 1,
        }));
    const remapPickupStopKey = (key: unknown) => {
        const normalizedKey = normalizeOptionalText(key);
        return normalizedKey ? pickupStopKeyAlias.get(normalizedKey) || normalizedKey : undefined;
    };
    const nextTripPayload = {
        ...data,
        _key: tripPlanKey,
        pickupStopKeys: requestedPickupStopKeys
            .map(remapPickupStopKey)
            .filter((key): key is string => Boolean(key && !key.startsWith('customer-pickup:'))),
    };

    let normalizedTripPlans: OrderTripPlan[];
    try {
        normalizedTripPlans = await normalizeOrderTripPlansInput(
            [nextTripPayload],
            effectiveOrderPickupStops,
            normalizeOptionalText(order.serviceRef) || undefined
        );
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Data trip tidak valid';
        const status = message.includes('tidak ditemukan') ? 404 : message.includes('tidak aktif') ? 409 : 400;
        return NextResponse.json({ error: message }, { status });
    }

    const updatedTripPlan = normalizedTripPlans[0];
    const nextTripPlans = currentTripPlans.map(plan =>
        normalizeOptionalText(plan._key) === tripPlanKey
            ? { ...updatedTripPlan, sequence: plan.sequence, _key: tripPlanKey }
            : plan
    ).map((plan, index) => ({
        ...plan,
        sequence: index + 1,
    }));

    let updatedOrder: unknown;
    try {
        updatedOrder = await updateDocument(id, {
            pickupStops: effectiveOrderPickupStops,
            pickupAddress: effectiveOrderPickupStops[0]?.pickupAddress || order.pickupAddress,
            customerPickupRef: effectiveOrderPickupStops[0]?.customerPickupRef || order.customerPickupRef,
            tripPlans: nextTripPlans,
        }, 'order');
    } catch (error) {
        if (isMutationConflictError(error)) {
            return NextResponse.json(
                { error: 'Rencana trip order berubah karena ada update lain. Refresh lalu coba lagi.' },
                { status: 409 }
            );
        }
        throw error;
    }

    await addAuditLog(
        session,
        'UPDATE',
        'orders',
        id,
        `Edit rencana trip pada ${order.masterResi || id}: ${updatedTripPlan.vehiclePlate || updatedTripPlan.vehicleRef} / ${updatedTripPlan.driverName || updatedTripPlan.driverRef}`
    );
    return NextResponse.json({ data: updatedOrder, id, tripPlan: updatedTripPlan });
}

export async function handleOrderTripPlanDelete(
    session: ApiSession,
    data: Record<string, unknown>,
    addAuditLog: AuditLogFn
) {
    const id = normalizeText(data.id);
    const tripPlanKey = normalizeText(data.tripPlanKey);
    if (!id || !tripPlanKey) {
        return NextResponse.json({ error: 'Rencana trip tidak valid' }, { status: 400 });
    }

    const order = await getDocumentById<{
        _id: string;
        _rev?: string;
        masterResi?: string;
        tripPlans?: OrderTripPlan[];
    }>(id, 'order');
    if (!order) {
        return NextResponse.json({ error: 'Order tidak ditemukan' }, { status: 404 });
    }
    if (!order._rev && !isSupabaseBackendEnabled()) {
        return NextResponse.json({ error: 'Revisi order tidak tersedia. Refresh lalu coba lagi.' }, { status: 409 });
    }

    const currentTripPlans = Array.isArray(order.tripPlans) ? order.tripPlans : [];
    const tripPlan = currentTripPlans.find(plan => normalizeOptionalText(plan._key) === tripPlanKey) || null;
    if (!tripPlan) {
        return NextResponse.json({ error: 'Rencana trip tidak ditemukan. Refresh lalu coba lagi.' }, { status: 404 });
    }
    if (tripPlan.linkedDeliveryOrderRef) {
        return NextResponse.json(
            { error: 'Rencana trip yang sudah punya SJ tidak bisa dihapus dari detail order.' },
            { status: 409 }
        );
    }

    const nextTripPlans = currentTripPlans
        .filter(plan => normalizeOptionalText(plan._key) !== tripPlanKey)
        .map((plan, index) => ({
            ...plan,
            sequence: index + 1,
        }));

    let updatedOrder: unknown;
    try {
        updatedOrder = await updateDocument(id, {
            tripPlans: nextTripPlans.length > 0 ? nextTripPlans : undefined,
        }, 'order');
    } catch (error) {
        if (isMutationConflictError(error)) {
            return NextResponse.json(
                { error: 'Rencana trip order berubah karena ada update lain. Refresh lalu coba lagi.' },
                { status: 409 }
            );
        }
        throw error;
    }

    await addAuditLog(
        session,
        'UPDATE',
        'orders',
        id,
        `Hapus rencana trip ${tripPlan.sequence} pada ${order.masterResi || id}`
    );
    return NextResponse.json({ data: updatedOrder, id, deletedTripPlanKey: tripPlanKey });
}

export async function handleOrderTargetRevision(
    session: ApiSession,
    data: Record<string, unknown>,
    addAuditLog: AuditLogFn
) {
    const id = normalizeText(data.id);
    const revisionReason = normalizeOptionalText(data.revisionReason);
    if (!id) {
        return NextResponse.json({ error: 'Order tidak valid' }, { status: 400 });
    }
    if (!revisionReason) {
        return NextResponse.json({ error: 'Alasan revisi order wajib diisi' }, { status: 400 });
    }

    const order = await getDocumentById<{ _id: string; _rev?: string; masterResi?: string; notes?: string; cargoEntryMode?: 'ORDER' | 'DELIVERY_ORDER' }>(id, 'order');
    if (!order) {
        return NextResponse.json({ error: 'Order tidak ditemukan' }, { status: 404 });
    }
    if (order.cargoEntryMode === 'DELIVERY_ORDER') {
        return NextResponse.json(
            { error: 'Order header booking tidak memakai revisi target item. Barang tetap mengikuti Surat Jalan.' },
            { status: 409 }
        );
    }

    const existingItems = await listDocumentsByFilter<OrderItemProgressSnapshot & { _rev?: string }>('orderItem', { orderRef: id });
    if (existingItems.length === 0) {
        return NextResponse.json({ error: 'Order belum punya item yang bisa direvisi' }, { status: 409 });
    }
    const rawItems = Array.isArray(data.items) ? data.items.filter(isPlainObject) : [];
    if (rawItems.length !== existingItems.length) {
        return NextResponse.json(
            { error: 'Revisi order hanya boleh mengubah target item yang sudah ada, tanpa menambah atau menghapus item' },
            { status: 409 }
        );
    }

    const rawItemById = new Map<string, Record<string, unknown>>();
    for (const rawItem of rawItems) {
        const itemId = normalizeText(rawItem.id);
        if (itemId) {
            rawItemById.set(itemId, rawItem);
        }
    }
    if (rawItemById.size !== existingItems.length) {
        return NextResponse.json({ error: 'Data item revisi tidak lengkap' }, { status: 400 });
    }

    const revisionSummaries: string[] = [];

    for (const existingItem of existingItems) {
        const rawItem = rawItemById.get(existingItem._id);
        if (!rawItem) {
            return NextResponse.json({ error: 'Ada item order yang belum ikut direvisi' }, { status: 400 });
        }

        const qtyKoli = roundQuantity(normalizeNumber(rawItem.qtyKoli));
        if (!Number.isFinite(qtyKoli) || qtyKoli < 0) {
            return NextResponse.json(
                { error: `Target koli untuk ${existingItem.description || 'item order'} tidak valid` },
                { status: 400 }
            );
        }

        let weightInputUnit: WeightInputUnit;
        let volumeInputUnit: VolumeInputUnit;
        try {
            weightInputUnit = resolvePayloadWeightInputUnit(rawItem.weightInputUnit, `Satuan berat target ${existingItem.description || 'item order'}`);
            volumeInputUnit = resolvePayloadVolumeInputUnit(rawItem.volumeInputUnit, `Satuan volume target ${existingItem.description || 'item order'}`);
        } catch (error) {
            return NextResponse.json(
                { error: error instanceof Error ? error.message : `Satuan item ${existingItem.description || 'item order'} tidak valid` },
                { status: 400 }
            );
        }
        const weightInputValue = roundQuantity(normalizeNumber(rawItem.weightInputValue, {
            maxFractionDigits: getWeightInputFractionDigits(weightInputUnit),
        }), getWeightInputFractionDigits(weightInputUnit));
        if (!Number.isFinite(weightInputValue) || weightInputValue < 0) {
            return NextResponse.json(
                { error: `Target berat untuk ${existingItem.description || 'item order'} tidak valid` },
                { status: 400 }
            );
        }
        const weight = roundQuantity(convertWeightToKg(weightInputValue, weightInputUnit));

        const volumeInputValue = roundQuantity(normalizeNumber(rawItem.volumeInputValue, {
            maxFractionDigits: volumeInputUnit === 'LITER' ? 0 : 3,
        }), volumeInputUnit === 'LITER' ? 0 : 3);
        if (!Number.isFinite(volumeInputValue) || volumeInputValue < 0) {
            return NextResponse.json(
                { error: `Target volume untuk ${existingItem.description || 'item order'} tidak valid` },
                { status: 400 }
            );
        }
        const volume = roundQuantity(convertVolumeToM3(volumeInputValue, volumeInputUnit), 3);

        const progress = getOrderItemProgress(existingItem);
        const lockedQtyKoli = roundQuantity(progress.deliveredQtyKoli + progress.assignedQtyKoli);
        const lockedWeight = roundQuantity(progress.deliveredWeight + progress.assignedWeight);
        const lockedVolume = roundQuantity(progress.deliveredVolume + progress.assignedVolume, 3);
        const hadHoldProgress =
            progress.heldQtyKoli > 0 ||
            progress.heldWeight > 0 ||
            progress.heldVolume > 0;

        if (qtyKoli <= 0 && weight <= 0 && volume <= 0) {
            return NextResponse.json(
                { error: `Target ${existingItem.description || 'item order'} wajib punya koli, berat, atau volume lebih dari 0` },
                { status: 400 }
            );
        }

        if (lockedQtyKoli > 0 && qtyKoli < lockedQtyKoli) {
            return NextResponse.json(
                {
                    error: `Target koli ${existingItem.description || 'item order'} tidak boleh lebih kecil dari progress yang sudah terkirim / dalam DO aktif (${lockedQtyKoli} koli).`,
                },
                { status: 409 }
            );
        }
        if (weight < lockedWeight) {
            return NextResponse.json(
                {
                    error: `Target berat ${existingItem.description || 'item order'} tidak boleh lebih kecil dari progress yang sudah terkirim / dalam DO aktif (${lockedWeight} kg).`,
                },
                { status: 409 }
            );
        }
        if (lockedVolume > 0 && volume < lockedVolume) {
            return NextResponse.json(
                {
                    error: `Target volume ${existingItem.description || 'item order'} tidak boleh lebih kecil dari progress yang sudah terkirim / dalam DO aktif (${lockedVolume} m3).`,
                },
                { status: 409 }
            );
        }

        const nextProgress = getOrderItemProgress({
            ...existingItem,
            qtyKoli,
            weight,
            volume,
            heldQtyKoli: 0,
            heldWeight: 0,
            heldVolume: 0,
        });
        const hasAssignedProgress =
            nextProgress.assignedQtyKoli > 0 ||
            nextProgress.assignedWeight > 0 ||
            nextProgress.assignedVolume > 0;
        const nextStatus =
            hasAssignedProgress
                ? deriveOrderItemStatusFromProgress(nextProgress, 'in-transit')
                : deriveOrderItemStatusFromProgress(nextProgress);

        await updateDocument(existingItem._id, {
            qtyKoli,
            weight,
            volume: volume > 0 ? volume : undefined,
            weightInputValue: weightInputValue > 0 ? weightInputValue : undefined,
            weightInputUnit: weightInputValue > 0 ? weightInputUnit : undefined,
            volumeInputValue: volumeInputValue > 0 ? volumeInputValue : undefined,
            volumeInputUnit: volumeInputValue > 0 ? volumeInputUnit : undefined,
            heldQtyKoli: 0,
            heldWeight: 0,
            heldVolume: 0,
            holdReason: undefined,
            holdLocation: undefined,
            status: nextStatus,
        }, 'orderItem');

        const itemChanges: string[] = [];
        if (roundQuantity(normalizeNumber(existingItem.qtyKoli)) !== qtyKoli) {
            itemChanges.push(`koli ${roundQuantity(normalizeNumber(existingItem.qtyKoli))} -> ${qtyKoli}`);
        }
        if (roundQuantity(normalizeNumber(existingItem.weight)) !== weight) {
            itemChanges.push(`berat ${roundQuantity(normalizeNumber(existingItem.weight))} kg -> ${weight} kg`);
        }
        if (roundQuantity(normalizeNumber(existingItem.volume ?? 0), 3) !== volume) {
            itemChanges.push(`volume ${roundQuantity(normalizeNumber(existingItem.volume ?? 0), 3)} m3 -> ${volume} m3`);
        }
        if (hadHoldProgress) {
            itemChanges.push('hold dilepas ke pending');
        }
        if (itemChanges.length > 0) {
            revisionSummaries.push(`${existingItem.description || existingItem._id}: ${itemChanges.join(', ')}`);
        }
    }

    try {
        await updateDocument(id, {
            notes: normalizeOptionalText(data.notes),
        }, 'order');
    } catch (error) {
        if (isMutationConflictError(error)) {
            return NextResponse.json(
                { error: 'Data order atau target item berubah karena ada update lain. Refresh lalu coba lagi.' },
                { status: 409 }
            );
        }
        throw error;
    }
    await syncOrderStatusFromItems(id, session, addAuditLog);
    await addAuditLog(
        session,
        'UPDATE',
        'orders',
        id,
        `Revisi order ${order.masterResi || id}: ${revisionReason}${revisionSummaries.length > 0 ? ` | ${revisionSummaries.join('; ')}` : ''}`
    );

    const updatedOrder = await getDocumentById(id, 'order');
    return NextResponse.json({ data: updatedOrder, id });
}

export async function handleDeliveryOrderStatusUpdate(
    session: ApiSession,
    data: Record<string, unknown>,
    addAuditLog: AuditLogFn
) {
    const id = typeof data.id === 'string' ? data.id : '';
    const status = typeof data.status === 'string' ? data.status : '';
    const note = typeof data.note === 'string' ? data.note.trim() : '';
    if (!id || !status) {
        return NextResponse.json({ error: 'Status DO tidak valid' }, { status: 400 });
    }

    const deliveryOrder = await getDocumentById<{
        _id: string;
        _rev?: string;
        doNumber?: string;
        status?: string;
        orderRef?: unknown;
        driverRef?: unknown;
        serviceRef?: unknown;
        vehicleRef?: unknown;
        tripRouteRateRef?: unknown;
        trackingState?: string;
        podReceiverName?: string;
        podReceivedDate?: string;
        podNote?: string;
        receiverName?: string;
        receiverCompany?: string;
        receiverAddress?: string;
        baseTaripBorongan?: number;
        taripBorongan?: number;
        overtonaseDriverRatePerKg?: number;
        pendingDriverStatus?: string;
        pendingDriverStatusRequestedAt?: string;
        pendingDriverStatusRequestedBy?: string;
        pendingDriverStatusRequestedByName?: string;
        pendingDriverStatusNote?: string;
        pendingDriverActualCargoItems?: Array<{
            deliveryOrderItemRef?: string;
            actualQtyKoli?: number;
            actualWeightInputValue?: number;
            actualWeightInputUnit?: WeightInputUnit;
            actualVolumeInputValue?: number;
            actualVolumeInputUnit?: VolumeInputUnit;
        }>;
        pendingDriverActualDropPoints?: ReturnType<typeof normalizeDeliveryActualDropPoints>;
    }>(id, 'deliveryOrder');
    if (!deliveryOrder) {
        return NextResponse.json({ error: 'Surat jalan tidak ditemukan' }, { status: 404 });
    }
    if (!deliveryOrder._rev && !isSupabaseBackendEnabled()) {
        return NextResponse.json({ error: 'Revisi surat jalan tidak tersedia. Refresh lalu coba lagi.' }, { status: 409 });
    }

    const hasTripVehicle = Boolean(extractRefId(deliveryOrder.vehicleRef));
    const hasTripDriver = Boolean(extractRefId(deliveryOrder.driverRef));
    const requiresTripResources =
        status === 'HEADING_TO_PICKUP' ||
        status === 'ON_DELIVERY' ||
        status === 'ARRIVED' ||
        status === 'DELIVERED';
    if (requiresTripResources && (!hasTripVehicle || !hasTripDriver)) {
        return NextResponse.json(
            {
                error: 'Armada trip belum lengkap. Isi kendaraan dan supir dulu sebelum DO dijalankan atau diselesaikan.',
            },
            { status: 409 }
        );
    }

    if (deliveryOrder.pendingDriverStatus && status !== deliveryOrder.pendingDriverStatus) {
        return NextResponse.json(
            {
                error: `DO ${deliveryOrder.doNumber || id} sedang menunggu approval permintaan driver ${deliveryOrder.pendingDriverStatus}. Review/approve atau tolak dulu sebelum ganti ke status lain.`,
            },
            { status: 409 }
        );
    }

    if (!MANUAL_DO_STATUSES.includes(status as (typeof MANUAL_DO_STATUSES)[number])) {
        return NextResponse.json({ error: 'Transisi status DO tidak valid' }, { status: 400 });
    }

    const doItems = await listDocumentsByFilter<DeliveryOrderItemCargoSnapshot & { _rev?: string }>('deliveryOrderItem', { deliveryOrderRef: id });
    const podReceiverName = normalizeOptionalText(data.podReceiverName);
    const podReceivedDate = normalizeOptionalText(data.podReceivedDate);
    const podNote = normalizeOptionalText(data.podNote);

    if (status === 'DELIVERED') {
        if (!podReceiverName) {
            return NextResponse.json({ error: 'Nama penerima POD wajib diisi untuk menyelesaikan surat jalan' }, { status: 400 });
        }
        if (!podReceivedDate) {
            return NextResponse.json({ error: 'Tanggal terima POD wajib diisi untuk menyelesaikan surat jalan' }, { status: 400 });
        }
        try {
            assertIsoDate(podReceivedDate, 'Tanggal terima POD');
        } catch (error) {
            return NextResponse.json(
                { error: error instanceof Error ? error.message : 'Tanggal terima POD tidak valid' },
                { status: 400 }
            );
        }
    }

    let actualCargoByDoItemId = new Map<string, NormalizedActualCargoInput>();
    let actualDropPoints: ReturnType<typeof normalizeDeliveryActualDropPoints> | undefined;
    let overtonageResult: ReturnType<typeof computeDeliveryOrderOvertonage> | undefined;
    let linkedVoucherAdjustmentSummary: string | undefined;
    let settledVoucherOvertonageWarning: string | undefined;
    let linkedVoucherPatch:
        | {
            _id: string;
            driverFeeAmount: number;
            totalClaimAmount: number;
        }
        | undefined;
    const targetSuratJalanRefs = normalizeSelectedSuratJalanRefs(data, id);
    const shouldAutoFinalizeSelectedSuratJalan =
        status === 'DELIVERED' &&
        Boolean(data.autoFinalizeSelectedSuratJalan) &&
        targetSuratJalanRefs.length > 0;
    if (status === 'DELIVERED') {
        if (doItems.length === 0) {
            return NextResponse.json(
                { error: 'Surat jalan belum punya item muatan. Isi barang dulu sebelum DO diselesaikan.' },
                { status: 400 }
            );
        }

        try {
            actualCargoByDoItemId = normalizeDeliveryOrderActualCargoInputs(data, doItems);
            if (shouldAutoFinalizeSelectedSuratJalan) {
                actualDropPoints = normalizeDeliveryActualDropPoints(
                    {
                        actualDropPoints: buildAutoFinalizeBatchRawDropPoints(
                            id,
                            deliveryOrder,
                            doItems,
                            actualCargoByDoItemId,
                            new Set(targetSuratJalanRefs)
                        ),
                    },
                    deliveryOrder,
                    actualCargoByDoItemId
                );
            } else {
                actualDropPoints = normalizeDeliveryActualDropPoints(data, deliveryOrder, actualCargoByDoItemId);
            }
            const ambiguousDropMappingMessage = getAmbiguousActualDropMappingMessage(actualDropPoints, doItems);
            if (ambiguousDropMappingMessage) {
                return NextResponse.json({ error: ambiguousDropMappingMessage }, { status: 400 });
            }
            const overPlanMessages = getActualCargoOverPlanMessages(doItems, actualCargoByDoItemId);
            const finalizationAuditNote = normalizeOptionalText(podNote) || normalizeOptionalText(data.note);
            if (overPlanMessages.length > 0 && !finalizationAuditNote) {
                return NextResponse.json(
                    {
                        error: `Aktual final melebihi rencana estimasi. Isi catatan finalisasi untuk audit: ${overPlanMessages.join('; ')}`,
                    },
                    { status: 400 }
                );
            }
        } catch (error) {
            return NextResponse.json(
                { error: error instanceof Error ? error.message : 'Muatan aktual surat jalan tidak valid' },
                { status: 400 }
            );
        }

        const actualCargoTotals = summarizeActualCargoInputs(actualCargoByDoItemId);
        const serviceRef = extractRefId(deliveryOrder.serviceRef);
        const vehicleRef = extractRefId(deliveryOrder.vehicleRef);
        const tripRouteRateRef = extractRefId(deliveryOrder.tripRouteRateRef);
        const [service, vehicle, tripRouteRate, linkedVoucher] = await Promise.all([
            serviceRef
                ? getDocumentById<{
                    _id: string;
                    maxPayloadKg?: number;
                }>(serviceRef, 'service')
                : Promise.resolve(null),
            vehicleRef
                ? getDocumentById<{
                    _id: string;
                    capacityKg?: number;
                }>(vehicleRef, 'vehicle')
                : Promise.resolve(null),
            tripRouteRateRef
                ? getDocumentById<{
                    _id: string;
                    overtonaseDriverRatePerTon?: number;
                    overtonaseReferencePerTon?: number;
                    notes?: string;
                }>(tripRouteRateRef, 'tripRouteRate')
                : Promise.resolve(null),
            listDocumentsByFilter<{
                _id: string;
                _rev?: string;
                bonNumber?: string;
                status?: string;
                totalSpent?: number;
                totalIssuedAmount?: number;
                cashGiven?: number;
                driverFeeAmount?: number;
            }>('driverVoucher', { deliveryOrderRef: id }).then(rows => rows[0] || null),
        ]);

        overtonageResult = computeDeliveryOrderOvertonage({
            actualTotalWeightKg: actualCargoTotals.weightKg,
            serviceMaxPayloadKg: service?.maxPayloadKg,
            vehicleCapacityKg: vehicle?.capacityKg,
            baseTripFee: normalizeCurrencyNumber(deliveryOrder.baseTaripBorongan ?? deliveryOrder.taripBorongan ?? 0),
            overtonaseDriverRatePerKg:
                normalizeCurrencyNumber(deliveryOrder.overtonaseDriverRatePerKg ?? 0) > 0
                    ? normalizeCurrencyNumber(deliveryOrder.overtonaseDriverRatePerKg ?? 0)
                    : getTripRouteOvertonaseRatePerKg(tripRouteRate),
        });

        if (
            linkedVoucher?._id &&
            linkedVoucher.status !== 'SETTLED' &&
            Math.abs(normalizeCurrencyNumber(linkedVoucher.driverFeeAmount ?? 0) - overtonageResult.effectiveTripFee) > 0.01
        ) {
            const voucherTotals = computeDriverVoucherTotals(
                normalizeNumber(linkedVoucher.totalIssuedAmount ?? linkedVoucher.cashGiven ?? 0, { maxFractionDigits: 0 }),
                normalizeNumber(linkedVoucher.totalSpent ?? 0, { maxFractionDigits: 0 }),
                overtonageResult.effectiveTripFee
            );
            linkedVoucherPatch = {
                _id: linkedVoucher._id,
                driverFeeAmount: voucherTotals.driverFeeAmount,
                totalClaimAmount: voucherTotals.totalClaimAmount,
            };
            linkedVoucherAdjustmentSummary = `bon ${linkedVoucher.bonNumber || linkedVoucher._id} ikut disinkronkan ke ${voucherTotals.driverFeeAmount}`;
        }

        if (
            linkedVoucher?._id &&
            linkedVoucher.status === 'SETTLED' &&
            Math.abs(normalizeCurrencyNumber(linkedVoucher.driverFeeAmount ?? 0) - overtonageResult.effectiveTripFee) > 0.01
        ) {
            settledVoucherOvertonageWarning = `Bon ${linkedVoucher.bonNumber || linkedVoucher._id} sudah settle, jadi tambahan overtonase tidak ikut mengubah settlement lama.`;
        }
    }

    const timestamp = new Date().toISOString();
    const shouldStopTracking = status === 'DELIVERED' || status === 'CANCELLED';
    const deliveryOrderUpdates: Record<string, unknown> = {
        status,
        pendingDriverStatus: null,
        pendingDriverStatusRequestedAt: null,
        pendingDriverStatusRequestedBy: null,
        pendingDriverStatusRequestedByName: null,
        pendingDriverStatusNote: null,
        pendingDriverActualCargoItems: null,
        pendingDriverActualDropPoints: null,
        ...(status === 'DELIVERED'
            ? {
                podReceiverName,
                podReceivedDate,
                podNote,
                baseTaripBorongan: normalizeCurrencyNumber(deliveryOrder.baseTaripBorongan ?? deliveryOrder.taripBorongan ?? 0) || undefined,
                taripBorongan: overtonageResult?.effectiveTripFee || normalizeCurrencyNumber(deliveryOrder.taripBorongan ?? 0) || undefined,
                actualTotalWeightKg: overtonageResult?.actualTotalWeightKg || undefined,
                serviceMaxPayloadKg: overtonageResult?.serviceMaxPayloadKg,
                vehicleCapacityKg: overtonageResult?.vehicleCapacityKg,
                overtonaseWeightKg: overtonageResult?.overtonaseWeightKg,
                overtonaseDriverRatePerKg: overtonageResult?.overtonaseDriverRatePerKg,
                overtonaseDriverAmount: overtonageResult?.overtonaseDriverAmount,
                vehicleCapacityExceededKg: overtonageResult?.vehicleCapacityExceededKg,
                cargoFinalizedAt: timestamp,
                cargoFinalizedBy: session._id,
                cargoFinalizedByName: session.name,
                actualDropPoints,
            }
            : {}),
        ...(shouldStopTracking
            ? {
                trackingState: 'STOPPED',
                trackingStoppedAt: timestamp,
            }
            : {}),
    };

    await updateDocument(id, deliveryOrderUpdates, 'deliveryOrder');
    await createDocument({
        _id: crypto.randomUUID(),
        _type: 'trackingLog',
        refType: 'DO',
        refRef: id,
        status,
        note: note || undefined,
        timestamp,
        userRef: session._id,
        userName: session.name,
    });

    if (linkedVoucherPatch) {
        await updateDocument(linkedVoucherPatch._id, {
            driverFeeAmount: linkedVoucherPatch.driverFeeAmount,
            totalClaimAmount: linkedVoucherPatch.totalClaimAmount,
        }, 'driverVoucher');
    }

    for (const item of doItems) {
        const orderItemRef = extractRefId(item.orderItemRef);
        if (orderItemRef) {
            const orderItem = await getDocumentById<OrderItemProgressSnapshot & { _rev?: string }>(orderItemRef, 'orderItem');
            if (!orderItem) {
                continue;
            }
            if (!orderItem._rev && !isSupabaseBackendEnabled()) {
                return NextResponse.json(
                    { error: 'Revisi item order tidak tersedia. Refresh lalu coba lagi.' },
                    { status: 409 }
                );
            }

            const progress = getOrderItemProgress(orderItem);
            const usesDeliveryOrderOwnedTarget =
                orderItem.entrySource === 'DELIVERY_ORDER' &&
                extractRefId(orderItem.sourceDeliveryOrderRef) === id;
            const plannedQtyKoli = roundQuantity(normalizeNumber(item.shippedQtyKoli ?? item.orderItemQtyKoli ?? 0));
            const plannedWeight = roundQuantity(normalizeNumber(item.shippedWeight ?? item.orderItemWeight ?? 0));
            const plannedVolume = roundQuantity(normalizeNumber(item.orderItemVolumeM3 ?? 0), 3);

            if (status === 'HEADING_TO_PICKUP' || status === 'ON_DELIVERY' || status === 'ARRIVED') {
                await updateDocument(orderItemRef, { status: 'ON_DELIVERY' }, 'orderItem');
                continue;
            }

            if (status === 'DELIVERED') {
                if (!item._rev && !isSupabaseBackendEnabled()) {
                    return NextResponse.json(
                        { error: 'Revisi item surat jalan tidak tersedia. Refresh lalu coba lagi.' },
                        { status: 409 }
                    );
                }
                const actualCargo = actualCargoByDoItemId.get(item._id);
                if (!actualCargo) {
                    return NextResponse.json({ error: 'Muatan aktual surat jalan tidak lengkap' }, { status: 400 });
                }
                const requireQty = progress.totalQtyKoli > 0;
                if (requireQty) {
                    if (!Number.isFinite(actualCargo.actualQtyKoli) || actualCargo.actualQtyKoli <= 0) {
                        return NextResponse.json(
                            { error: `Qty aktual untuk ${orderItem.description || 'item order'} harus lebih besar dari 0` },
                            { status: 400 }
                        );
                    }
                }
                if (!Number.isFinite(actualCargo.actualWeightKg) || actualCargo.actualWeightKg < 0) {
                    return NextResponse.json(
                        { error: `Berat aktual untuk ${orderItem.description || 'item order'} tidak valid` },
                        { status: 400 }
                    );
                }
                if ((plannedWeight > 0 || normalizeNumber(item.orderItemWeight ?? 0) > 0) && actualCargo.actualWeightKg <= 0) {
                    return NextResponse.json(
                        { error: `Berat aktual untuk ${orderItem.description || 'item order'} wajib diisi` },
                        { status: 400 }
                    );
                }
                if (actualCargo.actualVolumeM3 !== undefined && (!Number.isFinite(actualCargo.actualVolumeM3) || actualCargo.actualVolumeM3 < 0)) {
                    return NextResponse.json(
                        { error: `Volume aktual untuk ${orderItem.description || 'item order'} tidak valid` },
                        { status: 400 }
                    );
                }
                if ((plannedVolume > 0 || normalizeNumber(item.orderItemVolumeM3 ?? 0) > 0) && normalizeNumber(actualCargo.actualVolumeM3 ?? 0) <= 0) {
                    return NextResponse.json(
                        { error: `Volume aktual untuk ${orderItem.description || 'item order'} wajib diisi` },
                        { status: 400 }
                    );
                }

                const actualQtyKoli = requireQty ? actualCargo.actualQtyKoli : 0;
                const actualWeight = roundQuantity(actualCargo.actualWeightKg);
                const actualVolume = roundQuantity(normalizeNumber(actualCargo.actualVolumeM3 ?? 0), 3);
                const progressSplit = splitActualCargoForOrderProgress({
                    actualQtyKoli,
                    actualWeight,
                    actualVolume,
                    deliveryOrderItemRef: item._id,
                    shipperReferenceNumber: item.shipperReferenceNumber,
                    actualDropPoints,
                });
                const nextProgress = {
                    ...progress,
                    assignedQtyKoli: roundQuantity(Math.max(progress.assignedQtyKoli - plannedQtyKoli, 0)),
                    assignedWeight: roundQuantity(Math.max(progress.assignedWeight - plannedWeight, 0)),
                    assignedVolume: roundQuantity(Math.max(progress.assignedVolume - plannedVolume, 0), 3),
                    deliveredQtyKoli: roundQuantity(progress.deliveredQtyKoli + progressSplit.delivered.qtyKoli),
                    deliveredWeight: roundQuantity(progress.deliveredWeight + progressSplit.delivered.weight),
                    deliveredVolume: roundQuantity(progress.deliveredVolume + progressSplit.delivered.volume, 3),
                    heldQtyKoli: roundQuantity(progress.heldQtyKoli + progressSplit.held.qtyKoli),
                    heldWeight: roundQuantity(progress.heldWeight + progressSplit.held.weight),
                    heldVolume: roundQuantity(progress.heldVolume + progressSplit.held.volume, 3),
                };
                const orderItemPatch: {
                    set: Record<string, unknown>;
                    unset?: string[];
                } = {
                    set: {
                        assignedQtyKoli: nextProgress.assignedQtyKoli,
                        assignedWeight: nextProgress.assignedWeight,
                        assignedVolume: nextProgress.assignedVolume,
                        deliveredQtyKoli: nextProgress.deliveredQtyKoli,
                        deliveredWeight: nextProgress.deliveredWeight,
                        deliveredVolume: nextProgress.deliveredVolume,
                        heldQtyKoli: nextProgress.heldQtyKoli,
                        heldWeight: nextProgress.heldWeight,
                        heldVolume: nextProgress.heldVolume,
                        status: deriveOrderItemStatusFromProgress(nextProgress),
                    },
                };
                if (usesDeliveryOrderOwnedTarget) {
                    if (requireQty) {
                        orderItemPatch.set.qtyKoli = actualQtyKoli;
                    }
                    orderItemPatch.set.weight = actualWeight;
                    orderItemPatch.set.weightInputValue = actualCargo.actualWeightInputValue;
                    orderItemPatch.set.weightInputUnit = actualCargo.actualWeightInputUnit;
                    if (actualVolume > 0) {
                        orderItemPatch.set.volume = actualVolume;
                        orderItemPatch.set.volumeInputValue = actualCargo.actualVolumeInputValue;
                        orderItemPatch.set.volumeInputUnit = actualCargo.actualVolumeInputUnit;
                    } else {
                        orderItemPatch.unset = ['volume', 'volumeInputValue', 'volumeInputUnit'];
                    }
                }
                const orderItemUpdates: Record<string, unknown> = {
                    ...orderItemPatch.set,
                    ...(orderItemPatch.unset
                        ? Object.fromEntries(orderItemPatch.unset.map(field => [field, null]))
                        : {}),
                };
                const deliveryOrderItemUpdates: Record<string, unknown> = {
                    actualQtyKoli: requireQty ? actualCargo.actualQtyKoli : null,
                    actualWeightKg: actualWeight,
                    actualVolumeM3: actualVolume > 0 ? actualVolume : null,
                    actualWeightInputValue: actualCargo.actualWeightInputValue,
                    actualWeightInputUnit: actualCargo.actualWeightInputUnit,
                    actualVolumeInputValue: actualCargo.actualVolumeInputValue,
                    actualVolumeInputUnit: actualCargo.actualVolumeInputUnit,
                };
                await updateDocument(orderItemRef, orderItemUpdates, 'orderItem');
                await updateDocument(item._id, deliveryOrderItemUpdates, 'deliveryOrderItem');
                continue;
            }

            if (status === 'CANCELLED') {
                const nextProgress = {
                    ...progress,
                    assignedQtyKoli: roundQuantity(Math.max(progress.assignedQtyKoli - plannedQtyKoli, 0)),
                    assignedWeight: roundQuantity(Math.max(progress.assignedWeight - plannedWeight, 0)),
                    assignedVolume: roundQuantity(Math.max(progress.assignedVolume - plannedVolume, 0), 3),
                };
                const orderItemUpdates = {
                    assignedQtyKoli: nextProgress.assignedQtyKoli,
                    assignedWeight: nextProgress.assignedWeight,
                    assignedVolume: nextProgress.assignedVolume,
                    status: deriveOrderItemStatusFromProgress(nextProgress),
                };
                await updateDocument(orderItemRef, orderItemUpdates, 'orderItem');
            }
        }
    }

    if (shouldStopTracking) {
        try {
            await releaseDriverTrackingLockIfOwned(deliveryOrder.driverRef, id, timestamp);
        } catch (error) {
            console.warn('Failed to release driver tracking lock from DO status update', error);
        }
    }

    const orderRef = extractRefId(deliveryOrder.orderRef);
    if (orderRef) {
        await syncOrderStatusFromItems(orderRef, session, addAuditLog);
    }

    await addAuditLog(
        session,
        'UPDATE',
        'delivery-orders',
        id,
        `DO status ${deliveryOrder.doNumber || id}: ${deliveryOrder.status || '-'} -> ${status}${status === 'DELIVERED'
            ? ` (muatan aktual difinalisasi ${doItems.length} item, ${actualDropPoints?.length || 0} titik drop${overtonageResult?.actualTotalWeightKg ? `, berat final ${overtonageResult.actualTotalWeightKg} kg` : ''}${overtonageResult?.overtonaseWeightKg ? `, overtonase ${overtonageResult.overtonaseWeightKg} kg + ${overtonageResult.overtonaseDriverAmount || 0}` : ''}${overtonageResult?.vehicleCapacityExceededKg ? `, melebihi kapasitas kendaraan ${overtonageResult.vehicleCapacityExceededKg} kg` : ''}${linkedVoucherAdjustmentSummary ? `, ${linkedVoucherAdjustmentSummary}` : ''}${settledVoucherOvertonageWarning ? `, ${settledVoucherOvertonageWarning}` : ''})`
            : ''}`
    );

    return NextResponse.json({
        data: {
            ...deliveryOrder,
            status,
            ...(status === 'DELIVERED'
                ? {
                    podReceiverName,
                    podReceivedDate,
                    podNote,
                    baseTaripBorongan: normalizeCurrencyNumber(deliveryOrder.baseTaripBorongan ?? deliveryOrder.taripBorongan ?? 0) || undefined,
                    taripBorongan: overtonageResult?.effectiveTripFee || normalizeCurrencyNumber(deliveryOrder.taripBorongan ?? 0) || undefined,
                    actualTotalWeightKg: overtonageResult?.actualTotalWeightKg || undefined,
                    serviceMaxPayloadKg: overtonageResult?.serviceMaxPayloadKg,
                    vehicleCapacityKg: overtonageResult?.vehicleCapacityKg,
                    overtonaseWeightKg: overtonageResult?.overtonaseWeightKg,
                    overtonaseDriverRatePerKg: overtonageResult?.overtonaseDriverRatePerKg,
                    overtonaseDriverAmount: overtonageResult?.overtonaseDriverAmount,
                    vehicleCapacityExceededKg: overtonageResult?.vehicleCapacityExceededKg,
                    pendingDriverStatus: null,
                    pendingDriverStatusRequestedAt: null,
                    pendingDriverStatusRequestedBy: null,
                    pendingDriverStatusRequestedByName: null,
                    pendingDriverStatusNote: null,
                    pendingDriverActualCargoItems: null,
                    pendingDriverActualDropPoints: null,
                    cargoFinalizedAt: timestamp,
                    cargoFinalizedBy: session._id,
                    cargoFinalizedByName: session.name,
                    actualDropPoints,
                }
                : {}),
            ...(status !== 'DELIVERED'
                ? {
                    pendingDriverStatus: null,
                    pendingDriverStatusRequestedAt: null,
                    pendingDriverStatusRequestedBy: null,
                    pendingDriverStatusRequestedByName: null,
                    pendingDriverStatusNote: null,
                    pendingDriverActualCargoItems: null,
                    pendingDriverActualDropPoints: null,
                }
                : {}),
            trackingState: shouldStopTracking ? 'STOPPED' : deliveryOrder.trackingState,
            trackingStoppedAt: shouldStopTracking ? timestamp : undefined,
        },
    });
}

export async function handleDeliveryOrderContinueHeldCargo(
    session: ApiSession,
    data: Record<string, unknown>,
    addAuditLog: AuditLogFn
) {
    void session;
    void data;
    void addAuditLog;
    return NextResponse.json(
        { error: 'Finalisasi sisa hold sekarang diproses dari Update Batch SJ pada trip/SJ asal.' },
        { status: 410 }
    );

    /*
    const id = typeof data.id === 'string' ? data.id : '';
    const note = normalizeOptionalText(data.note);
    if (!id) {
        return NextResponse.json({ error: 'Surat jalan tidak valid' }, { status: 400 });
    }

    const deliveryOrder = await getDocumentById<DeliveryOrder>(id, 'deliveryOrder');
    if (!deliveryOrder) {
        return NextResponse.json({ error: 'Surat jalan tidak ditemukan' }, { status: 404 });
    }
    if (deliveryOrder.status !== 'DELIVERED' && deliveryOrder.status !== 'PARTIAL_HOLD') {
        return NextResponse.json(
            { error: 'Lanjutan hold di SJ yang sama hanya tersedia untuk surat jalan yang sudah selesai atau masih punya hold.' },
            { status: 409 }
        );
    }
    if (deliveryOrder.pendingDriverStatus) {
        return NextResponse.json(
            { error: `DO ${deliveryOrder.doNumber || id} sedang menunggu approval ${deliveryOrder.pendingDriverStatus}. Review dulu sebelum muatan hold dilanjutkan.` },
            { status: 409 }
        );
    }

    const currentDropPoints: ReturnType<typeof normalizeDeliveryActualDropPoints> = (
        Array.isArray(deliveryOrder.actualDropPoints)
            ? deliveryOrder.actualDropPoints
            : []
    ).map((point, index) => ({
        ...point,
        _key: point._key || `existing-hold-drop-${index + 1}`,
    }));
    const continuableDropPoints = currentDropPoints.filter(point =>
        point.stopType === 'HOLD' || point.stopType === 'TRANSIT'
    );
    if (continuableDropPoints.length === 0) {
        return NextResponse.json(
            { error: 'Tidak ada titik hold/transit yang bisa dilanjutkan di surat jalan ini.' },
            { status: 409 }
        );
    }

    const nextDropPoints: ReturnType<typeof normalizeDeliveryActualDropPoints> = currentDropPoints.map((point, index) =>
        point.stopType === 'HOLD' || point.stopType === 'TRANSIT'
            ? {
                ...point,
                _key: point._key || `continued-hold-drop-${index + 1}`,
                stopType: 'DROP' as const,
                note: normalizeOptionalText(point.note)
                    ? `${point.note} | Lanjutan hold dikirim di SJ yang sama`
                    : 'Lanjutan hold dikirim di SJ yang sama',
            }
            : {
                ...point,
                _key: point._key || `existing-hold-drop-${index + 1}`,
            }
    );

    const doItems = await listDocumentsByFilter<DeliveryOrderItemCargoSnapshot & { _rev?: string }>('deliveryOrderItem', { deliveryOrderRef: id });
    const orderItemProgressUpdates: Array<{
        orderItemRef: string;
        updates: Record<string, unknown>;
    }> = [];
    for (const item of doItems) {
        const orderItemRef = extractRefId(item.orderItemRef);
        if (!orderItemRef) {
            continue;
        }

        const orderItem = await getDocumentById<OrderItemProgressSnapshot & { _rev?: string }>(orderItemRef, 'orderItem');
        if (!orderItem) {
            continue;
        }
        if (!orderItem._rev && !isSupabaseBackendEnabled()) {
            return NextResponse.json(
                { error: 'Revisi item order tidak tersedia. Refresh lalu coba lagi.' },
                { status: 409 }
            );
        }

        const progress = getOrderItemProgress(orderItem);
        const requiresQty =
            progress.totalQtyKoli > 0 ||
            normalizeNumber(item.orderItemQtyKoli ?? item.shippedQtyKoli ?? 0) > 0;
        const actualQtyKoli = requiresQty ? roundQuantity(normalizeNumber(item.actualQtyKoli ?? item.shippedQtyKoli ?? item.orderItemQtyKoli ?? 0)) : 0;
        const actualWeight = roundQuantity(normalizeNumber(item.actualWeightKg ?? item.shippedWeight ?? item.orderItemWeight ?? 0));
        const actualVolume = roundQuantity(normalizeNumber(item.actualVolumeM3 ?? item.orderItemVolumeM3 ?? 0), 3);

        const previousSplit = splitActualCargoForOrderProgress({
            actualQtyKoli,
            actualWeight,
            actualVolume,
            deliveryOrderItemRef: item._id,
            shipperReferenceNumber: item.shipperReferenceNumber,
            actualDropPoints: currentDropPoints,
        });
        const nextSplit = splitActualCargoForOrderProgress({
            actualQtyKoli,
            actualWeight,
            actualVolume,
            deliveryOrderItemRef: item._id,
            shipperReferenceNumber: item.shipperReferenceNumber,
            actualDropPoints: nextDropPoints,
        });

        const nextProgress = {
            ...progress,
            deliveredQtyKoli: roundQuantity(progress.deliveredQtyKoli + nextSplit.delivered.qtyKoli - previousSplit.delivered.qtyKoli),
            deliveredWeight: roundQuantity(progress.deliveredWeight + nextSplit.delivered.weight - previousSplit.delivered.weight),
            deliveredVolume: roundQuantity(progress.deliveredVolume + nextSplit.delivered.volume - previousSplit.delivered.volume, 3),
            heldQtyKoli: roundQuantity(Math.max(progress.heldQtyKoli + nextSplit.held.qtyKoli - previousSplit.held.qtyKoli, 0)),
            heldWeight: roundQuantity(Math.max(progress.heldWeight + nextSplit.held.weight - previousSplit.held.weight, 0)),
            heldVolume: roundQuantity(Math.max(progress.heldVolume + nextSplit.held.volume - previousSplit.held.volume, 0), 3),
        };

        orderItemProgressUpdates.push({
            orderItemRef,
            updates: {
                deliveredQtyKoli: nextProgress.deliveredQtyKoli,
                deliveredWeight: nextProgress.deliveredWeight,
                deliveredVolume: nextProgress.deliveredVolume,
                heldQtyKoli: nextProgress.heldQtyKoli,
                heldWeight: nextProgress.heldWeight,
                heldVolume: nextProgress.heldVolume,
                status: deriveOrderItemStatusFromProgress(nextProgress),
            },
        });
    }

    const timestamp = new Date().toISOString();

    try {
        await ensureTripRecordForSuratJalanWrites(deliveryOrder);

        await updateDocument(id, {
            status: 'DELIVERED',
            actualDropPoints: nextDropPoints,
            cargoFinalizedAt: timestamp,
            cargoFinalizedBy: session._id,
            cargoFinalizedByName: session.name,
        }, 'deliveryOrder');

        const suratJalanRecords = await listDocumentsByFilter<{ _id: string; tripStatus?: DOStatus; suratJalanNumber?: string }>('suratJalan', { tripRef: id });
        for (const record of suratJalanRecords.filter(item => item.tripStatus === 'PARTIAL_HOLD')) {
            const summaryDeliveryOrder = {
                ...deliveryOrder,
                actualDropPoints: nextDropPoints,
            };
            await updateDocument(record._id, {
                tripStatus: 'DELIVERED',
                syncedAt: timestamp,
                billableCargo: summarizeSuratJalanActualCargo(summaryDeliveryOrder, doItems, record, getDeliveryOrderBillableCargoSummary),
                holdCargo: summarizeSuratJalanActualCargo(summaryDeliveryOrder, doItems, record, getDeliveryOrderHoldCargoSummary),
                returnCargo: summarizeSuratJalanActualCargo(summaryDeliveryOrder, doItems, record, getDeliveryOrderReturnCargoSummary),
            }, 'suratJalan');
        }

        const tripRecord = await getDocumentById<{ _id: string; _rev?: string }>(id, 'trip');
        if (tripRecord) {
            await updateDocument(id, { status: 'DELIVERED' }, 'trip');
        }

        for (const progressUpdate of orderItemProgressUpdates) {
            await updateDocument(progressUpdate.orderItemRef, progressUpdate.updates, 'orderItem');
        }

        await createDocument({
            _id: crypto.randomUUID(),
            _type: 'trackingLog',
            refType: 'DO',
            refRef: id,
            status: 'DELIVERED',
            note: note || 'Lanjutan hold dikirim di SJ yang sama',
            timestamp,
            userRef: session._id,
            userName: session.name,
        });
    } catch (error) {
        if (isMutationConflictError(error)) {
            return NextResponse.json(
                { error: 'Data surat jalan atau item order berubah karena ada update lain. Refresh lalu coba lagi.' },
                { status: 409 }
            );
        }
        throw error;
    }

    const orderRef = extractRefId(deliveryOrder.orderRef);
    if (orderRef) {
        await syncOrderStatusFromItems(orderRef, session, addAuditLog);
    }
    await addAuditLog(
        session,
        'UPDATE',
        'delivery-orders',
        id,
        `Lanjutan hold di SJ yang sama: ${deliveryOrder.doNumber || id} (${continuableDropPoints.length} titik hold/transit jadi drop)`
    );

    const updatedDeliveryOrder = await getDocumentById(id, 'deliveryOrder');
    return NextResponse.json({
        data: updatedDeliveryOrder || {
            ...deliveryOrder,
            actualDropPoints: nextDropPoints,
            cargoFinalizedAt: timestamp,
            cargoFinalizedBy: session._id,
            cargoFinalizedByName: session.name,
        },
    });
}
    */
}

export async function handleDeliveryOrderCancelTrip(
    session: ApiSession,
    data: Record<string, unknown>,
    addAuditLog: AuditLogFn
) {
    const id = typeof data.id === 'string' ? data.id : '';
    const note = normalizeOptionalText(data.note);
    if (!id) {
        return NextResponse.json({ error: 'Trip tidak valid' }, { status: 400 });
    }

    const deliveryOrder = await getDocumentById<DeliveryOrder>(id, 'deliveryOrder');
    if (!deliveryOrder) {
        return NextResponse.json({ error: 'Trip tidak ditemukan' }, { status: 404 });
    }
    if (deliveryOrder.status === 'CANCELLED') {
        return NextResponse.json({ error: 'Trip sudah dibatalkan.' }, { status: 409 });
    }
    if (deliveryOrder.pendingDriverStatus) {
        return NextResponse.json(
            { error: `Trip ${deliveryOrder.doNumber || id} masih punya permintaan driver ${deliveryOrder.pendingDriverStatus} yang belum diputuskan.` },
            { status: 409 }
        );
    }

    const doItems = await listDocumentsByFilter<DeliveryOrderItemCargoSnapshot & { _rev?: string }>('deliveryOrderItem', { deliveryOrderRef: id });
    const hasFinalizedCargo =
        deliveryOrder.status === 'DELIVERED' ||
        deliveryOrder.status === 'PARTIAL_HOLD' ||
        Boolean(deliveryOrder.cargoFinalizedAt) ||
        (Array.isArray(deliveryOrder.actualDropPoints) && deliveryOrder.actualDropPoints.length > 0) ||
        doItems.some(item =>
            normalizeNumber(item.actualQtyKoli ?? 0) > 0 ||
            normalizeNumber(item.actualWeightKg ?? 0) > 0 ||
            normalizeNumber(item.actualVolumeM3 ?? 0) > 0
        );
    if (hasFinalizedCargo) {
        return NextResponse.json(
            { error: 'Trip yang sudah punya finalisasi/drop aktual tidak bisa dibatalkan. Revisi data finalisasi atau lanjutkan sisa hold dari alur status.' },
            { status: 409 }
        );
    }

    try {
        await ensureTripRecordForSuratJalanWrites(deliveryOrder);
    } catch (error) {
        if (isMutationConflictError(error)) {
            return NextResponse.json({ error: 'Data trip berubah karena update lain. Refresh lalu coba lagi.' }, { status: 409 });
        }
        throw error;
    }

    let suratJalanRecords = await listDocumentsByFilter<{
        _id: string;
        _rev?: string;
        tripRef: string;
        tripStatus?: DOStatus;
        suratJalanNumber?: string;
    }>('suratJalan', { tripRef: id });

    if (suratJalanRecords.length === 0 && doItems.length > 0) {
        const derivedSuratJalanRecords = mapDeliveryOrderToSuratJalanRecords(deliveryOrder, doItems as DeliveryOrderItem[]);
        for (const record of derivedSuratJalanRecords) {
            await createDocument({ ...record });
        }
        suratJalanRecords = await listDocumentsByFilter<{
            _id: string;
            _rev?: string;
            tripRef: string;
            tripStatus?: DOStatus;
            suratJalanNumber?: string;
        }>('suratJalan', { tripRef: id });
    }

    const finalizedRecords = suratJalanRecords.filter(record =>
        record.tripStatus === 'DELIVERED' || record.tripStatus === 'PARTIAL_HOLD'
    );
    if (finalizedRecords.length > 0) {
        return NextResponse.json(
            { error: `Ada SJ yang sudah final/partial hold dan tidak bisa dibatalkan: ${finalizedRecords.map(record => record.suratJalanNumber || record._id).join(', ')}` },
            { status: 409 }
        );
    }

    const timestamp = new Date().toISOString();
    try {
        for (const record of suratJalanRecords) {
            await updateDocument(record._id, {
                tripStatus: 'CANCELLED',
                syncedAt: timestamp,
            }, 'suratJalan');
        }

        await updateDocument(id, {
            status: 'CANCELLED',
            pendingDriverStatus: null,
            pendingDriverStatusRequestedAt: null,
            pendingDriverStatusRequestedBy: null,
            pendingDriverStatusRequestedByName: null,
            pendingDriverStatusNote: null,
            pendingDriverActualCargoItems: null,
            pendingDriverActualDropPoints: null,
            trackingState: 'STOPPED',
            trackingStoppedAt: timestamp,
        }, 'deliveryOrder');

        for (const item of doItems) {
            const orderItemRef = extractRefId(item.orderItemRef);
            if (!orderItemRef) {
                continue;
            }
            const orderItem = await getDocumentById<OrderItemProgressSnapshot & { _rev?: string }>(orderItemRef, 'orderItem');
            if (!orderItem) {
                continue;
            }
            if (!orderItem._rev && !isSupabaseBackendEnabled()) {
                return NextResponse.json(
                    { error: 'Revisi item order tidak tersedia. Refresh lalu coba lagi.' },
                    { status: 409 }
                );
            }

            const progress = getOrderItemProgress(orderItem);
            const plannedQtyKoli = roundQuantity(normalizeNumber(item.shippedQtyKoli ?? item.orderItemQtyKoli ?? 0));
            const plannedWeight = roundQuantity(normalizeNumber(item.shippedWeight ?? item.orderItemWeight ?? 0));
            const plannedVolume = roundQuantity(normalizeNumber(item.orderItemVolumeM3 ?? 0), 3);
            const nextProgress = {
                ...progress,
                assignedQtyKoli: roundQuantity(Math.max(progress.assignedQtyKoli - plannedQtyKoli, 0)),
                assignedWeight: roundQuantity(Math.max(progress.assignedWeight - plannedWeight, 0)),
                assignedVolume: roundQuantity(Math.max(progress.assignedVolume - plannedVolume, 0), 3),
            };

            await updateDocument(orderItemRef, {
                assignedQtyKoli: nextProgress.assignedQtyKoli,
                assignedWeight: nextProgress.assignedWeight,
                assignedVolume: nextProgress.assignedVolume,
                status: deriveOrderItemStatusFromProgress(nextProgress),
            }, 'orderItem');
        }

        const tripRecord = await getDocumentById<{ _id: string; _rev?: string }>(id, 'trip');
        if (tripRecord) {
            await updateDocument(id, { status: 'CANCELLED' }, 'trip');
        }
    } catch (error) {
        if (isMutationConflictError(error)) {
            return NextResponse.json({ error: 'Data trip / surat jalan berubah karena update lain. Refresh lalu coba lagi.' }, { status: 409 });
        }
        throw error;
    }

    try {
        await releaseDriverTrackingLockIfOwned(deliveryOrder.driverRef, id, timestamp);
    } catch (error) {
        console.warn('Failed to release driver tracking lock from trip cancellation', error);
    }

    const orderRef = extractRefId(deliveryOrder.orderRef);
    if (orderRef) {
        await syncOrderStatusFromItems(orderRef, session, addAuditLog);
    }

    await addAuditLog(
        session,
        'UPDATE',
        'delivery-orders',
        id,
        `Trip dibatalkan: ${deliveryOrder.doNumber || id}. ${suratJalanRecords.length} SJ ikut batal.${note ? ` | ${note}` : ''}`
    );

    return NextResponse.json({
        data: {
            tripRef: id,
            status: 'CANCELLED',
            cancelledSuratJalanCount: suratJalanRecords.length,
        },
    });
}

export async function handleDeliveryOrderBatchSuratJalanStatusUpdate(
    session: ApiSession,
    data: Record<string, unknown>,
    addAuditLog: AuditLogFn
) {
    const id = typeof data.id === 'string' ? data.id : '';
    const status = normalizeText(data.status);
    const note = normalizeOptionalText(data.note);
    const targetSuratJalanRefs = Array.from(new Set(
        (Array.isArray(data.targetSuratJalanRefs) ? data.targetSuratJalanRefs : [])
            .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
            .map(value => value.trim())
            .filter(value => value.startsWith(`${id}:`) || value === `${id}:primary`)
    ));

    if (!id) {
        return NextResponse.json({ error: 'Trip tidak valid' }, { status: 400 });
    }
    if (!MANUAL_DO_STATUSES.includes(status as (typeof MANUAL_DO_STATUSES)[number])) {
        return NextResponse.json({ error: 'Status batch SJ tidak valid' }, { status: 400 });
    }
    if (targetSuratJalanRefs.length === 0) {
        return NextResponse.json({ error: 'Pilih minimal 1 surat jalan' }, { status: 400 });
    }

    const deliveryOrder = await getDocumentById<DeliveryOrder>(id, 'deliveryOrder');
    if (!deliveryOrder) {
        return NextResponse.json({ error: 'Trip tidak ditemukan' }, { status: 404 });
    }
    if (deliveryOrder.pendingDriverStatus) {
        return NextResponse.json(
            { error: `Trip ${deliveryOrder.doNumber || id} masih punya permintaan driver ${deliveryOrder.pendingDriverStatus} yang belum diputuskan.` },
            { status: 409 }
        );
    }

    let suratJalanRecords = await listDocumentsByFilter<{
        _id: string;
        _rev?: string;
        tripRef: string;
        tripStatus?: DOStatus;
        referenceKey?: string;
        suratJalanNumber?: string;
        holdCargo?: {
            qtyKoli?: number;
            weightKg?: number;
            volumeM3?: number;
        };
    }>('suratJalan', { tripRef: id });

    const missingTargetSuratJalanRefs = targetSuratJalanRefs.filter(
        ref => !suratJalanRecords.some(record => record._id === ref)
    );
    if (suratJalanRecords.length === 0 || missingTargetSuratJalanRefs.length > 0) {
        const deliveryOrderItems = await listDocumentsByFilter<DeliveryOrderItem>('deliveryOrderItem', { deliveryOrderRef: id });
        const derivedSuratJalanRecords = mapDeliveryOrderToSuratJalanRecords(deliveryOrder, deliveryOrderItems);

        if (derivedSuratJalanRecords.length === 0) {
            return NextResponse.json({ error: 'Trip ini belum punya surat jalan yang bisa diupdate.' }, { status: 409 });
        }

        await ensureTripRecordForSuratJalanWrites(deliveryOrder);

        const existingSuratJalanRecordIds = new Set(suratJalanRecords.map(record => record._id));
        const missingTargetSuratJalanRefSet = new Set(missingTargetSuratJalanRefs);
        const recordsToCreate = derivedSuratJalanRecords.filter(record =>
            !existingSuratJalanRecordIds.has(record._id) &&
            (suratJalanRecords.length === 0 || missingTargetSuratJalanRefSet.has(record._id))
        );

        for (const record of recordsToCreate) {
            try {
                await createDocument({ ...record });
            } catch (error) {
                if (!isMutationConflictError(error)) {
                    throw error;
                }
            }
        }

        suratJalanRecords = await listDocumentsByFilter<{
            _id: string;
            _rev?: string;
            tripRef: string;
            tripStatus?: DOStatus;
            referenceKey?: string;
            suratJalanNumber?: string;
            holdCargo?: {
                qtyKoli?: number;
                weightKg?: number;
                volumeM3?: number;
            };
        }>('suratJalan', { tripRef: id });
    }

    const allowedStatusesByCurrent: Record<DOStatus, DOStatus[]> = {
        CREATED: ['HEADING_TO_PICKUP'],
        HEADING_TO_PICKUP: ['ON_DELIVERY'],
        ON_DELIVERY: ['ARRIVED'],
        ARRIVED: ['DELIVERED'],
        PARTIAL_HOLD: ['HEADING_TO_PICKUP'],
        DELIVERED: [],
        CANCELLED: [],
    };

    const doItems = await listDocumentsByFilter<DeliveryOrderItemCargoSnapshot & { _rev?: string }>('deliveryOrderItem', { deliveryOrderRef: id });
    const deliveryOrderItemsForDerivedRecords = await listDocumentsByFilter<DeliveryOrderItem>('deliveryOrderItem', { deliveryOrderRef: id });
    const derivedSuratJalanRecordById = new Map(
        mapDeliveryOrderToSuratJalanRecords(deliveryOrder, deliveryOrderItemsForDerivedRecords)
            .map(record => [record._id, record] as const)
    );
    const derivedSuratJalanRecords = Array.from(derivedSuratJalanRecordById.values());
    const currentDropPoints: ReturnType<typeof normalizeDeliveryActualDropPoints> = (
        Array.isArray(deliveryOrder.actualDropPoints)
            ? deliveryOrder.actualDropPoints
            : []
    ).map((point, index) => ({
        ...point,
        _key: point._key || `existing-hold-drop-${index + 1}`,
    }));
    const targetedRecords = suratJalanRecords.filter(item => targetSuratJalanRefs.includes(item._id));
    if (targetedRecords.length === 0) {
        return NextResponse.json({ error: 'Surat jalan yang dipilih tidak ditemukan dalam trip ini.' }, { status: 404 });
    }
    const hasSuratJalanHoldCargo = (record: {
        holdCargo?: {
            qtyKoli?: number;
            weightKg?: number;
            volumeM3?: number;
        };
    }) =>
        normalizeNumber(record.holdCargo?.qtyKoli ?? 0) > 0 ||
        normalizeNumber(record.holdCargo?.weightKg ?? 0) > 0 ||
        normalizeNumber(record.holdCargo?.volumeM3 ?? 0) > 0;
    const getParsedSuratJalanReferenceKey = (recordId: string) => {
        try {
            return parseSuratJalanDocumentId(recordId).referenceKey;
        } catch {
            return '';
        }
    };
    const getDerivedSuratJalanRecord = (record: typeof targetedRecords[number]) => {
        const parsedReferenceKey = getParsedSuratJalanReferenceKey(record._id);
        const recordNumber = normalizeOptionalText(record.suratJalanNumber)?.toUpperCase();
        return (
            derivedSuratJalanRecordById.get(record._id) ||
            derivedSuratJalanRecords.find(candidate =>
                Boolean(
                    (record.referenceKey && candidate.referenceKey === record.referenceKey) ||
                    (parsedReferenceKey && parsedReferenceKey !== 'primary' && candidate.referenceKey === parsedReferenceKey) ||
                    (recordNumber && normalizeOptionalText(candidate.suratJalanNumber)?.toUpperCase() === recordNumber)
                )
            ) ||
            null
        );
    };
    const hasSuratJalanContinuableHoldCargo = (record: typeof targetedRecords[number]) => {
        const derivedRecord = getDerivedSuratJalanRecord(record);
        if (
            record.tripStatus === 'PARTIAL_HOLD' ||
            derivedRecord?.tripStatus === 'PARTIAL_HOLD' ||
            hasSuratJalanHoldCargo(record) ||
            hasSuratJalanHoldCargo(derivedRecord || {})
        ) {
            return true;
        }

        const parsedReferenceKey = getParsedSuratJalanReferenceKey(record._id);
        const recordDoItems = doItems.filter(item =>
            getDeliveryOrderSuratJalanIdentity({
                deliveryOrderId: id,
                shipperReferenceKey: item.shipperReferenceKey,
                shipperReferenceNumber: item.shipperReferenceNumber,
            }) === record._id ||
            Boolean(
                (record.referenceKey && item.shipperReferenceKey === record.referenceKey) ||
                (parsedReferenceKey && parsedReferenceKey !== 'primary' && item.shipperReferenceKey === parsedReferenceKey) ||
                (record.suratJalanNumber && item.shipperReferenceNumber === record.suratJalanNumber)
            )
        );
        const recordDoItemIds = new Set(recordDoItems.map(item => item._id));
        const recordReferenceKeys = new Set([
            normalizeOptionalText(record.referenceKey),
            normalizeOptionalText(parsedReferenceKey !== 'primary' ? parsedReferenceKey : ''),
            normalizeOptionalText(derivedRecord?.referenceKey),
            ...recordDoItems.map(item => normalizeOptionalText(item.shipperReferenceKey)),
        ].filter((value): value is string => Boolean(value)));
        const recordReferenceNumbers = new Set([
            normalizeOptionalText(record.suratJalanNumber)?.toUpperCase(),
            normalizeOptionalText(derivedRecord?.suratJalanNumber)?.toUpperCase(),
            ...recordDoItems.map(item => normalizeOptionalText(item.shipperReferenceNumber)?.toUpperCase()),
        ].filter((value): value is string => Boolean(value)));
        const holdPoints = currentDropPoints.filter(point => point.stopType === 'HOLD' || point.stopType === 'TRANSIT');

        const hasMappedHoldPoint = holdPoints.some(point => {
            const pointItemRefs = [
                normalizeOptionalText(point.deliveryOrderItemRef),
                ...((Array.isArray(point.deliveryOrderItemRefs) ? point.deliveryOrderItemRefs : [])
                    .map(ref => normalizeOptionalText(ref))
                    .filter((ref): ref is string => Boolean(ref))),
            ].filter((ref): ref is string => Boolean(ref));
            if (pointItemRefs.some(ref => recordDoItemIds.has(ref))) {
                return true;
            }

            const pointReferenceKey = normalizeOptionalText(point.shipperReferenceKey);
            const pointReferenceNumber = normalizeOptionalText(point.shipperReferenceNumber)?.toUpperCase();
            return (
                (pointReferenceKey && recordReferenceKeys.has(pointReferenceKey)) ||
                (pointReferenceNumber && recordReferenceNumbers.has(pointReferenceNumber))
            );
        });

        if (hasMappedHoldPoint) {
            return true;
        }

        const unscopedHoldPoints = holdPoints.filter(point => {
            const pointItemRefs = [
                normalizeOptionalText(point.deliveryOrderItemRef),
                ...((Array.isArray(point.deliveryOrderItemRefs) ? point.deliveryOrderItemRefs : [])
                    .map(ref => normalizeOptionalText(ref))
                    .filter((ref): ref is string => Boolean(ref))),
            ].filter((ref): ref is string => Boolean(ref));
            return (
                pointItemRefs.length === 0 &&
                !normalizeOptionalText(point.shipperReferenceKey) &&
                !normalizeOptionalText(point.shipperReferenceNumber)
            );
        });
        return targetSuratJalanRefs.length === 1 && suratJalanRecords.length === 1 && unscopedHoldPoints.length > 0;
    };
    const isPartialHoldContinuationFinalize =
        status === 'DELIVERED' &&
        targetedRecords.some(item => item.tripStatus === 'PARTIAL_HOLD' || hasSuratJalanContinuableHoldCargo(item));
    const getEffectiveSuratJalanCurrentStatus = (item: typeof targetedRecords[number]): DOStatus => {
        const derivedRecord = getDerivedSuratJalanRecord(item);
        const currentStatus = item.tripStatus || derivedRecord?.tripStatus || deliveryOrder.status || 'CREATED';
        return (
            currentStatus === 'PARTIAL_HOLD' ||
            (hasSuratJalanContinuableHoldCargo(item) && currentStatus === 'DELIVERED')
        )
            ? 'PARTIAL_HOLD'
            : currentStatus;
    };

    const ineligible = targetedRecords.filter(item => {
        const currentStatus = getEffectiveSuratJalanCurrentStatus(item);
        return !allowedStatusesByCurrent[currentStatus]?.includes(status as DOStatus);
    });
    if (ineligible.length > 0) {
        return NextResponse.json(
            { error: `Ada SJ yang belum memenuhi syarat untuk pindah ke ${status}: ${ineligible.map(item => item.suratJalanNumber || item._id).join(', ')}` },
            { status: 409 }
        );
    }

    const timestamp = new Date().toISOString();
    const podReceiverName = normalizeOptionalText(data.podReceiverName);
    const podReceivedDate = normalizeOptionalText(data.podReceivedDate);
    const podNote = normalizeOptionalText(data.podNote);
    const targetSuratJalanRefSet = new Set(targetSuratJalanRefs);
    const requestedActualItemRefs = new Set(
        (Array.isArray(data.actualItems) ? data.actualItems : [])
            .map(item => isPlainObject(item) ? normalizeOptionalText(item.deliveryOrderItemRef) : '')
            .filter((value): value is string => Boolean(value))
    );
    const allTargetedDoItems = doItems.filter(item =>
        targetSuratJalanRefSet.has(getDeliveryOrderSuratJalanIdentity({
            deliveryOrderId: id,
            shipperReferenceKey: item.shipperReferenceKey,
            shipperReferenceNumber: item.shipperReferenceNumber,
        }))
    );
    const targetedDoItems =
        isPartialHoldContinuationFinalize && requestedActualItemRefs.size > 0
            ? allTargetedDoItems.filter(item => requestedActualItemRefs.has(item._id))
            : allTargetedDoItems;
    const targetedDoItemIds = new Set(targetedDoItems.map(item => item._id));
    const targetedReferenceKeys = new Set(
        targetedDoItems
            .map(item => normalizeOptionalText(item.shipperReferenceKey))
            .filter((value): value is string => Boolean(value))
    );
    const targetedReferenceNumbers = new Set(
        targetedDoItems
            .map(item => normalizeOptionalText(item.shipperReferenceNumber)?.toUpperCase())
            .filter((value): value is string => Boolean(value))
    );
    const shouldTreatUntargetedGenericPointsAsSelected =
        suratJalanRecords.length <= 1 || targetSuratJalanRefs.length === suratJalanRecords.length;

    const matchesTargetedDropPoint = (point: NonNullable<DeliveryOrder['actualDropPoints']>[number]) => {
        const dropItemRefs = [
            normalizeOptionalText(point.deliveryOrderItemRef),
            ...((Array.isArray(point.deliveryOrderItemRefs) ? point.deliveryOrderItemRefs : [])
                .map(ref => normalizeOptionalText(ref))
                .filter((ref): ref is string => Boolean(ref))),
        ].filter((ref): ref is string => Boolean(ref));
        if (dropItemRefs.some(ref => targetedDoItemIds.has(ref))) {
            return true;
        }

        const pointReferenceKey = normalizeOptionalText(point.shipperReferenceKey);
        const pointReferenceNumber = normalizeOptionalText(point.shipperReferenceNumber)?.toUpperCase();
        if ((pointReferenceKey && targetedReferenceKeys.has(pointReferenceKey)) || (pointReferenceNumber && targetedReferenceNumbers.has(pointReferenceNumber))) {
            return true;
        }

        return shouldTreatUntargetedGenericPointsAsSelected && !pointReferenceKey && !pointReferenceNumber && dropItemRefs.length === 0;
    };

    let actualCargoByDoItemId = new Map<string, NormalizedActualCargoInput>();
    let scopedActualDropPoints: ReturnType<typeof normalizeDeliveryActualDropPoints> | undefined;
    const orderItemProgressUpdates: Array<{
        orderItemRef: string;
        orderItemUpdates: Record<string, unknown>;
        deliveryOrderItemRef: string;
        deliveryOrderItemUpdates: Record<string, unknown>;
    }> = [];
    let mergedActualDropPoints: NonNullable<DeliveryOrder['actualDropPoints']> = currentDropPoints;

    if (status === 'DELIVERED') {
        if (!podReceiverName || !podReceivedDate) {
            return NextResponse.json({ error: 'Nama penerima POD dan tanggal terima POD wajib diisi untuk finalisasi SJ.' }, { status: 400 });
        }
        try {
            assertIsoDate(podReceivedDate, 'Tanggal terima POD');
        } catch (error) {
            return NextResponse.json({ error: error instanceof Error ? error.message : 'Tanggal terima POD tidak valid' }, { status: 400 });
        }
        if (targetedDoItems.length === 0) {
            return NextResponse.json({ error: 'SJ yang dipilih belum punya item muatan untuk difinalkan.' }, { status: 409 });
        }

        try {
            actualCargoByDoItemId = normalizeDeliveryOrderActualCargoInputs(data, targetedDoItems);
            const normalizedDropPoints = normalizeDeliveryActualDropPoints(data, deliveryOrder, actualCargoByDoItemId);
            scopedActualDropPoints = normalizedDropPoints.map(point => {
                const normalizedPointItemRefs = [
                    normalizeOptionalText(point.deliveryOrderItemRef),
                    ...((Array.isArray(point.deliveryOrderItemRefs) ? point.deliveryOrderItemRefs : [])
                        .map(ref => normalizeOptionalText(ref))
                        .filter((ref): ref is string => Boolean(ref))),
                ];
                if (
                    normalizedPointItemRefs.length > 0 ||
                    normalizeOptionalText(point.shipperReferenceKey) ||
                    normalizeOptionalText(point.shipperReferenceNumber)
                ) {
                    return point;
                }

                const pointItems = targetedDoItems;
                const pointItemRefs = pointItems.map(item => item._id);
                const pointReferenceKeys = Array.from(new Set(
                    pointItems
                        .map(item => normalizeOptionalText(item.shipperReferenceKey))
                        .filter((value): value is string => Boolean(value))
                ));
                const pointReferenceNumbers = Array.from(new Set(
                    pointItems
                        .map(item => normalizeOptionalText(item.shipperReferenceNumber))
                        .filter((value): value is string => Boolean(value))
                ));

                return {
                    ...point,
                    deliveryOrderItemRef: pointItemRefs.length === 1 ? pointItemRefs[0] : undefined,
                    deliveryOrderItemRefs: pointItemRefs.length > 1 ? pointItemRefs : undefined,
                    shipperReferenceKey: pointReferenceKeys.length === 1 ? pointReferenceKeys[0] : point.shipperReferenceKey,
                    shipperReferenceNumber: pointReferenceNumbers.length === 1 ? pointReferenceNumbers[0] : point.shipperReferenceNumber,
                };
            });

            const ambiguousDropMappingMessage = getAmbiguousActualDropMappingMessage(scopedActualDropPoints, targetedDoItems);
            if (ambiguousDropMappingMessage) {
                return NextResponse.json({ error: ambiguousDropMappingMessage }, { status: 400 });
            }
            const overPlanMessages = getActualCargoOverPlanMessages(targetedDoItems, actualCargoByDoItemId);
            const finalizationAuditNote = normalizeOptionalText(podNote) || normalizeOptionalText(data.note);
            if (overPlanMessages.length > 0 && !finalizationAuditNote) {
                return NextResponse.json(
                    {
                        error: `Aktual final melebihi rencana estimasi. Isi catatan finalisasi untuk audit: ${overPlanMessages.join('; ')}`,
                    },
                    { status: 400 }
                );
            }
        } catch (error) {
            return NextResponse.json(
                { error: error instanceof Error ? error.message : 'Muatan aktual batch SJ tidak valid' },
                { status: 400 }
            );
        }

        const isBillableActualDropPoint = (point: NonNullable<DeliveryOrder['actualDropPoints']>[number]) =>
            point.stopType === 'DROP' || point.stopType === 'EXTRA_DROP';
        const preservedActualDropPoints = currentDropPoints.filter(point =>
            !matchesTargetedDropPoint(point) ||
            (isPartialHoldContinuationFinalize && isBillableActualDropPoint(point))
        );
        mergedActualDropPoints = [...preservedActualDropPoints, ...(scopedActualDropPoints || [])];

        for (const item of targetedDoItems) {
            const orderItemRef = extractRefId(item.orderItemRef);
            if (!orderItemRef) {
                continue;
            }

            const orderItem = await getDocumentById<OrderItemProgressSnapshot & { _rev?: string }>(orderItemRef, 'orderItem');
            if (!orderItem) {
                continue;
            }
            if (!orderItem._rev && !isSupabaseBackendEnabled()) {
                return NextResponse.json(
                    { error: 'Revisi item order tidak tersedia. Refresh lalu coba lagi.' },
                    { status: 409 }
                );
            }
            if (!item._rev && !isSupabaseBackendEnabled()) {
                return NextResponse.json(
                    { error: 'Revisi item surat jalan tidak tersedia. Refresh lalu coba lagi.' },
                    { status: 409 }
                );
            }

            const progress = getOrderItemProgress(orderItem);
            const usesDeliveryOrderOwnedTarget =
                orderItem.entrySource === 'DELIVERY_ORDER' &&
                extractRefId(orderItem.sourceDeliveryOrderRef) === id;
            const plannedQtyKoli = roundQuantity(normalizeNumber(item.shippedQtyKoli ?? item.orderItemQtyKoli ?? 0));
            const plannedWeight = roundQuantity(normalizeNumber(item.shippedWeight ?? item.orderItemWeight ?? 0));
            const plannedVolume = roundQuantity(normalizeNumber(item.orderItemVolumeM3 ?? 0), 3);
            const actualCargo = actualCargoByDoItemId.get(item._id);

            if (!actualCargo) {
                return NextResponse.json({ error: 'Muatan aktual batch SJ tidak lengkap' }, { status: 400 });
            }

            const requireQty =
                progress.totalQtyKoli > 0 ||
                plannedQtyKoli > 0 ||
                normalizeNumber(item.orderItemQtyKoli ?? item.shippedQtyKoli ?? 0) > 0;
            const actualQtyKoli = requireQty ? actualCargo.actualQtyKoli : 0;
            const actualWeight = roundQuantity(actualCargo.actualWeightKg);
            const actualVolume = roundQuantity(normalizeNumber(actualCargo.actualVolumeM3 ?? 0), 3);
            const itemNonBillableCargo = getDeliveryOrderNonBillableCargoSummary(
                { actualDropPoints: scopedActualDropPoints || [] },
                item.shipperReferenceNumber,
                item._id
            );
            const itemHasHoldCargo =
                itemNonBillableCargo.qtyKoli > 0 ||
                itemNonBillableCargo.weightKg > 0 ||
                itemNonBillableCargo.volumeM3 > 0;

            if (requireQty && (!Number.isFinite(actualQtyKoli) || (actualQtyKoli <= 0 && !itemHasHoldCargo))) {
                return NextResponse.json(
                    { error: `Qty aktual untuk ${orderItem.description || 'item order'} harus lebih besar dari 0` },
                    { status: 400 }
                );
            }
            if (!Number.isFinite(actualWeight) || actualWeight < 0) {
                return NextResponse.json(
                    { error: `Berat aktual untuk ${orderItem.description || 'item order'} tidak valid` },
                    { status: 400 }
                );
            }
            if ((plannedWeight > 0 || normalizeNumber(item.orderItemWeight ?? 0) > 0) && actualWeight <= 0 && !itemHasHoldCargo) {
                return NextResponse.json(
                    { error: `Berat aktual untuk ${orderItem.description || 'item order'} wajib diisi` },
                    { status: 400 }
                );
            }
            if (actualCargo.actualVolumeM3 !== undefined && (!Number.isFinite(actualCargo.actualVolumeM3) || actualCargo.actualVolumeM3 < 0)) {
                return NextResponse.json(
                    { error: `Volume aktual untuk ${orderItem.description || 'item order'} tidak valid` },
                    { status: 400 }
                );
            }
            if ((plannedVolume > 0 || normalizeNumber(item.orderItemVolumeM3 ?? 0) > 0) && actualVolume <= 0 && !itemHasHoldCargo) {
                return NextResponse.json(
                    { error: `Volume aktual untuk ${orderItem.description || 'item order'} wajib diisi` },
                    { status: 400 }
                );
            }

            const previousTargetedDropPoints = currentDropPoints
                .filter(point => matchesTargetedDropPoint(point))
                .map((point, index) => ({
                    ...point,
                    _key: point._key || `existing-drop-${index + 1}`,
                }));
            const previousBillableCargo = getDeliveryOrderBillableCargoSummary(
                { actualDropPoints: previousTargetedDropPoints },
                item.shipperReferenceNumber,
                item._id
            );
            const previousNonBillableCargo = getDeliveryOrderNonBillableCargoSummary(
                { actualDropPoints: previousTargetedDropPoints },
                item.shipperReferenceNumber,
                item._id
            );
            const previousSplit = {
                delivered: {
                    qtyKoli: roundQuantity(previousBillableCargo.qtyKoli),
                    weight: roundQuantity(previousBillableCargo.weightKg),
                    volume: roundQuantity(previousBillableCargo.volumeM3, 3),
                },
                held: {
                    qtyKoli: roundQuantity(previousNonBillableCargo.qtyKoli),
                    weight: roundQuantity(previousNonBillableCargo.weightKg),
                    volume: roundQuantity(previousNonBillableCargo.volumeM3, 3),
                },
            };
            const nextActualDropPointsForProgress = isPartialHoldContinuationFinalize
                ? [
                    ...previousTargetedDropPoints.filter(point => point.stopType === 'DROP' || point.stopType === 'EXTRA_DROP'),
                    ...(scopedActualDropPoints || []),
                ]
                : scopedActualDropPoints || [];
            const itemBillableCargo = getDeliveryOrderBillableCargoSummary(
                { actualDropPoints: nextActualDropPointsForProgress },
                item.shipperReferenceNumber,
                item._id
            );
            const nextSplit = {
                delivered: {
                    qtyKoli: roundQuantity(itemBillableCargo.qtyKoli),
                    weight: roundQuantity(itemBillableCargo.weightKg),
                    volume: roundQuantity(itemBillableCargo.volumeM3, 3),
                },
                held: {
                    qtyKoli: roundQuantity(itemNonBillableCargo.qtyKoli),
                    weight: roundQuantity(itemNonBillableCargo.weightKg),
                    volume: roundQuantity(itemNonBillableCargo.volumeM3, 3),
                },
            };
            const itemNonBillableCargoForProgress = getDeliveryOrderNonBillableCargoSummary(
                { actualDropPoints: nextActualDropPointsForProgress },
                item.shipperReferenceNumber,
                item._id
            );
            nextSplit.held = {
                qtyKoli: roundQuantity(itemNonBillableCargoForProgress.qtyKoli),
                weight: roundQuantity(itemNonBillableCargoForProgress.weightKg),
                volume: roundQuantity(itemNonBillableCargoForProgress.volumeM3, 3),
            };

            const nextProgress = {
                ...progress,
                assignedQtyKoli: roundQuantity(Math.max(progress.assignedQtyKoli - plannedQtyKoli, 0)),
                assignedWeight: roundQuantity(Math.max(progress.assignedWeight - plannedWeight, 0)),
                assignedVolume: roundQuantity(Math.max(progress.assignedVolume - plannedVolume, 0), 3),
                deliveredQtyKoli: roundQuantity(progress.deliveredQtyKoli + nextSplit.delivered.qtyKoli - previousSplit.delivered.qtyKoli),
                deliveredWeight: roundQuantity(progress.deliveredWeight + nextSplit.delivered.weight - previousSplit.delivered.weight),
                deliveredVolume: roundQuantity(progress.deliveredVolume + nextSplit.delivered.volume - previousSplit.delivered.volume, 3),
                heldQtyKoli: roundQuantity(Math.max(progress.heldQtyKoli + nextSplit.held.qtyKoli - previousSplit.held.qtyKoli, 0)),
                heldWeight: roundQuantity(Math.max(progress.heldWeight + nextSplit.held.weight - previousSplit.held.weight, 0)),
                heldVolume: roundQuantity(Math.max(progress.heldVolume + nextSplit.held.volume - previousSplit.held.volume, 0), 3),
            };
            const nextActualWeightInputUnit = actualCargo.actualWeightInputUnit || 'KG';
            const nextActualVolumeInputUnit = actualCargo.actualVolumeInputUnit || 'M3';
            const nextActualTotalQtyKoli = roundQuantity(nextSplit.delivered.qtyKoli + nextSplit.held.qtyKoli);
            const nextActualTotalWeight = roundQuantity(nextSplit.delivered.weight + nextSplit.held.weight);
            const nextActualTotalVolume = roundQuantity(nextSplit.delivered.volume + nextSplit.held.volume, 3);
            const nextActualWeightInputValue = convertKgToWeightInputValue(nextActualTotalWeight, nextActualWeightInputUnit);
            const nextActualVolumeInputValue = convertM3ToVolumeInputValue(nextActualTotalVolume, nextActualVolumeInputUnit);

            const orderItemUpdates: Record<string, unknown> = {
                assignedQtyKoli: nextProgress.assignedQtyKoli,
                assignedWeight: nextProgress.assignedWeight,
                assignedVolume: nextProgress.assignedVolume,
                deliveredQtyKoli: nextProgress.deliveredQtyKoli,
                deliveredWeight: nextProgress.deliveredWeight,
                deliveredVolume: nextProgress.deliveredVolume,
                heldQtyKoli: nextProgress.heldQtyKoli,
                heldWeight: nextProgress.heldWeight,
                heldVolume: nextProgress.heldVolume,
                status: deriveOrderItemStatusFromProgress(nextProgress),
            };

            if (usesDeliveryOrderOwnedTarget) {
                if (requireQty) {
                    orderItemUpdates.qtyKoli = nextActualTotalQtyKoli;
                }
                orderItemUpdates.weight = nextActualTotalWeight;
                orderItemUpdates.weightInputValue = nextActualWeightInputValue;
                orderItemUpdates.weightInputUnit = nextActualWeightInputUnit;
                if (nextActualTotalVolume > 0) {
                    orderItemUpdates.volume = nextActualTotalVolume;
                    orderItemUpdates.volumeInputValue = nextActualVolumeInputValue;
                    orderItemUpdates.volumeInputUnit = nextActualVolumeInputUnit;
                } else {
                    orderItemUpdates.volume = null;
                    orderItemUpdates.volumeInputValue = null;
                    orderItemUpdates.volumeInputUnit = null;
                }
            }

            orderItemProgressUpdates.push({
                orderItemRef,
                orderItemUpdates,
                deliveryOrderItemRef: item._id,
                deliveryOrderItemUpdates: {
                    actualQtyKoli: requireQty ? nextActualTotalQtyKoli : null,
                    actualWeightKg: nextActualTotalWeight,
                    actualVolumeM3: nextActualTotalVolume > 0 ? nextActualTotalVolume : null,
                    actualWeightInputValue: nextActualWeightInputValue,
                    actualWeightInputUnit: nextActualWeightInputUnit,
                    actualVolumeInputValue: nextActualVolumeInputValue,
                    actualVolumeInputUnit: nextActualVolumeInputUnit,
                },
            });
        }
    }

    const isContinuableHoldPoint = (point: NonNullable<DeliveryOrder['actualDropPoints']>[number]) =>
        point.stopType === 'HOLD' || point.stopType === 'TRANSIT';
    const getSuratJalanStatusAfterFinalize = (
        record: {
            _id: string;
            referenceKey?: string;
            suratJalanNumber?: string;
        }
    ): DOStatus => {
        if (status !== 'DELIVERED') {
            return status as DOStatus;
        }

        const recordDoItems = targetedDoItems.filter(item =>
            getDeliveryOrderSuratJalanIdentity({
                deliveryOrderId: id,
                shipperReferenceKey: item.shipperReferenceKey,
                shipperReferenceNumber: item.shipperReferenceNumber,
            }) === record._id
        );
        const recordDoItemIds = new Set(recordDoItems.map(item => item._id));
        const recordReferenceKeys = new Set([
            normalizeOptionalText(record.referenceKey),
            ...recordDoItems.map(item => normalizeOptionalText(item.shipperReferenceKey)),
        ].filter((value): value is string => Boolean(value)));
        const recordReferenceNumbers = new Set([
            normalizeOptionalText(record.suratJalanNumber)?.toUpperCase(),
            ...recordDoItems.map(item => normalizeOptionalText(item.shipperReferenceNumber)?.toUpperCase()),
        ].filter((value): value is string => Boolean(value)));

        const hasContinuableHold = (scopedActualDropPoints || []).some(point => {
            if (!isContinuableHoldPoint(point)) {
                return false;
            }
            const pointItemRefs = [
                normalizeOptionalText(point.deliveryOrderItemRef),
                ...((Array.isArray(point.deliveryOrderItemRefs) ? point.deliveryOrderItemRefs : [])
                    .map(ref => normalizeOptionalText(ref))
                    .filter((ref): ref is string => Boolean(ref))),
            ].filter((ref): ref is string => Boolean(ref));
            if (pointItemRefs.some(ref => recordDoItemIds.has(ref))) {
                return true;
            }

            const pointReferenceKey = normalizeOptionalText(point.shipperReferenceKey);
            const pointReferenceNumber = normalizeOptionalText(point.shipperReferenceNumber)?.toUpperCase();
            return (
                (pointReferenceKey && recordReferenceKeys.has(pointReferenceKey)) ||
                (pointReferenceNumber && recordReferenceNumbers.has(pointReferenceNumber))
            );
        });

        return hasContinuableHold ? 'PARTIAL_HOLD' : 'DELIVERED';
    };

    try {
        await ensureTripRecordForSuratJalanWrites(deliveryOrder);

        for (const record of targetedRecords) {
            const summaryDeliveryOrder = {
                ...deliveryOrder,
                actualDropPoints: mergedActualDropPoints,
            };
            await updateDocument(record._id, {
                tripStatus: getSuratJalanStatusAfterFinalize(record),
                syncedAt: timestamp,
                ...(status === 'DELIVERED'
                    ? {
                        billableCargo: summarizeSuratJalanActualCargo(summaryDeliveryOrder, doItems, record, getDeliveryOrderBillableCargoSummary),
                        holdCargo: summarizeSuratJalanActualCargo(summaryDeliveryOrder, doItems, record, getDeliveryOrderHoldCargoSummary),
                        returnCargo: summarizeSuratJalanActualCargo(summaryDeliveryOrder, doItems, record, getDeliveryOrderReturnCargoSummary),
                    }
                    : {}),
                ...(status === 'DELIVERED'
                    ? {
                        podReceiverName,
                        podReceivedDate,
                        podNote,
                    }
                    : {}),
            }, 'suratJalan');
        }

        const refreshedSuratJalanRecords = suratJalanRecords.map(record =>
            targetSuratJalanRefs.includes(record._id)
                ? { ...record, tripStatus: getSuratJalanStatusAfterFinalize(record) }
                : record
        );
        const aggregatedTripStatus = aggregateTripStatusFromSuratJalanStatuses(
            deliveryOrder.status || 'CREATED',
            refreshedSuratJalanRecords.map(record => record.tripStatus || deliveryOrder.status || 'CREATED')
        );

        await updateDocument(id, {
            status: aggregatedTripStatus,
            ...(status === 'DELIVERED' && targetedRecords.length === refreshedSuratJalanRecords.length
                ? {
                    podReceiverName,
                    podReceivedDate,
                    podNote,
                }
                : {}),
            ...(status === 'DELIVERED'
                ? {
                    actualDropPoints: mergedActualDropPoints,
                    cargoFinalizedAt: timestamp,
                    cargoFinalizedBy: session._id,
                    cargoFinalizedByName: session.name,
                }
                : {}),
        }, 'deliveryOrder');

        for (const progressUpdate of orderItemProgressUpdates) {
            await updateDocument(progressUpdate.orderItemRef, progressUpdate.orderItemUpdates, 'orderItem');
            await updateDocument(progressUpdate.deliveryOrderItemRef, progressUpdate.deliveryOrderItemUpdates, 'deliveryOrderItem');
        }

        const tripRecord = await getDocumentById<{ _id: string; _rev?: string }>(id, 'trip');
        if (tripRecord) {
            await updateDocument(id, { status: aggregatedTripStatus }, 'trip');
        }
    } catch (error) {
        if (isMutationConflictError(error)) {
            return NextResponse.json({ error: 'Data trip / surat jalan berubah karena update lain. Refresh lalu coba lagi.' }, { status: 409 });
        }
        throw error;
    }

    const orderRef = extractRefId(deliveryOrder.orderRef);
    if (orderRef) {
        await syncOrderStatusFromItems(orderRef, session, addAuditLog);
    }

    await addAuditLog(
        session,
        'UPDATE',
        'delivery-orders',
        id,
        `Batch status SJ ${status}: ${targetedRecords.map(item => item.suratJalanNumber || item._id).join(', ')}${status === 'DELIVERED'
            ? ` (${targetedDoItems.length} item order/resi ikut diperbarui)`
            : ''}${note ? ` | ${note}` : ''}`
    );

    return NextResponse.json({
        data: {
            tripRef: id,
            updatedCount: targetedRecords.length,
            targetSuratJalanRefs,
            status,
        },
    });
}

export async function handleDeliveryOrderDriverStatusRequest(
    session: ApiSession,
    data: Record<string, unknown>,
    addAuditLog: AuditLogFn
) {
    const id = typeof data.id === 'string' ? data.id : '';
    const status = typeof data.status === 'string' ? data.status : '';
    const note = normalizeOptionalText(data.note);
    if (!id || !status) {
        return NextResponse.json({ error: 'Permintaan status driver tidak valid' }, { status: 400 });
    }
    if (!DRIVER_APPROVAL_REQUESTABLE_DO_STATUSES.has(status)) {
        return NextResponse.json({ error: 'Status ini tidak memakai approval admin dari driver app' }, { status: 400 });
    }

    const deliveryOrder = await getDocumentById<{
        _id: string;
        _rev?: string;
        doNumber?: string;
        status?: string;
        driverRef?: unknown;
        pendingDriverStatus?: string;
        pendingDriverStatusRequestedAt?: string;
        pendingDriverStatusRequestedBy?: string;
        pendingDriverStatusRequestedByName?: string;
        pendingDriverStatusNote?: string;
        receiverName?: string;
        receiverCompany?: string;
        receiverAddress?: string;
        shipperReferences?: Array<{
            _key?: string;
            referenceNumber?: string;
            receiverName?: string;
            receiverCompany?: string;
            receiverAddress?: string;
        }>;
        pendingDriverActualCargoItems?: Array<{
            deliveryOrderItemRef?: string;
            actualQtyKoli?: number;
            actualWeightInputValue?: number;
            actualWeightInputUnit?: WeightInputUnit;
            actualVolumeInputValue?: number;
            actualVolumeInputUnit?: VolumeInputUnit;
        }>;
        pendingDriverActualDropPoints?: ReturnType<typeof normalizeDeliveryActualDropPoints>;
    }>(id, 'deliveryOrder');
    if (!deliveryOrder) {
        return NextResponse.json({ error: 'Surat jalan tidak ditemukan' }, { status: 404 });
    }
    if (!deliveryOrder._rev && !isSupabaseBackendEnabled()) {
        return NextResponse.json({ error: 'Revisi surat jalan tidak tersedia. Refresh lalu coba lagi.' }, { status: 409 });
    }

    const allowedStatuses = DO_STATUS_TRANSITIONS[deliveryOrder.status || ''] || [];
    if (!allowedStatuses.includes(status)) {
        return NextResponse.json({ error: 'Permintaan status driver tidak valid untuk kondisi DO saat ini' }, { status: 409 });
    }

    if (deliveryOrder.pendingDriverStatus) {
        if (deliveryOrder.pendingDriverStatus === status) {
            return NextResponse.json(
                { error: `Permintaan ${status} untuk DO ${deliveryOrder.doNumber || id} sudah menunggu approval admin.` },
                { status: 409 }
            );
        }
        return NextResponse.json(
            { error: `DO ${deliveryOrder.doNumber || id} masih punya permintaan status ${deliveryOrder.pendingDriverStatus} yang belum diputuskan admin.` },
            { status: 409 }
        );
    }

    const doItems = await listDocumentsByFilter<{
        _id: string;
        orderItemRef?: unknown;
        shippedQtyKoli?: number;
        shippedWeight?: number;
        orderItemQtyKoli?: number;
        orderItemWeight?: number;
        orderItemVolumeM3?: number;
        orderItemWeightInputValue?: number;
        orderItemWeightInputUnit?: WeightInputUnit;
        orderItemVolumeInputValue?: number;
        orderItemVolumeInputUnit?: VolumeInputUnit;
        actualQtyKoli?: number;
        actualWeightKg?: number;
        actualVolumeM3?: number;
        actualWeightInputValue?: number;
        actualWeightInputUnit?: WeightInputUnit;
        actualVolumeInputValue?: number;
        actualVolumeInputUnit?: VolumeInputUnit;
    }>('deliveryOrderItem', { deliveryOrderRef: id });
    if (doItems.length === 0) {
        return NextResponse.json(
            { error: 'Surat jalan ini belum punya item muatan. Minta admin isi barang dulu sebelum driver mengajukan selesai.' },
            { status: 400 }
        );
    }
    const explicitActualItemRefs = new Set(
        (Array.isArray(data.actualItems) ? data.actualItems : [])
            .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
            .map(item => normalizeText(item.deliveryOrderItemRef))
            .filter(Boolean)
    );
    const missingExplicitActualItem = doItems.find(item => !explicitActualItemRefs.has(item._id));
    if (missingExplicitActualItem) {
        return NextResponse.json(
            {
                error: `Driver harus mengisi seluruh muatan aktual sebelum mengajukan selesai. Item ${missingExplicitActualItem._id} belum diisi.`,
            },
            { status: 400 }
        );
    }
    let pendingDriverActualCargoItems: Array<{
        deliveryOrderItemRef: string;
        actualQtyKoli?: number;
        actualWeightInputValue?: number;
        actualWeightInputUnit?: WeightInputUnit;
        actualVolumeInputValue?: number;
        actualVolumeInputUnit?: VolumeInputUnit;
    }> = [];
    let pendingDriverActualDropPoints: ReturnType<typeof normalizeDeliveryActualDropPoints> | undefined;
    try {
        const actualCargoByDoItemId = normalizeDeliveryOrderActualCargoInputs(data, doItems);
        pendingDriverActualCargoItems = Array.from(actualCargoByDoItemId.values()).map(item => ({
            deliveryOrderItemRef: item.deliveryOrderItemRef,
            actualQtyKoli: item.actualQtyKoli > 0 ? item.actualQtyKoli : undefined,
            actualWeightInputValue: item.actualWeightInputValue,
            actualWeightInputUnit: item.actualWeightInputUnit,
            actualVolumeInputValue: item.actualVolumeInputValue,
            actualVolumeInputUnit: item.actualVolumeInputUnit,
        }));
        pendingDriverActualDropPoints = normalizeDeliveryActualDropPoints(data, deliveryOrder, actualCargoByDoItemId);
        const ambiguousDropMappingMessage = getAmbiguousActualDropMappingMessage(pendingDriverActualDropPoints, doItems);
        if (ambiguousDropMappingMessage) {
            return NextResponse.json({ error: ambiguousDropMappingMessage }, { status: 400 });
        }
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Muatan aktual draft driver tidak valid' },
            { status: 400 }
        );
    }

    const timestamp = new Date().toISOString();
    try {
        await updateDocument(id, {
            pendingDriverStatus: status,
            pendingDriverStatusRequestedAt: timestamp,
            pendingDriverStatusRequestedBy: session._id,
            pendingDriverStatusRequestedByName: session.name,
            pendingDriverStatusNote: note,
            pendingDriverActualCargoItems,
            pendingDriverActualDropPoints,
        }, 'deliveryOrder');
        await createDocument({
            _id: crypto.randomUUID(),
            _type: 'trackingLog',
            refType: 'DO',
            refRef: id,
            status: buildDriverRequestedTrackingStatus(status),
            note: note || undefined,
            timestamp,
            userRef: session._id,
            userName: session.name,
        });
    } catch (error) {
        if (isMutationConflictError(error)) {
            return NextResponse.json(
                { error: 'Permintaan driver berubah karena ada update lain. Refresh lalu coba lagi.' },
                { status: 409 }
            );
        }
        throw error;
    }

    await addAuditLog(
        session,
        'UPDATE',
        'delivery-orders',
        id,
        `Driver mengajukan status ${status} untuk DO ${deliveryOrder.doNumber || id} (${pendingDriverActualCargoItems.length} item aktual draft)${note ? `: ${note}` : ''}`
    );

    return NextResponse.json({
        data: {
            ...deliveryOrder,
            pendingDriverStatus: status,
            pendingDriverStatusRequestedAt: timestamp,
            pendingDriverStatusRequestedBy: session._id,
            pendingDriverStatusRequestedByName: session.name,
            pendingDriverStatusNote: note,
            pendingDriverActualCargoItems,
            pendingDriverActualDropPoints,
        },
    });
}

export async function handleDeliveryOrderDriverStatusRequestReject(
    session: ApiSession,
    data: Record<string, unknown>,
    addAuditLog: AuditLogFn
) {
    const id = typeof data.id === 'string' ? data.id : '';
    const note = normalizeOptionalText(data.note);
    if (!id) {
        return NextResponse.json({ error: 'Permintaan status driver tidak valid' }, { status: 400 });
    }
    if (!note) {
        return NextResponse.json({ error: 'Alasan penolakan wajib diisi' }, { status: 400 });
    }

    const deliveryOrder = await getDocumentById<{
        _id: string;
        _rev?: string;
        doNumber?: string;
        pendingDriverStatus?: string;
        pendingDriverStatusRequestedAt?: string;
        pendingDriverStatusRequestedBy?: string;
        pendingDriverStatusRequestedByName?: string;
        pendingDriverStatusNote?: string;
        pendingDriverActualCargoItems?: Array<{
            deliveryOrderItemRef?: string;
            actualQtyKoli?: number;
            actualWeightInputValue?: number;
            actualWeightInputUnit?: WeightInputUnit;
            actualVolumeInputValue?: number;
            actualVolumeInputUnit?: VolumeInputUnit;
        }>;
        pendingDriverActualDropPoints?: ReturnType<typeof normalizeDeliveryActualDropPoints>;
    }>(id, 'deliveryOrder');
    if (!deliveryOrder) {
        return NextResponse.json({ error: 'Surat jalan tidak ditemukan' }, { status: 404 });
    }
    if (!deliveryOrder._rev && !isSupabaseBackendEnabled()) {
        return NextResponse.json({ error: 'Revisi surat jalan tidak tersedia. Refresh lalu coba lagi.' }, { status: 409 });
    }
    if (!deliveryOrder.pendingDriverStatus) {
        return NextResponse.json({ error: 'Tidak ada permintaan status driver yang menunggu approval' }, { status: 409 });
    }

    const timestamp = new Date().toISOString();
    try {
        await updateDocument(id, {
            pendingDriverStatus: null,
            pendingDriverStatusRequestedAt: null,
            pendingDriverStatusRequestedBy: null,
            pendingDriverStatusRequestedByName: null,
            pendingDriverStatusNote: null,
            pendingDriverActualCargoItems: null,
            pendingDriverActualDropPoints: null,
        }, 'deliveryOrder');
        await createDocument({
            _id: crypto.randomUUID(),
            _type: 'trackingLog',
            refType: 'DO',
            refRef: id,
            status: 'DRIVER_REQUEST_REJECTED',
            note: `${deliveryOrder.pendingDriverStatus}${note ? `: ${note}` : ''}`,
            timestamp,
            userRef: session._id,
            userName: session.name,
        });
    } catch (error) {
        if (isMutationConflictError(error)) {
            return NextResponse.json(
                { error: 'Permintaan driver berubah karena ada update lain. Refresh lalu coba lagi.' },
                { status: 409 }
            );
        }
        throw error;
    }

    await addAuditLog(
        session,
        'UPDATE',
        'delivery-orders',
        id,
        `Permintaan driver ${deliveryOrder.pendingDriverStatus} untuk DO ${deliveryOrder.doNumber || id} ditolak: ${note}`
    );

    return NextResponse.json({
        data: {
            ...deliveryOrder,
            pendingDriverStatus: null,
            pendingDriverStatusRequestedAt: null,
            pendingDriverStatusRequestedBy: null,
            pendingDriverStatusRequestedByName: null,
            pendingDriverStatusNote: null,
            pendingDriverActualCargoItems: null,
            pendingDriverActualDropPoints: null,
        },
    });
}

export async function handleDeliveryOrderCreate(
    session: ApiSession,
    data: Record<string, unknown>,
    addAuditLog: AuditLogFn
) {
    const orderRef = typeof data.orderRef === 'string' ? data.orderRef : '';
    if (!orderRef) {
        return NextResponse.json({ error: 'Order surat jalan wajib diisi' }, { status: 400 });
    }

    const order = await getDocumentById<{
        _id: string;
        _rev?: string;
        masterResi?: string;
        cargoEntryMode?: 'ORDER' | 'DELIVERY_ORDER';
        customerRef?: string;
        customerName?: string;
        customerPickupRef?: string;
        receiverName?: string;
        receiverPhone?: string;
        receiverAddress?: string;
        receiverCompany?: string;
        pickupAddress?: string;
        pickupStops?: OrderPickupStop[];
        tripPlans?: OrderTripPlan[];
        serviceRef?: string;
        serviceName?: string;
    }>(orderRef, 'order');
    if (!order) {
        return NextResponse.json({ error: 'Order tidak ditemukan' }, { status: 404 });
    }
    const orderCustomerRef = extractRefId(order.customerRef);

    const orderTripPlanKey = normalizeOptionalText(data.orderTripPlanKey);
    const selectedTripPlan = orderTripPlanKey
        ? (order.tripPlans || []).find(plan => normalizeOptionalText(plan._key) === orderTripPlanKey) || null
        : null;
    if (orderTripPlanKey && !selectedTripPlan) {
        return NextResponse.json({ error: 'Rencana trip order tidak ditemukan atau sudah dipakai. Refresh lalu coba lagi.' }, { status: 409 });
    }
    if (selectedTripPlan?.linkedDeliveryOrderRef) {
        const linkedDeliveryOrder = await getDocumentById<{ _id: string; doNumber?: string; status?: string }>(
            selectedTripPlan.linkedDeliveryOrderRef,
            'deliveryOrder'
        );
        if (linkedDeliveryOrder && linkedDeliveryOrder.status !== 'CANCELLED') {
            return NextResponse.json(
                { error: `Rencana trip ini sudah dibuat menjadi Surat Jalan ${linkedDeliveryOrder.doNumber || linkedDeliveryOrder._id}.` },
                { status: 409 }
            );
        }
    }
    const requestedPickupStopKeys = Array.isArray(data.pickupStopKeys)
        ? data.pickupStopKeys.map(key => normalizeOptionalText(key)).filter((key): key is string => Boolean(key))
        : [];
    const extraPickupRefs = [
        ...new Set([
            ...requestedPickupStopKeys
                .filter(key => key.startsWith('customer-pickup:'))
                .map(key => key.replace('customer-pickup:', '')),
            ...(Array.isArray(data.extraPickupRefs)
                ? data.extraPickupRefs.map(ref => normalizeOptionalText(ref)).filter((ref): ref is string => Boolean(ref))
                : []),
        ]),
    ];
    const extraPickupDocs = extraPickupRefs.length > 0
        ? await listDocumentsByFilter<{
            _id: string;
            customerRef?: unknown;
            label?: string;
            pickupAddress?: string;
            notes?: string;
            active?: boolean;
        }>('customerPickupLocation', { _id: extraPickupRefs })
        : [];
    if (extraPickupDocs.length !== extraPickupRefs.length) {
        return NextResponse.json({ error: 'Sebagian master pickup tambahan tidak ditemukan' }, { status: 404 });
    }
    const invalidExtraPickup = extraPickupDocs.find(pickup =>
        extractRefId(pickup.customerRef) !== orderCustomerRef ||
        pickup.active === false ||
        !normalizeOptionalText(pickup.pickupAddress)
    );
    if (invalidExtraPickup) {
        return NextResponse.json({ error: 'Master pickup tambahan tidak aktif atau tidak sesuai customer order' }, { status: 409 });
    }
    const currentOrderPickupStops = normalizeOrderPickupStopsInput(
        Array.isArray(order.pickupStops) ? order.pickupStops : [],
        order.pickupAddress
    ).map((stop, index) => ({
        ...stop,
        sequence: index + 1,
    }));
    const orderPickupByMasterRef = new Map(
        currentOrderPickupStops
            .map(stop => [normalizeOptionalText(stop.customerPickupRef), stop] as const)
            .filter(([customerPickupRef]) => Boolean(customerPickupRef))
    );
    const orderPickupByAddress = new Map(
        currentOrderPickupStops
            .map(stop => [normalizeText(stop.pickupAddress).toLowerCase(), stop] as const)
            .filter(([pickupAddress]) => Boolean(pickupAddress))
    );
    const pickupStopKeyAlias = new Map<string, string>();
    const extraOrderPickupStops: OrderPickupStop[] = [];
    for (const pickup of extraPickupDocs) {
        const pickupAddress = normalizeText(pickup.pickupAddress);
        const existingStop =
            orderPickupByMasterRef.get(pickup._id) ||
            orderPickupByAddress.get(pickupAddress.toLowerCase());
        if (existingStop?._key) {
            pickupStopKeyAlias.set(`customer-pickup:${pickup._id}`, existingStop._key);
            continue;
        }

        const newStop: OrderPickupStop = {
            _key: crypto.randomUUID(),
            sequence: currentOrderPickupStops.length + extraOrderPickupStops.length + 1,
            customerPickupRef: pickup._id,
            pickupLabel: normalizeOptionalText(pickup.label),
            pickupAddress,
            notes: normalizeOptionalText(pickup.notes),
        };
        extraOrderPickupStops.push(newStop);
        orderPickupByMasterRef.set(pickup._id, newStop);
        orderPickupByAddress.set(pickupAddress.toLowerCase(), newStop);
        pickupStopKeyAlias.set(`customer-pickup:${pickup._id}`, newStop._key || '');
    }
    const effectiveOrderPickupStops = [...currentOrderPickupStops, ...extraOrderPickupStops]
        .map((stop, index) => ({
            ...stop,
            sequence: index + 1,
        }));
    const remapPickupStopKey = (key: unknown) => {
        const normalizedKey = normalizeOptionalText(key);
        return normalizedKey ? pickupStopKeyAlias.get(normalizedKey) || normalizedKey : undefined;
    };
    const requestedOrderPickupStopKeys = requestedPickupStopKeys
        .map(remapPickupStopKey)
        .filter((key): key is string => Boolean(key && !key.startsWith('customer-pickup:')));
    const selectedPickupStopKeys = new Set(
        requestedOrderPickupStopKeys.length > 0
            ? requestedOrderPickupStopKeys
            : (selectedTripPlan?.pickupStopKeys || [])
                .map(key => normalizeOptionalText(key))
                .filter((key): key is string => Boolean(key))
    );
    const plannedPickupStops = selectedTripPlan
        ? effectiveOrderPickupStops.filter(stop => selectedPickupStopKeys.size === 0 || (stop._key && selectedPickupStopKeys.has(stop._key)))
        : requestedOrderPickupStopKeys.length > 0
            ? effectiveOrderPickupStops.filter(stop => stop._key && selectedPickupStopKeys.has(stop._key))
            : [];
    const deliveryOrderPickupStops = [
        ...plannedPickupStops.map(stop => ({
        _key: crypto.randomUUID(),
        sequence: 0,
        orderPickupStopKey: stop._key,
        customerPickupRef: stop.customerPickupRef,
        pickupLabel: stop.pickupLabel,
        pickupAddress: stop.pickupAddress,
        notes: stop.notes,
        })),
    ].map((stop, index) => ({
        ...stop,
        sequence: index + 1,
    }));
    const pickupStopByOrderKey = new Map(
        deliveryOrderPickupStops
            .filter(stop => stop.orderPickupStopKey)
            .map(stop => [stop.orderPickupStopKey as string, stop])
    );
    const deliveryOrderShipperReferences = (Array.isArray(data.shipperReferences) ? data.shipperReferences : [])
        .filter(isPlainObject)
        .map((reference, index) => {
            const referenceNumber = normalizeText(reference.referenceNumber);
            if (!referenceNumber) {
                return null;
            }
            const pickupStopKey = remapPickupStopKey(reference.pickupStopKey);
            const pickupStop = pickupStopKey ? pickupStopByOrderKey.get(pickupStopKey) : undefined;
            return {
                _key: crypto.randomUUID(),
                sequence: index + 1,
                referenceNumber,
                pickupStopKey: pickupStop?._key || pickupStopKey,
                pickupAddress: pickupStop?.pickupAddress,
                billingCustomerRef: normalizeOptionalText(reference.billingCustomerRef),
                billingCustomerName: normalizeOptionalText(reference.billingCustomerName),
                notes: normalizeOptionalText(reference.notes),
            };
        })
        .filter((reference): reference is NonNullable<typeof reference> => Boolean(reference));

    const customer = orderCustomerRef
        ? await getDocumentById<{
            _id: string;
            _rev?: string;
            name?: string;
            active?: boolean;
            deliveryOrderPrefix?: string;
            deliveryOrderCounter?: number;
            deliveryOrderPeriod?: string;
        }>(orderCustomerRef, 'customer')
        : null;
    if (orderCustomerRef && !customer) {
        return NextResponse.json({ error: 'Customer order tidak ditemukan' }, { status: 404 });
    }

    const vehicleRef =
        (typeof data.vehicleRef === 'string' ? data.vehicleRef : '') ||
        selectedTripPlan?.vehicleRef ||
        '';
    let vehiclePlate =
        typeof data.vehiclePlate === 'string' && data.vehiclePlate.trim()
            ? data.vehiclePlate.trim()
            : selectedTripPlan?.vehiclePlate || '';
    let vehicleCapacityKg = 0;
    let selectedVehicle: {
        _id: string;
        _rev?: string;
        plateNumber?: string;
        status?: string;
        serviceRef?: string;
        serviceName?: string;
        capacityKg?: number;
    } | null = null;
    const vehicleCategoryOverrideReason =
        normalizeOptionalText(data.vehicleCategoryOverrideReason) ||
        selectedTripPlan?.vehicleCategoryOverrideReason;
    const driverRef =
        (typeof data.driverRef === 'string' ? data.driverRef : '') ||
        selectedTripPlan?.driverRef ||
        '';
    let driverName =
        typeof data.driverName === 'string' && data.driverName.trim()
            ? data.driverName.trim()
            : selectedTripPlan?.driverName || '';
    let selectedDriver: { _id: string; _rev?: string; name?: string; active?: boolean } | null = null;
    let vehicleServiceRef: string | undefined;
    let vehicleServiceName: string | undefined;
    let vehicleCategoryOverrideReasonToStore: string | undefined;

    if (vehicleRef) {
        const vehicle = await getDocumentById<{
            _id: string;
            plateNumber?: string;
            status?: string;
            serviceRef?: string;
            serviceName?: string;
            capacityKg?: number;
            _rev?: string;
        }>(vehicleRef, 'vehicle');
        if (!vehicle) {
            return NextResponse.json({ error: 'Kendaraan DO tidak ditemukan' }, { status: 404 });
        }
        selectedVehicle = vehicle;
        if (vehicle.status === 'SOLD') {
            return NextResponse.json({ error: 'Kendaraan yang sudah dijual tidak bisa dipakai untuk surat jalan baru' }, { status: 409 });
        }
        if (vehicle.status === 'OUT_OF_SERVICE') {
            return NextResponse.json({ error: 'Kendaraan yang sedang out of service tidak bisa dipakai untuk surat jalan baru' }, { status: 409 });
        }
        vehicleCapacityKg = normalizeNumber(vehicle.capacityKg ?? 0);
        const conflictingDeliveryOrder =
            (await listDocumentsByFilter<{
                _id: string;
                doNumber?: string;
                customerDoNumber?: string;
                vehicleRef?: unknown;
                vehiclePlate?: string;
                status?: string;
            }>('deliveryOrder', {
                status: ['CREATED', 'HEADING_TO_PICKUP', 'ON_DELIVERY', 'ARRIVED'],
            })).find(candidate =>
                extractRefId(candidate.vehicleRef) === vehicleRef
                || normalizeOptionalText(candidate.vehiclePlate)?.toLowerCase() === (vehicle.plateNumber || vehiclePlate || '').toLowerCase()
            ) || null;
        if (conflictingDeliveryOrder) {
            const conflictingNumber =
                conflictingDeliveryOrder.doNumber ||
                conflictingDeliveryOrder.customerDoNumber ||
                conflictingDeliveryOrder._id;
            return NextResponse.json(
                {
                    error: `Kendaraan ${vehicle.plateNumber || vehicleRef} masih dipakai di surat jalan aktif ${conflictingNumber}. Selesaikan atau batalkan dulu DO tersebut.`,
                },
                { status: 409 }
            );
        }
        const orderServiceRef = extractRefId(order.serviceRef);
        vehicleServiceRef = extractRefId(vehicle.serviceRef) || undefined;
        vehicleServiceName = vehicle.serviceName || undefined;
        if (orderServiceRef && !vehicleServiceRef && !vehicleCategoryOverrideReason) {
            return NextResponse.json(
                {
                    error: `Kendaraan ${vehicle.plateNumber || vehicleRef} belum punya kategori armada yang cocok. Isi alasan override jika trip ini memang harus jalan dengan armada berbeda.`,
                },
                { status: 400 }
            );
        }
        if (orderServiceRef && vehicleServiceRef !== orderServiceRef && !vehicleCategoryOverrideReason) {
            return NextResponse.json(
                {
                    error: `Kendaraan ${vehicle.plateNumber || vehicleRef} berkategori ${vehicle.serviceName || '-'} tidak sama dengan armada order ${order.serviceName || '-'}. Isi alasan override bila trip parsial ini memang memakai armada lain.`,
                },
                { status: 400 }
            );
        }
        if (orderServiceRef && vehicleServiceRef !== orderServiceRef) {
            vehicleCategoryOverrideReasonToStore = vehicleCategoryOverrideReason || undefined;
        }
        vehiclePlate = vehicle.plateNumber || vehiclePlate;
    }
    if (driverRef) {
        const driver = await getDocumentById<{ _id: string; _rev?: string; name?: string; active?: boolean }>(driverRef, 'driver');
        if (!driver) {
            return NextResponse.json({ error: 'Supir DO tidak ditemukan' }, { status: 404 });
        }
        selectedDriver = driver;
        if (driver.active === false) {
            return NextResponse.json({ error: 'Supir DO tidak aktif' }, { status: 409 });
        }
        const conflictingDeliveryOrder =
            (await listDocumentsByFilter<{
                _id: string;
                doNumber?: string;
                customerDoNumber?: string;
                driverRef?: unknown;
                driverName?: string;
                status?: string;
            }>('deliveryOrder', {
                status: ['CREATED', 'HEADING_TO_PICKUP', 'ON_DELIVERY', 'ARRIVED'],
            })).find(candidate =>
                extractRefId(candidate.driverRef) === driverRef
                || normalizeOptionalText(candidate.driverName)?.toLowerCase() === (driver.name || driverName || '').toLowerCase()
            ) || null;
        if (conflictingDeliveryOrder) {
            const conflictingNumber =
                conflictingDeliveryOrder.doNumber ||
                conflictingDeliveryOrder.customerDoNumber ||
                conflictingDeliveryOrder._id;
            return NextResponse.json(
                {
                    error: `Supir ${driver.name || driverRef} masih terikat di surat jalan aktif ${conflictingNumber}. Selesaikan atau batalkan dulu DO tersebut.`,
                },
                { status: 409 }
            );
        }
        driverName = driver.name || driverName;
    }

    const doDate =
        typeof data.date === 'string' && data.date
            ? data.date
            : selectedTripPlan?.date
                ? selectedTripPlan.date
            : getBusinessDateValue();
    try {
        assertIsoDate(doDate, 'Tanggal surat jalan');
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Tanggal surat jalan tidak valid' },
            { status: 400 }
        );
    }
    const manualCustomerDoNumber = normalizeOptionalText(data.customerDoNumber)?.toUpperCase();
    const taripBorongan = normalizeCurrencyNumber(data.taripBorongan ?? selectedTripPlan?.taripBorongan ?? 0);
    if (!Number.isFinite(taripBorongan) || taripBorongan < 0) {
        return NextResponse.json({ error: 'Upah trip pada surat jalan tidak valid' }, { status: 400 });
    }
    let tripRouteSelection: Awaited<ReturnType<typeof resolveTripRouteRateSelection>>;
    try {
        const tripRouteSelectionInput = {
            ...data,
            tripRouteRateRef: normalizeOptionalText(data.tripRouteRateRef) || selectedTripPlan?.tripRouteRateRef,
            tripOriginArea: normalizeOptionalText(data.tripOriginArea) || selectedTripPlan?.tripOriginArea,
            tripDestinationArea: normalizeOptionalText(data.tripDestinationArea) || selectedTripPlan?.tripDestinationArea,
        };
        tripRouteSelection = await resolveTripRouteRateSelection(tripRouteSelectionInput, {
            serviceRef: normalizeOptionalText(order.serviceRef) || vehicleServiceRef,
        });
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Master biaya rute trip tidak valid' },
            { status: 400 }
        );
    }
    const matchedTripRouteRateFee = normalizeCurrencyNumber(tripRouteSelection?.matchedTripRouteRate?.rate ?? 0);
    const matchedTripRouteOvertonaseRatePerKg = getTripRouteOvertonaseRatePerKg(tripRouteSelection?.matchedTripRouteRate);
    if (!isSupabaseBackendEnabled() && tripRouteSelection?.matchedTripRouteRate && !tripRouteSelection.matchedTripRouteRate._rev) {
        return NextResponse.json(
            { error: 'Revisi master biaya rute trip tidak tersedia. Refresh lalu coba lagi.' },
            { status: 409 }
        );
    }
    if (
        matchedTripRouteRateFee > 0 &&
        taripBorongan > 0 &&
        Math.abs(taripBorongan - matchedTripRouteRateFee) > 0.01
    ) {
        return NextResponse.json(
            { error: 'Upah trip mengikuti master biaya rute trip yang dipilih. Ubah area trip jika ingin memakai master yang berbeda.' },
            { status: 409 }
        );
    }
    const customerDoPrefix = normalizeCustomerDoPrefix(customer?.deliveryOrderPrefix);
    const customerDoNumber = manualCustomerDoNumber || undefined;
    const effectiveTripFee =
        matchedTripRouteRateFee > 0
            ? matchedTripRouteRateFee
            : taripBorongan;

    if (customerDoNumber && orderCustomerRef) {
        const duplicateCustomerDoNumber =
            (await listDocumentsByFilter<{
                _id: string;
                customerRef?: unknown;
                customerDoNumber?: string;
            }>('deliveryOrder', {
                customerRef: orderCustomerRef,
            })).find(candidate =>
                normalizeOptionalText(candidate.customerDoNumber)?.toLowerCase() === customerDoNumber.toLowerCase()
            ) || null;

        if (duplicateCustomerDoNumber) {
            return NextResponse.json(
                { error: `No. SJ pengirim ${customerDoNumber} sudah dipakai untuk customer ini.` },
                { status: 409 }
            );
        }
    }

    const existingOrderItems = await listDocumentsByFilter<{
        _id: string;
        _createdAt?: string;
        entrySource?: 'ORDER' | 'DELIVERY_ORDER';
        sourceDeliveryOrderRef?: string;
    }>('orderItem', { orderRef });
    const existingOrderItemCount = existingOrderItems.length;
    const orderItemCargoModeHints =
        !order.cargoEntryMode && existingOrderItemCount > 0
            ? existingOrderItems
            : [];
    const resolvedCargoEntryMode = resolveOrderCargoEntryMode(order, orderItemCargoModeHints);
    const requestedItemIds = Array.from(new Set([
        ...(Array.isArray(data.itemRefs) ? data.itemRefs.filter((item): item is string => typeof item === 'string' && item.length > 0) : []),
        ...(Array.isArray(data.items)
            ? data.items
                .filter(isPlainObject)
                .map(item => normalizeText(item.orderItemRef))
                .filter(Boolean)
            : []),
    ]));
    const usingDirectCargoInput = requestedItemIds.length === 0;
    const allowsDirectCargoInput = resolvedCargoEntryMode === 'DELIVERY_ORDER' || existingOrderItemCount === 0;
    let selectedItems: Array<OrderItemProgressSnapshot & { _rev?: string }> = [];
    let normalizedSelections: ReturnType<typeof normalizeDeliveryOrderSelections> = [];
    let selectionByItemId = new Map<string, ReturnType<typeof normalizeDeliveryOrderSelections>[number]>();
    let directCargoItems: NormalizedOrderItemInput[] = [];
    const selectionSummaries: string[] = [];
    let plannedShipmentWeightKgTotal = 0;

    if (usingDirectCargoInput) {
        if (!allowsDirectCargoInput) {
            return NextResponse.json(
                { error: 'Order ini sudah punya item target. Pilih item order yang mau dimasukkan ke surat jalan.' },
                { status: 409 }
            );
        }
        try {
            directCargoItems = await normalizeOrderItemsInput(
                orderCustomerRef || normalizeText(order.customerRef),
                Array.isArray(data.cargoItems) ? data.cargoItems : [],
                { allowEmpty: false }
            );
            directCargoItems = directCargoItems.map(item => ({
                ...item,
                pickupStopKey: remapPickupStopKey(item.pickupStopKey),
            }));
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Barang surat jalan tidak valid';
            return NextResponse.json({ error: message }, { status: 400 });
        }
        const plannedWeightKg = roundQuantity(
            directCargoItems.reduce((sum, item) => sum + normalizeNumber(item.weight || 0), 0)
        );
        plannedShipmentWeightKgTotal = plannedWeightKg;
        if (vehicleCapacityKg > 0 && plannedShipmentWeightKgTotal - vehicleCapacityKg > 0.00001) {
            return NextResponse.json(
                {
                    error: `Muatan rencana ${plannedShipmentWeightKgTotal} kg melebihi kapasitas kendaraan ${vehicleCapacityKg} kg.`,
                },
                { status: 409 }
            );
        }
        for (const item of directCargoItems) {
            selectionSummaries.push(
                summarizeSelection({
                    orderItemRef: item.description,
                    qtyKoli: item.qtyKoli,
                    weightInputValue: item.weightInputValue,
                    weightInputUnit: item.weightInputUnit,
                    volumeInputValue: item.volumeInputValue,
                    volumeInputUnit: item.volumeInputUnit,
                    holdRemaining: false,
                }, item.description)
            );
        }
    } else {
        selectedItems = (await Promise.all(
            requestedItemIds.map(itemId => getDocumentById<OrderItemProgressSnapshot & { _rev?: string }>(itemId, 'orderItem'))
        )).filter((item): item is OrderItemProgressSnapshot & { _rev?: string } => Boolean(item));
        if (selectedItems.length !== requestedItemIds.length) {
            return NextResponse.json({ error: 'Sebagian item order tidak ditemukan' }, { status: 404 });
        }
        if (!isSupabaseBackendEnabled() && selectedItems.some(item => !item._rev)) {
            return NextResponse.json({ error: 'Revisi item order tidak tersedia. Refresh lalu coba lagi.' }, { status: 409 });
        }

        try {
            normalizedSelections = normalizeDeliveryOrderSelections(data, selectedItems);
        } catch (error) {
            return NextResponse.json(
                { error: error instanceof Error ? error.message : 'Item surat jalan tidak valid' },
                { status: 400 }
            );
        }
        if (normalizedSelections.length === 0) {
            return NextResponse.json({ error: 'Pilih minimal 1 item untuk surat jalan' }, { status: 400 });
        }

        const duplicateSelection = normalizedSelections.find(
            (selection, index) => normalizedSelections.findIndex(candidate => candidate.orderItemRef === selection.orderItemRef) !== index
        );
        if (duplicateSelection) {
            return NextResponse.json({ error: 'Item surat jalan tidak boleh dipilih dua kali' }, { status: 400 });
        }

        selectionByItemId = new Map(normalizedSelections.map(selection => [selection.orderItemRef, selection]));

        for (const item of selectedItems) {
            const selection = selectionByItemId.get(item._id);
            if (!selection) {
                continue;
            }
            if (extractRefId(item.orderRef) !== orderRef) {
                return NextResponse.json({ error: 'Ada item yang bukan milik order ini' }, { status: 400 });
            }

            const progress = getOrderItemProgress(item);
            let activeAssignment: { _id: string } | null = null;
            const existingAssignments = await listDocumentsByFilter<{ _id: string; deliveryOrderRef?: string }>('deliveryOrderItem', {
                orderItemRef: item._id,
            });
            for (const assignment of existingAssignments) {
                const linkedDeliveryOrder = assignment.deliveryOrderRef
                    ? await getDocumentById<{ _id: string; status?: string }>(assignment.deliveryOrderRef, 'deliveryOrder')
                    : null;
                if (linkedDeliveryOrder && ['CREATED', 'HEADING_TO_PICKUP', 'ON_DELIVERY', 'ARRIVED'].includes(linkedDeliveryOrder.status || '')) {
                    activeAssignment = { _id: assignment._id };
                    break;
                }
            }
            if (activeAssignment) {
                return NextResponse.json({ error: 'Ada item yang sudah terikat ke surat jalan aktif lain' }, { status: 409 });
            }

            if (progress.totalQtyKoli > 0) {
                if (!Number.isFinite(selection.qtyKoli) || selection.qtyKoli <= 0) {
                    return NextResponse.json({ error: 'Jumlah koli kirim harus lebih besar dari 0' }, { status: 400 });
                }
                if (selection.qtyKoli > progress.pendingQtyKoli) {
                    return NextResponse.json({ error: `Jumlah koli kirim untuk ${item.description || 'item order'} melebihi muatan pending. Muatan hold harus diproses dari SJ/trip asal.` }, { status: 409 });
                }

                const pendingQtyUsed = roundQuantity(selection.qtyKoli);
                const remainingQtyAfterShipment = roundQuantity(Math.max(progress.pendingQtyKoli - pendingQtyUsed, 0));
                if (selection.holdRemaining) {
                    if (remainingQtyAfterShipment <= 0) {
                        return NextResponse.json({ error: `Tidak ada sisa qty ${item.description || 'item order'} yang bisa ditahan` }, { status: 409 });
                    }
                    if (!selection.holdReason) {
                        return NextResponse.json({ error: `Alasan hold wajib diisi untuk sisa qty ${item.description || 'item order'}` }, { status: 400 });
                    }
                }

                plannedShipmentWeightKgTotal = roundQuantity(
                    plannedShipmentWeightKgTotal +
                    calculateWeightPortion(progress.totalWeight, progress.totalQtyKoli, selection.qtyKoli)
                );
                selectionSummaries.push(summarizeSelection(selection, item.description));
                continue;
            }

            if (progress.pendingWeight <= 0 && progress.pendingVolume <= 0) {
                return NextResponse.json({ error: `Tidak ada sisa berat/volume ${item.description || 'item order'} yang pending untuk ditripkan. Muatan hold harus diproses dari SJ/trip asal.` }, { status: 409 });
            }
            if (selection.qtyKoli > 0) {
                return NextResponse.json(
                    { error: `Item ${item.description || 'item order'} tidak memakai basis koli. Centang item untuk mengirim seluruh sisa berat/volume.` },
                    { status: 400 }
                );
            }
            const selectedWeightInputValue = normalizeNumber(selection.weightInputValue ?? 0, {
                maxFractionDigits: getWeightInputFractionDigits(selection.weightInputUnit),
            });
            const selectedVolumeInputValue = normalizeNumber(selection.volumeInputValue ?? 0, {
                maxFractionDigits: selection.volumeInputUnit === 'LITER' ? 0 : 3,
            });
            const selectedWeightKg = selectedWeightInputValue > 0 && selection.weightInputUnit
                ? roundQuantity(convertWeightToKg(selectedWeightInputValue, selection.weightInputUnit))
                : 0;
            const selectedVolumeM3 = selectedVolumeInputValue > 0 && selection.volumeInputUnit
                ? roundQuantity(convertVolumeToM3(selectedVolumeInputValue, selection.volumeInputUnit), 3)
                : 0;
            if (progress.pendingWeight > 0 && selectedWeightKg <= 0) {
                return NextResponse.json({ error: `Berat kirim untuk ${item.description || 'item order'} wajib diisi` }, { status: 400 });
            }
            if (progress.pendingVolume > 0 && selectedVolumeM3 <= 0) {
                return NextResponse.json({ error: `Volume kirim untuk ${item.description || 'item order'} wajib diisi` }, { status: 400 });
            }
            if (selectedWeightKg <= 0 && selectedVolumeM3 <= 0) {
                return NextResponse.json({ error: `Muatan kirim untuk ${item.description || 'item order'} tidak valid` }, { status: 400 });
            }
            if (selectedWeightKg - progress.pendingWeight > 0.00001) {
                return NextResponse.json({ error: `Berat kirim untuk ${item.description || 'item order'} melebihi muatan pending. Muatan hold harus diproses dari SJ/trip asal.` }, { status: 409 });
            }
            if (selectedVolumeM3 - progress.pendingVolume > 0.00001) {
                return NextResponse.json({ error: `Volume kirim untuk ${item.description || 'item order'} melebihi muatan pending. Muatan hold harus diproses dari SJ/trip asal.` }, { status: 409 });
            }
            const pendingWeightUsed = roundQuantity(selectedWeightKg);
            const pendingVolumeUsed = roundQuantity(selectedVolumeM3, 3);
            const remainingWeightAfterShipment = roundQuantity(Math.max(progress.pendingWeight - pendingWeightUsed, 0));
            const remainingVolumeAfterShipment = roundQuantity(Math.max(progress.pendingVolume - pendingVolumeUsed, 0), 3);
            if (selection.holdRemaining) {
                if (remainingWeightAfterShipment <= 0 && remainingVolumeAfterShipment <= 0) {
                    return NextResponse.json({ error: `Tidak ada sisa muatan ${item.description || 'item order'} yang bisa ditahan` }, { status: 409 });
                }
                if (!selection.holdReason) {
                    return NextResponse.json({ error: `Alasan hold wajib diisi untuk sisa muatan ${item.description || 'item order'}` }, { status: 400 });
                }
            }

            plannedShipmentWeightKgTotal = roundQuantity(plannedShipmentWeightKgTotal + selectedWeightKg);
            selectionSummaries.push(summarizeSelection(selection, item.description));
        }

        if (vehicleCapacityKg > 0 && plannedShipmentWeightKgTotal - vehicleCapacityKg > 0.00001) {
            return NextResponse.json(
                {
                    error: `Muatan rencana ${plannedShipmentWeightKgTotal} kg melebihi kapasitas kendaraan ${vehicleCapacityKg} kg.`,
                },
                { status: 409 }
            );
        }
    }

    const doId = crypto.randomUUID();
    const doNumber = await getNextNumber('do', doDate);
    const companyProfile = await getCompanyProfile<Pick<CompanyProfile, 'name' | 'address' | 'phone' | 'email' | 'logoUrl'>>();
    const receiverName = '';
    const receiverPhone = '';
    const receiverAddress = '';
    const receiverCompany = '';
    const pickupAddress = normalizeOptionalText(deliveryOrderPickupStops[0]?.pickupAddress) || order.pickupAddress;
    const doDoc = {
        _id: doId,
        _type: 'deliveryOrder',
        issuerCompanyName: companyProfile?.name,
        issuerCompanyAddress: companyProfile?.address,
        issuerCompanyPhone: companyProfile?.phone,
        issuerCompanyEmail: companyProfile?.email,
        issuerCompanyLogoUrl: resolveCompanyLogoUrl(companyProfile),
        orderRef,
        masterResi: order.masterResi,
        customerRef: orderCustomerRef || undefined,
        customerName: order.customerName,
        customerDoPrefix,
        customerDoNumber,
        receiverName,
        receiverPhone,
        receiverAddress,
        receiverCompany,
        pickupAddress,
        pickupStops: deliveryOrderPickupStops.length > 0 ? deliveryOrderPickupStops : undefined,
        shipperReferences: deliveryOrderShipperReferences.length > 0 ? deliveryOrderShipperReferences : undefined,
        serviceRef: order.serviceRef,
        serviceName: order.serviceName,
        vehicleServiceRef,
        vehicleServiceName,
        vehicleCategoryOverrideReason: vehicleCategoryOverrideReasonToStore,
        vehicleRef: vehicleRef || undefined,
        vehiclePlate: vehiclePlate || undefined,
        driverRef: driverRef || undefined,
        driverName: driverName || undefined,
        tripRouteRateRef: tripRouteSelection?.tripRouteRateRef,
        tripOriginArea: tripRouteSelection?.tripOriginArea,
        tripDestinationArea: tripRouteSelection?.tripDestinationArea,
        orderTripPlanKey: selectedTripPlan?._key,
        plannedTripIssueBankRef: selectedTripPlan?.issueBankRef,
        plannedTripIssueBankName: selectedTripPlan?.issueBankName,
        plannedTripCashGiven: selectedTripPlan?.cashGiven,
        baseTaripBorongan: effectiveTripFee > 0 ? effectiveTripFee : undefined,
        taripBorongan: effectiveTripFee > 0 ? effectiveTripFee : undefined,
        overtonaseDriverRatePerKg: matchedTripRouteOvertonaseRatePerKg > 0 ? matchedTripRouteOvertonaseRatePerKg : undefined,
        date: doDate,
        notes: normalizeOptionalText(data.notes),
        doNumber,
        status: 'CREATED',
    };

    const mutationTimestamp = new Date().toISOString();
    try {
        await createDocument(doDoc);
        const postCreateMutations: Array<Promise<unknown>> = [];

        if (tripRouteSelection?.matchedTripRouteRate?._id) {
            postCreateMutations.push(
                updateDocument(tripRouteSelection.matchedTripRouteRate._id, { updatedAt: mutationTimestamp }, 'tripRouteRate')
            );
        }
        if (selectedVehicle?._id) {
            postCreateMutations.push(
                updateDocument(selectedVehicle._id, { updatedAt: mutationTimestamp }, 'vehicle')
            );
        }
        if (selectedDriver?._id) {
            postCreateMutations.push(
                updateDocument(selectedDriver._id, { updatedAt: mutationTimestamp }, 'driver')
            );
        }
        const orderUpdates: Record<string, unknown> = {};
        if (extraOrderPickupStops.length > 0) {
            const primaryCustomerPickupRef = effectiveOrderPickupStops[0]?.customerPickupRef || order.customerPickupRef;
            orderUpdates.pickupStops = effectiveOrderPickupStops;
            orderUpdates.pickupAddress = effectiveOrderPickupStops[0]?.pickupAddress || order.pickupAddress;
            if (primaryCustomerPickupRef) {
                orderUpdates.customerPickupRef = primaryCustomerPickupRef;
            }
        }
        if (selectedTripPlan?._key) {
            orderUpdates.tripPlans = (order.tripPlans || []).map(plan =>
                normalizeOptionalText(plan._key) === selectedTripPlan._key
                    ? {
                        ...plan,
                        pickupStopKeys: Array.from(selectedPickupStopKeys),
                        linkedDeliveryOrderRef: doId,
                        linkedDeliveryOrderNumber: doNumber,
                    }
                    : plan
            );
        }
        if (usingDirectCargoInput) {
            if (order.cargoEntryMode !== 'DELIVERY_ORDER') {
                orderUpdates.cargoEntryMode = 'DELIVERY_ORDER';
            }
            const seenProductRefs = new Set<string>();
            for (const item of directCargoItems) {
                if (!item.customerProductRef || seenProductRefs.has(item.customerProductRef)) {
                    continue;
                }
                postCreateMutations.push(
                    updateDocument(item.customerProductRef, { updatedAt: mutationTimestamp }, 'customerProduct')
                );
                seenProductRefs.add(item.customerProductRef);
            }
            for (const item of directCargoItems) {
                const orderItemId = crypto.randomUUID();
                const usesQtyBasis = item.qtyKoli > 0;
                const cargoItemContext = resolveDeliveryOrderCargoItemContext(item, {
                    pickupStops: deliveryOrderPickupStops,
                    shipperReferences: deliveryOrderShipperReferences,
                });
                postCreateMutations.push((async () => {
                    await createDocument({
                        ...buildOrderItemDraftDocument(orderRef, item, orderItemId, {
                            entrySource: 'DELIVERY_ORDER',
                            sourceDeliveryOrderRef: doId,
                            sourceDeliveryOrderNumber: doNumber,
                        }),
                        assignedQtyKoli: usesQtyBasis ? item.qtyKoli : 0,
                        assignedWeight: item.weight,
                        assignedVolume: item.volume || 0,
                        status: 'ASSIGNED',
                    });
                    await createDocument({
                        _id: crypto.randomUUID(),
                        _type: 'deliveryOrderItem',
                        deliveryOrderRef: doId,
                        orderItemRef: orderItemId,
                        pickupStopKey: cargoItemContext.pickupStopKey,
                        pickupAddress: cargoItemContext.pickupAddress,
                        shipperReferenceKey: cargoItemContext.shipperReferenceKey,
                        shipperReferenceNumber: cargoItemContext.shipperReferenceNumber,
                        orderItemDescription: item.description,
                        orderItemQtyKoli: usesQtyBasis ? item.qtyKoli : undefined,
                        orderItemWeight: item.weight,
                        orderItemVolumeM3: item.volume,
                        orderItemWeightInputValue: item.weightInputValue,
                        orderItemWeightInputUnit: item.weightInputUnit,
                        orderItemVolumeInputValue: item.volumeInputValue,
                        orderItemVolumeInputUnit: item.volumeInputUnit,
                        shippedQtyKoli: usesQtyBasis ? item.qtyKoli : undefined,
                        shippedWeight: item.weight,
                    });
                })());
            }
        }
        if (Object.keys(orderUpdates).length > 0) {
            postCreateMutations.push(updateDocument(orderRef, orderUpdates, 'order'));
        }
        for (const item of selectedItems) {
            const selection = selectionByItemId.get(item._id);
            if (!selection) {
                continue;
            }

                const progress = getOrderItemProgress(item);
                const usesQtyBasis = progress.totalQtyKoli > 0;
                const shippedQtyKoli = usesQtyBasis ? roundQuantity(selection.qtyKoli) : 0;
                const selectedWeightInputValue = normalizeNumber(selection.weightInputValue ?? 0, {
                    maxFractionDigits: getWeightInputFractionDigits(selection.weightInputUnit),
                });
                const selectedVolumeInputValue = normalizeNumber(selection.volumeInputValue ?? 0, {
                    maxFractionDigits: selection.volumeInputUnit === 'LITER' ? 0 : 3,
                });
                const shippedWeight = usesQtyBasis
                    ? calculateWeightPortion(progress.totalWeight, progress.totalQtyKoli, shippedQtyKoli)
                    : (selectedWeightInputValue > 0 && selection.weightInputUnit
                        ? roundQuantity(convertWeightToKg(selectedWeightInputValue, selection.weightInputUnit))
                        : 0);
                const shippedVolumeM3 = usesQtyBasis
                    ? calculateVolumePortion(normalizeNumber(item.volume ?? 0), progress.totalQtyKoli, shippedQtyKoli)
                    : (selectedVolumeInputValue > 0 && selection.volumeInputUnit
                        ? roundQuantity(convertVolumeToM3(selectedVolumeInputValue, selection.volumeInputUnit), 3)
                        : 0);
                const shippedWeightInputValue =
                    usesQtyBasis && item.weightInputValue && item.weightInputUnit
                        ? roundQuantity(convertKgToWeightInputValue(shippedWeight, item.weightInputUnit), getWeightInputFractionDigits(item.weightInputUnit))
                        : !usesQtyBasis && selection.weightInputValue && selection.weightInputUnit
                            ? roundQuantity(selection.weightInputValue, getWeightInputFractionDigits(selection.weightInputUnit))
                            : undefined;
                const shippedWeightInputUnit =
                    shippedWeightInputValue !== undefined
                        ? (usesQtyBasis ? item.weightInputUnit : selection.weightInputUnit)
                        : undefined;
                const shippedVolumeInputValue =
                    usesQtyBasis && item.volumeInputValue && item.volumeInputUnit
                        ? roundQuantity(convertM3ToVolumeInputValue(shippedVolumeM3, item.volumeInputUnit), item.volumeInputUnit === 'LITER' ? 0 : 3)
                        : !usesQtyBasis && selection.volumeInputValue && selection.volumeInputUnit
                            ? roundQuantity(selection.volumeInputValue, selection.volumeInputUnit === 'LITER' ? 0 : 3)
                            : undefined;
                const shippedVolumeInputUnit =
                    shippedVolumeInputValue !== undefined
                        ? (usesQtyBasis ? item.volumeInputUnit : selection.volumeInputUnit)
                        : undefined;
                const pendingQtyUsed = roundQuantity(shippedQtyKoli);
                const pendingWeightUsed = roundQuantity(shippedWeight);
                const pendingVolumeUsed = roundQuantity(shippedVolumeM3, 3);
                const remainingQtyAfterShipment = roundQuantity(Math.max(progress.pendingQtyKoli - pendingQtyUsed, 0));
                const remainingWeightAfterShipment = roundQuantity(Math.max(progress.pendingWeight - pendingWeightUsed, 0));
                const remainingVolumeAfterShipment = roundQuantity(Math.max(progress.pendingVolume - pendingVolumeUsed, 0), 3);
                const holdQtyToApply = selection.holdRemaining ? (usesQtyBasis ? remainingQtyAfterShipment : 0) : 0;
                const holdWeightToApply = selection.holdRemaining ? remainingWeightAfterShipment : 0;
                const holdVolumeToApply = selection.holdRemaining ? remainingVolumeAfterShipment : 0;
                const nextProgress = {
                    ...progress,
                    assignedQtyKoli: roundQuantity(progress.assignedQtyKoli + shippedQtyKoli),
                    assignedWeight: roundQuantity(progress.assignedWeight + shippedWeight),
                    assignedVolume: roundQuantity(progress.assignedVolume + shippedVolumeM3, 3),
                    heldQtyKoli: roundQuantity(progress.heldQtyKoli + holdQtyToApply),
                    heldWeight: roundQuantity(progress.heldWeight + holdWeightToApply),
                    heldVolume: roundQuantity(progress.heldVolume + holdVolumeToApply, 3),
                    pendingQtyKoli: roundQuantity(Math.max(progress.pendingQtyKoli - pendingQtyUsed - holdQtyToApply, 0)),
                    pendingWeight: roundQuantity(Math.max(progress.pendingWeight - pendingWeightUsed - holdWeightToApply, 0)),
                    pendingVolume: roundQuantity(Math.max(progress.pendingVolume - pendingVolumeUsed - holdVolumeToApply, 0), 3),
                };

                postCreateMutations.push((async () => {
                    await createDocument({
                        _id: crypto.randomUUID(),
                        _type: 'deliveryOrderItem',
                        deliveryOrderRef: doId,
                        orderItemRef: item._id,
                        orderItemDescription: item.description,
                        orderItemQtyKoli: usesQtyBasis ? shippedQtyKoli : undefined,
                        orderItemWeight: shippedWeight,
                        orderItemVolumeM3: shippedVolumeM3 > 0 ? shippedVolumeM3 : undefined,
                        orderItemWeightInputValue: shippedWeightInputValue,
                        orderItemWeightInputUnit: shippedWeightInputUnit,
                        orderItemVolumeInputValue: shippedVolumeInputValue,
                        orderItemVolumeInputUnit: shippedVolumeInputUnit,
                        shippedQtyKoli: usesQtyBasis ? shippedQtyKoli : undefined,
                        shippedWeight,
                    });
                    await updateDocument(item._id, {
                        assignedQtyKoli: nextProgress.assignedQtyKoli,
                        assignedWeight: nextProgress.assignedWeight,
                        assignedVolume: nextProgress.assignedVolume,
                        heldQtyKoli: nextProgress.heldQtyKoli,
                        heldWeight: nextProgress.heldWeight,
                        heldVolume: nextProgress.heldVolume,
                        holdReason: selection.holdRemaining ? selection.holdReason : item.holdReason,
                        holdLocation: selection.holdRemaining ? selection.holdLocation : item.holdLocation,
                        status: deriveOrderItemStatusFromProgress(nextProgress),
                    });
                })());
        }

        if (postCreateMutations.length > 0) {
            await Promise.all(postCreateMutations);
        }
    } catch (error) {
        if (isMutationConflictError(error)) {
            return NextResponse.json(
                { error: 'Data order, barang customer, master biaya rute trip, kendaraan, supir, atau item surat jalan berubah karena ada update lain. Refresh lalu coba lagi.' },
                { status: 409 }
            );
        }
        throw error;
    }
    await syncOrderStatusFromItems(orderRef, session, addAuditLog);
    await addAuditLog(
        session,
        'CREATE',
        'delivery-orders',
        doId,
        `Created delivery-orders: ${doNumber}${customerDoNumber ? ` / ${customerDoNumber}` : ''} (${selectionSummaries.join('; ')})${vehicleCategoryOverrideReasonToStore ? ` | override armada: ${order.serviceName || '-'} -> ${vehicleServiceName || vehiclePlate || '-'} | alasan: ${vehicleCategoryOverrideReasonToStore}` : ''}`
    );
    return NextResponse.json({ data: doDoc, id: doId });
}

function normalizeOrderPickupStopsInput(rawStops: unknown[], fallbackAddress?: string): OrderPickupStop[] {
    const stops = rawStops
        .filter(isPlainObject)
        .map((stop, index) => ({
            _key: normalizeOptionalText(stop._key) || normalizeOptionalText(stop.id) || crypto.randomUUID(),
            sequence: index + 1,
            customerPickupRef: normalizeOptionalText(stop.customerPickupRef),
            pickupLabel: normalizeOptionalText(stop.pickupLabel),
            pickupAddress: normalizeText(stop.pickupAddress),
            notes: normalizeOptionalText(stop.notes),
        }))
        .filter(stop => stop.pickupAddress);

    if (stops.length > 0) {
        return stops;
    }

    const fallback = normalizeOptionalText(fallbackAddress);
    return fallback
        ? [{
            _key: crypto.randomUUID(),
            sequence: 1,
            pickupAddress: fallback,
        }]
        : [];
}

async function normalizeOrderTripPlansInput(
    rawPlans: unknown[],
    pickupStops: OrderPickupStop[],
    serviceRef?: string
): Promise<OrderTripPlan[]> {
    const plans: OrderTripPlan[] = [];
    const validPickupStopKeys = new Set(pickupStops.map(stop => stop._key).filter((key): key is string => Boolean(key)));

    for (const [index, rawPlan] of rawPlans.filter(isPlainObject).entries()) {
        const vehicleRef = normalizeText(rawPlan.vehicleRef);
        const driverRef = normalizeText(rawPlan.driverRef);
        const issueBankRef = normalizeText(rawPlan.issueBankRef);
        const cashGiven = normalizeCurrencyNumber(rawPlan.cashGiven ?? 0);
        const requestedTaripBorongan = normalizeCurrencyNumber(rawPlan.taripBorongan ?? rawPlan.tripFee ?? 0);
        const date = normalizeOptionalText(rawPlan.date) || getBusinessDateValue();
        const pickupStopKeys = Array.isArray(rawPlan.pickupStopKeys)
            ? rawPlan.pickupStopKeys
                .filter((value): value is string => typeof value === 'string' && validPickupStopKeys.has(value))
            : [];

        if (pickupStopKeys.length === 0) {
            throw new Error(`Minimal 1 titik pickup wajib dipilih pada trip ${index + 1}`);
        }
        if (!vehicleRef) {
            throw new Error(`Kendaraan wajib dipilih pada trip ${index + 1}`);
        }
        if (!driverRef) {
            throw new Error(`Supir wajib dipilih pada trip ${index + 1}`);
        }
        if (!issueBankRef) {
            throw new Error(`Rekening atau kas sumber wajib dipilih pada trip ${index + 1}`);
        }
        if (!Number.isFinite(cashGiven) || cashGiven <= 0) {
            throw new Error(`Nominal uang jalan awal wajib diisi pada trip ${index + 1}`);
        }
        if (!Number.isFinite(requestedTaripBorongan) || requestedTaripBorongan < 0) {
            throw new Error(`Upah trip pada trip ${index + 1} tidak valid`);
        }
        assertIsoDate(date, `Tanggal trip ${index + 1}`);

        const [vehicle, driver, issueBank] = await Promise.all([
            getDocumentById<{
                _id: string;
                plateNumber?: string;
                status?: string;
                serviceRef?: string;
                serviceName?: string;
            }>(vehicleRef, 'vehicle'),
            getDocumentById<{ _id: string; name?: string; active?: boolean }>(driverRef, 'driver'),
            getDocumentById<{ _id: string; bankName?: string; accountNumber?: string; active?: boolean }>(issueBankRef, 'bankAccount'),
        ]);

        if (!vehicle) {
            throw new Error(`Kendaraan pada trip ${index + 1} tidak ditemukan`);
        }
        if (vehicle.status === 'SOLD' || vehicle.status === 'OUT_OF_SERVICE') {
            throw new Error(`Kendaraan pada trip ${index + 1} tidak bisa dipakai`);
        }
        if (!driver) {
            throw new Error(`Supir pada trip ${index + 1} tidak ditemukan`);
        }
        if (driver.active === false) {
            throw new Error(`Supir pada trip ${index + 1} tidak aktif`);
        }
        if (!issueBank) {
            throw new Error(`Rekening atau kas sumber pada trip ${index + 1} tidak ditemukan`);
        }
        if (issueBank.active === false) {
            throw new Error(`Rekening atau kas sumber pada trip ${index + 1} tidak aktif`);
        }

        const vehicleServiceRef = extractRefId(vehicle.serviceRef) || undefined;
        const vehicleCategoryOverrideReason = normalizeOptionalText(rawPlan.vehicleCategoryOverrideReason);
        if (serviceRef && vehicleServiceRef !== serviceRef && !vehicleCategoryOverrideReason) {
            throw new Error(`Alasan override armada wajib diisi pada trip ${index + 1}`);
        }
        const effectiveRouteServiceRef = serviceRef || vehicleServiceRef;
        let tripRouteSelection: Awaited<ReturnType<typeof resolveTripRouteRateSelection>>;
        try {
            tripRouteSelection = await resolveTripRouteRateSelection(rawPlan, {
                serviceRef: effectiveRouteServiceRef,
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Master biaya rute trip tidak valid';
            throw new Error(`${message} pada trip ${index + 1}`);
        }
        const matchedTripRouteRateFee = normalizeCurrencyNumber(tripRouteSelection.matchedTripRouteRate?.rate ?? 0);
        if (
            matchedTripRouteRateFee > 0 &&
            requestedTaripBorongan > 0 &&
            Math.abs(requestedTaripBorongan - matchedTripRouteRateFee) > 0.01
        ) {
            throw new Error(`Upah trip pada trip ${index + 1} mengikuti master biaya rute trip yang dipilih`);
        }
        const taripBorongan = matchedTripRouteRateFee > 0 ? matchedTripRouteRateFee : requestedTaripBorongan;
        if (!Number.isFinite(taripBorongan) || taripBorongan <= 0) {
            throw new Error(`Upah trip wajib diisi pada trip ${index + 1}`);
        }

        plans.push({
            _key: normalizeOptionalText(rawPlan._key) || crypto.randomUUID(),
            sequence: index + 1,
            pickupStopKeys,
            vehicleRef,
            vehiclePlate: vehicle.plateNumber,
            vehicleServiceRef,
            vehicleServiceName: vehicle.serviceName,
            vehicleCategoryOverrideReason,
            driverRef,
            driverName: driver.name,
            tripRouteRateRef: tripRouteSelection.tripRouteRateRef,
            tripOriginArea: tripRouteSelection.tripOriginArea,
            tripDestinationArea: tripRouteSelection.tripDestinationArea,
            taripBorongan,
            issueBankRef,
            issueBankName: [issueBank.bankName, issueBank.accountNumber].filter(Boolean).join(' - ') || issueBank.bankName,
            cashGiven,
            date,
            notes: normalizeOptionalText(rawPlan.notes),
        });
    }

    return plans;
}

export async function handleDeliveryOrderAppendCargoItems(
    session: ApiSession,
    data: Record<string, unknown>,
    addAuditLog: AuditLogFn
) {
    const id = typeof data.id === 'string' ? data.id : '';
    if (!id) {
        return NextResponse.json({ error: 'Surat jalan tidak valid' }, { status: 400 });
    }

    const deliveryOrder = await getDocumentById<{
        _id: string;
        doNumber?: string;
        status?: string;
        pendingDriverStatus?: string;
        tripClosedByAdminAt?: string;
        orderRef?: unknown;
        customerRef?: unknown;
        customerDoNumber?: string;
        pickupStops?: Array<{
            _key?: string;
            pickupAddress?: string;
        }>;
        shipperReferences?: Array<{
            _key?: string;
            sequence?: number;
            referenceNumber?: string;
            pickupStopKey?: string;
            pickupAddress?: string;
            billingCustomerRef?: string;
            billingCustomerName?: string;
            receiverName?: string;
            receiverPhone?: string;
            receiverAddress?: string;
            receiverCompany?: string;
            notes?: string;
        }>;
    }>(id, 'deliveryOrder');
    if (!deliveryOrder) {
        return NextResponse.json({ error: 'Surat jalan tidak ditemukan' }, { status: 404 });
    }
    if (!['CREATED', 'HEADING_TO_PICKUP', 'ON_DELIVERY', 'ARRIVED', 'DELIVERED', 'PARTIAL_HOLD'].includes(deliveryOrder.status || '')) {
        return NextResponse.json(
            { error: 'Muatan hanya bisa ditambahkan saat surat jalan masih aktif sebelum trip selesai atau dibatalkan.' },
            { status: 409 }
        );
    }
    if (deliveryOrder.tripClosedByAdminAt) {
        return NextResponse.json(
            { error: 'Trip ini sudah ditutup admin. Buka kembali trip jika masih ingin menambah SJ atau barang.' },
            { status: 409 }
        );
    }
    if (deliveryOrder.pendingDriverStatus) {
        return NextResponse.json(
            { error: `DO ${deliveryOrder.doNumber || id} sedang menunggu approval ${deliveryOrder.pendingDriverStatus}. Review dulu sebelum muatan diubah.` },
            { status: 409 }
        );
    }

    const orderRef = extractRefId(deliveryOrder.orderRef);
    if (!orderRef) {
        return NextResponse.json({ error: 'Order sumber surat jalan tidak ditemukan' }, { status: 409 });
    }
    const order = await getDocumentById<{
        _id: string;
        cargoEntryMode?: 'ORDER' | 'DELIVERY_ORDER';
        customerRef?: unknown;
    }>(orderRef, 'order');
    if (!order) {
        return NextResponse.json({ error: 'Order sumber surat jalan tidak ditemukan' }, { status: 404 });
    }

    let directCargoItems: NormalizedOrderItemInput[] = [];
    try {
        directCargoItems = await normalizeOrderItemsInput(
            extractRefId(order.customerRef) || extractRefId(deliveryOrder.customerRef) || '',
            Array.isArray(data.cargoItems) ? data.cargoItems : [],
            { allowEmpty: true }
        );
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Barang surat jalan tidak valid' },
            { status: 400 }
        );
    }

    let nextShipperReferences:
        | Array<{
            _key: string;
            sequence: number;
            referenceNumber: string;
            pickupStopKey?: string;
            pickupAddress?: string;
            billingCustomerRef?: string;
            billingCustomerName?: string;
            receiverName?: string;
            receiverPhone?: string;
            receiverAddress?: string;
            receiverCompany?: string;
            notes?: string;
        }>
        | undefined;
    try {
        nextShipperReferences = normalizeDeliveryOrderShipperReferencesForUpdate(
            deliveryOrder,
            data.shipperReferences
        );
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Daftar SJ pengirim tidak valid' },
            { status: 400 }
        );
    }

    const nextCustomerDoNumber = normalizeOptionalText(data.customerDoNumber);
    const nextPrimaryShipperReferenceNumber =
        nextShipperReferences && nextShipperReferences.length > 0
            ? nextShipperReferences[0]?.referenceNumber
            : undefined;
    const resolvedCustomerDoNumber = (nextCustomerDoNumber || nextPrimaryShipperReferenceNumber)?.toUpperCase();
    const shipperReferencesChanged = nextShipperReferences
        ? !areDeliveryOrderShipperReferencesEquivalent(deliveryOrder.shipperReferences, nextShipperReferences)
        : false;
    const customerDoNumberChanged =
        Boolean(resolvedCustomerDoNumber) &&
        normalizeOptionalText(deliveryOrder.customerDoNumber)?.toUpperCase() !== resolvedCustomerDoNumber;

    if (directCargoItems.length === 0 && !shipperReferencesChanged && !customerDoNumberChanged) {
        return NextResponse.json({
            data: {
                _id: id,
                appendedCount: 0,
                shipperReferenceCount: deliveryOrder.shipperReferences?.length || 0,
            },
        });
    }

    const mutationTimestamp = new Date().toISOString();
    try {
        if (directCargoItems.length > 0 && order.cargoEntryMode !== 'DELIVERY_ORDER') {
            await updateDocument(orderRef, { cargoEntryMode: 'DELIVERY_ORDER' }, 'order');
        }
        for (const item of directCargoItems) {
            if (item.customerProductRef) {
                await updateDocument(item.customerProductRef, { updatedAt: mutationTimestamp }, 'customerProduct');
            }
            const orderItemId = crypto.randomUUID();
            const usesQtyBasis = item.qtyKoli > 0;
            const effectiveDeliveryOrderForContext = {
                pickupStops: deliveryOrder.pickupStops,
                shipperReferences: nextShipperReferences || deliveryOrder.shipperReferences,
            };
            const cargoItemContext = resolveDeliveryOrderCargoItemContext(item, effectiveDeliveryOrderForContext);
            await createDocument({
                ...buildOrderItemDraftDocument(orderRef, item, orderItemId, {
                    entrySource: 'DELIVERY_ORDER',
                    sourceDeliveryOrderRef: id,
                    sourceDeliveryOrderNumber: deliveryOrder.doNumber,
                }),
                assignedQtyKoli: usesQtyBasis ? item.qtyKoli : 0,
                assignedWeight: item.weight,
                assignedVolume: item.volume || 0,
                status: 'ASSIGNED',
            });
            await createDocument({
                _id: crypto.randomUUID(),
                _type: 'deliveryOrderItem',
                deliveryOrderRef: id,
                orderItemRef: orderItemId,
                pickupStopKey: cargoItemContext.pickupStopKey,
                pickupAddress: cargoItemContext.pickupAddress,
                shipperReferenceKey: cargoItemContext.shipperReferenceKey,
                shipperReferenceNumber: cargoItemContext.shipperReferenceNumber,
                orderItemDescription: item.description,
                orderItemQtyKoli: usesQtyBasis ? item.qtyKoli : undefined,
                orderItemWeight: item.weight,
                orderItemVolumeM3: item.volume,
                orderItemWeightInputValue: item.weightInputValue,
                orderItemWeightInputUnit: item.weightInputUnit,
                orderItemVolumeInputValue: item.volumeInputValue,
                orderItemVolumeInputUnit: item.volumeInputUnit,
                shippedQtyKoli: usesQtyBasis ? item.qtyKoli : undefined,
                shippedWeight: item.weight,
            });
        }
        if (shipperReferencesChanged || customerDoNumberChanged) {
            await updateDocument(id, {
                shipperReferences: nextShipperReferences,
                customerDoNumber: resolvedCustomerDoNumber,
                ...((deliveryOrder.status === 'DELIVERED' || deliveryOrder.status === 'PARTIAL_HOLD')
                    ? { status: 'ARRIVED' }
                    : {}),
            }, 'deliveryOrder');
        }
        if (directCargoItems.length > 0 && (deliveryOrder.status === 'DELIVERED' || deliveryOrder.status === 'PARTIAL_HOLD')) {
            await updateDocument(id, { status: 'ARRIVED' }, 'deliveryOrder');
            const tripRecord = await getDocumentById<{ _id: string }>(id, 'trip');
            if (tripRecord) {
                await updateDocument(id, { status: 'ARRIVED' }, 'trip');
            }
        }
    } catch (error) {
        if (isMutationConflictError(error)) {
            return NextResponse.json(
                { error: 'Data order atau surat jalan berubah karena ada update lain. Refresh lalu coba lagi.' },
                { status: 409 }
            );
        }
        throw error;
    }

    await syncOrderStatusFromItems(orderRef, session, addAuditLog);
    await addAuditLog(
        session,
        'UPDATE',
        'delivery-orders',
        id,
        `Update Surat Jalan ${deliveryOrder.doNumber || id}: ${directCargoItems.length} barang ditambah, ${nextShipperReferences?.length || deliveryOrder.shipperReferences?.length || 0} SJ aktif`
    );

    return NextResponse.json({
        data: {
            _id: id,
            appendedCount: directCargoItems.length,
            shipperReferenceCount: nextShipperReferences?.length || deliveryOrder.shipperReferences?.length || 0,
        },
    });
}

export async function handleDeliveryOrderTripClosureSet(
    session: ApiSession,
    data: Record<string, unknown>,
    addAuditLog: AuditLogFn
) {
    const id = typeof data.id === 'string' ? data.id : '';
    const closed = data.closed === true;
    if (!id) {
        return NextResponse.json({ error: 'Trip tidak valid' }, { status: 400 });
    }

    const deliveryOrder = await getDocumentById<DeliveryOrder>(id, 'deliveryOrder');
    if (!deliveryOrder) {
        return NextResponse.json({ error: 'Trip tidak ditemukan' }, { status: 404 });
    }

    const timestamp = new Date().toISOString();
    try {
        await updateDocument(id, {
            tripClosedByAdminAt: closed ? timestamp : null,
            tripClosedByAdminRef: closed ? session._id : null,
            tripClosedByAdminName: closed ? session.name : null,
        }, 'deliveryOrder');

        const tripRecord = await getDocumentById<{ _id: string }>(id, 'trip');
        if (tripRecord) {
            await updateDocument(id, {
                tripClosedByAdminAt: closed ? timestamp : null,
                tripClosedByAdminRef: closed ? session._id : null,
                tripClosedByAdminName: closed ? session.name : null,
            }, 'trip');
        }
    } catch (error) {
        if (isMutationConflictError(error)) {
            return NextResponse.json(
                { error: 'Trip berubah karena ada update lain. Refresh lalu coba lagi.' },
                { status: 409 }
            );
        }
        throw error;
    }

    await addAuditLog(
        session,
        'UPDATE',
        'delivery-orders',
        id,
        closed
            ? `Tutup trip ${deliveryOrder.doNumber || id} dengan konfirmasi admin`
            : `Buka kembali trip ${deliveryOrder.doNumber || id}`
    );

    const updatedDeliveryOrder = await getDocumentById(id, 'deliveryOrder');
    return NextResponse.json({ data: updatedDeliveryOrder || deliveryOrder, id });
}

export async function handleDeliveryOrderCargoItemRemove(
    session: ApiSession,
    data: Record<string, unknown>,
    addAuditLog: AuditLogFn
) {
    const id = typeof data.id === 'string' ? data.id : '';
    const deliveryOrderItemId = typeof data.deliveryOrderItemId === 'string' ? data.deliveryOrderItemId : '';
    if (!id || !deliveryOrderItemId) {
        return NextResponse.json({ error: 'Item surat jalan tidak valid' }, { status: 400 });
    }

    const deliveryOrder = await getDocumentById<{
        _id: string;
        doNumber?: string;
        status?: string;
        pendingDriverStatus?: string;
        tripClosedByAdminAt?: string;
        orderRef?: unknown;
    }>(id, 'deliveryOrder');
    if (!deliveryOrder) {
        return NextResponse.json({ error: 'Surat jalan tidak ditemukan' }, { status: 404 });
    }
    if (!['CREATED', 'HEADING_TO_PICKUP', 'ON_DELIVERY', 'ARRIVED', 'DELIVERED', 'PARTIAL_HOLD'].includes(deliveryOrder.status || '')) {
        return NextResponse.json({ error: 'Barang tidak bisa dihapus pada status surat jalan saat ini' }, { status: 409 });
    }
    if (deliveryOrder.pendingDriverStatus) {
        return NextResponse.json({ error: 'Barang tidak bisa diubah saat menunggu approval driver' }, { status: 409 });
    }
    if (deliveryOrder.tripClosedByAdminAt) {
        return NextResponse.json({ error: 'Trip ini sudah ditutup admin sehingga barang SJ tidak bisa diubah lagi.' }, { status: 409 });
    }

    const deliveryOrderItem = await getDocumentById<{
        _id: string;
        deliveryOrderRef?: unknown;
        orderItemRef?: unknown;
        orderItemDescription?: string;
        shipperReferenceKey?: string;
        shipperReferenceNumber?: string;
    }>(deliveryOrderItemId, 'deliveryOrderItem');
    if (!deliveryOrderItem || extractRefId(deliveryOrderItem.deliveryOrderRef) !== id) {
        return NextResponse.json({ error: 'Item surat jalan tidak ditemukan' }, { status: 404 });
    }
    const orderItemRef = extractRefId(deliveryOrderItem.orderItemRef);
    if (!orderItemRef) {
        return NextResponse.json({ error: 'Item order sumber tidak ditemukan' }, { status: 409 });
    }

    const orderItem = await getDocumentById<{
        _id: string;
        orderRef?: unknown;
        entrySource?: 'ORDER' | 'DELIVERY_ORDER';
        sourceDeliveryOrderRef?: unknown;
    }>(orderItemRef, 'orderItem');
    if (!orderItem) {
        return NextResponse.json({ error: 'Item order sumber tidak ditemukan' }, { status: 404 });
    }
    if (orderItem.entrySource !== 'DELIVERY_ORDER' || extractRefId(orderItem.sourceDeliveryOrderRef) !== id) {
        return NextResponse.json(
            { error: 'Item ini berasal dari target order/resi utama. Koreksi assignment-nya harus dari flow order.' },
            { status: 409 }
        );
    }

    try {
        await deleteDocument(deliveryOrderItemId, 'deliveryOrderItem');
        await deleteDocument(orderItemRef, 'orderItem');
    } catch (error) {
        if (isMutationConflictError(error)) {
            return NextResponse.json(
                { error: 'Barang surat jalan berubah karena ada update lain. Refresh lalu coba lagi.' },
                { status: 409 }
            );
        }
        throw error;
    }

    const orderRef = extractRefId(deliveryOrder.orderRef) || extractRefId(orderItem.orderRef);
    if (orderRef) {
        await syncOrderStatusFromItems(orderRef, session, addAuditLog);
    }
    await addAuditLog(
        session,
        'UPDATE',
        'delivery-orders',
        id,
        `Hapus barang dari Surat Jalan ${deliveryOrder.doNumber || id}: ${deliveryOrderItem.orderItemDescription || deliveryOrderItemId}`
    );

    return NextResponse.json({
        data: {
            _id: id,
            removedDeliveryOrderItemId: deliveryOrderItemId,
            removedOrderItemId: orderItemRef,
        },
    });
}

export async function handleDeliveryOrderCargoItemUpdate(
    session: ApiSession,
    data: Record<string, unknown>,
    addAuditLog: AuditLogFn
) {
    const id = typeof data.id === 'string' ? data.id : '';
    const deliveryOrderItemId = typeof data.deliveryOrderItemId === 'string' ? data.deliveryOrderItemId : '';
    const cargoItemPayload = isPlainObject(data.cargoItem) ? data.cargoItem : null;
    if (!id || !deliveryOrderItemId || !cargoItemPayload) {
        return NextResponse.json({ error: 'Barang surat jalan tidak valid' }, { status: 400 });
    }

    const deliveryOrder = await getDocumentById<{
        _id: string;
        doNumber?: string;
        status?: string;
        pendingDriverStatus?: string;
        tripClosedByAdminAt?: string;
        orderRef?: unknown;
        customerRef?: unknown;
        pickupStops?: Array<{
            _key?: string;
            orderPickupStopKey?: string;
            pickupAddress?: string;
        }>;
        shipperReferences?: Array<{
            _key?: string;
            referenceNumber?: string;
            pickupStopKey?: string;
            pickupAddress?: string;
        }>;
    }>(id, 'deliveryOrder');
    if (!deliveryOrder) {
        return NextResponse.json({ error: 'Surat jalan tidak ditemukan' }, { status: 404 });
    }
    if (!['CREATED', 'HEADING_TO_PICKUP', 'ON_DELIVERY', 'ARRIVED', 'DELIVERED', 'PARTIAL_HOLD'].includes(deliveryOrder.status || '')) {
        return NextResponse.json({ error: 'Barang tidak bisa diubah pada status surat jalan saat ini' }, { status: 409 });
    }
    if (deliveryOrder.pendingDriverStatus) {
        return NextResponse.json({ error: 'Barang tidak bisa diubah saat menunggu approval driver' }, { status: 409 });
    }
    if (deliveryOrder.tripClosedByAdminAt) {
        return NextResponse.json({ error: 'Trip ini sudah ditutup admin sehingga barang SJ tidak bisa diubah lagi.' }, { status: 409 });
    }

    const deliveryOrderItem = await getDocumentById<{
        _id: string;
        deliveryOrderRef?: unknown;
        orderItemRef?: unknown;
        shipperReferenceKey?: string;
        shipperReferenceNumber?: string;
    }>(deliveryOrderItemId, 'deliveryOrderItem');
    if (!deliveryOrderItem || extractRefId(deliveryOrderItem.deliveryOrderRef) !== id) {
        return NextResponse.json({ error: 'Item surat jalan tidak ditemukan' }, { status: 404 });
    }
    const orderItemRef = extractRefId(deliveryOrderItem.orderItemRef);
    if (!orderItemRef) {
        return NextResponse.json({ error: 'Item order sumber tidak ditemukan' }, { status: 409 });
    }
    const orderItem = await getDocumentById<{
        _id: string;
        orderRef?: unknown;
        entrySource?: 'ORDER' | 'DELIVERY_ORDER';
        sourceDeliveryOrderRef?: unknown;
    }>(orderItemRef, 'orderItem');
    if (!orderItem) {
        return NextResponse.json({ error: 'Item order sumber tidak ditemukan' }, { status: 404 });
    }
    if (orderItem.entrySource !== 'DELIVERY_ORDER' || extractRefId(orderItem.sourceDeliveryOrderRef) !== id) {
        return NextResponse.json(
            { error: 'Item ini berasal dari target order/resi utama. Koreksi assignment-nya harus dari flow order.' },
            { status: 409 }
        );
    }

    let normalizedItem: NormalizedOrderItemInput;
    try {
        const normalized = await normalizeOrderItemsInput(
            extractRefId(deliveryOrder.customerRef) || '',
            [cargoItemPayload],
            { allowEmpty: false }
        );
        normalizedItem = normalized[0];
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Barang surat jalan tidak valid' },
            { status: 400 }
        );
    }

    const usesQtyBasis = normalizedItem.qtyKoli > 0;
    const shouldUpdateCargoItemContext = Boolean(normalizedItem.pickupStopKey || normalizedItem.shipperReferenceNumber);
    const cargoItemContext = shouldUpdateCargoItemContext
        ? resolveDeliveryOrderCargoItemContext(normalizedItem, deliveryOrder)
        : null;
    try {
        if (normalizedItem.customerProductRef) {
            await updateDocument(normalizedItem.customerProductRef, { updatedAt: new Date().toISOString() }, 'customerProduct');
        }
        await updateDocument(orderItemRef, {
            customerProductRef: normalizedItem.customerProductRef,
            customerProductCode: normalizedItem.customerProductCode,
            customerProductName: normalizedItem.customerProductName,
            description: normalizedItem.description,
            qtyKoli: normalizedItem.qtyKoli,
            weight: normalizedItem.weight,
            volume: normalizedItem.volume,
            weightInputValue: normalizedItem.weightInputValue,
            weightInputUnit: normalizedItem.weightInputUnit,
            volumeInputValue: normalizedItem.volumeInputValue,
            volumeInputUnit: normalizedItem.volumeInputUnit,
            value: normalizedItem.value,
            assignedQtyKoli: usesQtyBasis ? normalizedItem.qtyKoli : 0,
            assignedWeight: normalizedItem.weight,
            assignedVolume: normalizedItem.volume || 0,
        }, 'orderItem');
        await updateDocument(deliveryOrderItemId, {
            orderItemDescription: normalizedItem.description,
            orderItemQtyKoli: usesQtyBasis ? normalizedItem.qtyKoli : undefined,
            orderItemWeight: normalizedItem.weight,
            orderItemVolumeM3: normalizedItem.volume,
            orderItemWeightInputValue: normalizedItem.weightInputValue,
            orderItemWeightInputUnit: normalizedItem.weightInputUnit,
            orderItemVolumeInputValue: normalizedItem.volumeInputValue,
            orderItemVolumeInputUnit: normalizedItem.volumeInputUnit,
            shippedQtyKoli: usesQtyBasis ? normalizedItem.qtyKoli : undefined,
            shippedWeight: normalizedItem.weight,
            ...(cargoItemContext
                ? {
                    pickupStopKey: cargoItemContext.pickupStopKey,
                    pickupAddress: cargoItemContext.pickupAddress,
                    shipperReferenceKey: cargoItemContext.shipperReferenceKey,
                    shipperReferenceNumber: cargoItemContext.shipperReferenceNumber,
                }
                : {}),
        }, 'deliveryOrderItem');
    } catch (error) {
        if (isMutationConflictError(error)) {
            return NextResponse.json(
                { error: 'Barang surat jalan berubah karena ada update lain. Refresh lalu coba lagi.' },
                { status: 409 }
            );
        }
        throw error;
    }

    const orderRef = extractRefId(deliveryOrder.orderRef) || extractRefId(orderItem.orderRef);
    if (orderRef) {
        await syncOrderStatusFromItems(orderRef, session, addAuditLog);
    }
    await addAuditLog(
        session,
        'UPDATE',
        'delivery-orders',
        id,
        `Ubah barang Surat Jalan ${deliveryOrder.doNumber || id}`
    );

    return NextResponse.json({
        data: {
            _id: id,
            deliveryOrderItemId,
            orderItemRef,
        },
    });
}

export async function handleDeliveryOrderTripResourceAssign(
    session: ApiSession,
    data: Record<string, unknown>,
    addAuditLog: AuditLogFn
) {
    const id = typeof data.id === 'string' ? data.id : '';
    const vehicleRef = typeof data.vehicleRef === 'string' ? data.vehicleRef : '';
    const driverRef = typeof data.driverRef === 'string' ? data.driverRef : '';
    const vehicleCategoryOverrideReason = normalizeOptionalText(data.vehicleCategoryOverrideReason);

    if (!id) {
        return NextResponse.json({ error: 'Surat jalan tidak valid' }, { status: 400 });
    }
    if (!vehicleRef && !driverRef) {
        return NextResponse.json({ error: 'Pilih kendaraan dan/atau supir yang akan dilengkapi' }, { status: 400 });
    }

    const deliveryOrder = await getDocumentById<{
        _id: string;
        _rev?: string;
        doNumber?: string;
        customerDoNumber?: string;
        status?: string;
        trackingState?: string;
        serviceRef?: unknown;
        serviceName?: string;
        vehicleRef?: unknown;
        vehiclePlate?: string;
        vehicleServiceRef?: unknown;
        vehicleServiceName?: string;
        vehicleCategoryOverrideReason?: string;
        driverRef?: unknown;
        driverName?: string;
    }>(id, 'deliveryOrder');
    if (!deliveryOrder) {
        return NextResponse.json({ error: 'Surat jalan tidak ditemukan' }, { status: 404 });
    }
    if (deliveryOrder.status !== 'CREATED') {
        return NextResponse.json({ error: 'Armada trip hanya bisa dilengkapi saat status surat jalan masih Dibuat' }, { status: 409 });
    }
    if (deliveryOrder.trackingState === 'ACTIVE' || deliveryOrder.trackingState === 'PAUSED') {
        return NextResponse.json({ error: 'Armada trip tidak bisa diubah saat tracking driver masih aktif' }, { status: 409 });
    }

    const relatedVoucher = (await listDocumentsByFilter<{ _id: string; bonNumber?: string }>('driverVoucher', {
        deliveryOrderRef: id,
    }))[0] || null;
    if (relatedVoucher) {
        return NextResponse.json(
            { error: `Armada trip tidak boleh diubah karena DO ini sudah punya uang jalan ${relatedVoucher.bonNumber || relatedVoucher._id}` },
            { status: 409 }
        );
    }

    const relatedBoronganItem = (await listDocumentsByFilter<{ _id: string }>('driverBoronganItem', {
        doRef: id,
    }))[0] || null;
    if (relatedBoronganItem) {
        return NextResponse.json(
            { error: 'Armada trip tidak boleh diubah karena DO ini sudah masuk arsip slip borongan' },
            { status: 409 }
        );
    }

    const currentVehicleRef = extractRefId(deliveryOrder.vehicleRef);
    const currentDriverRef = extractRefId(deliveryOrder.driverRef);
    let nextVehicleRef = currentVehicleRef || '';
    let nextVehiclePlate = deliveryOrder.vehiclePlate || '';
    let nextVehicleServiceRef = extractRefId(deliveryOrder.vehicleServiceRef) || undefined;
    let nextVehicleServiceName = deliveryOrder.vehicleServiceName || undefined;
    let nextVehicleCategoryOverrideReason = deliveryOrder.vehicleCategoryOverrideReason || undefined;
    let nextDriverRef = currentDriverRef || '';
    let nextDriverName = deliveryOrder.driverName || '';
    let selectedVehicle: {
        _id: string;
        _rev?: string;
        plateNumber?: string;
        status?: string;
        serviceRef?: string;
        serviceName?: string;
    } | null = null;
    let selectedDriver: { _id: string; _rev?: string; name?: string; active?: boolean } | null = null;

    if (vehicleRef) {
        const vehicle = await getDocumentById<{
            _id: string;
            _rev?: string;
            plateNumber?: string;
            status?: string;
            serviceRef?: string;
            serviceName?: string;
        }>(vehicleRef, 'vehicle');
        if (!vehicle) {
            return NextResponse.json({ error: 'Kendaraan DO tidak ditemukan' }, { status: 404 });
        }
        selectedVehicle = vehicle;
        if (vehicle.status === 'SOLD') {
            return NextResponse.json({ error: 'Kendaraan yang sudah dijual tidak bisa dipakai untuk surat jalan baru' }, { status: 409 });
        }
        if (vehicle.status === 'OUT_OF_SERVICE') {
            return NextResponse.json({ error: 'Kendaraan yang sedang out of service tidak bisa dipakai untuk surat jalan baru' }, { status: 409 });
        }
        const conflictingDeliveryOrder =
            (await listDocumentsByFilter<{
                _id: string;
                doNumber?: string;
                customerDoNumber?: string;
                vehicleRef?: unknown;
                vehiclePlate?: string;
                status?: string;
            }>('deliveryOrder', {
                status: ['CREATED', 'HEADING_TO_PICKUP', 'ON_DELIVERY', 'ARRIVED'],
            })).find(candidate =>
                candidate._id !== id
                && (
                    extractRefId(candidate.vehicleRef) === vehicleRef
                    || normalizeOptionalText(candidate.vehiclePlate)?.toLowerCase() === (vehicle.plateNumber || nextVehiclePlate || '').toLowerCase()
                )
            ) || null;
        if (conflictingDeliveryOrder) {
            const conflictingNumber =
                conflictingDeliveryOrder.doNumber ||
                conflictingDeliveryOrder.customerDoNumber ||
                conflictingDeliveryOrder._id;
            return NextResponse.json(
                {
                    error: `Kendaraan ${vehicle.plateNumber || vehicleRef} masih dipakai di surat jalan aktif ${conflictingNumber}. Selesaikan atau batalkan dulu DO tersebut.`,
                },
                { status: 409 }
            );
        }
        const requestedServiceRef = extractRefId(deliveryOrder.serviceRef);
        const assignedVehicleServiceRef = extractRefId(vehicle.serviceRef) || undefined;
        const assignedVehicleServiceName = vehicle.serviceName || undefined;
        if (requestedServiceRef && !assignedVehicleServiceRef && !vehicleCategoryOverrideReason) {
            return NextResponse.json(
                {
                    error: `Kendaraan ${vehicle.plateNumber || vehicleRef} belum punya kategori armada yang cocok. Isi alasan override jika trip ini memang harus jalan dengan armada berbeda.`,
                },
                { status: 400 }
            );
        }
        if (requestedServiceRef && assignedVehicleServiceRef !== requestedServiceRef && !vehicleCategoryOverrideReason) {
            return NextResponse.json(
                {
                    error: `Kendaraan ${vehicle.plateNumber || vehicleRef} berkategori ${vehicle.serviceName || '-'} tidak sama dengan armada order ${deliveryOrder.serviceName || '-'}. Isi alasan override bila trip ini memang memakai armada lain.`,
                },
                { status: 400 }
            );
        }

        nextVehicleRef = vehicleRef;
        nextVehiclePlate = vehicle.plateNumber || nextVehiclePlate;
        nextVehicleServiceRef = assignedVehicleServiceRef;
        nextVehicleServiceName = assignedVehicleServiceName;
        nextVehicleCategoryOverrideReason =
            requestedServiceRef && assignedVehicleServiceRef !== requestedServiceRef
                ? vehicleCategoryOverrideReason || undefined
                : undefined;
    }

    if (driverRef) {
        const driver = await getDocumentById<{ _id: string; _rev?: string; name?: string; active?: boolean }>(driverRef, 'driver');
        if (!driver) {
            return NextResponse.json({ error: 'Supir DO tidak ditemukan' }, { status: 404 });
        }
        selectedDriver = driver;
        if (driver.active === false) {
            return NextResponse.json({ error: 'Supir DO tidak aktif' }, { status: 409 });
        }
        const conflictingDeliveryOrder =
            (await listDocumentsByFilter<{
                _id: string;
                doNumber?: string;
                customerDoNumber?: string;
                driverRef?: unknown;
                driverName?: string;
                status?: string;
            }>('deliveryOrder', {
                status: ['CREATED', 'HEADING_TO_PICKUP', 'ON_DELIVERY', 'ARRIVED'],
            })).find(candidate =>
                candidate._id !== id
                && (
                    extractRefId(candidate.driverRef) === driverRef
                    || normalizeOptionalText(candidate.driverName)?.toLowerCase() === (driver.name || nextDriverName || '').toLowerCase()
                )
            ) || null;
        if (conflictingDeliveryOrder) {
            const conflictingNumber =
                conflictingDeliveryOrder.doNumber ||
                conflictingDeliveryOrder.customerDoNumber ||
                conflictingDeliveryOrder._id;
            return NextResponse.json(
                {
                    error: `Supir ${driver.name || driverRef} masih terikat di surat jalan aktif ${conflictingNumber}. Selesaikan atau batalkan dulu DO tersebut.`,
                },
                { status: 409 }
            );
        }
        nextDriverRef = driverRef;
        nextDriverName = driver.name || nextDriverName;
    }

    const vehicleChanged =
        nextVehicleRef !== (currentVehicleRef || '') ||
        nextVehiclePlate !== (deliveryOrder.vehiclePlate || '') ||
        (nextVehicleCategoryOverrideReason || '') !== (deliveryOrder.vehicleCategoryOverrideReason || '');
    const driverChanged =
        nextDriverRef !== (currentDriverRef || '') ||
        nextDriverName !== (deliveryOrder.driverName || '');

    if (!vehicleChanged && !driverChanged) {
        const unchangedDeliveryOrder = await getDocumentById(id, 'deliveryOrder');
        return NextResponse.json({ data: unchangedDeliveryOrder, id });
    }

    if (!deliveryOrder._rev && !isSupabaseBackendEnabled()) {
        return NextResponse.json({ error: 'Revisi surat jalan tidak tersedia. Refresh lalu coba lagi.' }, { status: 409 });
    }

    let updatedDeliveryOrder: unknown;
    try {
        const mutationTimestamp = new Date().toISOString();
        if (vehicleChanged && selectedVehicle?._id) {
            await updateDocument(selectedVehicle._id, { updatedAt: mutationTimestamp }, 'vehicle');
        }
        if (driverChanged && selectedDriver?._id) {
            await updateDocument(selectedDriver._id, { updatedAt: mutationTimestamp }, 'driver');
        }
        updatedDeliveryOrder = await updateDocument(id, {
            vehicleRef: nextVehicleRef || undefined,
            vehiclePlate: nextVehiclePlate || undefined,
            vehicleServiceRef: nextVehicleServiceRef || undefined,
            vehicleServiceName: nextVehicleServiceName || undefined,
            vehicleCategoryOverrideReason: nextVehicleCategoryOverrideReason || undefined,
            driverRef: nextDriverRef || undefined,
            driverName: nextDriverName || undefined,
        }, 'deliveryOrder');
    } catch (error) {
        if (isMutationConflictError(error)) {
            return NextResponse.json(
                { error: 'Armada trip, kendaraan, atau supir berubah karena ada update lain. Refresh lalu coba lagi.' },
                { status: 409 }
            );
        }
        throw error;
    }

    const changes: string[] = [];
    if (vehicleChanged) {
        changes.push(`kendaraan ${deliveryOrder.vehiclePlate || '-'} -> ${nextVehiclePlate || '-'}`);
    }
    if (driverChanged) {
        changes.push(`supir ${deliveryOrder.driverName || '-'} -> ${nextDriverName || '-'}`);
    }
    if (nextVehicleCategoryOverrideReason) {
        changes.push(`override armada: ${nextVehicleCategoryOverrideReason}`);
    }

    await addAuditLog(
        session,
        'UPDATE',
        'delivery-orders',
        id,
        `Lengkapi armada trip ${deliveryOrder.doNumber || id}: ${changes.join('; ')}`
    );

    return NextResponse.json({ data: updatedDeliveryOrder, id });
}

export async function handleDeliveryOrderShipperReferenceUpdate(
    session: ApiSession,
    data: Record<string, unknown>,
    addAuditLog: AuditLogFn
) {
    const id = typeof data.id === 'string' ? data.id : '';
    const legacyCustomerDoNumber = normalizeOptionalText(data.customerDoNumber)?.toUpperCase();

    if (!id) {
        return NextResponse.json({ error: 'Surat jalan tidak valid' }, { status: 400 });
    }

    const deliveryOrder = await getDocumentById<{
        _id: string;
        _rev?: string;
        doNumber?: string;
        customerDoNumber?: string;
        status?: DOStatus;
        tripClosedByAdminAt?: string;
        customerRef?: unknown;
        customerName?: string;
        pickupStops?: Array<{
            _key?: string;
            pickupAddress?: string;
        }>;
        shipperReferences?: Array<{
            _key?: string;
            sequence?: number;
            referenceNumber?: string;
            pickupStopKey?: string;
            pickupAddress?: string;
            billingCustomerRef?: string;
            billingCustomerName?: string;
            receiverName?: string;
            receiverPhone?: string;
            receiverAddress?: string;
            receiverCompany?: string;
            notes?: string;
        }>;
        actualDropPoints?: Array<{
            _key?: string;
            deliveryOrderItemRef?: string;
            shipperReferenceKey?: string;
            shipperReferenceNumber?: string;
            [key: string]: unknown;
        }>;
    }>(id, 'deliveryOrder');
    if (!deliveryOrder) {
        return NextResponse.json({ error: 'Surat jalan tidak ditemukan' }, { status: 404 });
    }
    if (deliveryOrder.tripClosedByAdminAt) {
        return NextResponse.json(
            { error: 'Trip ini sudah ditutup admin. Buka kembali trip jika masih ingin mengubah SJ.' },
            { status: 409 }
        );
    }

    let nextShipperReferences:
        | Array<{
            _key: string;
            sequence: number;
            referenceNumber: string;
            pickupStopKey?: string;
            pickupAddress?: string;
            billingCustomerRef?: string;
            billingCustomerName?: string;
            receiverName?: string;
            receiverPhone?: string;
            receiverAddress?: string;
            receiverCompany?: string;
            notes?: string;
        }>
        | undefined;
    try {
        nextShipperReferences = normalizeDeliveryOrderShipperReferencesForUpdate(
            deliveryOrder,
            Array.isArray(data.shipperReferences) && data.shipperReferences.length > 0
                ? data.shipperReferences
                : legacyCustomerDoNumber
                    ? [{ referenceNumber: legacyCustomerDoNumber }]
                    : []
        );
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Daftar SJ pengirim tidak valid' },
            { status: 400 }
        );
    }

    const customerDoNumber = (legacyCustomerDoNumber || deliveryOrder.customerDoNumber || nextShipperReferences?.[0]?.referenceNumber)?.toUpperCase();
    if (!customerDoNumber || !nextShipperReferences || nextShipperReferences.length === 0) {
        return NextResponse.json({ error: 'No. SJ pengirim wajib diisi' }, { status: 400 });
    }

    const existingCustomerDoNumber = normalizeOptionalText(deliveryOrder.customerDoNumber)?.toUpperCase();
    const shipperReferencesChanged = !areDeliveryOrderShipperReferencesEquivalent(
        deliveryOrder.shipperReferences,
        nextShipperReferences
    );
    const customerDoNumberChanged = existingCustomerDoNumber !== customerDoNumber;
    if (!customerDoNumberChanged && !shipperReferencesChanged) {
        const unchangedDeliveryOrder = await getDocumentById(id, 'deliveryOrder');
        return NextResponse.json({ data: unchangedDeliveryOrder, id });
    }

    const hasNotaReference = (await listDocumentsByFilter<{ _id: string; notaRef?: string }>('freightNotaItem', {
        doRef: id,
    }))[0] || null;
    if (hasNotaReference) {
        return NextResponse.json(
                        { error: 'No. SJ pengirim tidak boleh diubah karena DO ini sudah masuk invoice' },
            { status: 409 }
        );
    }

    const hasBoronganReference = (await listDocumentsByFilter<{ _id: string; boronganRef?: string }>('driverBoronganItem', {
        doRef: id,
    }))[0] || null;
    if (hasBoronganReference) {
        return NextResponse.json(
            { error: 'No. SJ pengirim tidak boleh diubah karena DO ini sudah masuk arsip slip borongan' },
            { status: 409 }
        );
    }

    const customerRef = extractRefId(deliveryOrder.customerRef);
    if (customerRef) {
        const previousReferenceNumbers = new Set(
            (Array.isArray(deliveryOrder.shipperReferences) ? deliveryOrder.shipperReferences : [])
                .map(reference => normalizeOptionalText(reference.referenceNumber)?.toLowerCase() || '')
                .filter(Boolean)
        );
        const requestedReferenceNumbers = new Set(
            nextShipperReferences
                .map(reference => reference.referenceNumber.toLowerCase())
                .filter(referenceNumber => !previousReferenceNumbers.has(referenceNumber))
        );
        let duplicateReferenceNumber = '';
        const duplicateCustomerDoNumber =
            (await listDocumentsByFilter<{
                _id: string;
                customerRef?: unknown;
                customerDoNumber?: string;
                shipperReferences?: Array<{ referenceNumber?: string }>;
            }>('deliveryOrder', { customerRef })).find(candidate =>
                candidate._id !== id && (() => {
                    const duplicateByCustomerDoNumber =
                        customerDoNumberChanged &&
                        normalizeOptionalText(candidate.customerDoNumber)?.toLowerCase() === customerDoNumber.toLowerCase();
                    if (duplicateByCustomerDoNumber) {
                        duplicateReferenceNumber = customerDoNumber;
                        return true;
                    }
                    const duplicateShipperReference = (candidate.shipperReferences || []).find(reference => {
                        const normalizedReferenceNumber = normalizeOptionalText(reference.referenceNumber)?.toLowerCase() || '';
                        return requestedReferenceNumbers.has(normalizedReferenceNumber);
                    });
                    if (duplicateShipperReference) {
                        duplicateReferenceNumber = normalizeOptionalText(duplicateShipperReference.referenceNumber)?.toUpperCase() || '';
                        return true;
                    }
                    return false;
                })()
            ) || null;
        if (duplicateCustomerDoNumber) {
            return NextResponse.json(
                { error: `No. SJ pengirim ${duplicateReferenceNumber || customerDoNumber} sudah dipakai untuk customer ini.` },
                { status: 409 }
            );
        }
    }

    if (!deliveryOrder._rev && !isSupabaseBackendEnabled()) {
        return NextResponse.json({ error: 'Revisi surat jalan tidak tersedia. Refresh lalu coba lagi.' }, { status: 409 });
    }

    const deliveryOrderItems = await listDocumentsByFilter<{
        _id: string;
        shipperReferenceKey?: string;
        shipperReferenceNumber?: string;
        pickupStopKey?: string;
        pickupAddress?: string;
    }>('deliveryOrderItem', { deliveryOrderRef: id });
    const previousReferences = Array.isArray(deliveryOrder.shipperReferences) ? deliveryOrder.shipperReferences : [];
    const previousReferenceByKey = new Map(
        previousReferences
            .map(reference => [normalizeOptionalText(reference._key), reference] as const)
            .filter((entry): entry is [string, NonNullable<typeof entry[1]>] => Boolean(entry[0]))
    );
    const previousReferenceByNumber = new Map(
        previousReferences
            .map(reference => [normalizeOptionalText(reference.referenceNumber)?.toUpperCase(), reference] as const)
            .filter((entry): entry is [string, NonNullable<typeof entry[1]>] => Boolean(entry[0]))
    );
    const nextReferenceByKey = new Map(nextShipperReferences.map(reference => [reference._key, reference]));
    const nextSuratJalanRecordIds = new Set(
        nextShipperReferences.map(reference =>
            getDeliveryOrderSuratJalanIdentity({
                deliveryOrderId: id,
                shipperReferenceKey: reference._key,
                shipperReferenceNumber: reference.referenceNumber,
            })
        )
    );
    const singleNextReference = nextShipperReferences.length === 1 ? nextShipperReferences[0] : null;
    const itemReferencePatches = new Map<string, NonNullable<typeof singleNextReference>>();

    for (const item of deliveryOrderItems) {
        const currentReferenceKey = normalizeOptionalText(item.shipperReferenceKey);
        const currentReferenceNumber = normalizeOptionalText(item.shipperReferenceNumber)?.toUpperCase();
        const previousReference =
            (currentReferenceKey ? previousReferenceByKey.get(currentReferenceKey) : undefined)
            || (currentReferenceNumber ? previousReferenceByNumber.get(currentReferenceNumber) : undefined);
        const nextReference =
            (previousReference?._key ? nextReferenceByKey.get(previousReference._key) : undefined)
            || (singleNextReference && (!currentReferenceNumber || currentReferenceNumber === existingCustomerDoNumber)
                ? singleNextReference
                : undefined);
        if (nextReference) {
            itemReferencePatches.set(item._id, nextReference);
        }
    }

    const addedReferences = nextShipperReferences.filter(nextReference => {
        const normalizedKey = normalizeOptionalText(nextReference._key);
        const normalizedNumber = normalizeOptionalText(nextReference.referenceNumber)?.toUpperCase();
        return !previousReferences.some(previousReference =>
            (normalizedKey && normalizeOptionalText(previousReference._key) === normalizedKey) ||
            (normalizedNumber && normalizeOptionalText(previousReference.referenceNumber)?.toUpperCase() === normalizedNumber)
        );
    });
    const removedReferences = previousReferences.filter(previousReference => {
        const normalizedKey = normalizeOptionalText(previousReference._key);
        const normalizedNumber = normalizeOptionalText(previousReference.referenceNumber)?.toUpperCase();
        return !nextShipperReferences.some(nextReference =>
            (normalizedKey && normalizeOptionalText(nextReference._key) === normalizedKey) ||
            (normalizedNumber && normalizeOptionalText(nextReference.referenceNumber)?.toUpperCase() === normalizedNumber)
        );
    });
    const addedSuratJalanRecordIds = new Set(
        addedReferences.map(reference =>
            getDeliveryOrderSuratJalanIdentity({
                deliveryOrderId: id,
                shipperReferenceKey: reference._key,
                shipperReferenceNumber: reference.referenceNumber,
            })
        )
    );
    const removedReferenceKeys = new Set(
        removedReferences
            .map(reference => normalizeOptionalText(reference._key))
            .filter((value): value is string => Boolean(value))
    );
    const removedReferenceNumbers = new Set(
        removedReferences
            .map(reference => normalizeOptionalText(reference.referenceNumber)?.toUpperCase())
            .filter((value): value is string => Boolean(value))
    );
    const itemStillUsesRemovedReference = deliveryOrderItems.some(item => {
        if (itemReferencePatches.has(item._id)) {
            return false;
        }
        const itemReferenceKey = normalizeOptionalText(item.shipperReferenceKey);
        const itemReferenceNumber = normalizeOptionalText(item.shipperReferenceNumber)?.toUpperCase();
        return Boolean(
            (itemReferenceKey && removedReferenceKeys.has(itemReferenceKey)) ||
            (itemReferenceNumber && removedReferenceNumbers.has(itemReferenceNumber))
        );
    });
    if (itemStillUsesRemovedReference) {
        return NextResponse.json(
            { error: 'SJ pengirim yang masih punya barang tidak bisa dihapus. Hapus atau pindahkan barangnya dulu.' },
            { status: 409 }
        );
    }
    const nextActualDropPoints = Array.isArray(deliveryOrder.actualDropPoints)
        ? deliveryOrder.actualDropPoints
            .filter(point => {
                const pointReferenceKey = normalizeOptionalText(point.shipperReferenceKey);
                const pointReferenceNumber = normalizeOptionalText(point.shipperReferenceNumber)?.toUpperCase();
                return !(
                    (pointReferenceKey && removedReferenceKeys.has(pointReferenceKey)) ||
                    (pointReferenceNumber && removedReferenceNumbers.has(pointReferenceNumber))
                );
            })
            .map(point => {
                const itemRef = normalizeOptionalText(point.deliveryOrderItemRef);
                const nextReference = itemRef ? itemReferencePatches.get(itemRef) : undefined;
                return nextReference
                    ? {
                        ...point,
                        shipperReferenceKey: nextReference._key,
                        shipperReferenceNumber: nextReference.referenceNumber,
                    }
                    : point;
            })
        : undefined;

    let updatedDeliveryOrder: unknown;
    try {
        updatedDeliveryOrder = await updateDocument(id, {
            customerDoNumber,
            shipperReferences: nextShipperReferences,
            ...((deliveryOrder.status === 'DELIVERED' || deliveryOrder.status === 'PARTIAL_HOLD')
                && nextShipperReferences.length > previousReferences.length
                ? { status: 'ARRIVED' }
                : {}),
            ...(nextActualDropPoints ? { actualDropPoints: nextActualDropPoints } : {}),
        }, 'deliveryOrder');
        for (const item of deliveryOrderItems) {
            const nextReference = itemReferencePatches.get(item._id);
            if (!nextReference) {
                continue;
            }
            await updateDocument(item._id, {
                shipperReferenceKey: nextReference._key,
                shipperReferenceNumber: nextReference.referenceNumber,
                pickupStopKey: nextReference.pickupStopKey || item.pickupStopKey,
                pickupAddress: nextReference.pickupAddress || item.pickupAddress,
            }, 'deliveryOrderItem');
        }
        if (addedReferences.length > 0) {
            await ensureTripRecordForSuratJalanWrites(deliveryOrder);

            const nextOperationalStatus =
                (deliveryOrder.status === 'DELIVERED' || deliveryOrder.status === 'PARTIAL_HOLD')
                    ? 'ARRIVED'
                    : (deliveryOrder.status || 'CREATED');
            const deliveryOrderForNewRecords: DeliveryOrder = {
                ...(deliveryOrder as DeliveryOrder),
                customerDoNumber,
                shipperReferences: nextShipperReferences,
                status: nextOperationalStatus,
                actualDropPoints: nextActualDropPoints as DeliveryOrder['actualDropPoints'],
            };
            const suratJalanRecords = mapDeliveryOrderToSuratJalanRecords(
                deliveryOrderForNewRecords,
                deliveryOrderItems.map(item => ({
                    _id: item._id,
                    _type: 'deliveryOrderItem',
                    deliveryOrderRef: id,
                    shipperReferenceKey: itemReferencePatches.get(item._id)?._key || item.shipperReferenceKey,
                    shipperReferenceNumber: itemReferencePatches.get(item._id)?.referenceNumber || item.shipperReferenceNumber,
                })) as DeliveryOrderItem[]
            );
            const existingSuratJalanRecords = await listDocumentsByFilter<{ _id: string }>('suratJalan', { tripRef: id });
            const existingSuratJalanRecordIds = new Set(existingSuratJalanRecords.map(record => record._id));
            for (const addedReference of addedReferences) {
                const targetRecordId = getDeliveryOrderSuratJalanIdentity({
                    deliveryOrderId: id,
                    shipperReferenceKey: addedReference._key,
                    shipperReferenceNumber: addedReference.referenceNumber,
                });
                if (existingSuratJalanRecordIds.has(targetRecordId)) {
                    continue;
                }
                const mappedRecord = suratJalanRecords.find(record => record._id === targetRecordId);
                if (!mappedRecord) {
                    continue;
                }
                await createDocument({
                    ...mappedRecord,
                    tripStatus: 'CREATED',
                    billableCargo: { qtyKoli: 0, weightKg: 0, volumeM3: 0 },
                    holdCargo: { qtyKoli: 0, weightKg: 0, volumeM3: 0 },
                    returnCargo: { qtyKoli: 0, weightKg: 0, volumeM3: 0 },
                });
            }
        }
        if (removedReferences.length > 0) {
            const existingSuratJalanRecords = await listDocumentsByFilter<{ _id: string }>('suratJalan', { tripRef: id });
            const existingSuratJalanRecordIds = new Set(existingSuratJalanRecords.map(record => record._id));
            for (const removedReference of removedReferences) {
                const targetRecordId = getDeliveryOrderSuratJalanIdentity({
                    deliveryOrderId: id,
                    shipperReferenceKey: removedReference._key,
                    shipperReferenceNumber: removedReference.referenceNumber,
                });
                if (nextSuratJalanRecordIds.has(targetRecordId)) {
                    continue;
                }
                if (!existingSuratJalanRecordIds.has(targetRecordId)) {
                    continue;
                }
                await deleteDocument(targetRecordId, 'suratJalan');
            }
        }
        const deliveryOrderForSyncedRecords: DeliveryOrder = {
            ...(deliveryOrder as DeliveryOrder),
            customerDoNumber,
            shipperReferences: nextShipperReferences,
            status: (
                (deliveryOrder.status === 'DELIVERED' || deliveryOrder.status === 'PARTIAL_HOLD')
                && nextShipperReferences.length > previousReferences.length
            )
                ? 'ARRIVED'
                : (deliveryOrder.status || 'CREATED'),
            actualDropPoints: nextActualDropPoints as DeliveryOrder['actualDropPoints'],
        };
        const deliveryOrderItemsForSyncedRecords = deliveryOrderItems.map(item => {
            const nextReference = itemReferencePatches.get(item._id);
            return {
                ...(item as DeliveryOrderItem),
                shipperReferenceKey: nextReference?._key || item.shipperReferenceKey,
                shipperReferenceNumber: nextReference?.referenceNumber || item.shipperReferenceNumber,
                pickupStopKey: nextReference?.pickupStopKey || item.pickupStopKey,
                pickupAddress: nextReference?.pickupAddress || item.pickupAddress,
            };
        });
        const syncedSuratJalanRecords = mapDeliveryOrderToSuratJalanRecords(
            deliveryOrderForSyncedRecords,
            deliveryOrderItemsForSyncedRecords
        );
        const syncedSuratJalanRecordIds = new Set(syncedSuratJalanRecords.map(record => record._id));
        const existingSuratJalanRecords = await listDocumentsByFilter<{ _id: string }>('suratJalan', { tripRef: id });
        const existingSuratJalanRecordIds = new Set(existingSuratJalanRecords.map(record => record._id));
        for (const record of syncedSuratJalanRecords) {
            const recordForWrite = addedSuratJalanRecordIds.has(record._id)
                ? {
                    ...record,
                    tripStatus: 'CREATED' as const,
                    billableCargo: { qtyKoli: 0, weightKg: 0, volumeM3: 0 },
                    holdCargo: { qtyKoli: 0, weightKg: 0, volumeM3: 0 },
                    returnCargo: { qtyKoli: 0, weightKg: 0, volumeM3: 0 },
                }
                : record;
            if (!existingSuratJalanRecordIds.has(record._id)) {
                await createDocument({ ...recordForWrite });
                continue;
            }
            const recordPatch = Object.fromEntries(
                Object.entries(recordForWrite).filter(([key]) => key !== '_id' && key !== '_type')
            );
            await updateDocument(record._id, recordPatch, 'suratJalan');
        }
        for (const existingRecord of existingSuratJalanRecords) {
            if (syncedSuratJalanRecordIds.has(existingRecord._id)) {
                continue;
            }
            await deleteDocument(existingRecord._id, 'suratJalan');
        }
        if ((deliveryOrder.status === 'DELIVERED' || deliveryOrder.status === 'PARTIAL_HOLD') && nextShipperReferences.length > previousReferences.length) {
            const tripRecord = await getDocumentById<{ _id: string }>(id, 'trip');
            if (tripRecord) {
                await updateDocument(id, { status: 'ARRIVED' }, 'trip');
            }
        }
    } catch (error) {
        if (isMutationConflictError(error)) {
            return NextResponse.json(
                { error: 'No. SJ pengirim berubah karena ada update lain. Refresh lalu coba lagi.' },
                { status: 409 }
            );
        }
        throw error;
    }

    await addAuditLog(
        session,
        'UPDATE',
        'delivery-orders',
        id,
        `Update SJ pengirim ${deliveryOrder.doNumber || id}: ${existingCustomerDoNumber || '-'} -> ${nextShipperReferences.map(reference => reference.referenceNumber).join(', ')}`
    );

    return NextResponse.json({ data: updatedDeliveryOrder, id });
}

export async function handleOrderDelete(
    session: ApiSession,
    data: Record<string, unknown>,
    addAuditLog: AuditLogFn
) {
    const id = typeof data.id === 'string' ? data.id : '';
    if (!id) {
        return NextResponse.json({ error: 'Order tidak valid' }, { status: 400 });
    }

    const order = await getDocumentById<{ _id: string; _rev?: string; masterResi?: string }>(id, 'order');
    if (!order) {
        return NextResponse.json({ error: 'Order tidak ditemukan' }, { status: 404 });
    }
    if (!isSupabaseBackendEnabled() && !order._rev) {
        return NextResponse.json({ error: 'Revisi order tidak tersedia. Refresh lalu coba lagi.' }, { status: 409 });
    }

    const relatedDeliveryOrders = await listDocumentsByFilter<{ _id: string }>('deliveryOrder', { orderRef: id });
    const relatedDeliveryOrder = relatedDeliveryOrders[0] || null;
    if (relatedDeliveryOrder) {
        return NextResponse.json({ error: 'Order yang sudah punya surat jalan tidak boleh dihapus' }, { status: 409 });
    }

    const relatedInvoices = await listDocumentsByFilter<{ _id: string }>('invoice', { orderRef: id });
    const relatedInvoice = relatedInvoices[0] || null;
    if (relatedInvoice) {
        return NextResponse.json({ error: 'Order yang sudah punya invoice tidak boleh dihapus' }, { status: 409 });
    }

    const orderItems = await listDocumentsByFilter<Array<{
        _id: string;
        _rev?: string;
        description?: string;
        status?: string;
    }>[number]>('orderItem', { orderRef: id });

    try {
        await Promise.all(orderItems.map(orderItem => deleteDocument(orderItem._id, 'orderItem')));
        await deleteDocument(id, 'order');
    } catch (error) {
        if (isMutationConflictError(error)) {
            return NextResponse.json(
                { error: 'Order atau item order berubah karena ada update lain. Refresh lalu coba lagi.' },
                { status: 409 }
            );
        }
        throw error;
    }

    await addAuditLog(session, 'DELETE', 'orders', id, `Deleted orders ${order.masterResi || id}`);
    return NextResponse.json({ success: true });
}
