import { getBusinessDateValue } from './business-date';
import { formatQuantity } from './utils';
import type {
  InventoryUnit,
  Maintenance,
  MaintenanceMaterialUsage,
  Vehicle,
} from './types';

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

export type MaintenanceMaterialPreview = MaintenanceMaterialUsage & {
  displayLabel: string;
};

function getMaintenanceMaterialDisplayLabel(usage: MaintenanceMaterialUsage) {
  const codeAndName = [usage.itemCode, usage.itemName].filter(Boolean).join(' - ');
  return codeAndName || 'Barang';
}

export function getMaintenanceMaterialPreview(item: Maintenance, limit = 2): MaintenanceMaterialPreview[] {
  const usages = Array.isArray(item.materialUsages) ? item.materialUsages : [];
  return usages.slice(0, limit).map((usage) => ({
    ...usage,
    displayLabel: getMaintenanceMaterialDisplayLabel(usage),
  }));
}

export function formatMaintenanceMaterialPreview(usage: MaintenanceMaterialPreview) {
  return `${usage.displayLabel} ${formatQuantity(usage.quantity, 3)} ${usage.unit}`;
}

export function getMaintenanceMaterialSummary(item: Maintenance) {
  const usages = getMaintenanceMaterialPreview(item);
  if (usages.length === 0) {
    return 'Tanpa material gudang';
  }
  return usages.map(formatMaintenanceMaterialPreview).join(', ');
}

export function getMaintenanceMaterialOverflowCount(item: Maintenance) {
  const usages = Array.isArray(item.materialUsages) ? item.materialUsages : [];
  return usages.length > 2 ? usages.length - 2 : 0;
}
