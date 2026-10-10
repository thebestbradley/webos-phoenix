// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The app menu: tapping the app's name at the top left of the status bar
// opens it, as in every webOS app. LunaSysMgr relaunched the app with
// {"palm-command": "open-app-menu"} (Enyo 1.0's enyo.windows.events
// handleAppMenu); Phoenix's runtime turns the tap into a "phoenixAppMenu"
// document event (runtime/phoenix-runtime.js runtime.openAppMenu). The
// SDK hears both.
//
// Every app menu starts with Edit (Select All, Cut, Copy, Paste), as Mojo
// and Enyo's EditMenu gave every app, then Share (Phoenix's system share
// sheet), then the app's own items: the same rules as @phoenix/ui's
// AppMenu (apps/shared/phoenix-ui/src/appmenu.tsx). appMenu.attach() draws
// it in the page with the design layer's look, for any framework; the
// bindings wrap it (React's <AppMenu>, Enact's), and an app that draws its
// own menu uses onToggle(), editState(), edit() and shareContent().

import { app } from "./app";
import { hasDocument, phoenixRuntime } from "./core";
import { share, type ShareContent } from "./share";
import { applyTheme } from "./theme";

export interface MenuItem {
    label: string;
    onSelect: () => void;
    disabled?: boolean;
}

export type EditAction = "selectAll" | "cut" | "copy" | "paste";

export interface EditState {
    canSelectAll: boolean;
    canCut: boolean;
    canCopy: boolean;
    canPaste: boolean;
}

export interface AppMenuOptions {
    /** The app's own items, after Edit and Share (a function: read as the menu opens). */
    items?: MenuItem[] | (() => MenuItem[]);
    /** The Edit submenu first (default: yes). */
    edit?: boolean;
    /**
     * What Share shares (read as the menu opens); false leaves Share out.
     * Default: the text selected on the page.
     */
    share?: ShareContent | (() => ShareContent | null | undefined) | null | false;
    /** The app's own Share, run instead of the system sheet. */
    onShare?: (content: ShareContent) => void;
}

export interface AppMenuHandle {
    open(): void;
    close(): void;
    toggle(): void;
    readonly isOpen: boolean;
    /** New items or options (an open menu is drawn again). */
    update(options: AppMenuOptions): void;
    /** Stop listening and take the menu away. */
    destroy(): void;
}

const EDIT_ITEMS: { action: EditAction; label: string; can: keyof EditState }[] = [
    { action: "selectAll", label: "Select All", can: "canSelectAll" },
    { action: "cut", label: "Cut", can: "canCut" },
    { action: "copy", label: "Copy", can: "canCopy" },
    { action: "paste", label: "Paste", can: "canPaste" },
];

/** The text selected on the page, in a field or not. */
function selection(): string {
    if (!hasDocument()) return "";
    const el = document.activeElement as HTMLInputElement | HTMLTextAreaElement | null;
    if (el && (el.tagName === "TEXTAREA" || el.tagName === "INPUT") && typeof el.selectionStart === "number" && el.selectionEnd !== null)
        return el.value.substring(el.selectionStart, el.selectionEnd);
    return String(globalThis.getSelection?.() ?? "");
}

export const appMenu = {
    /**
     * The user tapped the app's name in the status bar: open or close your
     * menu. Returns a function that stops listening.
     */
    onToggle(cb: () => void): () => void {
        if (!hasDocument()) return () => {};
        const h = () => cb();
        document.addEventListener("phoenixAppMenu", h);
        const off = app.onRelaunch<{ "palm-command"?: string }>((p) => { if (p["palm-command"] === "open-app-menu") cb(); });
        return () => {
            document.removeEventListener("phoenixAppMenu", h);
            off();
        };
    },

    /** What Edit can do now (the web runtime's; outside it, only Copy of a selection). */
    editState(): EditState {
        const rt = phoenixRuntime();
        if (rt?.editState) return rt.editState();
        const copy = selection().length > 0;
        return { canSelectAll: false, canCut: false, canCopy: copy, canPaste: false };
    },

    /** Run an Edit command on the focused field or the page's selection. */
    edit(action: EditAction): void {
        const rt = phoenixRuntime();
        if (rt?.edit) rt.edit(action);
        else if (action !== "paste" && hasDocument()) document.execCommand(action);
    },

    /** What Share would share now (the app's content, else the selection), or null when nothing. */
    shareContent(content: AppMenuOptions["share"]): ShareContent | null {
        if (content === false) return null;
        const c = typeof content === "function" ? content() : content;
        if (c && (c.text || c.url || c.files?.length)) return c;
        if (c === undefined) {
            const text = selection().trim();
            return text ? { text } : null;
        }
        return null;
    },

    /**
     * Draw the app menu in the page, opening and closing with the status
     * bar's app name, with the Phoenix design layer's look.
     *
     *     const menu = appMenu.attach({
     *         items: [{ label: "Preferences", onSelect: openPrefs }],
     *         share: () => ({ title: note.title, text: note.body }),
     *     });
     */
    attach(options: AppMenuOptions = {}): AppMenuHandle {
        let opts = options;
        let root: HTMLElement | null = null;
        let editOpen = false;
        let isOpen = false;

        const render = () => {
            if (!hasDocument()) return;
            root?.remove();
            root = null;
            if (!isOpen) return;
            applyTheme({ body: false });
            const items = typeof opts.items === "function" ? opts.items() : opts.items ?? [];
            const edit = opts.edit !== false;
            const content = appMenu.shareContent(opts.share);
            const withShare = opts.share !== false;
            const state = appMenu.editState();
            if (!edit && !withShare && !items.length) return;

            root = document.createElement("div");
            root.className = "phx-appmenu-root";
            const scrim = document.createElement("div");
            scrim.className = "phx-appmenu-scrim";
            scrim.addEventListener("click", () => handle.close());
            const menu = document.createElement("div");
            menu.className = "phx-appmenu";
            menu.setAttribute("role", "menu");
            // A press in the menu keeps the focus (and the selection) where Edit acts.
            menu.addEventListener("mousedown", (e) => e.preventDefault());
            const add = (label: string, onSelect: (() => void) | null, extra = "", disabled = false) => {
                const el = document.createElement("div");
                el.className = "phx-appmenu-item" + (extra ? " " + extra : "") + (disabled ? " disabled" : "");
                el.setAttribute("role", "menuitem");
                el.tabIndex = -1;
                if (disabled) el.setAttribute("aria-disabled", "true");
                el.textContent = label;
                if (onSelect && !disabled) el.addEventListener("click", onSelect);
                menu.appendChild(el);
                return el;
            };
            if (edit) {
                const parent = add("Edit", () => { editOpen = !editOpen; render(); });
                parent.setAttribute("aria-haspopup", "menu");
                parent.setAttribute("aria-expanded", String(editOpen));
                const arrow = document.createElement("span");
                arrow.className = "phx-appmenu-arrow" + (editOpen ? " open" : "");
                parent.appendChild(arrow);
                if (editOpen)
                    for (const it of EDIT_ITEMS)
                        add(it.label, () => { handle.close(); appMenu.edit(it.action); }, "sub", !state[it.can]);
            }
            if (withShare) {
                // Dimmed when there is nothing to share (share.open falls back off Phoenix).
                const canShare = !!content;
                add("Share", () => {
                    handle.close();
                    if (!content) return;
                    if (opts.onShare) opts.onShare(content);
                    else void share.open(content).catch(() => {});
                }, "", !canShare);
            }
            for (const it of items)
                add(it.label, () => { handle.close(); it.onSelect(); }, "", !!it.disabled);
            root.appendChild(scrim);
            root.appendChild(menu);
            document.body.appendChild(root);
        };

        // The back gesture closes an open menu first.
        const onKey = (e: KeyboardEvent) => {
            if (!isOpen || (e.key !== "Escape" && e.keyCode !== 461)) return;
            e.preventDefault();
            e.stopPropagation();
            handle.close();
        };
        if (hasDocument()) window.addEventListener("keydown", onKey, true);
        const off = appMenu.onToggle(() => handle.toggle());

        const handle: AppMenuHandle = {
            open() { isOpen = true; editOpen = false; render(); },
            close() { isOpen = false; editOpen = false; render(); },
            toggle() { if (isOpen) handle.close(); else handle.open(); },
            get isOpen() { return isOpen; },
            update(o) { opts = o; if (isOpen) render(); },
            destroy() {
                off();
                if (hasDocument()) window.removeEventListener("keydown", onKey, true);
                isOpen = false;
                render();
            },
        };
        return handle;
    },
};
