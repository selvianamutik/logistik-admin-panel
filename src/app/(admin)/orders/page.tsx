'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useToast } from '../layout';
import { Plus, Search, Eye, Edit, Trash2, Package, FileDown, Printer } from 'lucide-react';
import { formatDate, ORDER_STATUS_MAP } from '@/lib/utils';
import { exportOrders } from '@/lib/export';
import { openBrandedPrint, fetchCompanyProfile } from '@/lib/print';
import type { Order } from '@/lib/types';

export default function OrdersPage() {
    const router = useRouter();
    const { addToast } = useToast();
    const [orders, setOrders] = useState<Order[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState('');
    const [deleteId, setDeleteId] = useState<string | null>(null);

    useEffect(() => {
        const loadOrders = async () => {
            try {
                const res = await fetch('/api/data?entity=orders');
                const payload = await res.json();
                if (!res.ok) {
                    throw new Error(payload.error || 'Gagal memuat order');
                }
                setOrders(payload.data || []);
            } catch (error) {
                addToast('error', error instanceof Error ? error.message : 'Gagal memuat order');
            } finally {
                setLoading(false);
            }
        };

        void loadOrders();
    }, [addToast]);

    const filtered = orders.filter(o => {
        const matchSearch = !search ||
            o.masterResi?.toLowerCase().includes(search.toLowerCase()) ||
            o.customerName?.toLowerCase().includes(search.toLowerCase()) ||
            o.receiverName?.toLowerCase().includes(search.toLowerCase());
        const matchStatus = !statusFilter || o.status === statusFilter;
        return matchSearch && matchStatus;
    });

    const handleDelete = async (id: string) => {
        try {
            const res = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ entity: 'orders', action: 'delete', data: { id } }),
            });
            const result = await res.json();
            if (!res.ok) {
                addToast('error', result.error || 'Gagal menghapus order');
                setDeleteId(null);
                return;
            }
            setOrders(prev => prev.filter(o => o._id !== id));
            addToast('success', 'Order berhasil dihapus');
            setDeleteId(null);
        } catch {
            addToast('error', 'Gagal menghapus order');
            setDeleteId(null);
        }
    };

    return (
        <div>
            <div className="page-header">
                <div className="page-header-left">
                    <h1 className="page-title">Order / Resi</h1>
                    <p className="page-subtitle">Kelola semua order pengiriman</p>
                </div>
                <div className="page-actions" style={{ flexWrap: 'wrap' }}>
                    <button className="btn btn-secondary btn-sm" onClick={() => exportOrders(filtered as unknown as Record<string, unknown>[])}>
                        <FileDown size={15} /> Excel
                    </button>
                    <button className="btn btn-secondary btn-sm" onClick={async () => {
                        const co = await fetchCompanyProfile();
                        openBrandedPrint({
                            title: 'Daftar Order / Resi', company: co, bodyHtml: `
                            <table><thead><tr><th>Resi</th><th>Customer</th><th>Penerima</th><th>Alamat</th><th>Tanggal</th><th>Status</th></tr></thead>
                            <tbody>${filtered.map(o => `<tr><td class="b">${o.masterResi}</td><td>${o.customerName || '-'}</td><td>${o.receiverName || '-'}</td><td>${o.receiverAddress || '-'}</td><td>${formatDate(o.createdAt)}</td><td>${ORDER_STATUS_MAP[o.status]?.label || o.status}</td></tr>`).join('')}</tbody></table>`
                        });
                    }}><Printer size={15} /> Print</button>
                    <Link href="/orders/new" className="btn btn-primary">
                        <Plus size={18} className="btn-icon" /> Tambah Order
                    </Link>
                </div>
            </div>

            <div className="table-container">
                <div className="table-toolbar">
                    <div className="table-toolbar-left">
                        <div className="table-search">
                            <Search size={16} className="table-search-icon" />
                            <input
                                type="text"
                                placeholder="Cari resi, customer, penerima..."
                                value={search}
                                onChange={e => setSearch(e.target.value)}
                            />
                        </div>
                        <select
                            className="form-select"
                            style={{ width: 'auto', minWidth: 140 }}
                            value={statusFilter}
                            onChange={e => setStatusFilter(e.target.value)}
                        >
                            <option value="">Semua Status</option>
                            {Object.entries(ORDER_STATUS_MAP).map(([k, v]) => (
                                <option key={k} value={k}>{v.label}</option>
                            ))}
                        </select>
                    </div>
                </div>

                <div className="table-wrapper">
                    <table>
                        <thead>
                            <tr>
                                <th>No. Resi</th>
                                <th>Customer</th>
                                <th>Penerima</th>
                                <th>Layanan</th>
                                <th>Status</th>
                                <th>Tanggal</th>
                                <th>Aksi</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                [1, 2, 3].map(i => (
                                    <tr key={i}>
                                        {[1, 2, 3, 4, 5, 6, 7].map(j => (
                                            <td key={j}><div className="skeleton skeleton-text" /></td>
                                        ))}
                                    </tr>
                                ))
                            ) : filtered.length === 0 ? (
                                <tr>
                                    <td colSpan={7}>
                                        <div className="empty-state">
                                            <Package size={48} className="empty-state-icon" />
                                            <div className="empty-state-title">Belum ada order</div>
                                            <div className="empty-state-text">Buat order baru untuk memulai pengiriman</div>
                                            <Link href="/orders/new" className="btn btn-primary">
                                                <Plus size={16} /> Tambah Order
                                            </Link>
                                        </div>
                                    </td>
                                </tr>
                            ) : (
                                filtered.map(order => (
                                    <tr key={order._id}>
                                        <td>
                                            <Link href={`/orders/${order._id}`} className="font-semibold" style={{ color: 'var(--color-primary)' }}>
                                                {order.masterResi}
                                            </Link>
                                        </td>
                                        <td>{order.customerName}</td>
                                        <td>{order.receiverName}</td>
                                        <td>{order.serviceName}</td>
                                        <td>
                                            <span className={`badge badge-${ORDER_STATUS_MAP[order.status]?.color || 'gray'}`}>
                                                <span className="badge-dot" />
                                                {ORDER_STATUS_MAP[order.status]?.label || order.status}
                                            </span>
                                        </td>
                                        <td className="text-muted">{formatDate(order.createdAt)}</td>
                                        <td>
                                            <div className="table-actions">
                                                <button className="table-action-btn" onClick={() => router.push(`/orders/${order._id}`)}>
                                                    <Eye size={14} /> Lihat
                                                </button>
                                                <button className="table-action-btn" onClick={() => router.push(`/orders/${order._id}/edit`)}>
                                                    <Edit size={14} /> Edit
                                                </button>
                                                <button className="table-action-btn danger" onClick={() => setDeleteId(order._id)}>
                                                    <Trash2 size={14} /> Hapus
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>

                {filtered.length > 0 && (
                    <div className="pagination">
                        <div className="pagination-info">Menampilkan {filtered.length} dari {orders.length} order</div>
                    </div>
                )}
            </div>

            {/* Delete Confirmation Dialog */}
            {deleteId && (
                <div className="modal-overlay" onClick={() => setDeleteId(null)}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3 className="modal-title">Konfirmasi Hapus</h3>
                            <button className="modal-close" onClick={() => setDeleteId(null)}>
                                <span>&times;</span>
                            </button>
                        </div>
                        <div className="modal-body">
                            <p>Apakah Anda yakin ingin menghapus order ini? Tindakan ini tidak dapat dibatalkan.</p>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setDeleteId(null)}>Batal</button>
                            <button className="btn btn-danger" onClick={() => handleDelete(deleteId)}>
                                <Trash2 size={16} /> Hapus
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
