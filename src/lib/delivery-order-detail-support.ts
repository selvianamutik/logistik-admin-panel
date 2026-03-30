import type { DeliveryOrder, DeliveryOrderItem, Driver, Order, TrackingLog, Vehicle } from '@/lib/types';
import { parseFormattedNumberish } from '@/lib/formatted-number';
import type { VolumeInputUnit, WeightInputUnit } from '@/lib/measurement';
import { formatCargoSummary } from '@/lib/measurement';
import { DO_ACTUAL_DROP_TYPE_MAP, DO_STATUS_MAP, formatDate, formatDateTime, formatShipperDeliveryOrderNumber } from '@/lib/utils';

export interface ActualCargoDraft {
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
    requireQty: boolean;
    requireWeight: boolean;
    requireVolume: boolean;
}

export interface ActualDropDraft {
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

export type DeliveryOrderDetailState = {
    actualCargoTotals: {
        qtyKoli: number;
        weightKg: number;
        volumeM3: number;
    };
    autoActualDropDraft: ActualDropDraft;
    effectiveActualDropPoints: ActualDropDraft[];
    actualCargoReady: boolean;
    actualDropReady: boolean;
    actualDropPointCount: number;
    actualDropSummary: NonNullable<DeliveryOrder['actualDropPoints']>;
    hasLiveCoordinates: boolean;
    trackingMapUrl: string | null;
    mapEmbedUrl: string | null;
};

export function buildActualCargoDraft(item: DeliveryOrderItem): ActualCargoDraft {
    const plannedQtyKoli = Number(item.orderItemQtyKoli || item.shippedQtyKoli || 0);
    return {
        deliveryOrderItemRef: item._id,
        description: item.orderItemDescription || '-',
        plannedQtyKoli,
        plannedWeightKg: Number(item.orderItemWeight || item.shippedWeight || 0),
        plannedWeightInputValue: item.orderItemWeightInputValue,
        plannedWeightInputUnit: item.orderItemWeightInputUnit,
        plannedVolumeM3: item.orderItemVolumeM3,
        plannedVolumeInputValue: item.orderItemVolumeInputValue,
        plannedVolumeInputUnit: item.orderItemVolumeInputUnit,
        actualQtyKoli: plannedQtyKoli > 0 ? String(item.actualQtyKoli ?? item.orderItemQtyKoli ?? item.shippedQtyKoli ?? 0) : '',
        actualWeightInputValue: String(item.actualWeightInputValue ?? item.orderItemWeightInputValue ?? item.actualWeightKg ?? item.orderItemWeight ?? item.shippedWeight ?? ''),
        actualWeightInputUnit: item.actualWeightInputUnit || item.orderItemWeightInputUnit || 'KG',
        actualVolumeInputValue: String(item.actualVolumeInputValue ?? item.orderItemVolumeInputValue ?? item.actualVolumeM3 ?? item.orderItemVolumeM3 ?? ''),
        actualVolumeInputUnit: item.actualVolumeInputUnit || item.orderItemVolumeInputUnit || 'M3',
        requireQty: plannedQtyKoli > 0,
        requireWeight: Number(item.orderItemWeight || item.shippedWeight || 0) > 0,
        requireVolume: Number(item.orderItemVolumeM3 || 0) > 0,
    };
}

export function summarizeActualCargoDrafts(items: ActualCargoDraft[]) {
    const qtyKoli = items.reduce((sum, item) => sum + parseFormattedNumberish(item.actualQtyKoli || 0), 0);
    const weightKg = items.reduce((sum, item) => {
        const value = parseFormattedNumberish(item.actualWeightInputValue || 0, {
            maxFractionDigits: item.actualWeightInputUnit === 'TON' ? 3 : 2,
        });
        if (!value) return sum;
        return sum + (item.actualWeightInputUnit === 'TON' ? value * 1000 : value);
    }, 0);
    const volumeM3 = items.reduce((sum, item) => {
        const value = parseFormattedNumberish(item.actualVolumeInputValue || 0, {
            maxFractionDigits: item.actualVolumeInputUnit === 'LITER' ? 0 : 3,
        });
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

export function buildDefaultActualDropDrafts(doData: DeliveryOrder | null, cargoItems: ActualCargoDraft[]): ActualDropDraft[] {
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

export function buildAutoActualDropDraft(doData: DeliveryOrder | null, cargoItems: ActualCargoDraft[]): ActualDropDraft {
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

export function shouldOpenAdvancedDropEditor(doData: DeliveryOrder | null, dropDrafts: ActualDropDraft[]) {
    const defaultLocationName = doData?.receiverCompany || doData?.receiverName || 'Tujuan Tagihan';
    const defaultLocationAddress = doData?.receiverAddress || '';

    return dropDrafts.length > 1 || dropDrafts.some(point =>
        point.stopType !== 'DROP' ||
        (point.locationName || '') !== defaultLocationName ||
        (point.locationAddress || '') !== defaultLocationAddress ||
        point.note.trim().length > 0
    );
}

export function getNextDeliveryOrderStatuses(current: string): string[] {
    const transitions: Record<string, string[]> = {
        CREATED: ['HEADING_TO_PICKUP', 'ON_DELIVERY', 'CANCELLED'],
        HEADING_TO_PICKUP: ['ON_DELIVERY', 'CANCELLED'],
        ON_DELIVERY: ['ARRIVED', 'DELIVERED', 'CANCELLED'],
        ARRIVED: ['DELIVERED', 'CANCELLED'],
    };
    return transitions[current] || [];
}

export function buildTripResourceBusyIds(activeDeliveryOrders: DeliveryOrder[], currentDeliveryOrderId: string) {
    const busyVehicleIds = new Set<string>();
    const busyDriverIds = new Set<string>();

    for (const deliveryOrder of activeDeliveryOrders) {
        if (deliveryOrder._id === currentDeliveryOrderId) {
            continue;
        }
        if (deliveryOrder.vehicleRef) {
            busyVehicleIds.add(deliveryOrder.vehicleRef);
        }
        if (deliveryOrder.driverRef) {
            busyDriverIds.add(deliveryOrder.driverRef);
        }
    }

    return {
        busyVehicleIds,
        busyDriverIds,
    };
}

export function getAssignableTripVehicles(params: {
    vehicles: Vehicle[];
    busyVehicleIds: Set<string>;
    currentVehicleRef?: string;
    requestedServiceRef?: string;
}) {
    const { vehicles, busyVehicleIds, currentVehicleRef, requestedServiceRef } = params;

    return vehicles
        .filter(vehicle => {
            const isCurrent = vehicle._id === currentVehicleRef;
            if (!isCurrent && busyVehicleIds.has(vehicle._id)) {
                return false;
            }
            if (!isCurrent && ['SOLD', 'OUT_OF_SERVICE'].includes(vehicle.status)) {
                return false;
            }
            return true;
        })
        .sort((left, right) => {
            const leftMatches = requestedServiceRef && left.serviceRef === requestedServiceRef ? 1 : 0;
            const rightMatches = requestedServiceRef && right.serviceRef === requestedServiceRef ? 1 : 0;
            if (leftMatches !== rightMatches) {
                return rightMatches - leftMatches;
            }
            const leftLabel = `${left.unitCode || ''} ${left.plateNumber || ''}`.trim();
            const rightLabel = `${right.unitCode || ''} ${right.plateNumber || ''}`.trim();
            return leftLabel.localeCompare(rightLabel, 'id');
        });
}

export function getAssignableTripDrivers(params: {
    drivers: Driver[];
    busyDriverIds: Set<string>;
    currentDriverRef?: string;
}) {
    const { drivers, busyDriverIds, currentDriverRef } = params;

    return drivers
        .filter(driver => {
            const isCurrent = driver._id === currentDriverRef;
            if (!isCurrent && busyDriverIds.has(driver._id)) {
                return false;
            }
            return driver.active !== false || isCurrent;
        })
        .sort((left, right) => (left.name || '').localeCompare(right.name || '', 'id'));
}

export function shouldRequireTripVehicleOverrideReason(deliveryOrder: DeliveryOrder | null, vehicle: Vehicle | null) {
    if (!deliveryOrder?.serviceRef || !vehicle) {
        return false;
    }
    return (vehicle.serviceRef || '') !== deliveryOrder.serviceRef;
}

export function getTripResourceActionLabel(deliveryOrder: DeliveryOrder | null) {
    if (!deliveryOrder) {
        return 'Lengkapi Armada Trip';
    }
    if (!deliveryOrder.vehicleRef && !deliveryOrder.driverRef) {
        return 'Lengkapi Armada Trip';
    }
    if (!deliveryOrder.vehicleRef) {
        return 'Pilih Kendaraan';
    }
    if (!deliveryOrder.driverRef) {
        return 'Pilih Supir';
    }
    return 'Ganti Armada / Supir';
}

export function buildDeliveryOrderDetailState(params: {
    doData: DeliveryOrder | null;
    actualCargoItems: ActualCargoDraft[];
    actualDropPoints: ActualDropDraft[];
    showAdvancedDropEditor: boolean;
}): DeliveryOrderDetailState {
    const { doData, actualCargoItems, actualDropPoints, showAdvancedDropEditor } = params;
    const actualCargoTotals = summarizeActualCargoDrafts(actualCargoItems);
    const autoActualDropDraft = buildAutoActualDropDraft(doData, actualCargoItems);
    const effectiveActualDropPoints = showAdvancedDropEditor ? actualDropPoints : [autoActualDropDraft];
    const actualCargoReady = actualCargoItems.every(item => {
        const qty = parseFormattedNumberish(item.actualQtyKoli);
        const weight = parseFormattedNumberish(item.actualWeightInputValue, {
            maxFractionDigits: item.actualWeightInputUnit === 'TON' ? 3 : 2,
        });
        const volume = parseFormattedNumberish(item.actualVolumeInputValue, {
            maxFractionDigits: item.actualVolumeInputUnit === 'LITER' ? 0 : 3,
        });
        return (
            (!item.requireQty || (Number.isFinite(qty) && qty > 0)) &&
            (!item.requireWeight || (Number.isFinite(weight) && weight > 0)) &&
            (!item.requireVolume || (Number.isFinite(volume) && volume > 0)) &&
            (
                (item.requireQty && Number.isFinite(qty) && qty > 0) ||
                (Number.isFinite(weight) && weight > 0) ||
                (Number.isFinite(volume) && volume > 0)
            )
        );
    });
    const actualDropReady = effectiveActualDropPoints.length > 0 && effectiveActualDropPoints.every(item => {
        const qty = parseFormattedNumberish(item.qtyKoli);
        const weight = parseFormattedNumberish(item.weightInputValue, {
            maxFractionDigits: item.weightInputUnit === 'TON' ? 3 : 2,
        });
        const volume = parseFormattedNumberish(item.volumeInputValue, {
            maxFractionDigits: item.volumeInputUnit === 'LITER' ? 0 : 3,
        });
        return (
            Boolean(item.locationName.trim() || item.locationAddress.trim()) &&
            ((Number.isFinite(qty) && qty > 0) || (Number.isFinite(weight) && weight > 0) || (Number.isFinite(volume) && volume > 0))
        );
    });
    const actualDropPointCount = effectiveActualDropPoints.length;
    const actualDropSummary = doData?.actualDropPoints || [];
    const hasLiveCoordinates = typeof doData?.trackingLastLat === 'number' && typeof doData?.trackingLastLng === 'number';
    const trackingMapUrl = hasLiveCoordinates ? `https://www.google.com/maps?q=${doData?.trackingLastLat},${doData?.trackingLastLng}` : null;
    const trackingLat = hasLiveCoordinates ? (doData?.trackingLastLat as number) : null;
    const trackingLng = hasLiveCoordinates ? (doData?.trackingLastLng as number) : null;
    const mapEmbedUrl = hasLiveCoordinates
        ? `https://www.openstreetmap.org/export/embed.html?bbox=${trackingLng! - 0.01},${trackingLat! - 0.01},${trackingLng! + 0.01},${trackingLat! + 0.01}&layer=mapnik&marker=${trackingLat!},${trackingLng!}`
        : null;

    return {
        actualCargoTotals,
        autoActualDropDraft,
        effectiveActualDropPoints,
        actualCargoReady,
        actualDropReady,
        actualDropPointCount,
        actualDropSummary,
        hasLiveCoordinates,
        trackingMapUrl,
        mapEmbedUrl,
    };
}

export function buildDeliveryOrderPrintHtml(
    doData: DeliveryOrder,
    doItems: DeliveryOrderItem[],
    trackingLogs: TrackingLog[]
) {
    return `
        <div style="margin-bottom:16px">
            <table style="width:100%;border:none"><tbody>
                <tr>
                    <td style="border:none;padding:2px 8px;width:140px;font-weight:600">No. SJ Pengirim</td>
                    <td style="border:none;padding:2px 8px">${formatShipperDeliveryOrderNumber(doData)}</td>
                    <td style="border:none;padding:2px 8px;width:140px;font-weight:600">Tanggal</td>
                    <td style="border:none;padding:2px 8px">${formatDate(doData.date || '')}</td>
                </tr>
                <tr>
                    <td style="border:none;padding:2px 8px;font-weight:600">No. DO Internal</td>
                    <td style="border:none;padding:2px 8px">${doData.doNumber || '-'}</td>
                    <td style="border:none;padding:2px 8px;font-weight:600">Master Resi</td>
                    <td style="border:none;padding:2px 8px">${doData.masterResi || '-'}</td>
                </tr>
                <tr>
                    <td style="border:none;padding:2px 8px;font-weight:600"></td>
                    <td style="border:none;padding:2px 8px"></td>
                    <td style="border:none;padding:2px 8px;font-weight:600">Status</td>
                    <td style="border:none;padding:2px 8px">${DO_STATUS_MAP[doData.status || '']?.label || doData.status || '-'}</td>
                </tr>
                <tr>
                    <td style="border:none;padding:2px 8px;font-weight:600">Customer</td>
                    <td style="border:none;padding:2px 8px">${doData.customerName || '-'}</td>
                    <td style="border:none;padding:2px 8px;font-weight:600">Kendaraan</td>
                    <td style="border:none;padding:2px 8px">${doData.vehiclePlate || '-'}</td>
                </tr>
                <tr>
                    <td style="border:none;padding:2px 8px;font-weight:600">Driver</td>
                    <td style="border:none;padding:2px 8px">${doData.driverName || '-'}</td>
                    <td style="border:none;padding:2px 8px;font-weight:600">Penerima</td>
                    <td style="border:none;padding:2px 8px">${doData.receiverName || '-'}</td>
                </tr>
                <tr>
                    <td style="border:none;padding:2px 8px;font-weight:600">Telepon Penerima</td>
                    <td style="border:none;padding:2px 8px">${doData.receiverPhone || '-'}</td>
                    <td style="border:none;padding:2px 8px;font-weight:600">Armada Diminta</td>
                    <td style="border:none;padding:2px 8px">${doData.serviceName || '-'}</td>
                </tr>
                <tr>
                    <td style="border:none;padding:2px 8px;font-weight:600">Armada Aktual</td>
                    <td style="border:none;padding:2px 8px">${doData.vehicleServiceName || doData.serviceName || '-'}</td>
                    <td style="border:none;padding:2px 8px;font-weight:600">Kendaraan</td>
                    <td style="border:none;padding:2px 8px">${doData.vehiclePlate || '-'}</td>
                </tr>
                ${doData.vehicleCategoryOverrideReason ? `<tr><td style="border:none;padding:2px 8px;font-weight:600">Alasan Override Armada</td><td colspan="3" style="border:none;padding:2px 8px">${doData.vehicleCategoryOverrideReason}</td></tr>` : ''}
                ${doData.receiverCompany ? `<tr><td style="border:none;padding:2px 8px;font-weight:600">Perusahaan Penerima</td><td colspan="3" style="border:none;padding:2px 8px">${doData.receiverCompany}</td></tr>` : ''}
                <tr>
                    <td style="border:none;padding:2px 8px;font-weight:600">Alamat Pickup</td>
                    <td colspan="3" style="border:none;padding:2px 8px">${doData.pickupAddress || '-'}</td>
                </tr>
                <tr>
                    <td style="border:none;padding:2px 8px;font-weight:600">Alamat Penerima</td>
                    <td colspan="3" style="border:none;padding:2px 8px">${doData.receiverAddress || '-'}</td>
                </tr>
                ${doData.notes ? `<tr><td style="border:none;padding:2px 8px;font-weight:600">Catatan</td><td colspan="3" style="border:none;padding:2px 8px">${doData.notes}</td></tr>` : ''}
                ${doData.podReceiverName ? `<tr><td style="border:none;padding:2px 8px;font-weight:600">POD</td><td colspan="3" style="border:none;padding:2px 8px">Diterima oleh ${doData.podReceiverName} pada ${formatDate(doData.podReceivedDate || '')}${doData.podNote ? ` - ${doData.podNote}` : ''}</td></tr>` : ''}
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
                ${(doData.actualDropPoints || []).length > 0
                    ? (doData.actualDropPoints || [])
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
                            <td>1. ${doData.receiverCompany || doData.receiverName || 'Tujuan Tagihan'}</td>
                            <td>${doData.receiverAddress || '-'}</td>
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
    `;
}

export function buildResolvedDeliveryOrder(deliveryOrder: DeliveryOrder | null, sourceOrder: Order | null) {
    if (!deliveryOrder) {
        return null;
    }

    return {
        ...deliveryOrder,
        customerName: deliveryOrder.customerName || sourceOrder?.customerName,
        receiverName: deliveryOrder.receiverName || sourceOrder?.receiverName,
        receiverPhone: deliveryOrder.receiverPhone || sourceOrder?.receiverPhone,
        receiverAddress: deliveryOrder.receiverAddress || sourceOrder?.receiverAddress,
        receiverCompany: deliveryOrder.receiverCompany || sourceOrder?.receiverCompany,
        pickupAddress: deliveryOrder.pickupAddress || sourceOrder?.pickupAddress,
        serviceRef: deliveryOrder.serviceRef || sourceOrder?.serviceRef,
        serviceName: deliveryOrder.serviceName || sourceOrder?.serviceName,
    };
}

export function sortTrackingLogs(logs: TrackingLog[]) {
    return [...logs].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
}

export function createEmptyActualDropDraft(): ActualDropDraft {
    return {
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
    };
}

export function buildDeliveryOrderStatusUpdateData(params: {
    id?: string;
    status: string;
    note: string;
    actualCargoItems: ActualCargoDraft[];
    actualDropPoints: ActualDropDraft[];
    effectiveActualDropPoints: ActualDropDraft[];
    podName: string;
    podDate: string;
    podNote: string;
}) {
    const completingDelivery = params.status === 'DELIVERED';

    return {
        id: params.id,
        status: params.status,
        note: params.note,
        ...(completingDelivery
            ? {
                podReceiverName: params.podName,
                podReceivedDate: params.podDate,
                podNote: params.podNote,
                actualItems: params.actualCargoItems.map(item => ({
                    deliveryOrderItemRef: item.deliveryOrderItemRef,
                    actualQtyKoli: parseFormattedNumberish(item.actualQtyKoli),
                    actualWeightInputValue: parseFormattedNumberish(item.actualWeightInputValue, {
                        maxFractionDigits: item.actualWeightInputUnit === 'TON' ? 3 : 2,
                    }),
                    actualWeightInputUnit: item.actualWeightInputUnit,
                    actualVolumeInputValue: item.actualVolumeInputValue.trim()
                        ? parseFormattedNumberish(item.actualVolumeInputValue, {
                            maxFractionDigits: item.actualVolumeInputUnit === 'LITER' ? 0 : 3,
                        })
                        : 0,
                    actualVolumeInputUnit: item.actualVolumeInputUnit,
                })),
                actualDropPoints: params.effectiveActualDropPoints.map(item => ({
                    stopType: item.stopType,
                    locationName: item.locationName,
                    locationAddress: item.locationAddress,
                    qtyKoli: item.qtyKoli.trim() ? parseFormattedNumberish(item.qtyKoli) : 0,
                    weightInputValue: item.weightInputValue.trim()
                        ? parseFormattedNumberish(item.weightInputValue, {
                            maxFractionDigits: item.weightInputUnit === 'TON' ? 3 : 2,
                        })
                        : 0,
                    weightInputUnit: item.weightInputUnit,
                    volumeInputValue: item.volumeInputValue.trim()
                        ? parseFormattedNumberish(item.volumeInputValue, {
                            maxFractionDigits: item.volumeInputUnit === 'LITER' ? 0 : 3,
                        })
                        : 0,
                    volumeInputUnit: item.volumeInputUnit,
                    note: item.note,
                })),
            }
            : {}),
    };
}

export function buildDeliveryOrderPodUpdateData(params: {
    id?: string;
    podName: string;
    podDate: string;
    podNote: string;
}) {
    return {
        id: params.id,
        updates: {
            podReceiverName: params.podName,
            podReceivedDate: params.podDate,
            podNote: params.podNote,
        },
    };
}

export function buildDeliveryOrderTripFeeUpdateData(params: {
    id?: string;
    tripRouteRateRef?: string;
    tripOriginArea?: string;
    tripDestinationArea?: string;
    taripBorongan: number;
    keteranganBorongan: string;
}) {
    return {
        id: params.id,
        updates: {
            tripRouteRateRef: params.tripRouteRateRef?.trim() || '',
            tripOriginArea: params.tripOriginArea?.trim() || '',
            tripDestinationArea: params.tripDestinationArea?.trim() || '',
            taripBorongan: params.taripBorongan,
            keteranganBorongan: params.keteranganBorongan,
        },
    };
}
