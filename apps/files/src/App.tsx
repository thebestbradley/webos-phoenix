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
//   delete, share (the system's share sheet, docs/SHARE-AND-FILES.md SF5),
//   rename or show the info sheet.
// - The header menu sorts by name, size or date, shows hidden files and
//   adds the folder to the favourites (the star in the command menu).
// - The back gesture goes back through the folders visited.
//
// Launch params: {path} opens that folder; {transfer} (a tap on a drive's
// upload in the notification area) shows the transfers.
//
// Drives (docs/SHARE-AND-FILES.md "Drives"): each Synergy account with the
// DOCUMENTS capability (Nextcloud, WebDAV, S3, Dropbox, OneDrive, Google
// Drive, Box) is a place beside the favourites, a folder of
// /media/drives. Its files open through a copy on the device (the file
// manager's open), copies to and from it are uploads and downloads with
// their progress and a Cancel, and when it cannot be reached the folder
// says so, with Try Again (and Accounts, when the sign-in was refused).
//
// Everything goes through org.webosphoenix.filemanager (@phoenix/luna
// files.ts).

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
    driveRootOf, DRIVES_ROOT, FILE_ERRORS, fileManager, formatSize, isDrivePath, isHidden, joinPath, kindOf, LunaError, mimeOf, openWith, opensAsText,
    parentOf, shareSheet, sortEntries, type FileEntry, type SortKey, type Transfer,
} from "@phoenix/luna";
import { useLaunchParams } from "@phoenix/luna/react";
import {
    AppMenu, BackProvider, CheckBox, cx, FileIcon, Glyph, IconToolButton, PageHeader, PopupMenu, Spinner, Toolbar, ToolSpacer, useBack, type Option,
} from "@phoenix/ui";
import { crumbs, driveNames, folderTitle, HOME, loadPrefs, planPaste, savePrefs, shortDate, type Clipboard, type Prefs } from "./browse";
import { DeleteDialog, InfoDialog, InstallDialog, NameDialog, OpenWithDialog } from "./Dialogs";
import { ImageViewer, TextEditor } from "./Viewers";

type Sheet =
    | { kind: "new-folder" } | { kind: "new-file" }
    | { kind: "rename"; entry: FileEntry }
    | { kind: "delete"; entries: FileEntry[] }
    | { kind: "info"; entry: FileEntry; quota?: { used: number; total?: number } }
    | { kind: "open-with"; entry: FileEntry }
    | { kind: "install"; entry: FileEntry }
    | null;

type Viewer = { kind: "image"; images: FileEntry[]; index: number } | { kind: "text"; entry: FileEntry } | null;

type Menu = { anchor: HTMLElement; kind: "main" | "favorites" | "new" | "more" } | null;

const HOLD_MS = 500;

const errorText = (e: unknown) => (e instanceof LunaError ? e.errorText : e instanceof Error ? e.message : String(e));
const errorCode = (e: unknown) => (e instanceof LunaError ? e.errorCode : undefined);
const percent = (t: Transfer) => (t.total > 0 ? Math.min(100, Math.floor(t.done * 100 / t.total)) : 0);

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
    const sub = entry.drive ? entry.drive.account
        : folder ? (entry.mtime ? shortDate(entry.mtime) : "") : `${formatSize(entry.size)} · ${entry.mtime ? shortDate(entry.mtime) : ""}`;
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
            <div className="pui-row-icon"><FileIcon kind={entry.drive ? "drive" : kindOf(entry)} /></div>
            <div className="pui-row-body">
                <div className="pui-row-title">{entry.drive ? entry.drive.title : entry.name}</div>
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

// A drive's upload or download under way: its progress and Cancel.
function TransferBar({ transfers, onCancel }: { transfers: Transfer[]; onCancel: (id: string) => void }) {
    if (!transfers.length) return null;
    const t = transfers[0];
    return (
        <div className="fm-transfer" data-testid="transfer" role="status">
            <div className="fm-transfer-text">
                {t.direction === "upload" ? "Uploading" : "Downloading"} {t.name}
                {transfers.length > 1 ? ` and ${transfers.length - 1} more` : ""} · {percent(t)}%
            </div>
            <div className="fm-transfer-bar"><div style={{ width: `${percent(t)}%` }} /></div>
            <button type="button" className="fm-transfer-cancel" data-testid="transfer-cancel" onClick={() => onCancel(t.id)}>Cancel</button>
        </div>
    );
}

function Browser() {
    const launch = useLaunchParams<{ path?: string; transfer?: string }>();
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
    const [drives, setDrives] = useState<FileEntry[]>([]);
    const [transfers, setTransfers] = useState<Transfer[]>([]);
    const [errorKind, setErrorKind] = useState<number | undefined>(undefined);
    const wide = useWide();
    const driveLabels = useMemo(() => driveNames(drives), [drives]);
    const title = (p: string) => folderTitle(p, driveLabels);
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
            setErrorKind(undefined);
        } catch (e) {
            setEntries([]);
            setError(errorText(e));
            setErrorKind(errorCode(e));
        }
        if (p === DRIVES_ROOT || p === "/media" || p === HOME) fileManager.drives().then(setDrives);
    }, [path]);

    useEffect(() => { setEntries(null); reload(path); }, [path, reload]);
    // The drive accounts: places beside the favourites (and again when an account is added).
    useEffect(() => {
        fileManager.drives().then(setDrives);
        const again = () => { if (document.visibilityState === "visible") fileManager.drives().then(setDrives); };
        document.addEventListener("visibilitychange", again);
        return () => document.removeEventListener("visibilitychange", again);
    }, []);
    // A drive's transfers while something is under way (or Files was opened for one).
    const watching = busy || !!launch.transfer;
    useEffect(() => {
        if (!watching) { setTransfers([]); return; }
        let live = true;
        const poll = () => fileManager.transfers().then((t) => { if (live) setTransfers(t); });
        poll();
        const timer = setInterval(poll, 400);
        return () => { live = false; clearInterval(timer); };
    }, [watching]);
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

    // A drive's file: its copy on the device (downloaded, with its progress), as an entry of the device.
    const local = async (e: FileEntry): Promise<FileEntry> => {
        if (!e.remote) return e;
        const r = await fileManager.open(e.path);
        if (r.stale) say("Offline: the copy kept on this device");
        return { ...e, path: r.path, remote: false };
    };

    const open = (e: FileEntry) => {
        if (e.type === "directory") { go(e.path); return; }
        const kind = kindOf(e);
        if (e.remote && !(opensAsText(e) && (kind === "text" || kind === "code" || kind === "file"))) {
            // Fetched first (the editor reads and saves through the drive itself).
            void run(async () => {
                const copy = await local(e);
                if (kind === "image") setViewer({ kind: "image", images: [copy], index: 0 });
                else if (kind === "package") setSheet({ kind: "install", entry: copy });
                else setSheet({ kind: "open-with", entry: copy });
            }, undefined, false);
            return;
        }
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

    const run = async (what: () => Promise<unknown>, done?: string, refresh = true) => {
        setBusy(true);
        try {
            await what();
            if (done) say(done);
        } catch (e) {
            say(errorCode(e) === FILE_ERRORS.CANCELED ? "Cancelled" : errorText(e));
        } finally {
            setBusy(false);
            if (refresh) reload();
        }
    };
    const cancelTransfer = (id: string) => { fileManager.cancel(id).catch(() => {}); };

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
        try {
            const entry = await fileManager.stat(e.path);
            // A drive's own folder: how full it is, where the drive says.
            const quota = entry.drive ? await fileManager.quota(entry.path).catch(() => undefined) : undefined;
            setSheet({ kind: "info", entry, quota });
        } catch (x) { say(errorText(x)); }
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
        else if (v === "info") showInfo({ path } as FileEntry);
        else if (v === "refresh") reload();
    };
    const favOptions: Option<string>[] = prefs.favorites.map((f) => ({ label: title(f), value: f }))
        .concat(drives.map((d) => ({ label: d.drive ? `${d.drive.title} (${d.drive.account})` : d.name, value: d.path })));
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
    // Share: files only (a folder is not something another app takes). A
    // drive's files are shared as their copies on the device.
    const shareable = chosen.length > 0 && chosen.every((e) => e.type === "file");
    const sharedFiles = () => chosen.map((e) => ({ path: e.path, mimeType: mimeOf(e.name) }));
    const share = async () => {
        let files = sharedFiles();
        try {
            if (chosen.some((e) => e.remote)) {
                setBusy(true);
                try { files = await Promise.all(chosen.map(async (e) => ({ path: (await local(e)).path, mimeType: mimeOf(e.name) }))); }
                finally { setBusy(false); }
            }
            const r = await shareSheet.open({ files });
            if (r.action === "cancel") return;
            if (r.action === "photos") say(files.length === 1 ? "Saved to Photos" : `Saved ${files.length} items to Photos`);
            else if (r.action === "files") say(`Saved to ${title(parentOf(r.path))}`);
            endSelect();
            reload();
        } catch (e) {
            say(errorText(e));
        }
    };
    const copyOrCut = (mode: Clipboard["mode"]) => {
        setClip({ mode, paths: chosen.map((e) => e.path) });
        say(`${chosen.length} item${chosen.length === 1 ? "" : "s"} ${mode === "cut" ? "cut" : "copied"}: go to a folder and paste`);
        endSelect();
    };

    const header = (
        <PageHeader icon="icon.png" title={<span data-testid="folder-title">{selecting ? `${chosen.length} selected` : title(path)}</span>}>
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
                     data-testid={`fav-${title(f)}`} onClick={() => go(f)}>
                    <FileIcon kind="folder" size={24} /> <span>{title(f)}</span>
                </div>
            ))}
            {drives.length > 0 && <div className="fm-favorites-title" data-testid="drives-title">Drives</div>}
            {drives.map((d) => (
                <div key={d.path} className={cx("fm-favorite", "fm-drive", driveRootOf(path) === d.path && "current")} role="button" tabIndex={0}
                     data-testid={`drive-${d.drive?.title ?? d.name}`} title={d.drive?.account} onClick={() => go(d.path)}>
                    <FileIcon kind="drive" size={24} />
                    <span className="fm-drive-text"><span>{d.drive?.title ?? d.name}</span><small>{d.drive?.account}</small></span>
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
            <AppMenu items={appMenu} share={selecting && shareable ? () => ({ files: sharedFiles() }) : undefined} onShare={() => void share()} />
            {wide && favorites}
            <div className="fm-main">
                {header}
                <div className="fm-path" ref={pathBar} data-testid="path-bar">
                    {crumbs(path, driveLabels).map((c, i, all) => (
                        <button key={c.path} type="button" className={cx("fm-crumb", i === all.length - 1 && "current")}
                                data-testid={`crumb-${i}`} onClick={() => go(c.path)}>{c.label}</button>
                    ))}
                </div>
                <div className="fm-scroll" data-testid="file-list">
                    {entries === null && <div className="fm-loading"><Spinner large /></div>}
                    {error && (
                        <div className="fm-empty" role="alert" data-testid="folder-error">
                            {errorKind === FILE_ERRORS.OFFLINE ? `${title(driveRootOf(path) ?? path)} can't be reached. Check your connection; nothing was lost.`
                                : errorKind === FILE_ERRORS.AUTH ? `${title(driveRootOf(path) ?? path)} did not accept the sign-in. Sign in again in Accounts.`
                                : error}
                            {isDrivePath(path) && (
                                <div className="fm-error-buttons">
                                    <button type="button" className="fm-retry" data-testid="retry" onClick={() => { setEntries(null); void reload(); }}>Try Again</button>
                                    {errorKind === FILE_ERRORS.AUTH && (
                                        <button type="button" className="fm-retry" data-testid="open-accounts"
                                                onClick={() => { void openWith.launchApp("com.palm.app.accounts"); }}>Accounts</button>
                                    )}
                                </div>
                            )}
                        </div>
                    )}
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
                {busy && !transfers.length && <div className="fm-busy"><Spinner /></div>}
                <TransferBar transfers={transfers} onCancel={cancelTransfer} />
                {selecting ? (
                    <Toolbar>
                        <IconToolButton icon="close" label="Done" testId="select-done" onClick={endSelect} />
                        <ToolSpacer />
                        <IconToolButton icon="copy" label="Copy" testId="copy" disabled={!chosen.length} onClick={() => copyOrCut("copy")} />
                        <IconToolButton icon="cut" label="Cut" testId="cut" disabled={!chosen.length || chosen.some((e) => e.readOnly)}
                                        onClick={() => copyOrCut("cut")} />
                        <IconToolButton icon="trash" label="Delete" testId="delete" disabled={!chosen.length || chosen.some((e) => e.readOnly)}
                                        onClick={() => setSheet({ kind: "delete", entries: chosen })} />
                        <IconToolButton icon="share" label="Share" testId="share" disabled={!shareable} onClick={() => void share()} />
                        <IconToolButton icon="menu" label="More" testId="more"
                                        onClick={() => { const a = document.querySelector<HTMLElement>("[data-testid='more']"); if (a) setMenu({ anchor: a, kind: "more" }); }} />
                    </Toolbar>
                ) : (
                    <Toolbar>
                        {!wide && <IconToolButton icon="star" label="Favorites" testId="favorites"
                                                  onClick={() => { const a = document.querySelector<HTMLElement>("[data-testid='favorites']"); if (a) setMenu({ anchor: a, kind: "favorites" }); }} />}
                        <IconToolButton icon="up" label="Up" testId="up" disabled={path === "/"}
                                        onClick={() => go(driveRootOf(path) === path ? DRIVES_ROOT : parentOf(path))} />
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
            {sheet?.kind === "info" && <InfoDialog entry={sheet.entry} quota={sheet.quota} onClose={() => setSheet(null)} />}
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
