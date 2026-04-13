import { NextResponse } from 'next/server';

import { getBusinessDateValue } from '@/lib/business-date';
import { computeDriverScoreDueDate, parseDriverScoreDayCount } from '@/lib/driver-scoring-support';
import { getSanityClient, sanityCreate, sanityGetById, sanityUpdate } from '@/lib/sanity';
import { extractRefId } from './data-helpers';

import { assertIsoDate, normalizeOptionalText, type ApiSession } from './data-helpers';

type AuditLogFn = (
    session: Pick<ApiSession, '_id' | 'name'>,
    action: string,
    entityType: string,
    entityRef: string,
    summary: string
) => void | Promise<void>;

type DriverScoreDocument = {
    _id: string;
    driverRef: string | { _ref?: string };
    driverName?: string;
    scoreType: 'WARNING' | 'DAYS';
    effectiveDate: string;
    durationDays: number;
    dueDate: string;
    notes?: string;
    warningAcknowledgedAt?: string;
    warningAcknowledgedByDriverRef?: string;
    createdAt: string;
};

async function fetchCurrentDriverScore(driverRef: string, today: string) {
    return getSanityClient().fetch<DriverScoreDocument | null>(
        `*[
            _type == "driverScore" &&
            (driverRef == $driverRef || driverRef._ref == $driverRef) &&
            (
                (scoreType != "WARNING" && effectiveDate <= $today && dueDate >= $today) ||
                (scoreType == "WARNING" && effectiveDate <= $today && (
                    !defined(warningAcknowledgedAt) ||
                    warningAcknowledgedAt == null ||
                    warningAcknowledgedAt == ""
                ))
            )
        ] | order(effectiveDate desc, _createdAt desc)[0]`,
        { driverRef, today }
    );
}

export async function getCurrentDriverScore(driverRef: string, today = getBusinessDateValue()) {
    return fetchCurrentDriverScore(driverRef, today);
}

export async function acknowledgeDriverWarningScore(scoreId: string, driverRef: string) {
    const current = await sanityGetById<DriverScoreDocument>(scoreId);
    if (
        !current ||
        extractRefId(current.driverRef) !== driverRef ||
        current.scoreType !== 'WARNING'
    ) {
        return null;
    }
    if (current.warningAcknowledgedAt) {
        return current;
    }

    return sanityUpdate(scoreId, {
        warningAcknowledgedAt: new Date().toISOString(),
        warningAcknowledgedByDriverRef: driverRef,
    });
}

async function validateDriverScorePayload(
    data: Record<string, unknown>,
    session: ApiSession,
    options?: { existing?: DriverScoreDocument | null }
) {
    const existing = options?.existing ?? null;
    const driverRefInput =
        typeof data.driverRef === 'string'
            ? data.driverRef.trim()
            : extractRefId(existing?.driverRef) || '';
    if (!driverRefInput) {
        throw new Error('Supir wajib dipilih');
    }

    const driver = await sanityGetById<{ _id: string; name?: string; active?: boolean }>(driverRefInput);
    if (!driver) {
        throw new Error('Supir tidak ditemukan');
    }
    if (driver.active === false) {
        throw new Error('Hanya supir aktif yang bisa diberi warning atau skors');
    }

    const effectiveDate =
        typeof data.effectiveDate === 'string' && data.effectiveDate.trim()
            ? data.effectiveDate.trim()
            : existing?.effectiveDate || getBusinessDateValue();
    assertIsoDate(effectiveDate, 'Tanggal mulai skors');

    const rawDuration =
        data.durationDays !== undefined
            ? parseDriverScoreDayCount(data.durationDays)
            : existing?.durationDays ?? NaN;
    const scoreType =
        typeof data.scoreType === 'string'
            ? data.scoreType.trim().toUpperCase()
            : existing?.scoreType || '';
    if (scoreType !== 'WARNING' && scoreType !== 'DAYS') {
        throw new Error('Jenis scoring supir tidak valid');
    }

    const normalizedDuration = scoreType === 'WARNING' ? 1 : rawDuration;
    if (!Number.isFinite(normalizedDuration) || normalizedDuration <= 0) {
        throw new Error('Durasi skors harus lebih besar dari 0 hari');
    }
    if (normalizedDuration > 3650) {
        throw new Error('Durasi skors terlalu panjang');
    }

    const dueDate = computeDriverScoreDueDate(effectiveDate, normalizedDuration);
    if (!dueDate) {
        throw new Error('Periode skors tidak valid');
    }
    const hasNotesField = Object.prototype.hasOwnProperty.call(data, 'notes');

    const overlap = await getSanityClient().fetch<{ _id: string } | null>(
        existing?._id
            ? `*[
                _type == "driverScore" &&
                (driverRef == $driverRef || driverRef._ref == $driverRef) &&
                _id != $excludeId &&
                (
                    (scoreType != "WARNING" && effectiveDate <= $dueDate && dueDate >= $effectiveDate) ||
                    (scoreType == "WARNING" && effectiveDate <= $dueDate && (
                        !defined(warningAcknowledgedAt) ||
                        warningAcknowledgedAt == null ||
                        warningAcknowledgedAt == ""
                    ))
                )
            ][0]{ _id }`
            : `*[
                _type == "driverScore" &&
                (driverRef == $driverRef || driverRef._ref == $driverRef) &&
                (
                    (scoreType != "WARNING" && effectiveDate <= $dueDate && dueDate >= $effectiveDate) ||
                    (scoreType == "WARNING" && effectiveDate <= $dueDate && (
                        !defined(warningAcknowledgedAt) ||
                        warningAcknowledgedAt == null ||
                        warningAcknowledgedAt == ""
                    ))
                )
            ][0]{ _id }`,
        existing?._id
            ? { driverRef: driverRefInput, effectiveDate, dueDate, excludeId: existing._id }
            : { driverRef: driverRefInput, effectiveDate, dueDate }
    );
    if (overlap) {
        throw new Error('Periode skors bentrok dengan warning/skors supir yang sudah ada');
    }

    return {
        driverRef: driver._id,
        driverName: driver.name || existing?.driverName,
        scoreType,
        effectiveDate,
        durationDays: normalizedDuration,
        dueDate,
        notes: hasNotesField ? normalizeOptionalText(data.notes) : existing?.notes,
        warningAcknowledgedAt:
            scoreType === 'WARNING'
                ? existing?.warningAcknowledgedAt
                : undefined,
        warningAcknowledgedByDriverRef:
            scoreType === 'WARNING'
                ? existing?.warningAcknowledgedByDriverRef
                : undefined,
        updatedAt: new Date().toISOString(),
        updatedBy: session._id,
        updatedByName: session.name,
    };
}

export async function handleDriverScoreCreate(
    session: ApiSession,
    data: Record<string, unknown>,
    addAuditLog: AuditLogFn
) {
    try {
        const normalized = await validateDriverScorePayload(data, session);
        const createdAt = new Date().toISOString();
        const created = await sanityCreate({
            _type: 'driverScore',
            ...normalized,
            createdAt,
            createdBy: session._id,
            createdByName: session.name,
        });

        await addAuditLog(
            session,
            'CREATE',
            'driver-scores',
            (created as { _id: string })._id,
            `Tambah scoring supir ${normalized.driverName || normalized.driverRef}: ${normalized.scoreType}${normalized.scoreType === 'DAYS' ? ` ${normalized.durationDays} hari` : ''}`
        );

        return NextResponse.json({ data: created });
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Data skors supir tidak valid' },
            { status: 400 }
        );
    }
}

export async function handleDriverScoreUpdate(
    session: ApiSession,
    id: string,
    updates: Record<string, unknown>,
    addAuditLog: AuditLogFn
) {
    const existing = await sanityGetById<DriverScoreDocument>(id);
    if (!existing) {
        return NextResponse.json({ error: 'Data skors supir tidak ditemukan' }, { status: 404 });
    }

    try {
        const normalized = await validateDriverScorePayload(updates, session, { existing });
        const updated = await sanityUpdate(id, normalized);
        await addAuditLog(
            session,
            'UPDATE',
            'driver-scores',
            id,
            `Perbarui scoring supir ${normalized.driverName || normalized.driverRef}: ${normalized.scoreType}${normalized.scoreType === 'DAYS' ? ` ${normalized.durationDays} hari` : ''}`
        );
        return NextResponse.json({ data: updated });
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Data skors supir tidak valid' },
            { status: 400 }
        );
    }
}

export async function handleDriverScoreEndEarly(
    session: ApiSession,
    data: Record<string, unknown>,
    addAuditLog: AuditLogFn
) {
    const id = typeof data.id === 'string' ? data.id : '';
    if (!id) return NextResponse.json({ error: 'Data skors supir tidak valid' }, { status: 400 });

    const existing = await sanityGetById<DriverScoreDocument>(id);
    if (!existing) return NextResponse.json({ error: 'Data skors supir tidak ditemukan' }, { status: 404 });

    let updates: Record<string, unknown> = {};
    if (existing.scoreType === 'WARNING') {
        updates = { warningAcknowledgedAt: new Date().toISOString() };
    } else {
        // Use getBusinessDateValue() (timezone-aware) instead of new Date() (UTC)
        // to avoid setting dueDate to 2 days ago for UTC+7 users at midnight.
        const todayStr = getBusinessDateValue();
        const [year, month, day] = todayStr.split('-').map(Number);
        const todayDate = new Date(Date.UTC(year, month - 1, day));
        todayDate.setUTCDate(todayDate.getUTCDate() - 1);
        const yyyy = todayDate.getUTCFullYear();
        const mm = String(todayDate.getUTCMonth() + 1).padStart(2, '0');
        const dd = String(todayDate.getUTCDate()).padStart(2, '0');
        updates = { dueDate: `${yyyy}-${mm}-${dd}` };
    }

    try {
        const updated = await sanityUpdate(id, updates);
        await addAuditLog(
            session,
            'UPDATE',
            'driver-scores',
            id,
            `Mengakhiri skors lebih awal untuk supir ${existing.driverName || existing.driverRef}`
        );
        return NextResponse.json({ data: updated });
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Gagal memperbarui status skors' },
            { status: 500 }
        );
    }
}
