import { ensureSameOriginRequest, jsonNoStore, parseJsonBody } from '@/lib/api/request-security';
import { getDriverPortalAccessNotice, requireDriverSessionContext } from '@/lib/api/driver-portal';
import { extractRefId } from '@/lib/api/data-helpers';
import { handleIncidentCreate } from '@/lib/api/operations-workflows';
import { getBusinessDateValue } from '@/lib/business-date';
import { createDocument, getDocumentById, listDocumentsByFilter, updateDocument } from '@/lib/repositories/document-store';
import type { DeliveryOrder, Incident, IncidentActionLog, IncidentSettlementCategory, IncidentSettlementLine } from '@/lib/types';

const DRIVER_ALLOWED_COST_CATEGORIES = new Set<IncidentSettlementCategory>([
    'TOWING',
    'REPAIR',
    'SPAREPART',
    'TIRE',
    'MEDICAL',
    'THIRD_PARTY_DAMAGE',
    'POLICE_ADMIN',
    'ACCOMMODATION',
    'CARGO_HANDLING',
    'OTHER',
]);

function normalizeCostAmount(value: unknown) {
    if (typeof value === 'number') {
        return Number.isFinite(value) ? Math.max(value, 0) : 0;
    }
    if (typeof value !== 'string') {
        return 0;
    }
    const normalized = value.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.');
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? Math.max(parsed, 0) : 0;
}

function normalizeCostCategory(value: unknown): IncidentSettlementCategory {
    const category = typeof value === 'string' ? value.trim().toUpperCase() : '';
    return DRIVER_ALLOWED_COST_CATEGORIES.has(category as IncidentSettlementCategory)
        ? category as IncidentSettlementCategory
        : 'OTHER';
}

function todayDateInput() {
    return getBusinessDateValue();
}

function isTripIncidentActive(incident: Pick<Incident, 'status'>) {
    return incident.status !== 'RESOLVED' && incident.status !== 'CLOSED';
}

async function ensureDriverIncidentAccess(incidentRef: string, driverId: string) {
    const incident = await getDocumentById<Incident>(incidentRef, 'incident');
    if (!incident) {
        return { error: jsonNoStore({ error: 'Insiden tidak ditemukan.' }, { status: 404 }) };
    }
    if (extractRefId(incident.driverRef) !== driverId) {
        return { error: jsonNoStore({ error: 'Insiden ini bukan milik driver yang login.' }, { status: 403 }) };
    }
    return { incident };
}

async function addAuditLog(
    actor: { _id: string; name: string; email?: string; role?: string },
    action: string,
    entityType: string,
    entityRef: string,
    summary: string
) {
    try {
        await createDocument({
            _type: 'auditLog',
            actorUserRef: actor._id,
            actorUserName: actor.name,
            actorUserEmail: actor.email,
            actorUserRole: actor.role,
            action,
            entityType,
            entityRef,
            changesSummary: summary,
            timestamp: new Date().toISOString(),
        });
    } catch {
        console.warn('Audit log write failed for driver incident report');
    }
}

export async function GET(request: Request) {
    const hasBearerAuth = Boolean(request.headers.get('authorization')?.toLowerCase().startsWith('bearer '));
    if (!hasBearerAuth) {
        const originError = ensureSameOriginRequest(request);
        if (originError) {
            return originError;
        }
    }

    try {
        const auth = await requireDriverSessionContext(request);
        if ('error' in auth) {
            return jsonNoStore({ error: auth.error }, { status: auth.status });
        }
        const driverAccessNotice = await getDriverPortalAccessNotice(auth.driver._id);
        if (driverAccessNotice?.blocking) {
            return jsonNoStore({ error: driverAccessNotice.message }, { status: 403 });
        }

        const incidents = (await listDocumentsByFilter<Incident>('incident', { driverRef: auth.driver._id }))
            .filter(incident => incident.status !== 'CLOSED')
            .sort((a, b) => (b.dateTime || '').localeCompare(a.dateTime || ''));

        const data = await Promise.all(incidents.map(async incident => {
            const settlementLines = await listDocumentsByFilter<IncidentSettlementLine>('incidentSettlementLine', {
                incidentRef: incident._id,
            });
            return {
                ...incident,
                settlementLines: settlementLines.sort((a, b) => (b.createdAt || b.date || '').localeCompare(a.createdAt || a.date || '')),
            };
        }));

        return jsonNoStore({ data });
    } catch (error) {
        console.error('Driver incident list error:', error);
        return jsonNoStore({ error: 'Terjadi kesalahan server' }, { status: 500 });
    }
}

export async function POST(request: Request) {
    const hasBearerAuth = Boolean(request.headers.get('authorization')?.toLowerCase().startsWith('bearer '));
    if (!hasBearerAuth) {
        const originError = ensureSameOriginRequest(request);
        if (originError) {
            return originError;
        }
    }

    try {
        const auth = await requireDriverSessionContext(request);
        if ('error' in auth) {
            return jsonNoStore({ error: auth.error }, { status: auth.status });
        }
        const driverAccessNotice = await getDriverPortalAccessNotice(auth.driver._id);
        if (driverAccessNotice?.blocking) {
            return jsonNoStore({ error: driverAccessNotice.message }, { status: 403 });
        }

        const parsedBody = await parseJsonBody<{
            relatedDeliveryOrderRef?: string;
            incidentType?: Incident['incidentType'];
            urgency?: Incident['urgency'];
            locationText?: string;
            odometer?: number;
            description?: string;
        }>(request);
        if ('error' in parsedBody) {
            return parsedBody.error;
        }

        const relatedDeliveryOrderRef =
            typeof parsedBody.data.relatedDeliveryOrderRef === 'string'
                ? parsedBody.data.relatedDeliveryOrderRef.trim()
                : '';
        if (!relatedDeliveryOrderRef) {
            return jsonNoStore({ error: 'Pilih trip/SJ terkait untuk laporan insiden.' }, { status: 400 });
        }

        const deliveryOrder = await getDocumentById<DeliveryOrder>(relatedDeliveryOrderRef, 'deliveryOrder');
        if (!deliveryOrder) {
            return jsonNoStore({ error: 'Trip/SJ terkait tidak ditemukan.' }, { status: 404 });
        }
        if (extractRefId(deliveryOrder.driverRef) !== auth.driver._id) {
            return jsonNoStore({ error: 'Trip/SJ ini bukan milik driver yang login.' }, { status: 403 });
        }
        const activeIncident = (await listDocumentsByFilter<Incident>('incident', {
            relatedDeliveryOrderRef,
        })).find(isTripIncidentActive);
        if (activeIncident) {
            const label = activeIncident.incidentNumber || 'insiden aktif';
            return jsonNoStore(
                {
                    error: `Trip ini masih punya ${label}. Selesaikan dan tunggu admin menutup insiden tersebut sebelum membuat laporan baru.`,
                },
                { status: 409 }
            );
        }

        return await handleIncidentCreate(
            auth.session,
            {
                relatedDeliveryOrderRef,
                relatedDONumber: deliveryOrder.doNumber,
                vehicleRef: extractRefId(deliveryOrder.vehicleRef),
                vehiclePlate: deliveryOrder.vehiclePlate,
                driverRef: auth.driver._id,
                driverName: auth.driver.name,
                incidentType: parsedBody.data.incidentType,
                urgency: parsedBody.data.urgency,
                locationText: parsedBody.data.locationText,
                odometer: parsedBody.data.odometer,
                description: parsedBody.data.description,
            },
            addAuditLog
        );
    } catch (error) {
        console.error('Driver incident report error:', error);
        return jsonNoStore({ error: 'Terjadi kesalahan server' }, { status: 500 });
    }
}

export async function PATCH(request: Request) {
    const hasBearerAuth = Boolean(request.headers.get('authorization')?.toLowerCase().startsWith('bearer '));
    if (!hasBearerAuth) {
        const originError = ensureSameOriginRequest(request);
        if (originError) {
            return originError;
        }
    }

    try {
        const auth = await requireDriverSessionContext(request);
        if ('error' in auth) {
            return jsonNoStore({ error: auth.error }, { status: auth.status });
        }
        const driverAccessNotice = await getDriverPortalAccessNotice(auth.driver._id);
        if (driverAccessNotice?.blocking) {
            return jsonNoStore({ error: driverAccessNotice.message }, { status: 403 });
        }

        const parsedBody = await parseJsonBody<{
            incidentRef?: string;
            action?: string;
            resolutionNote?: string;
            resolutionLocationText?: string;
            resolutionOdometer?: number;
            costs?: Array<{
                category?: IncidentSettlementCategory;
                amount?: number | string;
                description?: string;
                payeeName?: string;
                note?: string;
            }>;
        }>(request);
        if ('error' in parsedBody) {
            return parsedBody.error;
        }

        if (parsedBody.data.action !== 'submit-resolution') {
            return jsonNoStore({ error: 'Aksi insiden driver tidak valid.' }, { status: 400 });
        }

        const incidentRef = typeof parsedBody.data.incidentRef === 'string'
            ? parsedBody.data.incidentRef.trim()
            : '';
        if (!incidentRef) {
            return jsonNoStore({ error: 'Insiden wajib dipilih.' }, { status: 400 });
        }

        const access = await ensureDriverIncidentAccess(incidentRef, auth.driver._id);
        if ('error' in access) {
            return access.error;
        }
        const incident = access.incident;
        if (incident.status === 'CLOSED' || incident.status === 'RESOLVED') {
            return jsonNoStore({ error: 'Insiden ini sudah masuk tahap final admin.' }, { status: 409 });
        }

        const existingDriverLines = (await listDocumentsByFilter<IncidentSettlementLine>('incidentSettlementLine', {
            incidentRef: incident._id,
        })).filter(line => line.status !== 'VOID' && line.createdBy === auth.session._id);
        const hasReviewedDriverLine = existingDriverLines.some(line => line.status !== 'DRAFT');
        if (hasReviewedDriverLine) {
            return jsonNoStore({ error: 'Penyelesaian insiden sudah diajukan. Tunggu review admin.' }, { status: 409 });
        }

        const resolutionNote = typeof parsedBody.data.resolutionNote === 'string'
            ? parsedBody.data.resolutionNote.trim()
            : '';
        if (!resolutionNote) {
            return jsonNoStore({ error: 'Catatan penyelesaian insiden wajib diisi.' }, { status: 400 });
        }

        const normalizedCosts = (parsedBody.data.costs || [])
            .map(cost => ({
                category: normalizeCostCategory(cost.category),
                amount: normalizeCostAmount(cost.amount),
                description: typeof cost.description === 'string' ? cost.description.trim() : '',
                payeeName: typeof cost.payeeName === 'string' ? cost.payeeName.trim() : '',
                note: typeof cost.note === 'string' ? cost.note.trim() : '',
            }))
            .filter(cost => cost.amount > 0 || cost.description || cost.payeeName || cost.note);

        const invalidCostIndex = normalizedCosts.findIndex(cost => cost.amount <= 0 || !cost.description);
        if (invalidCostIndex >= 0) {
            return jsonNoStore({ error: `Biaya insiden baris ${invalidCostIndex + 1} wajib berisi nominal dan deskripsi.` }, { status: 400 });
        }
        const existingActionLogs = await listDocumentsByFilter<IncidentActionLog>('incidentActionLog', {
            incidentRef: incident._id,
        });
        const hasDriverResolutionLog = existingActionLogs.some(log =>
            log.userRef === auth.session._id &&
            (log.note || '').includes('Driver mengajukan penyelesaian insiden')
        );
        if (hasDriverResolutionLog && normalizedCosts.length === 0) {
            return jsonNoStore({ error: 'Penyelesaian insiden sudah diajukan. Tambahkan biaya baru jika ada perubahan sebelum review admin.' }, { status: 409 });
        }

        const now = new Date().toISOString();
        const pendingDriverResolutionPatch = {
            pendingDriverResolutionRequestedAt: now,
            pendingDriverResolutionRequestedBy: auth.session._id,
            pendingDriverResolutionRequestedByName: auth.session.name,
            pendingDriverResolutionNote: resolutionNote,
            pendingDriverResolutionCostCount: normalizedCosts.length,
            pendingDriverResolutionAmount: normalizedCosts.reduce((sum, cost) => sum + cost.amount, 0),
        };
        if (incident.status === 'OPEN') {
            await updateDocument<Incident>(incident._id, { status: 'IN_PROGRESS', ...pendingDriverResolutionPatch }, 'incident');
        } else {
            await updateDocument<Incident>(incident._id, pendingDriverResolutionPatch, 'incident');
        }

        const locationText = typeof parsedBody.data.resolutionLocationText === 'string'
            ? parsedBody.data.resolutionLocationText.trim()
            : '';
        const odometer = typeof parsedBody.data.resolutionOdometer === 'number' && Number.isFinite(parsedBody.data.resolutionOdometer)
            ? parsedBody.data.resolutionOdometer
            : 0;
        const contextNotes = [
            `Driver mengajukan penyelesaian insiden: ${resolutionNote}`,
            locationText ? `Lokasi akhir: ${locationText}` : '',
            odometer > 0 ? `Odometer akhir: ${odometer.toLocaleString('id-ID')} km` : '',
            normalizedCosts.length > 0
                ? `Biaya diajukan: ${normalizedCosts.length} baris / Rp ${normalizedCosts.reduce((sum, cost) => sum + cost.amount, 0).toLocaleString('id-ID')}`
                : 'Tidak ada biaya yang diajukan driver.',
        ].filter(Boolean).join(' | ');

        await createDocument({
            _type: 'incidentActionLog',
            incidentRef: incident._id,
            timestamp: now,
            note: contextNotes,
            userRef: auth.session._id,
            userName: auth.session.name,
        });

        const createdLines = [];
        for (const cost of normalizedCosts) {
            const created = await createDocument<IncidentSettlementLine>({
                _type: 'incidentSettlementLine',
                incidentRef: incident._id,
                incidentNumber: incident.incidentNumber,
                lineType: 'COST',
                category: cost.category,
                date: todayDateInput(),
                amount: cost.amount,
                description: cost.description,
                payeeName: cost.payeeName || undefined,
                recipientType: 'OTHER',
                note: [
                    'Diajukan driver, perlu review admin.',
                    cost.note,
                    locationText ? `Lokasi akhir: ${locationText}` : '',
                    odometer > 0 ? `Odometer akhir: ${odometer.toLocaleString('id-ID')} km` : '',
                ].filter(Boolean).join(' | '),
                status: 'DRAFT',
                createdAt: now,
                createdBy: auth.session._id,
                createdByName: auth.session.name,
            });
            createdLines.push(created);
        }

        await addAuditLog(
            auth.session,
            'UPDATE',
            'incidents',
            incident._id,
            `Driver ajukan penyelesaian insiden ${incident.incidentNumber}${createdLines.length > 0 ? ` dengan ${createdLines.length} biaya draft` : ''}`
        );

        return jsonNoStore({
            data: {
                incident: incident.status === 'OPEN'
                    ? { ...incident, status: 'IN_PROGRESS' as const, ...pendingDriverResolutionPatch }
                    : { ...incident, ...pendingDriverResolutionPatch },
                settlementLines: createdLines,
            },
        });
    } catch (error) {
        console.error('Driver incident completion request error:', error);
        return jsonNoStore({ error: 'Terjadi kesalahan server' }, { status: 500 });
    }
}
