// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Backup and restore: org.webosphoenix.service.backup
// (apps/settings/service/backupservice.js, which documents the methods).
// One encrypted file per backup, on the USB drive (/media/internal/backups)
// or a WebDAV server (Nextcloud, ownCloud, a NAS), holding what the legacy
// webOS backup participants hand over: db8's local data, the system
// preferences and the launcher layout.

import { call, subscribe, LunaError, type Subscription } from "./bridge";

const SERVICE = "luna://org.webosphoenix.service.backup/";

export type BackupDestination =
    | { type: "usb"; folder?: string }
    | { type: "webdav"; url: string; username?: string; password?: string }
    /** Phoenix Cloud: the Phoenix Account's WebDAV folder for this device (its address from the account). */
    | { type: "phoenix"; url?: string; username?: string };

export interface BackupResult {
    time: string;
    ok: boolean;
    name?: string;
    size?: number;
    errorCode?: BackupErrorCode;
    errorText?: string;
}

export interface BackupStatus {
    state: "idle" | "backingUp" | "restoring";
    /** A destination and a passphrase are set. */
    configured: boolean;
    hasPassphrase: boolean;
    /** Back up every day. */
    auto: boolean;
    /** Where backups go (never with the WebDAV password). */
    destination: BackupDestination | null;
    last: BackupResult | null;
    lastSuccess: string | null;
}

export interface BackupFile {
    name: string;
    size: number;
    created: string | null;
}

export interface BackupHeader {
    format: string;
    version: number;
    created: string;
    device: { name?: string; model?: string };
    parts: { id: string; description: string; version: string }[];
}

export type BackupErrorCode =
    | "NOT_CONFIGURED" | "NO_PASSPHRASE" | "BUSY" | "BAD_URL" | "UNAUTHORIZED" | "CONNECTION_FAILED" | "BAD_SERVER"
    | "NO_SPACE" | "NOT_FOUND" | "NOT_A_BACKUP" | "NEWER_VERSION" | "WRONG_PASSPHRASE" | "NOTHING_TO_BACK_UP"
    | "BAD_PARAMS" | "UNKNOWN_ERROR";

/** The service's error code of a failed call ("WRONG_PASSPHRASE", ...), or null. */
export function backupErrorCode(e: unknown): BackupErrorCode | null {
    return e instanceof LunaError && typeof e.reply.errorCode === "string" ? (e.reply.errorCode as BackupErrorCode) : null;
}

/** What a backup holds, in words, from its parts' ids. */
export const BACKUP_PARTS: Record<string, string> = {
    "com.palm.db": "Contacts, calendar and more",
    "com.webos.service.systemservice": "Settings",
    "com.palm.sysMgrDataBackup": "Launcher layout",
};

export const backup = {
    watchStatus(cb: (s: BackupStatus) => void, onError?: (e: LunaError) => void): Subscription {
        return subscribe(SERVICE + "getStatus", { subscribe: true }, (r) => cb(r as unknown as BackupStatus), onError);
    },
    status(): Promise<BackupStatus> {
        return call(SERVICE + "getStatus", {}) as unknown as Promise<BackupStatus>;
    },
    /** Set any of: where backups go (a WebDAV folder is checked first), the passphrase, daily backups. */
    configure(p: { destination?: BackupDestination; passphrase?: string; auto?: boolean }): Promise<BackupStatus> {
        return call(SERVICE + "configure", p) as unknown as Promise<BackupStatus>;
    },
    backupNow(): Promise<{ name: string; size: number; parts: string[] }> {
        return call(SERVICE + "backupNow", {}) as unknown as Promise<{ name: string; size: number; parts: string[] }>;
    },
    async list(): Promise<BackupFile[]> {
        return ((await call(SERVICE + "listBackups", {})) as unknown as { backups: BackupFile[] }).backups;
    },
    async inspect(name: string): Promise<BackupHeader> {
        return ((await call(SERVICE + "inspect", { name })) as unknown as { header: BackupHeader }).header;
    },
    /** Restore a backup from where backups go now, or from another place (First Use). */
    restore(name: string, passphrase: string, destination?: BackupDestination): Promise<{ restored: string[]; skipped: string[] }> {
        return call(SERVICE + "restore", { name, passphrase, ...(destination ? { destination } : {}) }) as unknown as
            Promise<{ restored: string[]; skipped: string[] }>;
    },
    remove(name: string): Promise<unknown> {
        return call(SERVICE + "deleteBackup", { name });
    },
};
