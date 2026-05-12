import 'package:driver_app/src/features/tracking/domain/models.dart';
import 'package:driver_app/src/features/tracking/presentation/delivery_manifest_page.dart';
import 'package:driver_app/src/shared/theme.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('DeliveryManifestPage', () {
    const pickupStops = [
      DeliveryPickupStop(
        key: 'pickup-1',
        sequence: 1,
        pickupAddress: 'Gudang A',
        pickupLabel: 'Pabrik Baja',
      ),
    ];

    testWidgets('submits SJ only when direct cargo input is disabled', (
      tester,
    ) async {
      DeliveryManifestSubmitResult? capturedResult;

      await tester.pumpWidget(
        MaterialApp(
          theme: buildAppTheme(),
          home: Builder(
            builder: (context) => Scaffold(
              body: Center(
                child: FilledButton(
                  onPressed: () async {
                    capturedResult = await Navigator.of(context).push(
                      MaterialPageRoute(
                        builder: (_) => const DeliveryManifestPage(
                          title: 'Kelola SJ',
                          submitLabel: 'Simpan SJ',
                          pickupStops: pickupStops,
                          customerProducts: [],
                          allowsDirectCargoInput: false,
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

      await tester.enterText(
        find.widgetWithText(TextFormField, 'No. SJ Pengirim'),
        'bk-001',
      );
      await tester.tap(find.text('Simpan SJ'));
      await tester.pumpAndSettle();

      expect(find.text('Open'), findsOneWidget);
      expect(capturedResult, isNotNull);
      expect(capturedResult!.shipperReferences.length, 1);
      expect(capturedResult!.shipperReferences.first.referenceNumber, 'BK-001');
      expect(capturedResult!.cargoItems, isEmpty);
      expect(find.text('Tambah Barang di SJ Ini'), findsNothing);
    });

    testWidgets('submits SJ and cargo when direct cargo input is enabled', (
      tester,
    ) async {
      DeliveryManifestSubmitResult? capturedResult;

      await tester.pumpWidget(
        MaterialApp(
          theme: buildAppTheme(),
          home: Builder(
            builder: (context) => Scaffold(
              body: Center(
                child: FilledButton(
                  onPressed: () async {
                    capturedResult = await Navigator.of(context).push(
                      MaterialPageRoute(
                        builder: (_) => const DeliveryManifestPage(
                          title: 'Kelola SJ & Barang',
                          submitLabel: 'Simpan SJ & Barang',
                          pickupStops: pickupStops,
                          customerProducts: [],
                          allowsDirectCargoInput: true,
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

      await tester.enterText(
        find.widgetWithText(TextFormField, 'No. SJ Pengirim'),
        'sj-002',
      );
      await tester.enterText(
        find.widgetWithText(TextFormField, 'Deskripsi Barang'),
        'Keramik 40x40',
      );
      await tester.enterText(find.widgetWithText(TextFormField, 'Koli'), '12');
      await tester.enterText(
        find.widgetWithText(TextFormField, 'Berat'),
        '850',
      );
      await tester.tap(find.text('Simpan SJ & Barang'));
      await tester.pumpAndSettle();

      expect(find.text('Open'), findsOneWidget);
      expect(capturedResult, isNotNull);
      expect(capturedResult!.shipperReferences.length, 1);
      expect(capturedResult!.shipperReferences.first.referenceNumber, 'SJ-002');
      expect(capturedResult!.cargoItems.length, 1);
      expect(capturedResult!.cargoItems.first.description, 'Keramik 40x40');
      expect(capturedResult!.cargoItems.first.qtyKoli, 12);
      expect(capturedResult!.cargoItems.first.weightInputValue, 850);
      expect(capturedResult!.cargoItems.first.shipperReferenceNumber, 'SJ-002');
    });

    testWidgets('keeps cargo input usable on compact mobile width', (
      tester,
    ) async {
      tester.view.physicalSize = const Size(320, 720);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      await tester.pumpWidget(
        MaterialApp(
          theme: buildAppTheme(),
          home: const DeliveryManifestPage(
            title: 'Kelola SJ & Barang',
            submitLabel: 'Simpan SJ & Barang',
            pickupStops: pickupStops,
            customerProducts: [
              CustomerProductOption(
                id: 'product-1',
                customerRef: 'customer-1',
                code: 'KRM-PREMIUM-LONG',
                name: 'Keramik granit premium ukuran panjang',
                description: 'Keramik granit premium ukuran panjang',
                defaultQtyKoli: 1,
                defaultWeightInputValue: 12,
                defaultWeightInputUnit: 'KG',
              ),
            ],
            allowsDirectCargoInput: true,
          ),
        ),
      );

      await tester.pumpAndSettle();

      expect(find.text('Kelola SJ & Barang'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('keeps numeric cargo input stable while keyboard is open', (
      tester,
    ) async {
      tester.view.physicalSize = const Size(360, 640);
      tester.view.devicePixelRatio = 1;
      tester.view.viewInsets = const FakeViewPadding(bottom: 320);
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      addTearDown(tester.view.resetViewInsets);

      await tester.pumpWidget(
        MaterialApp(
          theme: buildAppTheme(),
          home: const DeliveryManifestPage(
            title: 'Kelola SJ & Barang',
            submitLabel: 'Simpan SJ & Barang',
            pickupStops: pickupStops,
            customerProducts: [],
            allowsDirectCargoInput: true,
          ),
        ),
      );

      await tester.pumpAndSettle();

      final sjField = find.widgetWithText(TextFormField, 'No. SJ Pengirim');
      final descriptionField = find.widgetWithText(
        TextFormField,
        'Deskripsi Barang',
      );
      final koliField = find.widgetWithText(TextFormField, 'Koli');

      await tester.enterText(sjField, 'sj-keyboard');
      await tester.enterText(descriptionField, 'Besi Beton');
      await tester.ensureVisible(koliField);
      await tester.enterText(koliField, '12');
      await tester.pumpAndSettle();

      final koliWidget = tester.widget<TextFormField>(koliField);
      expect(koliWidget.controller?.text, '12');
      expect(find.text('Simpan SJ & Barang'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('renders existing cargo with unknown unit values safely', (
      tester,
    ) async {
      await tester.pumpWidget(
        MaterialApp(
          theme: buildAppTheme(),
          home: const DeliveryManifestPage(
            title: 'Kelola SJ & Barang',
            submitLabel: 'Simpan SJ & Barang',
            pickupStops: pickupStops,
            customerProducts: [],
            allowsDirectCargoInput: true,
            initialShipperReferences: [
              DeliveryShipperReference(referenceNumber: 'SJ-LEGACY'),
            ],
            existingCargoItems: [
              DeliveryCargoItem(
                id: 'legacy-item',
                description: 'Barang lama',
                shipperReferenceNumber: 'SJ-LEGACY',
                qtyKoli: 1,
                weightInputValue: 10,
                weightInputUnit: 'KGS',
                volumeInputValue: 2,
                volumeInputUnit: 'CBM',
              ),
            ],
          ),
        ),
      );

      await tester.pumpAndSettle();

      expect(find.text('Barang lama'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  });
}
