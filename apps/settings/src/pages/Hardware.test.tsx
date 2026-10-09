// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Settings > Hardware against the real org.webosphoenix.hardware service
// (services/hardware/hardwareservice.js) and the simulator's signed sample
// catalog (server/drivers/sample), on a made-up device whose image has its
// firmware: a Realtek dongle the catalog has newer firmware for, an
// RTL8812AU the 6.6 kernel has no driver for, an NVIDIA card, a USB gadget
// nothing drives. The page's luna calls go straight to the service.
// End to end in the simulator's runtime: tools/test-hardware.cjs.

import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { deviceTitle, reflowLicense, setBridgeFactory, type HardwareDevice } from "@phoenix/luna";
import { FirmwareLicenses, HardwarePage, statusText } from "./Hardware";

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
    // The image's packages, then what is installed.
    const w: Any = { installed: new Map<string, string>([["linux-firmware-rtl8821", "20240909-r0"], ["linux-firmware-nvidia-gpu", "20240909-r0"]]),
                     loaded: [] as string[], files: new Map<string, Uint8Array>(), state: null, posts: [] };
    const fromSample = (url: string) => {
        const m = /^file:\/\/\/usr\/share\/phoenix\/hardware\/sample\/(.*)$/.exec(url);
        try { return m ? new Uint8Array(readFileSync(resolve(SAMPLE, m[1]))) : null; } catch { return null; }
    };
    w.service = createHardwareService({
        system: {
            scan: async () => [
                { id: "usb:1-2", bus: "usb", name: "RTL8821CU USB Wi-Fi Adapter", vendor: "Realtek", category: "wifi",
                  modaliases: ["usb:v0BDApC811d0200dc00dsc00dp00icFFiscFFipFFin00"], driver: "rtw88_8821cu", firmwareMissing: [] },
                { id: "usb:1-3", bus: "usb", name: "RTL8812AU USB Wi-Fi Adapter", vendor: "Realtek", category: "wifi",
                  modaliases: ["usb:v0BDAp8812d0000dc00dsc00dp00icFFiscFFipFFin00"],
                  driver: w.loaded.includes("88XXau") ? "88XXau" : null, firmwareMissing: [] },
                { id: "pci:0000:01:00.0", bus: "pci", name: "TU117 [GeForce GTX 1650]", vendor: "NVIDIA", category: "graphics",
                  modaliases: ["pci:v000010DEd00001F82sv00001043sd000087B4bc03sc00i00"], driver: "nouveau", firmwareMissing: [] },
                { id: "usb:1-4", bus: "usb", name: "USB device (1209:0001)", vendor: "", category: "other",
                  modaliases: ["usb:v1209p0001d0100dcFFdsc00dp00icFFisc00ip00in00"], driver: null, firmwareMissing: [] },
            ],
            info: async () => ({ arch: "x86_64", kernel: "6.6.23-phoenix" }),
            activate: async () => { w.loaded = [...w.installed.keys()].some((n) => n.startsWith("kernel-module-88xxau")) ? ["88XXau"] : []; },
        },
        opkg: {
            list: async () => [...w.installed].map(([name, version]) => ({ name, version })),
            install: async (paths: string[]) => {
                paths.forEach((p) => { const [n, v] = p.split("/").pop()!.split("_"); w.installed.set(n, v); });
                return { ok: true };
            },
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
        imageFirmware: {
            list: () => JSON.parse(readFileSync(resolve(SAMPLE, "firmware-in-image.json"), "utf8")).packages,
            text: (p: string) => readFileSync(resolve(SAMPLE, "licences", p.split("/").pop()!), "utf8"),
        },
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
        expect(statusText(device({ status: "working", offers: [{ ...offer, update: true }] }))).toBe("Working · newer firmware available");
        expect(statusText(device({ status: "needs-firmware" }))).toBe("Needs firmware");
        expect(statusText(device({ status: "needs-firmware", offers: [{ ...offer, optional: false }] }))).toBe("Needs firmware, available to install");
        expect(statusText(device({ status: "no-driver", offers: [{ ...offer, available: false, reason: "x" }] }))).toBe("No driver for this device yet");
        expect(statusText(device({ status: "restart" }))).toBe("Restart to finish installing");
    });

    it("names devices with their maker, and reflows licence files", () => {
        expect(deviceTitle({ name: "RTL8821CU USB Wi-Fi Adapter", vendor: "Realtek" })).toBe("Realtek RTL8821CU USB Wi-Fi Adapter");
        expect(deviceTitle({ name: "Realtek 802.11ac NIC", vendor: "Realtek" })).toBe("Realtek 802.11ac NIC");
        expect(reflowLicense("Redistribution and use in binary\nform are permitted:\n\n* Redistributions must\n  reproduce it\n* No reverse\nengineering.\n1. One\n"))
            .toBe("Redistribution and use in binary form are permitted:\n\n* Redistributions must\n  reproduce it\n* No reverse engineering.\n1. One\n");
    });

    it("lists the hardware and what fills its gaps; installs a driver the kernel lacks", async () => {
        render(<HardwarePage />);
        const rtl8812 = await screen.findByTestId("hw-device-usb:1-3");
        expect(rtl8812.textContent).toMatch(/Needs a driver, available to install/);
        expect(screen.getByText("Needs attention")).toBeTruthy();
        expect(screen.getByTestId("hw-device-usb:1-2").textContent).toMatch(/Working · newer firmware available/);
        expect(screen.getByTestId("hw-device-pci:0000:01:00.0").textContent).toMatch(/Working$/);
        expect(screen.getByTestId("hw-device-usb:1-4").textContent).toMatch(/No driver/);
        expect(screen.getByTestId("hw-catalog").textContent).toMatch(/Phoenix Drivers \(sample\)/);
        // Open source: no licence to accept.
        fireEvent.click(rtl8812);
        await act(async () => { fireEvent.click(await screen.findByTestId("hw-install-module-rtl8812au")); });
        await waitFor(() => expect(screen.getByTestId("hw-notice").textContent).toBe("Realtek RTL8812AU Wi-Fi driver is installed."), { timeout: 3000 });
        await waitFor(() => expect(screen.getByTestId("hw-detail-status").textContent).toMatch(/Working/));
        expect(screen.getByTestId("hw-detail-driver").textContent).toMatch(/88XXau/);
    });

    it("updates firmware the system has to a newer one, after its licence", async () => {
        render(<HardwarePage />);
        fireEvent.click(await screen.findByTestId("hw-device-usb:1-2"));
        expect((await screen.findByTestId("hw-offer-included")).textContent).toMatch(/20240909-r0/);
        expect(screen.getByTestId("hw-offer-license").textContent).toMatch(/Realtek firmware licence/);
        expect(screen.getByTestId("hw-offer-license").textContent).toMatch(/Not open source/);
        fireEvent.click(screen.getByTestId("hw-install-firmware-rtw88-update"));
        // Nothing is installed before the licence is accepted.
        expect((await screen.findByTestId("hw-license-text")).textContent).toMatch(/LICENCE\.rtlwifi_firmware\.txt/);
        expect(calls.some((c) => c.uri.endsWith("/install"))).toBe(false);
        await act(async () => { fireEvent.click(screen.getByTestId("hw-license-accept")); });
        await waitFor(() => expect(screen.getByTestId("hw-notice").textContent).toBe("Newer Realtek Wi-Fi firmware (rtw88) is installed."), { timeout: 3000 });
        const install = calls.find((c) => c.uri.endsWith("/install"))!;
        expect(install.params).toMatchObject({ driverId: "firmware-rtw88-update", deviceId: "usb:1-2", acceptLicense: "LicenseRef-rtlwifi-firmware" });
        expect(world.installed.get("linux-firmware-rtw88-update")).toBe("20250311-r0");
        expect(world.installed.get("linux-firmware-rtl8821")).toBe("20240909-r0");
        await waitFor(() => expect(screen.getByTestId("hw-remove-firmware-rtw88-update")).toBeTruthy());
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

    it("shows the image's firmware and its licences in Device Info", async () => {
        render(<FirmwareLicenses />);
        expect((await screen.findByTestId("firmware-packages")).textContent).toMatch(/linux-firmware-rtl8821 20240909-r0 \(Firmware-rtlwifi_firmware\)/);
        fireEvent.click(screen.getByTestId("firmware-license-LICENCE.nvidia"));
        expect(await screen.findByText(/LICENCE\.nvidia, which a Phoenix/)).toBeTruthy();
    });
});
