// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Notes and folders as all the Notes demos keep them in db8 (the same kinds
// and fields as apps/shared/notes-core/src/model.ts), so a note written in
// the Enact or Ionic demo shows here and the other way round.

const noteKind = 'org.webosphoenix.enactnotes.note:1';
const folderKind = 'org.webosphoenix.enactnotes.folder:1';

const appId = 'org.webosphoenix.flutternotes';

/// The apps allowed to use the kinds (notes-core's APP_IDS).
const appIds = [
  'org.webosphoenix.enactnotes.limestone',
  'org.webosphoenix.enactnotes.agate',
  'org.webosphoenix.ionicnotes',
  'org.webosphoenix.flutternotes',
];

/// The built-in folders, as in Apple Notes. Only user folders are stored.
const allNotes = 'all';
const defaultFolder = 'notes';
const recentlyDeleted = 'deleted';

/// Recently Deleted keeps a note this long, then removes it for good.
const deletedRetentionMs = 30 * 24 * 60 * 60 * 1000;

enum SortOrder { modified, created, title }

class Note {
  Note({
    required this.id,
    this.rev,
    required this.folderId,
    required this.body,
    required this.pinned,
    required this.createdAt,
    required this.modifiedAt,
    required this.deletedAt,
  });

  final String id;
  final int? rev;

  /// defaultFolder or a Folder's id.
  final String folderId;

  /// The note's text, in Markdown (CommonMark with GitHub's extensions).
  final String body;
  final bool pinned;
  final int createdAt;
  final int modifiedAt;

  /// When it went to Recently Deleted; null while it is not deleted.
  final int? deletedAt;

  bool get isDeleted => deletedAt != null;

  factory Note.fromJson(Map<String, dynamic> j) => Note(
        id: j['_id'] as String,
        rev: (j['_rev'] as num?)?.toInt(),
        folderId: (j['folderId'] as String?) ?? defaultFolder,
        body: (j['body'] as String?) ?? '',
        pinned: j['pinned'] == true,
        createdAt: (j['createdAt'] as num?)?.toInt() ?? 0,
        modifiedAt: (j['modifiedAt'] as num?)?.toInt() ?? 0,
        deletedAt: (j['deletedAt'] as num?)?.toInt(),
      );
}

class Folder {
  Folder({required this.id, required this.name, required this.createdAt});

  final String id;
  final String name;
  final int createdAt;

  factory Folder.fromJson(Map<String, dynamic> j) => Folder(
        id: j['_id'] as String,
        name: (j['name'] as String?) ?? '',
        createdAt: (j['createdAt'] as num?)?.toInt() ?? 0,
      );
}

/// The notes a folder (built-in or user) shows.
List<Note> notesInFolder(List<Note> notes, String folderId) {
  if (folderId == recentlyDeleted) return notes.where((n) => n.isDeleted).toList();
  final live = notes.where((n) => !n.isDeleted);
  return folderId == allNotes ? live.toList() : live.where((n) => n.folderId == folderId).toList();
}

/// Notes in Recently Deleted for longer than the retention period.
List<Note> expiredNotes(List<Note> notes, int now) =>
    notes.where((n) => n.isDeleted && now - n.deletedAt! >= deletedRetentionMs).toList();

/// Days left before a deleted note is removed (Apple shows "30 days").
int daysLeft(Note n, int now) {
  if (!n.isDeleted) return 0;
  final left = ((deletedRetentionMs - (now - n.deletedAt!)) / 86400000).ceil();
  return left < 0 ? 0 : left;
}

/// A folder name that is not empty and not taken (case-insensitive).
String? folderNameProblem(String name, List<Folder> folders, [String? except]) {
  final trimmed = name.trim();
  if (trimmed.isEmpty) return 'Enter a name.';
  final lower = trimmed.toLowerCase();
  if (lower == 'notes' || lower == 'all notes' || lower == 'recently deleted') return 'That name is reserved.';
  if (folders.any((f) => f.id != except && f.name.trim().toLowerCase() == lower)) {
    return 'A folder with that name already exists.';
  }
  return null;
}
