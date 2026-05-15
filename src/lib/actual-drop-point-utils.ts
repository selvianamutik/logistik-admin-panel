import type { DeliveryActualDropPoint } from '@/lib/types';

export function isHoldContinuationStopType(stopType?: string | null) {
    return stopType === 'HOLD' || stopType === 'TRANSIT';
}

export function getActualDropPointSequence(
    point: Pick<DeliveryActualDropPoint, 'sequence'>,
    pointIndex: number
) {
    return Number.isFinite(point.sequence) ? Number(point.sequence) : pointIndex + 1;
}

export function findLatestActualDropPoint<T extends Pick<DeliveryActualDropPoint, 'sequence'>>(
    points: readonly T[],
    predicate: (point: T, pointIndex: number) => boolean
) {
    return points
        .map((point, pointIndex) => ({ point, pointIndex }))
        .filter(({ point, pointIndex }) => predicate(point, pointIndex))
        .sort((left, right) => {
            const leftSequence = getActualDropPointSequence(left.point, left.pointIndex);
            const rightSequence = getActualDropPointSequence(right.point, right.pointIndex);
            return rightSequence - leftSequence || right.pointIndex - left.pointIndex;
        })[0]?.point;
}
