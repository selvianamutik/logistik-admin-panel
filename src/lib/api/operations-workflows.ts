import { NextResponse } from 'next/server';

import { resolveCompanyLogoUrl } from '@/lib/branding';
import { getBusinessCalendarDateParts, getBusinessDateTimeLocalValue } from '@/lib/business-date';
import { getSanityClient, sanityDelete, sanityGetById, sanityGetNextNumber } from '@/lib/sanity';
import type { Driver, IncidentSettlementLine, User } from '@/lib/types';

import {
    assertIsoDateTime,
    isMutationConflictError,
    type ApiSession,
} from './data-helpers';
import {
    normalizeDriverPayload,
    normalizeIncidentSettlementLinePayload,
    normalizeOptionalWholeNumber,
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
const INCIDENT_SETTLEMENT_ALLOWED_CATEGORIES: Record<string, Set<string>> = {
    COST: new Set(['TOWING', 'REPAIR', 'SPAREPART', 'TIRE', 'MEDICAL', 'THIRD_PARTY_DAMAGE', 'POLICE_ADMIN', 'ACCOMMODATION', 'CARGO_HANDLING', 'OTHER']),
    COMPENSATION: new Set(['COMPENSATION_DRIVER', 'COMPENSATION_CREW', 'COMPENSATION_THIRD_PARTY', 'COMPENSATION_FAMILY', 'OTHER']),
    RECOVERY: new Set(['INSURANCE_CLAIM', 'THIRD_PARTY_RECOVERY', 'VENDOR_RECOVERY', 'INTERNAL_RECOVERY', 'OTHER']),
};
const ALLOWED_INCIDENT_TYPES = new Set(['BLOWOUT_TIRE', 'ENGINE_TROUBLE', 'ACCIDENT_MINOR', 'ACCIDENT_MAJOR', 'OTHER']);
const ALLOWED_INCIDENT_URGENCY = new Set(['LOW', 'MEDIUM', 'HIGH']);

function requireIncidentSettlementRevision(
    providedRevision: unknown,
    currentRevision?: string
) {
    const revision = typeof providedRevision === 'string' ? providedRevision.trim() : '';
    if (!revision || !currentRevision || revision !== currentRevision) {
        return false;
    }
    return true;
}

function sanitizePatchSet(input: Record<string, unknown>) {
    return Object.fromEntries(
        Object.entries(input).filter(([, value]) => value !== undefined)
    );
}

function formatIncidentSettlementLabel(line: Pick<IncidentSettlementLine, 'lineType' | 'description' | 'amount' | 'incidentNumber'>) {
    const lineTypeLabel =
        line.lineType === 'COMPENSATION'
            ? 'Santunan'
            : line.lineType === 'RECOVERY'
                ? 'Recovery'
                : 'Biaya';
    return `${lineTypeLabel} ${line.description || '-'} (${line.incidentNumber || '-'}) sebesar Rp ${Math.round(line.amount || 0).toLocaleString('id-ID')}`;
}

function validateIncidentSettlementLineBusinessRules(line: Pick<IncidentSettlementLine, 'lineType' | 'category' | 'payeeName' | 'recipientType'>) {
    const allowedCategories = INCIDENT_SETTLEMENT_ALLOWED_CATEGORIES[line.lineType];
    if (!allowedCategories?.has(line.category)) {
        throw new Error('Kategori detail insiden tidak cocok dengan tipe detail');
    }

    if ((line.lineType === 'COMPENSATION' || line.lineType === 'RECOVERY') && !line.payeeName) {
        throw new Error(
            line.lineType === 'COMPENSATION'
                ? 'Penerima santunan wajib diisi'
                : 'Sumber recovery wajib diisi'
        );
    }

    if (line.lineType === 'COMPENSATION' && !line.recipientType) {
        throw new Error('Jenis penerima santunan wajib dipilih');
    }
}

function getAllowedIncidentSettlementTargetStatuses(line: Pick<IncidentSettlementLine, 'lineType' | 'status'>) {
    if (line.status === 'DRAFT') {
        return ['APPROVED', 'VOID'];
    }
    if (line.status === 'APPROVED') {
        return line.lineType === 'RECOVERY'
            ? ['DRAFT', 'VOID', 'POSTED']
            : ['DRAFT', 'VOID'];
    }
    return [];
}

function getAllowedClosedIncidentSettlementTargetStatuses(line: Pick<IncidentSettlementLine, 'lineType' | 'status'>) {
    if (line.status === 'POSTED' || line.status === 'VOID') {
        return [];
    }
    if (line.lineType === 'RECOVERY' && line.status === 'APPROVED') {
        return ['POSTED', 'VOID'];
    }
    return ['VOID'];
}

export async function handleIncidentCreate(
    session: ApiSession,
    data: Record<string, unknown>,
    addAuditLog: AuditLogFn
) {
    const description = typeof data.description === 'string' ? data.description.trim() : '';
    const incidentType =
        typeof data.incidentType === 'string' && ALLOWED_INCIDENT_TYPES.has(data.incidentType)
            ? data.incidentType
            : '';
    const urgency =
        typeof data.urgency === 'string' && ALLOWED_INCIDENT_URGENCY.has(data.urgency)
            ? data.urgency
            : '';
    const locationText =
        typeof data.locationText === 'string' && data.locationText.trim()
            ? data.locationText.trim()
            : '';
    const odometer = normalizeOptionalWholeNumber(data.odometer, 'Odometer insiden');
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
    let driverName: string | undefined;
    let relatedDONumber =
        typeof data.relatedDONumber === 'string' && data.relatedDONumber.trim()
            ? data.relatedDONumber.trim()
            : undefined;
    if (!description) {
        return NextResponse.json({ error: 'Deskripsi insiden wajib diisi' }, { status: 400 });
    }
    if (!incidentType) {
        return NextResponse.json({ error: 'Tipe insiden tidak valid' }, { status: 400 });
    }
    if (!urgency) {
        return NextResponse.json({ error: 'Level urgensi insiden tidak valid' }, { status: 400 });
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
        if (!driverRef && deliveryOrder.driverRef) {
            driverRef = deliveryOrder.driverRef;
        } else if (driverRef && deliveryOrder.driverRef && driverRef !== deliveryOrder.driverRef) {
            return NextResponse.json({ error: 'Supir insiden tidak cocok dengan DO terkait' }, { status: 409 });
        }
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

    if (driverRef) {
        const driver = await sanityGetById<{ _id: string; name?: string; active?: boolean }>(driverRef);
        if (!driver) {
            return NextResponse.json({ error: 'Supir insiden tidak ditemukan' }, { status: 404 });
        }
        if (driver.active === false) {
            return NextResponse.json({ error: 'Supir insiden tidak aktif' }, { status: 409 });
        }
        driverName = driver.name || driverName;
    }

    const incidentId = crypto.randomUUID();
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
            : getBusinessDateTimeLocalValue();
    try {
        assertIsoDateTime(incidentDateTime, 'Waktu insiden');
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Waktu insiden tidak valid' },
            { status: 400 }
        );
    }
    const incidentDateParts = getBusinessCalendarDateParts(incidentDateTime);
    const incidentBusinessDate = incidentDateParts
        ? `${incidentDateParts.year}-${incidentDateParts.month}-${incidentDateParts.day}`
        : incidentDateTime.slice(0, 10);
    const incidentNumber = await sanityGetNextNumber('incident', incidentBusinessDate);
    const incidentDoc = {
        _id: incidentId,
        _type: 'incident',
        vehicleRef,
        vehiclePlate,
        driverRef,
        driverName,
        relatedDeliveryOrderRef,
        relatedDONumber,
        description,
        incidentType,
        urgency,
        locationText,
        odometer,
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
    const revision = typeof data.revision === 'string' ? data.revision.trim() : '';
    if (!id || !status || !note) {
        return NextResponse.json({ error: 'Status dan catatan insiden wajib diisi' }, { status: 400 });
    }

    const incident = await sanityGetById<{ _id: string; _rev?: string; incidentNumber?: string; status?: string }>(id);
    if (!incident) {
        return NextResponse.json({ error: 'Insiden tidak ditemukan' }, { status: 404 });
    }
    if (!requireIncidentSettlementRevision(revision, incident._rev)) {
        return NextResponse.json({ error: 'Data insiden berubah karena ada update lain. Refresh lalu coba lagi.' }, { status: 409 });
    }

    const allowedStatuses = INCIDENT_STATUS_TRANSITIONS[incident.status || ''] || [];
    if (!allowedStatuses.includes(status)) {
        return NextResponse.json({ error: 'Transisi status insiden tidak valid' }, { status: 400 });
    }
    if (status === 'CLOSED') {
        const pendingSettlement = await getSanityClient().fetch<{ _id: string } | null>(
            `*[_type == "incidentSettlementLine" && incidentRef == $incidentRef && !(status in ["POSTED", "VOID"])][0]{ _id }`,
            { incidentRef: id }
        );
        if (pendingSettlement) {
            return NextResponse.json(
                {
                    error: 'Insiden belum bisa ditutup karena masih ada detail biaya, santunan, atau recovery yang belum diposting atau di-void.',
                },
                { status: 409 }
            );
        }
    }

    const timestamp = new Date().toISOString();
    try {
        await getSanityClient()
            .transaction()
            .patch(id, { ifRevisionID: incident._rev, set: { status } })
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
    } catch (error) {
        if (isMutationConflictError(error)) {
            return NextResponse.json({ error: 'Data insiden berubah karena ada update lain. Refresh lalu coba lagi.' }, { status: 409 });
        }
        throw error;
    }

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

export async function handleIncidentSettlementLineCreate(
    session: ApiSession,
    data: Record<string, unknown>,
    addAuditLog: AuditLogFn
) {
    const incidentRef = typeof data.incidentRef === 'string' ? data.incidentRef.trim() : '';
    if (!incidentRef) {
        return NextResponse.json({ error: 'Insiden terkait wajib dipilih' }, { status: 400 });
    }

    const incident = await sanityGetById<{ _id: string; incidentNumber?: string; status?: string }>(incidentRef);
    if (!incident) {
        return NextResponse.json({ error: 'Insiden tidak ditemukan' }, { status: 404 });
    }
    if (incident.status === 'CLOSED') {
        return NextResponse.json(
            { error: 'Insiden yang sudah ditutup tidak boleh ditambah detail settlement baru' },
            { status: 409 }
        );
    }

    try {
        const normalized = await normalizeIncidentSettlementLinePayload(data);
        const now = new Date().toISOString();
        const nextLine = {
            _id: crypto.randomUUID(),
            _type: 'incidentSettlementLine' as const,
            incidentRef,
            incidentNumber: incident.incidentNumber,
            ...normalized,
            status: 'DRAFT' as const,
            createdAt: now,
            createdBy: session._id,
            createdByName: session.name,
            updatedAt: now,
            updatedBy: session._id,
            updatedByName: session.name,
        } as IncidentSettlementLine;

        validateIncidentSettlementLineBusinessRules(nextLine);

        await getSanityClient()
            .transaction()
            .create(nextLine)
            .create({
                _id: crypto.randomUUID(),
                _type: 'incidentActionLog',
                incidentRef,
                timestamp: now,
                note: `Detail insiden ditambahkan: ${formatIncidentSettlementLabel(nextLine)}`,
                userRef: session._id,
                userName: session.name,
            })
            .commit();

        await addAuditLog(session, 'CREATE', 'incident-settlement-lines', nextLine._id, `Created incident settlement line ${formatIncidentSettlementLabel(nextLine)}`);
        return NextResponse.json({ data: nextLine, id: nextLine._id });
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Gagal menambah detail insiden' },
            { status: 400 }
        );
    }
}

export async function handleIncidentSettlementLineUpdate(
    session: ApiSession,
    data: Record<string, unknown>,
    addAuditLog: AuditLogFn
) {
    const id = typeof data.id === 'string' ? data.id.trim() : '';
    const revision = typeof data.revision === 'string' ? data.revision.trim() : '';
    const updates = data.updates && typeof data.updates === 'object' && !Array.isArray(data.updates)
        ? data.updates as Record<string, unknown>
        : {};

    if (!id) {
        return NextResponse.json({ error: 'Detail insiden tidak valid' }, { status: 400 });
    }

    const existing = await sanityGetById<IncidentSettlementLine>(id);
    if (!existing) {
        return NextResponse.json({ error: 'Detail insiden tidak ditemukan' }, { status: 404 });
    }
    const incident = await sanityGetById<{ _id: string; status?: string }>(existing.incidentRef);
    if (!incident) {
        return NextResponse.json({ error: 'Insiden terkait detail settlement tidak ditemukan' }, { status: 404 });
    }
    if (incident.status === 'CLOSED') {
        return NextResponse.json(
            { error: 'Detail settlement pada insiden yang sudah ditutup tidak boleh diedit langsung' },
            { status: 409 }
        );
    }
    if (!requireIncidentSettlementRevision(revision, existing._rev)) {
        return NextResponse.json({ error: 'Detail insiden berubah karena ada update lain. Refresh lalu coba lagi.' }, { status: 409 });
    }
    if (existing.status !== 'DRAFT') {
        return NextResponse.json(
            { error: 'Hanya detail insiden draft yang boleh diedit. Turunkan status ke draft dulu jika perlu revisi.' },
            { status: 409 }
        );
    }

    try {
        const normalizedUpdates = await normalizeIncidentSettlementLinePayload(updates, { partial: true });
        if (Object.prototype.hasOwnProperty.call(normalizedUpdates, 'status')) {
            return NextResponse.json({ error: 'Status detail insiden harus diubah lewat action status' }, { status: 409 });
        }
        const unsetFields = [
            Object.prototype.hasOwnProperty.call(updates, 'payeeName') && !normalizedUpdates.payeeName ? 'payeeName' : null,
            Object.prototype.hasOwnProperty.call(updates, 'recipientType') && !normalizedUpdates.recipientType ? 'recipientType' : null,
            Object.prototype.hasOwnProperty.call(updates, 'note') && !normalizedUpdates.note ? 'note' : null,
        ].filter((value): value is string => Boolean(value));
        const nextLine = {
            ...existing,
            ...normalizedUpdates,
        };
        validateIncidentSettlementLineBusinessRules(nextLine);

        const patch = sanitizePatchSet({
            ...normalizedUpdates,
            updatedAt: new Date().toISOString(),
            updatedBy: session._id,
            updatedByName: session.name,
        });
        const now = patch.updatedAt as string;
        const committed = await getSanityClient()
            .transaction()
            .patch(id, {
                ifRevisionID: existing._rev,
                set: patch,
                unset: unsetFields,
            })
            .create({
                _id: crypto.randomUUID(),
                _type: 'incidentActionLog',
                incidentRef: existing.incidentRef,
                timestamp: now,
                note: `Detail insiden diperbarui: ${formatIncidentSettlementLabel(nextLine)}`,
                userRef: session._id,
                userName: session.name,
            })
            .commit({ returnDocuments: true });

        const updatedLine = (committed[0] as unknown as IncidentSettlementLine | undefined) || { ...nextLine, ...patch };
        await addAuditLog(session, 'UPDATE', 'incident-settlement-lines', id, `Updated incident settlement line ${formatIncidentSettlementLabel(nextLine)}`);
        return NextResponse.json({ data: updatedLine });
    } catch (error) {
        if (isMutationConflictError(error)) {
            return NextResponse.json({ error: 'Detail insiden berubah karena ada update lain. Refresh lalu coba lagi.' }, { status: 409 });
        }
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Gagal memperbarui detail insiden' },
            { status: 400 }
        );
    }
}

export async function handleIncidentSettlementLineDelete(
    session: ApiSession,
    data: Record<string, unknown>,
    addAuditLog: AuditLogFn
) {
    const id = typeof data.id === 'string' ? data.id.trim() : '';
    const revision = typeof data.revision === 'string' ? data.revision.trim() : '';
    if (!id) {
        return NextResponse.json({ error: 'Detail insiden tidak valid' }, { status: 400 });
    }

    const existing = await sanityGetById<IncidentSettlementLine>(id);
    if (!existing) {
        return NextResponse.json({ error: 'Detail insiden tidak ditemukan' }, { status: 404 });
    }
    const incident = await sanityGetById<{ _id: string; status?: string }>(existing.incidentRef);
    if (!incident) {
        return NextResponse.json({ error: 'Insiden terkait detail settlement tidak ditemukan' }, { status: 404 });
    }
    if (incident.status === 'CLOSED') {
        return NextResponse.json(
            { error: 'Detail settlement pada insiden yang sudah ditutup tidak boleh dihapus. Gunakan void jika perlu menutup data lama.' },
            { status: 409 }
        );
    }
    if (!requireIncidentSettlementRevision(revision, existing._rev)) {
        return NextResponse.json({ error: 'Detail insiden berubah karena ada update lain. Refresh lalu coba lagi.' }, { status: 409 });
    }
    if (existing.status !== 'DRAFT' || existing.linkedExpenseRef) {
        return NextResponse.json({ error: 'Hanya detail insiden draft yang belum terposting yang boleh dihapus' }, { status: 409 });
    }

    try {
        await getSanityClient()
            .transaction()
            .delete(id)
            .create({
                _id: crypto.randomUUID(),
                _type: 'incidentActionLog',
                incidentRef: existing.incidentRef,
                timestamp: new Date().toISOString(),
                note: `Detail insiden dihapus: ${formatIncidentSettlementLabel(existing)}`,
                userRef: session._id,
                userName: session.name,
            })
            .commit();
        await addAuditLog(session, 'DELETE', 'incident-settlement-lines', id, `Deleted incident settlement line ${formatIncidentSettlementLabel(existing)}`);
        return NextResponse.json({ success: true });
    } catch (error) {
        if (isMutationConflictError(error)) {
            return NextResponse.json({ error: 'Detail insiden berubah karena ada update lain. Refresh lalu coba lagi.' }, { status: 409 });
        }
        throw error;
    }
}

export async function handleIncidentSettlementLineStatusUpdate(
    session: ApiSession,
    data: Record<string, unknown>,
    addAuditLog: AuditLogFn
) {
    const id = typeof data.id === 'string' ? data.id.trim() : '';
    const revision = typeof data.revision === 'string' ? data.revision.trim() : '';
    const status = typeof data.status === 'string' ? data.status.trim() : '';
    if (!id || !status) {
        return NextResponse.json({ error: 'Status detail insiden tidak valid' }, { status: 400 });
    }

    const existing = await sanityGetById<IncidentSettlementLine>(id);
    if (!existing) {
        return NextResponse.json({ error: 'Detail insiden tidak ditemukan' }, { status: 404 });
    }
    const incident = await sanityGetById<{ _id: string; status?: string }>(existing.incidentRef);
    if (!incident) {
        return NextResponse.json({ error: 'Insiden terkait detail settlement tidak ditemukan' }, { status: 404 });
    }
    if (!requireIncidentSettlementRevision(revision, existing._rev)) {
        return NextResponse.json({ error: 'Detail insiden berubah karena ada update lain. Refresh lalu coba lagi.' }, { status: 409 });
    }

    const allowedTargets = incident.status === 'CLOSED'
        ? getAllowedClosedIncidentSettlementTargetStatuses(existing)
        : getAllowedIncidentSettlementTargetStatuses(existing);
    if (!allowedTargets.includes(status)) {
        return NextResponse.json(
            {
                error: existing.lineType === 'RECOVERY'
                    ? 'Transisi status recovery tidak valid'
                    : 'Transisi status biaya / santunan tidak valid',
            },
            { status: 400 }
        );
    }

    const now = new Date().toISOString();
    const patch: Record<string, unknown> = {
        status,
        updatedAt: now,
        updatedBy: session._id,
        updatedByName: session.name,
    };

    if (status === 'VOID') {
        patch.voidedAt = now;
        patch.voidedBy = session._id;
        patch.voidedByName = session.name;
    }

    if (status === 'POSTED') {
        patch.postedAt = now;
        patch.postedBy = session._id;
        patch.postedByName = session.name;
    }

    const actionNote =
        status === 'VOID'
            ? `Detail insiden di-void: ${formatIncidentSettlementLabel(existing)}`
            : status === 'POSTED'
                ? `Recovery insiden ditandai diterima: ${formatIncidentSettlementLabel(existing)}`
                : `Status detail insiden diubah ke ${status}: ${formatIncidentSettlementLabel(existing)}`;

    try {
        const committed = await getSanityClient()
            .transaction()
            .patch(id, {
                ifRevisionID: existing._rev,
                set: sanitizePatchSet(patch),
                unset: status === 'VOID' || status === 'POSTED' ? [] : ['voidedAt', 'voidedBy', 'voidedByName'],
            })
            .create({
                _id: crypto.randomUUID(),
                _type: 'incidentActionLog',
                incidentRef: existing.incidentRef,
                timestamp: now,
                note: actionNote,
                userRef: session._id,
                userName: session.name,
            })
            .commit({ returnDocuments: true });
        const updatedLine = (committed[0] as unknown as IncidentSettlementLine | undefined) || { ...existing, ...patch };
        await addAuditLog(session, 'UPDATE', 'incident-settlement-lines', id, actionNote);
        return NextResponse.json({ data: updatedLine });
    } catch (error) {
        if (isMutationConflictError(error)) {
            return NextResponse.json({ error: 'Detail insiden berubah karena ada update lain. Refresh lalu coba lagi.' }, { status: 409 });
        }
        throw error;
    }
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

    const category = await sanityGetById<{ _id: string; _rev?: string; name?: string }>(id);
    if (!category) {
        return NextResponse.json({ error: 'Kategori biaya tidak ditemukan' }, { status: 404 });
    }
    if (!category._rev) {
        return NextResponse.json(
            { error: 'Revisi kategori biaya tidak tersedia. Refresh lalu coba lagi.' },
            { status: 409 }
        );
    }

    const relatedExpense = await getSanityClient().fetch<{ _id: string } | null>(
        `*[_type == "expense" && ((categoryRef == $ref || categoryRef._ref == $ref) || lower(coalesce(categoryName, "")) == $categoryName)][0]{ _id }`,
        { ref: id, categoryName: (category.name || '').toLowerCase() }
    );
    if (relatedExpense) {
        return NextResponse.json({ error: 'Kategori biaya yang sudah dipakai pada pengeluaran tidak boleh dihapus' }, { status: 409 });
    }

    try {
        await getSanityClient()
            .transaction()
            .patch(id, {
                ifRevisionID: category._rev,
                set: { updatedAt: new Date().toISOString() },
            })
            .delete(id)
            .commit();
        await addAuditLog(session, 'DELETE', 'expense-categories', id, `Deleted expense-categories ${category.name || id}`);
        return NextResponse.json({ success: true });
    } catch (err) {
        if (isMutationConflictError(err)) {
            return NextResponse.json(
                { error: 'Kategori biaya berubah atau baru dipakai pada pengeluaran lain. Muat ulang lalu coba lagi.' },
                { status: 409 }
            );
        }
        throw err;
    }
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

    const relatedIncident = await getSanityClient().fetch<{ _id: string } | null>(
        `*[_type == "incident" && ((driverRef == $ref || driverRef._ref == $ref) || lower(coalesce(driverName, "")) == $driverName)][0]{ _id }`,
        { ref: id, driverName: (driver.name || '').toLowerCase() }
    );
    if (relatedIncident) {
        return NextResponse.json({ error: 'Supir yang sudah dipakai pada insiden tidak boleh dihapus' }, { status: 409 });
    }

    const relatedDriverUser = await getSanityClient().fetch<{ _id: string } | null>(
        `*[_type == "user" && role == "DRIVER" && ((driverRef == $ref || driverRef._ref == $ref) || lower(coalesce(driverName, "")) == $driverName)][0]{ _id }`,
        { ref: id, driverName: (driver.name || '').toLowerCase() }
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

    const linkedDriverUsers = await getSanityClient().fetch<Array<(Pick<User, '_id' | 'active' | 'driverName'> & { _rev?: string })>>(
        `*[_type == "user" && role == "DRIVER" && driverRef == $ref]{
            _id,
            _rev,
            active,
            driverName
        }`,
        { ref: id }
    );

    const shouldSyncDriverName = nextDriverName !== existingDriver.name;
    const activeLinkedUsers = linkedDriverUsers.filter(user => user.active !== false);
    const linkedUsersToRename = shouldSyncDriverName
        ? linkedDriverUsers.filter(user => user.driverName !== nextDriverName)
        : [];

    if (!isDeactivatingDriver) {
        if (!existingDriver._rev) {
            return NextResponse.json({ error: 'Revisi supir tidak tersedia. Refresh lalu coba lagi.' }, { status: 409 });
        }
        if (linkedUsersToRename.some(user => !user._rev)) {
            return NextResponse.json({ error: 'Revisi akun mobile driver tidak tersedia. Refresh lalu coba lagi.' }, { status: 409 });
        }

        try {
            const transaction = getSanityClient().transaction().patch(id, {
                ifRevisionID: existingDriver._rev,
                set: normalizedUpdates,
            });
            for (const user of linkedUsersToRename) {
                transaction.patch(user._id, {
                    ifRevisionID: user._rev as string,
                    set: {
                        driverName: nextDriverName,
                    },
                });
            }
            await transaction.commit();
        } catch (error) {
            if (isMutationConflictError(error)) {
                return NextResponse.json(
                    { error: 'Data supir atau akun mobile driver berubah karena ada update lain. Refresh lalu coba lagi.' },
                    { status: 409 }
                );
            }
            throw error;
        }

        const updated = await sanityGetById<Driver>(id);
        if (!updated) {
            return NextResponse.json({ error: 'Supir tidak ditemukan' }, { status: 404 });
        }

        await addAuditLog(session, 'UPDATE', 'drivers', id, `Updated drivers: ${JSON.stringify(normalizedUpdates).slice(0, 200)}`);
        return NextResponse.json({
            data: updated,
            meta: {
                syncedDriverAccountIds: linkedUsersToRename.map(user => user._id),
                disabledDriverAccountIds: [],
                stoppedTrackingCount: 0,
            },
        });
    }

    const now = new Date().toISOString();
    const trackedDeliveryOrders = await getSanityClient().fetch<Array<{ _id: string; _rev?: string; doNumber?: string; status?: string }>>(
        `*[
            _type == "deliveryOrder" &&
            (driverRef == $ref || driverRef._ref == $ref) &&
            trackingState in ["ACTIVE", "PAUSED"]
        ]{
            _id,
            _rev,
            doNumber,
            status
        }`,
        { ref: id }
    );

    if (!existingDriver._rev) {
        return NextResponse.json({ error: 'Revisi supir tidak tersedia. Refresh lalu coba lagi.' }, { status: 409 });
    }
    if (linkedDriverUsers.some(user => !user._rev)) {
        return NextResponse.json({ error: 'Revisi akun mobile driver tidak tersedia. Refresh lalu coba lagi.' }, { status: 409 });
    }
    if (trackedDeliveryOrders.some(deliveryOrder => !deliveryOrder._rev)) {
        return NextResponse.json({ error: 'Revisi tracking surat jalan tidak tersedia. Refresh lalu coba lagi.' }, { status: 409 });
    }

    const transaction = getSanityClient().transaction().patch(id, {
        ifRevisionID: existingDriver._rev,
        set: {
            ...normalizedUpdates,
            activeTrackingUpdatedAt: now,
        },
        unset: ['activeTrackingDeliveryOrderRef'],
    });

    for (const deliveryOrder of trackedDeliveryOrders) {
        transaction.patch(deliveryOrder._id, {
            ifRevisionID: deliveryOrder._rev,
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
            transaction.patch(user._id, {
                ifRevisionID: user._rev,
                set: nextUserPatch,
            });
        }
    }

    try {
        await transaction.commit();
    } catch (error) {
        if (isMutationConflictError(error)) {
            return NextResponse.json(
                { error: 'Data supir atau tracking berubah karena ada update lain. Refresh lalu coba lagi.' },
                { status: 409 }
            );
        }
        throw error;
    }

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
            syncedDriverAccountIds: linkedUsersToRename.map(user => user._id),
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
        `*[_type == "expense" && ((relatedVehicleRef == $ref || relatedVehicleRef._ref == $ref) || lower(coalesce(relatedVehiclePlate, "")) == $plate)][0]{ _id }`,
        { ref: id, plate: (vehicle.plateNumber || '').toLowerCase() }
    );
    if (relatedExpense) {
        return NextResponse.json({ error: 'Kendaraan yang sudah dipakai pada pengeluaran tidak boleh dihapus' }, { status: 409 });
    }

    await sanityDelete(id);
    await addAuditLog(session, 'DELETE', 'vehicles', id, `Deleted vehicles ${vehicle.plateNumber || id}`);
    return NextResponse.json({ success: true });
}
