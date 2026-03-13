'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Eye, Plus, Search, Receipt, Printer } from 'lucide-react';
import { formatDate, formatCurrency } from '@/lib/utils';
import { openBrandedPrint, fetchCompanyProfile } from '@/lib/print';
import type { DriverVoucher } from '@/lib/types';
import { useToast } from '../layout';

const STATUS_MAP: Record<string, { label: string; cls: string }> = {
    DRAFT: { label: 'Draft', cls: 'badge-gray' },
    ISSUED: { label: 'Diberikan', cls: 'badge-blue' },
    SETTLED: { label: 'Selesai', cls: 'badge-green' },
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
                    throw new Error(payload.error || 'Gagal memuat bon supir');
                }
                setItems(payload.data || []);
            } catch (error) {
                addToast('error', error instanceof Error ? error.message : 'Gagal memuat bon supir');
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
        return v.bonNumber?.toLowerCase().includes(s) || v.driverName?.toLowerCase().includes(s) || v.doNumber?.toLowerCase().includes(s);
    }).sort((a, b) => b.issuedDate.localeCompare(a.issuedDate));

    return (
        <div>
            <div className="page-header"><div className="page-header-left"><h1 className="page-title">Bon Supir</h1><p className="page-subtitle">Kelola uang operasional & pertanggungjawaban supir</p></div>
                <div className="page-actions" style={{ flexWrap: 'wrap' }}>
                    <button className="btn btn-secondary btn-sm" onClick={async () => {
                        const co = await fetchCompanyProfile();
                        openBrandedPrint({
                            title: 'Daftar Bon Supir', company: co, bodyHtml: `
                            <table><thead><tr><th>No. Bon</th><th>Supir</th><th>Tanggal</th><th>DO</th><th class="r">Uang</th><th class="r">Terpakai</th><th class="r">Sisa</th><th>Status</th></tr></thead>
                            <tbody>${filtered.map(v => `<tr><td class="b">${v.bonNumber}</td><td>${v.driverName || '-'}</td><td>${formatDate(v.issuedDate)}</td><td>${v.doNumber || '-'}</td><td class="r">${formatCurrency(v.cashGiven)}</td><td class="r">${formatCurrency(v.totalSpent)}</td><td class="r b">${formatCurrency(v.balance)}</td><td>${STATUS_MAP[v.status]?.label || v.status}</td></tr>`).join('')}
                            </tbody></table>`
                        });
                    }}><Printer size={15} /> Print</button>
                    <button className="btn btn-primary" onClick={() => router.push('/driver-vouchers/new')}><Plus size={18} /> Buat Bon Supir</button>
                </div></div>
            <div className="table-container">
                <div className="table-toolbar">
                    <div className="table-toolbar-left">
                        <div className="table-search"><Search size={16} className="table-search-icon" /><input placeholder="Cari no. bon, supir, DO..." value={search} onChange={e => setSearch(e.target.value)} /></div>
                    </div>
                    <div className="table-toolbar-right">
                        <select className="form-select" style={{ width: 150, fontSize: '0.8rem' }} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
                            <option value="">Semua Status</option>
                            <option value="DRAFT">Draft</option>
                            <option value="ISSUED">Diberikan</option>
                            <option value="SETTLED">Selesai</option>
                        </select>
                    </div>
                </div>
                <div className="table-wrapper">
                    <table>
                        <thead><tr><th>No. Bon</th><th>Supir</th><th>Tanggal</th><th>DO</th><th>Rute</th><th>Uang Diberikan</th><th>Terpakai</th><th>Sisa</th><th>Status</th><th>Aksi</th></tr></thead>
                        <tbody>
                            {loading ? [1, 2, 3].map(i => <tr key={i}>{[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(j => <td key={j}><div className="skeleton skeleton-text" /></td>)}</tr>) :
                                filtered.length === 0 ? <tr><td colSpan={10}><div className="empty-state"><Receipt size={48} className="empty-state-icon" /><div className="empty-state-title">Belum ada bon supir</div><div className="empty-state-text">Buat bon supir untuk mencatat uang operasional supir</div></div></td></tr> :
                                    filtered.map(v => {
                                        const st = STATUS_MAP[v.status] || { label: v.status, cls: 'badge-gray' };
                                        return (
                                            <tr key={v._id} className="table-row-link" onClick={() => router.push(`/driver-vouchers/${v._id}`)} style={{ cursor: 'pointer' }}>
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
                                                <td className="font-medium">{formatCurrency(v.cashGiven)}</td>
                                                <td>{formatCurrency(v.totalSpent)}</td>
                                                <td className={v.balance >= 0 ? 'font-medium' : 'font-medium'} style={{ color: v.balance < 0 ? '#ef4444' : v.balance > 0 ? '#16a34a' : undefined }}>{formatCurrency(v.balance)}</td>
                                                <td>
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', alignItems: 'flex-start' }}>
                                                        <span className={`badge ${st.cls}`}>{st.label}</span>
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
                                    })}
                        </tbody>
                    </table>
                </div>
                {filtered.length > 0 && <div className="pagination"><div className="pagination-info">Menampilkan {filtered.length} dari {items.length} bon</div></div>}
            </div>
        </div>
    );
}
