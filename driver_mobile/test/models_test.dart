import 'package:driver_mobile/src/models.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('DeliveryOrder.fromJson', () {
    test('parses extended delivery statuses correctly', () {
      final headingToPickup = DeliveryOrder.fromJson(const <String, dynamic>{
        '_id': 'do-1',
        'doNumber': 'DO-1',
        'date': '2026-03-16',
        'status': 'HEADING_TO_PICKUP',
        'trackingState': 'IDLE',
      });

      final arrived = DeliveryOrder.fromJson(const <String, dynamic>{
        '_id': 'do-2',
        'doNumber': 'DO-2',
        'date': '2026-03-16',
        'status': 'ARRIVED',
        'trackingState': 'ACTIVE',
      });

      expect(headingToPickup.status, DeliveryOrderStatus.headingToPickup);
      expect(arrived.status, DeliveryOrderStatus.arrived);
    });

    test('treats delivered and cancelled orders as closed', () {
      final delivered = DeliveryOrder.fromJson(const <String, dynamic>{
        '_id': 'do-3',
        'doNumber': 'DO-3',
        'date': '2026-03-16',
        'status': 'DELIVERED',
        'trackingState': 'STOPPED',
      });

      final cancelled = DeliveryOrder.fromJson(const <String, dynamic>{
        '_id': 'do-4',
        'doNumber': 'DO-4',
        'date': '2026-03-16',
        'status': 'CANCELLED',
        'trackingState': 'STOPPED',
      });

      final active = DeliveryOrder.fromJson(const <String, dynamic>{
        '_id': 'do-5',
        'doNumber': 'DO-5',
        'date': '2026-03-16',
        'status': 'ON_DELIVERY',
        'trackingState': 'ACTIVE',
      });

      expect(delivered.isClosed, isTrue);
      expect(cancelled.isClosed, isTrue);
      expect(active.isClosed, isFalse);
    });
  });
}
