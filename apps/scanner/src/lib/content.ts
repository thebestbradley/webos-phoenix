// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// What a scanned code says, and what the app can do with it. The formats
// are the de facto ones every phone scanner reads:
//
//   http(s)://...                         web address
//   WIFI:T:WPA;S:ssid;P:pass;H:true;;     Wi-Fi network (ZXing's format)
//   BEGIN:VCARD ... END:VCARD             contact (vCard 2.1 / 3.0 / 4.0)
//   MECARD:N:Doe,John;TEL:...;;           contact (NTT DoCoMo MeCard)
//   otpauth://totp/Label?secret=...       authenticator key (Key Uri Format)
//   tel:, mailto:, MATMSG:, sms:, smsto:  phone number, email, text message
//   geo:lat,lon                           a place
//   EAN / UPC barcodes                    product numbers
//   anything else                         text

/** A contact as the Contacts app takes it ({launchType: "newContact", contact}, com.palm.contact:1 fields). */
export interface PalmContact {
    name?: { givenName?: string; familyName?: string; middleName?: string; honorificPrefix?: string; honorificSuffix?: string };
    nickname?: string;
    phoneNumbers?: { value: string; type: string }[];
    emails?: { value: string; type: string }[];
    urls?: { value: string; type: string }[];
    addresses?: { streetAddress: string; locality: string; region: string; postalCode: string; country: string; type: string }[];
    organizations?: { name: string; title: string }[];
    birthday?: string;
    note?: string;
}

export type WifiSecurity = "none" | "psk" | "wep";

export type Content =
    | { kind: "url"; url: string }
    | { kind: "wifi"; ssid: string; security: WifiSecurity; password: string; hidden: boolean }
    | { kind: "contact"; name: string; contact: PalmContact }
    | { kind: "otpauth"; uri: string; type: string; account: string; issuer: string }
    | { kind: "tel"; number: string }
    | { kind: "email"; to: string; subject: string; body: string }
    | { kind: "sms"; number: string; body: string }
    | { kind: "geo"; latitude: number; longitude: number }
    | { kind: "product"; code: string }
    | { kind: "text"; text: string };

// ---- Field splitting shared by WIFI:, MECARD: and MATMSG: -----------------------------

/** Split "K:v;K2:v2;;" into pairs, honouring backslash escapes (\; \: \, \\ \"). */
export function splitFields(body: string): [string, string][] {
    const out: [string, string][] = [];
    let key = "", val = "", inKey = true;
    const push = () => {
        if (key || val) out.push([key.trim().toUpperCase(), val]);
        key = ""; val = ""; inKey = true;
    };
    for (let i = 0; i < body.length; i++) {
        const ch = body[i];
        if (ch === "\\" && i + 1 < body.length) {
            const next = body[++i];
            if (inKey) key += next; else val += next;
        } else if (ch === ";") {
            push();
        } else if (ch === ":" && inKey) {
            inKey = false;
        } else if (inKey) {
            key += ch;
        } else {
            val += ch;
        }
    }
    push();
    return out;
}

function wifi(text: string): Content | null {
    const f = splitFields(text.slice(5));
    const get = (k: string) => f.find(([key]) => key === k)?.[1];
    const ssid = get("S");
    if (!ssid) return null;
    const t = (get("T") ?? "").toUpperCase();
    const password = get("P") ?? "";
    const security: WifiSecurity = t === "WEP" ? "wep" : t === "NOPASS" || (!t && !password) ? "none" : "psk";
    return { kind: "wifi", ssid, security, password: security === "none" ? "" : password, hidden: /^true$/i.test(get("H") ?? "") };
}

function mecard(text: string): Content | null {
    const f = splitFields(text.slice(7));
    const c: PalmContact = {};
    let display = "";
    for (const [k, v] of f) {
        const value = v.trim();
        if (!value) continue;
        switch (k) {
        case "N": {
            const [family, given] = value.split(",").map((s) => s.trim());
            c.name = given !== undefined ? { givenName: given, familyName: family } : splitName(family);
            display = given !== undefined ? `${given} ${family}`.trim() : family;
            break;
        }
        case "NICKNAME": c.nickname = value; break;
        case "TEL": (c.phoneNumbers ??= []).push({ value, type: "type_mobile" }); break;
        case "EMAIL": (c.emails ??= []).push({ value, type: "type_home" }); break;
        case "URL": (c.urls ??= []).push({ value, type: "type_home" }); break;
        case "ADR": (c.addresses ??= []).push(address(value.split(","), "type_home", true)); break;
        case "ORG": (c.organizations ??= []).push({ name: value, title: "" }); break;
        case "BDAY": c.birthday = isoDate(value); break;
        case "NOTE": c.note = value; break;
        }
    }
    if (!display && !c.phoneNumbers && !c.emails) return null;
    return { kind: "contact", name: display || c.phoneNumbers?.[0]?.value || c.emails?.[0]?.value || "Contact", contact: c };
}

function splitName(full: string): NonNullable<PalmContact["name"]> {
    const parts = full.trim().split(/\s+/);
    if (parts.length < 2) return { givenName: parts[0] ?? "", familyName: "" };
    return { givenName: parts.slice(0, -1).join(" "), familyName: parts[parts.length - 1] };
}

/** "19800131" or "1980-01-31" -> "1980-01-31"; anything else as it is. */
function isoDate(v: string): string {
    const m = /^(\d{4})-?(\d{2})-?(\d{2})/.exec(v);
    return m ? `${m[1]}-${m[2]}-${m[3]}` : v;
}

function address(parts: string[], type: string, mecardOrder = false) {
    // vCard ADR: PO box; extended; street; locality; region; postal code; country.
    // MeCard ADR is one line ("street, city, ..."): the whole of it is the street.
    const p = parts.map((s) => s.trim());
    if (mecardOrder) return { streetAddress: p.join(", "), locality: "", region: "", postalCode: "", country: "", type };
    return {
        streetAddress: [p[0], p[1], p[2]].filter(Boolean).join(", "),
        locality: p[3] ?? "", region: p[4] ?? "", postalCode: p[5] ?? "", country: p[6] ?? "", type,
    };
}

// ---- vCard ------------------------------------------------------------------------------

/** vCard escapes: \n \, \; \\. */
const unescapeVcard = (s: string) => s.replace(/\\([nN,;\\])/g, (_, c: string) => (c === "n" || c === "N" ? "\n" : c));

/** Split on unescaped separators. */
function splitUnescaped(s: string, sep: string): string[] {
    const out: string[] = [];
    let cur = "";
    for (let i = 0; i < s.length; i++) {
        if (s[i] === "\\" && i + 1 < s.length) { cur += s[i] + s[i + 1]; i++; }
        else if (s[i] === sep) { out.push(cur); cur = ""; }
        else cur += s[i];
    }
    out.push(cur);
    return out;
}

function vcardType(params: string, kind: "tel" | "email" | "url" | "adr"): string {
    const p = params.toUpperCase();
    if (kind === "tel") {
        if (/CELL|MOBILE/.test(p)) return "type_mobile";
        if (/FAX/.test(p)) return /HOME/.test(p) ? "type_personal_fax" : "type_work_fax";
        if (/PAGER/.test(p)) return "type_pager";
    }
    if (/WORK/.test(p)) return "type_work";
    if (/HOME/.test(p)) return "type_home";
    return kind === "tel" ? "type_mobile" : "type_other";
}

export function parseVcard(text: string): Content | null {
    // Unfold continuation lines (RFC 6350 3.2), then read "GROUP.NAME;PARAMS:VALUE".
    const lines = text.replace(/\r\n?/g, "\n").replace(/\n[ \t]/g, "").split("\n");
    const c: PalmContact = {};
    let fn = "";
    for (const line of lines) {
        const colon = line.indexOf(":");
        if (colon < 0) continue;
        const head = line.slice(0, colon);
        const value = line.slice(colon + 1).trim();
        const [nameWithGroup, ...paramList] = head.split(";");
        const name = nameWithGroup.replace(/^.*\./, "").toUpperCase();
        const params = paramList.join(";");
        if (!value) continue;
        switch (name) {
        case "FN": fn = unescapeVcard(value); break;
        case "N": {
            const [family = "", given = "", middle = "", prefix = "", suffix = ""] = splitUnescaped(value, ";").map(unescapeVcard);
            c.name = { givenName: given, familyName: family, middleName: middle, honorificPrefix: prefix, honorificSuffix: suffix };
            break;
        }
        case "NICKNAME": c.nickname = unescapeVcard(value); break;
        case "TEL": (c.phoneNumbers ??= []).push({ value: value.replace(/^tel:/i, ""), type: vcardType(params, "tel") }); break;
        case "EMAIL": (c.emails ??= []).push({ value: unescapeVcard(value), type: vcardType(params, "email") }); break;
        case "URL": (c.urls ??= []).push({ value: unescapeVcard(value), type: vcardType(params, "url") }); break;
        case "ADR": (c.addresses ??= []).push(address(splitUnescaped(value, ";").map(unescapeVcard), vcardType(params, "adr"))); break;
        case "ORG": {
            const org = splitUnescaped(value, ";").map(unescapeVcard).filter(Boolean).join(", ");
            if (c.organizations?.[0]) c.organizations[0].name = org; else c.organizations = [{ name: org, title: "" }];
            break;
        }
        case "TITLE": {
            const title = unescapeVcard(value);
            if (c.organizations?.[0]) c.organizations[0].title = title; else c.organizations = [{ name: "", title }];
            break;
        }
        case "BDAY": c.birthday = isoDate(value); break;
        case "NOTE": c.note = unescapeVcard(value); break;
        }
    }
    if (!c.name && fn) c.name = splitName(fn);
    const n = c.name;
    const display = fn || [n?.givenName, n?.familyName].filter(Boolean).join(" ") || c.organizations?.[0]?.name
        || c.phoneNumbers?.[0]?.value || c.emails?.[0]?.value || "";
    if (!display) return null;
    return { kind: "contact", name: display, contact: c };
}

// ---- otpauth ----------------------------------------------------------------------------

function otpauth(text: string): Content | null {
    let u: URL;
    try { u = new URL(text); } catch { return null; }
    const type = u.hostname.toLowerCase() || u.pathname.replace(/^\/\//, "").split("/")[0].toLowerCase();
    if (type !== "totp" && type !== "hotp") return null;
    if (!u.searchParams.get("secret")) return null;
    const label = decodeURIComponent(u.pathname.replace(/^\/+/, "").replace(/^(totp|hotp)\//i, ""));
    const [labelIssuer, account] = label.includes(":") ? [label.slice(0, label.indexOf(":")), label.slice(label.indexOf(":") + 1)] : ["", label];
    return { kind: "otpauth", uri: text, type, account: account.trim(), issuer: (u.searchParams.get("issuer") ?? labelIssuer).trim() };
}

// ---- Everything -------------------------------------------------------------------------

const PRODUCT_FORMATS = /^(EAN|UPC|ISBN)/i;

/** What the text of a code (and its barcode format, from zxing) means. */
export function parseContent(raw: string, format = "QRCode"): Content {
    const text = raw.replace(/^﻿/, "").trim();
    if (PRODUCT_FORMATS.test(format) && /^\d{6,14}$/.test(text)) return { kind: "product", code: text };
    const lower = text.toLowerCase();
    if (/^https?:\/\/[^\s]+$/i.test(text)) {
        try { return { kind: "url", url: new URL(text).href }; } catch { /* not a URL after all */ }
    }
    if (/^www\.[^\s]+\.[a-z]{2,}(\/\S*)?$/i.test(text)) return { kind: "url", url: `http://${text}` };
    if (lower.startsWith("wifi:")) return wifi(text) ?? { kind: "text", text };
    if (lower.startsWith("begin:vcard")) return parseVcard(text) ?? { kind: "text", text };
    if (lower.startsWith("mecard:")) return mecard(text) ?? { kind: "text", text };
    if (lower.startsWith("otpauth://")) return otpauth(text) ?? { kind: "text", text };
    if (lower.startsWith("tel:")) {
        const number = text.slice(4).trim();
        if (/^[+\d][\d\s().\-*#,;pw]*$/i.test(number)) return { kind: "tel", number };
    }
    if (lower.startsWith("mailto:")) {
        const [addr, query = ""] = text.slice(7).split("?");
        const q = new URLSearchParams(query);
        return { kind: "email", to: decodeURIComponent(addr), subject: q.get("subject") ?? "", body: q.get("body") ?? "" };
    }
    if (lower.startsWith("matmsg:")) {
        const f = splitFields(text.slice(7));
        const get = (k: string) => f.find(([key]) => key === k)?.[1] ?? "";
        if (get("TO")) return { kind: "email", to: get("TO"), subject: get("SUB"), body: get("BODY") };
    }
    if (lower.startsWith("smsto:") || lower.startsWith("sms:")) {
        const rest = text.slice(text.indexOf(":") + 1);
        // smsto:NUMBER:BODY (ZXing) or sms:NUMBER?body=BODY (RFC 5724).
        const [numPart, query = ""] = rest.split("?");
        const colon = numPart.indexOf(":");
        const number = (colon >= 0 ? numPart.slice(0, colon) : numPart).trim();
        const body = colon >= 0 ? numPart.slice(colon + 1) : new URLSearchParams(query).get("body") ?? "";
        if (/^[+\d][\d\s().-]*$/.test(number)) return { kind: "sms", number, body };
    }
    if (lower.startsWith("geo:")) {
        const m = /^geo:(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/i.exec(text);
        if (m && Math.abs(+m[1]) <= 90 && Math.abs(+m[2]) <= 180) return { kind: "geo", latitude: +m[1], longitude: +m[2] };
    }
    return { kind: "text", text };
}

/** The heading of a result. */
export function kindTitle(c: Content): string {
    switch (c.kind) {
    case "url": return "Web Address";
    case "wifi": return "Wi-Fi Network";
    case "contact": return "Contact";
    case "otpauth": return "Authenticator Key";
    case "tel": return "Phone Number";
    case "email": return "Email";
    case "sms": return "Text Message";
    case "geo": return "Location";
    case "product": return "Product Code";
    case "text": return "Text";
    }
}

/** One line for the result and the history. Never shows a password or an authenticator secret. */
export function summary(c: Content): string {
    switch (c.kind) {
    case "url": return c.url;
    case "wifi": return c.ssid;
    case "contact": return c.name;
    case "otpauth": return [c.issuer, c.account].filter(Boolean).join(": ") || "Account";
    case "tel": return c.number;
    case "email": return c.to;
    case "sms": return c.number;
    case "geo": return `${c.latitude}, ${c.longitude}`;
    case "product": return c.code;
    case "text": return c.text;
    }
}

/**
 * What may be kept in the history: everything but authenticator secrets
 * (an otpauth URI is the key itself; the history keeps only its label).
 */
export function historyText(raw: string, c: Content): string {
    return c.kind === "otpauth" ? `otpauth://${c.type}/${encodeURIComponent(summary(c))}` : raw;
}

/** The URL the browser opens: only http(s), so a code cannot run javascript: or open file: URLs. */
export function safeUrl(url: string): string | null {
    try {
        const u = new URL(url);
        return u.protocol === "http:" || u.protocol === "https:" ? u.href : null;
    } catch {
        return null;
    }
}
