import type { Service, Vehicle } from './types';

type CapacityRangeSource = Pick<Vehicle, 'capacityMin' | 'capacityMax' | 'capacityKg'>;

function parseTonRangeValue(value: string | number | null | undefined) {
    if (value === null || value === undefined) {
        return undefined;
    }
    if (typeof value === 'number') {
        return Number.isFinite(value) && value > 0 ? value : undefined;
    }

    const normalized = value.replace(',', '.').trim();
    if (!normalized || !/^\d+(\.\d+)?$/.test(normalized)) {
        return undefined;
    }

    const parsed = Number(normalized);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function formatTonValue(value: number) {
    const rounded = Math.round(value * 100) / 100;
    return Number.isInteger(rounded)
        ? String(rounded)
        : rounded.toLocaleString('id-ID', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

export function getVehicleCapacityRange(source: CapacityRangeSource) {
    const minTon = parseTonRangeValue(source.capacityMin);
    const parsedMaxTon = parseTonRangeValue(source.capacityMax);
    const fallbackMaxTon =
        parsedMaxTon !== undefined
            ? parsedMaxTon
            : typeof source.capacityKg === 'number' && Number.isFinite(source.capacityKg) && source.capacityKg > 0
                ? source.capacityKg / 1000
                : undefined;
    const maxTon =
        minTon !== undefined && fallbackMaxTon !== undefined && fallbackMaxTon < minTon
            ? minTon
            : fallbackMaxTon;

    return {
        minTon,
        maxTon,
    };
}

export function formatCapacityRangeLabel(source: CapacityRangeSource) {
    const { minTon, maxTon } = getVehicleCapacityRange(source);
    if (minTon !== undefined && maxTon !== undefined) {
        return `${formatTonValue(minTon)} ton - ${formatTonValue(maxTon)} ton`;
    }
    if (maxTon !== undefined) {
        return `maks ${formatTonValue(maxTon)} ton`;
    }
    if (minTon !== undefined) {
        return `mulai ${formatTonValue(minTon)} ton`;
    }
    return 'Kapasitas belum diisi';
}

export function buildServiceCapacityRangeMap(services: Service[]) {
    return services.reduce<Record<string, string>>((acc, service) => {
        if (service.maxPayloadKg && service.maxPayloadKg > 0) {
            acc[service._id] = `maks ${formatTonValue(service.maxPayloadKg / 1000)} ton`;
            return acc;
        }

        acc[service._id] = 'Kapasitas layanan belum diisi';
        return acc;
    }, {});
}
