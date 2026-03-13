class DriverUser {
  const DriverUser({
    required this.id,
    required this.name,
    required this.email,
    required this.role,
    this.driverRef,
    this.driverName,
  });

  final String id;
  final String name;
  final String email;
  final String role;
  final String? driverRef;
  final String? driverName;

  factory DriverUser.fromJson(Map<String, dynamic> json) {
    return DriverUser(
      id: json['_id'] as String? ?? '',
      name: json['name'] as String? ?? '',
      email: json['email'] as String? ?? '',
      role: json['role'] as String? ?? 'DRIVER',
      driverRef: json['driverRef'] as String?,
      driverName: json['driverName'] as String?,
    );
  }
}

class DriverProfile {
  const DriverProfile({
    required this.id,
    required this.name,
    required this.phone,
    required this.active,
  });

  final String id;
  final String name;
  final String phone;
  final bool active;

  factory DriverProfile.fromJson(Map<String, dynamic> json) {
    return DriverProfile(
      id: json['_id'] as String? ?? '',
      name: json['name'] as String? ?? '',
      phone: json['phone'] as String? ?? '',
      active: json['active'] as bool? ?? false,
    );
  }
}

class CompanySummary {
  const CompanySummary({
    required this.id,
    required this.name,
    this.phone,
    this.themeColor,
  });

  final String id;
  final String name;
  final String? phone;
  final String? themeColor;

  factory CompanySummary.fromJson(Map<String, dynamic> json) {
    return CompanySummary(
      id: json['_id'] as String? ?? '',
      name: json['name'] as String? ?? '',
      phone: json['phone'] as String?,
      themeColor: json['themeColor'] as String?,
    );
  }
}

class DriverSessionPayload {
  const DriverSessionPayload({
    required this.user,
    required this.driver,
    required this.company,
  });

  final DriverUser user;
  final DriverProfile driver;
  final CompanySummary? company;
}

class DriverLoginPayload extends DriverSessionPayload {
  const DriverLoginPayload({
    required super.user,
    required super.driver,
    required super.company,
    required this.token,
    required this.expiresIn,
  });

  final String token;
  final int expiresIn;
}

enum DeliveryOrderStatus { created, onDelivery, delivered, cancelled }

enum TrackingState { idle, active, paused, stopped }

class DeliveryOrder {
  const DeliveryOrder({
    required this.id,
    required this.doNumber,
    required this.date,
    required this.status,
    required this.trackingState,
    this.masterResi,
    this.customerName,
    this.receiverAddress,
    this.vehiclePlate,
    this.driverName,
    this.trackingStartedAt,
    this.trackingStoppedAt,
    this.trackingLastSeenAt,
    this.trackingLastLat,
    this.trackingLastLng,
    this.trackingLastAccuracyM,
    this.trackingLastSpeedKph,
  });

  final String id;
  final String doNumber;
  final String date;
  final DeliveryOrderStatus status;
  final TrackingState trackingState;
  final String? masterResi;
  final String? customerName;
  final String? receiverAddress;
  final String? vehiclePlate;
  final String? driverName;
  final String? trackingStartedAt;
  final String? trackingStoppedAt;
  final String? trackingLastSeenAt;
  final double? trackingLastLat;
  final double? trackingLastLng;
  final double? trackingLastAccuracyM;
  final double? trackingLastSpeedKph;

  bool get isClosed =>
      status == DeliveryOrderStatus.delivered ||
      status == DeliveryOrderStatus.cancelled;

  factory DeliveryOrder.fromJson(Map<String, dynamic> json) {
    return DeliveryOrder(
      id: json['_id'] as String? ?? '',
      doNumber: json['doNumber'] as String? ?? '',
      date: json['date'] as String? ?? '',
      status: _parseDoStatus(json['status'] as String?),
      trackingState: _parseTrackingState(json['trackingState'] as String?),
      masterResi: json['masterResi'] as String?,
      customerName: json['customerName'] as String?,
      receiverAddress: json['receiverAddress'] as String?,
      vehiclePlate: json['vehiclePlate'] as String?,
      driverName: json['driverName'] as String?,
      trackingStartedAt: json['trackingStartedAt'] as String?,
      trackingStoppedAt: json['trackingStoppedAt'] as String?,
      trackingLastSeenAt: json['trackingLastSeenAt'] as String?,
      trackingLastLat: _toDouble(json['trackingLastLat']),
      trackingLastLng: _toDouble(json['trackingLastLng']),
      trackingLastAccuracyM: _toDouble(json['trackingLastAccuracyM']),
      trackingLastSpeedKph: _toDouble(json['trackingLastSpeedKph']),
    );
  }

  static DeliveryOrderStatus _parseDoStatus(String? raw) {
    switch (raw) {
      case 'ON_DELIVERY':
        return DeliveryOrderStatus.onDelivery;
      case 'DELIVERED':
        return DeliveryOrderStatus.delivered;
      case 'CANCELLED':
        return DeliveryOrderStatus.cancelled;
      case 'CREATED':
      default:
        return DeliveryOrderStatus.created;
    }
  }

  static TrackingState _parseTrackingState(String? raw) {
    switch (raw) {
      case 'ACTIVE':
        return TrackingState.active;
      case 'PAUSED':
        return TrackingState.paused;
      case 'STOPPED':
        return TrackingState.stopped;
      case 'IDLE':
      default:
        return TrackingState.idle;
    }
  }

  static double? _toDouble(dynamic value) {
    if (value is num) {
      return value.toDouble();
    }
    if (value is String) {
      final parsed = double.tryParse(value);
      return parsed;
    }
    return null;
  }
}
