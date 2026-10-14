// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Update logs (docs/APP-STORE.md "Update logs"): one entry of an app's
// changelog.json or of the system's release-notes.json, as the catalog
// (whatsNew, versionHistory), the Marketplace's service and com.palm.update
// (releaseNotes, getReleaseNotes) pass it on. Readers treat every field that
// carries one as optional: an older catalog, feed or system has none.

/** One version's notes, newest first in a history. */
export interface ReleaseNotes {
    version: string;
    /** YYYY-MM-DD. */
    date: string;
    /** One sentence. */
    summary: string;
    new: string[];
    improved: string[];
    fixed: string[];
    /** Known problems. */
    known: string[];
    /** The version where a rebuilt app starts (the oldest entry of its log); in a history only. */
    rebuild?: boolean;
    /** The original the rebuild replaces ("Tasks 1.0 (webOS 3.0.5)"). */
    replaces?: string;
}
