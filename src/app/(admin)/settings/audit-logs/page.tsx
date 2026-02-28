'use client';

import { useState, useEffect } from 'react';
import { Search, ScrollText } from 'lucide-react';
import { formatDateTime } from '@/lib/utils';
import type { AuditLog } from '@/lib/types';

export default function AuditLogsPage() {
    const [logs, setLogs] = useState<AuditLog[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');

    useEffect(() => { fetch('/api/data?entity=audit-logs').then(r => r.json()).then(d => { setLogs((d.data || []).reverse()); setLoading(false); }); }, []);

    const filtered = logs.filter(l => !search || l.changesSummary?.toLowerCase().includes(search.toLowerCase()) || l.actorUserName?.toLowerCase().includes(search.toLowerCase()) || l.entityType?.toLowerCase().includes(search.toLowerCase()));

    const actionColors: Record<string, string> = { CREATE: 'success', UPDATE: 'warning', DELETE: 'danger', LOGIN: 'info', LOGOUT: 'gray' };

    return (
        <div>
            <div className="page-header"><div className="page-header-left"><h1 className="page-title">Audit Log</h1><p className="page-subtitle">Riwayat aktivitas penting sistem</p></div></div>
            <div className="table-container">
                <div className="table-toolbar"><div className="table-toolbar-left"><div className="table-search"><Search size={16} className="table-search-icon" /><input placeholder="Cari log..." value={search} onChange={e => setSearch(e.target.value)} /></div></div></div>
                <div className="table-wrapper">
                    <table>
                        <thead><tr><th>Waktu</th><th>User</th><th>Aksi</th><th>Entitas</th><th>Ringkasan</th></tr></thead>
                        <tbody>
                            {loading ? [1, 2, 3].map(i => <tr key={i}>{[1, 2, 3, 4, 5].map(j => <td key={j}><div className="skeleton skeleton-text" /></td>)}</tr>) :
                                filtered.length === 0 ? <tr><td colSpan={5}><div className="empty-state"><ScrollText size={48} className="empty-state-icon" /><div className="empty-state-title">Belum ada log</div></div></td></tr> :
                                    filtered.map(l => (
                                        <tr key={l._id}>
                                            <td className="text-muted" style={{ whiteSpace: 'nowrap' }}>{formatDateTime(l.timestamp)}</td>
                                            <td className="font-medium">{l.actorUserName}</td>
                                            <td><span className={`badge badge-${actionColors[l.action] || 'gray'}`}>{l.action}</span></td>
                                            <td>{l.entityType}</td>
                                            <td className="text-muted" style={{ maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.changesSummary}</td>
                                        </tr>
                                    ))}
                        </tbody>
                    </table>
                </div>
                {filtered.length > 0 && <div className="pagination"><div className="pagination-info">{filtered.length} log tercatat</div></div>}
            </div>
        </div>
    );
}
