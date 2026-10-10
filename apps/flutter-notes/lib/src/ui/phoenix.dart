// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The app's part in the system, through the Phoenix service plugin for
// Dart (phoenix_services), as the web demos do it with @phoenix/sdk:
//
//   - The app menu (the status bar's app name): Edit and Share first, as
//     in every Phoenix app, then New Note and Settings; drawn by Flutter.
//     Share shares the open note through the system's share sheet.
//   - Shares received (web/appinfo.json shareTargets: text and links) and
//     Just Type's "New Note (Flutter)" action become new notes.

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:phoenix_services/phoenix_services.dart' hide Orientation;

import '../notes_model.dart';
import '../share.dart';
import 'settings_page.dart';

class PhoenixIntegration extends StatefulWidget {
  const PhoenixIntegration({super.key, required this.phoenix, required this.model, required this.navigator, required this.child});

  final Phoenix phoenix;
  final NotesModel model;
  final GlobalKey<NavigatorState> navigator;
  final Widget child;

  @override
  State<PhoenixIntegration> createState() => _PhoenixIntegrationState();
}

class _PhoenixIntegrationState extends State<PhoenixIntegration> {
  final List<StreamSubscription<Object?>> _subs = [];
  final List<String> _pending = [];
  bool _menuOpen = false;

  @override
  void initState() {
    super.initState();
    final p = widget.phoenix;
    _subs.add(p.share.receives.listen((s) => _newNote(noteFromShare(title: s.title, text: s.text, url: s.url))));
    _subs.add(p.justType.actions('newNote').listen(_newNote));
    _subs.add(p.appMenu.toggles.listen((_) => _toggleMenu()));
    widget.model.addListener(_flushPending);
  }

  @override
  void dispose() {
    for (final s in _subs) {
      s.cancel();
    }
    widget.model.removeListener(_flushPending);
    super.dispose();
  }

  // The notes load after the app starts; a share at launch waits for them.
  void _newNote(String body) {
    if (body.isEmpty) return;
    if (widget.model.loaded) {
      widget.model.newNote(body);
    } else {
      _pending.add(body);
    }
  }

  void _flushPending() {
    if (!widget.model.loaded || _pending.isEmpty) return;
    final all = List.of(_pending);
    _pending.clear();
    for (final b in all) {
      widget.model.newNote(b);
    }
  }

  Future<void> _toggleMenu() async {
    final nav = widget.navigator.currentState;
    if (nav == null) return;
    if (_menuOpen) {
      nav.maybePop();
      return;
    }
    final context = nav.overlay!.context;
    final note = widget.model.selected;
    _menuOpen = true;
    final choice = await showMenu<String>(
      context: context,
      position: const RelativeRect.fromLTRB(0, 0, 10000, 10000),
      items: [
        const PopupMenuItem(value: 'edit', child: Text('Edit')),
        PopupMenuItem(value: 'share', enabled: note != null, child: const Text('Share')),
        const PopupMenuItem(value: 'new', child: Text('New Note')),
        const PopupMenuItem(value: 'settings', child: Text('Settings')),
      ],
    );
    _menuOpen = false;
    if (!context.mounted) return;
    switch (choice) {
      case 'edit':
        await _editMenu(context);
      case 'share':
        final s = shareOfNote(widget.model.draft);
        await widget.phoenix.share.open(ShareContent(title: s.title, text: s.text)).catchError((Object _) => const ShareResult('cancel'));
      case 'new':
        await widget.model.newNote();
      case 'settings':
        await widget.navigator.currentState?.push(MaterialPageRoute<void>(builder: (_) => const SettingsPage()));
    }
  }

  // Edit's commands act on the focused field through the web runtime (__phoenixRuntime.edit).
  Future<void> _editMenu(BuildContext context) async {
    final state = widget.phoenix.appMenu.editState();
    const labels = {EditAction.selectAll: 'Select All', EditAction.cut: 'Cut', EditAction.copy: 'Copy', EditAction.paste: 'Paste'};
    final action = await showMenu<EditAction>(
      context: context,
      position: const RelativeRect.fromLTRB(0, 0, 10000, 10000),
      items: [
        for (final a in EditAction.values) PopupMenuItem(value: a, enabled: state.can(a), child: Text(labels[a]!)),
      ],
    );
    if (action != null) widget.phoenix.appMenu.edit(action);
  }

  @override
  Widget build(BuildContext context) => widget.child;
}
