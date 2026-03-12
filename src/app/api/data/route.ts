/* ============================================================
   LOGISTIK - General Data API
   Centralized CRUD API - Sanity CMS Backend
   ============================================================ */

import { NextResponse } from 'next/server';

import { createSession, getSession, hashPassword, setSessionCookie, verifyPassword } from '@/lib/auth';
import { filterExpensesByRole, sanitizeVehicleForRole } from '@/lib/rbac';
import {
    getSanityClient,
    SANITY_TYPE_MAP,
    sanityCreate,
    sanityDelete,
    sanityGetAll,
    sanityGetByFilter,
    sanityGetById,
    sanityGetCompanyProfile,
    sanityGetNextNumber,
    sanityUpdate,
} from '@/lib/sanity';
import type { Expense, Payment, User, Vehicle } from '@/lib/types';

type Session = { _id: string; name: string; role: User['role'] };
type BankAccountSummary = {
    _id: string;
    currentBalance: number;
    bankName: string;
    accountNumber?: string;
    accountType?: 'BANK' | 'CASH';
    systemKey?: string;
    accountHolder?: string;
    active?: boolean;
};
type OrderItemStatusSummary = { status?: string };
type MaintenanceCreatePayload = {
    vehicleRef: string;
    vehiclePlate?: string;
    type: string;
    scheduleType: 'DATE' | 'ODOMETER';
    plannedDate?: string;
    plannedOdometer?: number;
    notes?: string;
};
type NormalizedOrderItemInput = {
    description: string;
    qtyKoli: number;
    weight: number;
    volume?: number;
    value?: number;
};
type NormalizedFreightNotaRow = {
    doRef?: string;
    doNumber?: string;
    vehiclePlate?: string;
    date: string;
    noSJ: string;
    dari: string;
    tujuan: string;
    barang?: string;
    collie?: number;
    beratKg: number;
    tarip: number;
    uangRp: number;
    ket?: string;
};
type NormalizedDriverBoronganRow = {
    doRef?: string;
    doNumber?: string;
    vehiclePlate?: string;
    date: string;
    noSJ: string;
    tujuan: string;
    barang?: string;
    collie?: number;
    beratKg: number;
    tarip: number;
    uangRp: number;
    ket?: string;
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
type DashboardSummary = {
    orderStats: { total: number; open: number; partial: number; complete: number; onHold: number };
    doStats: { total: number; onDelivery: number };
    notaStats: { unpaid: number; totalOutstanding: number };
    boronganStats: { unpaid: number; totalOutstanding: number };
    voucherStats: { unsettled: number; totalIssued: number };
    fleetStats: { openIncidents: number; maintenanceDue: number };
    recentOrders: Array<{ _id: string; masterResi?: string; customerName?: string; status?: string; createdAt?: string }>;
    recentNotas: Array<{ _id: string; notaNumber?: string; customerName?: string; status?: string; totalAmount?: number }>;
};

const INCIDENT_STATUS_TRANSITIONS: Record<string, string[]> = {
    OPEN: ['IN_PROGRESS'],
    IN_PROGRESS: ['RESOLVED'],
    RESOLVED: ['CLOSED'],
    CLOSED: [],
};
const DO_STATUS_TRANSITIONS: Record<string, string[]> = {
    CREATED: ['ON_DELIVERY', 'CANCELLED'],
    ON_DELIVERY: ['DELIVERED', 'CANCELLED'],
    DELIVERED: [],
    CANCELLED: [],
};

const OWNER_ONLY_READ_ENTITIES = new Set(['audit-logs']);
const OWNER_ONLY_MUTATION_ENTITIES = new Set(['company', 'audit-logs', 'bank-accounts', 'bank-transactions', 'services', 'expense-categories']);
const LEGACY_READ_ONLY_ENTITIES = new Set(['invoices', 'invoice-items']);
const CASH_ACCOUNT_SYSTEM_KEY = 'cash-on-hand';
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const VEHICLE_STATUS_VALUES = new Set(['ACTIVE', 'IN_SERVICE', 'OUT_OF_SERVICE', 'SOLD']);

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeText(value: unknown) {
    return typeof value === 'string' ? value.trim() : '';
}

function normalizeOptionalText(value: unknown) {
    const normalized = normalizeText(value);
    return normalized || undefined;
}

function hasOwnKey(value: Record<string, unknown>, key: string) {
    return Object.prototype.hasOwnProperty.call(value, key);
}

function normalizeNumber(value: unknown) {
    return typeof value === 'number' ? value : Number(value);
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

function assertIsoDate(value: string, label: string) {
    if (!ISO_DATE_RE.test(value)) {
        throw new Error(`${label} tidak valid`);
    }
}

function normalizeTirePositionKey(posisi: string) {
    return posisi.trim().toLowerCase().replace(/\s+/g, ' ');
}

function isFreightNotaRowEmpty(row: Record<string, unknown>) {
    return (
        !normalizeOptionalText(row.doRef) &&
        !normalizeText(row.noSJ) &&
        !normalizeText(row.tujuan) &&
        !normalizeText(row.barang) &&
        normalizeNumber(row.collie || 0) === 0 &&
        normalizeNumber(row.beratKg || 0) === 0 &&
        normalizeNumber(row.tarip || 0) === 0
    );
}

function isDriverBoronganRowEmpty(row: Record<string, unknown>) {
    return (
        !normalizeOptionalText(row.doRef) &&
        !normalizeText(row.noSJ) &&
        !normalizeText(row.tujuan) &&
        !normalizeText(row.barang) &&
        normalizeNumber(row.collie || 0) === 0 &&
        normalizeNumber(row.beratKg || 0) === 0 &&
        normalizeNumber(row.tarip || 0) === 0
    );
}

function extractRefId(value: unknown) {
    if (typeof value === 'string' && value) {
        return value;
    }

    if (isPlainObject(value) && typeof value._ref === 'string' && value._ref) {
        return value._ref;
    }

    return null;
}

function validateEntity(entity: string | null): entity is keyof typeof SANITY_TYPE_MAP {
    return Boolean(entity && SANITY_TYPE_MAP[entity]);
}

async function ensureCashAccount() {
    const existing = await getSanityClient().fetch<BankAccountSummary | null>(
        `*[_type == "bankAccount" && systemKey == $key][0]{
            _id,
            currentBalance,
            bankName,
            accountNumber,
            accountType,
            systemKey,
            accountHolder,
            active
        }`,
        { key: CASH_ACCOUNT_SYSTEM_KEY }
    );
    if (existing) {
        if (existing.active === false) {
            await sanityUpdate(existing._id, { active: true });
            return { ...existing, active: true };
        }
        return existing;
    }

    const company = await sanityGetCompanyProfile() as { name?: string } | null;
    return sanityCreate<BankAccountSummary>({
        _id: 'bank-cash-on-hand',
        _type: 'bankAccount',
        bankName: 'Kas Tunai',
        accountNumber: 'CASH',
        accountHolder: company?.name || 'Perusahaan',
        accountType: 'CASH',
        systemKey: CASH_ACCOUNT_SYSTEM_KEY,
        initialBalance: 0,
        currentBalance: 0,
        active: true,
        notes: 'Akun sistem untuk mencatat kas tunai operasional.',
    });
}

async function getLedgerAccount(accountRef: string) {
    const account = await sanityGetById<BankAccountSummary>(accountRef);
    if (!account || account.active === false) {
        return null;
    }
    return account;
}

function forbidOwnerOnlyEntity(session: Session, entity: string) {
    if (OWNER_ONLY_MUTATION_ENTITIES.has(entity) && session.role !== 'OWNER') {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    return null;
}

async function addAuditLog(
    session: Pick<Session, '_id' | 'name'>,
    action: string,
    entityType: string,
    entityRef: string,
    summary: string
) {
    try {
        await sanityCreate({
            _type: 'auditLog',
            actorUserRef: session._id,
            actorUserName: session.name,
            action,
            entityType,
            entityRef,
            changesSummary: summary,
            timestamp: new Date().toISOString(),
        });
    } catch {
        console.warn('Audit log write failed');
    }
}

async function getDashboardSummary(session: Session): Promise<DashboardSummary> {
    const client = getSanityClient();
    const [
        orderStats,
        doStats,
        unpaidNotas,
        unpaidBorongans,
        openVouchers,
        fleetStats,
        recentOrders,
        recentNotas,
    ] = await Promise.all([
        client.fetch<DashboardSummary['orderStats']>(`{
            "total": count(*[_type == "order"]),
            "open": count(*[_type == "order" && status == "OPEN"]),
            "partial": count(*[_type == "order" && status == "PARTIAL"]),
            "complete": count(*[_type == "order" && status == "COMPLETE"]),
            "onHold": count(*[_type == "order" && status == "ON_HOLD"])
        }`),
        client.fetch<DashboardSummary['doStats']>(`{
            "total": count(*[_type == "deliveryOrder"]),
            "onDelivery": count(*[_type == "deliveryOrder" && status == "ON_DELIVERY"])
        }`),
        client.fetch<Array<{ totalAmount?: number }>>(`*[_type == "freightNota" && status != "PAID"]{ totalAmount }`),
        client.fetch<Array<{ totalAmount?: number }>>(`*[_type == "driverBorongan" && status != "PAID"]{ totalAmount }`),
        client.fetch<Array<{ cashGiven?: number }>>(`*[_type == "driverVoucher" && status != "SETTLED"]{ cashGiven }`),
        client.fetch<DashboardSummary['fleetStats']>(`{
            "openIncidents": count(*[_type == "incident" && (status == "OPEN" || status == "IN_PROGRESS")]),
            "maintenanceDue": count(*[_type == "maintenance" && status == "SCHEDULED"])
        }`),
        client.fetch<DashboardSummary['recentOrders']>(`*[_type == "order"] | order(_createdAt desc)[0...5]{
            _id,
            masterResi,
            customerName,
            status,
            createdAt
        }`),
        client.fetch<DashboardSummary['recentNotas']>(`*[_type == "freightNota"] | order(_createdAt desc)[0...5]{
            _id,
            notaNumber,
            customerName,
            status,
            totalAmount
        }`),
    ]);

    const notaOutstanding = unpaidNotas.reduce(
        (sum, nota) => sum + (typeof nota.totalAmount === 'number' ? nota.totalAmount : 0),
        0
    );
    const boronganOutstanding = unpaidBorongans.reduce(
        (sum, borongan) => sum + (typeof borongan.totalAmount === 'number' ? borongan.totalAmount : 0),
        0
    );
    const voucherIssued = openVouchers.reduce(
        (sum, voucher) => sum + (typeof voucher.cashGiven === 'number' ? voucher.cashGiven : 0),
        0
    );

    return {
        orderStats,
        doStats,
        notaStats: {
            unpaid: unpaidNotas.length,
            totalOutstanding: session.role === 'OWNER' ? notaOutstanding : 0,
        },
        boronganStats: {
            unpaid: unpaidBorongans.length,
            totalOutstanding: session.role === 'OWNER' ? boronganOutstanding : 0,
        },
        voucherStats: {
            unsettled: openVouchers.length,
            totalIssued: session.role === 'OWNER' ? voucherIssued : 0,
        },
        fleetStats,
        recentOrders,
        recentNotas,
    };
}

async function normalizeUserCreatePayload(data: Record<string, unknown>) {
    const name = normalizeText(data.name);
    const email = normalizeText(data.email).toLowerCase();
    const password = typeof data.password === 'string' ? data.password.trim() : '';
    const role = data.role === 'OWNER' || data.role === 'ADMIN' ? data.role : null;
    if (!name || !email) {
        throw new Error('Nama dan email wajib diisi');
    }
    if (!role) {
        throw new Error('Role user tidak valid');
    }
    if (password.length < 8) {
        throw new Error('Password minimal 8 karakter');
    }

    const existingEmail = await getSanityClient().fetch<{ _id: string } | null>(
        `*[_type == "user" && lower(email) == $email][0]{ _id }`,
        { email }
    );
    if (existingEmail) {
        throw new Error('Email user sudah digunakan');
    }

    return {
        ...data,
        name,
        email,
        role,
        passwordHash: await hashPassword(password),
        active: true,
        createdAt: new Date().toISOString(),
    };
}

async function normalizeUserUpdates(
    session: Session,
    targetUserId: string,
    updates: Record<string, unknown>,
    currentPassword: unknown
) {
    const nextUpdates = { ...updates };
    const existingUser = await sanityGetById<{ _id: string; email: string; role: string; active: boolean; passwordHash: string }>(targetUserId);
    if (!existingUser) {
        throw new Error('User tidak ditemukan');
    }

    const isSelfUpdate = session._id === targetUserId;
    if (session.role !== 'OWNER' && !isSelfUpdate) {
        throw new Error('Forbidden');
    }

    if (session.role !== 'OWNER') {
        const allowedSelfFields = new Set(['name', 'password', 'passwordHash']);
        if (Object.keys(nextUpdates).some(key => !allowedSelfFields.has(key))) {
            throw new Error('Perubahan profil ini tidak diizinkan');
        }
    }

    if (typeof nextUpdates.name === 'string') {
        const normalizedName = nextUpdates.name.trim();
        if (!normalizedName) {
            throw new Error('Nama wajib diisi');
        }
        nextUpdates.name = normalizedName;
    }

    if (typeof nextUpdates.email === 'string') {
        const normalizedEmail = nextUpdates.email.trim().toLowerCase();
        if (!normalizedEmail) {
            throw new Error('Email wajib diisi');
        }
        const duplicateEmail = await getSanityClient().fetch<{ _id: string } | null>(
            `*[_type == "user" && lower(email) == $email && _id != $excludeId][0]{ _id }`,
            { email: normalizedEmail, excludeId: targetUserId }
        );
        if (duplicateEmail) {
            throw new Error('Email user sudah digunakan');
        }
        nextUpdates.email = normalizedEmail;
    }

    if (typeof nextUpdates.role === 'string' && !['OWNER', 'ADMIN'].includes(nextUpdates.role)) {
        throw new Error('Role user tidak valid');
    }

    if ('active' in nextUpdates && typeof nextUpdates.active !== 'boolean') {
        throw new Error('Status user tidak valid');
    }

    const nextRole =
        typeof nextUpdates.role === 'string' ? nextUpdates.role : existingUser.role;
    const nextActive =
        typeof nextUpdates.active === 'boolean' ? nextUpdates.active : existingUser.active;

    if (isSelfUpdate && !nextActive) {
        throw new Error('Anda tidak dapat menonaktifkan akun sendiri');
    }

    if (existingUser.role === 'OWNER' && (nextRole !== 'OWNER' || !nextActive)) {
        const otherActiveOwners = await getSanityClient().fetch<number>(
            `count(*[_type == "user" && role == "OWNER" && active == true && _id != $excludeId])`,
            { excludeId: targetUserId }
        );
        if (otherActiveOwners === 0) {
            throw new Error('Minimal harus ada satu OWNER aktif');
        }
    }

    const rawPassword =
        typeof nextUpdates.password === 'string'
            ? nextUpdates.password
            : typeof nextUpdates.passwordHash === 'string'
                ? nextUpdates.passwordHash
                : null;

    if (rawPassword !== null) {
        const password = rawPassword.trim();
        if (password.length < 8) {
            throw new Error('Password minimal 8 karakter');
        }

        if (isSelfUpdate) {
            if (typeof currentPassword !== 'string' || !currentPassword.trim()) {
                throw new Error('Password saat ini wajib diisi');
            }

            const validCurrentPassword = await verifyPassword(currentPassword, existingUser.passwordHash);
            if (!validCurrentPassword) {
                throw new Error('Password saat ini tidak valid');
            }
        }

        nextUpdates.passwordHash = await hashPassword(password);
    }

    delete nextUpdates.password;
    return nextUpdates;
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

async function normalizeServicePayload(data: Record<string, unknown>, options?: { partial?: boolean; excludeId?: string }) {
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

async function normalizeExpenseCategoryPayload(data: Record<string, unknown>, options?: { partial?: boolean; excludeId?: string }) {
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

async function normalizeDriverPayload(data: Record<string, unknown>, options?: { partial?: boolean; excludeId?: string }) {
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

async function normalizeVehiclePayload(
    session: Session,
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

async function handleBankTransfer(data: Record<string, unknown>) {
    const amount = typeof data.amount === 'number' ? data.amount : Number(data.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
        return NextResponse.json({ error: 'Nominal transfer tidak valid' }, { status: 400 });
    }

    const fromAccountRef = typeof data.fromAccountRef === 'string' ? data.fromAccountRef : '';
    const toAccountRef = typeof data.toAccountRef === 'string' ? data.toAccountRef : '';
    if (!fromAccountRef || !toAccountRef || fromAccountRef === toAccountRef) {
        return NextResponse.json({ error: 'Rekening transfer tidak valid' }, { status: 400 });
    }

    const fromAcc = await getLedgerAccount(fromAccountRef);
    const toAcc = await getLedgerAccount(toAccountRef);
    if (!fromAcc || !toAcc) {
        return NextResponse.json({ error: 'Akun sumber atau tujuan tidak ditemukan' }, { status: 404 });
    }

    const transferId = `transfer-${Date.now()}`;
    const transferDate =
        typeof data.date === 'string' && data.date
            ? data.date
            : new Date().toISOString().slice(0, 10);
    const fromBalance = (fromAcc.currentBalance || 0) - amount;
    const toBalance = (toAcc.currentBalance || 0) + amount;

    await sanityCreate({
        _type: 'bankTransaction',
        bankAccountRef: fromAccountRef,
        bankAccountName: fromAcc.bankName,
        type: 'TRANSFER_OUT',
        amount,
        date: transferDate,
        description: `Transfer ke ${toAcc.bankName}`,
        balanceAfter: fromBalance,
        relatedTransferRef: transferId,
    });

    await sanityCreate({
        _type: 'bankTransaction',
        bankAccountRef: toAccountRef,
        bankAccountName: toAcc.bankName,
        type: 'TRANSFER_IN',
        amount,
        date: transferDate,
        description: `Transfer dari ${fromAcc.bankName}`,
        balanceAfter: toBalance,
        relatedTransferRef: transferId,
    });

    await sanityUpdate(fromAccountRef, { currentBalance: fromBalance });
    await sanityUpdate(toAccountRef, { currentBalance: toBalance });

    return NextResponse.json({ success: true, transferId });
}

async function loadPaymentTarget(invoiceRef: string) {
    const doc = await sanityGetById<Record<string, unknown>>(invoiceRef);
    if (!doc) {
        return { error: NextResponse.json({ error: 'Dokumen tagihan tidak ditemukan' }, { status: 404 }) };
    }

    const totalAmount = typeof doc.totalAmount === 'number' ? doc.totalAmount : Number(doc.totalAmount || 0);
    if (!Number.isFinite(totalAmount) || totalAmount <= 0) {
        return { error: NextResponse.json({ error: 'Total tagihan tidak valid' }, { status: 400 }) };
    }

    const allPayments = await getSanityClient().fetch<Payment[]>(
        `*[_type == "payment" && invoiceRef == $ref]`,
        { ref: invoiceRef }
    );
    const totalPaid = allPayments.reduce((sum, item) => sum + item.amount, 0);

    return { doc, totalAmount, totalPaid };
}

async function syncPaymentStatus(invoiceRef: string) {
    const loaded = await loadPaymentTarget(invoiceRef);
    if ('error' in loaded) return loaded.error;

    const { doc, totalAmount, totalPaid } = loaded;
    const nextStatus =
        doc._type === 'driverBorongan'
            ? totalPaid >= totalAmount ? 'PAID' : 'UNPAID'
            : totalPaid >= totalAmount ? 'PAID' : totalPaid > 0 ? 'PARTIAL' : 'UNPAID';
    await sanityUpdate(invoiceRef, { status: nextStatus });
    return null;
}

function deriveOrderStatusFromItems(items: OrderItemStatusSummary[]) {
    const allDelivered = items.length > 0 && items.every(item => item.status === 'DELIVERED');
    const anyInProgress = items.some(
        item => item.status === 'DELIVERED' || item.status === 'ON_DELIVERY'
    );
    const anyHold = items.some(item => item.status === 'HOLD');

    if (allDelivered) return 'COMPLETE';
    if (anyInProgress) return 'PARTIAL';
    if (anyHold) return 'ON_HOLD';
    return 'OPEN';
}

async function syncOrderStatusFromItems(orderRef: string, session: Session) {
    const order = await sanityGetById<{ _id: string; status?: string }>(orderRef);
    if (!order || order.status === 'CANCELLED') {
        return;
    }

    const items = await getSanityClient().fetch<OrderItemStatusSummary[]>(
        `*[_type == "orderItem" && orderRef == $orderRef]{ status }`,
        { orderRef }
    );
    const nextStatus = deriveOrderStatusFromItems(items);

    if (order.status === nextStatus) {
        return;
    }

    await sanityUpdate(orderRef, { status: nextStatus });
    void addAuditLog(
        session,
        'UPDATE',
        'orders',
        orderRef,
        `Order auto-${nextStatus}: sinkronisasi dari ${items.length} item`
    );
}

function normalizeMaintenanceCreatePayload(data: Record<string, unknown>): MaintenanceCreatePayload {
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

async function normalizeTireEventPayload(
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

async function handleOrderCreate(session: Session, data: Record<string, unknown>) {
    const customerRef = normalizeText(data.customerRef);
    const receiverName = normalizeText(data.receiverName);
    const receiverAddress = normalizeText(data.receiverAddress);
    if (!customerRef || !receiverName || !receiverAddress) {
        return NextResponse.json({ error: 'Customer, penerima, dan alamat tujuan wajib diisi' }, { status: 400 });
    }

    const rawItems = Array.isArray(data.items) ? data.items : [];
    const items = rawItems
        .filter(isPlainObject)
        .filter(item => normalizeText(item.description))
        .map<NormalizedOrderItemInput>(item => {
            const description = normalizeText(item.description);
            const qtyKoli = normalizeNumber(item.qtyKoli ?? 1);
            const weight = normalizeNumber(item.weight ?? 0);
            const volume = normalizeNumber(item.volume);
            const value = normalizeNumber(item.value);

            if (!description) {
                throw new Error('Deskripsi item order wajib diisi');
            }
            if (!Number.isFinite(qtyKoli) || qtyKoli <= 0) {
                throw new Error('Jumlah koli item order harus lebih besar dari 0');
            }
            if (!Number.isFinite(weight) || weight < 0) {
                throw new Error('Berat item order tidak valid');
            }

            return {
                description,
                qtyKoli,
                weight,
                volume: Number.isFinite(volume) && volume >= 0 ? volume : undefined,
                value: Number.isFinite(value) && value >= 0 ? value : undefined,
            };
        });

    if (items.length === 0) {
        return NextResponse.json({ error: 'Minimal 1 item order wajib diisi' }, { status: 400 });
    }

    const orderId = crypto.randomUUID();
    const masterResi = await sanityGetNextNumber('resi');
    const createdAt = new Date().toISOString();
    const orderDoc = {
        _id: orderId,
        _type: 'order',
        customerRef,
        customerName: normalizeOptionalText(data.customerName),
        receiverName,
        receiverPhone: normalizeText(data.receiverPhone),
        receiverAddress,
        receiverCompany: normalizeOptionalText(data.receiverCompany),
        pickupAddress: normalizeOptionalText(data.pickupAddress),
        serviceRef: typeof data.serviceRef === 'string' ? data.serviceRef : '',
        serviceName: normalizeOptionalText(data.serviceName),
        notes: normalizeOptionalText(data.notes),
        masterResi,
        status: 'OPEN',
        createdAt,
        createdBy: session._id,
    };

    const transaction = getSanityClient().transaction().create(orderDoc);
    for (const item of items) {
        transaction.create({
            _id: crypto.randomUUID(),
            _type: 'orderItem',
            orderRef: orderId,
            description: item.description,
            qtyKoli: item.qtyKoli,
            weight: item.weight,
            volume: item.volume,
            value: item.value,
            status: 'PENDING',
        });
    }

    await transaction.commit();
    void addAuditLog(session, 'CREATE', 'orders', orderId, `Created orders: ${masterResi}`);
    return NextResponse.json({ data: orderDoc, id: orderId });
}

async function handleIncidentCreate(session: Session, data: Record<string, unknown>) {
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

async function handleIncidentStatusUpdate(session: Session, data: Record<string, unknown>) {
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

async function handleDeliveryOrderStatusUpdate(session: Session, data: Record<string, unknown>) {
    const id = typeof data.id === 'string' ? data.id : '';
    const status = typeof data.status === 'string' ? data.status : '';
    const note = typeof data.note === 'string' ? data.note.trim() : '';
    if (!id || !status) {
        return NextResponse.json({ error: 'Status DO tidak valid' }, { status: 400 });
    }

    const deliveryOrder = await sanityGetById<{ _id: string; doNumber?: string; status?: string; orderRef?: unknown }>(id);
    if (!deliveryOrder) {
        return NextResponse.json({ error: 'Surat jalan tidak ditemukan' }, { status: 404 });
    }

    const allowedStatuses = DO_STATUS_TRANSITIONS[deliveryOrder.status || ''] || [];
    if (!allowedStatuses.includes(status)) {
        return NextResponse.json({ error: 'Transisi status DO tidak valid' }, { status: 400 });
    }

    const doItems = await getSanityClient().fetch<Array<{ orderItemRef?: unknown }>>(
        `*[_type == "deliveryOrderItem" && deliveryOrderRef == $ref]{ orderItemRef }`,
        { ref: id }
    );

    const nextOrderItemStatus =
        status === 'ON_DELIVERY'
            ? 'ON_DELIVERY'
            : status === 'DELIVERED'
                ? 'DELIVERED'
                : 'PENDING';

    const transaction = getSanityClient()
        .transaction()
        .patch(id, { set: { status } })
        .create({
            _id: crypto.randomUUID(),
            _type: 'trackingLog',
            refType: 'DO',
            refRef: id,
            status,
            note: note || undefined,
            timestamp: new Date().toISOString(),
            userRef: session._id,
            userName: session.name,
        });

    for (const item of doItems) {
        const orderItemRef = extractRefId(item.orderItemRef);
        if (orderItemRef) {
            transaction.patch(orderItemRef, { set: { status: nextOrderItemStatus } });
        }
    }

    await transaction.commit();

    const orderRef = extractRefId(deliveryOrder.orderRef);
    if (orderRef) {
        await syncOrderStatusFromItems(orderRef, session);
    }

    void addAuditLog(
        session,
        'UPDATE',
        'delivery-orders',
        id,
        `DO status ${deliveryOrder.doNumber || id}: ${deliveryOrder.status || '-'} -> ${status}`
    );

    return NextResponse.json({
        data: {
            ...deliveryOrder,
            status,
        },
    });
}

async function handleDeliveryOrderCreate(session: Session, data: Record<string, unknown>) {
    const orderRef = typeof data.orderRef === 'string' ? data.orderRef : '';
    const rawItemRefs = Array.isArray(data.itemRefs) ? data.itemRefs : [];
    const itemRefs = rawItemRefs.filter((item): item is string => typeof item === 'string' && item.length > 0);
    if (!orderRef || itemRefs.length === 0) {
        return NextResponse.json({ error: 'Order dan item surat jalan wajib diisi' }, { status: 400 });
    }

    const order = await sanityGetById<{
        _id: string;
        masterResi?: string;
        customerName?: string;
        receiverName?: string;
        receiverAddress?: string;
    }>(orderRef);
    if (!order) {
        return NextResponse.json({ error: 'Order tidak ditemukan' }, { status: 404 });
    }

    const selectedItems = await getSanityClient().fetch<Array<{
        _id: string;
        orderRef?: unknown;
        description?: string;
        qtyKoli?: number;
        weight?: number;
    }>>(`*[_type == "orderItem" && _id in $ids]`, { ids: itemRefs });
    if (selectedItems.length !== itemRefs.length) {
        return NextResponse.json({ error: 'Sebagian item order tidak ditemukan' }, { status: 404 });
    }

    for (const item of selectedItems) {
        if (extractRefId(item.orderRef) !== orderRef) {
            return NextResponse.json({ error: 'Ada item yang bukan milik order ini' }, { status: 400 });
        }

        const activeAssignment = await getSanityClient().fetch<{ _id: string } | null>(
            `*[
                _type == "deliveryOrderItem" &&
                orderItemRef == $orderItemRef &&
                defined(*[_type == "deliveryOrder" && _id == ^.deliveryOrderRef && status != "CANCELLED"][0]._id)
            ][0]{ _id }`,
            { orderItemRef: item._id }
        );
        if (activeAssignment) {
            return NextResponse.json({ error: 'Ada item yang sudah terikat ke surat jalan aktif lain' }, { status: 409 });
        }
    }

    const doId = crypto.randomUUID();
    const doNumber = await sanityGetNextNumber('do');
    const doDoc = {
        _id: doId,
        _type: 'deliveryOrder',
        ...data,
        orderRef,
        masterResi: typeof data.masterResi === 'string' && data.masterResi ? data.masterResi : order.masterResi,
        customerName: typeof data.customerName === 'string' && data.customerName ? data.customerName : order.customerName,
        receiverName: typeof data.receiverName === 'string' && data.receiverName ? data.receiverName : order.receiverName,
        receiverAddress: typeof data.receiverAddress === 'string' && data.receiverAddress ? data.receiverAddress : order.receiverAddress,
        doNumber,
        status: 'CREATED',
    };

    const transaction = getSanityClient().transaction().create(doDoc);
    for (const item of selectedItems) {
        transaction.create({
            _id: crypto.randomUUID(),
            _type: 'deliveryOrderItem',
            deliveryOrderRef: doId,
            orderItemRef: item._id,
            orderItemDescription: item.description,
            orderItemQtyKoli: item.qtyKoli,
            orderItemWeight: item.weight,
        });
    }

    await transaction.commit();
    void addAuditLog(session, 'CREATE', 'delivery-orders', doId, `Created delivery-orders: ${doNumber}`);
    return NextResponse.json({ data: doDoc, id: doId });
}

async function handleFreightNotaCreate(session: Session, data: Record<string, unknown>) {
    let resolvedCustomerRef = normalizeOptionalText(data.customerRef);
    const customerName = normalizeText(data.customerName);
    if (!customerName) {
        return NextResponse.json({ error: 'Nama customer nota wajib diisi' }, { status: 400 });
    }

    const rawRows = Array.isArray(data.items) ? data.items : Array.isArray(data.rows) ? data.rows : [];
    const rows = rawRows
        .filter(isPlainObject)
        .filter(row => !isFreightNotaRowEmpty(row))
        .map<NormalizedFreightNotaRow>(row => {
            const date = normalizeText(row.date);
            const doRef = normalizeOptionalText(row.doRef);
            const doNumber = normalizeOptionalText(row.doNumber);
            const noSJ = normalizeText(row.noSJ) || doNumber || '';
            const tujuan = normalizeText(row.tujuan);
            const dari = normalizeText(row.dari);
            const beratKg = normalizeNumber(row.beratKg);
            const tarip = normalizeNumber(row.tarip);
            const collie = normalizeNumber(row.collie ?? 0);

            if (!date || !noSJ || !tujuan) {
                throw new Error('Baris nota wajib punya tanggal, nomor SJ, dan tujuan');
            }
            if (!Number.isFinite(beratKg) || beratKg <= 0) {
                throw new Error('Berat pada baris nota harus lebih besar dari 0');
            }
            if (!Number.isFinite(tarip) || tarip <= 0) {
                throw new Error('Tarip pada baris nota harus lebih besar dari 0');
            }
            if (!Number.isFinite(collie) || collie < 0) {
                throw new Error('Collie pada baris nota tidak valid');
            }

            return {
                doRef,
                doNumber,
                vehiclePlate: normalizeOptionalText(row.vehiclePlate),
                date,
                noSJ,
                dari,
                tujuan,
                barang: normalizeOptionalText(row.barang),
                collie: collie > 0 ? collie : undefined,
                beratKg,
                tarip,
                uangRp: beratKg * tarip,
                ket: normalizeOptionalText(row.ket),
            };
        });

    if (rows.length === 0) {
        return NextResponse.json({ error: 'Minimal 1 baris nota wajib diisi' }, { status: 400 });
    }

    const doRefs = rows.flatMap(row => (row.doRef ? [row.doRef] : []));
    const uniqueDoRefs = [...new Set(doRefs)];
    if (uniqueDoRefs.length !== doRefs.length) {
        return NextResponse.json({ error: 'DO yang sama tidak boleh dimasukkan dua kali dalam nota' }, { status: 400 });
    }

    const deliveryOrders = uniqueDoRefs.length > 0
        ? await getSanityClient().fetch<Array<{
            _id: string;
            status?: string;
            orderRef?: unknown;
            doNumber?: string;
            vehiclePlate?: string;
            receiverAddress?: string;
        }>>(
            `*[_type == "deliveryOrder" && _id in $ids]{
                _id,
                status,
                orderRef,
                doNumber,
                vehiclePlate,
                receiverAddress
            }`,
            { ids: uniqueDoRefs }
        )
        : [];

    if (deliveryOrders.length !== uniqueDoRefs.length) {
        return NextResponse.json({ error: 'Sebagian DO nota tidak ditemukan' }, { status: 404 });
    }

    const deliveryOrderMap = new Map(deliveryOrders.map(item => [item._id, item]));
    for (const row of rows) {
        if (!row.doRef) continue;
        const deliveryOrder = deliveryOrderMap.get(row.doRef);
        if (!deliveryOrder) {
            return NextResponse.json({ error: 'DO nota tidak ditemukan' }, { status: 404 });
        }
        if (deliveryOrder.status !== 'DELIVERED') {
            return NextResponse.json({ error: `DO ${deliveryOrder.doNumber || row.doRef} belum selesai dikirim` }, { status: 409 });
        }
        row.doNumber = row.doNumber || deliveryOrder.doNumber;
        row.vehiclePlate = row.vehiclePlate || deliveryOrder.vehiclePlate;
        row.tujuan = row.tujuan || deliveryOrder.receiverAddress || row.tujuan;
    }

    if (uniqueDoRefs.length > 0) {
        const existingNotaItems = await getSanityClient().fetch<Array<{ doRef?: string; doNumber?: string }>>(
            `*[_type == "freightNotaItem" && doRef in $ids]{ doRef, doNumber }`,
            { ids: uniqueDoRefs }
        );
        if (existingNotaItems.length > 0) {
            const duplicate = existingNotaItems[0];
            return NextResponse.json(
                { error: `DO ${duplicate.doNumber || duplicate.doRef || ''} sudah tercantum di nota lain` },
                { status: 409 }
            );
        }
    }

    const orderRefs = [...new Set(
        deliveryOrders
            .map(item => extractRefId(item.orderRef))
            .filter((ref): ref is string => Boolean(ref))
    )];
    const sourceOrders = orderRefs.length > 0
        ? await getSanityClient().fetch<Array<{ _id: string; customerRef?: unknown }>>(
            `*[_type == "order" && _id in $ids]{ _id, customerRef }`,
            { ids: orderRefs }
        )
        : [];
    const orderCustomerMap = new Map(
        sourceOrders.map(order => [order._id, extractRefId(order.customerRef)])
    );
    const inferredCustomerRefs = [...new Set(
        deliveryOrders
            .map(deliveryOrder => {
                const orderRef = extractRefId(deliveryOrder.orderRef);
                return orderRef ? orderCustomerMap.get(orderRef) : undefined;
            })
            .filter((ref): ref is string => Boolean(ref))
    )];

    if (inferredCustomerRefs.length > 1) {
        return NextResponse.json(
            { error: 'DO yang dipilih berasal dari customer berbeda. Pisahkan per nota.' },
            { status: 409 }
        );
    }

    const inferredCustomerRef = inferredCustomerRefs[0];
    if (resolvedCustomerRef && inferredCustomerRef && resolvedCustomerRef !== inferredCustomerRef) {
        return NextResponse.json(
            { error: 'Customer nota tidak cocok dengan customer pada DO yang dipilih' },
            { status: 409 }
        );
    }
    if (!resolvedCustomerRef && inferredCustomerRef) {
        resolvedCustomerRef = inferredCustomerRef;
    }

    if (resolvedCustomerRef && deliveryOrders.length > 0) {
        for (const deliveryOrder of deliveryOrders) {
            const orderRef = extractRefId(deliveryOrder.orderRef);
            if (orderRef && orderCustomerMap.get(orderRef) !== resolvedCustomerRef) {
                return NextResponse.json(
                    { error: `DO ${deliveryOrder.doNumber || deliveryOrder._id} bukan milik customer yang dipilih` },
                    { status: 409 }
                );
            }
        }
    }

    const totalAmount = rows.reduce((sum, row) => sum + row.uangRp, 0);
    const totalCollie = rows.reduce((sum, row) => sum + (row.collie || 0), 0);
    const totalWeightKg = rows.reduce((sum, row) => sum + row.beratKg, 0);
    if (totalAmount <= 0) {
        return NextResponse.json({ error: 'Total nota harus lebih besar dari 0' }, { status: 400 });
    }

    const notaId = crypto.randomUUID();
    const notaNumber = await sanityGetNextNumber('nota');
    const issueDate = normalizeText(data.issueDate) || new Date().toISOString().slice(0, 10);
    const notaDoc = {
        _id: notaId,
        _type: 'freightNota',
        customerRef: resolvedCustomerRef,
        customerName,
        issueDate,
        dueDate: normalizeOptionalText(data.dueDate),
        status: 'UNPAID',
        totalAmount,
        totalCollie,
        totalWeightKg,
        notes: normalizeOptionalText(data.notes),
        notaNumber,
    };

    const transaction = getSanityClient().transaction().create(notaDoc);
    for (const row of rows) {
        transaction.create({
            _id: crypto.randomUUID(),
            _type: 'freightNotaItem',
            notaRef: notaId,
            doRef: row.doRef,
            doNumber: row.doNumber,
            vehiclePlate: row.vehiclePlate,
            date: row.date,
            noSJ: row.noSJ,
            dari: row.dari,
            tujuan: row.tujuan,
            barang: row.barang,
            collie: row.collie,
            beratKg: row.beratKg,
            tarip: row.tarip,
            uangRp: row.uangRp,
            ket: row.ket,
        });
    }

    await transaction.commit();
    void addAuditLog(session, 'CREATE', 'freight-notas', notaId, `Created freight-notas: ${notaNumber}`);
    return NextResponse.json({ data: notaDoc, id: notaId });
}

async function handleInvoiceCreate(session: Session, data: Record<string, unknown>) {
    const rawItems = Array.isArray(data.items) ? data.items : [];
    const items = rawItems.filter(isPlainObject);
    if (items.length === 0) {
        return NextResponse.json({ error: 'Item invoice wajib diisi' }, { status: 400 });
    }

    const totalAmount = typeof data.totalAmount === 'number' ? data.totalAmount : Number(data.totalAmount);
    if (!Number.isFinite(totalAmount) || totalAmount <= 0) {
        return NextResponse.json({ error: 'Total invoice tidak valid' }, { status: 400 });
    }

    const invoiceId = crypto.randomUUID();
    const invoiceNumber = await sanityGetNextNumber('invoice');
    const invoiceDoc = {
        _id: invoiceId,
        _type: 'invoice',
        ...data,
        invoiceNumber,
        status: 'UNPAID',
        totalAmount,
    };

    const transaction = getSanityClient().transaction().create(invoiceDoc);
    for (const item of items) {
        const subtotal = typeof item.subtotal === 'number' ? item.subtotal : Number(item.subtotal);
        const qty = typeof item.qty === 'number' ? item.qty : Number(item.qty);
        const price = typeof item.price === 'number' ? item.price : Number(item.price);
        if (!Number.isFinite(subtotal) || !Number.isFinite(qty) || !Number.isFinite(price)) {
            return NextResponse.json({ error: 'Ada item invoice yang tidak valid' }, { status: 400 });
        }

        transaction.create({
            _id: crypto.randomUUID(),
            _type: 'invoiceItem',
            invoiceRef: invoiceId,
            description: typeof item.description === 'string' ? item.description : '',
            qty,
            price,
            subtotal,
        });
    }

    await transaction.commit();
    void addAuditLog(session, 'CREATE', 'invoices', invoiceId, `Created invoices: ${invoiceNumber}`);
    return NextResponse.json({ data: invoiceDoc, id: invoiceId });
}

async function handleDriverBoronganCreate(session: Session, data: Record<string, unknown>) {
    let resolvedDriverRef = normalizeOptionalText(data.driverRef);
    const driverName = normalizeText(data.driverName);
    if (!driverName) {
        return NextResponse.json({ error: 'Nama supir borongan wajib diisi' }, { status: 400 });
    }

    const periodStart = normalizeText(data.periodStart) || new Date().toISOString().slice(0, 10);
    const periodEnd = normalizeText(data.periodEnd) || periodStart;
    if (periodEnd < periodStart) {
        return NextResponse.json({ error: 'Periode akhir borongan tidak boleh sebelum periode mulai' }, { status: 400 });
    }

    const rawRows = Array.isArray(data.items) ? data.items : Array.isArray(data.rows) ? data.rows : [];
    const rows = rawRows
        .filter(isPlainObject)
        .filter(row => !isDriverBoronganRowEmpty(row))
        .map<NormalizedDriverBoronganRow>(row => {
            const date = normalizeText(row.date);
            const doRef = normalizeOptionalText(row.doRef);
            const doNumber = normalizeOptionalText(row.doNumber);
            const noSJ = normalizeText(row.noSJ) || doNumber || '';
            const tujuan = normalizeText(row.tujuan);
            const beratKg = normalizeNumber(row.beratKg);
            const tarip = normalizeNumber(row.tarip);
            const collie = normalizeNumber(row.collie ?? 0);

            if (!date || !noSJ || !tujuan) {
                throw new Error('Baris borongan wajib punya tanggal, nomor SJ, dan tujuan');
            }
            if (!Number.isFinite(beratKg) || beratKg <= 0) {
                throw new Error('Berat pada baris borongan harus lebih besar dari 0');
            }
            if (!Number.isFinite(tarip) || tarip <= 0) {
                throw new Error('Tarip pada baris borongan harus lebih besar dari 0');
            }
            if (!Number.isFinite(collie) || collie < 0) {
                throw new Error('Collie pada baris borongan tidak valid');
            }

            return {
                doRef,
                doNumber,
                vehiclePlate: normalizeOptionalText(row.vehiclePlate),
                date,
                noSJ,
                tujuan,
                barang: normalizeOptionalText(row.barang),
                collie: collie > 0 ? collie : undefined,
                beratKg,
                tarip,
                uangRp: beratKg * tarip,
                ket: normalizeOptionalText(row.ket),
            };
        });

    if (rows.length === 0) {
        return NextResponse.json({ error: 'Minimal 1 baris borongan wajib diisi' }, { status: 400 });
    }

    const doRefs = rows.flatMap(row => (row.doRef ? [row.doRef] : []));
    const uniqueDoRefs = [...new Set(doRefs)];
    if (uniqueDoRefs.length !== doRefs.length) {
        return NextResponse.json({ error: 'DO yang sama tidak boleh dimasukkan dua kali dalam slip borongan' }, { status: 400 });
    }

    const deliveryOrders = uniqueDoRefs.length > 0
        ? await getSanityClient().fetch<Array<{
            _id: string;
            status?: string;
            doNumber?: string;
            vehiclePlate?: string;
            driverRef?: unknown;
        }>>(
            `*[_type == "deliveryOrder" && _id in $ids]{
                _id,
                status,
                doNumber,
                vehiclePlate,
                driverRef
            }`,
            { ids: uniqueDoRefs }
        )
        : [];

    if (deliveryOrders.length !== uniqueDoRefs.length) {
        return NextResponse.json({ error: 'Sebagian DO borongan tidak ditemukan' }, { status: 404 });
    }

    const deliveryOrderMap = new Map(deliveryOrders.map(item => [item._id, item]));
    for (const row of rows) {
        if (!row.doRef) continue;
        const deliveryOrder = deliveryOrderMap.get(row.doRef);
        if (!deliveryOrder) {
            return NextResponse.json({ error: 'DO borongan tidak ditemukan' }, { status: 404 });
        }
        if (deliveryOrder.status !== 'DELIVERED') {
            return NextResponse.json({ error: `DO ${deliveryOrder.doNumber || row.doRef} belum selesai dikirim` }, { status: 409 });
        }
        if (resolvedDriverRef) {
            const deliveryOrderDriverRef = extractRefId(deliveryOrder.driverRef);
            if (deliveryOrderDriverRef && deliveryOrderDriverRef !== resolvedDriverRef) {
                return NextResponse.json(
                    { error: `DO ${deliveryOrder.doNumber || deliveryOrder._id} bukan milik supir yang dipilih` },
                    { status: 409 }
                );
            }
        }
        row.doNumber = row.doNumber || deliveryOrder.doNumber;
        row.vehiclePlate = row.vehiclePlate || deliveryOrder.vehiclePlate;
    }

    if (uniqueDoRefs.length > 0) {
        const existingBoronganItems = await getSanityClient().fetch<Array<{ doRef?: string; doNumber?: string }>>(
            `*[_type == "driverBoronganItem" && doRef in $ids]{ doRef, doNumber }`,
            { ids: uniqueDoRefs }
        );
        if (existingBoronganItems.length > 0) {
            const duplicate = existingBoronganItems[0];
            return NextResponse.json(
                { error: `DO ${duplicate.doNumber || duplicate.doRef || ''} sudah tercantum di slip borongan lain` },
                { status: 409 }
            );
        }
    }

    const inferredDriverRefs = [...new Set(
        deliveryOrders
            .map(deliveryOrder => extractRefId(deliveryOrder.driverRef))
            .filter((ref): ref is string => Boolean(ref))
    )];
    if (inferredDriverRefs.length > 1) {
        return NextResponse.json(
            { error: 'DO yang dipilih berasal dari supir berbeda. Pisahkan per slip borongan.' },
            { status: 409 }
        );
    }

    const inferredDriverRef = inferredDriverRefs[0];
    if (resolvedDriverRef && inferredDriverRef && resolvedDriverRef !== inferredDriverRef) {
        return NextResponse.json(
            { error: 'Supir borongan tidak cocok dengan DO yang dipilih' },
            { status: 409 }
        );
    }
    if (!resolvedDriverRef && inferredDriverRef) {
        resolvedDriverRef = inferredDriverRef;
    }

    const totalAmount = rows.reduce((sum, row) => sum + row.uangRp, 0);
    const totalCollie = rows.reduce((sum, row) => sum + (row.collie || 0), 0);
    const totalWeightKg = rows.reduce((sum, row) => sum + row.beratKg, 0);
    if (totalAmount <= 0) {
        return NextResponse.json({ error: 'Total borongan harus lebih besar dari 0' }, { status: 400 });
    }

    const boronganId = crypto.randomUUID();
    const boronganNumber = await sanityGetNextNumber('borong');
    const boronganDoc = {
        _id: boronganId,
        _type: 'driverBorongan',
        driverRef: resolvedDriverRef,
        driverName,
        periodStart,
        periodEnd,
        status: 'UNPAID',
        totalAmount,
        totalCollie,
        totalWeightKg,
        notes: normalizeOptionalText(data.notes),
        boronganNumber,
    };

    const transaction = getSanityClient().transaction().create(boronganDoc);
    for (const row of rows) {
        transaction.create({
            _id: crypto.randomUUID(),
            _type: 'driverBoronganItem',
            boronganRef: boronganId,
            doRef: row.doRef,
            doNumber: row.doNumber,
            vehiclePlate: row.vehiclePlate,
            date: row.date,
            noSJ: row.noSJ,
            tujuan: row.tujuan,
            barang: row.barang,
            collie: row.collie,
            beratKg: row.beratKg,
            tarip: row.tarip,
            uangRp: row.uangRp,
            ket: row.ket,
        });
    }

    await transaction.commit();
    void addAuditLog(session, 'CREATE', 'driver-borongans', boronganId, `Created driver-borongans: ${boronganNumber}`);
    return NextResponse.json({ data: boronganDoc, id: boronganId });
}

async function handleFreightNotaDelete(session: Session, data: Record<string, unknown>) {
    const id = typeof data.id === 'string' ? data.id : '';
    if (!id) {
        return NextResponse.json({ error: 'Nota tidak valid' }, { status: 400 });
    }

    const nota = await sanityGetById<{ _id: string; notaNumber?: string }>(id);
    if (!nota) {
        return NextResponse.json({ error: 'Nota tidak ditemukan' }, { status: 404 });
    }

    const existingPayments = await getSanityClient().fetch<Array<{ _id: string }>>(
        `*[_type == "payment" && invoiceRef == $ref]{ _id }`,
        { ref: id }
    );
    if (existingPayments.length > 0) {
        return NextResponse.json({ error: 'Nota yang sudah punya pembayaran tidak boleh dihapus' }, { status: 409 });
    }

    const itemIds = await getSanityClient().fetch<string[]>(
        `*[_type == "freightNotaItem" && notaRef == $ref]._id`,
        { ref: id }
    );
    const transaction = getSanityClient().transaction();
    for (const itemId of itemIds) {
        transaction.delete(itemId);
    }
    transaction.delete(id);
    await transaction.commit();

    void addAuditLog(session, 'DELETE', 'freight-notas', id, `Deleted freight-notas ${nota.notaNumber || id}`);
    return NextResponse.json({ success: true });
}

async function handleDriverBoronganDelete(session: Session, data: Record<string, unknown>) {
    const id = typeof data.id === 'string' ? data.id : '';
    if (!id) {
        return NextResponse.json({ error: 'Borongan tidak valid' }, { status: 400 });
    }

    const borongan = await sanityGetById<{ _id: string; boronganNumber?: string; status?: string }>(id);
    if (!borongan) {
        return NextResponse.json({ error: 'Borongan tidak ditemukan' }, { status: 404 });
    }
    if (borongan.status === 'PAID') {
        return NextResponse.json({ error: 'Slip borongan yang sudah dibayar tidak boleh dihapus' }, { status: 409 });
    }

    const existingExpense = await getSanityClient().fetch<{ _id: string } | null>(
        `*[_type == "expense" && boronganRef == $ref][0]{ _id }`,
        { ref: id }
    );
    if (existingExpense) {
        return NextResponse.json({ error: 'Slip borongan yang sudah punya pengeluaran tidak boleh dihapus' }, { status: 409 });
    }

    const itemIds = await getSanityClient().fetch<string[]>(
        `*[_type == "driverBoronganItem" && boronganRef == $ref]._id`,
        { ref: id }
    );
    const transaction = getSanityClient().transaction();
    for (const itemId of itemIds) {
        transaction.delete(itemId);
    }
    transaction.delete(id);
    await transaction.commit();

    void addAuditLog(session, 'DELETE', 'driver-borongans', id, `Deleted driver-borongans ${borongan.boronganNumber || id}`);
    return NextResponse.json({ success: true });
}

async function handleOrderDelete(session: Session, data: Record<string, unknown>) {
    const id = typeof data.id === 'string' ? data.id : '';
    if (!id) {
        return NextResponse.json({ error: 'Order tidak valid' }, { status: 400 });
    }

    const order = await sanityGetById<{ _id: string; masterResi?: string }>(id);
    if (!order) {
        return NextResponse.json({ error: 'Order tidak ditemukan' }, { status: 404 });
    }

    const relatedDeliveryOrder = await getSanityClient().fetch<{ _id: string } | null>(
        `*[_type == "deliveryOrder" && orderRef == $ref][0]{ _id }`,
        { ref: id }
    );
    if (relatedDeliveryOrder) {
        return NextResponse.json({ error: 'Order yang sudah punya surat jalan tidak boleh dihapus' }, { status: 409 });
    }

    const relatedInvoice = await getSanityClient().fetch<{ _id: string } | null>(
        `*[_type == "invoice" && orderRef == $ref][0]{ _id }`,
        { ref: id }
    );
    if (relatedInvoice) {
        return NextResponse.json({ error: 'Order yang sudah punya invoice tidak boleh dihapus' }, { status: 409 });
    }

    const orderItemIds = await getSanityClient().fetch<string[]>(
        `*[_type == "orderItem" && orderRef == $ref]._id`,
        { ref: id }
    );
    const transaction = getSanityClient().transaction();
    for (const orderItemId of orderItemIds) {
        transaction.delete(orderItemId);
    }
    transaction.delete(id);
    await transaction.commit();

    void addAuditLog(session, 'DELETE', 'orders', id, `Deleted orders ${order.masterResi || id}`);
    return NextResponse.json({ success: true });
}

async function handleCustomerDelete(session: Session, data: Record<string, unknown>) {
    const id = typeof data.id === 'string' ? data.id : '';
    if (!id) {
        return NextResponse.json({ error: 'Customer tidak valid' }, { status: 400 });
    }

    const customer = await sanityGetById<{ _id: string; name?: string }>(id);
    if (!customer) {
        return NextResponse.json({ error: 'Customer tidak ditemukan' }, { status: 404 });
    }

    const relatedOrder = await getSanityClient().fetch<{ _id: string } | null>(
        `*[_type == "order" && customerRef == $ref][0]{ _id }`,
        { ref: id }
    );
    if (relatedOrder) {
        return NextResponse.json({ error: 'Customer yang sudah dipakai pada order tidak boleh dihapus' }, { status: 409 });
    }

    const relatedFreightNota = await getSanityClient().fetch<{ _id: string } | null>(
        `*[_type == "freightNota" && customerRef == $ref][0]{ _id }`,
        { ref: id }
    );
    if (relatedFreightNota) {
        return NextResponse.json({ error: 'Customer yang sudah dipakai pada nota tidak boleh dihapus' }, { status: 409 });
    }

    const relatedInvoice = await getSanityClient().fetch<{ _id: string } | null>(
        `*[_type == "invoice" && customerRef == $ref][0]{ _id }`,
        { ref: id }
    );
    if (relatedInvoice) {
        return NextResponse.json({ error: 'Customer yang sudah dipakai pada invoice tidak boleh dihapus' }, { status: 409 });
    }

    await sanityDelete(id);
    void addAuditLog(session, 'DELETE', 'customers', id, `Deleted customers ${customer.name || id}`);
    return NextResponse.json({ success: true });
}

async function handleServiceDelete(session: Session, data: Record<string, unknown>) {
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

async function handleExpenseCategoryDelete(session: Session, data: Record<string, unknown>) {
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

async function handleDriverDelete(session: Session, data: Record<string, unknown>) {
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

async function handleVehicleDelete(session: Session, data: Record<string, unknown>) {
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

function isProtectedLedgerEntity(entity: string) {
    return entity === 'payments' || entity === 'incomes' || entity === 'expenses' || entity === 'bank-transactions';
}

function isWorkflowManagedCreateEntity(entity: string) {
    return (
        entity === 'orders' ||
        entity === 'delivery-orders' ||
        entity === 'invoices' ||
        entity === 'freight-notas' ||
        entity === 'driver-borongans' ||
        entity === 'incomes' ||
        entity === 'bank-transactions'
    );
}

function isWorkflowManagedDeleteEntity(entity: string) {
    return (
        entity === 'delivery-orders' ||
        entity === 'delivery-order-items' ||
        entity === 'order-items' ||
        entity === 'invoice-items' ||
        entity === 'freight-nota-items' ||
        entity === 'driver-borogan-items' ||
        entity === 'tracking-logs'
    );
}

async function handleBoronganPayment(data: Record<string, unknown>) {
    const boronganId = typeof data.id === 'string' ? data.id : '';
    if (!boronganId) {
        return NextResponse.json({ error: 'Borongan tidak valid' }, { status: 400 });
    }

    const borongan = await sanityGetById<{
        _id: string;
        boronganNumber: string;
        driverName: string;
        totalAmount: number;
        status: string;
    }>(boronganId);
    if (!borongan) {
        return NextResponse.json({ error: 'Borongan tidak ditemukan' }, { status: 404 });
    }
    if (borongan.status === 'PAID') {
        return NextResponse.json({ error: 'Borongan ini sudah dibayar' }, { status: 409 });
    }

    const existingExpense = await getSanityClient().fetch<{ _id: string } | null>(
        `*[_type == "expense" && boronganRef == $ref][0]{ _id }`,
        { ref: boronganId }
    );
    if (existingExpense) {
        return NextResponse.json({ error: 'Pengeluaran borongan sudah pernah dicatat' }, { status: 409 });
    }

    const amount = typeof data.amount === 'number' ? data.amount : Number(data.amount ?? borongan.totalAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
        return NextResponse.json({ error: 'Nominal pembayaran borongan tidak valid' }, { status: 400 });
    }
    if (amount !== borongan.totalAmount) {
        return NextResponse.json({ error: 'Pembayaran borongan harus sama dengan total borongan' }, { status: 400 });
    }

    const paymentMethod = typeof data.paymentMethod === 'string' ? data.paymentMethod : 'CASH';
    const selectedAccountRef = typeof data.bankAccountRef === 'string' && data.bankAccountRef ? data.bankAccountRef : undefined;
    if (paymentMethod === 'TRANSFER' && !selectedAccountRef) {
        return NextResponse.json({ error: 'Rekening bank wajib dipilih untuk transfer' }, { status: 400 });
    }

    let bankAccount: BankAccountSummary | null = null;
    if (selectedAccountRef) {
        bankAccount = await getLedgerAccount(selectedAccountRef);
        if (!bankAccount) {
            return NextResponse.json({ error: 'Rekening bank tidak ditemukan' }, { status: 404 });
        }
    } else if (paymentMethod === 'CASH') {
        bankAccount = await ensureCashAccount();
    }
    if (paymentMethod === 'TRANSFER' && bankAccount?.accountType === 'CASH') {
        return NextResponse.json({ error: 'Metode transfer harus memakai rekening bank, bukan akun Kas Tunai' }, { status: 400 });
    }
    const bankAccountRef = bankAccount?._id;

    const paidDate =
        typeof data.date === 'string' && data.date
            ? data.date
            : new Date().toISOString().slice(0, 10);
    const note = typeof data.note === 'string' && data.note.trim() ? data.note.trim() : undefined;

    const expense = await sanityCreate({
        _type: 'expense',
        categoryRef: 'driver-borongan',
        categoryName: 'Borongan Supir',
        date: paidDate,
        amount,
        description: `Upah borongan supir ${borongan.driverName} - ${borongan.boronganNumber}`,
        note,
        privacyLevel: 'internal',
        paymentMethod,
        bankAccountRef,
        bankAccountName: bankAccount?.bankName,
        boronganRef: boronganId,
    });

    if (bankAccount && bankAccountRef) {
        const newBalance = (bankAccount.currentBalance || 0) - amount;
        await sanityCreate({
            _type: 'bankTransaction',
            bankAccountRef,
            bankAccountName: bankAccount.bankName,
            type: 'DEBIT',
            amount,
            date: paidDate,
            description: `Pembayaran borongan ${borongan.boronganNumber}`,
            balanceAfter: newBalance,
            relatedExpenseRef: expense._id,
        });
        await sanityUpdate(bankAccountRef, { currentBalance: newBalance });
    }

    const updated = await sanityUpdate(boronganId, {
        status: 'PAID',
        paidDate,
        paidMethod: paymentMethod,
        paidBankRef: bankAccountRef,
    });

    return NextResponse.json({ data: updated, expenseId: expense._id });
}

function toCategoryRef(categoryName: string) {
    const slug = categoryName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    return `driver-voucher-${slug || 'misc'}`;
}

async function getDriverVoucherState(voucherId: string) {
    const voucher = await sanityGetById<{
        _id: string;
        bonNumber: string;
        status: string;
        cashGiven: number;
        issuedDate: string;
        issueBankRef?: string;
        issueBankName?: string;
        vehicleRef?: string;
    }>(voucherId);

    if (!voucher) {
        return { error: NextResponse.json({ error: 'Bon supir tidak ditemukan' }, { status: 404 }) };
    }

    const items = await getSanityClient().fetch<Array<{ _id: string; category: string; description?: string; amount: number }>>(
        `*[_type == "driverVoucherItem" && voucherRef == $ref] | order(_createdAt asc){ _id, category, description, amount }`,
        { ref: voucherId }
    );

    return { voucher, items };
}

async function handleDriverVoucherCreate(
    session: Pick<Session, '_id' | 'name'>,
    data: Record<string, unknown>
) {
    const cashGiven = typeof data.cashGiven === 'number' ? data.cashGiven : Number(data.cashGiven);
    if (!Number.isFinite(cashGiven) || cashGiven <= 0) {
        return NextResponse.json({ error: 'Nominal bon supir tidak valid' }, { status: 400 });
    }

    const driverRef = typeof data.driverRef === 'string' ? data.driverRef : '';
    if (!driverRef) {
        return NextResponse.json({ error: 'Supir wajib dipilih' }, { status: 400 });
    }

    const issueBankRef = typeof data.issueBankRef === 'string' ? data.issueBankRef : '';
    if (!issueBankRef) {
        return NextResponse.json({ error: 'Rekening sumber bon wajib dipilih' }, { status: 400 });
    }

    const issueBank = await sanityGetById<BankAccountSummary>(issueBankRef);
    if (!issueBank) {
        return NextResponse.json({ error: 'Rekening sumber bon tidak ditemukan' }, { status: 404 });
    }

    const issueDate =
        typeof data.issuedDate === 'string' && data.issuedDate
            ? data.issuedDate
            : new Date().toISOString().slice(0, 10);
    const bonNumber = await sanityGetNextNumber('bon');
    const voucherId = crypto.randomUUID();
    const newBalance = (issueBank.currentBalance || 0) - cashGiven;

    const voucherDoc = {
        _id: voucherId,
        _type: 'driverVoucher',
        ...data,
        bonNumber,
        issuedDate: issueDate,
        cashGiven,
        issueBankRef,
        issueBankName: issueBank.bankName,
        totalSpent: 0,
        balance: cashGiven,
        status: 'ISSUED',
    };

    const transaction = getSanityClient()
        .transaction()
        .create(voucherDoc)
        .create({
            _type: 'bankTransaction',
            bankAccountRef: issueBankRef,
            bankAccountName: issueBank.bankName,
            type: 'DEBIT',
            amount: cashGiven,
            date: issueDate,
            description: `Pencairan bon supir ${bonNumber}`,
            balanceAfter: newBalance,
            relatedVoucherRef: voucherId,
        })
        .patch(issueBankRef, { set: { currentBalance: newBalance } });

    await transaction.commit();

    void addAuditLog(session, 'CREATE', 'driver-vouchers', voucherId, `Bon supir diterbitkan: ${bonNumber}`);
    return NextResponse.json({ data: voucherDoc, id: voucherId });
}

async function handleDriverVoucherItemCreate(data: Record<string, unknown>) {
    const voucherRef = typeof data.voucherRef === 'string' ? data.voucherRef : '';
    if (!voucherRef) {
        return NextResponse.json({ error: 'Bon supir tidak valid' }, { status: 400 });
    }

    const amount = typeof data.amount === 'number' ? data.amount : Number(data.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
        return NextResponse.json({ error: 'Nominal item tidak valid' }, { status: 400 });
    }

    const state = await getDriverVoucherState(voucherRef);
    if ('error' in state) return state.error;
    if (state.voucher.status === 'SETTLED') {
        return NextResponse.json({ error: 'Bon yang sudah settle tidak bisa diubah' }, { status: 409 });
    }

    const itemId = crypto.randomUUID();
    const nextTotal = state.items.reduce((sum, item) => sum + item.amount, 0) + amount;
    const nextBalance = (state.voucher.cashGiven || 0) - nextTotal;
    const itemDoc = {
        _id: itemId,
        _type: 'driverVoucherItem',
        voucherRef,
        category: typeof data.category === 'string' && data.category.trim() ? data.category.trim() : 'Lain-lain',
        description: typeof data.description === 'string' ? data.description.trim() : '',
        amount,
    };

    await getSanityClient()
        .transaction()
        .create(itemDoc)
        .patch(voucherRef, {
            set: {
                totalSpent: nextTotal,
                balance: nextBalance,
            },
        })
        .commit();

    return NextResponse.json({
        data: itemDoc,
        voucher: {
            ...state.voucher,
            totalSpent: nextTotal,
            balance: nextBalance,
        },
    });
}

async function handleDriverVoucherItemDelete(data: Record<string, unknown>) {
    const itemId = typeof data.id === 'string' ? data.id : '';
    if (!itemId) {
        return NextResponse.json({ error: 'Item bon tidak valid' }, { status: 400 });
    }

    const item = await sanityGetById<{ _id: string; voucherRef: string }>(itemId);
    if (!item?.voucherRef) {
        return NextResponse.json({ error: 'Item bon tidak ditemukan' }, { status: 404 });
    }

    const state = await getDriverVoucherState(item.voucherRef);
    if ('error' in state) return state.error;
    if (state.voucher.status === 'SETTLED') {
        return NextResponse.json({ error: 'Bon yang sudah settle tidak bisa diubah' }, { status: 409 });
    }

    const nextTotal = state.items
        .filter(existing => existing._id !== itemId)
        .reduce((sum, existing) => sum + existing.amount, 0);
    const nextBalance = (state.voucher.cashGiven || 0) - nextTotal;

    await getSanityClient()
        .transaction()
        .delete(itemId)
        .patch(item.voucherRef, {
            set: {
                totalSpent: nextTotal,
                balance: nextBalance,
            },
        })
        .commit();

    return NextResponse.json({
        success: true,
        voucher: {
            ...state.voucher,
            totalSpent: nextTotal,
            balance: nextBalance,
        },
    });
}

async function handleDriverVoucherSettlement(
    session: Pick<Session, '_id' | 'name'>,
    data: Record<string, unknown>
) {
    const voucherId = typeof data.id === 'string' ? data.id : '';
    if (!voucherId) {
        return NextResponse.json({ error: 'Bon supir tidak valid' }, { status: 400 });
    }

    const state = await getDriverVoucherState(voucherId);
    if ('error' in state) return state.error;

    if (state.voucher.status === 'SETTLED') {
        return NextResponse.json({ error: 'Bon supir ini sudah settle' }, { status: 409 });
    }
    if (state.items.length === 0) {
        return NextResponse.json({ error: 'Tambahkan minimal satu item pengeluaran sebelum settle' }, { status: 400 });
    }

    const existingExpense = await getSanityClient().fetch<{ _id: string } | null>(
        `*[_type == "expense" && voucherRef == $ref][0]{ _id }`,
        { ref: voucherId }
    );
    if (existingExpense) {
        return NextResponse.json({ error: 'Bon supir ini sudah pernah diposting ke pengeluaran' }, { status: 409 });
    }

    const settledDate =
        typeof data.date === 'string' && data.date
            ? data.date
            : new Date().toISOString().slice(0, 10);
    const totalSpent = state.items.reduce((sum, item) => sum + item.amount, 0);
    const balance = (state.voucher.cashGiven || 0) - totalSpent;

    const settlementBankRef =
        typeof data.settlementBankRef === 'string' && data.settlementBankRef
            ? data.settlementBankRef
            : state.voucher.issueBankRef || '';
    let settlementBank: BankAccountSummary | null = null;

    if (balance !== 0) {
        if (!settlementBankRef) {
            return NextResponse.json({ error: 'Rekening settlement wajib dipilih untuk selisih bon' }, { status: 400 });
        }

        settlementBank = await sanityGetById<BankAccountSummary>(settlementBankRef);
        if (!settlementBank) {
            return NextResponse.json({ error: 'Rekening settlement tidak ditemukan' }, { status: 404 });
        }
    }

    const transaction = getSanityClient().transaction();
    for (const item of state.items) {
        transaction.create({
            _id: crypto.randomUUID(),
            _type: 'expense',
            categoryRef: toCategoryRef(item.category),
            categoryName: item.category,
            date: settledDate,
            amount: item.amount,
            description: item.description || `Pengeluaran bon supir ${state.voucher.bonNumber}`,
            note: `Bon supir ${state.voucher.bonNumber}`,
            privacyLevel: 'internal',
            relatedVehicleRef: state.voucher.vehicleRef,
            voucherRef: voucherId,
        });
    }

    if (settlementBank && settlementBankRef) {
        const adjustmentAmount = Math.abs(balance);
        const nextBankBalance =
            balance > 0
                ? (settlementBank.currentBalance || 0) + adjustmentAmount
                : (settlementBank.currentBalance || 0) - adjustmentAmount;
        transaction
            .create({
                _id: crypto.randomUUID(),
                _type: 'bankTransaction',
                bankAccountRef: settlementBankRef,
                bankAccountName: settlementBank.bankName,
                type: balance > 0 ? 'CREDIT' : 'DEBIT',
                amount: adjustmentAmount,
                date: settledDate,
                description:
                    balance > 0
                        ? `Pengembalian sisa bon ${state.voucher.bonNumber}`
                        : `Kekurangan bon ${state.voucher.bonNumber}`,
                balanceAfter: nextBankBalance,
                relatedVoucherRef: voucherId,
            })
            .patch(settlementBankRef, {
                set: { currentBalance: nextBankBalance },
            });
    }

    transaction.patch(voucherId, {
        set: {
            status: 'SETTLED',
            settledDate,
            settledBy: session.name,
            totalSpent,
            balance,
            settlementBankRef: settlementBankRef || undefined,
            settlementBankName: settlementBank?.bankName,
        },
    });

    await transaction.commit();

    const updatedVoucher = {
        ...state.voucher,
        status: 'SETTLED',
        settledDate,
        settledBy: session.name,
        totalSpent,
        balance,
        settlementBankRef: settlementBankRef || undefined,
        settlementBankName: settlementBank?.bankName,
    };

    void addAuditLog(session, 'UPDATE', 'driver-vouchers', voucherId, `Bon supir settle: ${state.voucher.bonNumber}`);
    return NextResponse.json({ data: updatedVoucher });
}

async function handleDriverVoucherIssueRepair(
    session: Pick<Session, '_id' | 'name'>,
    data: Record<string, unknown>
) {
    const voucherId = typeof data.id === 'string' ? data.id : '';
    const issueBankRef = typeof data.issueBankRef === 'string' ? data.issueBankRef : '';
    if (!voucherId || !issueBankRef) {
        return NextResponse.json({ error: 'Data rekonsiliasi bon tidak lengkap' }, { status: 400 });
    }

    const voucher = await sanityGetById<{
        _id: string;
        bonNumber: string;
        issuedDate: string;
        cashGiven: number;
        issueBankRef?: string;
    }>(voucherId);
    if (!voucher) {
        return NextResponse.json({ error: 'Bon supir tidak ditemukan' }, { status: 404 });
    }
    if (voucher.issueBankRef) {
        return NextResponse.json({ error: 'Bon ini sudah punya rekening sumber' }, { status: 409 });
    }

    const existingTx = await getSanityClient().fetch<{ _id: string } | null>(
        `*[_type == "bankTransaction" && relatedVoucherRef == $ref][0]{ _id }`,
        { ref: voucherId }
    );
    if (existingTx) {
        return NextResponse.json({ error: 'Bon ini sudah punya mutasi bank terkait' }, { status: 409 });
    }

    const bank = await sanityGetById<BankAccountSummary>(issueBankRef);
    if (!bank) {
        return NextResponse.json({ error: 'Rekening sumber tidak ditemukan' }, { status: 404 });
    }

    const newBalance = (bank.currentBalance || 0) - (voucher.cashGiven || 0);
    await getSanityClient()
        .transaction()
        .create({
            _id: crypto.randomUUID(),
            _type: 'bankTransaction',
            bankAccountRef: issueBankRef,
            bankAccountName: bank.bankName,
            type: 'DEBIT',
            amount: voucher.cashGiven || 0,
            date: voucher.issuedDate,
            description: `Rekonsiliasi pencairan bon ${voucher.bonNumber}`,
            balanceAfter: newBalance,
            relatedVoucherRef: voucherId,
        })
        .patch(issueBankRef, {
            set: { currentBalance: newBalance },
        })
        .patch(voucherId, {
            set: {
                issueBankRef,
                issueBankName: bank.bankName,
            },
        })
        .commit();

    const updatedVoucher = {
        ...voucher,
        issueBankRef,
        issueBankName: bank.bankName,
    };

    void addAuditLog(session, 'UPDATE', 'driver-vouchers', voucherId, `Rekonsiliasi pencairan bon: ${voucher.bonNumber}`);
    return NextResponse.json({ data: updatedVoucher });
}

export async function GET(request: Request) {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const entity = searchParams.get('entity');
    const id = searchParams.get('id');
    const filter = searchParams.get('filter');

    if (entity === 'dashboard-summary') {
        try {
            const summary = await getDashboardSummary(session);
            return NextResponse.json({ data: summary });
        } catch (err) {
            console.error('API GET Dashboard Summary Error:', err);
            return NextResponse.json({ error: 'Server error' }, { status: 500 });
        }
    }

    if (!validateEntity(entity)) {
        return NextResponse.json({ error: 'Invalid entity type' }, { status: 400 });
    }

    if (entity === 'users' && session.role !== 'OWNER' && id !== session._id) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    if (OWNER_ONLY_READ_ENTITIES.has(entity) && session.role !== 'OWNER') {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const docType = SANITY_TYPE_MAP[entity];

    try {
        if (entity === 'company') {
            const profile = await sanityGetCompanyProfile();
            return NextResponse.json({ data: profile });
        }

        if (entity === 'bank-accounts') {
            await ensureCashAccount();
        }

        if (id) {
            let item = await sanityGetById(id);
            if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404 });
            if ((item as { _type?: string })._type !== docType) {
                return NextResponse.json({ error: 'Not found' }, { status: 404 });
            }

            if (entity === 'vehicles' && session.role !== 'OWNER') {
                item = sanitizeVehicleForRole(item as unknown as Vehicle, session.role) as unknown as Record<string, unknown>;
            }
            return NextResponse.json({ data: item });
        }

        let items: Record<string, unknown>[] = [];

        if (filter) {
            try {
                const filterObj = JSON.parse(filter) as Record<string, unknown>;
                items = await sanityGetByFilter(docType, filterObj);
            } catch {
                items = await sanityGetAll(docType);
            }
        } else {
            items = await sanityGetAll(docType);
        }

        if (entity === 'expenses') {
            items = filterExpensesByRole(items as unknown as Expense[], session.role) as unknown as Record<string, unknown>[];
        }

        if (entity === 'vehicles' && session.role !== 'OWNER') {
            items = (items as unknown as Vehicle[]).map(item => sanitizeVehicleForRole(item, session.role)) as unknown as Record<string, unknown>[];
        }

        return NextResponse.json({ data: items });
    } catch (err) {
        console.error('API GET Error:', err);
        return NextResponse.json({ error: 'Server error' }, { status: 500 });
    }
}

export async function POST(request: Request) {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    try {
        const body = await request.json();
        const entity = typeof body.entity === 'string' ? body.entity : null;
        const action =
            typeof body.action === 'string'
                ? body.action
                : typeof body.data?.action === 'string'
                    ? body.data.action
                    : undefined;
        const data = isPlainObject(body.data) ? body.data : {};

        if (!validateEntity(entity)) {
            return NextResponse.json({ error: 'Invalid entity type' }, { status: 400 });
        }

        if (LEGACY_READ_ONLY_ENTITIES.has(entity)) {
            return NextResponse.json(
                { error: 'Invoice legacy sudah dibekukan. Gunakan Nota Ongkos untuk workflow tagihan aktif.' },
                { status: 409 }
            );
        }

        if (entity === 'users') {
            if (action === 'delete') {
                return NextResponse.json({ error: 'User tidak boleh dihapus permanen' }, { status: 409 });
            }

            if (session.role !== 'OWNER' && action !== 'update') {
                return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
            }
        }

        const forbidden = forbidOwnerOnlyEntity(session, entity);
        if (forbidden) return forbidden;

        const docType = SANITY_TYPE_MAP[entity];

        if (action === 'update') {
            const id = typeof data.id === 'string' ? data.id : '';
            const updates = isPlainObject(data.updates) ? data.updates : null;
            if (!id || !updates) {
                return NextResponse.json({ error: 'Invalid update payload' }, { status: 400 });
            }

            if (isProtectedLedgerEntity(entity)) {
                return NextResponse.json({ error: 'Entri keuangan yang sudah terposting tidak boleh diubah lewat API umum' }, { status: 409 });
            }

            if (entity === 'driver-vouchers') {
                const existingVoucher = await sanityGetById<{ status?: string }>(id);
                if (!existingVoucher) {
                    return NextResponse.json({ error: 'Bon supir tidak ditemukan' }, { status: 404 });
                }
                if (existingVoucher.status === 'SETTLED') {
                    return NextResponse.json({ error: 'Bon yang sudah settle tidak bisa diubah' }, { status: 409 });
                }

                const protectedFields = new Set([
                    'bonNumber',
                    'cashGiven',
                    'issueBankRef',
                    'issueBankName',
                    'status',
                    'settledDate',
                    'settledBy',
                    'settlementBankRef',
                    'settlementBankName',
                ]);
                if (Object.keys(updates).some(key => protectedFields.has(key))) {
                    return NextResponse.json({ error: 'Field bon supir sensitif harus lewat workflow server' }, { status: 400 });
                }
            }

            if (entity === 'incidents' && typeof updates.status === 'string') {
                return NextResponse.json({ error: 'Status insiden harus lewat workflow server' }, { status: 400 });
            }

            if (entity === 'delivery-orders' && typeof updates.status === 'string') {
                return NextResponse.json({ error: 'Status surat jalan harus lewat workflow server' }, { status: 400 });
            }

            if (entity === 'maintenances' && typeof updates.status === 'string') {
                const existingMaintenance = await sanityGetById<{ status?: string }>(id);
                if (!existingMaintenance) {
                    return NextResponse.json({ error: 'Maintenance tidak ditemukan' }, { status: 404 });
                }

                if (existingMaintenance.status !== 'SCHEDULED') {
                    return NextResponse.json({ error: 'Maintenance yang sudah diproses tidak bisa diubah lagi' }, { status: 409 });
                }

                if (!['DONE', 'SKIPPED'].includes(updates.status)) {
                    return NextResponse.json({ error: 'Status maintenance tidak valid' }, { status: 400 });
                }

                if (typeof updates.completedDate !== 'string' || !updates.completedDate) {
                    updates.completedDate = new Date().toISOString().slice(0, 10);
                }
            }

            if (entity === 'tire-events') {
                const existingTire = await sanityGetById<Record<string, unknown>>(id);
                if (!existingTire) {
                    return NextResponse.json({ error: 'Catatan ban tidak ditemukan' }, { status: 404 });
                }
                const normalizedTireUpdates = await normalizeTireEventPayload({ ...existingTire, ...updates }, id);
                const updated = await sanityUpdate(id, normalizedTireUpdates);
                void addAuditLog(session, 'UPDATE', entity, id, `Updated ${entity}: ${JSON.stringify(normalizedTireUpdates).slice(0, 200)}`);
                return NextResponse.json({ data: updated });
            }

            if (entity === 'bank-accounts') {
                if ('currentBalance' in updates || 'initialBalance' in updates) {
                    return NextResponse.json({ error: 'Saldo rekening tidak boleh diubah manual lewat API umum' }, { status: 409 });
                }

                const existingAccount = await sanityGetById<BankAccountSummary>(id);
                if (!existingAccount) {
                    return NextResponse.json({ error: 'Rekening tidak ditemukan' }, { status: 404 });
                }
                if (existingAccount.systemKey === CASH_ACCOUNT_SYSTEM_KEY) {
                    if ('active' in updates && updates.active === false) {
                        return NextResponse.json({ error: 'Akun Kas Tunai sistem tidak boleh dinonaktifkan' }, { status: 409 });
                    }
                    if ('bankName' in updates || 'accountNumber' in updates || 'accountHolder' in updates || 'accountType' in updates || 'systemKey' in updates) {
                        return NextResponse.json({ error: 'Identitas akun Kas Tunai sistem tidak boleh diubah manual' }, { status: 409 });
                    }
                }
            }

            const normalizedUpdates =
                entity === 'users'
                    ? await normalizeUserUpdates(session, id, updates, data.currentPassword)
                    : entity === 'services'
                        ? await normalizeServicePayload(updates, { partial: true, excludeId: id })
                        : entity === 'expense-categories'
                            ? await normalizeExpenseCategoryPayload(updates, { partial: true, excludeId: id })
                            : entity === 'drivers'
                                ? await normalizeDriverPayload(updates, { partial: true, excludeId: id })
                                : entity === 'vehicles'
                                    ? await normalizeVehiclePayload(session, updates, { partial: true, excludeId: id })
                    : updates;

            const updated = await sanityUpdate(id, normalizedUpdates);
            if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 });

            if (entity === 'users' && id === session._id) {
                const nextSessionToken = await createSession(updated as unknown as User);
                await setSessionCookie(nextSessionToken);
            }

            void addAuditLog(session, 'UPDATE', entity, id, `Updated ${entity}: ${JSON.stringify(normalizedUpdates).slice(0, 200)}`);

            if (entity === 'order-items' && typeof normalizedUpdates.status === 'string') {
                const orderItem = updated as { orderRef?: unknown };
                const orderRef = extractRefId(orderItem.orderRef);
                if (orderRef) {
                    await syncOrderStatusFromItems(orderRef, session);
                }
            }

            if (entity === 'delivery-orders' && typeof normalizedUpdates.status === 'string') {
                const doDoc = updated as { orderRef?: unknown };
                const orderRef = extractRefId(doDoc.orderRef);
                if (orderRef) {
                    await syncOrderStatusFromItems(orderRef, session);
                }
            }

            return NextResponse.json({ data: updated });
        }

        if (action === 'delete') {
            if (entity === 'driver-voucher-items') {
                return handleDriverVoucherItemDelete(data);
            }

            if (isProtectedLedgerEntity(entity)) {
                return NextResponse.json({ error: 'Entri keuangan yang sudah terposting tidak boleh dihapus lewat API umum' }, { status: 409 });
            }

            if (isWorkflowManagedDeleteEntity(entity)) {
                return NextResponse.json({ error: 'Dokumen turunan workflow tidak boleh dihapus langsung lewat API umum' }, { status: 409 });
            }

            if (entity === 'orders') {
                return handleOrderDelete(session, data);
            }

            if (entity === 'customers') {
                return handleCustomerDelete(session, data);
            }

            if (entity === 'services') {
                return handleServiceDelete(session, data);
            }

            if (entity === 'expense-categories') {
                return handleExpenseCategoryDelete(session, data);
            }

            if (entity === 'drivers') {
                return handleDriverDelete(session, data);
            }

            if (entity === 'vehicles') {
                return handleVehicleDelete(session, data);
            }

            if (entity === 'freight-notas') {
                return handleFreightNotaDelete(session, data);
            }

            if (entity === 'driver-borongans') {
                return handleDriverBoronganDelete(session, data);
            }

            const id = typeof data.id === 'string' ? data.id : '';
            if (!id) {
                return NextResponse.json({ error: 'Invalid delete payload' }, { status: 400 });
            }

            await sanityDelete(id);
            void addAuditLog(session, 'DELETE', entity, id, `Deleted ${entity} ${id}`);
            return NextResponse.json({ success: true });
        }

        if (entity === 'driver-borongans' && action === 'mark-paid') {
            return handleBoronganPayment(data);
        }

        if (entity === 'incidents' && action === 'set-status') {
            return handleIncidentStatusUpdate(session, data);
        }

        if (entity === 'orders' && action === 'create-with-items') {
            return handleOrderCreate(session, data);
        }

        if (entity === 'delivery-orders' && action === 'create-with-items') {
            return handleDeliveryOrderCreate(session, data);
        }

        if (entity === 'freight-notas' && action === 'create-with-items') {
            return handleFreightNotaCreate(session, data);
        }

        if (entity === 'invoices' && action === 'create-with-items') {
            return handleInvoiceCreate(session, data);
        }

        if (entity === 'delivery-orders' && action === 'set-status') {
            return handleDeliveryOrderStatusUpdate(session, data);
        }

        if (entity === 'driver-borongans' && action === 'create-with-items') {
            return handleDriverBoronganCreate(session, data);
        }

        if (entity === 'driver-vouchers' && action === 'settle') {
            return handleDriverVoucherSettlement(session, data);
        }

        if (entity === 'driver-vouchers' && action === 'repair-issue-ledger') {
            return handleDriverVoucherIssueRepair(session, data);
        }

        if (entity === 'company') {
            const existing = await sanityGetCompanyProfile();
            if (existing?._id) {
                const updated = await sanityUpdate(existing._id, data);
                void addAuditLog(session, 'UPDATE', 'companyProfile', existing._id, 'Company profile updated');
                return NextResponse.json({ data: updated });
            }

            const created = await sanityCreate({ _type: 'companyProfile', ...data });
            return NextResponse.json({ data: created });
        }

        if (entity === 'bank-transactions' && action === 'transfer') {
            return handleBankTransfer(data);
        }

        if (entity === 'driver-vouchers') {
            return handleDriverVoucherCreate(session, data);
        }

        if (entity === 'driver-voucher-items') {
            return handleDriverVoucherItemCreate(data);
        }

        if (entity === 'incidents') {
            return handleIncidentCreate(session, data);
        }

        if (isWorkflowManagedCreateEntity(entity)) {
            return NextResponse.json({ error: 'Dokumen ini harus dibuat lewat workflow server yang sesuai' }, { status: 409 });
        }

        const newDoc: { _type: string; [key: string]: unknown } = { _type: docType, ...data };

        if (entity === 'delivery-order-items') {
            const deliveryOrderRef = typeof data.deliveryOrderRef === 'string' ? data.deliveryOrderRef : '';
            const orderItemRef = typeof data.orderItemRef === 'string' ? data.orderItemRef : '';
            if (!deliveryOrderRef || !orderItemRef) {
                return NextResponse.json({ error: 'Relasi DO item tidak valid' }, { status: 400 });
            }

            const deliveryOrder = await sanityGetById<{ _id: string; status?: string }>(deliveryOrderRef);
            if (!deliveryOrder) {
                return NextResponse.json({ error: 'Surat jalan tidak ditemukan' }, { status: 404 });
            }
            if (deliveryOrder.status === 'CANCELLED') {
                return NextResponse.json({ error: 'Tidak bisa menambah item ke surat jalan yang dibatalkan' }, { status: 409 });
            }

            const orderItem = await sanityGetById<{ _id: string }>(orderItemRef);
            if (!orderItem) {
                return NextResponse.json({ error: 'Item order tidak ditemukan' }, { status: 404 });
            }

            const activeAssignment = await getSanityClient().fetch<{ _id: string } | null>(
                `*[
                    _type == "deliveryOrderItem" &&
                    orderItemRef == $orderItemRef &&
                    deliveryOrderRef != $deliveryOrderRef &&
                    defined(*[_type == "deliveryOrder" && _id == ^.deliveryOrderRef && status != "CANCELLED"][0]._id)
                ][0]{ _id }`,
                { orderItemRef, deliveryOrderRef }
            );
            if (activeAssignment) {
                return NextResponse.json({ error: 'Item order sudah terikat ke surat jalan aktif lain' }, { status: 409 });
            }
        }

        if (entity === 'orders') {
            newDoc.masterResi = await sanityGetNextNumber('resi');
            newDoc.status = 'OPEN';
            newDoc.createdAt = new Date().toISOString();
            newDoc.createdBy = session._id;
        }

        if (entity === 'delivery-orders') {
            newDoc.doNumber = await sanityGetNextNumber('do');
            newDoc.status = 'CREATED';
        }

        if (entity === 'invoices') {
            newDoc.invoiceNumber = await sanityGetNextNumber('invoice');
            newDoc.status = 'UNPAID';
        }

        if (entity === 'freight-notas') {
            newDoc.notaNumber = await sanityGetNextNumber('nota');
            newDoc.status = 'UNPAID';
        }

        if (entity === 'driver-borongans') {
            newDoc.boronganNumber = await sanityGetNextNumber('borong');
            newDoc.status = 'UNPAID';
        }

        if (entity === 'maintenances') {
            const normalizedMaintenance = normalizeMaintenanceCreatePayload(data);
            Object.assign(newDoc, normalizedMaintenance);
            newDoc.status = 'SCHEDULED';
        }

        if (entity === 'services') {
            Object.assign(newDoc, await normalizeServicePayload(data));
        }

        if (entity === 'expense-categories') {
            Object.assign(newDoc, await normalizeExpenseCategoryPayload(data));
        }

        if (entity === 'drivers') {
            Object.assign(newDoc, await normalizeDriverPayload(data));
        }

        if (entity === 'vehicles') {
            Object.assign(newDoc, await normalizeVehiclePayload(session, data));
        }

        if (entity === 'users') {
            const normalizedUser = await normalizeUserCreatePayload(data);
            newDoc.name = normalizedUser.name;
            newDoc.email = normalizedUser.email;
            newDoc.role = normalizedUser.role;
            newDoc.passwordHash = normalizedUser.passwordHash;
            newDoc.active = normalizedUser.active;
            newDoc.createdAt = normalizedUser.createdAt;
            delete newDoc.password;
        }

        if (entity === 'tire-events') {
            const normalizedTireEvent = await normalizeTireEventPayload(data);
            Object.assign(newDoc, normalizedTireEvent);
        }

        if (entity === 'bank-accounts') {
            if (data.accountType === 'CASH' || typeof data.systemKey === 'string') {
                return NextResponse.json({ error: 'Akun sistem tidak boleh dibuat manual' }, { status: 409 });
            }
            newDoc.accountType = 'BANK';
        }

        if (entity === 'payments') {
            const amount = typeof data.amount === 'number' ? data.amount : Number(data.amount);
            if (!Number.isFinite(amount) || amount <= 0) {
                return NextResponse.json({ error: 'Nominal pembayaran tidak valid' }, { status: 400 });
            }

            const invoiceRef = typeof data.invoiceRef === 'string' ? data.invoiceRef : '';
            if (!invoiceRef) {
                return NextResponse.json({ error: 'Referensi tagihan wajib diisi' }, { status: 400 });
            }

            const paymentMethod = typeof data.method === 'string' ? data.method : 'CASH';
            const selectedAccountRef = typeof data.bankAccountRef === 'string' && data.bankAccountRef ? data.bankAccountRef : undefined;
            if (paymentMethod === 'TRANSFER' && !selectedAccountRef) {
                return NextResponse.json({ error: 'Rekening bank wajib dipilih untuk transfer' }, { status: 400 });
            }

            const loaded = await loadPaymentTarget(invoiceRef);
            if ('error' in loaded) return loaded.error;

            const remaining = loaded.totalAmount - loaded.totalPaid;
            if (amount > remaining) {
                return NextResponse.json({ error: `Pembayaran melebihi sisa tagihan (${remaining})` }, { status: 400 });
            }

            let bankAcc: BankAccountSummary | null = null;
            if (selectedAccountRef) {
                bankAcc = await getLedgerAccount(selectedAccountRef);
                if (!bankAcc) {
                    return NextResponse.json({ error: 'Rekening bank tidak ditemukan' }, { status: 404 });
                }
            } else if (paymentMethod === 'CASH') {
                bankAcc = await ensureCashAccount();
            }
            if (paymentMethod === 'TRANSFER' && bankAcc?.accountType === 'CASH') {
                return NextResponse.json({ error: 'Metode transfer harus memakai rekening bank, bukan akun Kas Tunai' }, { status: 400 });
            }
            if (bankAcc) {
                newDoc.bankAccountRef = bankAcc._id;
                newDoc.bankAccountName = bankAcc.bankName;
            }
        }

        const created = await sanityCreate(newDoc);
        const newId = (created as Record<string, unknown>)._id as string;

        if (entity === 'payments') {
            const amount = typeof data.amount === 'number' ? data.amount : Number(data.amount);
            const invoiceRef = typeof data.invoiceRef === 'string' ? data.invoiceRef : '';
            const loaded = await loadPaymentTarget(invoiceRef);
            if ('error' in loaded) return loaded.error;

            await sanityCreate({
                _type: 'income',
                sourceType: 'INVOICE_PAYMENT',
                paymentRef: newId,
                date: data.date,
                amount,
                note: loaded.doc._type === 'freightNota' ? 'Pembayaran nota ongkos' : 'Pembayaran invoice',
            });

            const postedPayment = created as Record<string, unknown>;
            const bankAccountRef = typeof postedPayment.bankAccountRef === 'string' ? postedPayment.bankAccountRef : '';
            if (bankAccountRef) {
                const bankAcc = await getLedgerAccount(bankAccountRef);
                if (bankAcc) {
                    const newBalance = (bankAcc.currentBalance || 0) + amount;
                    await sanityCreate({
                        _type: 'bankTransaction',
                        bankAccountRef,
                        bankAccountName: bankAcc.bankName,
                        type: 'CREDIT',
                        amount,
                        date: data.date,
                        description:
                            bankAcc.accountType === 'CASH'
                                ? 'Pembayaran tunai masuk'
                                : loaded.doc._type === 'freightNota'
                                    ? 'Pembayaran nota masuk'
                                    : 'Pembayaran invoice masuk',
                        balanceAfter: newBalance,
                        relatedPaymentRef: newId,
                    });
                    await sanityUpdate(bankAccountRef, { currentBalance: newBalance });
                }
            }

            if (invoiceRef) {
                await syncPaymentStatus(invoiceRef);
            }
        }

        if (entity === 'expenses' && typeof data.bankAccountRef === 'string' && data.bankAccountRef) {
            const amount = typeof data.amount === 'number' ? data.amount : Number(data.amount);
            if (!Number.isFinite(amount) || amount <= 0) {
                return NextResponse.json({ error: 'Nominal pengeluaran tidak valid' }, { status: 400 });
            }

            const bankAcc = await sanityGetById<{ _id: string; currentBalance: number; bankName: string }>(data.bankAccountRef);
            if (bankAcc) {
                const newBalance = (bankAcc.currentBalance || 0) - amount;
                await sanityCreate({
                    _type: 'bankTransaction',
                    bankAccountRef: data.bankAccountRef,
                    bankAccountName: bankAcc.bankName,
                    type: 'DEBIT',
                    amount,
                    date: data.date,
                    description: data.description || data.note || 'Pengeluaran',
                    balanceAfter: newBalance,
                    relatedExpenseRef: newId,
                });
                await sanityUpdate(data.bankAccountRef, { currentBalance: newBalance });
            }
        }

        if (entity === 'bank-accounts') {
            const initialBalance =
                typeof data.initialBalance === 'number'
                    ? data.initialBalance
                    : Number(data.initialBalance || 0);
            await sanityUpdate(newId, { currentBalance: Number.isFinite(initialBalance) ? initialBalance : 0 });
        }

        void addAuditLog(
            session,
            'CREATE',
            entity,
            newId,
            `Created ${entity}: ${(newDoc as Record<string, unknown>).masterResi ||
            (newDoc as Record<string, unknown>).doNumber ||
            (newDoc as Record<string, unknown>).invoiceNumber ||
            (newDoc as Record<string, unknown>).incidentNumber ||
            (newDoc as Record<string, unknown>).name ||
            newId}`
        );

        return NextResponse.json({ data: created, id: newId });
    } catch (err) {
        const message = err instanceof Error ? err.message : 'Server error';
        const status = message === 'Forbidden' ? 403 : 400;
        console.error('API POST Error:', err);
        return NextResponse.json({ error: message }, { status });
    }
}
