import { NextResponse } from 'next/server';

import { resolveCompanyLogoUrl } from '@/lib/branding';
import { getBusinessCalendarDateParts, normalizeBusinessDateTimeForStorage } from '@/lib/business-date';
import {
    createDocument,
    deleteDocument,
    getCompanyProfile,
    getDocumentById,
    getNextNumber,
    listDocumentsByFilter,
    updateDocument,
} from '@/lib/repositories/document-store';
import { normalizeOptionalTireType } from '@/lib/tire-types';
import type { Driver, IncidentSettlementLine, User } from '@/lib/types';

import {
    assertIsoDateTime,
    normalizeCurrencyNumber,
    normalizeOptionalText,
    type ApiSession,
} from './data-helpers';
import { hasPermission } from '@/lib/rbac';
import { handleGenericCreate } from './generic-workflows';
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
const INCIDENT_MAINTENANCE_FOLLOW_UP_CATEGORIES = new Set(['REPAIR', 'SPAREPART', 'TIRE']);

function requireIncidentSettlementRevision(
    providedRevision: unknown,
    currentRevision?: string
) {
    if (!currentRevision) {
        return true;
    }
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

async function findRelatedByRefOrLegacyText<T extends Record<string, unknown>>(
    docType: string,
    refField: string,
    refValue: string,
    legacyField: string,
    legacyValue: string,
    baseFilter: Record<string, unknown> = {},
) {
    const relatedByRef =
        (await listDocumentsByFilter<T>(docType, {
            ...baseFilter,
            [refField]: refValue,
        }))[0] || null;
    if (relatedByRef) {
        return relatedByRef;
    }

    if (!legacyValue) {
        return null;
    }

    const exactLegacyRows = await listDocumentsByFilter<T>(docType, {
        ...baseFilter,
        [legacyField]: legacyValue,
    });
    const exactLegacyMatch = exactLegacyRows.find(row =>
        !row[refField] &&
        normalizeOptionalText(row[legacyField])?.toLowerCase() === legacyValue
    ) || null;
    if (exactLegacyMatch) {
        return exactLegacyMatch;
    }

    return (await listDocumentsByFilter<T>(docType, baseFilter))
        .find(row =>
            !row[refField] &&
            normalizeOptionalText(row[legacyField])?.toLowerCase() === legacyValue
        ) || null;
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
        const deliveryOrder = await getDocumentById<{
            _id: string;
            doNumber?: string;
            vehicleRef?: string;
            vehiclePlate?: string;
            driverRef?: string;
            driverName?: string;
        }>(relatedDeliveryOrderRef, 'deliveryOrder');
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

    const vehicle = await getDocumentById<{ _id: string; plateNumber?: string; status?: string }>(vehicleRef, 'vehicle');
    if (!vehicle) {
        return NextResponse.json({ error: 'Kendaraan insiden tidak ditemukan' }, { status: 404 });
    }
    if (vehicle.status === 'SOLD') {
        return NextResponse.json({ error: 'Kendaraan yang sudah dijual tidak bisa dilaporkan sebagai insiden baru' }, { status: 409 });
    }
    vehiclePlate = vehiclePlate || vehicle.plateNumber;

    if (driverRef) {
        const driver = await getDocumentById<{ _id: string; name?: string; active?: boolean }>(driverRef, 'driver');
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
    const companyProfile = await getCompanyProfile<{
        name?: string;
        address?: string;
        phone?: string;
        email?: string;
        logoUrl?: string;
    }>();
    const incidentDateTime = normalizeBusinessDateTimeForStorage(
        typeof data.dateTime === 'string' && data.dateTime ? data.dateTime : new Date()
    );
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
    const incidentNumber = await getNextNumber('incident', incidentBusinessDate);
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
        attachmentUrls: [],
    };

    await createDocument(incidentDoc);
    await createDocument({
        _id: crypto.randomUUID(),
        _type: 'incidentActionLog',
        incidentRef: incidentId,
        timestamp,
        note: 'Laporan insiden dibuat',
        userRef: session._id,
        userName: session.name,
    });

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

    const incident = await getDocumentById<{ _id: string; _rev?: string; incidentNumber?: string; status?: string }>(id, 'incident');
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
        const pendingSettlement =
            (await listDocumentsByFilter<{ _id: string; status?: string }>('incidentSettlementLine', { incidentRef: id }))
                .find(item => item.status !== 'POSTED' && item.status !== 'VOID') || null;
        if (pendingSettlement) {
            return NextResponse.json(
                {
                    error: 'Insiden belum bisa ditutup karena masih ada detail biaya, santunan, atau recovery yang belum diposting atau ditolak.',
                },
                { status: 409 }
            );
        }
    }

    const timestamp = new Date().toISOString();
    await updateDocument(id, {
        status,
        ...(status === 'RESOLVED' || status === 'CLOSED'
            ? {
                pendingDriverResolutionRequestedAt: null,
                pendingDriverResolutionRequestedBy: null,
                pendingDriverResolutionRequestedByName: null,
                pendingDriverResolutionNote: null,
                pendingDriverResolutionCostCount: null,
                pendingDriverResolutionAmount: null,
            }
            : {}),
    }, 'incident');
    await createDocument({
        _id: crypto.randomUUID(),
        _type: 'incidentActionLog',
        incidentRef: id,
        timestamp,
        note,
        userRef: session._id,
        userName: session.name,
    });

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

    const incident = await getDocumentById<{ _id: string; incidentNumber?: string; status?: string }>(incidentRef, 'incident');
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

        await createDocument(nextLine as unknown as { _type: string; [key: string]: unknown });
        await createDocument({
            _id: crypto.randomUUID(),
            _type: 'incidentActionLog',
            incidentRef,
            timestamp: now,
            note: `Detail insiden ditambahkan: ${formatIncidentSettlementLabel(nextLine)}`,
            userRef: session._id,
            userName: session.name,
        });

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

    const existing = await getDocumentById<IncidentSettlementLine>(id, 'incidentSettlementLine');
    if (!existing) {
        return NextResponse.json({ error: 'Detail insiden tidak ditemukan' }, { status: 404 });
    }
    const incident = await getDocumentById<{ _id: string; status?: string }>(existing.incidentRef, 'incident');
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
        const nextPatch = {
            ...patch,
            ...Object.fromEntries(unsetFields.map(field => [field, null])),
        };
        const updatedLine = await updateDocument<IncidentSettlementLine>(id, nextPatch);
        await createDocument({
            _id: crypto.randomUUID(),
            _type: 'incidentActionLog',
            incidentRef: existing.incidentRef,
            timestamp: now,
            note: `Detail insiden diperbarui: ${formatIncidentSettlementLabel(nextLine)}`,
            userRef: session._id,
            userName: session.name,
        });
        await addAuditLog(session, 'UPDATE', 'incident-settlement-lines', id, `Updated incident settlement line ${formatIncidentSettlementLabel(nextLine)}`);
        return NextResponse.json({ data: updatedLine });
    } catch (error) {
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

    const existing = await getDocumentById<IncidentSettlementLine>(id, 'incidentSettlementLine');
    if (!existing) {
        return NextResponse.json({ error: 'Detail insiden tidak ditemukan' }, { status: 404 });
    }
    const incident = await getDocumentById<{ _id: string; status?: string }>(existing.incidentRef, 'incident');
    if (!incident) {
        return NextResponse.json({ error: 'Insiden terkait detail settlement tidak ditemukan' }, { status: 404 });
    }
    if (incident.status === 'CLOSED') {
        return NextResponse.json(
            { error: 'Detail settlement pada insiden yang sudah ditutup tidak boleh dihapus. Gunakan status ditolak jika perlu menutup data lama.' },
            { status: 409 }
        );
    }
    if (!requireIncidentSettlementRevision(revision, existing._rev)) {
        return NextResponse.json({ error: 'Detail insiden berubah karena ada update lain. Refresh lalu coba lagi.' }, { status: 409 });
    }
    if (existing.status !== 'DRAFT' || existing.linkedExpenseRef) {
        return NextResponse.json({ error: 'Hanya detail insiden draft yang belum terposting yang boleh dihapus' }, { status: 409 });
    }

    const now = new Date().toISOString();
    await deleteDocument(id);
    await createDocument({
        _id: crypto.randomUUID(),
        _type: 'incidentActionLog',
        incidentRef: existing.incidentRef,
        timestamp: now,
        note: `Detail insiden dihapus: ${formatIncidentSettlementLabel(existing)}`,
        userRef: session._id,
        userName: session.name,
    });
    await addAuditLog(session, 'DELETE', 'incident-settlement-lines', id, `Deleted incident settlement line ${formatIncidentSettlementLabel(existing)}`);
    return NextResponse.json({ success: true });
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

    const existing = await getDocumentById<IncidentSettlementLine>(id, 'incidentSettlementLine');
    if (!existing) {
        return NextResponse.json({ error: 'Detail insiden tidak ditemukan' }, { status: 404 });
    }
    const incident = await getDocumentById<{ _id: string; status?: string }>(existing.incidentRef, 'incident');
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
            ? `Detail insiden ditolak: ${formatIncidentSettlementLabel(existing)}`
            : status === 'POSTED'
                ? `Recovery insiden ditandai diterima: ${formatIncidentSettlementLabel(existing)}`
                : `Status detail insiden diubah ke ${status}: ${formatIncidentSettlementLabel(existing)}`;

    try {
        const unsetPatch =
            status === 'VOID' || status === 'POSTED'
                ? {}
                : { voidedAt: undefined, voidedBy: undefined, voidedByName: undefined };
        const updatedLine = await updateDocument<IncidentSettlementLine>(id, {
            ...sanitizePatchSet(patch),
            ...unsetPatch,
        });
        if (existing.status === 'DRAFT' && status !== 'DRAFT' && (existing.note || '').includes('Diajukan driver')) {
            const remainingDriverDraftLines = (await listDocumentsByFilter<IncidentSettlementLine>('incidentSettlementLine', {
                incidentRef: existing.incidentRef,
            })).filter(line =>
                line._id !== id &&
                line.status === 'DRAFT' &&
                (line.note || '').includes('Diajukan driver')
            );
            if (remainingDriverDraftLines.length === 0) {
                await updateDocument(existing.incidentRef, {
                    pendingDriverResolutionRequestedAt: null,
                    pendingDriverResolutionRequestedBy: null,
                    pendingDriverResolutionRequestedByName: null,
                    pendingDriverResolutionNote: null,
                    pendingDriverResolutionCostCount: null,
                    pendingDriverResolutionAmount: null,
                }, 'incident');
            }
        }
        await createDocument({
            _id: crypto.randomUUID(),
            _type: 'incidentActionLog',
            incidentRef: existing.incidentRef,
            timestamp: now,
            note: actionNote,
            userRef: session._id,
            userName: session.name,
        });
        await addAuditLog(session, 'UPDATE', 'incident-settlement-lines', id, actionNote);
        return NextResponse.json({ data: updatedLine });
    } catch (error) {
        throw error;
    }
}

function buildIncidentSettlementFollowUpError(line: IncidentSettlementLine) {
    if (line.lineType !== 'COST') {
        return 'Follow-up aset atau maintenance hanya boleh dibuat dari detail biaya insiden';
    }
    if (line.status !== 'POSTED' || !line.linkedExpenseRef) {
        return 'Biaya insiden harus sudah diposting sebelum membuat follow-up aset atau maintenance';
    }
    return '';
}

async function loadIncidentSettlementFollowUpContext(
    data: Record<string, unknown>
) {
    const id = typeof data.id === 'string' ? data.id.trim() : '';
    const revision = typeof data.revision === 'string' ? data.revision.trim() : '';
    if (!id) {
        return {
            error: NextResponse.json({ error: 'Detail insiden tidak valid' }, { status: 400 }),
        };
    }

    const line = await getDocumentById<IncidentSettlementLine>(id, 'incidentSettlementLine');
    if (!line) {
        return {
            error: NextResponse.json({ error: 'Detail insiden tidak ditemukan' }, { status: 404 }),
        };
    }
    if (!requireIncidentSettlementRevision(revision, line._rev)) {
        return {
            error: NextResponse.json({ error: 'Detail insiden berubah karena ada update lain. Refresh lalu coba lagi.' }, { status: 409 }),
        };
    }

    const lineError = buildIncidentSettlementFollowUpError(line);
    if (lineError) {
        return {
            error: NextResponse.json({ error: lineError }, { status: 409 }),
        };
    }

    const incident = await getDocumentById<{
        _id: string;
        incidentNumber?: string;
        vehicleRef?: string;
        vehiclePlate?: string;
        relatedDeliveryOrderRef?: string;
    }>(line.incidentRef, 'incident');
    if (!incident) {
        return {
            error: NextResponse.json({ error: 'Insiden terkait detail biaya tidak ditemukan' }, { status: 404 }),
        };
    }

    return { line, incident };
}

async function readCreateResponse<T extends { _id?: string }>(response: NextResponse) {
    if (!response.ok) {
        return { response };
    }
    const payload = await response.json() as { data?: T; id?: string };
    const id = payload.id || payload.data?._id;
    if (!id) {
        return {
            response: NextResponse.json({ error: 'Dokumen follow-up gagal dibuat' }, { status: 500 }),
        };
    }
    return { id, data: payload.data };
}

export async function handleIncidentSettlementLineTireFollowUpCreate(
    session: ApiSession,
    data: Record<string, unknown>,
    addAuditLog: AuditLogFn
) {
    if (!hasPermission(session.role, 'tires', 'create')) {
        return NextResponse.json({ error: 'Tidak punya akses mencatat aset ban' }, { status: 403 });
    }

    const context = await loadIncidentSettlementFollowUpContext(data);
    if ('error' in context) {
        return context.error;
    }
    const { line, incident } = context;

    if (line.category !== 'TIRE') {
        return NextResponse.json({ error: 'Aset ban hanya boleh ditautkan dari biaya insiden kategori ban' }, { status: 409 });
    }
    if (line.linkedTireEventRef) {
        return NextResponse.json({ error: 'Detail biaya insiden ini sudah tertaut ke aset ban' }, { status: 409 });
    }

    const linkedWarehouseItemRef = normalizeOptionalText(data.linkedWarehouseItemRef);
    const tireCode = normalizeOptionalText(data.tireCode);
    const tireBrand = normalizeOptionalText(data.tireBrand);
    const tireSize = normalizeOptionalText(data.tireSize);
    const tireType = normalizeOptionalTireType(data.tireType);
    const originalCost = normalizeCurrencyNumber(data.originalCost ?? line.amount, { maxFractionDigits: 0 });
    if (!linkedWarehouseItemRef) {
        return NextResponse.json({ error: 'Master barang gudang ban tertracking wajib dipilih' }, { status: 400 });
    }
    if (!tireCode || !tireBrand || !tireSize || !tireType) {
        return NextResponse.json({ error: 'Kode, jenis, merk, dan ukuran ban wajib diisi' }, { status: 400 });
    }
    if (!Number.isFinite(originalCost) || originalCost <= 0) {
        return NextResponse.json({ error: 'Nilai awal aset ban harus lebih besar dari 0' }, { status: 400 });
    }

    const incidentLabel = incident.incidentNumber || line.incidentNumber || incident._id;
    const notes = [
        normalizeOptionalText(data.notes),
        `Aset ban dicatat dari insiden ${incidentLabel}`,
        line.description ? `Detail biaya: ${line.description}` : '',
    ].filter(Boolean).join(' | ');
    const createResponse = await handleGenericCreate(
        session,
        'tire-events',
        'tireEvent',
        {
            tireCode,
            tireType,
            tireBrand,
            tireSize,
            linkedWarehouseItemRef,
            holderType: 'WAREHOUSE',
            status: 'IN_WAREHOUSE',
            installDate: normalizeOptionalText(data.installDate) || line.date,
            purchaseCost: originalCost,
            originalCost,
            totalUsedPercent: 0,
            notes,
        },
        addAuditLog
    );
    const created = await readCreateResponse<{ _id?: string; tireCode?: string }>(createResponse);
    if ('response' in created) {
        return created.response;
    }

    const now = new Date().toISOString();
    await updateDocument(created.id, {
        sourceIncidentRef: incident._id,
        sourceIncidentNumber: incidentLabel,
        sourceIncidentSettlementLineRef: line._id,
        sourceIncidentExpenseRef: line.linkedExpenseRef,
        sourceCategory: 'INCIDENT_DO_PURCHASE',
        sourceCategoryLabel: 'Ban mandiri / beli saat DO',
    }, 'tireEvent');
    const updatedLine = await updateDocument<IncidentSettlementLine>(line._id, {
        linkedTireEventRef: created.id,
        linkedTireCode: created.data?.tireCode || tireCode,
        linkedTireWarehouseItemRef: linkedWarehouseItemRef,
        updatedAt: now,
        updatedBy: session._id,
        updatedByName: session.name,
    }, 'incidentSettlementLine');
    const actionNote = `Aset ban ${created.data?.tireCode || tireCode} ditautkan dari ${formatIncidentSettlementLabel(line)}`;
    await createDocument({
        _id: crypto.randomUUID(),
        _type: 'incidentActionLog',
        incidentRef: line.incidentRef,
        timestamp: now,
        note: actionNote,
        userRef: session._id,
        userName: session.name,
    });
    await addAuditLog(session, 'UPDATE', 'incident-settlement-lines', line._id, actionNote);
    return NextResponse.json({ data: updatedLine, tireEventRef: created.id });
}

export async function handleIncidentSettlementLineMaintenanceFollowUpCreate(
    session: ApiSession,
    data: Record<string, unknown>,
    addAuditLog: AuditLogFn
) {
    if (!hasPermission(session.role, 'maintenance', 'create')) {
        return NextResponse.json({ error: 'Tidak punya akses menjadwalkan maintenance' }, { status: 403 });
    }

    const context = await loadIncidentSettlementFollowUpContext(data);
    if ('error' in context) {
        return context.error;
    }
    const { line, incident } = context;

    if (!INCIDENT_MAINTENANCE_FOLLOW_UP_CATEGORIES.has(line.category)) {
        return NextResponse.json({ error: 'Follow-up maintenance hanya tersedia untuk biaya perbaikan, sparepart, atau ban' }, { status: 409 });
    }
    if (line.linkedMaintenanceRef) {
        return NextResponse.json({ error: 'Detail biaya insiden ini sudah tertaut ke maintenance' }, { status: 409 });
    }
    if (!incident.vehicleRef) {
        return NextResponse.json({ error: 'Kendaraan insiden tidak tersedia untuk maintenance' }, { status: 409 });
    }

    const incidentLabel = incident.incidentNumber || line.incidentNumber || incident._id;
    const maintenanceType = normalizeOptionalText(data.type)
        || (line.category === 'TIRE'
            ? 'Follow-up Ban Insiden'
            : line.category === 'SPAREPART'
                ? 'Follow-up Sparepart Insiden'
                : 'Follow-up Perbaikan Insiden');
    const notes = [
        `Follow-up dari insiden ${incidentLabel}`,
        line.description ? `Detail biaya: ${line.description}` : '',
        normalizeOptionalText(data.notes),
        'Biaya insiden sudah diposting terpisah. Jangan catat biaya yang sama dua kali saat maintenance diselesaikan.',
    ].filter(Boolean).join(' | ');
    const createResponse = await handleGenericCreate(
        session,
        'maintenances',
        'maintenance',
        {
            vehicleRef: incident.vehicleRef,
            type: maintenanceType,
            scheduleType: 'DATE',
            plannedDate: normalizeOptionalText(data.plannedDate) || line.date,
            notes,
        },
        addAuditLog
    );
    const created = await readCreateResponse<{ _id?: string; type?: string }>(createResponse);
    if ('response' in created) {
        return created.response;
    }

    const now = new Date().toISOString();
    await updateDocument(created.id, {
        relatedIncidentRef: incident._id,
        relatedIncidentNumber: incidentLabel,
        relatedIncidentSettlementLineRef: line._id,
        relatedIncidentExpenseRef: line.linkedExpenseRef,
        relatedDeliveryOrderRef: incident.relatedDeliveryOrderRef,
    }, 'maintenance');
    const updatedLine = await updateDocument<IncidentSettlementLine>(line._id, {
        linkedMaintenanceRef: created.id,
        linkedMaintenanceType: created.data?.type || maintenanceType,
        updatedAt: now,
        updatedBy: session._id,
        updatedByName: session.name,
    }, 'incidentSettlementLine');
    const actionNote = `Follow-up maintenance ${created.data?.type || maintenanceType} dibuat dari ${formatIncidentSettlementLabel(line)}`;
    await createDocument({
        _id: crypto.randomUUID(),
        _type: 'incidentActionLog',
        incidentRef: line.incidentRef,
        timestamp: now,
        note: actionNote,
        userRef: session._id,
        userName: session.name,
    });
    await addAuditLog(session, 'UPDATE', 'incident-settlement-lines', line._id, actionNote);
    return NextResponse.json({ data: updatedLine, maintenanceRef: created.id });
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

    const service = await getDocumentById<{ _id: string; name?: string; code?: string }>(id, 'service');
    if (!service) {
        return NextResponse.json({ error: 'Kategori truk/armada tidak ditemukan' }, { status: 404 });
    }
    const serviceName = normalizeOptionalText(service.name)?.toLowerCase() || '';
    const relatedOrder = await findRelatedByRefOrLegacyText<{ _id: string; serviceRef?: string; serviceName?: string }>(
        'order',
        'serviceRef',
        id,
        'serviceName',
        serviceName,
    );
    if (relatedOrder) {
        return NextResponse.json({ error: 'Kategori truk/armada yang sudah dipakai pada order tidak boleh dihapus' }, { status: 409 });
    }

    const relatedVehicle = await findRelatedByRefOrLegacyText<{ _id: string; serviceRef?: string; serviceName?: string }>(
        'vehicle',
        'serviceRef',
        id,
        'serviceName',
        serviceName,
    );
    if (relatedVehicle) {
        return NextResponse.json({ error: 'Kategori truk/armada yang sudah dipakai pada kendaraan tidak boleh dihapus' }, { status: 409 });
    }

    const relatedTripRouteRate = await findRelatedByRefOrLegacyText<{ _id: string; serviceRef?: string; serviceName?: string }>(
        'tripRouteRate',
        'serviceRef',
        id,
        'serviceName',
        serviceName,
    );
    if (relatedTripRouteRate) {
        return NextResponse.json({ error: 'Kategori truk/armada yang sudah dipakai pada biaya rute trip tidak boleh dihapus' }, { status: 409 });
    }

    await deleteDocument(id);
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

    const category = await getDocumentById<{ _id: string; name?: string }>(id, 'expenseCategory');
    if (!category) {
        return NextResponse.json({ error: 'Kategori biaya tidak ditemukan' }, { status: 404 });
    }
    const categoryName = normalizeOptionalText(category.name)?.toLowerCase() || '';
    const relatedExpense = await findRelatedByRefOrLegacyText<{ _id: string; categoryRef?: string; categoryName?: string }>(
        'expense',
        'categoryRef',
        id,
        'categoryName',
        categoryName,
    );
    if (relatedExpense) {
        return NextResponse.json({ error: 'Kategori biaya yang sudah dipakai pada pengeluaran tidak boleh dihapus' }, { status: 409 });
    }

    await deleteDocument(id);
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

    const driver = await getDocumentById<{ _id: string; name?: string; licenseNumber?: string; ktpNumber?: string }>(id, 'driver');
    if (!driver) {
        return NextResponse.json({ error: 'Supir tidak ditemukan' }, { status: 404 });
    }
    const driverName = normalizeOptionalText(driver.name)?.toLowerCase() || '';
    const relatedDeliveryOrder = await findRelatedByRefOrLegacyText<{ _id: string; driverRef?: string; driverName?: string }>(
        'deliveryOrder',
        'driverRef',
        id,
        'driverName',
        driverName,
    );
    if (relatedDeliveryOrder) {
        return NextResponse.json({ error: 'Supir yang sudah dipakai pada surat jalan tidak boleh dihapus' }, { status: 409 });
    }

    const relatedBorongan = await findRelatedByRefOrLegacyText<{ _id: string; driverRef?: string; driverName?: string }>(
        'driverBorongan',
        'driverRef',
        id,
        'driverName',
        driverName,
    );
    if (relatedBorongan) {
        return NextResponse.json({ error: 'Supir yang sudah dipakai pada slip borongan tidak boleh dihapus' }, { status: 409 });
    }

    const relatedVoucher = await findRelatedByRefOrLegacyText<{ _id: string; driverRef?: string; driverName?: string }>(
        'driverVoucher',
        'driverRef',
        id,
        'driverName',
        driverName,
    );
    if (relatedVoucher) {
        return NextResponse.json({ error: 'Supir yang sudah dipakai pada uang jalan trip tidak boleh dihapus' }, { status: 409 });
    }

    const relatedIncident = await findRelatedByRefOrLegacyText<{ _id: string; driverRef?: string; driverName?: string }>(
        'incident',
        'driverRef',
        id,
        'driverName',
        driverName,
    );
    if (relatedIncident) {
        return NextResponse.json({ error: 'Supir yang sudah dipakai pada insiden tidak boleh dihapus' }, { status: 409 });
    }

    const relatedDriverUser = await findRelatedByRefOrLegacyText<{ _id: string; role?: string; driverRef?: string; driverName?: string }>(
        'user',
        'driverRef',
        id,
        'driverName',
        driverName,
        { role: 'DRIVER' },
    );
    if (relatedDriverUser) {
        return NextResponse.json({ error: 'Supir yang masih punya akun mobile tidak boleh dihapus' }, { status: 409 });
    }

    await deleteDocument(id);
    await addAuditLog(session, 'DELETE', 'drivers', id, `Deleted drivers ${driver.name || id}`);
    return NextResponse.json({ success: true });
}

export async function handleDriverUpdate(
    session: ApiSession,
    id: string,
    updates: Record<string, unknown>,
    addAuditLog: AuditLogFn
) {
    const existingDriver = await getDocumentById<Driver>(id, 'driver');
    if (!existingDriver) {
        return NextResponse.json({ error: 'Supir tidak ditemukan' }, { status: 404 });
    }

    const normalizedUpdates = await normalizeDriverPayload(updates, { partial: true, excludeId: id });
    const nextDriverName =
        typeof normalizedUpdates.name === 'string' && normalizedUpdates.name.trim()
            ? normalizedUpdates.name.trim()
            : existingDriver.name;
    const isDeactivatingDriver = existingDriver.active !== false && normalizedUpdates.active === false;

    const linkedDriverUsers = await listDocumentsByFilter<Pick<User, '_id' | 'active' | 'driverName'>>('user', {
        role: 'DRIVER',
        driverRef: id,
    });

    const shouldSyncDriverName = nextDriverName !== existingDriver.name;
    const activeLinkedUsers = linkedDriverUsers.filter(user => user.active !== false);
    const linkedUsersToRename = shouldSyncDriverName
        ? linkedDriverUsers.filter(user => user.driverName !== nextDriverName)
        : [];

    if (!isDeactivatingDriver) {
        const updated = await updateDocument<Driver>(id, normalizedUpdates);
        for (const user of linkedUsersToRename) {
            await updateDocument(user._id, {
                driverName: nextDriverName,
            });
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
    const trackedDeliveryOrders = (await listDocumentsByFilter<{ _id: string; doNumber?: string; status?: string; trackingState?: string }>('deliveryOrder', {
        driverRef: id,
    })).filter(deliveryOrder => deliveryOrder.trackingState === 'ACTIVE' || deliveryOrder.trackingState === 'PAUSED');

    const updated = await updateDocument<Driver>(id, {
        ...normalizedUpdates,
        activeTrackingUpdatedAt: now,
        activeTrackingDeliveryOrderRef: null,
    });

    for (const deliveryOrder of trackedDeliveryOrders) {
        await updateDocument(deliveryOrder._id, {
            trackingState: 'STOPPED',
            trackingStoppedAt: now,
            trackingLastSeenAt: now,
        });
        await createDocument({
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
            await updateDocument(user._id, nextUserPatch);
        }
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

    const vehicle = await getDocumentById<{ _id: string; plateNumber?: string; unitCode?: string; chassisNumber?: string; engineNumber?: string }>(id, 'vehicle');
    if (!vehicle) {
        return NextResponse.json({ error: 'Kendaraan tidak ditemukan' }, { status: 404 });
    }
    const vehiclePlate = normalizeOptionalText(vehicle.plateNumber)?.toLowerCase() || '';
    const relatedDeliveryOrder = await findRelatedByRefOrLegacyText<{ _id: string; vehicleRef?: string; vehiclePlate?: string }>(
        'deliveryOrder',
        'vehicleRef',
        id,
        'vehiclePlate',
        vehiclePlate,
    );
    if (relatedDeliveryOrder) {
        return NextResponse.json({ error: 'Kendaraan yang sudah dipakai pada surat jalan tidak boleh dihapus' }, { status: 409 });
    }

    const relatedMaintenance = await findRelatedByRefOrLegacyText<{ _id: string; vehicleRef?: string; vehiclePlate?: string }>(
        'maintenance',
        'vehicleRef',
        id,
        'vehiclePlate',
        vehiclePlate,
    );
    if (relatedMaintenance) {
        return NextResponse.json({ error: 'Kendaraan yang sudah punya maintenance tidak boleh dihapus' }, { status: 409 });
    }

    const relatedIncident = await findRelatedByRefOrLegacyText<{ _id: string; vehicleRef?: string; vehiclePlate?: string }>(
        'incident',
        'vehicleRef',
        id,
        'vehiclePlate',
        vehiclePlate,
    );
    if (relatedIncident) {
        return NextResponse.json({ error: 'Kendaraan yang sudah punya insiden tidak boleh dihapus' }, { status: 409 });
    }

    const relatedTireEvent = await findRelatedByRefOrLegacyText<{ _id: string; vehicleRef?: string; vehiclePlate?: string }>(
        'tireEvent',
        'vehicleRef',
        id,
        'vehiclePlate',
        vehiclePlate,
    );
    if (relatedTireEvent) {
        return NextResponse.json({ error: 'Kendaraan yang sudah punya riwayat ban tidak boleh dihapus' }, { status: 409 });
    }

    const relatedVoucher = await findRelatedByRefOrLegacyText<{ _id: string; vehicleRef?: string; vehiclePlate?: string }>(
        'driverVoucher',
        'vehicleRef',
        id,
        'vehiclePlate',
        vehiclePlate,
    );
    if (relatedVoucher) {
        return NextResponse.json({ error: 'Kendaraan yang sudah dipakai pada uang jalan trip tidak boleh dihapus' }, { status: 409 });
    }

    const relatedExpense = await findRelatedByRefOrLegacyText<{ _id: string; relatedVehicleRef?: string; relatedVehiclePlate?: string }>(
        'expense',
        'relatedVehicleRef',
        id,
        'relatedVehiclePlate',
        vehiclePlate,
    );
    if (relatedExpense) {
        return NextResponse.json({ error: 'Kendaraan yang sudah dipakai pada pengeluaran tidak boleh dihapus' }, { status: 409 });
    }

    await deleteDocument(id);
    await addAuditLog(session, 'DELETE', 'vehicles', id, `Deleted vehicles ${vehicle.plateNumber || id}`);
    return NextResponse.json({ success: true });
}
