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
  attachToVehicle: boolean;
  componentLabel: string;
  note: string;
};

export type MaintenanceCompletionFormState = {
  completedDate: string;
  odometerAtService: number;
  vendor: string;
  laborCost: number;
  laborBankAccountRef: string;
  completionNotes: string;
  materials: MaintenanceCompletionMaterialLine[];
};

export function createDefaultMaintenanceCompletionForm(vehicle?: Vehicle | null): MaintenanceCompletionFormState {
  return {
    completedDate: getBusinessDateValue(),
    odometerAtService: typeof vehicle?.lastOdometer === 'number' ? vehicle.lastOdometer : 0,
    vendor: '',
    laborCost: 0,
    laborBankAccountRef: '',
    completionNotes: '',
    materials: [],
  };
}

export function createEmptyMaintenanceMaterialLine(): MaintenanceCompletionMaterialLine {
  return {
    warehouseItemRef: '',
    quantity: 0,
    attachToVehicle: false,
    componentLabel: '',
    note: '',
  };
}

export function getMaintenanceRecordedCost(item: Maintenance) {
  if (typeof item.totalCost === 'number') return item.totalCost;
  const materialCost = typeof item.materialCostTotal === 'number' ? item.materialCostTotal : 0;
  const laborCost = typeof item.laborCost === 'number' ? item.laborCost : 0;
  if (materialCost > 0 || laborCost > 0) return materialCost + laborCost;
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
  const cost = typeof usage.subtotalCost === 'number' && usage.subtotalCost > 0
    ? ` - Rp${usage.subtotalCost.toLocaleString('id-ID')}`
    : '';
  return `${usage.displayLabel} ${formatQuantity(usage.quantity, 3)} ${usage.unit}${cost}`;
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

export type InstalledVehicleComponentRow = MaintenanceMaterialUsage & {
  id: string;
  maintenanceRef: string;
  maintenanceType: string;
  vehicleRef: string;
  vehiclePlate?: string;
  displayLabel: string;
};

export function isAttachedMaintenanceMaterial(usage: MaintenanceMaterialUsage) {
  return usage.attachedToVehicle === true || usage.attachmentStatus === 'INSTALLED';
}

export function getInstalledVehicleComponentRows(maintenances: Maintenance[]): InstalledVehicleComponentRow[] {
  return maintenances
    .filter((maintenance) => maintenance.status === 'DONE')
    .flatMap((maintenance) => {
      const usages = Array.isArray(maintenance.materialUsages) ? maintenance.materialUsages : [];
      return usages
        .filter(isAttachedMaintenanceMaterial)
        .map((usage, index) => ({
          ...usage,
          id: `${maintenance._id}-${usage.warehouseItemRef}-${index}`,
          maintenanceRef: maintenance._id,
          maintenanceType: maintenance.type,
          vehicleRef: usage.installedOnVehicleRef || maintenance.vehicleRef,
          vehiclePlate: usage.installedOnVehiclePlate || maintenance.vehiclePlate,
          installedDate: usage.installedDate || maintenance.completedDate || maintenance.plannedDate,
          installedOdometer: usage.installedOdometer ?? maintenance.odometerAtService,
          displayLabel: usage.componentLabel || getMaintenanceMaterialDisplayLabel(usage),
        }));
    })
    .sort((left, right) => `${right.installedDate || ''}-${right.id}`.localeCompare(`${left.installedDate || ''}-${left.id}`));
}
