import type { TripRouteRate } from '@/lib/types';

type TripRouteRateMatchParams = {
    originArea?: string | null;
    destinationArea?: string | null;
    serviceRef?: string | null;
};

type TripRouteOvertonaseSource = Pick<TripRouteRate, 'overtonaseDriverRatePerTon' | 'notes'> & {
    overtonaseReferencePerTon?: number;
};

function normalizeTripAreaLabel(value?: string | null) {
    return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function parseIndonesianMoney(value: string) {
    const normalized = value.replace(/\./g, '').replace(',', '.');
    const numeric = Number(normalized);
    return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
}

export function parseTripRouteOvertonaseRatePerTonFromNotes(notes?: string | null) {
    if (!notes) {
        return 0;
    }

    const match = notes.match(/referensi\s+overtonase\s+admin\s*:\s*rp\s*([0-9.,]+)\s*\/\s*ton/i);
    return match ? Math.round(parseIndonesianMoney(match[1])) : 0;
}

export function stripTripRouteOvertonaseRateNote(notes?: string | null) {
    if (!notes) {
        return '';
    }

    return notes
        .replace(/\s*Referensi\s+overtonase\s+admin\s*:\s*Rp\s*[0-9.,]+\s*\/\s*ton\.?/ig, '')
        .replace(/\s{2,}/g, ' ')
        .trim();
}

export function getTripRouteOvertonaseRatePerTon(
    rate?: TripRouteOvertonaseSource | null
) {
    if (rate && rate.overtonaseDriverRatePerTon !== undefined && rate.overtonaseDriverRatePerTon !== null) {
        const explicitRate = Number(rate.overtonaseDriverRatePerTon);
        return Number.isFinite(explicitRate) && explicitRate > 0 ? Math.round(explicitRate) : 0;
    }
    if (rate && rate.overtonaseReferencePerTon !== undefined && rate.overtonaseReferencePerTon !== null) {
        const legacyRate = Number(rate.overtonaseReferencePerTon);
        return Number.isFinite(legacyRate) && legacyRate > 0 ? Math.round(legacyRate) : 0;
    }

    return parseTripRouteOvertonaseRatePerTonFromNotes(rate?.notes);
}

export function getTripRouteOvertonaseRatePerKg(
    rate?: TripRouteOvertonaseSource | null
) {
    const ratePerTon = getTripRouteOvertonaseRatePerTon(rate);
    return ratePerTon > 0 ? ratePerTon / 1000 : 0;
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
