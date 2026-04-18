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
    this.pendingDriverStatus,
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
  final String? pendingDriverStatus;
  final String? receiverName;
  final String? itemSummary;

  bool get isAwaitingAdminApproval => pendingDriverStatus == 'DELIVERED';

  DeliveryTrip copyWith({
    TripStatus? status,
    String? trackingState,
    String? pendingDriverStatus,
    String? statusNote,
  }) {
    final nextStatus = status ?? this.status;
    final nextPendingDriverStatus = pendingDriverStatus ?? this.pendingDriverStatus;
    return DeliveryTrip(
      deliveryOrderId: deliveryOrderId,
      doNumber: doNumber,
      vehiclePlate: vehiclePlate,
      originLabel: originLabel,
      destinationLabel: destinationLabel,
      customerName: customerName,
      status: nextStatus,
      etdLabel: etdLabel,
      statusNote:
          statusNote ??
          defaultTripStatusNote(
            nextStatus,
            pendingDriverStatus: nextPendingDriverStatus,
          ),
      trackingState: trackingState ?? this.trackingState,
      pendingDriverStatus: nextPendingDriverStatus,
      receiverName: receiverName,
      itemSummary: itemSummary,
    );
  }
}

String defaultTripStatusNote(
  TripStatus status, {
  String? pendingDriverStatus,
}) {
  if (pendingDriverStatus == 'DELIVERED') {
    return 'Menunggu approval admin';
  }

  return switch (status) {
    TripStatus.headingToPickup => 'Driver menuju pickup',
    TripStatus.onDelivery => 'Pengiriman berjalan',
    TripStatus.arrived => 'Driver sudah tiba',
    TripStatus.delivered => 'Trip selesai',
    TripStatus.assigned => 'Trip sudah ditugaskan',
  };
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
