import 'package:driver_app/src/features/tracking/domain/models.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('DeliveryTrip.copyWith', () {
    const baseTrip = DeliveryTrip(
      deliveryOrderId: 'do-001',
      doNumber: 'DO-001',
      vehiclePlate: 'L 1234 AA',
      originLabel: 'Gudang A',
      destinationLabel: 'Tujuan A',
      customerName: 'PT Contoh',
      status: TripStatus.assigned,
      etdLabel: 'Tanggal DO 2026-04-18',
      statusNote: 'Trip sudah ditugaskan',
      allowsDirectCargoInput: true,
    );

    test('updates status note when status changes', () {
      final updated = baseTrip.copyWith(status: TripStatus.onDelivery);

      expect(updated.status, TripStatus.onDelivery);
      expect(updated.statusNote, 'Pengiriman berjalan');
    });

    test('prioritizes pending delivered approval message', () {
      final updated = baseTrip.copyWith(
        status: TripStatus.delivered,
        pendingDriverStatus: 'DELIVERED',
      );

      expect(updated.status, TripStatus.delivered);
      expect(updated.pendingDriverStatus, 'DELIVERED');
      expect(updated.statusNote, 'Menunggu approval admin');
    });

    test('keeps explicit status note override when provided', () {
      final updated = baseTrip.copyWith(
        status: TripStatus.arrived,
        statusNote: 'Custom note',
      );

      expect(updated.status, TripStatus.arrived);
      expect(updated.statusNote, 'Custom note');
    });

    test('supports partial hold and admin closure state', () {
      const closedTrip = DeliveryTrip(
        deliveryOrderId: 'do-closed',
        doNumber: 'DO-CLOSED',
        vehiclePlate: 'L 1234 AA',
        originLabel: 'Gudang A',
        destinationLabel: 'Tujuan A',
        customerName: 'PT Contoh',
        status: TripStatus.partialHold,
        etdLabel: 'Tanggal DO 2026-04-18',
        statusNote: 'Sebagian muatan hold',
        allowsDirectCargoInput: true,
        tripClosedByAdminAt: '2026-05-14T10:00:00.000Z',
        tripClosedByAdminName: 'Admin',
      );

      expect(
        defaultTripStatusNote(TripStatus.partialHold),
        'Sebagian muatan hold',
      );
      expect(closedTrip.isTripClosedByAdmin, isTrue);
    });

    test('keeps targeted partial finalization pending per SJ', () {
      const partialTrip = DeliveryTrip(
        deliveryOrderId: 'do-partial',
        doNumber: 'DO-PARTIAL',
        vehiclePlate: 'L 1234 AA',
        originLabel: 'Gudang A',
        destinationLabel: 'Tujuan A',
        customerName: 'PT Contoh',
        status: TripStatus.partialHold,
        etdLabel: 'Tanggal DO 2026-04-18',
        statusNote: 'Sebagian muatan hold',
        allowsDirectCargoInput: true,
        shipperReferences: [
          DeliveryShipperReference(
            referenceNumber: 'SJ-A',
            documentId: 'do-partial:SJ-A',
            tripStatus: 'ARRIVED',
          ),
          DeliveryShipperReference(
            referenceNumber: 'SJ-B',
            documentId: 'do-partial:SJ-B',
            tripStatus: 'ARRIVED',
          ),
        ],
        pendingDriverRequests: [
          PendingDriverRequest(
            requestId: 'request-a',
            status: 'DELIVERED',
            targetSuratJalanRefs: ['do-partial:SJ-A'],
          ),
        ],
      );

      expect(partialTrip.isAwaitingAdminApproval, isTrue);
      expect(partialTrip.hasBlockingAdminApproval, isFalse);
      expect(partialTrip.canRequestMoreFinalization, isTrue);
      expect(
        partialTrip.canRequestFinalizationForReference(
          partialTrip.shipperReferences.first,
        ),
        isFalse,
      );
      expect(
        partialTrip.canRequestFinalizationForReference(
          partialTrip.shipperReferences.last,
        ),
        isTrue,
      );
    });
  });
}
