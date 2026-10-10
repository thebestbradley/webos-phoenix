// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The Marketplace's service, org.webosphoenix.service.packages
// (apps/marketplace/service/packagesservice.js documents the methods):
// signed Phoenix catalogs (web apps and .ipk web apps), and the App Museum
// II and Preware feeds as add-on catalogs of Classics.

import { call, subscribe, LunaError, type Subscription } from "./bridge";

const SERVICE = "luna://org.webosphoenix.service.packages/";

export type CatalogKind = "phoenix" | "appmuseum" | "preware";
export type AppKind = "pwa" | "ipk" | "connector" | "classic" | "preware";

export interface CatalogSource {
    id: string;
    name: string;
    kind: CatalogKind;
    url: string;
    enabled: boolean;
    builtin: boolean;
    /** A Phoenix catalog's key was checked and pinned. */
    trusted: boolean;
    fingerprint: string | null;
    refreshed: string | null;
    error: { errorCode: string; errorText: string } | null;
    count: number;
}

/** A catalog's key, for the user to check before trusting it. */
export interface PendingKey {
    url: string;
    name: string;
    key: string;
    fingerprint: string;
}

export interface MarketApp {
    id: string;
    sourceId: string;
    kind: AppKind;
    title: string;
    developer: { name: string; url: string };
    summary: string;
    description: string;
    categories: string[];
    icon: string;
    screenshots: string[];
    license: string;
    homepage: string;
    donation: string;
    featured: boolean;
    rating: { stars: number; count: number } | null;
    version: string;
    adult?: boolean;
    devices?: string[];
    pwa?: { manifest: string; origin: string };
    installed: { version: string; sourceId: string } | null;
    /** The newer version there is, if installed. */
    update: string | null;
    /** Why it cannot be installed here, if known before downloading. */
    verdict?: { ok: boolean; text: string };
    museumId?: string;
    appId?: string;
    /** Installed: the app's own icon on the device, as the launcher shows it. */
    ownIcon?: string;
}

export interface InstalledApp {
    id: string;
    catalogId: string;
    title: string;
    /** The app's own icon on the device (as the launcher shows it), else the catalog's. */
    icon: string;
    /** The catalog's icon for it, when it was installed. */
    catalogIcon: string;
    version: string;
    sourceId: string;
    kind: AppKind;
    installedAt: string;
    update: string | null;
}

export interface InstallProgress {
    id: string;
    state: "queued" | "downloading" | "checking" | "installing" | "installed" | "failed";
    progress?: number;
    appId?: string;
    errorCode?: string;
    errorText?: string;
    /** Installed, but parts of the package were not (the simulator: install scripts, services). */
    skipped?: string[];
}

export type Section = "featured" | "web" | "apps" | "classics";

/**
 * An account type Phoenix can connect to (Synergy; docs/SYNERGY-CONNECTORS.md
 * 2.1): one account template, from a catalog index's "accounts".
 */
export interface AccountType {
    templateId: string;
    sourceId: string;
    title: string;
    provider: string;
    /** Resolved against the index's address; "" when there is none. */
    icon: string;
    summary: string;
    /** The template's capability names (CONTACTS, CALENDAR, MAIL, ...). */
    capabilities: { capability: string; direction?: string }[];
    protocols: string[];
    /** type "" when the catalog names one this device does not know. */
    auth: { type: "password" | "app-password" | "oauth" | "api-key" | "none" | ""; registration: "none" | "required" };
    server: "user" | "fixed" | "discovered" | "";
    privacy: { dataGoesTo: string; e2ee: boolean; phoenixServers: "none" | "push-relay" | "token-relay" | "" } | null;
    push: "poll" | "unifiedpush" | "relay";
    status: "stable" | "beta" | "experimental";
    /**
     * builtin: part of the system (the generic logins), never removed; else a
     * connector package (kind "connector") Connections installs and removes;
     * preinstalled: one Phoenix comes with (removable, installed again
     * without Developer Mode).
     */
    package: { id: string; builtin: boolean; preinstalled?: boolean };
    help: string;
    featured: boolean;
}

export const marketplace = {
    async sources(): Promise<CatalogSource[]> {
        return ((await call(SERVICE + "getSources", {})) as unknown as { sources: CatalogSource[] }).sources;
    },
    /** Reads the catalogs; a Phoenix catalog not trusted yet answers UNTRUSTED with its key. */
    async refresh(id?: string): Promise<{ id: string; ok: boolean; errorCode?: string; errorText?: string; pending?: PendingKey }[]> {
        return ((await call(SERVICE + "refresh", id ? { id } : {})) as unknown as { results: [] }).results;
    },
    async addSource(url: string): Promise<PendingKey> {
        return ((await call(SERVICE + "addSource", { url })) as unknown as { pending: PendingKey }).pending;
    },
    trustSource(pending: PendingKey): Promise<unknown> {
        return call(SERVICE + "trustSource", { url: pending.url, key: pending.key, name: pending.name });
    },
    setSource(id: string, enabled: boolean): Promise<unknown> {
        return call(SERVICE + "setSource", { id, enabled });
    },
    removeSource(id: string): Promise<unknown> {
        return call(SERVICE + "removeSource", { id });
    },
    async browse(section: Section, category?: string, page = 0): Promise<{ apps: MarketApp[]; categories: string[]; more: boolean }> {
        return (await call(SERVICE + "browse", { section, page, ...(category ? { category } : {}) })) as unknown as
            { apps: MarketApp[]; categories: string[]; more: boolean };
    },
    async search(query: string): Promise<MarketApp[]> {
        return ((await call(SERVICE + "search", { query })) as unknown as { apps: MarketApp[] }).apps;
    },
    /** Search with the account types that match (title, provider, capability, protocol). */
    async searchAll(query: string): Promise<{ apps: MarketApp[]; accountTypes: AccountType[] }> {
        const r = (await call(SERVICE + "search", { query })) as unknown as { apps: MarketApp[]; accountTypes?: AccountType[] };
        return { apps: r.apps, accountTypes: r.accountTypes ?? [] };
    },
    /** The account types of the catalogs; with capabilities, those having any of them. */
    async accountTypes(capabilities?: string[]): Promise<AccountType[]> {
        const r = await call(SERVICE + "listAccountTypes", capabilities ? { capability: capabilities } : {});
        return (r as unknown as { accountTypes?: AccountType[] }).accountTypes ?? [];
    },
    async app(sourceId: string, id: string): Promise<MarketApp> {
        return ((await call(SERVICE + "getApp", { sourceId, id })) as unknown as { app: MarketApp }).app;
    },
    /** Installs (or updates); onProgress hears each step, the last one installed or failed. */
    install(sourceId: string, id: string, onProgress: (p: InstallProgress) => void): Subscription {
        return subscribe(SERVICE + "install", { sourceId, id, subscribe: true },
                         (r) => onProgress(r as unknown as InstallProgress),
                         (e: LunaError) => onProgress({ id, state: "failed", errorCode: String(e.reply.errorCode), errorText: e.errorText }));
    },
    remove(id: string): Promise<unknown> {
        return call(SERVICE + "remove", { id });
    },
    async installed(): Promise<InstalledApp[]> {
        return ((await call(SERVICE + "listInstalled", {})) as unknown as { apps: InstalledApp[] }).apps;
    },
    updateAll(): Promise<{ updated: string[]; failed: { id: string; errorText: string }[] }> {
        return call(SERVICE + "updateAll", {}) as unknown as Promise<{ updated: string[]; failed: { id: string; errorText: string }[] }>;
    },
};

/**
 * The catalog service on this computer, in the simulator only
 * (org.webosphoenix.simulator, phoenix-sim's Services > Marketplace
 * Catalog): the Marketplace offers to start it when it cannot reach it.
 * On a device the methods fail (NOT_AVAILABLE), and nothing is offered.
 */
export interface LocalCatalogStatus {
    state: "stopped" | "starting" | "running" | "failed";
    url: string;
    error: string;
    /** Starting for the first time: it sets itself up first. */
    settingUp: boolean;
}

const SIMULATOR = "luna://org.webosphoenix.simulator/";

export const localCatalog = {
    /** Its state now and as it changes; onError when there is none to start (not the simulator). */
    watch(cb: (s: LocalCatalogStatus) => void, onError?: (e: LunaError) => void): Subscription {
        return subscribe(SIMULATOR + "marketplaceCatalog", {}, (r) => cb(r as unknown as LocalCatalogStatus), onError);
    },
    /** Starts it; resolves once it runs, rejects with the reason when it does not start. */
    async start(): Promise<LocalCatalogStatus> {
        return (await call(SIMULATOR + "startMarketplaceCatalog", {})) as unknown as LocalCatalogStatus;
    },
};
