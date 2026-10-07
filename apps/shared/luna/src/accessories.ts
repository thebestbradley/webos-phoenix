// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Phoenix's services for Settings > Game Controllers, USB, Hotspot &
// Tethering and Battery (docs/M6-PLAN.md F4 items 8-9; docs/APP-RUNTIME.md
// "Accessories"). The simulator implements them in runtime/phoenix-runtime.js
// ("Accessories, tethering and the battery's use").

import { call, subscribe, type LunaError, type Subscription } from "./bridge";

type OnError = (e: LunaError) => void;

export interface GamepadInfo {
    index: number;
    id: string;
    name: string;
    /** "bluetooth", "usb", or "" when the system does not say. */
    connection: string;
    mapping: string;
    /** The buttons held, by the standard mapping's index (0 is A). */
    buttons: number[];
    axes: number[];
}

export interface UsbDrive {
    id: string;
    label: string;
    vendor?: string;
    size: number;
    used: number;
    fs?: string;
    mounted: boolean;
    safeToRemove: boolean;
    path: string;
}

export interface TetheringStatus {
    /** The device has mobile data to share (phones). */
    available: boolean;
    wifi: { enabled: boolean; ssid: string; passphrase: string; security: "wpa2" | "open"; clients: { name: string }[] };
    usb: { enabled: boolean; connected: boolean };
}

export interface BatteryUsage {
    percent: number;
    charging: boolean;
    temperature: number;
    /** The level over the last 24 hours. */
    history: { t: number; percent: number; charging?: boolean }[];
    screenOnMs: number;
    apps: { appId: string; title: string; ms: number; share: number }[];
}

export const gamepads = {
    watch(cb: (pads: GamepadInfo[]) => void, onError?: OnError): Subscription {
        return subscribe("luna://org.webosphoenix.gamepads/list", {}, (r) => cb((r as unknown as { gamepads?: GamepadInfo[] }).gamepads ?? []), onError);
    },
};

export const usbDrives = {
    watch(cb: (drives: UsbDrive[]) => void, onError?: OnError): Subscription {
        return subscribe("luna://org.webosphoenix.usb/listDrives", {}, (r) => cb((r as unknown as { drives?: UsbDrive[] }).drives ?? []), onError);
    },
    unmount(id: string) { return call("luna://org.webosphoenix.usb/unmount", { id }); },
    mount(id: string) { return call("luna://org.webosphoenix.usb/mount", { id }); },
};

export const tethering = {
    watch(cb: (s: TetheringStatus) => void, onError?: OnError): Subscription {
        return subscribe("luna://org.webosphoenix.tethering/getStatus", {}, (r) => cb(r as unknown as TetheringStatus), onError);
    },
    setWifi(p: { enabled?: boolean; ssid?: string; passphrase?: string; security?: "wpa2" | "open" }) {
        return call("luna://org.webosphoenix.tethering/setWifi", p);
    },
    setUsb(enabled: boolean) { return call("luna://org.webosphoenix.tethering/setUsb", { enabled }); },
};

export const battery = {
    watchUsage(cb: (u: BatteryUsage) => void, onError?: OnError): Subscription {
        return subscribe("luna://org.webosphoenix.battery/usage", {}, (r) => cb(r as unknown as BatteryUsage), onError);
    },
};
