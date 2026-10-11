// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Connections: the account types Phoenix can connect to (Synergy), from the
// catalog index's "accounts" (docs/SYNERGY-CONNECTORS.md, 2.3). What the
// view shows, in words, kept apart from the view so it can be tested.

import type { AccountType } from "@phoenix/luna";

/** The home's groups, by the templates' capability names. */
export const GROUPS: { id: string; label: string; caps: string[] }[] = [
    { id: "contacts", label: "Contacts & Calendars", caps: ["CONTACTS", "REMOTECONTACTS", "CALENDAR"] },
    { id: "mail", label: "Mail", caps: ["MAIL"] },
    { id: "messaging", label: "Messaging", caps: ["MESSAGING", "IM", "PHONE", "VOICE"] },
    { id: "social", label: "Social & Feeds", caps: ["SOCIAL", "FEEDS"] },
    { id: "photos", label: "Photos & Media", caps: ["PHOTO", "VIDEO", "MEDIA", "MUSIC", "PODCASTS"] },
    { id: "files", label: "Files", caps: ["DOCUMENTS", "FILES", "LOCAL.FILESTORAGE"] },
    { id: "tasks", label: "Tasks & Notes", caps: ["TASKS", "MEMOS", "NOTES", "BOOKMARKS"] },
];

// PHOTO.UPLOAD is a PHOTO capability, VIDEO.UPLOAD a VIDEO one.
const inGroup = (cap: string, caps: string[]) => caps.includes(cap) || caps.includes(cap.split(".")[0]);

export interface TypeGroup { id: string; label: string; types: AccountType[] }

/**
 * The home: "Featured" when any is, then a group per capability with the
 * types that have it (a type with several is in each of them), and only
 * groups that have any; types in none of them last, under "More".
 */
export function groupAccountTypes(types: AccountType[]): TypeGroup[] {
    const byTitle = [...types].sort((a, b) => a.title.localeCompare(b.title));
    const out: TypeGroup[] = [];
    const featured = byTitle.filter((t) => t.featured);
    if (featured.length) out.push({ id: "featured", label: "Featured", types: featured });
    for (const g of GROUPS) {
        const list = byTitle.filter((t) => t.capabilities.some((c) => inGroup(c.capability, g.caps)));
        if (list.length) out.push({ id: g.id, label: g.label, types: list });
    }
    const rest = byTitle.filter((t) => !t.capabilities.some((c) => GROUPS.some((g) => inGroup(c.capability, g.caps))));
    if (rest.length) out.push({ id: "more", label: "More", types: rest });
    return out;
}

const CAPABILITY_WORDS: Record<string, string> = {
    CONTACTS: "Contacts", REMOTECONTACTS: "Directory", CALENDAR: "Calendar", MAIL: "Mail", MESSAGING: "Messaging",
    IM: "Chat", PHONE: "Phone", VOICE: "Calls", SOCIAL: "Social", FEEDS: "Feeds", PHOTO: "Photos", "PHOTO.UPLOAD": "Photo upload",
    VIDEO: "Videos", "VIDEO.UPLOAD": "Video upload", MEDIA: "Media", MUSIC: "Music", PODCASTS: "Podcasts", DOCUMENTS: "Documents",
    FILES: "Files", "LOCAL.FILESTORAGE": "Files", TASKS: "Tasks", MEMOS: "Memos", NOTES: "Notes", BOOKMARKS: "Bookmarks",
};

/** A capability in words: CONTACTS -> "Contacts". */
export function capabilityWord(cap: string): string {
    if (CAPABILITY_WORDS[cap]) return CAPABILITY_WORDS[cap];
    const t = cap.toLowerCase().replace(/[._]/g, " ");
    return t.charAt(0).toUpperCase() + t.slice(1);
}

/**
 * The capability chips: "Contacts", "Calendar", then "two-way" once when
 * every one says so; each its own direction when they differ.
 */
export function capabilityChips(t: AccountType): string[] {
    const caps = t.capabilities;
    const seen = new Set<string>();
    const dirs = new Set(caps.map((c) => c.direction ?? ""));
    const same = dirs.size === 1 ? [...dirs][0] : null;
    const chips: string[] = [];
    for (const c of caps) {
        const word = capabilityWord(c.capability) + (same === null && c.direction ? ` (${c.direction})` : "");
        if (!seen.has(word)) { seen.add(word); chips.push(word); }
    }
    if (same) chips.push(same);
    return chips;
}

/** Where your data goes, in plain words, from the entry's privacy notes. */
export function privacyLines(t: AccountType): string[] {
    const p = t.privacy;
    if (!p) return ["The catalog does not say where your data goes."];
    const lines: string[] = [];
    const to = p.dataGoesTo.replace(/\.$/, "");
    // "nowhere: ..." reads as it is.
    lines.push(!to ? "The catalog does not say where your data goes." : /^nowhere\b/i.test(to) ? `Your data goes ${to}.` : `Your data goes to ${to}.`);
    lines.push(p.e2ee ? "End-to-end encrypted" : "Not end-to-end encrypted");
    const phoenix = {
        none: "Phoenix's servers: none",
        "push-relay": "Phoenix's servers: a push relay, which only tells this device there is something new",
        "token-relay": "Phoenix's servers: the sign-in passes through them; your data does not",
        "": "",
    }[p.phoenixServers];
    if (phoenix) lines.push(phoenix);
    return lines;
}

/** The sign-in, in words. */
export function signInText(t: AccountType): string {
    switch (t.auth.type) {
        case "password": return "Password";
        case "app-password": return "App password";
        case "oauth": return `Sign in with ${t.provider || t.title}`;
        case "api-key": return "API key";
        case "none": return "No sign-in";
        default: return "";
    }
}

/** How new data arrives. */
export function pushText(t: AccountType): string {
    // A drive (DOCUMENTS only) syncs nothing: its files are read when they are opened.
    if (t.capabilities.length && t.capabilities.every((c) => c.capability === "DOCUMENTS")) return "Nothing is copied ahead: files are fetched when you open them";
    if (t.push === "unifiedpush") return "New data arrives as it happens (UnifiedPush)";
    if (t.push === "relay") return "New data arrives as it happens, through Phoenix's push relay";
    if (t.push === "connection") return "Stays connected while it is on: new messages arrive as they happen";
    return "Checks for new data every few minutes";
}

/** Which server it talks to. */
export function serverText(t: AccountType): string {
    if (t.server === "user") return "The one you enter";
    if (t.server === "fixed") return t.provider || t.title;
    if (t.server === "discovered") return "Found from your address";
    return "";
}

/** The status badge: none for a stable one. */
export function statusBadge(t: AccountType): string {
    return t.status === "beta" ? "Beta" : t.status === "experimental" ? "Experimental" : "";
}

/**
 * The original Accounts app's "Find More..." (enyo-1.0 accounts library,
 * add-account.js:85-92): it launched the App Catalog with
 * {common: {sceneType: "search", params: {type: "connector", connectorInfo:
 * {searchBarTitle, searchBarIcon, types: [capability, ...]}}}}. Here it
 * opens Connections with those capabilities; null for any other launch.
 */
export interface ConnectorFilter { title: string; types: string[] }

export function findMoreFilter(params: unknown): ConnectorFilter | null {
    const common = (params as { common?: { sceneType?: unknown; params?: { type?: unknown; connectorInfo?: unknown } } } | null)?.common;
    if (!common || common.sceneType !== "search" || !common.params || common.params.type !== "connector") return null;
    const info = (common.params.connectorInfo ?? {}) as { searchBarTitle?: unknown; types?: unknown };
    const types = (Array.isArray(info.types) ? info.types : [info.types]).filter((c): c is string => typeof c === "string" && c !== "");
    // The original Accounts names it "HP Synergy Services" (accounts util.js:297,
    // not debranded there): Palm's and HP's names are not shown.
    const asked = typeof info.searchBarTitle === "string" ? info.searchBarTitle.trim() : "";
    const title = asked && !/\b(?:HP|Palm|Synergy)\b/i.test(asked) ? asked : "Connections";
    return { title, types };
}

/** The types the filter keeps: any of its capabilities (all of them without any). */
export function applyFilter(types: AccountType[], filter: ConnectorFilter): AccountType[] {
    if (!filter.types.length) return types;
    return types.filter((t) => t.capabilities.some((c) => filter.types.includes(c.capability)));
}

/** The templates already added as accounts (com.palm.service.accounts listAccounts). */
export function addedTemplates(accounts: { templateId?: unknown }[]): Set<string> {
    return new Set(accounts.map((a) => a.templateId).filter((id): id is string => typeof id === "string"));
}

// ---- Accounts (com.palm.app.accounts) -----------------------------------------------------

export const ACCOUNTS_APP = "com.palm.app.accounts";

/**
 * Set up: the Accounts app's add flow at this template. Params as
 * com.palm.app.accounts takes them.
 */
export function setUpLaunch(t: AccountType): { id: string; params: { templateId: string } } {
    return { id: ACCOUNTS_APP, params: { templateId: t.templateId } };
}

/** Open in Accounts: the Accounts app, at its list. */
export function openAccountsLaunch(): { id: string; params: Record<string, never> } {
    return { id: ACCOUNTS_APP, params: {} };
}
