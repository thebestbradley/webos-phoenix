// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// A folder's notes in Apple Notes' sections (Pinned, Today, ...), under a
// Material 3 large app bar with search and its filter chips. A row swipes
// right to pin and left to delete; long press for its other actions.

import 'package:flutter/material.dart';

import '../dates.dart';
import '../markdown.dart';
import '../model.dart';
import 'app.dart';
import 'dialogs.dart';

const _filters = {
  Feature.checklist: 'Checklists',
  Feature.table: 'Tables',
  Feature.link: 'Links',
  Feature.code: 'Code',
};

class NoteList extends StatefulWidget {
  const NoteList({super.key, required this.drawer});

  /// The folders are a drawer (a phone): show the menu button.
  final bool drawer;

  @override
  State<NoteList> createState() => _NoteListState();
}

class _NoteListState extends State<NoteList> {
  final _search = TextEditingController();
  final _searchFocus = FocusNode();

  @override
  void initState() {
    super.initState();
    _searchFocus.addListener(() => setState(() {}));
  }

  // The query is cleared elsewhere too (opening a folder, a new note).
  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final query = NotesScope.of(context).query;
    if (_search.text != query) _search.text = query;
  }

  @override
  void dispose() {
    _search.dispose();
    _searchFocus.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final model = NotesScope.of(context);
    final theme = Theme.of(context);
    final inDeleted = model.folderId == recentlyDeleted;
    final userFolder = model.folders.any((f) => f.id == model.folderId);
    final count = model.searching ? model.matches.length : model.count;

    Widget row(Note n, [String? context]) {
      final s = summarize(n.body);
      final selected = model.selected?.id == n.id;
      final subtitle = [
        if (inDeleted) '${daysLeft(n, model.now)} days' else if (model.folderId == allNotes) model.folderName(n.folderId),
      ];
      return Dismissible(
        key: ValueKey(n.id),
        background: Container(
          color: n.isDeleted ? theme.colorScheme.primary : Colors.amber.shade700,
          alignment: Alignment.centerLeft,
          padding: const EdgeInsets.only(left: 24),
          child: Icon(n.isDeleted ? Icons.restore : (n.pinned ? Icons.push_pin_outlined : Icons.push_pin), color: Colors.white),
        ),
        secondaryBackground: Container(
          color: theme.colorScheme.error,
          alignment: Alignment.centerRight,
          padding: const EdgeInsets.only(right: 24),
          child: Icon(Icons.delete_outline, color: theme.colorScheme.onError),
        ),
        // The row stays: the change shows when db8 reports it.
        confirmDismiss: (direction) async {
          if (direction == DismissDirection.startToEnd) {
            n.isDeleted ? model.recover(n.id) : model.togglePin(n.id);
          } else {
            deleteNote(this.context, n);
          }
          return false;
        },
        child: ListTile(
          selected: selected,
          selectedTileColor: theme.colorScheme.secondaryContainer,
          selectedColor: theme.colorScheme.onSecondaryContainer,
          title: Row(
            children: [
              if (n.pinned) Padding(
                padding: const EdgeInsets.only(right: 4),
                child: Icon(Icons.push_pin, size: 16, color: Colors.amber.shade700, semanticLabel: 'Pinned'),
              ),
              Expanded(child: Text(s.title, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w600))),
            ],
          ),
          subtitle: Text.rich(
            TextSpan(children: [
              TextSpan(text: '${shortDate(n.modifiedAt, model.now)}  ', style: const TextStyle(fontWeight: FontWeight.w600)),
              TextSpan(text: context ?? s.preview),
              if (subtitle.isNotEmpty) TextSpan(text: '\n${subtitle.first}'),
            ]),
            maxLines: 3,
            overflow: TextOverflow.ellipsis,
          ),
          isThreeLine: true,
          onTap: () => model.select(n.id),
          onLongPress: () => _rowMenu(n),
        ),
      );
    }

    final slivers = <Widget>[];
    if (!model.loaded) {
      slivers.add(const SliverFillRemaining(child: Center(child: CircularProgressIndicator())));
    } else if (model.searching) {
      slivers.add(SliverToBoxAdapter(child: _header(context, count == 1 ? '1 found' : '$count found')));
      slivers.add(SliverList.list(children: [for (final m in model.matches) row(m.note, m.context)]));
    } else if (model.count == 0) {
      slivers.add(SliverFillRemaining(
        hasScrollBody: false,
        child: Center(child: Text('No Notes', style: theme.textTheme.bodyLarge?.copyWith(color: theme.colorScheme.outline))),
      ));
    } else {
      for (final s in model.sections) {
        if (s.title.isNotEmpty) slivers.add(SliverToBoxAdapter(child: _header(context, s.title)));
        slivers.add(SliverList.list(children: [for (final n in s.notes) row(n)]));
      }
      slivers.add(const SliverToBoxAdapter(child: SizedBox(height: 96)));
    }

    return Scaffold(
      body: CustomScrollView(
        slivers: [
          SliverAppBar.large(
            automaticallyImplyLeading: false,
            leading: widget.drawer
                ? IconButton(
                    tooltip: 'Folders',
                    icon: const Icon(Icons.menu),
                    onPressed: () => Scaffold.of(context).openDrawer(),
                  )
                : null,
            title: Text(model.folderName(model.folderId)),
            actions: [
              if (inDeleted && model.count > 0)
                TextButton(
                  onPressed: () => confirm(
                    context,
                    title: 'Delete all notes in Recently Deleted?',
                    message: 'They will be deleted immediately. You can’t undo this.',
                    action: 'Delete All',
                    onConfirm: model.emptyRecentlyDeleted,
                  ),
                  child: const Text('Delete All'),
                ),
              _viewOptions(userFolder),
            ],
          ),
          SliverToBoxAdapter(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
              child: SearchBar(
                controller: _search,
                focusNode: _searchFocus,
                hintText: 'Search',
                elevation: const WidgetStatePropertyAll(0),
                leading: const Icon(Icons.search),
                trailing: [
                  if (model.searching)
                    IconButton(
                      tooltip: 'Clear',
                      icon: const Icon(Icons.close),
                      onPressed: () {
                        model.setQuery('');
                        model.setFilters(const {});
                      },
                    ),
                ],
                onChanged: model.setQuery,
              ),
            ),
          ),
          if (_searchFocus.hasFocus || model.searching)
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: Wrap(
                  spacing: 8,
                  children: [
                    for (final e in _filters.entries)
                      FilterChip(
                        label: Text(e.value),
                        selected: model.filters.contains(e.key),
                        onSelected: (on) => model.setFilters(
                          on ? {...model.filters, e.key} : ({...model.filters}..remove(e.key)),
                        ),
                      ),
                  ],
                ),
              ),
            ),
          if (inDeleted && model.count > 0)
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(24, 4, 24, 4),
                child: Text(
                  'Notes are available here for 30 days. After that, they will be permanently deleted.',
                  textAlign: TextAlign.center,
                  style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.outline),
                ),
              ),
            ),
          ...slivers,
        ],
      ),
      floatingActionButton: inDeleted
          ? null
          : FloatingActionButton(
              tooltip: 'New Note',
              onPressed: model.newNote,
              child: const Icon(Icons.edit_square),
            ),
      bottomNavigationBar: SafeArea(
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 6),
          child: Text(count == 1 ? '1 Note' : '$count Notes', textAlign: TextAlign.center, style: theme.textTheme.labelMedium),
        ),
      ),
    );
  }

  Widget _header(BuildContext context, String title) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 4),
      child: Semantics(
        header: true,
        child: Text(title, style: theme.textTheme.titleSmall?.copyWith(color: theme.colorScheme.primary)),
      ),
    );
  }

  Widget _viewOptions(bool userFolder) {
    final model = NotesScope.of(context);
    final s = model.settings;
    return MenuAnchor(
      menuChildren: [
        for (final (sort, label) in [(SortOrder.modified, 'Date Edited'), (SortOrder.created, 'Date Created'), (SortOrder.title, 'Title')])
          MenuItemButton(
            leadingIcon: Icon(s.sort == sort ? Icons.check : null),
            onPressed: () => model.updateSettings(s.copyWith(sort: sort)),
            child: Text('Sort by $label'),
          ),
        const Divider(),
        CheckboxMenuButton(
          value: s.groupByDate,
          onChanged: s.sort == SortOrder.title ? null : (v) => model.updateSettings(s.copyWith(groupByDate: v ?? true)),
          child: const Text('Group By Date'),
        ),
        if (userFolder) ...[
          const Divider(),
          MenuItemButton(
            leadingIcon: const Icon(Icons.drive_file_rename_outline),
            onPressed: () => renameFolder(context, model.folderId),
            child: const Text('Rename Folder…'),
          ),
          MenuItemButton(
            leadingIcon: const Icon(Icons.folder_delete_outlined),
            onPressed: () => folderMenu(context, model.folderId),
            child: const Text('Folder Options…'),
          ),
        ],
      ],
      builder: (context, controller, _) => IconButton(
        tooltip: 'View Options',
        icon: const Icon(Icons.more_horiz),
        onPressed: () => controller.isOpen ? controller.close() : controller.open(),
      ),
    );
  }

  void _rowMenu(Note n) {
    final model = NotesScope.of(context);
    showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      builder: (sheet) {
        void run(VoidCallback f) {
          Navigator.of(sheet).pop();
          f();
        }

        return SafeArea(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (n.isDeleted)
                ListTile(leading: const Icon(Icons.restore), title: const Text('Recover'), onTap: () => run(() => model.recover(n.id)))
              else ...[
                ListTile(
                  leading: Icon(n.pinned ? Icons.push_pin_outlined : Icons.push_pin),
                  title: Text(n.pinned ? 'Unpin Note' : 'Pin Note'),
                  onTap: () => run(() => model.togglePin(n.id)),
                ),
                ListTile(
                  leading: const Icon(Icons.drive_file_move_outline),
                  title: const Text('Move to Folder…'),
                  onTap: () => run(() => moveNote(context, n)),
                ),
              ],
              ListTile(
                leading: Icon(Icons.delete_outline, color: Theme.of(sheet).colorScheme.error),
                title: Text('Delete Note', style: TextStyle(color: Theme.of(sheet).colorScheme.error)),
                onTap: () => run(() => deleteNote(context, n)),
              ),
            ],
          ),
        );
      },
    );
  }
}
