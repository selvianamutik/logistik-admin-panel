import { getSanityClient } from '@/lib/sanity';

type StockMovementDateRow = {
    warehouseItemRef?: string;
    movementDate?: string;
};

export async function getLatestWarehouseStockMovementDateMap(itemRefs: string[]) {
    const refs = Array.from(
        new Set(
            itemRefs
                .map((value) => value?.trim())
                .filter((value): value is string => Boolean(value))
        )
    );

    if (refs.length === 0) {
        return new Map<string, string>();
    }

    const rows = await getSanityClient().fetch<StockMovementDateRow[]>(
        `*[_type == "stockMovement" && warehouseItemRef in $refs && defined(movementDate)]{
            warehouseItemRef,
            movementDate
        }`,
        { refs }
    );

    const latestDates = new Map<string, string>();
    for (const row of rows) {
        if (!row.warehouseItemRef || !row.movementDate) continue;
        const current = latestDates.get(row.warehouseItemRef);
        if (!current || row.movementDate > current) {
            latestDates.set(row.warehouseItemRef, row.movementDate);
        }
    }
    return latestDates;
}
