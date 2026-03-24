import { formatDate, VEHICLE_STATUS_MAP } from './utils';
import { DEFAULT_PAGE_SIZE } from './pagination';
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

export const EMPTY_VEHICLE_FORM: VehicleForm = {
    unitCode: '',
    plateNumber: '',
    vehicleType: 'Truck',
    brandModel: '',
    year: new Date().getFullYear(),
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

export function buildVehiclePrintHtml(vehicles: Vehicle[], services: Service[]) {
    return `
        <table>
            <thead>
                <tr>
                    <th>Kode</th>
                    <th>Plat Nomor</th>
                    <th>Merk/Model</th>
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
                            <td>${getVehicleServiceLabel(vehicle, services)}</td>
                            <td>${vehicle.vehicleType}</td>
                            <td>${vehicle.year}</td>
                            <td>${VEHICLE_STATUS_MAP[vehicle.status]?.label || vehicle.status}</td>
                            <td class="r">${vehicle.lastOdometer ? `${vehicle.lastOdometer.toLocaleString('id-ID')} km` : '-'}</td>
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
        year: vehicle.year || new Date().getFullYear(),
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
