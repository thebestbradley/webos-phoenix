// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// What other apps ask Messaging for, from its launch params: the one place
// they are read (docs/LAUNCH-CONTRACTS.md). Phoenix's own and the original
// webOS callers' alike; appinfo.json "phoenix.launchParams" lists the keys
// (tools/check-launch-contracts.cjs checks every caller against it).
//
// Phoenix's:
//   {threadId}                  a conversation (a message's notification;
//                               Open in New Card)
//   {to, name?, messageText?}   a new message to that address (the Assistant)
//   {messageText}               a new message with that text (Maps' share)
//   {attachment: path}          a picture message with that picture (Photos)
//   {share: {text, url, files}} the share sheet's
//   {target: "sms:...?body=" | "smsto:N:TEXT" | "im:ADDR"}  a link (@phoenix/luna links.ts)
//
// The original webOS callers' (com.palm.app.messaging):
//   {compose: {personId, phoneNumbers: [phone], ims: [im], messageText,
//              attachment, attachments: [{fullPath | path}]}}
//       Contacts' message button beside a number and its IM addresses
//       (core-apps com.palm.app.contacts app/PseudoDetailsInApp.js:316-326,
//       :352-363, :404-414; the contacts framework's PseudoDetails.js and
//       DetailsInDialog.js the same), Just Type's "Send Message" on a
//       contact's number or IM address (luna-applauncher data/AppLauncher.js:
//       40-53), the browser's Share Link > Message ({compose: {messageText}},
//       isis-browser ShareLinkDialog.js:169-176). A phone number or IM
//       address is the contact's db8 field ({value, type, serviceName?}).
//   {personId, address, serviceName, type}
//       Just Type's chat with an IM buddy (AppLauncher.js:40-44).
//   {composeAddress, messageText} and {composeRecipients: [{address,
//   serviceName?}], messageText, attachment}
//       the webOS 1.x/2.x SDK's documented launch of Messaging (Application
//       Manager, "Messaging"): no caller in the released sources uses them.
//
// webOS opened the conversation with that address when there was one, with
// the text in its compose line, else a new message to it (the person's
// name shown): resolveLaunch below does the same.

import { isImService, messageTarget, sameNumber, type ChatThread, type ImBuddy, type ImLoginState, type MessagePart } from "@phoenix/luna";
import { buddyRecipient, type Recipient } from "./lib/threads";

/** The keys read here: appinfo.json "phoenix.launchParams" must list the same. */
export const LAUNCH_PARAMS = ["threadId", "to", "name", "messageText", "attachment", "share", "target",
                              "compose", "personId", "address", "serviceName", "type", "composeAddress", "composeRecipients"] as const;

interface ContactField { value?: string; type?: string; serviceName?: string; label?: string }
interface FileRef { path?: string; fullPath?: string; mimeType?: string; type?: string }

export interface MessagingLaunchParams {
    threadId?: string;
    to?: string;
    name?: string;
    messageText?: string;
    attachment?: string | FileRef;
    share?: { title?: string; text?: string; url?: string; files?: { path: string; mimeType?: string }[] };
    target?: string;
    compose?: {
        personId?: string;
        phoneNumbers?: ContactField[];
        ims?: ContactField[];
        messageText?: string;
        attachment?: string | FileRef;
        attachments?: (string | FileRef)[];
    };
    personId?: string;
    address?: string;
    serviceName?: string;
    type?: string;
    composeAddress?: string;
    composeRecipients?: { address?: string; serviceName?: string }[];
    [key: string]: unknown;
}

/** Who a new message is to, as the caller named them. */
export interface LaunchRecipient {
    addr: string;
    name?: string;
    personId?: string;
    /** An IM address's service ("type_jabber"); none for a phone number. */
    service?: string;
}

export type LaunchIntent =
    | { kind: "none" }
    | { kind: "thread"; threadId: string }
    | { kind: "compose"; to: LaunchRecipient | null; text?: string; parts: MessagePart[] };

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);

const isPicture = (path: string, mime?: string) => /^image\//.test(mime ?? "") || /\.(jpe?g|png|gif|webp|bmp)$/i.test(path);
const pictureType = (path: string, mime?: string) =>
    (mime && /^image\//.test(mime) ? mime : undefined) ||
    (/\.png$/i.test(path) ? "image/png" : /\.gif$/i.test(path) ? "image/gif" : /\.webp$/i.test(path) ? "image/webp" : "image/jpeg");

/** A picture to attach, from a path or a {fullPath | path} (file:// allowed); null for anything else. */
function picture(f: unknown): MessagePart | null {
    const ref = typeof f === "string" ? { path: f } : f && typeof f === "object" ? f as FileRef : null;
    const raw = ref ? str(ref.fullPath) ?? str(ref.path) : undefined;
    if (!raw) return null;
    const path = raw.replace(/^file:\/\//, "");
    const mime = ref?.mimeType ?? ref?.type;
    if (!isPicture(path, mime)) return null;
    return { path, mimeType: pictureType(path, mime), name: path.replace(/^.*\//, "") };
}

/** The launch params, whoever sent them, as one thing to do. */
export function parseLaunch(p: MessagingLaunchParams | null | undefined): LaunchIntent {
    if (!p || typeof p !== "object") return { kind: "none" };
    const threadId = str(p.threadId);
    if (threadId) return { kind: "thread", threadId };

    // The share sheet: the text and link, the first picture attached.
    if (p.share && typeof p.share === "object") {
        const pic = (p.share.files ?? []).map((f) => picture({ path: f.path, mimeType: f.mimeType })).find(Boolean) ?? null;
        const text = [p.share.text, p.share.url].filter(Boolean).join(" ");
        return { kind: "compose", to: null, text: text || undefined, parts: pic ? [pic] : [] };
    }

    const c = p.compose && typeof p.compose === "object" ? p.compose : undefined;
    const personId = str(c?.personId) ?? str(p.personId);
    let to: LaunchRecipient | null = null;

    // compose {phoneNumbers}: the first number; {ims}: the first IM address.
    const phone = (c?.phoneNumbers ?? []).find((n) => n && str(n.value));
    const im = (c?.ims ?? []).find((n) => n && str(n.value));
    if (phone) to = { addr: str(phone.value)!, personId };
    else if (im) to = { addr: str(im.value)!, personId, service: str(im.serviceName) ?? imService(im.type) };
    // Just Type's IM buddy: {personId, address, serviceName, type}.
    else if (str(p.address)) to = { addr: str(p.address)!, personId, ...(str(p.serviceName) ? { service: str(p.serviceName) } : {}) };
    // The SDK's composeRecipients / composeAddress.
    else if (Array.isArray(p.composeRecipients) && p.composeRecipients.some((r) => str(r?.address))) {
        const r = p.composeRecipients.find((x) => str(x?.address))!;
        to = { addr: str(r.address)!, ...(imService(r.serviceName) ? { service: imService(r.serviceName) } : {}) };
    } else if (str(p.composeAddress)) to = { addr: str(p.composeAddress)! };

    // A link: sms:, smsto:, im:.
    const link = messageTarget(p.target);
    if (!to && link?.to) to = { addr: link.to };
    // Phoenix's {to, name}.
    if (!to && str(p.to)) to = { addr: str(p.to)! };
    if (to && str(p.name)) to.name = str(p.name);

    const text = str(c?.messageText) ?? str(p.messageText) ?? link?.messageText;
    const files: unknown[] = [...(c?.attachments ?? []), c?.attachment, p.attachment].filter((x) => x !== undefined);
    const parts = files.map(picture).filter((x): x is MessagePart => !!x).slice(0, 1);

    if (!to && !text && !parts.length) return { kind: "none" };
    return { kind: "compose", to, text, parts };
}

/** A contact's IM type ("type_jabber") or an SDK service name, as Messaging's service; SMS is none. */
function imService(type: unknown): string | undefined {
    const t = str(type);
    if (!t || /^(sms|mms)$/i.test(t)) return undefined;
    return t.startsWith("type_") ? t : "type_" + t.toLowerCase();
}

export type LaunchView =
    | { kind: "list" }
    | { kind: "thread"; id: string; text?: string; parts?: MessagePart[] }
    | { kind: "compose"; to: Recipient | null; text?: string; parts?: MessagePart[] };

/**
 * What to show for it: the conversation with that address if there is
 * one (the text in its compose line), else a new message to it, with the
 * person's name and, for an IM address, the buddy's account.
 */
export function resolveLaunch(intent: LaunchIntent, ctx: {
    threads: readonly ChatThread[]; buddies: readonly ImBuddy[]; accounts: readonly ImLoginState[]; personName?: string;
}): LaunchView | null {
    if (intent.kind === "none") return null;
    if (intent.kind === "thread") return { kind: "thread", id: intent.threadId };
    const extra = { ...(intent.text ? { text: intent.text } : {}), ...(intent.parts.length ? { parts: intent.parts } : {}) };
    const t = intent.to;
    if (!t) return { kind: "compose", to: null, ...extra };
    const name = t.name ?? ctx.personName;
    if (t.service) {
        const addr = t.addr.toLowerCase();
        const buddy = ctx.buddies.find((b) => b.serviceName === t.service && b.username.toLowerCase() === addr);
        const recipient: Recipient = (buddy && buddyRecipient(buddy, ctx.accounts)) || (() => {
            const account = ctx.accounts.find((a) => a.serviceName === t.service);
            return { addr: t.addr, name, personId: t.personId, service: t.service, account: account?.username };
        })();
        if (name && !recipient.name) recipient.name = name;
        const thread = ctx.threads.find((x) => x._id && x.replyService === t.service && (x.replyAddress ?? "").toLowerCase() === addr &&
                                              (!x.username || !recipient.account || x.username === recipient.account));
        return thread?._id ? { kind: "thread", id: thread._id, ...extra } : { kind: "compose", to: recipient, ...extra };
    }
    const thread = ctx.threads.find((x) => x._id && !isImService(x.replyService) && !!x.replyAddress && sameNumber(x.replyAddress, t.addr));
    if (thread?._id) return { kind: "thread", id: thread._id, ...extra };
    return { kind: "compose", to: { addr: t.addr, ...(name ? { name } : {}), ...(t.personId ? { personId: t.personId } : {}) }, ...extra };
}
