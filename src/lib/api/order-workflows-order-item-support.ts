import type { NormalizedOrderItemInput } from './order-workflow-support';

export function buildOrderItemDraftDocument(
    orderRef: string,
    item: NormalizedOrderItemInput,
    itemId: string = crypto.randomUUID(),
    extras?: Record<string, unknown>
) {
    return {
        _id: itemId,
        _type: 'orderItem',
        orderRef,
        entrySource: 'ORDER',
        customerProductRef: item.customerProductRef,
        customerProductCode: item.customerProductCode,
        customerProductName: item.customerProductName,
        description: item.description,
        qtyKoli: item.qtyKoli,
        weight: item.weight,
        volume: item.volume,
        weightInputValue: item.weightInputValue,
        weightInputUnit: item.weightInputUnit,
        volumeInputValue: item.volumeInputValue,
        volumeInputUnit: item.volumeInputUnit,
        value: item.value,
        deliveredQtyKoli: 0,
        deliveredWeight: 0,
        deliveredVolume: 0,
        assignedQtyKoli: 0,
        assignedWeight: 0,
        assignedVolume: 0,
        heldQtyKoli: 0,
        heldWeight: 0,
        heldVolume: 0,
        status: 'PENDING',
        ...extras,
    };
}
