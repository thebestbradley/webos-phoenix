// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// TouchPad-style panes (Enyo 1.0's SlidingPane and SlidingView, the
// Onyx theme's Header, Toolbar, GrabButton and SwipeableItem), and a long
// press or right-click menu.
//
// SlidingPanes: a list pane at the left and a detail pane that slides over
// it (enyo-1.0/framework/source/palm/containers/SlidingPane.js). Wider than
// 500 px (multiViewMinWidth, :36; resize, :244-250) both show side by
// side, the list 320 px wide as in the TouchPad apps (Email's folder and
// mail panes, core-apps/com.palm.app.email/mail/source/MailApp.js:38-56),
// and the detail can be dragged left over the list or back; narrower, each
// takes the whole width and the detail slides in over the list, dragged
// back right to show it (applySingleViewLayout, :266-276). A change of
// layout snaps (selectViewImmediate); a change of selection slides
// (Animator, 700 ms, :47). Dragged past half the list (past 100 px,
// dismissDistance, narrow), it lets go to the other side. Drag the detail
// by its left edge (the nub, SlidingView.css) or a GrabButton in it.

import {
    createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState,
    type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode,
} from "react";
import { cx } from "./layout";
import { Button } from "./controls";
import { PopupMenu } from "./popups";
import "./panes.css";

/** SlidingPane's pivot between its layouts (multiViewMinWidth). */
export const MULTI_VIEW_MIN_WIDTH = 500;
/** The TouchPad apps' list pane (MailApp.js:38, :45). */
export const LIST_PANE_WIDTH = 320;
const SLIDE_MS = 700;
const DISMISS = 100;
const HYSTERESIS = 4;       // enyo.gesture.hysteresis (dom/Gesture.js:28)

/** Wider than SlidingPane's pivot: the panes side by side. Follows the window as it is resized. */
export function useMultiView(minWidth = MULTI_VIEW_MIN_WIDTH): boolean {
    const wide = () => typeof window !== "undefined" && window.innerWidth > minWidth;
    const [multi, setMulti] = useState(wide);
    useEffect(() => {
        const on = () => setMulti(wide());
        on();
        window.addEventListener("resize", on);
        return () => window.removeEventListener("resize", on);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [minWidth]);
    return multi;
}

export type PaneView = "list" | "detail";

interface Grab { drag: (e: ReactPointerEvent, tapToggles: boolean) => void; toggle: () => void }
const GrabContext = createContext<Grab | null>(null);

export interface SlidingPanesProps {
    /** Side by side (useMultiView), or one at a time. */
    multiView: boolean;
    /** The view at the far left (SlidingPane's view): "list" shows the list (with the detail
     *  beside it when side by side); "detail" the detail over the list. */
    selected: PaneView;
    onSelect: (view: PaneView) => void;
    list: ReactNode;
    detail: ReactNode;
    listWidth?: number;
    className?: string;
    testId?: string;
}

export function SlidingPanes({ multiView, selected, onSelect, list, detail, listWidth = LIST_PANE_WIDTH, className, testId }: SlidingPanesProps) {
    const root = useRef<HTMLDivElement>(null);
    // The detail's offset from the left while it is dragged.
    const [dragged, setDragged] = useState<number | null>(null);
    // Sliding to where it rests (the transition plays).
    const [moving, setMoving] = useState(false);
    const timer = useRef(0);
    const slide = useCallback(() => {
        window.clearTimeout(timer.current);
        setMoving(true);
        timer.current = window.setTimeout(() => setMoving(false), SLIDE_MS);
    }, []);
    useEffect(() => () => window.clearTimeout(timer.current), []);
    const last = useRef({ selected, multiView });
    useLayoutEffect(() => {
        const was = last.current;
        last.current = { selected, multiView };
        if (was.multiView !== multiView) {
            window.clearTimeout(timer.current);
            setMoving(false);
        } else if (was.selected !== selected) slide();
    }, [selected, multiView, slide]);

    const width = () => root.current?.clientWidth || window.innerWidth;
    const rest = (view: PaneView) => (view === "list" ? (multiView ? listWidth : width()) : 0);
    const latest = useRef({ selected, multiView, onSelect, listWidth });
    latest.current = { selected, multiView, onSelect, listWidth };

    const toggle = useCallback(() => {
        const l = latest.current;
        l.onSelect(l.selected === "list" ? "detail" : "list");
    }, []);
    const drag = useCallback((e: ReactPointerEvent, tapToggles: boolean) => {
        if (e.button !== 0) return;
        const x0 = e.clientX;
        const base = rest(latest.current.selected);
        let moved = false;
        const move = (ev: PointerEvent) => {
            const dx = ev.clientX - x0;
            if (!moved && Math.abs(dx) < HYSTERESIS) return;
            moved = true;
            const l = latest.current;
            setDragged(Math.max(0, Math.min(base + dx, l.multiView ? l.listWidth + DISMISS : width())));
        };
        const up = (ev: PointerEvent) => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
            window.removeEventListener("pointercancel", up);
            const l = latest.current;
            if (!moved) {
                if (tapToggles && ev.type === "pointerup") toggle();
                return;
            }
            const at = Math.max(0, base + ev.clientX - x0);
            const to: PaneView = at > (l.multiView ? l.listWidth / 2 : DISMISS) ? "list" : "detail";
            setDragged(null);
            slide();
            if (to !== l.selected) l.onSelect(to);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
        window.addEventListener("pointercancel", up);
        e.preventDefault();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [slide, toggle]);

    const still = dragged === null && !moving;
    const detailStyle: CSSProperties = {
        transform: dragged !== null ? `translateX(${dragged}px)`
            : selected === "list" ? (multiView ? `translateX(${listWidth}px)` : "translateX(100%)") : "none",
        // Only as wide as the room beside the list when it rests there
        // (validateViewSizes after the slide, SlidingPane.js:304-309).
        width: multiView && selected === "list" && still ? `calc(100% - ${listWidth}px)` : "100%",
    };
    return (
        <GrabContext.Provider value={{ drag, toggle }}>
            <div ref={root} className={cx("pui-panes", multiView ? "multi" : "single", moving && dragged === null && "moving", className)}
                 data-testid={testId} data-selected={selected}>
                <div className="pui-pane pui-pane-list" style={{ width: multiView ? listWidth : "100%" }}
                     hidden={selected === "detail" && still} data-testid={testId && `${testId}-list`}>
                    {list}
                </div>
                <div className="pui-pane pui-pane-detail" style={detailStyle}
                     hidden={!multiView && selected === "list" && still} data-testid={testId && `${testId}-detail`}>
                    <div className="pui-pane-shadow" aria-hidden="true" />
                    <div className="pui-pane-nub" aria-hidden="true" onPointerDown={(e) => drag(e, false)} />
                    {detail}
                </div>
            </div>
        </GrabContext.Provider>
    );
}

/** The grip that drags the detail pane (Onyx GrabButton): drag it, or tap it to show or cover the list. */
export function GrabButton({ testId }: { testId?: string }) {
    const grab = useContext(GrabContext);
    if (!grab) return null;
    return (
        <button type="button" className="pui-grab" aria-label="Show or hide the list" data-testid={testId}
                onPointerDown={(e) => grab.drag(e, true)}
                onClick={(e) => { if (e.detail === 0) grab.toggle(); }}>
            <span /><span /><span />
        </button>
    );
}

/** A pane's header (Onyx Header: light grey). */
export function PaneHeader({ children, className }: { children: ReactNode; className?: string }) {
    return <div className={cx("pui-pane-header", className)} role="heading" aria-level={1}>{children}</div>;
}

/** A pane's toolbar (Onyx Toolbar: dark, at its foot). */
export function PaneToolbar({ children, className }: { children: ReactNode; className?: string }) {
    return <div className={cx("pui-pane-toolbar", className)}>{children}</div>;
}

// ---- Long press or right-click -----------------------------------------------------------------

/** How long a press holds before it is a long press. */
export const LONG_PRESS_MS = 500;

/**
 * Handlers for an element that opens a menu on a long press (touch, pen or
 * a held mouse button) or a right-click (the context menu). The click a long
 * press ends with does not go through.
 */
export function useLongPress(onMenu: (el: HTMLElement) => void, ms = LONG_PRESS_MS) {
    const timer = useRef(0);
    const start = useRef<{ x: number; y: number } | null>(null);
    const fired = useRef(false);
    const cancel = () => { window.clearTimeout(timer.current); start.current = null; };
    useEffect(() => () => window.clearTimeout(timer.current), []);
    return {
        onPointerDown(e: ReactPointerEvent<HTMLElement>) {
            fired.current = false;
            if (e.button !== 0) return;
            const el = e.currentTarget;
            start.current = { x: e.clientX, y: e.clientY };
            window.clearTimeout(timer.current);
            timer.current = window.setTimeout(() => { start.current = null; fired.current = true; onMenu(el); }, ms);
        },
        onPointerMove(e: ReactPointerEvent<HTMLElement>) {
            const s = start.current;
            if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) > 10) cancel();
        },
        onPointerUp: cancel,
        onPointerCancel: cancel,
        onPointerLeave: cancel,
        onContextMenu(e: ReactMouseEvent<HTMLElement>) {
            e.preventDefault();
            cancel();
            // A long touch also makes a contextmenu event: one menu.
            if (fired.current) return;
            onMenu(e.currentTarget);
        },
        onClickCapture(e: ReactMouseEvent<HTMLElement>) {
            if (fired.current) { e.preventDefault(); e.stopPropagation(); fired.current = false; }
        },
    };
}

export interface ContextMenuItem { label: string; onSelect: () => void; testId?: string }

/** The menu a long press or right-click opens, beside the element held. */
export function ContextMenu({ anchor, items, onClose }: { anchor: HTMLElement | null; items: ContextMenuItem[]; onClose: () => void }) {
    if (!anchor) return null;
    return (
        <PopupMenu<number> anchor={anchor} value={-1} onClose={onClose}
                           options={items.map((it, i) => ({ value: i, label: <span data-testid={it.testId}>{it.label}</span> }))}
                           onSelect={(i) => items[i]?.onSelect()} />
    );
}

// ---- Swipe to delete -----------------------------------------------------------------------------

/**
 * A list item swiped across to delete (Onyx SwipeableItem): past 35% of its
 * width (triggerRatio) it asks, Cancel or Delete over the item
 * (ScrimmedConfirmPrompt, controls/ConfirmPrompt.js); less, it springs back.
 */
export function Swipeable({ children, onConfirm, confirmCaption = "Delete", cancelCaption = "Cancel", testId }: {
    children: ReactNode; onConfirm: () => void; confirmCaption?: string; cancelCaption?: string; testId?: string;
}) {
    const [dx, setDx] = useState(0);
    const [asking, setAsking] = useState(false);
    const swiped = useRef(false);
    const down = (e: ReactPointerEvent<HTMLDivElement>) => {
        if (asking || e.button !== 0) return;
        const el = e.currentTarget;
        const x0 = e.clientX, y0 = e.clientY;
        let horizontal: boolean | null = null;
        swiped.current = false;
        const move = (ev: PointerEvent) => {
            const x = ev.clientX - x0, y = ev.clientY - y0;
            if (horizontal === null) {
                if (Math.hypot(x, y) < 10) return;
                horizontal = Math.abs(x) > Math.abs(y);
            }
            if (horizontal) { swiped.current = true; setDx(x); }
        };
        const up = (ev: PointerEvent) => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
            window.removeEventListener("pointercancel", up);
            setDx(0);
            if (horizontal && ev.type === "pointerup" && Math.abs(ev.clientX - x0) > el.clientWidth * 0.35) setAsking(true);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
        window.addEventListener("pointercancel", up);
    };
    return (
        <div className={cx("pui-swipeable", asking && "asking")} data-testid={testId}>
            <div className="pui-swipeable-item" style={dx ? { transform: `translateX(${dx}px)` } : undefined} onPointerDown={down}
                 onClickCapture={(e) => { if (swiped.current) { e.stopPropagation(); e.preventDefault(); swiped.current = false; } }}>
                {children}
            </div>
            {asking && (
                <div className="pui-confirm-prompt" data-testid={testId && `${testId}-confirm`}>
                    <Button onClick={() => setAsking(false)}>{cancelCaption}</Button>
                    <Button variant="negative" data-testid={testId && `${testId}-delete`}
                            onClick={() => { setAsking(false); onConfirm(); }}>{confirmCaption}</Button>
                </div>
            )}
        </div>
    );
}
