// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The app's settings key and its look: Ionic's mode is kept as notes-core's
// `skin`, the colour scheme as an extra.

import { DEFAULT_SETTINGS, type Settings } from "@phoenix/notes-core";

export const APP_ID = "org.webosphoenix.ionicnotes";
export const SETTINGS_KEY = APP_ID + ":settings";

export type Mode = "ios" | "md";
export type Scheme = "system" | "light" | "dark";

export const DEFAULTS: Settings = { ...DEFAULT_SETTINGS, skin: "ios", extra: { scheme: "system" } };

export interface Style {
    mode: Mode;
    scheme: Scheme;
}

export function styleOf(s: Settings): Style {
    return {
        mode: s.skin === "md" ? "md" : "ios",
        scheme: s.extra.scheme === "light" || s.extra.scheme === "dark" ? s.extra.scheme : "system",
    };
}

/** The saved look, before React (and notes-core's hook) starts. */
export function readStyle(): Style {
    try {
        const raw = localStorage.getItem(SETTINGS_KEY);
        return styleOf(raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) } : DEFAULTS);
    } catch {
        return styleOf(DEFAULTS);
    }
}
