// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The web runtime from Dart (dart:js_interop): PalmServiceBridge for Luna,
// localStorage for settings, PalmSystem.stageReady.

import 'dart:async';
import 'dart:convert';
import 'dart:js_interop';
import 'dart:js_interop_unsafe';

import 'package:web/web.dart' as web;

import 'luna.dart';

@JS('PalmServiceBridge')
extension type _Bridge._(JSObject _) implements JSObject {
  external _Bridge();
  external set onservicecallback(JSFunction? f);
  external void call(String uri, String params);
  external void cancel();
}

class _Subscription implements LunaSubscription {
  _Subscription(this._bridge, this._pending);

  final _Bridge _bridge;
  final Set<_Bridge> _pending;
  bool _cancelled = false;

  @override
  void cancel() {
    if (_cancelled) return;
    _cancelled = true;
    _bridge.onservicecallback = null;
    _pending.remove(_bridge);
    _bridge.cancel();
  }
}

class _PalmLuna implements LunaTransport {
  // Bridges waiting for replies, kept from the garbage collector.
  final Set<_Bridge> _pending = {};

  Json _parse(String json) {
    try {
      return (jsonDecode(json) as Map).cast<String, dynamic>();
    } on FormatException {
      return {'returnValue': false, 'errorText': 'Bad reply: $json'};
    }
  }

  @override
  Future<Json> call(String uri, Json params) {
    final done = Completer<Json>();
    final bridge = _Bridge();
    _pending.add(bridge);
    bridge.onservicecallback = ((String json) {
      _pending.remove(bridge);
      bridge.onservicecallback = null;
      final r = _parse(json);
      if (r['returnValue'] == false) {
        done.completeError(LunaException(uri, r));
      } else {
        done.complete(r);
      }
    }).toJS;
    bridge.call(uri, jsonEncode(params));
    return done.future;
  }

  @override
  LunaSubscription subscribe(String uri, Json params, void Function(Json) onReply, void Function(LunaException) onError) {
    final bridge = _Bridge();
    final sub = _Subscription(bridge, _pending);
    _pending.add(bridge);
    bridge.onservicecallback = ((String json) {
      if (sub._cancelled) return;
      final r = _parse(json);
      if (r['returnValue'] == false) {
        onError(LunaException(uri, r));
      } else {
        onReply(r);
      }
    }).toJS;
    bridge.call(uri, jsonEncode({...params, 'subscribe': true}));
    return sub;
  }
}

/// Luna through the web runtime, or null outside webOS.
LunaTransport? systemLuna() => globalContext.has('PalmServiceBridge') ? _PalmLuna() : null;

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
  luna?.call('luna://com.webos.applicationManager/open', {'target': url}).catchError((Object _) => <String, dynamic>{});
}

/// Tells the web runtime the first frame is ready (webOS stageReady).
void stageReady() {
  final palm = globalContext['PalmSystem'];
  if (palm != null && palm.isA<JSObject>() && (palm as JSObject).has('stageReady')) {
    palm.callMethod('stageReady'.toJS);
  }
}
