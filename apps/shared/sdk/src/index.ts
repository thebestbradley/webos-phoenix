// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// @phoenix/sdk: the Phoenix service plugin's public API, the same for
// every framework (docs/APP-SDK.md). Each call is typed and returns a
// promise; subscriptions are Watches (a callback, or `for await`); failures
// are PhoenixErrors with the service's errorCode and errorText. has()
// says what this device offers, so one app runs on Phoenix, on plain
// webOS OSE and in a browser.
//
//     import { app, share, has } from "@phoenix/sdk";
//     app.onBack(() => closePane());
//     if (has("share")) await share.open({ text: "Hello" });

/** The SDK's version (semver); the API follows it. */
export const VERSION = "0.1.0";

export {
    PhoenixError, request, subscribeTo, setTransport, transport, palmTransport, noTransport, toPhoenixError,
} from "./core";
export type { LunaReply, Transport, PhoenixErrorCode, RequestOptions, Watch, OnValue, OnError } from "./core";
export { has, capabilities, available, setCapabilities } from "./capabilities";
export type { Capability } from "./capabilities";
export { app, appInfo } from "./app";
export type { Orientation, DeviceInfo } from "./app";
export { appMenu } from "./menu";
export type { MenuItem, EditAction, EditState, AppMenuOptions, AppMenuHandle } from "./menu";
export { share, pickers } from "./share";
export type { ShareContent, SharedFile, ShareResult, ShareTarget, PickKind, PickOptions, PickedFile, SaveOptions } from "./share";
export { notifications, ongoing, activities } from "./notifications";
export type { BannerOptions, NotificationOptions, NotificationAction, DashboardOptions, OngoingActivity, ScheduleOptions } from "./notifications";
export { justType, assistant } from "./commands";
export type { AssistantCommand } from "./commands";
export { contacts, calendar, accounts, email, messaging } from "./people";
export type { Person, PersonSummary, CalendarInfo, CalendarEvent, NewEvent, Account, AccountCapability, EmailDraft, MessageDraft } from "./people";
export { files, media, playback, location, device, clipboard, print } from "./system";
export type {
    FileEntry, ImageItem, AudioItem, VideoItem, NowPlaying, MediaKeyTarget, LocationFix, ReverseLocation, SystemPreferences,
    VibrationEffect, ClipboardHistory, HistoryQuery, Printer, PrintJob, DeviceDetails, PrintOptions,
} from "./system";
export { tokens, cssVariables, themeCss, applyTheme } from "./theme";
export type { PhoenixTokens } from "./theme";
