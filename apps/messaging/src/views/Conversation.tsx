// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// One conversation: webOS chat balloons (theirs on the left beside their
// picture, yours on the right), time stamps between bursts, the sending
// status under your last message, and the compose bar. Opening it marks
// the conversation read, and so does a message arriving while it is open.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { db, messaging, type ChatThread, type Message, type Person } from "@phoenix/luna";
import { Avatar, dayLabel, formatNumber, formatTime } from "@phoenix/ui";
import { chatItems } from "../lib/threads";
import { useMessages } from "../lib/hooks";
import { ComposeBar } from "./ComposeBar";

function statusLabel(m: Message): string | null {
    switch (m.status) {
    case "pending": case "sending": return "Sending…";
    case "failed": case "permanent-fail": return "Not sent";
    default: return null;
    }
}

function stamp(ts: number): string {
    const day = dayLabel(ts);
    return day === "Today" ? formatTime(ts) : `${day} ${formatTime(ts)}`;
}

export function Conversation({ threadId, people, header }: { threadId: string; people: readonly Person[]; header?: boolean }) {
    const [thread, setThread] = useState<ChatThread | null>(null);
    const messages = useMessages(threadId);
    const scroller = useRef<HTMLDivElement>(null);

    useEffect(() => {
        let alive = true;
        db.get<ChatThread>([threadId]).then(([t]) => { if (alive) setThread(t ?? null); }, () => {});
        return () => { alive = false; };
    }, [threadId, messages]);

    // Read while open.
    const unreadIn = messages?.some((m) => m.folder === "inbox" && !m.flags?.read) ?? false;
    useEffect(() => {
        if (unreadIn || (thread?.unreadCount ?? 0) > 0) messaging.markRead(threadId).catch(() => {});
    }, [threadId, unreadIn, thread?.unreadCount]);

    useLayoutEffect(() => {
        const el = scroller.current;
        if (el) el.scrollTop = el.scrollHeight;
    }, [messages?.length]);

    const person = thread?.personId ? people.find((p) => p._id === thread.personId) : undefined;
    const photo = person?.photos?.localPathList || person?.photos?.localPathSquare;
    const name = thread?.displayName || formatNumber(thread?.replyAddress ?? "");
    const send = (text: string) => {
        if (!thread?.replyAddress) return;
        messaging.sendSms({ addr: thread.replyAddress, name: thread.displayName }, text, threadId).catch(() => {});
    };

    return (
        <div className="conversation">
            {header !== false && (
                <div className="msg-header conversation-header"><div className="msg-header-inner">
                    <Avatar size={36} src={photo} />
                    <div className="msg-header-text" data-testid="thread-title">
                        <div className="msg-header-title">{name}</div>
                        {thread?.replyAddress && thread.displayName !== thread.replyAddress &&
                            <div className="msg-header-sub">{formatNumber(thread.replyAddress)}</div>}
                    </div>
                </div></div>
            )}
            <div className="chat" ref={scroller} data-testid="chat">
                {messages && chatItems(messages).map((it) => it.kind === "time" ? (
                    <div key={it.key} className="chat-time">{stamp(it.timestamp)}</div>
                ) : (
                    <div key={it.key} className={`chat-row ${it.incoming ? "in" : "out"}${it.last ? " last" : ""}`}>
                        {it.incoming && <span className="chat-avatar">{it.last && <Avatar size={32} src={photo} />}</span>}
                        <div className={`bubble ${it.incoming ? "in" : "out"}`} data-status={it.message.status}>
                            {it.message.messageText}
                        </div>
                        {!it.incoming && it.last && statusLabel(it.message) &&
                            <div className={`chat-status ${it.message.status}`}>{statusLabel(it.message)}</div>}
                    </div>
                ))}
            </div>
            <ComposeBar onSend={send} disabled={!thread} />
        </div>
    );
}
