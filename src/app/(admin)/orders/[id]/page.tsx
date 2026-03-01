'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useToast, useApp } from '../../layout';
import { ArrowLeft, Truck, FileText, Plus, Edit, Printer, Package, Eye } from 'lucide-react';
import { formatDate, formatDateTime, formatCurrency, ORDER_STATUS_MAP, ITEM_STATUS_MAP, DO_STATUS_MAP, INVOICE_STATUS_MAP } from '@/lib/utils';
import type { Order, OrderItem, DeliveryOrder, Invoice, TrackingLog, DeliveryOrderItem } from '@/lib/types';

export default function OrderDetailPage() {
    const params = useParams();
    const router = useRouter();
    const { addToast } = useToast();
    const { user } = useApp();
    const [order, setOrder] = useState<Order | null>(null);
    const [items, setItems] = useState<OrderItem[]>([]);
    const [dos, setDos] = useState<DeliveryOrder[]>([]);
    const [doItems, setDoItems] = useState<DeliveryOrderItem[]>([]);
    const [invoices, setInvoices] = useState<Invoice[]>([]);
    const [loading, setLoading] = useState(true);
    const [showDOModal, setShowDOModal] = useState(false);
    const [showInvModal, setShowInvModal] = useState(false);
    // DO form
    const [doDate, setDoDate] = useState(new Date().toISOString().split('T')[0]);
    const [doVehicle, setDoVehicle] = useState('');
    const [doNotes, setDoNotes] = useState('');
    const [selectedItems, setSelectedItems] = useState<string[]>([]);
    const [vehicles, setVehicles] = useState<Array<{ _id: string; plateNumber: string }>>([]);
    // Invoice form
    const [invDesc, setInvDesc] = useState('');
    const [invPrice, setInvPrice] = useState(0);
    const [invItems, setInvItems] = useState<Array<{ description: string; qty: number; price: number; subtotal: number }>>([]);

    useEffect(() => {
        const id = params.id as string;
        Promise.all([
            fetch(`/api/data?entity=orders&id=${id}`).then(r => r.json()),
            fetch(`/api/data?entity=order-items&filter=${encodeURIComponent(JSON.stringify({ orderRef: id }))}`).then(r => r.json()),
            fetch(`/api/data?entity=delivery-orders&filter=${encodeURIComponent(JSON.stringify({ orderRef: id }))}`).then(r => r.json()),
            fetch(`/api/data?entity=delivery-order-items`).then(r => r.json()),
            fetch(`/api/data?entity=invoices&filter=${encodeURIComponent(JSON.stringify({ orderRef: id }))}`).then(r => r.json()),
            fetch(`/api/data?entity=vehicles`).then(r => r.json()),
        ]).then(([orderRes, itemsRes, dosRes, doItemsRes, invRes, vehRes]) => {
            setOrder(orderRes.data);
            setItems(itemsRes.data || []);
            setDos(dosRes.data || []);
            setDoItems(doItemsRes.data || []);
            setInvoices(invRes.data || []);
            setVehicles(vehRes.data || []);
            setLoading(false);
        }).catch(() => setLoading(false));
    }, [params.id]);

    // Get already assigned item IDs
    const assignedItemIds = doItems
        .filter(doi => dos.some(d => d._id === doi.deliveryOrderRef))
        .map(doi => doi.orderItemRef);

    const availableItems = items.filter(i => !assignedItemIds.includes(i._id));
    const deliveredCount = items.filter(i => i.status === 'DELIVERED').length;
    const holdCount = items.filter(i => i.status === 'HOLD').length;
    const pendingCount = items.filter(i => i.status === 'PENDING').length;
    const progress = items.length > 0 ? Math.round((deliveredCount / items.length) * 100) : 0;

    const handleCreateDO = async () => {
        if (selectedItems.length === 0) {
            addToast('error', 'Pilih minimal 1 item untuk surat jalan');
            return;
        }
        try {
            const selVeh = vehicles.find(v => v._id === doVehicle);
            const doRes = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    entity: 'delivery-orders',
                    data: {
                        orderRef: order?._id,
                        masterResi: order?.masterResi,
                        vehicleRef: doVehicle || undefined,
                        vehiclePlate: selVeh?.plateNumber || '',
                        date: doDate,
                        notes: doNotes,
                        customerName: order?.customerName,
                        receiverName: order?.receiverName,
                        receiverAddress: order?.receiverAddress,
                    }
                }),
            });
            const doData = await doRes.json();
            const doId = doData.data?._id || doData.id;

            // Create DO items
            for (const itemId of selectedItems) {
                const item = items.find(i => i._id === itemId);
                await fetch('/api/data', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        entity: 'delivery-order-items',
                        data: {
                            deliveryOrderRef: doId,
                            orderItemRef: itemId,
                            orderItemDescription: item?.description,
                            orderItemQtyKoli: item?.qtyKoli,
                            orderItemWeight: item?.weight,
                        }
                    }),
                });
            }

            addToast('success', `Surat Jalan dibuat: ${doData.data?.doNumber || ''}`);
            setShowDOModal(false);
            setSelectedItems([]);
            router.refresh();
            // Reload data
            window.location.reload();
        } catch {
            addToast('error', 'Gagal membuat surat jalan');
        }
    };

    const handleCreateInvoice = async () => {
        if (invItems.length === 0) {
            addToast('error', 'Tambahkan minimal 1 item invoice');
            return;
        }
        try {
            const total = invItems.reduce((s, i) => s + i.subtotal, 0);
            const invRes = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    entity: 'invoices',
                    data: {
                        mode: 'ORDER', orderRef: order?._id,
                        customerRef: order?.customerRef, customerName: order?.customerName, masterResi: order?.masterResi,
                        issueDate: new Date().toISOString().split('T')[0],
                        dueDate: new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0],
                        totalAmount: total, notes: '',
                    }
                }),
            });
            const invData = await invRes.json();
            const invId = invData.data?._id || invData.id;

            for (const item of invItems) {
                await fetch('/api/data', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ entity: 'invoice-items', data: { invoiceRef: invId, ...item } }),
                });
            }

            addToast('success', `Invoice dibuat: ${invData.data?.invoiceNumber || ''}`);
            setShowInvModal(false);
            setInvItems([]);
            window.location.reload();
        } catch {
            addToast('error', 'Gagal membuat invoice');
        }
    };

    const updateItemStatus = async (itemId: string, newStatus: string) => {
        await fetch('/api/data', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ entity: 'order-items', action: 'update', data: { id: itemId, updates: { status: newStatus } } }),
        });
        setItems(prev => prev.map(i => i._id === itemId ? { ...i, status: newStatus as OrderItem['status'] } : i));

        // Recalculate order status
        const updatedItems = items.map(i => i._id === itemId ? { ...i, status: newStatus } : i);
        const allDelivered = updatedItems.every(i => i.status === 'DELIVERED');
        const anyDelivered = updatedItems.some(i => i.status === 'DELIVERED');
        const anyHold = updatedItems.some(i => i.status === 'HOLD');
        let newOrderStatus = order?.status || 'OPEN';
        if (allDelivered) newOrderStatus = 'COMPLETE';
        else if (anyDelivered) newOrderStatus = 'PARTIAL';
        else if (anyHold && !anyDelivered) newOrderStatus = 'ON_HOLD';

        if (newOrderStatus !== order?.status) {
            await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ entity: 'orders', action: 'update', data: { id: order?._id, updates: { status: newOrderStatus } } }),
            });
            setOrder(prev => prev ? { ...prev, status: newOrderStatus as Order['status'] } : prev);
        }

        addToast('success', 'Status item diperbarui');
    };

    if (loading) {
        return <div><div className="skeleton skeleton-title" /><div className="skeleton skeleton-card" style={{ height: 200 }} /></div>;
    }

    if (!order) {
        return <div className="empty-state"><div className="empty-state-title">Order tidak ditemukan</div></div>;
    }

    return (
        <div>
            <div className="page-header">
                <div className="page-header-left" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <button className="btn btn-ghost btn-sm" onClick={() => router.push('/orders')} style={{ flexShrink: 0 }}><ArrowLeft size={16} /></button>
                    <div>
                        <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                            {order.masterResi}
                            <span className={`badge badge-${ORDER_STATUS_MAP[order.status]?.color || 'gray'}`}>
                                <span className="badge-dot" /> {ORDER_STATUS_MAP[order.status]?.label}
                            </span>
                        </h1>
                        <p className="page-subtitle">Detail order dan pengiriman</p>
                    </div>
                </div>
                <div className="page-actions">
                    <button className="btn btn-primary" onClick={() => setShowDOModal(true)} disabled={availableItems.length === 0}>
                        <Truck size={16} /> Buat Surat Jalan
                    </button>
                    <button className="btn btn-secondary" onClick={() => setShowInvModal(true)}>
                        <FileText size={16} /> Buat Invoice
                    </button>
                    <button className="btn btn-ghost" onClick={() => router.push(`/orders/${order._id}/edit`)}>
                        <Edit size={16} /> Edit
                    </button>
                </div>
            </div>

            {/* Progress Bar */}
            <div className="card mb-6">
                <div className="card-body">
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 'var(--font-size-sm)' }}>
                        <span className="font-semibold">Progress Pengiriman</span>
                        <span className="text-muted">{deliveredCount}/{items.length} item terkirim ({progress}%)</span>
                    </div>
                    <div className="progress-bar">
                        <div className={`progress-bar-fill ${progress === 100 ? 'success' : ''}`} style={{ width: `${progress}%` }} />
                    </div>
                    <div style={{ display: 'flex', gap: 16, marginTop: 8, fontSize: 'var(--font-size-xs)', color: 'var(--color-gray-500)' }}>
                        <span style={{ color: 'var(--color-success)' }}>{deliveredCount} Terkirim</span>
                        <span style={{ color: 'var(--color-warning)' }}>{holdCount} Ditahan</span>
                        <span>{pendingCount} Pending</span>
                    </div>
                </div>
            </div>

            {/* Order Info */}
            <div className="detail-grid">
                <div className="card">
                    <div className="card-header"><span className="card-header-title">Informasi Order</span></div>
                    <div className="card-body">
                        <div className="detail-row">
                            <div className="detail-item"><div className="detail-label">Master Resi</div><div className="detail-value font-mono">{order.masterResi}</div></div>
                            <div className="detail-item"><div className="detail-label">Tanggal</div><div className="detail-value">{formatDate(order.createdAt)}</div></div>
                        </div>
                        <div className="detail-row">
                            <div className="detail-item"><div className="detail-label">Customer</div><div className="detail-value">{order.customerName}</div></div>
                            <div className="detail-item"><div className="detail-label">Layanan</div><div className="detail-value">{order.serviceName}</div></div>
                        </div>
                        {order.notes && <div className="mt-2"><div className="detail-label">Catatan</div><div className="detail-value">{order.notes}</div></div>}
                    </div>
                </div>

                <div className="card">
                    <div className="card-header"><span className="card-header-title">Penerima</span></div>
                    <div className="card-body">
                        <div className="detail-row">
                            <div className="detail-item"><div className="detail-label">Nama</div><div className="detail-value">{order.receiverName}</div></div>
                            <div className="detail-item"><div className="detail-label">Telepon</div><div className="detail-value">{order.receiverPhone}</div></div>
                        </div>
                        <div><div className="detail-label">Alamat</div><div className="detail-value">{order.receiverAddress}</div></div>
                        {order.receiverCompany && <div className="mt-2"><div className="detail-label">Perusahaan</div><div className="detail-value">{order.receiverCompany}</div></div>}
                    </div>
                </div>
            </div>

            {/* Items */}
            <div className="card mt-6">
                <div className="card-header">
                    <span className="card-header-title">Item / Koli ({items.length})</span>
                </div>
                <div className="table-wrapper">
                    <table>
                        <thead><tr><th>Deskripsi</th><th>Koli</th><th>Berat (kg)</th><th>Status</th><th>Aksi</th></tr></thead>
                        <tbody>
                            {items.map(item => (
                                <tr key={item._id}>
                                    <td className="font-medium">{item.description}</td>
                                    <td>{item.qtyKoli}</td>
                                    <td>{item.weight}</td>
                                    <td>
                                        <span className={`badge badge-${ITEM_STATUS_MAP[item.status]?.color || 'gray'}`}>
                                            <span className="badge-dot" /> {ITEM_STATUS_MAP[item.status]?.label}
                                        </span>
                                    </td>
                                    <td>
                                        <div className="table-actions">
                                            {item.status === 'PENDING' && (
                                                <button className="table-action-btn" onClick={() => updateItemStatus(item._id, 'HOLD')}>Set Hold</button>
                                            )}
                                            {item.status === 'HOLD' && (
                                                <button className="table-action-btn" onClick={() => updateItemStatus(item._id, 'PENDING')}>Set Pending</button>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* DOs */}
            <div className="card mt-6">
                <div className="card-header"><span className="card-header-title">Surat Jalan ({dos.length})</span></div>
                <div className="table-wrapper">
                    <table>
                        <thead><tr><th>No. DO</th><th>Tanggal</th><th>Kendaraan</th><th>Status</th><th>Aksi</th></tr></thead>
                        <tbody>
                            {dos.length === 0 ? (
                                <tr><td colSpan={5} className="text-center text-muted" style={{ padding: '2rem' }}>Belum ada surat jalan</td></tr>
                            ) : dos.map(d => (
                                <tr key={d._id}>
                                    <td><Link href={`/delivery-orders/${d._id}`} className="font-semibold" style={{ color: 'var(--color-primary)' }}>{d.doNumber}</Link></td>
                                    <td>{formatDate(d.date)}</td>
                                    <td>{d.vehiclePlate || '-'}</td>
                                    <td><span className={`badge badge-${DO_STATUS_MAP[d.status]?.color}`}><span className="badge-dot" /> {DO_STATUS_MAP[d.status]?.label}</span></td>
                                    <td><Link href={`/delivery-orders/${d._id}`} className="table-action-btn"><Eye size={14} /> Lihat</Link></td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Invoices */}
            <div className="card mt-6">
                <div className="card-header"><span className="card-header-title">Invoice ({invoices.length})</span></div>
                <div className="table-wrapper">
                    <table>
                        <thead><tr><th>No. Invoice</th><th>Tanggal</th><th>Total</th><th>Status</th><th>Aksi</th></tr></thead>
                        <tbody>
                            {invoices.length === 0 ? (
                                <tr><td colSpan={5} className="text-center text-muted" style={{ padding: '2rem' }}>Belum ada invoice</td></tr>
                            ) : invoices.map(inv => (
                                <tr key={inv._id}>
                                    <td><Link href={`/invoices/${inv._id}`} className="font-semibold" style={{ color: 'var(--color-primary)' }}>{inv.invoiceNumber}</Link></td>
                                    <td>{formatDate(inv.issueDate)}</td>
                                    <td className="font-medium">{formatCurrency(inv.totalAmount)}</td>
                                    <td><span className={`badge badge-${INVOICE_STATUS_MAP[inv.status]?.color}`}><span className="badge-dot" /> {INVOICE_STATUS_MAP[inv.status]?.label}</span></td>
                                    <td><Link href={`/invoices/${inv._id}`} className="table-action-btn"><Eye size={14} /> Lihat</Link></td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Create DO Modal */}
            {showDOModal && (
                <div className="modal-overlay" onClick={() => setShowDOModal(false)}>
                    <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3 className="modal-title">Buat Surat Jalan</h3>
                            <button className="modal-close" onClick={() => setShowDOModal(false)}>&times;</button>
                        </div>
                        <div className="modal-body">
                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label">Tanggal</label>
                                    <input type="date" className="form-input" value={doDate} onChange={e => setDoDate(e.target.value)} />
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Kendaraan</label>
                                    <select className="form-select" value={doVehicle} onChange={e => setDoVehicle(e.target.value)}>
                                        <option value="">Pilih kendaraan</option>
                                        {vehicles.map(v => <option key={v._id} value={v._id}>{v.plateNumber}</option>)}
                                    </select>
                                </div>
                            </div>
                            <div className="form-group">
                                <label className="form-label">Catatan</label>
                                <textarea className="form-textarea" rows={2} value={doNotes} onChange={e => setDoNotes(e.target.value)} placeholder="Catatan opsional..." />
                            </div>
                            <div className="form-section-title">Pilih Item untuk DO</div>
                            {availableItems.length === 0 ? (
                                <p className="text-muted text-sm">Semua item sudah masuk surat jalan</p>
                            ) : (
                                <div style={{ border: '1px solid var(--color-gray-200)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
                                    <table>
                                        <thead><tr><th style={{ width: 40 }}></th><th>Item</th><th>Koli</th><th>Berat</th><th>Status</th></tr></thead>
                                        <tbody>
                                            {availableItems.map(item => (
                                                <tr key={item._id}>
                                                    <td>
                                                        <input
                                                            type="checkbox"
                                                            checked={selectedItems.includes(item._id)}
                                                            onChange={e => {
                                                                if (e.target.checked) setSelectedItems(prev => [...prev, item._id]);
                                                                else setSelectedItems(prev => prev.filter(id => id !== item._id));
                                                            }}
                                                        />
                                                    </td>
                                                    <td>{item.description}</td>
                                                    <td>{item.qtyKoli}</td>
                                                    <td>{item.weight} kg</td>
                                                    <td><span className={`badge badge-${ITEM_STATUS_MAP[item.status]?.color}`}>{ITEM_STATUS_MAP[item.status]?.label}</span></td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setShowDOModal(false)}>Batal</button>
                            <button className="btn btn-primary" onClick={handleCreateDO} disabled={selectedItems.length === 0}>
                                <Truck size={16} /> Buat Surat Jalan ({selectedItems.length} item)
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Create Invoice Modal */}
            {showInvModal && (
                <div className="modal-overlay" onClick={() => setShowInvModal(false)}>
                    <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3 className="modal-title">Buat Invoice</h3>
                            <button className="modal-close" onClick={() => setShowInvModal(false)}>&times;</button>
                        </div>
                        <div className="modal-body">
                            <div className="form-section-title">Item Invoice</div>
                            {invItems.map((item, idx) => (
                                <div key={idx} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                                    <input className="form-input" placeholder="Deskripsi" value={item.description}
                                        onChange={e => { const n = [...invItems]; n[idx].description = e.target.value; setInvItems(n); }} style={{ flex: 2 }} />
                                    <input className="form-input" type="number" placeholder="Harga" value={item.price || ''}
                                        onChange={e => { const n = [...invItems]; n[idx].price = Number(e.target.value); n[idx].subtotal = n[idx].qty * n[idx].price; setInvItems(n); }} style={{ flex: 1 }} />
                                    <button className="btn btn-ghost btn-sm" onClick={() => setInvItems(prev => prev.filter((_, i) => i !== idx))}>x</button>
                                </div>
                            ))}
                            <button className="btn btn-secondary btn-sm" onClick={() => setInvItems(prev => [...prev, { description: '', qty: 1, price: 0, subtotal: 0 }])}>
                                <Plus size={14} /> Tambah Item
                            </button>
                            <div className="mt-4" style={{ textAlign: 'right', fontSize: 'var(--font-size-lg)', fontWeight: 700 }}>
                                Total: {formatCurrency(invItems.reduce((s, i) => s + (i.qty * i.price), 0))}
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setShowInvModal(false)}>Batal</button>
                            <button className="btn btn-primary" onClick={handleCreateInvoice} disabled={invItems.length === 0}>
                                <FileText size={16} /> Buat Invoice
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
