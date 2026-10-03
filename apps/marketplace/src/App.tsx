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
//
// Launch params: {section: "updates"} (the update notification) opens the
// installed apps; {sourceId, id} opens an app's page.

import { useCallback, useEffect, useRef, useState } from "react";
import {
    apps, LunaError, marketplace,
    type CatalogSource, type InstalledApp, type InstallProgress, type MarketApp, type PendingKey, type Section,
} from "@phoenix/luna";
import { useLaunchParams } from "@phoenix/luna/react";
import { Screenshots } from "./Gallery";
import { AppMenu, BackProvider, Button, Dialog, ErrorText, Group, Note, Row, Spinner, TextField, ToggleButton, useBack } from "@phoenix/ui";

const errorText = (e: unknown) => (e instanceof LunaError ? e.errorText : e instanceof Error ? e.message : String(e));

const SECTIONS: { id: Section; label: string }[] = [
    { id: "featured", label: "Featured" },
    { id: "web", label: "Web Apps" },
    { id: "apps", label: "Apps" },
    { id: "classics", label: "Classics" },
];

type View =
    | { kind: "home" }
    | { kind: "app"; sourceId: string; id: string; seed?: MarketApp }
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

function Icon({ src, size = 48 }: { src?: string; size?: number }) {
    const [broken, setBroken] = useState(false);
    return (
        <span className="mk-icon" style={{ width: size, height: size }}>
            {src && !broken ? <img src={src} alt="" width={size} height={size} draggable={false} onError={() => setBroken(true)} /> : null}
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
    const right = a.update ? "Update" : a.installed ? "Installed" : a.verdict && !a.verdict.ok ? "" : "Free";
    return (
        <Row testId={`app-${a.id}`} onClick={onOpen} icon={<Icon src={a.icon} />} chevron
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
    return { sources, pending, problems, version, reload };
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

function Home({ section, setSection, open, ctx }: {
    section: Section; setSection: (s: Section) => void; open: (a: MarketApp) => void; ctx: ReturnType<typeof useSources>;
}) {
    const [category, setCategory] = useState<string | null>(null);
    const [list, setList] = useState<MarketApp[] | null>(null);
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
        marketplace.browse(section, category ?? undefined, 0).then((r) => {
            if (!live) return;
            setList(r.apps);
            setCategories(r.categories);
            setMore(r.more);
        }, (e) => { if (live) { setList([]); setError(errorText(e)); } });
        return () => { live = false; };
    }, [section, category, ctx.version]);

    async function loadMore() {
        const next = page + 1;
        const r = await marketplace.browse(section, category ?? undefined, next);
        setList((l) => [...(l ?? []), ...r.apps]);
        setMore(r.more);
        setPage(next);
    }

    const phoenix = ctx.sources?.find((s) => s.kind === "phoenix" && s.builtin);
    return (
        <>
            <div className="mk-tabs" role="tablist">
                {SECTIONS.map((s) => (
                    <button key={s.id} type="button" role="tab" aria-selected={section === s.id} className={section === s.id ? "on" : ""}
                            data-testid={`tab-${s.id}`} onClick={() => setSection(s.id)}>{s.label}</button>
                ))}
            </div>
            {ctx.pending.map((p) => <TrustCard key={p.url} pending={p} onDone={() => void ctx.reload()} />)}
            {section !== "classics" && phoenix && phoenix.enabled && phoenix.error && phoenix.error.errorCode !== "UNTRUSTED" && (
                <div className="mk-card" data-testid="catalog-offline">
                    <div className="mk-card-title">Can't reach {phoenix.name}</div>
                    <p>{phoenix.error.errorText}</p>
                    <p className="mk-muted">It runs on this computer for now: start it with <code>server/marketplace/bin/serve.sh</code>.</p>
                    <Button onClick={() => void ctx.reload()} data-testid="catalog-retry">Try Again</Button>
                </div>
            )}
            {section === "classics" && !classicsOn && (
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
            {categories.length > 0 && (
                <div className="mk-cats">
                    <button type="button" className={category === null ? "on" : ""} onClick={() => setCategory(null)}>All</button>
                    {categories.map((c) => (
                        <button key={c} type="button" className={category === c ? "on" : ""} data-testid={`cat-${c}`} onClick={() => setCategory(c)}>{c}</button>
                    ))}
                </div>
            )}
            <Group>
                {list === null ? <Row title="Loading…"><Spinner /></Row>
                    : list.length === 0 ? <Row title={error ? "Could not load" : "Nothing here yet"} subtitle={error ?? undefined} />
                    : list.map((a) => <AppRow key={a.sourceId + a.id} a={a} onOpen={() => open(a)} />)}
            </Group>
            {more && <Button onClick={() => void loadMore()} data-testid="more">More</Button>}
        </>
    );
}

// ---- An app's page -------------------------------------------------------------------------

function AppPage({ sourceId, id, seed, onRemoved }: { sourceId: string; id: string; seed?: MarketApp; onRemoved: () => void }) {
    const [app, setApp] = useState<MarketApp | null>(seed ?? null);
    const [progress, setProgress] = useState<InstallProgress | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [confirmRemove, setConfirmRemove] = useState(false);
    const sub = useRef<{ cancel(): void } | null>(null);

    const load = useCallback(() => {
        marketplace.app(sourceId, id).then((a) => setApp((old) => ({
            // The App Museum's details lack the summary's fields.
            ...a, title: a.title || old?.title || "", icon: a.icon || old?.icon || "", summary: a.summary || old?.summary || "",
            developer: a.developer.name ? a.developer : old?.developer ?? a.developer, rating: a.rating ?? old?.rating ?? null,
        })), (e) => setError(errorText(e)));
    }, [sourceId, id]);
    useEffect(() => { load(); return () => sub.current?.cancel(); }, [load]);

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

    if (!app) return error ? <ErrorText>{error}</ErrorText> : <Row title="Loading…"><Spinner /></Row>;
    const busy = !!progress && progress.state !== "installed" && progress.state !== "failed";
    const appId = progress?.appId ?? app.appId ?? app.id;
    const label = progress?.state === "downloading" ? "Downloading…" : progress?.state === "checking" ? "Checking…"
        : progress?.state === "installing" ? "Installing…" : progress?.state === "queued" ? "Waiting…" : "";
    return (
        <div className="mk-app" data-testid="app-page">
            <div className="mk-app-head">
                <Icon src={app.icon} size={64} />
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
                        <Button variant="negative" data-testid="remove-app" onClick={() => setConfirmRemove(true)}>Remove</Button>
                    </>
                ) : (
                    <Button variant="affirmative" data-testid="install-app" disabled={!!app.verdict && !app.verdict.ok} onClick={install}>
                        {app.update ? `Update to ${app.update}` : app.kind === "pwa" ? "Add to Launcher" : "Download"}
                    </Button>
                )}
            </div>
            {app.verdict && !app.verdict.ok && <Note>{app.verdict.text}</Note>}
            {error && <ErrorText testId="install-error">{error}</ErrorText>}
            {progress?.errorCode === "NEEDS_DEVMODE" && (
                <Button variant="dark" data-testid="open-devmode"
                        onClick={() => void apps.launch("org.webosphoenix.settings", { page: "devmode" })}>Developer Mode Settings</Button>
            )}
            {progress?.state === "installed" && progress.skipped && progress.skipped.length > 0 && (
                <Note testId="install-skipped">Installed without its {progress.skipped.join(" and ")}: this device cannot run them yet.</Note>
            )}
            <Screenshots urls={app.screenshots} />
            {(app.description || app.summary) && <p className="mk-desc">{app.description || app.summary}</p>}
            <Group label="Details">
                <Row title="Kind" value={kindText(app)} />
                {app.version && <Row title="Version" value={app.version} />}
                {app.installed && <Row title="Installed" value={app.installed.version || "Yes"} />}
                {app.license && <Row title="License" value={app.license} />}
                {app.categories.length > 0 && <Row title="Category" value={app.categories.join(", ")} />}
                {app.devices && app.devices.length > 0 && <Row title="Made for" value={app.devices.join(", ")} />}
                {app.homepage && <Row title="Website" value={new URL(app.homepage).host} onClick={() => void apps.open(app.homepage)} />}
                {app.donation && <Row title="Support the developer" chevron onClick={() => void apps.open(app.donation)} />}
            </Group>
            {app.kind === "pwa" && <Note>A web app opens the site in its own card, with its own launcher icon. The site keeps your data.</Note>}
            {(app.kind === "classic" || app.kind === "preware") && <Note>From the webOS Archive, as it was. Phoenix checks the package before installing it.</Note>}
            <Dialog open={confirmRemove} title={`Remove ${app.title}?`} onClose={() => setConfirmRemove(false)} testId="remove-dialog"
                    message="The app and its data on this device are removed.">
                <Button variant="negative" data-testid="remove-confirm" onClick={() => void remove()}>Remove</Button>
                <Button variant="dark" onClick={() => setConfirmRemove(false)}>Cancel</Button>
            </Dialog>
        </div>
    );
}

// ---- Installed apps and updates --------------------------------------------------------------

function Installed({ open }: { open: (sourceId: string, id: string) => void }) {
    const [list, setList] = useState<InstalledApp[] | null>(null);
    const [busy, setBusy] = useState(false);
    const [result, setResult] = useState<string | null>(null);
    const load = () => marketplace.installed().then(setList, () => setList([]));
    useEffect(() => { void load(); }, []);
    const updates = list?.filter((a) => a.update) ?? [];
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
            <Group label="Installed from the Marketplace">
                {list === null ? <Row title="Loading…"><Spinner /></Row>
                    : list.length === 0 ? <Row title="Nothing yet" />
                    : list.map((a) => (
                        <Row key={a.id} testId={`installed-${a.id}`} icon={<Icon src={a.icon} />} chevron title={a.title}
                             subtitle={a.update ? `${a.version} → ${a.update}` : a.version} value={a.update ? "Update" : ""}
                             onClick={() => open(a.sourceId, a.catalogId)} />
                    ))}
            </Group>
        </>
    );
}

// ---- Settings: the catalogs --------------------------------------------------------------------

function Settings({ ctx }: { ctx: ReturnType<typeof useSources> }) {
    const [url, setUrl] = useState("");
    const [checking, setChecking] = useState(false);
    const [pending, setPending] = useState<PendingKey | null>(null);
    const [error, setError] = useState<string | null>(null);
    const kindName = { phoenix: "Phoenix catalog", appmuseum: "App Museum II", preware: "Preware feed" } as const;
    return (
        <>
            <Group label="Catalogs">
                {(ctx.sources ?? []).map((s) => (
                    <Row key={s.id} testId={`source-${s.id}`} title={s.name}
                         subtitle={s.error ? s.error.errorText : s.fingerprint ? `Key ${s.fingerprint}` : `${kindName[s.kind]} · ${s.url}`}>
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
    const params = useLaunchParams<{ section?: string; sourceId?: string; id?: string }>();
    const [stack, setStack] = useState<View[]>([{ kind: "home" }]);
    const [section, setSection] = useState<Section>("featured");
    const [query, setQuery] = useState("");
    const [results, setResults] = useState<MarketApp[] | null>(null);
    const ctx = useSources();
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

    async function search() {
        const q = query.trim();
        if (!q) return;
        setResults(null);
        push({ kind: "search", query: q });
        try { setResults(await marketplace.search(q)); } catch { setResults([]); }
    }
    const openApp = (a: MarketApp) => push({ kind: "app", sourceId: a.sourceId, id: a.id, seed: a });

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
                {view.kind === "home" && <Home section={section} setSection={setSection} open={openApp} ctx={ctx} />}
                {view.kind === "app" && <AppPage key={view.sourceId + view.id} sourceId={view.sourceId} id={view.id} seed={view.seed}
                                                 onRemoved={() => void ctx.reload()} />}
                {view.kind === "search" && (
                    <Group label={`Results for "${view.query}"`}>
                        {results === null ? <Row title="Searching…"><Spinner /></Row>
                            : results.length === 0 ? <Row title="Nothing found" />
                            : results.map((a) => <AppRow key={a.sourceId + a.id} a={a} onOpen={() => openApp(a)} />)}
                    </Group>
                )}
                {view.kind === "installed" && <Installed open={(sourceId, id) => push({ kind: "app", sourceId, id })} />}
                {view.kind === "settings" && <Settings ctx={ctx} />}
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
