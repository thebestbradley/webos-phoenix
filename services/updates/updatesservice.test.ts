// @vitest-environment node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// com.palm.update (updatesservice.js) with what it runs on on a device
// (lib/node.js: RAUC's command line, /etc/os-release, HTTP, downloads,
// /sys/class/power_supply), against an update feed on a local HTTP server
// and test/fake-rauc.cjs in place of rauc. Each "restart" is a new service
// on the same state, booted into the slot RAUC made primary.

import { createRequire } from "node:module";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const updates = require("./updatesservice.js") as Any;
const node = require("./lib/node.js") as Any;

const FAKE_RAUC = path.join(__dirname, "test/fake-rauc.cjs");
const COMPATIBLE = "phoenix-pinephone";

let dir: string;
let server: http.Server;
let base: string;
let files: Record<string, { status?: number; body: Buffer | string }> = {};

function bundle(version: string, build: number, compatible = COMPATIBLE) {
    return `[update]\ncompatible=${compatible}\nversion=${version}\nbuild=${build}\n\n[image.rootfs]\nfilename=rootfs.ext4\n`;
}
function publish(version: string, build: number, opts: { bundleText?: string; sha256?: string; compatible?: string; channel?: string } = {}) {
    const text = opts.bundleText ?? bundle(version, build);
    const name = `phoenix-${version}.raucb`;
    files[`/${COMPATIBLE}/${name}`] = { body: text };
    files[`/${COMPATIBLE}/${opts.channel ?? "stable"}.json`] = { body: JSON.stringify({
        format: 1, compatible: opts.compatible ?? COMPATIBLE, channel: opts.channel ?? "stable",
        release: { name: "webOS Phoenix", version, build, date: "2026-10-01", notes: ["Faster cards"], url: name,
                   size: Buffer.byteLength(text), sha256: opts.sha256 ?? crypto.createHash("sha256").update(text).digest("hex") },
    }) };
}

// The device: RAUC's slots, /etc/os-release of the running one, a battery.
function device(booted = { version: "1.0.0", build: 100 }) {
    fs.writeFileSync(path.join(dir, "rauc.json"), JSON.stringify({
        compatible: COMPATIBLE, booted: "rootfs.0", primary: "rootfs.0",
        slots: { "rootfs.0": booted, "rootfs.1": null },
    }));
    fs.rmSync(path.join(dir, "rauc.json.calls"), { force: true });
    osRelease(booted);
    battery(80, false);
}
function osRelease(b: { version: string; build: number }) {
    fs.writeFileSync(path.join(dir, "os-release"), `NAME="webOS Phoenix"\nVERSION_ID=${b.version}\nBUILD_ID=${b.build}\n`);
}
function battery(percent: number, charging: boolean) {
    const ps = path.join(dir, "power_supply");
    fs.rmSync(ps, { recursive: true, force: true });
    fs.mkdirSync(path.join(ps, "battery"), { recursive: true });
    fs.mkdirSync(path.join(ps, "usb"), { recursive: true });
    fs.writeFileSync(path.join(ps, "battery/type"), "Battery\n");
    fs.writeFileSync(path.join(ps, "battery/capacity"), percent + "\n");
    fs.writeFileSync(path.join(ps, "battery/status"), charging ? "Charging\n" : "Discharging\n");
    fs.writeFileSync(path.join(ps, "usb/type"), "USB\n");
    fs.writeFileSync(path.join(ps, "usb/online"), charging ? "1\n" : "0\n");
}
// The slots, and the commands run so far (test/fake-rauc.cjs logs them apart).
const raucState = () => {
    const calls = path.join(dir, "rauc.json.calls");
    return { ...JSON.parse(fs.readFileSync(path.join(dir, "rauc.json"), "utf8")),
             calls: fs.existsSync(calls) ? fs.readFileSync(calls, "utf8").split("\n").filter(Boolean) : [] };
};
// The bootloader: start the primary slot (or, failing, stay).
function restart(fails = false) {
    const st = raucState();
    if (!fails) st.booted = st.primary;
    else st.primary = st.booted;
    delete st.calls;
    fs.writeFileSync(path.join(dir, "rauc.json"), JSON.stringify(st));
    osRelease(st.slots[st.booted]);
}

let state: Any;
let calls: { uri: string; params: Any }[];
let wifi: boolean;

function service() {
    const downloads = path.join(dir, "downloads");
    return updates.createUpdatesService({
        rauc: node.createRauc({ command: FAKE_RAUC, osRelease: path.join(dir, "os-release") }),
        request: node.request,
        download: node.download,
        files: {
            path: (name: string) => path.join(downloads, name),
            exists: (f: string) => fs.existsSync(f),
            remove: (f: string) => fs.rmSync(f, { force: true }),
        },
        power: () => node.power(path.join(dir, "power_supply")),
        luna: {
            call: (uri: string, params: Any) => {
                calls.push({ uri, params });
                if (uri.endsWith("/getstatus")) return Promise.resolve({ returnValue: true, wifi: { state: wifi ? "connected" : "disconnected" } });
                return Promise.resolve({ returnValue: true });
            },
        },
        config: () => ({ feed: base, channel: "stable" }),
        state: { load: () => state && JSON.parse(JSON.stringify(state)), save: (o: Any) => { state = JSON.parse(JSON.stringify(o)); } },
        now: () => new Date("2026-10-01T12:00:00Z"),
    });
}
function palmEvents(svc: Any) {
    const seen: Any[] = [];
    svc.watchPalm((r: Any) => seen.push(r));
    return seen;
}
const called = (suffix: string) => calls.filter((c) => c.uri.endsWith(suffix));

beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "phoenix-updates-"));
    process.env.FAKE_RAUC_STATE = path.join(dir, "rauc.json");
    server = http.createServer((req, res) => {
        const f = files[req.url ?? ""];
        if (!f) { res.writeHead(404); return res.end("not found"); }
        res.writeHead(f.status ?? 200, { "Content-Type": "application/octet-stream" });
        res.end(f.body);
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    base = `http://127.0.0.1:${(server.address() as Any).port}/`;
});
afterAll(() => {
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
});
beforeEach(() => {
    files = {};
    state = null;
    calls = [];
    wifi = true;
    fs.rmSync(path.join(dir, "downloads"), { recursive: true, force: true });
    device();
});

describe("the feed", () => {
    it("reads the running system from RAUC and /etc/os-release, and the battery", async () => {
        const st = await service().getStatus({});
        expect(st).toMatchObject({ returnValue: true, state: "idle", available: null, channel: "stable", autoDownload: true,
            current: { name: "webOS Phoenix", version: "1.0.0", build: 100 }, battery: { percent: 80, charging: false } });
    });

    it("finds an update, or none (no feed for this device yet, or nothing newer)", async () => {
        const svc = service();
        expect((await svc.check({})).available).toBeNull();
        publish("1.0.0", 100);
        expect((await svc.check({})).available).toBeNull();
        publish("1.1.0", 110);
        const st = await svc.check({});
        expect(st.available).toMatchObject({ version: "1.1.0", build: 110, notes: ["Faster cards"],
            url: base + COMPATIBLE + "/phoenix-1.1.0.raucb" });
        expect(st.lastChecked).toBe("2026-10-01T12:00:00.000Z");
        expect(st.state).toBe("idle");
    });

    it("refuses a feed for another device, and says when the server cannot be reached", async () => {
        publish("1.1.0", 110, { compatible: "phoenix-pixel3a" });
        const svc = service();
        expect(await svc.check({})).toMatchObject({ returnValue: false, errorCode: "BAD_FEED" });
        expect((await svc.getStatus({})).error).toMatchObject({ errorCode: "BAD_FEED" });
        files[`/${COMPATIBLE}/stable.json`] = { status: 500, body: "oops" };
        expect(await svc.check({})).toMatchObject({ errorCode: "CONNECTION_FAILED" });
    });
});

describe("downloading and preparing", () => {
    it("downloads, writes the other slot, keeps this one primary, and tells the System UI", async () => {
        publish("1.1.0", 110);
        const svc = service();
        const palm = palmEvents(svc);
        await svc.check({});
        const st = await svc.download({});
        expect(st).toMatchObject({ state: "ready", available: { version: "1.1.0" } });
        const rauc = raucState();
        expect(rauc.slots["rootfs.1"]).toEqual({ version: "1.1.0", build: 110 });
        expect(rauc.primary).toBe("rootfs.0");     // nothing changes until "Install now"
        expect(rauc.calls).toContain("status mark-active rootfs.0");
        expect(palm.map((r) => r.status)).toContain("Downloading");
        expect(palm.at(-1)).toEqual({ returnValue: true, status: "Available", version: "webOS Phoenix 1.1.0", installTime: 1, minBattery: 20 });
        // The download and the preparing showed in the notification area.
        const ongoing = calls.filter((c) => c.uri.startsWith("luna://org.webosphoenix.ongoing/"));
        expect(ongoing.some((c) => c.params.title === "Downloading webOS Phoenix 1.1.0")).toBe(true);
        expect(ongoing.some((c) => c.params.title === "Preparing webOS Phoenix 1.1.0" && c.params.progress === 100)).toBe(true);
        expect(ongoing.at(-1)).toEqual({ uri: "luna://org.webosphoenix.ongoing/clear", params: { id: "com.palm.update" } });
        // The bundle is not kept once the slot has it.
        expect(fs.readdirSync(path.join(dir, "downloads"))).toEqual([]);
        // A new GetStatus subscriber (the System UI after a restart) hears it too.
        expect(await service().GetStatus({ subscribe: true })).toMatchObject({ status: "Available", version: "webOS Phoenix 1.1.0" });
    });

    it("refuses a download that is not what the feed said", async () => {
        publish("1.1.0", 110, { sha256: "0".repeat(64) });
        const svc = service();
        await svc.check({});
        expect(await svc.download({})).toMatchObject({ returnValue: false, errorCode: "BAD_DOWNLOAD" });
        expect(raucState().slots["rootfs.1"]).toBeNull();
        expect((await svc.getStatus({})).state).toBe("idle");
    });

    it("installs only bundles RAUC accepts, for this device, and newer than the running system", async () => {
        const svc = service();
        publish("1.1.0", 110, { bundleText: "BAD" + bundle("1.1.0", 110) });
        await svc.check({});
        expect(await svc.download({})).toMatchObject({ errorCode: "BAD_BUNDLE", errorText: expect.stringContaining("signature") });
        publish("1.1.0", 110, { bundleText: bundle("1.1.0", 110, "phoenix-pixel3a") });
        await svc.check({});
        expect(await svc.download({})).toMatchObject({ errorCode: "WRONG_DEVICE" });
        // The feed says 1.1.0; the signed bundle is an old system.
        publish("1.1.0", 110, { bundleText: bundle("0.9.0", 90) });
        await svc.check({});
        expect(await svc.download({})).toMatchObject({ errorCode: "NOT_NEWER" });
        expect(fs.readdirSync(path.join(dir, "downloads"))).toEqual([]);
        expect(raucState().slots["rootfs.1"]).toBeNull();
    });

    it("the daily check downloads over Wi-Fi only, and when automatic downloads are on", async () => {
        publish("1.1.0", 110);
        wifi = false;
        expect((await service().scheduled({ $activity: { activityId: 7 } })).state).toBe("idle");
        expect(called("/complete").at(-1)?.params).toEqual({ activityId: 7, restart: true });
        await service().setPreferences({ autoDownload: false });
        wifi = true;
        expect((await service().scheduled({})).state).toBe("idle");
        await service().setPreferences({ autoDownload: true });
        expect((await service().scheduled({})).state).toBe("ready");
        expect(called("/create").some((c) => c.params.activity.name === "com.palm.update.check")).toBe(false);
        await service().getStatus({});
        expect(called("/create").find((c) => c.params.activity.name === "com.palm.update.check")?.params.activity.schedule).toEqual({ interval: "24h" });
    });
});

describe("installing", () => {
    async function ready() {
        publish("1.1.0", 110);
        const svc = service();
        await svc.check({});
        await svc.download({});
        return svc;
    }

    it("switches slots and restarts; after the restart, says it was updated", async () => {
        const svc = await ready();
        battery(10, false);
        const palm = palmEvents(svc);
        expect(await svc.InstallNow({})).toMatchObject({ returnValue: false, errorCode: "LOW_BATTERY" });
        expect(palm.at(-1)).toMatchObject({ status: "InsufficientCharge", minBattery: 20 });
        battery(10, true);
        expect(await svc.InstallNow({})).toEqual({ returnValue: true });
        expect(raucState().primary).toBe("rootfs.1");
        expect(called("/machineReboot")).toHaveLength(1);
        expect((await svc.getStatus({})).state).toBe("restarting");

        restart();
        const after = service();
        const st = await after.getStatus({});
        expect(st).toMatchObject({ state: "idle", available: null, current: { version: "1.1.0", build: 110 } });
        expect(called("/createToast").at(-1)?.params.message).toBe("Updated to webOS Phoenix 1.1.0");
    });

    it("says so when the new system did not start and the device went back", async () => {
        const svc = await ready();
        await svc.installNow({});
        restart(true);
        const st = await service().getStatus({});
        expect(st.current.version).toBe("1.0.0");
        expect(called("/createToast").at(-1)?.params.message)
            .toBe("The update to 1.1.0 did not start. Your device went back to 1.0.0.");
    });

    it("Install later asks again, with a countdown, when the charger is next connected", async () => {
        const svc = await ready();
        expect(await svc.InstallLater({})).toEqual({ returnValue: true });
        const act = called("/create").find((c) => c.params.activity.name === "com.palm.update.install")!.params.activity;
        expect(act.requirements).toEqual({ charging: true });
        expect(act.callback.method).toBe("luna://com.palm.update/charging");
        // Not said again to a new System UI meanwhile.
        expect((await service().GetStatus({})).status).toBeUndefined();
        const palm = palmEvents(svc);
        await svc.charging({ $activity: { activityId: 9 } });
        expect(palm.at(-1)).toEqual({ returnValue: true, status: "Countdown", version: "webOS Phoenix 1.1.0", installTime: 1,
                                      countdownTime: 5, showLaterButton: true, minBattery: 20 });
        expect(called("/complete").at(-1)?.params).toEqual({ activityId: 9 });
    });

    it("a release that is withdrawn, or another channel, closes the alerts", async () => {
        const svc = await ready();
        const palm = palmEvents(svc);
        delete files[`/${COMPATIBLE}/stable.json`];
        expect((await svc.check({})).available).toBeNull();
        expect(palm.at(-1)).toEqual({ returnValue: true, status: "CancelAlert" });
        expect(await svc.setPreferences({ channel: "nightly" })).toMatchObject({ errorCode: "BAD_PARAMS" });
        expect((await svc.setPreferences({ channel: "beta" })).channel).toBe("beta");
    });
});
