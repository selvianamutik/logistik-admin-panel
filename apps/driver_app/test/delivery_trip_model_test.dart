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
  });
}
