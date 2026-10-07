// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Request and reply types for the webOS OSE service methods Phoenix apps
// use, taken from the services' own sources (webosose GitHub, master):
//
//   com.webos.service.wifi / connectionmanager  webos-connman-adapter
//       src/wifi_service.c, src/connectionmanager_service.c (API doc blocks)
//   com.webos.service.bluetooth2                com.webos.service.bluetooth2
//       src/bluetoothmanagerservice.cpp, src/bluetoothmanageradapter.cpp
//   com.webos.settingsservice                   settingsservice inc/SettingsServiceApi.h
//   com.webos.service.systemservice             luna-sysservice Src/PrefsFactory.cpp,
//       TimePrefsHandler.cpp, DeviceInfoService.cpp, OsInfoService.cpp
//   com.webos.service.audio                     audiod-pro src/modules/masterVolumeManager,
//       audioPolicyManager, systemSoundsManager
//
// Add a method here to get typed call()/subscribe() for it.

/** Every Luna reply. */
export interface LunaReply {
    returnValue: boolean;
    errorCode?: number;
    errorText?: string;
    subscribed?: boolean;
    [key: string]: unknown;
}

type Sub = { subscribe?: boolean };
type Empty = Record<string, never>;

// ---- com.webos.service.wifi ------------------------------------------------------------

export type WifiSecurityType = "none" | "psk" | "wep" | "wpa-personal" | "ieee8021x" | string;

/** connectState values (connman_service_get_webos_state). */
export type WifiConnectState = "notAssociated" | "associating" | "associated" | "ipConfigured" | "ipFailed";

export interface WifiNetworkInfo {
    ssid: string;
    availableSecurityTypes: WifiSecurityType[];
    /** Coarse signal strength, 1..3. */
    signalBars: number;
    /** Fine signal strength, 0..100. */
    signalLevel: number;
    profileId?: number;
    connectState?: WifiConnectState;
    supported?: boolean;
    available?: boolean;
}

export interface WifiIpInfo {
    interface: string;
    ip: string;
    subnet: string;
    gateway: string;
    dns: string[];
}

export interface WifiStatus {
    /** serviceEnabled / serviceDisabled when not connected, connectionStateChanged otherwise. */
    status?: "serviceEnabled" | "serviceDisabled" | "connectionStateChanged";
    wakeOnWlan?: string;
    networkInfo?: {
        ssid: string;
        connectState: WifiConnectState;
        signalBars: number;
        signalLevel: number;
        profileId?: number;
        ipInfo?: WifiIpInfo;
    };
}

export interface WifiConnectParams {
    ssid?: string;
    profileId?: number;
    wasCreatedWithJoinOther?: boolean;
    security?: {
        securityType: WifiSecurityType;
        simpleSecurity: { passKey: string };
    };
}

export interface WifiProfile {
    wifiProfile: { profileId: number; ssid: string; security?: { securityType: WifiSecurityType } };
}

// ---- com.webos.service.connectionmanager -------------------------------------------

export interface ConnectionState {
    state: "connected" | "disconnected";
    interfaceName?: string;
    ipAddress?: string;
    netmask?: string;
    gateway?: string;
    method?: string;
    ssid?: string;
    onInternet?: "yes" | "no";
}

export interface ConnectionStatus {
    isInternetConnectionAvailable: boolean;
    /** "enabled" = airplane mode. */
    offlineMode: "enabled" | "disabled";
    wired: ConnectionState;
    wifi: ConnectionState;
    wifiDirect?: { state: "connected" | "disconnected" };
}

// ---- com.webos.service.bluetooth2 --------------------------------------------------

export interface BluetoothAdapter {
    adapterAddress: string;
    name: string;
    powered: boolean;
    discovering: boolean;
    interfaceName?: string;
    discoverable?: boolean;
    pairable?: boolean;
}

export interface BluetoothDevice {
    name: string;
    address: string;
    typeOfDevice: "bredr" | "ble" | "dual" | string;
    classOfDevice: number;
    paired: boolean;
    pairing?: boolean;
    trusted?: boolean;
    blocked?: boolean;
    rssi?: number;
    connectedProfiles?: string[];
    adapterAddress?: string;
}

// ---- com.webos.settingsservice ------------------------------------------------------

export interface LocaleInfo {
    locales: { UI?: string; FMT?: string; TV?: string; [k: string]: string | undefined };
    clock?: "locale" | "12" | "24";
    [key: string]: unknown;
}

export interface SystemSettings {
    localeInfo?: LocaleInfo;
    /** Category "picture": display backlight, 0..100. */
    backlight?: number;
    [key: string]: unknown;
}

// ---- com.webos.service.systemservice ------------------------------------------------

export interface TimeZone {
    ZoneID: string;
    City?: string;
    Country?: string;
    CountryCode?: string;
    Description?: string;
    /** Minutes east of UTC. */
    offsetFromUTC?: number;
    supportsDST?: number;
}

/** Keys the Settings app reads and writes with get/setPreferences. */
export interface SystemPreferences {
    timeFormat?: "HH12" | "HH24";
    useNetworkTime?: boolean;
    timeZone?: TimeZone;
    wallpaper?: { wallpaperName: string; wallpaperFile: string };
    ringtone?: { name: string; fullPath: string };
    /** The tones popup alerts and notifications fall back on (LunaSysMgr Preferences). */
    alerttone?: { name: string; fullPath: string };
    notificationtone?: { name: string; fullPath: string };
    /** "System Sounds": the feedback sounds (keyboard clicks, closing a card). */
    systemSounds?: boolean;
    /** The virtual keyboard's preferences, a JSON string (see keyboardPrefs). */
    x_palm_virtualkeyboard_prefs?: string;
    rotationLock?: boolean;
    showAlertsWhenLocked?: boolean;
    /** Phoenix: seconds until the screen turns off. */
    screenTimeout?: number;
    /** Phoenix: seconds locked before the PIN or password is asked for (0: always). */
    lockTimeout?: number;
    /** Screen & Lock > Advanced gestures: a long swipe across the gesture area switches apps. */
    sysUiEnableNextPrevGestures?: boolean;
    /** Phoenix: the shell's hardware keyboard shortcuts, iPad-style or desktop-style. */
    keyboardShortcuts?: "ipad" | "desktop";
    /** Text Assist's checks and the user's shortcuts (see TextInputPrefs). */
    x_palm_textinput?: TextInputPrefs;
    /** Dock mode's own wallpaper (luna-sysmgr Preferences "dockwallpaper"). */
    dockwallpaper?: { wallpaperName: string; wallpaperFile: string };
    /** Sounds in dock mode: "systemsettings" (as Sounds & Ringtones) or, Phoenix, "mute". */
    dockModeSoundPref?: "systemsettings" | "mute";
    /** Phoenix: Settings > Exhibition. */
    exhibition?: ExhibitionPrefs;
    // Settings > Advanced (the community's Tweaks; docs/M6-PLAN.md F4).
    // LunaCE's own keys where it had the option:
    /** Card view wraps from the last card to the first (LunaCE abh_features.json). */
    infiniteCardCyclingEnabled?: boolean;
    /** A tap on a side card in card view maximizes it (LunaCE maximize-edges.json). */
    sysUiEnableMaximizeEdges?: boolean;
    /** An upward slide from the side of the gesture area opens the wave launcher (LunaCE wave-launcher.json). */
    sysUiEnableWaveLauncher?: boolean;
    /** The tap ripple (LunaCE tap-ripple.json; on by default). */
    showReticleAnimation?: boolean;
    /** Phoenix: the shell's animations. */
    animationSpeed?: "normal" | "fast";
    /** Phoenix: how far a swipe goes before it counts. */
    gestureSensitivity?: "low" | "normal" | "high";
    /** Phoenix: a vibration on every tap. */
    hapticFeedback?: boolean;
    /** Phoenix: the launcher's icon grid. */
    launcherGridDensity?: "normal" | "dense";
    /** Phoenix: the battery's percentage beside its icon in the status bar. */
    showBatteryPercent?: boolean;
    /** Phoenix: a row of numbers above the keyboard's letters. */
    keyboardNumberRow?: boolean;
    [key: string]: unknown;
}

/** One of the user's Text Assist shortcuts: typed `shortcut`, the space bar puts in `text`. */
export interface TextAssistShortcut {
    shortcut: string;
    text: string;
}

/**
 * x_palm_textinput (LunaSysMgr conf/defaultPreferences.txt): "autoCorrect" or
 * "off" for each check. Phoenix keeps the user's shortcuts in it too.
 */
export interface TextInputPrefs {
    spellChecking?: "autoCorrect" | "off";
    grammarChecking?: "autoCorrect" | "off";
    shortcutChecking?: "autoCorrect" | "off";
    shortcuts?: TextAssistShortcut[];
}

/** Settings > Exhibition (Phoenix): when dock mode starts and its night mode. */
export interface ExhibitionPrefs {
    /** Exhibitions on the Touchstone at all. */
    enabled: boolean;
    /** Seconds on the Touchstone with the screen on before one starts; 0: when the screen would turn off. */
    startAfter: number;
    /** The night brightness from nightStart to nightEnd ("HH:MM"). */
    nightMode: boolean;
    nightStart: string;
    nightEnd: string;
}

/** listDockModeLaunchPoints: an app that can be an exhibition (appinfo.json exhibitionMode). */
export interface DockModeLaunchPoint {
    id: string;
    appId: string;
    launchPointId: string;
    title: string;
    icon: string;
    /** Its row in dock mode's menu (exhibitionModeOptions.title). */
    exhibitionModeTitle: string;
    /** Turned on: in dock mode's menu. */
    enabled: boolean;
}

/** ringtone/listRingtones: one ringtone; system ones cannot be deleted. */
export interface Ringtone {
    name: string;
    fullPath: string;
    system?: boolean;
}

/** x_palm_virtualkeyboard_prefs, parsed (LunaSysMgr VirtualKeyboardPreferences.cpp). */
export interface VirtualKeyboardPrefs {
    keyboards?: { layout: string; language: string }[];
    TapSounds?: boolean;
    spaces2period?: boolean;
    /** Phoenix, Settings > Text Assist (missing means on). */
    WordSuggestions?: boolean;
    AutoCorrect?: boolean;
    SwipeTyping?: boolean;
    /** When the user asked for the learned words to be forgotten (ms). */
    ForgetWords?: number;
}

export interface SystemTime {
    utc: number;
    localtime: { year: number; month: number; day: number; hour: number; minute: number; second: number };
    offset?: number;
    timezone?: string;
    TZ?: string;
}

/** deviceInfo/query keys (DeviceInfoService.cpp). Values are strings. */
export interface DeviceInfo {
    device_name?: string;
    board_type?: string;
    hardware_id?: string;
    hardware_revision?: string;
    product_id?: string;
    serial_number?: string;
    ram_size?: string;
    storage_size?: string;
    storage_free?: string;
    wifi_addr?: string;
    bt_addr?: string;
    modem_present?: string;
    /** Legacy PalmSystem.deviceInfo fields (simulator). */
    modelName?: string;
    [key: string]: unknown;
}

/** osInfo/query keys (OsInfoService.cpp). */
export interface OsInfo {
    webos_name?: string;
    webos_release?: string;
    webos_build_id?: string;
    webos_imagename?: string;
    core_os_name?: string;
    core_os_release?: string;
    core_os_kernel_version?: string;
    [key: string]: unknown;
}

// ---- com.webos.service.audio ------------------------------------------------------

/** Input streams (audiod-pro files/config/audiod_sink_volume_policy_config.json). */
export type AudioStream = "pringtones" | "palerts" | "pmedia" | "pfeedback" | "pdefaultapp" | string;

export interface VolumeStatus {
    volumeStatus: { muted: boolean; volume: number; soundOutput: string; sessionId: number };
}

// ---- com.palm.systemmanager (legacy webOS 2.x; no OSE equivalent yet) ---------------

export type LockMode = "none" | "pin" | "password";

/** getSystemStatus (SystemService.cpp:3860-3970); gestureArea is Phoenix's. */
export interface SystemStatus {
    ime?: { visible: boolean };
    orientation?: { ui: string; device: string };
    /** The device has a gesture area (the strip below the screen). */
    gestureArea?: boolean;
}

// ---- The map -----------------------------------------------------------------------

const WIFI = "luna://com.webos.service.wifi";
const CM = "luna://com.webos.service.connectionmanager";
const BT = "luna://com.webos.service.bluetooth2";
const SETTINGS = "luna://com.webos.settingsservice";
const SYS = "luna://com.webos.service.systemservice";
const AUDIO = "luna://com.webos.service.audio";
const SYSMGR = "luna://com.palm.systemmanager";
export const Services = { WIFI, CM, BT, SETTINGS, SYS, AUDIO, SYSMGR } as const;

export interface LunaApi {
    // wifi
    "luna://com.webos.service.wifi/setstate": { params: { state: "enabled" | "disabled" }; result: Empty };
    "luna://com.webos.service.wifi/getstatus": { params: Sub; result: WifiStatus };
    "luna://com.webos.service.wifi/findnetworks": { params: Sub & { interval?: number }; result: { foundNetworks: { networkInfo: WifiNetworkInfo }[] } };
    "luna://com.webos.service.wifi/connect": { params: WifiConnectParams; result: Empty };
    "luna://com.webos.service.wifi/getprofilelist": { params: Empty; result: { profileList: WifiProfile[] } };
    "luna://com.webos.service.wifi/deleteprofile": { params: { profileId: number }; result: Empty };
    // connection manager
    "luna://com.webos.service.connectionmanager/getstatus": { params: Sub; result: ConnectionStatus };
    "luna://com.webos.service.connectionmanager/setstate": {
        params: { wifi?: "enabled" | "disabled"; wired?: "enabled" | "disabled"; offlineMode?: "enabled" | "disabled" };
        result: Empty;
    };
    // bluetooth
    "luna://com.webos.service.bluetooth2/adapter/getStatus": { params: Sub; result: { adapters: BluetoothAdapter[] } };
    "luna://com.webos.service.bluetooth2/adapter/setState": { params: { powered?: boolean; name?: string; discoverable?: boolean; adapterAddress?: string }; result: { adapterAddress: string } };
    "luna://com.webos.service.bluetooth2/adapter/startDiscovery": { params: { adapterAddress?: string }; result: { adapterAddress: string } };
    "luna://com.webos.service.bluetooth2/adapter/cancelDiscovery": { params: { adapterAddress?: string }; result: { adapterAddress: string } };
    "luna://com.webos.service.bluetooth2/adapter/pair": { params: Sub & { address: string; adapterAddress?: string }; result: { adapterAddress: string } };
    "luna://com.webos.service.bluetooth2/adapter/unpair": { params: { address: string; adapterAddress?: string }; result: { adapterAddress: string } };
    "luna://com.webos.service.bluetooth2/device/getStatus": { params: Sub & { adapterAddress?: string }; result: { adapterAddress: string; devices: BluetoothDevice[] } };
    // settings service
    "luna://com.webos.settingsservice/getSystemSettings": { params: Sub & { category?: string; keys?: string[] }; result: { settings: SystemSettings; category?: string } };
    "luna://com.webos.settingsservice/setSystemSettings": { params: { category?: string; settings: SystemSettings }; result: Empty };
    "luna://com.webos.settingsservice/resetSystemSettings": { params: { category?: string; keys?: string[] }; result: Empty };
    // system service
    "luna://com.webos.service.systemservice/getPreferences": { params: Sub & { keys: (keyof SystemPreferences)[] }; result: SystemPreferences };
    "luna://com.webos.service.systemservice/setPreferences": { params: SystemPreferences; result: Empty };
    "luna://com.webos.service.systemservice/getPreferenceValues": { params: { key: "timeZone" }; result: { timeZone: TimeZone[] } };
    "luna://com.webos.service.systemservice/time/getSystemTime": { params: Sub; result: SystemTime };
    "luna://com.webos.service.systemservice/time/setSystemTime": { params: { utc: number }; result: Empty };
    "luna://com.webos.service.systemservice/deviceInfo/query": { params: { parameters?: string[] }; result: DeviceInfo };
    "luna://com.webos.service.systemservice/osInfo/query": { params: { parameters?: string[] }; result: OsInfo };
    "luna://com.webos.service.systemservice/ringtone/listRingtones": { params: Empty; result: { ringtones: Ringtone[] } };
    // audio
    "luna://com.webos.service.audio/master/getVolume": { params: Sub & { soundOutput?: string }; result: VolumeStatus };
    "luna://com.webos.service.audio/master/setVolume": { params: { soundOutput: string; volume: number; sessionId?: number }; result: Empty };
    "luna://com.webos.service.audio/master/muteVolume": { params: { soundOutput: string; mute: boolean; sessionId?: number }; result: Empty };
    "luna://com.webos.service.audio/getInputVolume": { params: Sub & { streamType: AudioStream }; result: { streamType: string; volume: number } };
    "luna://com.webos.service.audio/setInputVolume": { params: { streamType: AudioStream; volume: number; ramp?: boolean }; result: { streamType: string; volume: number } };
    "luna://com.webos.service.audio/playFeedback": { params: { name: string; sink?: string; play?: boolean }; result: Empty };
    "luna://com.webos.service.audio/playSound": {
        params: { fileName: string; sink: AudioStream; loop?: boolean; duration?: number; volume?: number; fallback?: string };
        result: { playbackId: string };
    };
    "luna://com.webos.service.audio/controlPlayback": { params: { playbackId: string; requestType: "stop" | "pause" | "play" }; result: { playbackId: string } };
    // device lock (legacy)
    "luna://com.palm.systemmanager/getDeviceLockMode": { params: Empty; result: { lockMode: LockMode } };
    "luna://com.palm.systemmanager/getLockStatus": { params: Sub; result: { locked: boolean } };
    "luna://com.palm.systemmanager/getSystemStatus": { params: Sub; result: SystemStatus };
    "luna://com.palm.systemmanager/setDevicePasscode": { params: { lockMode: LockMode; passCode?: string; oldPasscode?: string }; result: Empty };
    "luna://com.palm.systemmanager/matchDevicePasscode": { params: { passCode: string }; result: { succeeded: boolean } };
    // Developer Mode (OSE)
    "luna://com.webos.service.devmode/getDevMode": { params: Sub; result: { status: "enabled" | "disabled" } };
    "luna://com.webos.service.devmode/setDevMode": { params: { status: "enabled" | "disabled" }; result: { status: "enabled" | "disabled" } };
}
