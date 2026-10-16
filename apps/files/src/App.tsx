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
// - On a tablet or a desktop (not a phone, and a card at least 600 px
//   wide) the folders are in columns, as the Finder's and iPadOS Files'
//   column views show them: each folder opens in a column to the right of
//   its parent's, a file tapped shows its preview after the last column (a
//   second tap opens it), and the arrow keys, Enter and Backspace move
//   through them (Columns.tsx; @phoenix/ui ColumnView). View as List (the
//   header menu, or the switch beside the path bar) shows the list there
//   instead; the user's choice is kept with the other preferences. A phone,
//   or a card narrowed to a phone's width, shows the list, in the same folder.
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
    driveRootOf, DRIVES_ROOT, FILE_ERRORS, fileManager, formatSize, isDrivePath, isHidden, isInside, joinPath, kindOf, LunaError, mimeOf, openWith, opensAsText,
    parentOf, shareSheet, sortEntries, type FileEntry, type SortKey, type Transfer,
} from "@phoenix/luna";
import { useFormFactor, useLaunchParams } from "@phoenix/luna/react";
import {
    AppMenu, BackProvider, CheckBox, columnCursor, columnHold, columnKey, columnTap, ColumnNote, ColumnRow, ColumnView, cx, FileIcon, folderChain, Glyph,
    IconToolButton, PageHeader, PopupMenu, shownView, Spinner, Toolbar, ToolSpacer, useBack, useColumnsWidth, ViewSwitch,
    type ColumnMove, type ColumnState, type FolderView, type Option,
} from "@phoenix/ui";
import {
    columnRoot, crumbs, driveNames, folderProblem, folderTitle, HOME, loadPrefs, planPaste, savePrefs, shortDate, type Clipboard, type Prefs,
} from "./browse";
import { FilePreview } from "./Columns";
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
const errorReason = (e: unknown) => (e instanceof LunaError ? (e.reply as { reason?: string }).reason : undefined);
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
    const [errorWhy, setErrorWhy] = useState<string | undefined>(undefined);
    const wide = useWide();
    const driveLabels = useMemo(() => driveNames(drives), [drives]);
    const title = (p: string) => folderTitle(p, driveLabels);
    const pathBar = useRef<HTMLDivElement>(null);
    const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

    // Columns: offered on a tablet or a desktop with room for them, and
    // shown there unless the user chose the list (the owner, 16 October
    // 2026); a phone (or a card narrowed to a phone's width) shows the list.
    const formFactor = useFormFactor();
    const roomy = useColumnsWidth();
    const columnsFit = formFactor !== "phone" && roomy;
    const columns = shownView(prefs.view, columnsFit) === "columns";
    // The file marked in the current folder's column (its preview shows;
    // in select mode, the row the keys are on).
    const [peek, setPeek] = useState<string | null>(null);
    // The first column: the place the folder is in, kept while the folders
    // opened stay inside it (columnRoot), chosen again from a favourite.
    const [colRoot, setColRoot] = useState(() => columnRoot(launch.path || HOME));
    const root = isInside(path, colRoot) ? colRoot : columnRoot(path);
    useEffect(() => { if (root !== colRoot) setColRoot(root); }, [root, colRoot]);
    const folders = useMemo(() => folderChain(root, path), [root, path]);
    // The folders' listings: the current folder's as it is read, the
    // columns before it read once each (again with Refresh).
    const [listed, setListed] = useState<Record<string, { list: FileEntry[]; error?: string }>>({});
    const listedRef = useRef(listed);
    listedRef.current = listed;
    const [refreshed, setRefreshed] = useState(0);

    const setPrefs = (p: Partial<Prefs>) => setPrefsState((old) => { const n = { ...old, ...p }; savePrefs(n); return n; });
    const setView = (v: FolderView) => { setPrefs({ view: v }); setPeek(null); };
    const say = useCallback((text: string) => {
        setToast(text);
        if (toastTimer.current) clearTimeout(toastTimer.current);
        toastTimer.current = setTimeout(() => setToast(""), 2500);
    }, []);

    const reload = useCallback(async (p = path) => {
        try {
            const list = await fileManager.list(p);
            setEntries(list);
            setListed((m) => ({ ...m, [p]: { list } }));
            setError("");
            setErrorKind(undefined);
            setErrorWhy(undefined);
        } catch (e) {
            setEntries([]);
            setError(errorText(e));
            setErrorKind(errorCode(e));
            setErrorWhy(errorReason(e));
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
    useEffect(() => { if (launch.path) { setPath(launch.path); setHistory([]); setColRoot(columnRoot(launch.path)); } }, [launch.path]);
    useEffect(() => { pathBar.current?.scrollTo?.({ left: 1e6 }); }, [path]);

    const visible = useCallback((list: FileEntry[]) => sortEntries(list.filter((e) => prefs.showHidden || !isHidden(e)), prefs.sort),
                                [prefs.showHidden, prefs.sort]);
    const shown = useMemo(() => visible(entries ?? []), [entries, visible]);
    const names = useMemo(() => (entries ?? []).map((e) => e.name), [entries]);
    const chosen = shown.filter((e) => selected.has(e.path));

    // The columns before the current folder's: each read when it first shows
    // (and again with Refresh); folders no longer shown are let go.
    const chainKey = folders.join("\n");
    const seenRefresh = useRef(refreshed);
    useEffect(() => {
        if (!columns) return;
        let live = true;
        const force = seenRefresh.current !== refreshed;
        seenRefresh.current = refreshed;
        setListed((m) => {
            const kept: typeof m = {};
            for (const f of folders) if (m[f]) kept[f] = m[f];
            return kept;
        });
        for (const f of folders.slice(0, -1)) {
            if (!force && listedRef.current[f]) continue;
            fileManager.list(f).then((list) => { if (live) setListed((m) => ({ ...m, [f]: { list } })); },
                                     (e) => { if (live) setListed((m) => ({ ...m, [f]: { list: [], error: errorText(e) } })); });
        }
        return () => { live = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [columns, chainKey, refreshed]);
    const last = folders.length - 1;
    const colEntries = useMemo(() => folders.map((f, i) => (i === last ? (entries === null ? null : shown) : listed[f] ? visible(listed[f].list) : null)),
                               [folders, last, entries, shown, listed, visible]);
    const peekEntry = peek !== null && parentOf(peek) === path ? shown.find((e) => e.path === peek) : undefined;
    // The file previewed (select mode has none).
    const previewEntry = columns && !selecting && peekEntry?.type === "file" ? peekEntry : undefined;
    const colState: ColumnState = {
        folders,
        items: colEntries.map((l) => (l ?? []).map((e) => ({ key: e.path, folder: e.type === "directory" }))),
        peek: peekEntry && (selecting || peekEntry.type === "file") ? peekEntry.path : null,
        selecting,
    };
    const cursor = columns ? columnCursor(colState) : null;

    const endSelect = () => { setSelecting(false); setSelected(new Set()); setPeek(null); };
    // reroot: a favourite, a drive or the path bar picks the first column again.
    // replace: the arrow keys walking a column of folders are one step back, not one a folder.
    const go = (p: string, how: { reroot?: boolean; replace?: boolean } = {}) => {
        if (how.reroot) setColRoot(columnRoot(p));
        setPeek(null);
        if (p === path) return;
        if (!how.replace) setHistory((h) => [...h, path]);
        setPath(p);
        endSelect();
    };
    const goUp = () => go(driveRootOf(path) === path ? DRIVES_ROOT : parentOf(path));
    const toggle = (e: FileEntry) => setSelected((s) => {
        const n = new Set(s);
        if (n.has(e.path)) n.delete(e.path); else n.add(e.path);
        return n;
    });

    useBack(() => { endSelect(); return true; }, selecting && !viewer);
    // Back closes a file's preview first, then goes back through the folders visited.
    useBack(() => {
        if (previewEntry) { setPeek(null); return true; }
        if (!history.length) return false;
        const prev = history[history.length - 1];
        setHistory((h) => h.slice(0, -1));
        setPath(prev);
        return true;
    }, !selecting && !viewer && (history.length > 0 || !!previewEntry));

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
    // "Open With..." for a file (a drive's: its copy on the device, fetched first, as open does).
    const openWithSheet = (e: FileEntry) => {
        if (!e.remote) { setSheet({ kind: "open-with", entry: e }); return; }
        void run(async () => setSheet({ kind: "open-with", entry: await local(e) }), undefined, false);
    };

    // A tap, a hold or a key in the columns (@phoenix/ui columnTap, columnHold, columnKey).
    const move = (m: ColumnMove | null, byKey = false): boolean => {
        if (!m) return false;
        const entry = (key: string) => shown.find((e) => e.path === key);
        switch (m.kind) {
            case "open":
                go(m.key, { replace: byKey && m.key !== path && parentOf(m.key) === parentOf(path) });
                return true;
            case "peek":
                if (m.folder !== path) go(m.folder, { replace: byKey });
                setPeek(m.key);
                return true;
            case "launch": { const e = entry(m.key); if (e) open(e); return true; }
            case "toggle": { const e = entry(m.key); if (e) toggle(e); return true; }
            case "select":
                if (m.folder !== path) go(m.folder);
                setSelecting(true);
                setSelected(new Set([m.key]));
                setPeek(m.key);
                return true;
            case "up":
                if (path === "/") return false;
                goUp();
                return true;
        }
    };
    const columnItem = (e: FileEntry) => ({ key: e.path, folder: e.type === "directory" });

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
        ...(columnsFit ? [{ label: columns ? "View as List" : "View as Columns", value: "view" }] : []),
        { label: isFavorite ? "Remove from Favorites" : "Add to Favorites", value: "favorite" },
        { label: "Select Items", value: "select" },
        { label: "Folder Info", value: "info" },
        { label: "Refresh", value: "refresh" },
    ];
    const onMain = (v: string) => {
        if (v.startsWith("sort:")) setPrefs({ sort: v.slice(5) as SortKey });
        else if (v === "hidden") setPrefs({ showHidden: !prefs.showHidden });
        else if (v === "view") setView(columns ? "list" : "columns");
        else if (v === "favorite") {
            setPrefs({ favorites: isFavorite ? prefs.favorites.filter((f) => f !== path) : [...prefs.favorites, path] });
            say(isFavorite ? "Removed from Favorites" : "Added to Favorites");
        } else if (v === "select") setSelecting(true);
        else if (v === "info") showInfo({ path } as FileEntry);
        else if (v === "refresh") { reload(); setRefreshed((n) => n + 1); }
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
    // drive's files are shared as their copies on the device. What is
    // selected, or the file previewed in the columns.
    const shareable = chosen.length > 0 && chosen.every((e) => e.type === "file");
    const sharing = selecting ? chosen : previewEntry ? [previewEntry] : [];
    const sharedFiles = (items = sharing) => items.map((e) => ({ path: e.path, mimeType: mimeOf(e.name) }));
    const share = async (items = sharing) => {
        let files = sharedFiles(items);
        try {
            if (items.some((e) => e.remote)) {
                setBusy(true);
                try { files = await Promise.all(items.map(async (e) => ({ path: (await local(e)).path, mimeType: mimeOf(e.name) }))); }
                finally { setBusy(false); }
            }
            const r = await shareSheet.open({ files });
            if (r.action === "cancel") return;
            if (r.action === "photos") say(files.length === 1 ? "Saved to Photos" : `Saved ${files.length} items to Photos`);
            else if (r.action === "files") say(`Saved to ${title(parentOf(r.path))}`);
            if (selecting) endSelect();
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
                     data-testid={`fav-${title(f)}`} onClick={() => go(f, { reroot: true })}>
                    <FileIcon kind="folder" size={24} /> <span>{title(f)}</span>
                </div>
            ))}
            {drives.length > 0 && <div className="fm-favorites-title" data-testid="drives-title">Drives</div>}
            {drives.map((d) => (
                <div key={d.path} className={cx("fm-favorite", "fm-drive", driveRootOf(path) === d.path && "current")} role="button" tabIndex={0}
                     data-testid={`drive-${d.drive?.title ?? d.name}`} title={d.drive?.account} onClick={() => go(d.path, { reroot: true })}>
                    <FileIcon kind="drive" size={24} />
                    <span className="fm-drive-text"><span>{d.drive?.title ?? d.name}</span><small>{d.drive?.account}</small></span>
                </div>
            ))}
        </nav>
    );

    // The current folder being read, out of reach, empty: the list says so, and so does its column.
    const folderStatus = (
        <>
            {entries === null && <div className="fm-loading"><Spinner large /></div>}
            {error && (() => {
                const problem = folderProblem(errorKind, errorWhy, error, title(driveRootOf(path) ?? path));
                return (
                <div className={cx("fm-empty", problem.warning && "fm-warning")} role="alert" data-testid="folder-error">
                    {problem.message}
                    {isDrivePath(path) && (
                        <div className="fm-error-buttons">
                            <button type="button" className="fm-retry" data-testid="retry" onClick={() => { setEntries(null); void reload(); }}>Try Again</button>
                            {problem.accounts && (
                                <button type="button" className="fm-retry" data-testid="open-accounts"
                                        onClick={() => { void openWith.launchApp("com.palm.app.accounts"); }}>Accounts</button>
                            )}
                        </div>
                    )}
                </div>
                );
            })()}
            {entries !== null && !error && shown.length === 0 && (
                <div className="fm-empty" data-testid="empty">
                    {entries.length ? "Only hidden files here. Show them from the menu." : "This folder is empty."}
                </div>
            )}
        </>
    );

    const pathBarEl = (
        <div className="fm-path" ref={pathBar} data-testid="path-bar">
            {crumbs(path, driveLabels).map((c, i, all) => (
                <button key={c.path} type="button" className={cx("fm-crumb", i === all.length - 1 && "current")}
                        data-testid={`crumb-${i}`} onClick={() => go(c.path, { reroot: true })}>{c.label}</button>
            ))}
        </div>
    );

    // A column's rows: the folder open beside it marked, the keyboard's row,
    // select mode's check boxes in the current folder's column.
    const columnContent = (i: number) => {
        const list = colEntries[i];
        const rows = (list ?? []).map((e) => {
            const here = i === last;
            return (
                <ColumnRow key={e.path} testId={`col-${e.name}`} path={e.path}
                           icon={<FileIcon kind={e.drive ? "drive" : kindOf(e)} size={24} />}
                           label={e.drive ? e.drive.title : e.name} detail={e.drive?.account}
                           folder={e.type === "directory"} dim={isHidden(e)}
                           open={!here && e.path === folders[i + 1]}
                           cursor={!selecting && cursor?.column === i && cursor.key === e.path}
                           focus={selecting && cursor?.column === i && cursor.key === e.path}
                           selected={selecting && here && selected.has(e.path)}
                           end={selecting && here
                               ? <CheckBox checked={selected.has(e.path)} onChange={() => toggle(e)} label={`Select ${e.name}`} testId={`check-${e.name}`} />
                               : undefined}
                           onTap={() => move(columnTap(colState, i, columnItem(e)))}
                           onHold={() => move(columnHold(colState, i, columnItem(e)))} />
            );
        });
        if (i === last) return <>{folderStatus}{rows}</>;
        const l = listed[folders[i]];
        if (!l) return <div className="fm-loading small"><Spinner /></div>;
        if (l.error) return <ColumnNote>{l.error}</ColumnNote>;
        return rows;
    };

    // The app menu: new items, then the folder menu's entries.
    const appMenu = [
        { label: "New Folder", onSelect: () => setSheet({ kind: "new-folder" }) },
        { label: "New File", onSelect: () => setSheet({ kind: "new-file" }) },
        ...mainMenu.map((o) => ({ label: o.label, disabled: o.disabled, onSelect: () => onMain(o.value) })),
    ];

    return (
        <div className={cx("fm-app", wide && "wide")}>
            <AppMenu items={appMenu} share={(selecting && shareable) || previewEntry ? () => ({ files: sharedFiles() }) : undefined} onShare={() => void share()} />
            {wide && favorites}
            <div className="fm-main">
                {header}
                {columnsFit ? <div className="fm-pathrow">{pathBarEl}<ViewSwitch value={columns ? "columns" : "list"} onChange={setView} /></div> : pathBarEl}
                {columns ? (
                    <ColumnView className="fm-columns" testId="columns" cursor={cursor?.key}
                                columns={folders.map((f, i) => ({ key: f, testId: `column-${i}`, content: columnContent(i) }))}
                                preview={previewEntry && (
                                    <FilePreview entry={previewEntry} place={title(driveRootOf(previewEntry.path) ?? "")}
                                                 onOpen={() => open(previewEntry)} onShare={() => void share([previewEntry])}
                                                 onOpenWith={() => openWithSheet(previewEntry)} onInfo={() => void showInfo(previewEntry)} />
                                )}
                                onKey={!sheet && !viewer && !menu ? (key) => move(columnKey(colState, key), true) : undefined} />
                ) : (
                <div className="fm-scroll" data-testid="file-list">
                    {folderStatus}
                    <div className="fm-list">
                        {shown.map((e) => (
                            <FileRow key={e.path} entry={e} selecting={selecting} selected={selected.has(e.path)}
                                     onTap={() => open(e)} onToggle={() => toggle(e)}
                                     onHold={() => { setSelecting(true); setSelected(new Set([e.path])); }} />
                        ))}
                    </div>
                </div>
                )}
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
                        <IconToolButton icon="up" label="Up" testId="up" disabled={path === "/"} onClick={goUp} />
                        <ToolSpacer />
                        {clip && <IconToolButton icon="paste" label="Paste" caption={String(clip.paths.length)} testId="paste" onClick={paste} />}
                        <IconToolButton icon="plus" label="New" testId="new"
                                        onClick={() => { const a = document.querySelector<HTMLElement>("[data-testid='new']"); if (a) setMenu({ anchor: a, kind: "new" }); }} />
                        <IconToolButton icon="check" label="Select" testId="select" onClick={() => setSelecting(true)} />
                    </Toolbar>
                )}
            </div>

            {menu?.kind === "main" && <PopupMenu options={mainMenu} value={`sort:${prefs.sort}`} anchor={menu.anchor} onSelect={onMain} onClose={() => setMenu(null)} />}
            {menu?.kind === "favorites" && <PopupMenu options={favOptions} value={path} anchor={menu.anchor} onSelect={(f) => go(f, { reroot: true })} onClose={() => setMenu(null)} />}
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
