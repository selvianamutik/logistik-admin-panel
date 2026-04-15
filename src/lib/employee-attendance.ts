import type { Employee, EmployeeAttendanceRecord } from './types';

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

export type EmployeeAttendanceCountSummary = {
    presentCount: number;
    earlyLeaveCount: number;
    permissionCount: number;
    sickCount: number;
    leaveCount: number;
    absentCount: number;
    offCount: number;
};

export type EmployeeAttendanceRecapRow = {
    employeeRef: string;
    employeeCode: string;
    employeeName: string;
    division: string;
    position: string;
    recordedDays: number;
    presentCount: number;
    earlyLeaveCount: number;
    permissionCount: number;
    sickCount: number;
    leaveCount: number;
    absentCount: number;
    offCount: number;
    lastAttendanceDate: string;
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

export function createEmployeeAttendanceCountSummary(): EmployeeAttendanceCountSummary {
    return {
        presentCount: 0,
        earlyLeaveCount: 0,
        permissionCount: 0,
        sickCount: 0,
        leaveCount: 0,
        absentCount: 0,
        offCount: 0,
    };
}

export function isEmployeeAttendancePresentStatus(status: EmployeeAttendanceStatus) {
    return status === 'HADIR' || status === 'PULANG_LEBIH_AWAL';
}

export function accumulateEmployeeAttendanceCount(
    summary: EmployeeAttendanceCountSummary,
    status: EmployeeAttendanceStatus
) {
    if (isEmployeeAttendancePresentStatus(status)) {
        summary.presentCount += 1;
    }
    if (status === 'PULANG_LEBIH_AWAL') {
        summary.earlyLeaveCount += 1;
    }
    if (status === 'IZIN') {
        summary.permissionCount += 1;
    }
    if (status === 'SAKIT') {
        summary.sickCount += 1;
    }
    if (status === 'CUTI') {
        summary.leaveCount += 1;
    }
    if (status === 'ALPHA') {
        summary.absentCount += 1;
    }
    if (status === 'LIBUR') {
        summary.offCount += 1;
    }
    return summary;
}

export function summarizeEmployeeAttendanceRecords(
    records: Array<Pick<EmployeeAttendanceRecord, 'status'>>
) {
    return records.reduce((summary, record) => {
        accumulateEmployeeAttendanceCount(summary, record.status);
        return summary;
    }, createEmployeeAttendanceCountSummary());
}

export function buildEmployeeAttendanceRecapRows(
    records: EmployeeAttendanceRecord[],
    employees: Array<Pick<Employee, '_id' | 'employeeCode' | 'name' | 'division' | 'position'>> = []
) {
    const employeesById = new Map(employees.map(employee => [employee._id, employee]));
    const rowsByEmployee = new Map<string, EmployeeAttendanceRecapRow>();

    for (const record of records) {
        const employeeRef = typeof record.employeeRef === 'string' ? record.employeeRef : '';
        if (!employeeRef) continue;

        const employee = employeesById.get(employeeRef);
        const existing = rowsByEmployee.get(employeeRef);
        const nextRow =
            existing
            || {
                employeeRef,
                employeeCode: record.employeeCode || employee?.employeeCode || '',
                employeeName: record.employeeName || employee?.name || '',
                division: record.division || employee?.division || '',
                position: record.position || employee?.position || '',
                recordedDays: 0,
                ...createEmployeeAttendanceCountSummary(),
                lastAttendanceDate: '',
            };

        nextRow.recordedDays += 1;
        nextRow.employeeCode = nextRow.employeeCode || record.employeeCode || employee?.employeeCode || '';
        nextRow.employeeName = nextRow.employeeName || record.employeeName || employee?.name || '';
        nextRow.division = nextRow.division || record.division || employee?.division || '';
        nextRow.position = nextRow.position || record.position || employee?.position || '';
        if (record.date && (!nextRow.lastAttendanceDate || record.date > nextRow.lastAttendanceDate)) {
            nextRow.lastAttendanceDate = record.date;
        }

        accumulateEmployeeAttendanceCount(nextRow, record.status);
        rowsByEmployee.set(employeeRef, nextRow);
    }

    return Array.from(rowsByEmployee.values()).sort((left, right) => {
        const nameCompare = left.employeeName.localeCompare(right.employeeName, 'id-ID');
        if (nameCompare !== 0) return nameCompare;
        return left.employeeCode.localeCompare(right.employeeCode, 'id-ID');
    });
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
