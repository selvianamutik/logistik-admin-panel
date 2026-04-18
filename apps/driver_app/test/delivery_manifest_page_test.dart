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
  });
}
