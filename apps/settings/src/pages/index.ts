// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0

import type { ComponentType } from "react";
import { WifiPage } from "./Wifi";
import { VpnPage } from "./Vpn";
import { BluetoothPage } from "./Bluetooth";
import { AirplanePage } from "./Airplane";
import { ScreenPage } from "./Screen";
import { SoundsPage } from "./Sounds";
import { DateTimePage } from "./DateTime";
import { LanguagePage } from "./Language";
import { DeviceInfoPage } from "./DeviceInfo";
import { UpdatesPage } from "./Updates";
import { BackupPage } from "./Backup";
import { LocationPage } from "./Location";
import { EmergencyPage } from "./Emergency";
import { AccessibilityPage } from "./Accessibility";
import { TextAssistPage } from "./TextAssist";

export interface PageInfo {
    title: string;
    /** Icon, relative to the app (public/icons). */
    icon: string;
    component: ComponentType;
}

// Keep ids, titles and icons in step with public/appinfo.json launchPoints.
export const PAGES = {
    wifi: { title: "Wi-Fi", icon: "icons/wifi.png", component: WifiPage },
    bluetooth: { title: "Bluetooth", icon: "icons/bluetooth.png", component: BluetoothPage },
    airplane: { title: "Airplane Mode", icon: "icons/airplane.png", component: AirplanePage },
    vpn: { title: "VPN", icon: "icons/vpn.png", component: VpnPage },
    screen: { title: "Screen & Lock", icon: "icons/screen.png", component: ScreenPage },
    sounds: { title: "Sounds & Ringtones", icon: "icons/sounds.png", component: SoundsPage },
    datetime: { title: "Date & Time", icon: "icons/datetime.png", component: DateTimePage },
    language: { title: "Language & Region", icon: "icons/language.png", component: LanguagePage },
    textassist: { title: "Text Assist", icon: "icons/textassist.png", component: TextAssistPage },
    location: { title: "Location Services", icon: "icons/location.png", component: LocationPage },
    emergency: { title: "Emergency Info", icon: "icons/emergency.png", component: EmergencyPage },
    accessibility: { title: "Accessibility", icon: "icons/accessibility.png", component: AccessibilityPage },
    deviceinfo: { title: "Device Info", icon: "icons/deviceinfo.png", component: DeviceInfoPage },
    backup: { title: "Backup", icon: "icons/backup.png", component: BackupPage },
    updates: { title: "Updates", icon: "icons/updates.png", component: UpdatesPage },
} satisfies Record<string, PageInfo>;

export type PageId = keyof typeof PAGES;
