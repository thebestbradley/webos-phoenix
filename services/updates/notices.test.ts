// @vitest-environment node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// com.palm.update's system notices (notices.js; docs/NOTICES.md section 4):
// a signed feed served from memory, the notification calls it makes, its
// state. Each "restart" is a new service on the same state.

import { createRequire } from "node:module";
import crypto from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const noticesLib = require("./notices.js") as Any;
const updates = require("./updatesservice.js") as Any;
const platform = require("@phoenix/platform") as Any;
const keys = require("../../tools/platform-mock/keys.cjs") as Any;

const FEEDS = "https://feeds.example.org/";
const URL_ = FEEDS + "notices/v1/notices.json";
let key: Any;
let files: Record<string, { status: number; bytes: Uint8Array }>;
let state: Any;
let calls: { uri: string; params: Any }[];
let prefs: Any;
let clock: Date;
let device: Any;
let pinned: string[];

function notice(id: string, extra: Any = {}) {
    return { id, severity: "info", title: "Title " + id, body: "Body " + id, starts: "2026-11-01T00:00:00Z", ends: "2026-11-30T00:00:00Z", ...extra };
}
function publish(list: Any[], extra: Any = {}, signer: Any = key) {
    const doc = { format: 1, sequence: 1, generated: "2026-11-02T00:00:00Z", expires: "2026-11-09T00:00:00Z", notices: list, ...extra };
    const bytes = new TextEncoder().encode(JSON.stringify(doc));
    files[URL_] = { status: 200, bytes };
    files[URL_ + ".sig"] = { status: 200, bytes: new TextEncoder().encode(keys.sigFile(signer, bytes)) };
}

function create() {
    return noticesLib.createNotices({
        service: "com.palm.update",
        servers: async () => platform.servers.resolve({ feeds: FEEDS, notices: { url: "notices/v1/notices.json", keys: pinned } }, null, false),
        getBytes: async (url: string) => files[url] ?? { status: 404, bytes: new Uint8Array() },
        luna: {
            call: async (uri: string, params: Any) => {
                calls.push({ uri, params });
                if (uri.endsWith("/getPreferences")) return { returnValue: true, ...prefs };
                if (uri.endsWith("/createToast")) return { returnValue: true, toastId: "t" + calls.length };
                return { returnValue: true };
            },
        },
        crypto: { sha512: async (b: Uint8Array) => new Uint8Array(crypto.createHash("sha512").update(b).digest()) },
        state: { load: () => state && JSON.parse(JSON.stringify(state)), save: (o: Any) => { state = JSON.parse(JSON.stringify(o)); } },
        device: async () => device,
        now: () => clock,
    });
}
const shown = () => calls.filter((c) => /createToast|createAlert/.test(c.uri)).map((c) => [c.uri.split("/").pop(), c.params.title || c.params.message]);
const toasts = () => calls.filter((c) => c.uri.endsWith("/createToast")).map((c) => c.params);

beforeEach(() => {
    key = keys.keypair();
    pinned = [key.publicKey];
    files = {};
    state = { channel: "stable", autoDownload: true };   // the update service's own, kept as it is
    calls = [];
    prefs = { locale: { languageCode: "en", countryCode: "us" } };
    clock = new Date("2026-11-02T12:00:00Z");
    device = { channel: "stable", compatible: "phoenix-vm-arm64", build: 20261020 };
});

describe("system notices", () => {
    it("shows each notice once, at its severity: info a banner and row, important kept, critical a popup alert first", async () => {
        publish([notice("i"), notice("m", { severity: "important" }), notice("c", { severity: "critical", action: { kind: "update" } })]);
        const n = create();
        const r = await n.checkNotices({});
        expect(r).toMatchObject({ returnValue: true, configured: true, enabled: true, sequence: 1, error: null });
        expect(r.notices.map((x: Any) => [x.id, x.seen])).toEqual([["i", true], ["m", true], ["c", true]]);
        expect(shown()).toEqual([["createToast", "Title i"], ["createToast", "Title m"], ["createAlert", "Title c"], ["createToast", "Title c"]]);
        expect(toasts()[0]).toEqual({ sourceId: "com.palm.update", title: "Title i", message: "Body i", onlyToast: false, persistent: false,
                                      onclick: { appId: "org.webosphoenix.settings", params: {} } });
        expect(toasts()[1].persistent).toBe(true);
        const alert = calls.find((c) => c.uri.endsWith("/createAlert"))!.params;
        expect(alert.buttons[0]).toEqual({ label: "Open", onclick: "luna://com.webos.applicationManager/launch",
                                           params: { id: "org.webosphoenix.settings", params: { page: "updates" } } });
        expect(toasts()[2].onclick).toEqual({ appId: "org.webosphoenix.settings", params: { page: "updates" } });
        // The update service's state is left as it was.
        expect(state).toMatchObject({ channel: "stable", autoDownload: true });

        calls = [];
        await n.checkNotices({});
        expect(shown()).toEqual([]);
        // A restart: a new service on the same state shows nothing again.
        await create().checkNotices({});
        expect(shown()).toEqual([]);
        // A new feed with one more: only that one.
        publish([notice("i"), notice("new")], { sequence: 2 });
        await create().checkNotices({});
        expect(shown()).toEqual([["createToast", "Title new"]]);
    });

    it("dismissed stays dismissed after a restart, even when a later feed has it again", async () => {
        publish([notice("m", { severity: "important" })]);
        const n = create();
        await n.checkNotices({});
        const r = await n.dismiss("m");
        expect(calls.some((c) => c.uri.endsWith("/closeToast"))).toBe(true);
        expect(r.notices[0]).toMatchObject({ id: "m", seen: true, dismissed: true });
        await expect(n.dismiss("")).rejects.toMatchObject({ code: "BAD_PARAMS" });

        calls = [];
        const again = create();
        expect((await again.list()).notices[0]).toMatchObject({ id: "m", dismissed: true });
        publish([notice("m", { severity: "important", title: "Still down" })], { sequence: 5 });
        await again.checkNotices({});
        expect(shown()).toEqual([]);
        // Dismissed before it was ever shown (another device's Settings, a test): never shown.
        await again.dismiss("later");
        publish([notice("m"), notice("later")], { sequence: 6 });
        await create().checkNotices({});
        expect(shown()).toEqual([]);
    });

    it("refuses an older feed (ROLLBACK), an expired one, a wrong signature, and shows nothing from them", async () => {
        publish([notice("a")], { sequence: 7 });
        await create().checkNotices({});
        calls = [];
        publish([notice("b")], { sequence: 6 });
        await expect(create().checkNotices({})).rejects.toMatchObject({ code: "ROLLBACK" });
        expect((await create().list())).toMatchObject({ sequence: 7, error: { errorCode: "ROLLBACK" } });
        publish([notice("b")], { sequence: 8, expires: "2026-11-01T00:00:00Z" });
        await expect(create().checkNotices({})).rejects.toMatchObject({ code: "EXPIRED" });
        publish([notice("b")], { sequence: 8 }, keys.keypair());
        await expect(create().checkNotices({})).rejects.toMatchObject({ code: "BAD_SIGNATURE" });
        delete files[URL_ + ".sig"];
        files[URL_ + ".sig"] = { status: 404, bytes: new Uint8Array() };
        await expect(create().checkNotices({})).rejects.toMatchObject({ code: "BAD_SIGNATURE" });
        expect(shown()).toEqual([]);
        // The good one again, then a fixed feed: it shows.
        publish([notice("b")], { sequence: 8 });
        await create().checkNotices({});
        expect(shown()).toEqual([["createToast", "Title b"]]);
    });

    it("needs a feed and a pinned key; none published yet is no error", async () => {
        pinned = [];
        publish([notice("a")]);
        await expect(create().checkNotices({})).rejects.toMatchObject({ code: "UNTRUSTED" });
        pinned = [key.publicKey];
        files = {};
        const r = await create().checkNotices({});
        expect(r).toMatchObject({ error: null, notices: [] });
        files[URL_] = { status: 500, bytes: new Uint8Array() };
        await expect(create().checkNotices({})).rejects.toMatchObject({ code: "CONNECTION_FAILED" });
        expect(shown()).toEqual([]);
    });

    it("only the notices for this device: channel, compatible, build, locale", async () => {
        publish([notice("beta", { audience: { channels: ["beta"] } }), notice("arm", { audience: { compatible: ["phoenix-vm-arm64"] } }),
                 notice("old", { audience: { maxBuild: 20261001 } }), notice("de", { audience: { locales: ["de"] } }),
                 notice("en", { audience: { locales: ["en-US"] } }), notice("later", { starts: "2026-11-20T00:00:00Z" })]);
        await create().checkNotices({});
        expect(shown().map((s) => s[1])).toEqual(["Title arm", "Title en"]);
        // The device moves to beta: the beta notice now.
        calls = [];
        device = { ...device, channel: "beta" };
        await create().checkNotices({});
        expect(shown().map((s) => s[1])).toEqual(["Title beta"]);
        // Its time comes.
        calls = [];
        clock = new Date("2026-11-21T00:00:00Z");
        publish([notice("later", { starts: "2026-11-20T00:00:00Z" })], { expires: "2026-11-28T00:00:00Z" });
        await create().checkNotices({});
        expect(shown().map((s) => s[1])).toEqual(["Title later"]);
    });

    it("a notice cannot open any app or address: only its allowlisted action, else Settings", async () => {
        publish([notice("term", { action: { kind: "app", appId: "org.webosphoenix.terminal", params: { command: "rm -rf /" } } }),
                 notice("evil", { action: { kind: "url", url: "https://evil.example/" } }),
                 notice("http", { action: { kind: "url", url: "http://feeds.example.org/status" } }),
                 notice("site", { action: { kind: "url", url: "https://feeds.example.org/status" } }),
                 notice("store", { action: { kind: "app", appId: "org.webosphoenix.marketplace", params: { appId: "org.example.tides" } } })]);
        await create().checkNotices({});
        expect(toasts().map((t) => [t.title, t.onclick])).toEqual([
            ["Title term", { appId: "org.webosphoenix.settings", params: {} }],
            ["Title evil", { appId: "org.webosphoenix.settings", params: {} }],
            ["Title http", { appId: "org.webosphoenix.settings", params: {} }],
            ["Title site", { appId: "com.palm.app.browser", params: { target: "https://feeds.example.org/status" } }],
            ["Title store", { appId: "org.webosphoenix.marketplace", params: { appId: "org.example.tides" } }],
        ]);
    });

    it("Phoenix announcements off: nothing shown but critical ones, and what was skipped stays skipped", async () => {
        prefs.phoenixAnnouncements = false;
        publish([notice("i"), notice("c", { severity: "critical" })]);
        const r = await create().checkNotices({});
        expect(r.enabled).toBe(false);
        expect(shown()).toEqual([["createAlert", "Title c"], ["createToast", "Title c"]]);
        expect(calls.find((c) => c.uri.endsWith("/createAlert"))!.params.buttons).toEqual([{ label: "OK" }]);
        calls = [];
        prefs.phoenixAnnouncements = true;
        await create().checkNotices({});
        expect(shown()).toEqual([]);
    });

    it("plain text: the shell gets the text as it is, control characters out; a notice without a body is its title", async () => {
        publish([notice("x", { title: "<img src=x onerror=alert(1)>\u0007", body: undefined })]);
        await create().checkNotices({});
        expect(toasts()[0]).toMatchObject({ title: "", message: "<img src=x onerror=alert(1)>" });
    });

    it("the activities: daily, and once after boot; each completed", async () => {
        const n = create();
        await n.ensureSchedule();
        await n.atBoot();
        const made = calls.filter((c) => c.uri.endsWith("activitymanager/create")).map((c) => c.params.activity);
        expect(made.map((a: Any) => [a.name, a.schedule || null, a.requirements, a.callback])).toEqual([
            ["org.webosphoenix.notices.check", { interval: "24h" }, { internet: true }, { method: "luna://com.palm.update/checkNotices", params: { daily: true } }],
            ["org.webosphoenix.notices.boot", null, { internet: true }, { method: "luna://com.palm.update/checkNotices", params: {} }],
        ]);
        publish([notice("a")]);
        await n.checkNotices({ daily: true, $activity: { activityId: 12 } });
        await n.checkNotices({ $activity: { activityId: 13 } });
        expect(calls.filter((c) => c.uri.endsWith("/complete")).map((c) => c.params)).toEqual([
            { activityId: 12, restart: true }, { activityId: 13, restart: false }]);
    });
});

describe("through com.palm.update", () => {
    function updatesService(extra: Any = {}) {
        return updates.createUpdatesService({
            rauc: { status: async () => ({ compatible: "phoenix-vm-arm64", booted: { slot: "rootfs.0", version: "1.0.0", build: 20261020 }, primary: "rootfs.0", other: "rootfs.1" }),
                    markGood: async () => {} },
            request: async () => ({ status: 404, body: "" }),
            requestBytes: async (r: Any) => files[r.url] ?? { status: 404, bytes: new Uint8Array() },
            download: () => { throw new Error("no"); },
            files: { path: (n: string) => n, exists: () => false, remove: () => {} },
            power: async () => null,
            luna: { call: async (uri: string, params: Any) => {
                calls.push({ uri, params });
                return uri.endsWith("/getPreferences") ? { returnValue: true, ...prefs } : { returnValue: true };
            } },
            crypto: { sha256: async () => new Uint8Array(32), sha512: async (b: Uint8Array) => new Uint8Array(crypto.createHash("sha512").update(b).digest()),
                      randomBytes: (k: number) => new Uint8Array(k) },
            servers: async () => platform.servers.resolve({ feeds: FEEDS, updates: { url: "updates/" },
                                                            notices: { url: "notices/v1/notices.json", keys: pinned } }, null, false),
            state: { load: () => state && JSON.parse(JSON.stringify(state)), save: (o: Any) => { state = JSON.parse(JSON.stringify(o)); } },
            now: () => clock,
            ...extra,
        });
    }

    it("registers the methods; the Updates pane's check reads the notices too; after boot the boot check is set up", async () => {
        expect(updates.METHODS).toEqual(expect.arrayContaining(["checkNotices", "getNotices", "dismissNotice"]));
        publish([notice("a")]);
        const svc = updatesService();
        await svc.check({});
        await new Promise((r) => setTimeout(r, 20));
        expect(shown()).toEqual([["createToast", "Title a"]]);
        expect(calls.some((c) => c.uri.endsWith("activitymanager/create") && c.params.activity.name === "org.webosphoenix.notices.boot")).toBe(true);
        const st = await svc.getNotices({});
        expect(st.notices[0]).toMatchObject({ id: "a", seen: true });
        expect(await svc.dismissNotice({ id: "a" })).toMatchObject({ returnValue: true });
        expect(await svc.dismissNotice({})).toMatchObject({ returnValue: false, errorCode: "BAD_PARAMS" });
        // The simulator leaves the boot check out.
        calls = [];
        await updatesService({ noticesAtBoot: false }).getNotices({});
        expect(calls.some((c) => c.uri.endsWith("activitymanager/create") && c.params.activity.name === "org.webosphoenix.notices.boot")).toBe(false);
    });
});
