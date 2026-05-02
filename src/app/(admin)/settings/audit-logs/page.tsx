'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Search, ScrollText } from 'lucide-react';
import AppPagination from '@/components/AppPagination';
import { getAuditLogTargetHref } from '@/lib/audit-log-target-links';
import { DEFAULT_PAGE_SIZE } from '@/lib/pagination';
import type { AuditLog, UserRole } from '@/lib/types';
import { formatDateTime } from '@/lib/utils';
import { useToast } from '../../layout';

function formatAuditDateTime(dateStr: string | undefined) {
    return formatDateTime(dateStr);
}

type AuditLogPeriod = 'today' | 'yesterday' | 'last7days' | 'thisMonth' | 'thisYear' | 'all';

const PERIOD_OPTIONS: Array<{ value: AuditLogPeriod; label: string }> = [
    { value: 'today', label: 'Hari Ini' },
    { value: 'yesterday', label: 'Kemarin' },
    { value: 'last7days', label: '7 Hari Terakhir' },
    { value: 'thisMonth', label: 'Bulan Ini' },
    { value: 'thisYear', label: 'Tahun Ini' },
    { value: 'all', label: 'Semua Waktu' },
];

const ROLE_LABELS: Record<UserRole, string> = {
    OWNER: 'Owner',
    OPERASIONAL: 'Operasional',
    FINANCE: 'Finance',
    ARMADA: 'Armada',
    DRIVER: 'Driver',
    ADMIN: 'Admin',
};

function inferActorRole(log: AuditLog): UserRole | undefined {
    const actorRef = typeof log.actorUserRef === 'string'
        ? log.actorUserRef.trim().toLowerCase()
        : typeof log.entityRef === 'string'
            ? log.entityRef.trim().toLowerCase()
            : '';
    const actorEmail = typeof log.actorUserEmail === 'string' ? log.actorUserEmail.trim().toLowerCase() : '';
    const identity = `${actorRef} ${actorEmail}`;

    if (identity.includes('user-owner-') || actorEmail.startsWith('owner@')) return 'OWNER';
    if (identity.includes('user-admin-') || actorEmail.startsWith('admin@')) return 'OPERASIONAL';
    if (identity.includes('user-finance-') || actorEmail.startsWith('finance@')) return 'FINANCE';
    if (identity.includes('user-armada-') || actorEmail.startsWith('armada@')) return 'ARMADA';
    if (identity.includes('user-driver-') || actorEmail.startsWith('driver.')) return 'DRIVER';
    return undefined;
}

function applyAuditLogActorFallback(log: AuditLog): AuditLog {
    if (log.actorUserRole) {
        return log;
    }

    const inferredRole = inferActorRole(log);
    if (!inferredRole) {
        return log;
    }

    return {
        ...log,
        actorUserRole: inferredRole,
    };
}

function getActorRoleLabel(log: AuditLog) {
    const resolvedRole = log.actorUserRole || inferActorRole(log);
    if (resolvedRole && ROLE_LABELS[resolvedRole]) {
        return ROLE_LABELS[resolvedRole];
    }
    return 'Role tidak tercatat';
}

function AuditTargetLink({ log }: { log: AuditLog }) {
    const target = log.entityRef || '-';
    const href = getAuditLogTargetHref(log);

    if (!href || target === '-') {
        return <span>{target}</span>;
    }

    return (
        <Link
            href={href}
            className="font-mono"
            style={{ color: 'var(--color-primary)', fontWeight: 600, wordBreak: 'break-all' }}
        >
            {target}
        </Link>
    );
}

export default function AuditLogsPage() {
    const { addToast } = useToast();
    const [logs, setLogs] = useState<AuditLog[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [period, setPeriod] = useState<AuditLogPeriod>('today');
    const [page, setPage] = useState(1);
    const [filteredTotalLogs, setFilteredTotalLogs] = useState(0);
    const [totalLogs, setTotalLogs] = useState(0);
    const [loginLogs, setLoginLogs] = useState(0);
    const [mutationLogs, setMutationLogs] = useState(0);
    const [actorCount, setActorCount] = useState(0);

    const buildAuditLogsQuery = useCallback((targetPage = page, targetPageSize = DEFAULT_PAGE_SIZE) => {
        const params = new URLSearchParams({
            entity: 'audit-logs',
            page: String(targetPage),
            pageSize: String(targetPageSize),
            sortField: 'timestamp',
            sortDir: 'desc',
            period,
        });
        if (search.trim()) {
            params.set('q', search.trim());
            params.set('searchFields', 'changesSummary,actorUserName,actorUserRole,actorUserEmail,actorUserRef,entityType,entityRef,action');
        }
        return params.toString();
    }, [page, period, search]);

    useEffect(() => {
        const loadAuditLogs = async () => {
            setLoading(true);
            try {
                const [listRes, summaryRes] = await Promise.all([
                    fetch(`/api/data?${buildAuditLogsQuery()}`),
                    fetch(`/api/data?entity=audit-logs-summary&period=${encodeURIComponent(period)}${
                        search.trim()
                            ? `&q=${encodeURIComponent(search.trim())}&searchFields=${encodeURIComponent('changesSummary,actorUserName,actorUserRole,actorUserEmail,actorUserRef,entityType,entityRef,action')}`
                            : ''
                    }`),
                ]);
                const listPayload = await listRes.json();
                const summaryPayload = await summaryRes.json();
                if (!listRes.ok) {
                    throw new Error(listPayload.error || 'Gagal memuat audit log');
                }
                if (!summaryRes.ok) {
                    throw new Error(summaryPayload.error || 'Gagal memuat ringkasan audit log');
                }

                setLogs(((listPayload.data || []) as AuditLog[]).map(applyAuditLogActorFallback));
                setFilteredTotalLogs(listPayload.meta?.total || 0);
                setTotalLogs(summaryPayload.data?.totalLogs || 0);
                setLoginLogs(summaryPayload.data?.loginLogs || 0);
                setMutationLogs(summaryPayload.data?.mutationLogs || 0);
                setActorCount(summaryPayload.data?.actorCount || 0);
            } catch (error) {
                addToast('error', error instanceof Error ? error.message : 'Gagal memuat audit log');
            } finally {
                setLoading(false);
            }
        };

        void loadAuditLogs();
    }, [addToast, buildAuditLogsQuery, period, search]);

    useEffect(() => {
        setPage(1);
    }, [search, period]);

    const actionColors: Record<string, string> = { CREATE: 'success', UPDATE: 'warning', DELETE: 'danger', LOGIN: 'info', LOGOUT: 'gray' };
    const selectedPeriodLabel = PERIOD_OPTIONS.find(option => option.value === period)?.label || 'Hari Ini';

    return (
        <div>
            <div className="page-header"><div className="page-header-left"><h1 className="page-title">Audit Log</h1></div></div>
            <div className="kpi-grid" style={{ marginBottom: '1.5rem' }}>
                <div className="kpi-card"><div className="kpi-content"><div className="kpi-label">Total Aktivitas</div><div className="kpi-value">{totalLogs}</div></div></div>
                <div className="kpi-card"><div className="kpi-content"><div className="kpi-label">Masuk / Keluar</div><div className="kpi-value">{loginLogs}</div></div></div>
                <div className="kpi-card"><div className="kpi-content"><div className="kpi-label">Buat / Ubah / Hapus</div><div className="kpi-value">{mutationLogs}</div></div></div>
                <div className="kpi-card"><div className="kpi-content"><div className="kpi-label">User Terlibat</div><div className="kpi-value">{actorCount}</div></div></div>
            </div>
            <div className="table-container">
                <div className="table-toolbar">
                    <div className="table-toolbar-left" style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
                        <div className="table-search"><Search size={16} className="table-search-icon" /><input placeholder="Cari nama, aksi, entitas, ringkasan..." value={search} onChange={e => setSearch(e.target.value)} /></div>
                        <select
                            className="filter-select"
                            value={period}
                            onChange={e => setPeriod(e.target.value as AuditLogPeriod)}
                            aria-label="Filter periode audit log"
                        >
                            {PERIOD_OPTIONS.map(option => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                        </select>
                    </div>
                </div>
                <div className="text-muted text-sm" style={{ marginBottom: '1rem' }}>
                    Menampilkan log untuk periode <strong>{selectedPeriodLabel}</strong>. Default halaman ini selalu membuka log hari ini agar tidak berat.
                </div>
                <div className="table-wrapper table-desktop-only">
                    <table>
                        <thead><tr><th>Waktu</th><th>User</th><th>Aksi</th><th>Entitas</th><th>Target</th><th>Ringkasan</th></tr></thead>
                        <tbody>
                            {loading ? [1, 2, 3].map(i => <tr key={i}>{[1, 2, 3, 4, 5, 6].map(j => <td key={j}><div className="skeleton skeleton-text" /></td>)}</tr>) :
                                filteredTotalLogs === 0 ? <tr><td colSpan={6}><div className="empty-state"><ScrollText size={48} className="empty-state-icon" /><div className="empty-state-title">Belum ada log pada periode ini</div></div></td></tr> :
                                    logs.map(l => (
                                        <tr key={l._id}>
                                            <td className="text-muted" style={{ whiteSpace: 'nowrap' }}>{formatAuditDateTime(l.timestamp || l._createdAt)}</td>
                                            <td>
                                                <div className="font-medium">{l.actorUserName || 'User tidak diketahui'}</div>
                                                <div className="text-muted text-xs">{getActorRoleLabel(l)}</div>
                                            </td>
                                            <td><span className={`badge badge-${actionColors[l.action] || 'gray'}`}>{l.action}</span></td>
                                            <td>{l.entityType}</td>
                                            <td className="text-muted" style={{ whiteSpace: 'nowrap' }}><AuditTargetLink log={l} /></td>
                                            <td className="text-muted" style={{ minWidth: 320, whiteSpace: 'normal', wordBreak: 'break-word' }}>{l.changesSummary}</td>
                                        </tr>
                                    ))}
                        </tbody>
                    </table>
                </div>
                {!loading && (
                    <div className="mobile-record-list">
                        {filteredTotalLogs === 0 ? (
                            <div className="mobile-record-card">
                                <div className="mobile-record-title">Belum ada log pada periode ini</div>
                            </div>
                        ) : logs.map(l => (
                            <div key={l._id} className="mobile-record-card">
                                <div className="mobile-record-header">
                                    <div>
                                        <div className="mobile-record-title">{l.actorUserName || 'User tidak diketahui'}</div>
                                        <div className="mobile-record-subtitle">{`${getActorRoleLabel(l)} | ${formatAuditDateTime(l.timestamp || l._createdAt)}`}</div>
                                    </div>
                                    <span className={`badge badge-${actionColors[l.action] || 'gray'}`}>{l.action}</span>
                                </div>
                                <div className="mobile-record-meta">
                                    <div className="mobile-record-kv">
                                        <span className="mobile-record-label">Entitas</span>
                                        <span className="mobile-record-value">{l.entityType || '-'}</span>
                                    </div>
                                    <div className="mobile-record-kv">
                                        <span className="mobile-record-label">Target</span>
                                        <span className="mobile-record-value"><AuditTargetLink log={l} /></span>
                                    </div>
                                    <div className="mobile-record-kv">
                                        <span className="mobile-record-label">Ringkasan</span>
                                        <span className="mobile-record-value">{l.changesSummary || '-'}</span>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
                {filteredTotalLogs > 0 && (
                    <AppPagination
                        page={page}
                        pageSize={DEFAULT_PAGE_SIZE}
                        totalItems={filteredTotalLogs}
                        onPageChange={setPage}
                        info={({ startIndex, endIndex, totalItems }) => (
                            <>{startIndex}-{endIndex} dari {totalItems} log tercatat</>
                        )}
                    />
                )}
            </div>
        </div>
    );
}
