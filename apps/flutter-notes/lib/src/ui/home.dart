// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The layout by width, as the Ionic demo's: from 900 px the folders, the
// list and the open note side by side (a tablet in landscape); from 768 px
// the folders beside the list, the note in its place (a tablet in
// portrait); narrower, the folders are a drawer and the note takes the
// screen (a phone). Back (the app bar's, the system's or Esc) closes it.

import 'package:flutter/material.dart';

import 'app.dart';
import 'folders.dart';
import 'note_list.dart';
import 'note_view.dart';

const folderPaneWidth = 768.0;
const notePaneWidth = 900.0;

class Home extends StatelessWidget {
  const Home({super.key});

  @override
  Widget build(BuildContext context) {
    final model = NotesScope.of(context);
    final width = MediaQuery.sizeOf(context).width;
    final folders = width >= folderPaneWidth;
    final beside = width >= notePaneWidth;
    final open = model.selected != null;

    final Widget main;
    if (beside) {
      main = Row(
        children: [
          SizedBox(width: width >= 1100 ? 380 : 340, child: const NoteList(drawer: false)),
          const VerticalDivider(width: 1),
          const Expanded(child: NoteView(page: false)),
        ],
      );
    } else {
      // The list, or the open note over it, with Material's shared-axis feel.
      main = AnimatedSwitcher(
        duration: const Duration(milliseconds: 250),
        transitionBuilder: (child, animation) => SlideTransition(
          position: Tween(begin: Offset(child.key == const ValueKey('note') ? 1 : -0.3, 0), end: Offset.zero).animate(
            CurvedAnimation(parent: animation, curve: Curves.easeOutCubic),
          ),
          child: child,
        ),
        child: open
            ? const NoteView(key: ValueKey('note'), page: true)
            : NoteList(key: const ValueKey('list'), drawer: !folders),
      );
    }

    return PopScope(
      canPop: beside || !open,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) model.select(null);
      },
      child: Scaffold(
        drawer: folders ? null : const Drawer(child: FolderPane(inDrawer: true)),
        body: folders
            ? Row(
                children: [
                  const SizedBox(width: 260, child: FolderPane(inDrawer: false)),
                  const VerticalDivider(width: 1),
                  Expanded(child: main),
                ],
              )
            : main,
      ),
    );
  }
}
