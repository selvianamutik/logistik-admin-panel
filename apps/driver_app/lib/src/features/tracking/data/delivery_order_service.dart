import 'dart:convert';

import 'package:http/http.dart' as http;

import '../../../shared/config.dart';
import '../domain/models.dart';

class DeliveryOrderService {
  Future<List<DeliveryTrip>> fetchDriverTrips({
    required String sessionToken,
  }) async {
    final portalData = await fetchDriverPortalData(sessionToken: sessionToken);
    return portalData.trips;
  }

  Future<DriverPortalData> fetchDriverPortalData({
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

    final tripData = decoded['data'] is List
        ? decoded['data'] as List
        : const [];
    final plannedTripData = decoded['plannedTrips'] is List
        ? decoded['plannedTrips'] as List
        : const [];
    final customerProductData = decoded['customerProducts'] is List
        ? decoded['customerProducts'] as List
        : const [];

    return DriverPortalData(
      trips: tripData
          .whereType<Map<String, dynamic>>()
          .map(_mapTrip)
          .toList(growable: false),
      plannedTrips: plannedTripData
          .whereType<Map<String, dynamic>>()
          .map(_mapTripPlan)
          .toList(growable: false),
      customerProducts: customerProductData
          .whereType<Map<String, dynamic>>()
          .map(_mapCustomerProduct)
          .toList(growable: false),
    );
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

  Future<void> createDeliveryOrderFromTripPlan({
    required String sessionToken,
    required String orderRef,
    required String orderTripPlanKey,
    required List<DriverManifestShipperReferenceInput> shipperReferences,
    required List<DriverManifestCargoItemInput> cargoItems,
  }) async {
    final response = await http.post(
      Uri.parse('${AppConfig.apiBaseUrl}/api/driver/delivery-orders/create'),
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'x-client-type': 'driver-app',
        'Authorization': 'Bearer $sessionToken',
      },
      body: jsonEncode({
        'orderRef': orderRef,
        'orderTripPlanKey': orderTripPlanKey,
        'shipperReferences': shipperReferences
            .map((item) => item.toJson())
            .toList(),
        'cargoItems': cargoItems.map((item) => item.toJson()).toList(),
      }),
    );

    final decoded = _decodeJson(response.body);
    if (response.statusCode >= 400) {
      final message = decoded['error'] is String
          ? decoded['error'] as String
          : 'Gagal membuat surat jalan dari trip order';
      throw DeliveryOrderException(message, response.statusCode);
    }
  }

  Future<void> appendCargoToDeliveryOrder({
    required String sessionToken,
    required String deliveryOrderId,
    required List<DriverManifestShipperReferenceInput> shipperReferences,
    required List<DriverManifestCargoItemInput> cargoItems,
  }) async {
    final response = await http.post(
      Uri.parse('${AppConfig.apiBaseUrl}/api/driver/delivery-orders/cargo'),
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'x-client-type': 'driver-app',
        'Authorization': 'Bearer $sessionToken',
      },
      body: jsonEncode({
        'id': deliveryOrderId,
        'shipperReferences': shipperReferences
            .map((item) => item.toJson())
            .toList(),
        'cargoItems': cargoItems.map((item) => item.toJson()).toList(),
      }),
    );

    final decoded = _decodeJson(response.body);
    if (response.statusCode >= 400) {
      final message = decoded['error'] is String
          ? decoded['error'] as String
          : 'Gagal menyimpan SJ/barang driver';
      throw DeliveryOrderException(message, response.statusCode);
    }
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
    final pickupStops = _mapPickupStops(json['pickupStops']);

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
      status: mappedStatus,
      etdLabel: date?.isNotEmpty == true ? 'Tanggal DO $date' : 'Tanggal DO -',
      statusNote: defaultTripStatusNote(
        mappedStatus,
        pendingDriverStatus: (json['pendingDriverStatus'] as String?)?.trim(),
      ),
      allowsDirectCargoInput: json['allowsDirectCargoInput'] != false,
      orderRef: (json['orderRef'] as String?)?.trim(),
      customerRef: (json['customerRef'] as String?)?.trim(),
      receiverName: receiverName?.isNotEmpty == true ? receiverName : null,
      itemSummary: notes?.isNotEmpty == true ? notes : null,
      trackingState: (json['trackingState'] as String?)?.trim(),
      pendingDriverStatus: (json['pendingDriverStatus'] as String?)?.trim(),
      pickupStops: pickupStops,
      shipperReferences: _mapShipperReferences(
        json['shipperReferences'],
        fallbackCustomerDoNumber: (json['customerDoNumber'] as String?)?.trim(),
        fallbackPickupStopKey: pickupStops.isNotEmpty
            ? pickupStops.first.key
            : null,
      ),
      cargoItems: _mapCargoItems(json['driverCargoItems']),
    );
  }

  DriverAssignedTripPlan _mapTripPlan(Map<String, dynamic> json) {
    return DriverAssignedTripPlan(
      orderRef: (json['orderRef'] as String?)?.trim() ?? '',
      masterResi: (json['masterResi'] as String?)?.trim(),
      customerRef: (json['customerRef'] as String?)?.trim(),
      customerName: (json['customerName'] as String?)?.trim(),
      serviceName: (json['serviceName'] as String?)?.trim(),
      tripPlanKey: (json['tripPlanKey'] as String?)?.trim() ?? '',
      tripSequence: _toInt(json['tripSequence']) ?? 1,
      pickupStops: _mapPickupStops(json['pickupStops']),
      vehicleRef: (json['vehicleRef'] as String?)?.trim(),
      vehiclePlate: (json['vehiclePlate'] as String?)?.trim(),
      driverRef: (json['driverRef'] as String?)?.trim(),
      driverName: (json['driverName'] as String?)?.trim(),
      tripOriginArea: (json['tripOriginArea'] as String?)?.trim(),
      tripDestinationArea: (json['tripDestinationArea'] as String?)?.trim(),
      taripBorongan: _toDouble(json['taripBorongan']),
      cashGiven: _toDouble(json['cashGiven']),
      issueBankName: (json['issueBankName'] as String?)?.trim(),
      date: (json['date'] as String?)?.trim(),
      notes: (json['notes'] as String?)?.trim(),
      linkedDeliveryOrderRef: (json['linkedDeliveryOrderRef'] as String?)
          ?.trim(),
      linkedDeliveryOrderNumber: (json['linkedDeliveryOrderNumber'] as String?)
          ?.trim(),
      linkedDeliveryOrderStatus: (json['linkedDeliveryOrderStatus'] as String?)
          ?.trim(),
      allowsDirectCargoInput: json['allowsDirectCargoInput'] != false,
    );
  }

  CustomerProductOption _mapCustomerProduct(Map<String, dynamic> json) {
    return CustomerProductOption(
      id: (json['_id'] as String?)?.trim() ?? '',
      customerRef: (json['customerRef'] as String?)?.trim() ?? '',
      name: (json['name'] as String?)?.trim() ?? '-',
      code: (json['code'] as String?)?.trim(),
      description: (json['description'] as String?)?.trim(),
      defaultQtyKoli: _toDouble(json['defaultQtyKoli']),
      defaultWeight: _toDouble(json['defaultWeight']),
      defaultWeightInputValue: _toDouble(json['defaultWeightInputValue']),
      defaultWeightInputUnit: (json['defaultWeightInputUnit'] as String?)
          ?.trim(),
      defaultVolume: _toDouble(json['defaultVolume']),
      defaultVolumeInputValue: _toDouble(json['defaultVolumeInputValue']),
      defaultVolumeInputUnit: (json['defaultVolumeInputUnit'] as String?)
          ?.trim(),
    );
  }

  List<DeliveryPickupStop> _mapPickupStops(dynamic raw) {
    if (raw is! List) return const [];
    return raw
        .whereType<Map<String, dynamic>>()
        .map(
          (item) => DeliveryPickupStop(
            key:
                (item['_key'] as String?)?.trim() ??
                'pickup-${_toInt(item['sequence']) ?? 1}',
            sequence: _toInt(item['sequence']) ?? 1,
            pickupLabel: (item['pickupLabel'] as String?)?.trim(),
            pickupAddress: (item['pickupAddress'] as String?)?.trim() ?? '-',
            notes: (item['notes'] as String?)?.trim(),
          ),
        )
        .toList(growable: false);
  }

  List<DeliveryShipperReference> _mapShipperReferences(
    dynamic raw, {
    String? fallbackCustomerDoNumber,
    String? fallbackPickupStopKey,
  }) {
    final references = <DeliveryShipperReference>[];
    if (raw is List) {
      for (final item in raw.whereType<Map<String, dynamic>>()) {
        final referenceNumber = (item['referenceNumber'] as String?)?.trim();
        if (referenceNumber == null || referenceNumber.isEmpty) continue;
        references.add(
          DeliveryShipperReference(
            referenceNumber: referenceNumber,
            pickupStopKey: (item['pickupStopKey'] as String?)?.trim(),
          ),
        );
      }
    }
    if (references.isEmpty &&
        fallbackCustomerDoNumber != null &&
        fallbackCustomerDoNumber.isNotEmpty) {
      references.add(
        DeliveryShipperReference(
          referenceNumber: fallbackCustomerDoNumber,
          pickupStopKey: fallbackPickupStopKey,
        ),
      );
    }
    return references;
  }

  List<DeliveryCargoItem> _mapCargoItems(dynamic raw) {
    if (raw is! List) return const [];
    return raw
        .whereType<Map<String, dynamic>>()
        .map(
          (item) => DeliveryCargoItem(
            id: (item['_id'] as String?)?.trim() ?? '',
            description:
                (item['orderItemDescription'] as String?)?.trim() ?? '-',
            qtyKoli: _toDouble(
              item['orderItemQtyKoli'] ?? item['shippedQtyKoli'],
            ),
            weightKg: _toDouble(
              item['orderItemWeight'] ?? item['shippedWeight'],
            ),
            volumeM3: _toDouble(item['orderItemVolumeM3']),
          ),
        )
        .toList(growable: false);
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

  double? _toDouble(dynamic value) {
    if (value is num) return value.toDouble();
    if (value is String) return double.tryParse(value);
    return null;
  }

  int? _toInt(dynamic value) {
    if (value is num) return value.toInt();
    if (value is String) return int.tryParse(value);
    return null;
  }
}

class DriverManifestShipperReferenceInput {
  const DriverManifestShipperReferenceInput({
    required this.referenceNumber,
    this.pickupStopKey,
  });

  final String referenceNumber;
  final String? pickupStopKey;

  Map<String, dynamic> toJson() => {
    'referenceNumber': referenceNumber,
    if (pickupStopKey != null && pickupStopKey!.isNotEmpty)
      'pickupStopKey': pickupStopKey,
  };
}

class DriverManifestCargoItemInput {
  const DriverManifestCargoItemInput({
    this.customerProductRef,
    required this.description,
    required this.qtyKoli,
    required this.weightInputValue,
    required this.weightInputUnit,
    required this.volumeInputValue,
    required this.volumeInputUnit,
    required this.shipperReferenceNumber,
    this.pickupStopKey,
  });

  final String? customerProductRef;
  final String description;
  final double qtyKoli;
  final double weightInputValue;
  final String weightInputUnit;
  final double volumeInputValue;
  final String volumeInputUnit;
  final String shipperReferenceNumber;
  final String? pickupStopKey;

  Map<String, dynamic> toJson() => {
    if (customerProductRef != null && customerProductRef!.isNotEmpty)
      'customerProductRef': customerProductRef,
    'description': description,
    'qtyKoli': qtyKoli,
    'weightInputValue': weightInputValue,
    'weightInputUnit': weightInputUnit,
    'volumeInputValue': volumeInputValue,
    'volumeInputUnit': volumeInputUnit,
    'shipperReferenceNumber': shipperReferenceNumber,
    if (pickupStopKey != null && pickupStopKey!.isNotEmpty)
      'pickupStopKey': pickupStopKey,
  };
}

class DeliveryOrderException implements Exception {
  const DeliveryOrderException(this.message, this.statusCode);

  final String message;
  final int statusCode;

  @override
  String toString() => 'DeliveryOrderException($statusCode): $message';
}
