// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Update logs in the classic look (docs/APP-STORE.md "Update logs"): one
// version's notes, its date, its summary and its items under New, Improved,
// Fixed and Known Issues, collapsed to a few with More (ReleaseNotes); and
// every version, newest first, each opening its notes (VersionHistory, rows
// for a Group). The Marketplace's app pages and Installed Apps show an app's
// (its changelog.json, from the catalog), Settings > Updates and Device Info
// the system's (release-notes.json, com.palm.update).

import { Fragment, useState } from "react";
import { cx, Row } from "./layout";

/** One version's notes (@phoenix/luna's ReleaseNotes). */
export interface ReleaseNotesEntry {
    version: string;
    /** YYYY-MM-DD. */
    date: string;
    summary: string;
    new: string[];
    improved: string[];
    fixed: string[];
    known: string[];
    /** The version where a rebuilt app starts. */
    rebuild?: boolean;
    /** What the rebuild replaces ("Tasks 1.0 (webOS 3.0.5)"). */
    replaces?: string;
}

/** The lists, in the order they are shown, with their headings. */
export const RELEASE_NOTE_KINDS = [
    ["new", "New"], ["improved", "Improved"], ["fixed", "Fixed"], ["known", "Known Issues"],
] as const;

/** A notes date (YYYY-MM-DD) as the device's language writes a day: "Nov 2, 2026". */
export function releaseDate(date: string): string {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
    if (!m) return date;
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export interface ReleaseNotesProps {
    notes: ReleaseNotesEntry;
    /** Items shown before More (0: all of them). */
    lines?: number;
    /** "Version 2.1.0 · Nov 2, 2026" above the summary. */
    heading?: boolean;
    testId?: string;
}

/** One version's notes: its summary and items, collapsed to `lines` items with More. */
export function ReleaseNotes({ notes, lines = 3, heading = true, testId }: ReleaseNotesProps) {
    const [open, setOpen] = useState(false);
    const items = RELEASE_NOTE_KINDS.flatMap(([kind]) => (notes[kind] ?? []).map((text) => ({ kind, text })));
    const shown = open || !lines ? items : items.slice(0, lines);
    return (
        <div className="pui-notes" data-testid={testId}>
            {heading && <div className="pui-notes-meta">Version {notes.version} · {releaseDate(notes.date)}</div>}
            {notes.rebuild && (
                <div className="pui-notes-meta" data-testid={testId && `${testId}-rebuild`}>
                    {notes.replaces ? `Rebuilt for webOS Phoenix, in place of ${notes.replaces}` : "Rebuilt for webOS Phoenix"}
                </div>
            )}
            <div className="pui-notes-summary">{notes.summary}</div>
            {RELEASE_NOTE_KINDS.map(([kind, label]) => {
                const list = shown.filter((i) => i.kind === kind);
                return list.length === 0 ? null : (
                    <div key={kind} className="pui-notes-section" data-kind={kind}>
                        <div className="pui-notes-head">{label}</div>
                        <ul>{list.map((i, n) => <li key={n}>{i.text}</li>)}</ul>
                    </div>
                );
            })}
            {shown.length < items.length && (
                <button type="button" className="pui-notes-more" data-testid={testId && `${testId}-more`} onClick={() => setOpen(true)}>More</button>
            )}
        </div>
    );
}

export interface VersionHistoryProps {
    /** Newest first. */
    versions: ReleaseNotesEntry[];
    testId?: string;
}

/** Every version as a row (for a Group), each opening its notes below it. */
export function VersionHistory({ versions, testId }: VersionHistoryProps) {
    const [open, setOpen] = useState<string | null>(null);
    return (
        <>
            {versions.map((v) => (
                <Fragment key={v.version}>
                    <Row title={`Version ${v.version}`} subtitle={`${releaseDate(v.date)} · ${v.summary}`} chevron
                         className={cx("pui-notes-row", open === v.version && "open")} testId={testId && `${testId}-${v.version}`}
                         onClick={() => setOpen(open === v.version ? null : v.version)} />
                    {open === v.version && <ReleaseNotes notes={v} heading={false} lines={0} testId={testId && `${testId}-${v.version}-notes`} />}
                </Fragment>
            ))}
        </>
    );
}
