'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { FileDown, Pencil, Plus, Save, ScrollText, Search, X } from 'lucide-react';

import AppPagination from '@/components/AppPagination';
import { fetchAllAdminCollectionData } from '@/lib/api/admin-client';
import { formatBusinessDate, getBusinessDateValue } from '@/lib/business-date';
import {
    EMPLOYEE_ATTENDANCE_PERIOD_LABELS,
    EMPLOYEE_ATTENDANCE_STATUS_LABELS,
    EMPLOYEE_ATTENDANCE_STATUS_OPTIONS,
    type EmployeeAttendancePeriod,
    type EmployeeAttendanceStatus,
} from '@/lib/employee-attendance';
import { exportEmployeeAttendanceReport } from '@/lib/export';
import { DEFAULT_PAGE_SIZE } from '@/lib/pagination';
import { hasPermission } from '@/lib/rbac';
import type { Employee, EmployeeAttendanceRecord } from '@/lib/types';
import { formatDateTime } from '@/lib/utils';

import { useApp, useToast } from '../layout';

type AttendanceSummary = {
    period: EmployeeAttendancePeriod;
    periodLabel: string;
    startDate: string;
    endDate: string;
    activeEmployeeCount: number;
    recordedEmployeeCount: number;
    unrecordedEmployeeCount: number;
    totalRecords: number;
    presentCount: number;
    permissionCount: number;
    sickCount: number;
    leaveCount: number;
    absentCount: number;
    offCount: number;
    pendingEmployees: Array<Pick<Employee, '_id' | 'employeeCode' | 'name' | 'division' | 'position'>>;
};

type AttendanceFormState = {
    employeeRef: string;
    date: string;
    status: EmployeeAttendanceStatus;
    checkInTime: string;
    checkOutTime: string;
    note: string;
};

const PERIOD_OPTIONS: Array<{ value: EmployeeAttendancePeriod; label: string }> = [
    { value: 'today', label: EMPLOYEE_ATTENDANCE_PERIOD_LABELS.today },
    { value: 'thisWeek', label: EMPLOYEE_ATTENDANCE_PERIOD_LABELS.thisWeek },
    { value: 'thisMonth', label: EMPLOYEE_ATTENDANCE_PERIOD_LABELS.thisMonth },
    { value: 'thisYear', label: EMPLOYEE_ATTENDANCE_PERIOD_LABELS.thisYear },
];

const createDefaultAttendanceForm = (date: string, record?: Partial<EmployeeAttendanceRecord>): AttendanceFormState => ({
    employeeRef: record?.employeeRef || '',
    date: record?.date || date,
    status: record?.status || 'HADIR',
    checkInTime: record?.checkInTime || '',
    checkOutTime: record?.checkOutTime || '',
    note: record?.note || '',
});

const STATUS_BADGE_CLASS: Record<EmployeeAttendanceStatus, string> = {
    HADIR: 'badge-success',
    IZIN: 'badge-info',
    SAKIT: 'badge-warning',
    CUTI: 'badge-purple',
    ALPHA: 'badge-danger',
    LIBUR: 'badge-gray',
};

function formatAttendanceDateLabel(dateValue?: string) {
    if (!dateValue) return '-';
    return formatBusinessDate(dateValue, 'id-ID', {
        day: '2-digit',
        month: 'long',
        year: 'numeric',
    });
}

export default function AttendancePage() {
    const { user } = useApp();
    const { addToast } = useToast();
    const [records, setRecords] = useState<EmployeeAttendanceRecord[]>([]);
    const [employees, setEmployees] = useState<Employee[]>([]);
    const [summary, setSummary] = useState<AttendanceSummary | null>(null);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [period, setPeriod] = useState<EmployeeAttendancePeriod>('today');
    const [selectedDate, setSelectedDate] = useState(getBusinessDateValue());
    const [statusFilter, setStatusFilter] = useState('');
    const [employeeFilter, setEmployeeFilter] = useState('');
    const [page, setPage] = useState(1);
    const [totalRecords, setTotalRecords] = useState(0);
    const [showModal, setShowModal] = useState(false);
    const [editRecord, setEditRecord] = useState<EmployeeAttendanceRecord | null>(null);
    const [saving, setSaving] = useState(false);
    const [form, setForm] = useState<AttendanceFormState>(createDefaultAttendanceForm(getBusinessDateValue()));
    const businessToday = getBusinessDateValue();

    const canManageAttendance = user ? hasPermission(user.role, 'attendance', 'create') || hasPermission(user.role, 'attendance', 'update') : false;
    const canExportAttendance = user ? hasPermission(user.role, 'attendance', 'export') : false;
    const activeEmployees = useMemo(() => employees.filter(employee => employee.active !== false), [employees]);
    const employeeOptions = useMemo(() => {
        const optionMap = new Map<string, Employee>();
        for (const employee of activeEmployees) {
            optionMap.set(employee._id, employee);
        }

        const selectedEmployeeId = form.employeeRef || editRecord?.employeeRef;
        if (selectedEmployeeId) {
            const selectedEmployee = employees.find(employee => employee._id === selectedEmployeeId);
            if (selectedEmployee) {
                optionMap.set(selectedEmployee._id, selectedEmployee);
            }
        }

        return Array.from(optionMap.values());
    }, [activeEmployees, editRecord?.employeeRef, employees, form.employeeRef]);
    const selectedEmployeeOption = useMemo(
        () => employeeOptions.find(employee => employee._id === employeeFilter) || null,
        [employeeFilter, employeeOptions],
    );
    const hasCustomFilters = Boolean(
        search.trim()
        || statusFilter
        || employeeFilter
        || period !== 'today'
        || selectedDate !== businessToday,
    );
    const attendancePeriodLabel = summary?.periodLabel || PERIOD_OPTIONS.find(option => option.value === period)?.label || EMPLOYEE_ATTENDANCE_PERIOD_LABELS.today;
    const attendanceRangeLabel = useMemo(() => {
        if (summary?.startDate && summary?.endDate) {
            if (summary.startDate === summary.endDate) {
                return formatAttendanceDateLabel(summary.startDate);
            }
            return `${formatAttendanceDateLabel(summary.startDate)} s/d ${formatAttendanceDateLabel(summary.endDate)}`;
        }

        return formatAttendanceDateLabel(selectedDate);
    }, [selectedDate, summary?.endDate, summary?.startDate]);
    const activeFilterSummary = useMemo(() => {
        const filters: string[] = [];
        if (statusFilter) {
            filters.push(`Status: ${EMPLOYEE_ATTENDANCE_STATUS_LABELS[statusFilter as EmployeeAttendanceStatus]}`);
        }
        if (selectedEmployeeOption) {
            filters.push(`Karyawan: ${selectedEmployeeOption.employeeCode} - ${selectedEmployeeOption.name}`);
        }
        if (search.trim()) {
            filters.push(`Cari: "${search.trim()}"`);
        }
        if (period !== 'today' || selectedDate !== businessToday) {
            filters.push(`Acuan: ${formatAttendanceDateLabel(selectedDate)}`);
        }
        return filters.length > 0 ? filters.join(' | ') : 'Semua status dan semua karyawan';
    }, [businessToday, period, search, selectedDate, selectedEmployeeOption, statusFilter]);

    const buildAttendanceQuery = useCallback((targetPage = page, targetPageSize = DEFAULT_PAGE_SIZE) => {
        const params = new URLSearchParams({
            entity: 'employee-attendance-records',
            page: String(targetPage),
            pageSize: String(targetPageSize),
            sortField: 'date',
            sortDir: 'desc',
            period,
            date: selectedDate,
        });
        if (search.trim()) {
            params.set('q', search.trim());
            params.set('searchFields', 'employeeCode,employeeName,division,position,note,date');
        }
        if (statusFilter) {
            params.set('status', statusFilter);
        }
        if (employeeFilter) {
            params.set('employeeRef', employeeFilter);
        }
        return params.toString();
    }, [employeeFilter, page, period, search, selectedDate, statusFilter]);

    const loadAttendance = useCallback(async () => {
        setLoading(true);
        try {
            const employeesPromise = fetchAllAdminCollectionData<Employee>(
                '/api/data?entity=employees&pageSize=200',
                'Gagal memuat data karyawan',
                200,
            ).catch(() => []);
            const [listRes, summaryRes, employeeRows] = await Promise.all([
                fetch(`/api/data?${buildAttendanceQuery()}`),
                fetch(`/api/data?entity=employee-attendance-summary&period=${encodeURIComponent(period)}&date=${encodeURIComponent(selectedDate)}${search.trim() ? `&q=${encodeURIComponent(search.trim())}&searchFields=${encodeURIComponent('employeeCode,employeeName,division,position,note,date')}` : ''}${statusFilter ? `&status=${encodeURIComponent(statusFilter)}` : ''}${employeeFilter ? `&employeeRef=${encodeURIComponent(employeeFilter)}` : ''}`),
                employeesPromise,
            ]);
            const [listPayload, summaryPayload] = await Promise.all([listRes.json(), summaryRes.json()]);
            if (!listRes.ok) {
                throw new Error(listPayload.error || 'Gagal memuat data absensi');
            }
            if (!summaryRes.ok) {
                throw new Error(summaryPayload.error || 'Gagal memuat ringkasan absensi');
            }

            setRecords((listPayload.data || []) as EmployeeAttendanceRecord[]);
            setTotalRecords(listPayload.meta?.total || 0);
            setSummary(summaryPayload.data as AttendanceSummary);
            setEmployees(employeeRows || []);
        } catch (error) {
            addToast('error', error instanceof Error ? error.message : 'Gagal memuat data absensi');
        } finally {
            setLoading(false);
        }
    }, [addToast, buildAttendanceQuery, employeeFilter, period, search, selectedDate, statusFilter]);

    useEffect(() => {
        void loadAttendance();
    }, [loadAttendance]);

    useEffect(() => {
        setPage(1);
    }, [search, period, selectedDate, statusFilter, employeeFilter]);

    const resetFilters = () => {
        setSearch('');
        setPeriod('today');
        setSelectedDate(businessToday);
        setStatusFilter('');
        setEmployeeFilter('');
    };

    const closeModal = () => {
        if (saving) return;
        setShowModal(false);
        setEditRecord(null);
        setForm(createDefaultAttendanceForm(selectedDate));
    };

    const openCreateModal = (employee?: Pick<Employee, '_id'>) => {
        setEditRecord(null);
        setForm(createDefaultAttendanceForm(selectedDate, employee ? { employeeRef: employee._id } : undefined));
        setShowModal(true);
    };

    const openEditModal = (record: EmployeeAttendanceRecord) => {
        setEditRecord(record);
        setForm(createDefaultAttendanceForm(selectedDate, record));
        setShowModal(true);
    };

    const handleSave = async () => {
        if (!canManageAttendance) {
            addToast('error', 'Anda tidak punya hak mengubah absensi');
            return;
        }
        if (!form.employeeRef || !form.date || !form.status) {
            addToast('error', 'Karyawan, tanggal, dan status wajib diisi');
            return;
        }
        if (form.status === 'HADIR' && !form.checkInTime) {
            addToast('error', 'Jam masuk wajib diisi untuk status hadir');
            return;
        }

        setSaving(true);
        try {
            const payload = {
                employeeRef: form.employeeRef,
                date: form.date,
                status: form.status,
                checkInTime: form.status === 'HADIR' ? form.checkInTime : '',
                checkOutTime: form.status === 'HADIR' ? form.checkOutTime : '',
                note: form.note,
            };

            const duplicateRecord = !editRecord
                ? records.find(record => record.employeeRef === form.employeeRef && record.date === form.date)
                : null;
            const targetRecord = editRecord || duplicateRecord || null;

            const res = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(
                    targetRecord
                        ? {
                            entity: 'employee-attendance-records',
                            action: 'update',
                            data: {
                                id: targetRecord._id,
                                updates: payload,
                            },
                        }
                        : {
                            entity: 'employee-attendance-records',
                            data: payload,
                        }
                ),
            });
            const response = await res.json();
            if (!res.ok) {
                throw new Error(response.error || 'Gagal menyimpan absensi');
            }

            addToast('success', targetRecord ? 'Absensi diperbarui' : 'Absensi dicatat');
            closeModal();
            await loadAttendance();
        } catch (error) {
            addToast('error', error instanceof Error ? error.message : 'Gagal menyimpan absensi');
        } finally {
            setSaving(false);
        }
    };

    const handleExport = useCallback(async () => {
        if (!canExportAttendance) {
            addToast('error', 'Anda tidak punya hak export laporan absensi');
            return;
        }

        try {
            const rows = await fetchAllAdminCollectionData<EmployeeAttendanceRecord>(
                `/api/data?${buildAttendanceQuery(1, 500)}`,
                'Gagal memuat data absensi untuk export',
                500,
            );
            await exportEmployeeAttendanceReport({
                records: rows,
                summary: {
                    periodLabel: attendancePeriodLabel,
                    startDate: summary?.startDate || selectedDate,
                    endDate: summary?.endDate || selectedDate,
                    activeEmployeeCount: summary?.activeEmployeeCount || activeEmployees.length,
                    recordedEmployeeCount: summary?.recordedEmployeeCount || 0,
                    unrecordedEmployeeCount: summary?.unrecordedEmployeeCount || 0,
                    totalRecords: summary?.totalRecords || rows.length,
                    presentCount: summary?.presentCount || 0,
                    permissionCount: summary?.permissionCount || 0,
                    sickCount: summary?.sickCount || 0,
                    leaveCount: summary?.leaveCount || 0,
                    absentCount: summary?.absentCount || 0,
                    offCount: summary?.offCount || 0,
                    pendingEmployees: summary?.pendingEmployees || [],
                },
                filters: {
                    search: search.trim(),
                    statusLabel: statusFilter
                        ? EMPLOYEE_ATTENDANCE_STATUS_LABELS[statusFilter as EmployeeAttendanceStatus]
                        : 'Semua Status',
                    employeeLabel: selectedEmployeeOption
                        ? `${selectedEmployeeOption.employeeCode} - ${selectedEmployeeOption.name}`
                        : 'Semua Karyawan',
                    anchorDate: selectedDate,
                },
                filename: `absensi-${period}-${selectedDate}`,
            });
            addToast('success', 'Excel absensi berhasil di-download');
        } catch (error) {
            addToast('error', error instanceof Error ? error.message : 'Gagal menyiapkan export absensi');
        }
    }, [
        activeEmployees.length,
        addToast,
        attendancePeriodLabel,
        buildAttendanceQuery,
        canExportAttendance,
        period,
        search,
        selectedDate,
        selectedEmployeeOption,
        statusFilter,
        summary,
    ]);

    const pendingEmployees = summary?.pendingEmployees || [];

    return (
        <div>
            <div className="page-header">
                <div className="page-header-left">
                    <h1 className="page-title">Absensi</h1>
                </div>
                <div className="page-actions">
                    {canExportAttendance && (
                        <button className="btn btn-secondary btn-sm" onClick={handleExport}>
                            <FileDown size={15} /> Excel
                        </button>
                    )}
                    {canManageAttendance && (
                        <button className="btn btn-primary" onClick={() => openCreateModal()}>
                            <Plus size={18} /> Catat Absensi
                        </button>
                    )}
                </div>
            </div>

            <div className="kpi-grid attendance-kpi-grid" style={{ marginBottom: '1.5rem' }}>
                <div className="kpi-card"><div className="kpi-content"><div className="kpi-label">Karyawan Aktif</div><div className="kpi-value">{summary?.activeEmployeeCount || activeEmployees.length}</div></div></div>
                <div className="kpi-card"><div className="kpi-content"><div className="kpi-label">Tercatat</div><div className="kpi-value">{summary?.recordedEmployeeCount || 0}</div></div></div>
                <div className="kpi-card"><div className="kpi-content"><div className="kpi-label">Hadir</div><div className="kpi-value">{summary?.presentCount || 0}</div></div></div>
                <div className="kpi-card"><div className="kpi-content"><div className="kpi-label">Izin</div><div className="kpi-value">{summary?.permissionCount || 0}</div></div></div>
                <div className="kpi-card"><div className="kpi-content"><div className="kpi-label">Sakit</div><div className="kpi-value">{summary?.sickCount || 0}</div></div></div>
                <div className="kpi-card"><div className="kpi-content"><div className="kpi-label">Cuti</div><div className="kpi-value">{summary?.leaveCount || 0}</div></div></div>
                <div className="kpi-card"><div className="kpi-content"><div className="kpi-label">Alpha</div><div className="kpi-value">{summary?.absentCount || 0}</div></div></div>
            </div>

            <div className="table-container" style={{ marginBottom: '1rem' }}>
                <div className="table-toolbar">
                    <div className="table-toolbar-left attendance-toolbar-filters">
                        <div className="table-search">
                            <Search size={16} className="table-search-icon" />
                            <input
                                placeholder="Cari kode, nama, divisi, jabatan..."
                                value={search}
                                onChange={event => setSearch(event.target.value)}
                            />
                        </div>
                        <select className="filter-select" value={period} onChange={event => setPeriod(event.target.value as EmployeeAttendancePeriod)}>
                            {PERIOD_OPTIONS.map(option => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                        </select>
                        <input
                            type="date"
                            className="form-input attendance-date-input"
                            value={selectedDate}
                            onChange={event => setSelectedDate(event.target.value)}
                        />
                        <select className="filter-select" value={statusFilter} onChange={event => setStatusFilter(event.target.value)}>
                            <option value="">Semua Status</option>
                            {EMPLOYEE_ATTENDANCE_STATUS_OPTIONS.map(status => (
                                <option key={status} value={status}>{EMPLOYEE_ATTENDANCE_STATUS_LABELS[status]}</option>
                            ))}
                        </select>
                        <select className="filter-select" value={employeeFilter} onChange={event => setEmployeeFilter(event.target.value)}>
                            <option value="">Semua Karyawan</option>
                            {employeeOptions.map(employee => (
                                <option key={employee._id} value={employee._id}>
                                    {employee.employeeCode} - {employee.name}
                                </option>
                            ))}
                        </select>
                    </div>
                    {hasCustomFilters && (
                        <div className="table-toolbar-right">
                            <button className="btn btn-secondary btn-sm" onClick={resetFilters}>
                                Reset Filter
                            </button>
                        </div>
                    )}
                </div>
                <div className="attendance-overview-card">
                    <div className="attendance-overview-grid">
                        <div className="attendance-overview-item">
                            <div className="attendance-overview-label">Periode Aktif</div>
                            <div className="attendance-overview-value">{attendancePeriodLabel}</div>
                            <div className="attendance-overview-note">Tanggal acuan: {formatAttendanceDateLabel(selectedDate)}</div>
                        </div>
                        <div className="attendance-overview-item">
                            <div className="attendance-overview-label">Rentang Tanggal</div>
                            <div className="attendance-overview-value">{attendanceRangeLabel}</div>
                            <div className="attendance-overview-note">Rekap mengikuti tanggal bisnis Jakarta.</div>
                        </div>
                        <div className="attendance-overview-item">
                            <div className="attendance-overview-label">Filter Aktif</div>
                            <div className="attendance-overview-value">{hasCustomFilters ? 'Disaring' : 'Semua Data'}</div>
                            <div className="attendance-overview-note">{activeFilterSummary}</div>
                        </div>
                        <div className="attendance-overview-item">
                            <div className="attendance-overview-label">Data Ditampilkan</div>
                            <div className="attendance-overview-value">{totalRecords}</div>
                            <div className="attendance-overview-note">
                                {summary
                                    ? `${summary.recordedEmployeeCount} karyawan tercatat dari ${summary.activeEmployeeCount} aktif.`
                                    : 'Menunggu ringkasan absensi.'}
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {period === 'today' && !search.trim() && !statusFilter && !employeeFilter && pendingEmployees.length > 0 && (
                <div className="card" style={{ marginBottom: '1rem', padding: '1rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
                        <div>
                            <div style={{ fontWeight: 700 }}>Belum Tercatat Hari Ini</div>
                            <div className="text-muted text-sm">
                                {summary?.unrecordedEmployeeCount || pendingEmployees.length} karyawan aktif belum punya absensi pada {formatBusinessDate(selectedDate, 'id-ID', { day: '2-digit', month: 'long', year: 'numeric' })}.
                            </div>
                        </div>
                    </div>
                    <div className="attendance-pending-actions">
                        {pendingEmployees.map(employee => (
                            <button
                                key={employee._id}
                                type="button"
                                className="btn btn-secondary btn-sm"
                                onClick={() => openCreateModal(employee)}
                                disabled={!canManageAttendance}
                            >
                                <Plus size={14} /> {employee.employeeCode} - {employee.name}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            <div className="table-container">
                <div className="table-wrapper table-desktop-only">
                    <table>
                        <thead>
                            <tr>
                                <th>Tanggal</th>
                                <th>Karyawan</th>
                                <th>Divisi / Jabatan</th>
                                <th>Status</th>
                                <th>Jam Masuk</th>
                                <th>Jam Pulang</th>
                                <th>Catatan</th>
                                <th>Input Terakhir</th>
                                <th>Aksi</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? [1, 2, 3].map(index => (
                                <tr key={index}>
                                    {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(cell => (
                                        <td key={cell}><div className="skeleton skeleton-text" /></td>
                                    ))}
                                </tr>
                            )) : totalRecords === 0 ? (
                                <tr>
                                    <td colSpan={9}>
                                        <div className="empty-state">
                                            <ScrollText size={48} className="empty-state-icon" />
                                            <div className="empty-state-title">Belum ada absensi pada periode ini</div>
                                        </div>
                                    </td>
                                </tr>
                            ) : records.map(record => (
                                <tr key={record._id}>
                                    <td className="text-muted">{formatBusinessDate(record.date, 'id-ID', { day: '2-digit', month: 'short', year: 'numeric' })}</td>
                                    <td>
                                        <div className="font-semibold">{record.employeeName || '-'}</div>
                                        <div className="text-muted text-xs">{record.employeeCode || '-'}</div>
                                    </td>
                                    <td>
                                        <div>{record.division || '-'}</div>
                                        <div className="text-muted text-xs">{record.position || '-'}</div>
                                    </td>
                                    <td>
                                        <span className={`badge ${STATUS_BADGE_CLASS[record.status] || 'badge-gray'}`}>
                                            {EMPLOYEE_ATTENDANCE_STATUS_LABELS[record.status]}
                                        </span>
                                    </td>
                                    <td>{record.checkInTime || '-'}</td>
                                    <td>{record.checkOutTime || '-'}</td>
                                    <td className="text-muted" style={{ minWidth: 220 }}>{record.note || '-'}</td>
                                    <td className="text-muted">
                                        <div>{record.updatedAt ? formatDateTime(record.updatedAt) : '-'}</div>
                                        <div className="text-xs">{record.updatedByName || record.createdByName || '-'}</div>
                                    </td>
                                    <td>
                                        {canManageAttendance ? (
                                            <button className="table-action-btn" onClick={() => openEditModal(record)}>
                                                <Pencil size={14} /> Edit
                                            </button>
                                        ) : (
                                            <span className="text-muted">Lihat saja</span>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                {!loading && (
                    <div className="mobile-record-list">
                        {totalRecords === 0 ? (
                            <div className="mobile-record-card">
                                <div className="mobile-record-title">Belum ada absensi pada periode ini</div>
                            </div>
                        ) : records.map(record => (
                            <div key={record._id} className="mobile-record-card">
                                <div className="mobile-record-header">
                                    <div>
                                        <div className="mobile-record-title">{record.employeeName || '-'}</div>
                                        <div className="mobile-record-subtitle">
                                            {record.employeeCode || '-'} | {formatBusinessDate(record.date, 'id-ID', { day: '2-digit', month: 'short', year: 'numeric' })}
                                        </div>
                                    </div>
                                    <span className={`badge ${STATUS_BADGE_CLASS[record.status] || 'badge-gray'}`}>
                                        {EMPLOYEE_ATTENDANCE_STATUS_LABELS[record.status]}
                                    </span>
                                </div>
                                <div className="mobile-record-meta">
                                    <div className="mobile-record-kv">
                                        <span className="mobile-record-label">Divisi / Jabatan</span>
                                        <span className="mobile-record-value">{record.division || '-'} / {record.position || '-'}</span>
                                    </div>
                                    <div className="mobile-record-kv">
                                        <span className="mobile-record-label">Jam</span>
                                        <span className="mobile-record-value">{record.checkInTime || '-'} - {record.checkOutTime || '-'}</span>
                                    </div>
                                    <div className="mobile-record-kv">
                                        <span className="mobile-record-label">Catatan</span>
                                        <span className="mobile-record-value">{record.note || '-'}</span>
                                    </div>
                                </div>
                                {canManageAttendance && (
                                    <div className="mobile-record-actions">
                                        <button className="btn btn-secondary" onClick={() => openEditModal(record)}>
                                            <Pencil size={14} /> Edit
                                        </button>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}

                {totalRecords > 0 && (
                    <AppPagination
                        page={page}
                        pageSize={DEFAULT_PAGE_SIZE}
                        totalItems={totalRecords}
                        onPageChange={setPage}
                        info={({ startIndex, endIndex, totalItems }) => (
                            <>{startIndex}-{endIndex} dari {totalItems} record absensi periode {summary?.periodLabel || PERIOD_OPTIONS.find(option => option.value === period)?.label || ''}</>
                        )}
                    />
                )}
            </div>

            {showModal && (
                <div className="modal-overlay" onClick={closeModal}>
                    <div className="modal" onClick={event => event.stopPropagation()}>
                        <div className="modal-header">
                            <h3 className="modal-title">{editRecord ? 'Edit Absensi' : 'Catat Absensi'}</h3>
                            <button className="modal-close" onClick={closeModal} disabled={saving}>
                                <X size={20} />
                            </button>
                        </div>
                        <div className="modal-body">
                            <div className="form-grid">
                                <div className="form-group">
                                    <label className="form-label">Karyawan <span className="required">*</span></label>
                                    <select
                                        className="form-select"
                                        value={form.employeeRef}
                                        onChange={event => setForm(current => ({ ...current, employeeRef: event.target.value }))}
                                    >
                                        <option value="">Pilih karyawan</option>
                                        {employeeOptions.map(employee => (
                                            <option key={employee._id} value={employee._id}>
                                                {employee.employeeCode} - {employee.name}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Tanggal <span className="required">*</span></label>
                                    <input
                                        type="date"
                                        className="form-input"
                                        value={form.date}
                                        onChange={event => setForm(current => ({ ...current, date: event.target.value }))}
                                    />
                                </div>
                            </div>
                            <div className="form-grid">
                                <div className="form-group">
                                    <label className="form-label">Status <span className="required">*</span></label>
                                    <select
                                        className="form-select"
                                        value={form.status}
                                        onChange={event => setForm(current => ({ ...current, status: event.target.value as EmployeeAttendanceStatus }))}
                                    >
                                        {EMPLOYEE_ATTENDANCE_STATUS_OPTIONS.map(status => (
                                            <option key={status} value={status}>
                                                {EMPLOYEE_ATTENDANCE_STATUS_LABELS[status]}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            </div>
                            {form.status === 'HADIR' && (
                                <div className="form-grid">
                                    <div className="form-group">
                                        <label className="form-label">Jam Masuk <span className="required">*</span></label>
                                        <input
                                            type="time"
                                            className="form-input"
                                            value={form.checkInTime}
                                            onChange={event => setForm(current => ({ ...current, checkInTime: event.target.value }))}
                                        />
                                    </div>
                                    <div className="form-group">
                                        <label className="form-label">Jam Pulang</label>
                                        <input
                                            type="time"
                                            className="form-input"
                                            value={form.checkOutTime}
                                            onChange={event => setForm(current => ({ ...current, checkOutTime: event.target.value }))}
                                        />
                                    </div>
                                </div>
                            )}
                            <div className="form-group">
                                <label className="form-label">Catatan</label>
                                <textarea
                                    className="form-textarea"
                                    rows={3}
                                    value={form.note}
                                    onChange={event => setForm(current => ({ ...current, note: event.target.value }))}
                                    placeholder={form.status === 'HADIR' ? 'Catatan tambahan bila ada' : 'Contoh: izin keluarga, kontrol dokter, cuti tahunan'}
                                />
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={closeModal} disabled={saving}>Batal</button>
                            <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                                <Save size={16} /> {saving ? 'Menyimpan...' : 'Simpan'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
