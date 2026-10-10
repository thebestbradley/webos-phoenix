// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// notes-core's share helpers (apps/shared/notes-core/src/share.ts): a share
// received as a new note's Markdown, and what sharing a note shares.

import 'markdown.dart';

/// A new note's text for what was shared: its title as a heading, the text, then the link.
String noteFromShare({String? title, String? text, String? url}) {
  final parts = <String>[];
  if (title != null && title.trim().isNotEmpty) parts.add('# ${title.trim()}');
  if (text != null && text.trim().isNotEmpty) parts.add(text.trim());
  if (url != null && url.trim().isNotEmpty && !(text ?? '').contains(url.trim())) parts.add(url.trim());
  return parts.join('\n\n');
}

/// What sharing a note shares: its title and its Markdown.
({String title, String text}) shareOfNote(String body) => (title: summarize(body).title, text: body);
