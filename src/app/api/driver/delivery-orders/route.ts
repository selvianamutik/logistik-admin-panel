import { NextResponse } from 'next/server';

import { getDriverAssignedDeliveryOrders, requireDriverSessionContext } from '@/lib/api/driver-portal';

export async function GET(request: Request) {
    const result = await requireDriverSessionContext(request);
    if ('error' in result) {
        return NextResponse.json({ error: result.error }, { status: result.status });
    }

    const deliveryOrders = await getDriverAssignedDeliveryOrders(result.driver._id);
    return NextResponse.json({ data: deliveryOrders });
}
