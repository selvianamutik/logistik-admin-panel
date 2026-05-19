import 'package:driver_app/src/features/tracking/presentation/mobile_numeric_input_formatter.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

TextEditingValue _format(String raw, {required int fractionDigits}) {
  return MobileNumberInputFormatter(
    maxFractionDigits: fractionDigits,
  ).formatEditUpdate(
    const TextEditingValue(),
    TextEditingValue(
      text: raw,
      selection: TextSelection.collapsed(offset: raw.length),
    ),
  );
}

void main() {
  group('MobileNumberInputFormatter', () {
    test('uses admin-style dot grouping and comma decimals', () {
      expect(_format('123456', fractionDigits: 2).text, '123.456');
      expect(_format('123.456', fractionDigits: 2).text, '123.456');
      expect(_format('123,456', fractionDigits: 2).text, '123,45');
      expect(_format('1.234,56789', fractionDigits: 3).text, '1.234,567');
      expect(_format('12,3', fractionDigits: 0).text, '123');
    });

    test('parses dot as thousands and comma as decimal', () {
      expect(parseMobileNumberInput('123.456'), 123456);
      expect(parseMobileNumberInput('123,45'), 123.45);
      expect(parseMobileNumberInput('1.234,567'), 1234.567);
      expect(parseMobileNumberInput('1.234.567'), 1234567);
    });

    test('formats existing values with Indonesian separators', () {
      expect(formatMobileNumberValue(123456), '123.456');
      expect(formatMobileNumberValue(123.45, fractionDigits: 2), '123,45');
      expect(formatMobileNumberValue(0.123456, fractionDigits: 5), '0,12346');
      expect(formatMobileNumberValue(1234.5, fractionDigits: 0), '1.235');
    });
  });
}
