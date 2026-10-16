// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The column view (columnmodel.ts has its logic): folders side by side, each in
// a column to the right of its parent's, a file's preview after the last,
// scrolling sideways when they do not fit; the rows of the Heritage list
// (Item.css) with the folder open beside them marked as the TouchPad marked
// the item its detail pane shows (Onyx Item.css .enyo-item-selected) and
// the keyboard's row as a held one (Heritage Item.css .enyo-held); and the
// switch between a list and columns, Enyo's Heritage radio buttons
// (RadioButton.css, radiobutton-heritage.png). Files and the system's file
// picker offer it on tablets and desktops: the shell's layout
// (@phoenix/luna/react useFormFactor) not a phone's, and a card wide enough
// (useColumnsWidth).

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { keyIsForColumns, type FolderView } from "./columnmodel";
import { cx } from "./layout";
import { Glyph } from "./media";
import { motionScale } from "./motion";
import { useLongPress } from "./panes";
import "./columns.css";

/** Columns only where they fit: a card at least this wide (Files' favourites column shows from here too). */
export const COLUMNS_MIN_WIDTH = 600;

/** The card is wide enough for columns (COLUMNS_MIN_WIDTH), following the window as it is resized. */
export function useColumnsWidth(min = COLUMNS_MIN_WIDTH): boolean {
    const wide = () => typeof window !== "undefined" && window.innerWidth >= min;
    const [fits, setFits] = useState(wide);
    useEffect(() => {
        const on = () => setFits(wide());
        on();
        window.addEventListener("resize", on);
        return () => window.removeEventListener("resize", on);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [min]);
    return fits;
}

export interface ColumnSpec {
    /** The folder (its path). */
    key: string;
    /** Its rows (ColumnRow), or what it says instead (loading, empty, an error). */
    content: ReactNode;
    testId?: string;
}

export interface ColumnViewProps {
    /** The folders' columns, the root's first. */
    columns: ColumnSpec[];
    /** The column after the last: the marked file's preview (ColumnPreview). */
    preview?: ReactNode;
    /** The row the keyboard is on: kept in sight. */
    cursor?: string | null;
    /** The keys (columns.ts columnKey), while given: true when the key was used. */
    onKey?: (key: string) => boolean;
    className?: string;
    testId?: string;
}

/** Folders in columns side by side; the newest column kept in sight. */
export function ColumnView({ columns, preview, cursor, onKey, className, testId }: ColumnViewProps) {
    const strip = useRef<HTMLDivElement>(null);
    const chain = columns.map((c) => c.key).join("\n") + (preview ? "\n\u0000preview" : "");
    // A column opened (or a preview): the strip scrolls to its end, as the
    // Finder's columns do, smoothly unless motion is reduced.
    useLayoutEffect(() => {
        const el = strip.current;
        if (!el || el.scrollWidth <= el.clientWidth) return;
        const left = el.scrollWidth - el.clientWidth;
        if (typeof el.scrollTo === "function") el.scrollTo({ left, behavior: motionScale() ? "smooth" : "auto" });
        else el.scrollLeft = left;
    }, [chain]);
    // The keyboard's row in sight in its column.
    useLayoutEffect(() => {
        if (!cursor) return;
        const row = strip.current?.querySelector<HTMLElement>(".pui-column-row.cursor, .pui-column-row.focus");
        row?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    }, [cursor, chain]);
    const keys = useRef(onKey);
    keys.current = onKey;
    const listening = !!onKey;
    useEffect(() => {
        if (!listening) return;
        const on = (e: KeyboardEvent) => {
            if (!keyIsForColumns(e, strip.current)) return;
            if (keys.current?.(e.key)) e.preventDefault();
        };
        window.addEventListener("keydown", on);
        return () => window.removeEventListener("keydown", on);
    }, [listening]);
    return (
        <div ref={strip} className={cx("pui-columns", className)} data-testid={testId} role="group" aria-label="Columns">
            {columns.map((c) => (
                <div key={c.key} className="pui-column" role="listbox" data-folder={c.key} data-testid={c.testId}>
                    {c.content}
                </div>
            ))}
            {preview && <div className="pui-column pui-column-preview" data-testid={testId && `${testId}-preview`}>{preview}</div>}
        </div>
    );
}

export interface ColumnRowProps {
    label: ReactNode;
    icon?: ReactNode;
    /** A smaller second line (a drive's account). */
    detail?: ReactNode;
    /** A folder: the chevron at its end. */
    folder?: boolean;
    /** The folder open in the next column. */
    open?: boolean;
    /** The keyboard's row: the current folder, or the file previewed. */
    cursor?: boolean;
    /** The keyboard's row in select mode (a ring: the ticks are the rows' marks there). */
    focus?: boolean;
    /** Ticked in select mode. */
    selected?: boolean;
    /** Greyed (a hidden file). */
    dim?: boolean;
    /** At the end instead of the chevron (select mode's check box). */
    end?: ReactNode;
    onTap: () => void;
    /** A hold or a right-click. */
    onHold?: () => void;
    /** The row's path (data-path). */
    path?: string;
    testId?: string;
}

/** A row of a column: a tap, a hold or a right-click. */
export function ColumnRow({ label, icon, detail, folder, open, cursor, focus, selected, dim, end, onTap, onHold, path, testId }: ColumnRowProps) {
    const hold = useLongPress(() => onHold?.());
    const handlers = onHold ? hold : {};
    return (
        <div className={cx("pui-column-row", folder && "folder", open && "open", cursor && "cursor", focus && "focus", selected && "selected", dim && "dim")}
             role="option" aria-current={open ? "location" : undefined} aria-selected={!!(selected || cursor)}
             data-testid={testId} data-path={path} data-cursor={cursor || focus || undefined} data-open={open || undefined}
             onClick={onTap} {...handlers}>
            {icon && <span className="pui-column-row-icon">{icon}</span>}
            <span className="pui-column-row-text">
                <span className="pui-column-row-label">{label}</span>
                {detail && <span className="pui-column-row-detail">{detail}</span>}
            </span>
            {end ?? (folder && <span className="pui-row-chevron" />)}
        </div>
    );
}

/** A column that says something instead of rows (empty, loading, a drive out of reach). */
export function ColumnNote({ children, testId }: { children: ReactNode; testId?: string }) {
    return <div className="pui-column-note" data-testid={testId}>{children}</div>;
}

export interface ColumnPreviewProps {
    /** The picture itself (a URL), else `icon`. */
    image?: string;
    icon?: ReactNode;
    title: ReactNode;
    /** Label and value rows: kind, size, dates. */
    facts: [string, ReactNode][];
    /** Buttons (Open, Share, ...). */
    children?: ReactNode;
    testId?: string;
}

/** A file's preview after the last column: the picture or the kind's icon, its name, its facts and actions. */
export function ColumnPreview({ image, icon, title, facts, children, testId }: ColumnPreviewProps) {
    return (
        <div className="pui-preview" data-testid={testId}>
            <div className="pui-preview-art">
                {image ? <img className="pui-preview-image" src={image} alt="" draggable={false} data-testid={testId && `${testId}-image`} /> : icon}
            </div>
            <div className="pui-preview-title" data-testid={testId && `${testId}-title`}>{title}</div>
            <dl className="pui-preview-facts">
                {facts.map(([k, v]) => (
                    <div key={k} className="pui-preview-fact"><dt>{k}</dt><dd>{v}</dd></div>
                ))}
            </dl>
            {children && <div className="pui-preview-actions">{children}</div>}
        </div>
    );
}

/** The List / Columns switch (Heritage radio buttons, two of them, with the list and columns glyphs). */
export function ViewSwitch({ value, onChange, testId = "view-switch" }: { value: FolderView; onChange: (v: FolderView) => void; testId?: string }) {
    const options: { value: FolderView; label: string; glyph: string }[] = [
        { value: "list", label: "List", glyph: "list" },
        { value: "columns", label: "Columns", glyph: "columns" },
    ];
    return (
        <div className="pui-view-switch" role="radiogroup" aria-label="View" data-testid={testId}>
            {options.map((o, i) => (
                <button key={o.value} type="button" role="radio" aria-checked={value === o.value} aria-label={o.label} title={o.label}
                        className={cx("pui-view-switch-button", i === 0 ? "first" : "last", value === o.value && "depressed")}
                        data-testid={`${testId}-${o.value}`}
                        onClick={(e) => { e.stopPropagation(); if (value !== o.value) onChange(o.value); }}>
                    <Glyph name={o.glyph} size={20} />
                </button>
            ))}
        </div>
    );
}
