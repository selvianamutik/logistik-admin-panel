import { createClient } from '@sanity/client';

import { loadScriptEnv, requireEnv } from './_env';
import { buildDeliveryOrderCustomerDoConstraintDoc, buildDeliveryOrderCustomerDoConstraintId } from '../src/lib/api/order-workflow-support';

loadScriptEnv();

type DeliveryOrderPickupStop = {
    _key?: string;
    sequence?: number;
    pickupLabel?: string;
    pickupAddress?: string;
};

type DeliveryOrderShipperReference = {
    _key?: string;
    sequence?: number;
    referenceNumber?: string;
    pickupStopKey?: string;
    pickupAddress?: string;
    notes?: string;
};

type DeliveryOrderDoc = {
    _id: string;
    _rev?: string;
    doNumber?: string;
    customerRef?: string;
    customerDoNumber?: string;
    pickupStops?: DeliveryOrderPickupStop[];
    shipperReferences?: DeliveryOrderShipperReference[];
};

type DeliveryOrderItemDoc = {
    _id: string;
    deliveryOrderRef?: string | { _ref?: string };
    shipperReferenceNumber?: string;
    pickupStopKey?: string;
    pickupAddress?: string;
};

type ConstraintDoc = {
    _id: string;
    ownerRef?: string;
};

type NormalizedPickupStop = {
    _key: string;
    sequence: number;
    pickupLabel?: string;
    pickupAddress: string;
};

type NormalizedShipperReference = {
    _key: string;
    sequence: number;
    referenceNumber: string;
    pickupStopKey?: string;
    pickupAddress?: string;
    notes?: string;
};

type CargoReferenceSnapshot = {
    shipperReferenceNumber?: string;
    pickupStopKey?: string;
    pickupAddress?: string;
};

const applyChanges = process.argv.includes('--write');

const client = createClient({
    projectId: requireEnv('NEXT_PUBLIC_SANITY_PROJECT_ID'),
    dataset: process.env.NEXT_PUBLIC_SANITY_DATASET?.trim() || 'production',
    apiVersion: process.env.SANITY_API_VERSION?.trim() || '2024-01-01',
    token: requireEnv('SANITY_API_TOKEN'),
    useCdn: false,
});

function normalizeOptionalText(value: unknown) {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed || undefined;
}

function normalizeReferenceNumber(value: unknown) {
    return normalizeOptionalText(value)?.toUpperCase();
}

function normalizePickupStops(stops: DeliveryOrderPickupStop[] | undefined) {
    const normalized: NormalizedPickupStop[] = [];
    for (const [index, stop] of (stops || []).entries()) {
        const pickupAddress = normalizeOptionalText(stop.pickupAddress);
        if (!pickupAddress) {
            continue;
        }
        normalized.push({
            _key: normalizeOptionalText(stop._key) || `pickup-stop-${index + 1}`,
            sequence: Number.isFinite(stop.sequence) && Number(stop.sequence) > 0 ? Number(stop.sequence) : index + 1,
            pickupLabel: normalizeOptionalText(stop.pickupLabel),
            pickupAddress,
        });
    }
    return normalized.sort((left, right) => left.sequence - right.sequence);
}

function normalizeExistingShipperReferences(
    references: DeliveryOrderShipperReference[] | undefined,
    pickupStops: NormalizedPickupStop[]
) {
    const pickupMap = new Map(pickupStops.map(stop => [stop._key, stop]));
    const normalized: NormalizedShipperReference[] = [];
    for (const [index, reference] of (references || []).entries()) {
        const referenceNumber = normalizeReferenceNumber(reference.referenceNumber);
        if (!referenceNumber) {
            continue;
        }
        const pickupStopKey = normalizeOptionalText(reference.pickupStopKey);
        const matchedStop = pickupStopKey ? pickupMap.get(pickupStopKey) : undefined;
        normalized.push({
            _key: normalizeOptionalText(reference._key) || crypto.randomUUID(),
            sequence: Number.isFinite(reference.sequence) && Number(reference.sequence) > 0 ? Number(reference.sequence) : index + 1,
            referenceNumber,
            pickupStopKey,
            pickupAddress: normalizeOptionalText(reference.pickupAddress) || matchedStop?.pickupAddress,
            notes: normalizeOptionalText(reference.notes),
        });
    }
    return normalized;
}

function describePickupStop(stop?: { pickupLabel?: string; pickupAddress?: string }) {
    return normalizeOptionalText(stop?.pickupLabel) || normalizeOptionalText(stop?.pickupAddress) || 'titik pickup';
}

function upsertShipperReferenceForPickup(
    references: NormalizedShipperReference[],
    referenceNumber: string,
    pickupStopKey: string | undefined,
    pickupMap: Map<string, NormalizedPickupStop>
) {
    const existingIndex = references.findIndex(reference => reference.referenceNumber === referenceNumber);
    if (existingIndex >= 0) {
        const current = references[existingIndex];
        if (pickupStopKey && current.pickupStopKey && current.pickupStopKey !== pickupStopKey) {
            throw new Error(
                `SJ pengirim ${referenceNumber} tidak boleh dipakai di dua titik pickup berbeda (${describePickupStop(pickupMap.get(current.pickupStopKey))} dan ${describePickupStop(pickupMap.get(pickupStopKey))}).`
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

    const createdReference: NormalizedShipperReference = {
        _key: crypto.randomUUID(),
        sequence: references.length + 1,
        referenceNumber,
        pickupStopKey,
        pickupAddress: pickupStopKey ? pickupMap.get(pickupStopKey)?.pickupAddress : undefined,
    };
    references.push(createdReference);
    return createdReference;
}

function buildShipperReferencesFromCargoSnapshots(
    items: CargoReferenceSnapshot[],
    pickupStops: NormalizedPickupStop[],
    existing: DeliveryOrderShipperReference[] | undefined
) {
    const pickupMap = new Map(pickupStops.map(stop => [stop._key, stop]));
    const existingByNumber = new Map(
        normalizeExistingShipperReferences(existing, pickupStops).map(reference => [reference.referenceNumber, reference])
    );
    const references: NormalizedShipperReference[] = [];

    for (const item of items) {
        const referenceNumber = normalizeReferenceNumber(item.shipperReferenceNumber);
        if (!referenceNumber) {
            continue;
        }
        const pickupStopKey = normalizeOptionalText(item.pickupStopKey);
        if (pickupStopKey && !pickupMap.has(pickupStopKey)) {
            throw new Error(`Titik pickup untuk SJ pengirim ${referenceNumber} tidak ditemukan di surat jalan.`);
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
            notes: reference.notes || existingReference?.notes,
        };
    });
}

function snapshotReferences(references: NormalizedShipperReference[]) {
    return references.map(reference => `${reference.referenceNumber}::${reference.pickupStopKey || ''}`).join('|');
}

async function main() {
    const [deliveryOrders, deliveryOrderItems, constraintDocs] = await Promise.all([
        client.fetch<DeliveryOrderDoc[]>(`*[_type == "deliveryOrder"]{
            _id,
            _rev,
            doNumber,
            "customerRef": customerRef._ref,
            customerDoNumber,
            pickupStops,
            shipperReferences
        }`),
        client.fetch<DeliveryOrderItemDoc[]>(`*[_type == "deliveryOrderItem"]{
            _id,
            deliveryOrderRef,
            shipperReferenceNumber,
            pickupStopKey,
            pickupAddress
        }`),
        client.fetch<ConstraintDoc[]>(`*[
            _type == "uniqueConstraint" &&
            entityType == "deliveryOrder" &&
            fieldName == "customerRefCustomerDoNumber"
        ]{
            _id,
            "ownerRef": ownerRef._ref
        }`),
    ]);

    const itemsByDeliveryOrder = new Map<string, CargoReferenceSnapshot[]>();
    for (const item of deliveryOrderItems) {
        const deliveryOrderRef =
            typeof item.deliveryOrderRef === 'string'
                ? item.deliveryOrderRef
                : normalizeOptionalText(item.deliveryOrderRef?._ref);
        if (!deliveryOrderRef) {
            continue;
        }
        const current = itemsByDeliveryOrder.get(deliveryOrderRef) || [];
        current.push({
            shipperReferenceNumber: item.shipperReferenceNumber,
            pickupStopKey: item.pickupStopKey,
            pickupAddress: item.pickupAddress,
        });
        itemsByDeliveryOrder.set(deliveryOrderRef, current);
    }

    const constraintsByDeliveryOrder = new Map<string, string[]>();
    for (const constraint of constraintDocs) {
        const ownerRef = normalizeOptionalText(constraint.ownerRef);
        if (!ownerRef) {
            continue;
        }
        const current = constraintsByDeliveryOrder.get(ownerRef) || [];
        current.push(constraint._id);
        constraintsByDeliveryOrder.set(ownerRef, current);
    }

    const desiredConstraintOwners = new Map<string, string[]>();
    for (const deliveryOrder of deliveryOrders) {
        const pickupStops = normalizePickupStops(deliveryOrder.pickupStops);
        const nextShipperReferences = buildShipperReferencesFromCargoSnapshots(
            itemsByDeliveryOrder.get(deliveryOrder._id) || [],
            pickupStops,
            deliveryOrder.shipperReferences
        );
        if (!deliveryOrder.customerRef) {
            continue;
        }
        for (const reference of nextShipperReferences) {
            const key = `${deliveryOrder.customerRef}::${reference.referenceNumber}`;
            const current = desiredConstraintOwners.get(key) || [];
            current.push(deliveryOrder._id);
            desiredConstraintOwners.set(key, current);
        }
    }

    let unchanged = 0;
    let patched = 0;
    let skippedNoRevision = 0;
    let skippedConflicts = 0;
    const conflictMessages: string[] = [];

    for (const deliveryOrder of deliveryOrders) {
        const pickupStops = normalizePickupStops(deliveryOrder.pickupStops);
        const existingShipperReferences = normalizeExistingShipperReferences(deliveryOrder.shipperReferences, pickupStops);
        const nextShipperReferences = buildShipperReferencesFromCargoSnapshots(
            itemsByDeliveryOrder.get(deliveryOrder._id) || [],
            pickupStops,
            deliveryOrder.shipperReferences
        );
        const currentConstraintIds = (constraintsByDeliveryOrder.get(deliveryOrder._id) || []).slice().sort();
        const nextConstraintIds = deliveryOrder.customerRef
            ? nextShipperReferences.map(reference => buildDeliveryOrderCustomerDoConstraintId(deliveryOrder.customerRef as string, reference.referenceNumber)).sort()
            : [];

        const currentSnapshot = snapshotReferences(existingShipperReferences);
        const nextSnapshot = snapshotReferences(nextShipperReferences);
        const currentCustomerDoNumber = normalizeReferenceNumber(deliveryOrder.customerDoNumber) || '';
        const nextCustomerDoNumber = nextShipperReferences[0]?.referenceNumber || '';
        const needsPatch =
            currentSnapshot !== nextSnapshot ||
            currentCustomerDoNumber !== nextCustomerDoNumber ||
            currentConstraintIds.join('|') !== nextConstraintIds.join('|');

        if (!needsPatch) {
            unchanged += 1;
            continue;
        }

        const conflictingReference = deliveryOrder.customerRef
            ? nextShipperReferences.find(reference => {
                const owners = desiredConstraintOwners.get(`${deliveryOrder.customerRef}::${reference.referenceNumber}`) || [];
                return owners.length > 1;
            })
            : null;
        if (conflictingReference) {
            skippedConflicts += 1;
            conflictMessages.push(
                `${deliveryOrder.doNumber || deliveryOrder._id}: SJ ${conflictingReference.referenceNumber} bentrok dengan DO lain untuk customer yang sama`
            );
            continue;
        }
        if (!deliveryOrder._rev) {
            skippedNoRevision += 1;
            continue;
        }

        if (!applyChanges) {
            patched += 1;
            continue;
        }

        const transaction = client.transaction();
        currentConstraintIds
            .filter(constraintId => !nextConstraintIds.includes(constraintId))
            .forEach(constraintId => transaction.delete(constraintId));

        if (deliveryOrder.customerRef) {
            nextShipperReferences
                .filter(reference => !currentConstraintIds.includes(buildDeliveryOrderCustomerDoConstraintId(deliveryOrder.customerRef as string, reference.referenceNumber)))
                .forEach(reference => transaction.create(
                    buildDeliveryOrderCustomerDoConstraintDoc(deliveryOrder._id, deliveryOrder.customerRef as string, reference.referenceNumber)
                ));
        }

        transaction.patch(deliveryOrder._id, {
            ifRevisionID: deliveryOrder._rev,
            set: nextShipperReferences.length > 0
                ? {
                    customerDoNumber: nextCustomerDoNumber,
                    shipperReferences: nextShipperReferences,
                }
                : {},
            unset: nextShipperReferences.length > 0 ? [] : ['customerDoNumber', 'shipperReferences'],
        });

        await transaction.commit();
        patched += 1;
    }

    console.log(JSON.stringify({
        mode: applyChanges ? 'write' : 'dry-run',
        dataset: process.env.NEXT_PUBLIC_SANITY_DATASET?.trim() || 'production',
        deliveryOrders: deliveryOrders.length,
        patched,
        unchanged,
        skippedNoRevision,
        skippedConflicts,
        conflicts: conflictMessages.slice(0, 20),
    }, null, 2));
}

main().catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
});
