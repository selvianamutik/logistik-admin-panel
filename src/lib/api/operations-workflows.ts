import { NextResponse } from 'next/server';

import { getSanityClient, sanityDelete, sanityGetById, sanityGetNextNumber } from '@/lib/sanity';

import {
    assertIsoDate,
    normalizeNumber,
    normalizeOptionalText,
    normalizeText,
    type ApiSession,
} from './data-helpers';

type AuditLogFn = (
    session: Pick<ApiSession, '_id' | 'name'>,
    action: string,
    entityType: string,
    entityRef: string,
    summary: string
) => void | Promise<void>;

type MaintenanceCreatePayload = {
    vehicleRef: string;
    vehiclePlate?: string;
    type: string;
    scheduleType: 'DATE' | 'ODOMETER';
    plannedDate?: string;
    plannedOdometer?: number;
    notes?: string;
};

type NormalizedTireEventPayload = {
    vehicleRef: string;
    vehiclePlate?: string;
    posisi: string;
    positionKey: string;
    tireType: 'Tubeless' | 'Tube Type' | 'Solid';
    tireBrand: string;
    tireSize: string;
    installDate: string;
    replaceDate?: string;
    notes?: string;
};

const INCIDENT_STATUS_TRANSITIONS: Record<string, string[]> = {
    OPEN: ['IN_PROGRESS'],
    IN_PROGRESS: ['RESOLVED'],
    RESOLVED: ['CLOSED'],
    CLOSED: [],
};

const VEHICLE_STATUS_VALUES = new Set(['ACTIVE', 'IN_SERVICE', 'OUT_OF_SERVICE', 'SOLD']);

function hasOwnKey(value: Record<string, unknown>, key: string) {
    return Object.prototype.hasOwnProperty.call(value, key);
}

function normalizeOptionalNonNegativeNumber(value: unknown, label: string) {
    if (value === '' || value === null || value === undefined) {
        return undefined;
    }

    const normalized = normalizeNumber(value);
    if (!Number.isFinite(normalized) || normalized < 0) {
        throw new Error(`${label} tidak valid`);
    }

    return normalized;
}

function normalizeTirePositionKey(posisi: string) {
    return posisi.trim().toLowerCase().replace(/\s+/g, ' ');
}

async function findDuplicateLowerTextDoc(docType: string, fieldName: string, value: string, excludeId?: string) {
    if (!value) return null;

    const query = excludeId
        ? `*[_type == "${docType}" && lower(coalesce(${fieldName}, "")) == $value && _id != $excludeId][0]{ _id }`
        : `*[_type == "${docType}" && lower(coalesce(${fieldName}, "")) == $value][0]{ _id }`;

    return getSanityClient().fetch<{ _id: string } | null>(
        query,
        excludeId ? { value: value.toLowerCase(), excludeId } : { value: value.toLowerCase() }
    );
}

export async function normalizeServicePayload(data: Record<string, unknown>, options?: { partial?: boolean; excludeId?: string }) {
    const partial = options?.partial === true;
    const next: Record<string, unknown> = {};

    if (!partial || hasOwnKey(data, 'name')) {
        const name = normalizeText(data.name);
        if (!name) {
            throw new Error('Nama layanan wajib diisi');
        }
        const duplicate = await findDuplicateLowerTextDoc('service', 'name', name, options?.excludeId);
        if (duplicate) {
            throw new Error('Nama layanan sudah digunakan');
        }
        next.name = name;
    }

    if (!partial || hasOwnKey(data, 'description')) {
        next.description = normalizeText(data.description);
    }

    if (!partial || hasOwnKey(data, 'active')) {
        if (data.active !== undefined && typeof data.active !== 'boolean') {
            throw new Error('Status layanan tidak valid');
        }
        next.active = typeof data.active === 'boolean' ? data.active : true;
    }

    return next;
}

export async function normalizeExpenseCategoryPayload(data: Record<string, unknown>, options?: { partial?: boolean; excludeId?: string }) {
    const partial = options?.partial === true;
    const next: Record<string, unknown> = {};

    if (!partial || hasOwnKey(data, 'name')) {
        const name = normalizeText(data.name);
        if (!name) {
            throw new Error('Nama kategori biaya wajib diisi');
        }
        const duplicate = await findDuplicateLowerTextDoc('expenseCategory', 'name', name, options?.excludeId);
        if (duplicate) {
            throw new Error('Nama kategori biaya sudah digunakan');
        }
        next.name = name;
    }

    if (!partial || hasOwnKey(data, 'active')) {
        if (data.active !== undefined && typeof data.active !== 'boolean') {
            throw new Error('Status kategori biaya tidak valid');
        }
        next.active = typeof data.active === 'boolean' ? data.active : true;
    }

    return next;
}

export async function normalizeDriverPayload(data: Record<string, unknown>, options?: { partial?: boolean; excludeId?: string }) {
    const partial = options?.partial === true;
    const next: Record<string, unknown> = {};

    if (!partial || hasOwnKey(data, 'name')) {
        const name = normalizeText(data.name);
        if (!name) {
            throw new Error('Nama supir wajib diisi');
        }
        next.name = name;
    }

    if (!partial || hasOwnKey(data, 'phone')) {
        const phone = normalizeText(data.phone);
        if (!phone) {
            throw new Error('No. HP supir wajib diisi');
        }
        next.phone = phone;
    }

    if (!partial || hasOwnKey(data, 'licenseNumber')) {
        const licenseNumber = normalizeText(data.licenseNumber).toUpperCase();
        if (licenseNumber) {
            const duplicate = await findDuplicateLowerTextDoc('driver', 'licenseNumber', licenseNumber, options?.excludeId);
            if (duplicate) {
                throw new Error('No. SIM sudah digunakan supir lain');
            }
        }
        next.licenseNumber = licenseNumber;
    }

    if (!partial || hasOwnKey(data, 'ktpNumber')) {
        const ktpNumber = normalizeOptionalText(data.ktpNumber)?.toUpperCase();
        if (ktpNumber) {
            const duplicate = await findDuplicateLowerTextDoc('driver', 'ktpNumber', ktpNumber, options?.excludeId);
            if (duplicate) {
                throw new Error('No. KTP sudah digunakan supir lain');
            }
        }
        next.ktpNumber = ktpNumber;
    }

    if (!partial || hasOwnKey(data, 'simExpiry')) {
        const simExpiry = normalizeOptionalText(data.simExpiry);
        if (simExpiry) {
            assertIsoDate(simExpiry, 'Tanggal masa berlaku SIM');
        }
        next.simExpiry = simExpiry;
    }

    if (!partial || hasOwnKey(data, 'address')) {
        next.address = normalizeOptionalText(data.address);
    }

    if (!partial || hasOwnKey(data, 'active')) {
        if (data.active !== undefined && typeof data.active !== 'boolean') {
            throw new Error('Status supir tidak valid');
        }
        next.active = typeof data.active === 'boolean' ? data.active : true;
    }

    return next;
}

export async function normalizeVehiclePayload(
    session: ApiSession,
    data: Record<string, unknown>,
    options?: { partial?: boolean; excludeId?: string }
) {
    const partial = options?.partial === true;
    const next: Record<string, unknown> = {};
    const existingVehicle = options?.excludeId
        ? await sanityGetById<{ _id: string; lastOdometer?: number }>(options.excludeId)
        : null;

    if (options?.excludeId && !existingVehicle) {
        throw new Error('Kendaraan tidak ditemukan');
    }

    let normalizedPlateNumber: string | undefined;

    if (!partial || hasOwnKey(data, 'plateNumber')) {
        const plateNumber = normalizeText(data.plateNumber).toUpperCase().replace(/\s+/g, ' ');
        if (!plateNumber) {
            throw new Error('Plat nomor kendaraan wajib diisi');
        }
        const duplicate = await findDuplicateLowerTextDoc('vehicle', 'plateNumber', plateNumber, options?.excludeId);
        if (duplicate) {
            throw new Error('Plat nomor kendaraan sudah digunakan');
        }
        normalizedPlateNumber = plateNumber;
        next.plateNumber = plateNumber;
    }

    if (!partial || hasOwnKey(data, 'unitCode')) {
        const providedUnitCode = normalizeText(data.unitCode).toUpperCase().replace(/\s+/g, '-');
        const fallbackUnitCode = normalizedPlateNumber?.replace(/\s+/g, '-') || '';
        const unitCode = providedUnitCode || (!partial ? fallbackUnitCode : '');
        if (unitCode) {
            const duplicate = await findDuplicateLowerTextDoc('vehicle', 'unitCode', unitCode, options?.excludeId);
            if (duplicate) {
                throw new Error('Kode unit kendaraan sudah digunakan');
            }
        }
        next.unitCode = unitCode;
    }

    if (!partial || hasOwnKey(data, 'vehicleType')) {
        const vehicleType = normalizeText(data.vehicleType);
        if (!vehicleType) {
            throw new Error('Tipe kendaraan wajib diisi');
        }
        next.vehicleType = vehicleType;
    }

    if (!partial || hasOwnKey(data, 'brandModel')) {
        const brandModel = normalizeText(data.brandModel);
        if (!brandModel) {
            throw new Error('Merk/model kendaraan wajib diisi');
        }
        next.brandModel = brandModel;
    }

    if (!partial || hasOwnKey(data, 'year')) {
        const year = normalizeNumber(data.year);
        const maxYear = new Date().getFullYear() + 1;
        if (!Number.isInteger(year) || year < 1900 || year > maxYear) {
            throw new Error('Tahun kendaraan tidak valid');
        }
        next.year = year;
    }

    if (!partial || hasOwnKey(data, 'capacityKg')) {
        const capacityKg = normalizeOptionalNonNegativeNumber(data.capacityKg, 'Kapasitas kg');
        next.capacityKg = capacityKg ?? 0;
    }

    if (!partial || hasOwnKey(data, 'capacityVolume')) {
        const capacityVolume = normalizeOptionalNonNegativeNumber(data.capacityVolume, 'Kapasitas volume');
        next.capacityVolume = capacityVolume ?? 0;
    }

    if (!partial || hasOwnKey(data, 'status')) {
        const status = normalizeText(data.status) || 'ACTIVE';
        if (!VEHICLE_STATUS_VALUES.has(status)) {
            throw new Error('Status kendaraan tidak valid');
        }
        next.status = status;
    }

    if (!partial || hasOwnKey(data, 'base')) {
        next.base = normalizeOptionalText(data.base);
    }

    if (!partial || hasOwnKey(data, 'notes')) {
        next.notes = normalizeOptionalText(data.notes);
    }

    if (!partial || hasOwnKey(data, 'lastOdometer')) {
        const lastOdometer = normalizeOptionalNonNegativeNumber(data.lastOdometer, 'Odometer kendaraan') ?? 0;
        if (
            existingVehicle &&
            typeof existingVehicle.lastOdometer === 'number' &&
            lastOdometer < existingVehicle.lastOdometer
        ) {
            throw new Error('Odometer kendaraan tidak boleh mundur dari catatan terakhir');
        }
        next.lastOdometer = lastOdometer;
        if (lastOdometer > 0 && !hasOwnKey(data, 'lastOdometerAt')) {
            next.lastOdometerAt = new Date().toISOString().slice(0, 10);
        }
    }

    if (!partial || hasOwnKey(data, 'lastOdometerAt')) {
        const lastOdometerAt = normalizeOptionalText(data.lastOdometerAt);
        if (lastOdometerAt) {
            assertIsoDate(lastOdometerAt, 'Tanggal update odometer');
        }
        next.lastOdometerAt = lastOdometerAt;
    }

    if (!partial || hasOwnKey(data, 'chassisNumber')) {
        if (session.role !== 'OWNER') {
            throw new Error('No. rangka hanya boleh diubah OWNER');
        }
        const chassisNumber = normalizeOptionalText(data.chassisNumber)?.toUpperCase();
        if (chassisNumber) {
            const duplicate = await findDuplicateLowerTextDoc('vehicle', 'chassisNumber', chassisNumber, options?.excludeId);
            if (duplicate) {
                throw new Error('No. rangka kendaraan sudah digunakan');
            }
        }
        next.chassisNumber = chassisNumber;
    }

    if (!partial || hasOwnKey(data, 'engineNumber')) {
        if (session.role !== 'OWNER') {
            throw new Error('No. mesin hanya boleh diubah OWNER');
        }
        const engineNumber = normalizeOptionalText(data.engineNumber)?.toUpperCase();
        if (engineNumber) {
            const duplicate = await findDuplicateLowerTextDoc('vehicle', 'engineNumber', engineNumber, options?.excludeId);
            if (duplicate) {
                throw new Error('No. mesin kendaraan sudah digunakan');
            }
        }
        next.engineNumber = engineNumber;
    }

    return next;
}

export function normalizeMaintenanceCreatePayload(data: Record<string, unknown>): MaintenanceCreatePayload {
    const vehicleRef = typeof data.vehicleRef === 'string' ? data.vehicleRef : '';
    const type = typeof data.type === 'string' ? data.type.trim() : '';
    if (!vehicleRef || !type) {
        throw new Error('Kendaraan dan tipe maintenance wajib diisi');
    }

    const scheduleType = data.scheduleType === 'ODOMETER' ? 'ODOMETER' : 'DATE';
    const notes = typeof data.notes === 'string' && data.notes.trim() ? data.notes.trim() : undefined;
    const vehiclePlate = typeof data.vehiclePlate === 'string' && data.vehiclePlate.trim() ? data.vehiclePlate.trim() : undefined;

    if (scheduleType === 'DATE') {
        const plannedDate = typeof data.plannedDate === 'string' ? data.plannedDate : '';
        if (!plannedDate) {
            throw new Error('Tanggal maintenance wajib diisi');
        }

        return {
            vehicleRef,
            vehiclePlate,
            type,
            scheduleType,
            plannedDate,
            notes,
        };
    }

    const plannedOdometer =
        typeof data.plannedOdometer === 'number' ? data.plannedOdometer : Number(data.plannedOdometer);
    if (!Number.isFinite(plannedOdometer) || plannedOdometer <= 0) {
        throw new Error('Odometer maintenance wajib lebih besar dari 0');
    }

    return {
        vehicleRef,
        vehiclePlate,
        type,
        scheduleType,
        plannedOdometer,
        notes,
    };
}

export async function normalizeTireEventPayload(
    data: Record<string, unknown>,
    excludeId = ''
): Promise<NormalizedTireEventPayload> {
    const vehicleRef = normalizeText(data.vehicleRef);
    const posisi = normalizeText(data.posisi);
    const tireBrand = normalizeText(data.tireBrand);
    const tireSize = normalizeText(data.tireSize);
    const installDate = normalizeText(data.installDate);
    const replaceDate = normalizeOptionalText(data.replaceDate);
    const notes = normalizeOptionalText(data.notes);
    const tireType =
        data.tireType === 'Tube Type' || data.tireType === 'Solid' ? data.tireType : 'Tubeless';

    if (!vehicleRef || !posisi || !tireBrand || !tireSize || !installDate) {
        throw new Error('Data ban wajib diisi lengkap');
    }

    if (replaceDate && replaceDate < installDate) {
        throw new Error('Tanggal penggantian ban tidak boleh sebelum tanggal pasang');
    }

    const vehicle = await sanityGetById<{ _id: string; plateNumber?: string }>(vehicleRef);
    if (!vehicle) {
        throw new Error('Kendaraan ban tidak ditemukan');
    }

    const positionKey = normalizeTirePositionKey(posisi);
    if (!replaceDate) {
        const activeTires = await getSanityClient().fetch<Array<{
            _id: string;
            posisi?: string;
            positionKey?: string;
            replaceDate?: string;
        }>>(
            `*[
                _type == "tireEvent" &&
                vehicleRef == $vehicleRef &&
                !defined(replaceDate)
            ]{
                _id,
                posisi,
                positionKey,
                replaceDate
            }`,
            { vehicleRef }
        );
        const activeDuplicate = activeTires.find(item => {
            if (item._id === excludeId) {
                return false;
            }
            const existingKey = normalizeTirePositionKey(item.positionKey || item.posisi || '');
            return existingKey === positionKey;
        });
        if (activeDuplicate) {
            throw new Error('Posisi ban ini masih aktif pada kendaraan yang sama');
        }
    }

    return {
        vehicleRef,
        vehiclePlate: vehicle.plateNumber,
        posisi,
        positionKey,
        tireType,
        tireBrand,
        tireSize,
        installDate,
        replaceDate,
        notes,
    };
}

export async function handleIncidentCreate(
    session: ApiSession,
    data: Record<string, unknown>,
    addAuditLog: AuditLogFn
) {
    const vehicleRef = typeof data.vehicleRef === 'string' ? data.vehicleRef : '';
    const description = typeof data.description === 'string' ? data.description.trim() : '';
    if (!vehicleRef || !description) {
        return NextResponse.json({ error: 'Kendaraan dan deskripsi insiden wajib diisi' }, { status: 400 });
    }

    const vehicle = await sanityGetById<{ _id: string; plateNumber?: string }>(vehicleRef);
    if (!vehicle) {
        return NextResponse.json({ error: 'Kendaraan insiden tidak ditemukan' }, { status: 404 });
    }

    const relatedDeliveryOrderRef =
        typeof data.relatedDeliveryOrderRef === 'string' && data.relatedDeliveryOrderRef
            ? data.relatedDeliveryOrderRef
            : undefined;
    let relatedDONumber =
        typeof data.relatedDONumber === 'string' && data.relatedDONumber.trim()
            ? data.relatedDONumber.trim()
            : undefined;
    if (relatedDeliveryOrderRef && !relatedDONumber) {
        const deliveryOrder = await sanityGetById<{ _id: string; doNumber?: string }>(relatedDeliveryOrderRef);
        if (!deliveryOrder) {
            return NextResponse.json({ error: 'DO terkait tidak ditemukan' }, { status: 404 });
        }
        relatedDONumber = deliveryOrder.doNumber;
    }

    const incidentId = crypto.randomUUID();
    const incidentNumber = await sanityGetNextNumber('incident');
    const timestamp = new Date().toISOString();
    const incidentDateTime =
        typeof data.dateTime === 'string' && data.dateTime
            ? data.dateTime
            : timestamp.slice(0, 16);
    const incidentDoc = {
        _id: incidentId,
        _type: 'incident',
        ...data,
        vehicleRef,
        vehiclePlate: vehicle.plateNumber,
        relatedDeliveryOrderRef,
        relatedDONumber,
        description,
        incidentNumber,
        status: 'OPEN',
        dateTime: incidentDateTime,
    };

    await getSanityClient()
        .transaction()
        .create(incidentDoc)
        .create({
            _id: crypto.randomUUID(),
            _type: 'incidentActionLog',
            incidentRef: incidentId,
            timestamp,
            note: 'Laporan insiden dibuat',
            userRef: session._id,
            userName: session.name,
        })
        .commit();

    void addAuditLog(session, 'CREATE', 'incidents', incidentId, `Created incidents: ${incidentNumber}`);
    return NextResponse.json({ data: incidentDoc, id: incidentId });
}

export async function handleIncidentStatusUpdate(
    session: ApiSession,
    data: Record<string, unknown>,
    addAuditLog: AuditLogFn
) {
    const id = typeof data.id === 'string' ? data.id : '';
    const status = typeof data.status === 'string' ? data.status : '';
    const note = typeof data.note === 'string' ? data.note.trim() : '';
    if (!id || !status || !note) {
        return NextResponse.json({ error: 'Status dan catatan insiden wajib diisi' }, { status: 400 });
    }

    const incident = await sanityGetById<{ _id: string; incidentNumber?: string; status?: string }>(id);
    if (!incident) {
        return NextResponse.json({ error: 'Insiden tidak ditemukan' }, { status: 404 });
    }

    const allowedStatuses = INCIDENT_STATUS_TRANSITIONS[incident.status || ''] || [];
    if (!allowedStatuses.includes(status)) {
        return NextResponse.json({ error: 'Transisi status insiden tidak valid' }, { status: 400 });
    }

    const timestamp = new Date().toISOString();
    await getSanityClient()
        .transaction()
        .patch(id, { set: { status } })
        .create({
            _id: crypto.randomUUID(),
            _type: 'incidentActionLog',
            incidentRef: id,
            timestamp,
            note,
            userRef: session._id,
            userName: session.name,
        })
        .commit();

    void addAuditLog(
        session,
        'UPDATE',
        'incidents',
        id,
        `Incident status ${incident.incidentNumber || id}: ${incident.status || '-'} -> ${status}`
    );

    return NextResponse.json({
        data: {
            ...incident,
            status,
        },
    });
}

export async function handleServiceDelete(
    session: ApiSession,
    data: Record<string, unknown>,
    addAuditLog: AuditLogFn
) {
    const id = typeof data.id === 'string' ? data.id : '';
    if (!id) {
        return NextResponse.json({ error: 'Layanan tidak valid' }, { status: 400 });
    }

    const service = await sanityGetById<{ _id: string; name?: string }>(id);
    if (!service) {
        return NextResponse.json({ error: 'Layanan tidak ditemukan' }, { status: 404 });
    }

    const relatedOrder = await getSanityClient().fetch<{ _id: string } | null>(
        `*[_type == "order" && ((serviceRef == $ref || serviceRef._ref == $ref) || lower(coalesce(serviceName, "")) == $serviceName)][0]{ _id }`,
        { ref: id, serviceName: (service.name || '').toLowerCase() }
    );
    if (relatedOrder) {
        return NextResponse.json({ error: 'Layanan yang sudah dipakai pada order tidak boleh dihapus' }, { status: 409 });
    }

    await sanityDelete(id);
    void addAuditLog(session, 'DELETE', 'services', id, `Deleted services ${service.name || id}`);
    return NextResponse.json({ success: true });
}

export async function handleExpenseCategoryDelete(
    session: ApiSession,
    data: Record<string, unknown>,
    addAuditLog: AuditLogFn
) {
    const id = typeof data.id === 'string' ? data.id : '';
    if (!id) {
        return NextResponse.json({ error: 'Kategori biaya tidak valid' }, { status: 400 });
    }

    const category = await sanityGetById<{ _id: string; name?: string }>(id);
    if (!category) {
        return NextResponse.json({ error: 'Kategori biaya tidak ditemukan' }, { status: 404 });
    }

    const relatedExpense = await getSanityClient().fetch<{ _id: string } | null>(
        `*[_type == "expense" && ((categoryRef == $ref || categoryRef._ref == $ref) || lower(coalesce(categoryName, "")) == $categoryName)][0]{ _id }`,
        { ref: id, categoryName: (category.name || '').toLowerCase() }
    );
    if (relatedExpense) {
        return NextResponse.json({ error: 'Kategori biaya yang sudah dipakai pada pengeluaran tidak boleh dihapus' }, { status: 409 });
    }

    await sanityDelete(id);
    void addAuditLog(session, 'DELETE', 'expense-categories', id, `Deleted expense-categories ${category.name || id}`);
    return NextResponse.json({ success: true });
}

export async function handleDriverDelete(
    session: ApiSession,
    data: Record<string, unknown>,
    addAuditLog: AuditLogFn
) {
    if (session.role !== 'OWNER') {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const id = typeof data.id === 'string' ? data.id : '';
    if (!id) {
        return NextResponse.json({ error: 'Supir tidak valid' }, { status: 400 });
    }

    const driver = await sanityGetById<{ _id: string; name?: string }>(id);
    if (!driver) {
        return NextResponse.json({ error: 'Supir tidak ditemukan' }, { status: 404 });
    }

    const relatedDeliveryOrder = await getSanityClient().fetch<{ _id: string } | null>(
        `*[_type == "deliveryOrder" && ((driverRef == $ref || driverRef._ref == $ref) || lower(coalesce(driverName, "")) == $driverName)][0]{ _id }`,
        { ref: id, driverName: (driver.name || '').toLowerCase() }
    );
    if (relatedDeliveryOrder) {
        return NextResponse.json({ error: 'Supir yang sudah dipakai pada surat jalan tidak boleh dihapus' }, { status: 409 });
    }

    const relatedBorongan = await getSanityClient().fetch<{ _id: string } | null>(
        `*[_type == "driverBorongan" && ((driverRef == $ref || driverRef._ref == $ref) || lower(coalesce(driverName, "")) == $driverName)][0]{ _id }`,
        { ref: id, driverName: (driver.name || '').toLowerCase() }
    );
    if (relatedBorongan) {
        return NextResponse.json({ error: 'Supir yang sudah dipakai pada slip borongan tidak boleh dihapus' }, { status: 409 });
    }

    const relatedVoucher = await getSanityClient().fetch<{ _id: string } | null>(
        `*[_type == "driverVoucher" && ((driverRef == $ref || driverRef._ref == $ref) || lower(coalesce(driverName, "")) == $driverName)][0]{ _id }`,
        { ref: id, driverName: (driver.name || '').toLowerCase() }
    );
    if (relatedVoucher) {
        return NextResponse.json({ error: 'Supir yang sudah dipakai pada bon supir tidak boleh dihapus' }, { status: 409 });
    }

    await sanityDelete(id);
    void addAuditLog(session, 'DELETE', 'drivers', id, `Deleted drivers ${driver.name || id}`);
    return NextResponse.json({ success: true });
}

export async function handleVehicleDelete(
    session: ApiSession,
    data: Record<string, unknown>,
    addAuditLog: AuditLogFn
) {
    const id = typeof data.id === 'string' ? data.id : '';
    if (!id) {
        return NextResponse.json({ error: 'Kendaraan tidak valid' }, { status: 400 });
    }

    const vehicle = await sanityGetById<{ _id: string; plateNumber?: string }>(id);
    if (!vehicle) {
        return NextResponse.json({ error: 'Kendaraan tidak ditemukan' }, { status: 404 });
    }

    const relatedDeliveryOrder = await getSanityClient().fetch<{ _id: string } | null>(
        `*[_type == "deliveryOrder" && ((vehicleRef == $ref || vehicleRef._ref == $ref) || lower(coalesce(vehiclePlate, "")) == $plate)][0]{ _id }`,
        { ref: id, plate: (vehicle.plateNumber || '').toLowerCase() }
    );
    if (relatedDeliveryOrder) {
        return NextResponse.json({ error: 'Kendaraan yang sudah dipakai pada surat jalan tidak boleh dihapus' }, { status: 409 });
    }

    const relatedMaintenance = await getSanityClient().fetch<{ _id: string } | null>(
        `*[_type == "maintenance" && ((vehicleRef == $ref || vehicleRef._ref == $ref) || lower(coalesce(vehiclePlate, "")) == $plate)][0]{ _id }`,
        { ref: id, plate: (vehicle.plateNumber || '').toLowerCase() }
    );
    if (relatedMaintenance) {
        return NextResponse.json({ error: 'Kendaraan yang sudah punya maintenance tidak boleh dihapus' }, { status: 409 });
    }

    const relatedIncident = await getSanityClient().fetch<{ _id: string } | null>(
        `*[_type == "incident" && ((vehicleRef == $ref || vehicleRef._ref == $ref) || lower(coalesce(vehiclePlate, "")) == $plate)][0]{ _id }`,
        { ref: id, plate: (vehicle.plateNumber || '').toLowerCase() }
    );
    if (relatedIncident) {
        return NextResponse.json({ error: 'Kendaraan yang sudah punya insiden tidak boleh dihapus' }, { status: 409 });
    }

    const relatedTireEvent = await getSanityClient().fetch<{ _id: string } | null>(
        `*[_type == "tireEvent" && ((vehicleRef == $ref || vehicleRef._ref == $ref) || lower(coalesce(vehiclePlate, "")) == $plate)][0]{ _id }`,
        { ref: id, plate: (vehicle.plateNumber || '').toLowerCase() }
    );
    if (relatedTireEvent) {
        return NextResponse.json({ error: 'Kendaraan yang sudah punya riwayat ban tidak boleh dihapus' }, { status: 409 });
    }

    const relatedVoucher = await getSanityClient().fetch<{ _id: string } | null>(
        `*[_type == "driverVoucher" && ((vehicleRef == $ref || vehicleRef._ref == $ref) || lower(coalesce(vehiclePlate, "")) == $plate)][0]{ _id }`,
        { ref: id, plate: (vehicle.plateNumber || '').toLowerCase() }
    );
    if (relatedVoucher) {
        return NextResponse.json({ error: 'Kendaraan yang sudah dipakai pada bon supir tidak boleh dihapus' }, { status: 409 });
    }

    const relatedExpense = await getSanityClient().fetch<{ _id: string } | null>(
        `*[_type == "expense" && (relatedVehicleRef == $ref || relatedVehicleRef._ref == $ref)][0]{ _id }`,
        { ref: id }
    );
    if (relatedExpense) {
        return NextResponse.json({ error: 'Kendaraan yang sudah dipakai pada pengeluaran tidak boleh dihapus' }, { status: 409 });
    }

    await sanityDelete(id);
    void addAuditLog(session, 'DELETE', 'vehicles', id, `Deleted vehicles ${vehicle.plateNumber || id}`);
    return NextResponse.json({ success: true });
}
