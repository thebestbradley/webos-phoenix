// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Device Info's web engine (docs/APP-RUNTIME.md, "The web engine and the
// user agent"): the engine as osInfo reports it (phoenix-sim's
// phoenix_web_engine_* keys), the Chrome version this page's user agent
// names, and no engine row where osInfo has none (a device's OSE).

import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sys = vi.hoisted(() => ({ os: {} as Record<string, unknown> }));
vi.mock("@phoenix/luna", async (orig) => {
    const real = await orig<typeof import("@phoenix/luna")>();
    return {
        ...real,
        system: {
            ...real.system,
            deviceInfo: () => Promise.resolve({ device_name: "Phoenix Simulator" }),
            osInfo: () => Promise.resolve(sys.os),
        },
        telephony: { ...real.telephony, platform: () => Promise.reject(new Error("no modem")) },
        call: () => Promise.reject(new Error("not here")),
    };
});
vi.mock("../../../../NOTICE?raw", () => ({ default: "" }));
vi.mock("../../../../LICENSE?raw", () => ({ default: "" }));

import { DeviceInfoPage } from "./DeviceInfo";
import { BackProvider } from "../nav";

const PHONE_UA = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Mobile Safari/537.36";

beforeEach(() => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(PHONE_UA);
});
afterEach(() => {
    vi.restoreAllMocks();
});

describe("Settings > Device Info: the web engine", () => {
    it("shows the engine as it is, and the Chrome version sites are told", async () => {
        sys.os = { webos_name: "webOS Phoenix", webos_release: "1.0.0", phoenix_web_engine: "Chromium",
                   phoenix_web_engine_version: "140.0.7339.225", phoenix_web_engine_security_patches: "153.0.8010.52" };
        render(<BackProvider><DeviceInfoPage /></BackProvider>);
        const engine = await screen.findByTestId("web-engine");
        expect(engine.textContent).toBe("Web engineChromium 140.0.7339.225 (security patches 153.0.8010.52)");
        expect(screen.getByTestId("web-user-agent").textContent).toBe("Sites seeChrome 155");
    });

    it("leaves the engine out where osInfo does not report it", async () => {
        sys.os = { webos_name: "webOS Phoenix", webos_release: "1.0.0" };
        render(<BackProvider><DeviceInfoPage /></BackProvider>);
        expect(await screen.findByTestId("web-user-agent")).toBeTruthy();
        expect(screen.queryByTestId("web-engine")).toBeNull();
    });
});
