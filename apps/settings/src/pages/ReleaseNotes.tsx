// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The system's release notes (release-notes.json, through com.palm.update
// getReleaseNotes; docs/APP-STORE.md "Update logs"): the running version's
// notes, then every version's, each opening its notes. Settings > Updates'
// Version History and Device Info's Release Notes open it; Back goes back.

import { useEffect, useState } from "react";
import { systemUpdates, type ReleaseNotes } from "@phoenix/luna";
import { Group, Note, Page, PageHeader, ReleaseNotes as Notes, Row, Spinner, VersionHistory } from "@phoenix/ui";

/** Every version's notes ([] when the system has none), or null while it asks. */
export function useSystemReleaseNotes(): ReleaseNotes[] | null {
    const [versions, setVersions] = useState<ReleaseNotes[] | null>(null);
    useEffect(() => {
        let live = true;
        // An older system has no getReleaseNotes: no notes, then.
        systemUpdates.releaseNotes().then((v) => { if (live) setVersions(v); }, () => { if (live) setVersions([]); });
        return () => { live = false; };
    }, []);
    return versions;
}

export function SystemReleaseNotes({ name }: { name: string }) {
    const versions = useSystemReleaseNotes();
    const current = versions?.[0];
    return (
        <Page>
            <PageHeader title="Release Notes" icon="icons/updates.png" />
            {versions === null ? <Row title="Loading…"><Spinner /></Row>
                : !current ? <Note testId="release-notes-none">This system has no release notes.</Note>
                : (
                    <>
                        <Group label={`What's New in ${name} ${current.version}`}>
                            <Notes notes={current} lines={0} testId="release-notes-current" />
                        </Group>
                        <Group label="Version History">
                            <VersionHistory versions={versions} testId="release-notes-history" />
                        </Group>
                    </>
                )}
        </Page>
    );
}
