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
//
// Picture messages and instant messages, as webOS kept them (the TouchPad
// Messaging app's queries name the fields):
//
//   com.palm.mmsmessage:1  extends com.palm.message:1; serviceName "mms",
//                          parts [{path, mimeType, name}] (the pictures, kept
//                          by the MMS store; the text is messageText)
//   com.palm.immessage:1   extends com.palm.message:1, one kind per transport
//                          (com.palm.immessage.xmpp:1); serviceName
//                          "type_jabber", username = the account's address,
//                          from / to the buddy's
//   com.palm.imloginstate:1   db8: an IM account's state (accountId,
//                          username, serviceName, state "online" | "offline",
//                          availability, customMessage)
//   com.palm.imbuddystatus:1  tempdb: a buddy's presence (accountId,
//                          username, displayName, personId, availability,
//                          status), which Contacts shows too
//
// Availability, as webOS numbered it: 0 available, 1 mobile, 2 busy (away),
// 3 invisible, 4 offline.

import { call, type LunaError, type Subscription } from "./bridge";
import { db, tempdb, type DbObject } from "./db8";

export const MESSAGE_KIND = "com.palm.message:1";
export const SMS_KIND = "com.palm.smsmessage:1";
export const MMS_KIND = "com.palm.mmsmessage:1";
export const IM_KIND = "com.palm.immessage:1";
export const THREAD_KIND = "com.palm.chatthread:1";
export const IM_LOGIN_KIND = "com.palm.imloginstate:1";
export const IM_BUDDY_KIND = "com.palm.imbuddystatus:1";

/** The IM transports' message kinds, by serviceName. */
export const IM_MESSAGE_KINDS: Record<string, string> = {
    // The Jabber (XMPP) account (apps/connectors/xmpp; docs/SYNERGY-CONNECTORS.md 7).
    type_jabber: "com.palm.immessage.xmpp:1",
    // The Fediverse account's direct mentions (apps/fediverse; docs/SYNERGY-CONNECTORS.md C2).
    type_fediverse: "com.palm.immessage.fediverse:1",
    // Matrix (apps/matrix), Delta Chat (apps/deltachat), the unofficial Telegram client (apps/telegram).
    type_matrix: "com.palm.immessage.matrix:1",
    type_deltachat: "com.palm.immessage.deltachat:1",
    type_telegram: "com.palm.immessage.telegram:1",
};

export const AVAILABILITY = { AVAILABLE: 0, MOBILE: 1, BUSY: 2, INVISIBLE: 3, OFFLINE: 4 } as const;

/** "available", "busy", "offline": the presence class for an availability. */
export function presenceClass(availability: number | undefined): "available" | "busy" | "offline" {
    if (availability === AVAILABILITY.AVAILABLE || availability === AVAILABILITY.MOBILE) return "available";
    if (availability === AVAILABILITY.BUSY) return "busy";
    return "offline";
}

/** True for an instant messaging service name ("type_jabber"), false for SMS and MMS. */
export function isImService(service: string | undefined): boolean {
    return /^type_/.test(service ?? "");
}

/** A picture (or other part) of a picture message. */
export interface MessagePart {
    path: string;
    mimeType: string;
    name?: string;
}

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
    serviceName: string;          // "sms", "mms", or an IM transport ("type_jabber")
    messageText: string;
    from?: MessageAddress;
    to?: MessageAddress[];
    /** Chat thread ids. */
    conversations?: string[];
    localTimestamp: number;
    timestamp: number;
    flags?: { read?: boolean; visible?: boolean };
    /** A picture message's pictures. */
    parts?: MessagePart[];
    /** An instant message's account (its address). */
    username?: string;
    /**
     * An outgoing instant message the other side has: "delivered", then
     * "read" (a receipt, a chat marker; named as LuneOS's imlibpurpleservice
     * names them, inc/IMMessage.h).
     */
    deliveryStatus?: "delivered" | "read";
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
    /** An IM conversation's account (its address). */
    username?: string;
    flags?: { visible?: boolean };
}

/** An IM account's state (com.palm.imloginstate:1). */
export interface ImLoginState extends DbObject {
    accountId: string;
    username: string;
    serviceName: string;
    state: "online" | "offline" | "logging-on" | "retrieving-buddies" | "logging-out";
    availability: number;
    customMessage?: string;
}

/** A buddy and their presence (com.palm.imbuddystatus:1, tempdb). */
export interface ImBuddy extends DbObject {
    accountId: string;
    /** The buddy's address on the service. */
    username: string;
    serviceName: string;
    displayName?: string;
    personId?: string;
    availability: number;
    status?: string;
    group?: string;
    /** "composing" while they type (a chat state, XEP-0085), "" otherwise. */
    chatState?: string;
}

type OnError = (e: LunaError) => void;

/** The Luna service of an IM transport ("org.webosphoenix.service.xmpp" for "type_jabber"). */
export function transportService(serviceName: string | undefined): string | undefined {
    return IM_SERVICES.find((s) => s.id === serviceName)?.service;
}

/** Whether pictures can be sent on a transport: SMS (as MMS) and the IM services that take them. */
export function takesPictures(serviceName: string | undefined): boolean {
    return !isImService(serviceName) || !!IM_SERVICES.find((s) => s.id === serviceName)?.pictures;
}

// The account an IM conversation is on: its login state's, by the account's address.
async function imAccountOf(thread: ChatThread): Promise<string | undefined> {
    if (!thread.username) return undefined;
    const states = await db.find<ImLoginState>({ from: IM_LOGIN_KIND, where: [{ prop: "username", op: "=", val: thread.username }] }).catch(() => []);
    return states.find((s) => s.serviceName === thread.replyService)?.accountId;
}

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
    /**
     * Send a picture message: a com.palm.mmsmessage:1 in the outbox with
     * its pictures; the messaging service keeps copies of them (the MMS
     * store) and the telephony service sends it, as it does texts.
     */
    async sendMms(to: MessageAddress, text: string, parts: MessagePart[], threadId?: string): Promise<string[]> {
        const now = Date.now();
        const message: Message = {
            _kind: MMS_KIND,
            folder: "outbox",
            status: "pending",
            serviceName: "mms",
            messageText: text,
            parts,
            to: [to],
            localTimestamp: now,
            timestamp: now,
            flags: { visible: true, read: true },
            ...(threadId ? { conversations: [threadId] } : {}),
        };
        const r = await call("luna://org.webosports.service.messaging/putMessage", { message });
        return (r as { threadids?: string[] }).threadids ?? [];
    },
    /**
     * Send an instant message from an IM account (its address, `username`)
     * to a buddy; the account's transport sends it, with its pictures
     * where the service takes them (IM_SERVICES pictures: Jabber's HTTP
     * upload, Matrix's media).
     */
    async sendIm(service: string, username: string, to: MessageAddress, text: string, threadId?: string,
                 parts?: MessagePart[]): Promise<string[]> {
        const kind = IM_MESSAGE_KINDS[service];
        if (!kind) throw new Error(`No IM transport for ${service}`);
        const now = Date.now();
        const message: Message = {
            _kind: kind,
            folder: "outbox",
            status: "pending",
            serviceName: service,
            username,
            messageText: text,
            ...(parts && parts.length ? { parts } : {}),
            to: [to],
            localTimestamp: now,
            timestamp: now,
            flags: { visible: true, read: true },
            ...(threadId ? { conversations: [threadId] } : {}),
        };
        const r = await call("luna://org.webosports.service.messaging/putMessage", { message });
        return (r as { threadids?: string[] }).threadids ?? [];
    },
    /** The IM accounts and their state, now and after every change. */
    watchImAccounts(cb: (states: ImLoginState[]) => void, onError?: OnError): Subscription {
        return db.watch<ImLoginState>({ from: IM_LOGIN_KIND }, cb, onError);
    },
    /** Every buddy of every IM account, with presence. */
    watchBuddies(cb: (buddies: ImBuddy[]) => void, onError?: OnError): Subscription {
        return tempdb.watch<ImBuddy>({ from: IM_BUDDY_KIND }, cb, onError);
    },
    /**
     * Your own status on an IM account: its transport's setPresence (the
     * original transports watched imloginstate.availability, which the
     * Messaging app wrote; imlibpurpleservice src/IMLoginState.cpp).
     */
    async setPresence(accountId: string, availability: number, customMessage?: string): Promise<void> {
        const [state] = await db.find<ImLoginState>({ from: IM_LOGIN_KIND, where: [{ prop: "accountId", op: "=", val: accountId }] });
        const svc = transportService(state?.serviceName) ?? "org.webosphoenix.service.xmpp";
        await call(`luna://${svc}/setPresence`, { accountId, availability,
            ...(customMessage !== undefined ? { customMessage } : {}) });
    },
    /** Typing in an IM conversation (XEP-0085 on Jabber): best effort. */
    async chatState(thread: ChatThread, state: "composing" | "paused" | "active"): Promise<void> {
        const svc = transportService(thread.replyService);
        const accountId = svc ? await imAccountOf(thread) : undefined;
        if (!svc || !accountId || !thread.replyAddress) return;
        await call(`luna://${svc}/chatState`, { accountId, to: thread.replyAddress, state }).catch(() => undefined);
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
        // An IM conversation: its transport tells the other side it was read
        // (a chat marker, a read receipt), where it can; best effort.
        if (changes.length) {
            const [thread] = await db.get<ChatThread>([threadId]).catch(() => [] as ChatThread[]);
            const svc = transportService(thread?.replyService);
            const accountId = svc && thread ? await imAccountOf(thread) : undefined;
            if (svc && accountId) await call(`luna://${svc}/markRead`, { accountId, threadId }).catch(() => undefined);
        }
    },
    /** Delete a conversation and its messages. */
    async deleteThread(threadId: string): Promise<void> {
        await db.delWhere({ from: MESSAGE_KIND, where: [{ prop: "conversations", op: "=", val: threadId }] });
        await db.del([threadId]);
    },
};

/**
 * IM services webOS Messaging knew, and which Phoenix has a transport for.
 * Jabber (XMPP), Matrix, Delta Chat and Telegram have transports (their
 * connectors: apps/connectors, apps/telegram), as the Fediverse; the closed
 * networks webOS reached through libpurple are gone or closed.
 */
export interface ImServiceInfo {
    id: string;
    label: string;
    available: boolean;
    presence?: boolean;
    notPrivate?: string;
    /** The transport's Luna service (setPresence, markRead, chatState). */
    service?: string;
    /** Pictures can be sent on it. */
    pictures?: boolean;
}

export const IM_SERVICES: ImServiceInfo[] = [
    { id: "type_jabber", label: "Jabber (XMPP)", available: true, service: "org.webosphoenix.service.xmpp", pictures: true },
    { id: "type_matrix", label: "Matrix", available: true, presence: false, service: "org.webosphoenix.service.matrix", pictures: true },
    { id: "type_deltachat", label: "Delta Chat", available: true, presence: false, service: "org.webosphoenix.service.deltachat", pictures: true },
    { id: "type_telegram", label: "Unofficial Telegram", available: true, presence: false, service: "org.webosphoenix.service.telegram", pictures: true,
      notPrivate: "Not end-to-end encrypted: Telegram's chats other than secret chats are kept on Telegram's servers, which can read them." },
    // Direct mentions: no presence, and no privacy from the servers' admins
    // (docs/SYNERGY-MODERN.md 3.1: shown "with a not private label").
    { id: "type_fediverse", label: "Fediverse", available: true, presence: false,
      notPrivate: "Not private: direct mentions are not encrypted, and the admins of both servers can read them." },
    { id: "type_aim", label: "AIM", available: false },
    { id: "type_gtalk", label: "Google Talk", available: false },
    { id: "type_yahoo", label: "Yahoo!", available: false },
    { id: "type_skype", label: "Skype", available: false },
];

/** Whether an IM service has presence (available, busy, offline) to show. */
export function hasPresence(service: string | undefined): boolean {
    return isImService(service) && IM_SERVICES.find((s) => s.id === service)?.presence !== false;
}

/** For a service whose messages are not private (the Fediverse's direct mentions): what to tell the user. */
export function notPrivateNote(service: string | undefined): string | undefined {
    return IM_SERVICES.find((s) => s.id === service)?.notPrivate;
}

/** "Jabber (XMPP)" for "type_jabber"; "Text" for SMS, "Picture" for MMS. */
export function serviceLabel(service: string | undefined): string {
    if (!service || service === "sms") return "Text";
    if (service === "mms") return "Picture";
    return IM_SERVICES.find((s) => s.id === service)?.label ?? service;
}
