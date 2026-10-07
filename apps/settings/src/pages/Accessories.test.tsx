// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Settings > Game Controllers, USB, Hotspot & Tethering and Battery
// (docs/M6-PLAN.md F4 items 8-9) against the simulated services
// (runtime/phoenix-runtime.js "Accessories, tethering and the battery's
// use"), with the shell's status played by applyHostStatus, as
// phoenix-sim's Simulate menu sends it.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { call } from "@phoenix/luna";
import { GameControllersPage } from "./GameControllers";
import { UsbPage, sizeText } from "./Usb";
import { HotspotPage, hotspotProblem } from "./Hotspot";
import { BatteryPage, durationText, levelPath } from "./Battery";

const hostMessages: { type: string; payload: Record<string, unknown> }[] = [];
type Runtime = { applyHostStatus(st: object, opts?: object): void; setPower(p: object): void };
const rt = () => (window as unknown as { __phoenixRuntime: Runtime }).__phoenixRuntime;

beforeAll(() => {
    (window as unknown as Record<string, unknown>).phoenixHost = {
        postToHost: (type: string, payload: Record<string, unknown>) => hostMessages.push({ type, payload }),
    };
    new Function(readFileSync(resolve(__dirname, "../../../../runtime/phoenix-runtime.js"), "utf8")).call(window);
});
beforeEach(() => cleanup());

const PAD = { index: 0, id: "Phoenix Wireless Controller (STANDARD GAMEPAD Vendor: 2d50 Product: 0001)", name: "Phoenix Wireless Controller",
              connection: "bluetooth", mapping: "standard", buttons: [] as number[], axes: [0, 0, 0, 0] };

describe("Game Controllers", () => {
    it("lists a controller the simulator connects, and web apps get it from the Gamepad API", async () => {
        const events: string[] = [];
        window.addEventListener("gamepadconnected", (e) => events.push("connected " + (e as unknown as { gamepad: Gamepad }).gamepad.id));
        render(<GameControllersPage />);
        await screen.findByTestId("gp-none");
        rt().applyHostStatus({ gamepads: [PAD] });
        await screen.findByText("Bluetooth");
        expect(events).toEqual(["connected " + PAD.id]);
        const pads = navigator.getGamepads().filter(Boolean) as Gamepad[];
        expect(pads).toHaveLength(1);
        expect(pads[0]).toMatchObject({ id: PAD.id, index: 0, connected: true, mapping: "standard" });
        expect(pads[0].buttons).toHaveLength(17);
        // A held for a moment: the test row shows it, and so does the API.
        rt().applyHostStatus({ gamepads: [{ ...PAD, buttons: [0] }] });
        await waitFor(() => expect(screen.getByText("A").className).toContain("gp-pressed"));
        expect((navigator.getGamepads()[0] as Gamepad).buttons[0].pressed).toBe(true);
        rt().applyHostStatus({ gamepads: [] });
        await screen.findByTestId("gp-none");
        expect(navigator.getGamepads().filter(Boolean)).toHaveLength(0);
    });
});

describe("USB", () => {
    it("shows a drive in the device's port, and removes it safely", async () => {
        expect(sizeText(16008609792)).toBe("16.0 GB");
        render(<UsbPage />);
        await screen.findByTestId("usb-none");
        hostMessages.length = 0;
        rt().applyHostStatus({ usbDrives: [{ id: "sda1", label: "PHOENIX", vendor: "SanDisk Cruzer Blade", size: 16008609792, used: 5368709120, fs: "vfat" }] });
        await screen.findByText("10.6 GB free of 16.0 GB");
        expect(hostMessages.find((m) => m.type === "notification")?.payload).toMatchObject({ title: "PHOENIX connected", params: { page: "usb" } });
        fireEvent.click(screen.getByTestId("usb-remove-sda1"));
        await screen.findByText("Safe to remove");
        const r = await call("luna://org.webosphoenix.usb/listDrives", {});
        expect((r as unknown as { drives: { mounted: boolean; path: string }[] }).drives[0]).toMatchObject({ mounted: false, path: "" });
        fireEvent.click(screen.getByTestId("usb-mount-sda1"));
        await screen.findByText("10.6 GB free of 16.0 GB");
        rt().applyHostStatus({ usbDrives: [] });
        await screen.findByTestId("usb-none");
    });
});

describe("Hotspot & Tethering", () => {
    it("checks the name and password", () => {
        expect(hotspotProblem("Phoenix", "wpa2", "webos2009")).toBeNull();
        expect(hotspotProblem("Phoenix", "open", "")).toBeNull();
        expect(hotspotProblem("", "open", "")).toMatch(/name/);
        expect(hotspotProblem("Phoenix", "wpa2", "short")).toMatch(/8 to 63/);
    });

    it("shares the mobile data over Wi-Fi and USB on a phone, with an ongoing activity", async () => {
        rt().applyHostStatus({ formFactor: "phone" });
        render(<HotspotPage />);
        const field = (id: string) => (screen.getByTestId(id).querySelector("input") ?? screen.getByTestId(id)) as HTMLInputElement;
        await screen.findByTestId("ht-ssid");
        expect(field("ht-ssid").value).toBe("Phoenix Hotspot");
        // No password yet: the hotspot cannot go on.
        expect(screen.getByTestId("ht-wifi").getAttribute("aria-disabled") === "true" || (screen.getByTestId("ht-wifi") as HTMLButtonElement).disabled).toBe(true);
        fireEvent.change(field("ht-password"), { target: { value: "webos2009" } });
        fireEvent.click(screen.getByTestId("ht-save"));
        await waitFor(() => expect(field("ht-password").value).toBe("webos2009"));
        fireEvent.click(screen.getByTestId("ht-wifi"));
        await screen.findByText("On as “Phoenix Hotspot”");
        expect(hostMessages.filter((m) => m.type === "ongoing").pop()!.payload).toMatchObject({ id: "tethering", params: { page: "hotspot" } });
        fireEvent.click(screen.getByTestId("ht-usb"));
        await screen.findByText("On: connect a USB cable");
        expect(String(hostMessages.filter((m) => m.type === "ongoing").pop()!.payload.body)).toMatch(/Wi-Fi hotspot .* and USB tethering on/);
        fireEvent.click(screen.getByTestId("ht-wifi"));
        fireEvent.click(screen.getByTestId("ht-usb"));
        await waitFor(() => expect(hostMessages.filter((m) => m.type === "ongoing").pop()!.payload).toMatchObject({ id: "tethering", clear: true }));
    });

    it("has nothing to share on a tablet", async () => {
        rt().applyHostStatus({ formFactor: "tablet" });
        render(<HotspotPage />);
        await screen.findByTestId("ht-unavailable");
        const r = await call("luna://org.webosphoenix.tethering/setWifi", { enabled: true }).catch((e) => e);
        expect(String((r as { errorText?: string }).errorText)).toMatch(/no mobile data/);
        rt().applyHostStatus({ formFactor: "phone" });
    });
});

describe("Battery", () => {
    it("draws the level and estimates each app's share from its time on screen", async () => {
        expect(durationText(30_000)).toBe("less than a minute");
        expect(durationText(65 * 60_000)).toBe("1 h 5 min");
        const now = 1_000_000_000_000;
        expect(levelPath([{ t: now - 12 * 3600_000, percent: 100 }, { t: now - 6 * 3600_000, percent: 50 }], now, 600, 100))
            .toBe("M300.0,0.0 H450.0 V50.0 H600");
        render(<BatteryPage />);
        // The simulator's demo day (first use), then what the shell reports.
        await screen.findByTestId("bat-app-com.palm.app.email");
        rt().applyHostStatus({ usageTick: { appId: "org.webosphoenix.weather", ms: 90 * 60_000, at: Date.now() } });
        await waitFor(() => expect(screen.getByTestId("bat-app-org.webosphoenix.weather").textContent).toMatch(/1 h 30 min on screen/));
        // The first in the list is the one used most.
        expect(document.querySelector(".bat-app")!.getAttribute("data-testid")).toBe("bat-app-org.webosphoenix.weather");
        rt().setPower({ percent: 42 });
        await screen.findByText("42%");
        expect(screen.getByTestId("bat-line").getAttribute("d")).toMatch(/^M/);
    });
});
