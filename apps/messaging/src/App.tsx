// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Messaging: Conversations and Buddies in the dark view menu at the top,
// as in webOS 2.x Messaging; a conversation or a new message fills the
// card, and back returns to the list. On a tablet the list stays on the
// left and the conversation opens on the right.
//
// Launch params: {threadId} opens a conversation; {to, name?} starts a
// message to that number.

import { useEffect, useState } from "react";
import { useLaunchParams } from "@phoenix/luna/react";
import { BackProvider, RadioToolGroup, ToolBar, ToolButton, useBack } from "@phoenix/ui";
import { usePeople, useThreads, useWide } from "./lib/hooks";
import type { Recipient } from "./lib/threads";
import { ThreadList } from "./views/ThreadList";
import { Conversation } from "./views/Conversation";
import { Compose } from "./views/Compose";
import { Buddies } from "./views/Buddies";
import { Bubbles, Compose as ComposeIcon } from "./icons";

type View = { kind: "list" } | { kind: "thread"; id: string } | { kind: "compose"; to?: Recipient | null };

function Messaging() {
    const params = useLaunchParams<{ threadId?: string; to?: string; name?: string }>();
    const people = usePeople();
    const threads = useThreads();
    const wide = useWide();
    const [tab, setTab] = useState<"conversations" | "buddies">("conversations");
    const [view, setView] = useState<View>({ kind: "list" });

    useEffect(() => {
        if (params.threadId) setView({ kind: "thread", id: params.threadId });
        else if (params.to) setView({ kind: "compose", to: { addr: params.to, name: params.name } });
    }, [params]);

    useBack(() => { setView({ kind: "list" }); return true; }, view.kind !== "list");

    const unread = (threads ?? []).reduce((n, t) => n + (t.unreadCount ?? 0), 0);
    const detail = view.kind === "thread"
        ? <Conversation key={view.id} threadId={view.id} people={people} />
        : view.kind === "compose"
            ? <Compose key="compose" people={people} initialTo={view.to} onSent={(id) => setView({ kind: "thread", id })} />
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
                    ? <ThreadList threads={threads} people={people} selected={view.kind === "thread" ? view.id : null}
                                  onOpen={(t) => t._id && setView({ kind: "thread", id: t._id })} />
                    : <Buddies />}
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

    if (wide) {
        return (
            <div className="msg-root wide">
                {list}
                <div className="msg-detail">
                    {detail ?? (
                        <div className="msg-placeholder"><Bubbles size={96} /><div>Choose a conversation or start a new one</div></div>
                    )}
                </div>
            </div>
        );
    }
    return <div className="msg-root">{detail ?? list}</div>;
}

export function App() {
    return (
        <BackProvider>
            <Messaging />
        </BackProvider>
    );
}
