// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// System updates (stub). Over-the-air updates are not wired up yet; on OSE
// they would go through com.webos.service.swupdater. For now this shows the
// installed version (osInfo/query) and pretends to check.

import { useEffect, useState } from "react";
import { system, type OsInfo } from "@phoenix/luna";
import { Button, Group, Note, Page, PageHeader, Row, Spinner } from "@phoenix/ui";

export function UpdatesPage() {
    const [os, setOs] = useState<OsInfo | null>(null);
    const [state, setState] = useState<"idle" | "checking" | "current">("idle");
    useEffect(() => {
        system.osInfo(["webos_name", "webos_release", "webos_build_id"]).then(setOs).catch(() => setOs({}));
    }, []);
    useEffect(() => {
        if (state !== "checking") return;
        const t = setTimeout(() => setState("current"), 1500);
        return () => clearTimeout(t);
    }, [state]);
    return (
        <Page>
            <PageHeader title="Updates" icon="icons/updates.png" />
            <Group label="System software">
                <Row title={os?.webos_name ?? "webOS Phoenix"} value={os?.webos_release ?? "…"} />
                <Row title="Build" value={os?.webos_build_id ?? "…"} />
            </Group>
            <div className="updates-status" data-testid="update-status">
                {state === "checking" && <><Spinner /> Checking for updates…</>}
                {state === "current" && "Your device is up to date."}
            </div>
            <Button disabled={state === "checking"} onClick={() => setState("checking")} data-testid="check-updates">
                Check for Updates
            </Button>
            <Note>Automatic updates are not available yet in this preview of webOS Phoenix.</Note>
        </Page>
    );
}
