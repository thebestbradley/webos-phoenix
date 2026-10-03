// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Files: a file manager for the whole device, with the feature set of the
// Preware-era webOS file managers (Internalz Pro above all), designed from
// scratch in the webOS 2.x style: the folder's name in the page header, a
// path bar, the list with type icons, sizes and dates, and the command
// menu at the bottom.
//
// - Tap a folder to open it, a file to view it: pictures in the image
//   viewer, text in the editor, .ipk packages go to the app installer and
//   anything else to "Open with".
// - Hold an item (or the select button) to select several; then copy, cut,
//   delete, rename or show the info sheet.
// - The header menu sorts by name, size or date, shows hidden files and
//   adds the folder to the favourites (the star in the command menu).
// - The back gesture goes back through the folders visited.
//
// Launch params: {path} opens that folder.
//
// Everything goes through org.webosphoenix.filemanager (@phoenix/luna
// files.ts).

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
    fileManager, formatSize, isHidden, joinPath, kindOf, LunaError, opensAsText, parentOf, sortEntries, type FileEntry, type SortKey,
} from "@phoenix/luna";
import { useLaunchParams } from "@phoenix/luna/react";
import {
    AppMenu, BackProvider, CheckBox, cx, FileIcon, Glyph, IconToolButton, PageHeader, PopupMenu, Spinner, Toolbar, ToolSpacer, useBack, type Option,
} from "@phoenix/ui";
import { crumbs, folderTitle, HOME, loadPrefs, planPaste, savePrefs, shortDate, type Clipboard, type Prefs } from "./browse";
import { DeleteDialog, InfoDialog, InstallDialog, NameDialog, OpenWithDialog } from "./Dialogs";
import { ImageViewer, TextEditor } from "./Viewers";

type Sheet =
    | { kind: "new-folder" } | { kind: "new-file" }
    | { kind: "rename"; entry: FileEntry }
    | { kind: "delete"; entries: FileEntry[] }
    | { kind: "info"; entry: FileEntry }
    | { kind: "open-with"; entry: FileEntry }
    | { kind: "install"; entry: FileEntry }
    | null;

type Viewer = { kind: "image"; images: FileEntry[]; index: number } | { kind: "text"; entry: FileEntry } | null;

type Menu = { anchor: HTMLElement; kind: "main" | "favorites" | "new" | "more" } | null;

const HOLD_MS = 500;

const errorText = (e: unknown) => (e instanceof LunaError ? e.errorText : e instanceof Error ? e.message : String(e));

function useWide(): boolean {
    const [wide, setWide] = useState(() => window.innerWidth >= 600);
    useEffect(() => {
        const on = () => setWide(window.innerWidth >= 600);
        window.addEventListener("resize", on);
        return () => window.removeEventListener("resize", on);
    }, []);
    return wide;
}

function FileRow({ entry, selecting, selected, onTap, onHold, onToggle }: {
    entry: FileEntry; selecting: boolean; selected: boolean;
    onTap: () => void; onHold: () => void; onToggle: () => void;
}) {
    const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const held = useRef(false);
    const start = useRef<{ x: number; y: number } | null>(null);
    const clear = () => { if (timer.current) clearTimeout(timer.current); timer.current = undefined; };
    const down = (e: ReactPointerEvent) => {
        held.current = false;
        start.current = { x: e.clientX, y: e.clientY };
        clear();
        timer.current = setTimeout(() => { held.current = true; onHold(); }, HOLD_MS);
    };
    const move = (e: ReactPointerEvent) => {
        // Scrolling the list is not a hold.
        if (start.current && Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) > 10) clear();
    };
    const folder = entry.type === "directory";
    const sub = folder ? shortDate(entry.mtime) : `${formatSize(entry.size)} · ${shortDate(entry.mtime)}`;
    return (
        <div
            className={cx("pui-row", "tappable", "fm-row", selected && "selected", isHidden(entry) && "hidden-file")}
            role="button"
            tabIndex={0}
            aria-selected={selecting ? selected : undefined}
            data-testid={`file-${entry.name}`}
            onPointerDown={down}
            onPointerMove={move}
            onPointerUp={clear}
            onPointerCancel={clear}
            onPointerLeave={clear}
            onContextMenu={(e) => e.preventDefault()}
            onClick={() => {
                clear();
                if (held.current) { held.current = false; return; }
                if (selecting) onToggle(); else onTap();
            }}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (selecting) onToggle(); else onTap(); } }}
        >
            <div className="pui-row-icon"><FileIcon kind={kindOf(entry)} /></div>
            <div className="pui-row-body">
                <div className="pui-row-title">{entry.name}</div>
                <div className="pui-row-subtitle">{sub}{entry.readOnly ? " · read-only" : ""}</div>
            </div>
            <div className="pui-row-end">
                {selecting
                    ? <CheckBox checked={selected} onChange={onToggle} label={`Select ${entry.name}`} testId={`check-${entry.name}`} />
                    : folder && <span className="pui-row-chevron" />}
            </div>
        </div>
    );
}

function Browser() {
    const launch = useLaunchParams<{ path?: string }>();
    const [prefs, setPrefsState] = useState<Prefs>(loadPrefs);
    const [path, setPath] = useState(launch.path || HOME);
    const [history, setHistory] = useState<string[]>([]);
    const [entries, setEntries] = useState<FileEntry[] | null>(null);
    const [error, setError] = useState("");
    const [selecting, setSelecting] = useState(false);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [clip, setClip] = useState<Clipboard | null>(null);
    const [sheet, setSheet] = useState<Sheet>(null);
    const [viewer, setViewer] = useState<Viewer>(null);
    const [menu, setMenu] = useState<Menu>(null);
    const [toast, setToast] = useState("");
    const [busy, setBusy] = useState(false);
    const wide = useWide();
    const pathBar = useRef<HTMLDivElement>(null);
    const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

    const setPrefs = (p: Partial<Prefs>) => setPrefsState((old) => { const n = { ...old, ...p }; savePrefs(n); return n; });
    const say = useCallback((text: string) => {
        setToast(text);
        if (toastTimer.current) clearTimeout(toastTimer.current);
        toastTimer.current = setTimeout(() => setToast(""), 2500);
    }, []);

    const reload = useCallback(async (p = path) => {
        try {
            const list = await fileManager.list(p);
            setEntries(list);
            setError("");
        } catch (e) {
            setEntries([]);
            setError(errorText(e));
        }
    }, [path]);

    useEffect(() => { setEntries(null); reload(path); }, [path, reload]);
    useEffect(() => { if (launch.path) { setPath(launch.path); setHistory([]); } }, [launch.path]);
    useEffect(() => { pathBar.current?.scrollTo?.({ left: 1e6 }); }, [path]);

    const shown = useMemo(() => {
        const list = (entries ?? []).filter((e) => prefs.showHidden || !isHidden(e));
        return sortEntries(list, prefs.sort);
    }, [entries, prefs.showHidden, prefs.sort]);
    const names = useMemo(() => (entries ?? []).map((e) => e.name), [entries]);
    const chosen = shown.filter((e) => selected.has(e.path));

    const endSelect = () => { setSelecting(false); setSelected(new Set()); };
    const go = (p: string) => {
        if (p === path) return;
        setHistory((h) => [...h, path]);
        setPath(p);
        endSelect();
    };
    const toggle = (e: FileEntry) => setSelected((s) => {
        const n = new Set(s);
        if (n.has(e.path)) n.delete(e.path); else n.add(e.path);
        return n;
    });

    useBack(() => { endSelect(); return true; }, selecting && !viewer);
    useBack(() => {
        const prev = history[history.length - 1];
        setHistory((h) => h.slice(0, -1));
        setPath(prev);
        return true;
    }, !selecting && !viewer && history.length > 0);

    const open = (e: FileEntry) => {
        if (e.type === "directory") { go(e.path); return; }
        const kind = kindOf(e);
        if (kind === "image") {
            const images = shown.filter((x) => kindOf(x) === "image");
            setViewer({ kind: "image", images, index: images.findIndex((x) => x.path === e.path) });
        } else if (kind === "package") {
            setSheet({ kind: "install", entry: e });
        } else if (opensAsText(e) && (kind === "text" || kind === "code" || kind === "file")) {
            setViewer({ kind: "text", entry: e });
        } else {
            setSheet({ kind: "open-with", entry: e });
        }
    };

    const run = async (what: () => Promise<unknown>, done?: string) => {
        setBusy(true);
        try {
            await what();
            if (done) say(done);
        } catch (e) {
            say(errorText(e));
        } finally {
            setBusy(false);
            reload();
        }
    };

    const paste = () => {
        if (!clip) return;
        const { steps, skipped } = planPaste(clip, path, names);
        run(async () => {
            for (const s of steps) {
                if (s.move) await fileManager.move(s.from, s.to);
                else await fileManager.copy(s.from, s.to);
            }
            if (clip.mode === "cut") setClip(null);
            if (skipped.length) throw new Error("A folder cannot be pasted into itself.");
        }, `${clip.mode === "cut" ? "Moved" : "Copied"} ${steps.length} item${steps.length === 1 ? "" : "s"}`);
    };

    const showInfo = async (e: FileEntry) => {
        try { setSheet({ kind: "info", entry: await fileManager.stat(e.path) }); } catch (x) { say(errorText(x)); }
    };

    const isFavorite = prefs.favorites.includes(path);
    const mainMenu: Option<string>[] = [
        { label: "Sort by Name", value: "sort:name" },
        { label: "Sort by Size", value: "sort:size" },
        { label: "Sort by Date", value: "sort:date" },
        { label: prefs.showHidden ? "Hide Hidden Files" : "Show Hidden Files", value: "hidden" },
        { label: isFavorite ? "Remove from Favorites" : "Add to Favorites", value: "favorite" },
        { label: "Select Items", value: "select" },
        { label: "Folder Info", value: "info" },
        { label: "Refresh", value: "refresh" },
    ];
    const onMain = (v: string) => {
        if (v.startsWith("sort:")) setPrefs({ sort: v.slice(5) as SortKey });
        else if (v === "hidden") setPrefs({ showHidden: !prefs.showHidden });
        else if (v === "favorite") {
            setPrefs({ favorites: isFavorite ? prefs.favorites.filter((f) => f !== path) : [...prefs.favorites, path] });
            say(isFavorite ? "Removed from Favorites" : "Added to Favorites");
        } else if (v === "select") setSelecting(true);
        else if (v === "info") fileManager.stat(path).then((entry) => setSheet({ kind: "info", entry }), (e) => say(errorText(e)));
        else if (v === "refresh") reload();
    };
    const favOptions: Option<string>[] = prefs.favorites.map((f) => ({ label: folderTitle(f), value: f }));
    const one = chosen.length === 1 ? chosen[0] : null;
    const moreOptions: Option<string>[] = [
        { label: "Rename", value: "rename", disabled: !one || !!one.readOnly },
        { label: "Info", value: "info", disabled: !one },
        { label: "Open With...", value: "open-with", disabled: !one || one.type !== "file" },
        { label: chosen.length === shown.length ? "Select None" : "Select All", value: "all" },
    ];
    const onMore = (v: string) => {
        if (v === "rename" && one) setSheet({ kind: "rename", entry: one });
        else if (v === "info" && one) showInfo(one);
        else if (v === "open-with" && one) setSheet({ kind: "open-with", entry: one });
        else if (v === "all") setSelected(chosen.length === shown.length ? new Set() : new Set(shown.map((e) => e.path)));
    };
    const copyOrCut = (mode: Clipboard["mode"]) => {
        setClip({ mode, paths: chosen.map((e) => e.path) });
        say(`${chosen.length} item${chosen.length === 1 ? "" : "s"} ${mode === "cut" ? "cut" : "copied"}: go to a folder and paste`);
        endSelect();
    };

    const header = (
        <PageHeader icon="icon.png" title={<span data-testid="folder-title">{selecting ? `${chosen.length} selected` : folderTitle(path)}</span>}>
            <button type="button" className="fm-menu-button" aria-label="Menu" data-testid="menu"
                    onClick={(e) => setMenu({ anchor: e.currentTarget, kind: "main" })}>
                <Glyph name="menu" size={22} />
            </button>
        </PageHeader>
    );

    const favorites = (
        <nav className="fm-favorites" aria-label="Favorites">
            <div className="fm-favorites-title">Favorites</div>
            {prefs.favorites.map((f) => (
                <div key={f} className={cx("fm-favorite", f === path && "current")} role="button" tabIndex={0}
                     data-testid={`fav-${folderTitle(f)}`} onClick={() => go(f)}>
                    <FileIcon kind="folder" size={24} /> <span>{folderTitle(f)}</span>
                </div>
            ))}
        </nav>
    );

    // The app menu: new items, then the folder menu's entries.
    const appMenu = [
        { label: "New Folder", onSelect: () => setSheet({ kind: "new-folder" }) },
        { label: "New File", onSelect: () => setSheet({ kind: "new-file" }) },
        ...mainMenu.map((o) => ({ label: o.label, disabled: o.disabled, onSelect: () => onMain(o.value) })),
    ];

    return (
        <div className={cx("fm-app", wide && "wide")}>
            <AppMenu items={appMenu} />
            {wide && favorites}
            <div className="fm-main">
                {header}
                <div className="fm-path" ref={pathBar} data-testid="path-bar">
                    {crumbs(path).map((c, i, all) => (
                        <button key={c.path} type="button" className={cx("fm-crumb", i === all.length - 1 && "current")}
                                data-testid={`crumb-${i}`} onClick={() => go(c.path)}>{c.label}</button>
                    ))}
                </div>
                <div className="fm-scroll" data-testid="file-list">
                    {entries === null && <div className="fm-loading"><Spinner large /></div>}
                    {error && <div className="fm-empty" role="alert">{error}</div>}
                    {entries !== null && !error && shown.length === 0 && (
                        <div className="fm-empty" data-testid="empty">
                            {entries.length ? "Only hidden files here. Show them from the menu." : "This folder is empty."}
                        </div>
                    )}
                    <div className="fm-list">
                        {shown.map((e) => (
                            <FileRow key={e.path} entry={e} selecting={selecting} selected={selected.has(e.path)}
                                     onTap={() => open(e)} onToggle={() => toggle(e)}
                                     onHold={() => { setSelecting(true); setSelected(new Set([e.path])); }} />
                        ))}
                    </div>
                </div>
                {toast && <div className="fm-toast" data-testid="toast">{toast}</div>}
                {busy && <div className="fm-busy"><Spinner /></div>}
                {selecting ? (
                    <Toolbar>
                        <IconToolButton icon="close" label="Done" testId="select-done" onClick={endSelect} />
                        <ToolSpacer />
                        <IconToolButton icon="copy" label="Copy" testId="copy" disabled={!chosen.length} onClick={() => copyOrCut("copy")} />
                        <IconToolButton icon="cut" label="Cut" testId="cut" disabled={!chosen.length || chosen.some((e) => e.readOnly)}
                                        onClick={() => copyOrCut("cut")} />
                        <IconToolButton icon="trash" label="Delete" testId="delete" disabled={!chosen.length || chosen.some((e) => e.readOnly)}
                                        onClick={() => setSheet({ kind: "delete", entries: chosen })} />
                        <IconToolButton icon="menu" label="More" testId="more"
                                        onClick={() => { const a = document.querySelector<HTMLElement>("[data-testid='more']"); if (a) setMenu({ anchor: a, kind: "more" }); }} />
                    </Toolbar>
                ) : (
                    <Toolbar>
                        {!wide && <IconToolButton icon="star" label="Favorites" testId="favorites"
                                                  onClick={() => { const a = document.querySelector<HTMLElement>("[data-testid='favorites']"); if (a) setMenu({ anchor: a, kind: "favorites" }); }} />}
                        <IconToolButton icon="up" label="Up" testId="up" disabled={path === "/"} onClick={() => go(parentOf(path))} />
                        <ToolSpacer />
                        {clip && <IconToolButton icon="paste" label="Paste" caption={String(clip.paths.length)} testId="paste" onClick={paste} />}
                        <IconToolButton icon="plus" label="New" testId="new"
                                        onClick={() => { const a = document.querySelector<HTMLElement>("[data-testid='new']"); if (a) setMenu({ anchor: a, kind: "new" }); }} />
                        <IconToolButton icon="check" label="Select" testId="select" onClick={() => setSelecting(true)} />
                    </Toolbar>
                )}
            </div>

            {menu?.kind === "main" && <PopupMenu options={mainMenu} value={`sort:${prefs.sort}`} anchor={menu.anchor} onSelect={onMain} onClose={() => setMenu(null)} />}
            {menu?.kind === "favorites" && <PopupMenu options={favOptions} value={path} anchor={menu.anchor} onSelect={go} onClose={() => setMenu(null)} />}
            {menu?.kind === "new" && (
                <PopupMenu options={[{ label: "New Folder", value: "new-folder" }, { label: "New File", value: "new-file" }]} anchor={menu.anchor}
                           onSelect={(v) => setSheet({ kind: v as "new-folder" | "new-file" })} onClose={() => setMenu(null)} />
            )}
            {menu?.kind === "more" && <PopupMenu options={moreOptions} anchor={menu.anchor} onSelect={onMore} onClose={() => setMenu(null)} />}

            {sheet?.kind === "new-folder" && (
                <NameDialog title="New Folder" initial="" action="Create" taken={names} onClose={() => setSheet(null)}
                            onSubmit={async (n) => { await fileManager.mkdir(joinPath(path, n)); reload(); }} />
            )}
            {sheet?.kind === "new-file" && (
                <NameDialog title="New File" initial="untitled.txt" action="Create" taken={names} onClose={() => setSheet(null)}
                            onSubmit={async (n) => {
                                const p = joinPath(path, n);
                                await fileManager.writeText(p, "", false);
                                await reload();
                                setViewer({ kind: "text", entry: await fileManager.stat(p) });
                            }} />
            )}
            {sheet?.kind === "rename" && (
                <NameDialog title="Rename" initial={sheet.entry.name} action="Rename" taken={names} onClose={() => setSheet(null)}
                            onSubmit={async (n) => {
                                await fileManager.move(sheet.entry.path, joinPath(path, n));
                                endSelect();
                                reload();
                            }} />
            )}
            {sheet?.kind === "delete" && (
                <DeleteDialog entries={sheet.entries} onClose={() => setSheet(null)} onConfirm={async () => {
                    try {
                        for (const e of sheet.entries) await fileManager.remove(e.path, true);
                        say(`Deleted ${sheet.entries.length} item${sheet.entries.length === 1 ? "" : "s"}`);
                    } finally {
                        endSelect();
                        reload();
                    }
                }} />
            )}
            {sheet?.kind === "info" && <InfoDialog entry={sheet.entry} onClose={() => setSheet(null)} />}
            {sheet?.kind === "open-with" && (
                <OpenWithDialog entry={sheet.entry} onClose={() => setSheet(null)}
                                onOpenAsText={sheet.entry.size <= 256 * 1024 ? () => setViewer({ kind: "text", entry: sheet.entry }) : undefined} />
            )}
            {sheet?.kind === "install" && <InstallDialog entry={sheet.entry} onClose={() => setSheet(null)} />}

            {viewer?.kind === "image" && <ImageViewer images={viewer.images} start={viewer.index} onClose={() => setViewer(null)} />}
            {viewer?.kind === "text" && <TextEditor entry={viewer.entry} onClose={() => { setViewer(null); reload(); }} onSaved={() => reload()} />}
        </div>
    );
}

export function App() {
    return (
        <BackProvider>
            <Browser />
        </BackProvider>
    );
}
