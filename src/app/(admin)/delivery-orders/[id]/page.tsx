'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useToast } from '../../layout';
import { ArrowLeft, Printer, FileDown, Truck, Upload, Save } from 'lucide-react';
import { formatDate, formatDateTime, DO_STATUS_MAP } from '@/lib/utils';
import { generateDOPdf } from '@/lib/pdf/doTemplate';
import type { DeliveryOrder, DeliveryOrderItem, TrackingLog, CompanyProfile } from '@/lib/types';

export default function DODetailPage() {
    const params = useParams();
    const router = useRouter();
    const { addToast } = useToast();
    const [doData, setDoData] = useState<DeliveryOrder | null>(null);
    const [doItems, setDoItems] = useState<DeliveryOrderItem[]>([]);
    const [trackingLogs, setTrackingLogs] = useState<TrackingLog[]>([]);
    const [loading, setLoading] = useState(true);
    const [showStatusModal, setShowStatusModal] = useState(false);
    const [showPODModal, setShowPODModal] = useState(false);
    const [newStatus, setNewStatus] = useState('');
    const [statusNote, setStatusNote] = useState('');
    const [podName, setPodName] = useState('');
    const [podDate, setPodDate] = useState(new Date().toISOString().split('T')[0]);
    const [podNote, setPodNote] = useState('');

    useEffect(() => {
        const id = params.id as string;
        Promise.all([
            fetch(`/api/data?entity=delivery-orders&id=${id}`).then(r => r.json()),
            fetch(`/api/data?entity=delivery-order-items`).then(r => r.json()),
            fetch(`/api/data?entity=tracking-logs`).then(r => r.json()),
        ]).then(([d, items, logs]) => {
            setDoData(d.data);
            setDoItems((items.data || []).filter((i: DeliveryOrderItem) => i.deliveryOrderRef === id));
            setTrackingLogs((logs.data || []).filter((l: TrackingLog) => l.refRef === id && l.refType === 'DO').sort((a: TrackingLog, b: TrackingLog) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()));
            setLoading(false);
        }).catch(() => setLoading(false));
    }, [params.id]);

    const updateDOStatus = async () => {
        if (!newStatus) return;
        await fetch('/api/data', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ entity: 'delivery-orders', action: 'update', data: { id: doData?._id, updates: { status: newStatus } } }),
        });
        // Add tracking log
        await fetch('/api/data', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ entity: 'tracking-logs', data: { refType: 'DO', refRef: doData?._id, status: newStatus, note: statusNote, timestamp: new Date().toISOString() } }),
        });
        // Update order item statuses if DO becomes ON_DELIVERY or DELIVERED
        if (newStatus === 'ON_DELIVERY' || newStatus === 'DELIVERED') {
            for (const doi of doItems) {
                await fetch('/api/data', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ entity: 'order-items', action: 'update', data: { id: doi.orderItemRef, updates: { status: newStatus === 'ON_DELIVERY' ? 'ON_DELIVERY' : 'DELIVERED' } } }),
                });
            }
        }
        setDoData(prev => prev ? { ...prev, status: newStatus as DeliveryOrder['status'] } : prev);
        setTrackingLogs(prev => [...prev, { _id: 'new', _type: 'trackingLog', refType: 'DO', refRef: doData?._id || '', status: newStatus, note: statusNote, timestamp: new Date().toISOString() }]);
        setShowStatusModal(false);
        setStatusNote('');
        addToast('success', `Status DO diperbarui ke ${DO_STATUS_MAP[newStatus]?.label || newStatus}`);
    };

    const savePOD = async () => {
        await fetch('/api/data', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ entity: 'delivery-orders', action: 'update', data: { id: doData?._id, updates: { podReceiverName: podName, podReceivedDate: podDate, podNote } } }),
        });
        setDoData(prev => prev ? { ...prev, podReceiverName: podName, podReceivedDate: podDate, podNote } : prev);
        setShowPODModal(false);
        addToast('success', 'POD berhasil disimpan');
    };

    const handlePrint = () => window.print();

    const handleExportPDF = async () => {
        try {
            const companyRes = await fetch('/api/data?entity=company');
            const companyData = await companyRes.json();
            generateDOPdf(doData!, doItems, companyData.data as CompanyProfile);
            addToast('success', 'PDF Surat Jalan berhasil di-download');
        } catch (err) {
            console.error('PDF Export Error:', err);
            addToast('error', `Gagal membuat PDF: ${err instanceof Error ? err.message : 'Unknown error'}`);
        }
    };

    const getNextStatuses = (current: string): string[] => {
        const transitions: Record<string, string[]> = {
            CREATED: ['ON_DELIVERY', 'CANCELLED'],
            ON_DELIVERY: ['DELIVERED', 'CANCELLED'],
        };
        return transitions[current] || [];
    };

    if (loading) return <div><div className="skeleton skeleton-title" /><div className="skeleton skeleton-card" style={{ height: 200 }} /></div>;
    if (!doData) return <div className="empty-state"><div className="empty-state-title">Surat Jalan tidak ditemukan</div></div>;

    const nextStatuses = getNextStatuses(doData.status);

    return (
        <div>
            <div className="page-header">
                <div className="page-header-left">
                    <button className="btn btn-ghost btn-sm mb-2" onClick={() => router.push('/delivery-orders')}>
                        <ArrowLeft size={16} /> Kembali
                    </button>
                    <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        {doData.doNumber}
                        <span className={`badge badge-${DO_STATUS_MAP[doData.status]?.color}`}>
                            <span className="badge-dot" /> {DO_STATUS_MAP[doData.status]?.label}
                        </span>
                    </h1>
                </div>
                <div className="page-actions">
                    {nextStatuses.length > 0 && (
                        <button className="btn btn-primary" onClick={() => setShowStatusModal(true)}>
                            <Truck size={16} /> Ubah Status
                        </button>
                    )}
                    {doData.status === 'DELIVERED' && !doData.podReceiverName && (
                        <button className="btn btn-success" onClick={() => setShowPODModal(true)}>
                            <Upload size={16} /> Upload POD
                        </button>
                    )}
                    <button className="btn btn-secondary" onClick={handleExportPDF}>
                        <FileDown size={16} /> Export PDF
                    </button>
                    <button className="btn btn-secondary" onClick={handlePrint}>
                        <Printer size={16} /> Print
                    </button>
                </div>
            </div>

            <div className="detail-grid">
                <div className="card">
                    <div className="card-header"><span className="card-header-title">Informasi Surat Jalan</span></div>
                    <div className="card-body">
                        <div className="detail-row">
                            <div className="detail-item"><div className="detail-label">No. DO</div><div className="detail-value font-mono">{doData.doNumber}</div></div>
                            <div className="detail-item"><div className="detail-label">Tanggal</div><div className="detail-value">{formatDate(doData.date)}</div></div>
                        </div>
                        <div className="detail-row">
                            <div className="detail-item"><div className="detail-label">Master Resi</div><div className="detail-value"><Link href={`/orders/${doData.orderRef}`}>{doData.masterResi}</Link></div></div>
                            <div className="detail-item"><div className="detail-label">Kendaraan</div><div className="detail-value">{doData.vehiclePlate || '-'}</div></div>
                        </div>
                        <div className="detail-row">
                            <div className="detail-item"><div className="detail-label">Driver</div><div className="detail-value">{doData.driverName || '-'}</div></div>
                            <div className="detail-item"><div className="detail-label">Customer</div><div className="detail-value">{doData.customerName || '-'}</div></div>
                        </div>
                        {doData.notes && <div className="mt-2"><div className="detail-label">Catatan</div><div className="detail-value">{doData.notes}</div></div>}
                    </div>
                </div>

                <div className="card">
                    <div className="card-header"><span className="card-header-title">Penerima</span></div>
                    <div className="card-body">
                        <div className="detail-item"><div className="detail-label">Nama</div><div className="detail-value">{doData.receiverName || '-'}</div></div>
                        <div className="detail-item mt-2"><div className="detail-label">Alamat</div><div className="detail-value">{doData.receiverAddress || '-'}</div></div>
                    </div>
                    {doData.podReceiverName && (
                        <div className="card-body" style={{ borderTop: '1px solid var(--color-gray-100)', background: 'var(--color-success-light)' }}>
                            <div className="form-section-title" style={{ color: 'var(--color-success)' }}>Proof of Delivery (POD)</div>
                            <div className="detail-row">
                                <div className="detail-item"><div className="detail-label">Diterima Oleh</div><div className="detail-value">{doData.podReceiverName}</div></div>
                                <div className="detail-item"><div className="detail-label">Tanggal Terima</div><div className="detail-value">{formatDate(doData.podReceivedDate)}</div></div>
                            </div>
                            {doData.podNote && <div className="mt-2"><div className="detail-label">Catatan</div><div className="detail-value">{doData.podNote}</div></div>}
                        </div>
                    )}
                </div>
            </div>

            {/* Items */}
            <div className="card mt-6">
                <div className="card-header"><span className="card-header-title">Item dalam DO ({doItems.length})</span></div>
                <div className="table-wrapper">
                    <table>
                        <thead><tr><th>Deskripsi</th><th>Koli</th><th>Berat (kg)</th></tr></thead>
                        <tbody>
                            {doItems.map(item => (
                                <tr key={item._id}>
                                    <td className="font-medium">{item.orderItemDescription}</td>
                                    <td>{item.orderItemQtyKoli}</td>
                                    <td>{item.orderItemWeight} kg</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Tracking Timeline */}
            <div className="card mt-6">
                <div className="card-header"><span className="card-header-title">Tracking Log</span></div>
                <div className="card-body">
                    {trackingLogs.length === 0 ? (
                        <p className="text-muted text-sm text-center" style={{ padding: '1rem' }}>Belum ada tracking log</p>
                    ) : (
                        <div className="timeline">
                            {trackingLogs.map((log, idx) => (
                                <div key={log._id || idx} className="timeline-item">
                                    <div className={`timeline-dot ${log.status === 'DELIVERED' ? 'success' : log.status === 'ON_DELIVERY' ? 'active' : ''}`} />
                                    <div className="timeline-content">
                                        <div className="timeline-title">{DO_STATUS_MAP[log.status]?.label || log.status}</div>
                                        <div className="timeline-meta">{formatDateTime(log.timestamp)} {log.locationText ? `- ${log.locationText}` : ''}</div>
                                        {log.note && <div className="timeline-text">{log.note}</div>}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* Status Modal */}
            {showStatusModal && (
                <div className="modal-overlay" onClick={() => setShowStatusModal(false)}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3 className="modal-title">Ubah Status DO</h3>
                            <button className="modal-close" onClick={() => setShowStatusModal(false)}>&times;</button>
                        </div>
                        <div className="modal-body">
                            <div className="form-group">
                                <label className="form-label">Status Baru</label>
                                <select className="form-select" value={newStatus} onChange={e => setNewStatus(e.target.value)}>
                                    <option value="">Pilih status</option>
                                    {nextStatuses.map(s => <option key={s} value={s}>{DO_STATUS_MAP[s]?.label || s}</option>)}
                                </select>
                            </div>
                            <div className="form-group">
                                <label className="form-label">Catatan</label>
                                <textarea className="form-textarea" rows={3} value={statusNote} onChange={e => setStatusNote(e.target.value)} placeholder="Catatan tracking..." />
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setShowStatusModal(false)}>Batal</button>
                            <button className="btn btn-primary" onClick={updateDOStatus} disabled={!newStatus}>
                                <Save size={16} /> Simpan
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* POD Modal */}
            {showPODModal && (
                <div className="modal-overlay" onClick={() => setShowPODModal(false)}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header"><h3 className="modal-title">Upload Proof of Delivery</h3></div>
                        <div className="modal-body">
                            <div className="form-group">
                                <label className="form-label">Nama Penerima</label>
                                <input className="form-input" value={podName} onChange={e => setPodName(e.target.value)} />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Tanggal Terima</label>
                                <input type="date" className="form-input" value={podDate} onChange={e => setPodDate(e.target.value)} />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Catatan</label>
                                <textarea className="form-textarea" rows={2} value={podNote} onChange={e => setPodNote(e.target.value)} />
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setShowPODModal(false)}>Batal</button>
                            <button className="btn btn-success" onClick={savePOD}><Upload size={16} /> Simpan POD</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
