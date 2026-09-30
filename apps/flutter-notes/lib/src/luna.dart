// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The Luna service bus as the app uses it: a call answered once, or a
// subscription answered until cancelled. On webOS the calls go through the
// web runtime's PalmServiceBridge (platform_web.dart); tests supply a fake.

typedef Json = Map<String, dynamic>;

class LunaException implements Exception {
  LunaException(this.uri, this.reply);

  final String uri;
  final Json reply;

  String get errorText => (reply['errorText'] as String?) ?? 'Unknown error';

  @override
  String toString() => '$uri: $errorText';
}

abstract class LunaSubscription {
  void cancel();
}

abstract class LunaTransport {
  /// One reply; an error reply (returnValue false) throws LunaException.
  Future<Json> call(String uri, Json params);

  /// Every reply until cancel(); error replies go to [onError].
  LunaSubscription subscribe(String uri, Json params, void Function(Json) onReply, void Function(LunaException) onError);
}
