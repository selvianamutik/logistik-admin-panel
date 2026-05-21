import type { DeliveryOrder } from '@/lib/types';

export function validateDriverStatusTransition(
    deliveryOrder: Pick<DeliveryOrder, 'status' | 'trackingState'>,
    requestedStatus: string
) {
    if (deliveryOrder.trackingState !== 'ACTIVE') {
        return 'Tracking live harus aktif sebelum driver mengirim progres perjalanan.';
    }

    if (
        requestedStatus === 'ON_DELIVERY' &&
        deliveryOrder.status !== 'CREATED' &&
        deliveryOrder.status !== 'HEADING_TO_PICKUP' &&
        deliveryOrder.status !== 'PARTIAL_HOLD'
    ) {
        return 'Driver hanya bisa menandai dalam pengiriman dari status siap jalan atau hold lanjutan.';
    }

    if (requestedStatus === 'ARRIVED' && deliveryOrder.status !== 'ON_DELIVERY') {
        return 'Driver hanya bisa menandai sudah tiba setelah status dalam pengiriman.';
    }

    if (requestedStatus === 'DELIVERED' && deliveryOrder.status !== 'ARRIVED') {
        return 'Driver hanya bisa mengajukan selesai setelah status sudah tiba.';
    }

    return null;
}
