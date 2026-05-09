import 'package:driver_app/src/features/tracking/domain/models.dart';
import 'package:driver_app/src/features/tracking/presentation/delivery_completion_page.dart';
import 'package:driver_app/src/shared/theme.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('DeliveryCompletionPage', () {
    const singleTargetTrip = DeliveryTrip(
      deliveryOrderId: 'do-001',
      doNumber: 'DO-001',
      vehiclePlate: 'L 1234 AA',
      originLabel: 'Gudang A',
      destinationLabel: 'Surabaya',
      customerName: 'PT Contoh',
      status: TripStatus.arrived,
      etdLabel: 'Tanggal DO 2026-04-18',
      statusNote: 'Driver sudah tiba',
      allowsDirectCargoInput: true,
      receiverName: 'PT Penerima',
      receiverAddress: 'Jl. Raya 1',
      shipperReferences: [
        DeliveryShipperReference(
          referenceNumber: 'SJ-001',
          receiverCompany: 'PT Penerima',
          receiverAddress: 'Jl. Raya 1',
        ),
      ],
      cargoItems: [
        DeliveryCargoItem(
          id: 'item-1',
          description: 'Keramik',
          qtyKoli: 10,
          weightInputValue: 750,
          weightInputUnit: 'KG',
        ),
      ],
    );

    const multiTargetTrip = DeliveryTrip(
      deliveryOrderId: 'do-002',
      doNumber: 'DO-002',
      vehiclePlate: 'L 1234 BB',
      originLabel: 'Gudang B',
      destinationLabel: 'Multi',
      customerName: 'PT Contoh',
      status: TripStatus.arrived,
      etdLabel: 'Tanggal DO 2026-04-18',
      statusNote: 'Driver sudah tiba',
      allowsDirectCargoInput: true,
      shipperReferences: [
        DeliveryShipperReference(
          referenceNumber: 'SJ-010',
          receiverCompany: 'PT Alpha',
          receiverAddress: 'Jl. Alpha',
        ),
        DeliveryShipperReference(
          referenceNumber: 'SJ-011',
          receiverCompany: 'PT Beta',
          receiverAddress: 'Jl. Beta',
        ),
      ],
      cargoItems: [
        DeliveryCargoItem(
          id: 'item-2',
          description: 'Beras',
          qtyKoli: 5,
          weightInputValue: 500,
          weightInputUnit: 'KG',
        ),
      ],
    );

    testWidgets('submits actual cargo and drop for single target trip', (
      tester,
    ) async {
      DeliveryCompletionSubmitResult? result;

      await tester.pumpWidget(
        MaterialApp(
          theme: buildAppTheme(),
          home: Builder(
            builder: (context) => Scaffold(
              body: Center(
                child: FilledButton(
                  onPressed: () async {
                    result = await Navigator.of(context).push(
                      MaterialPageRoute(
                        builder: (_) => const DeliveryCompletionPage(
                          trip: singleTargetTrip,
                          customerRecipients: [],
                        ),
                      ),
                    );
                  },
                  child: const Text('Open'),
                ),
              ),
            ),
          ),
        ),
      );

      await tester.tap(find.text('Open'));
      await tester.pumpAndSettle();

      final locationField = find.byWidgetPredicate(
        (widget) =>
            widget is TextField &&
            widget.decoration?.labelText == 'Nama Lokasi',
        description: 'Nama Lokasi TextField',
        skipOffstage: false,
      );
      await tester.ensureVisible(locationField);
      await tester.enterText(locationField, 'PT Penerima');
      await tester.pumpAndSettle();

      await tester.tap(find.byIcon(Icons.check_circle_rounded));
      await tester.pumpAndSettle();

      expect(result, isNotNull);
      expect(result!.actualItems, hasLength(1));
      expect(result!.actualItems.first.deliveryOrderItemRef, 'item-1');
      expect(result!.actualItems.first.actualQtyKoli, 10);
      expect(result!.actualDropPoints, hasLength(1));
      expect(result!.actualDropPoints.first.locationName, 'PT Penerima');
      expect(result!.actualDropPoints.first.qtyKoli, 10);
    });

    testWidgets('renders multi target helper notice', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          theme: buildAppTheme(),
          home: const DeliveryCompletionPage(
            trip: multiTargetTrip,
            customerRecipients: [],
          ),
        ),
      );

      await tester.pumpAndSettle();

      expect(find.textContaining('beberapa target SJ'), findsOneWidget);
    });

    testWidgets('keeps actual cargo and drop fields usable on compact width', (
      tester,
    ) async {
      tester.view.physicalSize = const Size(320, 720);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      await tester.pumpWidget(
        MaterialApp(
          theme: buildAppTheme(),
          home: const DeliveryCompletionPage(
            trip: multiTargetTrip,
            customerRecipients: [
              CustomerRecipientOption(
                id: 'recipient-1',
                customerRef: 'customer-1',
                label: 'Gudang Transit Pelanggan Dengan Nama Panjang',
                receiverName: 'PT Penerima Dengan Nama Sangat Panjang',
                receiverAddress:
                    'Jl. Industri Barat Nomor 123, Kawasan Pergudangan',
                receiverCompany: 'PT Penerima Dengan Nama Sangat Panjang',
              ),
            ],
          ),
        ),
      );

      await tester.pumpAndSettle();

      expect(find.text('Ajukan Selesai'), findsWidgets);
      expect(tester.takeException(), isNull);
    });
  });
}
