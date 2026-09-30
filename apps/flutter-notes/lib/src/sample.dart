// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The note a first run starts with: a tour of the Markdown the editor
// understands. The same text and first-run key as notes-core's sample.ts
// (test/parity_test.dart checks), so whichever demo runs first seeds it once.

const welcomeNote = '''# Welcome to Notes

This is a demo for webOS Phoenix, in four frameworks that share these notes. Notes are plain *Markdown*, so they read the same in any Markdown app.

## What you can write

- **Bold**, *italic*, ~~strikethrough~~ and `code`
- Links such as <https://commonmark.org>
- Lists, numbered lists and checklists

### A checklist

- [x] Open the Notes demo
- [ ] Tap a box to check it
- [ ] Try the Aa button for styles

### Steps

1. Pick a folder
2. Tap the new note button
3. Start typing

> Quotes look like this.

| Demo | Made with |
| --- | --- |
| Limestone | Enact, for webOS TV |
| Agate | Enact, for car dashboards |
| Ionic | Ionic, for phones and tablets |
| Flutter | Flutter, for phones and tablets |

```
Code blocks keep their spacing.
```
''';

const seededKey = 'org.webosphoenix.enactnotes:seeded';
