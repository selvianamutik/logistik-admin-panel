import 'package:flutter/material.dart';

class MobileUnitSelectorField extends StatelessWidget {
  const MobileUnitSelectorField({
    super.key,
    required this.value,
    required this.options,
    required this.onChanged,
    this.labelText = 'Unit',
    this.enabled = true,
  });

  final String value;
  final List<String> options;
  final ValueChanged<String> onChanged;
  final String labelText;
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    final selectedValue = options.contains(value) ? value : options.first;

    return DropdownButtonFormField<String>(
      initialValue: selectedValue,
      isExpanded: true,
      decoration: InputDecoration(labelText: labelText, enabled: enabled),
      items: options
          .map(
            (option) => DropdownMenuItem<String>(
              value: option,
              child: Text(_unitLabel(option), overflow: TextOverflow.ellipsis),
            ),
          )
          .toList(growable: false),
      onChanged: enabled
          ? (selected) {
              FocusManager.instance.primaryFocus?.unfocus();
              if (selected == null || selected == selectedValue) return;
              onChanged(selected);
            }
          : null,
    );
  }
}

String _unitLabel(String option) {
  return switch (option.trim().toUpperCase()) {
    'KG' => 'Kg',
    'TON' => 'Ton',
    'M3' => 'm3',
    'LITER' => 'Liter',
    'KL' => 'KL',
    _ => option,
  };
}
