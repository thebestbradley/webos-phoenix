// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Conversations (com.palm.chatthread:1), newest first: the person's
// picture, name, the last message and its time, and the unread count. An
// IM conversation shows the buddy's presence beside the name. Swiped
// across, a conversation asks Delete or Cancel (webOS Messaging's swipe to
// delete, the Onyx SwipeableItem) and goes with its messages. Held, or
// right-clicked, it opens a menu: Open, Open in New Card (another card of
// Messaging on that conversation alone, as the Assistant's conversations
// do) and Delete.

import { useState } from "react";
import { apps, isImService, type ChatThread, type ImBuddy, type Person } from "@phoenix/luna";
import {
    Avatar, Button, ContextMenu, Dialog, formatNumber, shortWhen, Swipeable, useLongPress, type ContextMenuItem,
} from "@phoenix/ui";
import { buddyFor, presenceText } from "../lib/threads";
import { Presence } from "../icons";

export const MESSAGING_APP_ID = "org.webosphoenix.messaging";

/**
 * The conversation in another card of Messaging, in a stack of its own
 * (the application manager's launch with {newCard: true}). {threadId} is
 * the same launch param a message's notification opens the conversation
 * with (phoenix-runtime.js simulateIncomingSms), so a cold launch, a
 * relaunch and the new card all take one path (App.tsx).
 */
export function openInNewCard(threadId: string) {
    return apps.launch(MESSAGING_APP_ID, { threadId }, { newCard: true });
}

const threadName = (t: ChatThread) =>
    t.displayName || (isImService(t.replyService) ? t.replyAddress ?? "" : formatNumber(t.replyAddress ?? ""));

function Row({ t, people, buddies, selected, onOpen, onDelete, onMenu }: {
    t: ChatThread; people: readonly Person[]; buddies: readonly ImBuddy[]; selected: boolean;
    onOpen: () => void; onDelete: () => void; onMenu: (el: HTMLElement) => void;
}) {
    const press = useLongPress(onMenu);
    const person = t.personId ? people.find((p) => p._id === t.personId) : undefined;
    const unread = t.unreadCount ?? 0;
    const im = isImService(t.replyService);
    const buddy = im ? buddyFor(t, buddies) : undefined;
    return (
        <Swipeable testId="thread-swipe" onConfirm={onDelete}>
            <div role="listitem" tabIndex={0} data-testid="thread-row" data-thread={t._id} data-service={t.replyService ?? "sms"}
                 className={`thread-row${unread ? " unread" : ""}${selected ? " selected" : ""}`}
                 onClick={onOpen} onKeyDown={(e) => { if (e.key === "Enter") onOpen(); }} {...press}>
                <Avatar size={44} src={person?.photos?.localPathList || person?.photos?.localPathSquare} />
                <div className="thread-body">
                    <div className="thread-top">
                        <span className="thread-name">
                            {im && <Presence availability={buddy?.availability} title={presenceText(buddy)} />}
                            {threadName(t)}
                        </span>
                        <span className="thread-when">{t.timestamp ? shortWhen(t.timestamp) : ""}</span>
                    </div>
                    <div className="thread-bottom">
                        <span className="thread-summary">{t.summary}</span>
                        {unread > 0 && <span className="thread-unread">{unread}</span>}
                    </div>
                </div>
            </div>
        </Swipeable>
    );
}

export function ThreadList({ threads, people, buddies, selected, onOpen, onDelete }: {
    threads: ChatThread[] | null;
    people: readonly Person[];
    buddies: readonly ImBuddy[];
    selected?: string | null;
    onOpen: (t: ChatThread) => void;
    onDelete?: (t: ChatThread) => void;
}) {
    const [menu, setMenu] = useState<{ t: ChatThread; el: HTMLElement } | null>(null);
    const [deleting, setDeleting] = useState<ChatThread | null>(null);
    if (threads && threads.length === 0)
        return <div className="msg-empty">No conversations yet. Tap the compose button to start one.</div>;
    const items: ContextMenuItem[] = menu ? [
        { label: "Open", testId: "thread-menu-open", onSelect: () => onOpen(menu.t) },
        { label: "Open in New Card", testId: "thread-menu-newcard",
          onSelect: () => { if (menu.t._id) void openInNewCard(menu.t._id).catch(() => undefined); } },
        ...(onDelete ? [{ label: "Delete", testId: "thread-menu-delete", onSelect: () => setDeleting(menu.t) }] : []),
    ] : [];
    return (
        <div className="thread-list" role="list">
            {(threads ?? []).map((t) => (
                <Row key={t._id} t={t} people={people} buddies={buddies} selected={selected === t._id}
                     onOpen={() => onOpen(t)} onDelete={() => onDelete?.(t)} onMenu={(el) => setMenu({ t, el })} />
            ))}
            <ContextMenu anchor={menu?.el ?? null} items={items} onClose={() => setMenu(null)} />
            <Dialog open={deleting !== null} onClose={() => setDeleting(null)} testId="thread-delete-dialog"
                    title="Delete this conversation?" message={deleting ? `Your conversation with ${threadName(deleting)} and its messages go.` : ""}>
                <Button variant="negative" data-testid="thread-delete-ok" onClick={() => {
                    const t = deleting;
                    setDeleting(null);
                    if (t) onDelete?.(t);
                }}>Delete</Button>
                <Button onClick={() => setDeleting(null)}>Cancel</Button>
            </Dialog>
        </div>
    );
}
