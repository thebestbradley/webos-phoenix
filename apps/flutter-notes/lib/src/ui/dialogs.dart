// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The dialogs and sheets the list, the note and the folders share.

import 'package:flutter/material.dart';

import '../markdown.dart';
import '../model.dart';
import '../notes_model.dart';
import 'app.dart';

/// New Folder / Rename Folder: a name, checked as it is typed.
Future<void> _folderName(BuildContext context, {required String title, String initial = '', String? except,
    required Future<String?> Function(NotesModel, String) save}) {
  final model = NotesScope.of(context);
  final controller = TextEditingController(text: initial);
  String? problem;
  return showDialog<void>(
    context: context,
    builder: (context) => StatefulBuilder(
      builder: (context, setState) {
        Future<void> submit() async {
          final p = folderNameProblem(controller.text, model.folders, except) ?? await save(model, controller.text);
          if (!context.mounted) return;
          if (p != null) {
            setState(() => problem = p);
          } else {
            Navigator.of(context).pop();
          }
        }

        return AlertDialog(
          title: Text(title),
          content: TextField(
            controller: controller,
            autofocus: true,
            decoration: InputDecoration(labelText: 'Name', errorText: problem),
            onChanged: (_) => setState(() => problem = null),
            onSubmitted: (_) => submit(),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.of(context).pop(), child: const Text('Cancel')),
            FilledButton(onPressed: submit, child: const Text('Save')),
          ],
        );
      },
    ),
  ).whenComplete(controller.dispose);
}

Future<void> newFolder(BuildContext context) =>
    _folderName(context, title: 'New Folder', save: (m, name) => m.createFolder(name));

Future<void> renameFolder(BuildContext context, String id) => _folderName(
      context,
      title: 'Rename Folder',
      initial: NotesScope.of(context).folderName(id),
      except: id,
      save: (m, name) => m.renameFolder(id, name),
    );

/// Asks, then runs [action]: for what can't be undone.
Future<void> confirm(BuildContext context,
    {required String title, required String message, required String action, required VoidCallback onConfirm}) {
  return showDialog<void>(
    context: context,
    builder: (context) => AlertDialog(
      title: Text(title),
      content: Text(message),
      actions: [
        TextButton(onPressed: () => Navigator.of(context).pop(), child: const Text('Cancel')),
        FilledButton(
          style: FilledButton.styleFrom(
            backgroundColor: Theme.of(context).colorScheme.error,
            foregroundColor: Theme.of(context).colorScheme.onError,
          ),
          onPressed: () {
            Navigator.of(context).pop();
            onConfirm();
          },
          child: Text(action),
        ),
      ],
    ),
  );
}

/// A user folder's actions.
Future<void> folderMenu(BuildContext context, String id) {
  final model = NotesScope.of(context);
  return showModalBottomSheet<void>(
    context: context,
    showDragHandle: true,
    builder: (sheet) => SafeArea(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          ListTile(title: Text(model.folderName(id), style: Theme.of(sheet).textTheme.titleMedium)),
          ListTile(
            leading: const Icon(Icons.drive_file_rename_outline),
            title: const Text('Rename Folder'),
            onTap: () {
              Navigator.of(sheet).pop();
              renameFolder(context, id);
            },
          ),
          ListTile(
            leading: const Icon(Icons.folder_delete_outlined),
            title: const Text('Delete Folder'),
            onTap: () {
              Navigator.of(sheet).pop();
              confirm(
                context,
                title: 'Delete “${model.folderName(id)}”?',
                message: 'Its notes move to Recently Deleted.',
                action: 'Delete',
                onConfirm: () => model.deleteFolder(id),
              );
            },
          ),
        ],
      ),
    ),
  );
}

/// Move to Folder: the folders as a choice.
Future<void> moveNote(BuildContext context, Note note) {
  final model = NotesScope.of(context);
  final choices = [(defaultFolder, 'Notes'), for (final f in model.sortedFolders) (f.id, f.name)];
  return showDialog<void>(
    context: context,
    builder: (context) => SimpleDialog(
      title: Text('Move “${summarize(note.body).title}”'),
      children: [
        RadioGroup<String>(
          groupValue: note.folderId,
          onChanged: (id) {
            if (id != null) model.moveNote(note.id, id);
            Navigator.of(context).pop();
          },
          child: Column(
            children: [
              for (final (id, name) in choices)
                RadioListTile<String>(value: id, title: Text(name), secondary: const Icon(Icons.folder_outlined)),
            ],
          ),
        ),
      ],
    ),
  );
}

/// Deletes a note, offering Undo while it is in Recently Deleted; deleting
/// it from there is for good, so that asks first.
void deleteNote(BuildContext context, Note note) {
  final model = NotesScope.of(context);
  if (note.isDeleted) {
    confirm(
      context,
      title: 'Delete this note now?',
      message: 'It will be deleted immediately. You can’t undo this.',
      action: 'Delete',
      onConfirm: () => model.deleteNote(note.id),
    );
    return;
  }
  model.deleteNote(note.id);
  ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(
      content: const Text('Moved to Recently Deleted'),
      behavior: SnackBarBehavior.floating,
      action: SnackBarAction(label: 'Undo', onPressed: () => model.recover(note.id)),
    ));
}
