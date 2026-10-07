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
import { JustTypePage } from "./JustType";
import { CertificatesPage } from "./Certificates";
import { PhonePrefsPage } from "./PhonePrefs";
import { DevModePage } from "./DevMode";
import { ExhibitionPage } from "./Exhibition";
import { ClipboardPage } from "./Clipboard";
import { AssistantPage } from "./Assistant";
import { AdvancedPage } from "./Advanced";
import { DropSharePage } from "./DropShare";
import { GameControllersPage } from "./GameControllers";
import { UsbPage } from "./Usb";
import { HotspotPage } from "./Hotspot";
import { BatteryPage } from "./Battery";

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
    phone: { title: "Phone Preferences", icon: "icons/phoneprefs.png", component: PhonePrefsPage },
    dropshare: { title: "DropShare", icon: "icons/dropshare.png", component: DropSharePage },
    hotspot: { title: "Hotspot & Tethering", icon: "icons/hotspot.png", component: HotspotPage },
    vpn: { title: "VPN", icon: "icons/vpn.png", component: VpnPage },
    screen: { title: "Screen & Lock", icon: "icons/screen.png", component: ScreenPage },
    battery: { title: "Battery", icon: "icons/battery.png", component: BatteryPage },
    exhibition: { title: "Exhibition", icon: "icons/exhibition.png", component: ExhibitionPage },
    sounds: { title: "Sounds & Ringtones", icon: "icons/sounds.png", component: SoundsPage },
    datetime: { title: "Date & Time", icon: "icons/datetime.png", component: DateTimePage },
    language: { title: "Language & Region", icon: "icons/language.png", component: LanguagePage },
    textassist: { title: "Text Assist", icon: "icons/textassist.png", component: TextAssistPage },
    justtype: { title: "Just Type", icon: "icons/justtype.png", component: JustTypePage },
    clipboard: { title: "Clipboard", icon: "icons/clipboard.png", component: ClipboardPage },
    assistant: { title: "Assistant", icon: "icons/assistant.png", component: AssistantPage },
    usb: { title: "USB", icon: "icons/usb.png", component: UsbPage },
    gamepads: { title: "Game Controllers", icon: "icons/gamepads.png", component: GameControllersPage },
    location: { title: "Location Services", icon: "icons/location.png", component: LocationPage },
    emergency: { title: "Emergency Info", icon: "icons/emergency.png", component: EmergencyPage },
    accessibility: { title: "Accessibility", icon: "icons/accessibility.png", component: AccessibilityPage },
    deviceinfo: { title: "Device Info", icon: "icons/deviceinfo.png", component: DeviceInfoPage },
    backup: { title: "Backup", icon: "icons/backup.png", component: BackupPage },
    updates: { title: "Updates", icon: "icons/updates.png", component: UpdatesPage },
    certificates: { title: "Certificate Manager", icon: "icons/certificates.png", component: CertificatesPage },
    devmode: { title: "Developer Mode", icon: "icons/devmode.png", component: DevModePage },
    advanced: { title: "Advanced", icon: "icons/advanced.png", component: AdvancedPage },
} satisfies Record<string, PageInfo>;

export type PageId = keyof typeof PAGES;
