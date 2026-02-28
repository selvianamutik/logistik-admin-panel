'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useApp } from '../layout';
import { Search, Eye, FileText, FileDown, Printer } from 'lucide-react';
import { formatDate, formatCurrency, INVOICE_STATUS_MAP } from '@/lib/utils';
import { exportInvoices } from '@/lib/export';
import { openBrandedPrint, fetchCompanyProfile } from '@/lib/print';
import type { Invoice } from '@/lib/types';

export default function InvoicesPage() {
    const router = useRouter();
    const { user } = useApp();
    const [items, setItems] = useState<Invoice[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState('');

    useEffect(() => {
        fetch('/api/data?entity=invoices').then(r => r.json()).then(d => { setItems(d.data || []); setLoading(false); });
    }, []);

    const filtered = items.filter(i => {
        const m = !search || i.invoiceNumber?.toLowerCase().includes(search.toLowerCase()) || i.customerName?.toLowerCase().includes(search.toLowerCase());
        const s = !statusFilter || i.status === statusFilter;
        return m && s;
    });

    const isOwner = user?.role === 'OWNER';

    return (
        <div>
            <div className="page-header">
                <div className="page-header-left"><h1 className="page-title">Invoice</h1><p className="page-subtitle">Kelola semua invoice dan pembayaran</p></div>
                <div className="page-actions" style={{ flexWrap: 'wrap' }}>
                    <button className="btn btn-secondary btn-sm" onClick={() => exportInvoices(filtered as unknown as Record<string, unknown>[])}><FileDown size={15} /> Excel</button>
                    <button className="btn btn-secondary btn-sm" onClick={async () => {
                        const co = await fetchCompanyProfile();
                        openBrandedPrint({
                            title: 'Daftar Invoice', company: co, bodyHtml: `
                            <table><thead><tr><th>No. Invoice</th><th>Customer</th><th>Resi</th><th>Terbit</th><th>Tempo</th><th class="r">Total</th><th>Status</th></tr></thead>
                            <tbody>${filtered.map(inv => `<tr><td class="b">${inv.invoiceNumber}</td><td>${inv.customerName || '-'}</td><td>${inv.masterResi || '-'}</td><td>${formatDate(inv.issueDate)}</td><td>${formatDate(inv.dueDate)}</td><td class="r b">${formatCurrency(inv.totalAmount)}</td><td>${INVOICE_STATUS_MAP[inv.status]?.label || inv.status}</td></tr>`).join('')}</tbody></table>`
                        });
                    }}><Printer size={15} /> Print</button>
                </div>
            </div>
            <div className="table-container">
                <div className="table-toolbar">
                    <div className="table-toolbar-left">
                        <div className="table-search"><Search size={16} className="table-search-icon" /><input type="text" placeholder="Cari invoice, customer..." value={search} onChange={e => setSearch(e.target.value)} /></div>
                        <select className="form-select" style={{ width: 'auto', minWidth: 140 }} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
                            <option value="">Semua Status</option>
                            {Object.entries(INVOICE_STATUS_MAP).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                        </select>
                    </div>
                </div>
                <div className="table-wrapper">
                    <table>
                        <thead><tr><th>No. Invoice</th><th>Customer</th><th>Resi</th><th>Tanggal</th><th>Jatuh Tempo</th>{isOwner && <th>Total</th>}<th>Status</th><th>Aksi</th></tr></thead>
                        <tbody>
                            {loading ? [1, 2, 3].map(i => <tr key={i}>{[1, 2, 3, 4, 5, 6, 7, 8].map(j => <td key={j}><div className="skeleton skeleton-text" /></td>)}</tr>) :
                                filtered.length === 0 ? (
                                    <tr><td colSpan={isOwner ? 8 : 7}><div className="empty-state"><FileText size={48} className="empty-state-icon" /><div className="empty-state-title">Belum ada invoice</div><div className="empty-state-text">Buat invoice dari halaman detail order</div></div></td></tr>
                                ) : filtered.map(inv => (
                                    <tr key={inv._id}>
                                        <td><Link href={`/invoices/${inv._id}`} className="font-semibold" style={{ color: 'var(--color-primary)' }}>{inv.invoiceNumber}</Link></td>
                                        <td>{inv.customerName}</td>
                                        <td><Link href={`/orders/${inv.orderRef}`} className="text-muted">{inv.masterResi}</Link></td>
                                        <td className="text-muted">{formatDate(inv.issueDate)}</td>
                                        <td className="text-muted">{formatDate(inv.dueDate)}</td>
                                        {isOwner && <td className="font-medium">{formatCurrency(inv.totalAmount)}</td>}
                                        <td><span className={`badge badge-${INVOICE_STATUS_MAP[inv.status]?.color}`}><span className="badge-dot" /> {INVOICE_STATUS_MAP[inv.status]?.label}</span></td>
                                        <td><button className="table-action-btn" onClick={() => router.push(`/invoices/${inv._id}`)}><Eye size={14} /> Lihat</button></td>
                                    </tr>
                                ))}
                        </tbody>
                    </table>
                </div>
                {filtered.length > 0 && <div className="pagination"><div className="pagination-info">Menampilkan {filtered.length} invoice</div></div>}
            </div>
        </div>
    );
}
