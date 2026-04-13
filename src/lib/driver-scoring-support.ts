import { getBusinessDateValue } from './business-date';
import { DEFAULT_PAGE_SIZE } from './pagination';
import type { DriverScore } from './types';

export type DriverScoreStatus = 'ACTIVE' | 'DUE_TODAY' | 'EXPIRED' | 'UPCOMING' | 'ACKNOWLEDGED';
export type DriverScoreType = DriverScore['scoreType'];

export type DriverScoreFormState = {
    driverRef: string;
    scoreType: DriverScoreType;
    effectiveDate: string;
    durationDays?: string;
    notes: string;
};

export const DRIVER_SCORE_TYPE_OPTIONS: Array<{ value: DriverScoreType; label: string }> = [
    { value: 'WARNING', label: 'Warning' },
    { value: 'DAYS', label: 'Skors Hari' },
];

export const DRIVER_SCORE_TYPE_META: Record<DriverScoreType, { label: string; badgeClass: string }> = {
    WARNING: { label: 'Warning', badgeClass: 'badge-warning' },
    DAYS: { label: 'Skors Hari', badgeClass: 'badge-danger' },
};

export type DriverScoreSummary = {
    score: DriverScore;
    status: DriverScoreStatus;
};

function compareIsoDate(left?: string, right?: string) {
    return `${left || ''}`.localeCompare(`${right || ''}`);
}

export function createDefaultDriverScoreForm(driverRef = ''): DriverScoreFormState {
    return {
        driverRef,
        scoreType: 'WARNING',
        effectiveDate: getBusinessDateValue(),
        notes: '',
    };
}

export function parseDriverScoreDayCount(value: unknown) {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return Math.trunc(value);
    }
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) return NaN;
        if (!/^\d+$/.test(trimmed)) return NaN;
        return Number(trimmed);
    }
    return NaN;
}

export function computeDriverScoreDueDate(effectiveDate: string, durationDays: number) {
    const [year, month, day] = effectiveDate.split('-').map(Number);
    if (!year || !month || !day || !Number.isFinite(durationDays) || durationDays <= 0) {
        return '';
    }

    const date = new Date(Date.UTC(year, month - 1, day));
    date.setUTCDate(date.getUTCDate() + durationDays - 1);
    const nextYear = date.getUTCFullYear();
    const nextMonth = `${date.getUTCMonth() + 1}`.padStart(2, '0');
    const nextDay = `${date.getUTCDate()}`.padStart(2, '0');
    return `${nextYear}-${nextMonth}-${nextDay}`;
}

export function resolveDriverScoreStatus(
    score: Pick<DriverScore, 'scoreType' | 'effectiveDate' | 'dueDate' | 'warningAcknowledgedAt'>,
    today = getBusinessDateValue()
): DriverScoreStatus {
    if (score.scoreType === 'WARNING' && score.warningAcknowledgedAt) {
        return 'ACKNOWLEDGED';
    }
    if (score.effectiveDate > today) {
        return 'UPCOMING';
    }
    if (score.dueDate < today) {
        return 'EXPIRED';
    }
    if (score.dueDate === today) {
        return 'DUE_TODAY';
    }
    return 'ACTIVE';
}

export function getDriverScoreStatusMeta(
    score: Pick<DriverScore, 'scoreType' | 'effectiveDate' | 'dueDate' | 'warningAcknowledgedAt'>,
    today = getBusinessDateValue()
) {
    const status = resolveDriverScoreStatus(score, today);
    const typeMeta = DRIVER_SCORE_TYPE_META[score.scoreType];

    if (status === 'UPCOMING') {
        return { label: `${typeMeta.label} terjadwal`, badgeClass: 'badge-info' };
    }
    if (status === 'ACKNOWLEDGED') {
        return { label: 'Warning sudah dibaca', badgeClass: 'badge-gray' };
    }
    if (status === 'EXPIRED') {
        return { label: `${typeMeta.label} selesai`, badgeClass: 'badge-gray' };
    }
    if (status === 'DUE_TODAY') {
        return { label: `${typeMeta.label} sampai hari ini`, badgeClass: score.scoreType === 'DAYS' ? 'badge-danger' : 'badge-warning' };
    }
    return {
        label: typeMeta.label,
        badgeClass: typeMeta.badgeClass,
    };
}

export function getLatestDriverScoreSummary(scores: DriverScore[], today = getBusinessDateValue()): DriverScoreSummary | null {
    if (scores.length === 0) {
        return null;
    }

    const statusPriority: Record<DriverScoreStatus, number> = {
        ACTIVE: 0,
        DUE_TODAY: 1,
        UPCOMING: 2,
        ACKNOWLEDGED: 3,
        EXPIRED: 4,
    };
    const sorted = scores
        .slice()
        .sort((left, right) => {
            const leftStatus = resolveDriverScoreStatus(left, today);
            const rightStatus = resolveDriverScoreStatus(right, today);
            if (statusPriority[leftStatus] !== statusPriority[rightStatus]) {
                return statusPriority[leftStatus] - statusPriority[rightStatus];
            }

            const byEffectiveDate = compareIsoDate(right.effectiveDate, left.effectiveDate);
            if (byEffectiveDate !== 0) {
                return byEffectiveDate;
            }
            const byDueDate = compareIsoDate(right.dueDate, left.dueDate);
            if (byDueDate !== 0) {
                return byDueDate;
            }
            return compareIsoDate(right.createdAt, left.createdAt);
        });

    const score = sorted[0];
    return {
        score,
        status: resolveDriverScoreStatus(score, today),
    };
}

export function buildDriverScoreSummaryMap(scores: DriverScore[], today = getBusinessDateValue()) {
    const grouped = new Map<string, DriverScore[]>();
    scores.forEach(score => {
        const current = grouped.get(score.driverRef) || [];
        current.push(score);
        grouped.set(score.driverRef, current);
    });

    return new Map(
        Array.from(grouped.entries()).map(([driverRef, driverScores]) => [
            driverRef,
            getLatestDriverScoreSummary(driverScores, today),
        ])
    );
}

export function buildDriverScoresQuery(params: {
    page?: number;
    pageSize?: number;
    driverRef?: string;
    search?: string;
}) {
    const query = new URLSearchParams({
        entity: 'driver-scores',
        page: String(params.page ?? 1),
        pageSize: String(params.pageSize ?? DEFAULT_PAGE_SIZE),
        sortField: 'effectiveDate',
        sortDir: 'desc',
    });

    if (params.driverRef?.trim()) {
        query.set('filter', JSON.stringify({ driverRef: params.driverRef.trim() }));
    }

    if (params.search?.trim()) {
        query.set('q', params.search.trim());
        query.set('searchFields', 'driverName,notes');
    }

    return query.toString();
}
