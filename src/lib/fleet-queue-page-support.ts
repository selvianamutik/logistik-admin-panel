import { DEFAULT_PAGE_SIZE } from './pagination';
import type { DeliveryOrder, Incident, Maintenance, Vehicle } from './types';

export type IncidentFormState = {
    vehicleRef: string;
    incidentType: Incident['incidentType'];
    urgency: Incident['urgency'];
    locationText: string;
    odometer: number;
    description: string;
    dateTime: string;
    relatedDeliveryOrderRef: string;
};

export type MaintenanceFormState = {
    vehicleRef: string;
    type: string;
    scheduleType: 'DATE' | 'ODOMETER';
    plannedDate: string;
    plannedOdometer: number;
    notes: string;
};

export function getDefaultIncidentDateTime() {
    return new Date().toISOString().slice(0, 16);
}

export function getTodayDate() {
    return new Date().toISOString().split('T')[0];
}

export function createDefaultIncidentForm(vehicle?: Vehicle | null, deliveryOrder?: DeliveryOrder | null): IncidentFormState {
    return {
        vehicleRef: deliveryOrder?.vehicleRef || vehicle?._id || '',
        incidentType: 'OTHER',
        urgency: 'MEDIUM',
        locationText: deliveryOrder?.receiverAddress || '',
        odometer: typeof vehicle?.lastOdometer === 'number' ? vehicle.lastOdometer : 0,
        description: '',
        dateTime: getDefaultIncidentDateTime(),
        relatedDeliveryOrderRef: deliveryOrder?._id || '',
    };
}

export function createDefaultMaintenanceForm(vehicle?: Vehicle | null): MaintenanceFormState {
    return {
        vehicleRef: vehicle?._id || '',
        type: '',
        scheduleType: 'DATE',
        plannedDate: getTodayDate(),
        plannedOdometer: typeof vehicle?.lastOdometer === 'number' ? vehicle.lastOdometer : 0,
        notes: '',
    };
}

export function getIncidentNextAction(item: Incident) {
    if (item.status === 'OPEN') {
        return 'Tangani segera dan cek kondisi unit, driver, serta trip terkait';
    }
    if (item.status === 'IN_PROGRESS') {
        return 'Lanjutkan penanganan lalu perbarui status sampai selesai';
    }
    if (item.status === 'RESOLVED') {
        return 'Verifikasi hasil penanganan lalu tutup insiden bila sudah aman';
    }
    return 'Arsip; buka lagi hanya jika ada tindak lanjut tambahan';
}

export function getMaintenanceNextAction(item: Maintenance) {
    if (item.status === 'SCHEDULED') {
        return 'Kerjakan servis sesuai jadwal atau odometer yang ditetapkan';
    }
    if (item.status === 'SKIPPED') {
        return 'Jadwalkan ulang bila servis ini masih dibutuhkan';
    }
    return 'Arsip; buat jadwal berikutnya bila sudah waktunya servis lagi';
}

export function buildIncidentsQuery(params: {
    page?: number;
    pageSize?: number;
    search?: string;
    vehicleFilter?: string;
    statusFilter?: string;
    sortField?: string;
    sortDir?: 'asc' | 'desc';
}) {
    const query = new URLSearchParams({
        entity: 'incidents',
        page: String(params.page ?? 1),
        pageSize: String(params.pageSize ?? DEFAULT_PAGE_SIZE),
    });

    if (params.sortField) {
        query.set('sortField', params.sortField);
        query.set('sortDir', params.sortDir === 'asc' ? 'asc' : 'desc');
    } else {
        query.set('sortPreset', 'work-queue');
    }

    if (params.search?.trim()) {
        query.set('q', params.search.trim());
        query.set('searchFields', 'incidentNumber,vehiclePlate,driverName,relatedDONumber,locationText');
    }

    const filterObj: Record<string, string> = {};
    if (params.vehicleFilter) {
        filterObj.vehicleRef = params.vehicleFilter;
    }
    if (params.statusFilter) {
        filterObj.status = params.statusFilter;
    }
    if (Object.keys(filterObj).length > 0) {
        query.set('filter', JSON.stringify(filterObj));
    }

    return query.toString();
}

export function buildMaintenanceQuery(params: {
    page?: number;
    pageSize?: number;
    search?: string;
    vehicleFilter?: string;
    statusFilter?: string;
    sortField?: string;
    sortDir?: 'asc' | 'desc';
}) {
    const query = new URLSearchParams({
        entity: 'maintenances',
        page: String(params.page ?? 1),
        pageSize: String(params.pageSize ?? DEFAULT_PAGE_SIZE),
    });

    if (params.sortField) {
        query.set('sortField', params.sortField);
        query.set('sortDir', params.sortDir === 'asc' ? 'asc' : 'desc');
    } else {
        query.set('sortPreset', 'work-queue');
    }

    if (params.search?.trim()) {
        query.set('q', params.search.trim());
        query.set('searchFields', 'type,vehiclePlate,notes');
    }

    const filterObj: Record<string, string> = {};
    if (params.vehicleFilter) {
        filterObj.vehicleRef = params.vehicleFilter;
    }
    if (params.statusFilter) {
        filterObj.status = params.statusFilter;
    }
    if (Object.keys(filterObj).length > 0) {
        query.set('filter', JSON.stringify(filterObj));
    }

    return query.toString();
}

export function buildIncidentSelectableState(params: {
    vehicles: Vehicle[];
    dos: DeliveryOrder[];
    form: IncidentFormState;
}) {
    const { vehicles, dos, form } = params;
    const selectableVehicleIds = new Set(vehicles.map(vehicle => vehicle._id));
    const selectableDos = dos.filter(deliveryOrder => !deliveryOrder.vehicleRef || selectableVehicleIds.has(deliveryOrder.vehicleRef));
    const filteredDos = form.vehicleRef
        ? selectableDos.filter(deliveryOrder => !deliveryOrder.vehicleRef || deliveryOrder.vehicleRef === form.vehicleRef)
        : selectableDos;
    const selectedVehicle = vehicles.find(vehicle => vehicle._id === form.vehicleRef) || null;
    const selectedRelatedDO = dos.find(deliveryOrder => deliveryOrder._id === form.relatedDeliveryOrderRef) || null;

    return {
        selectableDos,
        filteredDos,
        selectedVehicle,
        selectedRelatedDO,
    };
}
