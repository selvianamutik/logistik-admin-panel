import type { DeliveryOrder, PendingDriverStatusRequest } from '@/lib/types';

import { normalizeOptionalText } from './data-helpers';
import { getDeliveryOrderSuratJalanIdentity } from './order-workflows-surat-jalan-support';

export type PendingDriverApprovalSource = Pick<
    DeliveryOrder,
    | '_id'
    | 'pendingDriverRequests'
    | 'pendingDriverStatus'
    | 'pendingDriverStatusRequestedAt'
    | 'pendingDriverStatusRequestedBy'
    | 'pendingDriverStatusRequestedByName'
    | 'pendingDriverStatusNote'
    | 'pendingDriverStatusSuratJalanRefs'
    | 'pendingDriverPodReceiverName'
    | 'pendingDriverPodReceivedDate'
    | 'pendingDriverPodNote'
    | 'pendingDriverActualCargoItems'
    | 'pendingDriverActualDropPoints'
    | 'tripEndOdometerKm'
>;

export function getPendingDriverRequestsFromDeliveryOrder(
    deliveryOrder: PendingDriverApprovalSource
): PendingDriverStatusRequest[] {
    const requests = Array.isArray(deliveryOrder.pendingDriverRequests)
        ? deliveryOrder.pendingDriverRequests.filter(request => request && request.requestId && request.status)
        : [];
    if (requests.length > 0 || !deliveryOrder.pendingDriverStatus) {
        return requests;
    }
    return [{
        requestId: `${deliveryOrder._id}:legacy-pending-driver-request`,
        status: deliveryOrder.pendingDriverStatus,
        requestedAt: deliveryOrder.pendingDriverStatusRequestedAt,
        requestedBy: deliveryOrder.pendingDriverStatusRequestedBy,
        requestedByName: deliveryOrder.pendingDriverStatusRequestedByName,
        note: deliveryOrder.pendingDriverStatusNote,
        targetSuratJalanRefs: deliveryOrder.pendingDriverStatusSuratJalanRefs || [],
        podReceiverName: deliveryOrder.pendingDriverPodReceiverName,
        podReceivedDate: deliveryOrder.pendingDriverPodReceivedDate,
        podNote: deliveryOrder.pendingDriverPodNote,
        actualCargoItems: deliveryOrder.pendingDriverActualCargoItems || [],
        actualDropPoints: deliveryOrder.pendingDriverActualDropPoints || [],
        tripEndOdometerKm: deliveryOrder.tripEndOdometerKm,
        closeTripOnly: Boolean(deliveryOrder.tripEndOdometerKm && (!deliveryOrder.pendingDriverActualCargoItems || deliveryOrder.pendingDriverActualCargoItems.length === 0)),
    }];
}

export function hasPendingDriverApprovalRequest(deliveryOrder: { pendingDriverStatus?: unknown; pendingDriverRequests?: unknown }) {
    return Boolean(deliveryOrder.pendingDriverStatus) ||
        (Array.isArray(deliveryOrder.pendingDriverRequests) &&
            deliveryOrder.pendingDriverRequests.some(request =>
                request &&
                typeof request === 'object' &&
                'requestId' in request &&
                'status' in request
            ));
}

export function getBlockingPendingDriverApprovalRequest(deliveryOrder: PendingDriverApprovalSource) {
    return getPendingDriverRequestsFromDeliveryOrder(deliveryOrder)
        .find(request =>
            request.closeTripOnly ||
            request.status !== 'DELIVERED' ||
            !Array.isArray(request.targetSuratJalanRefs) ||
            request.targetSuratJalanRefs.length === 0
        );
}

export function getPendingFinalizationSuratJalanRefSet(deliveryOrder: PendingDriverApprovalSource) {
    return new Set(
        getPendingDriverRequestsFromDeliveryOrder(deliveryOrder)
            .filter(request =>
                request.status === 'DELIVERED' &&
                !request.closeTripOnly &&
                Array.isArray(request.targetSuratJalanRefs) &&
                request.targetSuratJalanRefs.length > 0
            )
            .flatMap(request => request.targetSuratJalanRefs || [])
            .map(ref => normalizeOptionalText(ref))
            .filter((ref): ref is string => Boolean(ref))
    );
}

function getSuratJalanIdentityCandidates(
    deliveryOrderId: string,
    params: {
        shipperReferenceKey?: string | null;
        shipperReferenceNumber?: string | null;
    }
) {
    const key = normalizeOptionalText(params.shipperReferenceKey);
    const number = normalizeOptionalText(params.shipperReferenceNumber);
    return Array.from(new Set([
        key ? getDeliveryOrderSuratJalanIdentity({ deliveryOrderId, shipperReferenceKey: key }) : '',
        number ? getDeliveryOrderSuratJalanIdentity({ deliveryOrderId, shipperReferenceNumber: number }) : '',
        !key && !number ? getDeliveryOrderSuratJalanIdentity({ deliveryOrderId }) : '',
    ].filter(Boolean)));
}

function intersectsPendingFinalization(
    pendingRefs: Set<string>,
    candidates: string[]
) {
    return candidates.some(candidate => pendingRefs.has(candidate));
}

export function pendingFinalizationReferenceLabel(
    deliveryOrderId: string,
    pendingRefs: Set<string>,
    fallback = 'SJ ini'
) {
    const first = Array.from(pendingRefs)[0];
    if (!first) return fallback;
    return first.startsWith(`${deliveryOrderId}:`)
        ? first.slice(`${deliveryOrderId}:`.length) || fallback
        : first;
}

export function getPendingShipperReferenceMutationMessage(
    deliveryOrder: PendingDriverApprovalSource & {
        shipperReferences?: DeliveryOrder['shipperReferences'];
    },
    nextShipperReferences: NonNullable<DeliveryOrder['shipperReferences']>
) {
    const blockingRequest = getBlockingPendingDriverApprovalRequest(deliveryOrder);
    if (blockingRequest) {
        return 'SJ/barang tidak bisa diubah karena trip masih punya permintaan driver yang menunggu approval admin.';
    }

    const pendingRefs = getPendingFinalizationSuratJalanRefSet(deliveryOrder);
    if (pendingRefs.size === 0) {
        return '';
    }

    const nextByKey = new Map(
        nextShipperReferences
            .map(reference => [normalizeOptionalText(reference._key), reference] as const)
            .filter((entry): entry is [string, NonNullable<typeof entry[1]>] => Boolean(entry[0]))
    );
    const nextByNumber = new Map(
        nextShipperReferences
            .map(reference => [normalizeOptionalText(reference.referenceNumber)?.toUpperCase(), reference] as const)
            .filter((entry): entry is [string, NonNullable<typeof entry[1]>] => Boolean(entry[0]))
    );

    for (const currentReference of deliveryOrder.shipperReferences || []) {
        const candidates = getSuratJalanIdentityCandidates(deliveryOrder._id, {
            shipperReferenceKey: currentReference._key,
            shipperReferenceNumber: currentReference.referenceNumber,
        });
        if (!intersectsPendingFinalization(pendingRefs, candidates)) {
            continue;
        }

        const currentKey = normalizeOptionalText(currentReference._key);
        const currentNumber = normalizeOptionalText(currentReference.referenceNumber)?.toUpperCase();
        const nextReference =
            (currentKey ? nextByKey.get(currentKey) : undefined) ||
            (currentNumber ? nextByNumber.get(currentNumber) : undefined);
        if (!nextReference) {
            return `SJ ${currentReference.referenceNumber || pendingFinalizationReferenceLabel(deliveryOrder._id, pendingRefs)} sedang menunggu approval admin dan tidak boleh dihapus dulu.`;
        }

        const nextNumber = normalizeOptionalText(nextReference.referenceNumber)?.toUpperCase();
        const currentPickup = normalizeOptionalText(currentReference.pickupStopKey);
        const nextPickup = normalizeOptionalText(nextReference.pickupStopKey);
        if (currentNumber !== nextNumber || currentPickup !== nextPickup) {
            return `SJ ${currentReference.referenceNumber || pendingFinalizationReferenceLabel(deliveryOrder._id, pendingRefs)} sedang menunggu approval admin dan tidak boleh diubah dulu.`;
        }
    }

    return '';
}

export function isCargoItemTargetedByPendingFinalization(
    deliveryOrderId: string,
    pendingRefs: Set<string>,
    item: {
        shipperReferenceKey?: string | null;
        shipperReferenceNumber?: string | null;
    }
) {
    return intersectsPendingFinalization(
        pendingRefs,
        getSuratJalanIdentityCandidates(deliveryOrderId, {
            shipperReferenceKey: item.shipperReferenceKey,
            shipperReferenceNumber: item.shipperReferenceNumber,
        })
    );
}

export function clearLegacyPendingDriverRequestFields() {
    return {
        pendingDriverStatus: null,
        pendingDriverStatusRequestedAt: null,
        pendingDriverStatusRequestedBy: null,
        pendingDriverStatusRequestedByName: null,
        pendingDriverStatusNote: null,
        pendingDriverStatusSuratJalanRefs: null,
        pendingDriverPodReceiverName: null,
        pendingDriverPodReceivedDate: null,
        pendingDriverPodNote: null,
        pendingDriverActualCargoItems: null,
        pendingDriverActualDropPoints: null,
    };
}
