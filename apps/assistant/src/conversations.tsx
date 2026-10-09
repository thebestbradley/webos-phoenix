// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The Assistant's conversations, as the list pane of a TouchPad app
// (phoenix-ui's SlidingPanes, after Enyo 1.0's SlidingPane: Email's and
// Messaging's lists on the TouchPad): a header, the conversations (each
// titled by its first request, the newest first, with how many follow-ups
// wait unread), and a toolbar with New Conversation. Swipe one across to
// delete it (Onyx SwipeableItem: Cancel or Delete over it); hold it, or
// right-click it, for Open, Open in New Card and Delete.
//
// Open in New Card: another card of the Assistant, in a stack of its own,
// showing that conversation (the application manager's launch with
// {newCard: true} and {conversationId}); each card shows its own
// conversation, and all of them the one store, so a message sent in one
// shows in the others' lists at once.

import { useState } from "react";
import { apps, assistant, ASSISTANT_APP_ID, type AssistantThread } from "@phoenix/luna";
import {
    Button, ContextMenu, cx, Dialog, PaneHeader, PaneToolbar, Spinner, Swipeable, useLongPress, type ContextMenuItem,
} from "@phoenix/ui";
import { Unread } from "./chat";

/** The conversation in another card of the app: its own stack, beside this one. */
export function openInNewCard(conversationId: string) {
    return apps.launch(ASSISTANT_APP_ID, { conversationId }, { newCard: true });
}

/** Text to the clipboard (the system's; the older way where the page may not use it). */
export async function copyText(text: string): Promise<boolean> {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        let done = false;
        try { done = document.execCommand("copy"); } catch { done = false; }
        ta.remove();
        return done;
    }
}

export function when(time: number, now = Date.now()): string {
    const d = new Date(time), n = new Date(now);
    if (d.toDateString() === n.toDateString()) return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    const y = new Date(n.getFullYear(), n.getMonth(), n.getDate() - 1);
    if (d.toDateString() === y.toDateString()) return "Yesterday";
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function NewIcon() {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>;
}

function Item({ t, selected, onOpen, onMenu, onDelete }: {
    t: AssistantThread; selected: boolean; onOpen: () => void; onMenu: (el: HTMLElement) => void; onDelete: () => void;
}) {
    const press = useLongPress(onMenu);
    return (
        <Swipeable testId={`as-swipe-${t.id}`} onConfirm={onDelete}>
            <div className={cx("as-thread", selected && "selected")} role="button" tabIndex={0} data-testid={`as-thread-${t.id}`}
                 aria-current={selected || undefined} onClick={onOpen} {...press}
                 onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); } }}>
                <div className="as-thread-body">
                    <div className="as-thread-title">{t.title || "New conversation"}</div>
                    <div className="as-thread-last">{t.last}</div>
                </div>
                <div className="as-thread-end">
                    <span className="as-thread-when">{when(t.updated)}</span>
                    <Unread n={t.unread} />
                </div>
            </div>
        </Swipeable>
    );
}

export function ConversationList({ threads, selected, onOpen, onNew }: {
    threads: AssistantThread[] | null;
    /** The conversation this card shows. */
    selected: string;
    onOpen: (id: string) => void;
    onNew: () => void;
}) {
    const [menu, setMenu] = useState<{ t: AssistantThread; el: HTMLElement } | null>(null);
    const [deleting, setDeleting] = useState<AssistantThread | null>(null);
    const items: ContextMenuItem[] = menu ? [
        { label: "Open", testId: "as-menu-open", onSelect: () => onOpen(menu.t.id) },
        { label: "Open in New Card", testId: "as-menu-newcard", onSelect: () => { void openInNewCard(menu.t.id).catch(() => undefined); } },
        { label: "Delete", testId: "as-menu-delete", onSelect: () => setDeleting(menu.t) },
    ] : [];
    return (
        <div className="as-list" data-testid="as-list">
            <PaneHeader>Conversations</PaneHeader>
            <div className="as-list-scroll">
                {!threads && <div className="as-loading"><Spinner /></div>}
                {threads && threads.length === 0 && <div className="as-none" data-testid="as-none">No conversations yet.</div>}
                {threads?.map((t) => (
                    <Item key={t.id} t={t} selected={t.id === selected} onOpen={() => onOpen(t.id)}
                          onMenu={(el) => setMenu({ t, el })} onDelete={() => { void assistant.deleteThread(t.id).catch(() => undefined); }} />
                ))}
            </div>
            <PaneToolbar>
                <button type="button" className="pui-pane-tool" data-testid="as-new" aria-label="New Conversation" onClick={onNew}>
                    <NewIcon /><span>New</span>
                </button>
            </PaneToolbar>
            <ContextMenu anchor={menu?.el ?? null} items={items} onClose={() => setMenu(null)} />
            <Dialog open={deleting !== null} onClose={() => setDeleting(null)} testId="as-delete-dialog"
                    title="Delete this conversation?" message={deleting ? `"${deleting.title || "New conversation"}" and its messages go.` : ""}>
                <Button variant="negative" data-testid="as-delete-ok" onClick={() => {
                    const t = deleting;
                    setDeleting(null);
                    if (t) void assistant.deleteThread(t.id).catch(() => undefined);
                }}>Delete</Button>
                <Button onClick={() => setDeleting(null)}>Cancel</Button>
            </Dialog>
        </div>
    );
}
