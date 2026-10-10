// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The web runtime from Dart: Luna, the first frame and links through the
// Phoenix service plugin (phoenix_services), localStorage for settings.

import 'package:phoenix_services/phoenix_services.dart';
import 'package:web/web.dart' as web;

/// Luna through the web runtime, or null outside webOS.
LunaTransport? systemLuna() {
  final p = Phoenix.system();
  return p.has(Capability.bus) ? p.transport : null;
}

String? readSetting(String key) {
  try {
    return web.window.localStorage.getItem(key);
  } catch (_) {
    return null; // storage refused (private mode)
  }
}

void writeSetting(String key, String value) {
  try {
    web.window.localStorage.setItem(key, value);
  } catch (_) {
    // storage refused: the setting lasts until the app closes
  }
}

/// Opens a link in the browser (applicationManager picks the handler).
void openLink(LunaTransport? luna, String url) {
  Phoenix.system().app.open(url).catchError((Object _) {});
}

/// Tells the web runtime the first frame is ready (webOS stageReady).
void stageReady() => Phoenix.system().app.stageReady();
