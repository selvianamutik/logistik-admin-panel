'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useToast } from '../../layout';
import { ArrowLeft, Truck, FileText, Edit, Eye } from 'lucide-react';
import { formatDate, formatCurrency, ORDER_STATUS_MAP, ITEM_STATUS_MAP, DO_STATUS_MAP, INVOICE_STATUS_MAP } from '@/lib/utils';
import type { Order, OrderItem, DeliveryOrder, DeliveryOrderItem, FreightNota, FreightNotaItem, Vehicle } from '@/lib/types';

export default function OrderDetailPage() {
    const params = useParams();
    const router = useRouter();
    const { addToast } = useToast();
    const orderId = params.id as string;
    const [order, setOrder] = useState<Order | null>(null);
    const [items, setItems] = useState<OrderItem[]>([]);
    const [dos, setDos] = useState<DeliveryOrder[]>([]);
    const [doItems, setDoItems] = useState<DeliveryOrderItem[]>([]);
    const [notas, setNotas] = useState<FreightNota[]>([]);
    const [loading, setLoading] = useState(true);
    const [showDOModal, setShowDOModal] = useState(false);
    // DO form
    const [doDate, setDoDate] = useState(new Date().toISOString().split('T')[0]);
    const [doVehicle, setDoVehicle] = useState('');
    const [doNotes, setDoNotes] = useState('');
    const [selectedItems, setSelectedItems] = useState<string[]>([]);
    const [vehicles, setVehicles] = useState<Array<Pick<Vehicle, '_id' | 'plateNumber'>>>([]);

    const loadOrderDetail = useCallback(async () => {
        const fetchEntity = async <T,>(url: string) => {
            const res = await fetch(url);
            const result = await res.json();
            if (!res.ok) {
                throw new Error(result.error || 'Gagal memuat detail order');
            }
            return result.data as T;
        };

        setLoading(true);
        try {
            const [orderData, itemData, deliveryOrders, vehicleData] = await Promise.all([
                fetchEntity<Order | null>(`/api/data?entity=orders&id=${orderId}`),
                fetchEntity<OrderItem[]>(`/api/data?entity=order-items&filter=${encodeURIComponent(JSON.stringify({ orderRef: orderId }))}`),
                fetchEntity<DeliveryOrder[]>(`/api/data?entity=delivery-orders&filter=${encodeURIComponent(JSON.stringify({ orderRef: orderId }))}`),
                fetchEntity<Array<Pick<Vehicle, '_id' | 'plateNumber'>>>(`/api/data?entity=vehicles&filter=${encodeURIComponent(JSON.stringify({ status: ['ACTIVE', 'IN_SERVICE'] }))}`),
            ]);
            const deliveryOrderIds = (deliveryOrders || []).map(item => item._id);
            const [deliveryOrderItems, notaItems] = await Promise.all([
                deliveryOrderIds.length > 0
                    ? fetchEntity<DeliveryOrderItem[]>(`/api/data?entity=delivery-order-items&filter=${encodeURIComponent(JSON.stringify({ deliveryOrderRef: deliveryOrderIds }))}`)
                    : Promise.resolve([] as DeliveryOrderItem[]),
                deliveryOrderIds.length > 0
                    ? fetchEntity<FreightNotaItem[]>(`/api/data?entity=freight-nota-items&filter=${encodeURIComponent(JSON.stringify({ doRef: deliveryOrderIds }))}`)
                    : Promise.resolve([] as FreightNotaItem[]),
            ]);
            const notaIds = [...new Set((notaItems || []).map(item => item.notaRef).filter(Boolean))];
            const orderNotas = notaIds.length > 0
                ? await fetchEntity<FreightNota[]>(`/api/data?entity=freight-notas&filter=${encodeURIComponent(JSON.stringify({ _id: notaIds }))}`)
                : [];

            setOrder(orderData);
            setItems(itemData || []);
            setDos(deliveryOrders || []);
            setDoItems(deliveryOrderItems);
            setNotas(orderNotas || []);
            setVehicles(vehicleData || []);
        } catch (error) {
            addToast('error', error instanceof Error ? error.message : 'Gagal memuat detail order');
        } finally {
            setLoading(false);
        }
    }, [addToast, orderId]);

    useEffect(() => {
        void loadOrderDetail();
    }, [loadOrderDetail]);

    // Get already assigned item IDs
    const assignedItemIds = doItems
        .filter(doi => dos.some(d => d._id === doi.deliveryOrderRef && d.status !== 'CANCELLED'))
        .map(doi => doi.orderItemRef);

    const availableItems = items.filter(i => !assignedItemIds.includes(i._id));
    const deliveredCount = items.filter(i => i.status === 'DELIVERED').length;
    const holdCount = items.filter(i => i.status === 'HOLD').length;
    const pendingCount = items.filter(i => i.status === 'PENDING').length;
    const deliveredDoCount = dos.filter(d => d.status === 'DELIVERED').length;
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
                    action: 'create-with-items',
                    data: {
                        orderRef: order?._id,
                        itemRefs: selectedItems,
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
            if (!doRes.ok) {
                addToast('error', doData.error || 'Gagal membuat surat jalan');
                return;
            }

            addToast('success', `Surat Jalan dibuat: ${doData.data?.doNumber || ''}`);
            setShowDOModal(false);
            setSelectedItems([]);
            await loadOrderDetail();
        } catch {
            addToast('error', 'Gagal membuat surat jalan');
        }
    };

    const updateItemStatus = async (itemId: string, newStatus: string) => {
        const res = await fetch('/api/data', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ entity: 'order-items', action: 'update', data: { id: itemId, updates: { status: newStatus } } }),
        });
        const result = await res.json();
        if (!res.ok) {
            addToast('error', result.error || 'Gagal memperbarui status item');
            return;
        }
        setItems(prev => prev.map(i => i._id === itemId ? { ...i, status: newStatus as OrderItem['status'] } : i));

        // Recalculate order status
        const updatedItems = items.map(i => i._id === itemId ? { ...i, status: newStatus } : i);
        const allDelivered = updatedItems.every(i => i.status === 'DELIVERED');
        const anyInProgress = updatedItems.some(i => i.status === 'DELIVERED' || i.status === 'ON_DELIVERY');
        const anyHold = updatedItems.some(i => i.status === 'HOLD');
        let newOrderStatus = order?.status || 'OPEN';
        if (allDelivered) newOrderStatus = 'COMPLETE';
        else if (anyInProgress) newOrderStatus = 'PARTIAL';
        else if (anyHold) newOrderStatus = 'ON_HOLD';
        else newOrderStatus = 'OPEN';

        if (newOrderStatus !== order?.status) {
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
                    <button className="btn-back" onClick={() => router.push('/orders')}><ArrowLeft size={16} /></button>
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
                    <button className="btn btn-secondary" onClick={() => router.push('/invoices/new')}>
                        <FileText size={16} /> Buat Nota
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

            {/* Notas */}
            <div className="card mt-6">
                <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'center' }}>
                    <span className="card-header-title">Nota Ongkos ({notas.length})</span>
                    <span className="text-muted" style={{ fontSize: '0.78rem' }}>Nota dibuat dari DO yang sudah selesai dikirim</span>
                </div>
                <div className="table-wrapper">
                    <table>
                        <thead><tr><th>No. Nota</th><th>Tanggal</th><th>Total</th><th>Status</th><th>Aksi</th></tr></thead>
                        <tbody>
                            {notas.length === 0 ? (
                                <tr>
                                    <td colSpan={5} className="text-center text-muted" style={{ padding: '2rem' }}>
                                        {deliveredDoCount === 0 ? 'Belum ada DO selesai yang bisa ditagihkan' : 'Belum ada nota untuk order ini'}
                                    </td>
                                </tr>
                            ) : notas.map(nota => (
                                <tr key={nota._id}>
                                    <td><Link href={`/invoices/${nota._id}`} className="font-semibold" style={{ color: 'var(--color-primary)' }}>{nota.notaNumber}</Link></td>
                                    <td>{formatDate(nota.issueDate)}</td>
                                    <td className="font-medium">{formatCurrency(nota.totalAmount)}</td>
                                    <td><span className={`badge badge-${INVOICE_STATUS_MAP[nota.status]?.color}`}><span className="badge-dot" /> {INVOICE_STATUS_MAP[nota.status]?.label}</span></td>
                                    <td><Link href={`/invoices/${nota._id}`} className="table-action-btn"><Eye size={14} /> Lihat</Link></td>
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
        </div>
    );
}
