// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The Luna service bus as an app uses it: a call answered once, or a
// subscription answered until cancelled. On webOS the calls go through the
// web runtime's PalmServiceBridge (src/web.dart); tests and other platforms
// give their own transport (src/testing.dart has a fake bus).

typedef Json = Map<String, dynamic>;

/// What went wrong, for code that decides what to do (as @phoenix/sdk's PhoenixErrorCode).
enum PhoenixErrorCode {
  /// Not here: no Luna bus (not webOS), or a Phoenix-only service on plain webOS OSE.
  unavailable,

  /// The service refused this app (a permission, or the user said no).
  permissionDenied,

  /// No reply in time.
  timeout,

  /// The service had no such thing.
  notFound,

  /// Any other failure: errorCode and errorText say which.
  failed,
}

/// A service replied with returnValue false (or the call could not be made).
class LunaException implements Exception {
  LunaException(this.uri, this.reply, [PhoenixErrorCode? code]) : code = code ?? classify(reply);

  final String uri;
  final Json reply;
  final PhoenixErrorCode code;

  int get errorCode => (reply['errorCode'] as num?)?.toInt() ?? -1;
  String get errorText => (reply['errorText'] as String?) ?? 'Unknown error';

  /// The same rules as @phoenix/sdk's (apps/shared/sdk/src/core.ts).
  static PhoenixErrorCode classify(Json reply) {
    final text = (reply['errorText'] as String?) ?? '';
    final code = (reply['errorCode'] as num?)?.toInt() ?? -1;
    if (RegExp(
      r'no Luna bus|service does not exist|unknown service|service not available|Unknown method|no such service',
      caseSensitive: false,
    ).hasMatch(text)) {
      return PhoenixErrorCode.unavailable;
    }
    if (RegExp(r'permission|denied|not allowed|not permitted|unauthori[sz]ed', caseSensitive: false).hasMatch(text)) {
      return PhoenixErrorCode.permissionDenied;
    }
    if (code == -2 && RegExp('timed out', caseSensitive: false).hasMatch(text)) return PhoenixErrorCode.timeout;
    if (RegExp(r'not found|no such|does not exist', caseSensitive: false).hasMatch(text)) return PhoenixErrorCode.notFound;
    return PhoenixErrorCode.failed;
  }

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

/// No bus (not webOS): every request fails with [PhoenixErrorCode.unavailable].
class NoTransport implements LunaTransport {
  const NoTransport();

  static Json _reply(String uri) {
    final service = RegExp(r'^(?:luna|palm)://([^/]+)').firstMatch(uri)?.group(1) ?? uri;
    return {'returnValue': false, 'errorCode': -1, 'errorText': '$service: no Luna bus here (not running on webOS)'};
  }

  @override
  Future<Json> call(String uri, Json params) => Future.error(LunaException(uri, _reply(uri)));

  @override
  LunaSubscription subscribe(String uri, Json params, void Function(Json) onReply, void Function(LunaException) onError) {
    final sub = _Done();
    Future.microtask(() {
      if (!sub.cancelled) onError(LunaException(uri, _reply(uri)));
    });
    return sub;
  }
}

class _Done implements LunaSubscription {
  bool cancelled = false;
  @override
  void cancel() => cancelled = true;
}
