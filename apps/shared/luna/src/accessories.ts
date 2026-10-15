// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Phoenix's services for Settings > Game Controllers, USB, Hotspot &
// Tethering and Battery (docs/M6-PLAN.md F4 items 8-9; docs/APP-RUNTIME.md
// "Accessories"), and for AirPods and tracker alerts (docs/ACCESSORIES.md).
// The simulator implements them in runtime/phoenix-runtime.js
// ("Accessories, tethering and the battery's use"; "AirPods and tracker
// alerts").

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

// ---- AirPods and tracker alerts (docs/ACCESSORIES.md) ------------------------------------
// org.webosphoenix.earbuds and org.webosphoenix.trackers: on a device the
// accessories service (services/accessories/earbuds.js, trackers.js), in
// the simulator the runtime ("AirPods and tracker alerts").

export type EarbudSpot = "ear" | "out" | "case" | "";
export type NoiseMode = "off" | "transparency" | "adaptive" | "anc";

/** Battery levels in percent; -1 when there is no reading. */
export interface EarbudsBattery {
    left: number;
    right: number;
    case: number;
    /** One battery (AirPods Max). */
    single?: number;
}

export interface EarbudsCharging {
    left: boolean;
    right: boolean;
    case: boolean;
    single?: boolean;
}

/** AirPods advertising nearby (their case open, or earbuds out). */
export interface NearbyEarbuds {
    id: string;
    model: string;
    modelName: string;
    kind: string;
    color: string;
    battery: EarbudsBattery;
    charging: EarbudsCharging;
    lidOpen: boolean;
    lidOpenCount: number;
    rssi: number;
    /** The paired AirPods these are taken to be ("" for none). */
    paired: string;
    /** How: by their key (their own), by model (the one pair of that model), or "" (not ours). */
    match: "key" | "model" | "";
    /** The batteries are their encrypted part's, to 1 % (else in tenths). */
    exact: boolean;
}

/** Paired AirPods or Beats. */
export interface EarbudsDevice {
    address: string;
    name: string;
    /** The model, from the control channel ("" until connected once). */
    model: string;
    kind: string;
    modelNumber: string;
    connected: boolean;
    /** The control channel is open: batteries, ears and modes are live. */
    aap: boolean;
    battery: EarbudsBattery;
    charging: EarbudsCharging;
    inEar: { left: EarbudSpot; right: EarbudSpot };
    noiseMode: NoiseMode | "";
    noiseModes: NoiseMode[];
    earDetection: boolean;
    /** null: the model has none. */
    conversationAwareness: boolean | null;
    /** The AirPods gave Phoenix their keys. */
    keys: boolean;
    /** "key": known by their key; "model": the one pair of that model is taken to be them. */
    recognition: "key" | "model";
    /** Their advertisement's batteries are read to 1 % (the layout is learned). */
    exactBattery: boolean;
    /** Renaming the AirPods themselves: "" (never), sent and waiting, done, refused or not answered, or waiting for them to connect. */
    renamed: "" | "pending" | "done" | "failed" | "offline";
}

export interface EarbudsPairing {
    id: string;
    state: "searching" | "pairing" | "connecting" | "failed";
    address: string;
    error: string;
}

export interface EarbudsStatus {
    bluetooth: boolean;
    nearby: NearbyEarbuds[];
    devices: EarbudsDevice[];
    pairing: EarbudsPairing | null;
}

const EARBUDS = "luna://org.webosphoenix.earbuds";

export const earbuds = {
    watch(cb: (s: EarbudsStatus) => void, onError?: OnError): Subscription {
        return subscribe(`${EARBUDS}/getStatus`, {}, (r) => cb(r as unknown as EarbudsStatus), onError);
    },
    connect(id: string) { return call(`${EARBUDS}/connect`, { id }); },
    cancelConnect() { return call(`${EARBUDS}/cancelConnect`, {}); },
    setNoiseMode(address: string, mode: NoiseMode) { return call(`${EARBUDS}/setNoiseMode`, { address, mode }); },
    setEarDetection(address: string, enabled: boolean) { return call(`${EARBUDS}/setEarDetection`, { address, enabled }); },
    setConversationAwareness(address: string, enabled: boolean) {
        return call(`${EARBUDS}/setConversationAwareness`, { address, enabled });
    },
    rename(address: string, name: string) { return call(`${EARBUDS}/rename`, { address, name }); },
    forget(address: string) { return call(`${EARBUDS}/forget`, { address }); },
};

export interface TrackerInfo {
    id: string;
    /** "airtag", "findmy", "airpods", "dult", "findhub", "tile", "smarttag". */
    type: string;
    network: string;
    name: string;
    firstSeen: number;
    lastSeen: number;
    sightings: number;
    /** ms between the first and last sighting. */
    duration: number;
    /** Metres between the farthest two places it was seen. */
    distance: number;
    alertedAt: number;
    ignored: boolean;
    points: { t: number; lat?: number; lon?: number }[];
    canPlaySound: boolean;
}

export type TrackerSensitivity = "low" | "medium" | "high";
export type ScanMode = "saver" | "balanced" | "performance";
/** A scan's windows: null, it runs; or `window` ms every `every` ms. */
export type ScanWindow = { window: number; every: number } | null;

export interface TrackerStatus {
    enabled: boolean;
    bluetooth: boolean;
    /** A location to note sightings with (Location Services on). */
    location: boolean;
    scanning: boolean;
    sensitivity: TrackerSensitivity;
    /** The level's rule: ms with you, sightings, metres, ms between alerts. */
    thresholds: { minDuration: number; minSightings: number; minDistance: number; realertAfter: number };
    scanMode: ScanMode;
    scanWindows: { screenOn: ScanWindow; screenOff: ScanWindow } | null;
    trackers: TrackerInfo[];
    sound: { id: string; state: "connecting" | "playing" | "done" | "failed"; error: string } | null;
}

const TRACKERS = "luna://org.webosphoenix.trackers";

export const trackers = {
    watch(cb: (s: TrackerStatus) => void, onError?: OnError): Subscription {
        return subscribe(`${TRACKERS}/getStatus`, {}, (r) => cb(r as unknown as TrackerStatus), onError);
    },
    setEnabled(enabled: boolean) { return call(`${TRACKERS}/setEnabled`, { enabled }); },
    setSensitivity(sensitivity: TrackerSensitivity) { return call(`${TRACKERS}/setSensitivity`, { sensitivity }); },
    setScanMode(mode: ScanMode) { return call(`${TRACKERS}/setScanMode`, { mode }); },
    playSound(id: string) { return call(`${TRACKERS}/playSound`, { id }); },
    stopSound(id: string) { return call(`${TRACKERS}/stopSound`, { id }); },
    ignore(id: string, ignored = true) { return call(`${TRACKERS}/ignore`, { id, ignored }); },
    clear() { return call(`${TRACKERS}/clear`, {}); },
};
