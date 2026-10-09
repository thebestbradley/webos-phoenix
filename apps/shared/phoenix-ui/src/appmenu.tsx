// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The app menu: tapping the app's name at the top left of the status bar
// opens it, as in every webOS app (enyo.AppMenu; LunaSysMgr relaunched the
// app with {"palm-command": "open-app-menu"}). The runtime turns that into
// a "phoenixAppMenu" document event (see __phoenixRuntime.openAppMenu).
//
// Every app menu starts with Edit (Select All, Cut, Copy, Paste), as Mojo
// and Enyo's EditMenu gave every app; its items act on the focused field
// or the page's selection through the web runtime (__phoenixRuntime.edit),
// and are dimmed when they cannot apply.

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cx } from "./layout";
import { Drawer } from "./popups";

export interface AppMenuItem {
    label: ReactNode;
    onSelect: () => void;
    disabled?: boolean;
}

export interface AppMenuProps {
    items: AppMenuItem[];
    /** The Edit submenu first (default: yes). */
    edit?: boolean;
}

type EditAction = "selectAll" | "cut" | "copy" | "paste";

interface EditState {
    canSelectAll: boolean;
    canCut: boolean;
    canCopy: boolean;
    canPaste: boolean;
}

interface Runtime {
    editState?: () => EditState;
    edit?: (action: EditAction) => boolean;
}

const runtime = (): Runtime | undefined => (globalThis as { __phoenixRuntime?: Runtime }).__phoenixRuntime;

const EDIT_ITEMS: { action: EditAction; label: string; can: keyof EditState }[] = [
    { action: "selectAll", label: "Select All", can: "canSelectAll" },
    { action: "cut", label: "Cut", can: "canCut" },
    { action: "copy", label: "Copy", can: "canCopy" },
    { action: "paste", label: "Paste", can: "canPaste" },
];

/** What Edit can do now, from the web runtime (outside it, only Copy of a selection). */
function editState(): EditState {
    const rt = runtime();
    if (rt?.editState) return rt.editState();
    const copy = String(globalThis.getSelection?.() ?? "").length > 0;
    return { canSelectAll: false, canCut: false, canCopy: copy, canPaste: false };
}

function runEdit(action: EditAction): void {
    const rt = runtime();
    if (rt?.edit) rt.edit(action);
    else if (action !== "paste") document.execCommand(action);
}

/** Toggles when the user taps the app name in the status bar. */
export function useAppMenuToggle(): [boolean, (open: boolean) => void] {
    const [open, setOpen] = useState(false);
    useEffect(() => {
        const toggle = () => setOpen((o) => !o);
        document.addEventListener("phoenixAppMenu", toggle);
        return () => document.removeEventListener("phoenixAppMenu", toggle);
    }, []);
    return [open, setOpen];
}

/** The app menu, dropping from the top left (Onyx AppMenu.css). Tap outside to close. */
export function AppMenu({ items, edit = true }: AppMenuProps) {
    const [open, setOpen] = useAppMenuToggle();
    const [editOpen, setEditOpen] = useState(false);
    const [state, setState] = useState<EditState>(() => editState());
    // What Edit can do is read as the menu opens, before any tap in it.
    useEffect(() => {
        if (open) setState(editState());
        else setEditOpen(false);
    }, [open]);
    if (!open || (items.length === 0 && !edit)) return null;
    return createPortal(
        <>
            <div className="pui-popup-scrim" onClick={() => setOpen(false)} />
            {/* A press in the menu must not take the focus (or the
                selection) from the field Edit acts on, as in Enyo's EditMenu. */}
            <div className="pui-appmenu" role="menu" onMouseDown={(e) => e.preventDefault()}>
                <div className="pui-appmenu-inner">
                    {edit && (
                        <>
                            <div
                                role="menuitem"
                                aria-haspopup="menu"
                                aria-expanded={editOpen}
                                className={cx("pui-appmenu-item", "pui-appmenu-parent", items.length === 0 && !editOpen && "last")}
                                onClick={() => setEditOpen((o) => !o)}
                            >
                                Edit
                                <span className={cx("pui-appmenu-arrow", editOpen && "open")} aria-hidden="true" />
                            </div>
                            {/* Its items open below it as a MenuItem's drawer:
                                enyo.BasicDrawer, 250 ms open, 100 ms closed
                                (MenuItem.js:53-69; BasicDrawer.js:82-103). */}
                            <Drawer open={editOpen} lazy>
                            {EDIT_ITEMS.map((e, i) => {
                                const disabled = !state[e.can];
                                return (
                                    <div
                                        key={e.action}
                                        role="menuitem"
                                        aria-disabled={disabled || undefined}
                                        className={cx("pui-appmenu-item", "pui-appmenu-subitem",
                                            items.length === 0 && i === EDIT_ITEMS.length - 1 && "last", disabled && "disabled")}
                                        onClick={() => {
                                            if (disabled) return;
                                            setOpen(false);
                                            runEdit(e.action);
                                        }}
                                    >
                                        {e.label}
                                    </div>
                                );
                            })}
                            </Drawer>
                        </>
                    )}
                    {items.map((item, i) => (
                        <div
                            key={i}
                            role="menuitem"
                            aria-disabled={item.disabled || undefined}
                            className={cx("pui-appmenu-item", i === items.length - 1 && "last", item.disabled && "disabled")}
                            onClick={() => {
                                if (item.disabled) return;
                                setOpen(false);
                                item.onSelect();
                            }}
                        >
                            {item.label}
                        </div>
                    ))}
                </div>
            </div>
        </>,
        document.body,
    );
}
