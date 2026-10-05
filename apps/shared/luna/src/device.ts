// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// LunaSysMgr's device services, as the webOS 1-3 apps called them
// (luna-sysmgr README.md:24-128), for Phoenix apps:
//
//   com.palm.display             the display: on, dimmed or off, and keeping it on
//   com.palm.keys                the audio, media and headset keys and the switches
//   com.palm.vibrate             the vibration motor
//   com.palm.ambientLightSensor  the light sensor
//
// The simulator implements them in runtime/phoenix-runtime.js ("LunaSysMgr's
// device services"), over the shell's own display, keys and motor; a device
// has them from services/devices (phoenix-devices). docs/APP-RUNTIME.md
// lists the requests and replies.

import { call, subscribe, type LunaError, type Subscription } from "./bridge";

/** The display as com.palm.display reports it ("undefined" never comes from Phoenix). */
export type DisplayState = "on" | "dimmed" | "off";

/** DisplayManager::notifySubscribers's events; "request" is the reply to the call itself. */
export type DisplayEvent = "request" | "displayOn" | "displayDimmed" | "displayOff" | "changedTimeout"
    | "blockedDisplay" | "unblockedDisplay" | "displayActive" | "displayInactive";

export interface DisplayStatus {
    event: DisplayEvent;
    /** Only with the "request" reply. */
    state?: DisplayState;
    /** Seconds until the screen turns off (control/status; changedTimeout). */
    timeout?: number;
    /** "true" while something keeps the display on: luna-sysmgr sent a string. */
    blockDisplay?: "true" | "false";
    /** The inactivity timer is running. */
    active?: boolean;
    /** displayOn in dock mode (the Touchstone's exhibition). */
    dockMode?: boolean;
}

export interface DisplayProperties {
    requestBlock?: boolean;
    powerKeyBlock?: boolean;
    timeout?: number;
    maximumBrightness?: number;
    onWhenConnected?: boolean;
    proximityEnabled?: boolean;
}

/** {key, state} from com.palm.keys: "up" / "down", and the headset button's clicks. */
export interface KeyEvent {
    key: string;
    state: "up" | "down" | "single_click" | "double_click" | "hold" | "unknown";
}

export type KeyCategory = "audio" | "media" | "headset" | "switches";

/** HapticsControllerCastle's effects. */
export type VibrationEffect = "ringtone" | "alert" | "notification" | "tapdown" | "tapup";

/** A light reading: current lux, and the region (0 undefined, 1 dark, 2 dim, 3 indoor, 4 outdoor). */
export interface LightReading {
    current: number;
    region?: number;
    average?: number;
    disabled?: boolean;
}

const DISPLAY = "luna://com.palm.display";
const KEYS = "luna://com.palm.keys";
const VIBRATE = "luna://com.palm.vibrate";
const ALS = "luna://com.palm.ambientLightSensor";

export const display = {
    /** The state now (control/status). */
    async status(): Promise<DisplayStatus> {
        return (await call(`${DISPLAY}/control/status`, {})) as unknown as DisplayStatus;
    },
    /** control/status {subscribe}: the state, then every event. */
    watch(cb: (s: DisplayStatus) => void, onError?: (e: LunaError) => void): Subscription {
        return subscribe(`${DISPLAY}/control/status`, {}, (r) => cb(r as unknown as DisplayStatus), onError);
    },
    /** Turn the display on, dim it, turn it off; "unlock" also asks to unlock (no passcode). */
    async setState(state: DisplayState | "unlock" | "dock" | "undock"): Promise<void> {
        await call(`${DISPLAY}/control/setState`, { state });
    },
    async getProperties(properties: (keyof DisplayProperties)[]): Promise<DisplayProperties> {
        return (await call(`${DISPLAY}/control/getProperty`, { properties })) as unknown as DisplayProperties;
    },
    async setProperties(props: Omit<DisplayProperties, "requestBlock" | "powerKeyBlock" | "proximityEnabled">): Promise<void> {
        await call(`${DISPLAY}/control/setProperty`, props);
    },
    /**
     * Keep the display on (and turn it on) until the returned subscription
     * is cancelled: setProperty {requestBlock, client}, as the Clock does
     * while an alarm rings. Works on the lock screen too.
     */
    keepOn(client: string, onError?: (e: LunaError) => void): Subscription {
        return subscribe(`${DISPLAY}/control/setProperty`, { requestBlock: true, client }, () => undefined, onError);
    },
    /** The Power key only reaches cb ({powerKey: "released"}) until cancelled. */
    blockPowerKey(client: string, cb: () => void, onError?: (e: LunaError) => void): Subscription {
        return subscribe(`${DISPLAY}/control/setProperty`, { powerKeyBlock: true, client },
            (r) => { if ((r as { powerKey?: string }).powerKey) cb(); }, onError);
    },
};

export const keys = {
    /** Every key event of a category (the reply to the call itself has no key). */
    watch(category: KeyCategory, cb: (e: KeyEvent) => void, onError?: (e: LunaError) => void): Subscription {
        return subscribe(`${KEYS}/${category}/status`, {}, (r) => {
            const k = r as unknown as Partial<KeyEvent>;
            if (typeof k.key === "string" && typeof k.state === "string") cb(k as KeyEvent);
        }, onError);
    },
    /** A switch's state: ringer ("up" on, "down" silent), slider, headset, headset-mic. */
    async get(name: string): Promise<KeyEvent["state"]> {
        return ((await call(`${KEYS}/switches/status`, { get: name })) as unknown as KeyEvent).state;
    },
};

export const vibrator = {
    /** period ms; duration ms, or 0 / none until the subscription is cancelled. */
    vibrate(period: number, duration?: number, onError?: (e: LunaError) => void): Subscription {
        return subscribe(`${VIBRATE}/vibrate`, duration ? { period, duration } : { period }, () => undefined, onError);
    },
    async effect(name: VibrationEffect): Promise<void> {
        await call(`${VIBRATE}/vibrateNamedEffect`, { name });
    },
};

export const lightSensor = {
    async read(): Promise<LightReading> {
        return (await call(`${ALS}/control/status`, {})) as unknown as LightReading;
    },
    watch(cb: (r: LightReading) => void, onError?: (e: LunaError) => void): Subscription {
        return subscribe(`${ALS}/control/status`, {}, (r) => cb(r as unknown as LightReading), onError);
    },
};
