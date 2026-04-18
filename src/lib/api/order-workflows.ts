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
import { getSanityClient, sanityGetById, sanityGetNextNumber } from '@/lib/sanity';

import {
    assertIsoDate,
    computeLedgerDebitBalance,
    extractRefId,
    getLedgerAccount,
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
    type VolumeInputUnit,
    type WeightInputUnit,
} from '@/lib/measurement';
import {
    buildDeliveryOrderCustomerDoConstraintDoc,
    buildDeliveryOrderCustomerDoConstraintId,
    DO_STATUS_TRANSITIONS,
    DRIVER_APPROVAL_REQUESTABLE_DO_STATUSES,
    DRIVER_STATUS_REQUEST_FIELDS,
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
import { resolveTripRouteRateSelection } from './generic-workflow-support';
import { buildRouteLabel, computeDriverVoucherTotals } from './driver-workflow-support';
import { computeDeliveryOrderOvertonage } from '@/lib/delivery-order-overtonage';
import type {
    CompanyProfile,
    DeliveryActualDropPoint,
    DeliveryOrderPickupStop,
    DeliveryOrderShipperReference,
    OrderPickupStop,
    OrderTripPlan,
} from '@/lib/types';

type AuditLogFn = (
    session: Pick<ApiSession, '_id' | 'name'>,
    action: string,
    entityType: string,
    entityRef: string,
    summary: string
) => void | Promise<void>;

type SanityMutations = Parameters<ReturnType<typeof getSanityClient>['mutate']>[0];

function isDocumentAlreadyExistsError(error: unknown, documentId?: string) {
    const statusCode =
        error && typeof error === 'object' && 'statusCode' in error && typeof (error as { statusCode?: unknown }).statusCode === 'number'
            ? (error as { statusCode: number }).statusCode
            : error && typeof error === 'object' && 'status' in error && typeof (error as { status?: unknown }).status === 'number'
                ? (error as { status: number }).status
                : undefined;
    const message =
        error instanceof Error
            ? error.message
            : error && typeof error === 'object' && 'message' in error && typeof (error as { message?: unknown }).message === 'string'
                ? (error as { message: string }).message
                : '';

    if (statusCode !== 409 && !/already exists/i.test(message)) {
        return false;
    }
    if (!documentId) {
        return /already exists/i.test(message);
    }
    return message.includes(documentId) && /already exists/i.test(message);
}

type NormalizedOrderPickupStop = Required<Pick<OrderPickupStop, 'sequence' | 'pickupAddress'>> & {
    _key: string;
    customerPickupRef?: string;
    pickupLabel?: string;
    notes?: string;
};

type NormalizedOrderTripPlan = Required<Pick<OrderTripPlan, 'sequence' | 'vehicleRef' | 'driverRef' | 'issueBankRef' | 'cashGiven' | 'date'>> & {
    _key: string;
    pickupStopKeys: string[];
    vehiclePlate?: string;
    vehicleServiceRef?: string;
    vehicleServiceName?: string;
    vehicleCategoryOverrideReason?: string;
    driverName?: string;
    tripRouteRateRef?: string;
    tripOriginArea?: string;
    tripDestinationArea?: string;
    taripBorongan?: number;
    issueBankName?: string;
    notes?: string;
    linkedDeliveryOrderRef?: string;
    linkedDeliveryOrderNumber?: string;
};

type NormalizedDeliveryOrderPickupStop = Required<Pick<DeliveryOrderPickupStop, 'sequence' | 'pickupAddress'>> & {
    _key: string;
    orderPickupStopKey?: string;
    customerPickupRef?: string;
    pickupLabel?: string;
    notes?: string;
};

type NormalizedDeliveryOrderShipperReference = Required<Pick<DeliveryOrderShipperReference, 'sequence' | 'referenceNumber'>> & {
    _key: string;
    pickupStopKey?: string;
    pickupAddress?: string;
    billingCustomerRef?: string;
    billingCustomerName?: string;
    receiverName?: string;
    receiverPhone?: string;
    receiverAddress?: string;
    receiverCompany?: string;
    notes?: string;
};

function normalizeReferenceNumber(value: unknown) {
    return normalizeOptionalText(value)?.toUpperCase() || '';
}

function hasDraftCargoPayloadRow(row: Record<string, unknown>) {
    return Boolean(
        normalizeOptionalText(row.description) ||
        normalizeOptionalText(row.customerProductRef) ||
        normalizeNumber(row.qtyKoli) > 0 ||
        normalizeNumber(row.weightInputValue) > 0 ||
        normalizeNumber(row.volumeInputValue) > 0
    );
}

function buildPickupSummary(stops: Array<{ pickupAddress?: string; pickupLabel?: string }>, fallback?: string) {
    if (stops.length === 0) {
        return normalizeOptionalText(fallback) || undefined;
    }
    if (stops.length === 1) {
        return normalizeOptionalText(stops[0].pickupAddress) || normalizeOptionalText(stops[0].pickupLabel) || undefined;
    }
    return `${stops.length} titik pickup | ${normalizeOptionalText(stops[0].pickupLabel) || normalizeOptionalText(stops[0].pickupAddress) || 'Stop 1'}`;
}

async function resolveNormalizedOrderPickupStops(
    customerRef: string,
    data: Record<string, unknown>,
    fallbackAddress?: string
): Promise<NormalizedOrderPickupStop[]> {
    const rawStops = Array.isArray(data.pickupStops) ? data.pickupStops.filter(isPlainObject) : [];
    const fallbackRows =
        rawStops.length > 0
            ? rawStops
            : [
                {
                    customerPickupRef: normalizeOptionalText(data.customerPickupRef),
                    pickupAddress: normalizeOptionalText(data.pickupAddress) || normalizeOptionalText(fallbackAddress) || '',
                },
            ];

    const pickupRefs = Array.from(
        new Set(
            fallbackRows
                .map(row => normalizeOptionalText(row.customerPickupRef))
                .filter((value): value is string => Boolean(value))
        )
    );
    const resolvedPickupMap = new Map<string, ResolvedCustomerPickupData>();
    if (pickupRefs.length > 0) {
        const resolvedPickups = await Promise.all(
            pickupRefs.map(async ref => ({
                ref,
                pickup: await resolveOrderPickupData(customerRef, ref),
            }))
        );
        resolvedPickups.forEach(({ ref, pickup }) => {
            if (pickup) {
                resolvedPickupMap.set(ref, pickup);
            }
        });
    }

    const normalizedStops: NormalizedOrderPickupStop[] = [];
    for (const [index, rawStop] of fallbackRows.entries()) {
        const customerPickupRef = normalizeOptionalText(rawStop.customerPickupRef);
        const matchedPickup = customerPickupRef ? resolvedPickupMap.get(customerPickupRef) || null : null;
        const pickupLabel = normalizeOptionalText(rawStop.pickupLabel) || normalizeOptionalText(matchedPickup?.label) || undefined;
        const pickupAddress = normalizeOptionalText(rawStop.pickupAddress) || normalizeOptionalText(matchedPickup?.pickupAddress) || '';
        const notes = normalizeOptionalText(rawStop.notes) || undefined;

        if (!customerPickupRef && !pickupLabel && !pickupAddress && !notes) {
            continue;
        }
        if (!pickupAddress) {
            throw new Error(`Alamat pickup pada titik ke-${index + 1} wajib diisi`);
        }

        normalizedStops.push({
            _key: normalizeOptionalText(rawStop._key) || normalizeOptionalText(rawStop.id) || crypto.randomUUID(),
            sequence: normalizedStops.length + 1,
            customerPickupRef: customerPickupRef || undefined,
            pickupLabel,
            pickupAddress,
            notes,
        });
    }

    if (normalizedStops.length > 0) {
        return normalizedStops;
    }

    const fallbackPickupAddress = normalizeOptionalText(data.pickupAddress) || normalizeOptionalText(fallbackAddress);
    if (!fallbackPickupAddress) {
        throw new Error('Minimal 1 titik pickup wajib diisi');
    }

    return [{
        _key: crypto.randomUUID(),
        sequence: 1,
        pickupAddress: fallbackPickupAddress,
    }];
}

function getOrderPickupStopsSnapshot(order: {
    pickupStops?: OrderPickupStop[];
    customerPickupRef?: string;
    pickupAddress?: string;
}) {
    const normalizedStops: NormalizedOrderPickupStop[] = [];
    for (const [index, stop] of (order.pickupStops || []).entries()) {
        const pickupAddress = normalizeOptionalText(stop.pickupAddress);
        if (!pickupAddress) {
            continue;
        }
        normalizedStops.push({
            _key: normalizeOptionalText(stop._key) || `pickup-stop-${index + 1}`,
            sequence: Number.isFinite(stop.sequence) && stop.sequence > 0 ? stop.sequence : index + 1,
            customerPickupRef: normalizeOptionalText(stop.customerPickupRef) || undefined,
            pickupLabel: normalizeOptionalText(stop.pickupLabel) || undefined,
            pickupAddress,
            notes: normalizeOptionalText(stop.notes) || undefined,
        });
    }
    normalizedStops.sort((left, right) => left.sequence - right.sequence);

    if (normalizedStops.length > 0) {
        return normalizedStops;
    }

    const pickupAddress = normalizeOptionalText(order.pickupAddress);
    if (!pickupAddress) {
        return [] as NormalizedOrderPickupStop[];
    }

    return [{
        _key: 'pickup-stop-1',
        sequence: 1,
        customerPickupRef: normalizeOptionalText(order.customerPickupRef) || undefined,
        pickupAddress,
    }];
}

function normalizeOrderTripPlansSnapshot(tripPlans: OrderTripPlan[] | undefined) {
    const normalizedPlans: NormalizedOrderTripPlan[] = [];
    for (const [index, plan] of (tripPlans || []).entries()) {
        const vehicleRef = normalizeOptionalText(plan.vehicleRef);
        const driverRef = normalizeOptionalText(plan.driverRef);
        const issueBankRef = normalizeOptionalText(plan.issueBankRef);
        const cashGiven = normalizeCurrencyNumber(plan.cashGiven ?? 0);
        const date = normalizeOptionalText(plan.date) || getBusinessDateValue();
        if (!vehicleRef || !driverRef || !issueBankRef || !Number.isFinite(cashGiven) || cashGiven <= 0) {
            continue;
        }

        normalizedPlans.push({
            _key: normalizeOptionalText(plan._key) || crypto.randomUUID(),
            sequence: Number.isFinite(plan.sequence) && plan.sequence > 0 ? plan.sequence : index + 1,
            pickupStopKeys: Array.isArray(plan.pickupStopKeys)
                ? plan.pickupStopKeys.map(value => normalizeOptionalText(value)).filter((value): value is string => Boolean(value))
                : [],
            vehicleRef,
            vehiclePlate: normalizeOptionalText(plan.vehiclePlate) || undefined,
            vehicleServiceRef: normalizeOptionalText(plan.vehicleServiceRef) || undefined,
            vehicleServiceName: normalizeOptionalText(plan.vehicleServiceName) || undefined,
            vehicleCategoryOverrideReason: normalizeOptionalText(plan.vehicleCategoryOverrideReason) || undefined,
            driverRef,
            driverName: normalizeOptionalText(plan.driverName) || undefined,
            tripRouteRateRef: normalizeOptionalText(plan.tripRouteRateRef) || undefined,
            tripOriginArea: normalizeOptionalText(plan.tripOriginArea) || undefined,
            tripDestinationArea: normalizeOptionalText(plan.tripDestinationArea) || undefined,
            taripBorongan: normalizeCurrencyNumber(plan.taripBorongan ?? 0) || undefined,
            issueBankRef,
            issueBankName: normalizeOptionalText(plan.issueBankName) || undefined,
            cashGiven,
            date,
            notes: normalizeOptionalText(plan.notes) || undefined,
            linkedDeliveryOrderRef: normalizeOptionalText(plan.linkedDeliveryOrderRef) || undefined,
            linkedDeliveryOrderNumber: normalizeOptionalText(plan.linkedDeliveryOrderNumber) || undefined,
        });
    }
    return normalizedPlans.sort((left, right) => left.sequence - right.sequence);
}

function resolveDeliveryOrderPickupStops(
    order: {
        pickupStops?: OrderPickupStop[];
        customerPickupRef?: string;
        pickupAddress?: string;
    },
    data: Record<string, unknown>
): NormalizedDeliveryOrderPickupStop[] {
    const orderPickupStops = getOrderPickupStopsSnapshot(order);
    if (orderPickupStops.length === 0) {
        return [];
    }

    const requestedKeys = Array.from(
        new Set(
            (Array.isArray(data.pickupStopKeys) ? data.pickupStopKeys : [])
                .filter((value): value is string => typeof value === 'string')
                .map(value => value.trim())
                .filter(Boolean)
        )
    );

    const selectedStops =
        requestedKeys.length > 0
            ? orderPickupStops.filter(stop => requestedKeys.includes(stop._key))
            : orderPickupStops;

    if (requestedKeys.length > 0 && selectedStops.length !== requestedKeys.length) {
        throw new Error('Sebagian titik pickup order untuk surat jalan tidak ditemukan');
    }

    return selectedStops.map((stop, index) => ({
        _key: stop._key,
        sequence: index + 1,
        orderPickupStopKey: stop._key,
        customerPickupRef: stop.customerPickupRef,
        pickupLabel: stop.pickupLabel,
        pickupAddress: stop.pickupAddress,
        notes: stop.notes,
    }));
}

function normalizeDeliveryOrderPickupStopsSnapshot(pickupStops: DeliveryOrderPickupStop[] | undefined) {
    const normalizedStops: NormalizedDeliveryOrderPickupStop[] = [];
    for (const [index, stop] of (pickupStops || []).entries()) {
        const pickupAddress = normalizeOptionalText(stop.pickupAddress);
        if (!pickupAddress) {
            continue;
        }
        normalizedStops.push({
            _key: normalizeOptionalText(stop._key) || `pickup-stop-${index + 1}`,
            sequence: Number.isFinite(stop.sequence) && stop.sequence > 0 ? stop.sequence : index + 1,
            orderPickupStopKey: normalizeOptionalText(stop.orderPickupStopKey) || undefined,
            customerPickupRef: normalizeOptionalText(stop.customerPickupRef) || undefined,
            pickupLabel: normalizeOptionalText(stop.pickupLabel) || undefined,
            pickupAddress,
            notes: normalizeOptionalText(stop.notes) || undefined,
        });
    }
    normalizedStops.sort((left, right) => left.sequence - right.sequence);
    return normalizedStops;
}

function normalizeExistingShipperReferences(existing: DeliveryOrderShipperReference[] | undefined, pickupStops: NormalizedDeliveryOrderPickupStop[]) {
    const pickupMap = new Map(pickupStops.map(stop => [stop._key, stop]));
    const normalizedReferences: NormalizedDeliveryOrderShipperReference[] = [];
    for (const [index, reference] of (existing || []).entries()) {
        const referenceNumber = normalizeReferenceNumber(reference.referenceNumber);
        if (!referenceNumber) {
            continue;
        }
        const pickupStopKey = normalizeOptionalText(reference.pickupStopKey) || undefined;
        const matchedStop = pickupStopKey ? pickupMap.get(pickupStopKey) : undefined;
        normalizedReferences.push({
            _key: normalizeOptionalText(reference._key) || crypto.randomUUID(),
            sequence: Number.isFinite(reference.sequence) && reference.sequence > 0 ? reference.sequence : index + 1,
            referenceNumber,
            pickupStopKey,
            pickupAddress: normalizeOptionalText(reference.pickupAddress) || matchedStop?.pickupAddress || undefined,
            billingCustomerRef: normalizeOptionalText(reference.billingCustomerRef) || undefined,
            billingCustomerName: normalizeOptionalText(reference.billingCustomerName) || undefined,
            receiverName: normalizeOptionalText(reference.receiverName) || undefined,
            receiverPhone: normalizeOptionalText(reference.receiverPhone) || undefined,
            receiverAddress: normalizeOptionalText(reference.receiverAddress) || undefined,
            receiverCompany: normalizeOptionalText(reference.receiverCompany) || undefined,
            notes: normalizeOptionalText(reference.notes) || undefined,
        });
    }
    return normalizedReferences;
}

function normalizeDeliveryOrderPersistedShipperReferences(
    deliveryOrder: {
        shipperReferences?: DeliveryOrderShipperReference[];
        customerDoNumber?: string;
        pickupAddress?: string;
    },
    pickupStops: NormalizedDeliveryOrderPickupStop[]
) {
    const normalizedReferences = normalizeExistingShipperReferences(deliveryOrder.shipperReferences, pickupStops);
    if (normalizedReferences.length > 0) {
        return normalizedReferences;
    }

    const legacyReferenceNumber = normalizeReferenceNumber(deliveryOrder.customerDoNumber);
    if (!legacyReferenceNumber) {
        return normalizedReferences;
    }

    const singlePickupStop = pickupStops.length === 1 ? pickupStops[0] : undefined;
    return [{
        _key: 'legacy-customer-do-number',
        sequence: 1,
        referenceNumber: legacyReferenceNumber,
        pickupStopKey: singlePickupStop?._key,
        pickupAddress: singlePickupStop?.pickupAddress || normalizeOptionalText(deliveryOrder.pickupAddress) || undefined,
        billingCustomerRef: undefined,
        billingCustomerName: undefined,
        receiverName: undefined,
        receiverPhone: undefined,
        receiverAddress: undefined,
        receiverCompany: undefined,
        notes: undefined,
    }];
}

function describePickupStop(stop?: { pickupLabel?: string; pickupAddress?: string }) {
    return normalizeOptionalText(stop?.pickupLabel) || normalizeOptionalText(stop?.pickupAddress) || 'titik pickup';
}

function upsertShipperReferenceForPickup(
    references: NormalizedDeliveryOrderShipperReference[],
    referenceNumber: string,
    pickupStopKey: string | undefined,
    pickupMap: Map<string, NormalizedDeliveryOrderPickupStop>,
    referenceLabel = 'SJ pengirim'
) {
    const existingIndex = references.findIndex(reference => reference.referenceNumber === referenceNumber);
    if (existingIndex >= 0) {
        const current = references[existingIndex];
        if (
            pickupStopKey &&
            current.pickupStopKey &&
            current.pickupStopKey !== pickupStopKey
        ) {
            throw new Error(
                `${referenceLabel} ${referenceNumber} tidak boleh dipakai di dua titik pickup berbeda dalam satu surat jalan (${describePickupStop(pickupMap.get(current.pickupStopKey))} dan ${describePickupStop(pickupMap.get(pickupStopKey))}).`
            );
        }
        if (pickupStopKey && !current.pickupStopKey) {
            references[existingIndex] = {
                ...current,
                pickupStopKey,
                pickupAddress: pickupMap.get(pickupStopKey)?.pickupAddress || current.pickupAddress,
            };
        }
        return references[existingIndex];
    }

    const createdReference: NormalizedDeliveryOrderShipperReference = {
        _key: crypto.randomUUID(),
        sequence: references.length + 1,
        referenceNumber,
        pickupStopKey,
        pickupAddress: pickupStopKey ? pickupMap.get(pickupStopKey)?.pickupAddress : undefined,
        receiverName: undefined,
        receiverPhone: undefined,
        receiverAddress: undefined,
        receiverCompany: undefined,
        billingCustomerRef: undefined,
        billingCustomerName: undefined,
    };
    references.push(createdReference);
    return createdReference;
}

function normalizeIncomingShipperReferences(
    data: Record<string, unknown>,
    pickupStops: NormalizedDeliveryOrderPickupStop[],
    existing: DeliveryOrderShipperReference[] | undefined,
    preserveWhenMissing = false
) {
    const hasExplicitArray = Array.isArray(data.shipperReferences);
    const hasLegacySingle = Boolean(normalizeReferenceNumber(data.customerDoNumber));
    if (!hasExplicitArray && !hasLegacySingle) {
        return preserveWhenMissing ? normalizeExistingShipperReferences(existing, pickupStops) : [];
    }

    const pickupMap = new Map(pickupStops.map(stop => [stop._key, stop]));
    const normalizedExisting = normalizeExistingShipperReferences(existing, pickupStops);
    const existingByNumber = new Map(
        normalizedExisting.map(reference => [reference.referenceNumber, reference])
    );
    const existingByKey = new Map(
        normalizedExisting
            .filter(reference => reference._key)
            .map(reference => [reference._key as string, reference])
    );
    const rows = hasExplicitArray
        ? (data.shipperReferences as unknown[]).map(item => (isPlainObject(item) ? item : { referenceNumber: item }))
        : [{ referenceNumber: data.customerDoNumber }];

    const seen = new Set<string>();
    const normalized: NormalizedDeliveryOrderShipperReference[] = [];
    for (const row of rows) {
        const incomingReferenceKey = normalizeOptionalText(row._key ?? row.referenceKey) || undefined;
        const referenceNumber = normalizeReferenceNumber(row.referenceNumber ?? row.customerDoNumber);
        const pickupStopKey = normalizeOptionalText(row.pickupStopKey) || undefined;
        const notes = normalizeOptionalText(row.notes) || undefined;
        const billingCustomerRef = normalizeOptionalText(row.billingCustomerRef) || undefined;
        const billingCustomerName = normalizeOptionalText(row.billingCustomerName) || undefined;
        const receiverName = normalizeOptionalText(row.receiverName) || undefined;
        const receiverPhone = normalizeOptionalText(row.receiverPhone) || undefined;
        const receiverAddress = normalizeOptionalText(row.receiverAddress) || undefined;
        const receiverCompany = normalizeOptionalText(row.receiverCompany) || undefined;
        if (!referenceNumber) {
            continue;
        }
        if (pickupStopKey && !pickupMap.has(pickupStopKey)) {
            throw new Error(`Titik pickup untuk SJ pengirim ${referenceNumber} tidak ditemukan di surat jalan`);
        }
        if (seen.has(referenceNumber)) {
            const currentReference = normalized.find(reference => reference.referenceNumber === referenceNumber);
            if (
                currentReference &&
                pickupStopKey &&
                currentReference.pickupStopKey &&
                currentReference.pickupStopKey !== pickupStopKey
            ) {
                throw new Error(
                    `SJ pengirim ${referenceNumber} tidak boleh dipakai di dua titik pickup berbeda dalam satu surat jalan (${describePickupStop(pickupMap.get(currentReference.pickupStopKey))} dan ${describePickupStop(pickupMap.get(pickupStopKey))}).`
                );
            }
            if (currentReference && pickupStopKey && !currentReference.pickupStopKey) {
                currentReference.pickupStopKey = pickupStopKey;
                currentReference.pickupAddress = pickupMap.get(pickupStopKey)?.pickupAddress || currentReference.pickupAddress;
            }
            if (currentReference) {
                currentReference.billingCustomerRef = billingCustomerRef || currentReference.billingCustomerRef;
                currentReference.billingCustomerName = billingCustomerName || currentReference.billingCustomerName;
                currentReference.receiverName = receiverName || currentReference.receiverName;
                currentReference.receiverPhone = receiverPhone || currentReference.receiverPhone;
                currentReference.receiverAddress = receiverAddress || currentReference.receiverAddress;
                currentReference.receiverCompany = receiverCompany || currentReference.receiverCompany;
                currentReference.notes = notes || currentReference.notes;
            }
            continue;
        }
        seen.add(referenceNumber);
        const existingReference =
            (incomingReferenceKey ? existingByKey.get(incomingReferenceKey) : undefined)
            || existingByNumber.get(referenceNumber);
        const matchedStop = pickupStopKey ? pickupMap.get(pickupStopKey) : undefined;
        normalized.push({
            _key: existingReference?._key || incomingReferenceKey || crypto.randomUUID(),
            sequence: normalized.length + 1,
            referenceNumber,
            pickupStopKey: pickupStopKey || existingReference?.pickupStopKey,
            pickupAddress:
                normalizeOptionalText(row.pickupAddress) ||
                matchedStop?.pickupAddress ||
                existingReference?.pickupAddress ||
                undefined,
            billingCustomerRef: billingCustomerRef || existingReference?.billingCustomerRef,
            billingCustomerName: billingCustomerName || existingReference?.billingCustomerName,
            receiverName: receiverName || existingReference?.receiverName,
            receiverPhone: receiverPhone || existingReference?.receiverPhone,
            receiverAddress: receiverAddress || existingReference?.receiverAddress,
            receiverCompany: receiverCompany || existingReference?.receiverCompany,
            notes: notes || existingReference?.notes,
        });
    }

    return normalized;
}

function serializeShipperReferenceSnapshot(references: NormalizedDeliveryOrderShipperReference[]) {
    return JSON.stringify(
        references.map(reference => ({
            key: reference._key || '',
            referenceNumber: reference.referenceNumber,
            pickupStopKey: reference.pickupStopKey || '',
            billingCustomerRef: reference.billingCustomerRef || '',
            billingCustomerName: reference.billingCustomerName || '',
            receiverName: reference.receiverName || '',
            receiverPhone: reference.receiverPhone || '',
            receiverAddress: reference.receiverAddress || '',
            receiverCompany: reference.receiverCompany || '',
            notes: reference.notes || '',
        }))
    );
}

type DeliveryOrderCargoReferenceSnapshot = {
    pickupStopKey?: string;
    pickupAddress?: string;
    shipperReferenceNumber?: string;
};

function buildShipperReferencesFromCargoSnapshots(
    items: DeliveryOrderCargoReferenceSnapshot[],
    pickupStops: NormalizedDeliveryOrderPickupStop[],
    existing: DeliveryOrderShipperReference[] | undefined
) {
    const pickupMap = new Map(pickupStops.map(stop => [stop._key, stop]));
    const existingByNumber = new Map(
        normalizeExistingShipperReferences(existing, pickupStops).map(reference => [reference.referenceNumber, reference])
    );
    const references: NormalizedDeliveryOrderShipperReference[] = [];

    for (const item of items) {
        const referenceNumber = normalizeReferenceNumber(item.shipperReferenceNumber);
        if (!referenceNumber) {
            continue;
        }
        const pickupStopKey = normalizeOptionalText(item.pickupStopKey) || undefined;
        if (pickupStopKey && !pickupMap.has(pickupStopKey)) {
            throw new Error(`Titik pickup untuk SJ pengirim ${referenceNumber} tidak ditemukan di surat jalan`);
        }
        const reference = upsertShipperReferenceForPickup(references, referenceNumber, pickupStopKey, pickupMap);
        if (!reference.pickupAddress) {
            reference.pickupAddress = normalizeOptionalText(item.pickupAddress) || reference.pickupAddress;
        }
    }

    return references.map((reference, index) => {
        const existingReference = existingByNumber.get(reference.referenceNumber);
        return {
            ...reference,
            _key: existingReference?._key || reference._key,
            sequence: index + 1,
            pickupStopKey: reference.pickupStopKey || existingReference?.pickupStopKey,
            pickupAddress: reference.pickupAddress || existingReference?.pickupAddress,
            billingCustomerRef: reference.billingCustomerRef || existingReference?.billingCustomerRef,
            billingCustomerName: reference.billingCustomerName || existingReference?.billingCustomerName,
            notes: reference.notes || existingReference?.notes,
        };
    });
}

function preserveExistingShipperReferences(
    nextReferences: NormalizedDeliveryOrderShipperReference[],
    existing: DeliveryOrderShipperReference[] | undefined,
    pickupStops: NormalizedDeliveryOrderPickupStop[]
) {
    const normalizedExisting = normalizeExistingShipperReferences(existing, pickupStops);
    if (normalizedExisting.length === 0) {
        return nextReferences.map((reference, index) => ({
            ...reference,
            sequence: index + 1,
        }));
    }

    const nextByKey = new Map(
        nextReferences
            .filter(reference => reference._key)
            .map(reference => [reference._key as string, reference])
    );
    const nextByNumber = new Map(
        nextReferences.map(reference => [reference.referenceNumber, reference])
    );
    const merged: NormalizedDeliveryOrderShipperReference[] = [];

    for (const existingReference of normalizedExisting) {
        const matchedReference =
            (existingReference._key ? nextByKey.get(existingReference._key) : undefined)
            || nextByNumber.get(existingReference.referenceNumber);
        if (matchedReference) {
            if (matchedReference._key) {
                nextByKey.delete(matchedReference._key);
            }
            nextByNumber.delete(matchedReference.referenceNumber);
            merged.push({
                ...existingReference,
                ...matchedReference,
                _key: existingReference._key || matchedReference._key,
            });
            continue;
        }

        merged.push(existingReference);
    }

    for (const reference of nextReferences) {
        if (!nextByNumber.has(reference.referenceNumber)) {
            continue;
        }
        nextByNumber.delete(reference.referenceNumber);
        if (reference._key) {
            nextByKey.delete(reference._key);
        }
        merged.push(reference);
    }

    return merged.map((reference, index) => ({
        ...reference,
        sequence: index + 1,
    }));
}

function buildCustomerDoConstraintDocs(deliveryOrderId: string, customerRef: string, references: NormalizedDeliveryOrderShipperReference[]) {
    return references.map(reference =>
        buildDeliveryOrderCustomerDoConstraintDoc(deliveryOrderId, customerRef, reference.referenceNumber)
    );
}

async function getExistingDeliveryOrderCustomerDoConstraintIds(deliveryOrderId: string) {
    if (!normalizeText(deliveryOrderId)) {
        return [];
    }

    const constraintIds = await getSanityClient().fetch<Array<{ _id: string }>>(
        `*[
            _type == "uniqueConstraint" &&
            entityType == "deliveryOrder" &&
            fieldName == "customerRefCustomerDoNumber" &&
            ownerRef == $deliveryOrderId
        ]{
            _id
        }`,
        { deliveryOrderId }
    );

    return constraintIds
        .map(item => normalizeOptionalText(item._id))
        .filter((value): value is string => Boolean(value));
}

async function findDuplicateCustomerDoReference(
    customerRef: string,
    references: Array<{ referenceNumber: string }>,
    excludeDeliveryOrderId?: string
) {
    const normalizedCustomerRef = normalizeText(customerRef);
    if (!normalizedCustomerRef || references.length === 0) {
        return null;
    }

    const numbers = references
        .map(reference => normalizeText(reference.referenceNumber).toLowerCase())
        .filter(Boolean);
    if (numbers.length === 0) {
        return null;
    }

    const duplicates = await getSanityClient().fetch<Array<{
        customerDoNumber?: string;
        shipperReferences?: Array<{ referenceNumber?: string }>;
    }>>(
        `*[
            _type == "deliveryOrder" &&
            _id != $excludeDeliveryOrderId &&
            (customerRef == $customerRef || customerRef._ref == $customerRef) &&
            (
                lower(coalesce(customerDoNumber, "")) in $numbers ||
                count(shipperReferences[lower(coalesce(referenceNumber, "")) in $numbers]) > 0
            )
        ]{
            customerDoNumber,
            shipperReferences[]{
                referenceNumber
            }
        }`,
        {
            customerRef: normalizedCustomerRef,
            numbers,
            excludeDeliveryOrderId: excludeDeliveryOrderId || '',
        }
    );

    if (duplicates.length === 0) {
        return null;
    }

    const duplicateSet = new Set<string>();
    duplicates.forEach(item => {
        const customerDoNumber = normalizeText(item.customerDoNumber).toLowerCase();
        if (customerDoNumber) {
            duplicateSet.add(customerDoNumber);
        }
        (item.shipperReferences || []).forEach(reference => {
            const referenceNumber = normalizeText(reference.referenceNumber).toLowerCase();
            if (referenceNumber) {
                duplicateSet.add(referenceNumber);
            }
        });
    });
    return references.find(reference => duplicateSet.has(normalizeText(reference.referenceNumber).toLowerCase())) || null;
}

async function releaseDriverTrackingLockIfOwned(driverRef: unknown, deliveryOrderRef: string, timestamp: string) {
    const driverId = extractRefId(driverRef);
    if (!driverId) {
        return;
    }

    const driver = await sanityGetById<{ _id: string; _rev?: string; activeTrackingDeliveryOrderRef?: unknown }>(driverId);
    if (!driver?._rev) {
        return;
    }

    if (extractRefId(driver.activeTrackingDeliveryOrderRef) !== deliveryOrderRef) {
        return;
    }

    await getSanityClient()
        .patch(driverId)
        .ifRevisionId(driver._rev)
        .unset(['activeTrackingDeliveryOrderRef'])
        .set({ activeTrackingUpdatedAt: timestamp })
        .commit();
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

function patchLinkedCustomerProducts(
    transaction: ReturnType<ReturnType<typeof getSanityClient>['transaction']>,
    items: NormalizedOrderItemInput[],
    timestamp: string
) {
    const seenProductRefs = new Set<string>();
    for (const item of items) {
        if (!item.customerProductRef || seenProductRefs.has(item.customerProductRef)) {
            continue;
        }
        if (!item.customerProductRevision) {
            throw new Error('Revisi barang customer tidak tersedia. Refresh lalu coba lagi.');
        }
        transaction.patch(item.customerProductRef, {
            ifRevisionID: item.customerProductRevision,
            set: { updatedAt: timestamp },
        });
        seenProductRefs.add(item.customerProductRef);
    }
}

export async function syncOrderStatusFromItems(orderRef: string, session: ApiSession, addAuditLog: AuditLogFn) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
        const order = await sanityGetById<{ _id: string; _rev?: string; status?: string }>(orderRef);
        if (!order || order.status === 'CANCELLED') {
            return;
        }

        const items = await getSanityClient().fetch<OrderItemStatusSummary[]>(
            `*[_type == "orderItem" && orderRef == $orderRef]{
                status,
                qtyKoli,
                weight,
                volume,
                deliveredQtyKoli,
                deliveredWeight,
                deliveredVolume,
                assignedQtyKoli,
                assignedWeight,
                assignedVolume,
                heldQtyKoli,
                heldWeight,
                heldVolume
            }`,
            { orderRef }
        );
        const nextStatus = deriveOrderStatusFromItems(items);

        if (order.status === nextStatus) {
            return;
        }
        if (!order._rev) {
            return;
        }

        try {
            await getSanityClient()
                .patch(orderRef)
                .ifRevisionId(order._rev)
                .set({ status: nextStatus })
                .commit();
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
        maxFractionDigits: holdWeightInputUnit === 'TON' ? 3 : 2,
    }), holdWeightInputUnit === 'TON' ? 3 : 2);
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

    const orderItem = await sanityGetById<OrderItemProgressSnapshot & { _rev?: string }>(id);
    if (!orderItem) {
        return NextResponse.json({ error: 'Item order tidak ditemukan' }, { status: 404 });
    }
    if (!orderItem._rev) {
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
            const patch = getSanityClient().patch(id).ifRevisionId(orderItem._rev).set(updates);
            if (!holdLocation) {
                patch.unset(['holdLocation']);
            }
            updated = await patch.commit();
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
        const patch = getSanityClient().patch(id).ifRevisionId(orderItem._rev).set(updates);
        if (!holdLocation) {
            patch.unset(['holdLocation']);
        }
        updated = await patch.commit();
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

    const orderItem = await sanityGetById<OrderItemProgressSnapshot & { _rev?: string }>(id);
    if (!orderItem) {
        return NextResponse.json({ error: 'Item order tidak ditemukan' }, { status: 404 });
    }
    if (!orderItem._rev) {
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
            updated = await getSanityClient()
                .patch(id)
                .ifRevisionId(orderItem._rev)
                .unset(['holdReason', 'holdLocation'])
                .set(updates)
                .commit();
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
        updated = await getSanityClient()
            .patch(id)
            .ifRevisionId(orderItem._rev)
            .unset(['holdReason', 'holdLocation'])
            .set(updates)
            .commit();
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
        return NextResponse.json({ error: 'Customer order wajib diisi' }, { status: 400 });
    }

    let customer: ResolvedOrderPartyData['customer'];
    let service: ResolvedOrderPartyData['service'];
    let serviceName: string | undefined;
    let customerRecipient: ResolvedCustomerRecipientData | null = null;
    let items: NormalizedOrderItemInput[];
    try {
        const party = await resolveOrderPartyData(customerRef, serviceRef);
        customer = party.customer;
        service = party.service;
        serviceName = party.serviceName;
        customerRecipient = await resolveOrderRecipientData(customerRef, customerRecipientRef);
        items = await normalizeOrderItemsInput(customerRef, Array.isArray(data.items) ? data.items : [], {
            allowEmpty: true,
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Data order tidak valid';
        const status = message.includes('tidak ditemukan') ? 404 : message.includes('tidak aktif') ? 409 : 400;
        return NextResponse.json({ error: message }, { status });
    }
    const receiverName = normalizeText(data.receiverName) || normalizeOptionalText(customerRecipient?.receiverName) || '';
    const receiverPhone = normalizeOptionalText(data.receiverPhone) || normalizeOptionalText(customerRecipient?.receiverPhone) || '';
    const receiverAddress = normalizeText(data.receiverAddress) || normalizeOptionalText(customerRecipient?.receiverAddress) || '';
    const receiverCompany = normalizeOptionalText(data.receiverCompany) || normalizeOptionalText(customerRecipient?.receiverCompany);
    let pickupStops: NormalizedOrderPickupStop[];
    try {
        pickupStops = await resolveNormalizedOrderPickupStops(customerRef, data, customer.address);
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Titik pickup order tidak valid';
        return NextResponse.json({ error: message }, { status: 400 });
    }
    if (!customer._rev) {
        return NextResponse.json({ error: 'Revisi customer tidak tersedia. Refresh lalu coba lagi.' }, { status: 409 });
    }
    if (serviceRef && !service?._rev) {
        return NextResponse.json({ error: 'Revisi kategori armada tidak tersedia. Refresh lalu coba lagi.' }, { status: 409 });
    }
    if (customerRecipientRef && !customerRecipient?._rev) {
        return NextResponse.json({ error: 'Revisi master penerima tidak tersedia. Refresh lalu coba lagi.' }, { status: 409 });
    }

    const orderId = crypto.randomUUID();
    const masterResi = await sanityGetNextNumber('resi');
    const createdAt = new Date().toISOString();
    const rawTripDrafts = Array.isArray(data.tripDrafts) ? data.tripDrafts.filter(isPlainObject) : [];
    const preparedTripPlans: OrderTripPlan[] = [];
    const usedVehicleRefs = new Set<string>();
    const usedDriverRefs = new Set<string>();
    const bankUsageState = new Map<string, {
        account: {
            _id: string;
            _rev?: string;
            bankName: string;
            accountNumber?: string;
            currentBalance: number;
        };
        nextBalance: number;
    }>();

    for (const [index, rawTripDraft] of rawTripDrafts.entries()) {
        const tripLabel = `trip ${index + 1}`;
        const vehicleRef = normalizeOptionalText(rawTripDraft.vehicleRef);
        const driverRef = normalizeOptionalText(rawTripDraft.driverRef);
        const issueBankRef = normalizeOptionalText(rawTripDraft.issueBankRef);
        const cashGiven = normalizeCurrencyNumber(rawTripDraft.cashGiven ?? 0);
        const vehicleCategoryOverrideReason = normalizeOptionalText(rawTripDraft.vehicleCategoryOverrideReason);

        if (!vehicleRef) {
            return NextResponse.json({ error: `Kendaraan wajib dipilih pada ${tripLabel}` }, { status: 400 });
        }
        if (!driverRef) {
            return NextResponse.json({ error: `Supir wajib dipilih pada ${tripLabel}` }, { status: 400 });
        }
        if (!issueBankRef) {
            return NextResponse.json({ error: `Rekening atau kas sumber wajib dipilih pada ${tripLabel}` }, { status: 400 });
        }
        if (!Number.isFinite(cashGiven) || cashGiven <= 0) {
            return NextResponse.json({ error: `Nominal uang jalan awal wajib diisi pada ${tripLabel}` }, { status: 400 });
        }
        if (usedVehicleRefs.has(vehicleRef)) {
            return NextResponse.json({ error: `Kendaraan ${vehicleRef} dipakai dua kali pada draft trip order yang sama` }, { status: 409 });
        }
        if (usedDriverRefs.has(driverRef)) {
            return NextResponse.json({ error: `Supir ${driverRef} dipakai dua kali pada draft trip order yang sama` }, { status: 409 });
        }

        const selectedPickupStops = resolveDeliveryOrderPickupStops(
            {
                pickupStops,
                customerPickupRef: pickupStops[0]?.customerPickupRef,
                pickupAddress: buildPickupSummary(pickupStops, customer.address),
            },
            rawTripDraft
        );
        if (selectedPickupStops.length === 0) {
            return NextResponse.json({ error: `Minimal 1 titik pickup wajib dipilih pada ${tripLabel}` }, { status: 400 });
        }

        const doDate =
            typeof rawTripDraft.date === 'string' && rawTripDraft.date
                ? rawTripDraft.date
                : getBusinessDateValue();
        try {
            assertIsoDate(doDate, `Tanggal ${tripLabel}`);
        } catch (error) {
            return NextResponse.json(
                { error: error instanceof Error ? error.message : `Tanggal ${tripLabel} tidak valid` },
                { status: 400 }
            );
        }

        const selectedVehicle = await sanityGetById<{
            _id: string;
            _rev?: string;
            plateNumber?: string;
            status?: string;
            serviceRef?: string;
            serviceName?: string;
            capacityKg?: number;
        }>(vehicleRef);
        if (!selectedVehicle) {
            return NextResponse.json({ error: `Kendaraan pada ${tripLabel} tidak ditemukan` }, { status: 404 });
        }
        if (!selectedVehicle._rev) {
            return NextResponse.json({ error: `Revisi kendaraan pada ${tripLabel} tidak tersedia. Refresh lalu coba lagi.` }, { status: 409 });
        }
        if (selectedVehicle.status === 'SOLD') {
            return NextResponse.json({ error: `Kendaraan ${selectedVehicle.plateNumber || vehicleRef} sudah dijual dan tidak bisa dipakai di ${tripLabel}` }, { status: 409 });
        }
        if (selectedVehicle.status === 'OUT_OF_SERVICE') {
            return NextResponse.json({ error: `Kendaraan ${selectedVehicle.plateNumber || vehicleRef} sedang out of service dan tidak bisa dipakai di ${tripLabel}` }, { status: 409 });
        }
        const conflictingVehicleDo = await getSanityClient().fetch<{
            _id: string;
            doNumber?: string;
            customerDoNumber?: string;
        } | null>(
            `*[
                _type == "deliveryOrder" &&
                status in ["CREATED", "HEADING_TO_PICKUP", "ON_DELIVERY", "ARRIVED"] &&
                ((vehicleRef == $ref || vehicleRef._ref == $ref) || lower(coalesce(vehiclePlate, "")) == $plate)
            ][0]{
                _id,
                doNumber,
                customerDoNumber
            }`,
            {
                ref: vehicleRef,
                plate: (selectedVehicle.plateNumber || '').toLowerCase(),
            }
        );
        if (conflictingVehicleDo) {
            const conflictingNumber =
                conflictingVehicleDo.doNumber ||
                conflictingVehicleDo.customerDoNumber ||
                conflictingVehicleDo._id;
            return NextResponse.json(
                { error: `Kendaraan ${selectedVehicle.plateNumber || vehicleRef} masih dipakai di surat jalan aktif ${conflictingNumber}` },
                { status: 409 }
            );
        }
        const orderServiceRef = extractRefId(serviceRef);
        const vehicleServiceRef = extractRefId(selectedVehicle.serviceRef) || undefined;
        const vehicleServiceName = selectedVehicle.serviceName || undefined;
        let vehicleCategoryOverrideReasonToStore: string | undefined;
        if (orderServiceRef && !vehicleServiceRef && !vehicleCategoryOverrideReason) {
            return NextResponse.json(
                { error: `Kendaraan ${selectedVehicle.plateNumber || vehicleRef} belum punya kategori armada yang cocok. Isi alasan override pada ${tripLabel}.` },
                { status: 400 }
            );
        }
        if (orderServiceRef && vehicleServiceRef !== orderServiceRef && !vehicleCategoryOverrideReason) {
            return NextResponse.json(
                { error: `Kendaraan ${selectedVehicle.plateNumber || vehicleRef} tidak sesuai kategori order. Isi alasan override pada ${tripLabel}.` },
                { status: 400 }
            );
        }
        if (orderServiceRef && vehicleServiceRef !== orderServiceRef) {
            vehicleCategoryOverrideReasonToStore = vehicleCategoryOverrideReason || undefined;
        }

        const selectedDriver = await sanityGetById<{ _id: string; _rev?: string; name?: string; active?: boolean }>(driverRef);
        if (!selectedDriver) {
            return NextResponse.json({ error: `Supir pada ${tripLabel} tidak ditemukan` }, { status: 404 });
        }
        if (!selectedDriver._rev) {
            return NextResponse.json({ error: `Revisi supir pada ${tripLabel} tidak tersedia. Refresh lalu coba lagi.` }, { status: 409 });
        }
        if (selectedDriver.active === false) {
            return NextResponse.json({ error: `Supir ${selectedDriver.name || driverRef} tidak aktif dan tidak bisa dipakai di ${tripLabel}` }, { status: 409 });
        }
        const conflictingDriverDo = await getSanityClient().fetch<{
            _id: string;
            doNumber?: string;
            customerDoNumber?: string;
        } | null>(
            `*[
                _type == "deliveryOrder" &&
                status in ["CREATED", "HEADING_TO_PICKUP", "ON_DELIVERY", "ARRIVED"] &&
                ((driverRef == $ref || driverRef._ref == $ref) || lower(coalesce(driverName, "")) == $driverName)
            ][0]{
                _id,
                doNumber,
                customerDoNumber
            }`,
            {
                ref: driverRef,
                driverName: (selectedDriver.name || '').toLowerCase(),
            }
        );
        if (conflictingDriverDo) {
            const conflictingNumber =
                conflictingDriverDo.doNumber ||
                conflictingDriverDo.customerDoNumber ||
                conflictingDriverDo._id;
            return NextResponse.json(
                { error: `Supir ${selectedDriver.name || driverRef} masih terikat di surat jalan aktif ${conflictingNumber}` },
                { status: 409 }
            );
        }

        let tripRouteSelection: Awaited<ReturnType<typeof resolveTripRouteRateSelection>>;
        try {
            tripRouteSelection = await resolveTripRouteRateSelection(rawTripDraft, {
                serviceRef: serviceRef || '',
            });
        } catch (error) {
            return NextResponse.json(
                { error: error instanceof Error ? error.message : `Master biaya rute trip pada ${tripLabel} tidak valid` },
                { status: 400 }
            );
        }
        const matchedTripRouteRateFee = normalizeCurrencyNumber(tripRouteSelection?.matchedTripRouteRate?.rate ?? 0);
        const manualTripFee = normalizeCurrencyNumber(rawTripDraft.taripBorongan ?? 0);
        if (!Number.isFinite(manualTripFee) || manualTripFee < 0) {
            return NextResponse.json({ error: `Upah trip pada ${tripLabel} tidak valid` }, { status: 400 });
        }
        if (
            matchedTripRouteRateFee > 0 &&
            manualTripFee > 0 &&
            Math.abs(manualTripFee - matchedTripRouteRateFee) > 0.01
        ) {
            return NextResponse.json(
                { error: `Upah trip pada ${tripLabel} harus mengikuti master biaya rute trip yang dipilih` },
                { status: 409 }
            );
        }
        const effectiveTripFee = matchedTripRouteRateFee > 0 ? matchedTripRouteRateFee : manualTripFee;
        if (!Number.isFinite(effectiveTripFee) || effectiveTripFee <= 0) {
            return NextResponse.json({ error: `Upah trip wajib diisi pada ${tripLabel}` }, { status: 400 });
        }

        let bankState = bankUsageState.get(issueBankRef);
        if (!bankState) {
            const account = await getLedgerAccount(issueBankRef);
            if (!account) {
                return NextResponse.json({ error: `Rekening sumber pada ${tripLabel} tidak ditemukan` }, { status: 404 });
            }
            if (!account._rev) {
                return NextResponse.json({ error: `Revisi rekening sumber pada ${tripLabel} tidak tersedia` }, { status: 409 });
            }
            bankState = {
                account,
                nextBalance: account.currentBalance,
            };
            bankUsageState.set(issueBankRef, bankState);
        }
        const { startingBalance, nextBalance } = computeLedgerDebitBalance(bankState.nextBalance, cashGiven);
        if (nextBalance < 0) {
            return NextResponse.json(
                { error: `Saldo ${bankState.account.bankName} tidak cukup untuk ${tripLabel}. Saldo tersedia ${startingBalance}` },
                { status: 409 }
            );
        }
        bankState.nextBalance = nextBalance;
        preparedTripPlans.push({
            _key: normalizeOptionalText(rawTripDraft._key) || normalizeOptionalText(rawTripDraft.id) || crypto.randomUUID(),
            sequence: index + 1,
            pickupStopKeys: selectedPickupStops.map(stop => stop._key),
            vehicleRef,
            vehiclePlate: selectedVehicle.plateNumber || undefined,
            vehicleServiceRef,
            vehicleServiceName,
            vehicleCategoryOverrideReason: vehicleCategoryOverrideReasonToStore,
            driverRef,
            driverName: selectedDriver.name || undefined,
            tripRouteRateRef: tripRouteSelection?.tripRouteRateRef,
            tripOriginArea: tripRouteSelection?.tripOriginArea,
            tripDestinationArea: tripRouteSelection?.tripDestinationArea,
            taripBorongan: effectiveTripFee,
            issueBankRef,
            issueBankName: bankState.account.bankName,
            cashGiven,
            date: doDate,
            notes: normalizeOptionalText(rawTripDraft.notes),
        });

        usedVehicleRefs.add(vehicleRef);
        usedDriverRefs.add(driverRef);
    }

    const orderDoc = {
        _id: orderId,
        _type: 'order',
        cargoEntryMode: items.length === 0 ? 'DELIVERY_ORDER' : 'ORDER',
        customerRef,
        customerName: customer.name,
        customerRecipientRef: customerRecipientRef || undefined,
        customerPickupRef: pickupStops[0]?.customerPickupRef || customerPickupRef || undefined,
        receiverName: receiverName || undefined,
        receiverPhone: receiverPhone || undefined,
        receiverAddress: receiverAddress || undefined,
        receiverCompany: receiverCompany || undefined,
        pickupAddress: buildPickupSummary(pickupStops, customer.address),
        pickupStops,
        tripPlans: preparedTripPlans.length > 0 ? preparedTripPlans : undefined,
        serviceRef: serviceRef || '',
        serviceName,
        notes: normalizeOptionalText(data.notes),
        masterResi,
        status: 'OPEN',
        createdAt,
        createdBy: session._id,
    };

    const transaction = getSanityClient()
        .transaction()
        .create(orderDoc)
        .patch(customer._id, {
            ifRevisionID: customer._rev,
            set: { updatedAt: createdAt },
        });
    if (serviceRef && service?._rev) {
        transaction.patch(service._id, {
            ifRevisionID: service._rev,
            set: { updatedAt: createdAt },
        });
    }
    try {
        patchLinkedCustomerProducts(transaction, items, createdAt);
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Barang customer berubah karena ada update lain. Refresh lalu coba lagi.' },
            { status: 409 }
        );
    }
    if (customerRecipientRef && customerRecipient?._rev) {
        transaction.patch(customerRecipient._id, {
            ifRevisionID: customerRecipient._rev,
            set: { updatedAt: createdAt },
        });
    }
    for (const item of items) {
        transaction.create(buildOrderItemDraftDocument(orderId, item));
    }

    try {
        await transaction.commit();
    } catch (error) {
        if (isMutationConflictError(error)) {
            return NextResponse.json(
                { error: 'Order, customer, barang customer, pickup, armada trip, supir, atau rekening sumber berubah karena ada update lain. Refresh lalu coba lagi.' },
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
        `Created orders: ${masterResi}${items.length > 0 ? ` (${items.length} item target)` : ' (header booking tanpa item)'}${preparedTripPlans.length > 0 ? ` | ${preparedTripPlans.length} trip direncanakan` : ''}`
    );
    return NextResponse.json({
        data: orderDoc,
        id: orderId,
        plannedTrips: preparedTripPlans.map(trip => ({
            _key: trip._key,
            vehiclePlate: trip.vehiclePlate,
            driverName: trip.driverName,
        })),
    });
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
        return NextResponse.json({ error: 'Order dan customer wajib diisi' }, { status: 400 });
    }

    const order = await sanityGetById<{
        _id: string;
        _rev?: string;
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
    }>(id);
    if (!order) {
        return NextResponse.json({ error: 'Order tidak ditemukan' }, { status: 404 });
    }
    if (!order._rev) {
        return NextResponse.json({ error: 'Revisi order tidak tersedia. Refresh lalu coba lagi.' }, { status: 409 });
    }
    if (order.cargoEntryMode === 'DELIVERY_ORDER') {
        return NextResponse.json(
            { error: 'Order ini memakai flow header booking. Edit header order lewat workflow header booking, bukan edit item order.' },
            { status: 409 }
        );
    }

    const relatedDeliveryOrder = await getSanityClient().fetch<{ _id: string } | null>(
        `*[_type == "deliveryOrder" && orderRef == $ref][0]{ _id }`,
        { ref: id }
    );
    if (relatedDeliveryOrder) {
        return NextResponse.json({ error: 'Order yang sudah punya surat jalan tidak boleh mengubah item atau koli lagi' }, { status: 409 });
    }

    const existingItems = await getSanityClient().fetch<Array<{
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
    }>>(
        `*[_type == "orderItem" && orderRef == $ref]{
            _id,
            _rev,
            description,
            status,
            deliveredQtyKoli,
            deliveredWeight,
            deliveredVolume,
            assignedQtyKoli,
            assignedWeight,
            assignedVolume,
            heldQtyKoli,
            heldWeight,
            heldVolume
        }`,
        { ref: id }
    );
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
    let items: NormalizedOrderItemInput[];
    try {
        const party = await resolveOrderPartyData(customerRef, serviceRef);
        customer = party.customer;
        service = party.service;
        serviceName = party.serviceName;
        customerRecipient = await resolveOrderRecipientData(customerRef, customerRecipientRef);
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

    const receiverFieldsProvided =
        Object.prototype.hasOwnProperty.call(data, 'customerRecipientRef') ||
        Object.prototype.hasOwnProperty.call(data, 'receiverName') ||
        Object.prototype.hasOwnProperty.call(data, 'receiverPhone') ||
        Object.prototype.hasOwnProperty.call(data, 'receiverAddress') ||
        Object.prototype.hasOwnProperty.call(data, 'receiverCompany');
    const refreshReceiverSnapshot =
        receiverFieldsProvided || normalizeOptionalText(order.customerRef) !== customerRef;
    const receiverName = refreshReceiverSnapshot
        ? normalizeText(data.receiverName) || normalizeOptionalText(customerRecipient?.receiverName) || ''
        : normalizeOptionalText(order.receiverName) || '';
    const receiverPhone = refreshReceiverSnapshot
        ? normalizeOptionalText(data.receiverPhone) || normalizeOptionalText(customerRecipient?.receiverPhone) || ''
        : normalizeOptionalText(order.receiverPhone) || '';
    const receiverAddress = refreshReceiverSnapshot
        ? normalizeText(data.receiverAddress) || normalizeOptionalText(customerRecipient?.receiverAddress) || ''
        : normalizeOptionalText(order.receiverAddress) || '';
    const receiverCompany = refreshReceiverSnapshot
        ? normalizeOptionalText(data.receiverCompany) || normalizeOptionalText(customerRecipient?.receiverCompany)
        : normalizeOptionalText(order.receiverCompany);
    let pickupStops: NormalizedOrderPickupStop[];
    try {
        pickupStops =
            !Array.isArray(data.pickupStops) && getOrderPickupStopsSnapshot(order).length > 1
                ? getOrderPickupStopsSnapshot(order)
                : await resolveNormalizedOrderPickupStops(customerRef, data, customer.address);
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Titik pickup order tidak valid';
        return NextResponse.json({ error: message }, { status: 400 });
    }
    if (existingItems.some(item => !item._rev)) {
        return NextResponse.json({ error: 'Revisi item order tidak tersedia. Refresh lalu coba lagi.' }, { status: 409 });
    }
    if (!customer._rev) {
        return NextResponse.json({ error: 'Revisi customer tidak tersedia. Refresh lalu coba lagi.' }, { status: 409 });
    }
    if (serviceRef && !service?._rev) {
        return NextResponse.json({ error: 'Revisi kategori armada tidak tersedia. Refresh lalu coba lagi.' }, { status: 409 });
    }
    if (customerRecipientRef && !customerRecipient?._rev) {
        return NextResponse.json({ error: 'Revisi master penerima tidak tersedia. Refresh lalu coba lagi.' }, { status: 409 });
    }

    const mutationTimestamp = new Date().toISOString();
    const transaction = getSanityClient()
        .transaction()
        .patch(customer._id, {
            ifRevisionID: customer._rev,
            set: { updatedAt: mutationTimestamp },
        })
        .patch(id, {
            ifRevisionID: order._rev,
            set: {
                cargoEntryMode: 'ORDER',
                customerRef,
                customerName: customer.name,
                customerRecipientRef: refreshReceiverSnapshot ? (customerRecipientRef || undefined) : (normalizeOptionalText(order.customerRecipientRef) || undefined),
                customerPickupRef: pickupStops[0]?.customerPickupRef || customerPickupRef || undefined,
                receiverName: receiverName || undefined,
                receiverPhone: receiverPhone || undefined,
                receiverAddress: receiverAddress || undefined,
                receiverCompany: receiverCompany || undefined,
                pickupAddress: buildPickupSummary(pickupStops, customer.address),
                pickupStops,
                serviceRef: serviceRef || '',
                serviceName,
                notes: normalizeOptionalText(data.notes),
            },
        });
    if (serviceRef && service?._rev) {
        transaction.patch(service._id, {
            ifRevisionID: service._rev,
            set: { updatedAt: mutationTimestamp },
        });
    }
    try {
        patchLinkedCustomerProducts(transaction, items, mutationTimestamp);
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Barang customer berubah karena ada update lain. Refresh lalu coba lagi.' },
            { status: 409 }
        );
    }
    if (customerRecipientRef && customerRecipient?._rev) {
        transaction.patch(customerRecipient._id, {
            ifRevisionID: customerRecipient._rev,
            set: { updatedAt: mutationTimestamp },
        });
    }

    for (const item of items) {
        transaction.create(buildOrderItemDraftDocument(id, item));
    }

    try {
        const mutations = transaction.serialize() as unknown as Array<Record<string, unknown>>;
        for (const item of existingItems) {
            mutations.push({
                delete: {
                    id: item._id,
                    ifRevisionID: item._rev as string,
                },
            });
        }
        await getSanityClient().mutate(mutations as unknown as SanityMutations);
    } catch (error) {
        if (isMutationConflictError(error)) {
            return NextResponse.json(
                { error: 'Data order, customer, barang customer, pickup, kategori armada, atau item target berubah karena ada update lain. Refresh lalu coba lagi.' },
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

    const updatedOrder = await sanityGetById(id);
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
        return NextResponse.json({ error: 'Order dan customer wajib diisi' }, { status: 400 });
    }

    const order = await sanityGetById<{
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
        serviceRef?: string;
        notes?: string;
    }>(id);
    if (!order) {
        return NextResponse.json({ error: 'Order tidak ditemukan' }, { status: 404 });
    }
    if (order.cargoEntryMode !== 'DELIVERY_ORDER') {
        return NextResponse.json(
            { error: 'Order ini masih memakai flow item target di order. Gunakan edit order biasa.' },
            { status: 409 }
        );
    }

    const relatedDeliveryOrder = await getSanityClient().fetch<{ _id: string } | null>(
        `*[_type == "deliveryOrder" && orderRef == $ref][0]{ _id }`,
        { ref: id }
    );

    if (relatedDeliveryOrder) {
        const touchesDeprecatedTargetFields =
            Object.prototype.hasOwnProperty.call(data, 'customerRecipientRef') ||
            Object.prototype.hasOwnProperty.call(data, 'receiverName') ||
            Object.prototype.hasOwnProperty.call(data, 'receiverPhone') ||
            Object.prototype.hasOwnProperty.call(data, 'receiverAddress') ||
            Object.prototype.hasOwnProperty.call(data, 'receiverCompany');
        const attemptedHeaderChanges =
            normalizeText(order.customerRef) !== customerRef ||
            normalizeOptionalText(order.serviceRef) !== serviceRef ||
            normalizeOptionalText(order.customerPickupRef) !== customerPickupRef ||
            (
                Array.isArray(data.pickupStops)
                    ? JSON.stringify(getOrderPickupStopsSnapshot(order).map(stop => ({
                        customerPickupRef: stop.customerPickupRef || '',
                        pickupAddress: stop.pickupAddress,
                    }))) !== JSON.stringify(
                        (data.pickupStops as unknown[])
                            .filter(isPlainObject)
                            .map(stop => ({
                                customerPickupRef: normalizeOptionalText(stop.customerPickupRef) || '',
                                pickupAddress: normalizeOptionalText(stop.pickupAddress) || '',
                            }))
                            .filter(stop => stop.customerPickupRef || stop.pickupAddress)
                    )
                    : normalizeOptionalText(order.pickupAddress) !== normalizeOptionalText(data.pickupAddress)
            ) ||
            touchesDeprecatedTargetFields;

        if (attemptedHeaderChanges) {
            return NextResponse.json(
                { error: 'Order header booking yang sudah punya Surat Jalan hanya boleh mengubah catatan umum.' },
                { status: 409 }
            );
        }

        if (!order._rev) {
            return NextResponse.json({ error: 'Revisi order tidak tersedia. Refresh lalu coba lagi.' }, { status: 409 });
        }

        let updatedOrder: unknown;
        try {
            updatedOrder = await getSanityClient()
                .patch(id)
                .ifRevisionId(order._rev)
                .set({ notes })
                .commit();
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
    try {
        const party = await resolveOrderPartyData(customerRef, serviceRef);
        customer = party.customer;
        service = party.service;
        serviceName = party.serviceName;
        customerRecipient = await resolveOrderRecipientData(customerRef, customerRecipientRef);
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Data order tidak valid';
        const status = message.includes('tidak ditemukan') ? 404 : message.includes('tidak aktif') ? 409 : 400;
        return NextResponse.json({ error: message }, { status });
    }

    const receiverFieldsProvided =
        Object.prototype.hasOwnProperty.call(data, 'customerRecipientRef') ||
        Object.prototype.hasOwnProperty.call(data, 'receiverName') ||
        Object.prototype.hasOwnProperty.call(data, 'receiverPhone') ||
        Object.prototype.hasOwnProperty.call(data, 'receiverAddress') ||
        Object.prototype.hasOwnProperty.call(data, 'receiverCompany');
    const refreshReceiverSnapshot =
        receiverFieldsProvided || normalizeOptionalText(order.customerRef) !== customerRef;
    const receiverName = refreshReceiverSnapshot
        ? normalizeText(data.receiverName) || normalizeOptionalText(customerRecipient?.receiverName) || ''
        : normalizeOptionalText(order.receiverName) || '';
    const receiverPhone = refreshReceiverSnapshot
        ? normalizeOptionalText(data.receiverPhone) || normalizeOptionalText(customerRecipient?.receiverPhone) || ''
        : normalizeOptionalText(order.receiverPhone) || '';
    const receiverAddress = refreshReceiverSnapshot
        ? normalizeText(data.receiverAddress) || normalizeOptionalText(customerRecipient?.receiverAddress) || ''
        : normalizeOptionalText(order.receiverAddress) || '';
    const receiverCompany = refreshReceiverSnapshot
        ? normalizeOptionalText(data.receiverCompany) || normalizeOptionalText(customerRecipient?.receiverCompany)
        : normalizeOptionalText(order.receiverCompany);
    let pickupStops: NormalizedOrderPickupStop[];
    try {
        pickupStops =
            !Array.isArray(data.pickupStops) && getOrderPickupStopsSnapshot(order).length > 1
                ? getOrderPickupStopsSnapshot(order)
                : await resolveNormalizedOrderPickupStops(customerRef, data, customer.address);
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Titik pickup order tidak valid';
        return NextResponse.json({ error: message }, { status: 400 });
    }

    if (!order._rev) {
        return NextResponse.json({ error: 'Revisi order tidak tersedia. Refresh lalu coba lagi.' }, { status: 409 });
    }
    if (!customer._rev) {
        return NextResponse.json({ error: 'Revisi customer tidak tersedia. Refresh lalu coba lagi.' }, { status: 409 });
    }
    if (serviceRef && !service?._rev) {
        return NextResponse.json({ error: 'Revisi kategori armada tidak tersedia. Refresh lalu coba lagi.' }, { status: 409 });
    }
    if (customerRecipientRef && !customerRecipient?._rev) {
        return NextResponse.json({ error: 'Revisi master penerima tidak tersedia. Refresh lalu coba lagi.' }, { status: 409 });
    }

    let updatedOrder: unknown;
    try {
        const mutationTimestamp = new Date().toISOString();
        const transaction = getSanityClient()
            .transaction()
            .patch(customer._id, {
                ifRevisionID: customer._rev,
                set: { updatedAt: mutationTimestamp },
            })
            .patch(id, {
                ifRevisionID: order._rev,
                set: {
                    cargoEntryMode: 'DELIVERY_ORDER',
                    customerRef,
                    customerName: customer.name,
                    customerRecipientRef: refreshReceiverSnapshot ? (customerRecipientRef || undefined) : (normalizeOptionalText(order.customerRecipientRef) || undefined),
                    customerPickupRef: pickupStops[0]?.customerPickupRef || customerPickupRef || undefined,
                    receiverName: receiverName || undefined,
                    receiverPhone: receiverPhone || undefined,
                    receiverAddress: receiverAddress || undefined,
                    receiverCompany: receiverCompany || undefined,
                    pickupAddress: buildPickupSummary(pickupStops, customer.address),
                    pickupStops,
                    serviceRef: serviceRef || '',
                    serviceName,
                    notes,
                },
            });
        if (serviceRef && service?._rev) {
            transaction.patch(service._id, {
                ifRevisionID: service._rev,
                set: { updatedAt: mutationTimestamp },
            });
        }
        if (customerRecipientRef && customerRecipient?._rev) {
            transaction.patch(customerRecipient._id, {
                ifRevisionID: customerRecipient._rev,
                set: { updatedAt: mutationTimestamp },
            });
        }
        updatedOrder = await transaction.commit();
    } catch (error) {
        if (isMutationConflictError(error)) {
            return NextResponse.json(
                { error: 'Header booking, customer, pickup, atau kategori armada berubah karena ada update lain. Refresh lalu coba lagi.' },
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
        `Update header booking ${order.masterResi || id}: customer, armada, pickup, atau catatan diperbarui`
    );
    return NextResponse.json({ data: updatedOrder, id });
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

    const order = await sanityGetById<{ _id: string; _rev?: string; masterResi?: string; notes?: string; cargoEntryMode?: 'ORDER' | 'DELIVERY_ORDER' }>(id);
    if (!order) {
        return NextResponse.json({ error: 'Order tidak ditemukan' }, { status: 404 });
    }
    if (order.cargoEntryMode === 'DELIVERY_ORDER') {
        return NextResponse.json(
            { error: 'Order header booking tidak memakai revisi target item. Barang tetap mengikuti Surat Jalan.' },
            { status: 409 }
        );
    }

    const existingItems = await getSanityClient().fetch<Array<OrderItemProgressSnapshot & { _rev?: string }>>(
        `*[_type == "orderItem" && orderRef == $ref]{
            _id,
            _rev,
            orderRef,
            description,
            qtyKoli,
            weight,
            volume,
            weightInputValue,
            weightInputUnit,
            volumeInputValue,
            volumeInputUnit,
            status,
            deliveredQtyKoli,
            deliveredWeight,
            deliveredVolume,
            assignedQtyKoli,
            assignedWeight,
            assignedVolume,
            heldQtyKoli,
            heldWeight,
            heldVolume,
            holdReason,
            holdLocation
        }`,
        { ref: id }
    );
    if (existingItems.length === 0) {
        return NextResponse.json({ error: 'Order belum punya item yang bisa direvisi' }, { status: 409 });
    }
    if (!order._rev) {
        return NextResponse.json({ error: 'Revisi order tidak tersedia. Refresh lalu coba lagi.' }, { status: 409 });
    }
    if (existingItems.some(item => !item._rev)) {
        return NextResponse.json({ error: 'Revisi item order tidak tersedia. Refresh lalu coba lagi.' }, { status: 409 });
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

    const transaction = getSanityClient().transaction();
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
            maxFractionDigits: weightInputUnit === 'TON' ? 3 : 2,
        }), weightInputUnit === 'TON' ? 3 : 2);
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

        transaction.patch(existingItem._id, {
            ifRevisionID: existingItem._rev,
            set: {
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
                status: nextStatus,
            },
            unset: ['holdReason', 'holdLocation'],
        });

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

    transaction.patch(id, {
        ifRevisionID: order._rev,
        set: {
            notes: normalizeOptionalText(data.notes),
        },
    });

    try {
        await transaction.commit();
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

    const updatedOrder = await sanityGetById(id);
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

    const deliveryOrder = await sanityGetById<{
        _id: string;
        _rev?: string;
        doNumber?: string;
        status?: string;
        orderRef?: unknown;
        driverRef?: unknown;
        serviceRef?: unknown;
        vehicleRef?: unknown;
        trackingState?: string;
        podReceiverName?: string;
        podReceivedDate?: string;
        podNote?: string;
        receiverName?: string;
        receiverCompany?: string;
        receiverAddress?: string;
        baseTaripBorongan?: number;
        taripBorongan?: number;
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
        pendingDriverActualDropPoints?: DeliveryActualDropPoint[];
    }>(id);
    if (!deliveryOrder) {
        return NextResponse.json({ error: 'Surat jalan tidak ditemukan' }, { status: 404 });
    }
    if (!deliveryOrder._rev) {
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

    const allowedStatuses = DO_STATUS_TRANSITIONS[deliveryOrder.status || ''] || [];
    if (!allowedStatuses.includes(status)) {
        return NextResponse.json({ error: 'Transisi status DO tidak valid' }, { status: 400 });
    }

    const doItems = await getSanityClient().fetch<Array<DeliveryOrderItemCargoSnapshot & { _rev?: string }>>(
        `*[_type == "deliveryOrderItem" && deliveryOrderRef == $ref]{
            _id,
            _rev,
            orderItemRef,
            shippedQtyKoli,
            shippedWeight,
            orderItemQtyKoli,
            orderItemWeight,
            orderItemVolumeM3,
            orderItemWeightInputValue,
            orderItemWeightInputUnit,
            orderItemVolumeInputValue,
            orderItemVolumeInputUnit,
            actualQtyKoli,
            actualWeightKg,
            actualVolumeM3,
            actualWeightInputValue,
            actualWeightInputUnit,
            actualVolumeInputValue,
            actualVolumeInputUnit
        }`,
        { ref: id }
    );
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
            _rev: string;
            driverFeeAmount: number;
            totalClaimAmount: number;
        }
        | undefined;
    if (status === 'DELIVERED') {
        if (doItems.length === 0) {
            return NextResponse.json(
                { error: 'Surat jalan belum punya item muatan. Isi barang dulu sebelum DO diselesaikan.' },
                { status: 400 }
            );
        }

        try {
            actualCargoByDoItemId = normalizeDeliveryOrderActualCargoInputs(data, doItems);
            actualDropPoints = normalizeDeliveryActualDropPoints(data, deliveryOrder, actualCargoByDoItemId);
        } catch (error) {
            return NextResponse.json(
                { error: error instanceof Error ? error.message : 'Muatan aktual surat jalan tidak valid' },
                { status: 400 }
            );
        }

        const actualCargoTotals = summarizeActualCargoInputs(actualCargoByDoItemId);
        const serviceRef = extractRefId(deliveryOrder.serviceRef);
        const vehicleRef = extractRefId(deliveryOrder.vehicleRef);
        const [service, vehicle, linkedVoucher] = await Promise.all([
            serviceRef
                ? sanityGetById<{
                    _id: string;
                    maxPayloadKg?: number;
                    overtonaseDriverRatePerKg?: number;
                }>(serviceRef)
                : Promise.resolve(null),
            vehicleRef
                ? sanityGetById<{
                    _id: string;
                    capacityKg?: number;
                }>(vehicleRef)
                : Promise.resolve(null),
            getSanityClient().fetch<{
                _id: string;
                _rev?: string;
                bonNumber?: string;
                status?: string;
                totalSpent?: number;
                totalIssuedAmount?: number;
                cashGiven?: number;
                driverFeeAmount?: number;
            } | null>(
                `*[_type == "driverVoucher" && (deliveryOrderRef == $ref || deliveryOrderRef._ref == $ref)][0]{
                    _id,
                    _rev,
                    bonNumber,
                    status,
                    totalSpent,
                    totalIssuedAmount,
                    cashGiven,
                    driverFeeAmount
                }`,
                { ref: id }
            ),
        ]);

        overtonageResult = computeDeliveryOrderOvertonage({
            actualTotalWeightKg: actualCargoTotals.weightKg,
            serviceMaxPayloadKg: service?.maxPayloadKg,
            vehicleCapacityKg: vehicle?.capacityKg,
            baseTripFee: normalizeCurrencyNumber(deliveryOrder.baseTaripBorongan ?? deliveryOrder.taripBorongan ?? 0),
            overtonaseDriverRatePerKg: service?.overtonaseDriverRatePerKg,
        });

        if (
            linkedVoucher?._id &&
            linkedVoucher._rev &&
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
                _rev: linkedVoucher._rev,
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
    const transaction = getSanityClient()
        .transaction()
        .patch(id, {
            ifRevisionID: deliveryOrder._rev,
            set: {
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
            },
            unset: DRIVER_STATUS_REQUEST_FIELDS,
        })
        .create({
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
        transaction.patch(linkedVoucherPatch._id, {
            ifRevisionID: linkedVoucherPatch._rev,
            set: {
                driverFeeAmount: linkedVoucherPatch.driverFeeAmount,
                totalClaimAmount: linkedVoucherPatch.totalClaimAmount,
            },
        });
    }

    for (const item of doItems) {
        const orderItemRef = extractRefId(item.orderItemRef);
        if (orderItemRef) {
            const orderItem = await sanityGetById<OrderItemProgressSnapshot & { _rev?: string }>(orderItemRef);
            if (!orderItem) {
                continue;
            }
            if (!orderItem._rev) {
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
                transaction.patch(orderItemRef, {
                    ifRevisionID: orderItem._rev,
                    set: { status: 'ON_DELIVERY' },
                });
                continue;
            }

            if (status === 'DELIVERED') {
                if (!item._rev) {
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
                    const otherReservedQtyKoli = roundQuantity(
                        Math.max(progress.deliveredQtyKoli + progress.assignedQtyKoli + progress.heldQtyKoli - plannedQtyKoli, 0)
                    );
                    const maxActualQtyKoli = roundQuantity(Math.max(progress.totalQtyKoli - otherReservedQtyKoli, 0));
                    if (!usesDeliveryOrderOwnedTarget && actualCargo.actualQtyKoli > maxActualQtyKoli) {
                        return NextResponse.json(
                            {
                                error: `Qty aktual untuk ${orderItem.description || 'item order'} melebihi sisa target order/resi (${maxActualQtyKoli} koli). Revisi order/resi dulu jika total barang fisik memang bertambah.`,
                            },
                            { status: 409 }
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
                const otherReservedWeight = roundQuantity(
                    Math.max(progress.deliveredWeight + progress.assignedWeight + progress.heldWeight - plannedWeight, 0)
                );
                if (!usesDeliveryOrderOwnedTarget && progress.totalWeight > 0) {
                    const maxActualWeight = roundQuantity(Math.max(progress.totalWeight - otherReservedWeight, 0));
                    if (actualWeight - maxActualWeight > 0.00001) {
                        return NextResponse.json(
                            {
                                error: `Berat aktual untuk ${orderItem.description || 'item order'} melebihi sisa target order/resi (${maxActualWeight} kg). Revisi target berat order/resi dulu jika total muatan fisik memang bertambah.`,
                            },
                            { status: 409 }
                        );
                    }
                }
                const otherReservedVolume = roundQuantity(
                    Math.max(progress.deliveredVolume + progress.assignedVolume + progress.heldVolume - plannedVolume, 0),
                    3
                );
                if (!usesDeliveryOrderOwnedTarget && progress.totalVolume > 0) {
                    const maxActualVolume = roundQuantity(Math.max(progress.totalVolume - otherReservedVolume, 0), 3);
                    if (actualVolume - maxActualVolume > 0.00001) {
                        return NextResponse.json(
                            {
                                error: `Volume aktual untuk ${orderItem.description || 'item order'} melebihi sisa target order/resi (${maxActualVolume} m3). Revisi target volume order/resi dulu jika total muatan fisik memang bertambah.`,
                            },
                            { status: 409 }
                        );
                    }
                }
                const nextProgress = {
                    ...progress,
                    assignedQtyKoli: roundQuantity(Math.max(progress.assignedQtyKoli - plannedQtyKoli, 0)),
                    assignedWeight: roundQuantity(Math.max(progress.assignedWeight - plannedWeight, 0)),
                    assignedVolume: roundQuantity(Math.max(progress.assignedVolume - plannedVolume, 0), 3),
                    deliveredQtyKoli: roundQuantity(progress.deliveredQtyKoli + actualQtyKoli),
                    deliveredWeight: roundQuantity(progress.deliveredWeight + actualWeight),
                    deliveredVolume: roundQuantity(progress.deliveredVolume + actualVolume, 3),
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
                transaction.patch(orderItemRef, {
                    ifRevisionID: orderItem._rev,
                    ...orderItemPatch,
                });
                transaction.patch(item._id, {
                    ifRevisionID: item._rev,
                    set: {
                        actualQtyKoli: requireQty ? actualCargo.actualQtyKoli : undefined,
                        actualWeightKg: actualWeight,
                        actualVolumeM3: actualVolume > 0 ? actualVolume : undefined,
                        actualWeightInputValue: actualCargo.actualWeightInputValue,
                        actualWeightInputUnit: actualCargo.actualWeightInputUnit,
                        actualVolumeInputValue: actualCargo.actualVolumeInputValue,
                        actualVolumeInputUnit: actualCargo.actualVolumeInputUnit,
                    },
                });
                continue;
            }

            if (status === 'CANCELLED') {
                const nextProgress = {
                    ...progress,
                    assignedQtyKoli: roundQuantity(Math.max(progress.assignedQtyKoli - plannedQtyKoli, 0)),
                    assignedWeight: roundQuantity(Math.max(progress.assignedWeight - plannedWeight, 0)),
                    assignedVolume: roundQuantity(Math.max(progress.assignedVolume - plannedVolume, 0), 3),
                };
                transaction.patch(orderItemRef, {
                    ifRevisionID: orderItem._rev,
                    set: {
                        assignedQtyKoli: nextProgress.assignedQtyKoli,
                        assignedWeight: nextProgress.assignedWeight,
                        assignedVolume: nextProgress.assignedVolume,
                        status: deriveOrderItemStatusFromProgress(nextProgress),
                    },
                });
            }
        }
    }

    try {
        await transaction.commit();
    } catch (error) {
        if (isMutationConflictError(error)) {
            return NextResponse.json(
                { error: 'Status surat jalan berubah karena ada update lain. Refresh lalu coba lagi.' },
                { status: 409 }
            );
        }
        throw error;
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
                    pendingDriverStatus: undefined,
                    pendingDriverStatusRequestedAt: undefined,
                    pendingDriverStatusRequestedBy: undefined,
                    pendingDriverStatusRequestedByName: undefined,
                    pendingDriverStatusNote: undefined,
                    pendingDriverActualCargoItems: undefined,
                    pendingDriverActualDropPoints: undefined,
                    cargoFinalizedAt: timestamp,
                    cargoFinalizedBy: session._id,
                    cargoFinalizedByName: session.name,
                    actualDropPoints,
                }
                : {}),
            ...(status !== 'DELIVERED'
                ? {
                    pendingDriverStatus: undefined,
                    pendingDriverStatusRequestedAt: undefined,
                    pendingDriverStatusRequestedBy: undefined,
                    pendingDriverStatusRequestedByName: undefined,
                    pendingDriverStatusNote: undefined,
                    pendingDriverActualCargoItems: undefined,
                    pendingDriverActualDropPoints: undefined,
                }
                : {}),
            trackingState: shouldStopTracking ? 'STOPPED' : deliveryOrder.trackingState,
            trackingStoppedAt: shouldStopTracking ? timestamp : undefined,
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

    const deliveryOrder = await sanityGetById<{
        _id: string;
        _rev?: string;
        doNumber?: string;
        status?: string;
        driverRef?: unknown;
        receiverName?: string;
        receiverCompany?: string;
        receiverAddress?: string;
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
        pendingDriverActualDropPoints?: DeliveryActualDropPoint[];
    }>(id);
    if (!deliveryOrder) {
        return NextResponse.json({ error: 'Surat jalan tidak ditemukan' }, { status: 404 });
    }
    if (!deliveryOrder._rev) {
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

    const doItems = await getSanityClient().fetch<Array<{
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
    }>>(
        `*[_type == "deliveryOrderItem" && deliveryOrderRef == $ref]{
            _id,
            orderItemRef,
            shippedQtyKoli,
            shippedWeight,
            orderItemQtyKoli,
            orderItemWeight,
            orderItemVolumeM3,
            orderItemWeightInputValue,
            orderItemWeightInputUnit,
            orderItemVolumeInputValue,
            orderItemVolumeInputUnit,
            actualQtyKoli,
            actualWeightKg,
            actualVolumeM3,
            actualWeightInputValue,
            actualWeightInputUnit,
            actualVolumeInputValue,
            actualVolumeInputUnit
        }`,
        { ref: id }
    );
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
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Draft penyelesaian driver tidak valid' },
            { status: 400 }
        );
    }

    const timestamp = new Date().toISOString();
    const transaction = getSanityClient()
        .transaction()
        .patch(id, {
            ifRevisionID: deliveryOrder._rev,
            set: {
                pendingDriverStatus: status,
                pendingDriverStatusRequestedAt: timestamp,
                pendingDriverStatusRequestedBy: session._id,
                pendingDriverStatusRequestedByName: session.name,
                pendingDriverStatusNote: note,
                pendingDriverActualCargoItems,
                pendingDriverActualDropPoints,
            },
        })
        .create({
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

    try {
        await transaction.commit();
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
        `Driver mengajukan status ${status} untuk DO ${deliveryOrder.doNumber || id} (${pendingDriverActualCargoItems.length} item aktual draft, ${pendingDriverActualDropPoints?.length || 0} titik drop draft)${note ? `: ${note}` : ''}`
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

    const deliveryOrder = await sanityGetById<{
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
    }>(id);
    if (!deliveryOrder) {
        return NextResponse.json({ error: 'Surat jalan tidak ditemukan' }, { status: 404 });
    }
    if (!deliveryOrder._rev) {
        return NextResponse.json({ error: 'Revisi surat jalan tidak tersedia. Refresh lalu coba lagi.' }, { status: 409 });
    }
    if (!deliveryOrder.pendingDriverStatus) {
        return NextResponse.json({ error: 'Tidak ada permintaan status driver yang menunggu approval' }, { status: 409 });
    }

    const timestamp = new Date().toISOString();
    const transaction = getSanityClient()
        .transaction()
        .patch(id, {
            ifRevisionID: deliveryOrder._rev,
            unset: DRIVER_STATUS_REQUEST_FIELDS,
        })
        .create({
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

    try {
        await transaction.commit();
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
            pendingDriverStatus: undefined,
            pendingDriverStatusRequestedAt: undefined,
            pendingDriverStatusRequestedBy: undefined,
            pendingDriverStatusRequestedByName: undefined,
            pendingDriverStatusNote: undefined,
            pendingDriverActualCargoItems: undefined,
            pendingDriverActualDropPoints: undefined,
        },
    });
}

export async function handleDeliveryOrderCreate(
    session: ApiSession,
    data: Record<string, unknown>,
    addAuditLog: AuditLogFn
) {
    const orderRef = typeof data.orderRef === 'string' ? data.orderRef : '';
    const orderTripPlanKey = normalizeOptionalText(data.orderTripPlanKey);
    if (!orderRef) {
        return NextResponse.json({ error: 'Order surat jalan wajib diisi' }, { status: 400 });
    }
    const doReceiverName = normalizeOptionalText(data.receiverName);
    const doReceiverPhone = normalizeOptionalText(data.receiverPhone);
    const doReceiverAddress = normalizeOptionalText(data.receiverAddress);
    const doReceiverCompany = normalizeOptionalText(data.receiverCompany);

    const order = await sanityGetById<{
        _id: string;
        _rev?: string;
        masterResi?: string;
        cargoEntryMode?: 'ORDER' | 'DELIVERY_ORDER';
        customerRef?: string;
        customerName?: string;
        receiverName?: string;
        receiverPhone?: string;
        receiverAddress?: string;
        receiverCompany?: string;
        pickupAddress?: string;
        pickupStops?: OrderPickupStop[];
        tripPlans?: OrderTripPlan[];
        serviceRef?: string;
        serviceName?: string;
    }>(orderRef);
    if (!order) {
        return NextResponse.json({ error: 'Order tidak ditemukan' }, { status: 404 });
    }
    const orderTripPlans = normalizeOrderTripPlansSnapshot(order.tripPlans);
    const selectedOrderTripPlan =
        orderTripPlanKey
            ? orderTripPlans.find(plan => plan._key === orderTripPlanKey) || null
            : null;
    if (orderTripPlanKey && !selectedOrderTripPlan) {
        return NextResponse.json({ error: 'Rencana trip order tidak ditemukan atau sudah berubah' }, { status: 409 });
    }
    if (selectedOrderTripPlan?.linkedDeliveryOrderRef) {
        const linkedDeliveryOrder = await sanityGetById<{ _id: string; doNumber?: string; status?: string }>(selectedOrderTripPlan.linkedDeliveryOrderRef);
        if (linkedDeliveryOrder && linkedDeliveryOrder.status !== 'CANCELLED') {
            return NextResponse.json(
                {
                    error: `Rencana trip ini sudah dipakai di surat jalan ${linkedDeliveryOrder.doNumber || selectedOrderTripPlan.linkedDeliveryOrderNumber || linkedDeliveryOrder._id}`,
                },
                { status: 409 }
            );
        }
    }

    const orderCustomerRef = extractRefId(order.customerRef);
    const customer = orderCustomerRef
        ? await sanityGetById<{
            _id: string;
            _rev?: string;
            name?: string;
            active?: boolean;
            deliveryOrderPrefix?: string;
            deliveryOrderCounter?: number;
            deliveryOrderPeriod?: string;
        }>(orderCustomerRef)
        : null;
    if (orderCustomerRef && !customer) {
        return NextResponse.json({ error: 'Customer order tidak ditemukan' }, { status: 404 });
    }

    const vehicleRef = selectedOrderTripPlan?.vehicleRef || (typeof data.vehicleRef === 'string' ? data.vehicleRef : '');
    let vehiclePlate =
        selectedOrderTripPlan?.vehiclePlate ||
        (typeof data.vehiclePlate === 'string' && data.vehiclePlate.trim()
            ? data.vehiclePlate.trim()
            : '');
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
    const vehicleCategoryOverrideReason = selectedOrderTripPlan?.vehicleCategoryOverrideReason || normalizeOptionalText(data.vehicleCategoryOverrideReason);
    const driverRef = selectedOrderTripPlan?.driverRef || (typeof data.driverRef === 'string' ? data.driverRef : '');
    let driverName =
        selectedOrderTripPlan?.driverName ||
        (typeof data.driverName === 'string' && data.driverName.trim()
            ? data.driverName.trim()
            : '');
    let selectedDriver: { _id: string; _rev?: string; name?: string; active?: boolean } | null = null;
    let vehicleServiceRef: string | undefined;
    let vehicleServiceName: string | undefined;
    let vehicleCategoryOverrideReasonToStore: string | undefined;

    if (!vehicleRef) {
        return NextResponse.json({ error: 'Kendaraan wajib dipilih saat membuat surat jalan' }, { status: 400 });
    }
    if (vehicleRef) {
        const vehicle = await sanityGetById<{
            _id: string;
            plateNumber?: string;
            status?: string;
            serviceRef?: string;
            serviceName?: string;
            capacityKg?: number;
            _rev?: string;
        }>(vehicleRef);
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
        const conflictingDeliveryOrder = await getSanityClient().fetch<{
            _id: string;
            doNumber?: string;
            customerDoNumber?: string;
        } | null>(
            `*[
                _type == "deliveryOrder" &&
                status in ["CREATED", "HEADING_TO_PICKUP", "ON_DELIVERY", "ARRIVED"] &&
                ((vehicleRef == $ref || vehicleRef._ref == $ref) || lower(coalesce(vehiclePlate, "")) == $plate)
            ][0]{
                _id,
                doNumber,
                customerDoNumber
            }`,
            {
                ref: vehicleRef,
                plate: (vehicle.plateNumber || vehiclePlate || '').toLowerCase(),
            }
        );
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
        const driver = await sanityGetById<{ _id: string; _rev?: string; name?: string; active?: boolean }>(driverRef);
        if (!driver) {
            return NextResponse.json({ error: 'Supir DO tidak ditemukan' }, { status: 404 });
        }
        selectedDriver = driver;
        if (driver.active === false) {
            return NextResponse.json({ error: 'Supir DO tidak aktif' }, { status: 409 });
        }
        const conflictingDeliveryOrder = await getSanityClient().fetch<{
            _id: string;
            doNumber?: string;
            customerDoNumber?: string;
        } | null>(
            `*[
                _type == "deliveryOrder" &&
                status in ["CREATED", "HEADING_TO_PICKUP", "ON_DELIVERY", "ARRIVED"] &&
                ((driverRef == $ref || driverRef._ref == $ref) || lower(coalesce(driverName, "")) == $driverName)
            ][0]{
                _id,
                doNumber,
                customerDoNumber
            }`,
            {
                ref: driverRef,
                driverName: (driver.name || driverName || '').toLowerCase(),
            }
        );
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
        selectedOrderTripPlan?.date ||
        (typeof data.date === 'string' && data.date
            ? data.date
            : getBusinessDateValue());
    try {
        assertIsoDate(doDate, 'Tanggal surat jalan');
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Tanggal surat jalan tidak valid' },
            { status: 400 }
        );
    }
    const manualCustomerDoNumber = normalizeOptionalText(data.customerDoNumber)?.toUpperCase();
    const taripBorongan = normalizeCurrencyNumber(selectedOrderTripPlan?.taripBorongan ?? data.taripBorongan ?? 0);
    if (!Number.isFinite(taripBorongan) || taripBorongan < 0) {
        return NextResponse.json({ error: 'Upah trip pada surat jalan tidak valid' }, { status: 400 });
    }
    let tripRouteSelection: Awaited<ReturnType<typeof resolveTripRouteRateSelection>>;
    try {
        tripRouteSelection = await resolveTripRouteRateSelection(selectedOrderTripPlan || data, {
            serviceRef: order.serviceRef,
        });
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Master biaya rute trip tidak valid' },
            { status: 400 }
        );
    }
    const matchedTripRouteRateFee = normalizeCurrencyNumber(tripRouteSelection?.matchedTripRouteRate?.rate ?? 0);
    if (tripRouteSelection?.matchedTripRouteRate && !tripRouteSelection.matchedTripRouteRate._rev) {
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
    const effectiveTripFee =
        matchedTripRouteRateFee > 0
            ? matchedTripRouteRateFee
            : taripBorongan;
    const tripCashIssueBankRef = selectedOrderTripPlan?.issueBankRef || (typeof data.issueBankRef === 'string' ? data.issueBankRef : '');
    const tripCashCashGiven = normalizeCurrencyNumber(selectedOrderTripPlan?.cashGiven ?? data.cashGiven ?? 0);
    const wantsInitialTripCash = Boolean(tripCashIssueBankRef) || tripCashCashGiven > 0;
    if (wantsInitialTripCash && !driverRef) {
        return NextResponse.json({ error: 'Supir wajib dipilih sebelum uang jalan awal diterbitkan' }, { status: 400 });
    }
    if (wantsInitialTripCash && !tripCashIssueBankRef) {
        return NextResponse.json({ error: 'Rekening atau kas sumber uang jalan trip wajib dipilih' }, { status: 400 });
    }
    if (wantsInitialTripCash && (!Number.isFinite(tripCashCashGiven) || tripCashCashGiven <= 0)) {
        return NextResponse.json({ error: 'Nominal uang jalan awal wajib diisi' }, { status: 400 });
    }
    if (wantsInitialTripCash && (!Number.isFinite(effectiveTripFee) || effectiveTripFee <= 0)) {
        return NextResponse.json({ error: 'Upah trip wajib diisi sebelum menerbitkan uang jalan awal' }, { status: 400 });
    }
    const shouldIssueInitialTripCash =
        wantsInitialTripCash &&
        Boolean(driverRef) &&
        Boolean(tripCashIssueBankRef) &&
        Number.isFinite(tripCashCashGiven) &&
        tripCashCashGiven > 0 &&
        Number.isFinite(effectiveTripFee) &&
        effectiveTripFee > 0;
    let selectedPickupStops: NormalizedDeliveryOrderPickupStop[] = [];
    try {
        selectedPickupStops = resolveDeliveryOrderPickupStops(
            order,
            selectedOrderTripPlan
                ? { pickupStopKeys: selectedOrderTripPlan.pickupStopKeys }
                : data
        );
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Titik pickup surat jalan tidak valid' },
            { status: 400 }
        );
    }
    if (selectedPickupStops.length === 0 && normalizeOptionalText(order.pickupAddress)) {
        selectedPickupStops = [{
            _key: 'pickup-stop-1',
            sequence: 1,
            pickupAddress: normalizeOptionalText(order.pickupAddress) as string,
        }];
    }

    let shipperReferences: NormalizedDeliveryOrderShipperReference[] = [];
    try {
        shipperReferences = normalizeIncomingShipperReferences(
            {
                ...data,
                customerDoNumber: manualCustomerDoNumber,
            },
            selectedPickupStops,
            undefined,
            false
        );
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Referensi SJ pengirim tidak valid' },
            { status: 400 }
        );
    }
    let customerDoNumber = shipperReferences[0]?.referenceNumber || undefined;

    const existingOrderItemCount = await getSanityClient().fetch<number>(
        `count(*[_type == "orderItem" && orderRef == $ref])`,
        { ref: orderRef }
    );
    const orderItemCargoModeHints =
        !order.cargoEntryMode && existingOrderItemCount > 0
            ? await getSanityClient().fetch<Array<{
                _createdAt?: string;
                entrySource?: 'ORDER' | 'DELIVERY_ORDER';
                sourceDeliveryOrderRef?: string;
            }>>(
                `*[_type == "orderItem" && orderRef == $ref]{
                    _createdAt,
                    entrySource,
                    sourceDeliveryOrderRef
                }`,
                { ref: orderRef }
            )
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
    let draftCargoRows: Array<Record<string, unknown>> = [];
    const selectionSummaries: string[] = [];
    let plannedShipmentWeightKgTotal = 0;

    if (usingDirectCargoInput) {
        try {
            directCargoItems = await normalizeOrderItemsInput(
                orderCustomerRef || normalizeText(order.customerRef),
                Array.isArray(data.cargoItems) ? data.cargoItems : [],
                { allowEmpty: true }
            );
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Barang surat jalan tidak valid';
            return NextResponse.json({ error: message }, { status: 400 });
        }
        draftCargoRows = (Array.isArray(data.cargoItems) ? data.cargoItems : [])
            .filter(isPlainObject)
            .filter(hasDraftCargoPayloadRow);
        if (draftCargoRows.length !== directCargoItems.length) {
            return NextResponse.json(
                { error: 'Draft barang surat jalan berubah. Refresh lalu isi lagi.' },
                { status: 409 }
            );
        }
        if (!allowsDirectCargoInput && directCargoItems.length > 0) {
            return NextResponse.json(
                { error: 'Order ini sudah punya item target. Pilih item order yang mau dimasukkan ke surat jalan.' },
                { status: 409 }
            );
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
        const pickupStopMap = new Map(selectedPickupStops.map(stop => [stop._key, stop]));
        for (const [index, item] of directCargoItems.entries()) {
            const cargoDraft = draftCargoRows[index];
            const pickupStopKey =
                normalizeOptionalText(cargoDraft?.pickupStopKey)
                || (selectedPickupStops.length === 1 ? selectedPickupStops[0]._key : undefined);
            if (selectedPickupStops.length > 0 && !pickupStopKey) {
                return NextResponse.json(
                    { error: `Titik pickup wajib dipilih untuk barang ${item.description || `baris ${index + 1}`}` },
                    { status: 400 }
                );
            }
            if (pickupStopKey && !pickupStopMap.has(pickupStopKey)) {
                return NextResponse.json(
                    { error: `Titik pickup untuk barang ${item.description || `baris ${index + 1}`} tidak ditemukan di trip ini` },
                    { status: 400 }
                );
            }
            const shipperReferenceNumber = normalizeReferenceNumber(cargoDraft?.shipperReferenceNumber || manualCustomerDoNumber);
            if (!shipperReferenceNumber) {
                return NextResponse.json(
                    { error: `No. SJ pengirim wajib diisi untuk barang ${item.description || `baris ${index + 1}`}` },
                    { status: 400 }
                );
            }
            try {
                upsertShipperReferenceForPickup(shipperReferences, shipperReferenceNumber, pickupStopKey, pickupStopMap);
            } catch (error) {
                return NextResponse.json(
                    { error: error instanceof Error ? error.message : 'Referensi SJ pengirim tidak valid' },
                    { status: 400 }
                );
            }
            selectionSummaries.push(
                summarizeSelection({
                    orderItemRef: item.description,
                    qtyKoli: item.qtyKoli,
                    weightInputValue: item.weightInputValue,
                    weightInputUnit: item.weightInputUnit,
                    volumeInputValue: item.volumeInputValue,
                    volumeInputUnit: item.volumeInputUnit,
                    holdRemaining: false,
                }, `${shipperReferenceNumber}${item.description ? ` - ${item.description}` : ''}`)
            );
        }
        if (directCargoItems.length === 0) {
            selectionSummaries.push('muatan menyusul');
        }
    } else if (resolvedCargoEntryMode === 'DELIVERY_ORDER') {
        return NextResponse.json(
            { error: 'Order ini memakai flow barang di Surat Jalan. Barang baru harus diinput langsung saat membuat Surat Jalan.' },
            { status: 409 }
        );
    } else {
        selectedItems = await getSanityClient().fetch<Array<OrderItemProgressSnapshot & { _rev?: string }>>(
            `*[_type == "orderItem" && _id in $ids]{
                _id,
                _rev,
                orderRef,
                description,
                qtyKoli,
                weight,
                volume,
                weightInputValue,
                weightInputUnit,
                volumeInputValue,
                volumeInputUnit,
                status,
                deliveredQtyKoli,
                deliveredWeight,
                deliveredVolume,
                assignedQtyKoli,
                assignedWeight,
                assignedVolume,
                heldQtyKoli,
                heldWeight,
                heldVolume,
                holdReason,
                holdLocation
            }`,
            { ids: requestedItemIds }
        );
        if (selectedItems.length !== requestedItemIds.length) {
            return NextResponse.json({ error: 'Sebagian item order tidak ditemukan' }, { status: 404 });
        }
        if (selectedItems.some(item => !item._rev)) {
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
            const activeAssignment = await getSanityClient().fetch<{ _id: string } | null>(
                `*[
                    _type == "deliveryOrderItem" &&
                    orderItemRef == $orderItemRef &&
                    defined(*[_type == "deliveryOrder" && _id == ^.deliveryOrderRef && status in ["CREATED", "HEADING_TO_PICKUP", "ON_DELIVERY", "ARRIVED"]][0]._id)
                ][0]{ _id }`,
                { orderItemRef: item._id }
            );
            if (activeAssignment) {
                return NextResponse.json({ error: 'Ada item yang sudah terikat ke surat jalan aktif lain' }, { status: 409 });
            }

            if (progress.totalQtyKoli > 0) {
                if (!Number.isFinite(selection.qtyKoli) || selection.qtyKoli <= 0) {
                    return NextResponse.json({ error: 'Jumlah koli kirim harus lebih besar dari 0' }, { status: 400 });
                }
                if (selection.qtyKoli > progress.pendingQtyKoli) {
                    return NextResponse.json({ error: `Jumlah koli kirim untuk ${item.description || 'item order'} melebihi sisa qty yang siap dikirim` }, { status: 409 });
                }

                const remainingQtyAfterShipment = roundQuantity(Math.max(progress.pendingQtyKoli - selection.qtyKoli, 0));
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
                return NextResponse.json({ error: `Tidak ada sisa berat/volume ${item.description || 'item order'} yang siap dikirim` }, { status: 409 });
            }
            if (selection.qtyKoli > 0) {
                return NextResponse.json(
                    { error: `Item ${item.description || 'item order'} tidak memakai basis koli. Centang item untuk mengirim seluruh sisa berat/volume.` },
                    { status: 400 }
                );
            }
            const selectedWeightInputValue = normalizeNumber(selection.weightInputValue ?? 0, {
                maxFractionDigits: selection.weightInputUnit === 'TON' ? 3 : 2,
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
                return NextResponse.json({ error: `Berat kirim untuk ${item.description || 'item order'} melebihi sisa berat yang siap dikirim` }, { status: 409 });
            }
            if (selectedVolumeM3 - progress.pendingVolume > 0.00001) {
                return NextResponse.json({ error: `Volume kirim untuk ${item.description || 'item order'} melebihi sisa volume yang siap dikirim` }, { status: 409 });
            }
            const remainingWeightAfterShipment = roundQuantity(Math.max(progress.pendingWeight - selectedWeightKg, 0));
            const remainingVolumeAfterShipment = roundQuantity(Math.max(progress.pendingVolume - selectedVolumeM3, 0), 3);
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

    customerDoNumber = shipperReferences[0]?.referenceNumber || undefined;
    if (orderCustomerRef && shipperReferences.length > 0) {
        const duplicateCustomerDoNumber = await findDuplicateCustomerDoReference(orderCustomerRef, shipperReferences);
        if (duplicateCustomerDoNumber) {
            return NextResponse.json(
                { error: `No. SJ pengirim ${duplicateCustomerDoNumber.referenceNumber} sudah dipakai untuk customer ini.` },
                { status: 409 }
            );
        }
    }

    const doId = crypto.randomUUID();
    const doNumber = await sanityGetNextNumber('do', doDate);
    const companyProfile = await getSanityClient().fetch<Pick<CompanyProfile, 'name' | 'address' | 'phone' | 'email' | 'logoUrl'> | null>(
        `*[_type == "companyProfile"][0]{
            name,
            address,
            phone,
            email,
            logoUrl
        }`
    );
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
        shipperReferences: shipperReferences.length > 0 ? shipperReferences : undefined,
        receiverName: doReceiverName || order.receiverName,
        receiverPhone: doReceiverPhone || order.receiverPhone,
        receiverAddress: doReceiverAddress || order.receiverAddress,
        receiverCompany: doReceiverCompany || order.receiverCompany,
        pickupAddress: buildPickupSummary(selectedPickupStops, order.pickupAddress),
        pickupStops: selectedPickupStops.length > 0 ? selectedPickupStops : undefined,
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
        baseTaripBorongan: effectiveTripFee > 0 ? effectiveTripFee : undefined,
        taripBorongan: effectiveTripFee > 0 ? effectiveTripFee : undefined,
        vehicleCapacityKg: vehicleCapacityKg > 0 ? vehicleCapacityKg : undefined,
        date: doDate,
        notes: normalizeOptionalText(data.notes),
        doNumber,
        status: 'CREATED',
    };
    let bonNumber: string | undefined;
    let voucherId: string | undefined;
    let initialDisbursementId: string | undefined;
    let issueTransactionId: string | undefined;
    let issueBank: Awaited<ReturnType<typeof getLedgerAccount>> | null = null;
    let issueBankNextBalance = 0;
    if (shouldIssueInitialTripCash) {
        bonNumber = await sanityGetNextNumber('bon', doDate);
        voucherId = crypto.randomUUID();
        initialDisbursementId = crypto.randomUUID();
        issueTransactionId = crypto.randomUUID();
        issueBank = await getLedgerAccount(tripCashIssueBankRef);
        if (!issueBank) {
            return NextResponse.json({ error: 'Rekening sumber uang jalan trip tidak ditemukan' }, { status: 404 });
        }
        if (!issueBank._rev) {
            return NextResponse.json({ error: 'Revisi rekening sumber uang jalan trip tidak tersedia' }, { status: 409 });
        }
        const { startingBalance: issueStartingBalance, nextBalance } = computeLedgerDebitBalance(issueBank.currentBalance, tripCashCashGiven);
        issueBankNextBalance = nextBalance;
        if (issueBankNextBalance < 0) {
            return NextResponse.json(
                { error: `Saldo ${issueBank.bankName} tidak cukup untuk pencairan bon. Saldo tersedia ${issueStartingBalance}` },
                { status: 409 }
            );
        }
    }

    const customerDoConstraints =
        orderCustomerRef && shipperReferences.length > 0
            ? buildCustomerDoConstraintDocs(doId, orderCustomerRef, shipperReferences)
            : [];
    const transaction = getSanityClient().transaction();
    customerDoConstraints.forEach(constraint => transaction.create(constraint));
    transaction.create(doDoc);
    if (shouldIssueInitialTripCash && voucherId && initialDisbursementId && issueTransactionId && issueBank && bonNumber) {
        const tripRouteLabel = buildRouteLabel(
            buildPickupSummary(selectedPickupStops, order.pickupAddress),
            doReceiverAddress || order.receiverAddress,
        );
        const voucherTotals = computeDriverVoucherTotals(tripCashCashGiven, 0, effectiveTripFee);
        transaction.create({
            _id: voucherId,
            _type: 'driverVoucher',
            issuerCompanyName: companyProfile?.name,
            issuerCompanyAddress: companyProfile?.address,
            issuerCompanyPhone: companyProfile?.phone,
            issuerCompanyEmail: companyProfile?.email,
            issuerCompanyLogoUrl: resolveCompanyLogoUrl(companyProfile),
            driverRef,
            driverName,
            deliveryOrderRef: doId,
            doNumber,
            vehicleRef: vehicleRef || undefined,
            vehiclePlate: vehiclePlate || undefined,
            route: tripRouteLabel || undefined,
            bonNumber,
            issuedDate: doDate,
            cashGiven: tripCashCashGiven,
            initialCashGiven: tripCashCashGiven,
            totalIssuedAmount: tripCashCashGiven,
            topUpCount: 0,
            driverFeeAmount: voucherTotals.driverFeeAmount,
            totalClaimAmount: voucherTotals.totalClaimAmount,
            issueBankRef: tripCashIssueBankRef,
            issueBankName: issueBank.bankName,
            totalSpent: voucherTotals.totalSpent,
            balance: voucherTotals.balance,
            status: 'ISSUED',
        });
        transaction.create({
            _id: initialDisbursementId,
            _type: 'driverVoucherDisbursement',
            voucherRef: voucherId,
            date: doDate,
            amount: tripCashCashGiven,
            kind: 'INITIAL',
            bankAccountRef: tripCashIssueBankRef,
            bankAccountName: issueBank.bankName,
            bankAccountNumber: issueBank.accountNumber,
            bankTransactionRef: issueTransactionId,
            createdBy: session._id,
            createdByName: session.name,
        });
        transaction.create({
            _id: issueTransactionId,
            _type: 'bankTransaction',
            bankAccountRef: tripCashIssueBankRef,
            bankAccountName: issueBank.bankName,
            bankAccountNumber: issueBank.accountNumber,
            type: 'DEBIT',
            amount: tripCashCashGiven,
            date: doDate,
            description: `Pencairan uang jalan trip ${bonNumber}`,
            balanceAfter: issueBankNextBalance,
            relatedVoucherRef: voucherId,
        });
        transaction.patch(tripCashIssueBankRef, {
            ifRevisionID: issueBank._rev,
            set: { currentBalance: issueBankNextBalance },
        });
    }
    const mutationTimestamp = new Date().toISOString();
    if (tripRouteSelection?.matchedTripRouteRate?._id && tripRouteSelection.matchedTripRouteRate._rev) {
        transaction.patch(tripRouteSelection.matchedTripRouteRate._id, {
            ifRevisionID: tripRouteSelection.matchedTripRouteRate._rev,
            set: { updatedAt: mutationTimestamp },
        });
    }
    if (selectedVehicle?._id) {
        if (!selectedVehicle._rev) {
            return NextResponse.json({ error: 'Revisi kendaraan tidak tersedia. Refresh lalu coba lagi.' }, { status: 409 });
        }
        transaction.patch(selectedVehicle._id, {
            ifRevisionID: selectedVehicle._rev,
            set: { updatedAt: mutationTimestamp },
        });
    }
    if (selectedDriver?._id) {
        if (!selectedDriver._rev) {
            return NextResponse.json({ error: 'Revisi supir tidak tersedia. Refresh lalu coba lagi.' }, { status: 409 });
        }
        transaction.patch(selectedDriver._id, {
            ifRevisionID: selectedDriver._rev,
            set: { updatedAt: mutationTimestamp },
        });
    }
    const nextOrderPatchSet: Record<string, unknown> = {};
    if (usingDirectCargoInput && directCargoItems.length > 0 && order.cargoEntryMode !== 'DELIVERY_ORDER') {
        nextOrderPatchSet.cargoEntryMode = 'DELIVERY_ORDER';
    }
    if (selectedOrderTripPlan) {
        nextOrderPatchSet.tripPlans = orderTripPlans.map(plan => (
            plan._key === selectedOrderTripPlan._key
                ? {
                    ...plan,
                    linkedDeliveryOrderRef: doId,
                    linkedDeliveryOrderNumber: doNumber,
                }
                : plan
        ));
    }
    if (Object.keys(nextOrderPatchSet).length > 0) {
        if (!order._rev) {
            return NextResponse.json({ error: 'Revisi order tidak tersedia. Refresh lalu coba lagi.' }, { status: 409 });
        }
        transaction.patch(orderRef, {
            ifRevisionID: order._rev,
            set: nextOrderPatchSet,
        });
    }
    if (usingDirectCargoInput) {
        try {
            patchLinkedCustomerProducts(transaction, directCargoItems, mutationTimestamp);
        } catch (error) {
            return NextResponse.json(
                { error: error instanceof Error ? error.message : 'Barang customer berubah karena ada update lain. Refresh lalu coba lagi.' },
                { status: 409 }
            );
        }
        const pickupStopMap = new Map(selectedPickupStops.map(stop => [stop._key, stop]));
        const shipperReferenceMap = new Map(shipperReferences.map(reference => [reference.referenceNumber, reference]));
        for (const [index, item] of directCargoItems.entries()) {
            const cargoDraft = draftCargoRows[index];
            const pickupStopKey =
                normalizeOptionalText(cargoDraft?.pickupStopKey)
                || (selectedPickupStops.length === 1 ? selectedPickupStops[0]._key : undefined);
            const shipperReferenceNumber = normalizeReferenceNumber(cargoDraft?.shipperReferenceNumber || manualCustomerDoNumber);
            const shipperReference = shipperReferenceNumber ? shipperReferenceMap.get(shipperReferenceNumber) : undefined;
            const orderItemId = crypto.randomUUID();
            const usesQtyBasis = item.qtyKoli > 0;
            transaction.create({
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
            transaction.create({
                _id: crypto.randomUUID(),
                _type: 'deliveryOrderItem',
                deliveryOrderRef: doId,
                orderItemRef: orderItemId,
                pickupStopKey: pickupStopKey || undefined,
                pickupAddress: pickupStopKey ? pickupStopMap.get(pickupStopKey)?.pickupAddress : undefined,
                shipperReferenceKey: shipperReference?._key,
                shipperReferenceNumber: shipperReference?.referenceNumber,
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
            maxFractionDigits: selection.weightInputUnit === 'TON' ? 3 : 2,
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
                ? roundQuantity(convertKgToWeightInputValue(shippedWeight, item.weightInputUnit), item.weightInputUnit === 'TON' ? 3 : 2)
                : !usesQtyBasis && selection.weightInputValue && selection.weightInputUnit
                    ? roundQuantity(selection.weightInputValue, selection.weightInputUnit === 'TON' ? 3 : 2)
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
        const remainingQtyAfterShipment = roundQuantity(Math.max(progress.pendingQtyKoli - shippedQtyKoli, 0));
        const remainingWeightAfterShipment = roundQuantity(Math.max(progress.pendingWeight - shippedWeight, 0));
        const remainingVolumeAfterShipment = roundQuantity(Math.max(progress.pendingVolume - shippedVolumeM3, 0), 3);
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
            pendingQtyKoli: roundQuantity(Math.max(progress.pendingQtyKoli - shippedQtyKoli - holdQtyToApply, 0)),
            pendingWeight: roundQuantity(Math.max(progress.pendingWeight - shippedWeight - holdWeightToApply, 0)),
            pendingVolume: roundQuantity(Math.max(progress.pendingVolume - shippedVolumeM3 - holdVolumeToApply, 0), 3),
        };

        transaction.create({
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
        transaction.patch(item._id, {
            ifRevisionID: item._rev,
            set: {
                assignedQtyKoli: nextProgress.assignedQtyKoli,
                assignedWeight: nextProgress.assignedWeight,
                assignedVolume: nextProgress.assignedVolume,
                heldQtyKoli: nextProgress.heldQtyKoli,
                heldWeight: nextProgress.heldWeight,
                heldVolume: nextProgress.heldVolume,
                holdReason: selection.holdRemaining ? selection.holdReason : item.holdReason,
                holdLocation: selection.holdRemaining ? selection.holdLocation : item.holdLocation,
                status: deriveOrderItemStatusFromProgress(nextProgress),
            },
        });
    }

    try {
        await transaction.commit();
    } catch (error) {
        if (customerDoConstraints.some(constraint => isDocumentAlreadyExistsError(error, constraint._id))) {
            return NextResponse.json(
                { error: `Salah satu SJ pengirim (${shipperReferences.map(reference => reference.referenceNumber).join(', ')}) sudah dipakai untuk customer ini.` },
                { status: 409 }
            );
        }
        if (isMutationConflictError(error)) {
            return NextResponse.json(
                { error: 'Data order, barang customer, kendaraan, supir, rekening sumber, atau item surat jalan berubah karena ada update lain. Refresh lalu coba lagi.' },
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
        `Created delivery-orders: ${doNumber}${shipperReferences.length > 0 ? ` / ${shipperReferences.map(reference => reference.referenceNumber).join(', ')}` : ''} (${selectionSummaries.join('; ')})${selectedOrderTripPlan ? ` | dari rencana trip ${selectedOrderTripPlan.sequence}` : ''}${bonNumber ? ` | bon ${bonNumber}` : ''}${vehicleCategoryOverrideReasonToStore ? ` | override armada: ${order.serviceName || '-'} -> ${vehicleServiceName || vehiclePlate || '-'} | alasan: ${vehicleCategoryOverrideReasonToStore}` : ''}`
    );
    return NextResponse.json({ data: doDoc, id: doId, issuedVoucherBonNumber: bonNumber });
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

    const deliveryOrder = await sanityGetById<{
        _id: string;
        _rev?: string;
        doNumber?: string;
        status?: string;
        pendingDriverStatus?: string;
        orderRef?: unknown;
        customerRef?: unknown;
        vehicleRef?: unknown;
        pickupStops?: DeliveryOrderPickupStop[];
        shipperReferences?: DeliveryOrderShipperReference[];
    }>(id);
    if (!deliveryOrder) {
        return NextResponse.json({ error: 'Surat jalan tidak ditemukan' }, { status: 404 });
    }
    if (!['CREATED', 'HEADING_TO_PICKUP', 'ON_DELIVERY', 'ARRIVED'].includes(deliveryOrder.status || '')) {
        return NextResponse.json(
            { error: 'Muatan hanya bisa ditambahkan saat surat jalan masih aktif sebelum trip selesai atau dibatalkan.' },
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

    const order = await sanityGetById<{
        _id: string;
        _rev?: string;
        customerRef?: unknown;
        cargoEntryMode?: 'ORDER' | 'DELIVERY_ORDER';
    }>(orderRef);
    if (!order) {
        return NextResponse.json({ error: 'Order sumber surat jalan tidak ditemukan' }, { status: 404 });
    }

    const existingOrderItemCount = await getSanityClient().fetch<number>(
        `count(*[_type == "orderItem" && orderRef == $ref])`,
        { ref: orderRef }
    );
    const orderItemCargoModeHints =
        !order.cargoEntryMode && existingOrderItemCount > 0
            ? await getSanityClient().fetch<Array<{
                _createdAt?: string;
                entrySource?: 'ORDER' | 'DELIVERY_ORDER';
                sourceDeliveryOrderRef?: string;
            }>>(
                `*[_type == "orderItem" && orderRef == $ref]{
                    _createdAt,
                    entrySource,
                    sourceDeliveryOrderRef
                }`,
                { ref: orderRef }
            )
            : [];
    const resolvedCargoEntryMode = resolveOrderCargoEntryMode(order, orderItemCargoModeHints);
    const allowsDirectCargoInput = resolvedCargoEntryMode === 'DELIVERY_ORDER' || existingOrderItemCount === 0;

    const doPickupStops = normalizeDeliveryOrderPickupStopsSnapshot(deliveryOrder.pickupStops);
    const pickupStopMap = new Map(doPickupStops.map(stop => [stop._key, stop]));
    const existingShipperReferences = normalizeDeliveryOrderPersistedShipperReferences(deliveryOrder, doPickupStops);
    const hasExplicitShipperReferences =
        Array.isArray(data.shipperReferences) || Boolean(normalizeReferenceNumber(data.customerDoNumber));
    let nextShipperReferences = [...existingShipperReferences];
    if (hasExplicitShipperReferences) {
        try {
            nextShipperReferences = normalizeIncomingShipperReferences(data, doPickupStops, deliveryOrder.shipperReferences, false);
        } catch (error) {
            return NextResponse.json(
                { error: error instanceof Error ? error.message : 'Referensi SJ pengirim tidak valid' },
                { status: 400 }
            );
        }
    }

    let directCargoItems: NormalizedOrderItemInput[] = [];
    try {
        directCargoItems = await normalizeOrderItemsInput(
            extractRefId(order.customerRef) || extractRefId(deliveryOrder.customerRef) || '',
            Array.isArray(data.cargoItems) ? data.cargoItems : [],
            { allowEmpty: true }
        );
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Barang surat jalan tidak valid';
        return NextResponse.json({ error: message }, { status: 400 });
    }
    const draftCargoRows = (Array.isArray(data.cargoItems) ? data.cargoItems : [])
        .filter(isPlainObject)
        .filter(hasDraftCargoPayloadRow);
    if (draftCargoRows.length !== directCargoItems.length) {
        return NextResponse.json(
            { error: 'Draft barang surat jalan berubah. Refresh lalu isi lagi.' },
            { status: 409 }
        );
    }
    if (!allowsDirectCargoInput && directCargoItems.length > 0) {
        return NextResponse.json(
            { error: 'Order ini memakai flow item order. Muatan tambahan tidak boleh dimasukkan manual langsung ke surat jalan.' },
            { status: 409 }
        );
    }
    if (directCargoItems.length === 0 && nextShipperReferences.length === 0) {
        return NextResponse.json(
            { error: 'Isi minimal 1 SJ pengirim atau 1 barang sebelum disimpan.' },
            { status: 400 }
        );
    }

    const currentConstraintIds = new Set(
        extractRefId(deliveryOrder.customerRef)
            ? await getExistingDeliveryOrderCustomerDoConstraintIds(id)
            : []
    );

    const existingDoItems = await getSanityClient().fetch<Array<{
        orderItemWeight?: number;
        shippedWeight?: number;
    }>>(
        `*[_type == "deliveryOrderItem" && deliveryOrderRef == $ref]{
            orderItemWeight,
            shippedWeight
        }`,
        { ref: id }
    );
    const existingPlannedWeightKg = roundQuantity(
        (existingDoItems || []).reduce(
            (sum, item) => sum + normalizeNumber(item.orderItemWeight ?? item.shippedWeight ?? 0),
            0
        )
    );
    const appendedWeightKg = roundQuantity(
        directCargoItems.reduce((sum, item) => sum + normalizeNumber(item.weight || 0), 0)
    );

    const vehicleRef = extractRefId(deliveryOrder.vehicleRef);
    if (vehicleRef) {
        const vehicle = await sanityGetById<{ _id: string; capacityKg?: number }>(vehicleRef);
        const vehicleCapacityKg = normalizeNumber(vehicle?.capacityKg ?? 0);
        if (
            vehicleCapacityKg > 0 &&
            roundQuantity(existingPlannedWeightKg + appendedWeightKg) - vehicleCapacityKg > 0.00001
        ) {
            return NextResponse.json(
                {
                    error: `Muatan rencana ${roundQuantity(existingPlannedWeightKg + appendedWeightKg)} kg melebihi kapasitas kendaraan ${vehicleCapacityKg} kg.`,
                },
                { status: 409 }
            );
        }
    }

    const mutationTimestamp = new Date().toISOString();
    const transaction = getSanityClient().transaction();
    if (directCargoItems.length > 0 && order.cargoEntryMode !== 'DELIVERY_ORDER') {
        if (!order._rev) {
            return NextResponse.json({ error: 'Revisi order tidak tersedia. Refresh lalu coba lagi.' }, { status: 409 });
        }
        transaction.patch(orderRef, {
            ifRevisionID: order._rev,
            set: {
                cargoEntryMode: 'DELIVERY_ORDER',
            },
        });
    }

    try {
        patchLinkedCustomerProducts(transaction, directCargoItems, mutationTimestamp);
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Barang customer berubah karena ada update lain. Refresh lalu coba lagi.' },
            { status: 409 }
        );
    }

    const selectionSummaries: string[] = [];
    for (const [index, item] of directCargoItems.entries()) {
        const cargoDraft = draftCargoRows[index];
        const pickupStopKey =
            normalizeOptionalText(cargoDraft?.pickupStopKey)
            || (doPickupStops.length === 1 ? doPickupStops[0]._key : undefined);
        if (doPickupStops.length > 0 && !pickupStopKey) {
            return NextResponse.json(
                { error: `Titik pickup wajib dipilih untuk barang ${item.description || `baris ${index + 1}`}` },
                { status: 400 }
            );
        }
        if (pickupStopKey && !pickupStopMap.has(pickupStopKey)) {
            return NextResponse.json(
                { error: `Titik pickup untuk barang ${item.description || `baris ${index + 1}`} tidak ditemukan` },
                { status: 400 }
            );
        }
        const shipperReferenceNumber = normalizeReferenceNumber(cargoDraft?.shipperReferenceNumber);
        if (!shipperReferenceNumber) {
            return NextResponse.json(
                { error: `No. SJ pengirim wajib diisi untuk barang ${item.description || `baris ${index + 1}`}` },
                { status: 400 }
            );
        }
        let shipperReference: NormalizedDeliveryOrderShipperReference;
        try {
            shipperReference = upsertShipperReferenceForPickup(nextShipperReferences, shipperReferenceNumber, pickupStopKey, pickupStopMap);
        } catch (error) {
            return NextResponse.json(
                { error: error instanceof Error ? error.message : 'Referensi SJ pengirim tidak valid' },
                { status: 400 }
            );
        }
        const orderItemId = crypto.randomUUID();
        const usesQtyBasis = item.qtyKoli > 0;
        transaction.create({
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
        transaction.create({
            _id: crypto.randomUUID(),
            _type: 'deliveryOrderItem',
            deliveryOrderRef: id,
            orderItemRef: orderItemId,
            pickupStopKey: pickupStopKey || undefined,
            pickupAddress: pickupStopKey ? pickupStopMap.get(pickupStopKey)?.pickupAddress : undefined,
            shipperReferenceKey: shipperReference._key,
            shipperReferenceNumber: shipperReference.referenceNumber,
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
        selectionSummaries.push(
            summarizeSelection({
                orderItemRef: item.description,
                qtyKoli: item.qtyKoli,
                weightInputValue: item.weightInputValue,
                weightInputUnit: item.weightInputUnit,
                volumeInputValue: item.volumeInputValue,
                volumeInputUnit: item.volumeInputUnit,
                holdRemaining: false,
            }, `${shipperReference.referenceNumber}${item.description ? ` - ${item.description}` : ''}`)
        );
    }

    if (nextShipperReferences.length > 0 && extractRefId(deliveryOrder.customerRef)) {
        const duplicateCustomerDoNumber = await findDuplicateCustomerDoReference(
            extractRefId(deliveryOrder.customerRef) as string,
            nextShipperReferences,
            id
        );
        if (duplicateCustomerDoNumber) {
            return NextResponse.json(
                { error: `No. SJ pengirim ${duplicateCustomerDoNumber.referenceNumber} sudah dipakai untuk customer ini.` },
                { status: 409 }
            );
        }
    }
    if (nextShipperReferences.length > 0) {
        if (!deliveryOrder._rev) {
            return NextResponse.json({ error: 'Revisi surat jalan tidak tersedia. Refresh lalu coba lagi.' }, { status: 409 });
        }
        const nextConstraintDocs =
            extractRefId(deliveryOrder.customerRef)
                ? buildCustomerDoConstraintDocs(id, extractRefId(deliveryOrder.customerRef) as string, nextShipperReferences)
                : [];
        nextConstraintDocs
            .filter(constraint => !currentConstraintIds.has(constraint._id))
            .forEach(constraint => transaction.create(constraint));
        transaction.patch(id, {
            ifRevisionID: deliveryOrder._rev,
            set: {
                customerDoNumber: nextShipperReferences[0]?.referenceNumber || undefined,
                shipperReferences: nextShipperReferences,
            },
        });
    }

    try {
        await transaction.commit();
    } catch (error) {
        if (
            extractRefId(deliveryOrder.customerRef) &&
            nextShipperReferences.some(reference =>
                isDocumentAlreadyExistsError(
                    error,
                    buildDeliveryOrderCustomerDoConstraintId(extractRefId(deliveryOrder.customerRef) as string, reference.referenceNumber)
                )
            )
        ) {
            return NextResponse.json(
                { error: 'Salah satu SJ pengirim yang diinput sudah dipakai untuk customer ini.' },
                { status: 409 }
            );
        }
        if (isMutationConflictError(error)) {
            return NextResponse.json(
                { error: 'Data order, barang customer, atau surat jalan berubah karena ada update lain. Refresh lalu coba lagi.' },
                { status: 409 }
            );
        }
        throw error;
    }

    if (directCargoItems.length > 0) {
        await syncOrderStatusFromItems(orderRef, session, addAuditLog);
    }
    await addAuditLog(
        session,
        'UPDATE',
        'delivery-orders',
        id,
        selectionSummaries.length > 0
            ? `Tambah muatan Surat Jalan ${deliveryOrder.doNumber || id}: ${selectionSummaries.join('; ')}`
            : `Perbarui SJ pengirim Surat Jalan ${deliveryOrder.doNumber || id}: ${nextShipperReferences.map(reference => reference.referenceNumber).join(', ')}`
    );

    return NextResponse.json({
        data: {
            _id: id,
            appendedCount: directCargoItems.length,
            shipperReferenceCount: nextShipperReferences.length,
        },
    });
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

    const deliveryOrder = await sanityGetById<{
        _id: string;
        _rev?: string;
        doNumber?: string;
        status?: string;
        pendingDriverStatus?: string;
        orderRef?: unknown;
        customerRef?: unknown;
        customerDoNumber?: string;
        pickupStops?: DeliveryOrderPickupStop[];
        shipperReferences?: DeliveryOrderShipperReference[];
    }>(id);
    if (!deliveryOrder) {
        return NextResponse.json({ error: 'Surat jalan tidak ditemukan' }, { status: 404 });
    }
    if (!['CREATED', 'HEADING_TO_PICKUP', 'ON_DELIVERY', 'ARRIVED'].includes(deliveryOrder.status || '')) {
        return NextResponse.json(
            { error: 'Barang hanya bisa dihapus saat surat jalan masih aktif sebelum trip selesai atau dibatalkan.' },
            { status: 409 }
        );
    }
    if (deliveryOrder.pendingDriverStatus) {
        return NextResponse.json(
            { error: `DO ${deliveryOrder.doNumber || id} sedang menunggu approval ${deliveryOrder.pendingDriverStatus}. Review dulu sebelum barang diubah.` },
            { status: 409 }
        );
    }

    const deliveryOrderItem = await sanityGetById<{
        _id: string;
        deliveryOrderRef?: unknown;
        orderItemRef?: unknown;
        orderItemDescription?: string;
        shipperReferenceNumber?: string;
    }>(deliveryOrderItemId);
    if (!deliveryOrderItem || extractRefId(deliveryOrderItem.deliveryOrderRef) !== id) {
        return NextResponse.json({ error: 'Item surat jalan tidak ditemukan' }, { status: 404 });
    }

    const orderItemRef = extractRefId(deliveryOrderItem.orderItemRef);
    if (!orderItemRef) {
        return NextResponse.json({ error: 'Item order sumber tidak ditemukan' }, { status: 409 });
    }

    const orderItem = await sanityGetById<{
        _id: string;
        _rev?: string;
        orderRef?: unknown;
        entrySource?: 'ORDER' | 'DELIVERY_ORDER';
        sourceDeliveryOrderRef?: unknown;
    }>(orderItemRef);
    if (!orderItem) {
        return NextResponse.json({ error: 'Item order sumber tidak ditemukan' }, { status: 404 });
    }
    if (
        orderItem.entrySource !== 'DELIVERY_ORDER' ||
        extractRefId(orderItem.sourceDeliveryOrderRef) !== id
    ) {
        return NextResponse.json(
            { error: 'Item ini berasal dari target order/resi utama. Koreksi assignment-nya harus dari flow order, bukan hapus langsung di surat jalan.' },
            { status: 409 }
        );
    }

    if (!deliveryOrder._rev) {
        return NextResponse.json({ error: 'Revisi surat jalan tidak tersedia. Refresh lalu coba lagi.' }, { status: 409 });
    }

    const doPickupStops = normalizeDeliveryOrderPickupStopsSnapshot(deliveryOrder.pickupStops);
    const remainingDeliveryOrderItems = await getSanityClient().fetch<Array<{
        pickupStopKey?: string;
        pickupAddress?: string;
        shipperReferenceNumber?: string;
    }>>(
        `*[_type == "deliveryOrderItem" && deliveryOrderRef == $ref && _id != $itemId]{
            pickupStopKey,
            pickupAddress,
            shipperReferenceNumber
        }`,
        { ref: id, itemId: deliveryOrderItemId }
    );
    let nextShipperReferences: NormalizedDeliveryOrderShipperReference[] = [];
    try {
        nextShipperReferences = buildShipperReferencesFromCargoSnapshots(
            remainingDeliveryOrderItems,
            doPickupStops,
            deliveryOrder.shipperReferences
        );
        nextShipperReferences = preserveExistingShipperReferences(
            nextShipperReferences,
            deliveryOrder.shipperReferences,
            doPickupStops
        );
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Referensi SJ pengirim tidak valid' },
            { status: 400 }
        );
    }

    const customerRef = extractRefId(deliveryOrder.customerRef);
    const currentConstraintIds =
        customerRef
            ? await getExistingDeliveryOrderCustomerDoConstraintIds(id)
            : [];
    const nextConstraintDocs =
        customerRef
            ? buildCustomerDoConstraintDocs(id, customerRef, nextShipperReferences)
            : [];

    const transaction = getSanityClient()
        .transaction()
        .delete(deliveryOrderItemId)
        .delete(orderItemRef);
    currentConstraintIds
        .filter(constraintId => !nextConstraintDocs.some(constraint => constraint._id === constraintId))
        .forEach(constraintId => transaction.delete(constraintId));
    nextConstraintDocs
        .filter(constraint => !currentConstraintIds.includes(constraint._id))
        .forEach(constraint => transaction.create(constraint));
    transaction.patch(id, {
        ifRevisionID: deliveryOrder._rev,
        set: {
            ...(nextShipperReferences.length > 0
                ? {
                    customerDoNumber: nextShipperReferences[0].referenceNumber,
                    shipperReferences: nextShipperReferences,
                }
                : {}),
        },
        unset: nextShipperReferences.length > 0 ? [] : ['customerDoNumber', 'shipperReferences'],
    });
    try {
        await transaction.commit();
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
        `Hapus barang dari Surat Jalan ${deliveryOrder.doNumber || id}: ${deliveryOrderItem.shipperReferenceNumber || '-'}${deliveryOrderItem.orderItemDescription ? ` - ${deliveryOrderItem.orderItemDescription}` : ''}`
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

    const deliveryOrder = await sanityGetById<{
        _id: string;
        _rev?: string;
        doNumber?: string;
        status?: string;
        pendingDriverStatus?: string;
        orderRef?: unknown;
        customerRef?: unknown;
        customerDoNumber?: string;
        pickupStops?: DeliveryOrderPickupStop[];
        shipperReferences?: DeliveryOrderShipperReference[];
    }>(id);
    if (!deliveryOrder) {
        return NextResponse.json({ error: 'Surat jalan tidak ditemukan' }, { status: 404 });
    }
    if (!['CREATED', 'HEADING_TO_PICKUP', 'ON_DELIVERY', 'ARRIVED'].includes(deliveryOrder.status || '')) {
        return NextResponse.json(
            { error: 'Barang hanya bisa diubah saat surat jalan masih aktif sebelum trip selesai atau dibatalkan.' },
            { status: 409 }
        );
    }
    if (deliveryOrder.pendingDriverStatus) {
        return NextResponse.json(
            { error: `DO ${deliveryOrder.doNumber || id} sedang menunggu approval ${deliveryOrder.pendingDriverStatus}. Review dulu sebelum barang diubah.` },
            { status: 409 }
        );
    }
    if (!deliveryOrder._rev) {
        return NextResponse.json({ error: 'Revisi surat jalan tidak tersedia. Refresh lalu coba lagi.' }, { status: 409 });
    }

    const deliveryOrderItem = await sanityGetById<{
        _id: string;
        deliveryOrderRef?: unknown;
        orderItemRef?: unknown;
        orderItemDescription?: string;
        shipperReferenceNumber?: string;
        pickupStopKey?: string;
        pickupAddress?: string;
    }>(deliveryOrderItemId);
    if (!deliveryOrderItem || extractRefId(deliveryOrderItem.deliveryOrderRef) !== id) {
        return NextResponse.json({ error: 'Item surat jalan tidak ditemukan' }, { status: 404 });
    }

    const orderItemRef = extractRefId(deliveryOrderItem.orderItemRef);
    if (!orderItemRef) {
        return NextResponse.json({ error: 'Item order sumber tidak ditemukan' }, { status: 409 });
    }

    const orderItem = await sanityGetById<{
        _id: string;
        _rev?: string;
        orderRef?: unknown;
        customerProductRef?: string;
        customerProductCode?: string;
        customerProductName?: string;
        entrySource?: 'ORDER' | 'DELIVERY_ORDER';
        sourceDeliveryOrderRef?: unknown;
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
    }>(orderItemRef);
    if (!orderItem || !orderItem._rev) {
        return NextResponse.json({ error: 'Item order sumber tidak ditemukan' }, { status: 404 });
    }
    if (
        orderItem.entrySource !== 'DELIVERY_ORDER' ||
        extractRefId(orderItem.sourceDeliveryOrderRef) !== id
    ) {
        return NextResponse.json(
            { error: 'Item ini berasal dari target order/resi utama. Koreksi assignment-nya harus dari flow order, bukan edit langsung di surat jalan.' },
            { status: 409 }
        );
    }

    const orderRef = extractRefId(deliveryOrder.orderRef) || extractRefId(orderItem.orderRef);
    if (!orderRef) {
        return NextResponse.json({ error: 'Order sumber surat jalan tidak ditemukan' }, { status: 409 });
    }

    const order = await sanityGetById<{
        _id: string;
        _rev?: string;
        customerRef?: unknown;
        cargoEntryMode?: 'ORDER' | 'DELIVERY_ORDER';
    }>(orderRef);
    if (!order) {
        return NextResponse.json({ error: 'Order sumber surat jalan tidak ditemukan' }, { status: 404 });
    }

    const existingOrderItemCount = await getSanityClient().fetch<number>(
        `count(*[_type == "orderItem" && orderRef == $ref])`,
        { ref: orderRef }
    );
    const orderItemCargoModeHints =
        !order.cargoEntryMode && existingOrderItemCount > 0
            ? await getSanityClient().fetch<Array<{
                _createdAt?: string;
                entrySource?: 'ORDER' | 'DELIVERY_ORDER';
                sourceDeliveryOrderRef?: string;
            }>>(
                `*[_type == "orderItem" && orderRef == $ref]{
                    _createdAt,
                    entrySource,
                    sourceDeliveryOrderRef
                }`,
                { ref: orderRef }
            )
            : [];
    const resolvedCargoEntryMode = resolveOrderCargoEntryMode(order, orderItemCargoModeHints);
    const allowsDirectCargoInput = resolvedCargoEntryMode === 'DELIVERY_ORDER' || existingOrderItemCount === 0;
    if (!allowsDirectCargoInput) {
        return NextResponse.json(
            { error: 'Order ini memakai flow item order. Koreksi barang harus dari flow order, bukan edit langsung di surat jalan.' },
            { status: 409 }
        );
    }

    let normalizedItem: NormalizedOrderItemInput;
    try {
        const items = await normalizeOrderItemsInput(
            extractRefId(order.customerRef) || extractRefId(deliveryOrder.customerRef) || '',
            [cargoItemPayload],
            { allowEmpty: false }
        );
        normalizedItem = items[0];
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Barang surat jalan tidak valid';
        return NextResponse.json({ error: message }, { status: 400 });
    }

    const pickupStopKey =
        normalizeOptionalText(cargoItemPayload.pickupStopKey)
        || (Array.isArray(deliveryOrder.pickupStops) && deliveryOrder.pickupStops.length === 1
            ? normalizeOptionalText(deliveryOrder.pickupStops[0]?._key)
            : undefined);
    const shipperReferenceNumber = normalizeReferenceNumber(cargoItemPayload.shipperReferenceNumber);
    const doPickupStops = normalizeDeliveryOrderPickupStopsSnapshot(deliveryOrder.pickupStops);
    const pickupStopMap = new Map(doPickupStops.map(stop => [stop._key, stop]));
    if (doPickupStops.length > 0 && !pickupStopKey) {
        return NextResponse.json({ error: 'Titik pickup wajib dipilih untuk barang surat jalan ini.' }, { status: 400 });
    }
    if (pickupStopKey && !pickupStopMap.has(pickupStopKey)) {
        return NextResponse.json({ error: 'Titik pickup barang surat jalan tidak ditemukan.' }, { status: 400 });
    }
    if (!shipperReferenceNumber) {
        return NextResponse.json({ error: 'No. SJ pengirim wajib diisi.' }, { status: 400 });
    }

    const otherDeliveryOrderItems = await getSanityClient().fetch<Array<{
        pickupStopKey?: string;
        pickupAddress?: string;
        shipperReferenceNumber?: string;
    }>>(
        `*[_type == "deliveryOrderItem" && deliveryOrderRef == $ref && _id != $itemId]{
            pickupStopKey,
            pickupAddress,
            shipperReferenceNumber
        }`,
        { ref: id, itemId: deliveryOrderItemId }
    );
    let nextShipperReferences: NormalizedDeliveryOrderShipperReference[] = [];
    try {
        nextShipperReferences = buildShipperReferencesFromCargoSnapshots(
            [
                ...otherDeliveryOrderItems,
                {
                    pickupStopKey,
                    pickupAddress: pickupStopKey ? pickupStopMap.get(pickupStopKey)?.pickupAddress : undefined,
                    shipperReferenceNumber,
                },
            ],
            doPickupStops,
            deliveryOrder.shipperReferences
        );
        nextShipperReferences = preserveExistingShipperReferences(
            nextShipperReferences,
            deliveryOrder.shipperReferences,
            doPickupStops
        );
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Referensi SJ pengirim tidak valid' },
            { status: 400 }
        );
    }

    const customerRef = extractRefId(deliveryOrder.customerRef);
    if (customerRef && nextShipperReferences.length > 0) {
        const duplicateCustomerDoNumber = await findDuplicateCustomerDoReference(customerRef, nextShipperReferences, id);
        if (duplicateCustomerDoNumber) {
            return NextResponse.json(
                { error: `No. SJ pengirim ${duplicateCustomerDoNumber.referenceNumber} sudah dipakai untuk customer ini.` },
                { status: 409 }
            );
        }
    }

    const currentConstraintIds =
        customerRef
            ? await getExistingDeliveryOrderCustomerDoConstraintIds(id)
            : [];
    const nextConstraintDocs =
        customerRef
            ? buildCustomerDoConstraintDocs(id, customerRef, nextShipperReferences)
            : [];
    const mutationTimestamp = new Date().toISOString();
    const usesQtyBasis = normalizedItem.qtyKoli > 0;
    const transaction = getSanityClient().transaction();
    try {
        patchLinkedCustomerProducts(transaction, [normalizedItem], mutationTimestamp);
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Barang customer berubah karena ada update lain. Refresh lalu coba lagi.' },
            { status: 409 }
        );
    }
    currentConstraintIds
        .filter(constraintId => !nextConstraintDocs.some(constraint => constraint._id === constraintId))
        .forEach(constraintId => transaction.delete(constraintId));
    nextConstraintDocs
        .filter(constraint => !currentConstraintIds.includes(constraint._id))
        .forEach(constraint => transaction.create(constraint));
    transaction.patch(orderItemRef, {
        ifRevisionID: orderItem._rev,
        set: {
            customerProductRef: normalizedItem.customerProductRef || orderItem.customerProductRef,
            customerProductCode: normalizedItem.customerProductCode || orderItem.customerProductCode,
            customerProductName: normalizedItem.customerProductName || orderItem.customerProductName,
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
        },
    });
    transaction.patch(deliveryOrderItemId, {
        set: {
            pickupStopKey: pickupStopKey || undefined,
            pickupAddress: pickupStopKey ? pickupStopMap.get(pickupStopKey)?.pickupAddress : undefined,
            shipperReferenceKey: nextShipperReferences.find(reference => reference.referenceNumber === shipperReferenceNumber)?._key,
            shipperReferenceNumber,
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
        },
    });
    transaction.patch(id, {
        ifRevisionID: deliveryOrder._rev,
        set: {
            ...(nextShipperReferences.length > 0
                ? {
                    customerDoNumber: nextShipperReferences[0].referenceNumber,
                    shipperReferences: nextShipperReferences,
                }
                : {}),
        },
        unset: nextShipperReferences.length > 0 ? [] : ['customerDoNumber', 'shipperReferences'],
    });

    try {
        await transaction.commit();
    } catch (error) {
        if (nextConstraintDocs.some(constraint => isDocumentAlreadyExistsError(error, constraint._id))) {
            return NextResponse.json(
                { error: `Salah satu SJ pengirim (${nextShipperReferences.map(reference => reference.referenceNumber).join(', ')}) sudah dipakai untuk customer ini.` },
                { status: 409 }
            );
        }
        if (isMutationConflictError(error)) {
            return NextResponse.json(
                { error: 'Barang surat jalan berubah karena ada update lain. Refresh lalu coba lagi.' },
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
        `Edit barang Surat Jalan ${deliveryOrder.doNumber || id}: ${deliveryOrderItem.shipperReferenceNumber || '-'}${deliveryOrderItem.orderItemDescription ? ` - ${deliveryOrderItem.orderItemDescription}` : ''} -> ${shipperReferenceNumber}${normalizedItem.description ? ` - ${normalizedItem.description}` : ''}`
    );

    return NextResponse.json({
        data: {
            _id: id,
            deliveryOrderItemId,
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

    const deliveryOrder = await sanityGetById<{
        _id: string;
        _rev?: string;
        doNumber?: string;
        orderRef?: unknown;
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
    }>(id);
    if (!deliveryOrder) {
        return NextResponse.json({ error: 'Surat jalan tidak ditemukan' }, { status: 404 });
    }
    if (deliveryOrder.status !== 'CREATED') {
        return NextResponse.json({ error: 'Armada trip hanya bisa dilengkapi saat status surat jalan masih Dibuat' }, { status: 409 });
    }
    if (deliveryOrder.trackingState === 'ACTIVE' || deliveryOrder.trackingState === 'PAUSED') {
        return NextResponse.json({ error: 'Armada trip tidak bisa diubah saat tracking driver masih aktif' }, { status: 409 });
    }

    const relatedVoucher = await getSanityClient().fetch<{ _id: string; bonNumber?: string } | null>(
        `*[_type == "driverVoucher" && deliveryOrderRef == $ref][0]{ _id, bonNumber }`,
        { ref: id }
    );
    if (relatedVoucher) {
        return NextResponse.json(
            { error: `Armada trip tidak boleh diubah karena DO ini sudah punya uang jalan ${relatedVoucher.bonNumber || relatedVoucher._id}` },
            { status: 409 }
        );
    }

    const relatedBoronganItem = await getSanityClient().fetch<{ _id: string } | null>(
        `*[_type == "driverBoronganItem" && doRef == $ref][0]{ _id }`,
        { ref: id }
    );
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
        const vehicle = await sanityGetById<{
            _id: string;
            _rev?: string;
            plateNumber?: string;
            status?: string;
            serviceRef?: string;
            serviceName?: string;
        }>(vehicleRef);
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
        const conflictingDeliveryOrder = await getSanityClient().fetch<{
            _id: string;
            doNumber?: string;
            customerDoNumber?: string;
        } | null>(
            `*[
                _type == "deliveryOrder" &&
                _id != $currentId &&
                status in ["CREATED", "HEADING_TO_PICKUP", "ON_DELIVERY", "ARRIVED"] &&
                ((vehicleRef == $ref || vehicleRef._ref == $ref) || lower(coalesce(vehiclePlate, "")) == $plate)
            ][0]{
                _id,
                doNumber,
                customerDoNumber
            }`,
            {
                currentId: id,
                ref: vehicleRef,
                plate: (vehicle.plateNumber || nextVehiclePlate || '').toLowerCase(),
            }
        );
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
        const driver = await sanityGetById<{ _id: string; _rev?: string; name?: string; active?: boolean }>(driverRef);
        if (!driver) {
            return NextResponse.json({ error: 'Supir DO tidak ditemukan' }, { status: 404 });
        }
        selectedDriver = driver;
        if (driver.active === false) {
            return NextResponse.json({ error: 'Supir DO tidak aktif' }, { status: 409 });
        }
        const conflictingDeliveryOrder = await getSanityClient().fetch<{
            _id: string;
            doNumber?: string;
            customerDoNumber?: string;
        } | null>(
            `*[
                _type == "deliveryOrder" &&
                _id != $currentId &&
                status in ["CREATED", "HEADING_TO_PICKUP", "ON_DELIVERY", "ARRIVED"] &&
                ((driverRef == $ref || driverRef._ref == $ref) || lower(coalesce(driverName, "")) == $driverName)
            ][0]{
                _id,
                doNumber,
                customerDoNumber
            }`,
            {
                currentId: id,
                ref: driverRef,
                driverName: (driver.name || nextDriverName || '').toLowerCase(),
            }
        );
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
        const unchangedDeliveryOrder = await sanityGetById(id);
        return NextResponse.json({ data: unchangedDeliveryOrder, id });
    }

    if (!deliveryOrder._rev) {
        return NextResponse.json({ error: 'Revisi surat jalan tidak tersedia. Refresh lalu coba lagi.' }, { status: 409 });
    }

    const relatedOrderRef = extractRefId(deliveryOrder.orderRef);
    const relatedOrder = relatedOrderRef
        ? await sanityGetById<{
            _id: string;
            _rev?: string;
            tripPlans?: OrderTripPlan[];
        }>(relatedOrderRef)
        : null;
    const relatedOrderTripPlans = normalizeOrderTripPlansSnapshot(relatedOrder?.tripPlans);
    const linkedTripPlan = relatedOrderTripPlans.find(plan => plan.linkedDeliveryOrderRef === id) || null;

    let updatedDeliveryOrder: unknown;
    try {
        const mutationTimestamp = new Date().toISOString();
        const transaction = getSanityClient().transaction();
        if (vehicleChanged && selectedVehicle?._id) {
            if (!selectedVehicle._rev) {
                return NextResponse.json({ error: 'Revisi kendaraan tidak tersedia. Refresh lalu coba lagi.' }, { status: 409 });
            }
            transaction.patch(selectedVehicle._id, {
                ifRevisionID: selectedVehicle._rev,
                set: { updatedAt: mutationTimestamp },
            });
        }
        if (driverChanged && selectedDriver?._id) {
            if (!selectedDriver._rev) {
                return NextResponse.json({ error: 'Revisi supir tidak tersedia. Refresh lalu coba lagi.' }, { status: 409 });
            }
            transaction.patch(selectedDriver._id, {
                ifRevisionID: selectedDriver._rev,
                set: { updatedAt: mutationTimestamp },
            });
        }
        transaction.patch(id, {
            ifRevisionID: deliveryOrder._rev,
            set: {
                vehicleRef: nextVehicleRef || undefined,
                vehiclePlate: nextVehiclePlate || undefined,
                vehicleServiceRef: nextVehicleServiceRef || undefined,
                vehicleServiceName: nextVehicleServiceName || undefined,
                vehicleCategoryOverrideReason: nextVehicleCategoryOverrideReason || undefined,
                driverRef: nextDriverRef || undefined,
                driverName: nextDriverName || undefined,
            },
        });
        if (relatedOrder && linkedTripPlan) {
            if (!relatedOrder._rev) {
                return NextResponse.json({ error: 'Revisi order trip tidak tersedia. Refresh lalu coba lagi.' }, { status: 409 });
            }
            transaction.patch(relatedOrder._id, {
                ifRevisionID: relatedOrder._rev,
                set: {
                    tripPlans: relatedOrderTripPlans.map(plan => (
                        plan._key === linkedTripPlan._key
                            ? {
                                ...plan,
                                vehicleRef: nextVehicleRef || undefined,
                                vehiclePlate: nextVehiclePlate || undefined,
                                vehicleServiceRef: nextVehicleServiceRef || undefined,
                                vehicleServiceName: nextVehicleServiceName || undefined,
                                vehicleCategoryOverrideReason: nextVehicleCategoryOverrideReason || undefined,
                                driverRef: nextDriverRef || undefined,
                                driverName: nextDriverName || undefined,
                            }
                            : plan
                    )),
                },
            });
        }
        updatedDeliveryOrder = await transaction.commit();
    } catch (error) {
        if (isMutationConflictError(error)) {
            return NextResponse.json(
                { error: 'Armada trip, kendaraan, supir, atau order trip berubah karena ada update lain. Refresh lalu coba lagi.' },
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

    if (!id) {
        return NextResponse.json({ error: 'Surat jalan tidak valid' }, { status: 400 });
    }

    const deliveryOrder = await sanityGetById<{
        _id: string;
        _rev?: string;
        doNumber?: string;
        customerDoNumber?: string;
        customerRef?: unknown;
        customerName?: string;
        pickupStops?: DeliveryOrderPickupStop[];
        shipperReferences?: DeliveryOrderShipperReference[];
        pendingDriverStatus?: string;
    }>(id);
    if (!deliveryOrder) {
        return NextResponse.json({ error: 'Surat jalan tidak ditemukan' }, { status: 404 });
    }
    if (deliveryOrder.pendingDriverStatus) {
        return NextResponse.json(
            { error: `DO ${deliveryOrder.doNumber || id} sedang menunggu approval ${deliveryOrder.pendingDriverStatus}. Review dulu sebelum SJ pengirim diubah.` },
            { status: 409 }
        );
    }

    const hasNotaReference = await getSanityClient().fetch<{ _id: string; notaRef?: string } | null>(
        `*[_type == "freightNotaItem" && (doRef == $ref || doRef._ref == $ref)][0]{ _id, notaRef }`,
        { ref: id }
    );
    if (hasNotaReference) {
        return NextResponse.json(
            { error: 'No. SJ pengirim tidak boleh diubah karena DO ini sudah masuk nota' },
            { status: 409 }
        );
    }

    const hasBoronganReference = await getSanityClient().fetch<{ _id: string; boronganRef?: string } | null>(
        `*[_type == "driverBoronganItem" && (doRef == $ref || doRef._ref == $ref)][0]{ _id, boronganRef }`,
        { ref: id }
    );
    if (hasBoronganReference) {
        return NextResponse.json(
            { error: 'No. SJ pengirim tidak boleh diubah karena DO ini sudah masuk arsip slip borongan' },
            { status: 409 }
        );
    }

    const customerRef = extractRefId(deliveryOrder.customerRef);
    if (!deliveryOrder._rev) {
        return NextResponse.json({ error: 'Revisi surat jalan tidak tersedia. Refresh lalu coba lagi.' }, { status: 409 });
    }

    const doPickupStops = normalizeDeliveryOrderPickupStopsSnapshot(deliveryOrder.pickupStops);
    const pickupStopMap = new Map(doPickupStops.map(stop => [stop._key, stop]));
    const nextShipperReferences = normalizeIncomingShipperReferences(data, doPickupStops, deliveryOrder.shipperReferences, false);
    if (doPickupStops.length > 1 && nextShipperReferences.some(reference => !reference.pickupStopKey)) {
        return NextResponse.json(
            { error: 'Setiap SJ pengirim wajib dikaitkan ke titik pickup yang benar karena surat jalan ini punya lebih dari satu pickup' },
            { status: 400 }
        );
    }
    const customerDoNumber = nextShipperReferences[0]?.referenceNumber || undefined;
    const existingShipperReferences = normalizeDeliveryOrderPersistedShipperReferences(deliveryOrder, doPickupStops);
    const relatedDeliveryOrderItems = await getSanityClient().fetch<Array<{
        _id: string;
        shipperReferenceKey?: string;
        shipperReferenceNumber?: string;
        pickupStopKey?: string;
        pickupAddress?: string;
    }>>(
        `*[_type == "deliveryOrderItem" && deliveryOrderRef == $ref]{
            _id,
            shipperReferenceKey,
            shipperReferenceNumber,
            pickupStopKey,
            pickupAddress
        }`,
        { ref: id }
    );
    const nextShipperReferenceByKey = new Map(
        nextShipperReferences
            .filter(reference => reference._key)
            .map(reference => [reference._key as string, reference])
    );
    const nextShipperReferenceByNumber = new Map(
        nextShipperReferences.map(reference => [reference.referenceNumber, reference])
    );
    const blockedReferenceNumbers = new Set<string>();
    const deliveryOrderItemPatches: Array<{
        id: string;
        set: {
            shipperReferenceKey?: string;
            shipperReferenceNumber?: string;
            pickupStopKey?: string;
            pickupAddress?: string;
        };
    }> = [];
    for (const item of relatedDeliveryOrderItems) {
        const currentReferenceKey = normalizeOptionalText(item.shipperReferenceKey) || undefined;
        const currentReferenceNumber = normalizeReferenceNumber(item.shipperReferenceNumber);
        if (!currentReferenceKey && !currentReferenceNumber) {
            continue;
        }

        const matchedReference =
            (currentReferenceKey ? nextShipperReferenceByKey.get(currentReferenceKey) : undefined)
            || (currentReferenceNumber ? nextShipperReferenceByNumber.get(currentReferenceNumber) : undefined);

        if (!matchedReference) {
            blockedReferenceNumbers.add(currentReferenceNumber || currentReferenceKey || item._id);
            continue;
        }

        const nextPickupStopKey = matchedReference.pickupStopKey || undefined;
        const nextPickupAddress = nextPickupStopKey
            ? pickupStopMap.get(nextPickupStopKey)?.pickupAddress
            : undefined;
        if (
            currentReferenceKey !== matchedReference._key ||
            currentReferenceNumber !== matchedReference.referenceNumber ||
            (normalizeOptionalText(item.pickupStopKey) || undefined) !== nextPickupStopKey ||
            (normalizeOptionalText(item.pickupAddress) || undefined) !== nextPickupAddress
        ) {
            deliveryOrderItemPatches.push({
                id: item._id,
                set: {
                    shipperReferenceKey: matchedReference._key,
                    shipperReferenceNumber: matchedReference.referenceNumber,
                    pickupStopKey: nextPickupStopKey,
                    pickupAddress: nextPickupAddress,
                },
            });
        }
    }
    if (blockedReferenceNumbers.size > 0) {
        return NextResponse.json(
            {
                error: `SJ pengirim ${[...blockedReferenceNumbers].join(', ')} masih dipakai oleh barang surat jalan. Edit barangnya dulu atau pindahkan ke SJ yang baru.`,
            },
            { status: 409 }
        );
    }

    const currentReferenceSnapshot = serializeShipperReferenceSnapshot(existingShipperReferences);
    const nextReferenceSnapshot = serializeShipperReferenceSnapshot(nextShipperReferences);
    if (currentReferenceSnapshot === nextReferenceSnapshot && deliveryOrderItemPatches.length === 0) {
        const unchangedDeliveryOrder = await sanityGetById(id);
        return NextResponse.json({ data: unchangedDeliveryOrder, id });
    }

    const currentConstraintId =
        customerRef
            ? await getExistingDeliveryOrderCustomerDoConstraintIds(id)
            : [];
    const nextConstraintDocs =
        customerRef
            ? buildCustomerDoConstraintDocs(id, customerRef, nextShipperReferences)
            : [];
    if (customerRef && nextShipperReferences.length > 0) {
        const duplicateCustomerDoNumber = await findDuplicateCustomerDoReference(customerRef, nextShipperReferences, id);
        if (duplicateCustomerDoNumber) {
            return NextResponse.json(
                { error: `No. SJ pengirim ${duplicateCustomerDoNumber.referenceNumber} sudah dipakai untuk customer ini.` },
                { status: 409 }
            );
        }
    }
    let updatedDeliveryOrder: unknown;
    try {
        const transaction = getSanityClient().transaction();
        currentConstraintId
            .filter(constraintId => !nextConstraintDocs.some(constraint => constraint._id === constraintId))
            .forEach(constraintId => transaction.delete(constraintId));
        nextConstraintDocs
            .filter(constraint => !currentConstraintId.includes(constraint._id))
            .forEach(constraint => transaction.create(constraint));
        deliveryOrderItemPatches.forEach(itemPatch => {
            transaction.patch(itemPatch.id, {
                set: itemPatch.set,
            });
        });
        transaction.patch(id, {
            ifRevisionID: deliveryOrder._rev,
            set: {
                customerDoNumber,
                shipperReferences: nextShipperReferences,
            },
        });
        await transaction.commit();
        updatedDeliveryOrder = await sanityGetById(id);
    } catch (error) {
        if (nextConstraintDocs.some(constraint => isDocumentAlreadyExistsError(error, constraint._id))) {
            return NextResponse.json(
                { error: `Salah satu SJ pengirim (${nextShipperReferences.map(reference => reference.referenceNumber).join(', ')}) sudah dipakai untuk customer ini.` },
                { status: 409 }
            );
        }
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
        `Update SJ pengirim ${deliveryOrder.doNumber || id}: ${existingShipperReferences.map(reference => reference.referenceNumber).join(', ') || '-'} -> ${nextShipperReferences.map(reference => reference.referenceNumber).join(', ') || '-'}`
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

    const order = await sanityGetById<{ _id: string; _rev?: string; masterResi?: string }>(id);
    if (!order) {
        return NextResponse.json({ error: 'Order tidak ditemukan' }, { status: 404 });
    }
    if (!order._rev) {
        return NextResponse.json({ error: 'Revisi order tidak tersedia. Refresh lalu coba lagi.' }, { status: 409 });
    }

    const relatedDeliveryOrder = await getSanityClient().fetch<{ _id: string } | null>(
        `*[_type == "deliveryOrder" && orderRef == $ref][0]{ _id }`,
        { ref: id }
    );
    if (relatedDeliveryOrder) {
        return NextResponse.json({ error: 'Order yang sudah punya surat jalan tidak boleh dihapus' }, { status: 409 });
    }

    const relatedInvoice = await getSanityClient().fetch<{ _id: string } | null>(
        `*[_type == "invoice" && orderRef == $ref][0]{ _id }`,
        { ref: id }
    );
    if (relatedInvoice) {
        return NextResponse.json({ error: 'Order yang sudah punya invoice tidak boleh dihapus' }, { status: 409 });
    }

    const orderItems = await getSanityClient().fetch<Array<{
        _id: string;
        _rev?: string;
        description?: string;
        status?: string;
    }>>(
        `*[_type == "orderItem" && orderRef == $ref]{
            _id,
            _rev,
            description,
            status
        }`,
        { ref: id }
    );
    if (orderItems.some(item => !item._rev)) {
        return NextResponse.json({ error: 'Revisi item order tidak tersedia. Refresh lalu coba lagi.' }, { status: 409 });
    }

    const mutations: Array<Record<string, unknown>> = [];
    for (const orderItem of orderItems) {
        mutations.push({
            delete: {
                id: orderItem._id,
                ifRevisionID: orderItem._rev as string,
            },
        });
    }
    mutations.push({
        delete: {
            id,
            ifRevisionID: order._rev,
        },
    });
    try {
        await getSanityClient().mutate(mutations as unknown as SanityMutations);
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
