// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The Phoenix plugin's interface, in Capacitor's style: each method takes
// one options object and resolves with an object; events come through
// addListener. The calls are @phoenix/sdk's (docs/APP-SDK.md).

import type { PluginListenerHandle } from "@capacitor/core";
import type {
    Account, BannerOptions, Capability, CalendarEvent, EmailDraft, LocationFix, LunaReply, MessageDraft, NotificationOptions,
    OngoingActivity, Orientation, PersonSummary, PickedFile, PickOptions, SaveOptions, ScheduleOptions, ShareContent, ShareResult,
} from "@phoenix/sdk";

export interface PhoenixInfo {
    appId: string;
    /** Running in Phoenix's runtime. */
    onPhoenix: boolean;
    /** Every capability and whether it is here (has()). */
    capabilities: Record<Capability, boolean>;
    launchParams: Record<string, unknown>;
    locale: string;
}

export interface PhoenixPlugin {
    getInfo(): Promise<PhoenixInfo>;
    has(options: { capability: Capability }): Promise<{ value: boolean }>;

    // Lifecycle and window
    stageReady(): Promise<void>;
    keepAlive(options: { enabled: boolean }): Promise<void>;
    setOrientation(options: { orientation: Orientation }): Promise<void>;
    setFullScreen(options: { enabled: boolean }): Promise<void>;
    keepScreenOn(options: { enabled: boolean }): Promise<void>;
    launch(options: { appId: string; params?: Record<string, unknown> }): Promise<void>;
    open(options: { target: string }): Promise<void>;

    // Share and pickers
    share(options: ShareContent): Promise<ShareResult>;
    pickFiles(options?: PickOptions): Promise<{ files: PickedFile[]; canceled: boolean }>;
    saveFile(options: SaveOptions): Promise<{ path?: string; canceled: boolean }>;

    // Telling the user
    showBanner(options: { message: string } & BannerOptions): Promise<{ id: string }>;
    postNotification(options: NotificationOptions): Promise<void>;
    removeNotification(options: { tag: string }): Promise<void>;
    setOngoing(options: OngoingActivity): Promise<void>;
    clearOngoing(options: { id: string }): Promise<void>;
    scheduleActivity(options: ScheduleOptions): Promise<void>;
    cancelActivity(options: { name: string }): Promise<void>;

    // Synergy
    listContacts(options?: { search?: string }): Promise<{ contacts: PersonSummary[] }>;
    calendarEvents(options: { from: number; to: number }): Promise<{ events: CalendarEvent[] }>;
    listAccounts(options?: { capability?: string }): Promise<{ accounts: Account[] }>;
    composeEmail(options: EmailDraft): Promise<void>;
    composeMessage(options: MessageDraft): Promise<void>;

    // Device
    getCurrentPosition(): Promise<LocationFix>;
    copyText(options: { text: string; sensitive?: boolean }): Promise<void>;

    /** Any Luna method (the escape hatch): one request, one reply. */
    request(options: { uri: string; params?: Record<string, unknown> }): Promise<LunaReply>;

    /**
     * - `appMenu`: the user tapped the app's name in the status bar (draw your menu).
     * - `relaunch`: the app was opened again with these params.
     * - `share`: content shared to the app (its appinfo.json shareTargets), at launch and after.
     * - `backButton`: the back gesture. While a listener is added the app takes
     *   every back (Capacitor's App plugin's rule); the bindings' onBack /
     *   useBack decide case by case instead.
     * - `activeChange`: the card came to the front or left it.
     */
    addListener(eventName: "appMenu" | "backButton", listener: () => void): Promise<PluginListenerHandle>;
    addListener(eventName: "relaunch", listener: (params: Record<string, unknown>) => void): Promise<PluginListenerHandle>;
    addListener(eventName: "share", listener: (content: ShareContent) => void): Promise<PluginListenerHandle>;
    addListener(eventName: "activeChange", listener: (event: { active: boolean }) => void): Promise<PluginListenerHandle>;
    removeAllListeners(): Promise<void>;
}
