// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Notes and folders in db8 (com.palm.db), with the same calls as
// notes-core's store.ts, so every demo reads and writes them alike.

import 'dart:async';

import 'luna.dart';
import 'model.dart';

const _db = 'luna://com.palm.db';

class NotesData {
  NotesData(this.notes, this.folders);

  final List<Note> notes;
  final List<Folder> folders;
}

class NotesStore {
  NotesStore(this.luna, [int Function()? now]) : now = now ?? (() => DateTime.now().millisecondsSinceEpoch);

  final LunaTransport luna;
  final int Function() now;

  /// Registers the kinds. The first of the demos to run owns them and lets
  /// the others use them (appIds); for the others, db8 refuses the putKind
  /// because the kinds belong to the first, which is expected.
  Future<void> ensureKinds(String appId) async {
    final kinds = <Json>[
      {
        'id': folderKind,
        'indexes': [
          {'name': 'name', 'props': [{'name': 'name'}]},
        ],
      },
      {
        'id': noteKind,
        'indexes': [
          {'name': 'modified', 'props': [{'name': 'modifiedAt'}]},
          {'name': 'folder', 'props': [{'name': 'folderId'}, {'name': 'modifiedAt'}]},
        ],
      },
    ];
    for (final k in kinds) {
      try {
        await luna.call('$_db/putKind', {...k, 'owner': appId});
      } on LunaException {
        if (!await _readable(k['id'] as String)) rethrow;
        continue;
      }
      await luna.call('$_db/putPermissions', {
        'permissions': [
          for (final caller in appIds)
            {
              'type': 'db.kind',
              'object': k['id'],
              'caller': caller,
              'operations': {'read': 'allow', 'create': 'allow', 'update': 'allow', 'delete': 'allow'},
            },
        ],
      });
    }
  }

  Future<bool> _readable(String kind) async {
    try {
      await luna.call('$_db/find', {
        'query': {'from': kind, 'limit': 1},
      });
      return true;
    } on LunaException {
      return false;
    }
  }

  Future<List<Json>> _findAll(String kind) async {
    final out = <Json>[];
    String? page;
    do {
      final r = await luna.call('$_db/find', {
        'query': {'from': kind, 'limit': 500, 'page': ?page},
      });
      out.addAll(((r['results'] as List?) ?? const []).cast<Map>().map((m) => m.cast<String, dynamic>()));
      page = r['next'] as String?;
    } while (page != null);
    return out;
  }

  Future<NotesData> load() async {
    final results = await Future.wait([_findAll(noteKind), _findAll(folderKind)]);
    return NotesData(results[0].map(Note.fromJson).toList(), results[1].map(Folder.fromJson).toList());
  }

  /// Calls back with all notes and folders now and after every change, in
  /// this app or another (the db8 watch pattern: find with watch: true
  /// answers once, then fires once when the results may have changed).
  LunaSubscription watch(void Function(NotesData) cb, void Function(Object) onError) {
    var cancelled = false;
    final subs = <LunaSubscription? Function()>[];
    void reload() {
      if (cancelled) return;
      load().then((d) {
        if (!cancelled) cb(d);
      }, onError: onError);
    }

    void watchKind(String kind) {
      LunaSubscription? sub;
      void open() {
        if (cancelled) return;
        sub = luna.subscribe('$_db/find', {
          'query': {'from': kind, 'limit': 1},
          'watch': true,
        }, (r) {
          if (r['fired'] == true) {
            sub?.cancel();
            open();
            reload();
          }
        }, onError);
      }

      open();
      subs.add(() => sub);
    }

    watchKind(noteKind);
    watchKind(folderKind);
    reload();
    return _Cancel(() {
      cancelled = true;
      for (final s in subs) {
        s()?.cancel();
      }
    });
  }

  Future<Note> createNote(String folderId, [String body = '']) async {
    final t = now();
    final fresh = <String, dynamic>{
      '_kind': noteKind,
      'folderId': folderId.isEmpty ? defaultFolder : folderId,
      'body': body,
      'pinned': false,
      'createdAt': t,
      'modifiedAt': t,
      'deletedAt': null,
    };
    final r = await luna.call('$_db/put', {
      'objects': [fresh],
    });
    final saved = ((r['results'] as List?) ?? const []).cast<Map>();
    if (saved.isEmpty) throw StateError('db8 put returned no id');
    return Note.fromJson({...fresh, '_id': saved.first['id'], '_rev': saved.first['rev']});
  }

  Future<Json> _merge(List<Json> objects) => luna.call('$_db/merge', {'objects': objects});

  Future<Json> saveBody(String id, String body) => _merge([
        {'_id': id, 'body': body, 'modifiedAt': now()},
      ]);

  Future<Json> setPinned(String id, bool pinned) => _merge([
        {'_id': id, 'pinned': pinned},
      ]);

  Future<Json> move(List<String> ids, String folderId) => _merge([
        for (final id in ids) {'_id': id, 'folderId': folderId},
      ]);

  /// To Recently Deleted (kept 30 days).
  Future<Json> trash(List<String> ids) {
    final t = now();
    return _merge([
      for (final id in ids) {'_id': id, 'deletedAt': t, 'pinned': false},
    ]);
  }

  /// Back from Recently Deleted, into Notes when its folder is gone.
  Future<Json> recover(List<Note> notes, List<Folder> folders) => _merge([
        for (final n in notes)
          {
            '_id': n.id,
            'deletedAt': null,
            'folderId': n.folderId == defaultFolder || folders.any((f) => f.id == n.folderId) ? n.folderId : defaultFolder,
          },
      ]);

  /// Gone for good.
  Future<Json> purge(List<String> ids) => luna.call('$_db/del', {'ids': ids, 'purge': true});

  Future<String> createFolder(String name) async {
    final r = await luna.call('$_db/put', {
      'objects': [
        {'_kind': folderKind, 'name': name.trim(), 'createdAt': now()},
      ],
    });
    final saved = ((r['results'] as List?) ?? const []).cast<Map>();
    if (saved.isEmpty) throw StateError('db8 put returned no id');
    return saved.first['id'] as String;
  }

  Future<Json> renameFolder(String id, String name) => _merge([
        {'_id': id, 'name': name.trim()},
      ]);

  /// Deletes a folder; its notes go to Recently Deleted, as in Apple Notes.
  Future<void> deleteFolder(String id, List<Note> notes) async {
    final inside = notes.where((n) => n.folderId == id && !n.isDeleted).map((n) => n.id).toList();
    if (inside.isNotEmpty) await trash(inside);
    await luna.call('$_db/del', {
      'ids': [id],
      'purge': true,
    });
  }
}

class _Cancel implements LunaSubscription {
  _Cancel(this._fn);

  final void Function() _fn;

  @override
  void cancel() => _fn();
}
