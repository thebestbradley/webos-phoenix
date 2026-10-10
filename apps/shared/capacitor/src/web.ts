// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The plugin's web implementation: Phoenix apps are web apps (Capacitor's
// "web" platform), so this is the only one; it calls @phoenix/sdk, which
// degrades the same way without Phoenix (PhoenixErrors with code
// "unavailable").

import { WebPlugin } from "@capacitor/core";
import {
    accounts, activities, app, appMenu, calendar, capabilities, clipboard, contacts, email, has, location, messaging, notifications,
    ongoing, pickers, request, share, type Capability, type LunaReply,
} from "@phoenix/sdk";
import type { PhoenixInfo, PhoenixPlugin } from "./definitions";

export class PhoenixWeb extends WebPlugin {
    private offs: (() => void)[] = [];

    constructor() {
        super();
        // The system's events become the plugin's (only delivered while
        // someone listens; a share at launch waits for the first listener).
        this.offs.push(appMenu.onToggle(() => this.notifyListeners("appMenu", {})));
        this.offs.push(app.onRelaunch((p) => this.notifyListeners("relaunch", p)));
        this.offs.push(share.onReceive((s) => this.notifyListeners("share", s, true)));
        this.offs.push(app.onActiveChange((active) => this.notifyListeners("activeChange", { active })));
        this.offs.push(app.onBack(() => {
            if (!this.hasListeners("backButton")) return false;
            this.notifyListeners("backButton", {});
            return true;
        }));
    }

    async getInfo(): Promise<PhoenixInfo> {
        return { appId: app.id, onPhoenix: app.onPhoenix, capabilities: capabilities(), launchParams: app.launchParams(), locale: app.locale };
    }
    async has(o: { capability: Capability }) { return { value: has(o.capability) }; }

    async stageReady() { app.stageReady(); }
    async keepAlive(o: { enabled: boolean }) { app.keepAlive(o.enabled); }
    async setOrientation(o: Parameters<PhoenixPlugin["setOrientation"]>[0]) { app.setOrientation(o.orientation); }
    async setFullScreen(o: { enabled: boolean }) { app.setFullScreen(o.enabled); }
    async keepScreenOn(o: { enabled: boolean }) { app.keepScreenOn(o.enabled); }
    async launch(o: { appId: string; params?: Record<string, unknown> }) { await app.launch(o.appId, o.params ?? {}); }
    async open(o: { target: string }) { await app.open(o.target); }

    share(o: Parameters<PhoenixPlugin["share"]>[0]) { return share.open(o); }
    async pickFiles(o: Parameters<PhoenixPlugin["pickFiles"]>[0] = {}) {
        const files = await pickers.open(o);
        return { files: files ?? [], canceled: files === null };
    }
    async saveFile(o: Parameters<PhoenixPlugin["saveFile"]>[0]) {
        const path = await pickers.save(o);
        return path === null ? { canceled: true } : { path, canceled: false };
    }

    async showBanner(o: Parameters<PhoenixPlugin["showBanner"]>[0]) {
        const { message, ...rest } = o;
        return { id: await notifications.banner(message, rest) };
    }
    async postNotification(o: Parameters<PhoenixPlugin["postNotification"]>[0]) { await notifications.post(o); }
    async removeNotification(o: { tag: string }) { notifications.remove(o.tag); }
    async setOngoing(o: Parameters<PhoenixPlugin["setOngoing"]>[0]) { await ongoing.set(o); }
    async clearOngoing(o: { id: string }) { await ongoing.clear(o.id); }
    async scheduleActivity(o: Parameters<PhoenixPlugin["scheduleActivity"]>[0]) { await activities.schedule(o); }
    async cancelActivity(o: { name: string }) { await activities.cancel(o.name); }

    async listContacts(o: { search?: string } = {}) {
        return { contacts: o.search ? await contacts.search(o.search) : await contacts.list() };
    }
    async calendarEvents(o: { from: number; to: number }) { return { events: await calendar.events(o) }; }
    async listAccounts(o: { capability?: string } = {}) { return { accounts: await accounts.list(o.capability) }; }
    async composeEmail(o: Parameters<PhoenixPlugin["composeEmail"]>[0]) { await email.compose(o); }
    async composeMessage(o: Parameters<PhoenixPlugin["composeMessage"]>[0]) { await messaging.compose(o); }

    getCurrentPosition() { return location.current(); }
    async copyText(o: { text: string; sensitive?: boolean }) { await clipboard.copy(o.text, { sensitive: o.sensitive }); }

    request(o: { uri: string; params?: Record<string, unknown> }): Promise<LunaReply> { return request(o.uri, o.params ?? {}); }

    /** Stop listening to the system (tests). */
    dispose(): void {
        for (const off of this.offs.splice(0)) off();
    }
}
