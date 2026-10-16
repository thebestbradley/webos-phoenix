// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The save and pick sheets' column view (on a tablet or a desktop, when
// chosen): the places, then each folder in a column to the right of its
// parent's, as Files' column view (@phoenix/ui ColumnView). Save shows
// folders only, the last column the folder the file goes to; pick shows
// the files it may pick too, and a file tapped shows its preview after the
// last column (a second tap, or Enter, picks it).

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
    extensionOf, FILE_ERRORS, fileManager, fileUrl, formatSize, kindLabel, kindOf, LunaError, mediaUrl, parentOf, type FileEntry,
} from "@phoenix/luna";
import { useFormFactor } from "@phoenix/luna/react";
import {
    Checkmark, columnCursor, columnKey, ColumnNote, ColumnPreview, ColumnRow, columnTap, ColumnView, FileIcon, longDate, Spinner, useColumnsWidth,
    type ColumnMove, type ColumnState,
} from "@phoenix/ui";
import { MEDIA, PLACES, pickerChain } from "./places";

/** Columns are offered on a tablet or a desktop, in a card wide enough; a phone's sheet keeps the list. */
export function useColumnsFit(): boolean {
    const formFactor = useFormFactor();
    const roomy = useColumnsWidth();
    return formFactor !== "phone" && roomy;
}

export const internalPlace = { name: "Internal Storage", path: MEDIA, type: "directory", size: 0, mtime: 0, mode: 0o755 } as FileEntry;

export const listError = (e: unknown) => (e instanceof LunaError && e.errorCode === FILE_ERRORS.OFFLINE ? "Can't reach the drive. Check your connection."
    : e instanceof LunaError && e.errorCode === FILE_ERRORS.AUTH ? "The drive did not accept the sign-in: sign in again in Accounts."
    : e instanceof LunaError ? e.errorText : "Could not open the folder");

interface Listing { list: FileEntry[]; error?: string }

/** Folders first, then by name; no hidden files; files only of the extensions asked for (none: any). */
function shownIn(list: FileEntry[], files: boolean, extensions: string[]): FileEntry[] {
    const want = new Set(extensions);
    return list.filter((e) => !e.name.startsWith(".") && (e.type === "directory" || (files && (!want.size || want.has(extensionOf(e.name).toLowerCase())))))
        .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "directory" ? -1 : 1));
}

export interface SheetColumnsProps {
    /** The folder the sheet is in (PLACES: the places). */
    folder: string;
    drives: FileEntry[];
    /** Files too (pick), or folders only (save). */
    files: boolean;
    extensions?: string[];
    /** The current folder's listing, when the sheet has read it (save). */
    seed?: { path: string; list: FileEntry[]; error?: string } | null;
    /** Read every folder again when this changes (a folder was made). */
    version?: number;
    /** The file marked in the current folder. */
    peek: FileEntry | null;
    isSelected?: (path: string) => boolean;
    /** A tap or a key, with the row it is about. */
    onMove: (m: ColumnMove, entry: FileEntry | undefined, byKey: boolean) => void;
    preview?: ReactNode;
    /** The keys go to the columns (nothing over them). */
    keys: boolean;
    /** "save" or "pick": the test ids' start. */
    name: string;
}

export function SheetColumns({ folder, drives, files, extensions = [], seed, version = 0, peek, isSelected, onMove, preview, keys, name }: SheetColumnsProps) {
    const chain = useMemo(() => pickerChain(folder, drives.length > 0), [folder, drives.length]);
    const [listed, setListed] = useState<Record<string, Listing>>({});
    const listedRef = useRef(listed);
    listedRef.current = listed;
    const seen = useRef(version);
    const key = chain.join("\n");
    useEffect(() => {
        let live = true;
        const again = seen.current !== version;
        seen.current = version;
        setListed((m) => {
            const kept: Record<string, Listing> = {};
            if (!again) for (const f of chain) if (m[f]) kept[f] = m[f];
            return kept;
        });
        for (const f of chain) {
            if (f === PLACES || (seed && seed.path === f) || (!again && listedRef.current[f])) continue;
            fileManager.list(f).then((list) => { if (live) setListed((m) => ({ ...m, [f]: { list } })); },
                                     (e) => { if (live) setListed((m) => ({ ...m, [f]: { list: [], error: listError(e) } })); });
        }
        return () => { live = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key, version, seed?.path]);
    // The current folder's listing stays known once it is an earlier column's.
    useEffect(() => {
        if (seed) setListed((m) => ({ ...m, [seed.path]: { list: seed.list, error: seed.error } }));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [seed?.path, seed?.list, seed?.error]);
    const listing = (f: string): Listing | null =>
        f === PLACES ? { list: [internalPlace, ...drives] } : seed && seed.path === f ? seed : listed[f] ?? null;
    const columns = chain.map((f) => {
        const l = listing(f);
        return l && { error: l.error, entries: f === PLACES ? l.list : shownIn(l.list, files, extensions) };
    });
    const state: ColumnState = {
        folders: chain,
        items: columns.map((c) => (c?.entries ?? []).map((e) => ({ key: e.path, folder: e.type === "directory" }))),
        peek: peek && parentOf(peek.path) === folder ? peek.path : null,
    };
    const entryOf = (k: string) => columns.flatMap((c) => c?.entries ?? []).find((e) => e.path === k);
    const last = chain.length - 1;
    const cursor = columnCursor(state);
    return (
        <ColumnView className="ss-columns" testId={`${name}-columns`} cursor={cursor?.key} preview={preview}
                    onKey={keys ? (k) => { const m = columnKey(state, k); if (!m) return false; onMove(m, "key" in m ? entryOf(m.key) : undefined, true); return true; } : undefined}
                    columns={chain.map((f, i) => {
                        const c = columns[i];
                        const content = !c ? <div className="ss-loading"><Spinner /></div>
                            : c.error ? <ColumnNote testId={`${name}-error`}>{c.error}</ColumnNote>
                            : !c.entries.length ? <ColumnNote>{files ? "Nothing here" : "No folders here"}</ColumnNote>
                            : c.entries.map((e) => {
                                const ticked = !!isSelected?.(e.path);
                                return (
                                    <ColumnRow key={e.path} testId={`${name}-col-${e.drive ? e.drive.title : e.name}`} path={e.path}
                                               icon={<FileIcon kind={e.drive ? "drive" : kindOf(e)} size={24} />}
                                               label={e.drive ? e.drive.title : e.name} detail={e.drive?.account}
                                               folder={e.type === "directory"} open={i < last && e.path === chain[i + 1]}
                                               cursor={cursor?.column === i && cursor.key === e.path} selected={ticked}
                                               end={ticked ? <Checkmark /> : undefined}
                                               onTap={() => onMove(columnTap(state, i, { key: e.path, folder: e.type === "directory" }), e, false)} />
                                );
                            });
                        return { key: f || "places", testId: `${name}-column-${i}`, content };
                    })} />
    );
}

/** A picture's URL wherever it is: the file store, else the media store. */
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

/** The file to pick, after the last column: its picture (a drive's is not fetched for it), name, kind, size and date. */
export function PickPreview({ entry, place, children }: { entry: FileEntry; place?: string; children?: ReactNode }) {
    const kind = kindOf(entry);
    const image = usePictureUrl(kind === "image" && !entry.remote ? entry.path : undefined);
    const facts: [string, ReactNode][] = [["Kind", kindLabel(entry)], ["Size", formatSize(entry.size)]];
    if (entry.mtime) facts.push(["Modified", longDate(entry.mtime)]);
    if (entry.remote && place) facts.push(["On", place]);
    return (
        <ColumnPreview testId="pick-preview" image={image} icon={<FileIcon kind={kind} size={80} />} title={entry.name} facts={facts}>
            {children}
        </ColumnPreview>
    );
}
