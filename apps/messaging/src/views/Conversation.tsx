// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// One conversation: webOS chat balloons (theirs on the left beside their
// picture, yours on the right), time stamps between bursts, the sending
// status under your last message, and the compose bar. Opening it marks
// the conversation read, and so does a message arriving while it is open.
//
// A picture message shows its pictures in the balloon; a tap shows one full
// screen, with Share (the system's sheet: Save to Photos, Email, ...). An
// IM conversation says the buddy's presence under their name, and its
// messages go by the buddy's IM service from the account the conversation
// is on. A conversation of the Fediverse's direct mentions has no presence
// and says it is not private (docs/SYNERGY-MODERN.md 3.1).

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { db, hasPresence, isImService, messaging, notPrivateNote, serviceLabel, shareSheet, type ChatThread, type ImBuddy, type Message,
         type MessagePart, type Person } from "@phoenix/luna";
import { useFileUrl } from "@phoenix/luna/react";
import { Avatar, Button, dayLabel, formatNumber, formatTime, useBack } from "@phoenix/ui";
import { buddyFor, chatItems, presenceText } from "../lib/threads";
import { useMessages } from "../lib/hooks";
import { Presence } from "../icons";
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

function PartView({ part, onOpen, onLoad }: { part: MessagePart; onOpen: () => void; onLoad: () => void }) {
    const url = useFileUrl(part.path);
    if (!/^image\//.test(part.mimeType)) return <div className="bubble-file">{part.name ?? part.path.replace(/^.*\//, "")}</div>;
    return (
        <button type="button" className="bubble-picture" data-testid="message-picture" aria-label="Open the picture" onClick={onOpen}>
            {url ? <img src={url} alt="" draggable={false} onLoad={onLoad} /> : <span className="bubble-picture-blank" />}
        </button>
    );
}

/** A message's picture, full screen; back or Done closes it. */
function PictureViewer({ part, onClose }: { part: MessagePart; onClose: () => void }) {
    const url = useFileUrl(part.path);
    useBack(() => { onClose(); return true; });
    return (
        <div className="picture-viewer" data-testid="picture-viewer">
            {url && <img src={url} alt="" draggable={false} />}
            <div className="picture-viewer-bar">
                <Button onClick={() => void shareSheet.open({ files: [{ path: part.path, mimeType: part.mimeType }] }).catch(() => undefined)}
                        data-testid="picture-share">Share</Button>
                <Button onClick={onClose} data-testid="picture-done">Done</Button>
            </div>
        </div>
    );
}

export function Conversation({ threadId, people, buddies, header }: {
    threadId: string; people: readonly Person[]; buddies: readonly ImBuddy[]; header?: boolean;
}) {
    const [thread, setThread] = useState<ChatThread | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [viewing, setViewing] = useState<MessagePart | null>(null);
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

    // The newest message in view; again when a picture has loaded and
    // grown its balloon.
    const toEnd = () => {
        const el = scroller.current;
        if (el) el.scrollTop = el.scrollHeight;
    };
    useLayoutEffect(toEnd, [messages?.length]);

    const im = isImService(thread?.replyService);
    const notPrivate = im ? notPrivateNote(thread?.replyService) : undefined;
    const buddy = im ? buddyFor(thread, buddies) : undefined;
    const person = thread?.personId ? people.find((p) => p._id === thread.personId) : undefined;
    const photo = person?.photos?.localPathList || person?.photos?.localPathSquare;
    const name = thread?.displayName || (im ? thread?.replyAddress ?? "" : formatNumber(thread?.replyAddress ?? ""));
    const send = (text: string, parts: MessagePart[]) => {
        if (!thread?.replyAddress) return;
        setError(null);
        const to = { addr: thread.replyAddress, name: thread.displayName };
        const sent = im
            ? thread.username ? messaging.sendIm(thread.replyService!, thread.username, to, text, threadId)
                              : Promise.reject(new Error("This conversation's IM account is gone"))
            : parts.length ? messaging.sendMms(to, text, parts, threadId)
            : messaging.sendSms(to, text, threadId);
        sent.catch((e: { errorText?: string; message?: string }) => setError(e.errorText ?? e.message ?? "Could not send"));
    };

    return (
        <div className="conversation">
            {header !== false && (
                <div className="msg-header conversation-header"><div className="msg-header-inner">
                    <Avatar size={36} src={photo} />
                    <div className="msg-header-text" data-testid="thread-title">
                        <div className="msg-header-title">{name}</div>
                        {im && hasPresence(thread?.replyService) ? (
                            <div className="msg-header-sub" data-testid="thread-presence">
                                <Presence availability={buddy?.availability} /> {presenceText(buddy)} · {serviceLabel(thread?.replyService)}
                            </div>
                        ) : im ? (
                            <div className="msg-header-sub" data-testid="thread-service">
                                {thread?.replyAddress && thread.displayName !== thread.replyAddress ? "@" + thread.replyAddress + " · " : ""}
                                {serviceLabel(thread?.replyService)}
                            </div>
                        ) : thread?.replyAddress && thread.displayName !== thread.replyAddress &&
                            <div className="msg-header-sub">{formatNumber(thread.replyAddress)}</div>}
                    </div>
                </div></div>
            )}
            {notPrivate && <div className="chat-notice" role="note" data-testid="not-private">{notPrivate}</div>}
            <div className="chat" ref={scroller} data-testid="chat">
                {messages && chatItems(messages).map((it) => it.kind === "time" ? (
                    <div key={it.key} className="chat-time">{stamp(it.timestamp)}</div>
                ) : (
                    <div key={it.key} className={`chat-row ${it.incoming ? "in" : "out"}${it.last ? " last" : ""}`}>
                        {it.incoming && <span className="chat-avatar">{it.last && <Avatar size={32} src={photo} />}</span>}
                        <div className={`bubble ${it.incoming ? "in" : "out"}${it.message.parts?.length ? " has-parts" : ""}`}
                             data-status={it.message.status} data-service={it.message.serviceName}>
                            {it.message.parts?.map((p) => <PartView key={p.path} part={p} onOpen={() => setViewing(p)} onLoad={toEnd} />)}
                            {it.message.messageText && <div className="bubble-text">{it.message.messageText}</div>}
                        </div>
                        {!it.incoming && it.last && statusLabel(it.message) &&
                            <div className={`chat-status ${it.message.status}`}>{statusLabel(it.message)}</div>}
                    </div>
                ))}
            </div>
            {error && <div className="compose-error" role="alert">{error}</div>}
            <ComposeBar onSend={send} disabled={!thread} service={im ? thread?.replyService : "sms"} />
            {viewing && <PictureViewer part={viewing} onClose={() => setViewing(null)} />}
        </div>
    );
}
