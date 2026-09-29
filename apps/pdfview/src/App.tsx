// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// PDF View: reads PDF files, after the "PDF View" app of webOS (Adobe
// Reader for webOS, which Palm never open-sourced), on PDF.js. The start
// page lists the documents read lately (with the page each was left at)
// and the PDFs on the device; a document opens in the viewer (Viewer.tsx).
//
//   Files on the device: org.webosphoenix.filemanager list / read (files.ts);
//       the media indexer does not index documents.
//   Launch params: {target: path | "file://..." | "http(s)://..."} opens that
//       PDF. appinfo.json registers application/pdf, so Files ("Open with",
//       "Open by Type"), Email attachments (getResourceInfo, then open) and
//       the browser's downloads (open {target}) come here.

import { useCallback, useEffect, useMemo, useState } from "react";
import { findFiles, formatSize, openTarget, readTarget, targetName, type FoundFile, type OpenParams } from "@phoenix/luna";
import { useLaunchParams } from "@phoenix/luna/react";
import { AppMenu, BackProvider, Divider, PageHeader, Row, Spinner, useBack } from "@phoenix/ui";
import { forgetRecent, loadRecents, type Recent } from "./library";
import { Viewer } from "./Viewer";

type Open = { target: string; name: string } | null;

function PdfIcon() {
    return (
        <svg className="pv-file-icon" width="32" height="32" viewBox="0 0 32 32" aria-hidden="true">
            <path d="M6 2h14l6 6v21a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z" fill="#fbfbfa" stroke="#8d8d8a" strokeWidth="0.8" />
            <path d="M20 2v5a1 1 0 0 0 1 1h5z" fill="#c9c9c6" stroke="#8d8d8a" strokeWidth="0.8" strokeLinejoin="round" />
            <rect x="7" y="17" width="18" height="12" rx="1" fill="#c8322f" />
            <text x="16" y="26" textAnchor="middle" fontSize="7.5" fontWeight="bold" fill="#fff" fontFamily="sans-serif">PDF</text>
        </svg>
    );
}

function when(ms: number): string {
    return new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function PdfView() {
    const params = useLaunchParams<OpenParams>();
    const [open, setOpen] = useState<Open>(null);
    const [files, setFiles] = useState<FoundFile[] | null>(null);
    const [recents, setRecents] = useState<Recent[]>(loadRecents);

    useEffect(() => {
        const t = openTarget(params);
        if (t) setOpen({ target: t, name: targetName(t, params.fileName) });
    }, [params]);

    const refresh = useCallback(() => {
        setRecents(loadRecents());
        findFiles(["pdf"]).then(setFiles, () => setFiles([]));
    }, []);
    useEffect(refresh, [refresh]);

    const close = () => { setOpen(null); refresh(); };
    useBack(() => { close(); return true; }, open !== null);

    const load = useMemo(() => (open ? () => readTarget(open.target) : null), [open]);

    if (open && load) return <Viewer key={open.target} target={open.target} name={open.name} load={load} onClose={close} />;

    const recentTargets = new Set(recents.map((r) => r.target));
    return (
        <div className="pv-app">
            <AppMenu items={[{ label: "Clear Recent Documents", disabled: !recents.length, onSelect: () => { recents.forEach((r) => forgetRecent(r.target)); refresh(); } }]} />
            <div className="pv-lib">
                <div className="pv-lib-page">
                    <PageHeader icon="icon.png" title="PDF View" />
                    {recents.length > 0 && (
                        <>
                            <Divider caption="Recent" />
                            <div className="pv-list" data-testid="recents">
                                {recents.map((r) => (
                                    <Row key={r.target} icon={<PdfIcon />} title={r.title} testId={`recent-${targetName(r.target)}`}
                                         subtitle={`Page ${r.page}${r.pages ? ` of ${r.pages}` : ""} · ${when(r.at)}`}
                                         onClick={() => setOpen({ target: r.target, name: r.title })} />
                                ))}
                            </div>
                        </>
                    )}
                    <Divider caption="On this device" />
                    {files === null && <div className="pv-lib-loading"><Spinner /></div>}
                    {files?.length === 0 && <div className="pv-empty" data-testid="empty">No PDF files yet. PDFs you download or get by email appear here.</div>}
                    <div className="pv-list" data-testid="files">
                        {files?.map((f) => (
                            <Row key={f.path} icon={<PdfIcon />} title={f.name} testId={`file-${f.name}`}
                                 subtitle={`${formatSize(f.size)} · ${f.path.replace(/^\/media\/internal\/?/, "").replace(/\/[^/]*$/, "") || "Internal storage"}`}
                                 value={recentTargets.has(f.path) ? "Read" : undefined}
                                 onClick={() => setOpen({ target: f.path, name: f.name })} />
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
            <PdfView />
        </BackProvider>
    );
}
