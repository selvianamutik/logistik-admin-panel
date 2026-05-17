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
        DeliveryCargoItem(
          id: 'item-3',
          description: 'Semen',
          shipperReferenceNumber: 'SJ-011',
          qtyKoli: 7,
          weightInputValue: 700,
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
      expect(result!.actualDropPoints.first.deliveryOrderItemRef, 'item-1');
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

    testWidgets('renders drop allocation as a separate workflow section', (
      tester,
    ) async {
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
      await tester.drag(find.byType(Scrollable).first, const Offset(0, -700));
      await tester.pumpAndSettle();

      expect(find.text('Tentukan Realisasi Titik Drop'), findsOneWidget);
      expect(find.text('Alokasi Barang Titik Ini'), findsOneWidget);
      expect(find.textContaining('SJ-001 | 10 koli / 750 KG'), findsOneWidget);
    });

    testWidgets(
      'scopes initial finalization and drop references to selected SJ',
      (tester) async {
        await tester.pumpWidget(
          MaterialApp(
            theme: buildAppTheme(),
            home: const DeliveryCompletionPage(
              trip: multiTargetTrip,
              customerRecipients: [],
              initialSelectedSuratJalanRefs: ['do-002:SJ-010'],
            ),
          ),
        );

        await tester.pumpAndSettle();

        final sj010Tile = tester.widget<CheckboxListTile>(
          find.widgetWithText(CheckboxListTile, 'SJ-010'),
        );
        final sj011Tile = tester.widget<CheckboxListTile>(
          find.widgetWithText(CheckboxListTile, 'SJ-011'),
        );

        expect(sj010Tile.value, isTrue);
        expect(sj011Tile.value, isFalse);

        await tester.drag(find.byType(Scrollable).first, const Offset(0, -450));
        await tester.pumpAndSettle();

        expect(find.text('Beras'), findsOneWidget);
        expect(find.text('Semen'), findsNothing);

        final dropReferenceDropdown = find.byWidgetPredicate(
          (widget) =>
              widget is DropdownButtonFormField<String> &&
              widget.decoration.labelText == 'Tentukan Barang',
          description: 'Tentukan Barang dropdown',
          skipOffstage: false,
        );
        final sj011TextCountBeforeOpen = find.text('SJ-011').evaluate().length;

        await tester.scrollUntilVisible(
          dropReferenceDropdown,
          300,
          scrollable: find.byType(Scrollable).first,
        );
        await tester.pumpAndSettle();
        await tester.tap(dropReferenceDropdown.first);
        await tester.pumpAndSettle();

        expect(find.textContaining('SJ-010'), findsWidgets);
        expect(find.text('SJ-011').evaluate().length, sj011TextCountBeforeOpen);
        expect(tester.takeException(), isNull);
      },
    );

    testWidgets(
      'derives actual item from item-specific billable drop when part is hold',
      (tester) async {
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

        await tester.drag(find.byType(Scrollable).first, const Offset(0, -900));
        await tester.pumpAndSettle();
        await tester.enterText(
          find.widgetWithText(TextFormField, 'Nama Lokasi').first,
          'PT Penerima',
        );
        await tester.pumpAndSettle();

        final cargoTargetDropdown = find.byWidgetPredicate(
          (widget) =>
              widget is DropdownButtonFormField<String> &&
              widget.decoration.labelText == 'Tentukan Barang',
          description: 'Tentukan Barang dropdown',
          skipOffstage: false,
        );
        await tester.ensureVisible(cargoTargetDropdown.first);
        await tester.pumpAndSettle();
        await tester.tap(cargoTargetDropdown.first);
        await tester.pumpAndSettle();
        await tester.tap(find.text('SJ-001 - Keramik').last);
        await tester.pumpAndSettle();

        await tester.enterText(
          find.widgetWithText(TextFormField, 'Qty Drop').first,
          '6',
        );
        await tester.pumpAndSettle();

        final addDropButton = find.widgetWithText(
          OutlinedButton,
          'Tambah Titik Drop',
        );
        await tester.scrollUntilVisible(
          addDropButton,
          240,
          scrollable: find.byType(Scrollable).first,
        );
        tester.widget<OutlinedButton>(addDropButton).onPressed?.call();
        await tester.pumpAndSettle();

        final typeDropdown = find.byWidgetPredicate(
          (widget) =>
              widget is DropdownButtonFormField<String> &&
              widget.decoration.labelText == 'Tipe',
          description: 'Tipe dropdown',
          skipOffstage: false,
        );
        await tester.ensureVisible(typeDropdown.last);
        await tester.tap(typeDropdown.last);
        await tester.pumpAndSettle();
        await tester.tap(find.text('Hold Gudang').last);
        await tester.pumpAndSettle();

        await tester.tap(find.byIcon(Icons.check_circle_rounded));
        await tester.pumpAndSettle();

        expect(result, isNotNull);
        expect(result!.actualItems, hasLength(1));
        expect(result!.actualItems.first.deliveryOrderItemRef, 'item-1');
        expect(result!.actualItems.first.actualQtyKoli, 6);
        expect(result!.actualItems.first.actualWeightInputValue, 450);
        expect(result!.actualDropPoints, hasLength(2));
        expect(result!.actualDropPoints.first.deliveryOrderItemRef, 'item-1');
        expect(result!.actualDropPoints.first.deliveryOrderItemRefs, [
          'item-1',
        ]);
        expect(result!.actualDropPoints.first.qtyKoli, 6);
        expect(result!.actualDropPoints.last.stopType, 'HOLD');
        expect(result!.actualDropPoints.last.deliveryOrderItemRef, 'item-1');
        expect(result!.actualDropPoints.last.qtyKoli, 4);
      },
    );

    testWidgets(
      'separates items inside one SJ when one item is delivered and another is hold',
      (tester) async {
        const sameSjMultiItemTrip = DeliveryTrip(
          deliveryOrderId: 'do-same-sj',
          doNumber: 'DO-SAME-SJ',
          vehiclePlate: 'L 2222 CC',
          originLabel: 'Gudang',
          destinationLabel: 'Satu SJ',
          customerName: 'PT Contoh',
          status: TripStatus.arrived,
          etdLabel: 'Tanggal DO 2026-04-18',
          statusNote: 'Driver sudah tiba',
          allowsDirectCargoInput: true,
          receiverName: 'PT Penerima',
          receiverAddress: 'Jl. Penerima',
          shipperReferences: [
            DeliveryShipperReference(
              referenceNumber: 'SJ-MIX',
              receiverCompany: 'PT Penerima',
              receiverAddress: 'Jl. Penerima',
            ),
          ],
          cargoItems: [
            DeliveryCargoItem(
              id: 'item-a',
              description: 'Barang Terkirim',
              shipperReferenceNumber: 'SJ-MIX',
              qtyKoli: 2,
              weightInputValue: 200,
              weightInputUnit: 'KG',
            ),
            DeliveryCargoItem(
              id: 'item-b',
              description: 'Barang Hold',
              shipperReferenceNumber: 'SJ-MIX',
              qtyKoli: 3,
              weightInputValue: 300,
              weightInputUnit: 'KG',
            ),
          ],
        );
        DeliveryCompletionSubmitResult? result;

        await tester.pumpWidget(
          MaterialApp(
            theme: buildAppTheme(),
            home: Builder(
              builder: (context) => Scaffold(
                body: FilledButton(
                  onPressed: () async {
                    result = await Navigator.of(context).push(
                      MaterialPageRoute(
                        builder: (_) => const DeliveryCompletionPage(
                          trip: sameSjMultiItemTrip,
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
        );

        await tester.tap(find.text('Open'));
        await tester.pumpAndSettle();
        await tester.drag(find.byType(Scrollable).first, const Offset(0, -900));
        await tester.pumpAndSettle();
        final locationField = find.widgetWithText(TextFormField, 'Nama Lokasi');
        await tester.scrollUntilVisible(
          locationField,
          300,
          scrollable: find.byType(Scrollable).first,
        );
        await tester.enterText(locationField.first, 'PT Penerima');
        await tester.pumpAndSettle();

        final cargoTargetDropdown = find.byWidgetPredicate(
          (widget) =>
              widget is DropdownButtonFormField<String> &&
              widget.decoration.labelText == 'Tentukan Barang',
          description: 'Tentukan Barang dropdown',
          skipOffstage: false,
        );
        await tester.drag(find.byType(Scrollable).first, const Offset(0, 420));
        await tester.pumpAndSettle();
        await tester.tap(cargoTargetDropdown.first);
        await tester.pumpAndSettle();
        await tester.tap(find.text('SJ-MIX - Barang Terkirim').last);
        await tester.pumpAndSettle();

        final addDropButton = find.widgetWithText(
          OutlinedButton,
          'Tambah Titik Drop',
        );
        await tester.scrollUntilVisible(
          addDropButton,
          240,
          scrollable: find.byType(Scrollable).first,
        );
        tester.widget<OutlinedButton>(addDropButton).onPressed?.call();
        await tester.pumpAndSettle();

        final typeDropdown = find.byWidgetPredicate(
          (widget) =>
              widget is DropdownButtonFormField<String> &&
              widget.decoration.labelText == 'Tipe',
          description: 'Tipe dropdown',
          skipOffstage: false,
        );
        await tester.ensureVisible(typeDropdown.last);
        await tester.tap(typeDropdown.last);
        await tester.pumpAndSettle();
        await tester.tap(find.text('Hold Gudang').last);
        await tester.pumpAndSettle();

        await tester.tap(find.byIcon(Icons.check_circle_rounded));
        await tester.pumpAndSettle();

        expect(result, isNotNull);
        final actualByItem = {
          for (final item in result!.actualItems)
            item.deliveryOrderItemRef: item,
        };
        expect(actualByItem['item-a']?.actualQtyKoli, 2);
        expect(actualByItem['item-a']?.actualWeightInputValue, 200);
        expect(actualByItem['item-b']?.actualQtyKoli, 0);
        expect(actualByItem['item-b']?.actualWeightInputValue, 0);
        expect(result!.actualDropPoints, hasLength(2));
        expect(result!.actualDropPoints.first.deliveryOrderItemRef, 'item-a');
        expect(result!.actualDropPoints.last.stopType, 'HOLD');
        expect(result!.actualDropPoints.last.deliveryOrderItemRef, 'item-b');
      },
    );

    testWidgets('continues partial hold from remaining hold cargo only', (
      tester,
    ) async {
      const partialHoldContinuationTrip = DeliveryTrip(
        deliveryOrderId: 'do-hold-continue',
        doNumber: 'DO-HOLD-CONTINUE',
        vehiclePlate: 'L 4444 EE',
        originLabel: 'Gudang',
        destinationLabel: 'Surabaya',
        customerName: 'PT Contoh',
        status: TripStatus.partialHold,
        etdLabel: 'Tanggal DO 2026-04-18',
        statusNote: 'Sebagian muatan hold',
        allowsDirectCargoInput: true,
        receiverName: 'PT Penerima',
        receiverAddress: 'Jl. Penerima',
        shipperReferences: [
          DeliveryShipperReference(
            referenceNumber: 'SJ-HOLD',
            documentId: 'do-hold-continue:SJ-HOLD',
            tripStatus: 'PARTIAL_HOLD',
            receiverCompany: 'PT Penerima',
            receiverAddress: 'Jl. Penerima',
          ),
        ],
        cargoItems: [
          DeliveryCargoItem(
            id: 'item-hold',
            description: 'Barang Hold Lanjutan',
            shipperReferenceNumber: 'SJ-HOLD',
            qtyKoli: 3,
            weightInputValue: 180,
            weightInputUnit: 'KG',
            volumeInputValue: 3,
            volumeInputUnit: 'M3',
            actualQtyKoli: 3,
            actualWeightInputValue: 190,
            actualWeightInputUnit: 'KG',
            actualVolumeInputValue: 3,
            actualVolumeInputUnit: 'M3',
          ),
        ],
        actualDropPoints: [
          DeliveryActualDropPoint(
            stopType: 'DROP',
            deliveryOrderItemRef: 'item-hold',
            deliveryOrderItemRefs: ['item-hold'],
            shipperReferenceNumber: 'SJ-HOLD',
            locationName: 'PT Penerima',
            locationAddress: 'Jl. Penerima',
            qtyKoli: 1,
            weightInputValue: 70,
            weightInputUnit: 'KG',
            volumeInputValue: 1,
            volumeInputUnit: 'M3',
          ),
          DeliveryActualDropPoint(
            stopType: 'HOLD',
            deliveryOrderItemRef: 'item-hold',
            deliveryOrderItemRefs: ['item-hold'],
            shipperReferenceNumber: 'SJ-HOLD',
            locationName: 'Gudang Hold',
            locationAddress: 'Jl. Hold',
            qtyKoli: 2,
            weightInputValue: 120,
            weightInputUnit: 'KG',
            volumeInputValue: 2,
            volumeInputUnit: 'M3',
          ),
        ],
      );
      DeliveryCompletionSubmitResult? result;

      await tester.pumpWidget(
        MaterialApp(
          theme: buildAppTheme(),
          home: Builder(
            builder: (context) => Scaffold(
              body: FilledButton(
                onPressed: () async {
                  result = await Navigator.of(context).push(
                    MaterialPageRoute(
                      builder: (_) => const DeliveryCompletionPage(
                        trip: partialHoldContinuationTrip,
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
      );

      await tester.tap(find.text('Open'));
      await tester.pumpAndSettle();

      await tester.tap(find.byIcon(Icons.check_circle_rounded));
      await tester.pumpAndSettle();

      expect(result, isNotNull);
      expect(result!.actualItems, hasLength(1));
      expect(result!.actualItems.first.deliveryOrderItemRef, 'item-hold');
      expect(result!.actualItems.first.actualQtyKoli, 2);
      expect(result!.actualItems.first.actualWeightInputValue, 120);
      expect(result!.actualItems.first.actualVolumeInputValue, 2);
      expect(result!.actualDropPoints, hasLength(1));
      expect(result!.actualDropPoints.first.stopType, 'DROP');
      expect(result!.actualDropPoints.first.deliveryOrderItemRef, 'item-hold');
      expect(result!.actualDropPoints.first.qtyKoli, 2);
      expect(result!.actualDropPoints.first.weightInputValue, 120);
      expect(result!.actualDropPoints.first.volumeInputValue, 2);
      expect(result!.actualDropPoints.first.originLocationName, 'Gudang Hold');
      expect(result!.actualDropPoints.first.originLocationAddress, 'Jl. Hold');
      expect(result!.actualDropPoints.first.locationName, 'PT Penerima');
    });

    testWidgets(
      'blocks mixed drop and hold in one SJ when the item is still ambiguous',
      (tester) async {
        const sameSjMultiItemTrip = DeliveryTrip(
          deliveryOrderId: 'do-ambiguous',
          doNumber: 'DO-AMBIGUOUS',
          vehiclePlate: 'L 3333 DD',
          originLabel: 'Gudang',
          destinationLabel: 'Satu SJ',
          customerName: 'PT Contoh',
          status: TripStatus.arrived,
          etdLabel: 'Tanggal DO 2026-04-18',
          statusNote: 'Driver sudah tiba',
          allowsDirectCargoInput: true,
          receiverName: 'PT Penerima',
          receiverAddress: 'Jl. Penerima',
          shipperReferences: [
            DeliveryShipperReference(
              referenceNumber: 'SJ-MIX',
              receiverCompany: 'PT Penerima',
              receiverAddress: 'Jl. Penerima',
            ),
          ],
          cargoItems: [
            DeliveryCargoItem(
              id: 'item-a',
              description: 'Barang A',
              shipperReferenceNumber: 'SJ-MIX',
              qtyKoli: 2,
              weightInputValue: 200,
              weightInputUnit: 'KG',
            ),
            DeliveryCargoItem(
              id: 'item-b',
              description: 'Barang B',
              shipperReferenceNumber: 'SJ-MIX',
              qtyKoli: 3,
              weightInputValue: 300,
              weightInputUnit: 'KG',
            ),
          ],
        );
        DeliveryCompletionSubmitResult? result;

        await tester.pumpWidget(
          MaterialApp(
            theme: buildAppTheme(),
            home: Builder(
              builder: (context) => Scaffold(
                body: FilledButton(
                  onPressed: () async {
                    result = await Navigator.of(context).push(
                      MaterialPageRoute(
                        builder: (_) => const DeliveryCompletionPage(
                          trip: sameSjMultiItemTrip,
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
        );

        await tester.tap(find.text('Open'));
        await tester.pumpAndSettle();
        await tester.drag(find.byType(Scrollable).first, const Offset(0, -900));
        await tester.pumpAndSettle();
        final locationField = find.widgetWithText(TextFormField, 'Nama Lokasi');
        await tester.scrollUntilVisible(
          locationField,
          300,
          scrollable: find.byType(Scrollable).first,
        );
        await tester.enterText(locationField.first, 'PT Penerima');
        await tester.pumpAndSettle();

        final addDropButton = find.widgetWithText(
          OutlinedButton,
          'Tambah Titik Drop',
        );
        await tester.scrollUntilVisible(
          addDropButton,
          240,
          scrollable: find.byType(Scrollable).first,
        );
        tester.widget<OutlinedButton>(addDropButton).onPressed?.call();
        await tester.pumpAndSettle();

        final typeDropdown = find.byWidgetPredicate(
          (widget) =>
              widget is DropdownButtonFormField<String> &&
              widget.decoration.labelText == 'Tipe',
          description: 'Tipe dropdown',
          skipOffstage: false,
        );
        await tester.ensureVisible(typeDropdown.last);
        await tester.tap(typeDropdown.last);
        await tester.pumpAndSettle();
        await tester.tap(find.text('Hold Gudang').last);
        await tester.pumpAndSettle();

        final cargoTargetDropdown = find.byWidgetPredicate(
          (widget) =>
              widget is DropdownButtonFormField<String> &&
              widget.decoration.labelText == 'Tentukan Barang',
          description: 'Tentukan Barang dropdown',
          skipOffstage: false,
        );
        await tester.ensureVisible(cargoTargetDropdown.last);
        await tester.tap(cargoTargetDropdown.last);
        await tester.pumpAndSettle();
        await tester.tap(find.text('SJ-MIX - semua barang').last);
        await tester.pumpAndSettle();

        await tester.tap(find.byIcon(Icons.check_circle_rounded));
        await tester.pumpAndSettle();

        expect(result, isNull);
        expect(find.textContaining('campuran drop dan hold'), findsOneWidget);
      },
    );

    testWidgets(
      'keeps pending partial SJ disabled while other SJ can proceed',
      (tester) async {
        const pendingPartialTrip = DeliveryTrip(
          deliveryOrderId: 'do-partial',
          doNumber: 'DO-PARTIAL',
          vehiclePlate: 'L 1234 BB',
          originLabel: 'Gudang B',
          destinationLabel: 'Multi',
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
          cargoItems: [
            DeliveryCargoItem(
              id: 'item-a',
              description: 'Barang A',
              shipperReferenceNumber: 'SJ-A',
              qtyKoli: 5,
              weightInputValue: 500,
              weightInputUnit: 'KG',
            ),
            DeliveryCargoItem(
              id: 'item-b',
              description: 'Barang B',
              shipperReferenceNumber: 'SJ-B',
              qtyKoli: 3,
              weightInputValue: 300,
              weightInputUnit: 'KG',
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

        await tester.pumpWidget(
          MaterialApp(
            theme: buildAppTheme(),
            home: const DeliveryCompletionPage(
              trip: pendingPartialTrip,
              customerRecipients: [],
            ),
          ),
        );

        await tester.pumpAndSettle();

        final sjATile = tester.widget<CheckboxListTile>(
          find.widgetWithText(CheckboxListTile, 'SJ-A'),
        );
        final sjBTile = tester.widget<CheckboxListTile>(
          find.widgetWithText(CheckboxListTile, 'SJ-B'),
        );

        expect(sjATile.value, isFalse);
        expect(sjATile.onChanged, isNull);
        expect(sjBTile.value, isTrue);
        expect(sjBTile.onChanged, isNotNull);
        expect(find.textContaining('Menunggu approval admin'), findsOneWidget);
        expect(tester.takeException(), isNull);
      },
    );

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

    testWidgets('warns before removing an actual drop point', (tester) async {
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

      final addDropButton = find.widgetWithText(
        OutlinedButton,
        'Tambah Titik Drop',
      );
      await tester.scrollUntilVisible(
        addDropButton,
        240,
        scrollable: find.byType(Scrollable).first,
      );
      await tester.pumpAndSettle();
      await tester.tap(addDropButton);
      await tester.pumpAndSettle();

      expect(find.text('Titik Drop 1', skipOffstage: false), findsOneWidget);
      expect(find.text('Titik Drop 2', skipOffstage: false), findsOneWidget);

      await tester.scrollUntilVisible(
        find.text('Titik Drop 2'),
        120,
        scrollable: find.byType(Scrollable).first,
      );
      await tester.pumpAndSettle();
      await tester.tap(find.byIcon(Icons.delete_outline_rounded).last);
      await tester.pumpAndSettle();
      expect(find.text('Hapus titik drop?'), findsOneWidget);

      await tester.tap(find.text('Batal'));
      await tester.pumpAndSettle();
      expect(find.text('Titik Drop 2', skipOffstage: false), findsOneWidget);

      await tester.tap(find.byIcon(Icons.delete_outline_rounded).last);
      await tester.pumpAndSettle();
      await tester.tap(find.widgetWithText(FilledButton, 'Hapus Titik'));
      await tester.pumpAndSettle();

      expect(find.text('Titik Drop 1', skipOffstage: false), findsOneWidget);
      expect(find.text('Titik Drop 2', skipOffstage: false), findsNothing);
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
      expect(
        find.widgetWithText(FilledButton, 'Ajukan Selesai'),
        findsOneWidget,
      );
      tester.view.viewInsets = const FakeViewPadding();
      await tester.pumpAndSettle();
      expect(
        find.widgetWithText(FilledButton, 'Ajukan Selesai'),
        findsOneWidget,
      );
      expect(tester.takeException(), isNull);
    });

    testWidgets('keeps added drop point reachable while keyboard is open', (
      tester,
    ) async {
      tester.view.physicalSize = const Size(360, 640);
      tester.view.devicePixelRatio = 1;
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

      tester.view.viewInsets = const FakeViewPadding(bottom: 300);
      await tester.pumpAndSettle();

      final addDropButton = find.widgetWithText(
        OutlinedButton,
        'Tambah Titik Drop',
        skipOffstage: false,
      );
      await tester.scrollUntilVisible(
        addDropButton,
        240,
        scrollable: find.byType(Scrollable).first,
      );
      tester.widget<OutlinedButton>(addDropButton).onPressed?.call();
      await tester.pumpAndSettle();

      final usableBottom =
          tester.view.physicalSize.height - tester.view.viewInsets.bottom;
      final secondDropTitle = find.text('Titik Drop 2', skipOffstage: false);
      expect(secondDropTitle, findsOneWidget);
      expect(tester.getRect(secondDropTitle).center.dy, lessThan(usableBottom));

      final locationFields = find.widgetWithText(
        TextFormField,
        'Nama Lokasi',
        skipOffstage: false,
      );
      expect(locationFields, findsAtLeastNWidgets(1));
      await tester.enterText(locationFields.last, 'Gudang Hold');
      await tester.pumpAndSettle();
      expect(
        tester.widget<TextFormField>(locationFields.last).controller?.text,
        'Gudang Hold',
      );
      expect(
        tester.getRect(locationFields.last).center.dy,
        lessThan(usableBottom),
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
