'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Search, Plus, Receipt } from 'lucide-react';
import AppPagination from '@/components/AppPagination';
import { formatDate, formatCurrency } from '@/lib/utils';
import { DEFAULT_PAGE_SIZE, paginateItems } from '@/lib/pagination';
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
    const [page, setPage] = useState(1);

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

    useEffect(() => {
        setPage(1);
    }, [search, statusFilter]);

    const filtered = items.filter(borongan => {
        const query = search.toLowerCase();
        const matchesSearch = !search ||
            borongan.boronganNumber?.toLowerCase().includes(query) ||
            borongan.driverName?.toLowerCase().includes(query);
        const matchesStatus = !statusFilter || borongan.status === statusFilter;
        return matchesSearch && matchesStatus;
    });
    const paginatedBorongans = paginateItems(filtered, page, DEFAULT_PAGE_SIZE);

    const totalUpah = filtered.reduce((sum, borongan) => sum + borongan.totalAmount, 0);

    return (
        <div>
            <div className="page-header">
                <div className="page-header-left">
                    <h1 className="page-title">Borongan Supir Legacy</h1>
                    <p className="page-subtitle">Modul lama. Workflow aktif gaji trip sekarang dipusatkan di Uang Jalan Trip / settlement trip.</p>
                </div>
                <div className="page-actions">
                    <button type="button" className="btn btn-primary" onClick={() => router.push('/driver-vouchers/new')}>
                        <Plus size={18} /> Buka Uang Jalan Trip
                    </button>
                </div>
            </div>

            <div className="card" style={{ marginBottom: '1rem', border: '1px solid var(--color-warning-light)', background: 'var(--color-warning-light)' }}>
                <div className="card-body" style={{ padding: '1rem' }}>
                    <div style={{ fontWeight: 700, color: 'var(--color-warning)', marginBottom: '0.35rem' }}>Modul legacy</div>
                    <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                        Untuk workflow utama client yang sekarang, gunakan <strong>Uang Jalan Trip</strong> karena di sana uang jalan, biaya aktual, upah trip, dan settlement akhir sudah digabung per DO/trip.
                    </div>
                </div>
            </div>

            <div className="kpi-grid" style={{ marginBottom: '1.5rem' }}>
                <div className="kpi-card">
                    <div className="kpi-icon danger"><Receipt size={20} /></div>
                    <div className="kpi-content">
                        <div className="kpi-label">Total Upah (filter)</div>
                        <div className="kpi-value" style={{ fontSize: '1.05rem', color: 'var(--color-danger)' }}>
                            {formatCurrency(totalUpah)}
                        </div>
                    </div>
                </div>
                <div className="kpi-card">
                    <div className="kpi-icon warning"><Receipt size={20} /></div>
                    <div className="kpi-content">
                        <div className="kpi-label">Belum Dibayar</div>
                        <div className="kpi-value">{filtered.filter(borongan => borongan.status === 'UNPAID').length}</div>
                    </div>
                </div>
                <div className="kpi-card">
                    <div className="kpi-icon success"><Receipt size={20} /></div>
                    <div className="kpi-content">
                        <div className="kpi-label">Sudah Dibayar</div>
                        <div className="kpi-value">{filtered.filter(borongan => borongan.status === 'PAID').length}</div>
                    </div>
                </div>
            </div>

            <div className="table-container">
                <div className="table-toolbar">
                    <div className="table-toolbar-left">
                        <div className="table-search">
                            <Search size={16} className="table-search-icon" />
                            <input placeholder="Cari slip, supir..." value={search} onChange={event => setSearch(event.target.value)} />
                        </div>
                        <select className="form-select" style={{ width: 'auto', minWidth: 140 }} value={statusFilter} onChange={event => setStatusFilter(event.target.value)}>
                            <option value="">Semua Status</option>
                            {Object.entries(STATUS_MAP).map(([key, value]) => <option key={key} value={key}>{value.label}</option>)}
                        </select>
                    </div>
                </div>
                <div className="table-wrapper">
                    <table>
                        <thead>
                            <tr>
                                <th>No. Slip</th>
                                <th>Supir</th>
                                <th>Periode</th>
                                <th>Total Collie</th>
                                <th>Total Berat (info)</th>
                                <th>Total Upah</th>
                                <th>Status</th>
                                <th>Aksi</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? [1, 2, 3].map(index => (
                                <tr key={index}>
                                    {[1, 2, 3, 4, 5, 6, 7, 8].map(cell => <td key={cell}><div className="skeleton skeleton-text" /></td>)}
                                </tr>
                            )) : paginatedBorongans.totalItems === 0 ? (
                                <tr>
                                    <td colSpan={8}>
                                        <div className="empty-state">
                                            <Receipt size={48} className="empty-state-icon" />
                                            <div className="empty-state-title">Belum ada slip borongan</div>
                                        </div>
                                    </td>
                                </tr>
                            ) : paginatedBorongans.items.map(borongan => (
                                <tr key={borongan._id}>
                                    <td>
                                        <button
                                            type="button"
                                            className="btn btn-ghost btn-sm"
                                            style={{ padding: 0, color: 'var(--color-primary)', fontWeight: 600 }}
                                            onClick={() => router.push(`/borongan/${borongan._id}`)}
                                        >
                                            {borongan.boronganNumber}
                                        </button>
                                    </td>
                                    <td className="font-semibold">{borongan.driverName}</td>
                                    <td className="text-muted">{formatDate(borongan.periodStart)} - {formatDate(borongan.periodEnd)}</td>
                                    <td>{borongan.totalCollie || 0}</td>
                                    <td>{(borongan.totalWeightKg || 0).toLocaleString('id')} kg</td>
                                    <td className="font-semibold">{formatCurrency(borongan.totalAmount)}</td>
                                    <td>
                                        <span className={`badge badge-${STATUS_MAP[borongan.status]?.color}`}>
                                            <span className="badge-dot" /> {STATUS_MAP[borongan.status]?.label}
                                        </span>
                                    </td>
                                    <td>
                                        <button type="button" className="table-action-btn" onClick={() => router.push(`/borongan/${borongan._id}`)}>
                                            Lihat
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                {paginatedBorongans.totalItems > 0 && (
                    <AppPagination
                        page={paginatedBorongans.currentPage}
                        pageSize={DEFAULT_PAGE_SIZE}
                        totalItems={paginatedBorongans.totalItems}
                        onPageChange={setPage}
                        info={({ startIndex, endIndex, totalItems }) => (
                            <>
                                Menampilkan {startIndex}-{endIndex} dari {totalItems} slip | Total upah: <strong style={{ color: 'var(--color-danger)' }}>{formatCurrency(totalUpah)}</strong>
                            </>
                        )}
                    />
                )}
            </div>
        </div>
    );
}
