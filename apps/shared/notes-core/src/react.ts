// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The Notes app's state and actions as one React hook, so the Limestone and
// Agate apps differ only in the Enact components they draw with.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { groupNotes, type Section } from "./dates";
import { textLines, toggleTask as toggleTaskIn, type Feature } from "./markdown";
import {
    ALL_NOTES, DEFAULT_FOLDER, RECENTLY_DELETED,
    expiredNotes, folderNameProblem, isDeleted, notesInFolder,
    type Folder, type Note, type SortOrder,
} from "./model";
import { SEEDED_KEY, WELCOME_NOTE } from "./sample";
import { searchNotes, type Match } from "./search";
import { NotesStore, type LunaTransport } from "./store";

export type NewNoteStyle = "title" | "heading" | "body";

export interface Settings {
    sort: SortOrder;
    groupByDate: boolean;
    /** What a new note's first line is (Apple's "New notes start with"). */
    newNoteStyle: NewNoteStyle;
    /** Editor and preview text size, percent. */
    textSize: number;
    /** Open notes rendered rather than as Markdown source. */
    openInPreview: boolean;
    /** The theme's skin name. */
    skin: string;
    /** Theme-specific extras (Agate's accent colour, day/night). */
    extra: Record<string, string | boolean>;
}

export const DEFAULT_SETTINGS: Settings = {
    sort: "modified",
    groupByDate: true,
    newNoteStyle: "title",
    textSize: 100,
    openInPreview: false,
    skin: "",
    extra: {},
};

const SAVE_DELAY = 600;

function readSettings(key: string, defaults: Settings): Settings {
    try {
        const raw = localStorage.getItem(key);
        return raw ? { ...defaults, ...(JSON.parse(raw) as Partial<Settings>) } : defaults;
    } catch {
        return defaults;
    }
}

export interface NotesApp {
    loaded: boolean;
    error: string | null;
    notes: Note[];
    folders: Folder[];
    /** Notes per folder id (built-in and user), for the sidebar. */
    counts: Record<string, number>;
    folderId: string;
    openFolder(id: string): void;
    folderName(id: string): string;
    /** The open folder's notes in list sections (search off). */
    sections: Section[];
    /** The open folder's note count. */
    count: number;
    query: string;
    setQuery(q: string): void;
    /** Search filters: only notes with all of these. */
    filters: Feature[];
    setFilters(f: Feature[]): void;
    /** Searching: a query or a filter is set. */
    searching: boolean;
    /** Search results across all notes (search on). */
    matches: Match[];
    selected: Note | null;
    select(id: string | null): void;
    /** The open note's text as being edited (saved shortly after each change). */
    draft: string;
    setDraft(text: string): void;
    /** A new note in the open folder: empty (the style's heading), or with this text (a share, Just Type). */
    newNote(body?: string): Promise<void>;
    togglePin(id: string): void;
    moveNote(id: string, folderId: string): void;
    /** To Recently Deleted; from Recently Deleted, gone for good. */
    deleteNote(id: string): void;
    recover(id: string): void;
    emptyRecentlyDeleted(): void;
    createFolder(name: string): Promise<string | null>;
    renameFolder(id: string, name: string): Promise<string | null>;
    deleteFolder(id: string): void;
    toggleTask(index: number): void;
    settings: Settings;
    updateSettings(patch: Partial<Settings>): void;
}

export interface NotesAppOptions {
    appId: string;
    luna: LunaTransport;
    /** localStorage key for this app's settings. */
    settingsKey: string;
    defaults?: Settings;
    now?: () => number;
}

export function useNotesApp({ appId, luna, settingsKey, defaults = DEFAULT_SETTINGS, now = Date.now }: NotesAppOptions): NotesApp {
    const store = useMemo(() => new NotesStore(luna, now), [luna, now]);
    const [loaded, setLoaded] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [notes, setNotes] = useState<Note[]>([]);
    const [folders, setFolders] = useState<Folder[]>([]);
    const [folderId, setFolderId] = useState<string>(ALL_NOTES);
    const [query, setQuery] = useState("");
    const [filters, setFilters] = useState<Feature[]>([]);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [draft, setDraftState] = useState("");
    const [settings, setSettings] = useState<Settings>(() => readSettings(settingsKey, defaults));

    // The note being edited: its id, its text, and whether the text has
    // changes not saved yet. Refs, so saving never waits on a render.
    const editing = useRef<{ id: string | null; text: string; dirty: boolean }>({ id: null, text: "", dirty: false });
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const flush = useCallback(() => {
        if (timer.current) { clearTimeout(timer.current); timer.current = null; }
        const e = editing.current;
        if (e.id && e.dirty) {
            e.dirty = false;
            store.saveBody(e.id, e.text).catch((err: { errorText?: string }) => setError(err.errorText ?? String(err)));
        }
    }, [store]);

    // Load, keep up to date, and seed the welcome note on a first run.
    useEffect(() => {
        let cancelled = false;
        let watch: { cancel(): void } | null = null;
        store.ensureKinds(appId).then(() => {
            if (cancelled) return;
            let first = true;
            watch = store.watch((data) => {
                if (cancelled) return;
                setNotes(data.notes);
                setFolders(data.folders);
                setLoaded(true);
                if (first) {
                    first = false;
                    const expired = expiredNotes(data.notes, now());
                    if (expired.length) void store.purge(expired.map((n) => n._id));
                    let seeded = false;
                    try { seeded = localStorage.getItem(SEEDED_KEY) === "1"; } catch { /* private mode */ }
                    if (!seeded && data.notes.length === 0) {
                        try { localStorage.setItem(SEEDED_KEY, "1"); } catch { /* ignore */ }
                        void store.createNote(DEFAULT_FOLDER, WELCOME_NOTE);
                    }
                }
            }, (e) => setError(e.errorText ?? "Could not read the notes"));
        }, (e: { errorText?: string }) => { if (!cancelled) setError(e.errorText ?? "Could not open the notes database"); });
        return () => { cancelled = true; watch?.cancel(); };
    }, [store, appId, now]);

    // Save before the app goes away.
    useEffect(() => {
        const onHide = () => flush();
        window.addEventListener("pagehide", onHide);
        document.addEventListener("visibilitychange", onHide);
        return () => {
            window.removeEventListener("pagehide", onHide);
            document.removeEventListener("visibilitychange", onHide);
            flush();
        };
    }, [flush]);

    const selected = useMemo(() => notes.find((n) => n._id === selectedId) ?? null, [notes, selectedId]);

    // A change from elsewhere (the other app) shows unless we are editing.
    useEffect(() => {
        const e = editing.current;
        if (selected && e.id === selected._id && !e.dirty && e.text !== selected.body) {
            e.text = selected.body;
            setDraftState(selected.body);
        }
    }, [selected]);

    const select = useCallback((id: string | null) => {
        if (id === editing.current.id) return;
        flush();
        const prev = editing.current.id ? notes.find((n) => n._id === editing.current.id) : null;
        // An empty note is not kept, as in Apple Notes.
        if (prev && textLines(editing.current.text).length === 0 && !isDeleted(prev)) void store.purge([prev._id]);
        const next = id ? notes.find((n) => n._id === id) : null;
        editing.current = { id: next ? next._id : null, text: next ? next.body : "", dirty: false };
        setDraftState(next ? next.body : "");
        setSelectedId(next ? next._id : null);
    }, [flush, notes, store]);

    const setDraft = useCallback((text: string) => {
        const e = editing.current;
        if (!e.id) return;
        e.text = text;
        e.dirty = true;
        setDraftState(text);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(flush, SAVE_DELAY);
    }, [flush]);

    const openFolder = useCallback((id: string) => {
        setFolderId(id);
        setQuery("");
        setFilters([]);
    }, []);

    const folderName = useCallback((id: string) => {
        if (id === ALL_NOTES) return "All Notes";
        if (id === DEFAULT_FOLDER) return "Notes";
        if (id === RECENTLY_DELETED) return "Recently Deleted";
        return folders.find((f) => f._id === id)?.name ?? "Notes";
    }, [folders]);

    const counts = useMemo(() => {
        const c: Record<string, number> = {
            [ALL_NOTES]: notesInFolder(notes, ALL_NOTES).length,
            [DEFAULT_FOLDER]: notesInFolder(notes, DEFAULT_FOLDER).length,
            [RECENTLY_DELETED]: notesInFolder(notes, RECENTLY_DELETED).length,
        };
        for (const f of folders) c[f._id] = notesInFolder(notes, f._id).length;
        return c;
    }, [notes, folders]);

    const inFolder = useMemo(() => notesInFolder(notes, folderId), [notes, folderId]);
    const sections = useMemo(
        () => groupNotes(inFolder, settings.sort, now(), settings.groupByDate),
        [inFolder, settings.sort, settings.groupByDate, now],
    );
    const searching = query.trim().length > 0 || filters.length > 0;
    const matches = useMemo(
        () => (searching ? searchNotes(notesInFolder(notes, ALL_NOTES), query, filters) : []),
        [notes, query, filters, searching],
    );

    const newNote = useCallback(async (body?: string) => {
        flush();
        const target = folderId === ALL_NOTES || folderId === RECENTLY_DELETED ? DEFAULT_FOLDER : folderId;
        if (folderId === RECENTLY_DELETED) setFolderId(DEFAULT_FOLDER);
        const start = typeof body === "string" ? body
            : settings.newNoteStyle === "title" ? "# " : settings.newNoteStyle === "heading" ? "## " : "";
        const n = await store.createNote(target, start);
        setQuery("");
        setFilters([]);
        setNotes((cur) => (cur.some((x) => x._id === n._id) ? cur : [n, ...cur]));
        editing.current = { id: n._id, text: n.body, dirty: false };
        setDraftState(n.body);
        setSelectedId(n._id);
    }, [flush, folderId, settings.newNoteStyle, store]);

    const togglePin = useCallback((id: string) => {
        const n = notes.find((x) => x._id === id);
        if (n) void store.setPinned(id, !n.pinned);
    }, [notes, store]);

    const moveNote = useCallback((id: string, to: string) => {
        flush();
        void store.move([id], to);
    }, [flush, store]);

    const deleteNote = useCallback((id: string) => {
        const n = notes.find((x) => x._id === id);
        if (!n) return;
        if (id === editing.current.id) {
            flush();
            editing.current = { id: null, text: "", dirty: false };
            setSelectedId(null);
            setDraftState("");
        }
        void (isDeleted(n) ? store.purge([id]) : store.trash([id]));
    }, [flush, notes, store]);

    const recover = useCallback((id: string) => {
        const n = notes.find((x) => x._id === id);
        if (n) void store.recover([n], folders);
    }, [notes, folders, store]);

    const emptyRecentlyDeleted = useCallback(() => {
        const ids = notesInFolder(notes, RECENTLY_DELETED).map((n) => n._id);
        if (selectedId && ids.includes(selectedId)) select(null);
        if (ids.length) void store.purge(ids);
    }, [notes, select, selectedId, store]);

    const createFolder = useCallback(async (name: string) => {
        const problem = folderNameProblem(name, folders);
        if (problem) return problem;
        const id = await store.createFolder(name);
        setFolderId(id);
        return null;
    }, [folders, store]);

    const renameFolder = useCallback(async (id: string, name: string) => {
        const problem = folderNameProblem(name, folders, id);
        if (problem) return problem;
        await store.renameFolder(id, name);
        return null;
    }, [folders, store]);

    const deleteFolder = useCallback((id: string) => {
        if (selected && selected.folderId === id) select(null);
        if (folderId === id) setFolderId(ALL_NOTES);
        void store.deleteFolder(id, notes);
    }, [folderId, notes, select, selected, store]);

    const toggleTask = useCallback((index: number) => {
        const e = editing.current;
        if (!e.id) return;
        setDraft(toggleTaskIn(e.text, index));
    }, [setDraft]);

    const updateSettings = useCallback((patch: Partial<Settings>) => {
        setSettings((cur) => {
            const next = { ...cur, ...patch, extra: { ...cur.extra, ...(patch.extra ?? {}) } };
            try { localStorage.setItem(settingsKey, JSON.stringify(next)); } catch { /* ignore */ }
            return next;
        });
    }, [settingsKey]);

    return {
        loaded, error, notes, folders, counts,
        folderId, openFolder, folderName,
        sections, count: inFolder.length,
        query, setQuery, filters, setFilters, searching, matches,
        selected, select, draft, setDraft,
        newNote, togglePin, moveNote, deleteNote, recover, emptyRecentlyDeleted,
        createFolder, renameFolder, deleteFolder, toggleTask,
        settings, updateSettings,
    };
}
