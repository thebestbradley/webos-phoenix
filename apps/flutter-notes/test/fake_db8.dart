// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// An in-memory db8 behind a LunaTransport, for tests: the calls NotesStore
// makes (putKind, putPermissions, find with watch, put, merge, del).

import 'dart:async';

import 'package:flutter_notes/src/luna.dart';

class FakeDb8 implements LunaTransport {
  FakeDb8({this.kindOwner});

  /// The app that registered the kinds already (another demo), if any.
  String? kindOwner;
  final Map<String, Json> objects = {};
  final List<String> calls = [];
  final List<void Function()> _watchers = [];
  int _id = 0;

  void _fire() {
    final w = [..._watchers];
    _watchers.clear();
    for (final f in w) {
      scheduleMicrotask(f);
    }
  }

  @override
  Future<Json> call(String uri, Json params) async {
    final method = uri.split('/').last;
    calls.add(method);
    switch (method) {
      case 'putKind':
        if (kindOwner != null && kindOwner != params['owner']) {
          throw LunaException(uri, {'returnValue': false, 'errorCode': -3963, 'errorText': 'db: permission denied'});
        }
        kindOwner = params['owner'] as String;
        return {'returnValue': true};
      case 'putPermissions':
        return {'returnValue': true};
      case 'find':
        final from = (params['query'] as Map)['from'];
        return {'returnValue': true, 'results': objects.values.where((o) => o['_kind'] == from).map((o) => {...o}).toList()};
      case 'put':
        final results = <Json>[];
        for (final o in (params['objects'] as List).cast<Json>()) {
          final id = 'id${++_id}';
          objects[id] = {...o, '_id': id, '_rev': 1};
          results.add({'id': id, 'rev': 1});
        }
        _fire();
        return {'returnValue': true, 'results': results};
      case 'merge':
        for (final o in (params['objects'] as List).cast<Json>()) {
          final id = o['_id'] as String;
          objects[id] = {...?objects[id], ...o};
        }
        _fire();
        return {'returnValue': true};
      case 'del':
        for (final id in (params['ids'] as List).cast<String>()) {
          objects.remove(id);
        }
        _fire();
        return {'returnValue': true};
    }
    throw LunaException(uri, {'returnValue': false, 'errorText': 'Unknown method'});
  }

  @override
  LunaSubscription subscribe(String uri, Json params, void Function(Json) onReply, void Function(LunaException) onError) {
    var cancelled = false;
    scheduleMicrotask(() {
      if (!cancelled) onReply({'returnValue': true, 'results': const []});
    });
    _watchers.add(() {
      if (!cancelled) onReply({'returnValue': true, 'fired': true});
    });
    return _Sub(() => cancelled = true);
  }
}

class _Sub implements LunaSubscription {
  _Sub(this._cancel);

  final void Function() _cancel;

  @override
  void cancel() => _cancel();
}
