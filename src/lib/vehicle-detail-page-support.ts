import { getBusinessDateValue } from './business-date';
import type { TireEvent, Vehicle } from './types';
import {
    compareTireSlotCodes,
    formatTireSlotLabel,
    getSuggestedVehicleTireLayout,
    resolveTireAssetStatus,
    resolveTirePlacementLabel,
    resolveTireSlotCode,
} from './tire-slots';

export type VehicleTireFormState = {
    registeredTireId: string;
    tireCode: string;
    slotCode: string;
    tireType: 'Tubeless' | 'Tube Type' | 'Solid';
    tireBrand: string;
    tireSize: string;
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

export const VEHICLE_TIRE_TYPE_OPTIONS: VehicleTireFormState['tireType'][] = ['Tubeless', 'Tube Type', 'Solid'];

export function createDefaultVehicleTireForm(slotCode = '1L'): VehicleTireFormState {
    return {
        registeredTireId: '',
        tireCode: '',
        slotCode,
        tireType: 'Tubeless',
        tireBrand: '',
        tireSize: '',
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
    const internalUnitTires = normalizedTireRows.filter(row => Boolean(row.slotCode) && ['IN_USE', 'SPARE'].includes(row.status));
    const layout = getSuggestedVehicleTireLayout(
        vehicle.vehicleType,
        vehicle.serviceName,
        internalUnitTires.map(row => row.slotCode || '').filter(Boolean)
    );
    const tireBySlot = new Map(internalUnitTires.map(row => [row.slotCode || '', row]));
    const mountedSlots = layout.roadSlots.map(slotCode => ({ slotCode, event: tireBySlot.get(slotCode) }));
    const spareSlots = layout.spareSlots.map(slotCode => ({ slotCode, event: tireBySlot.get(slotCode) }));
    const filledSlotCount = [...mountedSlots, ...spareSlots].filter(slot => Boolean(slot.event)).length;
    const emptySlotCount = layout.allSlots.length - filledSlotCount;
    const externalAuditTires = normalizedTireRows.filter(
        row => !row.slotCode || !layout.allSlots.includes(row.slotCode as (typeof layout.allSlots)[number])
    );
    const selectedRegisteredTire = normalizedAllTireRows.find(row => row._id === tireForm.registeredTireId);
    const tireSelectionLocked = Boolean(editingTire || selectedRegisteredTire);
    const availableRegisteredTires = normalizedAllTireRows.filter(row => {
        if (editingTire) {
            return row._id === editingTire._id;
        }
        if (row.status === 'SCRAPPED') {
            return false;
        }
        if (row.holderType === 'INTERNAL_VEHICLE' && ['IN_USE', 'SPARE'].includes(row.status)) {
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
