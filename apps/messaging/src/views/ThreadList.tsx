// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Conversations (com.palm.chatthread:1), newest first: the person's
// picture, name, the last message and its time, and the unread count. An
// IM conversation shows the buddy's presence beside the name.

import { isImService, type ChatThread, type ImBuddy, type Person } from "@phoenix/luna";
import { Avatar, formatNumber, shortWhen } from "@phoenix/ui";
import { buddyFor, presenceText } from "../lib/threads";
import { Presence } from "../icons";

export function ThreadList({ threads, people, buddies, selected, onOpen }: {
    threads: ChatThread[] | null;
    people: readonly Person[];
    buddies: readonly ImBuddy[];
    selected?: string | null;
    onOpen: (t: ChatThread) => void;
}) {
    if (threads && threads.length === 0)
        return <div className="msg-empty">No conversations yet. Tap the compose button to start one.</div>;
    return (
        <div className="thread-list" role="list">
            {(threads ?? []).map((t) => {
                const person = t.personId ? people.find((p) => p._id === t.personId) : undefined;
                const unread = t.unreadCount ?? 0;
                const im = isImService(t.replyService);
                const buddy = im ? buddyFor(t, buddies) : undefined;
                return (
                    <div key={t._id} role="listitem" tabIndex={0} data-testid="thread-row" data-service={t.replyService ?? "sms"}
                         className={`thread-row${unread ? " unread" : ""}${selected === t._id ? " selected" : ""}`}
                         onClick={() => onOpen(t)} onKeyDown={(e) => { if (e.key === "Enter") onOpen(t); }}>
                        <Avatar size={44} src={person?.photos?.localPathList || person?.photos?.localPathSquare} />
                        <div className="thread-body">
                            <div className="thread-top">
                                <span className="thread-name">
                                    {im && <Presence availability={buddy?.availability} title={presenceText(buddy)} />}
                                    {t.displayName || (im ? t.replyAddress : formatNumber(t.replyAddress ?? ""))}
                                </span>
                                <span className="thread-when">{t.timestamp ? shortWhen(t.timestamp) : ""}</span>
                            </div>
                            <div className="thread-bottom">
                                <span className="thread-summary">{t.summary}</span>
                                {unread > 0 && <span className="thread-unread">{unread}</span>}
                            </div>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
