// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The links the application manager hands to Phone and Messaging. A link
// to tel:, sms: or im: (a tapped link in a page, Scanner's Call / Send
// Text, applicationManager open {target}) launches the app its scheme
// belongs to (/usr/palm/command-resource-handlers.json) with the link
// itself, {target: "tel:..."}, as luna-sysmgr launched a scheme handler
// (ApplicationManagerService.cpp:1428-1435: appLaunch(handler,
// {"target": uri})). The app reads the number (and text) from it.

/** tel:NUMBER (RFC 3966; also tel://NUMBER) -> the number, else undefined. */
export function telTarget(target: unknown): string | undefined {
    if (typeof target !== "string") return undefined;
    const m = /^tel:(?:\/\/)?([^;?#]*)/i.exec(target.trim());
    if (!m) return undefined;
    const number = safeDecode(m[1]).trim();
    return number || undefined;
}

/**
 * sms:NUMBER[,NUMBER]?body=TEXT (RFC 5724), smsto:NUMBER:TEXT (as QR codes
 * write it) and im:ADDRESS -> {to, messageText}, else undefined.
 */
export function messageTarget(target: unknown): { to?: string; messageText?: string } | undefined {
    if (typeof target !== "string") return undefined;
    const t = target.trim();
    const sms = /^(sms|smsto|mms|mmsto):(?:\/\/)?([^?#]*)(?:\?([^#]*))?/i.exec(t);
    if (sms) {
        let to = safeDecode(sms[2]);
        let messageText: string | undefined;
        // smsto:NUMBER:TEXT
        const colon = /^(smsto|mmsto)$/i.test(sms[1]) ? to.indexOf(":") : -1;
        if (colon >= 0) { messageText = to.slice(colon + 1); to = to.slice(0, colon); }
        const q = new URLSearchParams(sms[3] ?? "");
        messageText = q.get("body") ?? messageText;
        // One recipient: the first of a list.
        to = to.split(",")[0].trim();
        return { ...(to ? { to } : {}), ...(messageText ? { messageText } : {}) };
    }
    const im = /^im:(?:\/\/)?([^?#]*)/i.exec(t);
    if (im) {
        const to = safeDecode(im[1]).trim();
        return to ? { to } : {};
    }
    return undefined;
}

function safeDecode(s: string): string {
    try { return decodeURIComponent(s); } catch { return s; }
}
