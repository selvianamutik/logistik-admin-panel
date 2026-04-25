import { formatInventoryQuantity, parseInventoryQuantity } from './inventory';
import { normalizeInventoryReportDate } from './inventory-report-period';
import type { StockMovement, WarehouseItem } from './types';

export type InventoryStockRecapRow = {
  warehouseItemRef: string;
  itemCode: string;
  itemName: string;
  category: string;
  unit: WarehouseItem['unit'];
  active: boolean;
  minStockQty: number;
  openingStock: number;
  incomingQty: number;
  outgoingQty: number;
  adjustmentQty: number;
  endingStock: number;
  movementCount: number;
  status: 'OUT_OF_STOCK' | 'LOW_STOCK' | 'OK' | 'INACTIVE';
};

function getMovementDelta(movement: StockMovement) {
  const quantity = getNonNegativeQuantity(movement.quantity);
  if (movement.type === 'OUT') return -quantity;
  if (movement.type === 'ADJUSTMENT') return parseStockRecapQuantity(movement.quantity) || 0;
  return quantity;
}

function parseStockRecapQuantity(value: unknown) {
  if (typeof value === 'string') {
    const cleaned = value.replace(/[^\d,.\-]/g, '').trim();
    const isGroupedIdNumber = /^-?\d{1,3}(\.\d{3})+$/.test(cleaned);
    if (isGroupedIdNumber && !cleaned.includes(',')) {
      const grouped = Number(cleaned.replace(/\./g, ''));
      return Number.isFinite(grouped) ? grouped : Number.NaN;
    }
  }

  return parseInventoryQuantity(value);
}

function getNonNegativeQuantity(value: unknown) {
  const quantity = parseStockRecapQuantity(value);
  return Number.isFinite(quantity) ? Math.max(quantity, 0) : 0;
}

function getStockStatus(item: WarehouseItem, endingStock: number): InventoryStockRecapRow['status'] {
  const minStockQty = getNonNegativeQuantity(item.minStockQty || 0);
  if (item.active === false) return 'INACTIVE';
  if (endingStock <= 0) return 'OUT_OF_STOCK';
  if (minStockQty > 0 && endingStock <= minStockQty) return 'LOW_STOCK';
  return 'OK';
}

export function buildInventoryStockRecapRows(params: {
  items: WarehouseItem[];
  movements: StockMovement[];
  startDate: string;
  endDate: string;
}) {
  const movementsByItem = params.movements.reduce<Record<string, StockMovement[]>>((acc, movement) => {
    if (!movement.warehouseItemRef) return acc;
    if (!acc[movement.warehouseItemRef]) acc[movement.warehouseItemRef] = [];
    acc[movement.warehouseItemRef].push(movement);
    return acc;
  }, {});

  return params.items
    .slice()
    .sort((left, right) => String(left.itemCode || '').localeCompare(String(right.itemCode || '')))
    .map<InventoryStockRecapRow>((item) => {
      const itemMovements = (movementsByItem[item._id] || []).filter((movement) => normalizeInventoryReportDate(movement.movementDate));
      const currentStock = getNonNegativeQuantity(item.currentStockQty || 0);
      const deltasFromPeriodStart = itemMovements
        .filter((movement) => normalizeInventoryReportDate(movement.movementDate) >= params.startDate)
        .reduce((sum, movement) => sum + getMovementDelta(movement), 0);
      const deltasAfterPeriodEnd = itemMovements
        .filter((movement) => normalizeInventoryReportDate(movement.movementDate) > params.endDate)
        .reduce((sum, movement) => sum + getMovementDelta(movement), 0);
      const periodMovements = itemMovements.filter((movement) => {
        const date = normalizeInventoryReportDate(movement.movementDate);
        return date >= params.startDate && date <= params.endDate;
      });
      const openingStock = currentStock - deltasFromPeriodStart;
      const incomingQty = periodMovements
        .filter((movement) => movement.type === 'IN')
        .reduce((sum, movement) => sum + getNonNegativeQuantity(movement.quantity), 0);
      const outgoingQty = periodMovements
        .filter((movement) => movement.type === 'OUT')
        .reduce((sum, movement) => sum + getNonNegativeQuantity(movement.quantity), 0);
      const adjustmentQty = periodMovements
        .filter((movement) => movement.type === 'ADJUSTMENT')
        .reduce((sum, movement) => sum + getMovementDelta(movement), 0);
      const endingStock = currentStock - deltasAfterPeriodEnd;

      return {
        warehouseItemRef: item._id,
        itemCode: item.itemCode,
        itemName: item.name,
        category: item.category || '-',
        unit: item.unit,
        active: item.active !== false,
        minStockQty: getNonNegativeQuantity(item.minStockQty || 0),
        openingStock,
        incomingQty,
        outgoingQty,
        adjustmentQty,
        endingStock,
        movementCount: periodMovements.length,
        status: getStockStatus(item, endingStock),
      };
    });
}

export function summarizeInventoryStockRecapRows(rows: InventoryStockRecapRow[]) {
  return {
    itemCount: rows.length,
    activeItemCount: rows.filter((row) => row.active).length,
    incomingQty: rows.reduce((sum, row) => sum + row.incomingQty, 0),
    outgoingQty: rows.reduce((sum, row) => sum + row.outgoingQty, 0),
    incomingItemCount: rows.filter((row) => row.incomingQty > 0).length,
    outgoingItemCount: rows.filter((row) => row.outgoingQty > 0).length,
    adjustedItemCount: rows.filter((row) => row.adjustmentQty !== 0).length,
    lowStockCount: rows.filter((row) => row.status === 'LOW_STOCK').length,
    outOfStockCount: rows.filter((row) => row.status === 'OUT_OF_STOCK').length,
    movedItemCount: rows.filter((row) => row.movementCount > 0).length,
  };
}

export function formatStockRecapQty(value: number, unit?: string) {
  const quantity = formatInventoryQuantity(value);
  return unit ? `${quantity} ${unit}` : quantity;
}

export const INVENTORY_STOCK_RECAP_STATUS_LABELS: Record<InventoryStockRecapRow['status'], string> = {
  OUT_OF_STOCK: 'Habis',
  LOW_STOCK: 'Menipis',
  OK: 'Aman',
  INACTIVE: 'Nonaktif',
};

export const INVENTORY_STOCK_RECAP_STATUS_BADGES: Record<InventoryStockRecapRow['status'], string> = {
  OUT_OF_STOCK: 'badge-danger',
  LOW_STOCK: 'badge-warning',
  OK: 'badge-success',
  INACTIVE: 'badge-gray',
};
