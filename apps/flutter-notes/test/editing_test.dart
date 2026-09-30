// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The cases of notes-core's editing.test.ts, for the Dart port.

import 'package:flutter_notes/src/editing.dart';
import 'package:flutter_test/flutter_test.dart';

TextState at(String text, int start, [int? end]) => TextState(text, start, end ?? start);

void main() {
  group('paragraph styles', () {
    test("reads the style of the cursor's line", () {
      expect(blockStyleAt(at('# T', 1)), BlockStyle.title);
      expect(blockStyleAt(at('## T', 1)), BlockStyle.heading);
      expect(blockStyleAt(at('### T', 1)), BlockStyle.subheading);
      expect(blockStyleAt(at('- a', 1)), BlockStyle.bulleted);
      expect(blockStyleAt(at('3. a', 1)), BlockStyle.numbered);
      expect(blockStyleAt(at('- [x] a', 1)), BlockStyle.checklist);
      expect(blockStyleAt(at('> a', 1)), BlockStyle.quote);
      expect(blockStyleAt(at('a', 1)), BlockStyle.body);
    });

    test('switches a line between styles, keeping the cursor in its text', () {
      final s = setBlockStyle(at('one\ntwo', 5), BlockStyle.heading);
      expect(s.text, 'one\n## two');
      expect(s.start, 8);
      expect(setBlockStyle(at('## two', 4), BlockStyle.checklist).text, '- [ ] two');
      expect(setBlockStyle(at('- [ ] two', 7), BlockStyle.body).text, 'two');
    });

    test('styles an empty first line (the cursor at 0 of a note opening with a blank line)', () {
      expect(blockStyleAt(at('\n# abc', 0)), BlockStyle.body);
      expect(setBlockStyle(at('\nabc', 0), BlockStyle.title), at('# \nabc', 2));
    });

    test('turns a style off when it is chosen again', () {
      expect(setBlockStyle(at('- a', 2), BlockStyle.bulleted).text, 'a');
      expect(setBlockStyle(at('# a', 2), BlockStyle.title).text, 'a');
    });

    test('numbers a selection of lines', () {
      const text = 'a\nb\nc';
      final s = setBlockStyle(at(text, 0, text.length), BlockStyle.numbered);
      expect(s.text, '1. a\n2. b\n3. c');
      expect([s.start, s.end], [0, s.text.length]);
    });
  });

  group('inline styles', () {
    test('wraps and unwraps the selection', () {
      final b = toggleInline(at('say hi', 4, 6), InlineStyle.bold);
      expect(b, at('say **hi**', 6, 8));
      expect(toggleInline(b, InlineStyle.bold), at('say hi', 4, 6));
      expect(toggleInline(at('say **hi**', 4, 10), InlineStyle.bold).text, 'say hi');
    });

    test('puts the cursor between a new pair', () {
      expect(toggleInline(at('x', 1), InlineStyle.strikethrough), at('x~~~~', 3));
    });

    test("does not take bold's markers for italic's", () {
      final s = toggleInline(at('**hi**', 2, 4), InlineStyle.italic);
      expect(s.text, '***hi***');
      expect(toggleInline(s, InlineStyle.italic).text, '**hi**');
    });
  });

  group('lists', () {
    test('continues a list on Enter', () {
      expect(continueList(at('- a', 3)), at('- a\n- ', 6));
      expect(continueList(at('9. a', 4))!.text, '9. a\n10. ');
      expect(continueList(at('  - [x] a', 9))!.text, '  - [x] a\n  - [ ] ');
      expect(continueList(at('> q', 3))!.text, '> q\n> ');
    });

    test('ends the list on an empty item, and ignores other lines', () {
      expect(continueList(at('- a\n- ', 6)), at('- a\n', 4));
      expect(continueList(at('plain', 5)), isNull);
      expect(continueList(at('- a', 1)), isNull);
    });

    test('indents and outdents list items', () {
      expect(indentLines(at('- a', 3), outdent: false), at('    - a', 7));
      expect(indentLines(at('    - a', 7), outdent: true), at('- a', 3));
      expect(indentLines(at('text', 1), outdent: false), isNull);
    });
  });

  group('inserts', () {
    test('inserts a table on lines of its own', () {
      final s = insertTable(at('above', 5));
      expect(s.text, 'above\n\n| Column 1 | Column 2 |\n| --- | --- |\n|   |   |\n|   |   |');
      expect(s.start, 9);
    });

    test('links the selection, or the address alone', () {
      expect(insertLink(at('see docs', 4, 8), 'https://x.org').text, 'see [docs](https://x.org)');
      expect(insertLink(at('', 0), 'https://x.org').text, '<https://x.org>');
    });

    test('fences the selected lines', () {
      expect(codeBlock(at('a\nb', 0, 3)).text, '```\na\nb\n```');
    });
  });
}
