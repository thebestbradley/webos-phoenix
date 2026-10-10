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
//   pick   luna-systemui's file picker in this look: the kind first when
//          there are several, pictures album by album (Camera Roll first),
//          videos, music, documents, any file by folder; one file or
//          several; a crop frame for a picture
//          (org.webosphoenix.filepicker/pick, SF2).
//   signin The system's browser sheet for an OAuth sign-in
//          (org.webosphoenix.service.oauth authorize; docs/SYNERGY-CONNECTORS.md
//          4.1): the provider's own page in a web view, its address above
//          it, Cancel; it closes when the page goes to the redirect address.
//          The app that asked cannot read the page: it only hears that
//          address back (the code), from the OAuth service.
//
// It talks to the page under it with postMessage: "ready", then the
// request; "done" with the choice. The back gesture comes as "back".

import { useCallback, useEffect, useRef, useState } from "react";
import {
    extensionOf, fileManager, fileUrl, findFiles, formatSize, joinPath, kindOf, LunaError, mediaIndexer, mediaUrl, mimeOf, parentOf,
    type AudioItem, type CropInfo, type FileEntry, type ImageItem, type PickKind, type VideoItem,
} from "@phoenix/luna";
import { useLaunchParams, useMediaUrl } from "@phoenix/luna/react";
import { Button, Checkmark, Dialog, FileIcon, Slider, Spinner, TextField, type FileIconKind } from "@phoenix/ui";

const MEDIA = "/media/internal";
const PHOTOS_ICON = "/usr/palm/applications/org.webosphoenix.photos/icon.png";

interface SharedFile { path: string; mimeType: string }
interface Picked extends SharedFile { size?: number; cropInfo?: CropInfo }
interface Share { title: string; text: string; url: string; files: SharedFile[] }
interface Target { appId: string; title: string; icon: string; label: string }
interface ShareRequest { share: Share; targets: Target[] }
interface SaveRequest { name: string; title: string; folder: string }
interface PickRequest { title: string; kinds: PickKind[]; multiple: boolean; crop: { width: number; height: number } | null; extensions: string[] }
interface SignInRequest { url: string; redirectPrefix: string }
type Request = ShareRequest | SaveRequest | PickRequest | SignInRequest;
type Result =
    | { action: "redirect"; url: string }
    | { action: "app"; appId: string }
    | { action: "photos" | "files" | "copy" | "cancel" }
    | { action: "save"; folder: string; name: string; overwrite: boolean }
    | { action: "pick"; files: Picked[] };

const baseName = (p: string) => p.replace(/^.*\//, "");
const isPicture = (f: SharedFile) => /^image\//.test(f.mimeType) || /\.(png|jpe?g|gif|webp|bmp)$/i.test(f.path);
const isVideo = (f: SharedFile) => /^video\//.test(f.mimeType) || /\.(mp4|m4v|mov|webm)$/i.test(f.path);
const isAudio = (f: SharedFile) => /^audio\//.test(f.mimeType) || /\.(wav|mp3|ogg|oga|m4a|aac|flac)$/i.test(f.path);
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
    const params = useLaunchParams<{ kind?: "share" | "save" | "pick" | "signin"; id?: string }>();
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
            {request && params.kind === "signin" && "redirectPrefix" in request && (
                <SignInSheet request={request} finish={finish} backHandler={backHandler} />
            )}
            {request && params.kind === "pick" && "kinds" in request && (
                <FilePicker request={{ ...request, kinds: request.kinds.length ? request.kinds : ["image"], multiple: !!request.multiple,
                                       crop: request.crop ?? null, extensions: request.extensions ?? [] }}
                            finish={finish} backHandler={backHandler} />
            )}
        </div>
    );
}

interface SheetProps<R> {
    request: R;
    finish: (r: Result) => void;
    backHandler: React.MutableRefObject<() => void>;
}

// ---- Sign in -------------------------------------------------------------------------

/** The scripting API the runtime gives an <object type="application/x-palm-browser"> (BrowserAdapter). */
interface WebViewNode extends HTMLObjectElement {
    eventListener?: Record<string, (...args: never[]) => void>;
    connectBrowserServer?: () => void;
    disconnectBrowserServer?: () => void;
    openURL?: (url: string) => void;
}

function addressParts(url: string): { host: string; rest: string; secure: boolean } {
    try {
        const u = new URL(url);
        return { host: u.host, rest: u.pathname === "/" ? "" : u.pathname, secure: u.protocol === "https:" };
    } catch {
        return { host: url, rest: "", secure: false };
    }
}

function SignInSheet({ request, finish, backHandler }: SheetProps<SignInRequest>) {
    const view = useRef<WebViewNode>(null);
    const [address, setAddress] = useState(request.url);
    const [loading, setLoading] = useState(true);
    // The view goes first: in phoenix-sim it is a native view over the
    // sheet, which would otherwise stay while the sheet slides away.
    const close = useCallback((r: Result) => {
        view.current?.disconnectBrowserServer?.();
        finish(r);
    }, [finish]);
    backHandler.current = () => close({ action: "cancel" });
    useEffect(() => {
        const node = view.current;
        if (!node) return;
        let done = false;
        node.eventListener = {
            urlTitleChanged: (url: string) => {
                if (done || !url) return;
                // The redirect: the sign-in is over. The page is not shown.
                if (url.indexOf(request.redirectPrefix) === 0) {
                    done = true;
                    close({ action: "redirect", url });
                    return;
                }
                setAddress(url);
            },
            loadStarted: () => setLoading(true),
            loadStopped: () => setLoading(false),
            documentLoadFinished: () => setLoading(false),
        };
        node.connectBrowserServer?.();
        node.openURL?.(request.url);
        return () => {
            done = true;
            node.disconnectBrowserServer?.();
        };
    }, [request.url, request.redirectPrefix, close]);
    const a = addressParts(address);
    return (
        <div className="ss-sheet ss-signin" role="dialog" aria-label="Sign In" data-testid="signin-sheet">
            <div className="ss-signin-bar">
                <span className={"ss-signin-lock" + (a.secure ? " secure" : "")} title={a.secure ? "Encrypted connection" : "Not encrypted"}
                      aria-label={a.secure ? "Encrypted connection" : "Not encrypted"} data-testid="signin-lock" />
                <div className="ss-signin-address" data-testid="signin-address"><b>{a.host}</b><span>{a.rest}</span></div>
                {loading && <Spinner />}
                <button type="button" className="ss-signin-cancel" onClick={() => close({ action: "cancel" })} data-testid="signin-cancel">Cancel</button>
            </div>
            <div className="ss-signin-note">Sign in on your server's own page. Phoenix never sees your password.</div>
            <object type="application/x-palm-browser" ref={view} className="ss-signin-view" data-testid="signin-view" />
        </div>
    );
}

// ---- Share ---------------------------------------------------------------------------

/** A picture's URL wherever it is: the file store (Files' folders), else the
    media store (a capture just saved). */
function usePictureUrl(path: string | undefined): string | undefined {
    const [url, setUrl] = useState<{ path: string; url: string }>();
    useEffect(() => {
        if (!path) return;
        let live = true;
        fileUrl(path).then((u) => (u === path ? mediaUrl(path) : u)).then((u) => { if (live) setUrl({ path, url: u }); }, () => {});
        return () => { live = false; };
    }, [path]);
    return url && url.path === path ? url.url : undefined;
}

function ShareSheet({ request, finish, backHandler }: SheetProps<ShareRequest>) {
    const { share, targets } = request;
    const first = share.files[0];
    const thumb = usePictureUrl(first && isPicture(first) ? first.path : undefined);
    backHandler.current = () => finish({ action: "cancel" });
    const title = share.title || (share.files.length > 1 ? `${baseName(first.path)} and ${share.files.length - 1} more`
        : first ? baseName(first.path) : share.url || "Share");
    const subtitle = share.files.length > 1 ? `${share.files.length} files`
        : first ? (isPicture(first) ? "Picture" : isVideo(first) ? "Video" : isAudio(first) ? "Audio" : "File")
        : share.url ? share.url : "Text";
    // Two rows of apps once one row would scroll a long way.
    const rows = targets.length > 8 ? 2 : 1;
    const copyable = share.text || share.url;

    return (
        <div className="ss-sheet" role="dialog" aria-label="Share" data-testid="share-sheet">
            <div className="ss-head">
                {thumb ? <img className="ss-thumb" src={thumb} alt="" data-testid="share-thumb" />
                    : <div className="ss-thumb ss-thumb-icon"><FileIcon kind={first ? (isVideo(first) ? "video" : isAudio(first) ? "audio" : kindOf({ name: baseName(first.path), type: "file" })) : "text"} size={40} /></div>}
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
                {first && share.files.every((f) => isPicture(f) || isVideo(f)) && (
                    <div className="pui-menu-item" role="button" data-testid="share-photos" onClick={() => finish({ action: "photos" })}>
                        <span className="pui-menu-label">Save to Photos</span>
                        <img className="ss-action-icon" src={PHOTOS_ICON} alt="" />
                    </div>
                )}
                {share.files.length === 1 && (
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

// ---- Choose a file -------------------------------------------------------------------
//
// luna-systemui's file picker, in this sheet's look (FilePickerApp.js):
// with several kinds the kind first (Photos, Videos, Music, Documents, as
// its categoryItems:39-45, and Files, any file by folder); pictures album
// by album, a tap picks one; several files are ticked and OK sends them
// ("2 Files Selected", its multiSelect labels:19-29); a crop size shows the
// picture in a frame of that shape to move and zoom, and OK sends where it
// was framed (ImageCropView.js, Enyo's CroppableImage).

const CAMERA_ROLL = MEDIA + "/DCIM/100PHNX";
const KINDS: Record<PickKind, { label: string; icon: FileIconKind }> = {
    image: { label: "Photos", icon: "image" },
    video: { label: "Videos", icon: "video" },
    audio: { label: "Music", icon: "audio" },
    document: { label: "Documents", icon: "document" },
    file: { label: "Files", icon: "folder" },
};
// The documents webOS 3's indexer listed (com.palm.media.misc.file:1).
const DOCUMENT_EXTENSIONS = ["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "rtf", "csv", "odt", "ods", "odp"];

function albumOf(path: string): string {
    const dir = parentOf(path);
    if (dir === CAMERA_ROLL) return "Camera Roll";
    if (dir === MEDIA + "/samples/photos") return "Sample Photos";
    if (dir === MEDIA + "/screencaptures") return "Screen Captures";
    const last = baseName(dir);
    return last ? last.charAt(0).toUpperCase() + last.slice(1) : "Pictures";
}
const newestFirst = <T extends { last_modified_date?: string }>(list: T[]) =>
    [...list].sort((a, b) => Date.parse(b.last_modified_date ?? "") - Date.parse(a.last_modified_date ?? "") || 0);
const selectedLabel = (n: number) => (n === 0 ? "No Files Selected" : n === 1 ? "1 File Selected" : `${n} Files Selected`);

function FilePicker({ request, finish, backHandler }: SheetProps<PickRequest>) {
    const kinds = request.kinds;
    const [kind, setKind] = useState<PickKind | null>(kinds.length === 1 ? kinds[0] : null);
    const [selected, setSelected] = useState<Picked[]>([]);
    const [cropping, setCropping] = useState<ImageItem | null>(null);
    const [folder, setFolder] = useState(MEDIA);
    const cropOf = useRef<() => CropInfo | null>(() => null);

    const isSelected = (path: string) => selected.some((f) => f.path === path);
    const choose = (f: Picked) => {
        if (!request.multiple) return finish({ action: "pick", files: [f] });
        setSelected((s) => (s.some((x) => x.path === f.path) ? s.filter((x) => x.path !== f.path) : [...s, f]));
    };
    const pickPicture = (it: ImageItem) => {
        if (request.crop) setCropping(it);
        else choose({ path: it.file_path, mimeType: it.mime ?? "image/jpeg", size: it.file_size });
    };
    // Back goes up a step, as the picker's own Back did (its views'
    // backHandler, FilePickerApp.js:240-247, 268-283): out of the crop,
    // up a folder, to the kinds (the files ticked are let go), then away.
    const nested = !!cropping || (kind === "file" && folder !== MEDIA) || (!!kind && kinds.length > 1);
    const back = () => {
        if (cropping) setCropping(null);
        else if (kind === "file" && folder !== MEDIA) setFolder(parentOf(folder));
        else if (kind && kinds.length > 1) { setKind(null); setSelected([]); }
        else finish({ action: "cancel" });
    };
    backHandler.current = back;
    const ok = () => {
        if (cropping) {
            const info = cropOf.current();
            if (info) finish({ action: "pick", files: [{ path: cropping.file_path, mimeType: cropping.mime ?? "image/jpeg", size: cropping.file_size, cropInfo: info }] });
        } else if (selected.length) {
            finish({ action: "pick", files: selected });
        }
    };
    const showOk = !!cropping || (request.multiple && !!kind);

    return (
        <div className="ss-sheet ss-pick" role="dialog" aria-label={request.title}
             data-testid={kinds.length === 1 && kinds[0] === "image" ? "picture-picker" : "file-picker"}>
            <div className="ss-pick-head">
                <div className="ss-title ss-pick-title" data-testid="pick-title">
                    {cropping ? "Preview" : kind && kinds.length > 1 ? KINDS[kind].label : request.title}
                </div>
                {request.multiple && kind && !cropping && <div className="ss-subtitle" data-testid="pick-count">{selectedLabel(selected.length)}</div>}
            </div>
            <div className="ss-pick-albums">
                {cropping ? <CropView item={cropping} crop={request.crop!} cropOf={cropOf} />
                    : !kind ? (
                        <div className="ss-pick-rows" data-testid="pick-kinds">
                            {kinds.map((k) => (
                                <div key={k} className="pui-menu-item" role="button" data-testid={"pick-kind-" + k} onClick={() => setKind(k)}>
                                    <FileIcon kind={KINDS[k].icon} size={28} />
                                    <span className="pui-menu-label">{KINDS[k].label}</span>
                                    <span className="pui-row-chevron" />
                                </div>
                            ))}
                        </div>
                    )
                    : kind === "image" ? <Pictures onPick={pickPicture} isSelected={isSelected} />
                    : kind === "video" ? <MediaRows kind="video" choose={choose} isSelected={isSelected} />
                    : kind === "audio" ? <MediaRows kind="audio" choose={choose} isSelected={isSelected} />
                    : kind === "document" ? <Documents extensions={request.extensions} choose={choose} isSelected={isSelected} />
                    : <Folder path={folder} open={setFolder} extensions={request.extensions} choose={choose} isSelected={isSelected} />}
            </div>
            <div className="ss-buttons">
                <Button onClick={back} data-testid="pick-cancel">{nested ? "Back" : "Cancel"}</Button>
                {showOk && <Button variant="affirmative" disabled={!cropping && !selected.length} onClick={ok} data-testid="pick-ok">OK</Button>}
            </div>
        </div>
    );
}

interface ListProps {
    choose: (f: Picked) => void;
    isSelected: (path: string) => boolean;
}

function Thumb({ item, selected, onPick }: { item: ImageItem; selected: boolean; onPick: () => void }) {
    const url = useMediaUrl(item.file_path);
    return (
        <button type="button" className={"ss-pick-thumb" + (selected ? " selected" : "")} data-testid="pick-picture" title={baseName(item.file_path)}
                onClick={onPick} aria-pressed={selected} style={url ? { backgroundImage: `url("${url}")` } : undefined}
                aria-label={item.title ?? baseName(item.file_path)} />
    );
}

function Pictures({ onPick, isSelected }: { onPick: (it: ImageItem) => void; isSelected: (path: string) => boolean }) {
    const [items, setItems] = useState<ImageItem[] | null>(null);
    useEffect(() => {
        let gone = false;
        mediaIndexer.images().then((list) => { if (!gone) setItems(list); }, () => { if (!gone) setItems([]); });
        return () => { gone = true; };
    }, []);
    if (items === null) return <div className="ss-loading"><Spinner /></div>;
    if (!items.length) return <div className="ss-empty">No pictures yet</div>;
    // Albums, Camera Roll first, then by name; newest pictures first in each.
    const albums = new Map<string, ImageItem[]>();
    newestFirst(items).forEach((it) => {
        const a = albumOf(it.file_path);
        albums.set(a, [...(albums.get(a) ?? []), it]);
    });
    const order = [...albums.keys()].sort((a, b) => (a === "Camera Roll" ? -1 : b === "Camera Roll" ? 1 : a.localeCompare(b)));
    return (
        <>
            {order.map((a) => (
                <div key={a} className="ss-pick-album">
                    <div className="ss-pick-album-name">{a}</div>
                    <div className="ss-pick-grid">
                        {albums.get(a)!.map((it) => <Thumb key={it.file_path} item={it} selected={isSelected(it.file_path)} onPick={() => onPick(it)} />)}
                    </div>
                </div>
            ))}
        </>
    );
}

function FileRow({ file, icon, title, detail, selected, onPick, testId }: {
    file: string; icon: FileIconKind; title: string; detail?: string; selected: boolean; onPick: () => void; testId: string;
}) {
    return (
        <div className={"pui-menu-item ss-pick-row" + (selected ? " selected" : "")} role="button" aria-pressed={selected}
             data-testid={testId} data-path={file} onClick={onPick}>
            <FileIcon kind={icon} size={28} />
            <span className="pui-menu-label">
                <span className="ss-pick-row-title">{title}</span>
                {detail && <span className="ss-pick-row-detail">{detail}</span>}
            </span>
            {selected && <Checkmark />}
        </div>
    );
}

const minutes = (s?: number) => (s ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}` : "");

function MediaRows({ kind, choose, isSelected }: ListProps & { kind: "video" | "audio" }) {
    const [items, setItems] = useState<(AudioItem | VideoItem)[] | null>(null);
    useEffect(() => {
        let gone = false;
        (kind === "audio" ? mediaIndexer.audio() : mediaIndexer.videos())
            .then((list) => { if (!gone) setItems(list); }, () => { if (!gone) setItems([]); });
        return () => { gone = true; };
    }, [kind]);
    if (items === null) return <div className="ss-loading"><Spinner /></div>;
    if (!items.length) return <div className="ss-empty">{kind === "audio" ? "No music yet" : "No videos yet"}</div>;
    const list = kind === "audio" ? [...items].sort((a, b) => (a.title ?? "").localeCompare(b.title ?? "")) : newestFirst(items);
    return (
        <div className="ss-pick-rows">
            {list.map((it) => (
                <FileRow key={it.file_path} file={it.file_path} icon={kind} testId={"pick-" + kind}
                         title={kind === "audio" ? it.title ?? baseName(it.file_path) : baseName(it.file_path)}
                         detail={[kind === "audio" ? (it as AudioItem).artist : "", minutes(it.duration), it.file_size ? formatSize(it.file_size) : ""].filter(Boolean).join(" · ")}
                         selected={isSelected(it.file_path)}
                         onPick={() => choose({ path: it.file_path, mimeType: it.mime ?? "", size: it.file_size })} />
            ))}
        </div>
    );
}

function Documents({ extensions, choose, isSelected }: ListProps & { extensions: string[] }) {
    const [files, setFiles] = useState<FileEntry[] | null>(null);
    const exts = (extensions.length ? extensions : DOCUMENT_EXTENSIONS).join(",");
    useEffect(() => {
        let gone = false;
        findFiles(exts.split(",")).then((list) => { if (!gone) setFiles(list); }, () => { if (!gone) setFiles([]); });
        return () => { gone = true; };
    }, [exts]);
    if (files === null) return <div className="ss-loading"><Spinner /></div>;
    if (!files.length) return <div className="ss-empty">No documents yet</div>;
    return (
        <div className="ss-pick-rows">
            {files.map((f) => (
                <FileRow key={f.path} file={f.path} icon={kindOf(f)} title={f.name} testId="pick-document"
                         detail={formatSize(f.size)} selected={isSelected(f.path)}
                         onPick={() => choose({ path: f.path, mimeType: mimeOf(f.name), size: f.size })} />
            ))}
        </div>
    );
}

function Folder({ path, open, extensions, choose, isSelected }: ListProps & { path: string; open: (p: string) => void; extensions: string[] }) {
    const [entries, setEntries] = useState<{ path: string; list: FileEntry[] } | null>(null);
    useEffect(() => {
        let gone = false;
        fileManager.list(path).then((list) => { if (!gone) setEntries({ path, list }); }, () => { if (!gone) setEntries({ path, list: [] }); });
        return () => { gone = true; };
    }, [path]);
    if (!entries || entries.path !== path) return <div className="ss-loading"><Spinner /></div>;
    const want = new Set(extensions);
    const shown = entries.list.filter((e) => !e.name.startsWith(".") &&
        (e.type === "directory" || !want.size || want.has(extensionOf(e.name).toLowerCase())))
        .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "directory" ? -1 : 1));
    return (
        <div className="ss-pick-rows">
            <div className="ss-pick-album-name" data-testid="pick-folder">{folderTitle(path)}</div>
            {!shown.length && <div className="ss-empty">Nothing here</div>}
            {shown.map((e) => e.type === "directory" ? (
                <div key={e.path} className="pui-menu-item" role="button" data-testid={"pick-folder-" + e.name} onClick={() => open(e.path)}>
                    <FileIcon kind="folder" size={28} />
                    <span className="pui-menu-label">{e.name}</span>
                    <span className="pui-row-chevron" />
                </div>
            ) : (
                <FileRow key={e.path} file={e.path} icon={kindOf(e)} title={e.name} testId="pick-file" detail={formatSize(e.size)}
                         selected={isSelected(e.path)} onPick={() => choose({ path: e.path, mimeType: mimeOf(e.name), size: e.size })} />
            ))}
        </div>
    );
}

// The crop view: the picture behind a frame of the crop's shape, moved by
// dragging and zoomed with the slider or the wheel, never smaller than
// the frame (as CroppableImage, a ScrollingImage, kept it).
function CropView({ item, crop, cropOf }: { item: ImageItem; crop: { width: number; height: number }; cropOf: React.MutableRefObject<() => CropInfo | null> }) {
    const url = useMediaUrl(item.file_path);
    const area = useRef<HTMLDivElement>(null);
    const [size, setSize] = useState<{ w: number; h: number } | null>(null);   // the picture's pixels
    const [frame, setFrame] = useState({ w: 0, h: 0 });
    const [zoom, setZoom] = useState(1);   // 1: the picture just covers the frame
    const [at, setAt] = useState({ x: 0, y: 0 });   // the picture's top left in the frame
    const drag = useRef<{ id: number; x: number; y: number; at: { x: number; y: number } } | null>(null);

    useEffect(() => {
        const el = area.current;
        if (!el) return;
        const fit = () => {
            const r = el.getBoundingClientRect();
            const k = Math.min((r.width - 16) / crop.width, (r.height - 16) / crop.height);
            setFrame({ w: Math.max(40, Math.floor(crop.width * k)), h: Math.max(40, Math.floor(crop.height * k)) });
        };
        fit();
        const ro = typeof ResizeObserver === "function" ? new ResizeObserver(fit) : null;
        ro?.observe(el);
        return () => ro?.disconnect();
    }, [crop.width, crop.height]);

    const base = size && frame.w ? Math.max(frame.w / size.w, frame.h / size.h) : 1;
    const z = base * zoom;   // shown pixels per picture pixel
    const clampAt = useCallback((p: { x: number; y: number }, zz: number) => size ? {
        x: Math.min(0, Math.max(frame.w - size.w * zz, p.x)),
        y: Math.min(0, Math.max(frame.h - size.h * zz, p.y)),
    } : p, [size, frame.w, frame.h]);
    // Centred when the picture or the frame changes.
    useEffect(() => {
        if (!size || !frame.w) return;
        const zz = Math.max(frame.w / size.w, frame.h / size.h);
        setZoom(1);
        setAt({ x: (frame.w - size.w * zz) / 2, y: (frame.h - size.h * zz) / 2 });
    }, [size, frame.w, frame.h]);
    const zoomTo = (next: number) => {
        const nz = Math.min(4, Math.max(1, next));
        // About the frame's centre.
        const cx = (frame.w / 2 - at.x) / z, cy = (frame.h / 2 - at.y) / z, zz = base * nz;
        setZoom(nz);
        setAt(clampAt({ x: frame.w / 2 - cx * zz, y: frame.h / 2 - cy * zz }, zz));
    };
    cropOf.current = () => {
        if (!size) return null;
        const left = -at.x / z, top = -at.y / z, sizeX = frame.w / z, sizeY = frame.h / z;
        return {
            scale: z, suggestedXtop: Math.max(0, Math.round(left)), suggestedYtop: Math.max(0, Math.round(top)), suggestedScale: z * 100,
            suggestedXsize: Math.round(sizeX), suggestedYsize: Math.round(sizeY), sourceWidth: size.w, sourceHeight: size.h,
            sourceImage: item.file_path, focusX: (left + sizeX / 2) / size.w, focusY: (top + sizeY / 2) / size.h,
        };
    };

    return (
        <div className="ss-crop" data-testid="pick-crop">
            <div className="ss-crop-area" ref={area} onWheel={(e) => zoomTo(zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1))}>
                <div className="ss-crop-frame" style={{ width: frame.w, height: frame.h }} data-testid="pick-crop-frame"
                     onPointerDown={(e) => {
                         (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
                         drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, at };
                     }}
                     onPointerMove={(e) => {
                         const d = drag.current;
                         if (!d || d.id !== e.pointerId) return;
                         setAt(clampAt({ x: d.at.x + e.clientX - d.x, y: d.at.y + e.clientY - d.y }, z));
                     }}
                     onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
                    {url && <img src={url} alt="" draggable={false} data-testid="pick-crop-image"
                                 onLoad={(e) => setSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
                                 style={size ? { width: size.w * z, height: size.h * z, transform: `translate(${at.x}px, ${at.y}px)` } : { visibility: "hidden" }} />}
                </div>
            </div>
            <Slider min={1} max={4} step={0.01} value={zoom} label="Zoom" testId="pick-crop-zoom" onChange={zoomTo} />
        </div>
    );
}

