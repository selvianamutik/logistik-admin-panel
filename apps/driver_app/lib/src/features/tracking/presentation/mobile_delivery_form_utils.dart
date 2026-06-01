import 'package:flutter/material.dart';

import 'mobile_numeric_input_formatter.dart';

const mobileInputScrollPadding = EdgeInsets.fromLTRB(20, 20, 20, 120);

String normalizeMobileWeightUnit(String value) {
  final normalized = value.trim().toUpperCase();
  return normalized == 'TON' ? 'TON' : 'KG';
}

String normalizeMobileVolumeUnit(String value) {
  final normalized = value.trim().toUpperCase();
  return switch (normalized) {
    'LITER' => 'LITER',
    'KL' => 'KL',
    _ => 'M3',
  };
}

String formatMobileMetric(double? value, {int fractionDigits = 2}) {
  return formatMobileNumberValue(value, fractionDigits: fractionDigits);
}
