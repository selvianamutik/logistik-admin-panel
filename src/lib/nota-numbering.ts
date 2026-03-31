import { getBusinessCalendarDateParts } from './business-date';

const ROMAN_MONTHS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];

export function buildFreightNotaDisplayNumberFromParts(
    notaNumber: string,
    issueDate: string,
    notaSeriesCode?: string | null,
) {
    const dateParts = getBusinessCalendarDateParts(issueDate);
    if (!dateParts) {
        return notaNumber;
    }

    const year = dateParts.year.slice(-2);
    const monthIndex = Number(dateParts.month) - 1;
    const romanMonth = ROMAN_MONTHS[monthIndex] || String(monthIndex + 1);
    const sequenceMatch = notaNumber.match(/(\d+)(?!.*\d)/);
    const sequence = sequenceMatch ? String(Number(sequenceMatch[1])).padStart(3, '0') : notaNumber;
    const seriesCode = notaSeriesCode?.trim() || '3';

    return `${year}/${romanMonth}/${seriesCode}/${sequence}`;
}
