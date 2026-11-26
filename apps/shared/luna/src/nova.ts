// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Dev push: org.webosphoenix.nova, the device's novad (services/nova/
// novaservice.js documents the methods; docs/DEV-PUSH.md). Settings >
// Developer Mode uses it for Pushed Changes, Pair a Computer, Paired
// Computers and Trusted Developers. Every method but getStatus answers
// NEEDS_DEVMODE while Developer Mode is off.

import { call, subscribe, LunaError, type Subscription } from "./bridge";

const SERVICE = "luna://org.webosphoenix.nova/";

export type NovaErrorCode =
    | "NEEDS_DEVMODE" | "UNTRUSTED" | "TOO_BIG" | "NOT_A_BUNDLE" | "BAD_BUNDLE" | "WRONG_BUILD" | "WRONG_PRODUCT" | "WRONG_DEVICE"
    | "REPLAY" | "REFUSED_PATH" | "OUT_OF_SCOPE" | "NO_SPACE" | "RATE_LIMITED" | "WRITE_FAILED" | "NOT_FOUND" | "BAD_PASSCODE"
    | "NOT_PAIRING" | "PAIRING_CLOSED" | "BAD_GRANT" | "BAD_REVOCATIONS" | "BAD_PARAMS" | "BUSY" | "NOT_RUNNING";

/** Who a change came from: a paired computer, a granted developer, or the platform's key. */
export type NovaKeyKind = "paired" | "grant" | "master";

export interface NovaFile {
    path: string;
    size?: number;
    bundle: string;
    by: string;
    name: string | null;
    kind: NovaKeyKind;
    at: string;
}

export interface NovaBundleRecord {
    id: string;
    by: string;
    fingerprint: string;
    name: string | null;
    kind: NovaKeyKind;
    note: string | null;
    made: string;
    applied: string;
    mode: "replace" | "add";
    files: number;
    removed: number;
    reverted: number;
    parts: string[];
}

export interface NovaRestart { what: string; ok: boolean; error?: string; pending?: boolean }

export interface NovaStatus {
    /** False in a simulator without its novad (no Node.js). */
    available?: boolean;
    devMode: boolean;
    build: string | null;
    product: string | null;
    compatible: string | null;
    deviceId: string;
    /** This device's key: what Pair a Computer shows and nova prints. */
    fingerprint: string;
    /** The overlay holds changes and is mounted. */
    active: boolean;
    /** Revert to Image is waiting for the restart. */
    clearing: boolean;
    files: NovaFile[];
    removed: NovaFile[];
    bundles: NovaBundleRecord[];
    usage: number;
    cap: number;
    /** A change needs the device restarted to finish. */
    pendingReboot: boolean;
    restarts: NovaRestart[];
    waiting: number;
    pairing: { code: string; fingerprint: string; expires: string; runsLeft: number } | null;
    paired: number;
    options: { network: boolean; usb: boolean; overlayCap: number };
}

export interface NovaWaiting {
    id: string;
    by: string;
    fingerprint: string;
    kind: NovaKeyKind;
    name: string | null;
    grant: string | null;
    note: string | null;
    made: string;
    received: string;
    mode: "replace" | "add";
    parts: string[];
    /** It changes Luna role and permission files: what services may do. */
    roles: boolean;
    files: string[];
    removed: string[];
    restart: string[];
    size: number;
}

export interface NovaPairedComputer { key: string; fingerprint: string; name: string; paired: string; lastUsed: string | null }
export interface NovaGrant {
    id: string; key: string; fingerprint: string; name: string; account: string | null; devices: string[]; product: string;
    parts: string[]; issued: string; expires: string; expired: boolean; revoked: boolean;
}
export interface NovaKeys { paired: NovaPairedComputer[]; grants: NovaGrant[]; master: { key: string; fingerprint: string } | null }

/** The service's error code of a failed call, or null. */
export function novaErrorCode(e: unknown): NovaErrorCode | null {
    return e instanceof LunaError && typeof e.reply.errorCode === "string" ? (e.reply.errorCode as NovaErrorCode) : null;
}

export const nova = {
    watchStatus(cb: (s: NovaStatus) => void, onError?: (e: LunaError) => void): Subscription {
        return subscribe(SERVICE + "getStatus", { subscribe: true }, (r) => cb(r as unknown as NovaStatus), onError);
    },
    status(): Promise<NovaStatus> {
        return call(SERVICE + "getStatus", {}).then((r) => r as unknown as NovaStatus);
    },
    /** Bundles from the platform's key or a granted developer, for the owner to Apply. */
    waiting(): Promise<NovaWaiting[]> {
        return call(SERVICE + "listWaiting", {}).then((r) => (r as unknown as { bundles: NovaWaiting[] }).bundles);
    },
    /** Apply a waiting bundle; the device passcode is checked by the service. */
    apply(id: string, passCode: string): Promise<{ applied: string; restarted: NovaRestart[]; pendingReboot: boolean }> {
        return call(SERVICE + "apply", { id, passCode }).then((r) => r as unknown as { applied: string; restarted: NovaRestart[]; pendingReboot: boolean });
    },
    decline(id: string): Promise<void> {
        return call(SERVICE + "decline", { id }).then(() => undefined);
    },
    /** One file back to the image's. */
    revertFile(path: string): Promise<void> {
        return call(SERVICE + "revert", { path }).then(() => undefined);
    },
    /** Revert to Image: every pushed change goes at the restart, which starts now. */
    revertToImage(): Promise<void> {
        return call(SERVICE + "revert", {}).then(() => undefined);
    },
    restartNow(): Promise<void> {
        return call(SERVICE + "restartNow", {}).then(() => undefined);
    },
    /** Pair a Computer: the six-digit code and this device's key fingerprint, for two minutes. */
    pairStart(): Promise<{ code: string; fingerprint: string; expires: string; seconds: number }> {
        return call(SERVICE + "pairStart", {}).then((r) => r as unknown as { code: string; fingerprint: string; expires: string; seconds: number });
    },
    pairCancel(): Promise<void> {
        return call(SERVICE + "pairCancel", {}).then(() => undefined);
    },
    keys(): Promise<NovaKeys> {
        return call(SERVICE + "listKeys", {}).then((r) => r as unknown as NovaKeys);
    },
    /** A paired computer's key ("ed25519:..." or base64) or a grant's id. */
    removeKey(key: string): Promise<void> {
        return call(SERVICE + "removeKey", { key }).then(() => undefined);
    },
    setOptions(o: { network?: boolean; usb?: boolean; overlayCap?: number }): Promise<void> {
        return call(SERVICE + "setOptions", o).then(() => undefined);
    },
};
