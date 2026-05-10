import type { DeliveryOrder, Order, OrderTripPlan } from '@/lib/types';

export type DeliveryOrderResourceLock = Pick<
    DeliveryOrder,
    | '_id'
    | 'status'
    | 'vehicleRef'
    | 'vehiclePlate'
    | 'driverRef'
    | 'driverName'
> &
    Partial<Pick<
        DeliveryOrder,
        | 'doNumber'
        | 'pendingDriverStatus'
        | 'pendingDriverRequests'
        | 'tripClosedByAdminAt'
        | 'tripEndOdometerKm'
        | 'odometerConfirmedAt'
    >> &
    Partial<{
        sourceDeliveryOrderRef: string;
    }>;

type OrderResourceLock = Pick<Order, '_id' | 'masterResi' | 'status' | 'tripPlans'>;

export type TripResourceLockSource =
    | {
        source: 'deliveryOrder';
        sourceRef: string;
        label: string;
        vehicleRef?: string;
        driverRef?: string;
    }
    | {
        source: 'orderTripPlan';
        sourceRef: string;
        tripPlanKey?: string;
        label: string;
        vehicleRef?: string;
        driverRef?: string;
    };

const LOCKING_DELIVERY_ORDER_STATUSES = new Set<DeliveryOrder['status']>([
    'CREATED',
    'HEADING_TO_PICKUP',
    'ON_DELIVERY',
    'ARRIVED',
    'PARTIAL_HOLD',
    'DELIVERED',
]);

const LOCKING_ORDER_STATUSES = new Set<Order['status']>(['OPEN', 'PARTIAL', 'ON_HOLD']);

export function isDeliveryOrderResourceLocked(order: DeliveryOrderResourceLock) {
    if (!order || order.status === 'CANCELLED' || order.tripClosedByAdminAt) {
        return false;
    }

    if (LOCKING_DELIVERY_ORDER_STATUSES.has(order.status)) {
        return true;
    }

    const hasPendingDriverRequest =
        Boolean(order.pendingDriverStatus) ||
        (Array.isArray(order.pendingDriverRequests) && order.pendingDriverRequests.length > 0);
    const hasPendingOdometerApproval =
        typeof order.tripEndOdometerKm === 'number' &&
        order.tripEndOdometerKm > 0 &&
        !order.odometerConfirmedAt;

    return hasPendingDriverRequest || hasPendingOdometerApproval;
}

export function isOrderTripPlanResourceLocked(order: OrderResourceLock, plan: OrderTripPlan) {
    if (!order || !LOCKING_ORDER_STATUSES.has(order.status)) {
        return false;
    }

    // After a plan has produced a DO, the linked DO owns the lock lifecycle.
    if (plan.linkedDeliveryOrderRef) {
        return false;
    }

    return Boolean(plan.vehicleRef || plan.driverRef);
}

export function buildDeliveryOrderResourceLockSources(
    deliveryOrders: DeliveryOrderResourceLock[],
    options: { excludeDeliveryOrderRef?: string } = {}
): TripResourceLockSource[] {
    return deliveryOrders
        .filter(order =>
            order._id !== options.excludeDeliveryOrderRef &&
            (!options.excludeDeliveryOrderRef || order.sourceDeliveryOrderRef !== options.excludeDeliveryOrderRef)
        )
        .filter(isDeliveryOrderResourceLocked)
        .map(order => ({
            source: 'deliveryOrder' as const,
            sourceRef: order._id,
            label: order.doNumber || order._id,
            vehicleRef: order.vehicleRef,
            driverRef: order.driverRef,
        }));
}

export function buildOrderTripPlanResourceLockSources(
    orders: OrderResourceLock[],
    options: { excludeOrderRef?: string; excludeOrderTripPlanKey?: string } = {}
): TripResourceLockSource[] {
    const sources: TripResourceLockSource[] = [];

    for (const order of orders) {
        for (const [index, plan] of (order.tripPlans || []).entries()) {
            const tripPlanKey = plan._key || `order-trip-${index + 1}`;
            if (
                order._id === options.excludeOrderRef &&
                tripPlanKey === options.excludeOrderTripPlanKey
            ) {
                continue;
            }
            if (!isOrderTripPlanResourceLocked(order, plan)) {
                continue;
            }
            sources.push({
                source: 'orderTripPlan',
                sourceRef: order._id,
                tripPlanKey,
                label: `${order.masterResi || order._id} / Trip ${plan.sequence || index + 1}`,
                vehicleRef: plan.vehicleRef,
                driverRef: plan.driverRef,
            });
        }
    }

    return sources;
}

export function buildTripResourceLockIds(sources: TripResourceLockSource[]) {
    const busyVehicleIds = new Set<string>();
    const busyDriverIds = new Set<string>();

    for (const source of sources) {
        if (source.vehicleRef) {
            busyVehicleIds.add(source.vehicleRef);
        }
        if (source.driverRef) {
            busyDriverIds.add(source.driverRef);
        }
    }

    return {
        busyVehicleIds: Array.from(busyVehicleIds),
        busyDriverIds: Array.from(busyDriverIds),
    };
}

export function buildTripResourceLocks(params: {
    deliveryOrders?: DeliveryOrderResourceLock[];
    orders?: OrderResourceLock[];
    excludeDeliveryOrderRef?: string;
    excludeOrderRef?: string;
    excludeOrderTripPlanKey?: string;
}) {
    const sources = [
        ...buildDeliveryOrderResourceLockSources(params.deliveryOrders || [], {
            excludeDeliveryOrderRef: params.excludeDeliveryOrderRef,
        }),
        ...buildOrderTripPlanResourceLockSources(params.orders || [], {
            excludeOrderRef: params.excludeOrderRef,
            excludeOrderTripPlanKey: params.excludeOrderTripPlanKey,
        }),
    ];

    return {
        sources,
        ...buildTripResourceLockIds(sources),
    };
}
