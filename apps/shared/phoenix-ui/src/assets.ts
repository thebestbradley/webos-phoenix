// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// URLs of Palm artwork apps use directly (bundled by Vite).

import wifiNone from "../assets/enyo/wifi/wifi-icon-none.png";
import wifiLow from "../assets/enyo/wifi/wifi-icon-low.png";
import wifiAverage from "../assets/enyo/wifi/wifi-icon-average.png";
import wifiExcellent from "../assets/enyo/wifi/wifi-icon-excellent.png";
import secure from "../assets/enyo/wifi/secure-icon.png";
import joinPlus from "../assets/enyo/wifi/join-plus-icon.png";
import checkmark from "../assets/enyo/checkmark.png";
import fullscreenPlay from "../assets/openwebos/fullscreen-play-button.png";

export const icons = {
    /** Wi-Fi signal strength, index 0..3 (lib/wifi/images). */
    wifiSignal: [wifiNone, wifiLow, wifiAverage, wifiExcellent] as const,
    secure,
    joinPlus,
    checkmark,
    /** Round play button over a video (luna-sysmgr fullscreen-play-button.png: 100x100, pressed below). */
    fullscreenPlay,
};
