// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Telling the user: banners, notifications (a row in the notification area
// that a tap opens the app from, with buttons), dashboards, sounds, ongoing
// activities (rows with progress) and background activities that wake the
// app later.
//
//   Banner: PalmSystem.addBannerMessage(message, params, icon, soundClass,
//       soundFile, duration), as LunaSysMgr's BannerMessageHandler; on
//       plain OSE com.webos.notification/createToast (the Phoenix runtime
//       shows a toast as the app's banner too).
//   Notification: the Phoenix shell's "notification" message (phoenixHost,
//       SimWindowSource.qml): {appId, title, body, params, tag, actions,
//       soundClass}; {tag} replaces the app's row of that tag, {tag,
//       remove: true} takes it away; actions {uri, params, items: [{id,
//       label}]} are buttons, each calling the app's service uri with
//       {...params, action: id} (Notifications.qml runAction).
//   Dashboard: a window the app opens with window.open(url, name,
//       'attributes={"window":"dashboard", ...}') (Enyo's
//       enyo.windows.openDashboard), which LunaSysMgr put in the
//       notification area.
//   Ongoing: org.webosphoenix.ongoing/set and /clear (docs/APP-RUNTIME.md,
//       Ongoing activities).
//   Activities: com.palm.activitymanager/create with a schedule and a
//       callback that launches the app (Tasks' reminders: apps/shared/luna/
//       src/tasks.ts).

import { app } from "./app";
import { palmSystem, phoenixHost, request, warnOnce } from "./core";
import { activityDateString } from "../../luna/src/tasks";

export interface BannerOptions {
    /** Launch params the app gets when the banner is tapped. */
    params?: object;
    /** An icon, relative to the app or absolute. */
    icon?: string;
    /** "notifications", "alerts", "alarm", "ringtones", "none"... (the system picks the file). */
    soundClass?: string;
    soundFile?: string;
    /** ms the sound plays at most. */
    duration?: number;
}

export interface NotificationAction {
    id: string;
    label: string;
}

export interface NotificationOptions {
    title: string;
    body?: string;
    /** Launch params when the row is tapped. */
    params?: object;
    /** Replaces the app's earlier notification of this tag; remove(tag) takes it away. */
    tag?: string;
    /**
     * Buttons on the row. A tap calls `uri` (the app's own Luna service)
     * with {...params, action: id} without opening the app; the reply's
     * `text` is shown as a banner.
     */
    actions?: { uri: string; params?: object; items: NotificationAction[] };
    soundClass?: string;
    soundFile?: string;
}

export interface DashboardOptions {
    /** The window's name: opening the same name again reuses it. */
    name?: string;
    /** Height in px (default 52, one row). */
    height?: number;
    icon?: string;
    /** No swipe dismisses it (the app closes it). */
    persistent?: boolean;
    /** Taps work on the lock screen. */
    clickableWhenLocked?: boolean;
}

export interface OngoingActivity {
    /** The app's own id for it; set() again with the same id updates the row. */
    id: string;
    title: string;
    body?: string;
    icon?: string;
    /** 0-100, or -1 (the default): no progress bar. */
    progress?: number;
    /** Launch params when the row is tapped. */
    params?: object;
}

export interface ScheduleOptions {
    /** Unique per app; schedule() again with the name replaces it. */
    name: string;
    description?: string;
    /** When to run once... */
    at?: Date | number;
    /** ...or how often ("15m", "1h", "1d": the activity manager's interval). */
    every?: string;
    /** Launch params the app is launched with when it fires (the app's launch params, with $activity). */
    params?: object;
    /** Keep it across restarts (default yes). */
    persist?: boolean;
}

export const notifications = {
    /**
     * A banner across the bottom of the screen. Resolves with its id (for
     * removeBanner). Off webOS, the browser's Notification when it is
     * allowed, else the console.
     */
    async banner(message: string, opts: BannerOptions = {}): Promise<string> {
        const palm = palmSystem();
        if (palm?.addBannerMessage)
            return palm.addBannerMessage(message, JSON.stringify(opts.params ?? {}), opts.icon ?? "", opts.soundClass ?? "",
                                         opts.soundFile ?? "", opts.duration ?? 0) ?? "";
        try {
            const r = await request<{ toastId?: string }>("luna://com.webos.notification/createToast", {
                message, ...(opts.icon ? { iconUrl: opts.icon } : {}),
                onclick: { appId: app.id, params: opts.params ?? {} },
            });
            return r.toastId ?? "";
        } catch {
            if (typeof Notification !== "undefined" && Notification.permission === "granted") {
                new Notification(message);
                return "";
            }
            warnOnce("banner", "notifications.banner: no banners here (not webOS); messages go to the console.");
            // eslint-disable-next-line no-console
            console.info(`[banner] ${message}`);
            return "";
        }
    },

    /** Take a banner away (by the id banner() gave). */
    removeBanner(id: string): void {
        const palm = palmSystem();
        if (palm?.removeBannerMessage) palm.removeBannerMessage(id);
        else if (id) void request("luna://com.webos.notification/closeToast", { toastId: id }).catch(() => {});
    },

    /**
     * A notification: a row in the notification area (and its banner),
     * which opens the app with `params` when tapped. Without the Phoenix
     * shell, a banner.
     *
     *     notifications.post({ title: "Upload finished", body: "12 photos", params: { album: id }, tag: "upload" });
     */
    async post(n: NotificationOptions): Promise<void> {
        const host = phoenixHost();
        if (host) {
            host.postToHost("notification", { appId: app.id, title: n.title, body: n.body ?? "", params: n.params ?? {},
                                              ...(n.tag ? { tag: n.tag } : {}), ...(n.actions ? { actions: n.actions } : {}),
                                              ...(n.soundClass ? { soundClass: n.soundClass } : {}), ...(n.soundFile ? { soundFile: n.soundFile } : {}) });
            return;
        }
        await notifications.banner(n.body ? `${n.title}: ${n.body}` : n.title, { params: n.params, soundClass: n.soundClass, soundFile: n.soundFile });
    },

    /** Take away the app's notification of this tag (with prefix: every tag starting with it). */
    remove(tag: string, prefix = false): void {
        phoenixHost()?.postToHost("notification", { appId: app.id, remove: true, ...(prefix ? { tagPrefix: tag } : { tag }) });
    },

    /**
     * A dashboard: a small window of the app's own in the notification
     * area (a player's controls, a timer). Returns the window, or null off
     * webOS. Close it with its close().
     */
    dashboard(url: string, opts: DashboardOptions = {}): Window | null {
        if (typeof window === "undefined" || typeof window.open !== "function") return null;
        if (!palmSystem()) warnOnce("dashboard", "notifications.dashboard: not on webOS; the dashboard opens as a browser window.");
        const attributes: Record<string, unknown> = { window: "dashboard" };
        if (opts.icon) attributes.icon = opts.icon;
        if (opts.persistent) attributes.persistent = true;
        if (opts.clickableWhenLocked) attributes.clickableWhenLocked = true;
        return window.open(url, opts.name ?? "dashboard", `height=${opts.height ?? 52}, attributes=${JSON.stringify(attributes)}`);
    },

    /** A system sound without a banner (PalmSystem.playSoundNotification). */
    sound(soundClass: string, soundFile?: string, duration?: number): void {
        palmSystem()?.playSoundNotification?.(soundClass, soundFile ?? "", duration ?? 0);
    },
};

export const ongoing = {
    /** Show or update an ongoing activity's row (it stays until clear, or the app's last card closes). */
    async set(a: OngoingActivity): Promise<void> {
        await request("luna://org.webosphoenix.ongoing/set", { appId: app.id, progress: -1, ...a });
    },
    /** Take the row away. */
    async clear(id: string): Promise<void> {
        await request("luna://org.webosphoenix.ongoing/clear", { id });
    },
};

export const activities = {
    /**
     * Wake the app later, even when it is not running: the activity manager
     * launches it with `params` (and {$activity}) at `at`, or every `every`.
     */
    async schedule(o: ScheduleOptions): Promise<void> {
        const schedule = o.every ? { interval: o.every, ...(o.at !== undefined ? { start: activityDateString(+o.at) } : {}) }
            : o.at !== undefined ? { start: activityDateString(+o.at) } : null;
        if (!schedule) throw new Error("activities.schedule: give `at` or `every`");
        await request("luna://com.palm.activitymanager/create", {
            start: true,
            replace: true,
            activity: {
                name: o.name,
                description: o.description ?? o.name,
                type: { foreground: true, persist: o.persist !== false },
                schedule,
                callback: { method: "palm://com.palm.applicationManager/launch", params: { id: app.id, params: o.params ?? {} } },
            },
        });
    },
    /** Cancel a scheduled activity (fine when there is none). */
    async cancel(name: string): Promise<void> {
        await request("luna://com.palm.activitymanager/complete", { activityName: name }).catch(() => undefined);
    },
};
