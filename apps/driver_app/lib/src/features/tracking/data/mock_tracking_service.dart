import 'dart:async';
import 'dart:math';

import '../domain/models.dart';

class MockTrackingService {
  List<DeliveryTrip> loadDriverTrips() {
    return const [
      DeliveryTrip(
        deliveryOrderId: 'do-001',
        doNumber: 'DO-202603-0007',
        vehiclePlate: 'B 9123 TKA',
        originLabel: 'Gudang Cakung, Jakarta Timur',
        destinationLabel: 'Karawang Barat, Jawa Barat',
        customerName: 'PT Maju Lancar',
        receiverName: 'CV Sentosa Abadi',
        itemSummary: 'Besi hollow, 120 koli',
        status: TripStatus.headingToPickup,
        etdLabel: 'Berangkat 06:30 WIB',
        statusNote: 'Supir sedang menuju titik pickup',
      ),
      DeliveryTrip(
        deliveryOrderId: 'do-002',
        doNumber: 'DO-202603-0008',
        vehiclePlate: 'B 9123 TKA',
        originLabel: 'Pulogadung, Jakarta Timur',
        destinationLabel: 'Bekasi Timur, Jawa Barat',
        customerName: 'PT Maju Lancar',
        receiverName: 'PT Bintang Baja',
        itemSummary: 'Pipa galvanis, 80 koli',
        status: TripStatus.onDelivery,
        etdLabel: 'Berangkat 08:15 WIB',
        statusNote: 'Pengiriman aktif, tracking perlu dilanjutkan',
      ),
      DeliveryTrip(
        deliveryOrderId: 'do-003',
        doNumber: 'DO-202603-0009',
        vehiclePlate: 'B 9011 RMD',
        originLabel: 'Cakung, Jakarta Timur',
        destinationLabel: 'Cikampek, Jawa Barat',
        customerName: 'PT Sumber Prima',
        receiverName: 'UD Mekar Jaya',
        itemSummary: 'Kawat bendrat, 55 koli',
        status: TripStatus.assigned,
        etdLabel: 'Jadwal 10:00 WIB',
        statusNote: 'DO sudah ditugaskan, belum mulai jalan',
      ),
      DeliveryTrip(
        deliveryOrderId: 'do-004',
        doNumber: 'DO-202603-0010',
        vehiclePlate: 'B 8771 LKK',
        originLabel: 'Marunda, Jakarta Utara',
        destinationLabel: 'Purwakarta, Jawa Barat',
        customerName: 'PT Lintas Timur',
        receiverName: 'PT Citra Konstruksi',
        itemSummary: 'Wiremesh M8, 64 koli',
        status: TripStatus.arrived,
        etdLabel: 'Berangkat 04:40 WIB',
        statusNote: 'Sudah tiba, menunggu konfirmasi bongkar',
      ),
      DeliveryTrip(
        deliveryOrderId: 'do-005',
        doNumber: 'DO-202603-0011',
        vehiclePlate: 'B 7652 HPA',
        originLabel: 'Cikarang, Jawa Barat',
        destinationLabel: 'Subang, Jawa Barat',
        customerName: 'PT Artha Niaga',
        receiverName: 'CV Putra Mandiri',
        itemSummary: 'Semen mortar, 150 sak',
        status: TripStatus.delivered,
        etdLabel: 'Berangkat 05:20 WIB',
        statusNote: 'Pengiriman selesai, tinggal unggah POD',
      ),
    ];
  }

  Stream<DriverLocationSnapshot> watchLocation({
    Duration interval = const Duration(seconds: 30),
  }) async* {
    final random = Random();
    var latitude = -6.21462;
    var longitude = 106.84513;

    yield DriverLocationSnapshot(
      latitude: latitude,
      longitude: longitude,
      speedKph: 34,
      accuracyMeters: 9,
      recordedAt: DateTime.now(),
    );

    while (true) {
      await Future<void>.delayed(interval);
      latitude += (random.nextDouble() - 0.5) / 500;
      longitude += (random.nextDouble() - 0.5) / 500;

      yield DriverLocationSnapshot(
        latitude: latitude,
        longitude: longitude,
        speedKph: 28 + random.nextInt(18).toDouble(),
        accuracyMeters: 6 + random.nextInt(8).toDouble(),
        recordedAt: DateTime.now(),
      );
    }
  }
}
