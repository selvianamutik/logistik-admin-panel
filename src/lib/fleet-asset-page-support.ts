import { getBusinessDateValue } from './business-date';
import { DEFAULT_PAGE_SIZE } from './pagination';
import {
    compareTireSlotCodes,
    formatTireSlotLabel,
    INTERNAL_TIRE_SLOT_CODES,
    getSuggestedVehicleTireLayout,
    resolveTireAssetStatus,
    resolveTireHolderType,
    resolveTirePlacementLabel,
    resolveTireSlotCode,
    type TireAssetStatus,
    type TireHolderType,
} from './tire-slots';
import type { TireEvent, User, Driver, Vehicle } from './types';

export type DriverMobileAccount = Pick<User, '_id' | 'name' | 'email' | 'active' | 'driverRef' | 'driverName' | 'lastLoginAt'>;

export type TireFormState = {
    tireCode: string;
    holderType: TireHolderType;
    status: TireAssetStatus;
    vehicleRef: string;
    slotCode: string;
    tireType: 'Tubeless' | 'Tube Type' | 'Solid';
    tireBrand: string;
    tireSize: string;
    installDate: string;
    notes: string;
    externalPartyName: string;
    externalPlateNumber: string;
};

export type ResolvedFleetTireEvent = TireEvent & {
    holderType: TireHolderType;
    status: TireAssetStatus;
    tireCodeLabel: string;
    slotCode?: string;
    slotLabel?: string;
    placementLabel: string;
};

export type TireVehicleCategoryOption = {
    value: string;
    label: string;
    vehicleCount: number;
};

export type TireSlotOption = {
    value: string;
    label: string;
    occupied: boolean;
    occupiedBy?: string;
    disabled: boolean;
};

export const TIRE_TYPES = ['Tubeless', 'Tube Type', 'Solid'] as const;

export function createDefaultTireForm(): TireFormState {
    return {
        tireCode: '',
        holderType: 'INTERNAL_VEHICLE',
        status: 'IN_USE',
        vehicleRef: '',
        slotCode: '1L',
        tireType: 'Tubeless',
        tireBrand: '',
        tireSize: '',
        installDate: getBusinessDateValue(),
        notes: '',
        externalPartyName: '',
        externalPlateNumber: '',
    };
}

export function createDefaultDriverForm() {
    return {
        name: '',
        phone: '',
        licenseNumber: '',
        ktpNumber: '',
        simExpiry: '',
        address: '',
        active: true,
    };
}

export function createDefaultDriverAccessForm() {
    return {
        accountId: '',
        name: '',
        email: '',
        password: '',
        active: true,
    };
}

export function buildDriversQuery(params: { page?: number; pageSize?: number; search?: string }) {
    const query = new URLSearchParams({
        entity: 'drivers',
        page: String(params.page ?? 1),
        pageSize: String(params.pageSize ?? DEFAULT_PAGE_SIZE),
        sortField: 'name',
        sortDir: 'asc',
    });
    if (params.search?.trim()) {
        query.set('q', params.search.trim());
        query.set('searchFields', 'name,phone,licenseNumber');
    }
    return query.toString();
}

export function buildTiresQuery(params: {
    page?: number;
    pageSize?: number;
    search?: string;
    filterVehicle?: string;
    filterStatus?: 'all' | TireAssetStatus;
    sortField?: string;
    sortDir?: 'asc' | 'desc';
}) {
    const query = new URLSearchParams({
        entity: 'tire-events',
        page: String(params.page ?? 1),
        pageSize: String(params.pageSize ?? DEFAULT_PAGE_SIZE),
    });

    if (params.sortField) {
        query.set('sortField', params.sortField);
        query.set('sortDir', params.sortDir === 'asc' ? 'asc' : 'desc');
    }

    if (params.search?.trim()) {
        query.set('q', params.search.trim());
        query.set('searchFields', 'tireCode,tireBrand,tireSize,vehiclePlate,notes,externalPartyName,externalPlateNumber,slotCode,slotLabel,posisi');
    }

    const filterObj: Record<string, string> = {};
    if (params.filterVehicle) {
        filterObj.vehicleRef = params.filterVehicle;
    }
    if (params.filterStatus && params.filterStatus !== 'all') {
        filterObj.status = params.filterStatus;
    }
    if (Object.keys(filterObj).length > 0) {
        query.set('filter', JSON.stringify(filterObj));
    }

    return query.toString();
}

export function buildDriverAccountMap(accounts: DriverMobileAccount[]) {
    return new Map(accounts.filter(account => account.driverRef).map(account => [account.driverRef as string, account]));
}

export function isDriverActive(driver: Pick<Driver, 'active'>) {
    return driver.active !== false;
}

export function isDriverAccountActive(account: Pick<DriverMobileAccount, 'active'>) {
    return account.active !== false;
}

export function getSelectableTireVehicles(vehicles: Vehicle[], editTarget: TireEvent | null) {
    return vehicles.filter(vehicle => vehicle.status !== 'SOLD' || vehicle._id === editTarget?.vehicleRef);
}

export function getSelectableInternalTireSlots() {
    return INTERNAL_TIRE_SLOT_CODES.slice();
}

export function getTireVehicleCategoryValue(vehicle: Pick<Vehicle, '_id' | 'serviceRef' | 'serviceName' | 'vehicleType'>) {
    if (vehicle.serviceRef?.trim()) {
        return `service:${vehicle.serviceRef.trim()}`;
    }
    if (vehicle.serviceName?.trim()) {
        return `service-name:${vehicle.serviceName.trim().toLowerCase()}`;
    }
    if (vehicle.vehicleType?.trim()) {
        return `vehicle-type:${vehicle.vehicleType.trim().toLowerCase()}`;
    }
    return 'uncategorized';
}

export function getTireVehicleCategoryLabel(vehicle: Pick<Vehicle, 'serviceName' | 'vehicleType'>) {
    return vehicle.serviceName?.trim() || vehicle.vehicleType?.trim() || 'Tanpa kategori';
}

export function getSelectableTireVehicleCategories(vehicles: Vehicle[], editTarget: TireEvent | null): TireVehicleCategoryOption[] {
    const selectableVehicles = getSelectableTireVehicles(vehicles, editTarget);
    const categoryMap = new Map<string, TireVehicleCategoryOption>();

    selectableVehicles.forEach(vehicle => {
        const value = getTireVehicleCategoryValue(vehicle);
        const existing = categoryMap.get(value);
        if (existing) {
            existing.vehicleCount += 1;
            return;
        }
        categoryMap.set(value, {
            value,
            label: getTireVehicleCategoryLabel(vehicle),
            vehicleCount: 1,
        });
    });

    return Array.from(categoryMap.values()).sort((left, right) => left.label.localeCompare(right.label, 'id-ID'));
}

export function getSelectableTireVehiclesByCategory(
    vehicles: Vehicle[],
    editTarget: TireEvent | null,
    categoryValue?: string
) {
    return getSelectableTireVehicles(vehicles, editTarget)
        .filter(vehicle => !categoryValue || getTireVehicleCategoryValue(vehicle) === categoryValue)
        .sort((left, right) => left.plateNumber.localeCompare(right.plateNumber, 'id-ID'));
}

export function getSelectableInternalTireSlotOptions(params: {
    vehicle: Vehicle | null;
    tireEvents: TireEvent[];
    editTargetId?: string | null;
}) {
    const { vehicle, tireEvents, editTargetId } = params;
    if (!vehicle) {
        return [];
    }

    const normalizedVehicleTires = resolveFleetTireEvents(tireEvents).filter(event =>
        event.vehicleRef === vehicle._id &&
        event.holderType === 'INTERNAL_VEHICLE' &&
        event.status === 'IN_USE' &&
        Boolean(event.slotCode)
    );
    const layout = getSuggestedVehicleTireLayout(
        vehicle.vehicleType,
        vehicle.serviceName,
        normalizedVehicleTires.map(event => event.slotCode || '').filter(Boolean),
        vehicle.tireLayoutConfig
    );
    const slotCodes = layout.allSlots.slice().sort(compareTireSlotCodes);
    const occupiedBySlot = new Map(
        normalizedVehicleTires
            .filter(event => event._id !== editTargetId)
            .map(event => [event.slotCode || '', event])
    );

    return slotCodes.map(slotCode => {
        const occupiedEvent = occupiedBySlot.get(slotCode);
        return {
            value: slotCode,
            label: `${slotCode} - ${formatTireSlotLabel(slotCode)}${occupiedEvent ? ` | Terisi ${occupiedEvent.tireCodeLabel}` : ' | Kosong'}`,
            occupied: Boolean(occupiedEvent),
            occupiedBy: occupiedEvent?.tireCodeLabel,
            disabled: Boolean(occupiedEvent),
        };
    });
}

export function resolveFleetTireEvents(events: TireEvent[]): ResolvedFleetTireEvent[] {
    return events.map(event => {
        const holderType = resolveTireHolderType(event);
        const status = resolveTireAssetStatus(event);
        const slotCode = resolveTireSlotCode(event);
        const slotLabel = slotCode ? formatTireSlotLabel(slotCode) : undefined;
        return {
            ...event,
            holderType,
            status,
            tireCodeLabel: event.tireCode?.trim() || 'Belum dikodekan',
            slotCode,
            slotLabel,
            placementLabel: resolveTirePlacementLabel({ ...event, holderType, status, slotCode }),
        };
    });
}
