import 'package:flutter/material.dart';

class MobileUnitSelectorField extends StatelessWidget {
  const MobileUnitSelectorField({
    super.key,
    required this.value,
    required this.options,
    required this.onChanged,
    this.labelText = 'Unit',
    this.title = 'Pilih Unit',
    this.enabled = true,
  });

  final String value;
  final List<String> options;
  final ValueChanged<String> onChanged;
  final String labelText;
  final String title;
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    final selectedValue = options.contains(value) ? value : options.first;

    return InkWell(
      borderRadius: BorderRadius.circular(8),
      onTap: enabled ? () => _openSelector(context, selectedValue) : null,
      child: InputDecorator(
        isEmpty: false,
        decoration: InputDecoration(
          labelText: labelText,
          enabled: enabled,
          suffixIcon: const Icon(Icons.expand_more_rounded),
        ),
        child: Text(
          selectedValue,
          style: Theme.of(context).textTheme.bodyLarge?.copyWith(
            color: enabled
                ? Theme.of(context).colorScheme.onSurface
                : Theme.of(context).disabledColor,
          ),
        ),
      ),
    );
  }

  Future<void> _openSelector(BuildContext context, String selectedValue) async {
    FocusManager.instance.primaryFocus?.unfocus();
    final selected = await showModalBottomSheet<String>(
      context: context,
      useSafeArea: true,
      builder: (context) {
        return SafeArea(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 16),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: Theme.of(context).textTheme.titleMedium?.copyWith(
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: 8),
                ...options.map(
                  (option) => ListTile(
                    contentPadding: EdgeInsets.zero,
                    title: Text(option),
                    trailing: option == selectedValue
                        ? const Icon(Icons.check_rounded)
                        : null,
                    onTap: () => Navigator.of(context).pop(option),
                  ),
                ),
              ],
            ),
          ),
        );
      },
    );
    if (selected != null && selected != selectedValue) {
      onChanged(selected);
    }
  }
}
