import fs from 'node:fs';
import path from 'node:path';

import { getSuratJalanDestination } from '../src/lib/surat-jalan-destination';
import { mapDeliveryOrdersToSuratJalanDocuments, mapSuratJalanRecordToDocument, mapTripRecordToTrip } from '../src/lib/trip-document-mappers';
import type { DeliveryOrder } from '../src/lib/types';
import type { CargoSummary, SuratJalanDocument, SuratJalanRecord, TripRecord } from '../src/lib/trip-document-types';

type AuditCase = {
    name: string;
    run: () => void;
};

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

function assertEqual(actual: unknown, expected: unknown, message: string) {
    if (actual !== expected) {
        throw new Error(`${message}. Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
}

function emptyCargo(): CargoSummary {
    return {
        qtyKoli: 0,
        weightKg: 0,
        volumeM3: 0,
    };
}

function buildBaseSuratJalan(overrides: Partial<SuratJalanDocument>): SuratJalanDocument {
    return {
        _id: 'sj-audit',
        _type: 'suratJalan',
        sourceDeliveryOrderRef: 'do-audit',
        tripRef: 'do-audit',
        tripNumber: 'DO-AUDIT',
        suratJalanNumber: 'SJ-AUDIT',
        itemCount: 1,
        cargoSummary: emptyCargo(),
        billableCargo: emptyCargo(),
        holdCargo: emptyCargo(),
        returnCargo: emptyCargo(),
        ...overrides,
    };
}

function buildBaseDeliveryOrder(overrides: Partial<DeliveryOrder>): DeliveryOrder {
    return {
        _id: 'do-audit',
        _type: 'deliveryOrder',
        doNumber: 'DO-AUDIT',
        orderRef: 'order-audit',
        masterResi: 'RESI-AUDIT',
        customerRef: 'customer-audit',
        customerName: 'Customer Audit',
        date: '2026-06-09',
        status: 'DELIVERED',
        pickupAddress: 'Pickup Audit',
        receiverName: '',
        receiverPhone: '',
        receiverAddress: '',
        receiverCompany: '',
        actualCargoItems: [],
        ...overrides,
    } as DeliveryOrder;
}

const cases: AuditCase[] = [
    {
        name: 'actual drop destinations win and remain unique for one SJ with many drops',
        run() {
            const row = buildBaseSuratJalan({
                receiverCompany: 'Receiver Fallback',
                tripDestinationArea: 'Route Fallback',
                actualDropPoints: [
                    { _key: 'drop-1', sequence: 1, stopType: 'DROP', locationName: 'Drop A', qtyKoli: 1 },
                    { _key: 'drop-2', sequence: 2, stopType: 'DROP', locationName: 'Drop B', qtyKoli: 1 },
                    { _key: 'drop-3', sequence: 3, stopType: 'DROP', locationName: 'Drop A', qtyKoli: 1 },
                    { _key: 'drop-4', sequence: 4, stopType: 'DROP', locationName: '', locationAddress: 'Drop C Address', qtyKoli: 1 },
                ],
            });

            assertEqual(getSuratJalanDestination(row), 'Drop A, Drop B, Drop C Address', 'multi-drop destination text mismatch');
        },
    },
    {
        name: 'receiver fields are used before trip destination area',
        run() {
            const row = buildBaseSuratJalan({
                receiverCompany: 'Receiver Company',
                receiverName: 'Receiver Name',
                receiverAddress: 'Receiver Address',
                tripDestinationArea: 'Route Area',
            });

            assertEqual(getSuratJalanDestination(row), 'Receiver Company', 'receiver fallback priority mismatch');
        },
    },
    {
        name: 'trip destination area fills pending/non-delivered SJ without receiver/drop data',
        run() {
            const row = buildBaseSuratJalan({
                tripDestinationArea: 'Surabaya Timur',
            });

            assertEqual(getSuratJalanDestination(row), 'Surabaya Timur', 'trip destination fallback missing');
        },
    },
    {
        name: 'blank destination falls back to dash',
        run() {
            assertEqual(getSuratJalanDestination(buildBaseSuratJalan({})), '-', 'empty destination fallback mismatch');
        },
    },
    {
        name: 'derived SJ document carries trip destination area from delivery order',
        run() {
            const deliveryOrder = buildBaseDeliveryOrder({
                tripOriginArea: 'Jakarta',
                tripDestinationArea: 'Bandung',
            });
            const [document] = mapDeliveryOrdersToSuratJalanDocuments([deliveryOrder], []);

            assertEqual(document.tripOriginArea, 'Jakarta', 'derived SJ trip origin missing');
            assertEqual(document.tripDestinationArea, 'Bandung', 'derived SJ trip destination missing');
            assertEqual(getSuratJalanDestination(document), 'Bandung', 'derived SJ destination fallback mismatch');
        },
    },
    {
        name: 'stored SJ record can recover trip destination area from trip record',
        run() {
            const record: SuratJalanRecord = {
                _id: 'do-audit:primary',
                _type: 'suratJalan',
                tripRef: 'do-audit',
                deliveryOrderRef: 'do-audit',
                suratJalanNumber: 'SJ-AUDIT',
                itemCount: 1,
                cargoSummary: emptyCargo(),
                billableCargo: emptyCargo(),
                holdCargo: emptyCargo(),
                returnCargo: emptyCargo(),
            };
            const trip: TripRecord = {
                _id: 'do-audit',
                _type: 'trip',
                tripNumber: 'DO-AUDIT',
                orderRef: 'order-audit',
                tripDate: '2026-06-09',
                status: 'CREATED',
                tripOriginArea: 'Semarang',
                tripDestinationArea: 'Solo',
            };
            const document = mapSuratJalanRecordToDocument(record, mapTripRecordToTrip(trip));

            assertEqual(document.tripDestinationArea, 'Solo', 'stored SJ trip destination missing');
            assertEqual(getSuratJalanDestination(document), 'Solo', 'stored SJ destination fallback mismatch');
        },
    },
    {
        name: 'page wiring uses destination helper on desktop, mobile, and search',
        run() {
            const pageSource = fs.readFileSync(path.join(process.cwd(), 'src/app/(admin)/surat-jalan/page.tsx'), 'utf8');
            assert(pageSource.includes('<td>{getSuratJalanDestination(row)}</td>'), 'desktop table does not use destination helper');
            assert(pageSource.includes('Tujuan: {getSuratJalanDestination(row)}'), 'mobile card does not show destination helper');
            assert(pageSource.includes('...getSuratJalanActualDropDestinations(row)'), 'search does not include actual drop destinations');
            assert(pageSource.includes('row.tripDestinationArea'), 'search does not include trip destination area');
        },
    },
    {
        name: 'projected real/derived merge preserves live drops and route destination fallback',
        run() {
            const source = fs.readFileSync(path.join(process.cwd(), 'src/lib/api/projected-document-reads.ts'), 'utf8');
            assert(source.includes('actualDropPoints: liveDocument.actualDropPoints || document.actualDropPoints'), 'projected merge drops actualDropPoints');
            assert(source.includes('tripDestinationArea: liveDocument.tripDestinationArea || document.tripDestinationArea'), 'projected merge drops tripDestinationArea');
        },
    },
];

let passCount = 0;

for (const item of cases) {
    item.run();
    passCount += 1;
    console.log(`OK - ${item.name}`);
}

console.log(`Surat Jalan destination display audit OK: ${passCount}/${cases.length} cases passed.`);
