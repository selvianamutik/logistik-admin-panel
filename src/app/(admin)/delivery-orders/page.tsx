'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Search, Eye, Truck } from 'lucide-react';
import { formatDate, DO_STATUS_MAP } from '@/lib/utils';
import type { DeliveryOrder } from '@/lib/types';

export default function DeliveryOrdersPage() {
    const router = useRouter();
    const [items, setItems] = useState<DeliveryOrder[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState('');

    useEffect(() => {
        fetch('/api/data?entity=delivery-orders').then(r => r.json()).then(d => { setItems(d.data || []); setLoading(false); });
    }, []);

    const filtered = items.filter(d => {
        const m = !search || d.doNumber?.toLowerCase().includes(search.toLowerCase()) || d.customerName?.toLowerCase().includes(search.toLowerCase());
        const s = !statusFilter || d.status === statusFilter;
        return m && s;
    });

    return (
        <div>
            <div className="page-header">
                <div className="page-header-left">
                    <h1 className="page-title">Surat Jalan (DO)</h1>
                    <p className="page-subtitle">Kelola semua surat jalan pengiriman</p>
                </div>
            </div>
            <div className="table-container">
                <div className="table-toolbar">
                    <div className="table-toolbar-left">
                        <div className="table-search">
                            <Search size={16} className="table-search-icon" />
                            <input type="text" placeholder="Cari nomor DO, customer..." value={search} onChange={e => setSearch(e.target.value)} />
                        </div>
                        <select className="form-select" style={{ width: 'auto', minWidth: 140 }} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
                            <option value="">Semua Status</option>
                            {Object.entries(DO_STATUS_MAP).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                        </select>
                    </div>
                </div>
                <div className="table-wrapper">
                    <table>
                        <thead><tr><th>No. DO</th><th>Resi</th><th>Customer</th><th>Kendaraan</th><th>Tanggal</th><th>Status</th><th>Aksi</th></tr></thead>
                        <tbody>
                            {loading ? [1, 2, 3].map(i => <tr key={i}>{[1, 2, 3, 4, 5, 6, 7].map(j => <td key={j}><div className="skeleton skeleton-text" /></td>)}</tr>) :
                                filtered.length === 0 ? (
                                    <tr><td colSpan={7}><div className="empty-state"><Truck size={48} className="empty-state-icon" /><div className="empty-state-title">Belum ada surat jalan</div><div className="empty-state-text">Buat surat jalan dari halaman detail order</div></div></td></tr>
                                ) : filtered.map(d => (
                                    <tr key={d._id}>
                                        <td><Link href={`/delivery-orders/${d._id}`} className="font-semibold" style={{ color: 'var(--color-primary)' }}>{d.doNumber}</Link></td>
                                        <td><Link href={`/orders/${d.orderRef}`} className="text-muted">{d.masterResi}</Link></td>
                                        <td>{d.customerName}</td>
                                        <td>{d.vehiclePlate || '-'}</td>
                                        <td className="text-muted">{formatDate(d.date)}</td>
                                        <td><span className={`badge badge-${DO_STATUS_MAP[d.status]?.color}`}><span className="badge-dot" /> {DO_STATUS_MAP[d.status]?.label}</span></td>
                                        <td><button className="table-action-btn" onClick={() => router.push(`/delivery-orders/${d._id}`)}><Eye size={14} /> Lihat</button></td>
                                    </tr>
                                ))}
                        </tbody>
                    </table>
                </div>
                {filtered.length > 0 && <div className="pagination"><div className="pagination-info">Menampilkan {filtered.length} surat jalan</div></div>}
            </div>
        </div>
    );
}
