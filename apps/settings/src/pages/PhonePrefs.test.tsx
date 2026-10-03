// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Phone Preferences against the simulated telephony: call forwarding (and
// what it does to an incoming call and the status bar), caller ID, call
// waiting, the voicemail number, mobile data and roaming, voice roaming and
// the network type; none of the network's settings without the network.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";
import { call, mobileData, phonePrefs, TELEPHONY_NO_NETWORK, type CallForwarding, type LunaError, type MobileData } from "@phoenix/luna";
import { PhonePrefsPage, forwardable } from "./PhonePrefs";

const hostMessages: { type: string; payload: Record<string, unknown> }[] = [];
type Runtime = { hostStatus(): Record<string, unknown>; simulateIncomingCall(o?: object): number };
const runtime = () => (window as unknown as { __phoenixRuntime: Runtime }).__phoenixRuntime;
const lastStatus = () => [...hostMessages].reverse().find((m) => m.type === "systemStatus")?.payload ?? {};

beforeAll(() => {
    (window as unknown as Record<string, unknown>).phoenixHost = {
        postToHost: (type: string, payload: Record<string, unknown>) => hostMessages.push({ type, payload }),
    };
    new Function(readFileSync(resolve(__dirname, "../../../../runtime/phoenix-runtime.js"), "utf8")).call(window);
});

const forwarding = () => new Promise<CallForwarding>((res, rej) => { const s = phonePrefs.watchForwarding((f) => { s.cancel(); res(f); }, rej); });
const data = () => new Promise<MobileData>((res) => { const s = mobileData.watch((d) => { s.cancel(); res(d); }); });
const airplane = (on: boolean) => call("luna://com.webos.service.connectionmanager/setstate", { offlineMode: on ? "enabled" : "disabled" });

describe("the phone preferences' services", () => {
    it("forwards calls: the status bar shows it and calls do not ring", async () => {
        expect(await forwarding()).toEqual({ activated: false, number: "" });
        await phonePrefs.setForwarding("(408) 555-0177");
        expect(await forwarding()).toEqual({ activated: true, number: "(408) 555-0177" });
        expect(runtime().hostStatus().callForwarding).toBe(true);
        expect(lastStatus().callForwarding).toBe(true);
        expect(runtime().simulateIncomingCall({ number: "(415) 555-0123" })).toBe(0);
        await phonePrefs.setForwarding("");
        expect(await forwarding()).toEqual({ activated: false, number: "(408) 555-0177" });
        expect(runtime().hostStatus().callForwarding).toBe(false);
        const id = runtime().simulateIncomingCall({ number: "(415) 555-0123" });
        expect(id).toBeGreaterThan(0);
        await call("luna://com.palm.telephony/ignore", { id });
    });

    it("keeps caller ID, call waiting, voicemail, roaming and the network type", async () => {
        expect(await phonePrefs.callerIdShown()).toBe(true);
        await phonePrefs.setCallerIdShown(false);
        expect(await phonePrefs.callerIdShown()).toBe(false);
        expect(await phonePrefs.callWaiting()).toBe(true);
        await phonePrefs.setCallWaiting(false);
        expect(await phonePrefs.callWaiting()).toBe(false);
        await phonePrefs.setVoicemailNumber("+1 408 555 0101");
        const vm = await new Promise<string>((res) => { const s = phonePrefs.watchVoicemailNumber((n) => { s.cancel(); res(n); }); });
        expect(vm).toBe("+1 408 555 0101");
        expect(await phonePrefs.voiceRoaming()).toBe("automatic");
        await phonePrefs.setVoiceRoaming("carrieronly");
        expect(await phonePrefs.voiceRoaming()).toBe("carrieronly");
        await phonePrefs.setNetworkType("gsm");
        expect(await phonePrefs.networkType()).toBe("gsm");
        expect(await data()).toEqual({ enabled: true, roaming: false, connected: true });
        await mobileData.setRoaming(true);
        await mobileData.setEnabled(false);
        expect(await data()).toEqual({ enabled: false, roaming: true, connected: false });
        await mobileData.setEnabled(true);
        await mobileData.setRoaming(false);
    });

    it("cannot reach the network's settings in airplane mode", async () => {
        await airplane(true);
        const code = (p: Promise<unknown>) => p.then(() => 0, (e: LunaError) => e.errorCode);
        expect(await code(forwarding())).toBe(TELEPHONY_NO_NETWORK);
        expect(await code(phonePrefs.setForwarding("5550100"))).toBe(TELEPHONY_NO_NETWORK);
        expect(await code(phonePrefs.callWaiting())).toBe(TELEPHONY_NO_NETWORK);
        await airplane(false);
        expect(await code(phonePrefs.callWaiting())).toBe(0);
    });
});

describe("Settings > Phone Preferences", () => {
    it("checks a forwarding number", () => {
        expect(forwardable("555")).toBe(true);
        expect(forwardable("(408) 555-0177")).toBe(true);
        expect(forwardable("ab")).toBe(false);
    });

    it("turns on call forwarding to a number and off again", async () => {
        render(<PhonePrefsPage />);
        const toggle = await screen.findByTestId("phone-forward");
        fireEvent.click(toggle);
        const field = await screen.findByTestId("phone-forward-number");
        fireEvent.change(field, { target: { value: "408 555 0177" } });
        fireEvent.click(screen.getByTestId("phone-forward-save"));
        await waitFor(async () => expect(await forwarding()).toEqual({ activated: true, number: "408 555 0177" }));
        await waitFor(() => expect(screen.getByTestId("phone-forward").getAttribute("aria-checked")).toBe("true"));
        // Caller ID and call waiting, read from the network.
        const waiting = await screen.findByTestId("phone-waiting");
        expect(waiting.getAttribute("aria-checked")).toBe("false");
        fireEvent.click(waiting);
        await waitFor(async () => expect(await phonePrefs.callWaiting()).toBe(true));
        // Data roaming.
        fireEvent.click(screen.getByTestId("phone-roaming"));
        fireEvent.click(await screen.findByRole("option", { name: "Enabled" }));
        await waitFor(async () => expect((await data()).roaming).toBe(true));
        // Off.
        fireEvent.click(screen.getByTestId("phone-forward"));
        await waitFor(async () => expect((await forwarding()).activated).toBe(false));
    });
});
