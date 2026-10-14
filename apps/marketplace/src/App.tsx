// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Marketplace: finding, installing and updating apps, in the shape of the
// webOS 2.x App Catalog (HP never released it): a blue header with search,
// Featured / Web Apps / Apps / Classics, app pages with one Download button
// that becomes the progress bar and then Open, and the installed apps with
// their updates. Everything goes through org.webosphoenix.service.packages
// (@phoenix/luna marketplace), which checks each catalog's signature and
// each package before OSE's installer sees it.
//
//   Web Apps   popular sites with a web app manifest, installed as apps
//   Apps       web apps packaged for Phoenix (.ipk), checked against the
//              catalog's signed SHA-256
//   Classics   the original webOS apps, from the webOS Archive's App Museum
//              II and Preware feeds: add-on catalogs, off until switched on
//   Connections  the accounts Phoenix can connect to (Synergy), from the
//              catalog's account types (Connections.tsx)
//
// Each device is offered the apps that are on for its class (phone,
// tablet, desktop: its layout, followed as it changes) and the kinds of
// app the user did not hide (Catalogs > Kinds of Apps), the catalog's
// switches applied by the service (docs/APP-STORE.md 3.17): a line under
// the tabs says for which device; an app that is not offered here says why
// on its page and does not download (installed, it stays, with its updates).
//
// Launch params: {section: "updates"} (the update notification) opens the
// installed apps; {sourceId, id} opens an app's page; the Accounts app's
// "Find More..." ({common: {sceneType: "search", params: {type:
// "connector", connectorInfo}}}) opens Connections with its capabilities.

import { useCallback, useEffect, useRef, useState } from "react";
import {
    apps, localCatalog, LunaError, marketplace, systemStatus,
    type AccountType, type Availability, type CatalogSource, type InstalledApp, type InstallProgress, type LocalCatalogStatus, type MarketApp,
    type OffHere, type PendingKey, type Section,
} from "@phoenix/luna";
import { useDevModeShown, useLaunchParams } from "@phoenix/luna/react";
import { AccountTypePage, AccountTypeRow, ConnectionsFiltered, ConnectionsHome, useAccountTypes, useAddedTemplates } from "./Connections";
import { findMoreFilter, type ConnectorFilter } from "./accountTypes";
import { Screenshots } from "./Gallery";
import { Icon } from "./Icon";
import { AppMenu, BackProvider, Button, Dialog, ErrorText, Group, Note, ReleaseNotes, Row, Spinner, TextField, ToggleButton, VersionHistory,
         useBack } from "@phoenix/ui";

const errorText = (e: unknown) => (e instanceof LunaError ? e.errorText : e instanceof Error ? e.message : String(e));

type Tab = Section | "connections";

const SECTIONS: { id: Tab; label: string }[] = [
    { id: "featured", label: "Featured" },
    { id: "web", label: "Web Apps" },
    { id: "apps", label: "Apps" },
    { id: "classics", label: "Classics" },
    { id: "connections", label: "Connections" },
];

type View =
    | { kind: "home" }
    | { kind: "app"; sourceId: string; id: string; seed?: MarketApp }
    | { kind: "account"; type: AccountType }
    | { kind: "connections"; filter: ConnectorFilter }
    | { kind: "search"; query: string }
    | { kind: "installed" }
    | { kind: "settings" };

function Stars({ rating }: { rating: MarketApp["rating"] }) {
    if (!rating) return null;
    const full = Math.round(rating.stars);
    return (
        <span className="mk-stars" aria-label={`${rating.stars} of 5 stars`}>
            {"★★★★★".slice(0, full)}<span className="mk-stars-off">{"★★★★★".slice(full)}</span>
            {rating.count > 0 && <span className="mk-stars-n"> ({rating.count})</span>}
        </span>
    );
}


function kindText(a: MarketApp): string {
    if (a.kind === "pwa") return a.pwa ? `Web app · ${new URL(a.pwa.origin).host}` : "Web app";
    if (a.kind === "classic") return "Classic · App Museum II";
    if (a.kind === "preware") return "Classic · Preware";
    return "App";
}

function AppRow({ a, onOpen }: { a: MarketApp; onOpen: () => void }) {
    // A built-in app's id: "Update" when the catalog's is newer, else "Built In".
    const right = a.update ? "Update" : a.installed ? "Installed" : a.builtin ? "Built In" : a.verdict && !a.verdict.ok ? "" : "Free";
    return (
        <Row testId={`app-${a.id}`} onClick={onOpen} icon={<Icon src={[a.ownIcon, a.icon]} title={a.title || a.id} />} chevron
             title={a.title || a.id}
             subtitle={<>{a.developer.name || kindText(a)}{a.rating ? <> · <Stars rating={a.rating} /></> : null}</>}
             value={right} />
    );
}

// ---- Home: a section, its categories, its apps ---------------------------------------------

function useSources() {
    const [sources, setSources] = useState<CatalogSource[] | null>(null);
    const [pending, setPending] = useState<PendingKey[]>([]);
    const [problems, setProblems] = useState<{ id: string; errorText: string }[]>([]);
    const [version, setVersion] = useState(0);
    const reload = useCallback(async () => {
        try {
            const results = await marketplace.refresh();
            setPending(results.filter((r) => r.errorCode === "UNTRUSTED" && r.pending).map((r) => r.pending!));
            setProblems(results.filter((r) => !r.ok && r.errorCode !== "UNTRUSTED").map((r) => ({ id: r.id, errorText: r.errorText ?? "" })));
            setSources(await marketplace.sources());
        } catch (e) {
            setProblems([{ id: "", errorText: errorText(e) }]);
            setSources([]);
        }
        setVersion((v) => v + 1);
    }, []);
    useEffect(() => { void reload(); }, [reload]);
    // The lists again, without reading the catalogs again (the device's class or kinds changed).
    const bump = useCallback(() => setVersion((v) => v + 1), []);
    return { sources, pending, problems, version, reload, bump };
}

// ---- Which apps this device is offered (docs/APP-STORE.md 3.17) -------------------------------
//
// Its class follows its layout (getSystemStatus formFactor: the adaptive
// simulator as its window is resized, a docked phone): when it changes, the
// lists are read again.

function useAvailability(bump: () => void) {
    const [av, setAv] = useState<Availability | null>(null);
    const bumpRef = useRef(bump);
    bumpRef.current = bump;
    // A service from before device classes (or none) answers without them: nothing to show.
    const valid = (r: Availability | null) => (r && Array.isArray(r.deviceClasses) && Array.isArray(r.kinds) ? r : null);
    const load = useCallback(() => marketplace.availability().then((r) => setAv(valid(r)), () => setAv(null)), []);
    useEffect(() => {
        void load();
        let last: string | undefined;
        const sub = systemStatus.watch((st) => {
            const now = st.formFactor ?? "";
            if (last !== undefined && last !== now) {
                void load();
                bumpRef.current();
            }
            last = now;
        }, () => {});
        return () => sub.cancel();
    }, [load]);
    const setKind = useCallback(async (kind: string, enabled: boolean) => {
        try { setAv(valid(await marketplace.setKind(kind, enabled))); } finally { bumpRef.current(); }
    }, []);
    return { av, setKind };
}
type AvailabilityCtx = ReturnType<typeof useAvailability>;

const className = (av: Availability | null) => av?.deviceClasses.find((c) => c.id === av.deviceClass)?.name ?? "";
const kindName = (av: Availability | null, id?: string) => av?.kinds.find((k) => k.id === id)?.name ?? "";

// "Apps for this phone", and the kinds hidden here: under the tabs.
function DeviceLine({ av, open }: { av: Availability | null; open: () => void }) {
    if (!av || !av.deviceClass) return null;
    const hidden = av.kinds.filter((k) => k.hidden);
    return (
        <div className="mk-device" data-testid="device-line">
            <span>Apps for this {className(av).toLowerCase()}{hidden.length ? ` · ${hidden.map((k) => k.name).join(", ")} hidden` : ""}</span>
            <button type="button" data-testid="device-settings" onClick={open}>Kinds of Apps</button>
        </div>
    );
}

function TrustCard({ pending, onDone, bare }: { pending: PendingKey; onDone: () => void; bare?: boolean }) {
    const [busy, setBusy] = useState(false);
    return (
        <div className={bare ? "mk-trust" : "mk-card"} data-testid="trust-card">
            {!bare && <div className="mk-card-title">Check this catalog</div>}
            <p>Before Marketplace uses <b>{pending.name}</b> ({pending.url}), make sure its key is the one its owners publish.
               From then on only catalogs signed with this key are taken.</p>
            <div className="mk-fingerprint" data-testid="trust-fingerprint">{pending.fingerprint}</div>
            <Button variant="affirmative" busy={busy} data-testid="trust-confirm"
                    onClick={async () => { setBusy(true); try { await marketplace.trustSource(pending); } finally { setBusy(false); onDone(); } }}>
                Trust This Catalog
            </Button>
        </div>
    );
}

// ---- The catalog on this computer (the simulator only) ----------------------------------------
//
// In phoenix-sim the Phoenix Marketplace's catalog runs on the same
// computer (server/marketplace), and the simulator starts it when asked
// (org.webosphoenix.simulator; its Services menu does the same). Anywhere
// else the watch fails and nothing is offered. Once it runs, from here or
// from the menu, the catalogs are read again.

function useLocalCatalog(reload: () => void) {
    const [status, setStatus] = useState<LocalCatalogStatus | null>(null);
    const last = useRef<string | null>(null);
    const startedHere = useRef(false);
    const reloadRef = useRef(reload);
    reloadRef.current = reload;
    useEffect(() => {
        const sub = localCatalog.watch((s) => {
            setStatus(s);
            if (s.state === "running" && last.current !== null && last.current !== "running" && !startedHere.current)
                reloadRef.current();
            last.current = s.state;
        }, () => setStatus(null));
        return () => sub.cancel();
    }, []);
    const start = useCallback(async () => {
        startedHere.current = true;
        try {
            await localCatalog.start();
            reloadRef.current();
        } catch { /* the watch has the reason */ }
        finally { startedHere.current = false; }
    }, []);
    return { status, start };
}

const capitalized = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

function LocalCatalog({ local }: { local: ReturnType<typeof useLocalCatalog> }) {
    const s = local.status!;
    const starting = s.state === "starting";
    return (
        <>
            <p className="mk-muted">It runs on this computer for now, and the simulator can start it.</p>
            {s.state === "failed" && <ErrorText testId="local-catalog-error">{capitalized(s.error.split("\n")[0].replace(/:$/, ""))}</ErrorText>}
            <Button variant="affirmative" busy={starting} data-testid="catalog-start" onClick={() => void local.start()}>
                {!starting ? "Start Local Catalog" : s.settingUp ? "Setting Up…" : "Starting…"}
            </Button>
            {starting && s.settingUp && <p className="mk-muted" data-testid="catalog-setting-up">The first time it sets itself up, which takes a minute.</p>}
        </>
    );
}

function Home({ section, setSection, open, ctx, connections, avail, openSettings }: {
    section: Tab; setSection: (s: Tab) => void; open: (a: MarketApp) => void; ctx: ReturnType<typeof useSources>;
    connections: { types: AccountType[] | null; added: Set<string>; open: (t: AccountType) => void };
    avail: AvailabilityCtx; openSettings: () => void;
}) {
    const [category, setCategory] = useState<string | null>(null);
    const [list, setList] = useState<MarketApp[] | null>(null);
    // The whole section not offered here (Classics with classic apps hidden, or off on this class).
    const [sectionOff, setSectionOff] = useState<OffHere | null>(null);
    const [categories, setCategories] = useState<string[]>([]);
    const [more, setMore] = useState(false);
    const [page, setPage] = useState(0);
    const [error, setError] = useState<string | null>(null);
    const classicsOn = !!ctx.sources?.some((s) => (s.kind === "appmuseum" || s.kind === "preware") && s.enabled);

    useEffect(() => { setCategory(null); }, [section]);
    useEffect(() => {
        let live = true;
        setList(null);
        setPage(0);
        setError(null);
        setSectionOff(null);
        // Connections has its own list (Connections.tsx).
        if (section === "connections") { setCategories([]); setMore(false); return; }
        marketplace.browse(section, category ?? undefined, 0).then((r) => {
            if (!live) return;
            setList(r.apps);
            setCategories(r.categories);
            setMore(r.more);
            setSectionOff(r.offHere ?? null);
        }, (e) => { if (live) { setList([]); setError(errorText(e)); } });
        return () => { live = false; };
    }, [section, category, ctx.version]);

    async function loadMore() {
        if (section === "connections") return;
        const next = page + 1;
        const r = await marketplace.browse(section, category ?? undefined, next);
        setList((l) => [...(l ?? []), ...r.apps]);
        setMore(r.more);
        setPage(next);
    }

    const phoenix = ctx.sources?.find((s) => s.kind === "phoenix" && s.builtin);
    const local = useLocalCatalog(ctx.reload);
    return (
        <>
            <div className="mk-tabs" role="tablist">
                {SECTIONS.map((s) => (
                    <button key={s.id} type="button" role="tab" aria-selected={section === s.id} className={section === s.id ? "on" : ""}
                            data-testid={`tab-${s.id}`} onClick={() => setSection(s.id)}>{s.label}</button>
                ))}
            </div>
            <DeviceLine av={avail.av} open={openSettings} />
            {ctx.pending.map((p) => <TrustCard key={p.url} pending={p} onDone={() => void ctx.reload()} />)}
            {section !== "classics" && phoenix && phoenix.enabled && phoenix.error && phoenix.error.errorCode !== "UNTRUSTED" && (
                <div className="mk-card" data-testid="catalog-offline">
                    <div className="mk-card-title">Can't reach {phoenix.name}</div>
                    <p>{phoenix.error.errorText}</p>
                    {local.status
                        ? <LocalCatalog local={local} />
                        : <p className="mk-muted">It runs on this computer for now: start it with <code>server/marketplace/bin/serve.sh</code>.</p>}
                    <Button onClick={() => void ctx.reload()} data-testid="catalog-retry">Try Again</Button>
                </div>
            )}
            {section === "classics" && sectionOff && (
                <div className="mk-card" data-testid="classics-off-here">
                    <div className="mk-card-title">The original webOS apps</div>
                    <p>{sectionOff.text}.</p>
                    {sectionOff.reason === "hidden" && (
                        <Button variant="affirmative" data-testid="classics-show" onClick={() => void avail.setKind("legacy", true)}>
                            Show Classic webOS Apps
                        </Button>
                    )}
                </div>
            )}
            {section === "classics" && !classicsOn && !sectionOff && (
                <div className="mk-card" data-testid="classics-off">
                    <div className="mk-card-title">The original webOS apps</div>
                    <p>The webOS Archive keeps the HP App Catalog's apps in its App Museum II, and the homebrew of the Preware days.
                       Phoenix can run many of the Enyo apps; Mojo apps need a framework Palm never open-sourced.</p>
                    <p className="mk-muted">They come as they were in 2011, unchecked by Phoenix, for preservation.</p>
                    <Button variant="affirmative" data-testid="classics-on" onClick={async () => {
                        await marketplace.setSource("appmuseum", true);
                        void ctx.reload();
                    }}>Show the App Museum</Button>
                </div>
            )}
            {section === "connections" && <ConnectionsHome {...connections} />}
            {categories.length > 0 && (
                <div className="mk-cats">
                    <button type="button" className={category === null ? "on" : ""} onClick={() => setCategory(null)}>All</button>
                    {categories.map((c) => (
                        <button key={c} type="button" className={category === c ? "on" : ""} data-testid={`cat-${c}`} onClick={() => setCategory(c)}>{c}</button>
                    ))}
                </div>
            )}
            {section !== "connections" && !sectionOff && (
                <Group>
                    {list === null ? <Row title="Loading…"><Spinner /></Row>
                        : list.length === 0 ? <Row title={error ? "Could not load" : "Nothing here yet"} subtitle={error ?? undefined} />
                        : list.map((a) => <AppRow key={a.sourceId + a.id} a={a} onOpen={() => open(a)} />)}
                </Group>
            )}
            {more && <Button onClick={() => void loadMore()} data-testid="more">More</Button>}
        </>
    );
}

// ---- An app's page -------------------------------------------------------------------------

function AppPage({ sourceId, id, seed, onRemoved, catalogVersion, av }: {
    sourceId: string; id: string; seed?: MarketApp; onRemoved: () => void;
    /** This device's class and the kinds' names. */
    av: Availability | null;
    /** Changes each time the catalogs were read again: the page shows the new entry (a page opened by a launch shows the entry kept from before until the refresh comes). */
    catalogVersion: number;
}) {
    const [app, setApp] = useState<MarketApp | null>(seed ?? null);
    const [progress, setProgress] = useState<InstallProgress | null>(null);
    const [error, setError] = useState<string | null>(null);
    // Reading the entry failed: kept apart from what Download or Remove said, so a read
    // that works (the catalogs read again) takes it away. A page opened by a launch looks
    // before the Marketplace has read the catalogs: an app published since is not there yet.
    const [loadError, setLoadError] = useState<string | null>(null);
    const [confirmRemove, setConfirmRemove] = useState(false);
    const sub = useRef<{ cancel(): void } | null>(null);
    // The way to Developer Mode once Just Type's Konami code revealed it
    // (as webOS users enabled it); before, how to find it.
    const devModeShown = useDevModeShown() === true;

    const load = useCallback(() => {
        marketplace.app(sourceId, id).then((a) => {
            setLoadError(null);
            setApp((old) => ({
                // The App Museum's details lack the summary's fields.
                ...a, title: a.title || old?.title || "", icon: a.icon || old?.icon || "", summary: a.summary || old?.summary || "",
                developer: a.developer.name ? a.developer : old?.developer ?? a.developer, rating: a.rating ?? old?.rating ?? null,
            }));
        }, (e) => setLoadError(errorText(e)));
    }, [sourceId, id]);
    useEffect(() => { load(); return () => sub.current?.cancel(); }, [load]);
    // Read again once the catalogs are (an install going on is not interrupted).
    const firstVersion = useRef(catalogVersion);
    useEffect(() => { if (catalogVersion !== firstVersion.current) load(); }, [catalogVersion, load]);

    function install() {
        setError(null);
        setProgress({ id, state: "queued", progress: 0 });
        sub.current = marketplace.install(sourceId, id, (p) => {
            setProgress(p);
            if (p.state === "installed" || p.state === "failed") {
                sub.current?.cancel();
                if (p.state === "failed") setError(p.errorText ?? "It could not be installed");
                load();
            }
        });
    }
    async function remove() {
        setConfirmRemove(false);
        try {
            await marketplace.remove(app?.installed ? (app.appId ?? app.id) : id);
            load();
            onRemoved();
        } catch (e) { setError(errorText(e)); }
    }

    if (!app) return loadError ? <ErrorText>{loadError}</ErrorText> : <Row title="Loading…"><Spinner /></Row>;
    const busy = !!progress && progress.state !== "installed" && progress.state !== "failed";
    const appId = progress?.appId ?? app.appId ?? app.id;
    const label = progress?.state === "downloading" ? "Downloading…" : progress?.state === "checking" ? "Checking…"
        : progress?.state === "installing" ? "Installing…" : progress?.state === "queued" ? "Waiting…" : "";
    // A built-in app's id (docs/APP-STORE.md "Updating a built-in app"): the
    // device's own version, the update in its place, or only Open.
    const builtin = app.builtin;
    const builtinOnly = !!builtin && !app.installed && !app.update;
    // Not offered on this device (docs/APP-STORE.md 3.17): it does not
    // download; installed, it stays, with its updates.
    const offHere = app.offHere ?? null;
    const offered = av?.deviceClasses.filter((c) => !app.deviceClasses || app.deviceClasses.includes(c.id)).map((c) => c.name) ?? [];
    return (
        <div className="mk-app" data-testid="app-page">
            <div className="mk-app-head">
                <Icon src={[app.ownIcon, app.icon]} size={64} title={app.title || app.id} />
                <div>
                    <div className="mk-app-title" data-testid="app-title">{app.title || app.id}</div>
                    <div className="mk-muted">{app.developer.name || kindText(app)}</div>
                    <Stars rating={app.rating} />
                </div>
            </div>
            <div className="mk-actions">
                {busy ? (
                    <div className="mk-progress" data-testid="install-progress">
                        <div className="mk-progress-bar" style={{ width: `${progress?.progress ?? 5}%` }} />
                        <span>{label}</span>
                    </div>
                ) : app.installed && !app.update ? (
                    <>
                        <Button variant="affirmative" data-testid="open-app" onClick={() => void apps.launch(appId)}>Open</Button>
                        <Button variant="negative" data-testid="remove-app" onClick={() => setConfirmRemove(true)}>
                            {builtin?.replaced ? "Remove Update" : "Remove"}
                        </Button>
                    </>
                ) : builtinOnly ? (
                    <Button variant="affirmative" data-testid="open-app" onClick={() => void apps.launch(appId)}>Open</Button>
                ) : (
                    <Button variant="affirmative" data-testid="install-app" disabled={(!!app.verdict && !app.verdict.ok) || (!!offHere && !app.installed)}
                            onClick={install}>
                        {app.update ? `Update to ${app.update}` : app.kind === "pwa" ? "Add to Launcher" : "Download"}
                    </Button>
                )}
            </div>
            {app.verdict && !app.verdict.ok && <Note>{app.verdict.text}</Note>}
            {offHere && (
                <Note testId="off-here">
                    {offHere.text}.{app.installed ? " It stays installed on this device, and gets its updates." : ""}
                    {offHere.reason === "hidden" ? " Kinds of Apps in Catalogs shows them again." : ""}
                </Note>
            )}
            {builtin && (
                <Note testId="builtin-note">
                    {builtin.replaced
                        ? `This version takes the place of the ${app.title} this device came with (${builtin.version}). Removing the update brings that version back.`
                        : app.update
                            ? `This device came with ${app.title} ${builtin.version}. ${app.update} installs in its place; removing it later brings back ${builtin.version}.`
                            : `Built into this device (${builtin.version}), the same as or newer than this one.`}
                </Note>
            )}
            {(error ?? loadError) && <ErrorText testId="install-error">{error ?? loadError}</ErrorText>}
            {progress?.errorCode === "NEEDS_DEVMODE" && devModeShown && (
                <Button variant="dark" data-testid="open-devmode"
                        onClick={() => void apps.launch("org.webosphoenix.settings", { page: "devmode" })}>Developer Mode Settings</Button>
            )}
            {progress?.errorCode === "NEEDS_DEVMODE" && !devModeShown && (
                <Note testId="devmode-hint">
                    Developer Mode is hidden until it is found: type the Konami code
                    (upupdowndownleftrightleftrightbastart) in Just Type, as on webOS.
                </Note>
            )}
            {progress?.state === "installed" && progress.skipped && progress.skipped.length > 0 && (
                <Note testId="install-skipped">Installed without its {progress.skipped.join(" and ")}: this device cannot run them yet.</Note>
            )}
            <Screenshots urls={app.screenshots} />
            {(app.description || app.summary) && <p className="mk-desc">{app.description || app.summary}</p>}
            {/* Its update log (docs/APP-STORE.md "Update logs"): the listed version's notes, then
                every version's; an app without a log has neither. */}
            {app.whatsNew && (
                <Group label="What's New">
                    <ReleaseNotes notes={app.whatsNew} testId="whats-new" />
                </Group>
            )}
            {app.versionHistory && app.versionHistory.length > 0 && (
                <Group label="Version History">
                    <VersionHistory versions={app.versionHistory} testId="version-history" />
                </Group>
            )}
            <Group label="Details">
                <Row title="Kind" value={kindText(app)} />
                {app.appKind && kindName(av, app.appKind) && <Row title="Kind of App" value={kindName(av, app.appKind)} testId="app-kind" />}
                {av && offered.length > 0 && (
                    <Row title="Offered On" value={offered.length === av.deviceClasses.length ? "Every device" : offered.join(", ")} testId="app-classes" />
                )}
                {app.version && <Row title="Version" value={app.version} />}
                {app.installed && <Row title="Installed" value={app.installed.version || "Yes"} />}
                {builtin && <Row title="Built in" value={builtin.version || "Yes"} />}
                {app.license && <Row title="License" value={app.license} />}
                {app.categories.length > 0 && <Row title="Category" value={app.categories.join(", ")} />}
                {app.devices && app.devices.length > 0 && <Row title="Made for" value={app.devices.join(", ")} />}
                {app.homepage && <Row title="Website" value={new URL(app.homepage).host} onClick={() => void apps.open(app.homepage)} />}
                {app.source && <Row title="Source code" value={new URL(app.source).host} testId="app-source" onClick={() => void apps.open(app.source!)} />}
                {app.releaseNotesUrl && (
                    <Row title="Release notes" value={new URL(app.releaseNotesUrl).host} testId="app-release-notes"
                         onClick={() => void apps.open(app.releaseNotesUrl!)} />
                )}
                {app.donation && <Row title="Support the developer" chevron onClick={() => void apps.open(app.donation)} />}
            </Group>
            {app.kind === "pwa" && <Note>A web app opens the site in its own card, with its own launcher icon. The site keeps your data.</Note>}
            {(app.kind === "classic" || app.kind === "preware") && <Note>From the webOS Archive, as it was. Phoenix checks the package before installing it.</Note>}
            <Dialog open={confirmRemove} title={builtin?.replaced ? `Remove the ${app.title} update?` : `Remove ${app.title}?`}
                    onClose={() => setConfirmRemove(false)} testId="remove-dialog"
                    message={builtin?.replaced ? `${app.title} goes back to ${builtin.version}, the version this device came with. Its data stays.`
                                                : "The app and its data on this device are removed."}>
                <Button variant="negative" data-testid="remove-confirm" onClick={() => void remove()}>Remove</Button>
                <Button variant="dark" onClick={() => setConfirmRemove(false)}>Cancel</Button>
            </Dialog>
        </div>
    );
}

// ---- Installed apps and updates --------------------------------------------------------------

function Installed({ open, av }: { open: (sourceId: string, id: string) => void; av: Availability | null }) {
    const [list, setList] = useState<InstalledApp[] | null>(null);
    const [busy, setBusy] = useState(false);
    const [result, setResult] = useState<string | null>(null);
    const load = () => marketplace.installed().then(setList, () => setList([]));
    useEffect(() => { void load(); }, []);
    const updates = list?.filter((a) => a.update) ?? [];
    const row = (a: InstalledApp) => (
        <Row key={a.id} testId={`installed-${a.id}`} icon={<Icon src={[a.icon, a.catalogIcon]} title={a.title} />} chevron title={a.title}
             subtitle={(a.update ? `${a.version} → ${a.update}` : a.version) + (a.builtin ? ` · in place of the built-in ${a.builtin}` : "")
                       // Installed, but not offered here now: it stays (docs/APP-STORE.md 3.17).
                       + (a.offHere ? (a.offHere.reason === "hidden" ? " · its kind is hidden here"
                                                                       : ` · not offered on this ${className(av).toLowerCase() || "device"}`) : "")}
             value={a.update ? "Update" : ""}
             onClick={() => open(a.sourceId, a.catalogId)} />
    );
    return (
        <>
            {updates.length > 0 && (
                <Button variant="affirmative" busy={busy} data-testid="update-all" onClick={async () => {
                    setBusy(true);
                    try {
                        const r = await marketplace.updateAll();
                        setResult(r.failed.length ? `Updated ${r.updated.length}; ${r.failed.length} failed: ${r.failed.map((f) => f.errorText).join("; ")}`
                                                  : `Updated ${r.updated.length} app${r.updated.length === 1 ? "" : "s"}.`);
                    } finally { setBusy(false); void load(); }
                }}>Update All ({updates.length})</Button>
            )}
            {result && <Note>{result}</Note>}
            {/* Each update with what it brings (its What's New, when the catalog has it). */}
            {updates.length > 0 && (
                <Group label="Updates">
                    {updates.map((a) => (
                        <div key={a.id} className="mk-update" data-testid={`update-${a.id}`}>
                            {row(a)}
                            {a.whatsNew && <ReleaseNotes notes={a.whatsNew} testId={`update-notes-${a.id}`} />}
                        </div>
                    ))}
                </Group>
            )}
            {(list === null || list.length > updates.length || list.length === 0) && (
                <Group label="Installed from the Marketplace">
                    {list === null ? <Row title="Loading…"><Spinner /></Row>
                        : list.length === 0 ? <Row title="Nothing yet" />
                        : list.filter((a) => !a.update).map(row)}
                </Group>
            )}
        </>
    );
}

// ---- Settings: the catalogs --------------------------------------------------------------------

function Settings({ ctx, avail }: { ctx: ReturnType<typeof useSources>; avail: AvailabilityCtx }) {
    const [url, setUrl] = useState("");
    const av = avail.av;
    const plural = className(av).toLowerCase() ? `${className(av).toLowerCase()}s` : "this device";
    const [checking, setChecking] = useState(false);
    const [pending, setPending] = useState<PendingKey | null>(null);
    const [error, setError] = useState<string | null>(null);
    const sourceKind = { phoenix: "Phoenix catalog", appmuseum: "App Museum II", preware: "Preware feed" } as const;
    return (
        <>
            {/* Which apps this device is offered (docs/APP-STORE.md 3.17): its class, from its
                layout, and the kinds the user shows or hides here. */}
            {av && (
                <>
                    <Group label="This Device">
                        <Row title="Kind of device" value={className(av) || "Not known yet"} testId="device-class"
                             subtitle="From its layout: the Marketplace offers the apps made for it" />
                    </Group>
                    <Group label="Kinds of Apps">
                        {av.kinds.map((k) => (
                            <Row key={k.id} testId={`kind-${k.id}`} title={k.name}
                                 subtitle={k.offByCatalog ? `The Marketplace does not offer these on ${plural}` : k.about}>
                                <ToggleButton value={!k.hidden} label={k.name} testId={`kind-toggle-${k.id}`}
                                              onChange={(on) => void avail.setKind(k.id, on)} />
                            </Row>
                        ))}
                    </Group>
                    <Note>A kind turned off here is not listed or offered on this device. Apps you installed stay, with their updates.</Note>
                </>
            )}
            <Group label="Catalogs">
                {(ctx.sources ?? []).map((s) => (
                    <Row key={s.id} testId={`source-${s.id}`} title={s.name}
                         subtitle={s.error ? s.error.errorText : s.fingerprint ? `Key ${s.fingerprint}` : `${sourceKind[s.kind]} · ${s.url}`}>
                        <ToggleButton value={s.enabled} label={s.name} testId={`source-toggle-${s.id}`}
                                      onChange={async (on) => { await marketplace.setSource(s.id, on); void ctx.reload(); }} />
                    </Row>
                ))}
            </Group>
            <Group label="Add a catalog">
                <TextField label="Address" value={url} onChange={setUrl} placeholder="https://apps.example.org/v1/" testId="source-url" />
            </Group>
            {error && <ErrorText>{error}</ErrorText>}
            <Button disabled={!url.trim() || checking} busy={checking} data-testid="source-add" onClick={async () => {
                setChecking(true);
                setError(null);
                try { setPending(await marketplace.addSource(url.trim())); } catch (e) { setError(errorText(e)); } finally { setChecking(false); }
            }}>Add Catalog</Button>
            <Note>A Phoenix catalog is signed; you check its key once, then only catalogs signed with it are taken.</Note>
            <Dialog open={!!pending} title="Check this catalog" onClose={() => setPending(null)} testId="source-dialog">
                {pending && <TrustCard bare pending={pending} onDone={() => { setPending(null); setUrl(""); void ctx.reload(); }} />}
                <Button variant="dark" onClick={() => setPending(null)}>Cancel</Button>
            </Dialog>
        </>
    );
}

// ---- The app ------------------------------------------------------------------------------------

function Marketplace() {
    const params = useLaunchParams<{ section?: string; sourceId?: string; id?: string; common?: unknown }>();
    const [stack, setStack] = useState<View[]>([{ kind: "home" }]);
    const [section, setSection] = useState<Tab>("featured");
    const [query, setQuery] = useState("");
    const [results, setResults] = useState<{ apps: MarketApp[]; accountTypes: AccountType[] } | null>(null);
    const ctx = useSources();
    const avail = useAvailability(ctx.bump);
    const accountTypes = useAccountTypes(ctx.version);
    const added = useAddedTemplates();
    const view = stack[stack.length - 1];
    const main = useRef<HTMLElement>(null);
    // Each view starts at its top.
    useEffect(() => { main.current?.scrollTo(0, 0); }, [stack.length, view.kind]);
    const push = (v: View) => setStack((s) => [...s, v]);
    const back = () => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s));
    useBack(() => { back(); return true; }, stack.length > 1);

    useEffect(() => {
        if (params?.section === "updates") setStack([{ kind: "home" }, { kind: "installed" }]);
        else if (params?.sourceId && params?.id) setStack([{ kind: "home" }, { kind: "app", sourceId: params.sourceId, id: params.id }]);
    }, [params?.section, params?.sourceId, params?.id]);
    // "Find More..." from the Accounts app, on each launch and relaunch:
    // under it, Connections with all of them.
    useEffect(() => {
        const filter = findMoreFilter(params);
        if (!filter) return;
        setSection("connections");
        setStack([{ kind: "home" }, { kind: "connections", filter }]);
    }, [params]);

    async function search() {
        const q = query.trim();
        if (!q) return;
        setResults(null);
        push({ kind: "search", query: q });
        try { setResults(await marketplace.searchAll(q)); } catch { setResults({ apps: [], accountTypes: [] }); }
    }
    const openApp = (a: MarketApp) => push({ kind: "app", sourceId: a.sourceId, id: a.id, seed: a });
    const openType = (t: AccountType) => push({ kind: "account", type: t });

    return (
        <div className="mk-root">
            <AppMenu items={[
                { label: "Installed Apps", onSelect: () => push({ kind: "installed" }) },
                { label: "Catalogs", onSelect: () => push({ kind: "settings" }) },
            ]} />
            <header className="mk-header">
                {stack.length > 1 && <button type="button" className="mk-back" aria-label="Back" data-testid="back" onClick={back} />}
                <div className="mk-title">Marketplace</div>
                <form className="mk-search" onSubmit={(e) => { e.preventDefault(); void search(); }}>
                    <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search" aria-label="Search" data-testid="search" />
                </form>
            </header>
            <main className="mk-main" ref={main}>
                {view.kind === "home" && <Home section={section} setSection={setSection} open={openApp} ctx={ctx} avail={avail}
                                               openSettings={() => push({ kind: "settings" })}
                                               connections={{ types: accountTypes, added, open: openType }} />}
                {view.kind === "connections" && (
                    <ConnectionsFiltered filter={view.filter} types={accountTypes} added={added} open={openType}
                                         showAll={() => { setSection("connections"); setStack([{ kind: "home" }]); }} />
                )}
                {view.kind === "account" && <AccountTypePage key={view.type.templateId} t={view.type} added={added.has(view.type.templateId)} />}
                {view.kind === "app" && <AppPage key={view.sourceId + view.id} sourceId={view.sourceId} id={view.id} seed={view.seed}
                                                 onRemoved={() => void ctx.reload()} catalogVersion={ctx.version} av={avail.av} />}
                {view.kind === "search" && (
                    <>
                        {(results === null || results.apps.length > 0 || results.accountTypes.length === 0) && (
                            <Group label={`Results for "${view.query}"`}>
                                {results === null ? <Row title="Searching…"><Spinner /></Row>
                                    : results.apps.length === 0 ? <Row title="Nothing found" />
                                    : results.apps.map((a) => <AppRow key={a.sourceId + a.id} a={a} onOpen={() => openApp(a)} />)}
                            </Group>
                        )}
                        {results && results.accountTypes.length > 0 && (
                            <Group label={results.apps.length ? "Connections" : `Connections for "${view.query}"`}>
                                <div data-testid="search-connections">
                                    {results.accountTypes.map((t) => (
                                        <AccountTypeRow key={t.templateId} t={t} added={added.has(t.templateId)} onOpen={() => openType(t)} />
                                    ))}
                                </div>
                            </Group>
                        )}
                    </>
                )}
                {view.kind === "installed" && <Installed open={(sourceId, id) => push({ kind: "app", sourceId, id })} av={avail.av} />}
                {view.kind === "settings" && <Settings ctx={ctx} avail={avail} />}
            </main>
            {view.kind === "home" && (
                <nav className="mk-footer">
                    <button type="button" data-testid="nav-installed" onClick={() => push({ kind: "installed" })}>Installed</button>
                    <button type="button" data-testid="nav-settings" onClick={() => push({ kind: "settings" })}>Catalogs</button>
                </nav>
            )}
        </div>
    );
}

export function App() {
    return (
        <BackProvider>
            <Marketplace />
        </BackProvider>
    );
}
