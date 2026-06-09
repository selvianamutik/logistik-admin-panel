import type { SuratJalanDocument } from './trip-document-types';

function toDisplayText(value: unknown) {
    return typeof value === 'string' && value.trim() ? value.trim() : '';
}

export function getSuratJalanActualDropDestinations(row: Pick<SuratJalanDocument, 'actualDropPoints'>) {
    const destinations = (row.actualDropPoints || [])
        .map(drop => toDisplayText(drop.locationName) || toDisplayText(drop.locationAddress))
        .filter(Boolean);

    return [...new Set(destinations)];
}

export function getSuratJalanDestination(
    row: Pick<
        SuratJalanDocument,
        'actualDropPoints' | 'receiverCompany' | 'receiverName' | 'receiverAddress' | 'tripDestinationArea'
    >
) {
    const actualDropDestinations = getSuratJalanActualDropDestinations(row);
    if (actualDropDestinations.length > 0) {
        return actualDropDestinations.join(', ');
    }

    return toDisplayText(row.receiverCompany) ||
        toDisplayText(row.receiverName) ||
        toDisplayText(row.receiverAddress) ||
        toDisplayText(row.tripDestinationArea) ||
        '-';
}
