import { getBusinessDateValue } from './business-date';
import { DEFAULT_TIRE_TYPE, normalizeTireType, TIRE_TYPE_OPTIONS } from './tire-types';
import type { TireEvent, TireType, Vehicle } from './types';
import {
    compareTireSlotCodes,
    formatTireSlotLabel,
    getSuggestedVehicleTireLayout,
    resolveTireAssetStatus,
    resolveTirePlacementLabel,
    resolveTireSlotCode,
} from './tire-slots';

export type VehicleTireFormState = {
    tireSource: 'WAREHOUSE' | 'UNIT';
    sourceVehicleRef: string;
    registeredTireId: string;
    tireCode: string;
    slotCode: string;
    tireType: TireType;
    tireBrand: string;
    tireSize: string;
    originalCost: number;
    totalUsedPercent: number;
    usagePercentOnExit: number | null;
    sourceTireUsagePercent: number | null;
    oldTireUsagePercent: number | null;
    oldTireDestination: 'WAREHOUSE' | 'SCRAPPED';
    technicianCost: number;
    technicianVendor: string;
    installDate: string;
    notes: string;
};

export type NormalizedVehicleTireRow = TireEvent & {
    status: TireEvent['status'];
    tireCodeLabel: string;
    slotCode?: string;
    slotLabel?: string;
    placementLabel: string;
};

export const VEHICLE_TIRE_TYPE_OPTIONS: VehicleTireFormState['tireType'][] = [...TIRE_TYPE_OPTIONS];

export function createDefaultVehicleTireForm(slotCode = '1L'): VehicleTireFormState {
    return {
        tireSource: 'WAREHOUSE',
        sourceVehicleRef: '',
        registeredTireId: '',
        tireCode: '',
        slotCode,
        tireType: DEFAULT_TIRE_TYPE,
        tireBrand: '',
        tireSize: '',
        originalCost: 0,
        totalUsedPercent: 0,
        usagePercentOnExit: null,
        sourceTireUsagePercent: null,
        oldTireUsagePercent: null,
        oldTireDestination: 'WAREHOUSE',
        technicianCost: 0,
        technicianVendor: '',
        installDate: getBusinessDateValue(),
        notes: '',
    };
}

export function getVehicleTabs(isOwner: boolean) {
    return ['profil', 'do', 'maintenance', 'ban', 'insiden', ...(isOwner ? ['biaya'] : [])];
}

export function normalizeVehicleTireRow(event: TireEvent): NormalizedVehicleTireRow {
    const status = resolveTireAssetStatus(event);
    const slotCode = resolveTireSlotCode(event);
    return {
        ...event,
        tireType: normalizeTireType(event.tireType),
        status,
        tireCodeLabel: event.tireCode?.trim() || 'Belum dikodekan',
        slotCode,
        slotLabel: slotCode ? formatTireSlotLabel(slotCode) : undefined,
        placementLabel: resolveTirePlacementLabel(event),
    };
}

export function buildVehicleTireDetailState(params: {
    vehicle: Vehicle;
    tireEvents: TireEvent[];
    allTireEvents: TireEvent[];
    tireForm: VehicleTireFormState;
    editingTire: TireEvent | null;
}) {
    const { vehicle, tireEvents, allTireEvents, tireForm, editingTire } = params;
    const normalizedTireRows = tireEvents
        .map(normalizeVehicleTireRow)
        .sort((left, right) => compareTireSlotCodes(left.slotCode || left.posisi || '', right.slotCode || right.posisi || ''));
    const normalizedAllTireRows = allTireEvents
        .map(normalizeVehicleTireRow)
        .sort((left, right) => left.tireCodeLabel.localeCompare(right.tireCodeLabel, 'id-ID'));
    const internalUnitTires = normalizedTireRows.filter(row => Boolean(row.slotCode) && row.status === 'IN_USE');
    const layout = getSuggestedVehicleTireLayout(
        vehicle.vehicleType,
        vehicle.serviceName,
        internalUnitTires.map(row => row.slotCode || '').filter(Boolean),
        vehicle.tireLayoutConfig
    );
    const tireBySlot = new Map(internalUnitTires.map(row => [row.slotCode || '', row]));
    const mountedSlots = layout.roadSlots.map(slotCode => ({ slotCode, event: tireBySlot.get(slotCode) }));
    const spareSlots = layout.spareSlots.map(slotCode => ({ slotCode, event: tireBySlot.get(slotCode) }));
    const filledSlotCount = [...mountedSlots, ...spareSlots].filter(slot => Boolean(slot.event)).length;
    const emptySlotCount = layout.allSlots.length - filledSlotCount;
    const externalAuditTires = normalizedTireRows.filter(
        row => !row.slotCode || !layout.allSlots.includes(row.slotCode)
    );
    const selectedRegisteredTire = normalizedAllTireRows.find(row => row._id === tireForm.registeredTireId);
    const tireSelectionLocked = Boolean(editingTire || selectedRegisteredTire);
    const availableRegisteredTires = normalizedAllTireRows.filter(row => {
        if (editingTire && row._id === editingTire._id) return false;
        if (row.status === 'SCRAPPED') {
            return false;
        }
        if (row.vehicleRef === vehicle._id) {
            return false;
        }
        if (tireForm.tireSource === 'WAREHOUSE') {
            if (row.holderType !== 'WAREHOUSE' || row.status !== 'IN_WAREHOUSE') {
                return false;
            }
        } else if (
            row.holderType !== 'INTERNAL_VEHICLE' ||
            row.status !== 'IN_USE' ||
            !row.vehicleRef
        ) {
            return false;
        } else if (tireForm.sourceVehicleRef && row.vehicleRef !== tireForm.sourceVehicleRef) {
            return false;
        }
        return true;
    });

    return {
        normalizedTireRows,
        normalizedAllTireRows,
        layout,
        mountedSlots,
        spareSlots,
        filledSlotCount,
        emptySlotCount,
        externalAuditTires,
        selectedRegisteredTire,
        tireSelectionLocked,
        availableRegisteredTires,
    };
}
