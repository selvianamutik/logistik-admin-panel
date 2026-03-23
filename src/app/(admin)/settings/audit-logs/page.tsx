'use client';

import { useState, useEffect } from 'react';
import { Search, ScrollText } from 'lucide-react';
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

    useEffect(() => {
        const loadAuditLogs = async () => {
            try {
                const res = await fetch('/api/data?entity=audit-logs');
                const payload = await res.json();
                if (!res.ok) {
                    throw new Error(payload.error || 'Gagal memuat audit log');
                }
                setLogs(payload.data || []);
            } catch (error) {
                addToast('error', error instanceof Error ? error.message : 'Gagal memuat audit log');
            } finally {
                setLoading(false);
            }
        };

        void loadAuditLogs();
    }, [addToast]);

    const normalizedSearch = search.trim().toLowerCase();
    const filtered = logs.filter(log => {
        if (!normalizedSearch) return true;
        return [
            log.changesSummary,
            log.actorUserName,
            log.actorUserRef,
            log.entityType,
            log.entityRef,
            log.action,
        ].some(value => value?.toLowerCase().includes(normalizedSearch));
    });
    const today = new Date().toISOString().slice(0, 10);
    const totalLogs = logs.length;
    const todayLogs = logs.filter(log => (log.timestamp || log._createdAt || '').slice(0, 10) === today).length;
    const loginLogs = logs.filter(log => log.action === 'LOGIN' || log.action === 'LOGOUT').length;
    const mutationLogs = logs.filter(log => ['CREATE', 'UPDATE', 'DELETE'].includes(log.action)).length;

    const actionColors: Record<string, string> = { CREATE: 'success', UPDATE: 'warning', DELETE: 'danger', LOGIN: 'info', LOGOUT: 'gray' };

    return (
        <div>
            <div className="page-header"><div className="page-header-left"><h1 className="page-title">Audit Log</h1><p className="page-subtitle">Riwayat aktivitas penting sistem</p></div></div>
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
                                filtered.length === 0 ? <tr><td colSpan={6}><div className="empty-state"><ScrollText size={48} className="empty-state-icon" /><div className="empty-state-title">Belum ada log</div></div></td></tr> :
                                    filtered.map(l => (
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
                        {filtered.length === 0 ? (
                            <div className="mobile-record-card">
                                <div className="mobile-record-title">Belum ada log</div>
                                <div className="mobile-record-subtitle">Aktivitas penting sistem akan muncul di sini untuk kebutuhan audit.</div>
                            </div>
                        ) : filtered.map(l => (
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
                {filtered.length > 0 && <div className="pagination"><div className="pagination-info">{filtered.length} log tercatat</div></div>}
            </div>
        </div>
    );
}
