'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useToast } from '../../layout';
import { Printer, FileDown, Truck, Upload, Save, MapPin, Radio } from 'lucide-react';
import CurrencyInput from '@/components/CurrencyInput';
import CollapsibleCard from '@/components/CollapsibleCard';
import FormattedNumberInput from '@/components/FormattedNumberInput';
import PageBackButton from '@/components/PageBackButton';
import { fetchCompanyProfile, openBrandedPrint } from '@/lib/print';
import { DO_ACTUAL_DROP_TYPE_MAP, DO_STATUS_MAP, formatDate, formatDateTime, formatDeliveryOrderDisplayNumber } from '@/lib/utils';
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

interface ActualDropDraft {
    draftKey: string;
    stopType: 'DROP' | 'HOLD' | 'TRANSIT' | 'EXTRA_DROP' | 'RETURN';
    locationName: string;
    locationAddress: string;
    qtyKoli: string;
    weightInputValue: string;
    weightInputUnit: WeightInputUnit;
    volumeInputValue: string;
    volumeInputUnit: VolumeInputUnit;
    note: string;
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

function summarizeActualCargoDrafts(items: ActualCargoDraft[]) {
    const qtyKoli = items.reduce((sum, item) => sum + Number(item.actualQtyKoli || 0), 0);
    const weightKg = items.reduce((sum, item) => {
        const value = Number(item.actualWeightInputValue || 0);
        if (!value) return sum;
        return sum + (item.actualWeightInputUnit === 'TON' ? value * 1000 : value);
    }, 0);
    const volumeM3 = items.reduce((sum, item) => {
        const value = Number(item.actualVolumeInputValue || 0);
        if (!value) return sum;
        if (item.actualVolumeInputUnit === 'LITER') return sum + value / 1000;
        if (item.actualVolumeInputUnit === 'KL') return sum + value;
        return sum + value;
    }, 0);

    return {
        qtyKoli,
        weightKg,
        volumeM3,
    };
}

function buildDefaultActualDropDrafts(doData: DeliveryOrder | null, cargoItems: ActualCargoDraft[]): ActualDropDraft[] {
    if (doData?.actualDropPoints && doData.actualDropPoints.length > 0) {
        return doData.actualDropPoints.map((point, index) => ({
            draftKey: point._key || `${index + 1}`,
            stopType: point.stopType,
            locationName: point.locationName || '',
            locationAddress: point.locationAddress || '',
            qtyKoli: point.qtyKoli !== undefined ? String(point.qtyKoli) : '',
            weightInputValue: point.weightInputValue !== undefined
                ? String(point.weightInputValue)
                : point.weightKg !== undefined
                    ? String(point.weightKg)
                    : '',
            weightInputUnit: point.weightInputUnit || 'KG',
            volumeInputValue: point.volumeInputValue !== undefined
                ? String(point.volumeInputValue)
                : point.volumeM3 !== undefined
                    ? String(point.volumeM3)
                    : '',
            volumeInputUnit: point.volumeInputUnit || 'M3',
            note: point.note || '',
        }));
    }

    const totals = summarizeActualCargoDrafts(cargoItems);
    return [
        {
            draftKey: crypto.randomUUID(),
            stopType: 'DROP',
            locationName: doData?.receiverCompany || doData?.receiverName || 'Tujuan Tagihan',
            locationAddress: doData?.receiverAddress || '',
            qtyKoli: totals.qtyKoli > 0 ? String(totals.qtyKoli) : '',
            weightInputValue: totals.weightKg > 0 ? String(totals.weightKg) : '',
            weightInputUnit: 'KG',
            volumeInputValue: totals.volumeM3 > 0 ? String(totals.volumeM3) : '',
            volumeInputUnit: 'M3',
            note: '',
        },
    ];
}

function buildAutoActualDropDraft(doData: DeliveryOrder | null, cargoItems: ActualCargoDraft[]): ActualDropDraft {
    const totals = summarizeActualCargoDrafts(cargoItems);
    return {
        draftKey: 'auto-default-drop',
        stopType: 'DROP',
        locationName: doData?.receiverCompany || doData?.receiverName || 'Tujuan Tagihan',
        locationAddress: doData?.receiverAddress || '',
        qtyKoli: totals.qtyKoli > 0 ? String(totals.qtyKoli) : '',
        weightInputValue: totals.weightKg > 0 ? String(totals.weightKg) : '',
        weightInputUnit: 'KG',
        volumeInputValue: totals.volumeM3 > 0 ? String(totals.volumeM3) : '',
        volumeInputUnit: 'M3',
        note: '',
    };
}

function shouldOpenAdvancedDropEditor(doData: DeliveryOrder | null, dropDrafts: ActualDropDraft[]) {
    const defaultLocationName = doData?.receiverCompany || doData?.receiverName || 'Tujuan Tagihan';
    const defaultLocationAddress = doData?.receiverAddress || '';

    return dropDrafts.length > 1 || dropDrafts.some(point =>
        point.stopType !== 'DROP' ||
        (point.locationName || '') !== defaultLocationName ||
        (point.locationAddress || '') !== defaultLocationAddress ||
        point.note.trim().length > 0
    );
}

export default function DODetailPage() {
    const params = useParams();
    const { addToast } = useToast();
    const doId = params.id as string;
    const [doData, setDoData] = useState<DeliveryOrder | null>(null);
    const [doItems, setDoItems] = useState<DeliveryOrderItem[]>([]);
    const [trackingLogs, setTrackingLogs] = useState<TrackingLog[]>([]);
    const [loading, setLoading] = useState(true);
    const [showStatusModal, setShowStatusModal] = useState(false);
    const [showPODModal, setShowPODModal] = useState(false);
    const [showRejectRequestModal, setShowRejectRequestModal] = useState(false);
    const [newStatus, setNewStatus] = useState('');
    const [statusNote, setStatusNote] = useState('');
    const [reviewingDriverRequest, setReviewingDriverRequest] = useState(false);
    const [rejectRequestNote, setRejectRequestNote] = useState('');
    const [podName, setPodName] = useState('');
    const [podDate, setPodDate] = useState(new Date().toISOString().split('T')[0]);
    const [podNote, setPodNote] = useState('');
    const [actualCargoItems, setActualCargoItems] = useState<ActualCargoDraft[]>([]);
    const [actualDropPoints, setActualDropPoints] = useState<ActualDropDraft[]>([]);
    const [showAdvancedDropEditor, setShowAdvancedDropEditor] = useState(false);
    const [editingTarip, setEditingTarip] = useState(false);
    const [taripBorongan, setTaripBorongan] = useState<number>(0);
    const [keteranganBorongan, setKeteranganBorongan] = useState('');
    const [updatingStatus, setUpdatingStatus] = useState(false);
    const [savingPOD, setSavingPOD] = useState(false);
    const [savingTarip, setSavingTarip] = useState(false);
    const [rejectingRequest, setRejectingRequest] = useState(false);

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

    const openStatusModal = (requestedStatus?: string, fromDriverRequest: boolean = false) => {
        setNewStatus(requestedStatus || '');
        setStatusNote(fromDriverRequest ? (doData?.pendingDriverStatusNote || '') : '');
        setReviewingDriverRequest(fromDriverRequest);
        setPodName('');
        setPodDate(new Date().toISOString().split('T')[0]);
        setPodNote('');
        const nextActualCargoItems = doItems.map(buildActualCargoDraft);
        const nextActualDropPoints = buildDefaultActualDropDrafts(doData, nextActualCargoItems);
        setActualCargoItems(nextActualCargoItems);
        setActualDropPoints(nextActualDropPoints);
        setShowAdvancedDropEditor(shouldOpenAdvancedDropEditor(doData, nextActualDropPoints));
        setShowStatusModal(true);
    };

    const rejectDriverStatusRequest = async () => {
        setRejectingRequest(true);
        try {
            const res = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    entity: 'delivery-orders',
                    action: 'reject-driver-status-request',
                    data: {
                        id: doData?._id,
                        note: rejectRequestNote,
                    },
                }),
            });
            const result = await res.json();
            if (!res.ok) {
                addToast('error', result.error || 'Gagal menolak permintaan driver');
                return;
            }
            await loadDO();
            setShowRejectRequestModal(false);
            setRejectRequestNote('');
            addToast('success', 'Permintaan driver ditolak');
        } catch {
            addToast('error', 'Gagal menolak permintaan driver');
        } finally {
            setRejectingRequest(false);
        }
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

    const updateActualDropDraft = (
        draftKey: string,
        field: keyof Pick<ActualDropDraft, 'stopType' | 'locationName' | 'locationAddress' | 'qtyKoli' | 'weightInputValue' | 'weightInputUnit' | 'volumeInputValue' | 'volumeInputUnit' | 'note'>,
        value: string
    ) => {
        setActualDropPoints(previous =>
            previous.map(item => (item.draftKey === draftKey ? { ...item, [field]: value } : item))
        );
    };

    const addActualDropDraft = () => {
        setActualDropPoints(previous => [
            ...previous,
            {
                draftKey: crypto.randomUUID(),
                stopType: 'DROP',
                locationName: '',
                locationAddress: '',
                qtyKoli: '',
                weightInputValue: '',
                weightInputUnit: 'KG',
                volumeInputValue: '',
                volumeInputUnit: 'M3',
                note: '',
            },
        ]);
    };

    const removeActualDropDraft = (draftKey: string) => {
        setActualDropPoints(previous => previous.filter(item => item.draftKey !== draftKey));
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
                                actualDropPoints: effectiveActualDropPoints.map(item => ({
                                    stopType: item.stopType,
                                    locationName: item.locationName,
                                    locationAddress: item.locationAddress,
                                    qtyKoli: item.qtyKoli.trim() ? Number(item.qtyKoli) : 0,
                                    weightInputValue: item.weightInputValue.trim() ? Number(item.weightInputValue) : 0,
                                    weightInputUnit: item.weightInputUnit,
                                    volumeInputValue: item.volumeInputValue.trim() ? Number(item.volumeInputValue) : 0,
                                    volumeInputUnit: item.volumeInputUnit,
                                    note: item.note,
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
            setReviewingDriverRequest(false);
            if (completingDelivery) {
                setPodName('');
                setPodDate(new Date().toISOString().split('T')[0]);
                setPodNote('');
                setActualCargoItems([]);
                setActualDropPoints([]);
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
                subtitle: formatDeliveryOrderDisplayNumber(doData || {}),
                company,
                bodyHtml: `
                    <div style="margin-bottom:16px">
                        <table style="width:100%;border:none"><tbody>
                            <tr>
                                <td style="border:none;padding:2px 8px;width:140px;font-weight:600">No. SJ Customer</td>
                                <td style="border:none;padding:2px 8px">${doData?.customerDoNumber || doData?.doNumber || '-'}</td>
                                <td style="border:none;padding:2px 8px;width:140px;font-weight:600">Tanggal</td>
                                <td style="border:none;padding:2px 8px">${formatDate(doData?.date || '')}</td>
                            </tr>
                            <tr>
                                <td style="border:none;padding:2px 8px;font-weight:600">No. Internal</td>
                                <td style="border:none;padding:2px 8px">${doData?.doNumber || '-'}</td>
                                <td style="border:none;padding:2px 8px;font-weight:600">Master Resi</td>
                                <td style="border:none;padding:2px 8px">${doData?.masterResi || '-'}</td>
                            </tr>
                            <tr>
                                <td style="border:none;padding:2px 8px;font-weight:600"></td>
                                <td style="border:none;padding:2px 8px"></td>
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
                                <td style="border:none;padding:2px 8px;font-weight:600">Armada Diminta</td>
                                <td style="border:none;padding:2px 8px">${doData?.serviceName || '-'}</td>
                            </tr>
                            <tr>
                                <td style="border:none;padding:2px 8px;font-weight:600">Armada Aktual</td>
                                <td style="border:none;padding:2px 8px">${doData?.vehicleServiceName || doData?.serviceName || '-'}</td>
                                <td style="border:none;padding:2px 8px;font-weight:600">Kendaraan</td>
                                <td style="border:none;padding:2px 8px">${doData?.vehiclePlate || '-'}</td>
                            </tr>
                            ${doData?.vehicleCategoryOverrideReason ? `<tr><td style="border:none;padding:2px 8px;font-weight:600">Alasan Override Armada</td><td colspan="3" style="border:none;padding:2px 8px">${doData.vehicleCategoryOverrideReason}</td></tr>` : ''}
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
                    <div class="section-title">Route Tagihan & Realisasi Drop</div>
                    <table>
                        <thead>
                            <tr>
                                <th>Tipe</th>
                                <th>Lokasi</th>
                                <th>Alamat</th>
                                <th>Muatan</th>
                                <th>Catatan</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${(doData?.actualDropPoints || []).length > 0
                                ? (doData?.actualDropPoints || [])
                                    .slice()
                                    .sort((a, b) => (a.sequence || 0) - (b.sequence || 0))
                                    .map(point => `
                                        <tr>
                                            <td>${DO_ACTUAL_DROP_TYPE_MAP[point.stopType]?.label || point.stopType}</td>
                                            <td>${point.sequence}. ${point.locationName || '-'}</td>
                                            <td>${point.locationAddress || '-'}</td>
                                            <td>${formatCargoSummary({
                                                qtyKoli: point.qtyKoli,
                                                weightKg: point.weightKg,
                                                weightInputValue: point.weightInputValue,
                                                weightInputUnit: point.weightInputUnit,
                                                volumeM3: point.volumeM3,
                                                volumeInputValue: point.volumeInputValue,
                                                volumeInputUnit: point.volumeInputUnit,
                                            })}</td>
                                            <td>${point.note || '-'}</td>
                                        </tr>
                                    `).join('')
                                : `
                                    <tr>
                                        <td>Drop</td>
                                        <td>1. ${doData?.receiverCompany || doData?.receiverName || 'Tujuan Tagihan'}</td>
                                        <td>${doData?.receiverAddress || '-'}</td>
                                        <td>-</td>
                                        <td>Realisasi drop belum dicatat terpisah.</td>
                                    </tr>
                                `}
                        </tbody>
                    </table>
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
                addToast('error', result.error || 'Gagal menyimpan upah trip');
                return;
            }
            setDoData(prev => prev ? { ...prev, taripBorongan, keteranganBorongan } : prev);
            setEditingTarip(false);
            addToast('success', 'Upah trip disimpan');
        } catch {
            addToast('error', 'Gagal menyimpan upah trip');
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
    const pendingDriverStatusMeta = doData.pendingDriverStatus ? DO_STATUS_MAP[doData.pendingDriverStatus] : null;
    const actualCargoTotals = summarizeActualCargoDrafts(actualCargoItems);
    const autoActualDropDraft = buildAutoActualDropDraft(doData, actualCargoItems);
    const effectiveActualDropPoints = showAdvancedDropEditor ? actualDropPoints : [autoActualDropDraft];
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
    const actualDropReady = effectiveActualDropPoints.length > 0 && effectiveActualDropPoints.every(item => {
        const qty = Number(item.qtyKoli);
        const weight = Number(item.weightInputValue);
        const volume = Number(item.volumeInputValue);
        return (
            Boolean(item.locationName.trim() || item.locationAddress.trim()) &&
            ((Number.isFinite(qty) && qty > 0) || (Number.isFinite(weight) && weight > 0) || (Number.isFinite(volume) && volume > 0))
        );
    });
    const actualDropSummary = doData.actualDropPoints || [];
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
                <div className="page-header-left" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                    <PageBackButton href="/delivery-orders" />
                    <div>
                        <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                            {formatDeliveryOrderDisplayNumber(doData)}
                            <span className={`badge badge-${DO_STATUS_MAP[doData.status]?.color}`}>
                                <span className="badge-dot" /> {DO_STATUS_MAP[doData.status]?.label}
                            </span>
                        </h1>
                        <p className="page-subtitle">Pantau trip, lanjutkan status, dan selesaikan POD bila pengiriman sudah selesai</p>
                    </div>
                </div>
                <div className="page-actions">
                    {nextStatuses.length > 0 && (
                        <button className="btn btn-primary" onClick={() => openStatusModal()}>
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

            {doData.pendingDriverStatus && (
                <div className="card" style={{ marginBottom: 'var(--space-4)', border: '1px solid var(--color-warning-light)', background: 'var(--color-warning-soft)' }}>
                    <div className="card-body">
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap' }}>
                            <div style={{ display: 'grid', gap: '0.35rem' }}>
                                <div className="form-section-title" style={{ marginBottom: 0 }}>Permintaan Driver Menunggu Approval</div>
                                <div className="detail-value">
                                    Driver mengajukan status{' '}
                                    <span className={`badge badge-${pendingDriverStatusMeta?.color || 'warning'}`}>
                                        <span className="badge-dot" /> {pendingDriverStatusMeta?.label || doData.pendingDriverStatus}
                                    </span>
                                </div>
                                <div className="text-muted text-sm">
                                    {doData.pendingDriverStatusRequestedByName || 'Driver'} · {formatDateTime(doData.pendingDriverStatusRequestedAt)}
                                </div>
                                {doData.pendingDriverStatusNote && (
                                    <div className="text-muted text-sm">Catatan driver: {doData.pendingDriverStatusNote}</div>
                                )}
                            </div>
                            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                                <button className="btn btn-success" onClick={() => openStatusModal(doData.pendingDriverStatus, true)}>
                                    <Save size={16} /> Review & Approve
                                </button>
                                <button
                                    className="btn btn-secondary"
                                    onClick={() => {
                                        setRejectRequestNote('');
                                        setShowRejectRequestModal(true);
                                    }}
                                >
                                    Tolak
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            <div className="detail-grid">
                <div className="card">
                    <div className="card-header"><span className="card-header-title">Informasi Surat Jalan</span></div>
                    <div className="card-body">
                        <div className="detail-row">
                            <div className="detail-item"><div className="detail-label">No. SJ Customer</div><div className="detail-value font-mono">{formatDeliveryOrderDisplayNumber(doData)}</div></div>
                            <div className="detail-item"><div className="detail-label">Tanggal</div><div className="detail-value">{formatDate(doData.date)}</div></div>
                        </div>
                        <div className="detail-row">
                            <div className="detail-item"><div className="detail-label">No. Internal</div><div className="detail-value font-mono">{doData.doNumber}</div></div>
                            <div className="detail-item"><div className="detail-label">Kendaraan</div><div className="detail-value">{doData.vehiclePlate || '-'}</div></div>
                        </div>
                        <div className="detail-row">
                            <div className="detail-item"><div className="detail-label">Master Resi</div><div className="detail-value"><Link href={`/orders/${doData.orderRef}`}>{doData.masterResi}</Link></div></div>
                            <div className="detail-item"><div className="detail-label">Customer</div><div className="detail-value">{doData.customerName || '-'}</div></div>
                        </div>
                        <div className="detail-row">
                            <div className="detail-item"><div className="detail-label">Driver</div><div className="detail-value">{doData.driverName || '-'}</div></div>
                            <div className="detail-item"><div className="detail-label">Telepon Penerima</div><div className="detail-value">{doData.receiverPhone || '-'}</div></div>
                        </div>
                        <div className="detail-row">
                            <div className="detail-item"><div className="detail-label">Armada Diminta</div><div className="detail-value">{doData.serviceName || '-'}</div></div>
                            <div className="detail-item"><div className="detail-label">Penerima</div><div className="detail-value">{doData.receiverName || '-'}</div></div>
                        </div>
                        <div className="detail-row">
                            <div className="detail-item"><div className="detail-label">Armada Aktual</div><div className="detail-value">{doData.vehicleServiceName || doData.serviceName || '-'}</div></div>
                            <div className="detail-item"><div className="detail-label">Alasan Override Armada</div><div className="detail-value">{doData.vehicleCategoryOverrideReason || '-'}</div></div>
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

            <div style={{ display: 'grid', gap: 'var(--space-4)', marginTop: 'var(--space-4)' }}>
            <CollapsibleCard
                title="Muatan & Realisasi Trip"
                subtitle="Buka jika perlu cek tujuan tagihan, titik drop aktual, dan detail muatan lapangan"
            >
                    <div className="detail-row">
                        <div className="detail-item">
                            <div className="detail-label">Asal Tagihan</div>
                            <div className="detail-value">{doData.pickupAddress || '-'}</div>
                        </div>
                        <div className="detail-item">
                            <div className="detail-label">Tujuan Tagihan</div>
                            <div className="detail-value">{doData.receiverAddress || '-'}</div>
                        </div>
                    </div>
                    <div style={{ marginTop: '1rem' }}>
                        <div className="detail-label" style={{ marginBottom: '0.5rem' }}>
                            Titik Drop Aktual {actualDropSummary.length > 0 ? `(${actualDropSummary.length})` : ''}
                        </div>
                        {actualDropSummary.length === 0 ? (
                            <div className="text-muted text-sm">Belum ada realisasi drop. Saat DO diselesaikan, sistem akan mencatat tujuan aktual per titik.</div>
                        ) : (
                            <div style={{ display: 'grid', gap: '0.75rem' }}>
                                {actualDropSummary
                                    .slice()
                                    .sort((a, b) => (a.sequence || 0) - (b.sequence || 0))
                                    .map(point => (
                                        <div key={point._key || `${point.sequence}-${point.locationName}`} style={{ border: '1px solid var(--color-gray-200)', borderRadius: '0.75rem', padding: '0.85rem 1rem' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                                                <div style={{ fontWeight: 600 }}>
                                                    {point.sequence}. {point.locationName}
                                                </div>
                                                <span className={`badge badge-${DO_ACTUAL_DROP_TYPE_MAP[point.stopType]?.color || 'gray'}`}>
                                                    {DO_ACTUAL_DROP_TYPE_MAP[point.stopType]?.label || point.stopType}
                                                </span>
                                            </div>
                                            {point.locationAddress && (
                                                <div className="text-muted text-sm" style={{ marginTop: '0.35rem' }}>
                                                    {point.locationAddress}
                                                </div>
                                            )}
                                            <div className="detail-row" style={{ marginTop: '0.75rem' }}>
                                                <div className="detail-item">
                                                    <div className="detail-label">Muatan</div>
                                                    <div className="detail-value">
                                                        {formatCargoSummary({
                                                            qtyKoli: point.qtyKoli,
                                                            weightKg: point.weightKg,
                                                            weightInputValue: point.weightInputValue,
                                                            weightInputUnit: point.weightInputUnit,
                                                            volumeM3: point.volumeM3,
                                                            volumeInputValue: point.volumeInputValue,
                                                            volumeInputUnit: point.volumeInputUnit,
                                                        })}
                                                    </div>
                                                </div>
                                                <div className="detail-item">
                                                    <div className="detail-label">Catatan</div>
                                                    <div className="detail-value">{point.note || '-'}</div>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                            </div>
                        )}
                    </div>
            </CollapsibleCard>

            <CollapsibleCard
                title="Tracking Driver"
                subtitle="Buka jika perlu cek posisi driver, peta, dan riwayat tracking"
                defaultOpen={doData.trackingState === 'ACTIVE'}
            >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
                        <div className="detail-label" style={{ marginBottom: 0 }}>Status Tracking</div>
                        <span className={`badge ${doData.trackingState === 'ACTIVE' ? 'badge-info' : doData.trackingState === 'PAUSED' ? 'badge-warning' : 'badge-gray'}`}>
                            <Radio size={12} /> {doData.trackingState || 'IDLE'}
                        </span>
                    </div>
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
            </CollapsibleCard>

            <CollapsibleCard
                title="Upah Trip Driver"
                subtitle={doData.taripBorongan ? 'Buka jika perlu cek atau ubah upah trip' : 'Upah trip belum diisi. Buka bagian ini untuk melengkapinya.'}
                defaultOpen={!doData.taripBorongan}
            >
                    {!editingTarip ? (
                        <div className="detail-row">
                            <div className="detail-item">
                                <div className="detail-label">Upah Trip per DO</div>
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
                                    <label className="form-label">Upah Trip per DO (Rp) <span className="required">*</span></label>
                                    <CurrencyInput value={taripBorongan} onValueChange={value => setTaripBorongan(value)} placeholder="Ketik upah trip per DO" />
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Keterangan</label>
                                    <input className="form-input" value={keteranganBorongan} onChange={e => setKeteranganBorongan(e.target.value)} placeholder="Opsional..." />
                                </div>
                            </div>
                            <div style={{ display: 'flex', gap: '0.5rem' }}>
                                <button className="btn btn-primary btn-sm" onClick={saveTaripBorongan} disabled={savingTarip}>
                                    <Save size={14} /> {savingTarip ? 'Menyimpan...' : 'Simpan Upah'}
                                </button>
                                <button className="btn btn-secondary btn-sm" onClick={() => setEditingTarip(false)}>Batal</button>
                            </div>
                        </div>
                    )}
            </CollapsibleCard>

            {/* Items */}
            <div className="card">
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

            <CollapsibleCard
                title="Riwayat Tracking"
                subtitle="Buka jika perlu audit urutan status dan update perjalanan"
            >
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
            </CollapsibleCard>
            </div>

            {/* Status Modal */}
            {showStatusModal && (
                <div className="modal-overlay" onClick={() => { if (!updatingStatus) setShowStatusModal(false); }}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3 className="modal-title">{isCompletingDelivery ? (reviewingDriverRequest ? 'Review Permintaan Selesai Driver' : 'Selesaikan Surat Jalan') : 'Ubah Status DO'}</h3>
                            <button className="modal-close" onClick={() => { setShowStatusModal(false); setReviewingDriverRequest(false); }} disabled={updatingStatus}>&times;</button>
                        </div>
                        <div className="modal-body">
                            <div className="form-group">
                                <label className="form-label">Status Baru</label>
                                {reviewingDriverRequest && doData.pendingDriverStatus ? (
                                    <div className="detail-value">
                                        <span className={`badge badge-${pendingDriverStatusMeta?.color || 'warning'}`}>
                                            <span className="badge-dot" /> {pendingDriverStatusMeta?.label || doData.pendingDriverStatus}
                                        </span>
                                    </div>
                                ) : (
                                    <select className="form-select" value={newStatus} onChange={e => setNewStatus(e.target.value)} disabled={updatingStatus}>
                                        <option value="">Pilih status</option>
                                        {nextStatuses.map(s => <option key={s} value={s}>{DO_STATUS_MAP[s]?.label || s}</option>)}
                                    </select>
                                )}
                            </div>
                            {reviewingDriverRequest && doData.pendingDriverStatusNote && (
                                <div className="form-group">
                                    <label className="form-label">Catatan Driver</label>
                                    <div className="detail-value">{doData.pendingDriverStatusNote}</div>
                                </div>
                            )}
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
                                        <div style={{ background: 'var(--color-gray-50)', borderRadius: '0.5rem', padding: '0.75rem 1rem', marginBottom: '0.75rem', fontSize: '0.8rem', color: 'var(--color-gray-600)' }}>
                                            Untuk trip normal, cukup cek angka aktual tiap item. Qty aktual boleh lebih kecil atau lebih besar dari rencana trip selama total order/resi belum terlampaui. Jika total barang fisik memang bertambah dari order awal, revisi order/resi dulu.
                                        </div>
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
                                                            <FormattedNumberInput
                                                                min={0}
                                                                maxFractionDigits={2}
                                                                value={Number(item.actualQtyKoli || 0)}
                                                                onValueChange={value => updateActualCargoDraft(item.deliveryOrderItemRef, 'actualQtyKoli', String(value))}
                                                                disabled={updatingStatus}
                                                            />
                                                        </div>
                                                        <div className="form-group">
                                                            <label className="form-label">Berat Aktual {item.requireWeight && <span className="required">*</span>}</label>
                                                            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 110px', gap: '0.5rem' }}>
                                                                <FormattedNumberInput
                                                                    min={0}
                                                                    maxFractionDigits={2}
                                                                    value={Number(item.actualWeightInputValue || 0)}
                                                                    onValueChange={value => updateActualCargoDraft(item.deliveryOrderItemRef, 'actualWeightInputValue', String(value))}
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
                                                                <FormattedNumberInput
                                                                    min={0}
                                                                    maxFractionDigits={2}
                                                                    value={Number(item.actualVolumeInputValue || 0)}
                                                                    onValueChange={value => updateActualCargoDraft(item.deliveryOrderItemRef, 'actualVolumeInputValue', String(value))}
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
                                    <div className="form-group">
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
                                            <label className="form-label" style={{ marginBottom: 0 }}>Realisasi Titik Drop <span className="required">*</span></label>
                                            <button
                                                type="button"
                                                className="btn btn-secondary btn-sm"
                                                onClick={() => setShowAdvancedDropEditor(previous => !previous)}
                                                disabled={updatingStatus}
                                            >
                                                {showAdvancedDropEditor ? 'Tutup Detail Drop' : 'Ada Multi-drop / Hold / Extra Drop'}
                                            </button>
                                        </div>
                                        <div style={{ background: 'var(--color-info-light)', borderRadius: '0.5rem', padding: '0.75rem 1rem', marginBottom: '0.75rem', fontSize: '0.8rem', color: 'var(--color-info)' }}>
                                            Untuk trip normal, sistem otomatis menganggap semua muatan aktual turun di tujuan tagihan: <strong>{autoActualDropDraft.locationName || 'Tujuan Tagihan'}</strong>. Buka detail ini hanya jika ada multi-drop, hold/inap, return, atau extra drop.
                                        </div>
                                        {!showAdvancedDropEditor ? (
                                            <div style={{ border: '1px solid var(--color-gray-200)', borderRadius: '0.75rem', padding: '0.9rem', background: 'var(--color-gray-50)' }}>
                                                <div style={{ fontWeight: 600, marginBottom: '0.35rem' }}>Realisasi Default</div>
                                                <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', display: 'grid', gap: '0.2rem' }}>
                                                    <div>Lokasi: {autoActualDropDraft.locationName || 'Tujuan Tagihan'}</div>
                                                    {autoActualDropDraft.locationAddress && <div>Alamat: {autoActualDropDraft.locationAddress}</div>}
                                                    <div>Muatan: {formatCargoSummary({ qtyKoli: actualCargoTotals.qtyKoli, weightKg: actualCargoTotals.weightKg, volumeM3: actualCargoTotals.volumeM3 })}</div>
                                                </div>
                                            </div>
                                        ) : (
                                            <>
                                                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '0.75rem' }}>
                                                    <button type="button" className="btn btn-secondary btn-sm" onClick={addActualDropDraft} disabled={updatingStatus}>
                                                        + Tambah Titik Drop
                                                    </button>
                                                </div>
                                                <div style={{ display: 'grid', gap: '0.75rem' }}>
                                                    {actualDropPoints.map((item, index) => (
                                                        <div key={item.draftKey} style={{ border: '1px solid var(--color-gray-200)', borderRadius: '0.75rem', padding: '0.9rem', background: 'var(--color-gray-50)' }}>
                                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
                                                                <div style={{ fontWeight: 600 }}>Titik Drop {index + 1}</div>
                                                                {actualDropPoints.length > 1 && (
                                                                    <button type="button" className="btn btn-danger btn-sm" onClick={() => removeActualDropDraft(item.draftKey)} disabled={updatingStatus}>
                                                                        Hapus
                                                                    </button>
                                                                )}
                                                            </div>
                                                            <div className="form-row">
                                                                <div className="form-group">
                                                                    <label className="form-label">Tipe Titik</label>
                                                                    <select
                                                                        className="form-select"
                                                                        value={item.stopType}
                                                                        onChange={e => updateActualDropDraft(item.draftKey, 'stopType', e.target.value)}
                                                                        disabled={updatingStatus}
                                                                    >
                                                                        {Object.entries(DO_ACTUAL_DROP_TYPE_MAP).map(([value, meta]) => (
                                                                            <option key={value} value={value}>{meta.label}</option>
                                                                        ))}
                                                                    </select>
                                                                </div>
                                                                <div className="form-group">
                                                                    <label className="form-label">Nama Lokasi <span className="required">*</span></label>
                                                                    <input
                                                                        className="form-input"
                                                                        value={item.locationName}
                                                                        onChange={e => updateActualDropDraft(item.draftKey, 'locationName', e.target.value)}
                                                                        disabled={updatingStatus}
                                                                        placeholder="Mis. Gudang Transit Malang"
                                                                    />
                                                                </div>
                                                            </div>
                                                            <div className="form-group">
                                                                <label className="form-label">Alamat Lokasi</label>
                                                                <input
                                                                    className="form-input"
                                                                    value={item.locationAddress}
                                                                    onChange={e => updateActualDropDraft(item.draftKey, 'locationAddress', e.target.value)}
                                                                    disabled={updatingStatus}
                                                                    placeholder="Opsional, isi jika berbeda dari tujuan tagihan"
                                                                />
                                                            </div>
                                                            <div className="form-row">
                                                                <div className="form-group">
                                                                    <label className="form-label">Qty Drop</label>
                                                                    <FormattedNumberInput
                                                                        min={0}
                                                                        maxFractionDigits={2}
                                                                        value={Number(item.qtyKoli || 0)}
                                                                        onValueChange={value => updateActualDropDraft(item.draftKey, 'qtyKoli', String(value))}
                                                                        disabled={updatingStatus}
                                                                    />
                                                                </div>
                                                                <div className="form-group">
                                                                    <label className="form-label">Berat Drop</label>
                                                                    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 110px', gap: '0.5rem' }}>
                                                                        <FormattedNumberInput
                                                                            min={0}
                                                                            maxFractionDigits={2}
                                                                            value={Number(item.weightInputValue || 0)}
                                                                            onValueChange={value => updateActualDropDraft(item.draftKey, 'weightInputValue', String(value))}
                                                                            disabled={updatingStatus}
                                                                        />
                                                                        <select
                                                                            className="form-select"
                                                                            value={item.weightInputUnit}
                                                                            onChange={e => updateActualDropDraft(item.draftKey, 'weightInputUnit', e.target.value)}
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
                                                                    <label className="form-label">Volume Drop</label>
                                                                    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 110px', gap: '0.5rem' }}>
                                                                        <FormattedNumberInput
                                                                            min={0}
                                                                            maxFractionDigits={2}
                                                                            value={Number(item.volumeInputValue || 0)}
                                                                            onValueChange={value => updateActualDropDraft(item.draftKey, 'volumeInputValue', String(value))}
                                                                            disabled={updatingStatus}
                                                                        />
                                                                        <select
                                                                            className="form-select"
                                                                            value={item.volumeInputUnit}
                                                                            onChange={e => updateActualDropDraft(item.draftKey, 'volumeInputUnit', e.target.value)}
                                                                            disabled={updatingStatus}
                                                                        >
                                                                            {VOLUME_INPUT_UNIT_OPTIONS.map(option => (
                                                                                <option key={option.value} value={option.value}>{option.label}</option>
                                                                            ))}
                                                                        </select>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                            <div className="form-group">
                                                                <label className="form-label">Catatan Titik Drop</label>
                                                                <textarea
                                                                    className="form-textarea"
                                                                    rows={2}
                                                                    value={item.note}
                                                                    onChange={e => updateActualDropDraft(item.draftKey, 'note', e.target.value)}
                                                                    disabled={updatingStatus}
                                                                    placeholder="Mis. 30 koli turun di Malang, sisa lanjut ke Ponorogo"
                                                                />
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </>
                                        )}
                                    </div>
                                </>
                            )}
                            <div className="form-group">
                                <label className="form-label">Catatan</label>
                                <textarea className="form-textarea" rows={3} value={statusNote} onChange={e => setStatusNote(e.target.value)} placeholder={isCompletingDelivery ? 'Catatan penyelesaian DO...' : 'Catatan tracking...'} disabled={updatingStatus} />
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => { setShowStatusModal(false); setReviewingDriverRequest(false); }} disabled={updatingStatus}>Batal</button>
                            <button className={`btn ${isCompletingDelivery ? 'btn-success' : 'btn-primary'}`} onClick={updateDOStatus} disabled={!newStatus || updatingStatus || (isCompletingDelivery && (!podName.trim() || !podDate || !actualCargoReady || !actualDropReady))}>
                                <Save size={16} /> {updatingStatus ? 'Menyimpan...' : (reviewingDriverRequest ? 'Approve & Selesaikan' : (isCompletingDelivery ? 'Selesaikan DO' : 'Simpan'))}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {showRejectRequestModal && (
                <div className="modal-overlay" onClick={() => { if (!rejectingRequest) setShowRejectRequestModal(false); }}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3 className="modal-title">Tolak Permintaan Driver</h3>
                            <button className="modal-close" onClick={() => setShowRejectRequestModal(false)} disabled={rejectingRequest}>&times;</button>
                        </div>
                        <div className="modal-body">
                            <div className="form-group">
                                <label className="form-label">Alasan Penolakan <span className="required">*</span></label>
                                <textarea
                                    className="form-textarea"
                                    rows={3}
                                    value={rejectRequestNote}
                                    onChange={e => setRejectRequestNote(e.target.value)}
                                    disabled={rejectingRequest}
                                    placeholder="Mis. POD belum lengkap atau barang belum benar-benar diterima."
                                />
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setShowRejectRequestModal(false)} disabled={rejectingRequest}>Batal</button>
                            <button className="btn btn-danger" onClick={rejectDriverStatusRequest} disabled={rejectingRequest || !rejectRequestNote.trim()}>
                                <Save size={16} /> {rejectingRequest ? 'Menyimpan...' : 'Tolak Permintaan'}
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

