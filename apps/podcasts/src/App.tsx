// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Podcasts. webOS never shipped one; drPodder (from the App Catalog and
// Preware) was the favourite, and this app keeps to its shape in the
// webOS 2.x style of the other Phoenix apps: the podcasts, each one's
// episodes (new ones in bold, how much is left, downloaded or not), a dark
// Now Playing with the speed and the sleep timer, and a mini player.
//
//   Subscribing: a feed address, a search of a directory (directory.ts),
//       or an OPML file (Preferences menu; or "Open with" in Files).
//   Launch params: {target: "...opml"} imports that file; {refresh: true}
//       (the background refresh activity, store.ts) looks for new episodes;
//       {newEpisodes: true} (its notification) opens the app.

import { useEffect, useMemo, useRef, useState } from "react";
import { db, fileManager, findFiles, openTarget, readTargetText, type OpenParams } from "@phoenix/luna";
import { useLaunchParams, useLuna } from "@phoenix/luna/react";
import {
    AppMenu, BackProvider, Button, Dialog, Divider, ErrorText, Glyph, IconToolButton, Note, PageHeader, PopupMenu, Row, Slider, Spinner,
    TextField, Toolbar, ToolSpacer, formatSeconds, useBack, type Option,
} from "@phoenix/ui";
import { searchDirectory, type DirectoryResult, type PodcastIndexKey } from "./directory";
import { normaliseFeedUrl } from "./feed";
import { parseOpml, toOpml } from "./opml";
import { PlayerProvider, usePlayer } from "./player";
import {
    backgroundRefresh, deleteDownload, downloadEpisode, ensureRefreshScheduled, EPISODE_KIND, PODCAST_KIND, podcasts,
    type Episode, type Podcast,
} from "./store";
import { durationText, episodeDate, nextSpeed, SLEEP_CHOICES, sleepLabel, sleepRemaining, speedLabel, type SleepChoice } from "./timing";

const errorText = (e: unknown) => (e as { errorText?: string }).errorText ?? (e instanceof Error ? e.message : String(e));
const PREFS_KEY = "org.webosphoenix.podcasts:prefs";
const EXPORT_PATH = "/media/internal/Documents/Podcasts.opml";

interface Prefs { podcastIndex: PodcastIndexKey }
function loadPrefs(): Prefs {
    try {
        const p = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "null") as Partial<Prefs> | null;
        return { podcastIndex: { key: p?.podcastIndex?.key ?? "", secret: p?.podcastIndex?.secret ?? "" } };
    } catch { return { podcastIndex: { key: "", secret: "" } }; }
}

type View = { kind: "list" } | { kind: "podcast"; id: string } | { kind: "search" } | { kind: "playing" };
type Sheet = { kind: "add" } | { kind: "prefs" } | { kind: "import"; files?: string[] } | { kind: "unsubscribe"; podcast: Podcast } | null;

function Art({ src, size }: { src?: string; size: number }) {
    const [broken, setBroken] = useState(false);
    return (
        <span className="pc-art" style={{ width: size, height: size }}>
            {src && !broken ? <img src={src} alt="" draggable={false} onError={() => setBroken(true)} /> : <Glyph name="note" size={Math.round(size * 0.55)} />}
        </span>
    );
}

// ---- Now Playing -------------------------------------------------------------------------

function NowPlaying({ onClose }: { onClose: () => void }) {
    const player = usePlayer();
    const [scrub, setScrub] = useState<number | null>(null);
    const [menu, setMenu] = useState<HTMLElement | null>(null);
    const sleepButton = useRef<HTMLDivElement>(null);
    const [, tick] = useState(0);
    useEffect(() => { if (!player.sleep) return; const t = setInterval(() => tick((x) => x + 1), 1000); return () => clearInterval(t); }, [player.sleep]);
    const e = player.episode, p = player.podcast;
    if (!e) return null;
    const duration = player.duration || e.duration || 0;
    const pos = scrub ?? player.position;
    const sleepOptions: Option<SleepChoice>[] = SLEEP_CHOICES.map((c) => ({ label: sleepLabel(c), value: c }));
    return (
        <div className="pc-np" data-testid="now-playing">
            {(e.image || p?.image) && <div className="pc-np-bg" style={{ backgroundImage: `url("${e.image || p?.image}")` }} />}
            <div className="pc-np-top">
                <button type="button" className="pc-np-back" aria-label="Back" onClick={onClose} data-testid="np-back" />
                <div className="pc-np-titles">
                    <div className="pc-np-title" data-testid="np-title">{e.title}</div>
                    <div className="pc-np-sub">{p?.title}</div>
                </div>
            </div>
            <div className="pc-np-body">
                <div className="pc-np-art"><Art src={e.image || p?.image} size={176} /></div>
                <div className="pc-np-controls">
                    <Slider progress value={duration ? pos : 0} min={0} max={Math.max(1, duration)} step={1} label="Position" testId="np-seek"
                            onChange={setScrub} onChangeComplete={(v) => { setScrub(null); player.seek(v); }} />
                    <div className="pc-np-times">
                        <span data-testid="np-elapsed">{formatSeconds(pos)}</span>
                        <span>-{formatSeconds(Math.max(0, duration - pos))}</span>
                    </div>
                    <div className="pc-np-extras">
                        <button type="button" className="pc-pill" data-testid="np-speed" onClick={() => player.setSpeed(nextSpeed(player.speed))}>
                            {speedLabel(player.speed)}
                        </button>
                        <div ref={sleepButton}>
                            <button type="button" className={"pc-pill" + (player.sleep ? " on" : "")} data-testid="np-sleep" onClick={() => setMenu(sleepButton.current)}>
                                <Glyph name="moon" size={16} /> {player.sleep ? sleepRemaining(player.sleep) : "Sleep"}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
            <Toolbar kind="dark">
                <ToolSpacer />
                <IconToolButton icon="replay" label="Back 15 seconds" testId="np-back15" onClick={() => player.skip(-15)} />
                <IconToolButton icon={player.playing ? "pause" : "play"} label={player.playing ? "Pause" : "Play"} testId="np-play" onClick={() => player.toggle()} />
                <IconToolButton icon="forward" label="Ahead 30 seconds" testId="np-fwd30" onClick={() => player.skip(30)} />
                <ToolSpacer />
            </Toolbar>
            {menu && <PopupMenu anchor={menu} options={sleepOptions} value={player.sleepChoice} onSelect={(c) => player.setSleep(c)} onClose={() => setMenu(null)} />}
        </div>
    );
}

function MiniPlayer({ onOpen }: { onOpen: () => void }) {
    const player = usePlayer();
    const e = player.episode;
    if (!e) return null;
    return (
        <div className="pc-mini" onClick={onOpen} role="button" data-testid="mini-player">
            <Art src={e.image || player.podcast?.image} size={40} />
            <div className="pc-mini-text">
                <div className="pc-mini-title">{e.title}</div>
                <div className="pc-mini-sub">{player.podcast?.title}</div>
            </div>
            <IconToolButton icon={player.playing ? "pause" : "play"} label={player.playing ? "Pause" : "Play"} testId="mini-play" onClick={() => player.toggle()} />
        </div>
    );
}

// ---- Episodes -----------------------------------------------------------------------------

type Downloads = Record<string, number>;

function EpisodeRow({ e, p, progress, onPlay, onDownload, onDelete }: {
    e: Episode; p: Podcast; progress?: number; onPlay: () => void; onDownload: () => void; onDelete: () => void;
}) {
    const player = usePlayer();
    const current = player.episode?._id === e._id;
    const bits = [episodeDate(e.published), durationText(e.duration, e.position)].filter(Boolean).join(" · ");
    return (
        <Row className={"pc-episode" + (e.played ? " played" : " new") + (current ? " current" : "")} testId={`episode-${e.title}`}
             title={e.title} subtitle={bits} onClick={onPlay}>
            {current && <span className={"pc-eq" + (player.playing ? " on" : "")}><i /><i /><i /></span>}
            {progress !== undefined ? (
                <span className="pc-dl-progress" data-testid={`downloading-${e.title}`}>{progress >= 0 ? `${Math.round(progress * 100)}%` : <Spinner />}</span>
            ) : e.file ? (
                <button type="button" className="pc-dl done" aria-label="Downloaded (tap to remove)" data-testid={`downloaded-${e.title}`}
                        onClick={(x) => { x.stopPropagation(); onDelete(); }}><Glyph name="check" size={18} /></button>
            ) : (
                <button type="button" className="pc-dl" aria-label="Download" data-testid={`download-${e.title}`}
                        onClick={(x) => { x.stopPropagation(); onDownload(); }}><Glyph name="download" size={18} /></button>
            )}
            <span hidden>{p.title}</span>
        </Row>
    );
}

function PodcastPage({ p, episodes, downloads, onDownload, onDelete, onPlay, onMenu }: {
    p: Podcast; episodes: Episode[]; downloads: Downloads;
    onDownload: (e: Episode) => void; onDelete: (e: Episode) => void; onPlay: (e: Episode) => void; onMenu: (anchor: HTMLElement) => void;
}) {
    const [more, setMore] = useState(false);
    return (
        <div className="pc-page">
            <div className="pc-head">
                <Art src={p.image} size={96} />
                <div className="pc-head-info">
                    <div className="pc-head-title" data-testid="podcast-title">{p.title}</div>
                    <div className="pc-head-author">{p.author}</div>
                    {p.lastError && <div className="pc-head-error">Could not refresh: {p.lastError}</div>}
                </div>
                <button type="button" className="pc-menu-button" aria-label="Menu" data-testid="podcast-menu" onClick={(e) => onMenu(e.currentTarget)}>
                    <Glyph name="menu" size={22} />
                </button>
            </div>
            {p.description && (
                <div className={"pc-desc" + (more ? " more" : "")} onClick={() => setMore(!more)}>{p.description}</div>
            )}
            <Divider caption={`${episodes.length} episode${episodes.length === 1 ? "" : "s"}`} />
            <div className="pc-list" data-testid="episodes">
                {episodes.map((e) => (
                    <EpisodeRow key={e._id} e={e} p={p} progress={downloads[e._id!]} onPlay={() => onPlay(e)}
                                onDownload={() => onDownload(e)} onDelete={() => onDelete(e)} />
                ))}
            </div>
        </div>
    );
}

// ---- Search -----------------------------------------------------------------------------------

function SearchPage({ prefs, subscribed, onSubscribe }: { prefs: Prefs; subscribed: Set<string>; onSubscribe: (url: string) => Promise<void> }) {
    const [q, setQ] = useState("");
    const [results, setResults] = useState<DirectoryResult[] | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [adding, setAdding] = useState<string | null>(null);
    const usesPi = !!(prefs.podcastIndex.key && prefs.podcastIndex.secret);
    const run = async () => {
        if (!q.trim()) return;
        setBusy(true); setError("");
        try { setResults(await searchDirectory(q, prefs.podcastIndex)); } catch (e) { setError(`Search did not work: ${errorText(e)}`); setResults(null); }
        setBusy(false);
    };
    return (
        <div className="pc-page">
            <PageHeader icon="icon.png" title="Find Podcasts" />
            <div className="pc-search">
                <TextField value={q} onChange={setQ} onSubmit={() => void run()} placeholder="Podcast name or topic" autoFocus testId="search-field" />
                <Button variant="affirmative" onClick={() => void run()} busy={busy} data-testid="search-go">Search</Button>
            </div>
            <Note>{usesPi ? "Searching the Podcast Index." : "Searching Apple's podcast directory. Podcasts plays each show from the feed its maker publishes."}</Note>
            {error && <ErrorText>{error}</ErrorText>}
            {results?.length === 0 && <div className="pc-empty">Nothing found for "{q}".</div>}
            <div className="pc-list" data-testid="results">
                {results?.map((r) => (
                    <Row key={r.feedUrl} title={r.title} subtitle={r.author} testId={`result-${r.title}`}>
                        {subscribed.has(r.feedUrl) ? <span className="pc-subscribed">Subscribed</span> : (
                            <Button variant="light" busy={adding === r.feedUrl} data-testid={`subscribe-${r.title}`}
                                    onClick={() => { setAdding(r.feedUrl); void onSubscribe(r.feedUrl).finally(() => setAdding(null)); }}>Subscribe</Button>
                        )}
                    </Row>
                ))}
            </div>
        </div>
    );
}

// ---- The app ------------------------------------------------------------------------------------

function PodcastsApp() {
    const list = useLuna<Podcast[]>((cb, err) => db.watch<Podcast>({ from: PODCAST_KIND, orderBy: "title", limit: 500 }, cb, err), []);
    const eps = useLuna<Episode[]>((cb, err) => db.watch<Episode>({ from: EPISODE_KIND, limit: 500 }, cb, err), []);
    const [view, setView] = useState<View>({ kind: "list" });
    const [sheet, setSheet] = useState<Sheet>(null);
    const [menu, setMenu] = useState<{ anchor: HTMLElement; kind: "app" | "podcast" } | null>(null);
    const [toast, setToast] = useState("");
    const [busy, setBusy] = useState(false);
    const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
    const [downloads, setDownloads] = useState<Downloads>({});
    const [url, setUrl] = useState("");
    const [error, setError] = useState("");
    const player = usePlayer();
    const params = useLaunchParams<OpenParams & { refresh?: boolean }>();

    const all = useMemo(() => list.value ?? [], [list.value]);
    const byPodcast = useMemo(() => {
        const m = new Map<string, Episode[]>();
        for (const e of eps.value ?? []) {
            if (!m.has(e.podcastId)) m.set(e.podcastId, []);
            m.get(e.podcastId)!.push(e);
        }
        m.forEach((l) => l.sort((a, b) => b.published - a.published));
        return m;
    }, [eps.value]);

    useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(""), 2600); return () => clearTimeout(t); }, [toast]);
    useEffect(() => { void ensureRefreshScheduled(); }, []);

    // Launched to refresh (the activity), or with an OPML file.
    useEffect(() => {
        if (params.refresh) { void backgroundRefresh().catch(() => {}); return; }
        const t = openTarget(params);
        if (t && /\.(opml|xml)$/i.test(t)) void importOpml(t);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [params]);

    useBack(() => { setView({ kind: "list" }); return true; }, view.kind !== "list");

    const subscribe = async (feed: string) => {
        setError("");
        try {
            const p = await podcasts.subscribe(feed);
            setToast(`Subscribed to ${p.title}`);
        } catch (e) {
            setError(`Could not subscribe: ${errorText(e)}`);
            setToast("Could not subscribe");
            throw e;
        }
    };

    const addByUrl = async () => {
        const feed = normaliseFeedUrl(url);
        if (!feed) { setError("Enter the address of a podcast feed."); return; }
        setBusy(true);
        try { await subscribe(feed); setSheet(null); setUrl(""); } catch { /* shown */ } finally { setBusy(false); }
    };

    const refreshAll = async () => {
        setBusy(true);
        const r = await podcasts.refreshAll().catch(() => ({ added: 0, failed: all.length }));
        setBusy(false);
        setToast(r.failed ? `${r.failed} podcast${r.failed === 1 ? "" : "s"} could not be refreshed` : r.added ? `${r.added} new episode${r.added === 1 ? "" : "s"}` : "No new episodes");
    };

    async function importOpml(path: string) {
        try {
            const feeds = parseOpml(await readTargetText(path));
            setSheet(null);
            setBusy(true);
            let ok = 0;
            for (const f of feeds) { try { await podcasts.subscribe(f.xmlUrl); ok++; } catch { /* skip */ } }
            setToast(`Imported ${ok} of ${feeds.length} podcast${feeds.length === 1 ? "" : "s"}`);
        } catch (e) {
            setToast(errorText(e));
        } finally {
            setBusy(false);
        }
    }

    const exportOpml = async () => {
        try {
            await fileManager.writeText(EXPORT_PATH, toOpml(all.map((p) => ({ title: p.title, xmlUrl: p.feedUrl, htmlUrl: p.link }))));
            setToast("Saved Documents/Podcasts.opml");
        } catch (e) {
            setToast(`Could not export: ${errorText(e)}`);
        }
    };

    const download = (p: Podcast, e: Episode) => {
        setDownloads((d) => ({ ...d, [e._id!]: -1 }));
        const h = downloadEpisode(p, e, (f) => setDownloads((d) => ({ ...d, [e._id!]: f })));
        h.done.then(() => setToast("Downloaded"), (x) => setToast(`Download failed: ${errorText(x)}`))
            .finally(() => setDownloads((d) => { const n = { ...d }; delete n[e._id!]; return n; }));
    };

    const current = view.kind === "podcast" ? all.find((p) => p._id === view.id) : undefined;
    const subscribed = new Set(all.map((p) => p.feedUrl));

    const appMenu: Option<string>[] = [
        { label: "Add by Address", value: "add" }, { label: "Find Podcasts", value: "search" },
        { label: "Refresh All", value: "refresh" }, { label: "Import OPML", value: "import" }, { label: "Export OPML", value: "export" },
        { label: "Preferences", value: "prefs" },
    ];
    const onAppMenu = (v: string) => {
        if (v === "add") setSheet({ kind: "add" });
        else if (v === "search") setView({ kind: "search" });
        else if (v === "refresh") void refreshAll();
        else if (v === "export") void exportOpml();
        else if (v === "prefs") setSheet({ kind: "prefs" });
        else if (v === "import") {
            setSheet({ kind: "import" });
            void findFiles(["opml"]).then((f) => setSheet({ kind: "import", files: f.map((x) => x.path) }), () => setSheet({ kind: "import", files: [] }));
        }
    };
    const onPodcastMenu = (v: string) => {
        if (!current) return;
        const list = byPodcast.get(current._id!) ?? [];
        if (v === "refresh") void podcasts.refresh(current).then((n) => setToast(n ? `${n} new episode${n === 1 ? "" : "s"}` : "No new episodes"), (e) => setToast(errorText(e)));
        else if (v === "played") void podcasts.setPlayed(list.map((e) => e._id!), true);
        else if (v === "unsubscribe") setSheet({ kind: "unsubscribe", podcast: current });
    };

    if (view.kind === "playing" && player.episode) return <NowPlaying onClose={() => setView({ kind: "list" })} />;

    let body;
    if (view.kind === "search") {
        body = <SearchPage prefs={prefs} subscribed={subscribed} onSubscribe={subscribe} />;
    } else if (current) {
        body = <PodcastPage p={current} episodes={byPodcast.get(current._id!) ?? []} downloads={downloads}
                            onDownload={(e) => download(current, e)} onDelete={(e) => void deleteDownload(e)}
                            onPlay={(e) => { player.play(e, current); setView({ kind: "playing" }); }}
                            onMenu={(a) => setMenu({ anchor: a, kind: "podcast" })} />;
    } else {
        body = (
            <div className="pc-page">
                <PageHeader icon="icon.png" title="Podcasts">
                    <button type="button" className="pc-menu-button" aria-label="Menu" data-testid="menu" onClick={(e) => setMenu({ anchor: e.currentTarget, kind: "app" })}>
                        <Glyph name="menu" size={22} />
                    </button>
                </PageHeader>
                {list.value === undefined && <div className="pc-loading"><Spinner large /></div>}
                {list.value?.length === 0 && (
                    <div className="pc-empty" data-testid="empty">
                        No podcasts yet. Tap <b>+</b> to add one by its address, or find one by name.
                        <div className="pc-empty-buttons">
                            <Button variant="affirmative" onClick={() => setView({ kind: "search" })} data-testid="empty-search">Find Podcasts</Button>
                        </div>
                    </div>
                )}
                <div className="pc-list" data-testid="podcasts">
                    {all.map((p) => {
                        const l = byPodcast.get(p._id!) ?? [];
                        const fresh = l.filter((e) => !e.played).length;
                        return (
                            <Row key={p._id} icon={<Art src={p.image} size={48} />} title={p.title} testId={`podcast-${p.title}`}
                                 subtitle={[fresh ? `${fresh} new` : "", p.author].filter(Boolean).join(" · ")} chevron
                                 onClick={() => setView({ kind: "podcast", id: p._id! })}>
                                {fresh > 0 && <span className="pc-count">{fresh}</span>}
                            </Row>
                        );
                    })}
                </div>
            </div>
        );
    }

    return (
        <div className={"pc-app" + (player.episode ? " with-mini" : "")}>
            <AppMenu items={appMenu.map((o) => ({ label: o.label, onSelect: () => onAppMenu(o.value) }))} />
            <div className="pc-scroll">{body}</div>
            <MiniPlayer onOpen={() => setView({ kind: "playing" })} />
            <Toolbar className="pc-toolbar">
                <IconToolButton icon="plus" label="Add a podcast" testId="add" onClick={() => setSheet({ kind: "add" })} />
                <IconToolButton icon="search" label="Find podcasts" testId="find" onClick={() => setView({ kind: "search" })} />
                <ToolSpacer />
                {busy && <Spinner />}
                <IconToolButton icon="refresh" label="Refresh" testId="refresh" disabled={busy || !all.length}
                                onClick={() => (current ? onPodcastMenu("refresh") : void refreshAll())} />
            </Toolbar>

            {menu?.kind === "app" && <PopupMenu anchor={menu.anchor} options={appMenu} onSelect={onAppMenu} onClose={() => setMenu(null)} />}
            {menu?.kind === "podcast" && (
                <PopupMenu anchor={menu.anchor} onSelect={onPodcastMenu} onClose={() => setMenu(null)}
                           options={[{ label: "Refresh", value: "refresh" }, { label: "Mark All as Played", value: "played" }, { label: "Unsubscribe", value: "unsubscribe" }]} />
            )}

            <Dialog open={sheet?.kind === "add"} title="Add a Podcast" onClose={() => setSheet(null)} testId="add-dialog">
                <TextField value={url} onChange={(v) => { setUrl(v); setError(""); }} onSubmit={() => void addByUrl()} placeholder="Feed address (RSS)" autoFocus testId="feed-url" />
                {error && <ErrorText>{error}</ErrorText>}
                <Button variant="affirmative" busy={busy} onClick={() => void addByUrl()} data-testid="add-ok">Subscribe</Button>
                <Button onClick={() => { setSheet(null); setView({ kind: "search" }); }}>Find by Name</Button>
                <Button onClick={() => setSheet(null)}>Cancel</Button>
            </Dialog>

            <Dialog open={sheet?.kind === "import"} title="Import OPML" onClose={() => setSheet(null)} testId="import-dialog">
                {sheet?.kind === "import" && !sheet.files && <Spinner />}
                {sheet?.kind === "import" && sheet.files?.length === 0 && <Note>No .opml files on the device. Export one from your old podcast app and copy it here.</Note>}
                {sheet?.kind === "import" && sheet.files?.map((f) => (
                    <Button key={f} onClick={() => void importOpml(f)} data-testid={`import-${f.replace(/^.*\//, "")}`}>{f.replace(/^\/media\/internal\//, "")}</Button>
                ))}
                <Button onClick={() => setSheet(null)}>Cancel</Button>
            </Dialog>

            <Dialog open={sheet?.kind === "unsubscribe"} title="Unsubscribe?" onClose={() => setSheet(null)} testId="unsubscribe-dialog"
                    message={sheet?.kind === "unsubscribe" ? `${sheet.podcast.title} and its downloaded episodes will be removed.` : ""}>
                <Button variant="negative" data-testid="unsubscribe-ok" onClick={() => {
                    if (sheet?.kind !== "unsubscribe") return;
                    const p = sheet.podcast;
                    setSheet(null);
                    if (player.podcast?._id === p._id) player.stop();
                    setView({ kind: "list" });
                    void podcasts.unsubscribe(p);
                }}>Unsubscribe</Button>
                <Button onClick={() => setSheet(null)}>Cancel</Button>
            </Dialog>

            <Dialog open={sheet?.kind === "prefs"} title="Preferences" onClose={() => setSheet(null)} testId="prefs-dialog">
                <Note>Podcast search uses Apple's directory. To use the Podcast Index instead, get a free API key at api.podcastindex.org and enter it here.</Note>
                <TextField value={prefs.podcastIndex.key} label="Podcast Index API key" testId="pi-key"
                           onChange={(v) => setPrefs({ podcastIndex: { ...prefs.podcastIndex, key: v.trim() } })} />
                <TextField value={prefs.podcastIndex.secret} label="API secret" type="password" testId="pi-secret"
                           onChange={(v) => setPrefs({ podcastIndex: { ...prefs.podcastIndex, secret: v.trim() } })} />
                <Button variant="affirmative" onClick={() => { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* ignore */ } setSheet(null); }}>Done</Button>
            </Dialog>

            {toast && <div className="pc-toast" role="status" data-testid="toast">{toast}</div>}
        </div>
    );
}

export function App() {
    return (
        <BackProvider>
            <PlayerProvider>
                <PodcastsApp />
            </PlayerProvider>
        </BackProvider>
    );
}
