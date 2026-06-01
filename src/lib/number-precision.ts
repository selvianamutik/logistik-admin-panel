export function roundToPrecision(value: number, digits = 2) {
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
}
