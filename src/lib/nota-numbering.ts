const ROMAN_MONTHS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];

export function buildFreightNotaDisplayNumberFromParts(
    notaNumber: string,
    issueDate: string,
    notaSeriesCode?: string | null,
) {
    const date = new Date(issueDate);
    if (Number.isNaN(date.getTime())) {
        return notaNumber;
    }

    const year = String(date.getFullYear()).slice(-2);
    const romanMonth = ROMAN_MONTHS[date.getMonth()] || String(date.getMonth() + 1);
    const sequenceMatch = notaNumber.match(/(\d+)(?!.*\d)/);
    const sequence = sequenceMatch ? String(Number(sequenceMatch[1])).padStart(3, '0') : notaNumber;
    const seriesCode = notaSeriesCode?.trim() || '3';

    return `${year}/${romanMonth}/${seriesCode}/${sequence}`;
}
