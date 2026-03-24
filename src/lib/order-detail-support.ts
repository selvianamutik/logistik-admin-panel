import {
    convertVolumeToM3,
    convertWeightToKg,
    formatCargoSummary,
    type VolumeInputUnit,
    type WeightInputUnit,
} from '@/lib/measurement';
import { roundQuantity } from '@/lib/order-item-progress';
import type { DeliveryOrderItem } from '@/lib/types';

export type SelectedShipmentMap = Record<string, {
    qtyKoli: string;
    weightInputValue: string;
    weightInputUnit: WeightInputUnit;
    volumeInputValue: string;
    volumeInputUnit: VolumeInputUnit;
    holdRemaining: boolean;
    holdReason: string;
    holdLocation: string;
}>;

export type CargoAggregate = {
    qtyKoli: number;
    weightKg: number;
    volumeM3: number;
};

export function createCargoAggregate(): CargoAggregate {
    return {
        qtyKoli: 0,
        weightKg: 0,
        volumeM3: 0,
    };
}

export function addCargoAggregate(base: CargoAggregate, next: Partial<CargoAggregate>) {
    return {
        qtyKoli: roundQuantity(base.qtyKoli + Number(next.qtyKoli || 0)),
        weightKg: roundQuantity(base.weightKg + Number(next.weightKg || 0)),
        volumeM3: roundQuantity(base.volumeM3 + Number(next.volumeM3 || 0), 3),
    };
}

export function getPlannedDoItemCargo(doItem: DeliveryOrderItem): CargoAggregate {
    return {
        qtyKoli: Number(doItem.orderItemQtyKoli || 0),
        weightKg: Number(doItem.orderItemWeight || 0),
        volumeM3: Number(doItem.orderItemVolumeM3 || 0),
    };
}

export function getActualDoItemCargo(doItem: DeliveryOrderItem): CargoAggregate {
    return {
        qtyKoli: Number(doItem.actualQtyKoli ?? doItem.orderItemQtyKoli ?? 0),
        weightKg: Number(doItem.actualWeightKg ?? doItem.orderItemWeight ?? 0),
        volumeM3: Number(doItem.actualVolumeM3 ?? doItem.orderItemVolumeM3 ?? 0),
    };
}

export function hasCargoAggregate(cargo: CargoAggregate) {
    return cargo.qtyKoli > 0 || cargo.weightKg > 0 || cargo.volumeM3 > 0;
}

export function buildSelectedNonKoliCargo(selection?: SelectedShipmentMap[string]): CargoAggregate {
    if (!selection) {
        return createCargoAggregate();
    }

    return {
        qtyKoli: 0,
        weightKg:
            selection.weightInputValue.trim() && selection.weightInputUnit
                ? roundQuantity(convertWeightToKg(Number(selection.weightInputValue), selection.weightInputUnit))
                : 0,
        volumeM3:
            selection.volumeInputValue.trim() && selection.volumeInputUnit
                ? roundQuantity(convertVolumeToM3(Number(selection.volumeInputValue), selection.volumeInputUnit), 3)
                : 0,
    };
}

export function getCargoBasisValue(cargo: CargoAggregate) {
    if (cargo.qtyKoli > 0) {
        return cargo.qtyKoli;
    }
    if (cargo.weightKg > 0) {
        return cargo.weightKg;
    }
    return cargo.volumeM3;
}

export function formatProgressLine(label: string, cargo: CargoAggregate) {
    if (!hasCargoAggregate(cargo)) {
        return null;
    }
    return `${label}: ${formatCargoSummary({
        qtyKoli: cargo.qtyKoli > 0 ? cargo.qtyKoli : undefined,
        weightKg: cargo.weightKg > 0 ? cargo.weightKg : undefined,
        volumeM3: cargo.volumeM3 > 0 ? cargo.volumeM3 : undefined,
    })}`;
}
