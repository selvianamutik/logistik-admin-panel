import type { DeliveryOrder, Order, OrderTripPlan } from '@/lib/types';
import { listDocumentsByFilter } from '@/lib/repositories/document-store';
import {
    buildDeliveryOrderResourceLockSources,
    buildOrderTripPlanResourceLockSources,
    type TripResourceLockSource,
} from '@/lib/trip-resource-lock-support';

type TripResourceCandidate = Pick<
    OrderTripPlan,
    'vehicleRef' | 'vehiclePlate' | 'driverRef' | 'driverName' | '_key' | 'sequence'
>;

const LOCKING_DELIVERY_ORDER_STATUS_FILTER: DeliveryOrder['status'][] = [
    'CREATED',
    'ON_DELIVERY',
    'ARRIVED',
    'PARTIAL_HOLD',
    'DELIVERED',
];

const LOCKING_ORDER_STATUS_FILTER: Order['status'][] = ['OPEN', 'PARTIAL'];

function describeTripCandidate(candidate: TripResourceCandidate, index: number) {
    return `Trip ${candidate.sequence || index + 1}`;
}

function describeResourceConflict(type: 'vehicle' | 'driver', candidate: TripResourceCandidate, source: TripResourceLockSource) {
    const resourceLabel = type === 'vehicle'
        ? candidate.vehiclePlate || candidate.vehicleRef || 'Kendaraan'
        : candidate.driverName || candidate.driverRef || 'Supir';
    const sourceLabel = source.label || source.sourceRef;
    const resourceName = type === 'vehicle' ? 'Kendaraan' : 'Supir';
    return `${resourceName} ${resourceLabel} masih terkunci di ${sourceLabel}. Selesaikan approval/finalisasi admin sebelum dipakai lagi.`;
}

export async function assertTripResourcesAssignable(
    candidates: TripResourceCandidate[],
    options: { excludeOrderRef?: string; excludeOrderTripPlanKey?: string; excludeDeliveryOrderRef?: string } = {}
) {
    const normalizedCandidates = candidates.filter(candidate => candidate.vehicleRef || candidate.driverRef);
    if (normalizedCandidates.length === 0) {
        return;
    }

    const seenVehicles = new Map<string, string>();
    const seenDrivers = new Map<string, string>();
    for (const [index, candidate] of normalizedCandidates.entries()) {
        const candidateLabel = describeTripCandidate(candidate, index);
        if (candidate.vehicleRef) {
            const existing = seenVehicles.get(candidate.vehicleRef);
            if (existing) {
                throw new Error(`Kendaraan ${candidate.vehiclePlate || candidate.vehicleRef} dipilih ganda di ${existing} dan ${candidateLabel}.`);
            }
            seenVehicles.set(candidate.vehicleRef, candidateLabel);
        }
        if (candidate.driverRef) {
            const existing = seenDrivers.get(candidate.driverRef);
            if (existing) {
                throw new Error(`Supir ${candidate.driverName || candidate.driverRef} dipilih ganda di ${existing} dan ${candidateLabel}.`);
            }
            seenDrivers.set(candidate.driverRef, candidateLabel);
        }
    }

    const [deliveryOrders, orders] = await Promise.all([
        listDocumentsByFilter<DeliveryOrder>('deliveryOrder', { status: LOCKING_DELIVERY_ORDER_STATUS_FILTER }),
        listDocumentsByFilter<Order>('order', { status: LOCKING_ORDER_STATUS_FILTER }),
    ]);

    const lockSources = [
        ...buildDeliveryOrderResourceLockSources(deliveryOrders, {
            excludeDeliveryOrderRef: options.excludeDeliveryOrderRef,
        }),
        ...buildOrderTripPlanResourceLockSources(orders, {
            excludeOrderRef: options.excludeOrderRef,
            excludeOrderTripPlanKey: options.excludeOrderTripPlanKey,
        }),
    ];

    for (const candidate of normalizedCandidates) {
        if (candidate.vehicleRef) {
            const conflict = lockSources.find(source => source.vehicleRef === candidate.vehicleRef);
            if (conflict) {
                throw new Error(describeResourceConflict('vehicle', candidate, conflict));
            }
        }
        if (candidate.driverRef) {
            const conflict = lockSources.find(source => source.driverRef === candidate.driverRef);
            if (conflict) {
                throw new Error(describeResourceConflict('driver', candidate, conflict));
            }
        }
    }
}

