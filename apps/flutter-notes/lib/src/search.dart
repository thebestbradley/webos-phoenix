// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0

import 'markdown.dart';
import 'model.dart';

class Match {
  Match(this.note, this.context);

  final Note note;

  /// The line holding the first match, for the result row.
  final String context;
}

// Case and accents are ignored, as Apple Notes searches (Latin letters;
// notes-core folds any accent with Unicode normalization, which Dart's core
// library lacks).
const _accents = {
  'à': 'a', 'á': 'a', 'â': 'a', 'ã': 'a', 'ä': 'a', 'å': 'a', 'ç': 'c', 'è': 'e', 'é': 'e', 'ê': 'e', 'ë': 'e',
  'ì': 'i', 'í': 'i', 'î': 'i', 'ï': 'i', 'ñ': 'n', 'ò': 'o', 'ó': 'o', 'ô': 'o', 'õ': 'o', 'ö': 'o', 'ø': 'o',
  'ù': 'u', 'ú': 'u', 'û': 'u', 'ü': 'u', 'ý': 'y', 'ÿ': 'y',
};

String _fold(String s) => s.toLowerCase().split('').map((c) => _accents[c] ?? c).join();

/// Notes whose text holds every word of the query. Markdown syntax is not
/// searched, only the text.
List<Match> searchNotes(List<Note> notes, String query, [Set<Feature> features = const {}]) {
  final words = _fold(query).split(RegExp(r'\s+')).where((w) => w.isNotEmpty).toList();
  final having = features.isEmpty ? notes : notes.where((n) => noteFeatures(n.body).containsAll(features)).toList();
  if (words.isEmpty) return having.map((n) => Match(n, '')).toList();
  final out = <Match>[];
  for (final note in having) {
    final lines = textLines(note.body);
    final folded = lines.map(_fold).toList();
    final all = folded.join('\n');
    if (!words.every(all.contains)) continue;
    final at = folded.indexWhere((l) => l.contains(words.first));
    out.add(Match(note, at >= 0 ? lines[at] : ''));
  }
  return out;
}
