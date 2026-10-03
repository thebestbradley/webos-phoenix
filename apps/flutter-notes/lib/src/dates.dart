// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Apple Notes' note list: Pinned first, then sections by date (Today,
// Yesterday, Previous 7 Days, Previous 30 Days, then months of this year,
// then years), and its short dates (notes-core's dates.ts).

import 'package:intl/intl.dart';

import 'markdown.dart';
import 'model.dart';

class Section {
  Section(this.title, this.notes);

  final String title;
  final List<Note> notes;
}

DateTime _day(int t) {
  final d = DateTime.fromMillisecondsSinceEpoch(t);
  return DateTime(d.year, d.month, d.day);
}

int _daysBetween(int earlier, int later) => (_day(later).difference(_day(earlier)).inHours / 24).round();

int _dateOf(Note n, SortOrder sort) => sort == SortOrder.created ? n.createdAt : n.modifiedAt;

List<Note> sortNotes(List<Note> notes, SortOrder sort) {
  final out = [...notes];
  if (sort == SortOrder.title) {
    final titles = {for (final n in out) n.id: summarize(n.body).title.toLowerCase()};
    out.sort((a, b) {
      final c = titles[a.id]!.compareTo(titles[b.id]!);
      return c != 0 ? c : b.modifiedAt - a.modifiedAt;
    });
  } else {
    out.sort((a, b) => _dateOf(b, sort) - _dateOf(a, sort));
  }
  return out;
}

String _sectionTitle(int t, int now) {
  final days = _daysBetween(t, now);
  if (days <= 0) return 'Today';
  if (days == 1) return 'Yesterday';
  if (days < 7) return 'Previous 7 Days';
  if (days < 30) return 'Previous 30 Days';
  final d = DateTime.fromMillisecondsSinceEpoch(t);
  if (d.year == DateTime.fromMillisecondsSinceEpoch(now).year) return DateFormat.MMMM().format(d);
  return '${d.year}';
}

/// The list's sections. Sorted by title there are no date sections, as in
/// Apple Notes: only Pinned and Notes.
List<Section> groupNotes(List<Note> notes, SortOrder sort, int now, {bool byDate = true}) {
  final sorted = sortNotes(notes, sort);
  final pinned = sorted.where((n) => n.pinned).toList();
  final rest = sorted.where((n) => !n.pinned).toList();
  final out = <Section>[];
  if (pinned.isNotEmpty) out.add(Section('Pinned', pinned));
  if (sort == SortOrder.title || !byDate) {
    if (rest.isNotEmpty) out.add(Section(pinned.isNotEmpty ? 'Notes' : '', rest));
    return out;
  }
  for (final n in rest) {
    final title = _sectionTitle(_dateOf(n, sort), now);
    if (out.isNotEmpty && out.last.title == title && title != 'Pinned') {
      out.last.notes.add(n);
    } else {
      out.add(Section(title, [n]));
    }
  }
  return out;
}

/// The date in a list row: 9:41 AM today, Yesterday, a weekday, then a date.
String shortDate(int t, int now) {
  final d = DateTime.fromMillisecondsSinceEpoch(t);
  final days = _daysBetween(t, now);
  if (days <= 0) return DateFormat.jm().format(d);
  if (days == 1) return 'Yesterday';
  if (days < 7) return DateFormat.EEEE().format(d);
  return DateFormat.yMd().format(d);
}

/// The date above the note: "September 29, 2026 at 9:41 PM".
String longDate(int t) {
  final d = DateTime.fromMillisecondsSinceEpoch(t);
  return '${DateFormat.yMMMMd().format(d)} at ${DateFormat.jm().format(d)}';
}
