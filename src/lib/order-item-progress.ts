import type { OrderItemStatus } from '@/lib/types';
import { parseFormattedNumberish, type FormattedNumberParseOptions } from '@/lib/formatted-number';

type OrderItemProgressSource = {
  qtyKoli?: number;
  weight?: number;
  volume?: number;
  status?: OrderItemStatus | string;
  deliveredQtyKoli?: number;
  deliveredWeight?: number;
  deliveredVolume?: number;
  assignedQtyKoli?: number;
  assignedWeight?: number;
  assignedVolume?: number;
  heldQtyKoli?: number;
  heldWeight?: number;
  heldVolume?: number;
};

export type OrderItemProgress = {
  totalQtyKoli: number;
  totalWeight: number;
  totalVolume: number;
  deliveredQtyKoli: number;
  deliveredWeight: number;
  deliveredVolume: number;
  assignedQtyKoli: number;
  assignedWeight: number;
  assignedVolume: number;
  heldQtyKoli: number;
  heldWeight: number;
  heldVolume: number;
  assignableQtyKoli: number;
  assignableWeight: number;
  assignableVolume: number;
  pendingQtyKoli: number;
  pendingWeight: number;
  pendingVolume: number;
};

function clampNonNegative(value: unknown, options?: FormattedNumberParseOptions) {
  const normalized = parseFormattedNumberish(value, options);
  if (!Number.isFinite(normalized) || normalized < 0) {
    return 0;
  }
  return normalized;
}

function clampPortion(total: number, value: number) {
  return Math.min(Math.max(value, 0), total);
}

export function roundQuantity(value: number, fractionDigits: number = 2) {
  const factor = 10 ** fractionDigits;
  return Math.round(value * factor) / factor;
}

export function calculateWeightPortion(totalWeight: number, totalQtyKoli: number, qtyKoli: number) {
  if (
    !Number.isFinite(totalWeight) ||
    !Number.isFinite(totalQtyKoli) ||
    !Number.isFinite(qtyKoli) ||
    totalQtyKoli <= 0 ||
    qtyKoli <= 0
  ) {
    return 0;
  }
  return roundQuantity((totalWeight / totalQtyKoli) * qtyKoli, 2);
}

export function calculateVolumePortion(totalVolume: number, totalQtyKoli: number, qtyKoli: number) {
  if (!Number.isFinite(totalQtyKoli) || totalQtyKoli <= 0) {
    return 0;
  }
  return roundQuantity((totalVolume / totalQtyKoli) * qtyKoli, 3);
}

export function getOrderItemProgress(source: OrderItemProgressSource): OrderItemProgress {
  const totalQtyKoli = clampNonNegative(source.qtyKoli, { maxFractionDigits: 2 });
  const totalWeight = clampNonNegative(source.weight, { maxFractionDigits: 2 });
  const totalVolume = clampNonNegative(source.volume, { maxFractionDigits: 3 });
  const hasExplicitProgress =
    source.deliveredQtyKoli !== undefined ||
    source.deliveredWeight !== undefined ||
    source.deliveredVolume !== undefined ||
    source.assignedQtyKoli !== undefined ||
    source.assignedWeight !== undefined ||
    source.assignedVolume !== undefined ||
    source.heldQtyKoli !== undefined ||
    source.heldWeight !== undefined ||
    source.heldVolume !== undefined;

  let deliveredQtyKoli = 0;
  let deliveredWeight = 0;
  let deliveredVolume = 0;
  let assignedQtyKoli = 0;
  let assignedWeight = 0;
  let assignedVolume = 0;
  let heldQtyKoli = 0;
  let heldWeight = 0;
  let heldVolume = 0;

  if (hasExplicitProgress) {
    deliveredQtyKoli = clampPortion(totalQtyKoli, clampNonNegative(source.deliveredQtyKoli, { maxFractionDigits: 2 }));
    deliveredWeight = clampPortion(totalWeight, clampNonNegative(source.deliveredWeight, { maxFractionDigits: 2 }));
    deliveredVolume = clampPortion(totalVolume, clampNonNegative(source.deliveredVolume, { maxFractionDigits: 3 }));
    assignedQtyKoli = clampPortion(totalQtyKoli, clampNonNegative(source.assignedQtyKoli, { maxFractionDigits: 2 }));
    assignedWeight = clampPortion(totalWeight, clampNonNegative(source.assignedWeight, { maxFractionDigits: 2 }));
    assignedVolume = clampPortion(totalVolume, clampNonNegative(source.assignedVolume, { maxFractionDigits: 3 }));
    heldQtyKoli = clampPortion(totalQtyKoli, clampNonNegative(source.heldQtyKoli, { maxFractionDigits: 2 }));
    heldWeight = clampPortion(totalWeight, clampNonNegative(source.heldWeight, { maxFractionDigits: 2 }));
    heldVolume = clampPortion(totalVolume, clampNonNegative(source.heldVolume, { maxFractionDigits: 3 }));
  } else {
    if (source.status === 'DELIVERED') {
      deliveredQtyKoli = totalQtyKoli;
      deliveredWeight = totalWeight;
      deliveredVolume = totalVolume;
    } else if (source.status === 'ASSIGNED' || source.status === 'ON_DELIVERY') {
      assignedQtyKoli = totalQtyKoli;
      assignedWeight = totalWeight;
      assignedVolume = totalVolume;
    } else if (source.status === 'HOLD') {
      heldQtyKoli = totalQtyKoli;
      heldWeight = totalWeight;
      heldVolume = totalVolume;
    }
  }

  const totalQtyUsed = deliveredQtyKoli + assignedQtyKoli + heldQtyKoli;
  if (totalQtyUsed > totalQtyKoli && totalQtyUsed > 0) {
    const ratio = totalQtyKoli / totalQtyUsed;
    deliveredQtyKoli = roundQuantity(deliveredQtyKoli * ratio);
    assignedQtyKoli = roundQuantity(assignedQtyKoli * ratio);
    heldQtyKoli = roundQuantity(heldQtyKoli * ratio);
  }

  const totalWeightUsed = deliveredWeight + assignedWeight + heldWeight;
  if (totalWeightUsed > totalWeight && totalWeightUsed > 0) {
    const ratio = totalWeight / totalWeightUsed;
    deliveredWeight = roundQuantity(deliveredWeight * ratio);
    assignedWeight = roundQuantity(assignedWeight * ratio);
    heldWeight = roundQuantity(heldWeight * ratio);
  }

  const totalVolumeUsed = deliveredVolume + assignedVolume + heldVolume;
  if (totalVolumeUsed > totalVolume && totalVolumeUsed > 0) {
    const ratio = totalVolume / totalVolumeUsed;
    deliveredVolume = roundQuantity(deliveredVolume * ratio, 3);
    assignedVolume = roundQuantity(assignedVolume * ratio, 3);
    heldVolume = roundQuantity(heldVolume * ratio, 3);
  }

  return {
    totalQtyKoli,
    totalWeight,
    totalVolume,
    deliveredQtyKoli,
    deliveredWeight,
    deliveredVolume,
    assignedQtyKoli,
    assignedWeight,
    assignedVolume,
    heldQtyKoli,
    heldWeight,
    heldVolume,
    assignableQtyKoli: roundQuantity(Math.max(totalQtyKoli - deliveredQtyKoli - assignedQtyKoli, 0)),
    assignableWeight: roundQuantity(Math.max(totalWeight - deliveredWeight - assignedWeight, 0)),
    assignableVolume: roundQuantity(Math.max(totalVolume - deliveredVolume - assignedVolume, 0), 3),
    pendingQtyKoli: roundQuantity(Math.max(totalQtyKoli - deliveredQtyKoli - assignedQtyKoli - heldQtyKoli, 0)),
    pendingWeight: roundQuantity(Math.max(totalWeight - deliveredWeight - assignedWeight - heldWeight, 0)),
    pendingVolume: roundQuantity(Math.max(totalVolume - deliveredVolume - assignedVolume - heldVolume, 0), 3),
  };
}

export function deriveOrderItemStatusFromProgress(progress: OrderItemProgress, mode: 'default' | 'in-transit' = 'default'): OrderItemStatus {
  const totalBasis =
    progress.totalQtyKoli > 0
      ? progress.totalQtyKoli
      : progress.totalWeight > 0
        ? progress.totalWeight
        : progress.totalVolume;
  const deliveredBasis =
    progress.totalQtyKoli > 0
      ? progress.deliveredQtyKoli
      : progress.totalWeight > 0
        ? progress.deliveredWeight
        : progress.deliveredVolume;
  const assignedBasis =
    progress.totalQtyKoli > 0
      ? progress.assignedQtyKoli
      : progress.totalWeight > 0
        ? progress.assignedWeight
        : progress.assignedVolume;
  const heldBasis =
    progress.totalQtyKoli > 0
      ? progress.heldQtyKoli
      : progress.totalWeight > 0
        ? progress.heldWeight
        : progress.heldVolume;

  if (mode === 'in-transit' && assignedBasis > 0) {
    return 'ON_DELIVERY';
  }
  if (assignedBasis > 0) {
    return 'ASSIGNED';
  }
  if (heldBasis > 0 && deliveredBasis > 0) {
    return 'PARTIAL';
  }
  if (heldBasis > 0) {
    return 'HOLD';
  }
  if (totalBasis > 0 && deliveredBasis >= totalBasis) {
    return 'DELIVERED';
  }
  if (deliveredBasis > 0) {
    return 'PARTIAL';
  }
  return 'PENDING';
}
