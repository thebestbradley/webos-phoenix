// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The notes as the share sheet sees them: a note's text to share, and a
// share received (the apps' appinfo.json shareTargets take text and links)
// as a new note's Markdown. The Phoenix service plugin (@phoenix/sdk and
// its bindings) carries them; this is the same in every demo.

import { summarize } from "./markdown";

export interface SharedContent {
    title?: string;
    text?: string;
    url?: string;
}

/** A new note's text for what was shared: its title as a heading, the text, then the link. */
export function noteFromShare(s: SharedContent): string {
    const parts: string[] = [];
    if (s.title?.trim()) parts.push("# " + s.title.trim());
    if (s.text?.trim()) parts.push(s.text.trim());
    if (s.url?.trim() && !(s.text ?? "").includes(s.url.trim())) parts.push(s.url.trim());
    return parts.join("\n\n");
}

/** What sharing a note shares: its title and its Markdown. */
export function shareOfNote(body: string): { title: string; text: string } {
    return { title: summarize(body).title, text: body };
}
