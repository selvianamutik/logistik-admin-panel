import type { DeliveryOrder, DeliveryOrderItem } from '@/lib/types';
import type { VolumeInputUnit, WeightInputUnit } from '@/lib/measurement';

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
