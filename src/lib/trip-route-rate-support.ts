import type { TripRouteRate } from '@/lib/types';

type TripRouteRateMatchParams = {
    originArea?: string | null;
    destinationArea?: string | null;
    serviceRef?: string | null;
};

function normalizeTripAreaLabel(value?: string | null) {
    return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export function buildTripRateAreaOptions(
    rates: TripRouteRate[],
    field: 'originArea' | 'destinationArea',
    filters?: { originArea?: string | null; serviceRef?: string | null }
) {
    const normalizedOriginArea = normalizeTripAreaLabel(filters?.originArea);
    const normalizedServiceRef = typeof filters?.serviceRef === 'string' ? filters.serviceRef.trim() : '';
    const optionSet = new Set<string>();

    for (const rate of rates) {
        if (rate.active === false) {
            continue;
        }
        if (normalizedServiceRef && rate.serviceRef && rate.serviceRef !== normalizedServiceRef) {
            continue;
        }
        if (
            field === 'destinationArea' &&
            normalizedOriginArea &&
            normalizeTripAreaLabel(rate.originArea) !== normalizedOriginArea
        ) {
            continue;
        }
        const value = typeof rate[field] === 'string' ? rate[field].trim() : '';
        if (value) {
            optionSet.add(value);
        }
    }

    return Array.from(optionSet).sort((left, right) => left.localeCompare(right, 'id'));
}

export function findMatchingTripRouteRate(
    rates: TripRouteRate[],
    params: TripRouteRateMatchParams
) {
    const normalizedOriginArea = normalizeTripAreaLabel(params.originArea);
    const normalizedDestinationArea = normalizeTripAreaLabel(params.destinationArea);
    if (!normalizedOriginArea || !normalizedDestinationArea) {
        return null;
    }

    const normalizedServiceRef = typeof params.serviceRef === 'string' ? params.serviceRef.trim() : '';
    const candidates = rates.filter(rate =>
        rate.active !== false &&
        normalizeTripAreaLabel(rate.originArea) === normalizedOriginArea &&
        normalizeTripAreaLabel(rate.destinationArea) === normalizedDestinationArea
    );

    if (candidates.length === 0) {
        return null;
    }

    const exactServiceMatch = normalizedServiceRef
        ? candidates.find(rate => (rate.serviceRef || '') === normalizedServiceRef)
        : null;
    if (exactServiceMatch) {
        return exactServiceMatch;
    }

    const genericMatch = candidates.find(rate => !rate.serviceRef);
    if (genericMatch) {
        return genericMatch;
    }

    // Never fall back to another service-specific rate when a service is requested.
    if (normalizedServiceRef) {
        return null;
    }

    return candidates[0];
}

export function formatTripRouteRateLabel(rate: Pick<TripRouteRate, 'originArea' | 'destinationArea' | 'serviceName'>) {
    const route = `${rate.originArea} -> ${rate.destinationArea}`;
    return rate.serviceName ? `${route} | ${rate.serviceName}` : route;
}
