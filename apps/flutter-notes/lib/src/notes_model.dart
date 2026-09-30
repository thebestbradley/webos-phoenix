// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The Notes app's state and actions (notes-core's useNotesApp, as a
// ChangeNotifier): load and watch db8, seed the welcome note on a first
// run, save the open note shortly after each change, drop an empty note.

import 'dart:async';

import 'package:flutter/foundation.dart';

import 'dates.dart';
import 'luna.dart';
import 'markdown.dart' as markdown;
import 'markdown.dart' show Feature, textLines;
import 'model.dart';
import 'platform.dart';
import 'platform.dart' as platform show openLink;
import 'sample.dart';
import 'search.dart';
import 'settings.dart';
import 'store.dart';

const _saveDelay = Duration(milliseconds: 600);

class NotesModel extends ChangeNotifier {
  NotesModel(LunaTransport? luna, {int Function()? now, Settings? settings})
      : _luna = luna,
        _store = luna == null ? null : NotesStore(luna, now),
        _now = now ?? (() => DateTime.now().millisecondsSinceEpoch),
        settings = settings ?? Settings.read() {
    if (_store == null) {
      error = 'The Luna service bus is not available (run Notes on webOS Phoenix).';
    } else {
      _start(_store);
    }
  }

  final LunaTransport? _luna;
  final NotesStore? _store;
  final int Function() _now;

  bool loaded = false;
  String? error;
  List<Note> notes = const [];
  List<Folder> folders = const [];
  String folderId = allNotes;
  String query = '';
  Set<Feature> filters = const {};
  Settings settings;

  String? _selectedId;

  // The note being edited: its text, and whether it has changes not saved.
  String? _editId;
  String _editText = '';
  bool _dirty = false;
  Timer? _timer;
  LunaSubscription? _watch;
  bool _disposed = false;

  NotesStore get _db => _store!;

  void _fail(Object e) {
    error = e is LunaException ? e.errorText : '$e';
    _changed();
  }

  /// Runs a db8 write; a failure shows as the error.
  void _run(Future<Object?> write) {
    write.then((_) {}, onError: _fail);
  }

  void _changed() {
    if (!_disposed) notifyListeners();
  }

  Future<void> _start(NotesStore store) async {
    try {
      await store.ensureKinds(appId);
    } on Object catch (e) {
      _fail(e is LunaException ? e : 'Could not open the notes database');
      return;
    }
    if (_disposed) return;
    var first = true;
    _watch = store.watch((data) {
      notes = data.notes;
      folders = data.folders;
      loaded = true;
      if (first) {
        first = false;
        final expired = expiredNotes(data.notes, _now());
        if (expired.isNotEmpty) _run(store.purge(expired.map((n) => n.id).toList()));
        if (readSetting(seededKey) != '1' && data.notes.isEmpty) {
          writeSetting(seededKey, '1');
          _run(store.createNote(defaultFolder, welcomeNote));
        }
      }
      _followRemote();
      _changed();
    }, _fail);
  }

  /// A change from elsewhere (another demo) shows unless we are editing.
  void _followRemote() {
    final s = selected;
    if (s != null && _editId == s.id && !_dirty && _editText != s.body) _editText = s.body;
  }

  /// Saves the open note's changes now.
  void flush() {
    _timer?.cancel();
    _timer = null;
    final id = _editId;
    if (id != null && _dirty) {
      _dirty = false;
      _run(_db.saveBody(id, _editText));
    }
  }

  @override
  void dispose() {
    flush();
    _disposed = true;
    _watch?.cancel();
    super.dispose();
  }

  Note? get selected => _selectedId == null ? null : notes.where((n) => n.id == _selectedId).firstOrNull;

  /// The open note's text as being edited (saved shortly after each change).
  String get draft => _editText;

  void select(String? id) {
    if (id == _editId) return;
    flush();
    final prev = _editId == null ? null : notes.where((n) => n.id == _editId).firstOrNull;
    // An empty note is not kept, as in Apple Notes.
    if (prev != null && textLines(_editText).isEmpty && !prev.isDeleted) _run(_db.purge([prev.id]));
    final next = id == null ? null : notes.where((n) => n.id == id).firstOrNull;
    _editId = next?.id;
    _editText = next?.body ?? '';
    _dirty = false;
    _selectedId = next?.id;
    _changed();
  }

  void setDraft(String text) {
    if (_editId == null || text == _editText) return;
    _editText = text;
    _dirty = true;
    _timer?.cancel();
    _timer = Timer(_saveDelay, flush);
    _changed();
  }

  void openFolder(String id) {
    folderId = id;
    query = '';
    filters = const {};
    _changed();
  }

  String folderName(String id) {
    if (id == allNotes) return 'All Notes';
    if (id == defaultFolder) return 'Notes';
    if (id == recentlyDeleted) return 'Recently Deleted';
    return folders.where((f) => f.id == id).firstOrNull?.name ?? 'Notes';
  }

  /// Notes per folder id (built-in and user), for the folder list.
  int countIn(String id) => notesInFolder(notes, id).length;

  List<Folder> get sortedFolders => [...folders]..sort((a, b) => a.name.toLowerCase().compareTo(b.name.toLowerCase()));

  /// The open folder's notes in list sections (search off).
  List<Section> get sections =>
      groupNotes(notesInFolder(notes, folderId), settings.sort, _now(), byDate: settings.groupByDate);

  int get count => notesInFolder(notes, folderId).length;

  void setQuery(String q) {
    query = q;
    _changed();
  }

  void setFilters(Set<Feature> f) {
    filters = f;
    _changed();
  }

  bool get searching => query.trim().isNotEmpty || filters.isNotEmpty;

  /// Search results across all notes (search on).
  List<Match> get matches => searching ? searchNotes(notesInFolder(notes, allNotes), query, filters) : const [];

  int get now => _now();

  Future<void> newNote() async {
    flush();
    final target = folderId == allNotes || folderId == recentlyDeleted ? defaultFolder : folderId;
    if (folderId == recentlyDeleted) folderId = defaultFolder;
    final start = switch (settings.newNoteStyle) {
      NewNoteStyle.title => '# ',
      NewNoteStyle.heading => '## ',
      NewNoteStyle.body => '',
    };
    try {
      final n = await _db.createNote(target, start);
      query = '';
      filters = const {};
      if (!notes.any((x) => x.id == n.id)) notes = [n, ...notes];
      _editId = n.id;
      _editText = n.body;
      _dirty = false;
      _selectedId = n.id;
      _changed();
    } on Object catch (e) {
      _fail(e);
    }
  }

  void togglePin(String id) {
    final n = notes.where((x) => x.id == id).firstOrNull;
    if (n != null) _run(_db.setPinned(id, !n.pinned));
  }

  void moveNote(String id, String to) {
    flush();
    _run(_db.move([id], to));
  }

  /// To Recently Deleted; from Recently Deleted, gone for good.
  void deleteNote(String id) {
    final n = notes.where((x) => x.id == id).firstOrNull;
    if (n == null) return;
    if (id == _editId) {
      flush();
      _editId = null;
      _editText = '';
      _selectedId = null;
      _changed();
    }
    _run(n.isDeleted ? _db.purge([id]) : _db.trash([id]));
  }

  void recover(String id) {
    final n = notes.where((x) => x.id == id).firstOrNull;
    if (n != null) _run(_db.recover([n], folders));
  }

  void emptyRecentlyDeleted() {
    final ids = notesInFolder(notes, recentlyDeleted).map((n) => n.id).toList();
    if (_selectedId != null && ids.contains(_selectedId)) select(null);
    if (ids.isNotEmpty) _run(_db.purge(ids));
  }

  Future<String?> createFolder(String name) async {
    final problem = folderNameProblem(name, folders);
    if (problem != null) return problem;
    try {
      folderId = await _db.createFolder(name);
      _changed();
    } on Object catch (e) {
      _fail(e);
    }
    return null;
  }

  Future<String?> renameFolder(String id, String name) async {
    final problem = folderNameProblem(name, folders, id);
    if (problem != null) return problem;
    try {
      await _db.renameFolder(id, name);
    } on Object catch (e) {
      _fail(e);
    }
    return null;
  }

  void deleteFolder(String id) {
    final s = selected;
    if (s != null && s.folderId == id) select(null);
    if (folderId == id) folderId = allNotes;
    _run(_db.deleteFolder(id, notes));
    _changed();
  }

  void toggleTask(int index) {
    if (_editId == null) return;
    setDraft(markdown.toggleTask(_editText, index));
  }

  /// Opens a link from a note in the browser.
  void openLink(String url) => platform.openLink(_luna, url);

  void updateSettings(Settings s) {
    settings = s;
    s.write();
    _changed();
  }
}
