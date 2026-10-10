// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The services' values, as @phoenix/sdk types them.

import 'luna.dart';

/// What has() checks (as @phoenix/sdk's Capability).
enum Capability {
  bus,
  webos,
  phoenix,
  share,
  pickers,
  appMenu,
  ongoing,
  assistant,
  justType,
  clipboardHistory,
  print,
  notifications,
  files,
  contacts,
  calendar,
  messaging,
  email,
  accounts,
  banner,
  dashboard,
  media,
  mediaKeys,
  location,
  device,
  settings,
  activities,
  orientation,
  fullScreen,
  keepAlive,
  screenOn,
}

enum Orientation { free, up, down, left, right, landscape, portrait }

enum EditAction { selectAll, cut, copy, paste }

enum PickKind { image, video, audio, document, file }

class EditState {
  const EditState({this.canSelectAll = false, this.canCut = false, this.canCopy = false, this.canPaste = false});
  factory EditState.fromJson(Json j) => EditState(
    canSelectAll: j['canSelectAll'] == true,
    canCut: j['canCut'] == true,
    canCopy: j['canCopy'] == true,
    canPaste: j['canPaste'] == true,
  );
  final bool canSelectAll, canCut, canCopy, canPaste;
  bool can(EditAction a) => switch (a) {
    EditAction.selectAll => canSelectAll,
    EditAction.cut => canCut,
    EditAction.copy => canCopy,
    EditAction.paste => canPaste,
  };
}

class SharedFile {
  const SharedFile(this.path, [this.mimeType]);
  final String path;
  final String? mimeType;
  Json toJson() => {'path': path, if (mimeType != null) 'mimeType': mimeType};
}

/// What is shared: any of a title, text, a link and files.
class ShareContent {
  const ShareContent({this.title, this.text, this.url, this.files = const []});
  factory ShareContent.fromJson(Json j) => ShareContent(
    title: _str(j['title']),
    text: _str(j['text']),
    url: _str(j['url']),
    files: ((j['files'] as List?) ?? const []).map((f) => SharedFile((f as Map)['path'] as String, f['mimeType'] as String?)).toList(),
  );
  final String? title, text, url;
  final List<SharedFile> files;
  Json toJson() => {
    if (title != null) 'title': title,
    if (text != null) 'text': text,
    if (url != null) 'url': url,
    if (files.isNotEmpty) 'files': files.map((f) => f.toJson()).toList(),
  };
}

String? _str(Object? v) => v is String && v.isNotEmpty ? v : null;

/// What the user did with the sheet: "app" (appId), "photos" / "files" (path), "copy", "cancel".
class ShareResult {
  const ShareResult(this.action, {this.appId, this.path});
  factory ShareResult.fromJson(Json j) =>
      ShareResult(j['action'] as String? ?? 'cancel', appId: j['appId'] as String?, path: j['path'] as String?);
  final String action;
  final String? appId, path;
}

class PickedFile {
  const PickedFile({required this.fullPath, required this.mimeType, required this.name, this.size, this.croppedPath});
  factory PickedFile.fromJson(Json j) => PickedFile(
    fullPath: j['fullPath'] as String,
    mimeType: (j['mimeType'] ?? '') as String,
    name: (j['name'] ?? '') as String,
    size: (j['size'] as num?)?.toInt(),
    croppedPath: j['croppedPath'] as String?,
  );
  final String fullPath, mimeType, name;
  final int? size;
  final String? croppedPath;
}

class NotificationActions {
  const NotificationActions(this.uri, this.items, {this.params = const {}});
  final String uri;
  final Json params;

  /// [id, label] pairs: a button each.
  final List<(String, String)> items;
  Json toJson() => {
    'uri': uri,
    'params': params,
    'items': [
      for (final (id, label) in items) {'id': id, 'label': label},
    ],
  };
}

class PersonSummary {
  const PersonSummary({required this.id, required this.name, this.phoneNumbers = const [], this.emails = const [], this.favorite = false});

  /// From a com.palm.person:1 record ("Mary Spetzler", falling back to the nickname, organisation or first number).
  factory PersonSummary.fromPerson(Json p) {
    final n = (p['name'] as Map?) ?? const {};
    final numbers = ((p['phoneNumbers'] as List?) ?? const []).map((x) => (x as Map)['value'] as String).toList();
    final emails = ((p['emails'] as List?) ?? const []).map((x) => (x as Map)['value'] as String).toList();
    var name = [n['givenName'], n['middleName'], n['familyName']].whereType<String>().where((s) => s.isNotEmpty).join(' ');
    if (name.isEmpty)
      name = (p['nickname'] as String?) ?? ((p['organization'] as Map?)?['name'] as String?) ?? (numbers.isEmpty ? '' : numbers.first);
    return PersonSummary(
      id: (p['_id'] ?? '') as String,
      name: name,
      phoneNumbers: numbers,
      emails: emails,
      favorite: p['favorite'] == true,
    );
  }
  final String id, name;
  final List<String> phoneNumbers, emails;
  final bool favorite;
}

class CalendarEvent {
  const CalendarEvent({
    required this.id,
    required this.subject,
    required this.start,
    required this.end,
    this.allDay = false,
    this.location,
  });
  factory CalendarEvent.fromJson(Json e) {
    int ms(Object? v) => v is num ? v.toInt() : int.tryParse('$v') ?? 0;
    final s = ms(e['dtstart']);
    return CalendarEvent(
      id: (e['_id'] ?? '') as String,
      subject: (e['subject'] ?? '') as String,
      start: s,
      end: e['dtend'] == null ? s : ms(e['dtend']),
      allDay: e['allDay'] == true,
      location: e['location'] as String?,
    );
  }
  final String id, subject;

  /// ms since the epoch.
  final int start, end;
  final bool allDay;
  final String? location;
}

class Account {
  const Account({required this.id, required this.templateId, required this.username, this.capabilities = const []});
  factory Account.fromJson(Json a) => Account(
    id: (a['_id'] ?? '') as String,
    templateId: (a['templateId'] ?? '') as String,
    username: (a['username'] ?? '') as String,
    capabilities: ((a['capabilityProviders'] as List?) ?? const []).map((c) => ((c as Map)['capability'] ?? '') as String).toList(),
  );
  final String id, templateId, username;
  final List<String> capabilities;
}

class LocationFix {
  const LocationFix({required this.latitude, required this.longitude, this.horizAccuracy = -1, this.timestamp = 0});
  factory LocationFix.fromJson(Json j) => LocationFix(
    latitude: (j['latitude'] as num).toDouble(),
    longitude: (j['longitude'] as num).toDouble(),
    horizAccuracy: (j['horizAccuracy'] as num?)?.toDouble() ?? -1,
    timestamp: (j['timestamp'] as num?)?.toInt() ?? 0,
  );
  final double latitude, longitude, horizAccuracy;
  final int timestamp;
}
