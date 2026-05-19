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

String _groupIntegerDigits(String digits) {
  final normalized = digits
      .replaceAll(RegExp(r'\D'), '')
      .replaceFirst(RegExp(r'^0+(?=\d)'), '');
  if (normalized.isEmpty) return '';

  final buffer = StringBuffer();
  for (var index = 0; index < normalized.length; index += 1) {
    final remaining = normalized.length - index;
    if (index > 0 && remaining % 3 == 0) {
      buffer.write('.');
    }
    buffer.write(normalized[index]);
  }
  return buffer.toString();
}

String formatMobileNumberValue(double? value, {int fractionDigits = 2}) {
  if (value == null || value <= 0) return '';

  if (fractionDigits <= 0 || value == value.roundToDouble()) {
    return _groupIntegerDigits(value.round().toString());
  }

  final fixed = value
      .toStringAsFixed(fractionDigits)
      .replaceFirst(RegExp(r'0+$'), '')
      .replaceFirst(RegExp(r'\.$'), '');
  final parts = fixed.split('.');
  final integerPart = _groupIntegerDigits(parts.first);
  final fractionPart = parts.length > 1 ? parts.last : '';
  return fractionPart.isEmpty ? integerPart : '$integerPart,$fractionPart';
}

double parseMobileNumberInput(String raw) {
  final cleaned = raw.trim().replaceAll(RegExp(r'[^0-9,.-]'), '');
  if (cleaned.isEmpty) return 0;

  final isNegative = cleaned.startsWith('-');
  final commaIndex = cleaned.indexOf(',');
  final integerRaw = commaIndex >= 0
      ? cleaned.substring(0, commaIndex)
      : cleaned;
  final fractionRaw = commaIndex >= 0 ? cleaned.substring(commaIndex + 1) : '';
  final integerDigits = integerRaw.replaceAll(RegExp(r'\D'), '');
  final fractionDigits = fractionRaw.replaceAll(RegExp(r'\D'), '');

  if (integerDigits.isEmpty && fractionDigits.isEmpty) return 0;

  final normalized =
      '${integerDigits.isEmpty ? '0' : integerDigits}'
      '${fractionDigits.isEmpty ? '' : '.$fractionDigits'}';
  final parsed = double.tryParse(normalized) ?? 0;
  return isNegative && parsed != 0 ? -parsed : parsed;
}

String _formatLiveInput(String raw, int maxFractionDigits) {
  final allowDecimal = maxFractionDigits > 0;
  if (raw.isEmpty) return raw;
  if (!allowDecimal) {
    return _groupIntegerDigits(raw);
  }

  final commaIndex = raw.indexOf(',');
  if (commaIndex < 0) {
    return _groupIntegerDigits(raw);
  }

  final integerPart = _groupIntegerDigits(raw.substring(0, commaIndex));
  final fractionDigits = raw
      .substring(commaIndex + 1)
      .replaceAll(RegExp(r'\D'), '');
  final limitedFraction = fractionDigits.length > maxFractionDigits
      ? fractionDigits.substring(0, maxFractionDigits)
      : fractionDigits;
  if (raw == ',') return ',';
  return '${integerPart.isEmpty ? '0' : integerPart},$limitedFraction';
}

int _offsetAfterDigits(String formatted, int digitCount) {
  if (digitCount <= 0) return 0;
  var seen = 0;
  for (var index = 0; index < formatted.length; index += 1) {
    final codeUnit = formatted.codeUnitAt(index);
    if (codeUnit < 48 || codeUnit > 57) continue;
    seen += 1;
    if (seen >= digitCount) return index + 1;
  }
  return formatted.length;
}

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
    final sanitized = _formatLiveInput(raw, maxFractionDigits);
    final commaIndex = raw.indexOf(',');
    final normalizedSelectionEnd = selectionEnd.clamp(0, raw.length).toInt();
    final selectionAfterComma =
        allowDecimal && commaIndex >= 0 && normalizedSelectionEnd > commaIndex;
    final rawBeforeSelection = raw.substring(0, normalizedSelectionEnd);
    final integerDigitsBeforeSelection =
        (selectionAfterComma
                ? raw.substring(0, commaIndex)
                : rawBeforeSelection)
            .replaceAll(RegExp(r'\D'), '')
            .length;
    final fractionDigitsBeforeSelection = selectionAfterComma
        ? raw
              .substring(commaIndex + 1, normalizedSelectionEnd)
              .replaceAll(RegExp(r'\D'), '')
              .length
              .clamp(0, maxFractionDigits)
        : 0;
    final nextCommaIndex = sanitized.indexOf(',');
    final selectionOffset = selectionAfterComma && nextCommaIndex >= 0
        ? (nextCommaIndex + 1 + fractionDigitsBeforeSelection).clamp(
            0,
            sanitized.length,
          )
        : _offsetAfterDigits(sanitized, integerDigitsBeforeSelection);

    return TextEditingValue(
      text: sanitized,
      selection: TextSelection.collapsed(
        offset: selectionOffset.clamp(0, sanitized.length).toInt(),
      ),
      composing: TextRange.empty,
    );
  }
}
