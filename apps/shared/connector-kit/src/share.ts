// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Sharing to a connector's service (docs/SYNERGY-SDK.md, "Sharing to your
// service"). A connector says what it can post in its definition's `share`
// (ShareDefinition: the types it takes, their limits, who may see a post)
// and how to post it (`send`). From that:
//
//   shareTarget(definition, title)   the appinfo.json "phoenix".shareTargets
//                                    entry that puts the connector in the
//                                    system's share sheet (docs/SHARE-AND-FILES.md
//                                    SF4), one entry per signed-in account;
//                                    phoenix-connector new and pack write it
//   shareTypes(accepts)              the MIME types the sheet matches
//   checkShare(declaration, request) what the kit's `share` method checks
//                                    before the connector's send sees anything
//
// The same rules are in tools/checks.ts (C14, C15) and in the Marketplace's
// server/marketplace/src/Connector.php, on the shared cases of
// server/marketplace/tests/connector-cases.json.

import type { Json, ShareAccepts, ShareDefinition, ShareKind, MediaLimits } from "./types";

/** What a connector may say it takes: text, a link, pictures, videos, any file. */
export const SHARE_KINDS: ShareKind[] = ["text", "link", "image", "video", "file"];
const MEDIA_KINDS: ShareKind[] = ["image", "video", "file"];
const DEFAULT_TYPES: Record<ShareKind, string[]> = {
    text: ["text/plain"], link: ["text/uri-list"], image: ["image/*"], video: ["video/*"], file: ["*/*"]
};
const MIME = /^[a-z0-9][a-z0-9.+-]*\/(\*|[a-z0-9][a-z0-9.+-]*)$/i;

function limitsOf(accepts: ShareAccepts, kind: ShareKind): MediaLimits | null {
    const v = (accepts as Record<string, Json>)[kind];
    if (!v) return null;
    return v === true ? {} : v;
}

/** The MIME types a declaration takes, in the sheet's terms (text/plain, text/uri-list, image/*, ...). */
export function shareTypes(accepts: ShareAccepts): string[] {
    const out: string[] = [];
    SHARE_KINDS.forEach((k) => {
        const l = limitsOf(accepts, k);
        if (!l) return;
        const types = MEDIA_KINDS.indexOf(k) >= 0 && Array.isArray(l.mimeTypes) && l.mimeTypes.length ? l.mimeTypes : DEFAULT_TYPES[k];
        types.forEach((t) => { if (out.indexOf(t) < 0) out.push(t); });
    });
    return out;
}

/** The declaration as data (no send): what appinfo.json carries and the compose page reads. */
export function shareDeclaration(def: { service: string; templateIds: string[]; share?: ShareDefinition }): Json {
    const s = def.share as ShareDefinition;
    const out: Json = { templateId: s.templateId || def.templateIds[0], service: def.service, accepts: {} };
    SHARE_KINDS.forEach((k) => {
        const v = (s.accepts as Record<string, Json>)[k];
        if (v) out.accepts[k] = v === true ? true : JSON.parse(JSON.stringify(v));
    });
    if (s.audience) out.audience = JSON.parse(JSON.stringify(s.audience));
    if (s.accountLabel) out.accountLabel = s.accountLabel;
    return out;
}

/**
 * The appinfo.json "phoenix".shareTargets entry of a connector: the sheet
 * lists it once per signed-in account of `connector.templateId`, and none
 * when no account is signed in.
 */
export function shareTarget(def: { service: string; templateIds: string[]; share?: ShareDefinition }, title: string): Json {
    if (!def.share) return null;
    return { types: shareTypes(def.share.accepts), label: def.share.label || title, connector: shareDeclaration(def) };
}

/** Problems with a definition's share, for defineConnector. */
export function shareProblems(def: { templateIds: string[]; methods?: Record<string, unknown>; share?: ShareDefinition }): string[] {
    const s = def.share;
    if (s === undefined) return [];
    const problems: string[] = [];
    if (!s || typeof s !== "object") return ["share: an object ({accepts, send})"];
    if (typeof s.send !== "function") problems.push("share.send: a function (ctx, content) -> {url?, id?}");
    if (s.templateId !== undefined && def.templateIds.indexOf(s.templateId) < 0) problems.push("share.templateId: one of templateIds");
    problems.push(...acceptsProblems(s.accepts).map((p) => "share." + p));
    problems.push(...audienceProblems(s.audience).map((p) => "share." + p));
    if (s.accountLabel !== undefined && typeof s.accountLabel !== "string") problems.push("share.accountLabel: a string such as \"@{username}\"");
    if (def.methods && def.methods.share) problems.push("methods.share: the kit makes this one from share");
    return problems;
}

function positiveInt(v: unknown): boolean { return typeof v === "number" && v > 0 && Math.floor(v) === v; }

/** The form of accepts (also C14 of the package checks). */
export function acceptsProblems(accepts: unknown): string[] {
    const out: string[] = [];
    if (!accepts || typeof accepts !== "object" || Array.isArray(accepts) || !Object.keys(accepts).length)
        return ["accepts: what it takes, one or more of " + SHARE_KINDS.join(", ")];
    Object.keys(accepts as object).forEach((k) => {
        const v = (accepts as Record<string, Json>)[k];
        if (SHARE_KINDS.indexOf(k as ShareKind) < 0) { out.push("accepts." + k + ": not one of " + SHARE_KINDS.join(", ")); return; }
        if (v === true) return;
        if (!v || typeof v !== "object" || Array.isArray(v)) { out.push("accepts." + k + ": true or an object of limits"); return; }
        ["max", "maxBytes", "maxLength"].forEach((n) => {
            if (v[n] !== undefined && !positiveInt(v[n])) out.push("accepts." + k + "." + n + ": a whole number above 0");
        });
        if (v.mimeTypes !== undefined) {
            if (MEDIA_KINDS.indexOf(k as ShareKind) < 0) out.push("accepts." + k + ".mimeTypes: only for image, video and file");
            else if (!Array.isArray(v.mimeTypes) || !v.mimeTypes.length || v.mimeTypes.some((t: unknown) => typeof t !== "string" || !MIME.test(t)))
                out.push("accepts." + k + ".mimeTypes: MIME types (image/png, image/*)");
        }
        if (v.altText !== undefined && typeof v.altText !== "boolean") {
            if (!v.altText || typeof v.altText !== "object" || (v.altText.maxLength !== undefined && !positiveInt(v.altText.maxLength)))
                out.push("accepts." + k + ".altText: true, or {maxLength}");
        }
    });
    return out;
}

/** The form of audience (also C14). */
export function audienceProblems(audience: unknown): string[] {
    if (audience === undefined) return [];
    const a = audience as Json;
    if (!a || typeof a !== "object" || !Array.isArray(a.options) || !a.options.length)
        return ["audience: {options: [{value, label, hint?}], default?}"];
    const out: string[] = [];
    const values = a.options.map((o: Json) => o && o.value);
    a.options.forEach((o: Json, i: number) => {
        if (!o || typeof o.value !== "string" || !o.value || typeof o.label !== "string" || !o.label)
            out.push("audience.options[" + i + "]: {value, label} strings");
    });
    if (a.default !== undefined && values.indexOf(a.default) < 0) out.push("audience.default: one of the options' values");
    if (a.label !== undefined && typeof a.label !== "string") out.push("audience.label: a string");
    return out;
}

function mimeMatches(pattern: string, type: string): boolean {
    if (pattern === "*/*" || pattern === type) return true;
    return /\/\*$/.test(pattern) && type.indexOf(pattern.slice(0, -1)) === 0;
}

/** Which kind a shared file is, for a declaration: an image, a video or a file; null when it takes none. */
export function kindOfFile(accepts: ShareAccepts, mimeType: string): ShareKind | null {
    const order: ShareKind[] = /^image\//.test(mimeType) ? ["image", "file"] : /^video\//.test(mimeType) ? ["video", "file"] : ["file"];
    for (const k of order) {
        const l = limitsOf(accepts, k);
        if (!l) continue;
        const types = Array.isArray(l.mimeTypes) && l.mimeTypes.length ? l.mimeTypes : DEFAULT_TYPES[k];
        if (types.some((p) => mimeMatches(p, mimeType))) return k;
    }
    return null;
}

const EXT_TYPES: Record<string, string> = {
    jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp", heic: "image/heic",
    mp4: "video/mp4", m4v: "video/mp4", mov: "video/quicktime", webm: "video/webm", pdf: "application/pdf"
};
export function mimeTypeOf(path: string, given?: string): string {
    if (given) return given;
    const m = /\.([A-Za-z0-9]+)$/.exec(path || "");
    return (m && EXT_TYPES[m[1].toLowerCase()]) || "application/octet-stream";
}

export interface ShareCheckError extends Error { errorCode: string }
function refuse(message: string, code: string): ShareCheckError {
    return Object.assign(new Error(message), { errorCode: code });
}

export interface CheckedShare {
    title: string;
    text: string;
    url: string;
    files: { path: string; mimeType: string; kind: ShareKind; description: string }[];
    audience?: string;
    idempotencyKey: string;
}

/**
 * What the kit checks before send: something to post, of kinds the
 * declaration takes, within its limits; the audience one of its options
 * (or its default). Throws an error with errorCode SHARE_NOTHING,
 * SHARE_NOT_ACCEPTED, SHARE_TOO_LONG, SHARE_TOO_MANY or SHARE_BAD_AUDIENCE.
 */
export function checkShare(s: ShareDefinition, p: Json): CheckedShare {
    const content = (p && p.content) || {};
    const accepts = s.accepts;
    let text = String(content.text || "");
    const url = String(content.url || "");
    const files = (Array.isArray(content.files) ? content.files : []).filter((f: Json) => f && f.path).map((f: Json) => {
        const mimeType = mimeTypeOf(String(f.path), f.mimeType ? String(f.mimeType) : "");
        const kind = kindOfFile(accepts, mimeType);
        if (!kind) throw refuse("This account does not take " + mimeType + " files", "SHARE_NOT_ACCEPTED");
        const l = limitsOf(accepts, kind) as MediaLimits;
        let description = String(f.description || "").trim();
        // Descriptions go only to a service that takes them.
        if (!l.altText) description = "";
        const maxAlt = l.altText && typeof l.altText === "object" ? l.altText.maxLength : undefined;
        if (maxAlt && description.length > maxAlt) throw refuse("A description is longer than " + maxAlt + " characters", "SHARE_TOO_LONG");
        return { path: String(f.path), mimeType, kind, description };
    });
    if (url && !limitsOf(accepts, "link")) {
        // A link goes in the text when the service takes text but no links of their own.
        if (!limitsOf(accepts, "text")) throw refuse("This account does not take links", "SHARE_NOT_ACCEPTED");
        if (text.indexOf(url) < 0) text = text ? text + "\n\n" + url : url;
    }
    if (text.trim() && !limitsOf(accepts, "text")) throw refuse("This account does not take text", "SHARE_NOT_ACCEPTED");
    if (!text.trim() && !url && !files.length) throw refuse("Nothing to post", "SHARE_NOTHING");
    const textLimits = limitsOf(accepts, "text");
    if (textLimits && textLimits.maxLength && text.length > textLimits.maxLength)
        throw refuse("The text is longer than " + textLimits.maxLength + " characters", "SHARE_TOO_LONG");
    MEDIA_KINDS.forEach((k) => {
        const l = limitsOf(accepts, k);
        const n = files.filter((f: Json) => f.kind === k).length;
        if (l && l.max && n > l.max) throw refuse("At most " + l.max + " " + (k === "image" ? "pictures" : k === "video" ? "videos" : "files"), "SHARE_TOO_MANY");
    });
    let audience: string | undefined;
    if (s.audience) {
        audience = p.audience === undefined || p.audience === null || p.audience === "" ? (s.audience.default || s.audience.options[0].value) : String(p.audience);
        if (!s.audience.options.some((o) => o.value === audience)) throw refuse("Not one of the audiences: " + audience, "SHARE_BAD_AUDIENCE");
    }
    return {
        title: String(content.title || ""), text, url: limitsOf(accepts, "link") ? url : "", files, audience,
        idempotencyKey: String(p.idempotencyKey || "")
    };
}

/** The limit a file's size must keep (maxBytes of its kind), or 0. */
export function maxBytesOf(accepts: ShareAccepts, kind: ShareKind): number {
    const l = limitsOf(accepts, kind);
    return (l && l.maxBytes) || 0;
}

/** The account's label in the sheet: accountLabel ("@{username}") filled in. */
export function accountLabel(pattern: string | undefined, account: Json): string {
    return String(pattern || "{username}").replace(/\{(\w+)\}/g, (_m, k) => String((account && account[k]) || ""));
}
