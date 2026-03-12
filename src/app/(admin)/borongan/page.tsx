'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Search, Plus, Receipt } from 'lucide-react';
import { formatDate, formatCurrency } from '@/lib/utils';
import type { DriverBorongan } from '@/lib/types';
import { useToast } from '../layout';

const STATUS_MAP: Record<string, { label: string; color: string }> = {
    UNPAID: { label: 'Belum Dibayar', color: 'danger' },
    PAID: { label: 'Sudah Dibayar', color: 'success' },
};

export default function BoronganListPage() {
    const router = useRouter();
    const { addToast } = useToast();
    const [items, setItems] = useState<DriverBorongan[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState('');

    useEffect(() => {
        const loadBorongan = async () => {
            try {
                const res = await fetch('/api/data?entity=driver-borongans');
                const payload = await res.json();
                if (!res.ok) {
                    throw new Error(payload.error || 'Gagal memuat slip borongan');
                }
                setItems(payload.data || []);
            } catch (error) {
                addToast('error', error instanceof Error ? error.message : 'Gagal memuat slip borongan');
            } finally {
                setLoading(false);
            }
        };

        void loadBorongan();
    }, [addToast]);

    const filtered = items.filter(b => {
        const m = !search || b.boronganNumber?.toLowerCase().includes(search.toLowerCase()) || b.driverName?.toLowerCase().includes(search.toLowerCase());
        const s = !statusFilter || b.status === statusFilter;
        return m && s;
    });

    const totalUpah = filtered.reduce((s, b) => s + b.totalAmount, 0);

    return (
        <div>
            <div className="page-header">
                <div className="page-header-left">
                    <h1 className="page-title">Borongan Supir</h1>
                    <p className="page-subtitle">Kelola slip upah borongan supir</p>
                </div>
                <div className="page-actions">
                    <button className="btn btn-primary" onClick={() => router.push('/borongan/new')}><Plus size={18} /> Buat Slip Borongan</button>
                </div>
            </div>

            {/* KPI */}
            <div className="kpi-grid" style={{ marginBottom: '1.5rem' }}>
                <div className="kpi-card">
                    <div className="kpi-icon danger"><Receipt size={20} /></div>
                    <div className="kpi-content">
                        <div className="kpi-label">Total Upah (filter)</div>
                        <div className="kpi-value" style={{ fontSize: '1.05rem', color: 'var(--color-danger)' }}>{formatCurrency(totalUpah)}</div>
                    </div>
                </div>
                <div className="kpi-card">
                    <div className="kpi-icon warning"><Receipt size={20} /></div>
                    <div className="kpi-content">
                        <div className="kpi-label">Belum Dibayar</div>
                        <div className="kpi-value">{filtered.filter(b => b.status === 'UNPAID').length}</div>
                    </div>
                </div>
                <div className="kpi-card">
                    <div className="kpi-icon success"><Receipt size={20} /></div>
                    <div className="kpi-content">
                        <div className="kpi-label">Sudah Dibayar</div>
                        <div className="kpi-value">{filtered.filter(b => b.status === 'PAID').length}</div>
                    </div>
                </div>
            </div>

            <div className="table-container">
                <div className="table-toolbar">
                    <div className="table-toolbar-left">
                        <div className="table-search"><Search size={16} className="table-search-icon" /><input placeholder="Cari slip, supir..." value={search} onChange={e => setSearch(e.target.value)} /></div>
                        <select className="form-select" style={{ width: 'auto', minWidth: 140 }} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
                            <option value="">Semua Status</option>
                            {Object.entries(STATUS_MAP).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                        </select>
                    </div>
                </div>
                <div className="table-wrapper">
                    <table>
                        <thead><tr><th>No. Slip</th><th>Supir</th><th>Periode</th><th>Total Collie</th><th>Total Berat</th><th>Total Upah</th><th>Status</th><th>Aksi</th></tr></thead>
                        <tbody>
                            {loading ? [1, 2, 3].map(i => <tr key={i}>{[1, 2, 3, 4, 5, 6, 7, 8].map(j => <td key={j}><div className="skeleton skeleton-text" /></td>)}</tr>) :
                                filtered.length === 0 ? (
                                    <tr><td colSpan={8}><div className="empty-state"><Receipt size={48} className="empty-state-icon" /><div className="empty-state-title">Belum ada slip borongan</div></div></td></tr>
                                ) : filtered.map(b => (
                                    <tr key={b._id}>
                                        <td><span className="font-semibold" style={{ color: 'var(--color-primary)', cursor: 'pointer' }} onClick={() => router.push(`/borongan/${b._id}`)}>{b.boronganNumber}</span></td>
                                        <td className="font-semibold">{b.driverName}</td>
                                        <td className="text-muted">{formatDate(b.periodStart)} — {formatDate(b.periodEnd)}</td>
                                        <td>{b.totalCollie || 0}</td>
                                        <td>{(b.totalWeightKg || 0).toLocaleString('id')} kg</td>
                                        <td className="font-semibold">{formatCurrency(b.totalAmount)}</td>
                                        <td><span className={`badge badge-${STATUS_MAP[b.status]?.color}`}><span className="badge-dot" /> {STATUS_MAP[b.status]?.label}</span></td>
                                        <td><button className="table-action-btn" onClick={() => router.push(`/borongan/${b._id}`)}>Lihat</button></td>
                                    </tr>
                                ))}
                        </tbody>
                    </table>
                </div>
                {filtered.length > 0 && <div className="pagination"><div className="pagination-info">Menampilkan {filtered.length} slip | Total upah: <strong style={{ color: 'var(--color-danger)' }}>{formatCurrency(totalUpah)}</strong></div></div>}
            </div>
        </div>
    );
}
