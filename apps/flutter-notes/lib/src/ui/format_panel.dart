// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Apple Notes' Aa panel as a Material bottom sheet: paragraph styles,
// inline styles and lists, applied to the note's selection.

import 'package:flutter/material.dart';

import '../editing.dart';

class FormatPanel extends StatelessWidget {
  const FormatPanel({super.key, required this.current, required this.apply});

  /// The paragraph style at the caret (blockStyleAt).
  final BlockStyle current;
  final void Function(TextState Function(TextState)) apply;

  static const _paragraph = [
    (BlockStyle.title, 'Title'),
    (BlockStyle.heading, 'Heading'),
    (BlockStyle.subheading, 'Subheading'),
    (BlockStyle.body, 'Body'),
  ];

  static const _inline = [
    (InlineStyle.bold, Icons.format_bold, 'Bold'),
    (InlineStyle.italic, Icons.format_italic, 'Italic'),
    (InlineStyle.strikethrough, Icons.format_strikethrough, 'Strikethrough'),
    (InlineStyle.code, Icons.code, 'Code'),
  ];

  static const _lists = [
    (BlockStyle.bulleted, Icons.format_list_bulleted, 'Bulleted List'),
    (BlockStyle.numbered, Icons.format_list_numbered, 'Numbered List'),
    (BlockStyle.checklist, Icons.checklist, 'Checklist'),
    (BlockStyle.quote, Icons.format_quote, 'Block Quote'),
  ];

  @override
  Widget build(BuildContext context) {
    final paragraph = _paragraph.any((p) => p.$1 == current) ? {current} : <BlockStyle>{};
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: SegmentedButton<BlockStyle>(
                showSelectedIcon: false,
                emptySelectionAllowed: true,
                segments: [for (final (style, label) in _paragraph) ButtonSegment(value: style, label: Text(label))],
                selected: paragraph,
                onSelectionChanged: (s) => apply((t) => setBlockStyle(t, s.isEmpty ? current : s.first)),
              ),
            ),
            const SizedBox(height: 12),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                for (final (style, icon, label) in _inline)
                  IconButton.outlined(tooltip: label, icon: Icon(icon), onPressed: () => apply((t) => toggleInline(t, style))),
                IconButton.outlined(tooltip: 'Monostyled', icon: const Icon(Icons.data_object), onPressed: () => apply(codeBlock)),
              ],
            ),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                for (final (style, icon, label) in _lists)
                  IconButton.filledTonal(
                    tooltip: label,
                    isSelected: current == style,
                    icon: Icon(icon),
                    onPressed: () => apply((t) => setBlockStyle(t, style)),
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
