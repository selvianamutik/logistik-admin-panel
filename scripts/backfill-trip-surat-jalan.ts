import { loadScriptEnv } from './_env';
import { getAllDocuments } from '../src/lib/repositories/document-store';
import { relationalUpsertDocument } from '../src/lib/supabase-relational';
import {
    mapDeliveryOrderToSuratJalanItemRecords,
    mapDeliveryOrderToSuratJalanRecords,
    mapDeliveryOrderToTripRecord,
} from '../src/lib/trip-document-mappers';
import type { DeliveryOrder, DeliveryOrderItem } from '../src/lib/types';
import type { SuratJalanItemRecord, SuratJalanRecord, TripRecord } from '../src/lib/trip-document-types';

loadScriptEnv();

function hasFlag(flag: string) {
    return process.argv.includes(flag);
}

function summarizeSample(ids: string[]) {
    return ids.slice(0, 5).join(', ');
}

async function main() {
    const shouldWrite = hasFlag('--write');

    const [deliveryOrders, deliveryOrderItems] = await Promise.all([
        getAllDocuments<DeliveryOrder>('deliveryOrder'),
        getAllDocuments<DeliveryOrderItem>('deliveryOrderItem'),
    ]);

    const itemsByDeliveryOrderRef = deliveryOrderItems.reduce<Map<string, DeliveryOrderItem[]>>((acc, item) => {
        const rows = acc.get(item.deliveryOrderRef) || [];
        rows.push(item);
        acc.set(item.deliveryOrderRef, rows);
        return acc;
    }, new Map());

    const tripRecords: TripRecord[] = [];
    const suratJalanRecords: SuratJalanRecord[] = [];
    const suratJalanItemRecords: SuratJalanItemRecord[] = [];

    for (const deliveryOrder of deliveryOrders) {
        const doItems = itemsByDeliveryOrderRef.get(deliveryOrder._id) || [];
        tripRecords.push(mapDeliveryOrderToTripRecord(deliveryOrder));
        suratJalanRecords.push(...mapDeliveryOrderToSuratJalanRecords(deliveryOrder, doItems));
        suratJalanItemRecords.push(...mapDeliveryOrderToSuratJalanItemRecords(deliveryOrder, doItems));
    }

    console.log('Backfill Trip / Surat Jalan Summary');
    console.log(`- Delivery orders source: ${deliveryOrders.length}`);
    console.log(`- Delivery order items source: ${deliveryOrderItems.length}`);
    console.log(`- Trip records planned: ${tripRecords.length}`);
    console.log(`- Surat jalan records planned: ${suratJalanRecords.length}`);
    console.log(`- Surat jalan item records planned: ${suratJalanItemRecords.length}`);
    console.log(`- Sample trip ids: ${summarizeSample(tripRecords.map(item => item._id)) || '-'}`);
    console.log(`- Sample surat jalan ids: ${summarizeSample(suratJalanRecords.map(item => item._id)) || '-'}`);

    if (!shouldWrite) {
        console.log('');
        console.log('Dry run only. No database changes were written.');
        console.log('Run with --write to upsert records into relational storage.');
        return;
    }

    for (const tripRecord of tripRecords) {
        await relationalUpsertDocument<TripRecord>(tripRecord as TripRecord & { [key: string]: unknown });
    }
    for (const suratJalanRecord of suratJalanRecords) {
        await relationalUpsertDocument<SuratJalanRecord>(suratJalanRecord as SuratJalanRecord & { [key: string]: unknown });
    }
    for (const suratJalanItemRecord of suratJalanItemRecords) {
        await relationalUpsertDocument<SuratJalanItemRecord>(suratJalanItemRecord as SuratJalanItemRecord & { [key: string]: unknown });
    }

    console.log('');
    console.log('Backfill completed successfully.');
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
