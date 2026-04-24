import { parseInventoryQuantity, parseWholeMoneyAmount } from './inventory';
import type { Maintenance, Purchase } from './types';

export type MaterialUsageRow = {
  maintenanceId: string;
  completedDate: string;
  vehicleRef?: string;
  vehiclePlate?: string;
  maintenanceType?: string;
  vendor?: string;
  warehouseItemRef: string;
  itemCode?: string;
  itemName?: string;
  category?: string;
  unit?: string;
  quantity: number;
  unitCostSnapshot: number;
  subtotalCost: number;
  note?: string;
};

export type MaterialUsageFilter = {
  dateFrom?: string;
  dateTo?: string;
  vehicleRef?: string;
  category?: string;
  warehouseItemRef?: string;
};

function normalizeDateValue(value: string | undefined | null) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)
    ? value.slice(0, 10)
    : '';
}

export function getMonthPrefix(dateValue: string) {
  return normalizeDateValue(dateValue).slice(0, 7);
}

export function getMaintenanceMaterialUsageRows(maintenances: Maintenance[]): MaterialUsageRow[] {
  return maintenances
    .filter((maintenance) => maintenance.status === 'DONE')
    .flatMap((maintenance) => {
      const completedDate = normalizeDateValue(maintenance.completedDate || maintenance.plannedDate);
      const usages = Array.isArray(maintenance.materialUsages) ? maintenance.materialUsages : [];
      return usages.map((usage) => ({
        maintenanceId: maintenance._id,
        completedDate,
        vehicleRef: maintenance.vehicleRef,
        vehiclePlate: maintenance.vehiclePlate,
        maintenanceType: maintenance.type,
        vendor: maintenance.vendor,
        warehouseItemRef: usage.warehouseItemRef,
        itemCode: usage.itemCode,
        itemName: usage.itemName,
        category: usage.category,
        unit: usage.unit,
        quantity: Math.max(parseInventoryQuantity(usage.quantity), 0),
        unitCostSnapshot: Math.max(parseWholeMoneyAmount(usage.unitCostSnapshot), 0),
        subtotalCost: Math.max(parseWholeMoneyAmount(usage.subtotalCost), 0),
        note: usage.note,
      }));
    })
    .filter((row) => row.completedDate && row.warehouseItemRef);
}

export function filterMaterialUsageRows(rows: MaterialUsageRow[], filters: MaterialUsageFilter) {
  return rows.filter((row) => {
    if (filters.dateFrom && row.completedDate < filters.dateFrom) return false;
    if (filters.dateTo && row.completedDate > filters.dateTo) return false;
    if (filters.vehicleRef && row.vehicleRef !== filters.vehicleRef) return false;
    if (filters.category && (row.category || '') !== filters.category) return false;
    if (filters.warehouseItemRef && row.warehouseItemRef !== filters.warehouseItemRef) return false;
    return true;
  });
}

export function summarizeMaterialUsageRows(rows: MaterialUsageRow[]) {
  return {
    rowCount: rows.length,
    totalValue: rows.reduce((sum, row) => sum + Number(row.subtotalCost || 0), 0),
    totalQuantity: rows.reduce((sum, row) => sum + Number(row.quantity || 0), 0),
    uniqueItemCount: new Set(rows.map((row) => row.warehouseItemRef).filter(Boolean)).size,
    uniqueVehicleCount: new Set(rows.map((row) => row.vehicleRef).filter(Boolean)).size,
  };
}

export function summarizeItemUsageRows(rows: MaterialUsageRow[]) {
  const sorted = rows
    .slice()
    .sort((left, right) => `${right.completedDate}-${right.maintenanceId}`.localeCompare(`${left.completedDate}-${left.maintenanceId}`));
  return {
    usageCount: sorted.length,
    totalQuantity: sorted.reduce((sum, row) => sum + Number(row.quantity || 0), 0),
    totalValue: sorted.reduce((sum, row) => sum + Number(row.subtotalCost || 0), 0),
    lastUsedDate: sorted[0]?.completedDate || '',
  };
}

export function summarizePurchasesForMonth(purchases: Purchase[], monthPrefix: string) {
  const monthRows = purchases.filter((purchase) => normalizeDateValue(purchase.orderDate).startsWith(monthPrefix));
  return {
    purchaseCount: monthRows.length,
    totalAmount: monthRows.reduce((sum, purchase) => sum + Math.max(parseWholeMoneyAmount(purchase.totalAmount), 0), 0),
  };
}
