import { isCancelledPurchase, parseInventoryQuantity, parseWholeMoneyAmount } from './inventory';
import type { Purchase, PurchaseItem, WarehouseItem } from './types';

export type SupplierOwnerSummary = {
  purchaseCount: number;
  totalAmount: number;
  outstandingAmount: number;
  paidAmount: number;
  overdueCount: number;
  lastPurchaseDate: string;
};

export type SupplierRelatedItem = {
  _id: string;
  itemCode: string;
  name: string;
  unit: string;
  currentStockQty: number;
  minStockQty: number;
  active: boolean;
  relationType: 'PURCHASED' | 'DEFAULT' | 'PURCHASED_AND_DEFAULT';
  purchaseCount: number;
  totalOrderedQty: number;
  totalReceivedQty: number;
  lastPurchaseDate: string;
};

type SupplierSummaryMap = Record<string, SupplierOwnerSummary>;

function normalizeDateValue(value: string | undefined | null) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)
    ? value.slice(0, 10)
    : '';
}

function toSafeQuantity(value: unknown) {
  const normalized = parseInventoryQuantity(value);
  return Number.isFinite(normalized) ? Math.max(normalized, 0) : 0;
}

export function buildSupplierOwnerSummaryMap(
  purchases: Purchase[],
  today: string,
): SupplierSummaryMap {
  return purchases.reduce<SupplierSummaryMap>((accumulator, purchase) => {
    if (!purchase.supplierRef) {
      return accumulator;
    }

    const current = accumulator[purchase.supplierRef] || {
      purchaseCount: 0,
      totalAmount: 0,
      outstandingAmount: 0,
      paidAmount: 0,
      overdueCount: 0,
      lastPurchaseDate: '',
    };
    const orderDate = normalizeDateValue(purchase.orderDate);
    const dueDate = normalizeDateValue(purchase.dueDate);
    const outstandingAmount = Math.max(parseWholeMoneyAmount(purchase.outstandingAmount), 0);
    const isCancelled = isCancelledPurchase(purchase);

    current.purchaseCount += 1;
    if (!isCancelled) {
      current.totalAmount += Math.max(parseWholeMoneyAmount(purchase.totalAmount), 0);
      current.outstandingAmount += outstandingAmount;
      current.paidAmount += Math.max(parseWholeMoneyAmount(purchase.paidAmount), 0);
    }
    if (!isCancelled && dueDate && dueDate < today && outstandingAmount > 0) {
      current.overdueCount += 1;
    }
    if (orderDate && orderDate > current.lastPurchaseDate) {
      current.lastPurchaseDate = orderDate;
    }

    accumulator[purchase.supplierRef] = current;
    return accumulator;
  }, {});
}

export function buildSupplierRelatedItems(
  supplierId: string,
  purchases: Purchase[],
  purchaseItems: PurchaseItem[],
  warehouseItems: WarehouseItem[],
): SupplierRelatedItem[] {
  const supplierPurchases = purchases.filter((purchase) => purchase.supplierRef === supplierId);
  const purchaseById = new Map(
    supplierPurchases.map((purchase) => [purchase._id, purchase] as const),
  );
  const warehouseItemById = new Map(
    warehouseItems.map((item) => [item._id, item] as const),
  );
  const relatedItems = new Map<string, SupplierRelatedItem>();

  for (const purchaseItem of purchaseItems) {
    const purchase = purchaseById.get(purchaseItem.purchaseRef);
    if (!purchase || !purchaseItem.warehouseItemRef) {
      continue;
    }

    const baseItem = warehouseItemById.get(purchaseItem.warehouseItemRef);
    const current = relatedItems.get(purchaseItem.warehouseItemRef) || {
      _id: purchaseItem.warehouseItemRef,
      itemCode: baseItem?.itemCode || purchaseItem.itemCode || purchaseItem.warehouseItemRef,
      name: baseItem?.name || purchaseItem.itemName || purchaseItem.warehouseItemRef,
      unit: baseItem?.unit || purchaseItem.itemUnit || '-',
      currentStockQty: toSafeQuantity(baseItem?.currentStockQty),
      minStockQty: toSafeQuantity(baseItem?.minStockQty),
      active: baseItem?.active !== false,
      relationType: 'PURCHASED' as const,
      purchaseCount: 0,
      totalOrderedQty: 0,
      totalReceivedQty: 0,
      lastPurchaseDate: '',
    };

    current.purchaseCount += 1;
    current.totalOrderedQty += Math.max(parseInventoryQuantity(purchaseItem.orderedQty), 0);
    current.totalReceivedQty += Math.max(parseInventoryQuantity(purchaseItem.receivedQty), 0);
    const orderDate = normalizeDateValue(purchase.orderDate);
    if (orderDate && orderDate > current.lastPurchaseDate) {
      current.lastPurchaseDate = orderDate;
    }

    relatedItems.set(purchaseItem.warehouseItemRef, current);
  }

  for (const item of warehouseItems) {
    if (item.defaultSupplierRef !== supplierId) {
      continue;
    }

    const current = relatedItems.get(item._id);
    if (!current) {
      relatedItems.set(item._id, {
        _id: item._id,
        itemCode: item.itemCode || item._id,
        name: item.name || item._id,
        unit: item.unit || '-',
        currentStockQty: toSafeQuantity(item.currentStockQty),
        minStockQty: toSafeQuantity(item.minStockQty),
        active: item.active !== false,
        relationType: 'DEFAULT',
        purchaseCount: 0,
        totalOrderedQty: 0,
        totalReceivedQty: 0,
        lastPurchaseDate: '',
      });
      continue;
    }

    relatedItems.set(item._id, {
      ...current,
      itemCode: item.itemCode || current.itemCode,
      name: item.name || current.name,
      unit: item.unit || current.unit,
      currentStockQty: toSafeQuantity(item.currentStockQty),
      minStockQty: toSafeQuantity(item.minStockQty),
      active: item.active !== false,
      relationType: current.relationType === 'PURCHASED' ? 'PURCHASED_AND_DEFAULT' : current.relationType,
    });
  }

  return Array.from(relatedItems.values()).sort((left, right) => {
    const lastPurchaseCompare = right.lastPurchaseDate.localeCompare(left.lastPurchaseDate);
    if (lastPurchaseCompare !== 0) return lastPurchaseCompare;
    const itemCodeCompare = String(left.itemCode || '').localeCompare(String(right.itemCode || ''));
    if (itemCodeCompare !== 0) return itemCodeCompare;
    return String(left.name || '').localeCompare(String(right.name || ''));
  });
}
