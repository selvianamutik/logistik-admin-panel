import { getBusinessDateValue } from '@/lib/business-date';
import { EMPLOYEE_ATTENDANCE_STATUS_LABELS, normalizeEmployeeAttendanceStatus, normalizeEmployeeAttendanceTime } from '@/lib/employee-attendance';
import { getDocumentById, listDocumentsByFilter } from '@/lib/repositories/document-store';

import {
    assertIsoDate,
    normalizeOptionalText,
    normalizeText,
    type ApiSession,
} from './data-helpers';

type NormalizeEmployeeOptions = {
    partial?: boolean;
    excludeId?: string;
};

type EmployeeSnapshot = {
    _id: string;
    employeeCode?: string;
    name?: string;
    position?: string;
    division?: string;
    active?: boolean;
};

function normalizeEmployeeCode(value: unknown) {
    return normalizeText(value).toUpperCase().replace(/\s+/g, '-');
}

function parseTimeToMinutes(value: string) {
    const [hours, minutes] = value.split(':').map(Number);
    return (hours * 60) + minutes;
}

function requiresAttendanceTime(status: ReturnType<typeof normalizeEmployeeAttendanceStatus>) {
    return status === 'HADIR' || status === 'PULANG_LEBIH_AWAL';
}

async function ensureEmployeeCodeUnique(employeeCode: string, excludeId?: string) {
    const duplicate = (await listDocumentsByFilter<Array<{ _id: string; employeeCode?: string }>[number]>('employee', {}))
        .find(item => normalizeText(item.employeeCode) === employeeCode && item._id !== (excludeId || ''))
        || null;
    if (duplicate) {
        throw new Error('Kode karyawan sudah digunakan');
    }
}

async function resolveEmployeeUserLink(userRef: unknown, excludeId?: string) {
    const normalizedUserRef = normalizeOptionalText(userRef);
    if (!normalizedUserRef) {
        return {
            userRef: undefined,
            userName: undefined,
        };
    }

    const user = await getDocumentById<{ _id: string; name?: string; role?: string }>(normalizedUserRef, 'user');
    if (!user) {
        throw new Error('Akun user karyawan tidak ditemukan');
    }
    if (user.role === 'DRIVER') {
        throw new Error('Akun driver tidak bisa dihubungkan ke master karyawan');
    }

    const duplicateLink = (await listDocumentsByFilter<Array<{ _id: string; userRef?: string }>[number]>('employee', {}))
        .find(item => normalizeOptionalText(item.userRef) === normalizedUserRef && item._id !== (excludeId || ''))
        || null;
    if (duplicateLink) {
        throw new Error('Akun user ini sudah terhubung ke karyawan lain');
    }

    return {
        userRef: normalizedUserRef,
        userName: user.name || undefined,
    };
}

async function resolveEmployeeSnapshot(employeeRef: string) {
    const employee = await getDocumentById<EmployeeSnapshot>(employeeRef, 'employee');
    if (!employee) {
        throw new Error('Karyawan tidak ditemukan');
    }
    return employee;
}

async function ensureUniqueAttendanceRecord(employeeRef: string, date: string, excludeId?: string) {
    const duplicate = (await listDocumentsByFilter<Array<{ _id: string; employeeRef?: string; date?: string }>[number]>('employeeAttendanceRecord', {}))
        .find(item =>
            normalizeOptionalText(item.employeeRef) === employeeRef
            && normalizeOptionalText(item.date) === date
            && item._id !== (excludeId || '')
        )
        || null;
    if (duplicate) {
        throw new Error('Absensi karyawan pada tanggal ini sudah tercatat');
    }
}

export async function normalizeEmployeePayload(
    data: Record<string, unknown>,
    options?: NormalizeEmployeeOptions,
) {
    const partial = options?.partial === true;
    const employeeCode = Object.prototype.hasOwnProperty.call(data, 'employeeCode')
        ? normalizeEmployeeCode(data.employeeCode)
        : undefined;
    const name = Object.prototype.hasOwnProperty.call(data, 'name')
        ? normalizeText(data.name)
        : undefined;
    const position = Object.prototype.hasOwnProperty.call(data, 'position')
        ? normalizeText(data.position)
        : undefined;
    const division = Object.prototype.hasOwnProperty.call(data, 'division')
        ? normalizeText(data.division)
        : undefined;
    const joinDate = Object.prototype.hasOwnProperty.call(data, 'joinDate')
        ? normalizeOptionalText(data.joinDate)
        : undefined;
    const phone = Object.prototype.hasOwnProperty.call(data, 'phone')
        ? normalizeOptionalText(data.phone)
        : undefined;
    const notes = Object.prototype.hasOwnProperty.call(data, 'notes')
        ? normalizeOptionalText(data.notes)
        : undefined;
    const active = Object.prototype.hasOwnProperty.call(data, 'active')
        ? data.active
        : undefined;

    if (!partial || Object.prototype.hasOwnProperty.call(data, 'employeeCode')) {
        if (!employeeCode) {
            throw new Error('Kode karyawan wajib diisi');
        }
        await ensureEmployeeCodeUnique(employeeCode, options?.excludeId);
    }
    if (!partial || Object.prototype.hasOwnProperty.call(data, 'name')) {
        if (!name) {
            throw new Error('Nama karyawan wajib diisi');
        }
    }
    if (!partial || Object.prototype.hasOwnProperty.call(data, 'position')) {
        if (!position) {
            throw new Error('Jabatan karyawan wajib diisi');
        }
    }
    if (!partial || Object.prototype.hasOwnProperty.call(data, 'division')) {
        if (!division) {
            throw new Error('Divisi karyawan wajib diisi');
        }
    }
    if (joinDate) {
        assertIsoDate(joinDate, 'Tanggal masuk karyawan');
    }
    if (active !== undefined && typeof active !== 'boolean') {
        throw new Error('Status aktif karyawan tidak valid');
    }

    const resolvesUserLink = !partial || Object.prototype.hasOwnProperty.call(data, 'userRef');
    const userLink = resolvesUserLink
        ? await resolveEmployeeUserLink(data.userRef, options?.excludeId)
        : null;

    return {
        ...(employeeCode !== undefined ? { employeeCode } : {}),
        ...(name !== undefined ? { name } : {}),
        ...(phone !== undefined ? { phone } : {}),
        ...(position !== undefined ? { position } : {}),
        ...(division !== undefined ? { division } : {}),
        ...(joinDate !== undefined ? { joinDate } : partial ? {} : { joinDate: getBusinessDateValue() }),
        ...(notes !== undefined ? { notes } : {}),
        ...(active !== undefined ? { active } : partial ? {} : { active: true }),
        ...(userLink ? { userRef: userLink.userRef, userName: userLink.userName } : {}),
    };
}

export async function normalizeEmployeeAttendanceCreatePayload(
    session: ApiSession,
    data: Record<string, unknown>,
) {
    const employeeRef = normalizeOptionalText(data.employeeRef);
    const date = normalizeOptionalText(data.date);
    const status = normalizeEmployeeAttendanceStatus(data.status);
    const checkInTime = normalizeEmployeeAttendanceTime(data.checkInTime);
    const checkOutTime = normalizeEmployeeAttendanceTime(data.checkOutTime);
    const note = normalizeOptionalText(data.note);

    if (!employeeRef) {
        throw new Error('Karyawan absensi wajib dipilih');
    }
    if (!date) {
        throw new Error('Tanggal absensi wajib diisi');
    }
    assertIsoDate(date, 'Tanggal absensi');
    if (!status) {
        throw new Error('Status absensi tidak valid');
    }
    if (checkInTime === null) {
        throw new Error('Jam masuk tidak valid');
    }
    if (checkOutTime === null) {
        throw new Error('Jam pulang tidak valid');
    }

    const employee = await resolveEmployeeSnapshot(employeeRef);
    if (employee.active === false) {
        throw new Error('Karyawan nonaktif tidak bisa dicatat absensinya');
    }

    if (requiresAttendanceTime(status) && !checkInTime) {
        throw new Error('Jam masuk wajib diisi untuk status hadir atau pulang lebih awal');
    }
    if (status === 'PULANG_LEBIH_AWAL' && !checkOutTime) {
        throw new Error('Jam pulang wajib diisi untuk status pulang lebih awal');
    }
    if (requiresAttendanceTime(status) && checkInTime && checkOutTime && parseTimeToMinutes(checkOutTime) < parseTimeToMinutes(checkInTime)) {
        throw new Error('Jam pulang tidak boleh lebih awal dari jam masuk');
    }

    await ensureUniqueAttendanceRecord(employeeRef, date);

    return {
        employeeRef,
        employeeCode: employee.employeeCode || '',
        employeeName: employee.name || '',
        position: employee.position || '',
        division: employee.division || '',
        date,
        status,
        checkInTime: requiresAttendanceTime(status) ? checkInTime : undefined,
        checkOutTime: requiresAttendanceTime(status) ? checkOutTime : undefined,
        note,
        createdBy: session._id,
        createdByName: session.name,
        updatedBy: session._id,
        updatedByName: session.name,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    };
}

export async function normalizeEmployeeAttendanceUpdates(
    session: ApiSession,
    updates: Record<string, unknown>,
    existingRecordId: string,
    existingRecord?: Record<string, unknown>,
) {
    const resolvedExisting = existingRecord || await getDocumentById<Record<string, unknown>>(existingRecordId, 'employeeAttendanceRecord');
    if (!resolvedExisting) {
        throw new Error('Data absensi tidak ditemukan');
    }
    const existingEmployeeRef = normalizeOptionalText(resolvedExisting.employeeRef);

    const employeeRef = normalizeOptionalText(
        Object.prototype.hasOwnProperty.call(updates, 'employeeRef')
            ? updates.employeeRef
            : resolvedExisting.employeeRef,
    );
    const date = normalizeOptionalText(
        Object.prototype.hasOwnProperty.call(updates, 'date')
            ? updates.date
            : resolvedExisting.date,
    );
    const status = normalizeEmployeeAttendanceStatus(
        Object.prototype.hasOwnProperty.call(updates, 'status')
            ? updates.status
            : resolvedExisting.status,
    );
    const checkInTime = normalizeEmployeeAttendanceTime(
        Object.prototype.hasOwnProperty.call(updates, 'checkInTime')
            ? updates.checkInTime
            : resolvedExisting.checkInTime,
    );
    const checkOutTime = normalizeEmployeeAttendanceTime(
        Object.prototype.hasOwnProperty.call(updates, 'checkOutTime')
            ? updates.checkOutTime
            : resolvedExisting.checkOutTime,
    );
    const note = Object.prototype.hasOwnProperty.call(updates, 'note')
        ? normalizeOptionalText(updates.note)
        : normalizeOptionalText(resolvedExisting.note);

    if (!employeeRef) {
        throw new Error('Karyawan absensi wajib dipilih');
    }
    if (!date) {
        throw new Error('Tanggal absensi wajib diisi');
    }
    assertIsoDate(date, 'Tanggal absensi');
    if (!status) {
        throw new Error('Status absensi tidak valid');
    }
    if (checkInTime === null) {
        throw new Error('Jam masuk tidak valid');
    }
    if (checkOutTime === null) {
        throw new Error('Jam pulang tidak valid');
    }

    const employee = await resolveEmployeeSnapshot(employeeRef);
    if (employee.active === false && employeeRef !== existingEmployeeRef) {
        throw new Error('Karyawan nonaktif tidak bisa dicatat absensinya');
    }
    if (requiresAttendanceTime(status) && !checkInTime) {
        throw new Error('Jam masuk wajib diisi untuk status hadir atau pulang lebih awal');
    }
    if (status === 'PULANG_LEBIH_AWAL' && !checkOutTime) {
        throw new Error('Jam pulang wajib diisi untuk status pulang lebih awal');
    }
    if (requiresAttendanceTime(status) && checkInTime && checkOutTime && parseTimeToMinutes(checkOutTime) < parseTimeToMinutes(checkInTime)) {
        throw new Error('Jam pulang tidak boleh lebih awal dari jam masuk');
    }

    await ensureUniqueAttendanceRecord(employeeRef, date, existingRecordId);

    return {
        employeeRef,
        employeeCode: employee.employeeCode || '',
        employeeName: employee.name || '',
        position: employee.position || '',
        division: employee.division || '',
        date,
        status,
        checkInTime: requiresAttendanceTime(status) ? checkInTime : undefined,
        checkOutTime: requiresAttendanceTime(status) ? checkOutTime : undefined,
        note,
        updatedBy: session._id,
        updatedByName: session.name,
        updatedAt: new Date().toISOString(),
    };
}

export function buildEmployeeSummary(doc: Record<string, unknown>, fallbackId: string) {
    const employeeCode = normalizeOptionalText(doc.employeeCode);
    const name = normalizeOptionalText(doc.name);
    if (employeeCode && name) {
        return `${employeeCode} - ${name}`;
    }
    return employeeCode || name || fallbackId;
}

export function buildEmployeeAttendanceSummary(doc: Record<string, unknown>, fallbackId: string) {
    const employeeName = normalizeOptionalText(doc.employeeName) || normalizeOptionalText(doc.name);
    const employeeCode = normalizeOptionalText(doc.employeeCode);
    const date = normalizeOptionalText(doc.date);
    const status = normalizeEmployeeAttendanceStatus(doc.status);
    const statusLabel = status ? EMPLOYEE_ATTENDANCE_STATUS_LABELS[status] : undefined;
    const header = [employeeCode, employeeName].filter(Boolean).join(' - ') || fallbackId;
    const detail = [date, statusLabel].filter(Boolean).join(' / ');
    return detail ? `${header} (${detail})` : header;
}
