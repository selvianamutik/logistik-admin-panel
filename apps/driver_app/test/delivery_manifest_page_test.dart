import 'package:driver_app/src/features/tracking/domain/models.dart';
import 'package:driver_app/src/features/tracking/presentation/delivery_manifest_page.dart';
import 'package:driver_app/src/features/tracking/presentation/mobile_unit_selector_field.dart';
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
    const multiPickupStops = [
      DeliveryPickupStop(
        key: 'pickup-1',
        sequence: 1,
        pickupAddress: 'Gudang A',
        pickupLabel: 'Pabrik Baja',
      ),
      DeliveryPickupStop(
        key: 'pickup-2',
        sequence: 2,
        pickupAddress: 'Gudang B',
        pickupLabel: 'Gudang B',
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

    testWidgets('chooses pickup per SJ from bottom sheet selector', (
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
                          pickupStops: multiPickupStops,
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

      await tester.tap(find.text('Pickup 1 - Pabrik Baja'));
      await tester.pumpAndSettle();
      expect(find.text('Pilih Pickup untuk SJ Ini'), findsOneWidget);

      await tester.tap(find.text('Pickup 2 - Gudang B'));
      await tester.pumpAndSettle();
      await tester.enterText(
        find.widgetWithText(TextFormField, 'No. SJ Pengirim'),
        'sj-pickup-2',
      );
      await tester.tap(find.text('Simpan SJ'));
      await tester.pumpAndSettle();

      expect(capturedResult, isNotNull);
      expect(
        capturedResult!.shipperReferences.single.referenceNumber,
        'SJ-PICKUP-2',
      );
      expect(
        capturedResult!.shipperReferences.single.pickupStopKey,
        'pickup-2',
      );
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
      final unitSelector = find.byType(MobileUnitSelectorField).first;
      await tester.ensureVisible(unitSelector);
      await tester.pumpAndSettle();
      await tester.tap(unitSelector);
      await tester.pumpAndSettle();
      await tester.tap(find.text('TON').last);
      await tester.pumpAndSettle();
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
      expect(capturedResult!.cargoItems.first.weightInputUnit, 'TON');
      expect(capturedResult!.cargoItems.first.shipperReferenceNumber, 'SJ-002');
    });

    testWidgets(
      'blocks direct cargo submit when item has no koli weight or volume',
      (tester) async {
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
          'sj-missing-metric',
        );
        await tester.enterText(
          find.widgetWithText(TextFormField, 'Deskripsi Barang'),
          'Barang tanpa ukuran',
        );
        await tester.tap(find.text('Simpan SJ & Barang'));
        await tester.pump();

        expect(capturedResult, isNull);
        expect(find.text('Simpan SJ & Barang'), findsOneWidget);
        expect(
          find.text(
            'Isi koli, berat, atau volume untuk semua barang yang dicatat.',
          ),
          findsOneWidget,
        );
      },
    );

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
      await tester.enterText(sjField, 'sj-keyboard');

      final descriptionField = find.widgetWithText(
        TextFormField,
        'Deskripsi Barang',
      );
      await tester.enterText(descriptionField, 'Besi Beton');
      final koliField = find.widgetWithText(TextFormField, 'Koli');
      await tester.ensureVisible(koliField);
      tester.view.viewInsets = const FakeViewPadding(bottom: 320);
      await tester.pumpAndSettle();
      await tester.enterText(koliField, '12');
      await tester.pumpAndSettle();

      final koliWidget = tester.widget<TextFormField>(koliField);
      expect(koliWidget.controller?.text, '12');
      expect(find.text('Simpan SJ & Barang'), findsOneWidget);
      tester.view.viewInsets = const FakeViewPadding();
      await tester.pumpAndSettle();
      expect(find.text('Simpan SJ & Barang'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('keeps added SJ and cargo reachable while keyboard is open', (
      tester,
    ) async {
      DeliveryManifestSubmitResult? capturedResult;

      tester.view.physicalSize = const Size(360, 640);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      addTearDown(tester.view.resetViewInsets);

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
        find.widgetWithText(TextFormField, 'No. SJ Pengirim').first,
        'sj-a',
      );
      await tester.enterText(
        find.widgetWithText(TextFormField, 'Deskripsi Barang').first,
        'Barang A',
      );
      await tester.enterText(
        find.widgetWithText(TextFormField, 'Koli').first,
        '2',
      );

      tester.view.viewInsets = const FakeViewPadding(bottom: 300);
      await tester.pumpAndSettle();

      final addSjButton = find.widgetWithText(
        OutlinedButton,
        'Tambah SJ',
        skipOffstage: false,
      );
      final usableBottom =
          tester.view.physicalSize.height - tester.view.viewInsets.bottom;
      final addItemButtons = find.widgetWithText(
        OutlinedButton,
        'Tambah Barang di SJ Ini',
        skipOffstage: false,
      );
      await tester.scrollUntilVisible(
        addItemButtons.last,
        240,
        scrollable: find.byType(Scrollable).first,
      );
      tester.widget<OutlinedButton>(addItemButtons.last).onPressed?.call();
      await tester.pumpAndSettle();

      final descriptionFields = find.widgetWithText(
        TextFormField,
        'Deskripsi Barang',
        skipOffstage: false,
      );
      expect(descriptionFields, findsNWidgets(2));
      await tester.enterText(descriptionFields.last, 'Barang A2');
      await tester.enterText(
        find.widgetWithText(TextFormField, 'Koli', skipOffstage: false).last,
        '3',
      );
      await tester.pumpAndSettle();
      expect(
        tester.widget<TextFormField>(descriptionFields.last).controller?.text,
        'Barang A2',
      );
      expect(
        tester.getRect(descriptionFields.last).center.dy,
        lessThan(usableBottom),
      );

      await tester.scrollUntilVisible(
        addSjButton,
        240,
        scrollable: find.byType(Scrollable).first,
      );
      tester.widget<OutlinedButton>(addSjButton).onPressed?.call();
      await tester.pumpAndSettle();

      final sjFields = find.widgetWithText(
        TextFormField,
        'No. SJ Pengirim',
        skipOffstage: false,
      );
      expect(sjFields, findsNWidgets(2));
      expect(tester.getRect(sjFields.last).center.dy, lessThan(usableBottom));
      await tester.enterText(sjFields.last, 'sj-b');

      tester.view.viewInsets = const FakeViewPadding();
      await tester.pumpAndSettle();
      await tester.tap(find.text('Simpan SJ & Barang'));
      await tester.pumpAndSettle();

      expect(capturedResult, isNotNull);
      expect(
        capturedResult!.shipperReferences.map(
          (reference) => reference.referenceNumber,
        ),
        ['SJ-A', 'SJ-B'],
      );
      expect(capturedResult!.cargoItems.map((item) => item.description), [
        'Barang A',
        'Barang A2',
      ]);
      expect(tester.takeException(), isNull);
    });

    testWidgets(
      'keeps focused cargo input visible when viewport shrinks without insets',
      (tester) async {
        tester.view.physicalSize = const Size(360, 900);
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
              customerProducts: [],
              allowsDirectCargoInput: true,
            ),
          ),
        );

        await tester.pumpAndSettle();

        await tester.enterText(
          find.widgetWithText(TextFormField, 'No. SJ Pengirim'),
          'sj-shrink',
        );
        await tester.enterText(
          find.widgetWithText(TextFormField, 'Deskripsi Barang'),
          'Besi Beton',
        );

        final koliField = find.widgetWithText(
          TextFormField,
          'Koli',
          skipOffstage: false,
        );
        await tester.ensureVisible(koliField.first);
        await tester.pumpAndSettle();
        await tester.enterText(koliField.first, '12');
        await tester.pumpAndSettle();

        tester.view.physicalSize = const Size(360, 520);
        await tester.pumpAndSettle();

        final rect = tester.getRect(koliField.first);
        expect(rect.top, greaterThanOrEqualTo(0));
        expect(rect.bottom, lessThanOrEqualTo(tester.view.physicalSize.height));
        expect(tester.takeException(), isNull);
      },
    );

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

    testWidgets('edits existing SJ number and keeps cargo linked', (
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
                          initialShipperReferences: [
                            DeliveryShipperReference(
                              key: 'ref-a',
                              referenceNumber: 'SJ-OLD',
                            ),
                          ],
                          existingCargoItems: [
                            DeliveryCargoItem(
                              id: 'cargo-a',
                              description: 'Barang lama',
                              shipperReferenceKey: 'ref-a',
                              shipperReferenceNumber: 'SJ-OLD',
                              qtyKoli: 1,
                              weightInputValue: 10,
                              weightInputUnit: 'KG',
                            ),
                          ],
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
        'sj-new',
      );
      await tester.tap(find.text('Simpan SJ & Barang'));
      await tester.pumpAndSettle();

      expect(capturedResult, isNotNull);
      expect(capturedResult!.shipperReferences.single.key, 'ref-a');
      expect(
        capturedResult!.shipperReferences.single.referenceNumber,
        'SJ-NEW',
      );
      expect(
        capturedResult!.updatedCargoItems.single.deliveryOrderItemId,
        'cargo-a',
      );
      expect(
        capturedResult!
            .updatedCargoItems
            .single
            .cargoItem
            .shipperReferenceNumber,
        'SJ-NEW',
      );
      expect(capturedResult!.deletedCargoItemIds, isEmpty);
    });

    testWidgets('removes an existing SJ group with its cargo draft', (
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
                          initialShipperReferences: [
                            DeliveryShipperReference(
                              key: 'ref-a',
                              referenceNumber: 'SJ-A',
                            ),
                            DeliveryShipperReference(
                              key: 'ref-b',
                              referenceNumber: 'SJ-B',
                            ),
                          ],
                          existingCargoItems: [
                            DeliveryCargoItem(
                              id: 'cargo-a',
                              description: 'Barang A',
                              shipperReferenceKey: 'ref-a',
                              shipperReferenceNumber: 'SJ-A',
                              qtyKoli: 1,
                              weightInputValue: 10,
                              weightInputUnit: 'KG',
                            ),
                            DeliveryCargoItem(
                              id: 'cargo-b',
                              description: 'Barang B',
                              shipperReferenceKey: 'ref-b',
                              shipperReferenceNumber: 'SJ-B',
                              qtyKoli: 2,
                              weightInputValue: 20,
                              weightInputUnit: 'KG',
                            ),
                          ],
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

      final removeSjButtons = find.byTooltip('Hapus SJ');
      expect(removeSjButtons, findsAtLeastNWidgets(1));
      await tester.tap(removeSjButtons.first);
      await tester.pumpAndSettle();
      expect(find.text('Hapus SJ ini?'), findsOneWidget);
      expect(find.textContaining('ditandai hapus'), findsOneWidget);

      await tester.tap(find.text('Batal'));
      await tester.pumpAndSettle();
      expect(find.text('SJ-A'), findsWidgets);

      await tester.tap(removeSjButtons.first);
      await tester.pumpAndSettle();
      await tester.tap(find.widgetWithText(FilledButton, 'Hapus SJ'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Simpan SJ & Barang'));
      await tester.pumpAndSettle();

      expect(capturedResult, isNotNull);
      expect(capturedResult!.shipperReferences.length, 1);
      expect(capturedResult!.shipperReferences.single.key, 'ref-b');
      expect(capturedResult!.shipperReferences.single.referenceNumber, 'SJ-B');
      expect(capturedResult!.deletedCargoItemIds, contains('cargo-a'));
      expect(capturedResult!.updatedCargoItems.length, 1);
      expect(
        capturedResult!.updatedCargoItems.single.deliveryOrderItemId,
        'cargo-b',
      );
    });
  });
}
