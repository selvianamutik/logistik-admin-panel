'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Search, Plus, Receipt } from 'lucide-react';
import AppPagination from '@/components/AppPagination';
import { formatDate, formatCurrency, formatQuantity } from '@/lib/utils';
import { DEFAULT_PAGE_SIZE } from '@/lib/pagination';
import { normalizeUserRole } from '@/lib/rbac';
import { parseFormattedNumberish } from '@/lib/formatted-number';
import type { DriverBorongan } from '@/lib/types';
import { useApp, useToast } from '../layout';

const STATUS_MAP: Record<string, { label: string; color: string }> = {
    UNPAID: { label: 'Belum Dibayar', color: 'danger' },
    PAID: { label: 'Sudah Dibayar', color: 'success' },
};

export default function BoronganListPage() {
    const router = useRouter();
    const { addToast } = useToast();
    const { user } = useApp();
    const [items, setItems] = useState<DriverBorongan[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState('');
    const [page, setPage] = useState(1);
    const [filteredTotalBorongans, setFilteredTotalBorongans] = useState(0);
    const [totalUpah, setTotalUpah] = useState(0);
    const [unpaidCount, setUnpaidCount] = useState(0);
    const [paidCount, setPaidCount] = useState(0);
    const normalizedRole = user ? normalizeUserRole(user.role) : null;

    useEffect(() => {
        if (normalizedRole && normalizedRole !== 'OWNER') {
            router.replace('/driver-vouchers');
        }
    }, [normalizedRole, router]);

    const buildBoronganQuery = useCallback((targetPage = page, targetPageSize = DEFAULT_PAGE_SIZE) => {
        const params = new URLSearchParams({
            entity: 'driver-borongans',
            page: String(targetPage),
            pageSize: String(targetPageSize),
            sortField: 'periodStart',
            sortDir: 'desc',
        });
        if (search.trim()) {
            params.set('q', search.trim());
            params.set('searchFields', 'boronganNumber,driverName');
        }
        if (statusFilter) {
            params.set('filter', JSON.stringify({ status: statusFilter }));
            params.set('status', statusFilter);
        }
        return params.toString();
    }, [page, search, statusFilter]);

    const fetchAllMatchingBorongans = useCallback(async () => {
        const pageSize = 200;
        let currentPage = 1;
        let total = 0;
        const allItems: DriverBorongan[] = [];

        do {
            const res = await fetch(`/api/data?${buildBoronganQuery(currentPage, pageSize)}`);
            const payload = await res.json();
            if (!res.ok) {
                throw new Error(payload.error || 'Gagal memuat slip borongan');
            }

            const nextItems = (payload.data || []) as DriverBorongan[];
            total = payload.meta?.total || nextItems.length;
            allItems.push(...nextItems);
            if (nextItems.length === 0) break;
            currentPage += 1;
        } while (allItems.length < total);

        return allItems;
    }, [buildBoronganQuery]);

    useEffect(() => {
        const loadBorongan = async () => {
            if (normalizedRole && normalizedRole !== 'OWNER') {
                setLoading(false);
                return;
            }
            setLoading(true);
            try {
                const [listRes, matchingBorongans] = await Promise.all([
                    fetch(`/api/data?${buildBoronganQuery()}`),
                    fetchAllMatchingBorongans(),
                ]);
                const listPayload = await listRes.json();
                if (!listRes.ok) {
                    throw new Error(listPayload.error || 'Gagal memuat slip borongan');
                }
                setItems(listPayload.data || []);
                setFilteredTotalBorongans(listPayload.meta?.total || 0);
                setTotalUpah(matchingBorongans.reduce((sum, item) => sum + Math.max(parseFormattedNumberish(item.totalAmount ?? 0, { maxFractionDigits: 0 }), 0), 0));
                setUnpaidCount(matchingBorongans.filter(item => item.status === 'UNPAID').length);
                setPaidCount(matchingBorongans.filter(item => item.status === 'PAID').length);
            } catch (error) {
                addToast('error', error instanceof Error ? error.message : 'Gagal memuat slip borongan');
            } finally {
                setLoading(false);
            }
        };

        void loadBorongan();
    }, [addToast, buildBoronganQuery, fetchAllMatchingBorongans, normalizedRole, search, statusFilter]);

    useEffect(() => {
        setPage(1);
    }, [search, statusFilter]);

    if (normalizedRole && normalizedRole !== 'OWNER') {
        return null;
    }

    return (
        <div>
            <div className="page-header">
                <div className="page-header-left">
                    <h1 className="page-title">Arsip Borongan Supir</h1>
                </div>
                <div className="page-actions">
                    <button type="button" className="btn btn-primary" onClick={() => router.push('/driver-vouchers/new')}>
                        <Plus size={18} /> Buka Uang Jalan Trip
                    </button>
                </div>
            </div>

            <div className="card" style={{ marginBottom: '1rem', border: '1px solid var(--color-warning-light)', background: 'var(--color-warning-light)' }}>
                <div className="card-body" style={{ padding: '1rem' }}>
                    <div style={{ fontWeight: 700, color: 'var(--color-warning)', marginBottom: '0.35rem' }}>Modul arsip</div>
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
                        <div className="kpi-value">{unpaidCount}</div>
                    </div>
                </div>
                <div className="kpi-card">
                    <div className="kpi-icon success"><Receipt size={20} /></div>
                    <div className="kpi-content">
                        <div className="kpi-label">Sudah Dibayar</div>
                        <div className="kpi-value">{paidCount}</div>
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
                            )) : filteredTotalBorongans === 0 ? (
                                <tr>
                                    <td colSpan={8}>
                                        <div className="empty-state">
                                            <Receipt size={48} className="empty-state-icon" />
                                            <div className="empty-state-title">Belum ada slip borongan</div>
                                        </div>
                                    </td>
                                </tr>
                            ) : items.map(borongan => (
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
                                    <td>{formatQuantity(borongan.totalCollie || 0)}</td>
                                    <td>{formatQuantity(borongan.totalWeightKg || 0)} kg</td>
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
                {filteredTotalBorongans > 0 && (
                    <AppPagination
                        page={page}
                        pageSize={DEFAULT_PAGE_SIZE}
                        totalItems={filteredTotalBorongans}
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
