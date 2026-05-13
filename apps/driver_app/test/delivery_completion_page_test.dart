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
          shipperReferenceNumber: 'SJ-001',
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
          documentId: 'do-002:SJ-010',
          receiverCompany: 'PT Alpha',
          receiverAddress: 'Jl. Alpha',
        ),
        DeliveryShipperReference(
          referenceNumber: 'SJ-011',
          documentId: 'do-002:SJ-011',
          receiverCompany: 'PT Beta',
          receiverAddress: 'Jl. Beta',
        ),
      ],
      cargoItems: [
        DeliveryCargoItem(
          id: 'item-2',
          description: 'Beras',
          shipperReferenceNumber: 'SJ-010',
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
      await tester.drag(find.byType(Scrollable).first, const Offset(0, -900));
      await tester.pumpAndSettle();
      await tester.enterText(locationField.first, 'PT Penerima');
      await tester.pumpAndSettle();

      await tester.tap(find.byIcon(Icons.check_circle_rounded));
      await tester.pumpAndSettle();

      expect(result, isNotNull);
      expect(result!.actualItems, hasLength(1));
      expect(result!.actualItems.first.deliveryOrderItemRef, 'item-1');
      expect(result!.actualItems.first.actualQtyKoli, 10);
      expect(result!.podReceiverName, 'PT Penerima');
      expect(result!.podReceivedDate, matches(RegExp(r'^\d{4}-\d{2}-\d{2}$')));
      expect(result!.selectedSuratJalanRefs, ['do-001:SJ-001']);
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
      expect(find.text('SJ Finalisasi'), findsOneWidget);
      expect(find.text('SJ-010'), findsWidgets);
      expect(find.text('SJ-011'), findsWidgets);
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

    testWidgets('keeps actual numeric input stable while keyboard is open', (
      tester,
    ) async {
      tester.view.physicalSize = const Size(360, 900);
      tester.view.devicePixelRatio = 1;
      tester.view.viewInsets = const FakeViewPadding(bottom: 320);
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      addTearDown(tester.view.resetViewInsets);

      await tester.pumpWidget(
        MaterialApp(
          theme: buildAppTheme(),
          home: const DeliveryCompletionPage(
            trip: singleTargetTrip,
            customerRecipients: [],
          ),
        ),
      );

      await tester.pumpAndSettle();

      final actualKoliField = find.widgetWithText(
        TextFormField,
        'Qty Aktual *',
        skipOffstage: false,
      );

      await tester.drag(find.byType(Scrollable).first, const Offset(0, -350));
      await tester.pumpAndSettle();
      await tester.enterText(actualKoliField.first, '8');
      await tester.pumpAndSettle();

      final koliWidget = tester.widget<TextFormField>(actualKoliField.first);
      expect(koliWidget.controller?.text, '8');
      expect(find.widgetWithText(FilledButton, 'Ajukan Selesai'), findsNothing);
      tester.view.viewInsets = const FakeViewPadding();
      await tester.pumpAndSettle();
      expect(
        find.widgetWithText(FilledButton, 'Ajukan Selesai'),
        findsOneWidget,
      );
      expect(tester.takeException(), isNull);
    });

    testWidgets(
      'keeps focused actual input visible when viewport shrinks without insets',
      (tester) async {
        tester.view.physicalSize = const Size(360, 900);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);

        await tester.pumpWidget(
          MaterialApp(
            theme: buildAppTheme(),
            home: const DeliveryCompletionPage(
              trip: singleTargetTrip,
              customerRecipients: [],
            ),
          ),
        );

        await tester.pumpAndSettle();

        final actualKoliField = find.widgetWithText(
          TextFormField,
          'Qty Aktual *',
          skipOffstage: false,
        );

        await tester.drag(find.byType(Scrollable).first, const Offset(0, -350));
        await tester.pumpAndSettle();
        await tester.ensureVisible(actualKoliField.first);
        await tester.pumpAndSettle();
        await tester.enterText(actualKoliField.first, '8');
        await tester.pumpAndSettle();

        tester.view.physicalSize = const Size(360, 520);
        await tester.pumpAndSettle();

        final rect = tester.getRect(actualKoliField.first);
        expect(rect.top, greaterThanOrEqualTo(0));
        expect(rect.bottom, lessThanOrEqualTo(tester.view.physicalSize.height));
        expect(tester.takeException(), isNull);
      },
    );

    testWidgets('renders legacy units and duplicate SJ references safely', (
      tester,
    ) async {
      const legacyTrip = DeliveryTrip(
        deliveryOrderId: 'do-legacy',
        doNumber: 'DO-LEGACY',
        vehiclePlate: 'L 9999 ZZ',
        originLabel: 'Gudang',
        destinationLabel: 'Tujuan',
        customerName: 'PT Legacy',
        status: TripStatus.arrived,
        etdLabel: 'Tanggal DO 2026-04-18',
        statusNote: 'Driver sudah tiba',
        allowsDirectCargoInput: true,
        shipperReferences: [
          DeliveryShipperReference(referenceNumber: 'SJ-DUP'),
          DeliveryShipperReference(referenceNumber: 'SJ-DUP'),
        ],
        cargoItems: [
          DeliveryCargoItem(
            id: 'item-legacy',
            description: 'Barang legacy',
            qtyKoli: 3,
            weightInputValue: 15,
            weightInputUnit: 'KGS',
            volumeInputValue: 4,
            volumeInputUnit: 'CBM',
          ),
        ],
        pendingActualDropPoints: [
          DeliveryActualDropPoint(
            stopType: 'RETURN',
            locationName: 'Gudang penerima',
            qtyKoli: 3,
            weightInputValue: 15,
            weightInputUnit: 'KGS',
            volumeInputValue: 4,
            volumeInputUnit: 'CBM',
          ),
        ],
      );

      await tester.pumpWidget(
        MaterialApp(
          theme: buildAppTheme(),
          home: const DeliveryCompletionPage(
            trip: legacyTrip,
            customerRecipients: [],
          ),
        ),
      );

      await tester.pumpAndSettle();

      await tester.drag(find.byType(Scrollable).first, const Offset(0, -450));
      await tester.pumpAndSettle();

      expect(find.text('Barang legacy'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  });
}
