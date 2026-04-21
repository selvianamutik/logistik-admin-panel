import type { FreightNotaBillingMode } from './types';

type CustomerBillingRateLike = {
    customerRef?: string;
    basis?: string;
    rate?: number;
    active?: boolean;
    serviceRef?: string;
    routeFrom?: string;
    routeTo?: string;
};

function normalizeText(value: unknown) {
    return typeof value === 'string' ? value.trim() : '';
}

function sameText(left: unknown, right: unknown) {
    return normalizeText(left).toLowerCase() === normalizeText(right).toLowerCase();
}

export function findMatchingCustomerBillingRate(
    rates: CustomerBillingRateLike[],
    params: {
        customerRef?: string | null;
        serviceRef?: string | null;
        basis?: FreightNotaBillingMode | null;
        routeFrom?: string | null;
        routeTo?: string | null;
    }
) {
    const customerRef = normalizeText(params.customerRef);
    const serviceRef = normalizeText(params.serviceRef);
    const basis = normalizeText(params.basis);
    const routeFrom = normalizeText(params.routeFrom);
    const routeTo = normalizeText(params.routeTo);
    if (!customerRef || !basis) {
        return null;
    }

    const candidates = rates.filter(rate =>
        rate.active !== false &&
        normalizeText(rate.customerRef) === customerRef &&
        normalizeText(rate.basis) === basis
    );

    const scored = candidates
        .filter(rate => !normalizeText(rate.serviceRef) || !serviceRef || normalizeText(rate.serviceRef) === serviceRef)
        .filter(rate => !normalizeText(rate.routeFrom) || !routeFrom || sameText(rate.routeFrom, routeFrom))
        .filter(rate => !normalizeText(rate.routeTo) || !routeTo || sameText(rate.routeTo, routeTo))
        .map(rate => ({
            rate,
            score:
                (normalizeText(rate.serviceRef) && serviceRef ? 4 : 0) +
                (normalizeText(rate.routeFrom) && routeFrom ? 2 : 0) +
                (normalizeText(rate.routeTo) && routeTo ? 2 : 0),
        }))
        .sort((left, right) => right.score - left.score);

    return scored[0]?.rate || null;
}
