'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Search, Plus, FileText, Printer, FileDown } from 'lucide-react';
import { formatDate, formatCurrency } from '@/lib/utils';
import { buildFreightNotaPrintDocument, openBrandedPrint, fetchCompanyProfile } from '@/lib/print';
import { exportFreightNotaDetail, exportInvoices } from '@/lib/export';
import type { FreightNota, FreightNotaItem } from '@/lib/types';

import { useToast } from '../layout';

const STATUS_MAP: Record<string, { label: string; color: string }> = {
    UNPAID: { label: 'Belum Lunas', color: 'danger' },
    PARTIAL: { label: 'Sebagian', color: 'warning' },
    PAID: { label: 'Lunas', color: 'success' },
};

export default function NotaListPage() {
    const router = useRouter();
    const { addToast } = useToast();
    const [items, setItems] = useState<FreightNota[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState('');

    useEffect(() => {
        fetch('/api/data?entity=freight-notas').then(r => r.json()).then(d => {
            setItems(d.data || []);
            setLoading(false);
        });
    }, []);

    const filtered = items.filter(n => {
        const m = !search || n.notaNumber?.toLowerCase().includes(search.toLowerCase()) || n.customerName?.toLowerCase().includes(search.toLowerCase());
        const s = !statusFilter || n.status === statusFilter;
        return m && s;
    });

    const grandTotal = filtered.reduce((s, n) => s + n.totalAmount, 0);

    const fetchNotaItems = async (notaId: string) => {
        const response = await fetch(`/api/data?entity=freight-nota-items&filter=${encodeURIComponent(JSON.stringify({ notaRef: notaId }))}`);
        const payload = await response.json();
        if (!response.ok) {
            throw new Error(payload.error || 'Gagal memuat item nota');
        }
        return (payload.data || []) as FreightNotaItem[];
    };

    const handlePrintNota = async (nota: FreightNota) => {
        try {
            const [company, notaItems] = await Promise.all([
                fetchCompanyProfile(),
                fetchNotaItems(nota._id),
            ]);
            const doc = buildFreightNotaPrintDocument({ nota, items: notaItems, company });
            openBrandedPrint({
                title: doc.title,
                subtitle: doc.subtitle,
                company,
                bodyHtml: doc.bodyHtml,
                extraStyles: doc.extraStyles,
                showCompanyHeader: doc.showCompanyHeader,
                showFooter: doc.showFooter,
            });
        } catch {
            addToast('error', 'Gagal menyiapkan cetak nota');
        }
    };

    const handleExportNota = async (nota: FreightNota) => {
        try {
            const [company, notaItems] = await Promise.all([
                fetchCompanyProfile(),
                fetchNotaItems(nota._id),
            ]);
            await exportFreightNotaDetail(nota, notaItems, company);
            addToast('success', 'Excel nota berhasil di-download');
        } catch {
            addToast('error', 'Gagal menyiapkan Excel nota');
        }
    };

    return (
        <div>
            <div className="page-header">
                <div className="page-header-left">
                    <h1 className="page-title">Nota Ongkos Angkut</h1>
                    <p className="page-subtitle">Tagihan ongkos angkut ke customer. Satu nota dapat memuat beberapa SJ/DO untuk customer yang sama.</p>
                </div>
                <div className="page-actions">
                    <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => exportInvoices(filtered as unknown as Record<string, unknown>[])}
                    >
                        <FileDown size={15} /> Excel
                    </button>
                    <button className="btn btn-secondary btn-sm" onClick={async () => {
                        const co = await fetchCompanyProfile();
                        openBrandedPrint({
                            title: 'Daftar Nota Ongkos Angkut', company: co, bodyHtml: `
                            <table><thead><tr><th>No. Nota</th><th>Customer</th><th>Tanggal</th><th>Total Collie</th><th>Total Berat</th><th class="r">Total Ongkos</th><th>Status</th></tr></thead>
                            <tbody>${filtered.map(n => `<tr><td class="b">${n.notaNumber}</td><td>${n.customerName}</td><td>${formatDate(n.issueDate)}</td><td>${n.totalCollie || 0}</td><td>${n.totalWeightKg || 0} kg</td><td class="r b">${formatCurrency(n.totalAmount)}</td><td>${STATUS_MAP[n.status]?.label || n.status}</td></tr>`).join('')}
                            <tr style="border-top:2px solid #1e293b"><td colspan="5" class="r b">TOTAL</td><td class="r b">${formatCurrency(grandTotal)}</td><td></td></tr></tbody></table>`
                        });
                    }}><Printer size={15} /> Print</button>
                    <button className="btn btn-primary" onClick={() => router.push('/invoices/new')}><Plus size={18} /> Buat Nota</button>
                </div>
            </div>

            {/* KPI */}
            <div className="kpi-grid" style={{ marginBottom: '1.5rem' }}>
                <div className="kpi-card">
                    <div className="kpi-icon danger"><FileText size={20} /></div>
                    <div className="kpi-content">
                        <div className="kpi-label">Total Tagihan</div>
                        <div className="kpi-value" style={{ fontSize: '1.05rem', color: 'var(--color-danger)' }}>{formatCurrency(grandTotal)}</div>
                    </div>
                </div>
                <div className="kpi-card">
                    <div className="kpi-icon warning"><FileText size={20} /></div>
                    <div className="kpi-content">
                        <div className="kpi-label">Belum Lunas</div>
                        <div className="kpi-value">{filtered.filter(n => n.status !== 'PAID').length}</div>
                    </div>
                </div>
                <div className="kpi-card">
                    <div className="kpi-icon success"><FileText size={20} /></div>
                    <div className="kpi-content">
                        <div className="kpi-label">Lunas</div>
                        <div className="kpi-value">{filtered.filter(n => n.status === 'PAID').length}</div>
                    </div>
                </div>
            </div>

            <div className="table-container">
                <div className="table-toolbar">
                    <div className="table-toolbar-left">
                        <div className="table-search"><Search size={16} className="table-search-icon" /><input placeholder="Cari nota, customer..." value={search} onChange={e => setSearch(e.target.value)} /></div>
                        <select className="form-select" style={{ width: 'auto', minWidth: 140 }} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
                            <option value="">Semua Status</option>
                            {Object.entries(STATUS_MAP).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                        </select>
                    </div>
                </div>
                <div className="table-wrapper">
                    <table>
                        <thead><tr><th>No. Nota</th><th>Customer</th><th>Tanggal</th><th>Total Collie</th><th>Total Berat</th><th>Total Ongkos</th><th>Status</th><th>Aksi</th></tr></thead>
                        <tbody>
                            {loading ? [1, 2, 3].map(i => <tr key={i}>{[1, 2, 3, 4, 5, 6, 7, 8].map(j => <td key={j}><div className="skeleton skeleton-text" /></td>)}</tr>) :
                                filtered.length === 0 ? (
                                    <tr><td colSpan={8}><div className="empty-state"><FileText size={48} className="empty-state-icon" /><div className="empty-state-title">Belum ada nota</div><div className="empty-state-text">Klik tombol &quot;Buat Nota&quot; untuk membuat nota baru</div></div></td></tr>
                                ) : filtered.map(n => (
                                    <tr key={n._id}>
                                        <td><span className="font-semibold" style={{ color: 'var(--color-primary)', cursor: 'pointer' }} onClick={() => router.push(`/invoices/${n._id}`)}>{n.notaNumber}</span></td>
                                        <td>{n.customerName}</td>
                                        <td className="text-muted">{formatDate(n.issueDate)}</td>
                                        <td>{n.totalCollie || 0}</td>
                                        <td>{(n.totalWeightKg || 0).toLocaleString('id')} kg</td>
                                        <td className="font-semibold">{formatCurrency(n.totalAmount)}</td>
                                        <td><span className={`badge badge-${STATUS_MAP[n.status]?.color}`}><span className="badge-dot" /> {STATUS_MAP[n.status]?.label}</span></td>
                                        <td>
                                            <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                                                <button className="table-action-btn" onClick={() => router.push(`/invoices/${n._id}`)}>Lihat</button>
                                                <button className="table-action-btn" onClick={() => void handleExportNota(n)}><FileDown size={13} /> Excel</button>
                                                <button className="table-action-btn" onClick={() => void handlePrintNota(n)}><Printer size={13} /> Cetak</button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                        </tbody>
                    </table>
                </div>
                {filtered.length > 0 && <div className="pagination"><div className="pagination-info">Menampilkan {filtered.length} nota · Total: <strong style={{ color: 'var(--color-danger)' }}>{formatCurrency(grandTotal)}</strong></div></div>}
            </div>
        </div>
    );
}
