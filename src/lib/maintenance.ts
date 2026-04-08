import { getBusinessDateValue } from './business-date';
import { formatQuantity } from './utils';
import type { InventoryUnit, Maintenance, Vehicle } from './types';

export type MaintenanceMaterialOption = {
  _id: string;
  itemCode: string;
  name: string;
  category?: string;
  unit: InventoryUnit;
  currentStockQty: number;
};

export type MaintenanceCompletionMaterialLine = {
  warehouseItemRef: string;
  quantity: number;
  note: string;
};

export type MaintenanceCompletionFormState = {
  completedDate: string;
  odometerAtService: number;
  vendor: string;
  completionNotes: string;
  materials: MaintenanceCompletionMaterialLine[];
};

export function createDefaultMaintenanceCompletionForm(vehicle?: Vehicle | null): MaintenanceCompletionFormState {
  return {
    completedDate: getBusinessDateValue(),
    odometerAtService: typeof vehicle?.lastOdometer === 'number' ? vehicle.lastOdometer : 0,
    vendor: '',
    completionNotes: '',
    materials: [],
  };
}

export function createEmptyMaintenanceMaterialLine(): MaintenanceCompletionMaterialLine {
  return {
    warehouseItemRef: '',
    quantity: 0,
    note: '',
  };
}

export function getMaintenanceRecordedCost(item: Maintenance) {
  if (typeof item.totalCost === 'number') return item.totalCost;
  if (typeof item.materialCostTotal === 'number') return item.materialCostTotal;
  if (typeof item.cost === 'number') return item.cost;
  return 0;
}

export function getMaintenanceMaterialSummary(item: Maintenance) {
  const usages = Array.isArray(item.materialUsages) ? item.materialUsages : [];
  if (usages.length === 0) {
    return 'Tanpa material gudang';
  }
  return usages
    .slice(0, 2)
    .map((usage) => `${usage.itemName || usage.itemCode || 'Barang'} ${formatQuantity(usage.quantity, 3)} ${usage.unit}`)
    .join(', ');
}

export function getMaintenanceMaterialOverflowCount(item: Maintenance) {
  const usages = Array.isArray(item.materialUsages) ? item.materialUsages : [];
  return usages.length > 2 ? usages.length - 2 : 0;
}
