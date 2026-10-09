// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Wi-Fi's {join} launch param (QR Scanner's Wi-Fi codes): the join dialog
// opens filled in, against the simulated wifi service. The Proxy group:
// the system preference networkProxy, and the shell hears it (systemStatus).

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";
import { call } from "@phoenix/luna";
import { joinFromParams, proxyProblem, WifiPage } from "./Wifi";

const hostMessages: { type: string; payload: Record<string, unknown> }[] = [];

beforeAll(() => {
    (window as unknown as Record<string, unknown>).phoenixHost = {
        postToHost: (type: string, payload: Record<string, unknown>) => hostMessages.push({ type, payload }),
    };
    const src = readFileSync(resolve(__dirname, "../../../../runtime/phoenix-runtime.js"), "utf8");
    new Function(src).call(window);
});

describe("Wi-Fi join from a launch", () => {
    it("reads the join param", () => {
        expect(joinFromParams({ ssid: "Lab", security: "psk", passKey: "webos2009" }))
            .toEqual({ ssid: "Lab", security: "psk", other: false, passKey: "webos2009" });
        expect(joinFromParams({ ssid: "Cafe", security: "none" })).toMatchObject({ security: "none", passKey: undefined });
        expect(joinFromParams({ ssid: "Hidden", security: "wep", hidden: true })).toMatchObject({ security: "wep", other: true });
        expect(joinFromParams({ ssid: "" })).toBeNull();
        expect(joinFromParams("Lab")).toBeNull();
        expect(joinFromParams(undefined)).toBeNull();
    });

    it("opens the join dialog with the password filled in", async () => {
        (window as unknown as { PalmSystem: { launchParams: string } }).PalmSystem.launchParams =
            JSON.stringify({ page: "wifi", join: { ssid: "Lab 5G", security: "psk", passKey: "webos2009" } });
        render(<WifiPage />);
        await waitFor(() => expect(screen.getByTestId("wifi-join")).toBeTruthy());
        expect(screen.getByTestId("wifi-join").textContent).toContain("Lab 5G");
        const pw = screen.getByTestId("wifi-password").querySelector("input") ?? screen.getByTestId("wifi-password");
        expect((pw as HTMLInputElement).value).toBe("webos2009");
    });
});

describe("Wi-Fi > Proxy", () => {
    it("checks the server and the port", () => {
        expect(proxyProblem("none", "", "")).toBeNull();
        expect(proxyProblem("http", "proxy.lan", "3128")).toBeNull();
        expect(proxyProblem("socks", "10.0.0.9", "1080")).toBeNull();
        expect(proxyProblem("http", "", "3128")).toMatch(/server/);
        expect(proxyProblem("http", "proxy lan", "3128")).toMatch(/server/);
        expect(proxyProblem("http", "proxy.lan", "0")).toMatch(/port/);
        expect(proxyProblem("http", "proxy.lan", "70000")).toMatch(/port/);
    });

    it("saves an HTTP proxy for the whole system, and None again", async () => {
        cleanup();
        (window as unknown as { PalmSystem: { launchParams: string } }).PalmSystem.launchParams = JSON.stringify({ page: "wifi" });
        render(<WifiPage />);
        fireEvent.click(await screen.findByTestId("proxy-type"));
        fireEvent.click(await screen.findByText("HTTP"));
        const field = (id: string) => (screen.getByTestId(id).querySelector("input") ?? screen.getByTestId(id)) as HTMLInputElement;
        await waitFor(() => expect(screen.getByTestId("proxy-host")).toBeTruthy());
        fireEvent.change(field("proxy-host"), { target: { value: "proxy.lan" } });
        fireEvent.change(field("proxy-port"), { target: { value: "99999" } });
        expect(screen.getByTestId("proxy-problem").textContent).toMatch(/port/);
        expect((screen.getByTestId("proxy-save") as HTMLButtonElement).disabled).toBe(true);
        fireEvent.change(field("proxy-port"), { target: { value: "3128" } });
        fireEvent.click(screen.getByTestId("proxy-save"));
        await waitFor(async () => expect((await call("luna://com.webos.service.systemservice/getPreferences", { keys: ["networkProxy"] })).networkProxy)
            .toEqual({ type: "http", host: "proxy.lan", port: 3128 }));
        // The shell gets it (phoenix-sim's simBrowser sets the proxy).
        await waitFor(() => expect(hostMessages.filter((m) => m.type === "systemStatus").pop()!.payload.proxy)
            .toEqual({ type: "http", host: "proxy.lan", port: 3128 }));
        fireEvent.click(screen.getByTestId("proxy-type"));
        fireEvent.click(await screen.findByText("None"));
        await waitFor(async () => expect((await call("luna://com.webos.service.systemservice/getPreferences", { keys: ["networkProxy"] })).networkProxy)
            .toEqual({ type: "none", host: "", port: 0 }));
    });
});

// The system menu's Wi-Fi drawer (phoenix-sim): the shell hears the networks
// Settings lists (systemStatus wifiNetworks) and asks to join one
// (applyHostStatus {wifiConnect}); it had a list of its own.
describe("Wi-Fi in the system menu", () => {
    type Net = { ssid: string; bars: number; security: string; known: boolean; state: string };
    const lastNetworks = () => {
        for (let i = hostMessages.length - 1; i >= 0; --i) {
            const p = hostMessages[i].payload;
            if (hostMessages[i].type === "systemStatus" && p.wifiNetworks) return p.wifiNetworks as Net[];
        }
        return null;
    };
    const rt = () => (window as unknown as { __phoenixRuntime: { applyHostStatus(s: object): void; hostStatus(): { wifiNetworks: Net[] } } }).__phoenixRuntime;

    it("reports the networks Settings lists, and joins the one the menu picks", async () => {
        const nets = rt().hostStatus().wifiNetworks;
        expect(nets.map((n) => n.ssid)).toEqual(expect.arrayContaining(["Phoenix", "Sunnyvale Cafe", "Lab 5G"]));
        expect(nets.find((n) => n.ssid === "Sunnyvale Cafe")).toMatchObject({ security: "" });
        rt().applyHostStatus({ wifiConnect: "Sunnyvale Cafe" });
        await waitFor(() => expect(lastNetworks()?.find((n) => n.ssid === "Sunnyvale Cafe")?.state).toBe("ipConfigured"), { timeout: 3000 });
        expect(lastNetworks()?.find((n) => n.ssid === "Sunnyvale Cafe")?.known).toBe(true);
        expect(lastNetworks()?.filter((n) => n.state === "ipConfigured").length).toBe(1);
        const st = (await call("luna://com.webos.service.wifi/getstatus", {})) as { networkInfo?: { ssid: string } };
        expect(st.networkInfo?.ssid).toBe("Sunnyvale Cafe");
    });
});
