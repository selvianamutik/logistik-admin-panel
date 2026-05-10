import { buildFreightNotaDisplayNumberFromParts } from '../src/lib/nota-numbering';

const cases: Array<[string, string, string | undefined, string]> = [
    ['INV-202605-0007', '2026-05-10', '3', '26/V/3/007'],
    ['ABC-0012', '2026-12-01', '9', '26/XII/9/012'],
    ['NO-DIGIT', '2026-01-15', undefined, '26/I/3/NO-DIGIT'],
];

for (const [notaNumber, issueDate, seriesCode, expected] of cases) {
    const actual = buildFreightNotaDisplayNumberFromParts(notaNumber, issueDate, seriesCode);
    if (actual !== expected) {
        throw new Error(`Invoice display number mismatch: ${actual} !== ${expected}`);
    }
}

console.log('settings document format audit OK');
