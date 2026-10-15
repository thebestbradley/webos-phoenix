// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Settings > Bluetooth > AirPods and Tracker Alerts (docs/ACCESSORIES.md)
// against the simulated services (runtime/phoenix-runtime.js "AirPods and
// tracker alerts"), with the simulated hardware played by applyHostStatus
// as phoenix-sim's Simulate > AirPods and Trackers sends it.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { bluetooth, call, earbuds, type EarbudsStatus } from "@phoenix/luna";
import { BluetoothPage, viewFromParams } from "./Bluetooth";
import { batteryLine } from "./Earbuds";
import { disableSteps, metres, minutes, TrackerDetail } from "./Trackers";

const hostMessages: { type: string; payload: Record<string, unknown> }[] = [];
type Runtime = { applyHostStatus(st: object, opts?: object): void };
const rt = () => (window as unknown as { __phoenixRuntime: Runtime }).__phoenixRuntime;
const status = () => call("luna://org.webosphoenix.earbuds/getStatus", {}) as unknown as Promise<EarbudsStatus>;

const POD = (over: object = {}) => ({ present: true, lidOpen: true, left: "case", right: "case",
                                      battery: { left: 100, right: 96, case: 80 }, charging: { left: true, right: true, case: false },
                                      stem: 0, at: Date.now(), ...over });

beforeAll(async () => {
    (window as unknown as Record<string, unknown>).phoenixHost = {
        postToHost: (type: string, payload: Record<string, unknown>) => hostMessages.push({ type, payload }),
    };
    new Function(readFileSync(resolve(__dirname, "../../../../runtime/phoenix-runtime.js"), "utf8")).call(window);
    await bluetooth.setPowered(true);
});
beforeEach(() => cleanup());

describe("AirPods", () => {
    it("formats the batteries", () => {
        expect(batteryLine({ left: 80, right: 70, case: 40 })).toBe("L 80% · R 70% · Case 40%");
        expect(batteryLine({ left: 80, right: -1, case: -1 })).toBe("L 80%");
        expect(batteryLine({ left: -1, right: -1, case: -1, single: 55 })).toBe("55%");
        expect(viewFromParams({ view: "tracker", id: "x" })).toEqual({ kind: "tracker", id: "x" });
        expect(viewFromParams({ view: "earbuds" })).toBeNull();
    });

    it("lists AirPods whose case opens nearby, pairs them with Connect, and shows them in Bluetooth", async () => {
        rt().applyHostStatus({ simAirPods: POD() });
        const s = await status();
        expect(s.nearby).toEqual([expect.objectContaining({ modelName: "AirPods", lidOpen: true, paired: "",
                                                            battery: { left: 100, right: 100, case: 80 } })]);
        // The shell heard it too (its card): systemStatus {earbuds}.
        expect(hostMessages.some((m) => m.type === "systemStatus" && (m.payload.earbuds as EarbudsStatus | undefined)?.nearby?.length === 1)).toBe(true);
        await earbuds.connect(s.nearby[0].id);
        expect((await status()).pairing).toMatchObject({ state: "searching" });
        await waitFor(async () => expect((await status()).pairing).toBeNull(), { timeout: 6000 });
        const after = await status();
        expect(after.devices).toEqual([expect.objectContaining({
            address: "a0:b1:c2:d3:e4:f5", name: "AirPods Pro", model: "AirPods Pro 2", modelNumber: "A2931", connected: true, aap: true,
            battery: { left: 100, right: 96, case: 80, single: -1 }, noiseMode: "anc",
            noiseModes: ["off", "transparency", "adaptive", "anc"], earDetection: true, conversationAwareness: true })]);
        expect(after.nearby[0].paired).toBe("a0:b1:c2:d3:e4:f5");

        render(<BluetoothPage />);
        const row = await screen.findByTestId("bt-a0:b1:c2:d3:e4:f5");
        expect(row.textContent).toContain("AirPods Pro");
        expect(row.textContent).toContain("L 100% · R 96% · Case 80%");
        // Its own page: the batteries, the listening modes, the settings.
        fireEvent.click(row);
        await screen.findByText("Noise Control");
        expect(screen.getByTestId("ab-left").textContent).toContain("100%");
        expect(screen.getByTestId("ab-case").textContent).toContain("80%");
        const checked = (m: string) => !!screen.getByTestId(`ab-mode-${m}`).querySelector(".pui-check");
        expect(checked("anc")).toBe(true);
        fireEvent.click(screen.getByTestId("ab-mode-transparency"));
        await waitFor(async () => expect((await status()).devices[0].noiseMode).toBe("transparency"));
        await waitFor(() => expect(checked("transparency")).toBe(true));
        expect(checked("anc")).toBe(false);
        fireEvent.click(screen.getByTestId("ab-ear-detection"));
        await waitFor(async () => expect((await status()).devices[0].earDetection).toBe(false));
        fireEvent.click(screen.getByTestId("ab-conversation"));
        await waitFor(async () => expect((await status()).devices[0].conversationAwareness).toBe(false));
        fireEvent.click(screen.getByTestId("ab-name"));
        fireEvent.change(await screen.findByTestId("ab-name-field"), { target: { value: "Pat's AirPods" } });
        fireEvent.click(screen.getByTestId("ab-name-done"));
        await waitFor(async () => expect((await status()).devices[0].name).toBe("Pat's AirPods"));
    });

    it("follows the AirPods: an earbud out and in an ear, the stem pressed, the case closed", async () => {
        rt().applyHostStatus({ simAirPods: POD({ left: "ear", right: "out" }) });
        let d = (await status()).devices[0];
        expect(d.inEar).toEqual({ left: "ear", right: "out" });
        expect(d.charging).toMatchObject({ left: false, right: false });
        // Press and hold the stem: the next listening mode (after Transparency, Adaptive).
        rt().applyHostStatus({ simAirPods: POD({ left: "ear", right: "out", stem: 1, at: Date.now() }) });
        d = (await status()).devices[0];
        expect(d.noiseMode).toBe("adaptive");
        // Both back and the lid closed: disconnected, not nearby.
        rt().applyHostStatus({ simAirPods: POD({ lidOpen: false, stem: 1 }) });
        const s = await status();
        expect(s.devices[0]).toMatchObject({ connected: false, aap: false, battery: { left: -1, right: -1, case: -1 } });
        expect(s.nearby).toEqual([]);
        // Settings > Bluetooth lists them as paired, not connected.
        const bt = await call("luna://com.webos.service.bluetooth2/device/getStatus", {}) as unknown as { devices: { address: string; connectedProfiles: string[] }[] };
        expect(bt.devices.find((x) => x.address === "a0:b1:c2:d3:e4:f5")?.connectedProfiles).toEqual([]);
    });

    it("forgets them", async () => {
        rt().applyHostStatus({ simAirPods: POD() });
        await earbuds.forget("a0:b1:c2:d3:e4:f5");
        expect((await status()).devices).toEqual([]);
        const bt = await call("luna://com.webos.service.bluetooth2/device/getStatus", {}) as unknown as { devices: { address: string }[] };
        expect(bt.devices.some((x) => x.address === "a0:b1:c2:d3:e4:f5")).toBe(false);
    });
});

describe("Tracker alerts", () => {
    it("words what it found", () => {
        expect(minutes(35 * 60000)).toBe("35 min");
        expect(minutes(130 * 60000)).toBe("2 h 10 min");
        expect(metres(1234)).toBe("1.2 km");
        expect(metres(350)).toBe("350 m");
        expect(disableSteps({ type: "airtag" })[1]).toMatch(/battery/);
    });

    it("alerts for an AirTag that follows, and its page plays its sound and says how to disable it", async () => {
        hostMessages.length = 0;
        rt().applyHostStatus({ simTracker: { follow: 1, kind: "airtag", at: Date.now() } });
        const note = hostMessages.find((m) => m.type === "notification");
        expect(note?.payload).toMatchObject({ appId: "org.webosphoenix.settings", title: "Unknown AirTag found moving with you",
                                              params: { page: "bluetooth", view: "tracker" } });
        const id = (note!.payload.params as { id: string }).id;
        render(<TrackerDetail id={id} />);
        await screen.findByText("This AirTag has been moving with you");
        expect(screen.getByTestId("tr-summary").textContent).toMatch(/Seen 4 times over 35 min, 1\.\d km apart/);
        expect(screen.getByTestId("tr-route")).toBeTruthy();
        fireEvent.click(screen.getByTestId("tr-play"));
        await screen.findByText("Connecting…");
        await screen.findByText("Playing Sound…", undefined, { timeout: 3000 });
        fireEvent.click(screen.getByTestId("tr-howto"));
        expect(screen.getByText(/round metal back/)).toBeTruthy();
        fireEvent.click(screen.getByTestId("tr-ignore"));
        await waitFor(async () => {
            const r = await call("luna://org.webosphoenix.trackers/getStatus", {}) as unknown as { trackers: { ignored: boolean }[] };
            expect(r.trackers[0].ignored).toBe(true);
        });
    });

    it("is listed under Bluetooth's Tracker Alerts, which can be turned off", async () => {
        render(<BluetoothPage />);
        const row = await screen.findByTestId("bt-trackers");
        await waitFor(() => expect(row.textContent).toContain("On"));
        fireEvent.click(row);
        await screen.findByText("Trackers seen");
        expect(screen.getByText("AirTag (moving with you)")).toBeTruthy();
        fireEvent.click(screen.getByTestId("tr-enabled"));
        await waitFor(async () => {
            const r = await call("luna://org.webosphoenix.trackers/getStatus", {}) as unknown as { enabled: boolean };
            expect(r.enabled).toBe(false);
        });
    });
});
