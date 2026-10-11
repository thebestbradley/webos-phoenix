// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// System updates: com.palm.update (services/updates/updatesservice.js,
// which documents the methods). Phoenix's own methods, for Settings >
// Updates; luna-systemui uses Palm's (GetStatus, InstallLater, InstallNow).
// An update is downloaded and written to the other system slot in the
// background; installing it is switching slots and restarting.

import { call, subscribe, LunaError, type Subscription } from "./bridge";

const SERVICE = "luna://com.palm.update/";

export interface SystemRelease {
    name: string;
    version: string;
    build: number;
    date: string;
    notes: string[];
    size: number;
}

export type UpdateErrorCode =
    | "NOT_SET_UP" | "CONNECTION_FAILED" | "BAD_FEED" | "BAD_SIGNATURE" | "NO_DELEGATION" | "EXPIRED" | "ROLLBACK" | "REVOKED" | "NO_UPDATE" | "DOWNLOAD_FAILED" | "BAD_DOWNLOAD" | "BAD_BUNDLE" | "WRONG_DEVICE"
    | "NOT_NEWER" | "INSTALL_FAILED" | "LOW_BATTERY" | "BUSY" | "BAD_PARAMS" | "UNKNOWN_ERROR";

export type UpdateChannel = "stable" | "beta" | "dev";

export interface UpdateStatus {
    /** ready: downloaded and prepared; installing it restarts the device. */
    state: "idle" | "checking" | "downloading" | "preparing" | "ready" | "restarting";
    current: { name: string; version: string; build: number };
    available: SystemRelease | null;
    /** 0-100 while downloading and preparing. */
    progress: number | null;
    lastChecked: string | null;
    error: { errorCode: UpdateErrorCode; errorText: string } | null;
    /** Download updates by themselves over Wi-Fi. */
    autoDownload: boolean;
    channel: UpdateChannel;
    /** The channels servers.json offers (stable, beta, dev). */
    channels: UpdateChannel[];
    /** An update server is set up (servers.json "updates"). */
    configured: boolean;
    /** The last feed read was signed and its signature checked. */
    verified: boolean;
    /** A staged release this device is not in yet. */
    rollout: { percent: number; waiting: boolean; version: string } | null;
    battery: { percent: number; charging: boolean } | null;
    minBattery: number;
    /** "Install later": asked again at the next charge. */
    deferred: boolean;
}

/** The service's error code of a failed call ("LOW_BATTERY", ...), or null. */
export function updateErrorCode(e: unknown): UpdateErrorCode | null {
    return e instanceof LunaError && typeof e.reply.errorCode === "string" ? (e.reply.errorCode as UpdateErrorCode) : null;
}

const status = (r: unknown) => r as UpdateStatus;

export const systemUpdates = {
    watchStatus(cb: (s: UpdateStatus) => void, onError?: (e: LunaError) => void): Subscription {
        return subscribe(SERVICE + "getStatus", { subscribe: true }, (r) => cb(status(r)), onError);
    },
    status(): Promise<UpdateStatus> {
        return call(SERVICE + "getStatus", {}).then(status);
    },
    /** Read the update feed. */
    check(): Promise<UpdateStatus> {
        return call(SERVICE + "check", {}).then(status);
    },
    /** Download the update and prepare it (any network). */
    download(): Promise<UpdateStatus> {
        return call(SERVICE + "download", {}).then(status);
    },
    cancel(): Promise<UpdateStatus> {
        return call(SERVICE + "cancel", {}).then(status);
    },
    /** Switch to the prepared system and restart. */
    installNow(): Promise<void> {
        return call(SERVICE + "installNow", {}).then(() => undefined);
    },
    /** Ask again when the charger is next connected. */
    installLater(): Promise<void> {
        return call(SERVICE + "InstallLater", {}).then(() => undefined);
    },
    setPreferences(p: { autoDownload?: boolean; channel?: UpdateChannel }): Promise<UpdateStatus> {
        return call(SERVICE + "setPreferences", p).then(status);
    },
};
