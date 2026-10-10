// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// What this device offers, so one app runs on Phoenix, on plain webOS OSE
// (no share sheet, pickers, ongoing activities, Assistant) and in a desktop
// browser (no bus at all), and leaves out what is not there.
//
//     if (has("share")) menu.push({ label: "Share", onSelect: ... });

import { palmSystem, phoenixRuntime, request, transport } from "./core";

/**
 * - `bus`: a Luna service bus (PalmServiceBridge, or a transport set with setTransport).
 * - `webos`: the webOS web runtime's PalmSystem (banners, orientation, stage ready).
 * - `phoenix`: Phoenix's runtime and its services (the rest of this list needs it unless said).
 * - `share`, `pickers` (open and save), `appMenu` (the status bar's app name opens it),
 *   `ongoing` (rows with progress in the notification area), `assistant` (app commands),
 *   `justType` (actions and content search from appinfo.json), `clipboardHistory`, `print`,
 *   `notifications` (rows in the notification area, tag, actions).
 * - `banner`: a banner (webOS, or the browser's Notification API when it is allowed).
 * - `dashboard`: a dashboard window (webOS).
 * - `contacts`, `calendar`, `messaging`, `email`, `accounts`: the Synergy data and apps (Phoenix).
 * - `files`: the user's files (Phoenix's file manager service).
 * - `media`, `mediaKeys`, `location`, `device`, `settings`, `activities`: OSE services on the bus.
 * - `orientation`, `fullScreen`, `keepAlive`, `screenOn`: window controls of PalmSystem.
 */
export type Capability =
    | "bus" | "webos" | "phoenix"
    | "share" | "pickers" | "appMenu" | "ongoing" | "assistant" | "justType" | "clipboardHistory" | "print" | "notifications"
    | "banner" | "dashboard"
    | "contacts" | "calendar" | "messaging" | "email" | "accounts"
    | "files" | "media" | "mediaKeys" | "location" | "device" | "settings" | "activities"
    | "orientation" | "fullScreen" | "keepAlive" | "screenOn";

const PHOENIX: Capability[] = ["share", "pickers", "appMenu", "ongoing", "assistant", "justType", "clipboardHistory", "print",
                               "notifications", "files", "contacts", "calendar", "messaging", "email", "accounts"];
const BUS: Capability[] = ["media", "mediaKeys", "location", "device", "settings", "activities"];

/** Whether the bus and the Phoenix runtime are here (set by tests and by bindings that know better). */
let override: Partial<Record<Capability, boolean>> = {};

/**
 * Whether this device offers it. Synchronous, from what the page can see:
 * the bus, PalmSystem and the Phoenix runtime. A service can still be
 * refused at call time (permission-denied); available() asks the bus.
 */
export function has(cap: Capability): boolean {
    if (cap in override) return !!override[cap];
    const palm = palmSystem();
    // Claimed base capabilities count for those that follow from them.
    const bus = "bus" in override ? !!override.bus : transport().name !== "none";
    const phoenix = "phoenix" in override ? !!override.phoenix : !!phoenixRuntime() && bus;
    switch (cap) {
        case "bus": return bus;
        case "webos": return !!palm;
        case "phoenix": return phoenix;
        case "banner":
            return !!palm?.addBannerMessage || bus
                || (typeof Notification !== "undefined" && Notification.permission === "granted");
        case "dashboard": return !!palm && typeof globalThis.open === "function";
        case "orientation": return !!palm?.setWindowOrientation;
        case "fullScreen": return !!palm?.enableFullScreenMode;
        case "keepAlive": return !!palm?.keepAlive;
        case "screenOn": return !!palm?.setWindowProperties;
        default:
            if (PHOENIX.includes(cap)) return phoenix;
            if (BUS.includes(cap)) return bus;
            return false;
    }
}

/** Every capability and whether it is here (for a diagnostics page, or a test). */
export function capabilities(): Record<Capability, boolean> {
    const all: Capability[] = ["bus", "webos", "phoenix", ...PHOENIX, "banner", "dashboard", ...BUS, "orientation", "fullScreen", "keepAlive", "screenOn"];
    return Object.fromEntries(all.map((c) => [c, has(c)])) as Record<Capability, boolean>;
}

/**
 * Tests and hosts that know better: claim capabilities on or off (an empty
 * object undoes it).
 */
export function setCapabilities(caps: Partial<Record<Capability, boolean>>): void {
    override = { ...caps };
}

/**
 * Whether a service is registered on the bus now (com.palm.bus's
 * signal/registerServerStatus, which luna-systemui also waits on). False
 * without a bus, or when the bus does not answer in time.
 *
 *     if (await available("com.webos.service.location")) ...
 */
export async function available(serviceName: string, timeoutMs = 2000): Promise<boolean> {
    if (transport().name === "none") return false;
    try {
        const r = await request<{ connected?: boolean }>("luna://com.palm.bus/signal/registerServerStatus", { serviceName }, { timeoutMs });
        return !!r.connected;
    } catch {
        return false;
    }
}
