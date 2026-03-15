import 'dart:convert';

import 'package:http/http.dart' as http;

import '../../../shared/config.dart';
import '../domain/models.dart';

class DeliveryOrderService {
  Future<List<DeliveryTrip>> fetchDriverTrips({
    required String driverRef,
    int limit = 1,
  }) async {
    final query =
        '''
*[
  _type == "deliveryOrder" &&
  status != "CANCELLED" &&
  status != "DELIVERED" &&
  (
    driverRef == \$driverRef ||
    driverRef._ref == \$driverRef
  )
] | order(date desc, _createdAt desc)[0...$limit]{
  _id,
  doNumber,
  vehiclePlate,
  customerName,
  receiverName,
  receiverAddress,
  date,
  notes,
  status,
  trackingState
}
''';

    final projectId = AppConfig.sanityProjectId;
    final dataset = AppConfig.sanityDataset;
    final encodedQuery = Uri.encodeComponent(query);
    final encodedRef = Uri.encodeComponent('"$driverRef"');

    final url =
        'https://$projectId.api.sanity.io/v2024-01-01/data/query/$dataset'
        '?query=$encodedQuery'
        '&\$driverRef=$encodedRef';

    final response = await http.get(
      Uri.parse(url),
      headers: const {'Accept': 'application/json'},
    );

    if (response.statusCode >= 400) {
      throw DeliveryOrderException(
        'Gagal memuat delivery order dari Sanity',
        response.statusCode,
      );
    }

    final decoded = jsonDecode(response.body);
    if (decoded is! Map<String, dynamic>) {
      throw const DeliveryOrderException('Respons Sanity tidak valid', 500);
    }

    final result = decoded['result'];
    if (result is! List) {
      return const [];
    }

    return result
        .whereType<Map<String, dynamic>>()
        .map(_mapTrip)
        .toList(growable: false);
  }

  Future<DeliveryTrip> updateTripStatus({
    required String sessionToken,
    required String deliveryOrderId,
    required TripStatus status,
    String? note,
  }) async {
    final response = await http.post(
      Uri.parse('${AppConfig.apiBaseUrl}/api/driver/delivery-orders/status'),
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'x-client-type': 'driver-app',
        'Authorization': 'Bearer $sessionToken',
      },
      body: jsonEncode({
        'id': deliveryOrderId,
        'status': _mapStatusToApi(status),
        if (note != null && note.trim().isNotEmpty) 'note': note.trim(),
      }),
    );

    final decoded = jsonDecode(response.body);
    if (response.statusCode >= 400) {
      final message = decoded is Map<String, dynamic>
          ? decoded['error'] as String? ?? 'Gagal memperbarui status DO'
          : 'Gagal memperbarui status DO';
      throw DeliveryOrderException(message, response.statusCode);
    }

    if (decoded is! Map<String, dynamic> || decoded['data'] is! Map<String, dynamic>) {
      throw const DeliveryOrderException('Respons update status tidak valid', 500);
    }

    return _mapTrip(decoded['data'] as Map<String, dynamic>);
  }

  DeliveryTrip _mapTrip(Map<String, dynamic> json) {
    final status = (json['status'] as String?) ?? 'CREATED';
    final mappedStatus = switch (status) {
      'HEADING_TO_PICKUP' => TripStatus.headingToPickup,
      'ON_DELIVERY' => TripStatus.onDelivery,
      'ARRIVED' => TripStatus.arrived,
      _ => TripStatus.assigned,
    };

    final date = (json['date'] as String?)?.trim();
    final destination = (json['receiverAddress'] as String?)?.trim();
    final receiverName = (json['receiverName'] as String?)?.trim();

    return DeliveryTrip(
      deliveryOrderId: json['_id'] as String? ?? '',
      doNumber: json['doNumber'] as String? ?? '-',
      vehiclePlate: (json['vehiclePlate'] as String?)?.trim().isNotEmpty == true
          ? json['vehiclePlate'] as String
          : '-',
      originLabel: 'Lihat detail order / warehouse',
      destinationLabel: destination?.isNotEmpty == true ? destination! : '-',
      customerName: (json['customerName'] as String?)?.trim().isNotEmpty == true
          ? json['customerName'] as String
          : 'Tanpa customer',
      receiverName: receiverName?.isNotEmpty == true ? receiverName : null,
      itemSummary: (json['notes'] as String?)?.trim(),
      trackingState: (json['trackingState'] as String?)?.trim(),
      status: mappedStatus,
      etdLabel: date?.isNotEmpty == true ? 'Tanggal DO $date' : 'Tanggal DO -',
      statusNote: _statusNote(status),
    );
  }

  String _statusNote(String status) {
    return switch (status) {
      'HEADING_TO_PICKUP' => 'Driver menuju pickup',
      'ON_DELIVERY' => 'Pengiriman sedang berjalan',
      'ARRIVED' => 'Driver sudah tiba',
      _ => 'DO sudah ditugaskan ke driver',
    };
  }

  String _mapStatusToApi(TripStatus status) {
    return switch (status) {
      TripStatus.assigned => 'CREATED',
      TripStatus.headingToPickup => 'HEADING_TO_PICKUP',
      TripStatus.onDelivery => 'ON_DELIVERY',
      TripStatus.arrived => 'ARRIVED',
      TripStatus.delivered => 'DELIVERED',
    };
  }
}

class DeliveryOrderException implements Exception {
  const DeliveryOrderException(this.message, this.statusCode);

  final String message;
  final int statusCode;

  @override
  String toString() => 'DeliveryOrderException($statusCode): $message';
}
