// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Settings > Hardware against the real org.webosphoenix.hardware service
// (services/hardware/hardwareservice.js) and the simulator's signed sample
// catalog (server/drivers/sample), on a made-up device: a Realtek dongle
// whose firmware is missing, an NVIDIA card with an optional firmware, a USB
// gadget nothing drives. The page's luna calls go straight to the service.
// End to end in the simulator's runtime: tools/test-hardware.cjs.

import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { setBridgeFactory, type HardwareDevice } from "@phoenix/luna";
import { HardwarePage, statusText } from "./Hardware";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;
const REPO = resolve(__dirname, "../../../..");
const SAMPLE = resolve(REPO, "server/drivers/sample/public");
const require = createRequire(import.meta.url);
const { createHardwareService } = require(resolve(REPO, "services/hardware/hardwareservice.js")) as Any;

let world: Any;
let calls: { uri: string; params: Any }[];

function makeWorld() {
    const config = JSON.parse(readFileSync(resolve(SAMPLE, "catalog-sim.json"), "utf8"));
    const w: Any = { installed: new Map<string, string[]>(), loaded: [] as string[], files: new Map<string, Uint8Array>(), state: null, posts: [] };
    const fromSample = (url: string) => {
        const m = /^file:\/\/\/usr\/share\/phoenix\/hardware\/sample\/(.*)$/.exec(url);
        try { return m ? new Uint8Array(readFileSync(resolve(SAMPLE, m[1]))) : null; } catch { return null; }
    };
    w.service = createHardwareService({
        system: {
            scan: async () => [
                { id: "usb:1-2", bus: "usb", name: "802.11ac WLAN Adapter", vendor: "Realtek", category: "wifi",
                  modaliases: ["usb:v0BDApC811d0200dc00dsc00dp00icFFiscFFipFFin00"],
                  driver: w.loaded.includes("rtw88/rtw8821c_fw.bin") ? "rtw88_8821cu" : null,
                  firmwareMissing: w.loaded.includes("rtw88/rtw8821c_fw.bin") ? [] : ["rtw88/rtw8821c_fw.bin"] },
                { id: "pci:0000:01:00.0", bus: "pci", name: "TU117 [GeForce GTX 1650]", vendor: "NVIDIA", category: "graphics",
                  modaliases: ["pci:v000010DEd00001F82sv00001043sd000087B4bc03sc00i00"], driver: "nouveau", firmwareMissing: [] },
                { id: "usb:1-4", bus: "usb", name: "USB device (1209:0001)", vendor: "", category: "other",
                  modaliases: ["usb:v1209p0001d0100dcFFdsc00dp00icFFisc00ip00in00"], driver: null, firmwareMissing: [] },
            ],
            info: async () => ({ arch: "x86_64", kernel: "6.6.23-phoenix" }),
            activate: async () => { w.loaded = w.installed.has("linux-firmware-rtw88") ? ["rtw88/rtw8821c_fw.bin"] : []; },
        },
        opkg: {
            list: async () => [...w.installed.keys()].map((name) => ({ name, version: "20240909-r0" })),
            install: async (paths: string[]) => { paths.forEach((p) => w.installed.set(p.split("/").pop()!.split("_")[0], [])); return { ok: true }; },
            remove: async (names: string[]) => { names.forEach((n) => w.installed.delete(n)); return { ok: true }; },
        },
        request: async (req: Any) => {
            if (req.method === "POST") { w.posts.push(JSON.parse(req.body)); return { status: 201, body: "{}" }; }
            const b = fromSample(req.url);
            return b ? { status: 200, body: Buffer.from(b).toString("utf8") } : { status: 404, body: "" };
        },
        requestBytes: async (req: Any) => {
            const b = fromSample(req.url);
            return b ? { status: 200, bytes: b } : { status: 404, bytes: new Uint8Array() };
        },
        crypto: {
            sha256: async (b: Uint8Array) => new Uint8Array(createHash("sha256").update(b).digest()),
            sha512: async (b: Uint8Array) => new Uint8Array(createHash("sha512").update(b).digest()),
        },
        files: {
            write: (n: string, b: Uint8Array) => { w.files.set(n, b); return "/cache/" + n; },
            find: (n: string) => (w.files.has(n) ? "/cache/" + n : null),
            remove: (p: string) => { w.files.delete(p.replace("/cache/", "")); },
        },
        state: { load: () => (w.state ? JSON.parse(JSON.stringify(w.state)) : null), save: (o: Any) => { w.state = JSON.parse(JSON.stringify(o)); } },
        config: () => config,
        luna: { call: async () => ({ returnValue: true }) },
    });
    return w;
}

// The page's PalmServiceBridge, answered by the service.
beforeEach(() => {
    world = makeWorld();
    calls = [];
    setBridgeFactory(() => {
        let stopped = false, stop: (() => void) | null = null;
        const bridge: Any = {
            onservicecallback: null,
            call(uri: string, json: string) {
                const params = JSON.parse(json);
                calls.push({ uri, params });
                const reply = (r: Any) => setTimeout(() => { if (!stopped) bridge.onservicecallback?.(JSON.stringify(r)); }, 0);
                const m = /^luna:\/\/org\.webosphoenix\.hardware\/(\w+)$/.exec(uri);
                if (!m) return reply({ returnValue: true });
                if (m[1] === "install" && params.subscribe) {
                    reply({ returnValue: true, subscribed: true, state: "queued" });
                    world.service.install(params, reply);
                    return;
                }
                world.service[m[1]](params).then((r: Any) => {
                    if (m[1] === "list" && params.subscribe) stop = world.service.watch(reply);
                    reply(r);
                });
            },
            cancel() { stopped = true; stop?.(); },
        };
        return bridge;
    });
});
afterAll(() => setBridgeFactory(null));

const device = (over: Partial<HardwareDevice>): HardwareDevice => ({
    id: "x", bus: "usb", name: "X", vendor: "", category: "other", ids: [], driver: null, firmwareMissing: [], status: "working", offers: [], ...over,
});

describe("Settings > Hardware", () => {
    it("says what each device needs", () => {
        const offer: Any = { optional: true, available: true, installed: false };
        expect(statusText(device({ status: "working" }))).toBe("Working");
        expect(statusText(device({ status: "working", offers: [offer] }))).toBe("Working · optional driver available");
        expect(statusText(device({ status: "needs-firmware" }))).toBe("Needs firmware");
        expect(statusText(device({ status: "needs-firmware", offers: [{ ...offer, optional: false }] }))).toBe("Needs firmware, available to install");
        expect(statusText(device({ status: "no-driver", offers: [{ ...offer, available: false, reason: "x" }] }))).toBe("No driver for this device yet");
        expect(statusText(device({ status: "restart" }))).toBe("Restart to finish installing");
    });

    it("lists the hardware, installs firmware after its licence, and the device works", async () => {
        render(<HardwarePage />);
        const realtek = await screen.findByTestId("hw-device-usb:1-2");
        expect(realtek.textContent).toMatch(/Needs firmware, available to install/);
        expect(screen.getByText("Needs attention")).toBeTruthy();
        expect(screen.getByTestId("hw-device-pci:0000:01:00.0").textContent).toMatch(/optional driver available/);
        expect(screen.getByTestId("hw-device-usb:1-4").textContent).toMatch(/No driver/);
        expect(screen.getByTestId("hw-catalog").textContent).toMatch(/Phoenix Drivers \(sample\)/);

        fireEvent.click(realtek);
        expect((await screen.findByTestId("hw-detail-missing")).textContent).toMatch(/rtw88\/rtw8821c_fw\.bin/);
        expect(screen.getByTestId("hw-offer-license").textContent).toMatch(/Realtek firmware licence/);
        expect(screen.getByTestId("hw-offer-license").textContent).toMatch(/Not open source/);
        expect(screen.getByTestId("hw-offer-size").textContent).toMatch(/KB|bytes|B/);
        fireEvent.click(screen.getByTestId("hw-install-firmware-rtw88"));
        // Nothing is installed before the licence is accepted.
        expect((await screen.findByTestId("hw-license-text")).textContent).toMatch(/LICENCE\.rtlwifi_firmware\.txt/);
        expect(calls.some((c) => c.uri.endsWith("/install"))).toBe(false);
        await act(async () => { fireEvent.click(screen.getByTestId("hw-license-accept")); });
        await waitFor(() => expect(screen.getByTestId("hw-notice").textContent).toBe("Realtek Wi-Fi firmware (rtw88) is installed."), { timeout: 3000 });
        const install = calls.find((c) => c.uri.endsWith("/install"))!;
        expect(install.params).toMatchObject({ driverId: "firmware-rtw88", deviceId: "usb:1-2", acceptLicense: "LicenseRef-rtlwifi-firmware" });
        await waitFor(() => expect(screen.getByTestId("hw-detail-status").textContent).toMatch(/Working/));
        expect(screen.getByTestId("hw-detail-driver").textContent).toMatch(/rtw88_8821cu/);
        expect(screen.getByTestId("hw-remove-firmware-rtw88")).toBeTruthy();
        expect(world.installed.has("linux-firmware-rtw88")).toBe(true);
    });

    it("installs an optional driver that starts after a restart", async () => {
        render(<HardwarePage />);
        fireEvent.click(await screen.findByTestId("hw-device-pci:0000:01:00.0"));
        fireEvent.click(await screen.findByTestId("hw-install-firmware-nvidia-gsp"));
        await act(async () => { fireEvent.click(await screen.findByTestId("hw-license-accept")); });
        await waitFor(() => expect(screen.getByTestId("hw-notice").textContent).toMatch(/starts when you restart/), { timeout: 3000 });
        await waitFor(() => expect(screen.getByTestId("hw-restart")).toBeTruthy());
        fireEvent.click(screen.getByTestId("hw-restart"));
        expect(calls.at(-1)?.uri).toBe("luna://com.palm.power/shutdown/machineReboot");
    });

    it("shows the hardware report before sending it, with IDs only", async () => {
        render(<HardwarePage />);
        fireEvent.click(await screen.findByTestId("hw-report-open"));
        const ids = await screen.findByTestId("hw-report-ids");
        expect(ids.textContent).toBe("usb:v1209p0001d0100dcFFdsc00dp00icFFisc00ip00in00");
        await act(async () => { fireEvent.click(screen.getByTestId("hw-report-send")); });
        await waitFor(() => expect(screen.getByTestId("hw-report-result").textContent).toBe("Sent. Thank you."));
        expect(world.posts).toEqual([{ format: 1, arch: "x86_64", kernel: "6.6.23",
                                       devices: [{ bus: "usb", ids: ["usb:v1209p0001d0100dcFFdsc00dp00icFFisc00ip00in00"], firmwareMissing: [] }] }]);
        fireEvent.click(screen.getByTestId("hw-report-toggle"));
        await waitFor(() => expect(world.state.report.enabled).toBe(true));
    });
});
