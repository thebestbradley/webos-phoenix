// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// An account type that comes in a connector package (package.builtin
// false; docs/SYNERGY-CONNECTORS.md C4): its page's actions. Install puts the
// package on the device through the Marketplace's install path (the
// catalog's kind "connector" entry, its SHA-256 signed in the index), then
// Set up opens the Accounts app's add flow at its template, as for a
// built-in type. Third-party connectors install only in Developer Mode,
// as the owner decided, until Phoenix runs connectors in a sandbox (C5):
// without it, Install says so and leads to Settings > Developer Mode. The
// connectors Phoenix comes with (package.preinstalled: the Fediverse) are
// installed already, removable, and installed again without Developer Mode.
// Remove takes the package's accounts with it, after a confirmation that
// says so.

import { useCallback, useEffect, useRef, useState } from "react";
import { apps, call, devMode, LunaError, marketplace, type AccountType, type InstallProgress } from "@phoenix/luna";
import { useDevModeShown, useLuna } from "@phoenix/luna/react";
import { Button, Dialog, ErrorText, Note } from "@phoenix/ui";
import { openAccountsLaunch, setUpLaunch } from "./accountTypes";

const errorText = (e: unknown) => (e instanceof LunaError ? e.errorText : e instanceof Error ? e.message : String(e));

interface Account { _id: string; templateId?: string; username?: string; alias?: string }

/** What Remove takes with it, in words: "" for no account. */
export function removeAccountsText(accounts: { username?: string; alias?: string }[]): string {
    if (!accounts.length) return "";
    const names = accounts.map((a) => a.alias || a.username || "").filter(Boolean);
    const which = names.length ? ` (${names.join(", ")})` : "";
    return accounts.length === 1
        ? `Its account on this device${which} is removed with it, and the data it brought.`
        : `Its ${accounts.length} accounts on this device${which} are removed with it, and the data they brought.`;
}

/**
 * Whether Install needs Developer Mode first: a third-party connector does,
 * one Phoenix comes with does not (the Marketplace's service checks the same,
 * packagesservice.js firstPartyEntry).
 */
export function needsDevMode(t: AccountType, devModeOn: boolean): boolean {
    return !t.package.builtin && !t.package.preinstalled && !devModeOn;
}

export function ConnectorPackage({ t, added }: { t: AccountType; added: boolean }) {
    const appId = t.package.id;
    // installed: its version, or null; undefined while it is looked up.
    const [installed, setInstalled] = useState<string | null | undefined>(undefined);
    const [update, setUpdate] = useState<string | null>(null);
    const [inCatalog, setInCatalog] = useState(true);
    const [progress, setProgress] = useState<InstallProgress | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [askDevMode, setAskDevMode] = useState(false);
    const [accounts, setAccounts] = useState<Account[]>([]);
    const [templates, setTemplates] = useState<string[]>([t.templateId]);
    const [confirmRemove, setConfirmRemove] = useState(false);
    const [removing, setRemoving] = useState(false);
    const sub = useRef<{ cancel(): void } | null>(null);
    const devModeOn = useLuna<boolean>((cb, err) => devMode.watch(cb, err), []).value === true;
    const devModeShown = useDevModeShown() === true;

    const load = useCallback(async () => {
        try {
            const list = await marketplace.installed();
            const mine = list.find((a) => a.id === appId);
            setInstalled(mine ? mine.version || "" : null);
            setUpdate(mine?.update ?? null);
        } catch { setInstalled(null); }
        try { await marketplace.app(t.sourceId, appId); setInCatalog(true); } catch { setInCatalog(false); }
        // Every template of the package (one package can bring several types).
        try {
            const types = await marketplace.accountTypes();
            setTemplates([t.templateId, ...types.filter((x) => x.package.id === appId && x.templateId !== t.templateId).map((x) => x.templateId)]);
        } catch { /* this one */ }
        try {
            const r = (await call("luna://com.palm.service.accounts/listAccounts", {})) as { results?: Account[] };
            setAccounts(r.results ?? []);
        } catch { setAccounts([]); }
    }, [appId, t.sourceId, t.templateId]);
    useEffect(() => { void load(); return () => sub.current?.cancel(); }, [load]);

    function install() {
        setError(null);
        if (needsDevMode(t, devModeOn)) { setAskDevMode(true); return; }
        setAskDevMode(false);
        setProgress({ id: appId, state: "queued", progress: 0 });
        sub.current = marketplace.install(t.sourceId, appId, (p) => {
            setProgress(p);
            if (p.state === "installed" || p.state === "failed") {
                sub.current?.cancel();
                if (p.state === "failed") {
                    if (p.errorCode === "NEEDS_DEVMODE") setAskDevMode(true);
                    else setError(p.errorText ?? "It could not be installed");
                }
                void load();
            }
        });
    }

    const mine = accounts.filter((a) => a.templateId && templates.includes(a.templateId));
    async function remove() {
        setConfirmRemove(false);
        setRemoving(true);
        setError(null);
        try {
            // Its accounts first: their data goes with them (each capability's onDelete).
            for (const a of mine) await call("luna://com.palm.service.accounts/deleteAccount", { accountId: a._id });
            await marketplace.remove(appId);
        } catch (e) { setError(errorText(e)); }
        finally { setRemoving(false); setProgress(null); void load(); }
    }

    const busy = !!progress && progress.state !== "installed" && progress.state !== "failed";
    const label = progress?.state === "downloading" ? "Downloading…" : progress?.state === "checking" ? "Checking…"
        : progress?.state === "installing" ? "Installing…" : "Waiting…";
    const isAdded = added || mine.length > 0;
    return (
        <>
            <div className="mk-actions" data-testid="connector-actions">
                {installed === undefined ? null : busy ? (
                    <div className="mk-progress" data-testid="install-progress">
                        <div className="mk-progress-bar" style={{ width: `${progress?.progress ?? 5}%` }} />
                        <span>{label}</span>
                    </div>
                ) : installed !== null ? (
                    <>
                        {isAdded ? (
                            <Button variant="affirmative" data-testid="open-accounts"
                                    onClick={() => { const l = openAccountsLaunch(); void apps.launch(l.id, l.params); }}>Open in Accounts</Button>
                        ) : (
                            <Button variant="affirmative" data-testid="set-up"
                                    onClick={() => { const l = setUpLaunch(t); void apps.launch(l.id, l.params); }}>Set up</Button>
                        )}
                        {update && inCatalog && <Button data-testid="connector-update" onClick={install}>Update to {update}</Button>}
                        <Button variant="negative" busy={removing} data-testid="connector-remove" onClick={() => setConfirmRemove(true)}>Remove</Button>
                    </>
                ) : (
                    <Button variant="affirmative" data-testid="connector-install" disabled={!inCatalog} onClick={install}>Install</Button>
                )}
            </div>
            {installed !== undefined && installed !== null && !busy && (
                <Note testId="connector-installed">
                    {t.package.preinstalled
                        ? "Installed: it comes with Phoenix. You can remove it, and install it again from here."
                        : "Installed from the catalog. It runs as a third-party connector, in Developer Mode."}
                </Note>
            )}
            {installed === null && !inCatalog && <Note>The catalog does not have its package now.</Note>}
            {installed === null && inCatalog && !askDevMode && !t.package.preinstalled && (
                <Note testId="connector-third-party">A third-party connector: it installs in Developer Mode, until Phoenix can run connectors in a sandbox.</Note>
            )}
            {askDevMode && (
                <div className="mk-card" data-testid="devmode-needed">
                    <div className="mk-card-title">Developer Mode needed</div>
                    <p>{t.title} comes from a developer outside Phoenix, with a background service of its own. Until Phoenix can run
                       such connectors in a sandbox, they install only in Developer Mode.</p>
                    {devModeShown ? (
                        <Button variant="dark" data-testid="open-devmode"
                                onClick={() => void apps.launch("org.webosphoenix.settings", { page: "devmode" })}>Developer Mode Settings</Button>
                    ) : (
                        <p className="mk-muted" data-testid="devmode-hint">Developer Mode is hidden until it is found: type the Konami code
                           (upupdowndownleftrightleftrightbastart) in Just Type, as on webOS.</p>
                    )}
                </div>
            )}
            {error && <ErrorText testId="install-error">{error}</ErrorText>}
            {progress?.state === "installed" && progress.skipped && progress.skipped.length > 0 && (
                <Note testId="install-skipped">Installed without its {progress.skipped.join(" and ")}: this device cannot run them yet.</Note>
            )}
            <Dialog open={confirmRemove} title={`Remove ${t.title}?`} onClose={() => setConfirmRemove(false)} testId="connector-remove-dialog"
                    message={[removeAccountsText(mine), t.package.preinstalled ? "You can install it again from Connections." : ""]
                        .filter(Boolean).join(" ") || "It is removed from this device."}>
                <Button variant="negative" data-testid="connector-remove-confirm" onClick={() => void remove()}>
                    {mine.length ? "Remove It and Its Accounts" : "Remove"}
                </Button>
                <Button variant="dark" onClick={() => setConfirmRemove(false)}>Cancel</Button>
            </Dialog>
        </>
    );
}
