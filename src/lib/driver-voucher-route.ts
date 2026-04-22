import type { DeliveryOrder, Order } from './types';

type RouteShipperReference = {
    receiverName?: string | null;
    receiverCompany?: string | null;
    receiverAddress?: string | null;
};

type RouteDeliveryOrder = Pick<
    DeliveryOrder,
    | 'tripOriginArea'
    | 'tripDestinationArea'
    | 'pickupAddress'
    | 'receiverAddress'
> & {
    shipperReferences?: RouteShipperReference[] | null;
};

type RouteOrder = Pick<Order, 'pickupAddress' | 'receiverAddress'>;

function normalizeRouteText(value?: string | null) {
    const text = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
    return text || undefined;
}

function stripPostalCode(value: string) {
    return value.replace(/\b\d{5}\b/g, '').replace(/\s+/g, ' ').trim();
}

function extractConciseLocation(value?: string | null) {
    const text = normalizeRouteText(value);
    if (!text) return undefined;

    const commaParts = text.split(',').map(part => stripPostalCode(part)).filter(Boolean);
    if (commaParts.length > 1) {
        return commaParts[commaParts.length - 1];
    }

    const dashParts = text.split(/\s+-\s+/).map(part => stripPostalCode(part)).filter(Boolean);
    if (dashParts.length > 1) {
        return dashParts[dashParts.length - 1];
    }

    return stripPostalCode(text);
}

function summarizeReceiverLocations(deliveryOrder: RouteDeliveryOrder, order?: RouteOrder | null) {
    const targets = new Set<string>();
    for (const reference of deliveryOrder.shipperReferences || []) {
        const location = extractConciseLocation(reference.receiverAddress)
            || normalizeRouteText(reference.receiverCompany)
            || normalizeRouteText(reference.receiverName);
        if (location) {
            targets.add(location);
        }
    }

    if (targets.size === 0) {
        const fallback = extractConciseLocation(deliveryOrder.receiverAddress || order?.receiverAddress);
        if (fallback) {
            targets.add(fallback);
        }
    }

    const values = Array.from(targets);
    if (values.length <= 2) {
        return values.join(', ') || undefined;
    }

    return `${values.slice(0, 2).join(', ')} (+${values.length - 2})`;
}

export function buildDriverVoucherRouteLabel(
    deliveryOrder?: RouteDeliveryOrder | null,
    order?: RouteOrder | null
) {
    if (!deliveryOrder) return undefined;

    const origin = normalizeRouteText(deliveryOrder.tripOriginArea)
        || extractConciseLocation(deliveryOrder.pickupAddress || order?.pickupAddress);
    const destination = normalizeRouteText(deliveryOrder.tripDestinationArea)
        || summarizeReceiverLocations(deliveryOrder, order);

    if (origin && destination) {
        return `${origin} -> ${destination}`;
    }

    return origin || destination || undefined;
}

export function formatDriverVoucherRouteForDisplay(route?: string | null) {
    const text = normalizeRouteText(route);
    if (!text) return undefined;

    const parts = text.split(/\s*->\s*/).map(part => extractConciseLocation(part)).filter(Boolean);
    if (parts.length >= 2) {
        return `${parts[0]} -> ${parts.slice(1).join(', ')}`;
    }

    return extractConciseLocation(text) || text;
}
