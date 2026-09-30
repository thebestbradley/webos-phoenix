// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../notes_model.dart';
import 'home.dart';

/// The model for the widgets below (they rebuild when it changes).
class NotesScope extends InheritedNotifier<NotesModel> {
  const NotesScope({super.key, required NotesModel model, required super.child}) : super(notifier: model);

  static NotesModel of(BuildContext context) => context.dependOnInheritedWidgetOfExactType<NotesScope>()!.notifier!;
}

/// Back: webOS's back gesture reaches a web app as the Escape key.
class BackIntent extends Intent {
  const BackIntent();
}

class NotesApp extends StatefulWidget {
  const NotesApp({super.key, required this.model});

  final NotesModel model;

  @override
  State<NotesApp> createState() => _NotesAppState();
}

class _NotesAppState extends State<NotesApp> {
  late final AppLifecycleListener _lifecycle;
  final _navigator = GlobalKey<NavigatorState>();

  @override
  void initState() {
    super.initState();
    // Save before the app goes to the background or closes.
    _lifecycle = AppLifecycleListener(onHide: widget.model.flush, onDetach: widget.model.flush);
  }

  @override
  void dispose() {
    _lifecycle.dispose();
    widget.model.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return NotesScope(
      model: widget.model,
      child: ListenableBuilder(
        listenable: widget.model,
        builder: (context, _) {
          final s = widget.model.settings;
          return MaterialApp(
            title: 'Notes (Flutter)',
            debugShowCheckedModeBanner: false,
            theme: ThemeData(colorSchemeSeed: s.seed, brightness: Brightness.light),
            darkTheme: ThemeData(colorSchemeSeed: s.seed, brightness: Brightness.dark),
            themeMode: s.themeMode,
            navigatorKey: _navigator,
            // Back closes what is on top: a menu (its own Escape), a dialog,
            // sheet or drawer, Settings, then the open note (Home's PopScope).
            shortcuts: {
              ...WidgetsApp.defaultShortcuts,
              const SingleActivator(LogicalKeyboardKey.escape): const BackIntent(),
            },
            actions: {
              ...WidgetsApp.defaultActions,
              BackIntent: CallbackAction<BackIntent>(onInvoke: (_) => _navigator.currentState?.maybePop()),
            },
            home: const Home(),
          );
        },
      ),
    );
  }
}
