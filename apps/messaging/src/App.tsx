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
// Launch params: {threadId} opens a conversation; {to, name?} starts a
// message to that number; {messageText} (webOS 2.x's name for it) starts a
// message with that text, e.g. a location shared from Maps; {share: {text,
// url, files}} (the share sheet) starts one with the text and the first
// picture attached; {attachment} (a path: Photos' Share) attaches that
// picture.

import { useEffect, useMemo, useState } from "react";
import { messageTarget, messaging, type MessagePart } from "@phoenix/luna";
import { useLaunchParams } from "@phoenix/luna/react";
import { AppMenu, BackProvider, RadioToolGroup, ToolBar, ToolButton, useBack } from "@phoenix/ui";
import { useBuddies, useImAccounts, usePeople, useThreads, useWide } from "./lib/hooks";
import type { Recipient } from "./lib/threads";
import { ThreadList } from "./views/ThreadList";
import { Conversation } from "./views/Conversation";
import { Compose } from "./views/Compose";
import { Buddies } from "./views/Buddies";
import { Bubbles, Compose as ComposeIcon } from "./icons";

type View = { kind: "list" } | { kind: "thread"; id: string }
    | { kind: "compose"; to?: Recipient | null; text?: string; parts?: MessagePart[] };

const isPicture = (path: string, mime?: string) => /^image\//.test(mime ?? "") || /\.(jpe?g|png|gif|webp|bmp)$/i.test(path);
const pictureType = (path: string, mime?: string) =>
    mime || (/\.png$/i.test(path) ? "image/png" : /\.gif$/i.test(path) ? "image/gif" : /\.webp$/i.test(path) ? "image/webp" : "image/jpeg");

function Messaging() {
    // {target: "sms:..." | "im:..."}: a link (the application manager's,
    // @phoenix/luna links.ts), a new message to its recipient with its text.
    const launch = useLaunchParams<{ threadId?: string; to?: string; name?: string; messageText?: string; attachment?: string; target?: string;
                                     share?: { title?: string; text?: string; url?: string; files?: { path: string; mimeType?: string }[] } }>();
    const params = useMemo(() => {
        const m = messageTarget(launch.target);
        return m ? { ...launch, ...m } : launch;
    }, [launch]);
    const people = usePeople();
    const threads = useThreads();
    const buddies = useBuddies();
    const accounts = useImAccounts();
    const wide = useWide();
    const [tab, setTab] = useState<"conversations" | "buddies">("conversations");
    const [view, setView] = useState<View>({ kind: "list" });

    useEffect(() => {
        if (params.threadId) setView({ kind: "thread", id: params.threadId });
        // From the share sheet: a new message with the text and the link,
        // and the first picture attached.
        else if (params.share) {
            const pic = (params.share.files ?? []).find((f) => isPicture(f.path, f.mimeType));
            setView({ kind: "compose", to: null, text: [params.share.text, params.share.url].filter(Boolean).join(" "),
                      parts: pic ? [{ path: pic.path, mimeType: pictureType(pic.path, pic.mimeType), name: pic.path.replace(/^.*\//, "") }] : [] });
        } else if (params.attachment && isPicture(params.attachment))
            setView({ kind: "compose", to: null,
                      parts: [{ path: params.attachment, mimeType: pictureType(params.attachment), name: params.attachment.replace(/^.*\//, "") }] });
        else if (params.to || params.messageText)
            setView({ kind: "compose", to: params.to ? { addr: params.to, name: params.name } : null, text: params.messageText });
    }, [params]);

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
        ? <Conversation key={view.id} threadId={view.id} people={people} buddies={buddies} />
        : view.kind === "compose"
            ? <Compose key={"compose" + (view.to?.addr ?? "")} people={people} buddies={buddies} accounts={accounts}
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
                                  onOpen={(t) => t._id && setView({ kind: "thread", id: t._id })} />
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

