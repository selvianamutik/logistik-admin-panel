enum TripStatus { assigned, headingToPickup, onDelivery, arrived, delivered }

class DeliveryPickupStop {
  const DeliveryPickupStop({
    required this.key,
    required this.sequence,
    required this.pickupAddress,
    this.pickupLabel,
    this.notes,
  });

  final String key;
  final int sequence;
  final String pickupAddress;
  final String? pickupLabel;
  final String? notes;

  String get displayLabel {
    final label = (pickupLabel ?? '').trim();
    if (label.isNotEmpty) {
      return 'Pickup $sequence - $label';
    }
    return 'Pickup $sequence';
  }
}

class DeliveryShipperReference {
  const DeliveryShipperReference({
    required this.referenceNumber,
    this.pickupStopKey,
    this.receiverName,
    this.receiverCompany,
    this.receiverAddress,
  });

  final String referenceNumber;
  final String? pickupStopKey;
  final String? receiverName;
  final String? receiverCompany;
  final String? receiverAddress;

  String get targetLabel {
    final company = (receiverCompany ?? '').trim();
    if (company.isNotEmpty) return company;
    final name = (receiverName ?? '').trim();
    if (name.isNotEmpty) return name;
    final address = (receiverAddress ?? '').trim();
    if (address.isNotEmpty) return address;
    return '-';
  }
}

class DeliveryCargoItem {
  const DeliveryCargoItem({
    required this.id,
    required this.description,
    this.qtyKoli,
    this.weightKg,
    this.volumeM3,
    this.weightInputValue,
    this.weightInputUnit,
    this.volumeInputValue,
    this.volumeInputUnit,
    this.actualQtyKoli,
    this.actualWeightInputValue,
    this.actualWeightInputUnit,
    this.actualVolumeInputValue,
    this.actualVolumeInputUnit,
  });

  final String id;
  final String description;
  final double? qtyKoli;
  final double? weightKg;
  final double? volumeM3;
  final double? weightInputValue;
  final String? weightInputUnit;
  final double? volumeInputValue;
  final String? volumeInputUnit;
  final double? actualQtyKoli;
  final double? actualWeightInputValue;
  final String? actualWeightInputUnit;
  final double? actualVolumeInputValue;
  final String? actualVolumeInputUnit;
}

class PendingDriverActualCargoItem {
  const PendingDriverActualCargoItem({
    required this.deliveryOrderItemRef,
    this.actualQtyKoli,
    this.actualWeightInputValue,
    this.actualWeightInputUnit,
    this.actualVolumeInputValue,
    this.actualVolumeInputUnit,
  });

  final String deliveryOrderItemRef;
  final double? actualQtyKoli;
  final double? actualWeightInputValue;
  final String? actualWeightInputUnit;
  final double? actualVolumeInputValue;
  final String? actualVolumeInputUnit;
}

class DeliveryActualDropPoint {
  const DeliveryActualDropPoint({
    required this.stopType,
    required this.locationName,
    this.shipperReferenceNumber,
    this.shipperReferenceKey,
    this.sequence,
    this.locationAddress,
    this.qtyKoli,
    this.weightInputValue,
    this.weightInputUnit,
    this.volumeInputValue,
    this.volumeInputUnit,
    this.note,
  });

  final int? sequence;
  final String stopType;
  final String? shipperReferenceNumber;
  final String? shipperReferenceKey;
  final String locationName;
  final String? locationAddress;
  final double? qtyKoli;
  final double? weightInputValue;
  final String? weightInputUnit;
  final double? volumeInputValue;
  final String? volumeInputUnit;
  final String? note;
}

class CustomerProductOption {
  const CustomerProductOption({
    required this.id,
    required this.customerRef,
    required this.name,
    this.code,
    this.description,
    this.defaultQtyKoli,
    this.defaultWeight,
    this.defaultWeightInputValue,
    this.defaultWeightInputUnit,
    this.defaultVolume,
    this.defaultVolumeInputValue,
    this.defaultVolumeInputUnit,
  });

  final String id;
  final String customerRef;
  final String name;
  final String? code;
  final String? description;
  final double? defaultQtyKoli;
  final double? defaultWeight;
  final double? defaultWeightInputValue;
  final String? defaultWeightInputUnit;
  final double? defaultVolume;
  final double? defaultVolumeInputValue;
  final String? defaultVolumeInputUnit;

  String get displayLabel {
    final normalizedCode = (code ?? '').trim();
    if (normalizedCode.isNotEmpty) {
      return '$normalizedCode - $name';
    }
    return name;
  }
}

class DriverAssignedTripPlan {
  const DriverAssignedTripPlan({
    required this.orderRef,
    required this.tripPlanKey,
    required this.tripSequence,
    required this.pickupStops,
    required this.allowsDirectCargoInput,
    this.masterResi,
    this.customerRef,
    this.customerName,
    this.serviceName,
    this.vehicleRef,
    this.vehiclePlate,
    this.driverRef,
    this.driverName,
    this.tripOriginArea,
    this.tripDestinationArea,
    this.taripBorongan,
    this.cashGiven,
    this.issueBankName,
    this.date,
    this.notes,
    this.linkedDeliveryOrderRef,
    this.linkedDeliveryOrderNumber,
    this.linkedDeliveryOrderStatus,
  });

  final String orderRef;
  final String tripPlanKey;
  final int tripSequence;
  final List<DeliveryPickupStop> pickupStops;
  final bool allowsDirectCargoInput;
  final String? masterResi;
  final String? customerRef;
  final String? customerName;
  final String? serviceName;
  final String? vehicleRef;
  final String? vehiclePlate;
  final String? driverRef;
  final String? driverName;
  final String? tripOriginArea;
  final String? tripDestinationArea;
  final double? taripBorongan;
  final double? cashGiven;
  final String? issueBankName;
  final String? date;
  final String? notes;
  final String? linkedDeliveryOrderRef;
  final String? linkedDeliveryOrderNumber;
  final String? linkedDeliveryOrderStatus;

  String get tripLabel => masterResi?.trim().isNotEmpty == true
      ? '${masterResi!} / Trip $tripSequence'
      : 'Trip $tripSequence';
}

class DriverPortalData {
  const DriverPortalData({
    required this.trips,
    required this.plannedTrips,
    required this.customerProducts,
  });

  final List<DeliveryTrip> trips;
  final List<DriverAssignedTripPlan> plannedTrips;
  final List<CustomerProductOption> customerProducts;
}

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
    required this.allowsDirectCargoInput,
    this.orderRef,
    this.customerRef,
    this.trackingState,
    this.pendingDriverStatus,
    this.receiverName,
    this.receiverAddress,
    this.itemSummary,
    this.pickupStops = const [],
    this.shipperReferences = const [],
    this.cargoItems = const [],
    this.pendingActualCargoItems = const [],
    this.pendingActualDropPoints = const [],
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
  final bool allowsDirectCargoInput;
  final String? orderRef;
  final String? customerRef;
  final String? trackingState;
  final String? pendingDriverStatus;
  final String? receiverName;
  final String? receiverAddress;
  final String? itemSummary;
  final List<DeliveryPickupStop> pickupStops;
  final List<DeliveryShipperReference> shipperReferences;
  final List<DeliveryCargoItem> cargoItems;
  final List<PendingDriverActualCargoItem> pendingActualCargoItems;
  final List<DeliveryActualDropPoint> pendingActualDropPoints;

  bool get isAwaitingAdminApproval => pendingDriverStatus == 'DELIVERED';

  int get shipperReferenceCount => shipperReferences.length;

  DeliveryTrip copyWith({
    TripStatus? status,
    String? trackingState,
    String? pendingDriverStatus,
    String? statusNote,
  }) {
    final nextStatus = status ?? this.status;
    final nextPendingDriverStatus =
        pendingDriverStatus ?? this.pendingDriverStatus;
    return DeliveryTrip(
      deliveryOrderId: deliveryOrderId,
      doNumber: doNumber,
      vehiclePlate: vehiclePlate,
      originLabel: originLabel,
      destinationLabel: destinationLabel,
      customerName: customerName,
      status: nextStatus,
      etdLabel: etdLabel,
      allowsDirectCargoInput: allowsDirectCargoInput,
      orderRef: orderRef,
      customerRef: customerRef,
      statusNote:
          statusNote ??
          defaultTripStatusNote(
            nextStatus,
            pendingDriverStatus: nextPendingDriverStatus,
          ),
      trackingState: trackingState ?? this.trackingState,
      pendingDriverStatus: nextPendingDriverStatus,
      receiverName: receiverName,
      receiverAddress: receiverAddress,
      itemSummary: itemSummary,
      pickupStops: pickupStops,
      shipperReferences: shipperReferences,
      cargoItems: cargoItems,
      pendingActualCargoItems: pendingActualCargoItems,
      pendingActualDropPoints: pendingActualDropPoints,
    );
  }
}

String defaultTripStatusNote(TripStatus status, {String? pendingDriverStatus}) {
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
