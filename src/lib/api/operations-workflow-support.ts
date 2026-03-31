import { getSanityClient, sanityGetById } from '@/lib/sanity';
import { getBusinessDateValue } from '@/lib/business-date';
import {
    buildTirePlacementLabel,
    formatTireSlotLabel,
    isKnownInternalTireSlotCode,
    normalizeTireSlotCode,
} from '@/lib/tire-slots';

import {
    assertIsoDate,
    normalizeNumber,
    normalizeOptionalText,
    normalizeText,
    type ApiSession,
} from './data-helpers';

export type MaintenanceCreatePayload = {
    vehicleRef: string;
    vehiclePlate?: string;
    type: string;
    scheduleType: 'DATE' | 'ODOMETER';
    plannedDate?: string;
    plannedOdometer?: number;
    notes?: string;
};

export type NormalizedTireEventPayload = {
    tireCode: string;
    holderType: 'INTERNAL_VEHICLE' | 'EXTERNAL_VEHICLE' | 'WAREHOUSE';
    status: 'IN_USE' | 'SPARE' | 'IN_WAREHOUSE' | 'LOANED_OUT' | 'SCRAPPED';
    vehicleRef?: string;
    vehiclePlate?: string;
    posisi: string;
    positionKey: string;
    slotCode?: string;
    slotLabel?: string;
    externalPartyName?: string;
    externalPlateNumber?: string;
    tireType: 'Tubeless' | 'Tube Type' | 'Solid';
    tireBrand: string;
    tireSize: string;
    installDate: string;
    replaceDate?: string;
    notes?: string;
};

const SERVICE_CODE_RE = /^[A-Z0-9][A-Z0-9-]{1,11}$/;
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

export function normalizeOptionalWholeNumber(value: unknown, label: string) {
    if (value === '' || value === null || value === undefined) {
        return undefined;
    }

    if (typeof value === 'number') {
        if (!Number.isFinite(value) || value < 0 || !Number.isInteger(value)) {
            throw new Error(`${label} harus berupa angka bulat`);
        }
        return value;
    }

    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) {
            return undefined;
        }

        const parts = trimmed.replace(/\s+/g, '').split(/[,.]/);
        if (parts.length > 1) {
            const tailGroups = parts
                .slice(1)
                .map(part => part.replace(/\D/g, ''))
                .filter(Boolean);
            const hasValidThousandsGrouping =
                tailGroups.length > 0 &&
                tailGroups.every(part => part.length === 3);

            if (!hasValidThousandsGrouping) {
                throw new Error(`${label} harus berupa angka bulat`);
            }
        }
    }

    const normalized = normalizeNumber(value, { allowDecimal: false, maxFractionDigits: 0 });
    if (!Number.isFinite(normalized) || normalized < 0) {
        throw new Error(`${label} tidak valid`);
    }

    return normalized;
}

function normalizeTirePositionKey(posisi: string) {
    return posisi.trim().toLowerCase().replace(/\s+/g, ' ');
}

function normalizeServiceCode(value: unknown) {
    return normalizeText(value)
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

async function generateVehicleUnitCode(categoryCode: string, excludeId?: string) {
    const rows = await getSanityClient().fetch<Array<{ _id: string; unitCode?: string }>>(
        excludeId
            ? `*[_type == "vehicle" && _id != $excludeId && defined(unitCode)]{ _id, unitCode }`
            : `*[_type == "vehicle" && defined(unitCode)]{ _id, unitCode }`,
        excludeId ? { excludeId } : {}
    );

    const prefix = `${categoryCode}-`;
    const highestNumber = rows.reduce((max, row) => {
        const code = normalizeText(row.unitCode).toUpperCase();
        if (!code.startsWith(prefix)) {
            return max;
        }
        const match = code.slice(prefix.length).match(/^(\d{1,6})$/);
        if (!match) {
            return max;
        }
        return Math.max(max, Number(match[1]));
    }, 0);

    return `${prefix}${String(highestNumber + 1).padStart(3, '0')}`;
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

export async function normalizeServicePayload(
    data: Record<string, unknown>,
    options?: { partial?: boolean; excludeId?: string }
) {
    const partial = options?.partial === true;
    const next: Record<string, unknown> = {};

    if (!partial || hasOwnKey(data, 'code')) {
        const code = normalizeServiceCode(data.code);
        if (!code) {
            throw new Error('Kode kategori armada wajib diisi');
        }
        if (!SERVICE_CODE_RE.test(code)) {
            throw new Error('Kode kategori armada hanya boleh berisi huruf/angka singkat, misalnya CDD atau FUSO');
        }
        const duplicate = await findDuplicateLowerTextDoc('service', 'code', code, options?.excludeId);
        if (duplicate) {
            throw new Error('Kode kategori armada sudah digunakan');
        }
        if (options?.excludeId) {
            const currentService = await sanityGetById<{ _id: string; code?: string; name?: string }>(options.excludeId);
            if (currentService?.code && currentService.code !== code) {
                const relatedVehicle = await getSanityClient().fetch<{ _id: string } | null>(
                    `*[_type == "vehicle" && ((serviceRef == $ref || serviceRef._ref == $ref) || lower(coalesce(serviceName, "")) == $serviceName)][0]{ _id }`,
                    {
                        ref: options.excludeId,
                        serviceName: normalizeText(currentService.name).toLowerCase(),
                    }
                );
                if (relatedVehicle) {
                    throw new Error('Kode kategori armada yang sudah dipakai kendaraan tidak boleh diubah');
                }
            }
        }
        next.code = code;
    }

    if (!partial || hasOwnKey(data, 'name')) {
        const name = normalizeText(data.name);
        if (!name) {
            throw new Error('Nama kategori truk/armada wajib diisi');
        }
        const duplicate = await findDuplicateLowerTextDoc('service', 'name', name, options?.excludeId);
        if (duplicate) {
            throw new Error('Nama kategori truk/armada sudah digunakan');
        }
        next.name = name;
    }

    if (!partial || hasOwnKey(data, 'description')) {
        next.description = normalizeText(data.description);
    }

    if (!partial || hasOwnKey(data, 'active')) {
        if (data.active !== undefined && typeof data.active !== 'boolean') {
            throw new Error('Status kategori truk/armada tidak valid');
        }
        next.active = typeof data.active === 'boolean' ? data.active : true;
    }

    return next;
}

export async function normalizeExpenseCategoryPayload(
    data: Record<string, unknown>,
    options?: { partial?: boolean; excludeId?: string }
) {
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

export async function normalizeDriverPayload(
    data: Record<string, unknown>,
    options?: { partial?: boolean; excludeId?: string }
) {
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
        ? await sanityGetById<{ _id: string; lastOdometer?: number; serviceRef?: string; unitCode?: string }>(options.excludeId)
        : null;

    if (options?.excludeId && !existingVehicle) {
        throw new Error('Kendaraan tidak ditemukan');
    }

    if (!partial || hasOwnKey(data, 'plateNumber')) {
        const plateNumber = normalizeText(data.plateNumber).toUpperCase().replace(/\s+/g, ' ');
        if (!plateNumber) {
            throw new Error('Plat nomor kendaraan wajib diisi');
        }
        const duplicate = await findDuplicateLowerTextDoc('vehicle', 'plateNumber', plateNumber, options?.excludeId);
        if (duplicate) {
            throw new Error('Plat nomor kendaraan sudah digunakan');
        }
        next.plateNumber = plateNumber;
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

    let resolvedServiceCode = '';
    if (!partial || hasOwnKey(data, 'serviceRef') || hasOwnKey(data, 'unitCode')) {
        const serviceRef = !partial || hasOwnKey(data, 'serviceRef')
            ? normalizeOptionalText(data.serviceRef)
            : normalizeOptionalText(existingVehicle?.serviceRef);
        if (!serviceRef) {
            throw new Error('Kategori armada kendaraan wajib dipilih');
        }
        const service = await sanityGetById<{ _id: string; name?: string; code?: string; active?: boolean }>(serviceRef);
        if (!service) {
            throw new Error('Kategori armada tidak ditemukan');
        }
        if (service.active === false) {
            throw new Error('Kategori armada tidak aktif');
        }
        const serviceCode = normalizeServiceCode(service.code);
        if (!serviceCode) {
            throw new Error('Kategori armada belum punya kode yang valid');
        }
        resolvedServiceCode = serviceCode;
        if (!partial || hasOwnKey(data, 'serviceRef')) {
            next.serviceRef = serviceRef;
            next.serviceName = service.name || '';
        }
    }

    if (!partial || hasOwnKey(data, 'unitCode') || hasOwnKey(data, 'serviceRef')) {
        const providedUnitCode = normalizeText(data.unitCode).toUpperCase().replace(/\s+/g, '-');
        let unitCode = providedUnitCode;
        if (!unitCode) {
            if (!resolvedServiceCode) {
                throw new Error('Kategori armada kendaraan wajib dipilih sebelum kode unit dibuat');
            }
            unitCode = await generateVehicleUnitCode(resolvedServiceCode, options?.excludeId);
        }
        if (resolvedServiceCode && !unitCode.startsWith(`${resolvedServiceCode}-`)) {
            throw new Error(`Kode unit harus diawali ${resolvedServiceCode}- sesuai kategori armada`);
        }
        const duplicate = await findDuplicateLowerTextDoc('vehicle', 'unitCode', unitCode, options?.excludeId);
        if (duplicate) {
            throw new Error('Kode unit kendaraan sudah digunakan');
        }
        next.unitCode = unitCode;
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
        const lastOdometer = normalizeOptionalWholeNumber(data.lastOdometer, 'Odometer kendaraan') ?? 0;
        if (
            existingVehicle &&
            typeof existingVehicle.lastOdometer === 'number' &&
            lastOdometer < existingVehicle.lastOdometer
        ) {
            throw new Error('Odometer kendaraan tidak boleh mundur dari catatan terakhir');
        }
        next.lastOdometer = lastOdometer;
        if (lastOdometer > 0 && !hasOwnKey(data, 'lastOdometerAt')) {
            next.lastOdometerAt = getBusinessDateValue();
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

export async function normalizeMaintenanceCreatePayload(data: Record<string, unknown>): Promise<MaintenanceCreatePayload> {
    const vehicleRef = typeof data.vehicleRef === 'string' ? data.vehicleRef : '';
    const type = typeof data.type === 'string' ? data.type.trim() : '';
    if (!vehicleRef || !type) {
        throw new Error('Kendaraan dan tipe maintenance wajib diisi');
    }

    const scheduleType = data.scheduleType === 'ODOMETER' ? 'ODOMETER' : 'DATE';
    const notes = typeof data.notes === 'string' && data.notes.trim() ? data.notes.trim() : undefined;
    const vehicle = await sanityGetById<{ _id: string; plateNumber?: string; status?: string }>(vehicleRef);
    if (!vehicle) {
        throw new Error('Kendaraan maintenance tidak ditemukan');
    }
    if (vehicle.status === 'SOLD') {
        throw new Error('Kendaraan yang sudah dijual tidak bisa dijadwalkan maintenance');
    }
    const vehiclePlate = vehicle.plateNumber;

    if (scheduleType === 'DATE') {
        const plannedDate = typeof data.plannedDate === 'string' ? data.plannedDate : '';
        if (!plannedDate) {
            throw new Error('Tanggal maintenance wajib diisi');
        }
        assertIsoDate(plannedDate, 'Tanggal maintenance');

        return {
            vehicleRef,
            vehiclePlate,
            type,
            scheduleType,
            plannedDate,
            notes,
        };
    }

    const plannedOdometer = normalizeOptionalWholeNumber(data.plannedOdometer, 'Odometer maintenance');
    if (plannedOdometer === undefined || !Number.isFinite(plannedOdometer) || plannedOdometer <= 0) {
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
    const tireCode = normalizeText(data.tireCode).toUpperCase().replace(/\s+/g, '-');
    const holderType =
        data.holderType === 'EXTERNAL_VEHICLE' || data.holderType === 'WAREHOUSE'
            ? data.holderType
            : 'INTERNAL_VEHICLE';
    const rawStatus = normalizeText(data.status).toUpperCase();
    const status =
        rawStatus === 'SPARE' ||
        rawStatus === 'IN_WAREHOUSE' ||
        rawStatus === 'LOANED_OUT' ||
        rawStatus === 'SCRAPPED'
            ? rawStatus
            : 'IN_USE';
    const vehicleRef = normalizeOptionalText(data.vehicleRef);
    const slotCode = normalizeOptionalText(data.slotCode) ? normalizeTireSlotCode(String(data.slotCode)) : '';
    const slotLabel = slotCode ? formatTireSlotLabel(slotCode) : '';
    const tireBrand = normalizeText(data.tireBrand);
    const tireSize = normalizeText(data.tireSize);
    const installDate = normalizeText(data.installDate);
    const replaceDate = normalizeOptionalText(data.replaceDate);
    const notes = normalizeOptionalText(data.notes);
    const externalPartyName = normalizeOptionalText(data.externalPartyName);
    const externalPlateNumber = normalizeOptionalText(data.externalPlateNumber)?.toUpperCase();
    const tireType =
        data.tireType === 'Tube Type' || data.tireType === 'Solid' ? data.tireType : 'Tubeless';

    if (!tireCode || !tireBrand || !tireSize || !installDate) {
        throw new Error('Kode ban, merk, ukuran, dan tanggal pencatatan wajib diisi');
    }

    assertIsoDate(installDate, 'Tanggal pencatatan ban');
    if (replaceDate) {
        assertIsoDate(replaceDate, 'Tanggal penggantian ban');
    }
    if (replaceDate && replaceDate < installDate) {
        throw new Error('Tanggal penggantian ban tidak boleh sebelum tanggal pasang');
    }

    const duplicateTireCode = await findDuplicateLowerTextDoc('tireEvent', 'tireCode', tireCode, excludeId);
    if (duplicateTireCode) {
        throw new Error('Kode ban sudah digunakan');
    }

    let normalizedVehiclePlate: string | undefined;
    let existingTireEvent: { vehicleRef?: string; vehiclePlate?: string } | null = null;
    if (excludeId) {
        existingTireEvent = await sanityGetById<{ vehicleRef?: string; vehiclePlate?: string }>(excludeId);
    }

    if (holderType === 'INTERNAL_VEHICLE') {
        if (!['IN_USE', 'SPARE'].includes(status)) {
            throw new Error('Ban internal hanya boleh berstatus terpasang atau serep');
        }
        if (!vehicleRef) {
            throw new Error('Kendaraan wajib dipilih untuk ban internal');
        }
        if (!slotCode) {
            throw new Error('Slot/kode posisi ban wajib diisi');
        }
        if (!isKnownInternalTireSlotCode(slotCode)) {
            throw new Error('Kode slot ban tidak valid');
        }
        const isSpareSlot = slotCode.startsWith('SP');
        if (status === 'SPARE' && !isSpareSlot) {
            throw new Error('Ban serep wajib memakai slot SP');
        }
        if (status === 'IN_USE' && isSpareSlot) {
            throw new Error('Ban terpasang tidak boleh memakai slot serep');
        }
        const vehicle = await sanityGetById<{ _id: string; plateNumber?: string; status?: string }>(vehicleRef);
        if (!vehicle) {
            throw new Error('Kendaraan ban tidak ditemukan');
        }
        const canUseSoldVehicle = existingTireEvent?.vehicleRef === vehicleRef;
        if (vehicle.status === 'SOLD' && !canUseSoldVehicle) {
            throw new Error('Kendaraan yang sudah dijual tidak bisa dicatat pada manajemen ban');
        }
        normalizedVehiclePlate = vehicle.plateNumber;

        if (status !== 'SCRAPPED') {
            const activeTires = await getSanityClient().fetch<Array<{
                _id: string;
                slotCode?: string;
                holderType?: string;
                status?: string;
                vehicleRef?: string;
            }>>(
                `*[
                    _type == "tireEvent" &&
                    vehicleRef == $vehicleRef &&
                    holderType == "INTERNAL_VEHICLE" &&
                    status in ["IN_USE", "SPARE"]
                ]{
                    _id,
                    slotCode,
                    holderType,
                    status,
                    vehicleRef
                }`,
                { vehicleRef }
            );
            const activeDuplicate = activeTires.find(item => item._id !== excludeId && normalizeTireSlotCode(item.slotCode || '') === slotCode);
            if (activeDuplicate) {
                throw new Error('Slot ban ini masih dipakai ban lain pada kendaraan yang sama');
            }
        }
    } else if (holderType === 'EXTERNAL_VEHICLE') {
        if (status !== 'LOANED_OUT') {
            throw new Error('Ban pinjam keluar wajib berstatus dipinjam keluar');
        }
        if (!externalPartyName && !externalPlateNumber) {
            throw new Error('Nama pihak luar atau plat luar wajib diisi untuk ban pinjam keluar');
        }
    } else {
        if (status !== 'IN_WAREHOUSE' && status !== 'SCRAPPED') {
            throw new Error('Ban di gudang hanya boleh berstatus gudang atau afkir');
        }
    }

    const posisi = buildTirePlacementLabel({
        holderType,
        status,
        vehiclePlate: normalizedVehiclePlate,
        slotCode,
        externalPartyName,
        externalPlateNumber,
    });
    const positionKey = normalizeTirePositionKey(slotCode || posisi);

    return {
        tireCode,
        holderType,
        status,
        vehicleRef: holderType === 'INTERNAL_VEHICLE' ? vehicleRef || undefined : undefined,
        vehiclePlate: holderType === 'INTERNAL_VEHICLE' ? normalizedVehiclePlate : undefined,
        posisi,
        positionKey,
        slotCode: holderType === 'INTERNAL_VEHICLE' ? slotCode || undefined : undefined,
        slotLabel: holderType === 'INTERNAL_VEHICLE' ? slotLabel || undefined : undefined,
        externalPartyName: holderType === 'EXTERNAL_VEHICLE' ? externalPartyName : undefined,
        externalPlateNumber: holderType === 'EXTERNAL_VEHICLE' ? externalPlateNumber : undefined,
        tireType,
        tireBrand,
        tireSize,
        installDate,
        replaceDate,
        notes,
    };
}
