import {
    getDriverCustomerRecipients,
    getDriverCustomerProducts,
    getDriverAssignedDeliveryOrders,
    getDriverAssignedTripPlans,
    getDriverOrderCargoCapabilities,
    getDriverPortalAccessNotice,
    requireDriverSessionContext,
} from '@/lib/api/driver-portal';
import { jsonNoStore } from '@/lib/api/request-security';
import { getDataServiceErrorInfo } from '@/lib/service-errors';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: Request) {
    try {
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
        const cargoCapabilities = await getDriverOrderCargoCapabilities([
            ...deliveryOrders.map(item => typeof item.orderRef === 'string' ? item.orderRef : ''),
            ...plannedTrips.map(item => item.orderRef || ''),
        ]);
        const customerRefs = [
            ...deliveryOrders.map(item => item.customerRef || ''),
            ...plannedTrips.map(item => item.customerRef || ''),
        ];
        const [customerProducts, customerRecipients] = await Promise.all([
            getDriverCustomerProducts(customerRefs),
            getDriverCustomerRecipients(customerRefs),
        ]);
        return jsonNoStore({
            data: deliveryOrders.map(item => ({
                ...item,
                allowsDirectCargoInput: cargoCapabilities.get(typeof item.orderRef === 'string' ? item.orderRef : '') ?? true,
            })),
            plannedTrips: plannedTrips.map(item => ({
                ...item,
                allowsDirectCargoInput: cargoCapabilities.get(item.orderRef || '') ?? true,
            })),
            customerProducts,
            customerRecipients,
        });
    } catch (error) {
        const serviceError = getDataServiceErrorInfo(
            error,
            'Layanan data portal driver sedang tidak tersedia. Coba lagi beberapa saat.'
        );
        if (serviceError) {
            return jsonNoStore({ error: serviceError.message }, { status: serviceError.status });
        }
        throw error;
    }
}
