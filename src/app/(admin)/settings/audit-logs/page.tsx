'use client';

import { useState, useEffect, useCallback } from 'react';
import { Search, ScrollText } from 'lucide-react';
import AppPagination from '@/components/AppPagination';
import { getBusinessCalendarDateParts, getBusinessDateValue } from '@/lib/business-date';
import { DEFAULT_PAGE_SIZE } from '@/lib/pagination';
import type { AuditLog } from '@/lib/types';
import { useToast } from '../../layout';

function formatAuditDateTime(dateStr: string | undefined) {
    if (!dateStr) return '-';
    try {
        return `${new Intl.DateTimeFormat('id-ID', {
            timeZone: 'Asia/Jakarta',
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false,
        }).format(new Date(dateStr)).replace(/\./g, ':')} WIB`;
    } catch {
        return dateStr;
    }
}

export default function AuditLogsPage() {
    const { addToast } = useToast();
    const [logs, setLogs] = useState<AuditLog[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [page, setPage] = useState(1);
    const [filteredTotalLogs, setFilteredTotalLogs] = useState(0);
    const [totalLogs, setTotalLogs] = useState(0);
    const [todayLogs, setTodayLogs] = useState(0);
    const [loginLogs, setLoginLogs] = useState(0);
    const [mutationLogs, setMutationLogs] = useState(0);

    const buildAuditLogsQuery = useCallback((targetPage = page, targetPageSize = DEFAULT_PAGE_SIZE) => {
        const params = new URLSearchParams({
            entity: 'audit-logs',
            page: String(targetPage),
            pageSize: String(targetPageSize),
            sortField: 'timestamp',
            sortDir: 'desc',
        });
        if (search.trim()) {
            params.set('q', search.trim());
            params.set('searchFields', 'changesSummary,actorUserName,actorUserRef,entityType,entityRef,action');
        }
        return params.toString();
    }, [page, search]);

    const fetchAllMatchingAuditLogs = useCallback(async () => {
        const pageSize = 200;
        let currentPage = 1;
        let total = 0;
        const allItems: AuditLog[] = [];

        do {
            const res = await fetch(`/api/data?${buildAuditLogsQuery(currentPage, pageSize)}`);
            const payload = await res.json();
            if (!res.ok) {
                throw new Error(payload.error || 'Gagal memuat audit log');
            }

            const nextItems = (payload.data || []) as AuditLog[];
            total = payload.meta?.total || nextItems.length;
            allItems.push(...nextItems);
            if (nextItems.length === 0) break;
            currentPage += 1;
        } while (allItems.length < total);

        return allItems;
    }, [buildAuditLogsQuery]);

    useEffect(() => {
        const loadAuditLogs = async () => {
            setLoading(true);
            try {
                const [listRes, matchingLogs] = await Promise.all([
                    fetch(`/api/data?${buildAuditLogsQuery()}`),
                    fetchAllMatchingAuditLogs(),
                ]);
                const listPayload = await listRes.json();
                if (!listRes.ok) {
                    throw new Error(listPayload.error || 'Gagal memuat audit log');
                }

                const today = getBusinessDateValue();
                const nextTodayLogs = matchingLogs.filter(log => {
                    const businessDate = getBusinessCalendarDateParts(log.timestamp || log._createdAt || '');
                    return businessDate ? `${businessDate.year}-${businessDate.month}-${businessDate.day}` === today : false;
                }).length;
                const nextLoginLogs = matchingLogs.filter(log => log.action === 'LOGIN' || log.action === 'LOGOUT').length;
                const nextMutationLogs = matchingLogs.filter(log => log.action === 'CREATE' || log.action === 'UPDATE' || log.action === 'DELETE').length;

                setLogs(listPayload.data || []);
                setFilteredTotalLogs(listPayload.meta?.total || 0);
                setTotalLogs(matchingLogs.length);
                setTodayLogs(nextTodayLogs);
                setLoginLogs(nextLoginLogs);
                setMutationLogs(nextMutationLogs);
            } catch (error) {
                addToast('error', error instanceof Error ? error.message : 'Gagal memuat audit log');
            } finally {
                setLoading(false);
            }
        };

        void loadAuditLogs();
    }, [addToast, buildAuditLogsQuery, fetchAllMatchingAuditLogs]);

    useEffect(() => {
        setPage(1);
    }, [search]);

    const actionColors: Record<string, string> = { CREATE: 'success', UPDATE: 'warning', DELETE: 'danger', LOGIN: 'info', LOGOUT: 'gray' };

    return (
        <div>
            <div className="page-header"><div className="page-header-left"><h1 className="page-title">Audit Log</h1></div></div>
            <div className="kpi-grid" style={{ marginBottom: '1.5rem' }}>
                <div className="kpi-card"><div className="kpi-content"><div className="kpi-label">Total Log</div><div className="kpi-value">{totalLogs}</div></div></div>
                <div className="kpi-card"><div className="kpi-content"><div className="kpi-label">Hari Ini</div><div className="kpi-value">{todayLogs}</div></div></div>
                <div className="kpi-card"><div className="kpi-content"><div className="kpi-label">Login / Logout</div><div className="kpi-value">{loginLogs}</div></div></div>
                <div className="kpi-card"><div className="kpi-content"><div className="kpi-label">Perubahan Data</div><div className="kpi-value">{mutationLogs}</div></div></div>
            </div>
            <div className="table-container">
                <div className="table-toolbar"><div className="table-toolbar-left"><div className="table-search"><Search size={16} className="table-search-icon" /><input placeholder="Cari log..." value={search} onChange={e => setSearch(e.target.value)} /></div></div></div>
                <div className="table-wrapper table-desktop-only">
                    <table>
                        <thead><tr><th>Waktu</th><th>User</th><th>Aksi</th><th>Entitas</th><th>Target</th><th>Ringkasan</th></tr></thead>
                        <tbody>
                            {loading ? [1, 2, 3].map(i => <tr key={i}>{[1, 2, 3, 4, 5, 6].map(j => <td key={j}><div className="skeleton skeleton-text" /></td>)}</tr>) :
                                filteredTotalLogs === 0 ? <tr><td colSpan={6}><div className="empty-state"><ScrollText size={48} className="empty-state-icon" /><div className="empty-state-title">Belum ada log</div></div></td></tr> :
                                    logs.map(l => (
                                        <tr key={l._id}>
                                            <td className="text-muted" style={{ whiteSpace: 'nowrap' }}>{formatAuditDateTime(l.timestamp || l._createdAt)}</td>
                                            <td>
                                                <div className="font-medium">{l.actorUserName || 'User tidak diketahui'}</div>
                                                <div className="text-muted text-xs">{l.actorUserRef || '-'}</div>
                                            </td>
                                            <td><span className={`badge badge-${actionColors[l.action] || 'gray'}`}>{l.action}</span></td>
                                            <td>{l.entityType}</td>
                                            <td className="text-muted" style={{ whiteSpace: 'nowrap' }}>{l.entityRef || '-'}</td>
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
                                <div className="mobile-record-title">Belum ada log</div>
                            </div>
                        ) : logs.map(l => (
                            <div key={l._id} className="mobile-record-card">
                                <div className="mobile-record-header">
                                    <div>
                                        <div className="mobile-record-title">{l.actorUserName || 'User tidak diketahui'}</div>
                                        <div className="mobile-record-subtitle">{formatAuditDateTime(l.timestamp || l._createdAt)}</div>
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
                                        <span className="mobile-record-value">{l.entityRef || '-'}</span>
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
