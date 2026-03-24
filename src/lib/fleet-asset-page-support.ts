import { DEFAULT_PAGE_SIZE } from './pagination';
import {
    formatTireSlotLabel,
    INTERNAL_TIRE_SLOT_CODES,
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
        installDate: new Date().toISOString().split('T')[0],
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
}) {
    const query = new URLSearchParams({
        entity: 'tire-events',
        page: String(params.page ?? 1),
        pageSize: String(params.pageSize ?? DEFAULT_PAGE_SIZE),
    });

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

export function getSelectableInternalTireSlots(status: TireAssetStatus) {
    return INTERNAL_TIRE_SLOT_CODES.filter(code => (status === 'SPARE' ? code.startsWith('SP') : !code.startsWith('SP')));
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
