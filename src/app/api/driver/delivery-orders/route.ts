import {
    getDriverCustomerProducts,
    getDriverAssignedDeliveryOrders,
    getDriverAssignedTripPlans,
    getDriverPortalAccessNotice,
    requireDriverSessionContext,
} from '@/lib/api/driver-portal';
import { jsonNoStore } from '@/lib/api/request-security';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: Request) {
    const result = await requireDriverSessionContext(request);
    if ('error' in result) {
        return jsonNoStore({ error: result.error }, { status: result.status });
    }

    const driverAccessNotice = await getDriverPortalAccessNotice(result.driver._id);
    if (driverAccessNotice?.blocking) {
        return jsonNoStore({ error: driverAccessNotice.message }, { status: 403 });
    }

    const [deliveryOrders, plannedTrips] = await Promise.all([
        getDriverAssignedDeliveryOrders(result.driver._id),
        getDriverAssignedTripPlans(result.driver._id),
    ]);
    const customerProducts = await getDriverCustomerProducts([
        ...deliveryOrders.map(item => item.customerRef || ''),
        ...plannedTrips.map(item => item.customerRef || ''),
    ]);
    return jsonNoStore({ data: deliveryOrders, plannedTrips, customerProducts });
}
