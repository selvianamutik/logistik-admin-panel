import type { OrderItemStatus } from '@/lib/types';

type OrderItemProgressSource = {
  qtyKoli?: number;
  weight?: number;
  status?: OrderItemStatus | string;
  deliveredQtyKoli?: number;
  deliveredWeight?: number;
  assignedQtyKoli?: number;
  assignedWeight?: number;
  heldQtyKoli?: number;
  heldWeight?: number;
};

export type OrderItemProgress = {
  totalQtyKoli: number;
  totalWeight: number;
  deliveredQtyKoli: number;
  deliveredWeight: number;
  assignedQtyKoli: number;
  assignedWeight: number;
  heldQtyKoli: number;
  heldWeight: number;
  pendingQtyKoli: number;
  pendingWeight: number;
};

function clampNonNegative(value: unknown) {
  const normalized = typeof value === 'number' ? value : Number(value);
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
  if (!Number.isFinite(totalQtyKoli) || totalQtyKoli <= 0) {
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
  const totalQtyKoli = clampNonNegative(source.qtyKoli);
  const totalWeight = clampNonNegative(source.weight);
  const hasExplicitProgress =
    source.deliveredQtyKoli !== undefined ||
    source.deliveredWeight !== undefined ||
    source.assignedQtyKoli !== undefined ||
    source.assignedWeight !== undefined ||
    source.heldQtyKoli !== undefined ||
    source.heldWeight !== undefined;

  let deliveredQtyKoli = 0;
  let deliveredWeight = 0;
  let assignedQtyKoli = 0;
  let assignedWeight = 0;
  let heldQtyKoli = 0;
  let heldWeight = 0;

  if (hasExplicitProgress) {
    deliveredQtyKoli = clampPortion(totalQtyKoli, clampNonNegative(source.deliveredQtyKoli));
    deliveredWeight = clampPortion(totalWeight, clampNonNegative(source.deliveredWeight));
    assignedQtyKoli = clampPortion(totalQtyKoli, clampNonNegative(source.assignedQtyKoli));
    assignedWeight = clampPortion(totalWeight, clampNonNegative(source.assignedWeight));
    heldQtyKoli = clampPortion(totalQtyKoli, clampNonNegative(source.heldQtyKoli));
    heldWeight = clampPortion(totalWeight, clampNonNegative(source.heldWeight));
  } else {
    if (source.status === 'DELIVERED') {
      deliveredQtyKoli = totalQtyKoli;
      deliveredWeight = totalWeight;
    } else if (source.status === 'ASSIGNED' || source.status === 'ON_DELIVERY') {
      assignedQtyKoli = totalQtyKoli;
      assignedWeight = totalWeight;
    } else if (source.status === 'HOLD') {
      heldQtyKoli = totalQtyKoli;
      heldWeight = totalWeight;
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

  return {
    totalQtyKoli,
    totalWeight,
    deliveredQtyKoli,
    deliveredWeight,
    assignedQtyKoli,
    assignedWeight,
    heldQtyKoli,
    heldWeight,
    pendingQtyKoli: roundQuantity(Math.max(totalQtyKoli - deliveredQtyKoli - assignedQtyKoli - heldQtyKoli, 0)),
    pendingWeight: roundQuantity(Math.max(totalWeight - deliveredWeight - assignedWeight - heldWeight, 0)),
  };
}

export function deriveOrderItemStatusFromProgress(progress: OrderItemProgress, mode: 'default' | 'in-transit' = 'default'): OrderItemStatus {
  if (progress.totalQtyKoli > 0 && progress.deliveredQtyKoli >= progress.totalQtyKoli) {
    return 'DELIVERED';
  }
  if (mode === 'in-transit' && progress.assignedQtyKoli > 0) {
    return 'ON_DELIVERY';
  }
  if (progress.assignedQtyKoli > 0) {
    return 'ASSIGNED';
  }
  if (progress.deliveredQtyKoli > 0) {
    return 'PARTIAL';
  }
  if (progress.heldQtyKoli > 0) {
    return 'HOLD';
  }
  return 'PENDING';
}
