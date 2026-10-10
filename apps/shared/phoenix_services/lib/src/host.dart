// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// What the web runtime offers an app beside the bus: PalmSystem (launch
// params, stage ready, the window), the shell's messages (phoenixHost),
// the Phoenix runtime (__phoenixRuntime: Edit), and the page's events
// (relaunch, the app menu, the card's activation, the back gesture).
// src/web.dart reads them with dart:js_interop; StubHost stands in for
// them in tests and off the web.

import 'dart:async';
import 'dart:convert';

import 'luna.dart';

abstract class PhoenixHost {
  /// PalmSystem is here (webOS).
  bool get webos;

  /// The Phoenix runtime is here (phoenix-sim, a Phoenix device).
  bool get phoenix;

  /// The shell takes messages (phoenixHost.postToHost: notifications).
  bool get shell;

  String get appId;

  /// PalmSystem.launchParams, a JSON string.
  String get launchParams;
  String get locale;

  /// PalmSystem.deviceInfo, parsed.
  Json get deviceInfo;

  /// A PalmSystem method, when it has it: stageReady, activate, keepAlive,
  /// setWindowOrientation, enableFullScreenMode, setWindowProperties,
  /// addBannerMessage, removeBannerMessage, playSoundNotification. Returns
  /// its result (a banner's id), or null when PalmSystem has no such method.
  Object? palm(String method, [List<Object?> args = const []]);

  /// A message to the shell (phoenixHost.postToHost).
  void postToHost(String type, Json payload);

  /// Each relaunch's params (OSE's webOSRelaunch event).
  Stream<Json> get relaunches;

  /// The user tapped the app's name in the status bar (phoenixAppMenu).
  Stream<void> get appMenuToggles;

  /// The card came to the front (true) or left it.
  Stream<bool> get activeChanges;

  /// The back gesture (Escape) with [handler] first; it returns whether it
  /// took it. Returns a function that removes it.
  void Function() onBack(bool Function() handler);

  /// What Edit can do now ({canSelectAll, canCut, canCopy, canPaste}).
  Json editState();

  /// Select All, Cut, Copy or Paste on the focused field.
  void edit(String action);

  /// Open a window (a dashboard): window.open(url, name, features).
  void openWindow(String url, String name, String features);
}

/// An in-memory host: off the web, and in tests (set what it reports,
/// read what it was asked).
class StubHost implements PhoenixHost {
  StubHost({
    this.webos = false,
    this.phoenix = false,
    this.shell = false,
    this.appId = '',
    this.launchParams = '{}',
    this.locale = 'en_us',
    Json? deviceInfo,
  }) : deviceInfo = deviceInfo ?? {};

  @override
  bool webos;
  @override
  bool phoenix;
  @override
  bool shell;
  @override
  String appId;
  @override
  String launchParams;
  @override
  String locale;
  @override
  Json deviceInfo;

  /// Every PalmSystem call and shell message, in order: [name, args].
  final List<List<Object?>> log = [];
  Json edits = {'canSelectAll': false, 'canCut': false, 'canCopy': false, 'canPaste': false};
  final _relaunches = StreamController<Json>.broadcast(sync: true);
  final _menus = StreamController<void>.broadcast(sync: true);
  final _active = StreamController<bool>.broadcast(sync: true);
  final List<bool Function()> _backs = [];

  @override
  Object? palm(String method, [List<Object?> args = const []]) {
    log.add(['PalmSystem.$method', args]);
    if (!webos) return null;
    return method == 'addBannerMessage' ? 'b${log.length}' : true;
  }

  @override
  void postToHost(String type, Json payload) => log.add(['postToHost', type, payload]);

  @override
  Stream<Json> get relaunches => _relaunches.stream;
  @override
  Stream<void> get appMenuToggles => _menus.stream;
  @override
  Stream<bool> get activeChanges => _active.stream;

  @override
  void Function() onBack(bool Function() handler) {
    _backs.add(handler);
    return () => _backs.remove(handler);
  }

  @override
  Json editState() => edits;

  @override
  void edit(String action) => log.add(['edit', action]);

  @override
  void openWindow(String url, String name, String features) => log.add(['open', url, name, features]);

  // ---- Driving it (tests) -----------------------------------------------------------------

  /// The system relaunches the app with [params].
  void relaunch(Json params) {
    launchParams = jsonEncode(params);
    _relaunches.add(params);
  }

  void tapAppName() => _menus.add(null);

  void setActive(bool active) => _active.add(active);

  /// The back gesture: whether a handler took it (innermost first).
  bool back() {
    for (final h in _backs.reversed.toList()) {
      if (h()) return true;
    }
    return false;
  }
}
