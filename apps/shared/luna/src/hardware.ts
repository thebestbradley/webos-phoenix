// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The device's hardware and its drivers: org.webosphoenix.hardware
// (services/hardware/hardwareservice.js documents the methods). Lists the
// hardware with what each device needs, and installs the drivers and
// firmware the signed driver catalog has for it.

import { call, subscribe, LunaError, type Subscription } from "./bridge";

const SERVICE = "luna://org.webosphoenix.hardware/";

export type DeviceStatus = "working" | "needs-firmware" | "needs-driver" | "no-driver" | "restart";
export type DriverKind = "firmware" | "module" | "service";
export type HardwareCategory = "wifi" | "bluetooth" | "graphics" | "camera" | "audio" | "input" | "sensors" | "storage" | "modem" | "network" | "usb" | "other";

export interface DriverLicense {
    /** SPDX id, or LicenseRef-... for a vendor's own. */
    id: string;
    name: string;
    /** The full text: shown before installing when it is not a free licence. */
    text: string;
    url: string;
    /** An open source licence (no acceptance needed). */
    free: boolean;
}

/** A driver, firmware or service the catalog has for a device. */
export interface DriverOffer {
    driverId: string;
    kind: DriverKind;
    title: string;
    summary: string;
    description: string;
    category: HardwareCategory;
    /** An extra for hardware that already works. */
    optional: boolean;
    after: "reload" | "rebind" | "reboot" | "none";
    source: string;
    license: DriverLicense;
    /** Download size in bytes, and on the device once installed (null: unknown). */
    size: number;
    installedSize: number | null;
    version: string;
    packages: string[];
    /** Built for this device's processor and kernel. */
    available: boolean;
    reason: string | null;
    installed: boolean;
    installedVersion: string | null;
    installing: { state: DriverInstallState; progress: number } | null;
}

export interface HardwareDevice {
    id: string;
    bus: string;
    name: string;
    vendor: string;
    category: HardwareCategory;
    /** The kernel's modaliases: what drivers match. */
    ids: string[];
    driver: string | null;
    firmwareMissing: string[];
    status: DeviceStatus;
    offers: DriverOffer[];
}

export interface HardwareList {
    devices: HardwareDevice[];
    catalog: { name: string | null; build: number | null; refreshed: string | null; error: { errorCode: string; errorText: string } | null };
    system: { arch: string; kernel: string };
    /** Drivers installed that start with the next restart. */
    pendingRestart: string[];
    report: { enabled: boolean; lastSent: string | null };
}

export type DriverInstallState = "queued" | "downloading" | "checking" | "installing" | "activating" | "installed" | "restart" | "failed";

export interface DriverInstallProgress {
    driverId: string;
    state: DriverInstallState;
    progress?: number;
    errorCode?: string;
    errorText?: string;
    /** A failed install was undone. */
    rolledBack?: boolean;
}

/** What the opt-in hardware report sends: the IDs of devices nothing drives, nothing else. */
export interface HardwareReport {
    format: 1;
    arch: string;
    kernel: string;
    devices: { bus: string; ids: string[]; firmwareMissing: string[] }[];
}

/** Devices that need something installed to work. */
export function needsAttention(d: HardwareDevice): boolean {
    return d.status === "needs-firmware" || d.status === "needs-driver";
}

/** What can be installed for a device now (not installed, built for it). */
export function installable(d: HardwareDevice): DriverOffer[] {
    return d.offers.filter((o) => o.available && !o.installed);
}

const list = (r: unknown) => r as unknown as HardwareList;

export const hardware = {
    watch(cb: (l: HardwareList) => void, onError?: (e: LunaError) => void): Subscription {
        return subscribe(SERVICE + "list", { subscribe: true }, (r) => cb(list(r)), onError);
    },
    list(): Promise<HardwareList> {
        return call(SERVICE + "list", {}).then(list);
    },
    /** Read the driver catalog again. */
    refresh(): Promise<HardwareList> {
        return call(SERVICE + "refresh", {}).then(list);
    },
    /**
     * Install a driver; acceptLicense is the licence's id once the user has
     * agreed to it (needed when it is not a free licence). Resolves when it
     * is installed ("installed", or "restart" for one that starts with the
     * next restart); rejects with the service's error (rolledBack: undone).
     */
    install(driverId: string, opts: { deviceId?: string; acceptLicense?: string }, onProgress?: (p: DriverInstallProgress) => void): Promise<DriverInstallProgress> {
        return new Promise((resolve, reject) => {
            const sub = subscribe(SERVICE + "install", { driverId, ...opts, subscribe: true }, (r) => {
                const p = r as unknown as DriverInstallProgress;
                onProgress?.(p);
                if (p.state === "installed" || p.state === "restart") {
                    sub.cancel();
                    resolve(p);
                }
            }, (e) => {
                onProgress?.({ driverId, ...(e.reply as object), state: "failed" } as DriverInstallProgress);
                reject(e);
            });
        });
    },
    remove(driverId: string): Promise<{ restart: boolean }> {
        return call(SERVICE + "remove", { driverId }).then((r) => ({ restart: !!(r as { restart?: boolean }).restart }));
    },
    getReport(): Promise<HardwareReport> {
        return call(SERVICE + "getReport", {}).then((r) => (r as unknown as { report: HardwareReport }).report);
    },
    sendReport(): Promise<{ sent: boolean }> {
        return call(SERVICE + "sendReport", {}).then((r) => ({ sent: !!(r as { sent?: boolean }).sent }));
    },
    setPreferences(p: { reportEnabled: boolean }): Promise<void> {
        return call(SERVICE + "setPreferences", p).then(() => undefined);
    },
};

/** The service's error code of a failed call ("LICENSE_REQUIRED", ...), or null. */
export function hardwareErrorCode(e: unknown): string | null {
    return e instanceof LunaError && typeof e.reply.errorCode === "string" ? e.reply.errorCode : null;
}
