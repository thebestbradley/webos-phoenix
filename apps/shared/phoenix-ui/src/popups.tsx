// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Things that open: PopupMenu, ListSelector, Picker, Drawer, Dialog.

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Checkmark, cx, Divider, Row } from "./layout";
import { motion } from "./motion";

export interface Option<T> {
    label: ReactNode;
    value: T;
    /** Shown greyed out and cannot be chosen. */
    disabled?: boolean;
}

// ---- PopupMenu ----------------------------------------------------------------------

export interface PopupMenuProps<T> {
    options: Option<T>[];
    value?: T;
    /** Element the menu drops from. */
    anchor: HTMLElement | null;
    onSelect: (value: T) => void;
    onClose: () => void;
    /** "menu": dark Heritage popup (ListSelector). "picker": light pill list (Picker). */
    kind?: "menu" | "picker";
}

/** A popup list next to its anchor, kept on screen. Tap outside to close. */
export function PopupMenu<T>({ options, value, anchor, onSelect, onClose, kind = "menu" }: PopupMenuProps<T>) {
    const ref = useRef<HTMLDivElement>(null);
    const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

    useLayoutEffect(() => {
        const el = ref.current;
        if (!el) return;
        const a = anchor?.getBoundingClientRect();
        const w = el.offsetWidth, h = el.offsetHeight;
        const vw = window.innerWidth, vh = window.innerHeight;
        let left = a ? (kind === "menu" ? a.right - w + 12 : a.left + a.width / 2 - w / 2) : (vw - w) / 2;
        let top = a ? a.bottom - 6 : (vh - h) / 2;
        if (top + h > vh - 4) top = Math.max(4, (a ? a.top : vh) - h + 6);
        left = Math.max(4, Math.min(left, vw - w - 4));
        setPos({ left, top: Math.max(4, top) });
        // Scroll the selected item into view.
        el.querySelector(".selected")?.scrollIntoView?.({ block: "center" });
    }, [anchor, kind]);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
        window.addEventListener("keydown", onKey, true);
        return () => window.removeEventListener("keydown", onKey, true);
    }, [onClose]);

    return createPortal(
        <>
            <div className="pui-popup-scrim" onClick={onClose} />
            <div ref={ref} className={cx("pui-popup", kind === "picker" && "picker")} role="listbox"
                 style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: 0 }}>
                <div className="pui-popup-inner">
                    {options.map((o, i) => (
                        <div
                            key={i}
                            role="option"
                            aria-selected={o.value === value}
                            aria-disabled={o.disabled || undefined}
                            className={cx("pui-menu-item", o.value === value && "selected", o.disabled && "disabled")}
                            onClick={o.disabled ? undefined : () => { onSelect(o.value); onClose(); }}
                        >
                            <span className="pui-menu-label">{o.label}</span>
                            {kind === "menu" && o.value === value && <Checkmark />}
                        </div>
                    ))}
                </div>
            </div>
        </>,
        document.body,
    );
}

// ---- ListSelector -----------------------------------------------------------------

export interface ListSelectorProps<T> {
    title: ReactNode;
    value: T;
    options: Option<T>[];
    onChange: (value: T) => void;
    disabled?: boolean;
    testId?: string;
}

/**
 * A row showing the current choice in blue with a small arrow; tapping it
 * drops a menu of the choices (Mojo/Enyo ListSelector).
 */
export function ListSelector<T>({ title, value, options, onChange, disabled, testId }: ListSelectorProps<T>) {
    const [open, setOpen] = useState(false);
    const anchor = useRef<HTMLSpanElement>(null);
    const current = options.find((o) => o.value === value);
    return (
        <>
            <Row title={title} onClick={() => setOpen(true)} disabled={disabled} testId={testId}>
                <span ref={anchor} className="pui-row-value">{current ? current.label : ""}</span>
                <span className="pui-row-arrow" />
            </Row>
            {open && (
                <PopupMenu options={options} value={value} anchor={anchor.current}
                           onSelect={(v) => { if (v !== value) onChange(v); }} onClose={() => setOpen(false)} />
            )}
        </>
    );
}

// ---- Picker ---------------------------------------------------------------------------

export interface PickerProps<T> {
    label?: ReactNode;
    value: T;
    options: Option<T>[];
    onChange: (value: T) => void;
    testId?: string;
}

/** The rounded pill used for dates and times (Enyo Picker, Heritage art). */
export function Picker<T>({ label, value, options, onChange, testId }: PickerProps<T>) {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLButtonElement>(null);
    const current = options.find((o) => o.value === value);
    return (
        <div className="pui-picker">
            {label && <div className="pui-picker-label">{label}</div>}
            <button ref={ref} type="button" className={cx("pui-picker-button", open && "open")}
                    data-testid={testId} onClick={() => setOpen(true)}>
                <span className="pui-picker-caption">{current ? current.label : String(value)}</span>
            </button>
            {open && (
                <PopupMenu kind="picker" options={options} value={value} anchor={ref.current}
                           onSelect={onChange} onClose={() => setOpen(false)} />
            )}
        </div>
    );
}

// ---- Drawer -------------------------------------------------------------------------

export interface DrawerProps {
    open: boolean;
    children: ReactNode;
    /** Its content made only while open or closing (a MenuItem's items). */
    lazy?: boolean;
}

/** Enyo BasicDrawer's times: 250 ms open, 100 ms closed, cubicOut (BasicDrawer.js:82-103; Animator's easing, Animation.js:90-96). */
export const DRAWER_OPEN_MS = 250;
export const DRAWER_CLOSE_MS = 100;

/** Content that slides open and closed (Enyo Drawer): its height, 250 ms opening, 100 ms closing. */
export function Drawer({ open, children, lazy }: DrawerProps) {
    const inner = useRef<HTMLDivElement>(null);
    const [height, setHeight] = useState<number | "auto">(open ? "auto" : 0);
    const first = useRef(true);
    const ms = motion(open ? DRAWER_OPEN_MS : DRAWER_CLOSE_MS);
    const [made, setMade] = useState(open);
    if (open && !made)
        setMade(true);
    useEffect(() => {
        if (open || !lazy) return;
        const t = setTimeout(() => setMade(false), ms);
        return () => clearTimeout(t);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, lazy]);

    useLayoutEffect(() => {
        if (first.current) {
            first.current = false;
            return;
        }
        const h = inner.current?.scrollHeight ?? 0;
        if (ms === 0) {
            setHeight(open ? "auto" : 0);
            return;
        }
        if (open) {
            setHeight(h);
            const t = setTimeout(() => setHeight("auto"), ms + 20);
            return () => clearTimeout(t);
        }
        setHeight(h);
        const r = requestAnimationFrame(() => setHeight(0));
        return () => cancelAnimationFrame(r);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    return (
        <div className="pui-drawer" style={{ height, transitionDuration: `${ms}ms` }} aria-hidden={!open}>
            <div ref={inner}>{!lazy || made || open ? children : null}</div>
        </div>
    );
}

/** A divider with the round arrow button that opens and closes a drawer. */
export function DividerDrawer({ caption, open, onToggle, children }: { caption: ReactNode; open: boolean; onToggle: () => void; children: ReactNode }) {
    return (
        <>
            <div className="pui-drawer-divider" onClick={onToggle} role="button" aria-expanded={open}>
                <Divider caption={caption} />
                <span className={cx("pui-drawer-arrow", open && "open")} />
            </div>
            <Drawer open={open}>{children}</Drawer>
        </>
    );
}

// ---- Dialog -----------------------------------------------------------------------

export interface DialogProps {
    open: boolean;
    title?: ReactNode;
    message?: ReactNode;
    children?: ReactNode;
    /** Tapping the scrim or pressing back/Escape. */
    onClose?: () => void;
    testId?: string;
}

/** Enyo's Dialog is a Toaster: it slides up from below the card and back down over the Animator's 350 ms, cubicOut (Toaster.js:57-95, Animation.js:90-96). The scrim fades in over 0.5 s (Scrim.css:10-11) and goes at once (Scrim.js:84-90). */
export const DIALOG_SLIDE_MS = 350;

/** A modal dialog that slides up from the bottom of the card, as in Mojo (Enyo's Heritage Dialog), and back down when it closes. */
export function Dialog({ open, title, message, children, onClose, testId }: DialogProps) {
    // Still drawn while it slides away, with what it last showed: the same
    // tree, so nothing in it is made again.
    const [leaving, setLeaving] = useState(false);
    const [wasOpen, setWasOpen] = useState(open);
    const last = useRef<{ title?: ReactNode; message?: ReactNode; children?: ReactNode }>({});
    if (open)
        last.current = { title, message, children };
    if (wasOpen !== open) {
        setWasOpen(open);
        setLeaving(!open && motion(DIALOG_SLIDE_MS) > 0);
    }
    useEffect(() => {
        if (!leaving) return;
        const t = setTimeout(() => setLeaving(false), motion(DIALOG_SLIDE_MS));
        return () => clearTimeout(t);
    }, [leaving]);
    useEffect(() => {
        if (!open || !onClose) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                e.stopPropagation();
                e.preventDefault();
                onClose();
            }
        };
        window.addEventListener("keydown", onKey, true);
        return () => window.removeEventListener("keydown", onKey, true);
    }, [open, onClose]);
    if (!open && !leaving) return null;
    const c = open ? { title, message, children } : last.current;
    return createPortal(
        <div className={cx("pui-scrim", !open && "leaving")} onClick={open ? onClose : undefined} aria-hidden={!open || undefined}>
            <div className={cx("pui-dialog", !open && "leaving")} role={open ? "dialog" : undefined} aria-modal={open || undefined}
                 data-testid={open ? testId : undefined} onClick={(e) => e.stopPropagation()}
                 style={{ animationDuration: `${motion(DIALOG_SLIDE_MS)}ms` }}>
                <div className="pui-dialog-inner">
                    {c.title && <div className="pui-dialog-title">{c.title}</div>}
                    {c.message && <div className="pui-dialog-message">{c.message}</div>}
                    {c.children}
                </div>
            </div>
        </div>,
        document.body,
    );
}
