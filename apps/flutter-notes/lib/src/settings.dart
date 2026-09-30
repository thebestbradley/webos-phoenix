// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The app's settings, kept as JSON in the same shape as notes-core's
// Settings. The Material colour scheme's seed is kept as `skin`, light or
// dark as an extra.

import 'dart:convert';

import 'package:flutter/material.dart';

import 'model.dart';
import 'platform.dart';

enum NewNoteStyle { title, heading, body }

/// Material 3 seed colours to choose from (Settings > Appearance).
const seeds = <String, Color>{
  'blue': Color(0xFF0175C2),
  'teal': Color(0xFF00897B),
  'green': Color(0xFF43A047),
  'amber': Color(0xFFFFB300),
  'deepOrange': Color(0xFFF4511E),
  'pink': Color(0xFFD81B60),
  'purple': Color(0xFF7E57C2),
};

const settingsKey = '$appId:settings';

class Settings {
  const Settings({
    this.sort = SortOrder.modified,
    this.groupByDate = true,
    this.newNoteStyle = NewNoteStyle.title,
    this.textSize = 100,
    this.openInPreview = false,
    this.skin = 'blue',
    this.themeMode = ThemeMode.system,
  });

  final SortOrder sort;
  final bool groupByDate;

  /// What a new note's first line is (Apple's "New notes start with").
  final NewNoteStyle newNoteStyle;

  /// Editor and preview text size, percent.
  final int textSize;

  /// Open notes rendered rather than as Markdown source.
  final bool openInPreview;

  /// The colour scheme's seed (a key of [seeds]).
  final String skin;
  final ThemeMode themeMode;

  Color get seed => seeds[skin] ?? seeds['blue']!;

  Settings copyWith({
    SortOrder? sort,
    bool? groupByDate,
    NewNoteStyle? newNoteStyle,
    int? textSize,
    bool? openInPreview,
    String? skin,
    ThemeMode? themeMode,
  }) =>
      Settings(
        sort: sort ?? this.sort,
        groupByDate: groupByDate ?? this.groupByDate,
        newNoteStyle: newNoteStyle ?? this.newNoteStyle,
        textSize: textSize ?? this.textSize,
        openInPreview: openInPreview ?? this.openInPreview,
        skin: skin ?? this.skin,
        themeMode: themeMode ?? this.themeMode,
      );

  static T _byName<T extends Enum>(List<T> values, Object? name, T fallback) =>
      values.where((v) => v.name == name).firstOrNull ?? fallback;

  static Settings read() {
    const d = Settings();
    final raw = readSetting(settingsKey);
    if (raw == null) return d;
    try {
      final j = (jsonDecode(raw) as Map).cast<String, dynamic>();
      final extra = (j['extra'] as Map?)?.cast<String, dynamic>() ?? const {};
      return Settings(
        sort: _byName(SortOrder.values, j['sort'], d.sort),
        groupByDate: j['groupByDate'] as bool? ?? d.groupByDate,
        newNoteStyle: _byName(NewNoteStyle.values, j['newNoteStyle'], d.newNoteStyle),
        textSize: (j['textSize'] as num?)?.toInt() ?? d.textSize,
        openInPreview: j['openInPreview'] as bool? ?? d.openInPreview,
        skin: seeds.containsKey(j['skin']) ? j['skin'] as String : d.skin,
        themeMode: _byName(ThemeMode.values, extra['themeMode'], d.themeMode),
      );
    } on Object {
      return d;
    }
  }

  void write() => writeSetting(
        settingsKey,
        jsonEncode({
          'sort': sort.name,
          'groupByDate': groupByDate,
          'newNoteStyle': newNoteStyle.name,
          'textSize': textSize,
          'openInPreview': openInPreview,
          'skin': skin,
          'extra': {'themeMode': themeMode.name},
        }),
      );
}
