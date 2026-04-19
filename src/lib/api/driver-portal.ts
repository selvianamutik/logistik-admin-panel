import { getDriverSession, getSession, getSessionFromToken } from '@/lib/auth';
import { getBusinessDateValue } from '@/lib/business-date';
import { getDriverScoreStatusMeta } from '@/lib/driver-scoring-support';
import { getCurrentDriverScore } from '@/lib/api/driver-score-workflows';
import { getSanityClient, sanityGetById, sanityGetCompanyProfile } from '@/lib/sanity';
import { resolveOrderCargoEntryMode } from '@/lib/order-cargo-entry-mode';
import type {
    CompanyProfile,
    CustomerProduct,
    DeliveryOrder,
    DeliveryOrderItem,
    Driver,
    DriverScore,
    OrderPickupStop,
    OrderTripPlan,
    SessionUser,
    User,
} from '@/lib/types';
import { normalizeUserRole, type InternalUserRole } from '@/lib/rbac';

export type DriverSessionContext = {
    session: SessionUser;
    user: User;
    driver: Driver;
};

export type DriverAssignedDeliveryOrderCargoItem = DeliveryOrderItem;

export type DriverAssignedDeliveryOrder = DeliveryOrder & {
    driverCargoItems?: DriverAssignedDeliveryOrderCargoItem[];
    allowsDirectCargoInput?: boolean;
};

export type DriverAssignedTripPlanPickupStop = {
    _key: string;
    sequence: number;
    pickupLabel?: string;
    pickupAddress: string;
    notes?: string;
};

export type DriverAssignedTripPlan = {
    orderRef: string;
    masterResi?: string;
    customerRef?: string;
    customerName?: string;
    serviceName?: string;
    pickupAddress?: string;
    tripPlanKey: string;
    tripSequence: number;
    pickupStops: DriverAssignedTripPlanPickupStop[];
    vehicleRef?: string;
    vehiclePlate?: string;
    driverRef?: string;
    driverName?: string;
    tripOriginArea?: string;
    tripDestinationArea?: string;
    taripBorongan?: number;
    cashGiven?: number;
    issueBankName?: string;
    date?: string;
    notes?: string;
    linkedDeliveryOrderRef?: string;
    linkedDeliveryOrderNumber?: string;
    linkedDeliveryOrderStatus?: DeliveryOrder['status'] | 'UNKNOWN';
    allowsDirectCargoInput?: boolean;
};

export type DriverPortalAccessNotice = {
    scoreId: string;
    scoreType: DriverScore['scoreType'];
    title: string;
    message: string;
    blocking: boolean;
    effectiveDate: string;
    dueDate: string;
    durationDays: number;
    notes?: string;
    warningAcknowledgedAt?: string;
};

export async function requireInternalSession(allowedRoles?: InternalUserRole[]) {
    const session = await getSession();
    if (!session) {
        return { error: 'Unauthorized', status: 401 } as const;
    }
    const normalizedRole = normalizeUserRole(session.role);
    if (normalizedRole === 'DRIVER') {
        return { error: 'Forbidden', status: 403 } as const;
    }
    if (allowedRoles && !allowedRoles.includes(normalizedRole)) {
        return { error: 'Forbidden', status: 403 } as const;
    }
    return { session } as const;
}

function getBearerToken(request?: Request) {
    if (!request) return null;
    const authorization = request.headers.get('authorization') || '';
    const [scheme, token] = authorization.split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !token) {
        return null;
    }
    return token.trim() || null;
}

export function hasBearerDriverAuth(request?: Request) {
    return Boolean(getBearerToken(request));
}

export async function requireDriverSessionContext(request?: Request): Promise<DriverSessionContext | { error: string; status: number }> {
    const bearerToken = getBearerToken(request);
    const session = bearerToken ? await getSessionFromToken(bearerToken) : await getDriverSession();
    if (!session) {
        return { error: 'Unauthorized', status: 401 };
    }
    if (session.role !== 'DRIVER' || !session.driverRef) {
        return { error: 'Forbidden', status: 403 };
    }

    const user = await sanityGetById<User>(session._id);
    if (!user || user.role !== 'DRIVER' || !user.driverRef || user.active === false) {
        return { error: 'Akun driver tidak aktif', status: 403 };
    }

    const driver = await sanityGetById<Driver>(user.driverRef);
    if (!driver || driver.active === false) {
        return { error: 'Data supir tidak aktif atau tidak ditemukan', status: 403 };
    }

    return { session, user, driver };
}

export async function getDriverAppContext() {
    const company = await sanityGetCompanyProfile() as CompanyProfile | null;
    return {
        company: company
            ? {
                _id: company._id,
                name: company.name,
                phone: company.phone,
                themeColor: company.themeColor,
            }
            : null,
    };
}

export async function getDriverPortalAccessNotice(driverRef: string): Promise<DriverPortalAccessNotice | null> {
    const score = await getCurrentDriverScore(driverRef, getBusinessDateValue());
    if (!score) {
        return null;
    }

    const statusMeta = getDriverScoreStatusMeta(score);
    const blocking = score.scoreType === 'DAYS';
    const title = blocking ? 'Akses aplikasi ditangguhkan' : 'Peringatan untuk akun driver';
    const baseMessage = blocking
        ? `Akun driver ini sedang diskors sampai ${score.dueDate || 'waktu yang belum ditentukan'}. Akses aplikasi ditutup sementara.`
        : `Akun driver ini mendapat warning aktif yang perlu dibaca.`;
    const noteText = score.notes ? ` Catatan admin: ${score.notes}` : '';

    return {
        scoreId: score._id,
        scoreType: score.scoreType,
        title,
        message: `${baseMessage}${noteText} (${statusMeta.label})`,
        blocking,
        effectiveDate: score.effectiveDate,
        dueDate: score.dueDate,
        durationDays: score.durationDays,
        notes: score.notes,
        warningAcknowledgedAt: score.warningAcknowledgedAt,
    };
}

export async function getDriverAssignedDeliveryOrders(driverRef: string) {
    return getSanityClient().fetch<DriverAssignedDeliveryOrder[]>(
        `*[
            _type == "deliveryOrder" &&
            (driverRef == $driverRef || driverRef._ref == $driverRef) &&
            status in ["CREATED", "HEADING_TO_PICKUP", "ON_DELIVERY", "ARRIVED"]
        ] | order(date desc, _createdAt desc){
            _id,
            orderRef,
            doNumber,
            customerDoNumber,
            date,
            status,
            trackingState,
            masterResi,
            customerRef,
            "customerName": coalesce(customerName, orderRef->customerName),
            "receiverName": coalesce(receiverName, orderRef->receiverName),
            "receiverAddress": coalesce(receiverAddress, orderRef->receiverAddress),
            "pickupAddress": coalesce(pickupAddress, orderRef->pickupAddress),
            pickupStops,
            shipperReferences,
            notes,
            vehiclePlate,
            driverName,
            trackingStartedAt,
            trackingStoppedAt,
            trackingLastSeenAt,
            trackingLastLat,
            trackingLastLng,
            trackingLastAccuracyM,
            trackingLastSpeedKph,
            pendingDriverStatus,
            pendingDriverStatusRequestedAt,
            pendingDriverStatusRequestedByName,
            pendingDriverStatusNote,
            pendingDriverActualCargoItems,
            pendingDriverActualDropPoints,
            "driverCargoItems": *[_type == "deliveryOrderItem" && deliveryOrderRef == ^._id] | order(_createdAt asc){
                _id,
                _type,
                "deliveryOrderRef": ^._id,
                "orderItemRef": coalesce(orderItemRef._ref, orderItemRef),
                pickupStopKey,
                pickupAddress,
                shipperReferenceKey,
                shipperReferenceNumber,
                orderItemDescription,
                orderItemQtyKoli,
                orderItemWeight,
                orderItemVolumeM3,
                orderItemWeightInputValue,
                orderItemWeightInputUnit,
                orderItemVolumeInputValue,
                orderItemVolumeInputUnit,
                shippedQtyKoli,
                shippedWeight,
                actualQtyKoli,
                actualWeightKg,
                actualVolumeM3,
                actualWeightInputValue,
                actualWeightInputUnit,
                actualVolumeInputValue,
                actualVolumeInputUnit
            }
        }`,
        { driverRef }
    );
}

export async function getDriverOrderCargoCapabilities(orderRefs: string[]) {
    const normalizedOrderRefs = [...new Set(orderRefs.filter(Boolean))];
    if (normalizedOrderRefs.length === 0) {
        return new Map<string, boolean>();
    }

    const [orders, orderItemHints] = await Promise.all([
        getSanityClient().fetch<Array<{
            _id: string;
            _createdAt?: string;
            createdAt?: string;
            cargoEntryMode?: 'ORDER' | 'DELIVERY_ORDER';
        }>>(
            `*[_type == "order" && _id in $ids]{
                _id,
                _createdAt,
                createdAt,
                cargoEntryMode
            }`,
            { ids: normalizedOrderRefs }
        ),
        getSanityClient().fetch<Array<{
            orderRef?: string;
            _createdAt?: string;
            entrySource?: 'ORDER' | 'DELIVERY_ORDER';
            sourceDeliveryOrderRef?: string;
        }>>(
            `*[_type == "orderItem" && orderRef in $ids]{
                orderRef,
                _createdAt,
                entrySource,
                sourceDeliveryOrderRef
            }`,
            { ids: normalizedOrderRefs }
        ),
    ]);

    const orderMap = new Map(orders.map(order => [order._id, order]));
    const hintsByOrderRef = new Map<string, Array<{
        _createdAt?: string;
        entrySource?: 'ORDER' | 'DELIVERY_ORDER';
        sourceDeliveryOrderRef?: string;
    }>>();
    for (const item of orderItemHints) {
        const orderRef = typeof item.orderRef === 'string' ? item.orderRef : '';
        if (!orderRef) {
            continue;
        }
        const current = hintsByOrderRef.get(orderRef) || [];
        current.push({
            _createdAt: item._createdAt,
            entrySource: item.entrySource,
            sourceDeliveryOrderRef: item.sourceDeliveryOrderRef,
        });
        hintsByOrderRef.set(orderRef, current);
    }

    const capabilities = new Map<string, boolean>();
    normalizedOrderRefs.forEach(orderRef => {
        const order = orderMap.get(orderRef);
        const hints = hintsByOrderRef.get(orderRef) || [];
        const resolvedCargoEntryMode = resolveOrderCargoEntryMode(order, hints);
        capabilities.set(orderRef, resolvedCargoEntryMode === 'DELIVERY_ORDER' || hints.length === 0);
    });

    return capabilities;
}

function normalizeTripPlanPickupStops(
    pickupStops: OrderPickupStop[] | undefined,
    pickupAddress: string | undefined,
    pickupStopKeys: string[] | undefined
): DriverAssignedTripPlanPickupStop[] {
    const normalizedStops: DriverAssignedTripPlanPickupStop[] = [];
    for (const [index, stop] of (pickupStops || []).entries()) {
        const pickupAddressValue = stop.pickupAddress?.trim();
        if (!pickupAddressValue) {
            continue;
        }
        normalizedStops.push({
            _key: stop._key || `pickup-stop-${index + 1}`,
            sequence: stop.sequence || index + 1,
            pickupLabel: stop.pickupLabel,
            pickupAddress: pickupAddressValue,
            notes: stop.notes,
        });
    }
    normalizedStops.sort((left, right) => left.sequence - right.sequence);

    const resolvedStops = normalizedStops.length > 0
        ? normalizedStops
        : pickupAddress?.trim()
            ? [{
                _key: 'pickup-stop-1',
                sequence: 1,
                pickupLabel: '',
                pickupAddress: pickupAddress.trim(),
                notes: '',
            }]
            : [];

    const selectedPickupStopKeys = new Set((pickupStopKeys || []).filter(Boolean));
    if (selectedPickupStopKeys.size === 0) {
        return resolvedStops;
    }

    const filteredStops = resolvedStops.filter(stop => stop._key && selectedPickupStopKeys.has(stop._key));
    return filteredStops.length > 0 ? filteredStops : resolvedStops;
}

export async function getDriverAssignedTripPlans(driverRef: string) {
    const orders = await getSanityClient().fetch<Array<{
        _id: string;
        masterResi?: string;
        customerRef?: string;
        customerName?: string;
        serviceName?: string;
        pickupAddress?: string;
        pickupStops?: OrderPickupStop[];
        tripPlans?: OrderTripPlan[];
    }>>(
        `*[
            _type == "order" &&
            count(tripPlans[driverRef == $driverRef]) > 0
        ] | order(createdAt desc, _createdAt desc){
            _id,
            masterResi,
            customerRef,
            customerName,
            serviceName,
            pickupAddress,
            pickupStops,
            "tripPlans": tripPlans[driverRef == $driverRef]{
                _key,
                sequence,
                pickupStopKeys,
                vehicleRef,
                vehiclePlate,
                driverRef,
                driverName,
                tripOriginArea,
                tripDestinationArea,
                taripBorongan,
                cashGiven,
                issueBankName,
                date,
                notes,
                linkedDeliveryOrderRef,
                linkedDeliveryOrderNumber
            }
        }`,
        { driverRef }
    );

    const linkedDeliveryOrderRefs = [
        ...new Set(
            orders.flatMap(order =>
                (order.tripPlans || [])
                    .map(plan => plan.linkedDeliveryOrderRef)
                    .filter((ref): ref is string => typeof ref === 'string' && ref.trim().length > 0)
            )
        ),
    ];

    const linkedDeliveryOrders = linkedDeliveryOrderRefs.length > 0
        ? await getSanityClient().fetch<Array<Pick<DeliveryOrder, '_id' | 'status' | 'doNumber'>>>(
            `*[_type == "deliveryOrder" && _id in $ids]{
                _id,
                status,
                doNumber
            }`,
            { ids: linkedDeliveryOrderRefs }
        )
        : [];
    const linkedDeliveryOrderMap = new Map(linkedDeliveryOrders.map(item => [item._id, item]));

    const plannedTrips: DriverAssignedTripPlan[] = [];
    for (const order of orders) {
        for (const [index, plan] of (order.tripPlans || []).entries()) {
            const tripPlanKey = plan._key || `order-trip-${index + 1}`;
            const linkedDeliveryOrder = plan.linkedDeliveryOrderRef
                ? linkedDeliveryOrderMap.get(plan.linkedDeliveryOrderRef) || null
                : null;
            if (linkedDeliveryOrder && linkedDeliveryOrder.status !== 'CANCELLED') {
                continue;
            }

            plannedTrips.push({
                orderRef: order._id,
                masterResi: order.masterResi,
                customerRef: order.customerRef,
                customerName: order.customerName,
                serviceName: order.serviceName,
                pickupAddress: order.pickupAddress,
                tripPlanKey,
                tripSequence: plan.sequence || index + 1,
                pickupStops: normalizeTripPlanPickupStops(order.pickupStops, order.pickupAddress, plan.pickupStopKeys),
                vehicleRef: plan.vehicleRef,
                vehiclePlate: plan.vehiclePlate,
                driverRef: plan.driverRef,
                driverName: plan.driverName,
                tripOriginArea: plan.tripOriginArea,
                tripDestinationArea: plan.tripDestinationArea,
                taripBorongan: plan.taripBorongan,
                cashGiven: plan.cashGiven,
                issueBankName: plan.issueBankName,
                date: plan.date,
                notes: plan.notes,
                linkedDeliveryOrderRef: plan.linkedDeliveryOrderRef,
                linkedDeliveryOrderNumber: linkedDeliveryOrder?.doNumber || plan.linkedDeliveryOrderNumber,
                linkedDeliveryOrderStatus: linkedDeliveryOrder?.status || (plan.linkedDeliveryOrderRef ? 'UNKNOWN' : undefined),
            });
        }
    }

    return plannedTrips;
}

export async function getDriverCustomerProducts(customerRefs: string[]) {
    const normalizedCustomerRefs = [...new Set(customerRefs.filter(Boolean))];
    if (normalizedCustomerRefs.length === 0) {
        return [] as CustomerProduct[];
    }

    return getSanityClient().fetch<CustomerProduct[]>(
        `*[_type == "customerProduct" && customerRef in $customerRefs && active != false] | order(coalesce(code, name) asc){
            _id,
            _type,
            customerRef,
            customerName,
            code,
            name,
            description,
            defaultQtyKoli,
            defaultWeight,
            defaultWeightInputValue,
            defaultWeightInputUnit,
            defaultVolume,
            defaultVolumeInputValue,
            defaultVolumeInputUnit,
            notes,
            active
        }`,
        { customerRefs: normalizedCustomerRefs }
    );
}

export function sanitizeDriverForMobile(driver: Driver) {
    return {
        _id: driver._id,
        name: driver.name,
        phone: driver.phone,
        active: driver.active,
    };
}

export function formatTrackingLocationText(latitude: number, longitude: number) {
    return `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
}

export function normalizeTrackingNumber(value: unknown) {
    const numeric = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(numeric) ? numeric : null;
}

export function toSpeedKph(speedMetersPerSecond: number | null) {
    if (speedMetersPerSecond === null || speedMetersPerSecond < 0) return undefined;
    return Math.round(speedMetersPerSecond * 3.6 * 10) / 10;
}
