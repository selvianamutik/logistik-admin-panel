enum TripStatus { assigned, headingToPickup, onDelivery, arrived, delivered }

class DeliveryTrip {
  const DeliveryTrip({
    required this.deliveryOrderId,
    required this.doNumber,
    required this.vehiclePlate,
    required this.originLabel,
    required this.destinationLabel,
    required this.customerName,
    required this.status,
    required this.etdLabel,
    required this.statusNote,
    this.trackingState,
    this.receiverName,
    this.itemSummary,
  });

  final String deliveryOrderId;
  final String doNumber;
  final String vehiclePlate;
  final String originLabel;
  final String destinationLabel;
  final String customerName;
  final TripStatus status;
  final String etdLabel;
  final String statusNote;
  final String? trackingState;
  final String? receiverName;
  final String? itemSummary;

  DeliveryTrip copyWith({TripStatus? status, String? trackingState}) {
    return DeliveryTrip(
      deliveryOrderId: deliveryOrderId,
      doNumber: doNumber,
      vehiclePlate: vehiclePlate,
      originLabel: originLabel,
      destinationLabel: destinationLabel,
      customerName: customerName,
      status: status ?? this.status,
      etdLabel: etdLabel,
      statusNote: statusNote,
      trackingState: trackingState ?? this.trackingState,
      receiverName: receiverName,
      itemSummary: itemSummary,
    );
  }
}

class DriverLocationSnapshot {
  const DriverLocationSnapshot({
    required this.latitude,
    required this.longitude,
    required this.speedKph,
    required this.accuracyMeters,
    required this.recordedAt,
  });

  final double latitude;
  final double longitude;
  final double speedKph;
  final double accuracyMeters;
  final DateTime recordedAt;
}
