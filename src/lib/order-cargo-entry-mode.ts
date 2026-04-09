import type { Order, OrderItem } from '@/lib/types';

type CargoMode = 'ORDER' | 'DELIVERY_ORDER';

type OrderCargoModeOrderLike = Partial<Pick<Order, 'cargoEntryMode' | 'createdAt'>> & { _createdAt?: string };
type OrderCargoModeItemLike = Partial<Pick<OrderItem, 'entrySource' | 'sourceDeliveryOrderRef'>> & { _createdAt?: string };

function parseTimestamp(value: unknown) {
    if (typeof value !== 'string' || !value.trim()) {
        return Number.NaN;
    }
    return Date.parse(value);
}

export function resolveOrderCargoEntryMode(
    order: OrderCargoModeOrderLike | null | undefined,
    orderItems: OrderCargoModeItemLike[] = []
): CargoMode {
    if (order?.cargoEntryMode === 'ORDER' || order?.cargoEntryMode === 'DELIVERY_ORDER') {
        return order.cargoEntryMode;
    }

    if (orderItems.length === 0) {
        return 'DELIVERY_ORDER';
    }

    const hasExplicitDeliveryOrderSource = orderItems.some(
        item => item.entrySource === 'DELIVERY_ORDER' || Boolean(item.sourceDeliveryOrderRef)
    );
    if (hasExplicitDeliveryOrderSource) {
        const hasOrderEnteredItems = orderItems.some(
            item => item.entrySource === 'ORDER' || (!item.entrySource && !item.sourceDeliveryOrderRef)
        );
        if (!hasOrderEnteredItems) {
            return 'DELIVERY_ORDER';
        }
    }

    const orderCreatedAt = parseTimestamp(order?._createdAt || order?.createdAt);
    if (Number.isFinite(orderCreatedAt)) {
        const allItemsCreatedAfterOrder = orderItems.every(item => {
            const itemCreatedAt = parseTimestamp(item._createdAt);
            return Number.isFinite(itemCreatedAt) && itemCreatedAt - orderCreatedAt > 1000;
        });
        if (allItemsCreatedAfterOrder) {
            return 'DELIVERY_ORDER';
        }
    }

    const hasOrderEnteredItems = orderItems.some(item => item.entrySource !== 'DELIVERY_ORDER');
    return hasOrderEnteredItems ? 'ORDER' : 'DELIVERY_ORDER';
}
