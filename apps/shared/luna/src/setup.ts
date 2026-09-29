// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Device setup preferences, kept by the system service
// (com.webos.service.systemservice get/setPreferences; luna-sysservice's
// PrefsFactory stores any key) so the shell, Settings, Phone and First Use
// all see them:
//
//   firstUseComplete  First Use has run or was skipped; until then the shell
//                     starts in First Use (as LunaSysMgr ran com.palm.app.firstuse
//                     in its minimal UI until /var/luna/preferences/ran-first-use existed)
//   emergencyInfo     the medical ID (Settings > Emergency Info), shown from the
//                     lock screen's emergency window when showWhenLocked is on
//   accessibility     Settings > Accessibility
//
// And the emergency numbers Phone's restricted (lock screen) mode may dial.

import { call, subscribe, type LunaError, type Subscription } from "./bridge";

type OnError = (e: LunaError) => void;

export interface EmergencyContact {
    /** com.palm.person:1 _id, when picked from Contacts. */
    personId?: string;
    name: string;
    number: string;
    /** "Spouse", "Parent", ... */
    relation?: string;
}

export interface EmergencyInfo {
    name?: string;
    /** YYYY-MM-DD */
    birthDate?: string;
    bloodType?: string;
    conditions?: string;
    allergies?: string;
    medications?: string;
    notes?: string;
    organDonor?: boolean;
    contacts?: EmergencyContact[];
    /** Show it from the lock screen's Emergency window (default true). */
    showWhenLocked?: boolean;
}

export interface AccessibilityPrefs {
    /** No card and launcher animations: things appear and go at once. */
    reduceMotion?: boolean;
    /** Stronger text and outline colors in the apps. */
    highContrast?: boolean;
    /** Both ears get the same sound. */
    monoAudio?: boolean;
    /** Show captions where videos have them. */
    captions?: boolean;
}

export const BLOOD_TYPES = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"] as const;

const PREFS = "luna://com.webos.service.systemservice/";

function watchPref<T>(key: string, cb: (v: T) => void, onError?: OnError): Subscription {
    return subscribe(PREFS + "getPreferences", { keys: [key] }, (r) => {
        if (key in r) cb((r as Record<string, unknown>)[key] as T);
    }, onError);
}

async function getPref<T>(key: string): Promise<T | undefined> {
    const r = await call(PREFS + "getPreferences", { keys: [key] });
    return (r as Record<string, unknown>)[key] as T | undefined;
}

/** Is there anything worth showing? */
export function hasEmergencyInfo(info: EmergencyInfo | null | undefined): boolean {
    if (!info) return false;
    return !!(info.name || info.birthDate || info.bloodType || info.conditions || info.allergies
        || info.medications || info.notes || info.organDonor || (info.contacts && info.contacts.length));
}

export const emergencyInfo = {
    watch(cb: (info: EmergencyInfo) => void, onError?: OnError): Subscription {
        return watchPref<EmergencyInfo>("emergencyInfo", (v) => cb(v ?? {}), onError);
    },
    async get(): Promise<EmergencyInfo> {
        return (await getPref<EmergencyInfo>("emergencyInfo")) ?? {};
    },
    set(info: EmergencyInfo) {
        return call(PREFS + "setPreferences", { emergencyInfo: info });
    },
};

export const firstUse = {
    async isComplete(): Promise<boolean> {
        return !!(await getPref<boolean>("firstUseComplete"));
    },
    watch(cb: (complete: boolean) => void, onError?: OnError): Subscription {
        return watchPref<boolean>("firstUseComplete", (v) => cb(!!v), onError);
    },
    /** First Use is done (or skipped): the shell starts normally from now on. */
    complete() {
        return call(PREFS + "setPreferences", { firstUseComplete: true });
    },
    /** com.palm.systemmanager getBootStatus: is the shell running First Use now? */
    async running(): Promise<boolean> {
        try {
            return !!(await call("luna://com.palm.systemmanager/getBootStatus", {}) as { firstUse?: boolean }).firstUse;
        } catch {
            return false;
        }
    },
};

export const accessibility = {
    watch(cb: (p: AccessibilityPrefs) => void, onError?: OnError): Subscription {
        return watchPref<AccessibilityPrefs>("accessibility", (v) => cb(v ?? {}), onError);
    },
    async set(changes: AccessibilityPrefs) {
        const cur = (await getPref<AccessibilityPrefs>("accessibility")) ?? {};
        return call(PREFS + "setPreferences", { accessibility: { ...cur, ...changes } });
    },
};

// ---- Emergency numbers -----------------------------------------------------------

/**
 * Numbers every GSM/UMTS/LTE phone treats as emergency numbers, SIM or not
 * (3GPP TS 22.101 section 10.1.1: 112 and 911 always; 000, 08, 110, 999,
 * 118 and 119 without a SIM).
 */
export const EMERGENCY_NUMBERS: readonly string[] = ["112", "911", "000", "08", "110", "118", "119", "999"];

/** National numbers on top of those, by ISO country code (lower case). */
export const NATIONAL_EMERGENCY_NUMBERS: Readonly<Record<string, readonly string[]>> = {
    nz: ["111"],
    in: ["100", "101", "102", "108"],
    fr: ["15", "17", "18", "115"],
    it: ["113", "115"],
    es: ["061", "062", "080", "091", "092"],
    br: ["190", "192", "193"],
    cn: ["120", "122"],
    kr: ["112", "119"],
    mx: ["065", "066"],
    za: ["10111", "10177"],
    ch: ["117", "144"],
    at: ["122", "133", "144"],
};

/** Can this number be called from the lock screen? */
export function isEmergencyNumber(number: string, countryCode = ""): boolean {
    const n = number.replace(/[^0-9]/g, "");
    if (!n || n !== number.replace(/[\s\-().]/g, "")) return false;
    return EMERGENCY_NUMBERS.includes(n) || (NATIONAL_EMERGENCY_NUMBERS[countryCode.toLowerCase()] ?? []).includes(n);
}

/** The number to offer first for a country ("911" in North America, else "112"). */
export function primaryEmergencyNumber(countryCode = ""): string {
    const c = countryCode.toLowerCase();
    if (["us", "ca", "mx", "pr"].includes(c)) return "911";
    if (["gb", "ie", "hk", "sg", "my"].includes(c)) return "999";
    if (c === "au") return "000";
    if (c === "nz") return "111";
    if (["jp", "tw"].includes(c)) return "110";
    return "112";
}
