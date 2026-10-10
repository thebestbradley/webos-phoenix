// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The SDK's APIs against a fake bus and a fake PalmSystem: what each sends
// to the system, and how it degrades without Phoenix.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    accounts, activities, app, appMenu, assistant, calendar, clipboard, contacts, cssVariables, email, justType, location,
    messaging, notifications, ongoing, pickers, share, themeCss, tokens, applyTheme,
} from "./index";
import { resetBackHandlers } from "./app";
import { resetWarnings } from "./core";
import { installFakeBus, type FakeBus } from "./testing";

type G = { PalmSystem?: unknown; __phoenixRuntime?: unknown; phoenixHost?: unknown };
const g = globalThis as G;

let bus: FakeBus;
let palm: Record<string, unknown>;

function relaunch(params: object) {
    palm.launchParams = JSON.stringify(params);
    document.dispatchEvent(new CustomEvent("webOSRelaunch", { detail: params }));
}

beforeEach(() => {
    bus = installFakeBus();
    palm = {
        appIdentifier: "com.example.app",
        launchParams: "{}",
        stageReady: vi.fn(),
        setWindowOrientation: vi.fn(),
        enableFullScreenMode: vi.fn(),
        setWindowProperties: vi.fn(),
        keepAlive: vi.fn(),
        addBannerMessage: vi.fn(() => "b1"),
        removeBannerMessage: vi.fn(),
    };
    g.PalmSystem = palm;
});

afterEach(() => {
    bus.uninstall();
    delete g.PalmSystem;
    delete g.__phoenixRuntime;
    delete g.phoenixHost;
    resetBackHandlers();
    resetWarnings();
    document.body.innerHTML = "";
    vi.restoreAllMocks();
});

describe("app", () => {
    it("reads the id and launch params, and hears relaunches", () => {
        palm.launchParams = JSON.stringify({ a: 1 });
        expect(app.id).toBe("com.example.app");
        expect(app.launchParams()).toEqual({ a: 1 });
        const seen: object[] = [];
        const off = app.onLaunch((p) => seen.push(p));
        relaunch({ b: 2 });
        off();
        relaunch({ c: 3 });
        expect(seen).toEqual([{ a: 1 }, { b: 2 }]);
    });

    it("gives the back gesture to the innermost handler that takes it", () => {
        const order: string[] = [];
        app.onBack(() => { order.push("outer"); return true; });
        const off = app.onBack(() => { order.push("inner"); return false; });
        const e1 = new KeyboardEvent("keydown", { key: "Escape", cancelable: true });
        window.dispatchEvent(e1);
        expect(order).toEqual(["inner", "outer"]);
        expect(e1.defaultPrevented).toBe(true);
        off();
        resetBackHandlers();
        const e2 = new KeyboardEvent("keydown", { key: "Escape", cancelable: true });
        window.dispatchEvent(e2);
        expect(e2.defaultPrevented).toBe(false);
    });

    it("drives the window through PalmSystem", () => {
        app.stageReady();
        app.setOrientation("landscape");
        app.setFullScreen(true);
        app.keepScreenOn(true);
        app.keepAlive();
        expect(palm.stageReady).toHaveBeenCalled();
        expect(palm.setWindowOrientation).toHaveBeenCalledWith("landscape");
        expect(palm.enableFullScreenMode).toHaveBeenCalledWith(true);
        expect(palm.setWindowProperties).toHaveBeenCalledWith({ blockScreenTimeout: true });
        expect(palm.keepAlive).toHaveBeenCalledWith(true);
    });

    it("launches and opens through the application manager", async () => {
        bus.handle(/applicationManager/, () => ({}));
        await app.launch("com.palm.app.email", { x: 1 });
        await app.open("https://example.com");
        expect(bus.calls.map((c) => [c.uri, c.params])).toEqual([
            ["luna://com.webos.applicationManager/launch", { id: "com.palm.app.email", params: { x: 1 } }],
            ["luna://com.webos.applicationManager/open", { target: "https://example.com" }],
        ]);
    });
});

describe("appMenu", () => {
    it("opens on the status bar's tap with Edit, Share and the app's items", async () => {
        const edit = vi.fn();
        g.__phoenixRuntime = { editState: () => ({ canSelectAll: true, canCut: false, canCopy: true, canPaste: true }), edit };
        const prefs = vi.fn();
        const menu = appMenu.attach({ items: [{ label: "Preferences", onSelect: prefs }], share: { text: "hello" } });
        document.dispatchEvent(new CustomEvent("phoenixAppMenu"));
        expect(menu.isOpen).toBe(true);
        const labels = () => [...document.querySelectorAll(".phx-appmenu-item")].map((e) => e.textContent);
        expect(labels()).toEqual(["Edit", "Share", "Preferences"]);
        (document.querySelector(".phx-appmenu-item") as HTMLElement).click();
        expect(labels()).toEqual(["Edit", "Select All", "Cut", "Copy", "Paste", "Share", "Preferences"]);
        expect(document.querySelectorAll(".phx-appmenu-item.disabled")).toHaveLength(1);
        ([...document.querySelectorAll(".phx-appmenu-item")][3] as HTMLElement).click();
        expect(edit).toHaveBeenCalledWith("copy");
        expect(menu.isOpen).toBe(false);

        bus.handle("luna://org.webosphoenix.share/open", () => ({ action: "copy" }));
        menu.open();
        ([...document.querySelectorAll(".phx-appmenu-item")][1] as HTMLElement).click();
        await vi.waitFor(() => expect(bus.callsTo("luna://org.webosphoenix.share/open")[0]?.params).toEqual({ text: "hello" }));

        menu.open();
        ([...document.querySelectorAll(".phx-appmenu-item")][2] as HTMLElement).click();
        expect(prefs).toHaveBeenCalled();
        menu.destroy();
    });

    it("closes on the back gesture first, and opens on webOS's palm-command relaunch", () => {
        const menu = appMenu.attach({ share: false, edit: false, items: [{ label: "About", onSelect() {} }] });
        relaunch({ "palm-command": "open-app-menu" });
        expect(menu.isOpen).toBe(true);
        const back = vi.fn(() => true);
        app.onBack(back);
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", cancelable: true }));
        expect(menu.isOpen).toBe(false);
        expect(back).not.toHaveBeenCalled();
        menu.destroy();
    });

    it("shares the page's selection when the app says nothing, and dims Share without one", () => {
        expect(appMenu.shareContent(undefined)).toBeNull();
        expect(appMenu.shareContent(() => ({ url: "https://x" }))).toEqual({ url: "https://x" });
        expect(appMenu.shareContent(false)).toBeNull();
    });
});

describe("share and pickers", () => {
    it("opens the system's sheet", async () => {
        bus.handle("luna://org.webosphoenix.share/open", () => ({ action: "app", appId: "com.palm.app.email" }));
        await expect(share.open({ title: "T", text: "body" })).resolves.toEqual({ returnValue: true, action: "app", appId: "com.palm.app.email" });
        expect(bus.calls[0].params).toEqual({ title: "T", text: "body" });
    });

    it("refuses nothing to share", async () => {
        await expect(share.open({ title: "only a title" })).rejects.toMatchObject({ code: "failed" });
    });

    it("copies to the clipboard without a share sheet", async () => {
        vi.spyOn(console, "warn").mockImplementation(() => {});
        const writeText = vi.fn(async () => {});
        Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
        await expect(share.open({ text: "a", url: "https://b" })).resolves.toEqual({ action: "copy" });
        expect(writeText).toHaveBeenCalledWith("a\nhttps://b");
    });

    it("receives shares at launch and relaunch", () => {
        palm.launchParams = JSON.stringify({ share: { text: "first" } });
        const got: unknown[] = [];
        const off = share.onReceive((s) => got.push(s));
        relaunch({ share: { url: "https://second" } });
        relaunch({ other: true });
        off();
        expect(got).toEqual([{ text: "first" }, { url: "https://second" }]);
    });

    it("picks files, and resolves null when cancelled", async () => {
        bus.handle("luna://org.webosphoenix.filepicker/pick", (p) => p.multiple
            ? { files: [{ fullPath: "/media/internal/a.pdf", mimeType: "application/pdf", name: "a.pdf" }] } : { canceled: true });
        await expect(pickers.open({ kinds: ["document"], multiple: true, extensions: ["pdf"] })).resolves.toHaveLength(1);
        expect(bus.calls[0].params).toEqual({ kinds: ["document"], multiple: true, extensions: ["pdf"] });
        await expect(pickers.picture()).resolves.toBeNull();
        bus.handle("luna://org.webosphoenix.filepicker/save", () => ({ path: "/media/internal/Documents/x.txt" }));
        await expect(pickers.save({ name: "x.txt", data: "aGk=", mimeType: "text/plain" })).resolves.toBe("/media/internal/Documents/x.txt");
    });
});

describe("notifications", () => {
    it("shows banners with PalmSystem", async () => {
        await expect(notifications.banner("Saved", { params: { id: 1 }, soundClass: "notifications" })).resolves.toBe("b1");
        expect(palm.addBannerMessage).toHaveBeenCalledWith("Saved", '{"id":1}', "", "notifications", "", 0);
        notifications.removeBanner("b1");
        expect(palm.removeBannerMessage).toHaveBeenCalledWith("b1");
    });

    it("falls back to OSE's toast without PalmSystem", async () => {
        delete g.PalmSystem;
        bus.handle("luna://com.webos.notification/createToast", () => ({ toastId: "t9" }));
        await expect(notifications.banner("Hi")).resolves.toBe("t9");
        expect(bus.calls[0].params).toMatchObject({ message: "Hi" });
    });

    it("posts rows to the Phoenix shell, with tags and actions", async () => {
        const postToHost = vi.fn();
        g.phoenixHost = { postToHost };
        await notifications.post({ title: "Upload", body: "Done", tag: "up", params: { a: 1 },
                                   actions: { uri: "luna://com.example.app.service/act", items: [{ id: "retry", label: "Retry" }] } });
        notifications.remove("up");
        expect(postToHost.mock.calls).toEqual([
            ["notification", { appId: "com.example.app", title: "Upload", body: "Done", params: { a: 1 }, tag: "up",
                               actions: { uri: "luna://com.example.app.service/act", items: [{ id: "retry", label: "Retry" }] } }],
            ["notification", { appId: "com.example.app", remove: true, tag: "up" }],
        ]);
    });

    it("opens a dashboard window with webOS's attributes", () => {
        const open = vi.spyOn(window, "open").mockImplementation(() => null);
        notifications.dashboard("dash.html", { name: "timer", height: 104, persistent: true });
        expect(open).toHaveBeenCalledWith("dash.html", "timer", 'height=104, attributes={"window":"dashboard","persistent":true}');
    });

    it("sets and clears ongoing activities, and schedules activities", async () => {
        bus.handle(/org\.webosphoenix\.ongoing|activitymanager/, () => ({}));
        await ongoing.set({ id: "dl", title: "Downloading", progress: 40 });
        await ongoing.clear("dl");
        await activities.schedule({ name: "com.example.app.sync", every: "1h", params: { sync: true } });
        expect(bus.calls[0].params).toEqual({ appId: "com.example.app", progress: 40, id: "dl", title: "Downloading" });
        expect(bus.calls[1].params).toEqual({ id: "dl" });
        expect(bus.calls[2].params).toMatchObject({
            start: true, replace: true,
            activity: { name: "com.example.app.sync", schedule: { interval: "1h" },
                        callback: { method: "palm://com.palm.applicationManager/launch", params: { id: "com.example.app", params: { sync: true } } } },
        });
    });
});

describe("Just Type and the Assistant", () => {
    it("hand the app what the user typed or said", () => {
        palm.launchParams = JSON.stringify({ newNote: "buy milk" });
        const actions: string[] = [];
        const commands: string[] = [];
        justType.onAction("newNote", (t) => actions.push(t));
        assistant.onCommand("newNote", (t) => commands.push(t));
        relaunch({ noteId: "x" });
        relaunch({ newNote: "call mum" });
        expect(actions).toEqual(["buy milk", "call mum"]);
        expect(commands).toEqual(["buy milk", "call mum"]);
    });

    it("lists the app's own commands", async () => {
        bus.handle("luna://org.webosphoenix.assistant/commands", () => ({ commands: [
            { id: "a", title: "A", appId: "com.example.app" }, { id: "b", title: "B", appId: "other" }] }));
        await expect(assistant.commands()).resolves.toEqual([{ id: "a", title: "A", appId: "com.example.app" }]);
    });
});

describe("Synergy data and compose", () => {
    it("lists and searches contacts", async () => {
        bus.handle("luna://com.palm.db/find", () => ({ results: [
            { _id: "p1", _kind: "com.palm.person:1", name: { givenName: "Mary", familyName: "Spetzler" }, phoneNumbers: [{ value: "(408) 555-0101" }], emails: [] },
            { _id: "p2", _kind: "com.palm.person:1", name: { givenName: "Ron" }, emails: [{ value: "ron@example.com" }] },
        ] }));
        expect((await contacts.list()).map((p) => p.name)).toEqual(["Mary Spetzler", "Ron"]);
        expect((await contacts.search("555 0101")).map((p) => p.id)).toEqual(["p1"]);
        expect((await contacts.search("example")).map((p) => p.id)).toEqual(["p2"]);
    });

    it("reads calendar events in a range and opens a new one in Calendar", async () => {
        bus.handle("luna://com.palm.db/find", () => ({ results: [
            { _id: "e1", calendarId: "c", subject: "Lunch", dtstart: 1000, dtend: 2000 },
            { _id: "e2", calendarId: "c", subject: "Later", dtstart: 9000, dtend: 9500 },
        ] }));
        expect((await calendar.events({ from: 0, to: 5000 })).map((e) => e.subject)).toEqual(["Lunch"]);
        bus.handle(/applicationManager\/launch/, () => ({}));
        await calendar.newEvent({ subject: "Dentist", start: 3_600_000 });
        expect(bus.callsTo("luna://com.webos.applicationManager/launch")[0].params).toEqual({
            id: "com.palm.app.calendar", params: { newEvent: { subject: "Dentist", dtstart: "3600000", dtend: "7200000" } } });
    });

    it("composes an email with the SDK email API's params", async () => {
        bus.handle(/applicationManager\/launch/, () => ({}));
        await email.compose({ to: ["a@x"], cc: ["b@x"], subject: "S", body: "B", attachments: [{ path: "/media/internal/a.pdf" }] });
        expect(bus.calls[0].params).toEqual({ id: "com.palm.app.email", params: {
            summary: "S", text: "B", isHtml: false,
            recipients: [{ value: "a@x", type: "email", role: 1 }, { value: "b@x", type: "email", role: 2 }],
            attachments: [{ fullPath: "/media/internal/a.pdf", mimeType: "" }] } });
    });

    it("falls back to an sms: link when Phoenix's Messaging is not there", async () => {
        bus.handle(/applicationManager\/launch/, () => { throw { errorCode: -1, errorText: "app not found: org.webosphoenix.messaging" }; });
        bus.handle(/applicationManager\/open/, () => ({}));
        await messaging.compose({ to: "4085550101", text: "On my way" });
        expect(bus.callsTo("luna://com.webos.applicationManager/open")[0].params).toEqual({ target: "sms:4085550101?body=On%20my%20way" });
    });

    it("lists accounts for a capability", async () => {
        bus.handle("luna://com.palm.service.accounts/listAccounts", () => ({ results: [
            { _id: "a1", templateId: "com.palm.imap", username: "me@x", capabilityProviders: [{ capability: "MAIL" }] }] }));
        await expect(accounts.list("MAIL")).resolves.toEqual([{ id: "a1", templateId: "com.palm.imap", username: "me@x", alias: undefined, capabilities: ["MAIL"] }]);
        expect(bus.calls[0].params).toEqual({ capability: "MAIL" });
    });
});

describe("device services", () => {
    it("makes a location refusal a permission-denied error", async () => {
        bus.handle("luna://com.webos.service.location/getLocationUpdates", () => { throw { errorCode: 6, errorText: "User denied" }; });
        await expect(location.current()).rejects.toMatchObject({ code: "permission-denied", errorCode: 6 });
    });

    it("copies sensitive text into the clipboard history", async () => {
        bus.handle(/clipboard/, () => ({ clip: { id: "c1" } }));
        await clipboard.copy("hunter2", { sensitive: true });
        expect(bus.calls[0].params).toMatchObject({ text: "hunter2", sensitive: true });
    });
});

describe("design layer", () => {
    it("has the classic tokens as CSS variables and a stylesheet", () => {
        expect(tokens.color.background).toBe("#e4e4e2");
        expect(tokens.font.family).toMatch(/^Prelude, .*"Open Sans"/);
        expect(cssVariables()["--phx-color-background"]).toBe("#e4e4e2");
        expect(cssVariables()["--phx-radius-menu"]).toBe("12px");
        expect(themeCss()).toContain(".phx-appmenu {");
        applyTheme();
        applyTheme();
        expect(document.querySelectorAll("#phoenix-sdk-theme")).toHaveLength(1);
        expect(document.body.classList.contains("phx-app")).toBe(true);
    });
});
