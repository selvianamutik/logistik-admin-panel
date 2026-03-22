'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Eye, Plus, Search, Receipt, Printer } from 'lucide-react';

import { formatDate, formatCurrency, getDriverVoucherIssuedAmount, getDriverVoucherTopUpAmount } from '@/lib/utils';
import { openBrandedPrint, fetchCompanyProfile } from '@/lib/print';
import type { DriverVoucher } from '@/lib/types';
import { useToast } from '../layout';

const STATUS_MAP: Record<string, { label: string; cls: string }> = {
    DRAFT: { label: 'Draft', cls: 'badge-gray' },
    ISSUED: { label: 'Diberikan', cls: 'badge-blue' },
    SETTLED: { label: 'Selesai', cls: 'badge-green' },
};

const VOUCHER_ACTION_PRIORITY: Record<string, number> = {
    ISSUED: 0,
    DRAFT: 1,
    SETTLED: 2,
};

export default function DriverVouchersPage() {
    const router = useRouter();
    const { addToast } = useToast();
    const [items, setItems] = useState<DriverVoucher[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState('');

    useEffect(() => {
        const loadVouchers = async () => {
            try {
                const res = await fetch('/api/data?entity=driver-vouchers');
                const payload = await res.json();
                if (!res.ok) {
                    throw new Error(payload.error || 'Gagal memuat uang jalan trip');
                }
                setItems(payload.data || []);
            } catch (error) {
                addToast('error', error instanceof Error ? error.message : 'Gagal memuat uang jalan trip');
            } finally {
                setLoading(false);
            }
        };

        void loadVouchers();
    }, [addToast]);

    const filtered = items.filter(v => {
        if (statusFilter && v.status !== statusFilter) return false;
        if (!search) return true;
        const s = search.toLowerCase();
        return (
            v.bonNumber?.toLowerCase().includes(s) ||
            v.driverName?.toLowerCase().includes(s) ||
            v.doNumber?.toLowerCase().includes(s)
        );
    }).sort((a, b) => {
        const priorityDiff = (VOUCHER_ACTION_PRIORITY[a.status] ?? 99) - (VOUCHER_ACTION_PRIORITY[b.status] ?? 99);
        if (priorityDiff !== 0) {
            return priorityDiff;
        }
        return b.issuedDate.localeCompare(a.issuedDate);
    });

    const queueCounts = {
        issued: items.filter(item => item.status === 'ISSUED').length,
        draft: items.filter(item => item.status === 'DRAFT').length,
        settled: items.filter(item => item.status === 'SETTLED').length,
    };

    return (
        <div>
            <div className="page-header">
                <div className="page-header-left">
                    <h1 className="page-title">Uang Jalan Trip</h1>
                    <p className="page-subtitle">Antrian trip yang masih berjalan tampil lebih dulu. Modul ini dipakai untuk uang jalan awal, top up, biaya aktual, upah trip, dan settlement akhir.</p>
                </div>
                <div className="page-actions">
                    <button
                        className="btn btn-secondary btn-sm"
                        onClick={async () => {
                            const company = await fetchCompanyProfile();
                            openBrandedPrint({
                                title: 'Daftar Uang Jalan Trip',
                                company,
                                bodyHtml: `
                                <table>
                                    <thead>
                                        <tr>
                                            <th>No. Bon</th>
                                            <th>Supir</th>
                                            <th>Tanggal</th>
                                            <th>DO</th>
                                            <th class="r">Bon Awal</th>
                                            <th class="r">Tambahan</th>
                                            <th class="r">Total Diberikan</th>
                                            <th class="r">Biaya</th>
                                            <th class="r">Upah Trip</th>
                                            <th class="r">Total Hak Trip</th>
                                            <th class="r">Selisih</th>
                                            <th>Status</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        ${filtered.map(v => {
                                            const totalClaimAmount = v.totalClaimAmount || ((v.totalSpent || 0) + (v.driverFeeAmount || 0));
                                            const initialCashGiven = v.initialCashGiven || v.cashGiven || 0;
                                            return `<tr>
                                                <td class="b">${v.bonNumber}</td>
                                                <td>${v.driverName || '-'}</td>
                                                <td>${formatDate(v.issuedDate)}</td>
                                                <td>${v.doNumber || '-'}</td>
                                                <td class="r">${formatCurrency(initialCashGiven)}</td>
                                                <td class="r">${formatCurrency(getDriverVoucherTopUpAmount(v))}</td>
                                                <td class="r">${formatCurrency(getDriverVoucherIssuedAmount(v))}</td>
                                                <td class="r">${formatCurrency(v.totalSpent)}</td>
                                                <td class="r">${formatCurrency(v.driverFeeAmount || 0)}</td>
                                                <td class="r">${formatCurrency(totalClaimAmount)}</td>
                                                <td class="r b">${formatCurrency(v.balance)}</td>
                                                <td>${STATUS_MAP[v.status]?.label || v.status}</td>
                                            </tr>`;
                                        }).join('')}
                                    </tbody>
                                </table>`,
                            });
                        }}
                    >
                        <Printer size={15} /> Print
                    </button>
                    <button className="btn btn-primary" onClick={() => router.push('/driver-vouchers/new')}>
                        <Plus size={18} /> Terbitkan Uang Jalan
                    </button>
                </div>
            </div>

            <div className="kpi-grid" style={{ marginBottom: '1.5rem' }}>
                <div className="kpi-card">
                    <div className="kpi-icon warning"><Receipt size={20} /></div>
                    <div className="kpi-content">
                        <div className="kpi-label">Belum Settle</div>
                        <div className="kpi-value">{queueCounts.issued}</div>
                    </div>
                </div>
                <div className="kpi-card">
                    <div className="kpi-icon"><Receipt size={20} /></div>
                    <div className="kpi-content">
                        <div className="kpi-label">Draft</div>
                        <div className="kpi-value">{queueCounts.draft}</div>
                    </div>
                </div>
                <div className="kpi-card">
                    <div className="kpi-icon success"><Receipt size={20} /></div>
                    <div className="kpi-content">
                        <div className="kpi-label">Selesai</div>
                        <div className="kpi-value">{queueCounts.settled}</div>
                    </div>
                </div>
            </div>

            <div className="table-container">
                <div className="table-toolbar">
                    <div className="table-toolbar-left">
                        <div className="table-search">
                            <Search size={16} className="table-search-icon" />
                            <input placeholder="Cari no. bon, supir, DO..." value={search} onChange={event => setSearch(event.target.value)} />
                        </div>
                    </div>
                    <div className="table-toolbar-right">
                        <select className="form-select" style={{ width: 150, fontSize: '0.8rem' }} value={statusFilter} onChange={event => setStatusFilter(event.target.value)}>
                            <option value="">Semua Status</option>
                            <option value="DRAFT">Draft</option>
                            <option value="ISSUED">Diberikan</option>
                            <option value="SETTLED">Selesai</option>
                        </select>
                    </div>
                </div>

                <div className="table-wrapper table-desktop-only">
                    <table>
                        <thead>
                            <tr>
                                <th>No. Bon</th>
                                <th>Supir</th>
                                <th>Tanggal</th>
                                <th>DO</th>
                                <th>Rute</th>
                                <th>Bon Awal</th>
                                <th>Tambahan</th>
                                <th>Total Diberikan</th>
                                <th>Biaya</th>
                                <th>Upah Trip</th>
                                <th>Total Hak Trip</th>
                                <th>Selisih</th>
                                <th>Status</th>
                                <th>Aksi</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                [1, 2, 3].map(i => (
                                    <tr key={i}>
                                        {Array.from({ length: 14 }).map((_, j) => (
                                            <td key={j}><div className="skeleton skeleton-text" /></td>
                                        ))}
                                    </tr>
                                ))
                            ) : filtered.length === 0 ? (
                                <tr>
                                    <td colSpan={14}>
                                        <div className="empty-state">
                                            <Receipt size={48} className="empty-state-icon" />
                                            <div className="empty-state-title">Belum ada uang jalan trip</div>
                                            <div className="empty-state-text">Terbitkan uang jalan yang tertaut ke DO untuk mencatat uang jalan awal, top up, biaya perjalanan, upah trip, dan settlement akhir</div>
                                        </div>
                                    </td>
                                </tr>
                            ) : (
                                filtered.map(v => {
                                    const status = STATUS_MAP[v.status] || { label: v.status, cls: 'badge-gray' };
                                    const totalClaimAmount = v.totalClaimAmount || ((v.totalSpent || 0) + (v.driverFeeAmount || 0));
                                    const initialCashGiven = v.initialCashGiven || v.cashGiven || 0;
                                    const topUpAmount = getDriverVoucherTopUpAmount(v);
                                    const totalIssuedAmount = getDriverVoucherIssuedAmount(v);

                                    return (
                                        <tr key={v._id}>
                                            <td>
                                                <button
                                                    type="button"
                                                    className="btn btn-ghost btn-sm"
                                                    style={{ padding: 0, color: 'var(--color-primary)', fontWeight: 600 }}
                                                    onClick={(event) => {
                                                        event.stopPropagation();
                                                        router.push(`/driver-vouchers/${v._id}`);
                                                    }}
                                                >
                                                    {v.bonNumber}
                                                </button>
                                            </td>
                                            <td className="font-medium">{v.driverName || '-'}</td>
                                            <td className="text-muted">{formatDate(v.issuedDate)}</td>
                                            <td>{v.doNumber || '-'}</td>
                                            <td className="text-muted">{v.route || '-'}</td>
                                            <td>{formatCurrency(initialCashGiven)}</td>
                                            <td>{formatCurrency(topUpAmount)}</td>
                                            <td className="font-medium">{formatCurrency(totalIssuedAmount)}</td>
                                            <td>{formatCurrency(v.totalSpent)}</td>
                                            <td>{formatCurrency(v.driverFeeAmount || 0)}</td>
                                            <td className="font-medium">{formatCurrency(totalClaimAmount)}</td>
                                            <td
                                                className="font-medium"
                                                style={{ color: v.balance < 0 ? '#ef4444' : v.balance > 0 ? '#16a34a' : undefined }}
                                            >
                                                {formatCurrency(v.balance)}
                                            </td>
                                            <td>
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', alignItems: 'flex-start' }}>
                                                    <span className={`badge ${status.cls}`}>{status.label}</span>
                                                    {!v.issueBankRef && <span className="badge badge-warning">Perlu Rekonsiliasi</span>}
                                                </div>
                                            </td>
                                            <td>
                                                <button
                                                    type="button"
                                                    className="table-action-btn"
                                                    onClick={(event) => {
                                                        event.stopPropagation();
                                                        router.push(`/driver-vouchers/${v._id}`);
                                                    }}
                                                >
                                                    <Eye size={14} /> Lihat
                                                </button>
                                            </td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>

                {!loading && (
                    <div className="mobile-record-list">
                        {filtered.length === 0 ? (
                            <div className="mobile-record-card">
                                <div className="mobile-record-title">Belum ada uang jalan trip</div>
                                <div className="mobile-record-subtitle">Terbitkan uang jalan yang tertaut ke DO untuk mencatat uang jalan awal, top up, biaya perjalanan, upah trip, dan settlement akhir.</div>
                            </div>
                        ) : filtered.map(v => {
                            const status = STATUS_MAP[v.status] || { label: v.status, cls: 'badge-gray' };
                            const totalClaimAmount = v.totalClaimAmount || ((v.totalSpent || 0) + (v.driverFeeAmount || 0));
                            const initialCashGiven = v.initialCashGiven || v.cashGiven || 0;
                            const topUpAmount = getDriverVoucherTopUpAmount(v);
                            const totalIssuedAmount = getDriverVoucherIssuedAmount(v);

                            return (
                                <div key={v._id} className="mobile-record-card">
                                    <div className="mobile-record-header">
                                        <div>
                                            <div className="mobile-record-title">{v.bonNumber}</div>
                                            <div className="mobile-record-subtitle">{v.driverName || '-'} | {formatDate(v.issuedDate)}</div>
                                        </div>
                                        <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                                            <span className={`badge ${status.cls}`}>{status.label}</span>
                                            {!v.issueBankRef && <span className="badge badge-warning">Perlu Rekonsiliasi</span>}
                                        </div>
                                    </div>
                                    <div className="mobile-record-meta">
                                        <div className="mobile-record-kv">
                                            <span className="mobile-record-label">DO</span>
                                            <span className="mobile-record-value">{v.doNumber || '-'}</span>
                                        </div>
                                        <div className="mobile-record-kv">
                                            <span className="mobile-record-label">Rute</span>
                                            <span className="mobile-record-value">{v.route || '-'}</span>
                                        </div>
                                        <div className="mobile-record-kv">
                                            <span className="mobile-record-label">Bon Awal</span>
                                            <span className="mobile-record-value">{formatCurrency(initialCashGiven)}</span>
                                        </div>
                                        <div className="mobile-record-kv">
                                            <span className="mobile-record-label">Tambahan</span>
                                            <span className="mobile-record-value">{formatCurrency(topUpAmount)}</span>
                                        </div>
                                        <div className="mobile-record-kv">
                                            <span className="mobile-record-label">Total Diberikan</span>
                                            <span className="mobile-record-value">{formatCurrency(totalIssuedAmount)}</span>
                                        </div>
                                        <div className="mobile-record-kv">
                                            <span className="mobile-record-label">Biaya</span>
                                            <span className="mobile-record-value">{formatCurrency(v.totalSpent)}</span>
                                        </div>
                                        <div className="mobile-record-kv">
                                            <span className="mobile-record-label">Upah Trip</span>
                                            <span className="mobile-record-value">{formatCurrency(v.driverFeeAmount || 0)}</span>
                                        </div>
                                        <div className="mobile-record-kv">
                                            <span className="mobile-record-label">Total Hak Trip</span>
                                            <span className="mobile-record-value">{formatCurrency(totalClaimAmount)}</span>
                                        </div>
                                        <div className="mobile-record-kv">
                                            <span className="mobile-record-label">Selisih</span>
                                            <span className="mobile-record-value" style={{ fontWeight: 700, color: v.balance < 0 ? '#ef4444' : v.balance > 0 ? '#16a34a' : undefined }}>
                                                {formatCurrency(v.balance)}
                                            </span>
                                        </div>
                                    </div>
                                    <div className="mobile-record-actions">
                                        <button type="button" className="btn btn-secondary" onClick={() => router.push(`/driver-vouchers/${v._id}`)}>
                                            <Eye size={14} /> Lihat
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}

                {filtered.length > 0 && (
                    <div className="pagination">
                        <div className="pagination-info">Menampilkan {filtered.length} dari {items.length} trip</div>
                    </div>
                )}
            </div>
        </div>
    );
}
