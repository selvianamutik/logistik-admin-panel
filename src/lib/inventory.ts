import { parseFormattedNumberish } from './formatted-number';
import type {
  Purchase,
  PurchaseItem,
  PurchasePayment,
  PurchaseStatus,
  StockMovementSourceType,
  StockMovementType,
  WarehouseItem,
  WarehouseItemTrackingMode,
} from './types';

export const INVENTORY_UNIT_OPTIONS = [
  'PCS',
  'UNIT',
  'BOX',
  'SET',
  'ROLL',
  'KG',
  'LITER',
  'METER',
] as const;

export const PURCHASE_STATUS_LABELS: Record<PurchaseStatus, string> = {
  ORDERED: 'Dipesan',
  PARTIALLY_RECEIVED: 'Diterima Sebagian',
  RECEIVED: 'Diterima',
  PARTIALLY_PAID: 'Sebagian Dibayar',
  PAID: 'Lunas',
  CANCELLED: 'Dibatalkan',
};

export const STOCK_MOVEMENT_TYPE_LABELS: Record<StockMovementType, string> = {
  IN: 'Stok Masuk',
  OUT: 'Stok Keluar',
  ADJUSTMENT: 'Penyesuaian',
};

export const STOCK_MOVEMENT_SOURCE_LABELS: Record<StockMovementSourceType, string> = {
  PURCHASE_RECEIPT: 'Penerimaan Pembelian',
  MANUAL_IN: 'Stok Masuk Manual',
  MANUAL_OUT: 'Stok Keluar Manual',
  ADJUSTMENT: 'Penyesuaian Stok',
  TIRE_DEPLOYMENT: 'Ban Keluar Gudang',
  TIRE_RETURN: 'Ban Kembali ke Gudang',
};

export const WAREHOUSE_ITEM_TRACKING_MODE_OPTIONS = [
  'STANDARD',
  'TIRE_ASSET',
] as const;

export const WAREHOUSE_ITEM_TRACKING_MODE_LABELS: Record<WarehouseItemTrackingMode, string> = {
  STANDARD: 'Barang Umum',
  TIRE_ASSET: 'Ban Tertracking',
};

export function isInventoryUnit(value: unknown): value is WarehouseItem['unit'] {
  return typeof value === 'string' && INVENTORY_UNIT_OPTIONS.includes(value as WarehouseItem['unit']);
}

export function normalizeWarehouseItemTrackingMode(value: unknown): WarehouseItemTrackingMode {
  return value === 'TIRE_ASSET' ? 'TIRE_ASSET' : 'STANDARD';
}

export function isWarehouseItemTrackingMode(value: unknown): value is WarehouseItemTrackingMode {
  return value === 'STANDARD' || value === 'TIRE_ASSET';
}

export function isTireTrackedWarehouseItem(
  item: Pick<WarehouseItem, 'trackingMode'> | Pick<PurchaseItem, 'trackingMode'> | null | undefined
) {
  return normalizeWarehouseItemTrackingMode(item?.trackingMode) === 'TIRE_ASSET';
}

export function parseInventoryQuantity(value: unknown) {
  const normalized = parseFormattedNumberish(value ?? 0, { maxFractionDigits: 3 });
  return Number.isFinite(normalized) ? normalized : Number.NaN;
}

export function parseWholeMoneyAmount(value: unknown) {
  const normalized = parseFormattedNumberish(value ?? 0, { maxFractionDigits: 0 });
  return Number.isFinite(normalized) ? Math.round(normalized) : Number.NaN;
}

export function formatInventoryQuantity(value: unknown) {
  const numeric = parseInventoryQuantity(value);
  if (!Number.isFinite(numeric)) return '0';
  const isInteger = Math.abs(numeric - Math.round(numeric)) < 0.000_001;
  return new Intl.NumberFormat('id-ID', {
    minimumFractionDigits: isInteger ? 0 : 3,
    maximumFractionDigits: isInteger ? 0 : 3,
  }).format(isInteger ? Math.round(numeric) : numeric);
}

export function computePurchaseStatus(params: {
  totalOrderedQty: number;
  totalReceivedQty: number;
  totalAmount: number;
  paidAmount: number;
  existingStatus?: PurchaseStatus;
}) {
  if (params.existingStatus === 'CANCELLED') {
    return 'CANCELLED' satisfies PurchaseStatus;
  }
  const fullyReceived = params.totalOrderedQty > 0 && params.totalReceivedQty >= params.totalOrderedQty;
  const partiallyReceived = params.totalReceivedQty > 0 && params.totalReceivedQty < params.totalOrderedQty;
  const fullyPaid = params.totalAmount > 0 && params.paidAmount >= params.totalAmount;
  const partiallyPaid = params.paidAmount > 0 && params.paidAmount < params.totalAmount;

  if (fullyPaid) {
    return 'PAID' satisfies PurchaseStatus;
  }
  if (partiallyPaid) {
    return 'PARTIALLY_PAID' satisfies PurchaseStatus;
  }
  if (fullyReceived) {
    return 'RECEIVED' satisfies PurchaseStatus;
  }
  if (partiallyReceived) {
    return 'PARTIALLY_RECEIVED' satisfies PurchaseStatus;
  }
  return 'ORDERED' satisfies PurchaseStatus;
}

export function computePurchaseSummary(input: {
  purchase: Pick<Purchase, 'status'>;
  items: Array<Pick<PurchaseItem, 'orderedQty' | 'receivedQty' | 'subtotal'>>;
  payments: Array<Pick<PurchasePayment, 'amount'>>;
}) {
  const totalOrderedQty = input.items.reduce((sum, item) => sum + Math.max(parseInventoryQuantity(item.orderedQty), 0), 0);
  const totalReceivedQty = input.items.reduce((sum, item) => sum + Math.max(parseInventoryQuantity(item.receivedQty), 0), 0);
  const totalAmount = input.items.reduce((sum, item) => sum + Math.max(parseWholeMoneyAmount(item.subtotal), 0), 0);
  const paidAmount = input.payments.reduce((sum, payment) => sum + Math.max(parseWholeMoneyAmount(payment.amount), 0), 0);
  const outstandingAmount = Math.max(totalAmount - paidAmount, 0);
  const status = computePurchaseStatus({
    totalOrderedQty,
    totalReceivedQty,
    totalAmount,
    paidAmount,
    existingStatus: input.purchase.status,
  });

  return {
    totalOrderedQty,
    totalReceivedQty,
    totalAmount,
    paidAmount,
    outstandingAmount,
    lineCount: input.items.length,
    status,
  };
}
