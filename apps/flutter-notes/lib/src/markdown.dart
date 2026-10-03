// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Notes are plain Markdown: CommonMark with GitHub's extensions, parsed by
// Dart's markdown package exactly as flutter_markdown_plus parses it for the
// preview (notes-core's markdown.ts does the same with marked for the web
// demos).

import 'dart:convert';

import 'package:markdown/markdown.dart' as md;

/// The parser flutter_markdown_plus uses (MarkdownWidget._parseMarkdown).
List<md.Node> parse(String src) =>
    md.Document(extensionSet: md.ExtensionSet.gitHubFlavored, encodeHtml: false)
        .parseLines(const LineSplitter().convert(src));

void _walk(List<md.Node> nodes, void Function(md.Element e) visit) {
  for (final n in nodes) {
    if (n is md.Element) {
      visit(n);
      final c = n.children;
      if (c != null) _walk(c, visit);
    }
  }
}

/// The task box a list item opens with, as flutter_markdown_plus draws it
/// (a box only when it is the item's first child: a tight list's item).
md.Element? _taskBox(md.Element li) {
  final c = li.children;
  if (li.tag != 'li' || c == null || c.isEmpty) return null;
  final first = c.first;
  return first is md.Element && first.tag == 'input' && first.attributes['type'] == 'checkbox' ? first : null;
}

/// Every task box the preview draws, in order: checked or not.
List<bool> taskStates(String src) {
  final out = <bool>[];
  _walk(parse(src), (e) {
    final box = _taskBox(e);
    if (box != null) out.add(box.attributes.containsKey('checked'));
  });
  return out;
}

// A line that may hold a task box: list marker (inside any blockquotes),
// then [ ], [x] or [X]. Group 1 ends just before the box's inner character.
final _taskLine = RegExp(r'^((?:[ \t]*>)*[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+\[)[ xX]\]');

/// Checks or unchecks the index-th task box. The box is found by trying
/// each candidate line and keeping the change the parser reads as flipping
/// exactly that box, so code blocks and the like are never edited by
/// mistake (notes-core's toggleTask).
String toggleTask(String src, int index) {
  final before = taskStates(src);
  if (index < 0 || index >= before.length) return src;
  final want = [...before];
  want[index] = !want[index];
  final lines = src.split('\n');
  for (var i = 0; i < lines.length; i++) {
    final m = _taskLine.firstMatch(lines[i]);
    if (m == null) continue;
    final at = m.group(1)!.length;
    final mark = lines[i][at] == ' ' ? 'x' : ' ';
    final changed = [...lines];
    changed[i] = lines[i].substring(0, at) + mark + lines[i].substring(at + 1);
    final next = changed.join('\n');
    final after = taskStates(next);
    if (after.length == want.length && _same(after, want)) return next;
  }
  return src;
}

bool _same(List<bool> a, List<bool> b) {
  for (var i = 0; i < a.length; i++) {
    if (a[i] != b[i]) return false;
  }
  return true;
}

String _text(List<md.Node> nodes) => nodes.map((n) => n.textContent).join();

const _headings = {'h1', 'h2', 'h3', 'h4', 'h5', 'h6'};

void _blockLines(List<md.Node> nodes, List<String> out) {
  final inline = <md.Node>[];
  void flush() {
    if (inline.isEmpty) return;
    out.addAll(_text(inline).split('\n'));
    inline.clear();
  }

  for (final n in nodes) {
    if (n is md.Text) {
      // Raw HTML blocks, and the text of a tight list's item.
      inline.add(md.Text(n.text.replaceAll(RegExp(r'<[^>]*>'), ' ')));
      continue;
    }
    final e = n as md.Element;
    if (_headings.contains(e.tag) || e.tag == 'p') {
      flush();
      out.addAll(e.textContent.split('\n'));
    } else if (e.tag == 'pre') {
      flush();
      out.addAll(e.textContent.split('\n').map((l) => l.trim()));
    } else if (e.tag == 'blockquote' || e.tag == 'ul' || e.tag == 'ol' || e.tag == 'li' ||
        e.tag == 'thead' || e.tag == 'tbody' || e.tag == 'table') {
      flush();
      _blockLines(e.children ?? const [], out);
    } else if (e.tag == 'tr') {
      flush();
      out.add((e.children ?? const []).map((c) => c.textContent).join(' '));
    } else if (e.tag == 'hr' || e.tag == 'input') {
      flush();
    } else {
      inline.add(e);
    }
  }
  flush();
}

/// The note's text, one line per paragraph line, heading, item or row.
List<String> textLines(String src) {
  final out = <String>[];
  _blockLines(parse(src), out);
  return out.map((l) => l.replaceAll(RegExp(r'\s+'), ' ').trim()).where((l) => l.isNotEmpty).toList();
}

class Summary {
  const Summary(this.title, this.preview);

  /// The first line, as Apple Notes titles a note.
  final String title;

  /// The text after it.
  final String preview;
}

Summary summarize(String src) {
  final lines = textLines(src);
  final rest = lines.skip(1).join(' ');
  return Summary(
    lines.isEmpty ? 'New Note' : lines.first,
    rest.isEmpty ? 'No additional text' : (rest.length > 200 ? rest.substring(0, 200) : rest),
  );
}

/// Words in the note (for the note's info).
int wordCount(String src) =>
    textLines(src).join(' ').split(RegExp(r'\s+')).where((w) => RegExp(r'[\p{L}\p{N}]', unicode: true).hasMatch(w)).length;

enum Feature { checklist, table, link, code }

/// What a note contains, for the search filters (Apple's "Notes with Checklists").
Set<Feature> noteFeatures(String src) {
  final out = <Feature>{};
  _walk(parse(src), (e) {
    if (e.tag == 'input' && e.attributes['type'] == 'checkbox') out.add(Feature.checklist);
    if (e.tag == 'table') out.add(Feature.table);
    if (e.tag == 'a') out.add(Feature.link);
    if (e.tag == 'code') out.add(Feature.code);
  });
  return out;
}
