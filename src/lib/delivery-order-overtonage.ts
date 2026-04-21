export type DeliveryOrderOvertonageResult = {
    actualTotalWeightKg: number;
    serviceMaxPayloadKg?: number;
    vehicleCapacityKg?: number;
    overtonaseWeightKg?: number;
    overtonaseDriverRatePerKg?: number;
    overtonaseDriverAmount?: number;
    vehicleCapacityExceededKg?: number;
    effectiveTripFee: number;
};

function normalizeNonNegative(value: unknown) {
    const numeric = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) {
        return 0;
    }
    return numeric;
}

function roundQuantity(value: number, digits = 2) {
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
}

export function computeDeliveryOrderOvertonage(params: {
    actualTotalWeightKg: unknown;
    serviceMaxPayloadKg?: unknown;
    vehicleCapacityKg?: unknown;
    baseTripFee?: unknown;
    overtonaseDriverRatePerKg?: unknown;
}): DeliveryOrderOvertonageResult {
    const actualTotalWeightKg = roundQuantity(normalizeNonNegative(params.actualTotalWeightKg));
    const serviceMaxPayloadKg = roundQuantity(normalizeNonNegative(params.serviceMaxPayloadKg));
    const vehicleCapacityKg = roundQuantity(normalizeNonNegative(params.vehicleCapacityKg));
    const baseTripFee = Math.round(normalizeNonNegative(params.baseTripFee));
    const overtonaseDriverRatePerKg = Math.round(normalizeNonNegative(params.overtonaseDriverRatePerKg));
    const effectivePayloadLimitKg = vehicleCapacityKg > 0 ? vehicleCapacityKg : serviceMaxPayloadKg;

    const overtonaseWeightKg =
        actualTotalWeightKg > 0 && effectivePayloadLimitKg > 0
            ? roundQuantity(Math.max(actualTotalWeightKg - effectivePayloadLimitKg, 0))
            : 0;
    const vehicleCapacityExceededKg =
        actualTotalWeightKg > 0 && vehicleCapacityKg > 0
            ? roundQuantity(Math.max(actualTotalWeightKg - vehicleCapacityKg, 0))
            : 0;
    const overtonaseDriverAmount =
        overtonaseWeightKg > 0 && overtonaseDriverRatePerKg > 0
            ? Math.round(overtonaseWeightKg * overtonaseDriverRatePerKg)
            : 0;

    return {
        actualTotalWeightKg,
        serviceMaxPayloadKg: serviceMaxPayloadKg > 0 ? serviceMaxPayloadKg : undefined,
        vehicleCapacityKg: vehicleCapacityKg > 0 ? vehicleCapacityKg : undefined,
        overtonaseWeightKg: overtonaseWeightKg > 0 ? overtonaseWeightKg : undefined,
        overtonaseDriverRatePerKg: overtonaseDriverRatePerKg > 0 ? overtonaseDriverRatePerKg : undefined,
        overtonaseDriverAmount: overtonaseDriverAmount > 0 ? overtonaseDriverAmount : undefined,
        vehicleCapacityExceededKg: vehicleCapacityExceededKg > 0 ? vehicleCapacityExceededKg : undefined,
        effectiveTripFee: baseTripFee + overtonaseDriverAmount,
    };
}
