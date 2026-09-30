// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The cases of notes-core's markdown.test.ts, for the Dart port.

import 'package:flutter_notes/src/markdown.dart';
import 'package:flutter_notes/src/sample.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('toggleTask', () {
    test('checks and unchecks the chosen box', () {
      const src = '- [ ] a\n- [x] b\n- [ ] c';
      expect(toggleTask(src, 0), '- [x] a\n- [x] b\n- [ ] c');
      expect(toggleTask(src, 1), '- [ ] a\n- [ ] b\n- [ ] c');
      expect(toggleTask(src, 2), '- [ ] a\n- [x] b\n- [x] c');
    });

    test('never edits a look-alike inside a code block', () {
      const src = '```\n- [ ] not a task\n```\n\n- [ ] real';
      expect(taskStates(src), [false]);
      expect(toggleTask(src, 0), '```\n- [ ] not a task\n```\n\n- [x] real');
    });

    test('handles numbered, nested and quoted tasks', () {
      const src = '1. [ ] first\n   - [ ] inner\n\n> - [ ] quoted';
      expect(taskStates(src), [false, false, false]);
      expect(taskStates(toggleTask(src, 1)), [false, true, false]);
      expect(taskStates(toggleTask(src, 2)), [false, false, true]);
    });

    test('leaves the note alone for an index out of range', () {
      expect(toggleTask('- [ ] a', 3), '- [ ] a');
    });

    test('counts only the boxes the preview draws (a tight list’s items)', () {
      // flutter_markdown_plus draws a box when it is the item's first child;
      // in a loose list (blank lines between items) the parser puts it in
      // the item's paragraph, and no box is drawn.
      expect(taskStates('- [ ] a\n\n- [x] b'), isEmpty);
      expect(taskStates(welcomeNote), [true, false, false]);
    });
  });

  group('summaries', () {
    test('titles a note by its first line, without Markdown', () {
      final s = summarize('# **Shopping** list\n\n- [ ] milk\n- eggs');
      expect(s.title, 'Shopping list');
      expect(s.preview, 'milk eggs');
      expect(summarize('').title, 'New Note');
      expect(summarize('').preview, 'No additional text');
      expect(summarize('Just a title').preview, 'No additional text');
    });

    test('reads links, tables and code as text', () {
      expect(textLines('see [the site](https://x.org) & more'), ['see the site & more']);
      expect(textLines('| a | b |\n| - | - |\n| 1 | 2 |'), ['a b', '1 2']);
      expect(textLines('```\ncode  here\n```'), ['code here']);
    });

    test('counts words', () {
      expect(wordCount('# Hello world\n\n- [ ] one, two'), 4);
      expect(wordCount(welcomeNote), greaterThan(50));
    });

    test('finds what a note contains, for the search filters', () {
      expect(noteFeatures(welcomeNote), {Feature.checklist, Feature.table, Feature.link, Feature.code});
      expect(noteFeatures('plain'), isEmpty);
    });
  });
}
