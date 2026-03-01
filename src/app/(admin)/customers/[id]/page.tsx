'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useToast } from '../../layout';
import { ArrowLeft, Edit, Package, DollarSign } from 'lucide-react';
import { formatDate, formatCurrency } from '@/lib/utils';
import type { Customer, Order, Invoice } from '@/lib/types';

export default function CustomerDetailPage() {
    const params = useParams();
    const router = useRouter();
    const { addToast } = useToast();
    const [customer, setCustomer] = useState<Customer | null>(null);
    const [orders, setOrders] = useState<Order[]>([]);
    const [invoices, setInvoices] = useState<Invoice[]>([]);
    const [loading, setLoading] = useState(true);
    const [editing, setEditing] = useState(false);
    const [form, setForm] = useState({ name: '', address: '', contactPerson: '', phone: '', email: '', npwp: '' });

    useEffect(() => {
        const id = params.id as string;
        Promise.all([
            fetch(`/api/data?entity=customers&id=${id}`).then(r => r.json()),
            fetch('/api/data?entity=orders').then(r => r.json()),
            fetch('/api/data?entity=invoices').then(r => r.json()),
        ]).then(([c, o, i]) => {
            const cust = c.data as Customer;
            setCustomer(cust);
            if (cust) {
                setForm({ name: cust.name, address: cust.address, contactPerson: cust.contactPerson, phone: cust.phone, email: cust.email, npwp: cust.npwp || '' });
                setOrders((o.data || []).filter((ord: Order) => ord.customerRef === id));
                setInvoices((i.data || []).filter((inv: Invoice) => inv.customerRef === id));
            }
            setLoading(false);
        }).catch(() => setLoading(false));
    }, [params.id]);

    const handleSave = async () => {
        try {
            await fetch('/api/data', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ entity: 'customers', action: 'update', data: { id: params.id, updates: form } }),
            });
            setCustomer(prev => prev ? { ...prev, ...form } : prev);
            setEditing(false);
            addToast('success', 'Customer berhasil diperbarui');
        } catch { addToast('error', 'Gagal menyimpan'); }
    };

    if (loading) return <div><div className="skeleton skeleton-title" /><div className="skeleton skeleton-card" style={{ height: 200 }} /></div>;
    if (!customer) return <div className="empty-state"><div className="empty-state-title">Customer tidak ditemukan</div></div>;

    return (
        <div>
            <div className="page-header">
                <div className="page-header-left" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <button className="btn-back" onClick={() => router.push('/customers')}><ArrowLeft size={16} /></button>
                    <h1 className="page-title">{customer.name}</h1>
                </div>
                <div className="page-actions">
                    {!editing && <button className="btn btn-primary" onClick={() => setEditing(true)}><Edit size={16} /> Edit</button>}
                </div>
            </div>

            <div className="detail-grid">
                <div className="card">
                    <div className="card-header"><span className="card-header-title">Informasi Customer</span></div>
                    <div className="card-body">
                        {editing ? (
                            <>
                                <div className="form-group"><label className="form-label">Nama</label><input className="form-input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
                                <div className="form-group"><label className="form-label">Alamat</label><textarea className="form-textarea" rows={2} value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} /></div>
                                <div className="form-row">
                                    <div className="form-group"><label className="form-label">Contact Person</label><input className="form-input" value={form.contactPerson} onChange={e => setForm({ ...form, contactPerson: e.target.value })} /></div>
                                    <div className="form-group"><label className="form-label">Telepon</label><input className="form-input" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} /></div>
                                </div>
                                <div className="form-row">
                                    <div className="form-group"><label className="form-label">Email</label><input className="form-input" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></div>
                                    <div className="form-group"><label className="form-label">NPWP</label><input className="form-input" value={form.npwp} onChange={e => setForm({ ...form, npwp: e.target.value })} /></div>
                                </div>
                                <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                                    <button className="btn btn-secondary" onClick={() => setEditing(false)}>Batal</button>
                                    <button className="btn btn-primary" onClick={handleSave}>Simpan</button>
                                </div>
                            </>
                        ) : (
                            <>
                                <div className="detail-row">
                                    <div className="detail-item"><div className="detail-label">Nama</div><div className="detail-value font-medium">{customer.name}</div></div>
                                    <div className="detail-item"><div className="detail-label">Contact Person</div><div className="detail-value">{customer.contactPerson}</div></div>
                                </div>
                                <div className="detail-row">
                                    <div className="detail-item"><div className="detail-label">Telepon</div><div className="detail-value">{customer.phone}</div></div>
                                    <div className="detail-item"><div className="detail-label">Email</div><div className="detail-value">{customer.email}</div></div>
                                </div>
                                <div className="detail-item mt-2"><div className="detail-label">Alamat</div><div className="detail-value">{customer.address}</div></div>
                                {customer.npwp && <div className="detail-item mt-2"><div className="detail-label">NPWP</div><div className="detail-value font-mono">{customer.npwp}</div></div>}
                            </>
                        )}
                    </div>
                </div>

                <div className="card">
                    <div className="card-header"><span className="card-header-title">Statistik</span></div>
                    <div className="card-body">
                        <div className="kpi-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
                            <div className="kpi-card"><div className="kpi-icon" style={{ background: 'var(--color-primary-light)' }}><Package size={20} /></div><div className="kpi-value">{orders.length}</div><div className="kpi-label">Total Order</div></div>
                            <div className="kpi-card"><div className="kpi-icon" style={{ background: 'var(--color-success-light)' }}><DollarSign size={20} /></div><div className="kpi-value">{invoices.length}</div><div className="kpi-label">Total Invoice</div></div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Recent Orders */}
            <div className="card mt-6">
                <div className="card-header"><span className="card-header-title">Order Terbaru ({orders.length})</span></div>
                <div className="table-wrapper">
                    <table>
                        <thead><tr><th>Resi</th><th>Penerima</th><th>Status</th><th>Tanggal</th></tr></thead>
                        <tbody>
                            {orders.length === 0 ? <tr><td colSpan={4} className="text-center text-muted" style={{ padding: '2rem' }}>Belum ada order</td></tr> :
                                orders.slice(0, 10).map(o => (
                                    <tr key={o._id}>
                                        <td><Link href={`/orders/${o._id}`} style={{ color: 'var(--color-primary)' }}>{o.masterResi}</Link></td>
                                        <td>{o.receiverName}</td>
                                        <td>{o.status}</td>
                                        <td className="text-muted">{formatDate(o.createdAt)}</td>
                                    </tr>
                                ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Recent Invoices */}
            <div className="card mt-6">
                <div className="card-header"><span className="card-header-title">Invoice ({invoices.length})</span></div>
                <div className="table-wrapper">
                    <table>
                        <thead><tr><th>No. Invoice</th><th>Total</th><th>Status</th><th>Jatuh Tempo</th></tr></thead>
                        <tbody>
                            {invoices.length === 0 ? <tr><td colSpan={4} className="text-center text-muted" style={{ padding: '2rem' }}>Belum ada invoice</td></tr> :
                                invoices.map(inv => (
                                    <tr key={inv._id}>
                                        <td><Link href={`/invoices/${inv._id}`} style={{ color: 'var(--color-primary)' }}>{inv.invoiceNumber}</Link></td>
                                        <td className="font-medium">{formatCurrency(inv.totalAmount)}</td>
                                        <td>{inv.status}</td>
                                        <td className="text-muted">{formatDate(inv.dueDate)}</td>
                                    </tr>
                                ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
