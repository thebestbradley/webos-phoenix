// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Wi-Fi's {join} launch param (QR Scanner's Wi-Fi codes): the join dialog
// opens filled in, against the simulated wifi service.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";
import { joinFromParams, WifiPage } from "./Wifi";

beforeAll(() => {
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
