// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Updates: the System Updates app (com.palm.app.updates) as a Settings page,
// on com.palm.update (@phoenix/luna systemUpdates). The running system,
// what the update server offers, and the steps an update goes through:
// downloaded and written to the other system slot in the background (also
// an ongoing activity in the notification area), then installed by
// restarting into it, now or at the next charge.
//
// Launch params {page: "updates"}; luna-systemui's update alerts open
// com.palm.app.updates, which is this page, with {installNow: true} after
// "Install now".

import { useEffect, useRef, useState } from "react";
import { systemUpdates, updateErrorCode, type UpdateChannel, type UpdateStatus } from "@phoenix/luna";
import { useLaunchParams, useLuna } from "@phoenix/luna/react";
import { Button, ErrorText, Group, ListSelector, Note, Page, PageHeader, Row, Spinner, ToggleButton } from "@phoenix/ui";
import { errorText, size, when } from "./Backup";

const CHANNEL_LABELS: Record<string, string> = { stable: "Stable", beta: "Beta", dev: "Development" };

export function UpdatesPage() {
    const status = useLuna<UpdateStatus>((cb, err) => systemUpdates.watchStatus(cb, err), []).value;
    const params = useLaunchParams<{ installNow?: boolean }>();
    const [error, setError] = useState<string | null>(null);
    const asked = useRef(false);

    async function run(fn: () => Promise<unknown>) {
        setError(null);
        try {
            await fn();
        } catch (e) {
            setError(updateErrorCode(e) === "LOW_BATTERY" && status
                ? `Charge the battery to ${status.minBattery}% or connect the charger to install the update.`
                : errorText(e));
        }
    }

    // "Install now" in the System UI's alert.
    useEffect(() => {
        if (!params.installNow || asked.current || !status || status.state !== "ready") return;
        asked.current = true;
        void run(() => systemUpdates.installNow());
    }, [params.installNow, status?.state]);

    if (!status) return <Page><PageHeader title="Updates" icon="icons/updates.png" /><Row title="Loading…"><Spinner /></Row></Page>;
    const rel = status.available;
    const busy = status.state === "checking" || status.state === "downloading" || status.state === "preparing" || status.state === "restarting";

    return (
        <Page>
            <PageHeader title="Updates" icon="icons/updates.png" />
            <Group label="System software">
                <Row title={status.current.name} value={status.current.version} testId="update-current" />
                <Row title="Build" value={String(status.current.build)} />
            </Group>

            <Group label={rel ? `${rel.name} ${rel.version}` : "Updates"}>
                <div className="updates-status" data-testid="update-status">
                    <UpdateState status={status} />
                </div>
                {(status.state === "downloading" || status.state === "preparing") && (
                    <div className="update-progress" data-testid="update-progress">
                        <div style={{ width: `${status.progress ?? 0}%` }} />
                    </div>
                )}
                {rel && status.state !== "restarting" && (
                    <>
                        <Row title="Size" value={size(rel.size)} />
                        {rel.notes.length > 0 && (
                            <ul className="update-notes" data-testid="update-notes">
                                {rel.notes.map((n) => <li key={n}>{n}</li>)}
                            </ul>
                        )}
                    </>
                )}
                {status.state === "idle" && !rel && status.rollout?.waiting && (
                    <div className="update-detail" data-testid="update-rollout">
                        {status.rollout.version} is reaching devices a few at a time; this one will be offered it soon.
                    </div>
                )}
                {status.state === "idle" && !rel && status.configured !== false && (
                    <Button onClick={() => void run(() => systemUpdates.check())} data-testid="check-updates">Check for Updates</Button>
                )}
                {status.configured === false && (
                    <div className="update-detail" data-testid="update-not-set-up">No update server is set up on this device.</div>
                )}
                {status.lastChecked && status.configured !== false && (
                    <div className="update-detail" data-testid="update-verified">
                        {status.verified ? "The update server's list is signed and was checked." : "The update server's list is not signed (a development server)."}
                    </div>
                )}
                {status.state === "idle" && rel && (
                    <Button onClick={() => void run(() => systemUpdates.download())} data-testid="update-download">Download</Button>
                )}
                {status.state === "downloading" && (
                    <Button variant="dark" onClick={() => void run(() => systemUpdates.cancel())} data-testid="update-cancel">Cancel</Button>
                )}
                {status.state === "ready" && (
                    <>
                        <Button onClick={() => void run(() => systemUpdates.installNow())} data-testid="update-install">Install Now</Button>
                        {!status.deferred && (
                            <Button variant="dark" onClick={() => void run(() => systemUpdates.installLater())} data-testid="update-later">
                                Install Later
                            </Button>
                        )}
                    </>
                )}
                <Row title="Last checked" value={status.state === "checking" ? "Now" : when(status.lastChecked)} testId="update-last-checked" />
            </Group>
            {(error || status.error) && <ErrorText testId="update-error">{error ?? status.error?.errorText}</ErrorText>}

            <Group label="Settings">
                <Row title="Download updates automatically" subtitle="Over Wi-Fi">
                    <ToggleButton value={status.autoDownload} label="Download updates automatically" testId="update-auto"
                                  onChange={(on) => void run(() => systemUpdates.setPreferences({ autoDownload: on }))} />
                </Row>
                <ListSelector title="Updates" value={status.channel} testId="update-channel" disabled={busy || !status.configured}
                              onChange={(v) => void run(() => systemUpdates.setPreferences({ channel: v as UpdateChannel }))}
                              options={(status.channels ?? ["stable", "beta"]).map((c) => ({ label: CHANNEL_LABELS[c] ?? c, value: c }))} />
                {status.channel !== "stable" && (
                    <Note testId="update-channel-note">
                        {status.channel === "dev"
                            ? "Development builds come out every night. They are for testing and can break things; keep a backup."
                            : "Beta releases come before stable ones, for people who want to try them early."}
                    </Note>
                )}
            </Group>
            <Note>
                Updates are written next to the system you are using, so you can keep using your device meanwhile.
                Installing one restarts your device into it, which takes about a minute. If the new system does not
                start, your device goes back to this one.
            </Note>
        </Page>
    );
}

function UpdateState({ status }: { status: UpdateStatus }) {
    const rel = status.available;
    switch (status.state) {
        case "checking": return <><Spinner /> Checking for updates…</>;
        case "downloading": return <>Downloading… {status.progress ?? 0}%</>;
        case "preparing": return <>Preparing the update… {status.progress ?? 0}%</>;
        case "restarting": return <><Spinner /> Restarting to install the update…</>;
        case "ready":
            return status.deferred
                ? <>Ready to install. It will be installed when you next connect the charger.</>
                : <>Ready to install.</>;
        default:
            return rel ? <>An update is available.</> : <>Your device is up to date.</>;
    }
}
