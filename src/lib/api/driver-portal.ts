import { getDriverSession, getSession, getSessionFromToken } from '@/lib/auth';
import { getBusinessDateValue } from '@/lib/business-date';
import { getDriverScoreStatusMeta } from '@/lib/driver-scoring-support';
import { getCurrentDriverScore } from '@/lib/api/driver-score-workflows';
import { getSanityClient, sanityGetById, sanityGetCompanyProfile } from '@/lib/sanity';
import type {
    CompanyProfile,
    DeliveryOrder,
    DeliveryOrderItem,
    Driver,
    DriverScore,
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
            doNumber,
            date,
            status,
            trackingState,
            masterResi,
            "customerName": coalesce(customerName, orderRef->customerName),
            "receiverName": coalesce(receiverName, orderRef->receiverName),
            "receiverAddress": coalesce(receiverAddress, orderRef->receiverAddress),
            "pickupAddress": coalesce(pickupAddress, orderRef->pickupAddress),
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
            "driverCargoItems": *[_type == "deliveryOrderItem" && deliveryOrderRef == ^._id] | order(_createdAt asc){
                _id,
                _type,
                "deliveryOrderRef": ^._id,
                "orderItemRef": coalesce(orderItemRef._ref, orderItemRef),
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
