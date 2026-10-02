// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The system's share sheet and save picker (docs/SHARE-AND-FILES.md): a
// page the runtime lays over the app that asks (org.webosphoenix.share/open,
// org.webosphoenix.filepicker/save), so every app gets the same ones.
//
//   share  What is shared (a picture's thumbnail, its name); a row of the
//          apps that take it (two rows when there are many), scrolling
//          sideways; then the system's actions as menu rows: Save to Photos,
//          Save to Files..., Copy. The webOS popup art, laid out the way the
//          latest iOS sheet mixes icons and a list.
//   save   A folder of /media/internal (the last one used first), its
//          subfolders, New Folder, the file's name; Replace asks first.
//
// It talks to the page under it with postMessage: "ready", then the
// request; "done" with the choice. The back gesture comes as "back".

import { useCallback, useEffect, useRef, useState } from "react";
import { fileManager, joinPath, LunaError, parentOf, type FileEntry } from "@phoenix/luna";
import { useLaunchParams, useMediaUrl } from "@phoenix/luna/react";
import { Button, Dialog, FileIcon, Spinner, TextField } from "@phoenix/ui";

const MEDIA = "/media/internal";
const PHOTOS_ICON = "/usr/palm/applications/org.webosphoenix.photos/icon.png";

interface SharedFile { path: string; mimeType: string }
interface Share { title: string; text: string; url: string; files: SharedFile[] }
interface Target { appId: string; title: string; icon: string; label: string }
interface ShareRequest { share: Share; targets: Target[] }
interface SaveRequest { name: string; title: string; folder: string }
type Request = ShareRequest | SaveRequest;
type Result =
    | { action: "app"; appId: string }
    | { action: "photos" | "files" | "copy" | "cancel" }
    | { action: "save"; folder: string; name: string; overwrite: boolean };

const baseName = (p: string) => p.replace(/^.*\//, "");
const isPicture = (f: SharedFile) => /^image\//.test(f.mimeType) || /\.(png|jpe?g|gif|webp|bmp)$/i.test(f.path);
const isVideo = (f: SharedFile) => /^video\//.test(f.mimeType) || /\.(mp4|m4v|mov|webm)$/i.test(f.path);
const folderTitle = (p: string) => (p === MEDIA ? "Internal Storage" : baseName(p));

async function copyText(text: string): Promise<boolean> {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch {
        const ta = document.createElement("textarea");
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        let done = false;
        try { done = document.execCommand("copy"); } catch { done = false; }
        ta.remove();
        return done;
    }
}

export function App() {
    const params = useLaunchParams<{ kind?: "share" | "save"; id?: string }>();
    const [request, setRequest] = useState<Request | null>(null);
    const [leaving, setLeaving] = useState(false);
    const backHandler = useRef<() => void>(() => {});

    const finish = useCallback((result: Result) => {
        setLeaving(true);
        // The page under it lifts its dimming while the sheet slides away,
        // then hears the choice.
        window.parent.postMessage({ phoenixSheet: params.id, type: "leaving" }, "*");
        window.setTimeout(() => window.parent.postMessage({ phoenixSheet: params.id, type: "done", result }, "*"), 180);
    }, [params.id]);

    useEffect(() => {
        const onMessage = (e: MessageEvent) => {
            const m = e.data as { phoenixSheet?: string; type?: string; request?: Request };
            if (!m || m.phoenixSheet !== params.id) return;
            if (m.type === "request" && m.request) setRequest(m.request);
            else if (m.type === "back") backHandler.current();
        };
        window.addEventListener("message", onMessage);
        if (window.parent !== window) window.parent.postMessage({ phoenixSheet: params.id, type: "ready" }, "*");
        return () => window.removeEventListener("message", onMessage);
    }, [params.id]);

    // Escape on a hardware keyboard, as the back gesture.
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== "Escape" || e.defaultPrevented) return;
            e.preventDefault();
            backHandler.current();
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, []);

    return (
        <div className={"ss-overlay" + (leaving ? " leaving" : "")} data-testid="sheet-overlay">
            <div className="ss-scrim" onClick={() => finish({ action: "cancel" })} />
            {request && params.kind === "share" && "share" in request && (
                <ShareSheet request={request} finish={finish} backHandler={backHandler} />
            )}
            {request && params.kind === "save" && "folder" in request && (
                <SavePicker request={request} finish={finish} backHandler={backHandler} />
            )}
        </div>
    );
}

interface SheetProps<R> {
    request: R;
    finish: (r: Result) => void;
    backHandler: React.MutableRefObject<() => void>;
}

// ---- Share ---------------------------------------------------------------------------

function ShareSheet({ request, finish, backHandler }: SheetProps<ShareRequest>) {
    const { share, targets } = request;
    const first = share.files[0];
    const thumb = useMediaUrl(first && isPicture(first) ? first.path : undefined);
    backHandler.current = () => finish({ action: "cancel" });
    const title = share.title || (first ? baseName(first.path) : share.url || "Share");
    const subtitle = share.files.length > 1 ? `${share.files.length} files`
        : first ? (isPicture(first) ? "Picture" : isVideo(first) ? "Video" : "File")
        : share.url ? share.url : "Text";
    // Two rows of apps once one row would scroll a long way.
    const rows = targets.length > 8 ? 2 : 1;
    const copyable = share.text || share.url;

    return (
        <div className="ss-sheet" role="dialog" aria-label="Share" data-testid="share-sheet">
            <div className="ss-head">
                {thumb ? <img className="ss-thumb" src={thumb} alt="" data-testid="share-thumb" />
                    : <div className="ss-thumb ss-thumb-icon"><FileIcon kind={first ? (isVideo(first) ? "video" : "file") : "text"} size={40} /></div>}
                <div className="ss-head-text">
                    <div className="ss-title" data-testid="share-title">{title}</div>
                    <div className="ss-subtitle">{subtitle}</div>
                </div>
            </div>
            {targets.length > 0 && (
                <div className="ss-apps" style={{ gridTemplateRows: `repeat(${rows}, auto)` }} data-testid="share-apps">
                    {targets.map((t) => (
                        <button key={t.appId} type="button" className="ss-app" data-testid={"share-app-" + t.appId}
                                onClick={() => finish({ action: "app", appId: t.appId })}>
                            <img src={t.icon} alt="" />
                            <span>{t.label}</span>
                        </button>
                    ))}
                </div>
            )}
            <div className="ss-actions">
                {first && (isPicture(first) || isVideo(first)) && (
                    <div className="pui-menu-item" role="button" data-testid="share-photos" onClick={() => finish({ action: "photos" })}>
                        <span className="pui-menu-label">Save to Photos</span>
                        <img className="ss-action-icon" src={PHOTOS_ICON} alt="" />
                    </div>
                )}
                {first && (
                    <div className="pui-menu-item" role="button" data-testid="share-files" onClick={() => finish({ action: "files" })}>
                        <span className="pui-menu-label">Save to Files…</span>
                        <span className="ss-action-icon"><FileIcon kind="folder" size={28} /></span>
                    </div>
                )}
                {copyable && (
                    <div className="pui-menu-item" role="button" data-testid="share-copy"
                         onClick={() => void copyText([share.text, share.url].filter(Boolean).join("\n")).then(() => finish({ action: "copy" }))}>
                        <span className="pui-menu-label">{share.url && !share.text ? "Copy Link" : "Copy"}</span>
                    </div>
                )}
            </div>
            <Button onClick={() => finish({ action: "cancel" })} data-testid="share-cancel">Cancel</Button>
        </div>
    );
}

// ---- Save to Files -----------------------------------------------------------------------

function SavePicker({ request, finish, backHandler }: SheetProps<SaveRequest>) {
    const [folder, setFolder] = useState<string | null>(null);
    const [entries, setEntries] = useState<FileEntry[] | null>(null);
    const [name, setName] = useState(request.name);
    const [newFolder, setNewFolder] = useState<string | null>(null);
    const [replace, setReplace] = useState(false);
    const [error, setError] = useState("");

    const open = useCallback(async (path: string) => {
        setEntries(null);
        try {
            const list = await fileManager.list(path);
            setFolder(path);
            setEntries(list.filter((e) => e.type === "directory" && !e.name.startsWith(".")).sort((a, b) => a.name.localeCompare(b.name)));
        } catch {
            // The last folder is gone: up to Documents, then the top.
            if (path !== MEDIA) void open(path === MEDIA + "/Documents" ? MEDIA : MEDIA + "/Documents");
        }
    }, []);
    useEffect(() => { void open(request.folder.indexOf(MEDIA) === 0 ? request.folder : MEDIA); }, [open, request.folder]);

    backHandler.current = () => {
        if (newFolder !== null) setNewFolder(null);
        else if (replace) setReplace(false);
        else if (folder && folder !== MEDIA) void open(parentOf(folder));
        else finish({ action: "cancel" });
    };

    const clean = name.trim().replace(/[\/\\]/g, "-");
    const save = async (overwrite: boolean) => {
        if (!folder || !clean) return;
        if (!overwrite) {
            const exists = await fileManager.stat(joinPath(folder, clean)).then(() => true, () => false);
            if (exists) return setReplace(true);
        }
        finish({ action: "save", folder, name: clean, overwrite });
    };
    const makeFolder = async () => {
        const n = (newFolder ?? "").trim().replace(/[\/\\]/g, "-");
        if (!folder || !n) return;
        try {
            await fileManager.mkdir(joinPath(folder, n));
            setNewFolder(null);
            await open(joinPath(folder, n));
        } catch (e) {
            setError(e instanceof LunaError ? e.errorText : "Could not make the folder");
        }
    };

    return (
        <div className="ss-sheet ss-save" role="dialog" aria-label={request.title} data-testid="save-picker">
            <div className="ss-save-head">
                <button type="button" className="ss-up" disabled={!folder || folder === MEDIA} aria-label="Up"
                        data-testid="save-up" onClick={() => folder && void open(parentOf(folder))} />
                <div className="ss-title" data-testid="save-folder">{folder ? folderTitle(folder) : request.title}</div>
                <button type="button" className="ss-link" data-testid="save-new-folder" disabled={!folder} onClick={() => setNewFolder("")}>New Folder</button>
            </div>
            <div className="ss-folders" data-testid="save-folders">
                {entries === null ? <div className="ss-loading"><Spinner /></div>
                    : entries.length === 0 ? <div className="ss-empty">No folders here</div>
                    : entries.map((e) => (
                        <div key={e.path} className="pui-menu-item" role="button" data-testid={"save-folder-" + e.name} onClick={() => void open(e.path)}>
                            <FileIcon kind="folder" size={28} />
                            <span className="pui-menu-label">{e.name}</span>
                            <span className="pui-row-chevron" />
                        </div>
                    ))}
            </div>
            <TextField label="Name" value={name} onChange={setName} onSubmit={() => void save(false)} testId="save-name" />
            {error && <div className="ss-error">{error}</div>}
            <div className="ss-buttons">
                <Button onClick={() => finish({ action: "cancel" })} data-testid="save-cancel">Cancel</Button>
                <Button variant="affirmative" disabled={!folder || !clean} onClick={() => void save(false)} data-testid="save-confirm">Save</Button>
            </div>
            <Dialog open={newFolder !== null} title="New Folder" onClose={() => setNewFolder(null)} testId="new-folder-dialog">
                <TextField value={newFolder ?? ""} onChange={setNewFolder} onSubmit={() => void makeFolder()} autoFocus testId="new-folder-name" />
                <Button variant="affirmative" disabled={!(newFolder ?? "").trim()} onClick={() => void makeFolder()} data-testid="new-folder-create">Create</Button>
                <Button onClick={() => setNewFolder(null)}>Cancel</Button>
            </Dialog>
            <Dialog open={replace} title={`Replace "${clean}"?`} message="A file with this name is already in this folder." onClose={() => setReplace(false)} testId="replace-dialog">
                <Button variant="negative" onClick={() => { setReplace(false); void save(true); }} data-testid="replace-confirm">Replace</Button>
                <Button onClick={() => setReplace(false)}>Cancel</Button>
            </Dialog>
        </div>
    );
}
