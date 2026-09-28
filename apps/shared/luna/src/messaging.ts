// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Text messages, stored as on webOS 2.x/3.x in db8:
//
//   com.palm.message:1     every message (IM or SMS); indexes by
//                          conversations + localTimestamp ("bychat")
//   com.palm.smsmessage:1  extends com.palm.message:1; owned by the
//                          telephony service, which sends messages put in
//                          folder "outbox" with status "pending" and puts
//                          received ones in "inbox"
//   com.palm.chatthread:1  one per conversation: displayName, summary,
//                          timestamp, unreadCount, personId,
//                          normalizedAddress, replyAddress, replyService
//
// Sources: webOS-ports/webos-telephonyd files/db8/kinds/com.palm.smsmessage,
// files/activities/com.palm.telephony/outgoing-sms.json and
// src/telephonyservice_sms.c (incoming message fields, status updates);
// webOS-ports/org.webosports.messaging service/configuration/db/kinds and
// service/javascript/utils/MessageAssigner.js (chat thread fields).
//
// Sending goes through the LuneOS messaging service, which assigns the
// message to a thread and stores it (service/javascript/assistants/PutMessage.js):
//
//   luna://org.webosports.service.messaging/putMessage {message} -> {threadids}

import { call, type LunaError, type Subscription } from "./bridge";
import { db, type DbObject } from "./db8";

export const MESSAGE_KIND = "com.palm.message:1";
export const SMS_KIND = "com.palm.smsmessage:1";
export const THREAD_KIND = "com.palm.chatthread:1";

export interface MessageAddress {
    addr: string;
    name?: string;
}

export type MessageFolder = "inbox" | "outbox" | "drafts" | "system";
/** telephonyd sets pending -> sending -> successful | failed. */
export type MessageStatus = "pending" | "sending" | "successful" | "failed" | "permanent-fail";

export interface Message extends DbObject {
    folder: MessageFolder;
    status?: MessageStatus;
    serviceName: string;          // "sms", or an IM transport
    messageText: string;
    from?: MessageAddress;
    to?: MessageAddress[];
    /** Chat thread ids. */
    conversations?: string[];
    localTimestamp: number;
    timestamp: number;
    flags?: { read?: boolean; visible?: boolean };
}

export interface ChatThread extends DbObject {
    displayName?: string;
    summary?: string;
    timestamp?: number;
    unreadCount?: number;
    personId?: string;
    normalizedAddress?: string;
    replyAddress?: string;
    replyService?: string;
    flags?: { visible?: boolean };
}

type OnError = (e: LunaError) => void;

export const messaging = {
    /** Conversations, newest first. */
    watchThreads(cb: (threads: ChatThread[]) => void, onError?: OnError): Subscription {
        return db.watch<ChatThread>({ from: THREAD_KIND, orderBy: "timestamp", desc: true }, (all) =>
            cb(all.filter((t) => t.flags?.visible !== false)), onError);
    },
    /** One conversation's messages, oldest first (index "bychat"). */
    watchMessages(threadId: string, cb: (messages: Message[]) => void, onError?: OnError): Subscription {
        return db.watch<Message>({
            from: MESSAGE_KIND,
            where: [{ prop: "conversations", op: "=", val: threadId }],
            orderBy: "localTimestamp",
        }, cb, onError);
    },
    /**
     * Send a text: putMessage with a complete com.palm.smsmessage:1 in the
     * outbox; the telephony service sends it and updates its status.
     * Resolves with the thread ids it was assigned to.
     */
    async sendSms(to: MessageAddress, text: string, threadId?: string): Promise<string[]> {
        const now = Date.now();
        const message: Message = {
            _kind: SMS_KIND,
            folder: "outbox",
            status: "pending",
            serviceName: "sms",
            messageText: text,
            to: [to],
            localTimestamp: now,
            timestamp: now,
            flags: { visible: true, read: true },
            ...(threadId ? { conversations: [threadId] } : {}),
        };
        const r = await call("luna://org.webosports.service.messaging/putMessage", { message });
        return (r as { threadids?: string[] }).threadids ?? [];
    },
    /** Mark a conversation read: its inbox messages' flags.read and the thread's unreadCount. */
    async markRead(threadId: string): Promise<void> {
        const unread = await db.find<Message>({
            from: MESSAGE_KIND,
            where: [{ prop: "conversations", op: "=", val: threadId }, { prop: "folder", op: "=", val: "inbox" }],
        });
        const changes = unread.filter((m) => !m.flags?.read && m._id)
            .map((m) => ({ _id: m._id!, flags: { ...(m.flags ?? {}), read: true } }));
        if (changes.length) await db.merge(changes);
        await db.merge([{ _id: threadId, unreadCount: 0 }]);
    },
    /** Delete a conversation and its messages. */
    async deleteThread(threadId: string): Promise<void> {
        await db.delWhere({ from: MESSAGE_KIND, where: [{ prop: "conversations", op: "=", val: threadId }] });
        await db.del([threadId]);
    },
};

/** Transports the webOS 2.x Messaging app offered. Only SMS works in Phoenix so far. */
export const TRANSPORTS: { id: string; label: string; available: boolean }[] = [
    { id: "sms", label: "Text (SMS)", available: true },
    { id: "type_aim", label: "AIM", available: false },
    { id: "type_gtalk", label: "Google Talk", available: false },
    { id: "type_yahoo", label: "Yahoo!", available: false },
    { id: "type_skype", label: "Skype", available: false },
];
