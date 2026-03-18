'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useToast } from '../../layout';
import { ArrowLeft, Printer, FileDown, Truck, Upload, Save, MapPin, Radio } from 'lucide-react';
import { fetchCompanyProfile, openBrandedPrint } from '@/lib/print';
import { formatDate, formatDateTime, DO_STATUS_MAP } from '@/lib/utils';
import {
    formatCargoSummary,
    VOLUME_INPUT_UNIT_OPTIONS,
    WEIGHT_INPUT_UNIT_OPTIONS,
    type VolumeInputUnit,
    type WeightInputUnit,
} from '@/lib/measurement';
import { generateDOPdf } from '@/lib/pdf/doTemplate';
import type { DeliveryOrder, DeliveryOrderItem, TrackingLog, CompanyProfile, Order } from '@/lib/types';

interface ActualCargoDraft {
    deliveryOrderItemRef: string;
    description: string;
    plannedQtyKoli: number;
    plannedWeightKg: number;
    plannedWeightInputValue?: number;
    plannedWeightInputUnit?: WeightInputUnit;
    plannedVolumeM3?: number;
    plannedVolumeInputValue?: number;
    plannedVolumeInputUnit?: VolumeInputUnit;
    actualQtyKoli: string;
    actualWeightInputValue: string;
    actualWeightInputUnit: WeightInputUnit;
    actualVolumeInputValue: string;
    actualVolumeInputUnit: VolumeInputUnit;
    requireWeight: boolean;
    requireVolume: boolean;
}

function buildActualCargoDraft(item: DeliveryOrderItem): ActualCargoDraft {
    return {
        deliveryOrderItemRef: item._id,
        description: item.orderItemDescription || '-',
        plannedQtyKoli: Number(item.orderItemQtyKoli || item.shippedQtyKoli || 0),
        plannedWeightKg: Number(item.orderItemWeight || item.shippedWeight || 0),
        plannedWeightInputValue: item.orderItemWeightInputValue,
        plannedWeightInputUnit: item.orderItemWeightInputUnit,
        plannedVolumeM3: item.orderItemVolumeM3,
        plannedVolumeInputValue: item.orderItemVolumeInputValue,
        plannedVolumeInputUnit: item.orderItemVolumeInputUnit,
        actualQtyKoli: String(item.actualQtyKoli ?? item.orderItemQtyKoli ?? item.shippedQtyKoli ?? 0),
        actualWeightInputValue: String(item.actualWeightInputValue ?? item.orderItemWeightInputValue ?? item.actualWeightKg ?? item.orderItemWeight ?? item.shippedWeight ?? ''),
        actualWeightInputUnit: item.actualWeightInputUnit || item.orderItemWeightInputUnit || 'KG',
        actualVolumeInputValue: String(item.actualVolumeInputValue ?? item.orderItemVolumeInputValue ?? item.actualVolumeM3 ?? item.orderItemVolumeM3 ?? ''),
        actualVolumeInputUnit: item.actualVolumeInputUnit || item.orderItemVolumeInputUnit || 'M3',
        requireWeight: Number(item.orderItemWeight || item.shippedWeight || 0) > 0,
        requireVolume: Number(item.orderItemVolumeM3 || 0) > 0,
    };
}

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
    const [actualCargoItems, setActualCargoItems] = useState<ActualCargoDraft[]>([]);
    const [editingTarip, setEditingTarip] = useState(false);
    const [taripBorongan, setTaripBorongan] = useState<number>(0);
    const [keteranganBorongan, setKeteranganBorongan] = useState('');
    const [updatingStatus, setUpdatingStatus] = useState(false);
    const [savingPOD, setSavingPOD] = useState(false);
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
            const deliveryOrder = await fetchEntity<DeliveryOrder | null>(`/api/data?entity=delivery-orders&id=${doId}`);
            const [itemRows, logRows, sourceOrder] = await Promise.all([
                fetchEntity<DeliveryOrderItem[]>(`/api/data?entity=delivery-order-items&filter=${encodeURIComponent(JSON.stringify({ deliveryOrderRef: doId }))}`),
                fetchEntity<TrackingLog[]>(`/api/data?entity=tracking-logs&filter=${encodeURIComponent(JSON.stringify({ refRef: doId, refType: 'DO' }))}`),
                deliveryOrder?.orderRef
                    ? fetchEntity<Order | null>(`/api/data?entity=orders&id=${deliveryOrder.orderRef}`)
                    : Promise.resolve(null),
            ]);

            const resolvedDeliveryOrder = deliveryOrder ? {
                ...deliveryOrder,
                customerName: deliveryOrder.customerName || sourceOrder?.customerName,
                receiverName: deliveryOrder.receiverName || sourceOrder?.receiverName,
                receiverPhone: deliveryOrder.receiverPhone || sourceOrder?.receiverPhone,
                receiverAddress: deliveryOrder.receiverAddress || sourceOrder?.receiverAddress,
                receiverCompany: deliveryOrder.receiverCompany || sourceOrder?.receiverCompany,
                pickupAddress: deliveryOrder.pickupAddress || sourceOrder?.pickupAddress,
                serviceRef: deliveryOrder.serviceRef || sourceOrder?.serviceRef,
                serviceName: deliveryOrder.serviceName || sourceOrder?.serviceName,
            } : null;

            setDoData(resolvedDeliveryOrder);
            setTaripBorongan(resolvedDeliveryOrder?.taripBorongan || 0);
            setKeteranganBorongan(resolvedDeliveryOrder?.keteranganBorongan || '');
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

    const openStatusModal = () => {
        setNewStatus('');
        setStatusNote('');
        setPodName('');
        setPodDate(new Date().toISOString().split('T')[0]);
        setPodNote('');
        setActualCargoItems(doItems.map(buildActualCargoDraft));
        setShowStatusModal(true);
    };

    const updateActualCargoDraft = (
        deliveryOrderItemRef: string,
        field: keyof Pick<ActualCargoDraft, 'actualQtyKoli' | 'actualWeightInputValue' | 'actualWeightInputUnit' | 'actualVolumeInputValue' | 'actualVolumeInputUnit'>,
        value: string
    ) => {
        setActualCargoItems(previous =>
            previous.map(item =>
                item.deliveryOrderItemRef === deliveryOrderItemRef
                    ? { ...item, [field]: value }
                    : item
            )
        );
    };

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
        const completingDelivery = newStatus === 'DELIVERED';
        setUpdatingStatus(true);
        try {
            const res = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    entity: 'delivery-orders',
                    action: 'set-status',
                    data: {
                        id: doData?._id,
                        status: newStatus,
                        note: statusNote,
                        ...(completingDelivery
                            ? {
                                podReceiverName: podName,
                                podReceivedDate: podDate,
                                podNote,
                                actualItems: actualCargoItems.map(item => ({
                                    deliveryOrderItemRef: item.deliveryOrderItemRef,
                                    actualQtyKoli: Number(item.actualQtyKoli),
                                    actualWeightInputValue: Number(item.actualWeightInputValue),
                                    actualWeightInputUnit: item.actualWeightInputUnit,
                                    actualVolumeInputValue: item.actualVolumeInputValue.trim()
                                        ? Number(item.actualVolumeInputValue)
                                        : 0,
                                    actualVolumeInputUnit: item.actualVolumeInputUnit,
                                })),
                            }
                            : {}),
                    },
                }),
            });
            const d = await res.json();
            if (!res.ok) {
                addToast('error', d.error || 'Gagal memperbarui status surat jalan');
                return;
            }

            setTrackingLogs(prev => [...prev, {
                _id: 'new-' + Date.now(),
                _type: 'trackingLog',
                refType: 'DO',
                refRef: doData?._id || '',
                status: newStatus,
                note: statusNote || undefined,
                timestamp: new Date().toISOString(),
            }]);
            await loadDO();
            setShowStatusModal(false);
            setNewStatus('');
            setStatusNote('');
            if (completingDelivery) {
                setPodName('');
                setPodDate(new Date().toISOString().split('T')[0]);
                setPodNote('');
                setActualCargoItems([]);
                addToast('success', 'Surat jalan diselesaikan dan POD tersimpan');
            } else {
                addToast('success', `Status DO diperbarui ke ${DO_STATUS_MAP[newStatus]?.label || newStatus}`);
            }
        } catch {
            addToast('error', 'Gagal memperbarui status surat jalan');
        } finally {
            setUpdatingStatus(false);
        }
    };

    const savePOD = async () => {
        setSavingPOD(true);
        try {
            const res = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    entity: 'delivery-orders',
                    action: 'update',
                    data: {
                        id: doData?._id,
                        updates: {
                            podReceiverName: podName,
                            podReceivedDate: podDate,
                            podNote,
                        },
                    },
                }),
            });
            const result = await res.json();
            if (!res.ok) {
                addToast('error', result.error || 'Gagal menyimpan POD');
                return;
            }
            setDoData(prev => prev ? { ...prev, podReceiverName: podName, podReceivedDate: podDate, podNote } : prev);
            setShowPODModal(false);
            setPodName('');
            setPodDate(new Date().toISOString().split('T')[0]);
            setPodNote('');
            addToast('success', 'POD berhasil disimpan');
        } catch {
            addToast('error', 'Gagal menyimpan POD');
        } finally {
            setSavingPOD(false);
        }
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
                                <td style="border:none;padding:2px 8px;font-weight:600">Telepon Penerima</td>
                                <td style="border:none;padding:2px 8px">${doData?.receiverPhone || '-'}</td>
                                <td style="border:none;padding:2px 8px;font-weight:600">Kategori Armada</td>
                                <td style="border:none;padding:2px 8px">${doData?.serviceName || '-'}</td>
                            </tr>
                            ${doData?.receiverCompany ? `<tr><td style="border:none;padding:2px 8px;font-weight:600">Perusahaan Penerima</td><td colspan="3" style="border:none;padding:2px 8px">${doData.receiverCompany}</td></tr>` : ''}
                            <tr>
                                <td style="border:none;padding:2px 8px;font-weight:600">Alamat Pickup</td>
                                <td colspan="3" style="border:none;padding:2px 8px">${doData?.pickupAddress || '-'}</td>
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
                                <th>Muatan</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${doItems.map((item, index) => `
                                <tr>
                                    <td>${index + 1}</td>
                                    <td>${item.orderItemDescription || '-'}</td>
                                    <td class="r">${item.actualQtyKoli ?? item.orderItemQtyKoli ?? 0}</td>
                                    <td>${formatCargoSummary(
                                        item.actualQtyKoli !== undefined || item.actualWeightKg !== undefined || item.actualVolumeM3 !== undefined
                                            ? {
                                                qtyKoli: item.actualQtyKoli,
                                                weightKg: item.actualWeightKg,
                                                weightInputValue: item.actualWeightInputValue,
                                                weightInputUnit: item.actualWeightInputUnit,
                                                volumeM3: item.actualVolumeM3,
                                                volumeInputValue: item.actualVolumeInputValue,
                                                volumeInputUnit: item.actualVolumeInputUnit,
                                            }
                                            : {
                                                qtyKoli: item.orderItemQtyKoli,
                                                weightKg: item.orderItemWeight,
                                                weightInputValue: item.orderItemWeightInputValue,
                                                weightInputUnit: item.orderItemWeightInputUnit,
                                                volumeM3: item.orderItemVolumeM3,
                                                volumeInputValue: item.orderItemVolumeInputValue,
                                                volumeInputUnit: item.orderItemVolumeInputUnit,
                                            }
                                    )}</td>
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
        try {
            const res = await fetch('/api/data', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ entity: 'delivery-orders', action: 'update', data: { id: doData?._id, updates: { taripBorongan, keteranganBorongan } } }),
            });
            const result = await res.json();
            if (!res.ok) {
                addToast('error', result.error || 'Gagal menyimpan tarip borongan');
                return;
            }
            setDoData(prev => prev ? { ...prev, taripBorongan, keteranganBorongan } : prev);
            setEditingTarip(false);
            addToast('success', 'Tarip borongan disimpan');
        } catch {
            addToast('error', 'Gagal menyimpan tarip borongan');
        } finally {
            setSavingTarip(false);
        }
    };

    const getNextStatuses = (current: string): string[] => {
        const transitions: Record<string, string[]> = {
            CREATED: ['HEADING_TO_PICKUP', 'ON_DELIVERY', 'CANCELLED'],
            HEADING_TO_PICKUP: ['ON_DELIVERY', 'CANCELLED'],
            ON_DELIVERY: ['ARRIVED', 'DELIVERED', 'CANCELLED'],
            ARRIVED: ['DELIVERED', 'CANCELLED'],
        };
        return transitions[current] || [];
    };

    if (loading) return <div><div className="skeleton skeleton-title" /><div className="skeleton skeleton-card" style={{ height: 200 }} /></div>;
    if (!doData) return <div className="empty-state"><div className="empty-state-title">Surat Jalan tidak ditemukan</div></div>;

    const nextStatuses = getNextStatuses(doData.status);
    const isCompletingDelivery = newStatus === 'DELIVERED';
    const actualCargoReady = actualCargoItems.every(item => {
        const qty = Number(item.actualQtyKoli);
        const weight = Number(item.actualWeightInputValue);
        const volume = Number(item.actualVolumeInputValue);
        return (
            Number.isFinite(qty) &&
            qty > 0 &&
            (!item.requireWeight || (Number.isFinite(weight) && weight > 0)) &&
            (!item.requireVolume || (Number.isFinite(volume) && volume > 0))
        );
    });
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
                        <button className="btn btn-primary" onClick={openStatusModal}>
                            <Truck size={16} /> {nextStatuses.includes('DELIVERED') ? 'Lanjut / Selesaikan DO' : 'Ubah Status'}
                        </button>
                    )}
                    {doData.status === 'DELIVERED' && !doData.podReceiverName && (
                        <button
                            className="btn btn-success"
                            onClick={() => {
                                setPodName('');
                                setPodDate(new Date().toISOString().split('T')[0]);
                                setPodNote('');
                                setShowPODModal(true);
                            }}
                        >
                            <Upload size={16} /> Lengkapi POD
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
                        <div className="detail-row">
                            <div className="detail-item"><div className="detail-label">Kategori Truk / Armada</div><div className="detail-value">{doData.serviceName || '-'}</div></div>
                            <div className="detail-item"><div className="detail-label">Telepon Penerima</div><div className="detail-value">{doData.receiverPhone || '-'}</div></div>
                        </div>
                        {doData.cargoFinalizedAt && (
                            <div className="detail-row">
                                <div className="detail-item">
                                    <div className="detail-label">Muatan Aktual Final</div>
                                    <div className="detail-value">{formatDateTime(doData.cargoFinalizedAt)}</div>
                                </div>
                                <div className="detail-item">
                                    <div className="detail-label">Difinalkan Oleh</div>
                                    <div className="detail-value">{doData.cargoFinalizedByName || '-'}</div>
                                </div>
                            </div>
                        )}
                        <div className="mt-2"><div className="detail-label">Alamat Pickup</div><div className="detail-value">{doData.pickupAddress || '-'}</div></div>
                        {doData.notes && <div className="mt-2"><div className="detail-label">Catatan</div><div className="detail-value">{doData.notes}</div></div>}
                    </div>
                </div>

                <div className="card">
                    <div className="card-header"><span className="card-header-title">Penerima</span></div>
                    <div className="card-body">
                        <div className="detail-item"><div className="detail-label">Nama</div><div className="detail-value">{doData.receiverName || '-'}</div></div>
                        <div className="detail-item mt-2"><div className="detail-label">Alamat</div><div className="detail-value">{doData.receiverAddress || '-'}</div></div>
                        {doData.receiverCompany && <div className="detail-item mt-2"><div className="detail-label">Perusahaan</div><div className="detail-value">{doData.receiverCompany}</div></div>}
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
                    <span className="card-header-title" style={{ color: 'var(--color-warning)' }}>Tarip Borongan Supir</span>
                    {!editingTarip && (
                        <button className="btn btn-sm btn-secondary" onClick={() => setEditingTarip(true)}>Edit Tarip</button>
                    )}
                </div>
                <div className="card-body">
                    {!editingTarip ? (
                        <div className="detail-row">
                            <div className="detail-item">
                                <div className="detail-label">Tarif Borongan per DO</div>
                                <div className="detail-value font-semibold" style={{ color: doData.taripBorongan ? 'var(--color-primary)' : 'var(--color-gray-400)' }}>
                                    {doData.taripBorongan ? `Rp ${doData.taripBorongan.toLocaleString('id')}` : 'Belum diisi'}
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
                                    <label className="form-label">Tarif Borongan per DO (Rp) <span className="required">*</span></label>
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
                        <thead><tr><th>Deskripsi</th><th>Koli</th><th>Muatan</th></tr></thead>
                        <tbody>
                            {doItems.map(item => (
                                <tr key={item._id}>
                                    <td className="font-medium">{item.orderItemDescription}</td>
                                    <td>
                                        <div className="text-muted text-xs">Rencana</div>
                                        <div className="font-medium">{item.orderItemQtyKoli || 0} koli</div>
                                        <div className="text-muted text-xs" style={{ marginTop: '0.35rem' }}>Aktual</div>
                                        <div className="font-medium" style={{ color: item.actualQtyKoli !== undefined ? 'var(--color-success)' : 'var(--color-gray-500)' }}>
                                            {item.actualQtyKoli !== undefined ? `${item.actualQtyKoli} koli` : 'Belum final'}
                                        </div>
                                    </td>
                                    <td>
                                        <div className="text-muted text-xs">Rencana</div>
                                        <div className="font-medium">
                                            {formatCargoSummary({
                                                qtyKoli: item.orderItemQtyKoli,
                                                weightKg: item.orderItemWeight,
                                                weightInputValue: item.orderItemWeightInputValue,
                                                weightInputUnit: item.orderItemWeightInputUnit,
                                                volumeM3: item.orderItemVolumeM3,
                                                volumeInputValue: item.orderItemVolumeInputValue,
                                                volumeInputUnit: item.orderItemVolumeInputUnit,
                                            })}
                                        </div>
                                        <div className="text-muted text-xs" style={{ marginTop: '0.35rem' }}>Aktual</div>
                                        <div className="font-medium" style={{ color: item.actualQtyKoli !== undefined ? 'var(--color-success)' : 'var(--color-gray-500)' }}>
                                            {item.actualQtyKoli !== undefined || item.actualWeightKg !== undefined || item.actualVolumeM3 !== undefined
                                                ? formatCargoSummary({
                                                    qtyKoli: item.actualQtyKoli,
                                                    weightKg: item.actualWeightKg,
                                                    weightInputValue: item.actualWeightInputValue,
                                                    weightInputUnit: item.actualWeightInputUnit,
                                                    volumeM3: item.actualVolumeM3,
                                                    volumeInputValue: item.actualVolumeInputValue,
                                                    volumeInputUnit: item.actualVolumeInputUnit,
                                                })
                                                : 'Belum final'}
                                        </div>
                                    </td>
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
                                    <div className={`timeline-dot ${log.status === 'DELIVERED' ? 'success' : ['HEADING_TO_PICKUP', 'ON_DELIVERY', 'ARRIVED'].includes(log.status) ? 'active' : ''}`} />
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
                <div className="modal-overlay" onClick={() => { if (!updatingStatus) setShowStatusModal(false); }}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3 className="modal-title">{isCompletingDelivery ? 'Selesaikan Surat Jalan' : 'Ubah Status DO'}</h3>
                            <button className="modal-close" onClick={() => setShowStatusModal(false)} disabled={updatingStatus}>&times;</button>
                        </div>
                        <div className="modal-body">
                            <div className="form-group">
                                <label className="form-label">Status Baru</label>
                                <select className="form-select" value={newStatus} onChange={e => setNewStatus(e.target.value)} disabled={updatingStatus}>
                                    <option value="">Pilih status</option>
                                    {nextStatuses.map(s => <option key={s} value={s}>{DO_STATUS_MAP[s]?.label || s}</option>)}
                                </select>
                            </div>
                            {isCompletingDelivery && (
                                <>
                                    <div style={{ background: 'var(--color-success-light)', borderRadius: '0.5rem', padding: '0.75rem 1rem', marginBottom: '1rem', fontSize: '0.8rem', color: 'var(--color-success)' }}>
                                        Status selesai ditetapkan oleh admin. Isi POD dan muatan aktual di bawah ini. Sistem akan memakai muatan aktual sebagai realisasi akhir DO, mengembalikan selisih rencana ke pending bila perlu, lalu menandai DO sebagai <strong>Delivered</strong>.
                                    </div>
                                    <div className="form-group">
                                        <label className="form-label">Nama Penerima POD <span className="required">*</span></label>
                                        <input className="form-input" value={podName} onChange={e => setPodName(e.target.value)} disabled={updatingStatus} />
                                    </div>
                                    <div className="form-group">
                                        <label className="form-label">Tanggal Terima POD <span className="required">*</span></label>
                                        <input type="date" className="form-input" value={podDate} onChange={e => setPodDate(e.target.value)} disabled={updatingStatus} />
                                    </div>
                                    <div className="form-group">
                                        <label className="form-label">Catatan POD</label>
                                        <textarea className="form-textarea" rows={2} value={podNote} onChange={e => setPodNote(e.target.value)} disabled={updatingStatus} />
                                    </div>
                                    <div className="form-group">
                                        <label className="form-label">Muatan Aktual per Item <span className="required">*</span></label>
                                        <div style={{ display: 'grid', gap: '0.75rem' }}>
                                            {actualCargoItems.map(item => (
                                                <div key={item.deliveryOrderItemRef} style={{ border: '1px solid var(--color-gray-200)', borderRadius: '0.75rem', padding: '0.9rem', background: 'var(--color-gray-50)' }}>
                                                    <div style={{ fontWeight: 600, marginBottom: '0.35rem' }}>{item.description}</div>
                                                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
                                                        Rencana: {formatCargoSummary({
                                                            qtyKoli: item.plannedQtyKoli,
                                                            weightKg: item.plannedWeightKg,
                                                            weightInputValue: item.plannedWeightInputValue,
                                                            weightInputUnit: item.plannedWeightInputUnit,
                                                            volumeM3: item.plannedVolumeM3,
                                                            volumeInputValue: item.plannedVolumeInputValue,
                                                            volumeInputUnit: item.plannedVolumeInputUnit,
                                                        })}
                                                    </div>
                                                    <div className="form-row">
                                                        <div className="form-group">
                                                            <label className="form-label">Koli Aktual <span className="required">*</span></label>
                                                            <input
                                                                type="number"
                                                                min="0"
                                                                step="0.01"
                                                                className="form-input"
                                                                value={item.actualQtyKoli}
                                                                onChange={e => updateActualCargoDraft(item.deliveryOrderItemRef, 'actualQtyKoli', e.target.value)}
                                                                disabled={updatingStatus}
                                                            />
                                                        </div>
                                                        <div className="form-group">
                                                            <label className="form-label">Berat Aktual {item.requireWeight && <span className="required">*</span>}</label>
                                                            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 110px', gap: '0.5rem' }}>
                                                                <input
                                                                    type="number"
                                                                    min="0"
                                                                    step="0.01"
                                                                    className="form-input"
                                                                    value={item.actualWeightInputValue}
                                                                    onChange={e => updateActualCargoDraft(item.deliveryOrderItemRef, 'actualWeightInputValue', e.target.value)}
                                                                    disabled={updatingStatus}
                                                                />
                                                                <select
                                                                    className="form-select"
                                                                    value={item.actualWeightInputUnit}
                                                                    onChange={e => updateActualCargoDraft(item.deliveryOrderItemRef, 'actualWeightInputUnit', e.target.value)}
                                                                    disabled={updatingStatus}
                                                                >
                                                                    {WEIGHT_INPUT_UNIT_OPTIONS.map(option => (
                                                                        <option key={option.value} value={option.value}>{option.label}</option>
                                                                    ))}
                                                                </select>
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <div className="form-row">
                                                        <div className="form-group">
                                                            <label className="form-label">Volume Aktual {item.requireVolume && <span className="required">*</span>}</label>
                                                            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 110px', gap: '0.5rem' }}>
                                                                <input
                                                                    type="number"
                                                                    min="0"
                                                                    step="0.01"
                                                                    className="form-input"
                                                                    value={item.actualVolumeInputValue}
                                                                    onChange={e => updateActualCargoDraft(item.deliveryOrderItemRef, 'actualVolumeInputValue', e.target.value)}
                                                                    disabled={updatingStatus}
                                                                />
                                                                <select
                                                                    className="form-select"
                                                                    value={item.actualVolumeInputUnit}
                                                                    onChange={e => updateActualCargoDraft(item.deliveryOrderItemRef, 'actualVolumeInputUnit', e.target.value)}
                                                                    disabled={updatingStatus}
                                                                >
                                                                    {VOLUME_INPUT_UNIT_OPTIONS.map(option => (
                                                                        <option key={option.value} value={option.value}>{option.label}</option>
                                                                    ))}
                                                                </select>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </>
                            )}
                            <div className="form-group">
                                <label className="form-label">Catatan</label>
                                <textarea className="form-textarea" rows={3} value={statusNote} onChange={e => setStatusNote(e.target.value)} placeholder={isCompletingDelivery ? 'Catatan penyelesaian DO...' : 'Catatan tracking...'} disabled={updatingStatus} />
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setShowStatusModal(false)} disabled={updatingStatus}>Batal</button>
                            <button className={`btn ${isCompletingDelivery ? 'btn-success' : 'btn-primary'}`} onClick={updateDOStatus} disabled={!newStatus || updatingStatus || (isCompletingDelivery && (!podName.trim() || !podDate || !actualCargoReady))}>
                                <Save size={16} /> {updatingStatus ? 'Menyimpan...' : (isCompletingDelivery ? 'Selesaikan DO' : 'Simpan')}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {showPODModal && (
                <div className="modal-overlay" onClick={() => { if (!savingPOD) setShowPODModal(false); }}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3 className="modal-title">Lengkapi Proof of Delivery</h3>
                            <button className="modal-close" onClick={() => setShowPODModal(false)} disabled={savingPOD}>&times;</button>
                        </div>
                        <div className="modal-body">
                            <div className="form-group">
                                <label className="form-label">Nama Penerima POD <span className="required">*</span></label>
                                <input className="form-input" value={podName} onChange={e => setPodName(e.target.value)} disabled={savingPOD} />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Tanggal Terima POD <span className="required">*</span></label>
                                <input type="date" className="form-input" value={podDate} onChange={e => setPodDate(e.target.value)} disabled={savingPOD} />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Catatan POD</label>
                                <textarea className="form-textarea" rows={2} value={podNote} onChange={e => setPodNote(e.target.value)} disabled={savingPOD} />
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setShowPODModal(false)} disabled={savingPOD}>Batal</button>
                            <button className="btn btn-success" onClick={savePOD} disabled={savingPOD || !podName.trim() || !podDate}>
                                <Upload size={16} /> {savingPOD ? 'Menyimpan...' : 'Simpan POD'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

