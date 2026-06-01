export function parseOdometerValue(value: unknown) {
    if (value === undefined || value === null || value === '') {
        return undefined;
    }
    const parsed = typeof value === 'number' ? value : Number(String(value).replace(/\./g, '').replace(',', '.'));
    return Number.isFinite(parsed) ? Math.round(parsed) : undefined;
}

export function isOilMaintenanceType(value: unknown) {
    const text = typeof value === 'string' ? value.toLowerCase() : '';
    return text.includes('oli') || text.includes('oil');
}

export function resolveOilStatus(remainingKm: number | undefined) {
    if (typeof remainingKm !== 'number' || !Number.isFinite(remainingKm)) {
        return undefined;
    }
    if (remainingKm <= 0) return 'DUE';
    if (remainingKm <= 1000) return 'DUE_SOON';
    return 'OK';
}
