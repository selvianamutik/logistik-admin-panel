import {
    findLatestActualDropPoint,
    getActualDropPointSequence,
    isHoldContinuationStopType,
} from '../src/lib/actual-drop-point-utils';
import type { DeliveryActualDropPoint } from '../src/lib/types';

function assert(condition: unknown, message: string) {
    if (!condition) {
        throw new Error(message);
    }
}

const points: DeliveryActualDropPoint[] = [
    {
        sequence: 1,
        stopType: 'HOLD',
        deliveryOrderItemRef: 'item-1',
        locationName: 'Gudang Transit Pertama',
        qtyKoli: 10,
    },
    {
        sequence: 2,
        stopType: 'DROP',
        deliveryOrderItemRef: 'item-1',
        locationName: 'Customer Antara',
        qtyKoli: 2,
    },
    {
        sequence: 3,
        stopType: 'TRANSIT',
        deliveryOrderItemRef: 'item-1',
        locationName: 'Gudang Transit Terbaru',
        qtyKoli: 8,
    },
    {
        sequence: 4,
        stopType: 'DROP',
        deliveryOrderItemRef: 'item-1',
        originLocationName: 'Gudang Transit Terbaru',
        locationName: 'Customer Final',
        qtyKoli: 8,
    },
];

const latestHold = findLatestActualDropPoint(points, point =>
    isHoldContinuationStopType(point.stopType) &&
    point.deliveryOrderItemRef === 'item-1'
);

assert(
    latestHold?.locationName === 'Gudang Transit Terbaru',
    'Hold continuation harus memakai HOLD/TRANSIT terbaru untuk cargo yang sama.'
);

const finalDrop = points[3];
const finalDropIndex = points.indexOf(finalDrop);
const finalDropSequence = getActualDropPointSequence(finalDrop, finalDropIndex);
const inferredPreviousHold = findLatestActualDropPoint(points, (candidate, candidateIndex) => {
    if (!isHoldContinuationStopType(candidate.stopType)) {
        return false;
    }
    if (candidate.deliveryOrderItemRef !== finalDrop.deliveryOrderItemRef) {
        return false;
    }
    const candidateSequence = getActualDropPointSequence(candidate, candidateIndex);
    return candidateSequence < finalDropSequence ||
        (candidateSequence === finalDropSequence && candidateIndex < finalDropIndex);
});

assert(
    inferredPreviousHold?.locationName === 'Gudang Transit Terbaru',
    'Invoice origin fallback harus membaca hold terakhir sebelum drop final.'
);

console.log('Audit hold continuation origin passed.');
