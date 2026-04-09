import { getBusinessDateValue, parseBusinessDateValue } from './business-date';

export type EmployeeAttendanceStatus =
    | 'HADIR'
    | 'PULANG_LEBIH_AWAL'
    | 'IZIN'
    | 'SAKIT'
    | 'CUTI'
    | 'ALPHA'
    | 'LIBUR';

export type EmployeeAttendancePeriod = 'today' | 'thisWeek' | 'thisMonth' | 'thisYear';

export const EMPLOYEE_ATTENDANCE_STATUS_OPTIONS: EmployeeAttendanceStatus[] = [
    'HADIR',
    'PULANG_LEBIH_AWAL',
    'IZIN',
    'SAKIT',
    'CUTI',
    'ALPHA',
    'LIBUR',
];

export const EMPLOYEE_ATTENDANCE_STATUS_LABELS: Record<EmployeeAttendanceStatus, string> = {
    HADIR: 'Hadir',
    PULANG_LEBIH_AWAL: 'Pulang Lebih Awal',
    IZIN: 'Izin',
    SAKIT: 'Sakit',
    CUTI: 'Cuti',
    ALPHA: 'Alpha',
    LIBUR: 'Libur',
};

export const EMPLOYEE_ATTENDANCE_PERIOD_LABELS: Record<EmployeeAttendancePeriod, string> = {
    today: 'Hari Ini',
    thisWeek: 'Minggu Ini',
    thisMonth: 'Bulan Ini',
    thisYear: 'Tahun Ini',
};

export type EmployeeAttendancePeriodRange = {
    startDate: string;
    endDate: string;
};

const TIME_VALUE_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

function formatUtcDateValue(date: Date) {
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function parseDateValueAsUtc(value: string) {
    const parsed = parseBusinessDateValue(value);
    if (!parsed) return null;
    return new Date(Date.UTC(Number(parsed.year), Number(parsed.month) - 1, Number(parsed.day)));
}

export function isEmployeeAttendanceStatus(value: unknown): value is EmployeeAttendanceStatus {
    return EMPLOYEE_ATTENDANCE_STATUS_OPTIONS.includes(value as EmployeeAttendanceStatus);
}

export function normalizeEmployeeAttendanceStatus(value: unknown) {
    return isEmployeeAttendanceStatus(value) ? value : undefined;
}

export function normalizeEmployeeAttendanceTime(value: unknown) {
    if (typeof value !== 'string') {
        return undefined;
    }
    const normalized = value.trim();
    if (!normalized) {
        return undefined;
    }
    return TIME_VALUE_RE.test(normalized) ? normalized : null;
}

export function getEmployeeAttendancePeriodRange(
    period: EmployeeAttendancePeriod,
    anchorDate: string = getBusinessDateValue(),
): EmployeeAttendancePeriodRange {
    const anchor = parseDateValueAsUtc(anchorDate) || parseDateValueAsUtc(getBusinessDateValue())!;

    if (period === 'today') {
        const value = formatUtcDateValue(anchor);
        return { startDate: value, endDate: value };
    }

    if (period === 'thisWeek') {
        const dayOfWeek = anchor.getUTCDay();
        const offsetToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
        const start = new Date(anchor);
        start.setUTCDate(anchor.getUTCDate() + offsetToMonday);
        const end = new Date(start);
        end.setUTCDate(start.getUTCDate() + 6);
        return {
            startDate: formatUtcDateValue(start),
            endDate: formatUtcDateValue(end),
        };
    }

    if (period === 'thisMonth') {
        const year = anchor.getUTCFullYear();
        const month = anchor.getUTCMonth();
        const start = new Date(Date.UTC(year, month, 1));
        const end = new Date(Date.UTC(year, month + 1, 0));
        return {
            startDate: formatUtcDateValue(start),
            endDate: formatUtcDateValue(end),
        };
    }

    const year = anchor.getUTCFullYear();
    return {
        startDate: `${year}-01-01`,
        endDate: `${year}-12-31`,
    };
}

export function isDateWithinEmployeeAttendanceRange(
    dateValue: string | undefined,
    range: EmployeeAttendancePeriodRange,
) {
    if (!dateValue) return false;
    return dateValue >= range.startDate && dateValue <= range.endDate;
}
