import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:driver_mobile/main.dart';

void main() {
  testWidgets('driver app shows login shell', (WidgetTester tester) async {
    SharedPreferences.setMockInitialValues(<String, Object>{});
    await tester.pumpWidget(const DriverMobileApp());
    await tester.pumpAndSettle();

    expect(find.text('Masuk ke APK Driver'), findsOneWidget);
  });
}
