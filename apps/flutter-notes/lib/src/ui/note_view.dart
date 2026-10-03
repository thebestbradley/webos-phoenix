// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The open note: its Markdown source or the rendered preview (a segmented
// button in the app bar), the Aa sheet and the insert buttons in the bottom
// bar, the note's other actions in the ⋮ menu. On a phone it takes the
// screen, with a back button to the list.

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_markdown_plus/flutter_markdown_plus.dart';

import '../dates.dart';
import '../editing.dart';
import '../markdown.dart';
import '../model.dart';
import 'app.dart';
import 'dialogs.dart';
import 'format_panel.dart';

enum _Mode { markdown, preview }

class _IndentIntent extends Intent {
  const _IndentIntent({required this.outdent});

  final bool outdent;
}

class _InlineIntent extends Intent {
  const _InlineIntent(this.style);

  final InlineStyle style;
}

class NoteView extends StatefulWidget {
  const NoteView({super.key, required this.page});

  /// The note has the screen (a phone): show the back button.
  final bool page;

  @override
  State<NoteView> createState() => _NoteViewState();
}

class _NoteViewState extends State<NoteView> {
  final _controller = TextEditingController();
  final _focus = FocusNode();
  String? _noteId;
  _Mode _mode = _Mode.markdown;
  // The text before the last edit, to tell an Enter from other typing.
  TextEditingValue _last = TextEditingValue.empty;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final model = NotesScope.of(context);
    final note = model.selected;
    if (note?.id != _noteId) {
      // Each note opens as Settings says; a deleted one only as its preview.
      _noteId = note?.id;
      _mode = note != null && (model.settings.openInPreview || note.isDeleted) ? _Mode.preview : _Mode.markdown;
      // A new (empty) note is ready for typing after its "# ".
      final fresh = note != null && !note.isDeleted && textLines(note.body).isEmpty;
      _setText(model.draft, caret: fresh ? model.draft.length : 0);
      if (fresh) WidgetsBinding.instance.addPostFrameCallback((_) => _focus.requestFocus());
    } else if (model.draft != _controller.text) {
      // Changed elsewhere: a task box, or another demo.
      _setText(model.draft);
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    _focus.dispose();
    super.dispose();
  }

  void _setText(String text, {int? caret}) {
    final at = (caret ?? _controller.selection.baseOffset).clamp(0, text.length);
    _controller.value = TextEditingValue(text: text, selection: TextSelection.collapsed(offset: at));
    _last = _controller.value;
  }

  TextState get _state {
    final v = _controller.value;
    final sel = v.selection.isValid ? v.selection : TextSelection.collapsed(offset: v.text.length);
    return TextState(v.text, sel.start, sel.end);
  }

  void _put(TextState s) {
    _controller.value = TextEditingValue(text: s.text, selection: TextSelection(baseOffset: s.start, extentOffset: s.end));
    _last = _controller.value;
    NotesScope.of(context).setDraft(s.text);
  }

  /// Runs a formatting command on the text and selection.
  void apply(TextState Function(TextState) command) {
    if (_mode != _Mode.markdown) setState(() => _mode = _Mode.markdown);
    _put(command(_state));
    _focus.requestFocus();
  }

  void _onChanged(String text) {
    final v = _controller.value;
    // Enter (however it arrived: key, IME, paste of one newline) at the end
    // of a list item continues the list.
    final old = _last;
    final p = v.selection.baseOffset;
    if (v.selection.isCollapsed &&
        old.selection.isCollapsed &&
        text.length == old.text.length + 1 &&
        p > 0 &&
        old.selection.baseOffset == p - 1 &&
        text[p - 1] == '\n' &&
        text == '${old.text.substring(0, p - 1)}\n${old.text.substring(p - 1)}') {
      final next = continueList(TextState(old.text, p - 1, p - 1));
      if (next != null) return _put(next);
    }
    _last = v;
    NotesScope.of(context).setDraft(text);
  }

  Future<void> _addLink() async {
    final controller = TextEditingController();
    final url = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Add Link'),
        content: TextField(
          controller: controller,
          autofocus: true,
          keyboardType: TextInputType.url,
          decoration: const InputDecoration(labelText: 'Address', hintText: 'https://', helperText: 'The selected text becomes the link’s text.'),
          onSubmitted: (v) => Navigator.of(context).pop(v),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.of(context).pop(), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.of(context).pop(controller.text), child: const Text('Add')),
        ],
      ),
    );
    controller.dispose();
    final u = url?.trim() ?? '';
    if (u.isEmpty) return;
    apply((s) => insertLink(s, RegExp(r'^[a-z][a-z0-9+.-]*:', caseSensitive: false).hasMatch(u) ? u : 'https://$u'));
  }

  void _format() {
    showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      builder: (sheet) => StatefulBuilder(
        builder: (sheet, setSheet) => FormatPanel(
          current: blockStyleAt(_state),
          apply: (command) {
            apply(command);
            setSheet(() {});
          },
        ),
      ),
    );
  }

  void _info(Note note) {
    final model = NotesScope.of(context);
    final draft = model.draft;
    showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      builder: (sheet) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(title: Text('Note Info', style: Theme.of(sheet).textTheme.titleMedium)),
            for (final (label, value) in [
              ('Folder', model.folderName(note.folderId)),
              ('Created', longDate(note.createdAt)),
              ('Modified', longDate(note.modifiedAt)),
              ('Words', '${wordCount(draft)}'),
              ('Characters', '${draft.length}'),
              ('Lines', '${textLines(draft).length}'),
            ])
              ListTile(dense: true, title: Text(label), trailing: Text(value)),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final model = NotesScope.of(context);
    final theme = Theme.of(context);
    final note = model.selected;
    final back = widget.page
        ? IconButton(tooltip: 'Back', icon: const BackButtonIcon(), onPressed: () => model.select(null))
        : null;

    if (note == null) {
      return Scaffold(
        appBar: AppBar(automaticallyImplyLeading: false),
        body: Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text('No note selected', style: theme.textTheme.bodyLarge?.copyWith(color: theme.colorScheme.outline)),
              const SizedBox(height: 16),
              OutlinedButton.icon(onPressed: model.newNote, icon: const Icon(Icons.edit_square), label: const Text('New Note')),
            ],
          ),
        ),
      );
    }

    final deleted = note.isDeleted;
    final tasks = taskStates(model.draft);
    final done = tasks.where((t) => t).length;
    final scale = model.settings.textSize / 100;

    return Scaffold(
      appBar: AppBar(
        automaticallyImplyLeading: false,
        leading: back,
        centerTitle: true,
        title: deleted
            ? const Text('Recently Deleted')
            : SegmentedButton<_Mode>(
                showSelectedIcon: false,
                segments: const [
                  ButtonSegment(value: _Mode.markdown, label: Text('Markdown')),
                  ButtonSegment(value: _Mode.preview, label: Text('Preview')),
                ],
                selected: {_mode},
                onSelectionChanged: (s) => setState(() => _mode = s.first),
              ),
        actions: deleted
            ? null
            : [
                IconButton(
                  tooltip: note.pinned ? 'Unpin' : 'Pin',
                  isSelected: note.pinned,
                  icon: const Icon(Icons.push_pin_outlined),
                  selectedIcon: Icon(Icons.push_pin, color: Colors.amber.shade700),
                  onPressed: () => model.togglePin(note.id),
                ),
                MenuAnchor(
                  menuChildren: [
                    MenuItemButton(leadingIcon: const Icon(Icons.link), onPressed: _addLink, child: const Text('Add Link…')),
                    MenuItemButton(
                      leadingIcon: const Icon(Icons.drive_file_move_outline),
                      onPressed: () => moveNote(context, note),
                      child: const Text('Move to Folder…'),
                    ),
                    MenuItemButton(leadingIcon: const Icon(Icons.info_outline), onPressed: () => _info(note), child: const Text('Note Info')),
                    MenuItemButton(
                      leadingIcon: Icon(Icons.delete_outline, color: theme.colorScheme.error),
                      onPressed: () => deleteNote(context, note),
                      child: Text('Delete Note', style: TextStyle(color: theme.colorScheme.error)),
                    ),
                  ],
                  builder: (context, controller, _) => IconButton(
                    tooltip: 'More',
                    icon: const Icon(Icons.more_vert),
                    onPressed: () => controller.isOpen ? controller.close() : controller.open(),
                  ),
                ),
              ],
        bottom: _mode == _Mode.preview && tasks.isNotEmpty
            ? PreferredSize(
                preferredSize: const Size.fromHeight(28),
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
                  child: Row(
                    children: [
                      Expanded(child: LinearProgressIndicator(value: done / tasks.length, semanticsLabel: 'Checklist progress')),
                      const SizedBox(width: 12),
                      Text('$done of ${tasks.length} done', style: theme.textTheme.labelMedium),
                    ],
                  ),
                ),
              )
            : null,
      ),
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.only(top: 4),
            child: Text(longDate(note.modifiedAt), textAlign: TextAlign.center,
                style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.outline)),
          ),
          if (deleted)
            Card(
              margin: const EdgeInsets.fromLTRB(16, 8, 16, 0),
              color: theme.colorScheme.surfaceContainerHighest,
              child: const Padding(
                padding: EdgeInsets.all(12),
                child: Text('This note is in Recently Deleted. Recover it to edit it.', textAlign: TextAlign.center),
              ),
            ),
          Expanded(
            child: _mode == _Mode.preview
                ? _Preview(
                    source: model.draft,
                    scale: scale,
                    onToggleTask: deleted ? null : model.toggleTask,
                    onOpenLink: model.openLink,
                  )
                : _editor(theme, scale),
          ),
        ],
      ),
      bottomNavigationBar: BottomAppBar(
        height: 64,
        child: deleted
            ? Row(
                children: [
                  TextButton(onPressed: () => model.recover(note.id), child: const Text('Recover')),
                  const Spacer(),
                  TextButton(
                    style: TextButton.styleFrom(foregroundColor: theme.colorScheme.error),
                    onPressed: () => deleteNote(context, note),
                    child: const Text('Delete'),
                  ),
                ],
              )
            : Row(
                children: [
                  IconButton(tooltip: 'Format', icon: const Icon(Icons.text_format), onPressed: _format),
                  IconButton(tooltip: 'Checklist', icon: const Icon(Icons.checklist), onPressed: () => apply((s) => setBlockStyle(s, BlockStyle.checklist))),
                  IconButton(tooltip: 'Table', icon: const Icon(Icons.table_chart_outlined), onPressed: () => apply(insertTable)),
                  IconButton(tooltip: 'Add Link', icon: const Icon(Icons.link), onPressed: _addLink),
                  IconButton(tooltip: 'Monostyled', icon: const Icon(Icons.code), onPressed: () => apply(codeBlock)),
                  const Spacer(),
                  IconButton(tooltip: 'New Note', icon: const Icon(Icons.edit_square), onPressed: model.newNote),
                ],
              ),
      ),
    );
  }

  Widget _editor(ThemeData theme, double scale) {
    final mac = theme.platform == TargetPlatform.macOS || theme.platform == TargetPlatform.iOS;
    SingleActivator key(LogicalKeyboardKey k) => SingleActivator(k, control: !mac, meta: mac);
    return Shortcuts(
      shortcuts: {
        const SingleActivator(LogicalKeyboardKey.tab): const _IndentIntent(outdent: false),
        const SingleActivator(LogicalKeyboardKey.tab, shift: true): const _IndentIntent(outdent: true),
        key(LogicalKeyboardKey.keyB): const _InlineIntent(InlineStyle.bold),
        key(LogicalKeyboardKey.keyI): const _InlineIntent(InlineStyle.italic),
        key(LogicalKeyboardKey.keyE): const _InlineIntent(InlineStyle.code),
      },
      child: Actions(
        actions: {
          // Tab outside a list moves the focus on, as usual.
          _IndentIntent: _IndentAction(this),
          _InlineIntent: CallbackAction<_InlineIntent>(onInvoke: (i) {
            apply((s) => toggleInline(s, i.style));
            return null;
          }),
        },
        child: Padding(
          padding: const EdgeInsets.fromLTRB(20, 8, 20, 0),
          child: TextField(
            controller: _controller,
            focusNode: _focus,
            maxLines: null,
            expands: true,
            keyboardType: TextInputType.multiline,
            textAlignVertical: TextAlignVertical.top,
            style: TextStyle(fontFamily: 'DejaVu Sans Mono', fontSize: 15 * scale, height: 1.5),
            decoration: const InputDecoration.collapsed(hintText: 'Start typing. Markdown works: # Title, **bold**, - [ ] task'),
            onChanged: _onChanged,
          ),
        ),
      ),
    );
  }
}

class _IndentAction extends ContextAction<_IndentIntent> {
  _IndentAction(this.view);

  final _NoteViewState view;

  @override
  bool isEnabled(_IndentIntent intent, [BuildContext? context]) => indentLines(view._state, outdent: intent.outdent) != null;

  @override
  Object? invoke(_IndentIntent intent, [BuildContext? context]) {
    final next = indentLines(view._state, outdent: intent.outdent);
    if (next != null) view._put(next);
    return null;
  }
}

/// The note rendered by flutter_markdown_plus. Its task boxes are live: each
/// knows its index in the note (see _TaskBoxes).
class _Preview extends StatelessWidget {
  const _Preview({required this.source, required this.scale, required this.onToggleTask, required this.onOpenLink});

  final String source;
  final double scale;
  final void Function(int index)? onToggleTask;
  final void Function(String url) onOpenLink;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final mono = TextStyle(fontFamily: 'DejaVu Sans Mono', fontSize: 14, backgroundColor: theme.colorScheme.surfaceContainerHighest);
    final sheet = MarkdownStyleSheet.fromTheme(theme).copyWith(
      textScaler: TextScaler.linear(scale),
      p: theme.textTheme.bodyLarge,
      code: mono,
      codeblockDecoration: BoxDecoration(color: theme.colorScheme.surfaceContainerHighest, borderRadius: BorderRadius.circular(8)),
      blockquoteDecoration: BoxDecoration(border: Border(left: BorderSide(color: theme.colorScheme.primary, width: 3))),
      blockquotePadding: const EdgeInsets.only(left: 12),
      tableBorder: TableBorder.all(color: theme.colorScheme.outlineVariant),
      tableHead: const TextStyle(fontWeight: FontWeight.w600),
    );
    final boxes = _TaskBoxes(taskStates(source).length, onToggleTask);
    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(20, 12, 20, 48),
      child: MarkdownBody(
        data: source,
        styleSheet: sheet,
        checkboxBuilder: boxes.build,
        onTapLink: (text, href, title) {
          if (href != null) onOpenLink(href);
        },
      ),
    );
  }
}

/// flutter_markdown_plus asks for the note's task boxes in document order
/// every time it parses the note (checkboxBuilder has no index), so the
/// n-th call is box n; counting modulo the note's box count keeps that
/// true when it parses again (its dependencies changed) with the same
/// builder.
class _TaskBoxes {
  _TaskBoxes(this.total, this.onToggle);

  final int total;
  final void Function(int index)? onToggle;
  int _next = 0;

  Widget build(bool checked) {
    final index = total == 0 ? 0 : _next++ % total;
    return SizedBox(
      width: 28,
      height: 24,
      child: Checkbox(
        value: checked,
        materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
        visualDensity: VisualDensity.compact,
        semanticLabel: 'Task ${index + 1}',
        onChanged: onToggle == null ? null : (_) => onToggle!(index),
      ),
    );
  }
}
