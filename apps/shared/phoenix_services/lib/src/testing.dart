// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// A fake Luna bus for an app's tests (as @phoenix/sdk/testing): answer
// methods, see what was asked, push replies to subscriptions.
//
//     final bus = FakeBus()..handle('luna://org.webosphoenix.share/open', (p) => {'action': 'cancel'});
//     final phoenix = Phoenix(transport: bus, host: StubHost(phoenix: true));

import 'dart:async';

import 'luna.dart';

typedef FakeHandler = FutureOr<Json> Function(Json params);

class FakeCall {
  FakeCall(this.uri, this.params, this.subscribed);
  final String uri;
  final Json params;
  bool subscribed;
}

class FakeBus implements LunaTransport {
  final Map<String, FakeHandler> _handlers = {};
  final Map<String, List<void Function(Json)>> _subs = {};
  final List<FakeCall> calls = [];

  /// Answer a method; throw a LunaException (or anything) for an error reply.
  void handle(String uri, FakeHandler h) => _handlers[uri] = h;

  /// Reply to the method's open subscriptions.
  void emit(String uri, Json reply) {
    for (final f in List.of(_subs[uri] ?? const <void Function(Json)>[])) {
      f({'returnValue': true, ...reply});
    }
  }

  Future<Json> _answer(String uri, Json params) async {
    final h = _handlers[uri];
    if (h == null) throw LunaException(uri, {'returnValue': false, 'errorCode': -1, 'errorText': 'Service does not exist: $uri'});
    try {
      return {'returnValue': true, ...await h(params)};
    } on LunaException {
      rethrow;
    } on Object catch (e) {
      throw LunaException(uri, {'returnValue': false, 'errorCode': -1, 'errorText': '$e'});
    }
  }

  @override
  Future<Json> call(String uri, Json params) {
    calls.add(FakeCall(uri, params, false));
    return _answer(uri, params);
  }

  @override
  LunaSubscription subscribe(String uri, Json params, void Function(Json) onReply, void Function(LunaException) onError) {
    final call = FakeCall(uri, params, true);
    calls.add(call);
    final sub = _FakeSub(() {
      call.subscribed = false;
      _subs[uri]?.remove(onReply);
    });
    (_subs[uri] ??= []).add(onReply);
    _answer(uri, params).then(
      (r) {
        if (call.subscribed) onReply(r);
      },
      onError: (Object e) {
        if (call.subscribed) onError(e as LunaException);
      },
    );
    return sub;
  }
}

class _FakeSub implements LunaSubscription {
  _FakeSub(this._onCancel);
  final void Function() _onCancel;
  @override
  void cancel() => _onCancel();
}
