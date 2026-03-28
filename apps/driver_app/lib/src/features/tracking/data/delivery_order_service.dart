import 'dart:convert';

import 'package:http/http.dart' as http;

import '../../../shared/config.dart';
import '../domain/models.dart';

class DeliveryOrderService {
  Future<List<DeliveryTrip>> fetchDriverTrips({
    required String sessionToken,
  }) async {
    final response = await http.get(
      Uri.parse('${AppConfig.apiBaseUrl}/api/driver/delivery-orders'),
      headers: {
        'Accept': 'application/json',
        'x-client-type': 'driver-app',
        'Authorization': 'Bearer $sessionToken',
      },
    );

    final decoded = _decodeJson(response.body);
    if (response.statusCode >= 400) {
      final message = decoded['error'] is String
          ? decoded['error'] as String
          : 'Gagal memuat trip driver';
      throw DeliveryOrderException(message, response.statusCode);
    }

    final data = decoded['data'];
    if (data is! List) {
      return const [];
    }

    return data
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

    final decoded = _decodeJson(response.body);
    if (response.statusCode >= 400) {
      final message = decoded['error'] is String
          ? decoded['error'] as String
          : 'Gagal memperbarui status DO';
      throw DeliveryOrderException(message, response.statusCode);
    }

    final data = decoded['data'];
    if (data is! Map<String, dynamic>) {
      throw const DeliveryOrderException(
        'Respons update status tidak valid',
        500,
      );
    }

    return _mapTrip(data);
  }

  DeliveryTrip _mapTrip(Map<String, dynamic> json) {
    final status = (json['status'] as String?) ?? 'CREATED';
    final mappedStatus = switch (status) {
      'HEADING_TO_PICKUP' => TripStatus.headingToPickup,
      'ON_DELIVERY' => TripStatus.onDelivery,
      'ARRIVED' => TripStatus.arrived,
      'DELIVERED' => TripStatus.delivered,
      _ => TripStatus.assigned,
    };

    final date = (json['date'] as String?)?.trim();
    final pickupAddress = (json['pickupAddress'] as String?)?.trim();
    final destination = (json['receiverAddress'] as String?)?.trim();
    final receiverName = (json['receiverName'] as String?)?.trim();
    final notes = (json['notes'] as String?)?.trim();

    return DeliveryTrip(
      deliveryOrderId: json['_id'] as String? ?? '',
      doNumber: json['doNumber'] as String? ?? '-',
      vehiclePlate: (json['vehiclePlate'] as String?)?.trim().isNotEmpty == true
          ? json['vehiclePlate'] as String
          : '-',
      originLabel: pickupAddress?.isNotEmpty == true ? pickupAddress! : '-',
      destinationLabel: destination?.isNotEmpty == true ? destination! : '-',
      customerName: (json['customerName'] as String?)?.trim().isNotEmpty == true
          ? json['customerName'] as String
          : 'Tanpa customer',
      receiverName: receiverName?.isNotEmpty == true ? receiverName : null,
      itemSummary: notes?.isNotEmpty == true ? notes : null,
      trackingState: (json['trackingState'] as String?)?.trim(),
      pendingDriverStatus: (json['pendingDriverStatus'] as String?)?.trim(),
      status: mappedStatus,
      etdLabel: date?.isNotEmpty == true ? 'Tanggal DO $date' : 'Tanggal DO -',
      statusNote: _statusNote(
        status,
        pendingDriverStatus: (json['pendingDriverStatus'] as String?)?.trim(),
      ),
    );
  }

  String _statusNote(String status, {String? pendingDriverStatus}) {
    if (pendingDriverStatus == 'DELIVERED') {
      return 'Menunggu approval admin';
    }
    return switch (status) {
      'HEADING_TO_PICKUP' => 'Driver menuju pickup',
      'ON_DELIVERY' => 'Pengiriman berjalan',
      'ARRIVED' => 'Driver sudah tiba',
      'DELIVERED' => 'Trip selesai',
      _ => 'Trip sudah ditugaskan',
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

  Map<String, dynamic> _decodeJson(String body) {
    if (body.isEmpty) return <String, dynamic>{};
    final decoded = jsonDecode(body);
    if (decoded is Map<String, dynamic>) {
      return decoded;
    }
    return <String, dynamic>{};
  }
}

class DeliveryOrderException implements Exception {
  const DeliveryOrderException(this.message, this.statusCode);

  final String message;
  final int statusCode;

  @override
  String toString() => 'DeliveryOrderException($statusCode): $message';
}
