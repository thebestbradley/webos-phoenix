// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The formatting commands of the editor (Apple Notes' Aa menu and checklist
// button), as edits of the Markdown text and its selection: a port of
// notes-core's editing.ts, so every demo writes the same Markdown.

import 'dart:math' as math;

class TextState {
  const TextState(this.text, this.start, this.end);

  final String text;

  /// Selection start and end.
  final int start;
  final int end;

  @override
  bool operator ==(Object other) => other is TextState && other.text == text && other.start == start && other.end == end;

  @override
  int get hashCode => Object.hash(text, start, end);

  @override
  String toString() => 'TextState(${text.replaceAll('\n', r'\n')}, $start, $end)';
}

/// Apple Notes' paragraph styles, and the Markdown each one writes.
enum BlockStyle { title, heading, subheading, body, bulleted, numbered, checklist, quote }

enum InlineStyle { bold, italic, strikethrough, code }

const _inlineMark = {
  InlineStyle.bold: '**',
  InlineStyle.italic: '*',
  InlineStyle.strikethrough: '~~',
  InlineStyle.code: '`',
};

final _heading = RegExp(r'^(#{1,6})[ \t]+');
final _list = RegExp(r'^([ \t]*)(?:([-*+])|(\d{1,9})([.)]))[ \t]+(\[[ xX]\][ \t]+)?');
final _quote = RegExp(r'^[ \t]*>[ \t]?');

String _at(String s, int i) => i >= 0 && i < s.length ? s[i] : '';

String _slice(String s, int from, [int? to]) {
  final a = from.clamp(0, s.length);
  final b = (to ?? s.length).clamp(a, s.length);
  return s.substring(a, b);
}

(int, int) _lineRange(String text, int start, int end) {
  final from = start == 0 ? 0 : text.lastIndexOf('\n', start - 1) + 1;
  var to = text.indexOf('\n', end > start && _at(text, end - 1) == '\n' ? end - 1 : end);
  if (to < 0) to = text.length;
  return (from, to);
}

/// The style of the line holding the cursor.
BlockStyle blockStyleAt(TextState state) {
  final (from, to) = _lineRange(state.text, state.start, state.start);
  final line = state.text.substring(from, to);
  final h = _heading.firstMatch(line);
  if (h != null) {
    final n = h.group(1)!.length;
    return n == 1 ? BlockStyle.title : n == 2 ? BlockStyle.heading : BlockStyle.subheading;
  }
  final l = _list.firstMatch(line);
  if (l != null) return l.group(5) != null ? BlockStyle.checklist : l.group(3) != null ? BlockStyle.numbered : BlockStyle.bulleted;
  if (_quote.hasMatch(line)) return BlockStyle.quote;
  return BlockStyle.body;
}

String _stripBlock(String line) =>
    line.replaceFirst(_heading, '').replaceFirstMapped(_list, (m) => m.group(1)!).replaceFirst(_quote, '');

/// Applies a paragraph style to every line in the selection. Choosing the
/// style a line already has turns it back into body text, as in Apple Notes.
TextState setBlockStyle(TextState state, BlockStyle style) {
  final (from, to) = _lineRange(state.text, state.start, state.end);
  final lines = state.text.substring(from, to).split('\n');
  final toggleOff = style != BlockStyle.body && blockStyleAt(state) == style;
  var n = 0;
  final out = lines.map((line) {
    if (line.trim().isEmpty && lines.length > 1) return line;
    final indent = RegExp(r'^[ \t]*').firstMatch(line)!.group(0)!;
    final bare = _stripBlock(line).replaceFirst(RegExp(r'^[ \t]*'), '');
    if (toggleOff) return indent + bare;
    switch (style) {
      case BlockStyle.title:
        return '# $bare';
      case BlockStyle.heading:
        return '## $bare';
      case BlockStyle.subheading:
        return '### $bare';
      case BlockStyle.bulleted:
        return '$indent- $bare';
      case BlockStyle.numbered:
        return '$indent${++n}. $bare';
      case BlockStyle.checklist:
        return '$indent- [ ] $bare';
      case BlockStyle.quote:
        return '> $bare';
      case BlockStyle.body:
        return indent + bare;
    }
  }).toList();
  final replaced = out.join('\n');
  final text = state.text.substring(0, from) + replaced + state.text.substring(to);
  if (state.start == state.end) {
    // Keep the cursor at the same place in the line's own text.
    final delta = replaced.length - (to - from);
    final pos = math.min(math.max(from, state.start + (lines.length == 1 ? delta : 0)), from + replaced.length);
    return TextState(text, pos, pos);
  }
  return TextState(text, from, from + replaced.length);
}

/// Bold, italic, strikethrough or code around the selection; with the
/// markers already around it, removes them. With no selection, inserts the
/// pair and puts the cursor between them.
TextState toggleInline(TextState state, InlineStyle style) {
  final mark = _inlineMark[style]!;
  final text = state.text;
  final start = state.start;
  final end = state.end;
  final before = _slice(text, start - mark.length, start);
  final after = _slice(text, end, end + mark.length);
  // Italic's "*" must not match the inside of bold's "**" (but "***x***"
  // is bold and italic, so its inner "*" pair is italic).
  final insideBold =
      style == InlineStyle.italic && _at(text, start - 2) == '*' && _at(text, end + 1) == '*' && _at(text, start - 3) != '*';
  if (before == mark && after == mark && !insideBold) {
    return TextState(
      _slice(text, 0, start - mark.length) + text.substring(start, end) + _slice(text, end + mark.length),
      start - mark.length,
      end - mark.length,
    );
  }
  final sel = text.substring(start, end);
  if (sel.startsWith(mark) && sel.endsWith(mark) && sel.length >= mark.length * 2) {
    final inner = sel.substring(mark.length, sel.length - mark.length);
    return TextState(text.substring(0, start) + inner + text.substring(end), start, start + inner.length);
  }
  return TextState(
    text.substring(0, start) + mark + sel + mark + text.substring(end),
    start + mark.length,
    end + mark.length,
  );
}

/// Inserts text at the selection, on lines of its own when [block] is set.
TextState insert(TextState state, String snippet, {bool block = false, int? cursorOffset}) {
  final text = state.text;
  final start = state.start;
  final end = state.end;
  var pre = '';
  var post = '';
  if (block) {
    if (start > 0 && text[start - 1] != '\n') {
      pre = '\n\n';
    } else if (start > 1 && text[start - 2] != '\n') {
      pre = '\n';
    }
    if (end < text.length && text[end] != '\n') {
      post = '\n\n';
    } else if (end < text.length - 1 && text[end + 1] != '\n') {
      post = '\n';
    }
  }
  final at = start + pre.length + (cursorOffset ?? snippet.length);
  return TextState(text.substring(0, start) + pre + snippet + post + text.substring(end), at, at);
}

/// A GitHub-style table with a header row and two empty rows.
TextState insertTable(TextState state, [int columns = 2]) {
  final head = '| ${List.generate(columns, (i) => 'Column ${i + 1}').join(' | ')} |';
  final rule = '|${List.filled(columns, ' --- ').join('|')}|';
  final row = '|${List.filled(columns, '   ').join('|')}|';
  return insert(state, [head, rule, row, row].join('\n'), block: true, cursorOffset: 2);
}

/// [selection](url), or the url in angle brackets with nothing selected.
TextState insertLink(TextState state, String url) {
  final sel = state.text.substring(state.start, state.end);
  return insert(state, sel.isNotEmpty ? '[$sel]($url)' : '<$url>');
}

/// A fenced code block (Apple's Monostyled) around the selected lines.
TextState codeBlock(TextState state) {
  final (from, to) = _lineRange(state.text, state.start, state.end);
  final body = state.text.substring(from, to);
  final text = '${state.text.substring(0, from)}```\n$body\n```${state.text.substring(to)}';
  final cursor = from + 4 + body.length;
  return TextState(text, cursor, cursor);
}

/// Enter at the end of a list item continues the list with the same kind of
/// item (the next number, an unchecked box); Enter on an empty item ends the
/// list. Returns null when Enter should just insert a newline.
TextState? continueList(TextState state) {
  final text = state.text;
  final start = state.start;
  if (start != state.end) return null;
  final (from, to) = _lineRange(text, start, start);
  final line = text.substring(from, to);
  final m = _list.firstMatch(line);
  final q = m == null ? _quote.firstMatch(line) : null;
  if (m == null && q == null) return null;
  final marker = (m ?? q)!.group(0)!;
  if (start < from + marker.length) return null;
  if (line.substring(marker.length).trim().isEmpty) {
    // An empty item: end the list, leaving an empty line.
    return TextState(text.substring(0, from) + text.substring(to), from, from);
  }
  String next;
  if (m != null) {
    final indent = m.group(1)!;
    final bullet = m.group(2);
    final num = m.group(3);
    final delim = m.group(4);
    final box = m.group(5);
    next = '$indent${bullet ?? '${int.parse(num!) + 1}$delim'} ${box != null ? '[ ] ' : ''}';
  } else {
    next = marker;
  }
  final out = '${text.substring(0, start)}\n$next${text.substring(start)}';
  final at = start + 1 + next.length;
  return TextState(out, at, at);
}

/// Tab and Shift+Tab in a list: nest the items, or bring them back out.
TextState? indentLines(TextState state, {required bool outdent}) {
  final (from, to) = _lineRange(state.text, state.start, state.end);
  final lines = state.text.substring(from, to).split('\n');
  if (!lines.every((l) => l.trim().isEmpty || _list.hasMatch(l))) return null;
  final out = lines
      .map((l) => outdent ? l.replaceFirst(RegExp(r'^(?: {1,4}|\t)'), '') : (l.trim().isNotEmpty ? '    $l' : l))
      .toList();
  final replaced = out.join('\n');
  final text = state.text.substring(0, from) + replaced + state.text.substring(to);
  final delta = out[0].length - lines[0].length;
  if (state.start == state.end) {
    final pos = math.max(from, state.start + delta);
    return TextState(text, pos, pos);
  }
  return TextState(text, from, from + replaced.length);
}
