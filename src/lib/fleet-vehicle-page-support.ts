import { formatDate, formatQuantity, VEHICLE_STATUS_MAP } from './utils';
import { DEFAULT_PAGE_SIZE } from './pagination';
import { getBusinessCalendarDateParts } from './business-date';
import type { Service, Vehicle, VehicleStatus } from './types';

export type VehicleTireSummary = {
    filled: number;
    expected: number;
    missing: number;
};

export type VehicleForm = {
    unitCode: string;
    plateNumber: string;
    vehicleType: string;
    brandModel: string;
    size: string;
    dimension: string;
    capacityMin: string;
    capacityMax: string;
    year: number;
    capacityKg: number;
    capacityVolume: number;
    serviceRef: string;
    chassisNumber: string;
    engineNumber: string;
    base: string;
    notes: string;
    status: VehicleStatus;
    lastOdometer: number;
    lastOdometerAt: string;
};

function getCurrentBusinessYear() {
    return Number(getBusinessCalendarDateParts()?.year || new Date().getFullYear());
}

export const EMPTY_VEHICLE_FORM: VehicleForm = {
    unitCode: '',
    plateNumber: '',
    vehicleType: 'Truck',
    brandModel: '',
    size: '',
    dimension: '',
    capacityMin: '',
    capacityMax: '',
    year: getCurrentBusinessYear(),
    capacityKg: 0,
    capacityVolume: 0,
    serviceRef: '',
    chassisNumber: '',
    engineNumber: '',
    base: '',
    notes: '',
    status: 'ACTIVE',
    lastOdometer: 0,
    lastOdometerAt: '',
};

export function buildVehiclesQuery(params: {
    page?: number;
    pageSize?: number;
    search?: string;
    statusFilter?: string;
    serviceFilter?: string;
}) {
    const query = new URLSearchParams({
        entity: 'vehicles',
        page: String(params.page ?? 1),
        pageSize: String(params.pageSize ?? DEFAULT_PAGE_SIZE),
        sortField: 'plateNumber',
        sortDir: 'asc',
    });

    if (params.search?.trim()) {
        query.set('q', params.search.trim());
        query.set('searchFields', 'plateNumber,brandModel,unitCode,serviceName');
    }

    const filterObj: Record<string, string> = {};
    if (params.statusFilter) {
        filterObj.status = params.statusFilter;
    }
    if (params.serviceFilter) {
        filterObj.serviceRef = params.serviceFilter;
    }
    if (Object.keys(filterObj).length > 0) {
        query.set('filter', JSON.stringify(filterObj));
    }

    return query.toString();
}

export function getVehicleServiceLabel(vehicle: Vehicle, services: Service[]) {
    const service = services.find(item => item._id === vehicle.serviceRef);
    if (service) {
        return `${service.code} - ${service.name}`;
    }
    return vehicle.serviceName || '-';
}

export function getVehicleNextAction(vehicle: Vehicle, tireSummaryByVehicle: Record<string, VehicleTireSummary>) {
    const summary = tireSummaryByVehicle[vehicle._id];
    if (vehicle.status !== 'ACTIVE') {
        return 'Cek status unit sebelum dipakai untuk trip baru';
    }
    if (summary && summary.missing > 0) {
        return `Lengkapi ${summary.missing} slot ban yang masih kosong`;
    }
    return 'Siap dipakai; buka profil unit bila perlu servis atau insiden';
}

export function getAvailableVehicleServiceOptions(params: {
    services: Service[];
    serviceFilter: string;
    vehicles: Vehicle[];
}) {
    const { services, serviceFilter, vehicles } = params;
    return services.filter(service =>
        service.active !== false || service._id === serviceFilter || vehicles.some(vehicle => vehicle.serviceRef === service._id)
    );
}

export function getSelectableVehicleServiceOptions(services: Service[], currentServiceRef = '') {
    return services.filter(service => service.active !== false || service._id === currentServiceRef);
}

function parseCapacityRangeValue(value: string) {
    if (!value.trim()) {
        return undefined;
    }

    const normalized = value.replace(',', '.').trim();
    if (!/^\d+(\.\d+)?$/.test(normalized)) {
        return undefined;
    }

    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : undefined;
}

export function hasInvalidCapacityRange(form: Pick<VehicleForm, 'capacityMin' | 'capacityMax'>) {
    const min = parseCapacityRangeValue(form.capacityMin);
    const max = parseCapacityRangeValue(form.capacityMax);

    return min !== undefined && max !== undefined && max < min;
}

export function buildVehicleBasePayload(form: VehicleForm, isOwner: boolean) {
    return {
        unitCode: form.unitCode,
        plateNumber: form.plateNumber,
        vehicleType: form.vehicleType,
        brandModel: form.brandModel,
        size: form.size || undefined,
        dimension: form.dimension || undefined,
        capacityMin: form.capacityMin || undefined,
        capacityMax: form.capacityMax || undefined,
        year: form.year,
        capacityKg: form.capacityKg,
        capacityVolume: form.capacityVolume,
        serviceRef: form.serviceRef || undefined,
        base: form.base,
        notes: form.notes,
        ...(isOwner ? { chassisNumber: form.chassisNumber, engineNumber: form.engineNumber } : {}),
    };
}

export function buildVehiclePrintHtml(vehicles: Vehicle[], services: Service[]) {
    return `
        <table>
            <thead>
                <tr>
                    <th>Kode</th>
                    <th>Plat Nomor</th>
                    <th>Merk/Model</th>
                    <th>Ukuran</th>
                    <th>Dimensi</th>
                    <th>Kapasitas Min</th>
                    <th>Kapasitas Maks</th>
                    <th>Kategori</th>
                    <th>Tipe</th>
                    <th>Tahun</th>
                    <th>Status</th>
                    <th>Odometer</th>
                    <th>Tgl Update</th>
                </tr>
            </thead>
            <tbody>
                ${vehicles
                    .map(
                        vehicle => `<tr>
                            <td class="b">${vehicle.unitCode || '-'}</td>
                            <td>${vehicle.plateNumber}</td>
                            <td>${vehicle.brandModel}</td>
                            <td>${vehicle.size || '-'}</td>
                            <td>${vehicle.dimension || '-'}</td>
                            <td>${vehicle.capacityMin || '-'}</td>
                            <td>${vehicle.capacityMax || '-'}</td>
                            <td>${getVehicleServiceLabel(vehicle, services)}</td>
                            <td>${vehicle.vehicleType}</td>
                            <td>${vehicle.year}</td>
                            <td>${VEHICLE_STATUS_MAP[vehicle.status]?.label || vehicle.status}</td>
                            <td class="r">${vehicle.lastOdometer ? `${formatQuantity(vehicle.lastOdometer, 0)} km` : '-'}</td>
                            <td>${formatDate(vehicle.lastOdometerAt)}</td>
                        </tr>`
                    )
                    .join('')}
            </tbody>
        </table>
    `;
}

export function mapVehicleToForm(vehicle: Vehicle): VehicleForm {
    return {
        unitCode: vehicle.unitCode || '',
        plateNumber: vehicle.plateNumber || '',
        vehicleType: vehicle.vehicleType || 'Truck',
        brandModel: vehicle.brandModel || '',
        size: vehicle.size || '',
        dimension: vehicle.dimension || '',
        capacityMin: vehicle.capacityMin || '',
        capacityMax: vehicle.capacityMax || '',
        year: vehicle.year || getCurrentBusinessYear(),
        capacityKg: vehicle.capacityKg || 0,
        capacityVolume: vehicle.capacityVolume || 0,
        serviceRef: vehicle.serviceRef || '',
        chassisNumber: vehicle.chassisNumber || '',
        engineNumber: vehicle.engineNumber || '',
        base: vehicle.base || '',
        notes: vehicle.notes || '',
        status: vehicle.status || 'ACTIVE',
        lastOdometer: vehicle.lastOdometer || 0,
        lastOdometerAt: vehicle.lastOdometerAt || '',
    };
}

export function getVehicleSections(vehicleId: string, isOwner: boolean) {
    return [
        { key: 'profil', label: 'Profil', href: `/fleet/vehicles/${vehicleId}` },
        { key: 'do', label: 'Riwayat DO', href: `/fleet/vehicles/${vehicleId}?tab=do` },
        { key: 'maintenance', label: 'Maintenance', href: `/fleet/vehicles/${vehicleId}?tab=maintenance` },
        { key: 'ban', label: 'Ban', href: `/fleet/vehicles/${vehicleId}?tab=ban` },
        { key: 'insiden', label: 'Insiden', href: `/fleet/vehicles/${vehicleId}?tab=insiden` },
        ...(isOwner ? [{ key: 'biaya', label: 'Biaya', href: `/fleet/vehicles/${vehicleId}?tab=biaya` }] : []),
    ];
}
