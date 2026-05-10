import assert from 'node:assert/strict';

import {
    buildTripResourceLocks,
    isDeliveryOrderResourceLocked,
} from '../src/lib/trip-resource-lock-support';
import type { DeliveryOrder, Order } from '../src/lib/types';

const lockingStatuses: DeliveryOrder['status'][] = [
    'CREATED',
    'HEADING_TO_PICKUP',
    'ON_DELIVERY',
    'ARRIVED',
    'PARTIAL_HOLD',
    'DELIVERED',
];

for (const status of lockingStatuses) {
    assert.equal(
        isDeliveryOrderResourceLocked({
            _id: `do-${status.toLowerCase()}`,
            status,
            vehicleRef: 'veh-active',
            driverRef: 'drv-active',
        }),
        true,
        `${status} must keep vehicle and driver locked until admin closure`
    );
}

assert.equal(
    isDeliveryOrderResourceLocked({
        _id: 'do-delivered-closed',
        status: 'DELIVERED',
        vehicleRef: 'veh-free',
        driverRef: 'drv-free',
        tripClosedByAdminAt: '2026-05-10T00:00:00.000Z',
    }),
    false,
    'DELIVERED trip must be assignable again after admin closure'
);

assert.equal(
    isDeliveryOrderResourceLocked({
        _id: 'do-pending-odometer',
        status: 'ARCHIVED' as DeliveryOrder['status'],
        vehicleRef: 'veh-odo',
        driverRef: 'drv-odo',
        tripEndOdometerKm: 2000,
    }),
    true,
    'pending odometer approval must keep resources locked'
);

const activeOrder: Pick<Order, '_id' | 'masterResi' | 'status' | 'tripPlans'> = {
    _id: 'order-active',
    masterResi: 'R-ACTIVE',
    status: 'OPEN',
    tripPlans: [
        {
            _key: 'plan-unlinked',
            sequence: 1,
            date: '2026-05-10',
            issueBankRef: 'bank-001',
            cashGiven: 100000,
            vehicleRef: 'veh-plan',
            driverRef: 'drv-plan',
        },
        {
            _key: 'plan-linked',
            sequence: 2,
            date: '2026-05-10',
            issueBankRef: 'bank-001',
            cashGiven: 100000,
            vehicleRef: 'veh-linked',
            driverRef: 'drv-linked',
            linkedDeliveryOrderRef: 'do-linked',
        },
    ],
};

const lockSet = buildTripResourceLocks({
    deliveryOrders: [
        {
            _id: 'do-hold',
            status: 'PARTIAL_HOLD',
            vehicleRef: 'veh-hold',
            driverRef: 'drv-hold',
        },
        {
            _id: 'do-closed',
            status: 'DELIVERED',
            vehicleRef: 'veh-closed',
            driverRef: 'drv-closed',
            tripClosedByAdminAt: '2026-05-10T00:00:00.000Z',
        },
    ],
    orders: [activeOrder],
});

assert.ok(lockSet.busyVehicleIds.includes('veh-hold'), 'PARTIAL_HOLD DO vehicle must be busy');
assert.ok(lockSet.busyDriverIds.includes('drv-hold'), 'PARTIAL_HOLD DO driver must be busy');
assert.ok(lockSet.busyVehicleIds.includes('veh-plan'), 'unlinked active order plan vehicle must be busy');
assert.ok(lockSet.busyDriverIds.includes('drv-plan'), 'unlinked active order plan driver must be busy');
assert.ok(!lockSet.busyVehicleIds.includes('veh-closed'), 'closed delivered DO vehicle must be free');
assert.ok(!lockSet.busyVehicleIds.includes('veh-linked'), 'linked order plan must not double-lock resource');

const excludedLockSet = buildTripResourceLocks({
    orders: [activeOrder],
    excludeOrderRef: 'order-active',
    excludeOrderTripPlanKey: 'plan-unlinked',
});

assert.ok(!excludedLockSet.busyVehicleIds.includes('veh-plan'), 'current order plan must be excluded while creating its DO');

console.log('Trip resource lock audit passed.');
