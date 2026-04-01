import { parseFormattedNumberish } from './formatted-number';
import { convertKgToWeightInputValue } from './measurement';
import type { FreightNotaBillingMode } from './types';

export const FREIGHT_NOTA_BILLING_MODE_OPTIONS: Array<{
    value: FreightNotaBillingMode;
    label: string;
    description: string;
}> = [
    {
        value: 'PER_KG',
        label: 'Kg / Tarif per kg',
        description: 'Nota tampil dalam kg dan total dihitung per kg.',
    },
    {
        value: 'PER_TON',
        label: 'Ton / Tarif per ton',
        description: 'Nota tampil dalam ton dan total dihitung per ton.',
    },
];

export function isFreightNotaBillingMode(value: unknown): value is FreightNotaBillingMode {
    return value === 'PER_KG' || value === 'PER_TON';
}

export function normalizeFreightNotaBillingMode(value: unknown): FreightNotaBillingMode {
    return value === 'PER_TON' ? 'PER_TON' : 'PER_KG';
}

export function resolveFreightNotaBillingModeInput(
    value: unknown,
    label: string,
    options?: { defaultMode?: FreightNotaBillingMode; allowEmpty?: boolean }
): FreightNotaBillingMode {
    const normalized =
        typeof value === 'string'
            ? value.trim().toUpperCase()
            : '';
    if (!normalized) {
        if (options?.allowEmpty) {
            return options?.defaultMode || 'PER_KG';
        }
        throw new Error(`${label} tidak valid`);
    }
    if (!isFreightNotaBillingMode(normalized)) {
        throw new Error(`${label} tidak valid`);
    }
    return normalized;
}

export function getFreightNotaBillingModeLabel(mode: FreightNotaBillingMode) {
    return mode === 'PER_TON' ? 'Per Ton' : 'Per Kg';
}

export function getFreightNotaWeightColumnLabel(mode: FreightNotaBillingMode) {
    return mode === 'PER_TON' ? 'BERAT TON' : 'BERAT KG';
}

export function getFreightNotaRateColumnLabel(mode: FreightNotaBillingMode) {
    return mode === 'PER_TON' ? 'TARIF/TON' : 'TARIF/KG';
}

export function getFreightNotaWeightUnitLabel(mode: FreightNotaBillingMode) {
    return mode === 'PER_TON' ? 'ton' : 'kg';
}

export function getFreightNotaDisplayWeightValue(beratKg: unknown, mode: FreightNotaBillingMode) {
    const normalizedKg = Math.max(parseFormattedNumberish(beratKg || 0), 0);
    return mode === 'PER_TON'
        ? convertKgToWeightInputValue(normalizedKg, 'TON')
        : normalizedKg;
}

export function roundFreightNotaCurrencyAmount(value: unknown) {
    const numeric = parseFormattedNumberish(value || 0);
    if (!Number.isFinite(numeric) || numeric <= 0) {
        return 0;
    }
    return Math.round(numeric);
}

export function calculateFreightNotaRowAmount(params: {
    beratKg: unknown;
    tarip: unknown;
    billingMode: FreightNotaBillingMode;
}) {
    const beratKg = Math.max(parseFormattedNumberish(params.beratKg || 0), 0);
    const tarip = Math.max(parseFormattedNumberish(params.tarip || 0), 0);
    const billedWeight = params.billingMode === 'PER_TON'
        ? convertKgToWeightInputValue(beratKg, 'TON')
        : beratKg;
    return roundFreightNotaCurrencyAmount(billedWeight * tarip);
}

function formatBillingValue(value: number, maxFractionDigits: number) {
    return new Intl.NumberFormat('id-ID', {
        minimumFractionDigits: 0,
        maximumFractionDigits: maxFractionDigits,
    }).format(value);
}

export function formatFreightNotaDisplayWeight(params: {
    beratKg: unknown;
    billingMode: FreightNotaBillingMode;
    includeCanonical?: boolean;
}) {
    const beratKg = Math.max(parseFormattedNumberish(params.beratKg || 0), 0);
    if (params.billingMode === 'PER_TON') {
        const tonValue = getFreightNotaDisplayWeightValue(beratKg, 'PER_TON');
        const tonLabel = `${formatBillingValue(tonValue, 3)} ton`;
        if (params.includeCanonical) {
            return `${tonLabel} (${formatBillingValue(beratKg, 2)} kg)`;
        }
        return tonLabel;
    }

    return `${formatBillingValue(beratKg, 2)} kg`;
}
