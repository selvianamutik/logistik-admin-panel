import { NextResponse } from 'next/server';

import { resolveCompanyLogoUrl } from '@/lib/branding';
import { getSanityClient, sanityDelete, sanityGetById, sanityGetNextNumber, sanityUpdate } from '@/lib/sanity';
import type { Driver, User } from '@/lib/types';

import {
    type ApiSession,
} from './data-helpers';
import {
    normalizeDriverPayload,
} from './operations-workflow-support';

export {
    normalizeDriverPayload,
    normalizeExpenseCategoryPayload,
    normalizeMaintenanceCreatePayload,
    normalizeServicePayload,
    normalizeTireEventPayload,
    normalizeVehiclePayload,
} from './operations-workflow-support';

type AuditLogFn = (
    session: Pick<ApiSession, '_id' | 'name'>,
    action: string,
    entityType: string,
    entityRef: string,
    summary: string
) => void | Promise<void>;

const INCIDENT_STATUS_TRANSITIONS: Record<string, string[]> = {
    OPEN: ['IN_PROGRESS'],
    IN_PROGRESS: ['RESOLVED'],
    RESOLVED: ['CLOSED'],
    CLOSED: [],
};

export async function handleIncidentCreate(
    session: ApiSession,
    data: Record<string, unknown>,
    addAuditLog: AuditLogFn
) {
    const description = typeof data.description === 'string' ? data.description.trim() : '';
    const relatedDeliveryOrderRef =
        typeof data.relatedDeliveryOrderRef === 'string' && data.relatedDeliveryOrderRef
            ? data.relatedDeliveryOrderRef
            : undefined;
    let vehicleRef = typeof data.vehicleRef === 'string' ? data.vehicleRef : '';
    let vehiclePlate =
        typeof data.vehiclePlate === 'string' && data.vehiclePlate.trim()
            ? data.vehiclePlate.trim()
            : undefined;
    let driverRef =
        typeof data.driverRef === 'string' && data.driverRef.trim()
            ? data.driverRef.trim()
            : undefined;
    let driverName =
        typeof data.driverName === 'string' && data.driverName.trim()
            ? data.driverName.trim()
            : undefined;
    let relatedDONumber =
        typeof data.relatedDONumber === 'string' && data.relatedDONumber.trim()
            ? data.relatedDONumber.trim()
            : undefined;
    if (!description) {
        return NextResponse.json({ error: 'Deskripsi insiden wajib diisi' }, { status: 400 });
    }
    if (relatedDeliveryOrderRef) {
        const deliveryOrder = await sanityGetById<{
            _id: string;
            doNumber?: string;
            vehicleRef?: string;
            vehiclePlate?: string;
            driverRef?: string;
            driverName?: string;
        }>(relatedDeliveryOrderRef);
        if (!deliveryOrder) {
            return NextResponse.json({ error: 'DO terkait tidak ditemukan' }, { status: 404 });
        }
        relatedDONumber = deliveryOrder.doNumber || relatedDONumber;
        if (!vehicleRef && deliveryOrder.vehicleRef) {
            vehicleRef = deliveryOrder.vehicleRef;
        } else if (vehicleRef && deliveryOrder.vehicleRef && vehicleRef !== deliveryOrder.vehicleRef) {
            return NextResponse.json({ error: 'Kendaraan insiden tidak cocok dengan DO terkait' }, { status: 409 });
        }
        vehiclePlate = deliveryOrder.vehiclePlate || vehiclePlate;
        driverRef = deliveryOrder.driverRef || driverRef;
        driverName = deliveryOrder.driverName || driverName;
    }

    if (!vehicleRef) {
        return NextResponse.json({ error: 'Kendaraan insiden wajib dipilih atau diturunkan dari DO terkait' }, { status: 400 });
    }

    const vehicle = await sanityGetById<{ _id: string; plateNumber?: string; status?: string }>(vehicleRef);
    if (!vehicle) {
        return NextResponse.json({ error: 'Kendaraan insiden tidak ditemukan' }, { status: 404 });
    }
    if (vehicle.status === 'SOLD') {
        return NextResponse.json({ error: 'Kendaraan yang sudah dijual tidak bisa dilaporkan sebagai insiden baru' }, { status: 409 });
    }
    vehiclePlate = vehiclePlate || vehicle.plateNumber;

    const incidentId = crypto.randomUUID();
    const incidentNumber = await sanityGetNextNumber('incident');
    const timestamp = new Date().toISOString();
    const companyProfile = await getSanityClient().fetch<{
        name?: string;
        address?: string;
        phone?: string;
        email?: string;
        logoUrl?: string;
    } | null>(
        `*[_type == "companyProfile"][0]{
            name,
            address,
            phone,
            email,
            logoUrl
        }`
    );
    const incidentDateTime =
        typeof data.dateTime === 'string' && data.dateTime
            ? data.dateTime
            : timestamp.slice(0, 16);
    const incidentDoc = {
        _id: incidentId,
        _type: 'incident',
        ...data,
        vehicleRef,
        vehiclePlate,
        driverRef,
        driverName,
        relatedDeliveryOrderRef,
        relatedDONumber,
        description,
        incidentNumber,
        issuerCompanyName: companyProfile?.name,
        issuerCompanyAddress: companyProfile?.address,
        issuerCompanyPhone: companyProfile?.phone,
        issuerCompanyEmail: companyProfile?.email,
        issuerCompanyLogoUrl: resolveCompanyLogoUrl(companyProfile),
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

    await addAuditLog(session, 'CREATE', 'incidents', incidentId, `Created incidents: ${incidentNumber}`);
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

    await addAuditLog(
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
        return NextResponse.json({ error: 'Kategori truk/armada tidak valid' }, { status: 400 });
    }

    const service = await sanityGetById<{ _id: string; name?: string }>(id);
    if (!service) {
        return NextResponse.json({ error: 'Kategori truk/armada tidak ditemukan' }, { status: 404 });
    }

    const relatedOrder = await getSanityClient().fetch<{ _id: string } | null>(
        `*[_type == "order" && ((serviceRef == $ref || serviceRef._ref == $ref) || lower(coalesce(serviceName, "")) == $serviceName)][0]{ _id }`,
        { ref: id, serviceName: (service.name || '').toLowerCase() }
    );
    if (relatedOrder) {
        return NextResponse.json({ error: 'Kategori truk/armada yang sudah dipakai pada order tidak boleh dihapus' }, { status: 409 });
    }

    const relatedVehicle = await getSanityClient().fetch<{ _id: string } | null>(
        `*[_type == "vehicle" && ((serviceRef == $ref || serviceRef._ref == $ref) || lower(coalesce(serviceName, "")) == $serviceName)][0]{ _id }`,
        { ref: id, serviceName: (service.name || '').toLowerCase() }
    );
    if (relatedVehicle) {
        return NextResponse.json({ error: 'Kategori truk/armada yang sudah dipakai pada kendaraan tidak boleh dihapus' }, { status: 409 });
    }

    const relatedTripRouteRate = await getSanityClient().fetch<{ _id: string } | null>(
        `*[_type == "tripRouteRate" && ((serviceRef == $ref || serviceRef._ref == $ref) || lower(coalesce(serviceName, "")) == $serviceName)][0]{ _id }`,
        { ref: id, serviceName: (service.name || '').toLowerCase() }
    );
    if (relatedTripRouteRate) {
        return NextResponse.json({ error: 'Kategori truk/armada yang sudah dipakai pada biaya rute trip tidak boleh dihapus' }, { status: 409 });
    }

    await sanityDelete(id);
    await addAuditLog(session, 'DELETE', 'services', id, `Deleted vehicle category ${service.name || id}`);
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
    await addAuditLog(session, 'DELETE', 'expense-categories', id, `Deleted expense-categories ${category.name || id}`);
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
        return NextResponse.json({ error: 'Supir yang sudah dipakai pada uang jalan trip tidak boleh dihapus' }, { status: 409 });
    }

    const relatedDriverUser = await getSanityClient().fetch<{ _id: string } | null>(
        `*[_type == "user" && role == "DRIVER" && driverRef == $ref][0]{ _id }`,
        { ref: id }
    );
    if (relatedDriverUser) {
        return NextResponse.json({ error: 'Supir yang masih punya akun mobile tidak boleh dihapus' }, { status: 409 });
    }

    await sanityDelete(id);
    await addAuditLog(session, 'DELETE', 'drivers', id, `Deleted drivers ${driver.name || id}`);
    return NextResponse.json({ success: true });
}

export async function handleDriverUpdate(
    session: ApiSession,
    id: string,
    updates: Record<string, unknown>,
    addAuditLog: AuditLogFn
) {
    const existingDriver = await sanityGetById<Driver>(id);
    if (!existingDriver) {
        return NextResponse.json({ error: 'Supir tidak ditemukan' }, { status: 404 });
    }

    const normalizedUpdates = await normalizeDriverPayload(updates, { partial: true, excludeId: id });
    const nextDriverName =
        typeof normalizedUpdates.name === 'string' && normalizedUpdates.name.trim()
            ? normalizedUpdates.name.trim()
            : existingDriver.name;
    const isDeactivatingDriver = existingDriver.active !== false && normalizedUpdates.active === false;

    const linkedDriverUsers = await getSanityClient().fetch<Array<Pick<User, '_id' | 'active' | 'driverName'>>>(
        `*[_type == "user" && role == "DRIVER" && driverRef == $ref]{
            _id,
            active,
            driverName
        }`,
        { ref: id }
    );

    const shouldSyncDriverName = nextDriverName !== existingDriver.name;
    const activeLinkedUsers = linkedDriverUsers.filter(user => user.active !== false);

    if (!isDeactivatingDriver) {
        const updated = await sanityUpdate<Driver>(id, normalizedUpdates);

        if (shouldSyncDriverName) {
            await Promise.all(
                linkedDriverUsers
                    .filter(user => user.driverName !== nextDriverName)
                    .map(user => getSanityClient().patch(user._id).set({ driverName: nextDriverName }).commit())
            );
        }

        await addAuditLog(session, 'UPDATE', 'drivers', id, `Updated drivers: ${JSON.stringify(normalizedUpdates).slice(0, 200)}`);
        return NextResponse.json({
            data: updated,
            meta: {
                syncedDriverAccountIds: shouldSyncDriverName ? linkedDriverUsers.map(user => user._id) : [],
                disabledDriverAccountIds: [],
                stoppedTrackingCount: 0,
            },
        });
    }

    const now = new Date().toISOString();
    const trackedDeliveryOrders = await getSanityClient().fetch<Array<{ _id: string; doNumber?: string; status?: string }>>(
        `*[
            _type == "deliveryOrder" &&
            (driverRef == $ref || driverRef._ref == $ref) &&
            trackingState in ["ACTIVE", "PAUSED"]
        ]{
            _id,
            doNumber,
            status
        }`,
        { ref: id }
    );

    const transaction = getSanityClient().transaction().patch(id, {
        set: {
            ...normalizedUpdates,
            activeTrackingUpdatedAt: now,
        },
        unset: ['activeTrackingDeliveryOrderRef'],
    });

    for (const deliveryOrder of trackedDeliveryOrders) {
        transaction.patch(deliveryOrder._id, {
            set: {
                trackingState: 'STOPPED',
                trackingStoppedAt: now,
                trackingLastSeenAt: now,
            },
        });
        transaction.create({
            _id: crypto.randomUUID(),
            _type: 'trackingLog',
            refType: 'DO',
            refRef: deliveryOrder._id,
            status: deliveryOrder.status || 'ON_DELIVERY',
            note: `Tracking dihentikan otomatis karena supir ${existingDriver.name} dinonaktifkan`,
            source: 'DRIVER_APP',
            timestamp: now,
            userRef: session._id,
            userName: session.name,
        });
    }

    for (const user of linkedDriverUsers) {
        const nextUserPatch: Record<string, unknown> = {};
        if (user.active !== false) {
            nextUserPatch.active = false;
        }
        if (user.driverName !== nextDriverName) {
            nextUserPatch.driverName = nextDriverName;
        }
        if (Object.keys(nextUserPatch).length > 0) {
            transaction.patch(user._id, { set: nextUserPatch });
        }
    }

    await transaction.commit();

    const updated = await sanityGetById<Driver>(id);
    if (!updated) {
        return NextResponse.json({ error: 'Supir tidak ditemukan' }, { status: 404 });
    }

    await addAuditLog(session, 'UPDATE', 'drivers', id, `Updated drivers: ${JSON.stringify(normalizedUpdates).slice(0, 200)}`);
    for (const deliveryOrder of trackedDeliveryOrders) {
        await addAuditLog(
            session,
            'UPDATE',
            'delivery-orders',
            deliveryOrder._id,
            `Tracking dihentikan otomatis karena supir ${existingDriver.name || id} dinonaktifkan`
        );
    }
    for (const user of activeLinkedUsers) {
        await addAuditLog(
            session,
            'UPDATE',
            'users',
            user._id,
            `Akun mobile driver dinonaktifkan otomatis karena supir ${existingDriver.name || id} dinonaktifkan`
        );
    }

    return NextResponse.json({
        data: updated,
        meta: {
            syncedDriverAccountIds: shouldSyncDriverName ? linkedDriverUsers.map(user => user._id) : [],
            disabledDriverAccountIds: activeLinkedUsers.map(user => user._id),
            stoppedTrackingCount: trackedDeliveryOrders.length,
        },
    });
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
        return NextResponse.json({ error: 'Kendaraan yang sudah dipakai pada uang jalan trip tidak boleh dihapus' }, { status: 409 });
    }

    const relatedExpense = await getSanityClient().fetch<{ _id: string } | null>(
        `*[_type == "expense" && (relatedVehicleRef == $ref || relatedVehicleRef._ref == $ref)][0]{ _id }`,
        { ref: id }
    );
    if (relatedExpense) {
        return NextResponse.json({ error: 'Kendaraan yang sudah dipakai pada pengeluaran tidak boleh dihapus' }, { status: 409 });
    }

    await sanityDelete(id);
    await addAuditLog(session, 'DELETE', 'vehicles', id, `Deleted vehicles ${vehicle.plateNumber || id}`);
    return NextResponse.json({ success: true });
}
