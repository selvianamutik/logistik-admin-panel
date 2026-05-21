import type { TireType } from './types';

export const DEFAULT_TIRE_TYPE: TireType = 'ORI kawat / radial';

export const TIRE_TYPE_OPTIONS = [
    'ORI benang / nilon',
    'ORI kawat / radial',
    'kanisir',
] as const satisfies readonly TireType[];

const LEGACY_TIRE_TYPE_MAP: Record<string, TireType> = {
    Tubeless: 'ORI kawat / radial',
    'Tube Type': 'ORI benang / nilon',
    Solid: 'kanisir',
};

export function isTireType(value: unknown): value is TireType {
    return typeof value === 'string' && (TIRE_TYPE_OPTIONS as readonly string[]).includes(value);
}

export function normalizeTireType(value: unknown, fallback: TireType = DEFAULT_TIRE_TYPE): TireType {
    if (typeof value !== 'string') {
        return fallback;
    }
    const text = value.trim();
    if (isTireType(text)) {
        return text;
    }
    return LEGACY_TIRE_TYPE_MAP[text] || fallback;
}

export function normalizeOptionalTireType(value: unknown): TireType | '' {
    if (typeof value !== 'string' || !value.trim()) {
        return '';
    }
    return normalizeTireType(value);
}
