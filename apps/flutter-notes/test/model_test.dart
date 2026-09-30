// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0

import 'package:flutter_notes/src/model.dart';
import 'package:flutter_notes/src/notes_model.dart';
import 'package:flutter_notes/src/platform_stub.dart' show resetStubStorage;
import 'package:flutter_notes/src/sample.dart';
import 'package:flutter_notes/src/settings.dart';
import 'package:flutter_notes/src/store.dart';
import 'package:flutter_test/flutter_test.dart';

import 'fake_db8.dart';

Future<void> settle() => Future<void>.delayed(const Duration(milliseconds: 20));

void main() {
  setUp(resetStubStorage);

  group('NotesStore', () {
    test('registers the kinds and lets all the Notes demos use them', () async {
      final db = FakeDb8();
      await NotesStore(db).ensureKinds(appId);
      expect(db.kindOwner, appId);
      expect(db.calls.where((c) => c == 'putPermissions'), hasLength(2));
    });

    test('uses the kinds another demo registered', () async {
      final db = FakeDb8(kindOwner: 'org.webosphoenix.ionicnotes');
      await NotesStore(db).ensureKinds(appId);
      expect(db.kindOwner, 'org.webosphoenix.ionicnotes');
      expect(db.calls, isNot(contains('putPermissions')));
    });
  });

  group('NotesModel', () {
    test('seeds the welcome note once, then writes, deletes and recovers notes', () async {
      final db = FakeDb8();
      var t = 1000;
      final m = NotesModel(db, now: () => t, settings: const Settings());
      await settle();
      expect(m.loaded, isTrue);
      expect(m.notes.single.body, welcomeNote);

      await m.newNote();
      expect(m.draft, '# ');
      m.setDraft('# Groceries\n\n- [ ] milk');
      t = 2000;
      m.flush();
      await settle();
      final id = m.selected!.id;
      expect(db.objects[id]!['body'], '# Groceries\n\n- [ ] milk');
      expect(db.objects[id]!['modifiedAt'], 2000);

      m.toggleTask(0);
      m.flush();
      await settle();
      expect(db.objects[id]!['body'], '# Groceries\n\n- [x] milk');

      m.deleteNote(id);
      await settle();
      expect(m.selected, isNull);
      expect(m.notes.firstWhere((n) => n.id == id).isDeleted, isTrue);
      m.recover(id);
      await settle();
      expect(m.notes.firstWhere((n) => n.id == id).isDeleted, isFalse);
      m.dispose();
    });

    test('drops a new note left empty', () async {
      final db = FakeDb8();
      final m = NotesModel(db, settings: const Settings());
      await settle();
      final before = db.objects.length;
      await m.newNote();
      await settle();
      expect(db.objects.length, before + 1);
      m.select(null);
      await settle();
      expect(db.objects.length, before);
      m.dispose();
    });

    test('checks folder names and moves notes between folders', () async {
      final db = FakeDb8();
      final m = NotesModel(db, settings: const Settings());
      await settle();
      expect(await m.createFolder('Notes'), 'That name is reserved.');
      expect(await m.createFolder('Work'), isNull);
      await settle();
      expect(await m.createFolder('work'), 'A folder with that name already exists.');
      final work = m.folders.single.id;
      final note = m.notes.single.id;
      m.moveNote(note, work);
      await settle();
      expect(m.countIn(work), 1);
      m.deleteFolder(work);
      await settle();
      expect(m.folders, isEmpty);
      expect(m.countIn(recentlyDeleted), 1);
      m.dispose();
    });

    test('reports a missing Luna bus instead of failing', () {
      final m = NotesModel(null, settings: const Settings());
      expect(m.error, contains('Luna'));
      m.dispose();
    });
  });
}
