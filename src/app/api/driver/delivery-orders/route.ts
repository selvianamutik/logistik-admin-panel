import { getDriverAssignedDeliveryOrders, requireDriverSessionContext } from '@/lib/api/driver-portal';
import { jsonNoStore } from '@/lib/api/request-security';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: Request) {
    const result = await requireDriverSessionContext(request);
    if ('error' in result) {
        return jsonNoStore({ error: result.error }, { status: result.status });
    }

    const deliveryOrders = await getDriverAssignedDeliveryOrders(result.driver._id);
    return jsonNoStore({ data: deliveryOrders });
}
