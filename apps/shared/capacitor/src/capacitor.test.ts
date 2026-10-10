// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installFakeBus, type FakeBus } from "@phoenix/sdk/testing";
import { Phoenix } from "./index";

type G = { PalmSystem?: { launchParams: string; appIdentifier: string; stageReady?: () => void } };
const g = globalThis as G;
let bus: FakeBus;

beforeEach(() => {
    bus = installFakeBus();
    g.PalmSystem = { launchParams: JSON.stringify({ share: { text: "from launch" } }), appIdentifier: "com.example.ionic", stageReady: vi.fn() };
});
afterEach(async () => {
    await Phoenix.removeAllListeners();
    bus.uninstall();
    delete g.PalmSystem;
});

describe("@phoenix/capacitor", () => {
    it("is a registered Capacitor plugin with the web implementation over the SDK", async () => {
        const info = await Phoenix.getInfo();
        expect(info.appId).toBe("com.example.ionic");
        expect(info.capabilities.share).toBe(true);
        expect((await Phoenix.has({ capability: "pickers" })).value).toBe(true);
    });

    it("shares and picks over the bus", async () => {
        bus.handle("luna://org.webosphoenix.share/open", () => ({ action: "cancel" }));
        bus.handle("luna://org.webosphoenix.filepicker/pick", () => ({ canceled: true }));
        await expect(Phoenix.share({ text: "hi" })).resolves.toMatchObject({ action: "cancel" });
        await expect(Phoenix.pickFiles({ kinds: ["image"] })).resolves.toEqual({ files: [], canceled: true });
        expect(bus.calls.map((c) => c.uri)).toEqual(["luna://org.webosphoenix.share/open", "luna://org.webosphoenix.filepicker/pick"]);
    });

    it("rejects with the PhoenixError's text", async () => {
        bus.handle("luna://x/y", () => { throw { errorCode: 7, errorText: "nope" }; });
        await expect(Phoenix.request({ uri: "luna://x/y" })).rejects.toMatchObject({ errorCode: 7, code: "failed" });
    });

    it("delivers the launch's share to the first listener, and later events", async () => {
        const shares: unknown[] = [];
        const menus: number[] = [];
        await Phoenix.addListener("share", (s) => shares.push(s));
        await Phoenix.addListener("appMenu", () => menus.push(1));
        document.dispatchEvent(new CustomEvent("phoenixAppMenu"));
        document.dispatchEvent(new CustomEvent("webOSRelaunch", { detail: { share: { url: "https://x" } } }));
        expect(shares).toEqual([{ text: "from launch" }, { url: "https://x" }]);
        expect(menus).toEqual([1]);
    });

    it("takes the back gesture only while backButton has a listener", async () => {
        const back = vi.fn();
        await Phoenix.getInfo();
        const e1 = new KeyboardEvent("keydown", { key: "Escape", cancelable: true });
        window.dispatchEvent(e1);
        expect(e1.defaultPrevented).toBe(false);
        const h = await Phoenix.addListener("backButton", back);
        const e2 = new KeyboardEvent("keydown", { key: "Escape", cancelable: true });
        window.dispatchEvent(e2);
        expect(e2.defaultPrevented).toBe(true);
        expect(back).toHaveBeenCalledTimes(1);
        await h.remove();
    });
});
