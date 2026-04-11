import type { Pph23BaseMode } from './types';
import { parseFormattedNumberish } from './formatted-number';

export const DEFAULT_PPH23_RATE_PERCENT = 2;
export const DEFAULT_PPH23_BASE_MODE: Pph23BaseMode = 'BEFORE_CLAIM';

export const PPH23_BASE_MODE_OPTIONS: Array<{ value: Pph23BaseMode; label: string }> = [
    { value: 'BEFORE_CLAIM', label: 'Sebelum Claim' },
    { value: 'AFTER_CLAIM', label: 'Sesudah Claim' },
];

function roundMoney(value: unknown) {
    const parsed = parseFormattedNumberish(value ?? 0, { maxFractionDigits: 0 });
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return 0;
    }
    return Math.round(parsed);
}

function roundRate(value: number) {
    return Math.round(value * 100) / 100;
}

export function normalizePph23Enabled(value: unknown, fallback = false) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (normalized === 'true') return true;
        if (normalized === 'false') return false;
    }
    return fallback;
}

export function normalizePph23BaseMode(value: unknown, fallback: Pph23BaseMode = DEFAULT_PPH23_BASE_MODE): Pph23BaseMode {
    if (typeof value !== 'string') {
        return fallback;
    }
    const normalized = value.trim().toUpperCase();
    if (normalized === 'AFTER_CLAIM') return 'AFTER_CLAIM';
    if (normalized === 'BEFORE_CLAIM') return 'BEFORE_CLAIM';
    return fallback;
}

export function normalizePph23RatePercent(value: unknown, fallback = DEFAULT_PPH23_RATE_PERCENT) {
    const parsed = parseFormattedNumberish(value ?? fallback, { maxFractionDigits: 2 });
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
        return roundRate(fallback);
    }
    return roundRate(parsed);
}

export function getPph23BaseModeLabel(value: Pph23BaseMode) {
    return value === 'AFTER_CLAIM' ? 'Sesudah Claim' : 'Sebelum Claim';
}

export function formatPph23RateLabel(ratePercent: number) {
    const normalized = normalizePph23RatePercent(ratePercent);
    return `${normalized.toLocaleString('id-ID', {
        minimumFractionDigits: normalized % 1 === 0 ? 0 : 2,
        maximumFractionDigits: 2,
    })}%`;
}

export function buildPph23Label(params: {
    enabled?: boolean;
    ratePercent?: number;
    baseMode?: Pph23BaseMode;
}) {
    const enabled = normalizePph23Enabled(params.enabled);
    if (!enabled) {
        return 'Tidak Dipotong PPh 23';
    }
    const ratePercent = normalizePph23RatePercent(params.ratePercent);
    const baseMode = normalizePph23BaseMode(params.baseMode);
    return `PPh 23 ${formatPph23RateLabel(ratePercent)} (${getPph23BaseModeLabel(baseMode)})`;
}

export function calculatePph23Summary(params: {
    grossAmount?: unknown;
    claimAmount?: unknown;
    enabled?: unknown;
    ratePercent?: unknown;
    baseMode?: unknown;
}) {
    const grossAmount = roundMoney(params.grossAmount);
    const claimAmount = roundMoney(params.claimAmount);
    const enabled = normalizePph23Enabled(params.enabled);
    const ratePercent = normalizePph23RatePercent(params.ratePercent);
    const baseMode = normalizePph23BaseMode(params.baseMode);
    const baseAmount = enabled
        ? roundMoney(baseMode === 'AFTER_CLAIM' ? Math.max(grossAmount - claimAmount, 0) : grossAmount)
        : 0;
    const amount = enabled && ratePercent > 0
        ? roundMoney((baseAmount * ratePercent) / 100)
        : 0;
    const netAmount = roundMoney(Math.max(grossAmount - claimAmount - amount, 0));

    return {
        enabled,
        ratePercent,
        baseMode,
        baseAmount,
        amount,
        netAmount,
        grossAmount,
        claimAmount,
    };
}
