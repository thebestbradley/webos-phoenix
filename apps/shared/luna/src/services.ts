// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Small, documented wrappers for the OSE service calls the Phoenix apps
// make. Each names the real service method it uses (see types.ts for the
// source files). Subscriptions return a Subscription; cancel it when done.

import { call, subscribe, type LunaError, type Subscription } from "./bridge";
import type {
    AudioStream, BluetoothAdapter, BluetoothDevice, ConnectionStatus, DeviceInfo, LockMode, OsInfo, Ringtone,
    SystemPreferences, SystemSettings, SystemTime, TimeZone, VirtualKeyboardPrefs, WifiNetworkInfo, WifiSecurityType, WifiStatus,
} from "./types";

type OnError = (e: LunaError) => void;

// ---- Wi-Fi: com.webos.service.wifi (webos-connman-adapter src/wifi_service.c) -------

export const wifi = {
    /** setstate {state: "enabled" | "disabled"} */
    setEnabled(on: boolean) {
        return call("luna://com.webos.service.wifi/setstate", { state: on ? "enabled" : "disabled" });
    },
    /** getstatus {subscribe}: serviceEnabled/Disabled, or the current connection. */
    watchStatus(cb: (s: WifiStatus) => void, onError?: OnError): Subscription {
        return subscribe("luna://com.webos.service.wifi/getstatus", {}, cb, onError);
    },
    /** findnetworks {subscribe}: access points in range; rescans while subscribed. */
    watchNetworks(cb: (networks: WifiNetworkInfo[]) => void, onError?: OnError): Subscription {
        return subscribe("luna://com.webos.service.wifi/findnetworks", {},
            (r) => cb(r.foundNetworks.map((n) => n.networkInfo)), onError);
    },
    /**
     * connect {ssid, security?}: replies when connman has connected or failed
     * (errorCode 10 = wrong password). Open networks need no security.
     */
    connect(ssid: string, securityType?: WifiSecurityType, passKey?: string, hidden = false) {
        return call("luna://com.webos.service.wifi/connect", {
            ssid,
            ...(hidden ? { wasCreatedWithJoinOther: true } : {}),
            ...(securityType && securityType !== "none"
                ? { security: { securityType, simpleSecurity: { passKey: passKey ?? "" } } } : {}),
        });
    },
    /** connect {profileId}: a network joined before. */
    connectProfile(profileId: number) {
        return call("luna://com.webos.service.wifi/connect", { profileId });
    },
    /** deleteprofile {profileId}: forget a network. */
    forget(profileId: number) {
        return call("luna://com.webos.service.wifi/deleteprofile", { profileId });
    },
};

/** Error code of a wrong Wi-Fi password (errors.h WCA_API_ERROR_INVALID_KEY). */
export const WIFI_ERROR_INVALID_KEY = 10;

// ---- Airplane mode: com.webos.service.connectionmanager -----------------------------

export const connection = {
    /** getstatus {subscribe}: connection summary; offlineMode is airplane mode. */
    watchStatus(cb: (s: ConnectionStatus) => void, onError?: OnError): Subscription {
        return subscribe("luna://com.webos.service.connectionmanager/getstatus", {}, cb, onError);
    },
    /** setstate {offlineMode: "enabled" | "disabled"} */
    setAirplaneMode(on: boolean) {
        return call("luna://com.webos.service.connectionmanager/setstate", { offlineMode: on ? "enabled" : "disabled" });
    },
};

// ---- Bluetooth: com.webos.service.bluetooth2 ---------------------------------------

export const bluetooth = {
    /** adapter/getStatus {subscribe}: the default adapter. */
    watchAdapter(cb: (a: BluetoothAdapter | null) => void, onError?: OnError): Subscription {
        return subscribe("luna://com.webos.service.bluetooth2/adapter/getStatus", {},
            (r) => cb(r.adapters[0] ?? null), onError);
    },
    /** adapter/setState {powered} */
    setPowered(powered: boolean) {
        return call("luna://com.webos.service.bluetooth2/adapter/setState", { powered });
    },
    /** device/getStatus {subscribe}: paired and discovered devices. */
    watchDevices(cb: (d: BluetoothDevice[]) => void, onError?: OnError): Subscription {
        return subscribe("luna://com.webos.service.bluetooth2/device/getStatus", {}, (r) => cb(r.devices), onError);
    },
    /** adapter/startDiscovery */
    startDiscovery() {
        return call("luna://com.webos.service.bluetooth2/adapter/startDiscovery", {});
    },
    /** adapter/cancelDiscovery */
    cancelDiscovery() {
        return call("luna://com.webos.service.bluetooth2/adapter/cancelDiscovery", {});
    },
    /** adapter/pair {address} */
    pair(address: string) {
        return call("luna://com.webos.service.bluetooth2/adapter/pair", { address });
    },
    /** adapter/unpair {address} */
    unpair(address: string) {
        return call("luna://com.webos.service.bluetooth2/adapter/unpair", { address });
    },
};

// ---- com.webos.settingsservice -------------------------------------------------------

export const settings = {
    /** getSystemSettings {category, keys, subscribe} */
    watch(category: string, keys: string[], cb: (s: SystemSettings) => void, onError?: OnError): Subscription {
        return subscribe("luna://com.webos.settingsservice/getSystemSettings",
            { ...(category ? { category } : {}), keys }, (r) => cb(r.settings), onError);
    },
    /** setSystemSettings {category, settings} */
    set(category: string, values: SystemSettings) {
        return call("luna://com.webos.settingsservice/setSystemSettings",
            { ...(category ? { category } : {}), settings: values });
    },
    /** resetSystemSettings {category?}: back to the defaults. */
    reset(category?: string) {
        return call("luna://com.webos.settingsservice/resetSystemSettings", category ? { category } : {});
    },
};

// ---- com.webos.service.systemservice (luna-sysservice) --------------------------------

export const system = {
    /**
     * getPreferences {keys, subscribe}. Later replies carry only the keys
     * that changed; cb always gets all of them, the changes merged in.
     */
    watchPreferences(keys: (keyof SystemPreferences)[], cb: (p: SystemPreferences) => void, onError?: OnError): Subscription {
        let all: SystemPreferences = {};
        return subscribe("luna://com.webos.service.systemservice/getPreferences", { keys }, (r) => {
            all = { ...all, ...r };
            cb(all);
        }, onError);
    },
    /** setPreferences {key: value, ...} */
    setPreferences(p: SystemPreferences) {
        return call("luna://com.webos.service.systemservice/setPreferences", p);
    },
    /** getPreferenceValues {key: "timeZone"}: every selectable zone. */
    async timeZones(): Promise<TimeZone[]> {
        return (await call("luna://com.webos.service.systemservice/getPreferenceValues", { key: "timeZone" })).timeZone;
    },
    /** time/getSystemTime */
    async systemTime(): Promise<SystemTime> {
        return call("luna://com.webos.service.systemservice/time/getSystemTime", {});
    },
    /** time/setSystemTime {utc}: seconds since the epoch (TimePrefsHandler.cpp example). */
    setSystemTime(date: Date) {
        return call("luna://com.webos.service.systemservice/time/setSystemTime", { utc: Math.floor(date.getTime() / 1000) });
    },
    /** deviceInfo/query {parameters?} */
    deviceInfo(parameters?: string[]): Promise<DeviceInfo> {
        return call("luna://com.webos.service.systemservice/deviceInfo/query", parameters ? { parameters } : {});
    },
    /** osInfo/query {parameters?} */
    osInfo(parameters?: string[]): Promise<OsInfo> {
        return call("luna://com.webos.service.systemservice/osInfo/query", parameters ? { parameters } : {});
    },
    /** ringtone/listRingtones: the system's ringtones, then the user's (/media/internal/ringtones). */
    async ringtones(): Promise<Ringtone[]> {
        return (await call("luna://com.webos.service.systemservice/ringtone/listRingtones", {})).ringtones;
    },
};

/**
 * The virtual keyboard's preferences (x_palm_virtualkeyboard_prefs, a JSON
 * string: LunaSysMgr VirtualKeyboardPreferences.cpp). TapSounds is
 * "Keyboard clicks"; missing means on.
 */
export function keyboardPrefs(value: unknown): VirtualKeyboardPrefs {
    if (typeof value === "string") {
        try { value = JSON.parse(value); } catch { value = null; }
    }
    return value && typeof value === "object" ? value as VirtualKeyboardPrefs : {};
}

/** The same preference with TapSounds set, other keys kept, as the string it is stored as. */
export function withTapSounds(value: unknown, on: boolean): string {
    return JSON.stringify({ ...keyboardPrefs(value), TapSounds: on });
}

// ---- com.webos.service.audio (audiod-pro) --------------------------------------------

export const audio = {
    /** master/getVolume {subscribe} */
    watchMaster(cb: (v: { volume: number; muted: boolean }) => void, onError?: OnError): Subscription {
        return subscribe("luna://com.webos.service.audio/master/getVolume", {},
            (r) => cb({ volume: r.volumeStatus.volume, muted: r.volumeStatus.muted }), onError);
    },
    /** master/setVolume {soundOutput, volume} */
    setMasterVolume(volume: number) {
        return call("luna://com.webos.service.audio/master/setVolume", { soundOutput: "alsa", volume: Math.round(volume) });
    },
    /** master/muteVolume {soundOutput, mute} */
    setMuted(mute: boolean) {
        return call("luna://com.webos.service.audio/master/muteVolume", { soundOutput: "alsa", mute });
    },
    /** getInputVolume {streamType, subscribe} */
    watchStream(streamType: AudioStream, cb: (volume: number) => void, onError?: OnError): Subscription {
        return subscribe("luna://com.webos.service.audio/getInputVolume", { streamType }, (r) => cb(r.volume), onError);
    },
    /** setInputVolume {streamType, volume} */
    setStreamVolume(streamType: AudioStream, volume: number) {
        return call("luna://com.webos.service.audio/setInputVolume", { streamType, volume: Math.round(volume) });
    },
    /** playFeedback {name}: a short system sound. */
    playFeedback(name: string) {
        return call("luna://com.webos.service.audio/playFeedback", { name });
    },
    /** playSound {fileName, sink}: play a sound file on a stream; resolves to its playbackId. */
    async playSound(fileName: string, sink: AudioStream, options: { duration?: number } = {}): Promise<string> {
        return (await call("luna://com.webos.service.audio/playSound", { fileName, sink, ...options })).playbackId;
    },
    /** controlPlayback {playbackId, requestType: "stop"} */
    stopSound(playbackId: string) {
        return call("luna://com.webos.service.audio/controlPlayback", { playbackId, requestType: "stop" });
    },
};

// ---- Device lock: com.palm.systemmanager (legacy webOS; Phoenix to provide on OSE) ----

export const deviceLock = {
    async mode(): Promise<LockMode> {
        return (await call("luna://com.palm.systemmanager/getDeviceLockMode", {})).lockMode;
    },
    set(lockMode: LockMode, passCode?: string, oldPasscode?: string) {
        return call("luna://com.palm.systemmanager/setDevicePasscode", {
            lockMode, ...(passCode ? { passCode } : {}), ...(oldPasscode ? { oldPasscode } : {}),
        });
    },
    async matches(passCode: string): Promise<boolean> {
        return (await call("luna://com.palm.systemmanager/matchDevicePasscode", { passCode })).succeeded;
    },
    /** getLockStatus {subscribe}: the lock screen is up (the shell says so when the screen locks and unlocks). */
    watchLocked(cb: (locked: boolean) => void, onError?: OnError): Subscription {
        return subscribe("luna://com.palm.systemmanager/getLockStatus", {}, (r) => cb(!!r.locked), onError);
    },
};

// ---- Applications: com.webos.applicationManager (SAM) ---------------------------------

export const apps = {
    /** launch {id, params}: start or relaunch an app. */
    launch(id: string, params: object = {}) {
        return call("luna://com.webos.applicationManager/launch", { id, params });
    },
    /**
     * open {target}: the app that handles a URL (web pages to the browser,
     * mailto: to Email, tel: to Phone, ...: command-resource-handlers.json).
     */
    open(target: string) {
        return call("luna://com.webos.applicationManager/open", { target });
    },
    /** getAppInfo {id}: whether an app is installed (false when it is not). */
    async installed(id: string): Promise<boolean> {
        try {
            const r = await call("luna://com.webos.applicationManager/getAppInfo", { id });
            return !!(r as { appInfo?: unknown }).appInfo;
        } catch {
            return false;
        }
    },
};
