import { loadScriptEnv } from './_env';

loadScriptEnv();

import { getAllDocuments, listDocumentsByFilter, updateDocument } from '../src/lib/repositories/document-store';
import type { DeliveryOrder, DeliveryOrderItem } from '../src/lib/types';

function numberValue(value: unknown) {
    const numeric = Number(value ?? 0);
    return Number.isFinite(numeric) ? numeric : 0;
}

function itemRefsForPoint(point: NonNullable<DeliveryOrder['actualDropPoints']>[number]) {
    const refs: string[] = [];
    if (typeof point.deliveryOrderItemRef === 'string' && point.deliveryOrderItemRef.trim()) {
        refs.push(point.deliveryOrderItemRef.trim());
    }
    if (Array.isArray(point.deliveryOrderItemRefs)) {
        for (const ref of point.deliveryOrderItemRefs) {
            if (typeof ref === 'string' && ref.trim()) refs.push(ref.trim());
        }
    }
    return [...new Set(refs)];
}

async function main() {
    const dryRun = process.env.DRY_RUN !== '0';
    const deliveryOrders = await getAllDocuments<DeliveryOrder>('deliveryOrder');
    const patched: Array<{ id: string; deliveryOrderRef: string; actualQtyKoli: number; actualWeightKg: number; actualVolumeM3: number }> = [];
    const skippedAmbiguous: Array<{ deliveryOrderRef: string; pointKey?: string; sequence?: number; itemRefCount: number }> = [];

    for (const deliveryOrder of deliveryOrders) {
        const points = Array.isArray(deliveryOrder.actualDropPoints) ? deliveryOrder.actualDropPoints : [];
        if (points.length === 0) continue;

        const items = await listDocumentsByFilter<DeliveryOrderItem>('deliveryOrderItem', {
            deliveryOrderRef: deliveryOrder._id,
        });
        if (items.length === 0) continue;

        for (const item of items) {
            const matchedPoints = points.filter(point => {
                const refs = itemRefsForPoint(point);
                if (refs.length !== 1) {
                    if (refs.length > 1) {
                        skippedAmbiguous.push({
                            deliveryOrderRef: deliveryOrder._id,
                            pointKey: point._key,
                            sequence: point.sequence,
                            itemRefCount: refs.length,
                        });
                    }
                    return false;
                }
                return refs[0] === item._id;
            });
            if (matchedPoints.length === 0) continue;

            const actualQtyKoli = matchedPoints.reduce((sum, point) => sum + numberValue(point.qtyKoli), 0);
            const actualWeightKg = matchedPoints.reduce((sum, point) => sum + numberValue(point.weightKg), 0);
            const actualVolumeM3 = matchedPoints.reduce((sum, point) => sum + numberValue(point.volumeM3), 0);
            const currentQty = numberValue(item.actualQtyKoli);
            const currentWeight = numberValue(item.actualWeightKg);
            const currentVolume = numberValue(item.actualVolumeM3);
            if (
                Math.abs(currentQty - actualQtyKoli) <= 0.01 &&
                Math.abs(currentWeight - actualWeightKg) <= 0.01 &&
                Math.abs(currentVolume - actualVolumeM3) <= 0.001
            ) {
                continue;
            }

            if (!dryRun) {
                await updateDocument(item._id, {
                    actualQtyKoli,
                    actualWeightKg,
                    actualVolumeM3: actualVolumeM3 > 0 ? actualVolumeM3 : null,
                    actualWeightInputValue: actualWeightKg,
                    actualWeightInputUnit: 'KG',
                    actualVolumeInputValue: actualVolumeM3 > 0 ? actualVolumeM3 : null,
                    actualVolumeInputUnit: actualVolumeM3 > 0 ? 'M3' : null,
                }, 'deliveryOrderItem');
            }
            patched.push({ id: item._id, deliveryOrderRef: deliveryOrder._id, actualQtyKoli, actualWeightKg, actualVolumeM3 });
        }
    }

    console.log(JSON.stringify({
        dryRun,
        patched,
        skippedAmbiguousCount: skippedAmbiguous.length,
        skippedAmbiguous: skippedAmbiguous.slice(0, 20),
    }, null, 2));
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
