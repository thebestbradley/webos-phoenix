// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The web runtime from Dart (dart:js_interop): PalmServiceBridge (or OSE's
// WebOSServiceBridge) for Luna, PalmSystem, phoenixHost, __phoenixRuntime
// and the page's events. Generalised from apps/flutter-notes'
// platform_web.dart.

import 'dart:async';
import 'dart:convert';
import 'dart:js_interop';
import 'dart:js_interop_unsafe';

import 'package:web/web.dart' as web;

import 'host.dart';
import 'luna.dart';
import 'phoenix.dart';

extension type _Bridge._(JSObject _) implements JSObject {
  external set onservicecallback(JSFunction? f);
  external void call(String uri, String params);
  external void cancel();
}

_Bridge _newBridge(String name) => _Bridge._((globalContext[name] as JSFunction).callAsConstructor<JSObject>());

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

/// Luna through the page's PalmServiceBridge.
class PalmBridgeTransport implements LunaTransport {
  PalmBridgeTransport(this._ctor);

  final String _ctor;

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
    final bridge = _newBridge(_ctor);
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
    final bridge = _newBridge(_ctor);
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

/// The page's bus: PalmServiceBridge, OSE's WebOSServiceBridge, or none.
LunaTransport webTransport() {
  if (globalContext.has('PalmServiceBridge')) return PalmBridgeTransport('PalmServiceBridge');
  if (globalContext.has('WebOSServiceBridge')) return PalmBridgeTransport('WebOSServiceBridge');
  return const NoTransport();
}

JSObject? _obj(String name) {
  final v = globalContext[name];
  return v != null && v.isA<JSObject>() ? v as JSObject : null;
}

Json _json(Object? dartified) => dartified is Map ? dartified.cast<String, dynamic>() : {};

class WebHost implements PhoenixHost {
  WebHost() {
    web.document.addEventListener(
      'webOSRelaunch',
      ((web.Event e) {
        final detail = (e as web.CustomEvent).detail;
        Json p = {};
        if (detail != null) {
          p = _json(detail.dartify());
        }
        if (p.isEmpty) {
          try {
            p = (jsonDecode(launchParams) as Map).cast<String, dynamic>();
          } on Object {
            p = {};
          }
        }
        _relaunches.add(p);
      }).toJS,
    );
    web.document.addEventListener('phoenixAppMenu', ((web.Event _) => _menus.add(null)).toJS);
    web.window.addEventListener(
      'phoenixcardactivation',
      ((web.Event e) {
        final d = _json((e as web.CustomEvent).detail?.dartify());
        _active.add(d['active'] == true);
      }).toJS,
    );
    web.window.addEventListener(
      'keydown',
      ((web.KeyboardEvent e) {
        if ((e.key != 'Escape' && e.keyCode != 461) || e.defaultPrevented) return;
        for (final h in _backs.reversed.toList()) {
          if (h()) {
            e.preventDefault();
            return;
          }
        }
      }).toJS,
    );
  }

  final _relaunches = StreamController<Json>.broadcast(sync: true);
  final _menus = StreamController<void>.broadcast(sync: true);
  final _active = StreamController<bool>.broadcast(sync: true);
  final List<bool Function()> _backs = [];

  JSObject? get _palm => _obj('PalmSystem');
  JSObject? get _runtime => _obj('__phoenixRuntime');

  String _palmString(String key) {
    final v = _palm?[key];
    return v != null && v.isA<JSString>() ? (v as JSString).toDart : '';
  }

  @override
  bool get webos => _palm != null;
  @override
  bool get phoenix => _runtime != null;
  @override
  bool get shell => _obj('phoenixHost') != null;

  @override
  String get appId {
    final id = _palmString('appIdentifier');
    if (id.isNotEmpty) return id;
    final m = RegExp(r'/usr/palm/applications/([^/]+)/').firstMatch(web.window.location.pathname);
    return m?.group(1) ?? _palmString('identifier').split(' ').first;
  }

  @override
  String get launchParams => _palmString('launchParams').isEmpty ? '{}' : _palmString('launchParams');

  @override
  String get locale => _palmString('locale').isEmpty ? 'en_us' : _palmString('locale');

  @override
  Json get deviceInfo {
    try {
      return (jsonDecode(_palmString('deviceInfo')) as Map).cast<String, dynamic>();
    } on Object {
      return {};
    }
  }

  @override
  Object? palm(String method, [List<Object?> args = const []]) {
    final p = _palm;
    if (p == null || !p.has(method)) return null;
    final r = p.callMethodVarArgs<JSAny?>(method.toJS, args.map((a) => a.jsify()).toList());
    return r?.dartify() ?? true;
  }

  @override
  void postToHost(String type, Json payload) {
    _obj('phoenixHost')?.callMethod<JSAny?>('postToHost'.toJS, type.toJS, payload.jsify());
  }

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
  Json editState() {
    final rt = _runtime;
    if (rt == null || !rt.has('editState')) return {};
    return _json(rt.callMethod<JSAny?>('editState'.toJS)?.dartify());
  }

  @override
  void edit(String action) {
    final rt = _runtime;
    if (rt != null && rt.has('edit')) rt.callMethod<JSAny?>('edit'.toJS, action.toJS);
  }

  @override
  void openWindow(String url, String name, String features) => web.window.open(url, name, features);
}

/// The page's Phoenix: its bus and runtime.
Phoenix systemPhoenix() => Phoenix(transport: webTransport(), host: WebHost());
