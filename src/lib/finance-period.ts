import { getBusinessCalendarDateParts, getBusinessDateValue } from './business-date';

export type FinancePeriodMode = 'all' | 'month' | 'year' | 'custom';

export const FINANCE_PERIOD_MONTH_NAMES = [
  'Januari',
  'Februari',
  'Maret',
  'April',
  'Mei',
  'Juni',
  'Juli',
  'Agustus',
  'September',
  'Oktober',
  'November',
  'Desember',
];

export function getDefaultFinancePeriod() {
  const today = getBusinessCalendarDateParts() || {
    year: String(new Date().getFullYear()),
    month: String(new Date().getMonth() + 1).padStart(2, '0'),
    day: '01',
  };
  const year = Number(today.year);
  const monthIndex = Math.max(Math.min(Number(today.month) - 1, 11), 0);

  return { year, monthIndex };
}

export function normalizeFinanceDate(value: string | undefined | null) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)
    ? value.slice(0, 10)
    : '';
}

export function getFinanceLastDateOfMonth(year: number, monthIndex: number) {
  const date = new Date(Date.UTC(year, monthIndex + 1, 0));
  const nextYear = date.getUTCFullYear();
  const nextMonth = String(date.getUTCMonth() + 1).padStart(2, '0');
  const nextDay = String(date.getUTCDate()).padStart(2, '0');
  return `${nextYear}-${nextMonth}-${nextDay}`;
}

export function getFinancePeriodYearOptions(selectedYear?: number, yearsBack = 5, yearsForward = 1) {
  const defaultPeriod = getDefaultFinancePeriod();
  const currentYear = Number.isFinite(defaultPeriod.year) ? defaultPeriod.year : new Date().getFullYear();
  const years = new Set<number>();

  for (let year = currentYear - yearsBack; year <= currentYear + yearsForward; year += 1) {
    years.add(year);
  }

  if (Number.isFinite(selectedYear)) {
    years.add(Number(selectedYear));
  }

  return Array.from(years).sort((left, right) => right - left);
}

export function getFinancePeriodDateRange(params: {
  mode: FinancePeriodMode;
  monthIndex: number;
  year: number;
  dateFrom?: string;
  dateTo?: string;
}) {
  const defaultPeriod = getDefaultFinancePeriod();
  const safeYear = Number.isFinite(params.year) ? Math.trunc(params.year) : defaultPeriod.year;
  const safeMonthIndex = Number.isFinite(params.monthIndex)
    ? Math.max(0, Math.min(11, Math.trunc(params.monthIndex)))
    : defaultPeriod.monthIndex;

  if (params.mode === 'all') {
    return { startDate: '', endDate: '' };
  }

  if (params.mode === 'year') {
    return {
      startDate: `${safeYear}-01-01`,
      endDate: `${safeYear}-12-31`,
    };
  }

  if (params.mode === 'custom') {
    return {
      startDate: normalizeFinanceDate(params.dateFrom),
      endDate: normalizeFinanceDate(params.dateTo),
    };
  }

  const month = String(safeMonthIndex + 1).padStart(2, '0');
  return {
    startDate: `${safeYear}-${month}-01`,
    endDate: getFinanceLastDateOfMonth(safeYear, safeMonthIndex),
  };
}

export function isFinancePeriodRangeReady(mode: FinancePeriodMode, startDate: string, endDate: string) {
  if (mode === 'all') return true;
  return Boolean(startDate && endDate && startDate <= endDate);
}

export function buildFinanceDateFilter(startDate: string, endDate: string) {
  const normalizedStartDate = normalizeFinanceDate(startDate);
  const normalizedEndDate = normalizeFinanceDate(endDate);
  if (!normalizedStartDate || !normalizedEndDate || normalizedStartDate > normalizedEndDate) {
    return null;
  }
  return { gte: normalizedStartDate, lte: normalizedEndDate };
}

export function buildFinancePeriodLabel(params: {
  mode: FinancePeriodMode;
  monthIndex: number;
  year: number;
  startDate?: string;
  endDate?: string;
}) {
  if (params.mode === 'all') return 'Semua Tanggal';
  if (params.mode === 'year') return `Tahun ${params.year}`;
  if (params.mode === 'custom') {
    const startDate = normalizeFinanceDate(params.startDate) || '-';
    const endDate = normalizeFinanceDate(params.endDate) || '-';
    return `${startDate} s.d. ${endDate}`;
  }
  return `${FINANCE_PERIOD_MONTH_NAMES[params.monthIndex] || '-'} ${params.year}`;
}

export function getDefaultFinanceCustomDateFrom() {
  const defaultPeriod = getDefaultFinancePeriod();
  return `${defaultPeriod.year}-${String(defaultPeriod.monthIndex + 1).padStart(2, '0')}-01`;
}

export function getDefaultFinanceCustomDateTo() {
  return getBusinessDateValue();
}
