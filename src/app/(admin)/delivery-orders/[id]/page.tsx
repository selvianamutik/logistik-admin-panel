'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useToast } from '../../layout';
import { ArrowLeft, Printer, FileDown, Truck, Upload, Save, MapPin, Radio } from 'lucide-react';
import { fetchCompanyProfile, openBrandedPrint } from '@/lib/print';
import { formatDate, formatDateTime, DO_STATUS_MAP } from '@/lib/utils';
import { generateDOPdf } from '@/lib/pdf/doTemplate';
import type { DeliveryOrder, DeliveryOrderItem, TrackingLog, CompanyProfile } from '@/lib/types';

export default function DODetailPage() {
    const params = useParams();
    const router = useRouter();
    const { addToast } = useToast();
    const doId = params.id as string;
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
    const [editingTarip, setEditingTarip] = useState(false);
    const [taripBorongan, setTaripBorongan] = useState<number>(0);
    const [keteranganBorongan, setKeteranganBorongan] = useState('');
    const [savingTarip, setSavingTarip] = useState(false);

    const fetchEntity = useCallback(async <T,>(url: string) => {
        const res = await fetch(url);
        const result = await res.json();
        if (!res.ok) {
            throw new Error(result.error || 'Gagal memuat detail surat jalan');
        }
        return result.data as T;
    }, []);

    const loadDO = useCallback(async (mode: 'initial' | 'refresh' = 'refresh') => {
        if (mode === 'initial') {
            setLoading(true);
        }

        try {
            const [deliveryOrder, itemRows, logRows] = await Promise.all([
                fetchEntity<DeliveryOrder | null>(`/api/data?entity=delivery-orders&id=${doId}`),
                fetchEntity<DeliveryOrderItem[]>(`/api/data?entity=delivery-order-items&filter=${encodeURIComponent(JSON.stringify({ deliveryOrderRef: doId }))}`),
                fetchEntity<TrackingLog[]>(`/api/data?entity=tracking-logs&filter=${encodeURIComponent(JSON.stringify({ refRef: doId, refType: 'DO' }))}`),
            ]);

            setDoData(deliveryOrder);
            setTaripBorongan(deliveryOrder?.taripBorongan || 0);
            setKeteranganBorongan(deliveryOrder?.keteranganBorongan || '');
            setDoItems(itemRows || []);
            setTrackingLogs((logRows || []).sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()));
        } catch (error) {
            addToast('error', error instanceof Error ? error.message : 'Gagal memuat detail surat jalan');
        } finally {
            if (mode === 'initial') {
                setLoading(false);
            }
        }
    }, [addToast, doId, fetchEntity]);

    useEffect(() => {
        void loadDO('initial');
    }, [loadDO]);

    useEffect(() => {
        const intervalId = window.setInterval(() => {
            void loadDO();
        }, 15000);

        return () => window.clearInterval(intervalId);
    }, [loadDO]);

    const updateDOStatus = async () => {
        if (!newStatus) return;
        const res = await fetch('/api/data', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ entity: 'delivery-orders', action: 'set-status', data: { id: doData?._id, status: newStatus, note: statusNote } }),
        });
        const d = await res.json();
        if (!res.ok) {
            addToast('error', d.error || 'Gagal memperbarui status surat jalan');
            return;
        }

        setDoData(prev => prev ? { ...prev, status: newStatus as DeliveryOrder['status'] } : prev);
        setTrackingLogs(prev => [...prev, {
            _id: 'new-' + Date.now(),
            _type: 'trackingLog',
            refType: 'DO',
            refRef: doData?._id || '',
            status: newStatus,
            note: statusNote || undefined,
            timestamp: new Date().toISOString(),
        }]);
        setShowStatusModal(false);
        setStatusNote('');
        addToast('success', `Status DO diperbarui ke ${DO_STATUS_MAP[newStatus]?.label || newStatus}`);
    };

    const savePOD = async () => {
        const res = await fetch('/api/data', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ entity: 'delivery-orders', action: 'update', data: { id: doData?._id, updates: { podReceiverName: podName, podReceivedDate: podDate, podNote } } }),
        });
        const result = await res.json();
        if (!res.ok) {
            addToast('error', result.error || 'Gagal menyimpan POD');
            return;
        }
        setDoData(prev => prev ? { ...prev, podReceiverName: podName, podReceivedDate: podDate, podNote } : prev);
        setShowPODModal(false);
        addToast('success', 'POD berhasil disimpan');
    };

    const handlePrint = async () => {
        try {
            const company = await fetchCompanyProfile();
            openBrandedPrint({
                title: 'Surat Jalan',
                subtitle: doData?.doNumber,
                company,
                bodyHtml: `
                    <div style="margin-bottom:16px">
                        <table style="width:100%;border:none"><tbody>
                            <tr>
                                <td style="border:none;padding:2px 8px;width:140px;font-weight:600">No. DO</td>
                                <td style="border:none;padding:2px 8px">${doData?.doNumber || '-'}</td>
                                <td style="border:none;padding:2px 8px;width:140px;font-weight:600">Tanggal</td>
                                <td style="border:none;padding:2px 8px">${formatDate(doData?.date || '')}</td>
                            </tr>
                            <tr>
                                <td style="border:none;padding:2px 8px;font-weight:600">Master Resi</td>
                                <td style="border:none;padding:2px 8px">${doData?.masterResi || '-'}</td>
                                <td style="border:none;padding:2px 8px;font-weight:600">Status</td>
                                <td style="border:none;padding:2px 8px">${DO_STATUS_MAP[doData?.status || '']?.label || doData?.status || '-'}</td>
                            </tr>
                            <tr>
                                <td style="border:none;padding:2px 8px;font-weight:600">Customer</td>
                                <td style="border:none;padding:2px 8px">${doData?.customerName || '-'}</td>
                                <td style="border:none;padding:2px 8px;font-weight:600">Kendaraan</td>
                                <td style="border:none;padding:2px 8px">${doData?.vehiclePlate || '-'}</td>
                            </tr>
                            <tr>
                                <td style="border:none;padding:2px 8px;font-weight:600">Driver</td>
                                <td style="border:none;padding:2px 8px">${doData?.driverName || '-'}</td>
                                <td style="border:none;padding:2px 8px;font-weight:600">Penerima</td>
                                <td style="border:none;padding:2px 8px">${doData?.receiverName || '-'}</td>
                            </tr>
                            <tr>
                                <td style="border:none;padding:2px 8px;font-weight:600">Alamat Penerima</td>
                                <td colspan="3" style="border:none;padding:2px 8px">${doData?.receiverAddress || '-'}</td>
                            </tr>
                            ${doData?.notes ? `<tr><td style="border:none;padding:2px 8px;font-weight:600">Catatan</td><td colspan="3" style="border:none;padding:2px 8px">${doData.notes}</td></tr>` : ''}
                            ${doData?.podReceiverName ? `<tr><td style="border:none;padding:2px 8px;font-weight:600">POD</td><td colspan="3" style="border:none;padding:2px 8px">Diterima oleh ${doData.podReceiverName} pada ${formatDate(doData.podReceivedDate || '')}${doData.podNote ? ` - ${doData.podNote}` : ''}</td></tr>` : ''}
                        </tbody></table>
                    </div>
                    <div class="section-title">Detail Barang</div>
                    <table>
                        <thead>
                            <tr>
                                <th>No</th>
                                <th>Deskripsi</th>
                                <th class="r">Koli</th>
                                <th class="r">Berat</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${doItems.map((item, index) => `
                                <tr>
                                    <td>${index + 1}</td>
                                    <td>${item.orderItemDescription || '-'}</td>
                                    <td class="r">${item.orderItemQtyKoli || 0}</td>
                                    <td class="r">${item.orderItemWeight || 0} kg</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                    <div class="section-title">Timeline Pengiriman</div>
                    <table>
                        <thead>
                            <tr>
                                <th>Waktu</th>
                                <th>Status</th>
                                <th>Catatan</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${trackingLogs.length > 0 ? trackingLogs.map((item) => `
                                <tr>
                                    <td>${formatDateTime(item.timestamp)}</td>
                                    <td>${DO_STATUS_MAP[item.status]?.label || item.status || '-'}</td>
                                    <td>${item.note || '-'}</td>
                                </tr>
                            `).join('') : '<tr><td colspan="3" class="c">Belum ada log tracking</td></tr>'}
                        </tbody>
                    </table>
                `,
            });
        } catch {
            addToast('error', 'Gagal menyiapkan dokumen cetak');
        }
    };

    const handleExportPDF = async () => {
        try {
            const companyRes = await fetch('/api/data?entity=company');
            const companyData = await companyRes.json();
            if (!companyRes.ok || !companyData.data) {
                throw new Error(companyData.error || 'Profil perusahaan tidak tersedia');
            }
            generateDOPdf(doData!, doItems, companyData.data as CompanyProfile);
            addToast('success', 'PDF Surat Jalan berhasil di-download');
        } catch (err) {
            console.error('PDF Export Error:', err);
            addToast('error', `Gagal membuat PDF: ${err instanceof Error ? err.message : 'Unknown error'}`);
        }
    };

    const saveTaripBorongan = async () => {
        setSavingTarip(true);
        const res = await fetch('/api/data', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ entity: 'delivery-orders', action: 'update', data: { id: doData?._id, updates: { taripBorongan, keteranganBorongan } } }),
        });
        const result = await res.json();
        if (!res.ok) {
            addToast('error', result.error || 'Gagal menyimpan tarip borongan');
            setSavingTarip(false);
            return;
        }
        setDoData(prev => prev ? { ...prev, taripBorongan, keteranganBorongan } : prev);
        setEditingTarip(false);
        setSavingTarip(false);
        addToast('success', 'Tarip borongan disimpan');
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
    const hasLiveCoordinates = typeof doData.trackingLastLat === 'number' && typeof doData.trackingLastLng === 'number';
    const trackingMapUrl = hasLiveCoordinates ? `https://www.google.com/maps?q=${doData.trackingLastLat},${doData.trackingLastLng}` : null;
    const trackingLat = hasLiveCoordinates ? doData.trackingLastLat as number : null;
    const trackingLng = hasLiveCoordinates ? doData.trackingLastLng as number : null;
    const mapEmbedUrl = hasLiveCoordinates
        ? `https://www.openstreetmap.org/export/embed.html?bbox=${trackingLng! - 0.01},${trackingLat! - 0.01},${trackingLng! + 0.01},${trackingLat! + 0.01}&layer=mapnik&marker=${trackingLat!},${trackingLng!}`
        : null;

    return (
        <div>
            <div className="page-header">
                <div className="page-header-left" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <button className="btn-back" onClick={() => router.push('/delivery-orders')}>
                        <ArrowLeft size={16} />
                    </button>
                    <div>
                        <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                            {doData.doNumber}
                            <span className={`badge badge-${DO_STATUS_MAP[doData.status]?.color}`}>
                                <span className="badge-dot" /> {DO_STATUS_MAP[doData.status]?.label}
                            </span>
                        </h1>
                    </div>
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

            <div className="card" style={{ marginTop: '1rem' }}>
                <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span className="card-header-title">Live Tracking Driver</span>
                    <span className={`badge ${doData.trackingState === 'ACTIVE' ? 'badge-info' : doData.trackingState === 'PAUSED' ? 'badge-warning' : 'badge-gray'}`}>
                        <Radio size={12} /> {doData.trackingState || 'IDLE'}
                    </span>
                </div>
                <div className="card-body">
                    <div className="detail-row">
                        <div className="detail-item">
                            <div className="detail-label">Posisi terakhir</div>
                            <div className="detail-value">{doData.trackingLastSeenAt ? formatDateTime(doData.trackingLastSeenAt) : 'Belum ada update dari driver app'}</div>
                        </div>
                        <div className="detail-item">
                            <div className="detail-label">Akurasi GPS</div>
                            <div className="detail-value">{typeof doData.trackingLastAccuracyM === 'number' ? `${Math.round(doData.trackingLastAccuracyM)} meter` : '-'}</div>
                        </div>
                    </div>
                    <div className="detail-row">
                        <div className="detail-item">
                            <div className="detail-label">Koordinat</div>
                            <div className="detail-value">
                                {hasLiveCoordinates ? `${doData.trackingLastLat?.toFixed(6)}, ${doData.trackingLastLng?.toFixed(6)}` : '-'}
                            </div>
                        </div>
                        <div className="detail-item">
                            <div className="detail-label">Kecepatan terakhir</div>
                            <div className="detail-value">{typeof doData.trackingLastSpeedKph === 'number' ? `${doData.trackingLastSpeedKph} km/jam` : '-'}</div>
                        </div>
                    </div>
                    {trackingMapUrl && (
                        <div style={{ marginTop: '1rem', display: 'grid', gap: '0.75rem' }}>
                            <a href={trackingMapUrl} target="_blank" rel="noreferrer" className="btn btn-secondary btn-sm" style={{ width: 'fit-content' }}>
                                <MapPin size={14} /> Buka di Google Maps
                            </a>
                            {mapEmbedUrl && (
                                <iframe
                                    title="Peta posisi driver"
                                    src={mapEmbedUrl}
                                    style={{ width: '100%', minHeight: 260, border: '1px solid var(--color-gray-200)', borderRadius: '12px' }}
                                    loading="lazy"
                                />
                            )}
                        </div>
                    )}
                </div>
            </div>

            {/* Borongan Tarip - Set Sebelum Berangkat */}
            <div className="card" style={{ marginTop: '1rem', border: '1.5px solid var(--color-warning-light)' }}>
                <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--color-warning-light)' }}>
                    <span className="card-header-title" style={{ color: 'var(--color-warning)' }}>🚛 Tarip Borongan Supir</span>
                    {!editingTarip && (
                        <button className="btn btn-sm btn-secondary" onClick={() => setEditingTarip(true)}>Edit Tarip</button>
                    )}
                </div>
                <div className="card-body">
                    {!editingTarip ? (
                        <div className="detail-row">
                            <div className="detail-item">
                                <div className="detail-label">Tarip per kg</div>
                                <div className="detail-value font-semibold" style={{ color: doData.taripBorongan ? 'var(--color-primary)' : 'var(--color-gray-400)' }}>
                                    {doData.taripBorongan ? `Rp ${doData.taripBorongan.toLocaleString('id')}/kg` : '— Belum diisi —'}
                                </div>
                            </div>
                            <div className="detail-item">
                                <div className="detail-label">Keterangan</div>
                                <div className="detail-value">{doData.keteranganBorongan || '-'}</div>
                            </div>
                        </div>
                    ) : (
                        <div>
                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label">Tarip per kg (Rp) <span className="required">*</span></label>
                                    <input type="number" className="form-input" value={taripBorongan || ''} onChange={e => setTaripBorongan(Number(e.target.value))} placeholder="Contoh: 50" />
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Keterangan</label>
                                    <input className="form-input" value={keteranganBorongan} onChange={e => setKeteranganBorongan(e.target.value)} placeholder="Opsional..." />
                                </div>
                            </div>
                            <div style={{ display: 'flex', gap: '0.5rem' }}>
                                <button className="btn btn-primary btn-sm" onClick={saveTaripBorongan} disabled={savingTarip}>
                                    <Save size={14} /> {savingTarip ? 'Menyimpan...' : 'Simpan Tarip'}
                                </button>
                                <button className="btn btn-secondary btn-sm" onClick={() => setEditingTarip(false)}>Batal</button>
                            </div>
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
