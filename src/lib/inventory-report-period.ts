import { getBusinessCalendarDateParts } from './business-date';

export type InventoryReportPeriodMode = 'month' | 'year' | 'custom';

export const INVENTORY_REPORT_MONTH_NAMES = [
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

export function getDefaultInventoryReportPeriod() {
  const today = getBusinessCalendarDateParts() || {
    year: String(new Date().getFullYear()),
    month: String(new Date().getMonth() + 1).padStart(2, '0'),
    day: '01',
  };
  const year = Number(today.year);
  const monthIndex = Math.max(Math.min(Number(today.month) - 1, 11), 0);

  return { year, monthIndex };
}

export function getInventoryReportYearOptions(selectedYear?: number, yearsBack = 5, yearsForward = 1) {
  const defaultPeriod = getDefaultInventoryReportPeriod();
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

export function normalizeInventoryReportDate(value: string | undefined | null) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)
    ? value.slice(0, 10)
    : '';
}

export function getLastDateOfMonth(year: number, monthIndex: number) {
  const date = new Date(Date.UTC(year, monthIndex + 1, 0));
  const nextYear = date.getUTCFullYear();
  const nextMonth = String(date.getUTCMonth() + 1).padStart(2, '0');
  const nextDay = String(date.getUTCDate()).padStart(2, '0');
  return `${nextYear}-${nextMonth}-${nextDay}`;
}

export function getInventoryReportDateRange(params: {
  mode: InventoryReportPeriodMode;
  monthIndex: number;
  year: number;
  dateFrom?: string;
  dateTo?: string;
}) {
  const defaultPeriod = getDefaultInventoryReportPeriod();
  const safeYear = Number.isFinite(params.year) ? Math.trunc(params.year) : defaultPeriod.year;
  const safeMonthIndex = Number.isFinite(params.monthIndex)
    ? Math.max(0, Math.min(11, Math.trunc(params.monthIndex)))
    : defaultPeriod.monthIndex;

  if (params.mode === 'year') {
    return {
      startDate: `${safeYear}-01-01`,
      endDate: `${safeYear}-12-31`,
    };
  }

  if (params.mode === 'custom') {
    const startDate = normalizeInventoryReportDate(params.dateFrom);
    const endDate = normalizeInventoryReportDate(params.dateTo);
    return {
      startDate,
      endDate,
    };
  }

  const month = String(safeMonthIndex + 1).padStart(2, '0');
  return {
    startDate: `${safeYear}-${month}-01`,
    endDate: getLastDateOfMonth(safeYear, safeMonthIndex),
  };
}

export function buildInventoryReportPeriodLabel(params: {
  mode: InventoryReportPeriodMode;
  monthIndex: number;
  year: number;
  startDate?: string;
  endDate?: string;
}) {
  const defaultPeriod = getDefaultInventoryReportPeriod();
  const safeYear = Number.isFinite(params.year) ? Math.trunc(params.year) : defaultPeriod.year;
  const safeMonthIndex = Number.isFinite(params.monthIndex)
    ? Math.max(0, Math.min(11, Math.trunc(params.monthIndex)))
    : defaultPeriod.monthIndex;

  if (params.mode === 'year') return `Tahun ${safeYear}`;
  if (params.mode === 'custom') {
    const startDate = normalizeInventoryReportDate(params.startDate) || '-';
    const endDate = normalizeInventoryReportDate(params.endDate) || '-';
    return `${startDate} s.d. ${endDate}`;
  }

  return `${INVENTORY_REPORT_MONTH_NAMES[safeMonthIndex]} ${safeYear}`;
}

export function isDateInInventoryReportRange(dateValue: string | undefined | null, startDate: string, endDate: string) {
  const normalized = normalizeInventoryReportDate(dateValue);
  if (!normalized) return false;
  if (startDate && normalized < startDate) return false;
  if (endDate && normalized > endDate) return false;
  return true;
}
