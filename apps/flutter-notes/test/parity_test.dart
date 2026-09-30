// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The Dart port keeps what the web demos keep (notes-core), so the demos
// share one set of notes: the same db8 kinds, apps, welcome note and
// first-run key.

import 'dart:io';

import 'package:flutter_notes/src/model.dart';
import 'package:flutter_notes/src/sample.dart';
import 'package:flutter_test/flutter_test.dart';

String _core(String file) => File('../shared/notes-core/src/$file').readAsStringSync();

String _tsString(String source, String name) =>
    RegExp('export const $name = "([^"]+)"').firstMatch(source)!.group(1)!;

void main() {
  test('the db8 kinds and the apps allowed to use them match notes-core', () {
    final model = _core('model.ts');
    expect(noteKind, _tsString(model, 'NOTE_KIND'));
    expect(folderKind, _tsString(model, 'FOLDER_KIND'));
    final ids = RegExp(r'export const APP_IDS = \[([^\]]*)\]').firstMatch(model)!.group(1)!;
    expect(RegExp(r'"([^"]+)"').allMatches(ids).map((m) => m.group(1)).toList(), appIds);
    expect(appIds, contains(appId));
    expect(allNotes, _tsString(model, 'ALL_NOTES'));
    expect(defaultFolder, _tsString(model, 'DEFAULT_FOLDER'));
    expect(recentlyDeleted, _tsString(model, 'RECENTLY_DELETED'));
  });

  test('the welcome note and the first-run key match notes-core', () {
    final sample = _core('sample.ts');
    final ts = RegExp(r'export const WELCOME_NOTE = `(.*?)`;', dotAll: true).firstMatch(sample)!.group(1)!;
    expect(welcomeNote, ts.replaceAll(r'\`', '`'));
    expect(seededKey, _tsString(sample, 'SEEDED_KEY'));
  });

  test('the app id is the one in appinfo.json', () {
    expect(File('web/appinfo.json').readAsStringSync(), contains('"id": "$appId"'));
  });
}
