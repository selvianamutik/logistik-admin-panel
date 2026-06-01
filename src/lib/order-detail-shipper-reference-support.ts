import type { DeliveryOrder, DeliveryOrderItem } from '@/lib/types';

type DeliveryOrderShipperReferenceSource = Pick<DeliveryOrder, '_id' | 'customerDoNumber' | 'shipperReferences'>;

export function getDeliveryOrderShipperReferenceNumbers(
    deliveryOrder: DeliveryOrderShipperReferenceSource,
    deliveryOrderItems: Pick<DeliveryOrderItem, 'deliveryOrderRef' | 'shipperReferenceNumber'>[] = []
) {
    const references =
        Array.isArray(deliveryOrder.shipperReferences)
            ? deliveryOrder.shipperReferences
                .map(reference => reference.referenceNumber?.trim())
                .filter((value): value is string => Boolean(value))
            : [];

    deliveryOrderItems
        .filter(item => item.deliveryOrderRef === deliveryOrder._id)
        .map(item => item.shipperReferenceNumber?.trim())
        .filter((value): value is string => Boolean(value))
        .forEach(value => references.push(value));

    if (references.length === 0 && deliveryOrder.customerDoNumber?.trim()) {
        references.push(deliveryOrder.customerDoNumber.trim());
    }

    return Array.from(new Set(references));
}

export function formatDeliveryOrderShipperReferencePreview(
    deliveryOrder: DeliveryOrderShipperReferenceSource,
    deliveryOrderItems: Pick<DeliveryOrderItem, 'deliveryOrderRef' | 'shipperReferenceNumber'>[] = [],
    limit: number = 2
) {
    const references = getDeliveryOrderShipperReferenceNumbers(deliveryOrder, deliveryOrderItems);
    if (references.length === 0) {
        return null;
    }
    if (references.length <= limit) {
        return references.join(', ');
    }
    return `${references.slice(0, limit).join(', ')} +${references.length - limit} lagi`;
}

export function buildDeliveryOrderShipperReferenceLinks(
    deliveryOrder: DeliveryOrderShipperReferenceSource,
    deliveryOrderItems: Pick<DeliveryOrderItem, 'deliveryOrderRef' | 'shipperReferenceKey' | 'shipperReferenceNumber'>[] = []
) {
    const links = new Map<string, { id: string; label: string }>();

    (deliveryOrder.shipperReferences || []).forEach((reference, index) => {
        const label = reference.referenceNumber?.trim();
        if (!label) return;
        const referenceIdentity = reference._key || reference.referenceNumber || `reference-${index + 1}`;
        const id = `${deliveryOrder._id}:${referenceIdentity}`;
        links.set(id, { id, label });
    });

    deliveryOrderItems
        .filter(item => item.deliveryOrderRef === deliveryOrder._id)
        .forEach(item => {
            const label = item.shipperReferenceNumber?.trim();
            if (!label) return;
            const referenceIdentity = item.shipperReferenceKey || item.shipperReferenceNumber || 'primary';
            const id = `${deliveryOrder._id}:${referenceIdentity}`;
            if (!links.has(id)) {
                links.set(id, { id, label });
            }
        });

    if (links.size === 0 && deliveryOrder.customerDoNumber?.trim()) {
        const id = `${deliveryOrder._id}:primary`;
        links.set(id, { id, label: deliveryOrder.customerDoNumber.trim() });
    }

    return [...links.values()];
}
