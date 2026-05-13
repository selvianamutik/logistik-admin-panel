import 'package:flutter/material.dart';

class MobileInputVisibilityRoot extends StatefulWidget {
  const MobileInputVisibilityRoot({super.key, required this.child});

  final Widget child;

  @override
  State<MobileInputVisibilityRoot> createState() =>
      _MobileInputVisibilityRootState();
}

class _MobileInputVisibilityRootState extends State<MobileInputVisibilityRoot>
    with WidgetsBindingObserver {
  final _subtreeKey = GlobalKey();
  bool _visibilityScheduled = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    FocusManager.instance.addListener(_scheduleFocusedInputVisibility);
  }

  @override
  void dispose() {
    FocusManager.instance.removeListener(_scheduleFocusedInputVisibility);
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeMetrics() {
    _scheduleFocusedInputVisibility();
  }

  void _scheduleFocusedInputVisibility() {
    if (_visibilityScheduled) return;
    if (focusedEditableContextInside(_subtreeKey) == null) return;

    _visibilityScheduled = true;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _visibilityScheduled = false;
      if (!mounted) return;

      final inputContext = focusedEditableContextInside(_subtreeKey);
      if (inputContext == null) return;

      ensureMobileInputVisible(inputContext);
    });
  }

  @override
  Widget build(BuildContext context) {
    return KeyedSubtree(key: _subtreeKey, child: widget.child);
  }
}

BuildContext? focusedEditableContextInside(GlobalKey subtreeKey) {
  final focusedContext = FocusManager.instance.primaryFocus?.context;
  final subtreeContext = subtreeKey.currentContext;
  if (focusedContext == null || subtreeContext == null) return null;
  if (!focusedContext.mounted || !subtreeContext.mounted) return null;

  var insideSubtree = identical(focusedContext, subtreeContext);
  var belongsToEditableText = focusedContext.widget is EditableText;

  focusedContext.visitAncestorElements((ancestor) {
    if (ancestor.widget is EditableText) {
      belongsToEditableText = true;
    }
    if (identical(ancestor, subtreeContext)) {
      insideSubtree = true;
      return false;
    }
    return true;
  });

  if (!insideSubtree || !belongsToEditableText) return null;
  return focusedContext;
}

void ensureMobileInputVisible(BuildContext inputContext) {
  Scrollable.ensureVisible(
    inputContext,
    duration: const Duration(milliseconds: 180),
    curve: Curves.easeOut,
    alignment: 0.38,
    alignmentPolicy: ScrollPositionAlignmentPolicy.explicit,
  );
}
