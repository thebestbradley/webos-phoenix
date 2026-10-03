// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The folders: beside the notes on a tablet, a drawer on a phone. A user
// folder's menu (long press, or its ⋮ button) renames or deletes it.

import 'package:flutter/material.dart';

import '../model.dart';
import 'app.dart';
import 'dialogs.dart';
import 'settings_page.dart';

class FolderPane extends StatelessWidget {
  const FolderPane({super.key, required this.inDrawer});

  final bool inDrawer;

  @override
  Widget build(BuildContext context) {
    final model = NotesScope.of(context);
    final theme = Theme.of(context);

    void open(String id) {
      model.openFolder(id);
      model.select(null);
      if (inDrawer) Scaffold.of(context).closeDrawer();
    }

    Widget row(String id, String name, IconData icon, {Widget? menu}) => ListTile(
          leading: Icon(icon),
          title: Text(name),
          trailing: Row(
            mainAxisSize: MainAxisSize.min,
            children: [Text('${model.countIn(id)}', style: theme.textTheme.bodySmall), ?menu],
          ),
          selected: model.folderId == id,
          selectedTileColor: theme.colorScheme.secondaryContainer,
          shape: const StadiumBorder(),
          onTap: () => open(id),
          onLongPress: menu == null ? null : () => folderMenu(context, id),
        );

    return Material(
      color: theme.colorScheme.surfaceContainerLow,
      child: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(24, 20, 16, 8),
              child: Text('Folders', style: theme.textTheme.titleLarge),
            ),
            Expanded(
              child: ListView(
                padding: const EdgeInsets.symmetric(horizontal: 12),
                children: [
                  row(allNotes, 'All Notes', Icons.inventory_2_outlined),
                  row(defaultFolder, 'Notes', Icons.folder_outlined),
                  for (final f in model.sortedFolders)
                    row(
                      f.id,
                      f.name,
                      Icons.folder_outlined,
                      menu: IconButton(
                        tooltip: 'Folder options',
                        icon: const Icon(Icons.more_vert, size: 20),
                        onPressed: () => folderMenu(context, f.id),
                      ),
                    ),
                  row(recentlyDeleted, 'Recently Deleted', Icons.delete_outline),
                ],
              ),
            ),
            const Divider(height: 1),
            Padding(
              padding: const EdgeInsets.all(8),
              child: Row(
                children: [
                  TextButton.icon(
                    icon: const Icon(Icons.create_new_folder_outlined),
                    label: const Text('New Folder'),
                    onPressed: () => newFolder(context),
                  ),
                  const Spacer(),
                  IconButton(
                    tooltip: 'Settings',
                    icon: const Icon(Icons.settings_outlined),
                    onPressed: () {
                      if (inDrawer) Scaffold.of(context).closeDrawer();
                      Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => const SettingsPage()));
                    },
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
