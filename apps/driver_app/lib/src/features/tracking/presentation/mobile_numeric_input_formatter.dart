import 'package:flutter/services.dart';

int mobileWeightInputFractionDigits(String unit) =>
    unit.trim().toUpperCase() == 'TON' ? 5 : 2;

int mobileVolumeInputFractionDigits(String unit) =>
    unit.trim().toUpperCase() == 'LITER' ? 0 : 3;

TextInputType mobileNumberKeyboardType(int fractionDigits) =>
    TextInputType.numberWithOptions(decimal: fractionDigits > 0);

List<TextInputFormatter> mobileNumberInputFormatters(int fractionDigits) => [
  MobileNumberInputFormatter(maxFractionDigits: fractionDigits),
];

class MobileNumberInputFormatter extends TextInputFormatter {
  const MobileNumberInputFormatter({required this.maxFractionDigits});

  final int maxFractionDigits;

  @override
  TextEditingValue formatEditUpdate(
    TextEditingValue oldValue,
    TextEditingValue newValue,
  ) {
    final raw = newValue.text;
    if (raw.isEmpty) return newValue;

    final allowDecimal = maxFractionDigits > 0;
    final selectionEnd = newValue.selection.end < 0
        ? raw.length
        : newValue.selection.end;
    final buffer = StringBuffer();
    var hasSeparator = false;
    var fractionDigitCount = 0;
    var selectionOffset = 0;

    for (var index = 0; index < raw.length; index += 1) {
      final codeUnit = raw.codeUnitAt(index);
      final isDigit = codeUnit >= 48 && codeUnit <= 57;
      var shouldKeep = false;

      if (isDigit) {
        if (!hasSeparator || fractionDigitCount < maxFractionDigits) {
          buffer.writeCharCode(codeUnit);
          shouldKeep = true;
          if (hasSeparator) fractionDigitCount += 1;
        }
      } else if (allowDecimal &&
          !hasSeparator &&
          (codeUnit == 44 || codeUnit == 46)) {
        buffer.writeCharCode(codeUnit);
        hasSeparator = true;
        shouldKeep = true;
      }

      if (shouldKeep && index < selectionEnd) {
        selectionOffset = buffer.length;
      }
    }

    final sanitized = buffer.toString();
    return TextEditingValue(
      text: sanitized,
      selection: TextSelection.collapsed(
        offset: selectionOffset.clamp(0, sanitized.length).toInt(),
      ),
      composing: TextRange.empty,
    );
  }
}
