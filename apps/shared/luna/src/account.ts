// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The Phoenix Account and the platform's servers:
// org.webosphoenix.service.account (services/account/accountservice.js,
// which documents the methods; docs/PLATFORM-CLIENT.md). For Settings >
// Phoenix Account, First Use and Settings > Developer Mode > Platform
// Servers. Everything is "notSetUp" until servers.json names an account
// server.

import { call, subscribe, LunaError, type Subscription } from "./bridge";

const SERVICE = "luna://org.webosphoenix.service.account/";

export interface AccountProfile {
    id: string;
    name: string;
    email: string;
    emailVerified: boolean;
    avatar: string | null;
    locale: string;
    plan: "free" | "cloud" | string;
    deleting: string | null;
}

export interface AccountEntitlements {
    plan: string;
    features: {
        backup?: { quotaBytes: number; usedBytes: number };
        pushRelay?: { channels: number };
        assistant?: { monthlyTokens: number; usedTokens: number };
        messaging?: boolean;
        fediverse?: boolean;
    };
    validUntil: string | null;
    graceDays: number;
    verified: boolean;
    /** Still valid (validUntil plus the grace days). */
    current: boolean;
    offline?: boolean;
}

export interface AccountStatus {
    state: "notSetUp" | "signedOut" | "signingIn" | "signedIn";
    /** "Phoenix Account" (OPEN-QUESTIONS Q40: one string to change). */
    accountName: string;
    issuer: string | null;
    account: AccountProfile | null;
    device: { id: string } | null;
    signIn: { method: "code" | "browser"; userCode: string | null; verificationUri: string | null;
              verificationUriComplete: string | null; expiresAt: string | null } | null;
    entitlements: AccountEntitlements | null;
    services: { backup: boolean; push: boolean; assistant: boolean } | null;
    error: { errorCode: string; errorText: string } | null;
}

/** servers.json, resolved (null: not set up). */
export interface PlatformServers {
    name: string;
    overridden: boolean;
    feeds: string | null;
    api: string | null;
    catalog: { url: string; key: string | null; root: string | null } | null;
    updates: { url: string; channel: string; channels: string[]; key: string | null; root: string | null } | null;
    revocations: { url: string } | null;
    drivers: { url: string; key: string | null; reportUrl: string | null } | null;
    account: { issuer: string; clientId: string; scope: string; key: string | null } | null;
    push: { server: string | null; channels: string } | null;
    assistant: { url: string } | null;
    connectivity: { probe: string } | null;
    backup: { credentials: string; summary: string } | null;
}

export function accountErrorCode(e: unknown): string | null {
    return e instanceof LunaError && typeof e.reply.errorCode === "string" ? e.reply.errorCode : null;
}

const status = (r: unknown) => r as AccountStatus;

export const phoenixAccount = {
    watchStatus(cb: (s: AccountStatus) => void, onError?: (e: LunaError) => void): Subscription {
        return subscribe(SERVICE + "getStatus", { subscribe: true }, (r) => cb(status(r)), onError);
    },
    status(): Promise<AccountStatus> {
        return call(SERVICE + "getStatus", {}).then(status);
    },
    /** Start signing in: "code" shows a code to approve on another device (RFC 8628). */
    signIn(method: "code" | "browser" = "code"): Promise<AccountStatus> {
        return call(SERVICE + "signIn", { method }).then(status);
    },
    cancelSignIn(): Promise<AccountStatus> {
        return call(SERVICE + "cancelSignIn", {}).then(status);
    },
    signOut(): Promise<AccountStatus> {
        return call(SERVICE + "signOut", {}).then(status);
    },
    refresh(): Promise<AccountStatus> {
        return call(SERVICE + "refresh", {}).then(status);
    },
    devices(): Promise<{ id: string; name: string; model: string; lastSeen: string; current: boolean }[]> {
        return call(SERVICE + "devices", {}).then((r) => (r as unknown as { items: [] }).items);
    },
    servers(): Promise<{ servers: PlatformServers; override: Record<string, unknown> | null; devMode: boolean }> {
        return call(SERVICE + "getServers", {}) as unknown as Promise<{ servers: PlatformServers; override: Record<string, unknown> | null; devMode: boolean }>;
    },
    /** Developer Mode only: point this device at other servers (null: the image's). */
    setServers(servers: Record<string, unknown> | null): Promise<{ servers: PlatformServers }> {
        return call(SERVICE + "setServers", { servers }) as unknown as Promise<{ servers: PlatformServers }>;
    },
    /** The account's cloud backups, every device's (First Use's restore). */
    backupSummary(): Promise<{ usedBytes: number; quotaBytes: number; devices: { deviceId: string; name: string; files: { name: string; size: number; modified: string }[] }[] }> {
        return call(SERVICE + "backupSummary", {}) as unknown as Promise<{ usedBytes: number; quotaBytes: number;
            devices: { deviceId: string; name: string; files: { name: string; size: number; modified: string }[] }[] }>;
    },
    /** Developer Mode only: a platform's own servers.json (<api>/v1/servers.json). */
    useServersAt(url: string): Promise<{ servers: PlatformServers }> {
        return call(SERVICE + "setServers", { url }) as unknown as Promise<{ servers: PlatformServers }>;
    },
};
