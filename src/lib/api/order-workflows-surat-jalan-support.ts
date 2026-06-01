import {
    isMutationConflictError,
    normalizeNumber,
    normalizeOptionalText,
} from './data-helpers';
import {
    createDocument,
    deleteDocument,
    getDocumentById,
    listDocumentsByFilter,
    updateDocument,
} from '@/lib/repositories/document-store';
import { roundQuantity } from '@/lib/order-item-progress';
import { clearRelationalReadCache } from '@/lib/supabase-relational';
import {
    mapDeliveryOrderToSuratJalanItemRecords,
    mapDeliveryOrderToTripRecord,
} from '@/lib/trip-document-mappers';
import type { DeliveryOrder, DeliveryOrderItem } from '@/lib/types';
import type {
    DeliveryOrderItemCargoSnapshot,
    NormalizedActualCargoInput,
} from './order-workflow-support';

export const MANUAL_DO_STATUSES = ['CREATED', 'ON_DELIVERY', 'ARRIVED', 'DELIVERED', 'CANCELLED'] as const;

export function getDeliveryOrderSuratJalanIdentity(params: {
    deliveryOrderId: string;
    shipperReferenceKey?: string | null;
    shipperReferenceNumber?: string | null;
}) {
    return `${params.deliveryOrderId}:${params.shipperReferenceKey || params.shipperReferenceNumber || 'primary'}`;
}

async function findPersistedTripRecordForDeliveryOrder(deliveryOrderId: string) {
    const byId = await getDocumentById<{ _id: string; deliveryOrderRef?: string }>(deliveryOrderId, 'trip');
    if (byId) {
        return byId;
    }

    const byDeliveryOrderRef = await listDocumentsByFilter<{ _id: string; deliveryOrderRef?: string }>('trip', {
        deliveryOrderRef: deliveryOrderId,
    });
    return byDeliveryOrderRef.find(record => record.deliveryOrderRef === deliveryOrderId) || null;
}

export async function ensureTripRecordForSuratJalanWrites(deliveryOrder: { _id: string; _type?: unknown; orderRef?: unknown; date?: unknown }) {
    const completeDeliveryOrder =
        deliveryOrder._type === 'deliveryOrder' && typeof deliveryOrder.orderRef === 'string' && typeof deliveryOrder.date === 'string'
            ? deliveryOrder as DeliveryOrder
            : await getDocumentById<DeliveryOrder>(deliveryOrder._id, 'deliveryOrder');
    if (!completeDeliveryOrder) {
        throw new Error('Trip tidak ditemukan');
    }

    for (let attempt = 0; attempt < 3; attempt += 1) {
        clearRelationalReadCache();
        const persistedTripRecord = await findPersistedTripRecordForDeliveryOrder(deliveryOrder._id);
        if (persistedTripRecord) {
            return;
        }
        try {
            await createDocument({ ...mapDeliveryOrderToTripRecord(completeDeliveryOrder) });
            clearRelationalReadCache();
            return;
        } catch (error) {
            if (!isMutationConflictError(error)) {
                throw error;
            }
            clearRelationalReadCache();
            const persistedTripRecordAfterConflict = await findPersistedTripRecordForDeliveryOrder(deliveryOrder._id);
            if (persistedTripRecordAfterConflict) {
                return;
            }
        }
        await new Promise(resolve => setTimeout(resolve, 75 * (attempt + 1)));
    }
    throw new Error('Trip relasional belum siap untuk penulisan surat jalan');
}

export async function refreshSuratJalanItemRecordsForDeliveryOrder(deliveryOrder: DeliveryOrder) {
    const deliveryOrderItems = await listDocumentsByFilter<DeliveryOrderItem>('deliveryOrderItem', {
        deliveryOrderRef: deliveryOrder._id,
    });
    const mappedItemRecords = mapDeliveryOrderToSuratJalanItemRecords(deliveryOrder, deliveryOrderItems);
    const existingItemRecords = await listDocumentsByFilter<{ _id: string }>('suratJalanItem', {
        tripRef: deliveryOrder._id,
    });
    const mappedItemRecordIds = new Set(mappedItemRecords.map(item => item._id));
    const existingItemRecordIds = new Set(existingItemRecords.map(item => item._id));

    for (const record of mappedItemRecords) {
        if (existingItemRecordIds.has(record._id)) {
            await updateDocument(record._id, { ...record }, 'suratJalanItem');
        } else {
            await createDocument({ ...record });
        }
    }

    for (const record of existingItemRecords) {
        if (!mappedItemRecordIds.has(record._id)) {
            await deleteDocument(record._id, 'suratJalanItem');
        }
    }
}

export function buildAutoFinalizeBatchRawDropPoints(
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

function hasSuratJalanCargoSummaryValue(summary?: { qtyKoli?: number; weightKg?: number; volumeM3?: number } | null) {
    return (
        normalizeNumber(summary?.qtyKoli ?? 0) > 0 ||
        normalizeNumber(summary?.weightKg ?? 0) > 0 ||
        normalizeNumber(summary?.volumeM3 ?? 0) > 0
    );
}

export function getLockedRemovedShipperReferenceLabels(params: {
    deliveryOrderId: string;
    removedReferences: Array<{ _key?: string; referenceNumber?: string }>;
    removedReferenceKeys: Set<string>;
    removedReferenceNumbers: Set<string>;
    itemsLinkedToRemovedReferences: Array<{ _id: string }>;
    suratJalanRecords: Array<{
        _id: string;
        tripStatus?: string;
        referenceKey?: string;
        suratJalanNumber?: string;
        billableCargo?: { qtyKoli?: number; weightKg?: number; volumeM3?: number };
        holdCargo?: { qtyKoli?: number; weightKg?: number; volumeM3?: number };
        returnCargo?: { qtyKoli?: number; weightKg?: number; volumeM3?: number };
    }>;
    actualDropPoints?: Array<{
        stopType?: string;
        deliveryOrderItemRef?: string;
        deliveryOrderItemRefs?: unknown;
        shipperReferenceKey?: string;
        shipperReferenceNumber?: string;
    }>;
}) {
    const removedItemIds = new Set(params.itemsLinkedToRemovedReferences.map(item => item._id));
    const allocatedDropTypes = new Set(['DROP', 'HOLD', 'TRANSIT', 'EXTRA_DROP', 'RETURN']);
    return params.removedReferences
        .filter(reference => {
            const referenceKey = normalizeOptionalText(reference._key);
            const referenceNumber = normalizeOptionalText(reference.referenceNumber)?.toUpperCase();
            const targetRecordId = getDeliveryOrderSuratJalanIdentity({
                deliveryOrderId: params.deliveryOrderId,
                shipperReferenceKey: reference._key,
                shipperReferenceNumber: reference.referenceNumber,
            });
            const matchingRecord = params.suratJalanRecords.find(record =>
                record._id === targetRecordId ||
                (referenceKey && normalizeOptionalText(record.referenceKey) === referenceKey) ||
                (referenceNumber && normalizeOptionalText(record.suratJalanNumber)?.toUpperCase() === referenceNumber)
            );
            if (
                matchingRecord &&
                (
                    matchingRecord.tripStatus === 'DELIVERED' ||
                    matchingRecord.tripStatus === 'PARTIAL_HOLD' ||
                    hasSuratJalanCargoSummaryValue(matchingRecord.billableCargo) ||
                    hasSuratJalanCargoSummaryValue(matchingRecord.holdCargo) ||
                    hasSuratJalanCargoSummaryValue(matchingRecord.returnCargo)
                )
            ) {
                return true;
            }

            return (params.actualDropPoints || []).some(point => {
                if (!allocatedDropTypes.has(point.stopType || '')) {
                    return false;
                }
                const pointReferenceKey = normalizeOptionalText(point.shipperReferenceKey);
                const pointReferenceNumber = normalizeOptionalText(point.shipperReferenceNumber)?.toUpperCase();
                if (
                    (pointReferenceKey && params.removedReferenceKeys.has(pointReferenceKey)) ||
                    (pointReferenceNumber && params.removedReferenceNumbers.has(pointReferenceNumber))
                ) {
                    return true;
                }
                const pointItemRefs = [
                    normalizeOptionalText(point.deliveryOrderItemRef),
                    ...((Array.isArray(point.deliveryOrderItemRefs) ? point.deliveryOrderItemRefs : [])
                        .map(ref => normalizeOptionalText(ref))
                        .filter((ref): ref is string => Boolean(ref))),
                ].filter((ref): ref is string => Boolean(ref));
                return pointItemRefs.some(ref => removedItemIds.has(ref));
            });
        })
        .map(reference => normalizeOptionalText(reference.referenceNumber)?.toUpperCase() || normalizeOptionalText(reference._key) || 'SJ');
}

export function normalizeSelectedSuratJalanRefs(data: Record<string, unknown>, deliveryOrderId: string) {
    return Array.from(
        new Set(
            (Array.isArray(data.targetSuratJalanRefs) ? data.targetSuratJalanRefs : [])
                .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
                .map(value => value.trim())
                .filter(value => value === `${deliveryOrderId}:primary` || value.startsWith(`${deliveryOrderId}:`))
        )
    );
}
