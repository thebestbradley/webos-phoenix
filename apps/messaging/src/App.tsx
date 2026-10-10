// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Messaging: Conversations and Buddies in the dark view menu at the top,
// as in webOS 2.x Messaging; a conversation or a new message fills the
// card, and back returns to the list. On a tablet the list stays on the
// left and the conversation opens on the right.
//
// Texts (SMS), picture messages (MMS) and instant messages (IM, the
// accounts' buddies with their presence) are conversations alike; the
// Conversations badge counts what is unread in all of them.
//
// Launch params (src/launchParams.ts, the one place they are read; docs/
// LAUNCH-CONTRACTS.md): {threadId} opens a conversation (a message's
// notification; Open in New Card, which launches another card of Messaging
// with it, from a conversation's menu in the list or from the app menu
// while one is open; a cold launch and a relaunch alike); {to, name?}
// starts a message to that number; {messageText} starts a message with that
// text, e.g. a location shared from Maps; {share: {text, url, files}} (the
// share sheet) starts one with the text and the first picture attached;
// {attachment} (a path: Photos' Share) attaches that picture. The original
// apps' {compose: {personId, phoneNumbers | ims, messageText, attachment}}
// (Contacts' message button, Just Type, the browser's Share Link) opens the
// conversation with that number or buddy if there is one, else a new
// message to them, with the person's name.

import { useEffect, useMemo, useState } from "react";
import { db, messaging, personDisplayName, type MessagePart, type Person } from "@phoenix/luna";
import { useLaunchParams } from "@phoenix/luna/react";
import { AppMenu, BackProvider, RadioToolGroup, ToolBar, ToolButton, useBack } from "@phoenix/ui";
import { useBuddies, useImAccounts, usePeople, useThreads, useWide } from "./lib/hooks";
import type { Recipient } from "./lib/threads";
import { openInNewCard, ThreadList } from "./views/ThreadList";
import { Conversation } from "./views/Conversation";
import { Compose } from "./views/Compose";
import { Buddies } from "./views/Buddies";
import { Bubbles, Compose as ComposeIcon } from "./icons";
import { parseLaunch, resolveLaunch, type MessagingLaunchParams } from "./launchParams";

type View = { kind: "list" } | { kind: "thread"; id: string; text?: string; parts?: MessagePart[] }
    | { kind: "compose"; to?: Recipient | null; text?: string; parts?: MessagePart[] };

function Messaging() {
    const launch = useLaunchParams<MessagingLaunchParams>();
    const intent = useMemo(() => parseLaunch(launch), [launch]);
    const people = usePeople();
    const threads = useThreads();
    const buddies = useBuddies();
    const accounts = useImAccounts();
    const wide = useWide();
    const [tab, setTab] = useState<"conversations" | "buddies">("conversations");
    const [view, setView] = useState<View>({ kind: "list" });

    // Once the conversations are known (to find the one with that address),
    // and the person's name for a new message to them.
    const threadsKnown = threads !== null;
    useEffect(() => {
        if (intent.kind === "none" || !threadsKnown) return;
        let alive = true;
        const show = (personName?: string) => {
            const v = resolveLaunch(intent, { threads: threads ?? [], buddies, accounts, personName });
            if (!alive || !v) return;
            setTab("conversations");
            setView(v);
        };
        const personId = intent.kind === "compose" && !intent.to?.name ? intent.to?.personId : undefined;
        if (personId) db.get<Person>([personId]).then(([p]) => show(personDisplayName(p) || undefined), () => show());
        else show();
        return () => { alive = false; };
        // Once per launch (and relaunch): not again as the lists change.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [intent, threadsKnown]);

    useBack(() => { setView({ kind: "list" }); return true; }, view.kind !== "list");

    // A buddy tapped: their conversation, or a new message to them.
    const openBuddy = (r: Recipient) => {
        const addr = r.addr.toLowerCase();
        const t = (threads ?? []).find((x) => x.replyService === r.service && (x.replyAddress ?? "").toLowerCase() === addr &&
                                            (!x.username || x.username === r.account));
        setTab("conversations");
        setView(t?._id ? { kind: "thread", id: t._id } : { kind: "compose", to: r });
    };

    const unread = (threads ?? []).reduce((n, t) => n + (t.unreadCount ?? 0), 0);
    const detail = view.kind === "thread"
        ? <Conversation key={view.id + (view.text ?? "") + (view.parts?.length ?? 0)} threadId={view.id} people={people} buddies={buddies}
                        initialText={view.text} initialParts={view.parts} />
        : view.kind === "compose"
            ? <Compose key={"compose" + (view.to?.addr ?? "") + (view.text ?? "")} people={people} buddies={buddies} accounts={accounts}
                       initialTo={view.to} initialText={view.text} initialParts={view.parts}
                       onSent={(id) => setView({ kind: "thread", id })} />
            : null;

    const list = (
        <div className="msg-list-pane">
            <div className="view-menu">
                <RadioToolGroup testId="msg-tabs" value={tab} onChange={setTab} options={[
                    { value: "conversations", label: "Conversations", badge: unread || undefined },
                    { value: "buddies", label: "Buddies" },
                ]} />
            </div>
            <div className="msg-scroll">
                {tab === "conversations"
                    ? <ThreadList threads={threads} people={people} buddies={buddies} selected={view.kind === "thread" ? view.id : null}
                                  onOpen={(t) => t._id && setView({ kind: "thread", id: t._id })}
                                  onDelete={(t) => {
                                      if (!t._id) return;
                                      if (view.kind === "thread" && view.id === t._id) setView({ kind: "list" });
                                      void messaging.deleteThread(t._id).catch(() => undefined);
                                  }} />
                    : <Buddies accounts={accounts} buddies={buddies} people={people} onOpen={openBuddy}
                               onSetPresence={(id, a) => { void messaging.setPresence(id, a).catch(() => undefined); }} />}
            </div>
            {tab === "conversations" && (
                <ToolBar>
                    <span className="pui-spacer" />
                    <ToolButton title="New message" testId="compose" onClick={() => setView({ kind: "compose" })}>
                        <ComposeIcon />
                    </ToolButton>
                </ToolBar>
            )}
        </div>
    );

    const menu = (
        <AppMenu items={[
            { label: "New Message", onSelect: () => setView({ kind: "compose" }) },
            { label: "Conversations", onSelect: () => { setTab("conversations"); setView({ kind: "list" }); } },
            { label: "Buddies", onSelect: () => { setTab("buddies"); setView({ kind: "list" }); } },
            // While a conversation is open: the same as its menu in the list.
            ...(view.kind === "thread"
                ? [{ label: "Open in New Card", onSelect: () => { void openInNewCard(view.id).catch(() => undefined); } }]
                : []),
        ]} />
    );

    if (wide) {
        return (
            <div className="msg-root wide">
                {menu}
                {list}
                <div className="msg-detail">
                    {detail ?? (
                        <div className="msg-placeholder"><Bubbles size={96} /><div>Choose a conversation or start a new one</div></div>
                    )}
                </div>
            </div>
        );
    }
    return <div className="msg-root">{menu}{detail ?? list}</div>;
}

export function App() {
    return (
        <BackProvider>
            <Messaging />
        </BackProvider>
    );
}

