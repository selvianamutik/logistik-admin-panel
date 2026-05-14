import 'package:driver_app/src/app.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('DriverTrackingApp shows login without location preflight', (
    tester,
  ) async {
    await tester.pumpWidget(const DriverTrackingApp());
    await tester.pumpAndSettle();

    expect(find.text('PT. Gading Mas Surya'), findsOneWidget);
    expect(find.text('Masuk'), findsOneWidget);
    expect(find.byIcon(Icons.location_off_rounded), findsNothing);
  });
}
