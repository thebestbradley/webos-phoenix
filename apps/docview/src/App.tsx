// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Doc View: e-books and documents. webOS phones read Office files with
// "Doc View" (DataViz Documents To Go, later QuickOffice) and the TouchPad
// had no e-book reader of its own (Amazon's Kindle app was a download).
// Phoenix puts both in one app because they are one job on a phone:
// reflowable text with a remembered place, a text size and night mode.
// PDF files have their own app, PDF View, as on webOS.
//
// The start page has two lists, Books (EPUB) and Documents (Word, Excel,
// PowerPoint, Markdown, text), from the files on the device, the ones read
// lately first with how far along they are.
//
//   Files: org.webosphoenix.filemanager list / read (files.ts).
//   Launch params: {target: path | "file://..." | "http(s)://..."} opens it;
//       appinfo.json registers the types, so Files, Email and the browser
//       come here.

import { useCallback, useEffect, useMemo, useState } from "react";
import { findFiles, formatSize, openTarget, readTarget, targetName, type FoundFile, type OpenParams } from "@phoenix/luna";
import { useLaunchParams } from "@phoenix/luna/react";
import { AppMenu, BackProvider, GroupedToolButtons, PageHeader, Row, Spinner, useBack } from "@phoenix/ui";
import { parseEpub } from "./epub";
import { EXTENSIONS, formatOf, isBook, type Format } from "./formats";
import { loadPositions, loadPrefs, percentRead, savePrefs, type Position, type Prefs } from "./library";
import { Reader } from "./Reader";
import { mimeOfPath } from "./zip";

type Tab = "books" | "documents";
type Open = { target: string; name: string; format: Format } | null;

interface BookInfo { cover: string | null; title: string; author: string }

// A book's cover, title and author, read once per file and session.
const books = new Map<string, Promise<BookInfo | null>>();
function bookInfo(path: string, mtime: number): Promise<BookInfo | null> {
    const key = `${path}@${mtime}`;
    let p = books.get(key);
    if (!p) {
        p = readTarget(path).then((bytes) => {
            const book = parseEpub(bytes);
            const data = book.cover && book.pkg.bytes(book.cover);
            const cover = data ? URL.createObjectURL(new Blob([data as BlobPart], { type: mimeOfPath(book.cover!) })) : null;
            return { cover, title: book.title, author: book.author };
        }).catch(() => null);
        books.set(key, p);
    }
    return p;
}

function useBookInfo(f: FoundFile, on: boolean): BookInfo | null {
    const [info, setInfo] = useState<BookInfo | null>(null);
    useEffect(() => {
        if (!on) return;
        let live = true;
        void bookInfo(f.path, f.mtime).then((i) => { if (live) setInfo(i); });
        return () => { live = false; };
    }, [f.path, f.mtime, on]);
    return info;
}

function Cover({ url }: { url: string | null | undefined }) {
    return <span className="dv-cover">{url ? <img src={url} alt="" draggable={false} /> : <DocIcon format="epub" />}</span>;
}

function DocRow({ f, pos, onOpen }: { f: FoundFile; pos?: Position; onOpen: () => void }) {
    const fmt = formatOf(f.name);
    const book = useBookInfo(f, fmt === "epub");
    const pct = percentRead(pos);
    const title = book?.title || pos?.title || f.name.replace(/\.[^.]+$/, "");
    const about = book?.author || `${formatSize(f.size)} · ${f.name}`;
    return (
        <Row testId={`doc-${f.name}`} icon={fmt === "epub" ? <Cover url={book?.cover} /> : <DocIcon format={fmt} />}
             title={title} subtitle={pos ? `${pct}% read · ${about}` : about} onClick={onOpen}>
            {pos && <span className="dv-progress" aria-hidden="true"><i style={{ width: `${pct}%` }} /></span>}
        </Row>
    );
}

const BANDS: Record<Format, [string, string]> = {
    epub: ["#6b3f1f", "BOOK"], docx: ["#2b5fa8", "DOC"], xlsx: ["#2f7d3a", "XLS"], pptx: ["#c25a1c", "PPT"],
    markdown: ["#4a5563", "MD"], text: ["#4f7fb8", "TXT"], unsupported: ["#8a8f96", "?"],
};

function DocIcon({ format }: { format: Format }) {
    const [color, label] = BANDS[format];
    return (
        <svg className="dv-file-icon" width="32" height="32" viewBox="0 0 32 32" aria-hidden="true">
            <path d="M6 2h14l6 6v21a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z" fill="#fbfbfa" stroke="#8d8d8a" strokeWidth="0.8" />
            <path d="M20 2v5a1 1 0 0 0 1 1h5z" fill="#c9c9c6" stroke="#8d8d8a" strokeWidth="0.8" strokeLinejoin="round" />
            <rect x="7" y="17" width="18" height="12" rx="1" fill={color} />
            <text x="16" y="25.8" textAnchor="middle" fontSize={label.length > 3 ? 5.6 : 7} fontWeight="bold" fill="#fff" fontFamily="sans-serif">{label}</text>
        </svg>
    );
}

function DocView() {
    const params = useLaunchParams<OpenParams>();
    const [open, setOpen] = useState<Open>(null);
    const [files, setFiles] = useState<FoundFile[] | null>(null);
    const [positions, setPositions] = useState<Record<string, Position>>(loadPositions);
    const [tab, setTab] = useState<Tab>("books");
    const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
    const updatePrefs = (p: Prefs) => { setPrefs(p); savePrefs(p); };

    useEffect(() => {
        const t = openTarget(params);
        if (!t) return;
        const name = targetName(t, params.fileName);
        setOpen({ target: t, name, format: formatOf(name, params.mimeType) });
    }, [params]);

    const refresh = useCallback(() => {
        setPositions(loadPositions());
        findFiles(EXTENSIONS).then(setFiles, () => setFiles([]));
    }, []);
    useEffect(refresh, [refresh]);

    const close = () => { setOpen(null); refresh(); };
    useBack(() => { close(); return true; }, open !== null);
    const load = useMemo(() => (open ? () => readTarget(open.target) : null), [open]);

    const list = useMemo(() => {
        const wanted = (files ?? []).filter((f) => isBook(formatOf(f.name)) === (tab === "books"));
        // Read lately first, then newest.
        return wanted.sort((a, b) => (positions[b.path]?.at ?? 0) - (positions[a.path]?.at ?? 0));
    }, [files, tab, positions]);

    if (open && load)
        return <Reader key={open.target} target={open.target} name={open.name} format={open.format} prefs={prefs} onPrefs={updatePrefs} load={load} onClose={close} />;

    return (
        <div className="dv-app">
            <AppMenu items={[
                { label: "Books", onSelect: () => setTab("books") },
                { label: "Documents", onSelect: () => setTab("documents") },
                { label: prefs.night ? "Day Mode" : "Night Mode", onSelect: () => updatePrefs({ ...prefs, night: !prefs.night }) },
            ]} />
            <div className="dv-lib">
                <div className="dv-lib-page">
                    <PageHeader icon="icon.png" title="Doc View" />
                    <div className="dv-tabs">
                        <GroupedToolButtons value={tab} onChange={setTab} options={[
                            { value: "books" as const, caption: "Books", testId: "tab-books" },
                            { value: "documents" as const, caption: "Documents", testId: "tab-documents" },
                        ]} />
                    </div>
                    {files === null && <div className="dv-lib-loading"><Spinner /></div>}
                    {files && !list.length && (
                        <div className="dv-empty" data-testid="empty">
                            {tab === "books" ? "No books yet. EPUB files you copy to the device appear here." : "No documents yet. Word, Excel, PowerPoint, Markdown and text files appear here."}
                        </div>
                    )}
                    <div className={"dv-list " + tab} data-testid="library">
                        {list.map((f) => (
                            <DocRow key={f.path} f={f} pos={positions[f.path]} onOpen={() => setOpen({ target: f.path, name: f.name, format: formatOf(f.name) })} />
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}

export function App() {
    return (
        <BackProvider>
            <DocView />
        </BackProvider>
    );
}
