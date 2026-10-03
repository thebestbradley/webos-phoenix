// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// URLs of Palm artwork apps use directly (bundled by Vite), and their HiDPI
// variants (name@2x.png, name@3x.png beside each; tools/hidpi-art.py,
// docs/spec/hidpi-art.md). The shell zooms web views by its density, which
// Chromium reports as the device pixel ratio: give an <img> srcSet(url),
// a CSS background cssImage(url), and it draws the variant for it.

import wifiNone from "../assets/enyo/wifi/wifi-icon-none.png";
import wifiNone2 from "../assets/enyo/wifi/wifi-icon-none@2x.png";
import wifiNone3 from "../assets/enyo/wifi/wifi-icon-none@3x.png";
import wifiLow from "../assets/enyo/wifi/wifi-icon-low.png";
import wifiLow2 from "../assets/enyo/wifi/wifi-icon-low@2x.png";
import wifiLow3 from "../assets/enyo/wifi/wifi-icon-low@3x.png";
import wifiAverage from "../assets/enyo/wifi/wifi-icon-average.png";
import wifiAverage2 from "../assets/enyo/wifi/wifi-icon-average@2x.png";
import wifiAverage3 from "../assets/enyo/wifi/wifi-icon-average@3x.png";
import wifiExcellent from "../assets/enyo/wifi/wifi-icon-excellent.png";
import wifiExcellent2 from "../assets/enyo/wifi/wifi-icon-excellent@2x.png";
import wifiExcellent3 from "../assets/enyo/wifi/wifi-icon-excellent@3x.png";
import secure from "../assets/enyo/wifi/secure-icon.png";
import secure2 from "../assets/enyo/wifi/secure-icon@2x.png";
import secure3 from "../assets/enyo/wifi/secure-icon@3x.png";
import joinPlus from "../assets/enyo/wifi/join-plus-icon.png";
import joinPlus2 from "../assets/enyo/wifi/join-plus-icon@2x.png";
import joinPlus3 from "../assets/enyo/wifi/join-plus-icon@3x.png";
import checkmark from "../assets/enyo/checkmark.png";
import checkmark2 from "../assets/enyo/checkmark@2x.png";
import checkmark3 from "../assets/enyo/checkmark@3x.png";
import fullscreenPlay from "../assets/openwebos/fullscreen-play-button.png";
import fullscreenPlay2 from "../assets/openwebos/fullscreen-play-button@2x.png";
import fullscreenPlay3 from "../assets/openwebos/fullscreen-play-button@3x.png";

// 1x URL -> its [url, density] candidates, 1x first.
const variants = new Map<string, [string, number][]>();

/** Registers a picture's 2x and 3x files; returns the 1x URL. */
export function art(x1: string, x2: string, x3: string): string {
    variants.set(x1, [[x1, 1], [x2, 2], [x3, 3]]);
    return x1;
}

/** An <img> srcset for a picture from this kit (undefined for any other URL). */
export function srcSet(url: string): string | undefined {
    const v = variants.get(url);
    return v ? v.map(([u, k]) => `${u} ${k}x`).join(", ") : undefined;
}

/** A CSS image (background-image) for a picture, with its variants when it has them. */
export function cssImage(url: string): string {
    const v = variants.get(url);
    return v ? `-webkit-image-set(${v.map(([u, k]) => `url("${u}") ${k}x`).join(", ")})` : `url("${url}")`;
}

export const icons = {
    /** Wi-Fi signal strength, index 0..3 (lib/wifi/images). */
    wifiSignal: [
        art(wifiNone, wifiNone2, wifiNone3),
        art(wifiLow, wifiLow2, wifiLow3),
        art(wifiAverage, wifiAverage2, wifiAverage3),
        art(wifiExcellent, wifiExcellent2, wifiExcellent3),
    ] as const,
    secure: art(secure, secure2, secure3),
    joinPlus: art(joinPlus, joinPlus2, joinPlus3),
    checkmark: art(checkmark, checkmark2, checkmark3),
    /** Round play button over a video (luna-sysmgr fullscreen-play-button.png: 100x100, pressed below). */
    fullscreenPlay: art(fullscreenPlay, fullscreenPlay2, fullscreenPlay3),
};
