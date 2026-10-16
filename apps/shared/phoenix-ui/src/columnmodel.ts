// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The column view of a folder tree (Miller columns, as the Finder's and
// iPadOS Files' column views show folders), the logic without the drawing
// (columns.tsx): which folders the columns show, where the keyboard is,
// and what a tap, a hold or a key does. Files and the system's file picker
// (the share sheet's pick and save sheets) use it.
//
// The model: the columns show the folders from a root down to the current
// folder, one column each; the current folder's contents are the last
// column. In each column but the last, the folder open in the next column
// is marked. A file of the last column can be marked too (`peek`): its
// preview is the column after the last. The keyboard is on the marked file,
// else on the current folder (in its parent's column), else nowhere (the
// root is the current folder): the arrows move it, as in the Finder.

/** The view a folder is shown in: a list (webOS's) or columns. */
export type FolderView = "list" | "columns";

/**
 * The view shown: columns where they are offered (a tablet's or a
 * desktop's layout, a card wide enough), unless the user chose the list
 * (the owner, 16 October 2026: columns by default there, the user's choice
 * kept); the list everywhere else. `chosen` is the user's choice, undefined
 * until they make one.
 */
export function shownView(chosen: FolderView | undefined, offered: boolean): FolderView {
    return offered && chosen !== "list" ? "columns" : "list";
}

/**
 * The folders from `root` down to `path`, one column each: ("/a", "/a/b/c")
 * -> ["/a", "/a/b", "/a/b/c"]. A path outside the root: itself alone.
 */
export function folderChain(root: string, path: string): string[] {
    const inside = path === root || path.startsWith(root === "/" ? "/" : root + "/");
    if (!inside) return [path];
    const out = [root];
    let p = root === "/" ? "" : root;
    for (const seg of path.slice(p.length).split("/").filter(Boolean)) {
        p += "/" + seg;
        out.push(p);
    }
    return out;
}

/** One row of a column, as the keys see it. */
export interface ColumnItem {
    key: string;
    folder: boolean;
}

export interface ColumnState {
    /** The columns' folders, the root's first; the last is the current folder. */
    folders: string[];
    /** Each column's rows in the order shown (one list per folder). */
    items: ColumnItem[][];
    /** The file marked in the last column (its preview shows); selecting, any row the keys are on. */
    peek: string | null;
    /** Select mode: the keys tick rows of the last column. */
    selecting?: boolean;
}

/** What a tap, a hold or a key asks for. */
export type ColumnMove =
    /** A folder becomes the current folder: its column opens to the right of its parent's. */
    | { kind: "open"; key: string }
    /** A file of `folder` is marked (`folder` becomes the current folder): its preview shows. */
    | { kind: "peek"; key: string; folder: string }
    /** Open the file (a second tap on the marked file, Enter): what a tap in the list does. */
    | { kind: "launch"; key: string }
    /** Select mode: tick or untick the row. */
    | { kind: "toggle"; key: string }
    /** A hold: select mode in `folder`, with this row ticked. */
    | { kind: "select"; key: string; folder: string }
    /** Up a folder, above the first column (Backspace there): the Up button. */
    | { kind: "up" };

/** Where the keyboard is: a column and a row, or nowhere. */
export function columnCursor(s: ColumnState): { column: number; key: string } | null {
    const last = s.folders.length - 1;
    if (s.peek !== null && (s.items[last] ?? []).some((i) => i.key === s.peek)) return { column: last, key: s.peek };
    if (s.selecting || last < 1) return null;
    return { column: last - 1, key: s.folders[last] };
}

/** Going to a row: a folder opens, a file is marked. */
function moveTo(s: ColumnState, column: number, item: ColumnItem | undefined): ColumnMove | null {
    if (!item) return null;
    if (s.selecting) return { kind: "peek", key: item.key, folder: s.folders[column] };
    return item.folder ? { kind: "open", key: item.key } : { kind: "peek", key: item.key, folder: s.folders[column] };
}

/**
 * What a key does (KeyboardEvent.key):
 *
 *   ArrowUp, ArrowDown   the row above or below in the keyboard's column (a
 *                        folder opens beside it, a file shows its preview);
 *                        with the keyboard nowhere, the first or last row
 *   ArrowRight           into the folder the keyboard is on: its first row
 *   ArrowLeft            back to the folder this column is (in its parent's
 *                        column); nothing in the first column
 *   Backspace            as ArrowLeft; in the first column, up a folder
 *   Enter                a folder: into it (ArrowRight); a file: open it
 *   Home, End            the first or last row of the keyboard's column
 *
 * Select mode keeps to the last column: the arrows move without opening
 * anything, Enter or Space ticks the row. null: the key does nothing here.
 */
export function columnKey(s: ColumnState, key: string): ColumnMove | null {
    const last = s.folders.length - 1;
    if (last < 0) return null;
    const cur = columnCursor(s);
    if (s.selecting) {
        const rows = s.items[last] ?? [];
        const at = cur ? rows.findIndex((i) => i.key === cur.key) : -1;
        if (key === "ArrowDown") return moveTo(s, last, rows[at < 0 ? 0 : Math.min(rows.length - 1, at + 1)]);
        if (key === "ArrowUp") return moveTo(s, last, rows[at < 0 ? rows.length - 1 : Math.max(0, at - 1)]);
        if (key === "Home") return moveTo(s, last, rows[0]);
        if (key === "End") return moveTo(s, last, rows[rows.length - 1]);
        if ((key === "Enter" || key === " ") && cur) return { kind: "toggle", key: cur.key };
        return null;
    }
    if (!cur) {
        // The root is the current folder: the keys start in its column.
        const rows = s.items[last] ?? [];
        if (key === "ArrowDown" || key === "ArrowRight" || key === "Home") return moveTo(s, last, rows[0]);
        if (key === "ArrowUp" || key === "End") return moveTo(s, last, rows[rows.length - 1]);
        if (key === "Backspace") return { kind: "up" };
        return null;
    }
    const rows = s.items[cur.column] ?? [];
    const at = rows.findIndex((i) => i.key === cur.key);
    const here = rows[at];
    switch (key) {
        case "ArrowDown": return at < 0 ? moveTo(s, cur.column, rows[0]) : at + 1 < rows.length ? moveTo(s, cur.column, rows[at + 1]) : null;
        case "ArrowUp": return at < 0 ? moveTo(s, cur.column, rows[rows.length - 1]) : at > 0 ? moveTo(s, cur.column, rows[at - 1]) : null;
        case "Home": return rows[0] && rows[0].key !== cur.key ? moveTo(s, cur.column, rows[0]) : null;
        case "End": return rows.length && rows[rows.length - 1].key !== cur.key ? moveTo(s, cur.column, rows[rows.length - 1]) : null;
        case "ArrowRight":
        case "Enter":
            // On the current folder (it is open in the last column): its first row.
            if (cur.column === last - 1) return moveTo(s, last, (s.items[last] ?? [])[0]);
            return key === "Enter" && here && !here.folder ? { kind: "launch", key: cur.key } : null;
        case "ArrowLeft":
            return cur.column >= 1 ? { kind: "open", key: s.folders[cur.column] } : null;
        case "Backspace":
            return cur.column >= 1 ? { kind: "open", key: s.folders[cur.column] } : { kind: "up" };
        default:
            return null;
    }
}

/**
 * What a tap on a row of column `column` does: a folder opens; a file is
 * marked, and a tap on the marked file opens it (as a double click does in
 * the Finder); in select mode a tap in the last column ticks the row (a
 * tap in another column goes there, as out of select mode).
 */
export function columnTap(s: ColumnState, column: number, item: ColumnItem): ColumnMove {
    const last = s.folders.length - 1;
    if (s.selecting && column === last) return { kind: "toggle", key: item.key };
    if (item.folder) return { kind: "open", key: item.key };
    if (column === last && s.peek === item.key && !s.selecting) return { kind: "launch", key: item.key };
    return { kind: "peek", key: item.key, folder: s.folders[column] };
}

/** What a hold (or a right-click) on a row does: select mode in its folder, the row ticked. */
export function columnHold(s: ColumnState, column: number, item: ColumnItem): ColumnMove {
    return { kind: "select", key: item.key, folder: s.folders[column] };
}

/**
 * A key from the window is the column view's: not typed into a field, not
 * with a menu open (the app menu, a popup menu: the runtime and the menu
 * take their keys) or in a dialog over the view, and not Enter or Space on
 * a button outside it (which the button takes).
 */
export function keyIsForColumns(e: Pick<KeyboardEvent, "key" | "target" | "altKey" | "ctrlKey" | "metaKey" | "defaultPrevented">,
                                view: Element | null): boolean {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return false;
    const doc = view?.ownerDocument ?? (typeof document !== "undefined" ? document : null);
    if (doc?.querySelector(".pui-appmenu, .pui-popup")) return false;
    const t = e.target as HTMLElement | null;
    if (!t || typeof t.closest !== "function") return true;
    if (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return false;
    // A dialog over the view (the picker's own sheet is a dialog the view is in).
    const over = t.closest("[role=dialog], .pui-popup, .pui-dialog");
    if (over && !(view && over.contains(view))) return false;
    const inView = !!view && view.contains(t);
    if ((e.key === "Enter" || e.key === " ") && !inView && t.closest("button, a, [role=button], [role=checkbox]")) return false;
    return true;
}
