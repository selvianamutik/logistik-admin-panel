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

    test('supports partial hold and admin closure state', () {
      const closedTrip = DeliveryTrip(
        deliveryOrderId: 'do-closed',
        doNumber: 'DO-CLOSED',
        vehiclePlate: 'L 1234 AA',
        originLabel: 'Gudang A',
        destinationLabel: 'Tujuan A',
        customerName: 'PT Contoh',
        status: TripStatus.partialHold,
        etdLabel: 'Tanggal DO 2026-04-18',
        statusNote: 'Sebagian muatan hold',
        allowsDirectCargoInput: true,
        tripClosedByAdminAt: '2026-05-14T10:00:00.000Z',
        tripClosedByAdminName: 'Admin',
      );

      expect(
        defaultTripStatusNote(TripStatus.partialHold),
        'Sebagian muatan hold',
      );
      expect(closedTrip.isTripClosedByAdmin, isTrue);
    });

    test('keeps targeted partial finalization pending per SJ', () {
      const partialTrip = DeliveryTrip(
        deliveryOrderId: 'do-partial',
        doNumber: 'DO-PARTIAL',
        vehiclePlate: 'L 1234 AA',
        originLabel: 'Gudang A',
        destinationLabel: 'Tujuan A',
        customerName: 'PT Contoh',
        status: TripStatus.partialHold,
        etdLabel: 'Tanggal DO 2026-04-18',
        statusNote: 'Sebagian muatan hold',
        allowsDirectCargoInput: true,
        shipperReferences: [
          DeliveryShipperReference(
            referenceNumber: 'SJ-A',
            documentId: 'do-partial:SJ-A',
            tripStatus: 'ARRIVED',
          ),
          DeliveryShipperReference(
            referenceNumber: 'SJ-B',
            documentId: 'do-partial:SJ-B',
            tripStatus: 'ARRIVED',
          ),
        ],
        pendingDriverRequests: [
          PendingDriverRequest(
            requestId: 'request-a',
            status: 'DELIVERED',
            targetSuratJalanRefs: ['do-partial:SJ-A'],
          ),
        ],
      );

      expect(partialTrip.isAwaitingAdminApproval, isTrue);
      expect(partialTrip.hasBlockingAdminApproval, isFalse);
      expect(partialTrip.canRequestMoreFinalization, isTrue);
      expect(
        partialTrip.canRequestFinalizationForReference(
          partialTrip.shipperReferences.first,
        ),
        isFalse,
      );
      expect(
        partialTrip.canRequestFinalizationForReference(
          partialTrip.shipperReferences.last,
        ),
        isTrue,
      );
    });
  });

  group('Delivery status labels', () {
    test('uses admin operational labels for per-SJ statuses', () {
      const reference = DeliveryShipperReference(
        referenceNumber: 'SJ-A',
        tripStatus: 'HEADING_TO_PICKUP',
      );

      expect(
        deliveryStatusApiValue(TripStatus.headingToPickup),
        'HEADING_TO_PICKUP',
      );
      expect(reference.statusLabel, 'Menuju Pickup');
      expect(deliveryStatusLabel('ON_DELIVERY'), 'Dalam Pengiriman');
      expect(deliveryStatusLabel('DELIVERED'), 'Terkirim');
    });

    test('matches backend tracking guard for driver status updates', () {
      expect(
        deliveryStatusRequiresActiveTracking(TripStatus.headingToPickup),
        isFalse,
      );
      expect(
        deliveryStatusRequiresActiveTracking(TripStatus.onDelivery),
        isTrue,
      );
      expect(deliveryStatusRequiresActiveTracking(TripStatus.arrived), isTrue);
      expect(
        deliveryStatusRequiresActiveTracking(TripStatus.delivered),
        isFalse,
      );

      const stoppedTrip = DeliveryTrip(
        deliveryOrderId: 'do-stopped',
        doNumber: 'DO-STOPPED',
        vehiclePlate: 'L 1234 AA',
        originLabel: 'Gudang A',
        destinationLabel: 'Tujuan A',
        customerName: 'PT Contoh',
        status: TripStatus.headingToPickup,
        etdLabel: 'Tanggal DO 2026-04-18',
        statusNote: 'Menuju pickup',
        allowsDirectCargoInput: true,
        trackingState: 'STOPPED',
      );
      final activeTrip = stoppedTrip.copyWith(trackingState: 'ACTIVE');

      expect(stoppedTrip.hasActiveTracking, isFalse);
      expect(activeTrip.hasActiveTracking, isTrue);
    });
  });

  group('DriverIncident', () {
    test('allows extra cost while driver draft waits for admin review', () {
      const incident = DriverIncident(
        id: 'incident-1',
        incidentNumber: 'INC-001',
        status: 'IN_PROGRESS',
        incidentType: 'OTHER',
        urgency: 'LOW',
        relatedDeliveryOrderRef: 'do-1',
        relatedDONumber: 'DO-001',
        description: 'Ban pecah',
        locationText: 'Tol',
        pendingDriverResolutionRequestedAt: '2026-05-19T10:00:00.000Z',
        settlementLines: [
          DriverIncidentSettlementLine(
            id: 'line-1',
            status: 'DRAFT',
            category: 'REPAIR',
            amount: 100000,
            description: 'Tambal ban',
            isDriverSubmitted: true,
          ),
        ],
      );

      expect(incident.hasSubmittedResolution, isTrue);
      expect(incident.hasReviewedResolution, isFalse);
      expect(incident.isWaitingResolutionReview, isTrue);
      expect(incident.canSubmitResolution, isFalse);
      expect(incident.canAddResolutionCost, isTrue);
      expect(incident.canOpenResolutionForm, isTrue);
      expect(incident.blocksNewIncidentReport, isTrue);
    });

    test('allows driver resolution when admin-only cost line exists', () {
      const incident = DriverIncident(
        id: 'incident-2',
        incidentNumber: 'INC-002',
        status: 'IN_PROGRESS',
        incidentType: 'OTHER',
        urgency: 'LOW',
        relatedDeliveryOrderRef: 'do-2',
        relatedDONumber: 'DO-002',
        description: 'Kerusakan',
        locationText: 'Gudang',
        settlementLines: [
          DriverIncidentSettlementLine(
            id: 'line-2',
            status: 'APPROVED',
            category: 'REPAIR',
            amount: 150000,
            description: 'Perbaikan',
          ),
        ],
      );

      expect(incident.hasSubmittedResolution, isFalse);
      expect(incident.hasReviewedResolution, isFalse);
      expect(incident.isWaitingResolutionReview, isFalse);
      expect(incident.canSubmitResolution, isTrue);
      expect(incident.canAddResolutionCost, isFalse);
      expect(incident.canOpenResolutionForm, isTrue);
      expect(incident.blocksNewIncidentReport, isTrue);
    });

    test(
      'blocks driver resolution after driver-submitted line is reviewed',
      () {
        const incident = DriverIncident(
          id: 'incident-2b',
          incidentNumber: 'INC-002B',
          status: 'IN_PROGRESS',
          incidentType: 'OTHER',
          urgency: 'LOW',
          relatedDeliveryOrderRef: 'do-2',
          relatedDONumber: 'DO-002',
          description: 'Kerusakan',
          locationText: 'Gudang',
          settlementLines: [
            DriverIncidentSettlementLine(
              id: 'line-2b',
              status: 'APPROVED',
              category: 'REPAIR',
              amount: 150000,
              description: 'Perbaikan',
              isDriverSubmitted: true,
            ),
          ],
        );

        expect(incident.hasSubmittedResolution, isTrue);
        expect(incident.hasReviewedResolution, isTrue);
        expect(incident.isWaitingResolutionReview, isFalse);
        expect(incident.canSubmitResolution, isFalse);
        expect(incident.canAddResolutionCost, isFalse);
        expect(incident.canOpenResolutionForm, isFalse);
        expect(incident.blocksNewIncidentReport, isTrue);
      },
    );

    test('blocks new incident report until admin closes the incident', () {
      const resolvedIncident = DriverIncident(
        id: 'incident-3',
        incidentNumber: 'INC-003',
        status: 'RESOLVED',
        incidentType: 'OTHER',
        urgency: 'LOW',
        relatedDeliveryOrderRef: 'do-3',
        relatedDONumber: 'DO-003',
        description: 'Sudah selesai tapi belum ditutup admin',
        locationText: 'Gudang',
      );
      const closedIncident = DriverIncident(
        id: 'incident-4',
        incidentNumber: 'INC-004',
        status: 'CLOSED',
        incidentType: 'OTHER',
        urgency: 'LOW',
        relatedDeliveryOrderRef: 'do-4',
        relatedDONumber: 'DO-004',
        description: 'Sudah ditutup',
        locationText: 'Gudang',
      );

      expect(resolvedIncident.blocksNewIncidentReport, isTrue);
      expect(resolvedIncident.canOpenResolutionForm, isFalse);
      expect(closedIncident.blocksNewIncidentReport, isFalse);
      expect(closedIncident.canOpenResolutionForm, isFalse);
    });
  });
}
