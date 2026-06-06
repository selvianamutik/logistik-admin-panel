import { getBusinessDateValue } from '@/lib/business-date';
import { listDocumentsByFilter } from '@/lib/repositories/document-store';
import type { AccountingPeriod } from '@/lib/types';

function normalizeDateValue(value: unknown) {
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
        ? value
        : '';
}

export async function findClosedAccountingPeriodForDate(dateValue: unknown) {
    const normalizedDate = normalizeDateValue(dateValue);
    if (!normalizedDate) return null;

    const periods = await listDocumentsByFilter<AccountingPeriod>('accountingPeriod', {
        status: 'CLOSED',
    });

    return periods.find(period =>
        normalizeDateValue(period.startDate) <= normalizedDate &&
        normalizeDateValue(period.endDate) >= normalizedDate
    ) || null;
}

export async function assertAccountingPeriodOpen(dateValue: unknown, actionLabel = 'Transaksi') {
    const closedPeriod = await findClosedAccountingPeriodForDate(dateValue);
    if (!closedPeriod) return;

    throw new Error(
        `${actionLabel} tanggal ${dateValue || getBusinessDateValue()} masuk periode ${closedPeriod.period} yang sudah dikunci. Buka periode dulu sebelum revisi.`
    );
}
