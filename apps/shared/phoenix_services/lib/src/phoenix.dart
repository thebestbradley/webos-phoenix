// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The Phoenix service plugin in Dart: the same API as @phoenix/sdk
// (apps/shared/sdk; docs/APP-SDK.md), with Futures for calls and Streams
// for subscriptions and events, over the same Luna methods.
//
//     final phoenix = Phoenix.system();
//     phoenix.app.stageReady();
//     if (phoenix.has(Capability.share)) await phoenix.share.open(const ShareContent(text: 'Hello'));
//     phoenix.share.receives.listen((s) => createNote(s.text ?? ''));

import 'dart:async';
import 'dart:convert';

import 'host.dart';
import 'luna.dart';
import 'stub.dart' if (dart.library.js_interop) 'web.dart' as platform;
import 'types.dart';

/// The services, over a transport and a host (Phoenix.system() takes the
/// page's; tests pass fakes).
class Phoenix {
  Phoenix({required this.transport, required this.host}) {
    app = PhoenixApp._(this);
    appMenu = PhoenixAppMenu._(this);
    share = PhoenixShare._(this);
    pickers = PhoenixPickers._(this);
    notifications = PhoenixNotifications._(this);
    ongoing = PhoenixOngoing._(this);
    activities = PhoenixActivities._(this);
    justType = PhoenixJustType._(this);
    assistant = PhoenixAssistant._(this);
    contacts = PhoenixContacts._(this);
    calendar = PhoenixCalendar._(this);
    accounts = PhoenixAccounts._(this);
    email = PhoenixEmail._(this);
    messaging = PhoenixMessaging._(this);
    files = PhoenixFiles._(this);
    location = PhoenixLocation._(this);
    device = PhoenixDevice._(this);
    clipboard = PhoenixClipboard._(this);
  }

  /// The page's Phoenix (its bus and runtime), made once. Off the web
  /// (the Dart VM, a native build): no bus, and has() says so.
  factory Phoenix.system() => _system ??= platform.systemPhoenix();
  static Phoenix? _system;

  final LunaTransport transport;
  final PhoenixHost host;

  late final PhoenixApp app;
  late final PhoenixAppMenu appMenu;
  late final PhoenixShare share;
  late final PhoenixPickers pickers;
  late final PhoenixNotifications notifications;
  late final PhoenixOngoing ongoing;
  late final PhoenixActivities activities;
  late final PhoenixJustType justType;
  late final PhoenixAssistant assistant;
  late final PhoenixContacts contacts;
  late final PhoenixCalendar calendar;
  late final PhoenixAccounts accounts;
  late final PhoenixEmail email;
  late final PhoenixMessaging messaging;
  late final PhoenixFiles files;
  late final PhoenixLocation location;
  late final PhoenixDevice device;
  late final PhoenixClipboard clipboard;

  /// Whether the device offers it (the same table as @phoenix/sdk's has()).
  bool has(Capability c) {
    final bus = transport is! NoTransport;
    final phoenix = host.phoenix && bus;
    switch (c) {
      case Capability.bus:
        return bus;
      case Capability.webos:
        return host.webos;
      case Capability.phoenix:
        return phoenix;
      case Capability.banner:
        return host.webos || bus;
      case Capability.dashboard:
      case Capability.orientation:
      case Capability.fullScreen:
      case Capability.keepAlive:
      case Capability.screenOn:
        return host.webos;
      case Capability.media:
      case Capability.mediaKeys:
      case Capability.location:
      case Capability.device:
      case Capability.settings:
      case Capability.activities:
        return bus;
      default:
        return phoenix;
    }
  }

  /// Any Luna method: one request, one reply (throws LunaException).
  Future<Json> request(String uri, [Json params = const {}]) => transport.call(uri, Map.of(params));

  /// Any Luna method with subscribe: true, as a stream (an error reply is
  /// an error event; the subscription stays open). Cancel the listen to end it.
  Stream<Json> subscribe(String uri, [Json params = const {}]) {
    late StreamController<Json> c;
    LunaSubscription? sub;
    c = StreamController<Json>(
      onListen: () => sub = transport.subscribe(uri, Map.of(params), c.add, c.addError),
      onCancel: () => sub?.cancel(),
    );
    return c.stream;
  }

  Future<void> _launch(String appId, Json params) => request('luna://com.webos.applicationManager/launch', {'id': appId, 'params': params});
}

// ---- The app's life -----------------------------------------------------------------------------

class PhoenixApp {
  PhoenixApp._(this._p);
  final Phoenix _p;

  String get id => _p.host.appId;

  /// The params the app was (last) launched with.
  Json get launchParams {
    try {
      final v = jsonDecode(_p.host.launchParams.isEmpty ? '{}' : _p.host.launchParams);
      return v is Map ? v.cast<String, dynamic>() : {};
    } on FormatException {
      return {};
    }
  }

  /// Each relaunch's params.
  Stream<Json> get relaunches => _p.host.relaunches;

  /// The launch params now, then at each relaunch.
  Stream<Json> get launches async* {
    yield launchParams;
    yield* relaunches;
  }

  /// The back gesture: [handler] returns whether it took it (innermost
  /// first). Untaken, the system minimizes the card. A Flutter app also
  /// gets it as the Escape key (Shortcuts); use one or the other.
  void Function() onBack(bool Function() handler) => _p.host.onBack(handler);

  Stream<bool> get activeChanges => _p.host.activeChanges;

  void stageReady() => _p.host.palm('stageReady');
  void activate() => _p.host.palm('activate');
  void keepAlive([bool on = true]) => _p.host.palm('keepAlive', [on]);
  void setOrientation(Orientation o) => _p.host.palm('setWindowOrientation', [o.name]);
  void setFullScreen(bool on) => _p.host.palm('enableFullScreenMode', [on]);
  void keepScreenOn(bool on) => _p.host.palm('setWindowProperties', [
    {'blockScreenTimeout': on},
  ]);
  String get locale => _p.host.locale;
  Json get deviceInfo => _p.host.deviceInfo;
  bool get onPhoenix => _p.host.phoenix;

  Future<void> launch(String appId, [Json params = const {}]) => _p._launch(appId, params);

  /// Open a URL or file in its app (applicationManager/open).
  Future<void> open(String target) => _p.request('luna://com.webos.applicationManager/open', {'target': target});
}

// ---- The app menu ------------------------------------------------------------------------------

class PhoenixAppMenu {
  PhoenixAppMenu._(this._p);
  final Phoenix _p;

  /// The user tapped the app's name in the status bar (draw the menu: Edit, Share first).
  Stream<void> get toggles =>
      StreamGroup2.merge([_p.host.appMenuToggles, _p.host.relaunches.where((p) => p['palm-command'] == 'open-app-menu').map((_) {})]);

  EditState editState() => EditState.fromJson(_p.host.editState());

  void edit(EditAction action) => _p.host.edit(action.name);
}

/// Merges broadcast streams (dart:async has no merge).
class StreamGroup2 {
  static Stream<T> merge<T>(List<Stream<T>> streams) {
    late StreamController<T> c;
    final subs = <StreamSubscription<T>>[];
    c = StreamController<T>.broadcast(
      onListen: () {
        for (final s in streams) {
          subs.add(s.listen(c.add, onError: c.addError));
        }
      },
      onCancel: () {
        for (final s in subs) {
          s.cancel();
        }
        subs.clear();
      },
    );
    return c.stream;
  }
}

// ---- Share and pickers ---------------------------------------------------------------------------

class PhoenixShare {
  PhoenixShare._(this._p);
  final Phoenix _p;

  /// The system's share sheet (org.webosphoenix.share/open).
  Future<ShareResult> open(ShareContent content) async {
    final r = await _p.request('luna://org.webosphoenix.share/open', content.toJson());
    return ShareResult.fromJson(r);
  }

  /// What the app was launched with to receive (appinfo.json shareTargets).
  ShareContent? get received {
    final s = _p.app.launchParams['share'];
    return s is Map ? ShareContent.fromJson(s.cast<String, dynamic>()) : null;
  }

  /// Shares: the launch's, then each relaunch's.
  Stream<ShareContent> get receives =>
      _p.app.launches.where((p) => p['share'] is Map).map((p) => ShareContent.fromJson((p['share'] as Map).cast<String, dynamic>()));
}

class PhoenixPickers {
  PhoenixPickers._(this._p);
  final Phoenix _p;

  /// The file picker: the files, or null when cancelled.
  Future<List<PickedFile>?> open({
    List<PickKind> kinds = const [PickKind.image],
    bool multiple = false,
    int? cropWidth,
    int? cropHeight,
    List<String> extensions = const [],
    String? title,
  }) async {
    final r = await _p.request('luna://org.webosphoenix.filepicker/pick', {
      'kinds': kinds.map((k) => k.name).toList(),
      if (multiple) 'multiple': true,
      'cropWidth': ?cropWidth,
      'cropHeight': ?cropHeight,
      if (extensions.isNotEmpty) 'extensions': extensions,
      'title': ?title,
    });
    if (r['canceled'] == true) return null;
    return ((r['files'] as List?) ?? const []).map((f) => PickedFile.fromJson((f as Map).cast<String, dynamic>())).toList();
  }

  /// Save to Files: the path written, or null when cancelled. Give [from] (a path) or [data] (base64).
  Future<String?> save({required String name, String? from, String? data, String? mimeType, String? title}) async {
    final r = await _p.request('luna://org.webosphoenix.filepicker/save', {
      'name': name,
      'from': ?from,
      'data': ?data,
      'mimeType': ?mimeType,
      'title': ?title,
    });
    return r['canceled'] == true ? null : r['path'] as String?;
  }
}

// ---- Telling the user -----------------------------------------------------------------------------

class PhoenixNotifications {
  PhoenixNotifications._(this._p);
  final Phoenix _p;

  /// A banner: PalmSystem.addBannerMessage, else OSE's createToast. Its id.
  Future<String> banner(String message, {Json params = const {}, String icon = '', String soundClass = ''}) async {
    final id = _p.host.palm('addBannerMessage', [message, jsonEncode(params), icon, soundClass, '', 0]);
    if (id != null) return id.toString();
    final r = await _p.request('luna://com.webos.notification/createToast', {
      'message': message,
      if (icon.isNotEmpty) 'iconUrl': icon,
      'onclick': {'appId': _p.app.id, 'params': params},
    });
    return (r['toastId'] ?? '').toString();
  }

  void removeBanner(String id) => _p.host.palm('removeBannerMessage', [id]);

  /// A row in the notification area (Phoenix's shell), else a banner.
  Future<void> post(String title, {String body = '', Json params = const {}, String? tag, NotificationActions? actions}) async {
    if (_p.host.shell) {
      _p.host.postToHost('notification', {
        'appId': _p.app.id,
        'title': title,
        'body': body,
        'params': params,
        'tag': ?tag,
        if (actions != null) 'actions': actions.toJson(),
      });
      return;
    }
    await banner(body.isEmpty ? title : '$title: $body', params: params);
  }

  void remove(String tag) => _p.host.postToHost('notification', {'appId': _p.app.id, 'remove': true, 'tag': tag});

  /// A dashboard window (webOS): window.open with the dashboard attributes.
  void dashboard(String url, {String name = 'dashboard', int height = 52, bool persistent = false}) => _p.host.openWindow(
    url,
    name,
    'height=$height, attributes=${jsonEncode({'window': 'dashboard', if (persistent) 'persistent': true})}',
  );
}

class PhoenixOngoing {
  PhoenixOngoing._(this._p);
  final Phoenix _p;

  /// Show or update an ongoing activity's row (progress 0-100, or -1: none).
  Future<void> set(String id, String title, {String body = '', int progress = -1, Json params = const {}}) => _p.request(
    'luna://org.webosphoenix.ongoing/set',
    {'appId': _p.app.id, 'id': id, 'title': title, 'body': body, 'progress': progress, 'params': params},
  );

  Future<void> clear(String id) => _p.request('luna://org.webosphoenix.ongoing/clear', {'id': id});
}

class PhoenixActivities {
  PhoenixActivities._(this._p);
  final Phoenix _p;

  /// Launch the app with [params] at [at], or every [every] ("1h").
  Future<void> schedule(String name, {DateTime? at, String? every, Json params = const {}}) {
    if (at == null && every == null) throw ArgumentError('give at or every');
    return _p.request('luna://com.palm.activitymanager/create', {
      'start': true,
      'replace': true,
      'activity': {
        'name': name,
        'description': name,
        'type': {'foreground': true, 'persist': true},
        'schedule': {'interval': ?every, if (at != null) 'start': activityDate(at)},
        'callback': {
          'method': 'palm://com.palm.applicationManager/launch',
          'params': {'id': _p.app.id, 'params': params},
        },
      },
    });
  }

  Future<void> cancel(String name) async {
    try {
      await _p.request('luna://com.palm.activitymanager/complete', {'activityName': name});
    } on LunaException {
      // none: fine
    }
  }

  /// "2026-09-28 14:05:00Z", the activity manager's format (as @phoenix/luna's activityDateString).
  static String activityDate(DateTime t) {
    final u = t.toUtc();
    String p(int n) => n.toString().padLeft(2, '0');
    return '${u.year}-${p(u.month)}-${p(u.day)} ${p(u.hour)}:${p(u.minute)}:${p(u.second)}Z';
  }
}

// ---- Just Type and the Assistant --------------------------------------------------------------------

class PhoenixJustType {
  PhoenixJustType._(this._p);
  final Phoenix _p;

  /// The app's Just Type action (its launchParam in appinfo.json's universalSearch): the words typed.
  Stream<String> actions(String launchParam) => _p.app.launches.where((p) => p[launchParam] != null).map((p) => p[launchParam].toString());

  /// A content result tapped: its launchParamDbField's value.
  Stream<String> results(String launchParam) => actions(launchParam);
}

class PhoenixAssistant {
  PhoenixAssistant._(this._p);
  final Phoenix _p;

  /// One of the app's Assistant commands (appinfo.json "assistant"): the words in {text}.
  Stream<String> commands(String launchParam) =>
      _p.app.launches.where((p) => p.containsKey(launchParam)).map((p) => p[launchParam] is String ? p[launchParam] as String : '');

  /// The app's commands as the Assistant knows them.
  Future<List<Json>> registered() async {
    final r = await _p.request('luna://org.webosphoenix.assistant/commands');
    return ((r['commands'] as List?) ?? const [])
        .map((c) => (c as Map).cast<String, dynamic>())
        .where((c) => c['appId'] == _p.app.id)
        .toList();
  }
}

// ---- Synergy ------------------------------------------------------------------------------------------

class PhoenixContacts {
  PhoenixContacts._(this._p);
  final Phoenix _p;

  Future<List<PersonSummary>> list() async {
    final r = await _p.request('luna://com.palm.db/find', {
      'query': {'from': 'com.palm.person:1', 'orderBy': 'sortKey'},
    });
    return ((r['results'] as List?) ?? const []).map((p) => PersonSummary.fromPerson((p as Map).cast<String, dynamic>())).toList();
  }

  Future<List<PersonSummary>> search(String text) async {
    final q = text.trim().toLowerCase();
    final digits = q.replaceAll(RegExp(r'\D'), '');
    return (await list())
        .where(
          (p) =>
              p.name.toLowerCase().contains(q) ||
              p.emails.any((e) => e.toLowerCase().contains(q)) ||
              (digits.length >= 3 && p.phoneNumbers.any((n) => n.replaceAll(RegExp(r'\D'), '').contains(digits))),
        )
        .toList();
  }

  Future<void> show(String id) => _p._launch('com.palm.app.contacts', {'launchType': 'showPerson', 'id': id});
}

class PhoenixCalendar {
  PhoenixCalendar._(this._p);
  final Phoenix _p;

  /// Events overlapping [from, to) (repeats by their first occurrence).
  Future<List<CalendarEvent>> events(DateTime from, DateTime to) async {
    final r = await _p.request('luna://com.palm.db/find', {
      'query': {'from': 'com.palm.calendarevent:1'},
    });
    final f = from.millisecondsSinceEpoch, t = to.millisecondsSinceEpoch;
    final out =
        ((r['results'] as List?) ?? const [])
            .map((e) => CalendarEvent.fromJson((e as Map).cast<String, dynamic>()))
            .where((e) => e.start < t && e.end >= f)
            .toList()
          ..sort((a, b) => a.start.compareTo(b.start));
    return out;
  }

  /// Open Calendar on a new event for the user to save.
  Future<void> newEvent(String subject, {DateTime? start, DateTime? end, bool allDay = false, String? location, String? note}) {
    final s = start?.millisecondsSinceEpoch;
    final e = end?.millisecondsSinceEpoch ?? (s == null ? null : s + 3600000);
    return _p._launch('com.palm.app.calendar', {
      'newEvent': {
        'subject': subject,
        if (s != null) 'dtstart': '$s',
        if (e != null) 'dtend': '$e',
        if (allDay) 'allDay': true,
        'location': ?location,
        'note': ?note,
      },
    });
  }

  Future<void> showEvent(String id) => _p._launch('com.palm.app.calendar', {'showEventDetail': id});
}

class PhoenixAccounts {
  PhoenixAccounts._(this._p);
  final Phoenix _p;

  /// The user's accounts, or those offering a capability ("CONTACTS", "MAIL", ...).
  Future<List<Account>> list([String? capability]) async {
    final r = await _p.request('luna://com.palm.service.accounts/listAccounts', {'capability': ?capability});
    return ((r['results'] as List?) ?? const []).map((a) => Account.fromJson((a as Map).cast<String, dynamic>())).toList();
  }
}

class PhoenixEmail {
  PhoenixEmail._(this._p);
  final Phoenix _p;

  /// Email's compose with a draft (the SDK email API's params: role 1 To, 2 Cc, 3 Bcc).
  Future<void> compose({
    List<String> to = const [],
    List<String> cc = const [],
    List<String> bcc = const [],
    String? subject,
    String? body,
    List<String> attachments = const [],
  }) {
    final recipients = [
      for (final v in to) {'value': v, 'type': 'email', 'role': 1},
      for (final v in cc) {'value': v, 'type': 'email', 'role': 2},
      for (final v in bcc) {'value': v, 'type': 'email', 'role': 3},
    ];
    return _p._launch('com.palm.app.email', {
      'summary': ?subject,
      'text': ?body,
      if (body != null) 'isHtml': false,
      if (recipients.isNotEmpty) 'recipients': recipients,
      if (attachments.isNotEmpty)
        'attachments': [
          for (final a in attachments) {'fullPath': a, 'mimeType': ''},
        ],
    });
  }
}

class PhoenixMessaging {
  PhoenixMessaging._(this._p);
  final Phoenix _p;

  /// Messaging's compose with a draft; elsewhere an sms: link.
  Future<void> compose({String? to, String? text}) async {
    try {
      await _p._launch('org.webosphoenix.messaging', {'to': ?to, 'messageText': ?text});
    } on LunaException catch (e) {
      if (e.code != PhoenixErrorCode.unavailable && e.code != PhoenixErrorCode.notFound) rethrow;
      await _p.app.open('sms:${Uri.encodeComponent(to ?? '')}${text == null ? '' : '?body=${Uri.encodeComponent(text)}'}');
    }
  }
}

// ---- Device -----------------------------------------------------------------------------------------

class PhoenixFiles {
  PhoenixFiles._(this._p);
  final Phoenix _p;
  static const _fm = 'luna://org.webosphoenix.filemanager';

  Future<List<Json>> list(String path) async => (((await _p.request('$_fm/list', {'path': path}))['entries'] as List?) ?? const [])
      .map((e) => (e as Map).cast<String, dynamic>())
      .toList();

  Future<String> readText(String path) async =>
      ((await _p.request('$_fm/read', {'path': path, 'encoding': 'utf8'}))['data'] ?? '') as String;

  Future<void> writeText(String path, String text) =>
      _p.request('$_fm/write', {'path': path, 'data': text, 'encoding': 'utf8', 'overwrite': true});
}

class PhoenixLocation {
  PhoenixLocation._(this._p);
  final Phoenix _p;
  static const _svc = 'luna://com.webos.service.location/getLocationUpdates';

  static LunaException _map(LunaException e) => switch (e.errorCode) {
    6 => LunaException(e.uri, e.reply, PhoenixErrorCode.permissionDenied),
    5 => LunaException(e.uri, e.reply, PhoenixErrorCode.unavailable),
    1 => LunaException(e.uri, e.reply, PhoenixErrorCode.timeout),
    _ => e,
  };

  /// One fix. A refusal is permissionDenied, Location Services off unavailable.
  Future<LocationFix> current() async {
    try {
      return LocationFix.fromJson(await _p.request(_svc));
    } on LunaException catch (e) {
      throw _map(e);
    }
  }

  Stream<LocationFix> watch({int minimumIntervalMs = 1000}) => _p
      .subscribe(_svc, {'minimumInterval': minimumIntervalMs})
      .where((r) => r['latitude'] is num)
      .map(LocationFix.fromJson)
      .handleError((Object e) => throw (e is LunaException ? _map(e) : e));
}

class PhoenixDevice {
  PhoenixDevice._(this._p);
  final Phoenix _p;

  /// osInfo/query: the build and the OS name.
  Future<Json> osInfo() => _p.request('luna://com.webos.service.systemservice/osInfo/query');

  /// System preferences ("locale", "timeFormat", ...) and their changes.
  Stream<Json> preferences(List<String> keys) => _p.subscribe('luna://com.webos.service.systemservice/getPreferences', {'keys': keys});
}

class PhoenixClipboard {
  PhoenixClipboard._(this._p);
  final Phoenix _p;

  /// Into the clipboard history (org.webosphoenix.clipboard add); sensitive: masked, expires.
  Future<void> copy(String text, {bool sensitive = false}) => _p.request('luna://org.webosphoenix.clipboard/add', {
    'text': text,
    if (sensitive) 'sensitive': true,
    if (sensitive) 'kind': 'password',
  });
}
