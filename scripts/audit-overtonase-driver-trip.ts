import { computeDeliveryOrderOvertonage } from '../src/lib/delivery-order-overtonage';
import { calculateFreightNotaRowAmount } from '../src/lib/freight-nota-billing';
import { buildNotaRowsFromDeliveryOrder } from '../src/lib/invoice-create-page-support';
import {
    getTripRouteOvertonaseRatePerKg,
    getTripRouteOvertonaseRatePerTon,
    stripTripRouteOvertonaseRateNote,
} from '../src/lib/trip-route-rate-support';
import type { DeliveryOrder, DeliveryOrderItem, Order, TripRouteRate } from '../src/lib/types';

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

function main() {
    const tripRate: TripRouteRate = {
        _id: 'audit-trip-rate',
        _type: 'tripRouteRate',
        originArea: 'Jawa Timur',
        destinationArea: 'Audit Kota',
        serviceRef: 'service-cdd',
        serviceName: 'CDD / Engkel',
        rate: 525000,
        overtonaseDriverRatePerTon: 16000,
        notes: 'Tarif audit. Referensi overtonase admin: Rp 99.999/ton.',
        active: true,
    };

    assert(getTripRouteOvertonaseRatePerTon(tripRate) === 16000, 'Rate overtonase harus memakai field eksplisit rute, bukan catatan lama.');
    assert(getTripRouteOvertonaseRatePerKg(tripRate) === 16, 'Rate overtonase per kg harus hasil konversi rate per ton.');
    assert(stripTripRouteOvertonaseRateNote(tripRate.notes) === 'Tarif audit.', 'Catatan legacy overtonase harus dibersihkan dari tampilan catatan.');

    const overtonage = computeDeliveryOrderOvertonage({
        actualTotalWeightKg: 5200,
        serviceMaxPayloadKg: 4500,
        vehicleCapacityKg: 9000,
        baseTripFee: tripRate.rate,
        overtonaseDriverRatePerKg: getTripRouteOvertonaseRatePerKg(tripRate),
    });

    assert(overtonage.overtonaseWeightKg === 700, `Berat overtonase harus 700 kg, sekarang ${overtonage.overtonaseWeightKg}.`);
    assert(overtonage.overtonaseDriverAmount === 11200, `Tambahan driver harus Rp 11.200, sekarang ${overtonage.overtonaseDriverAmount}.`);
    assert(overtonage.effectiveTripFee === 536200, `Upah borongan final harus Rp 536.200, sekarang ${overtonage.effectiveTripFee}.`);

    const order: Order = {
        _id: 'audit-order',
        _type: 'order',
        masterResi: 'ORD-AUDIT',
        customerRef: 'customer-audit',
        customerName: 'PT Audit Customer',
        serviceRef: 'service-cdd',
        serviceName: 'CDD / Engkel',
        pickupAddress: 'Gudang Audit',
        receiverAddress: '',
        status: 'COMPLETE',
        tripPlans: [],
        createdAt: '2026-04-30T00:00:00.000Z',
        createdBy: 'audit',
        cargoEntryMode: 'DELIVERY_ORDER',
    };

    const deliveryOrder: DeliveryOrder = {
        _id: 'audit-do',
        _type: 'deliveryOrder',
        orderRef: order._id,
        customerRef: order.customerRef,
        customerName: order.customerName,
        doNumber: 'DO-AUDIT',
        vehiclePlate: 'W 1234 AU',
        driverName: 'Driver Audit',
        serviceRef: order.serviceRef,
        serviceName: order.serviceName,
        tripRouteRateRef: tripRate._id,
        tripOriginArea: tripRate.originArea,
        tripDestinationArea: tripRate.destinationArea,
        date: '2026-04-30',
        status: 'DELIVERED',
        shipperReferences: [
            {
                referenceNumber: 'SJ-AUDIT',
                pickupAddress: 'Gudang Audit',
            },
        ],
        pickupAddress: 'Gudang Audit',
        baseTaripBorongan: tripRate.rate,
        taripBorongan: overtonage.effectiveTripFee,
        actualTotalWeightKg: overtonage.actualTotalWeightKg,
        serviceMaxPayloadKg: overtonage.serviceMaxPayloadKg,
        vehicleCapacityKg: overtonage.vehicleCapacityKg,
        overtonaseWeightKg: overtonage.overtonaseWeightKg,
        overtonaseDriverRatePerKg: overtonage.overtonaseDriverRatePerKg,
        overtonaseDriverAmount: overtonage.overtonaseDriverAmount,
        actualDropPoints: [
            {
                stopType: 'DROP',
                shipperReferenceNumber: 'SJ-AUDIT',
                deliveryOrderItemRef: 'audit-item',
                deliveryOrderItemRefs: ['audit-item'],
                locationName: 'Audit Drop',
                locationAddress: 'Audit Tujuan',
                qtyKoli: 2,
                weightKg: 5200,
                volumeM3: 1,
            },
        ],
    } as DeliveryOrder;

    const deliveryOrderItems: DeliveryOrderItem[] = [
        {
            _id: 'audit-item',
            _type: 'deliveryOrderItem',
            deliveryOrderRef: deliveryOrder._id,
            orderItemDescription: 'Barang Audit',
            shipperReferenceNumber: 'SJ-AUDIT',
            orderItemQtyKoli: 2,
            orderItemWeight: 5200,
            orderItemVolumeM3: 1,
            actualQtyKoli: 2,
            actualWeightKg: 5200,
            actualVolumeM3: 1,
        } as DeliveryOrderItem,
    ];

    const notaRows = buildNotaRowsFromDeliveryOrder({
        deliveryOrder,
        orders: [order],
        deliveryOrderItems,
    });

    assert(notaRows.length === 1, `Invoice harus tetap 1 row barang, bukan row tambahan overtonase. Sekarang ${notaRows.length}.`);
    assert(notaRows[0].barang === 'Barang Audit', 'Invoice row harus berisi barang SJ, bukan keterangan overtonase.');
    assert(notaRows[0].beratKg === 5200, `Invoice harus memakai berat aktual barang 5200 kg, sekarang ${notaRows[0].beratKg}.`);

    const customerBillAmount = calculateFreightNotaRowAmount({
        beratKg: notaRows[0].beratKg,
        tarip: 1000,
        billingMode: 'PER_KG',
    });
    assert(customerBillAmount === 5200000, `Invoice customer harus Rp 5.200.000 dan tidak ditambah overtonase driver, sekarang ${customerBillAmount}.`);

    console.log('Overtonase driver trip audit OK: rate rute -> hak driver, invoice customer tetap tanpa charge overtonase.');
}

main();
