// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0

import { render } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { request, setTransport, subscribeTo, transport } from "@phoenix/sdk";
import LS2Request from "./test/LS2Request";
import { ls2Transport, PhoenixDecorator, PhoenixHeader, phoenixAgate, useBack } from "./index";

type G = { PalmServiceBridge?: unknown };
const g = globalThis as G;

afterEach(() => {
    setTransport(null);
    LS2Request.sent = [];
    delete g.PalmServiceBridge;
    document.documentElement.classList.remove("phx-enact");
});

describe("@phoenix/enact", () => {
    it("carries the SDK's requests over LS2Request", async () => {
        g.PalmServiceBridge = class {};
        setTransport(ls2Transport());
        const p = request("luna://com.webos.service.systemservice/time/getSystemTime", { a: 1 });
        const s = LS2Request.sent[0];
        expect([s.service, s.method, s.parameters, s.subscribe]).toEqual(["luna://com.webos.service.systemservice", "time/getSystemTime", { a: 1 }, false]);
        s.onSuccess?.({ returnValue: true, utc: 5 });
        await expect(p).resolves.toMatchObject({ utc: 5 });

        const q = request("luna://x.y/z");
        LS2Request.sent[1].onFailure?.({ returnValue: false, errorCode: 3, errorText: "bad" });
        await expect(q).rejects.toMatchObject({ errorCode: 3, errorText: "bad" });
    });

    it("subscribes and cancels through LS2Request", () => {
        g.PalmServiceBridge = class {};
        setTransport(ls2Transport());
        const seen: unknown[] = [];
        const w = subscribeTo<{ n: number }>("luna://a.b/watch", {}, (r) => seen.push(r.n));
        const s = LS2Request.sent[0];
        expect(s.subscribe).toBe(true);
        expect(s.parameters).toEqual({});
        s.onSuccess?.({ returnValue: true, n: 1 });
        s.onSuccess?.({ returnValue: true, n: 2 });
        w.cancel();
        expect(s.cancelled).toBe(true);
        expect(seen).toEqual([1, 2]);
    });

    it("fails as unavailable outside webOS, without asking LS2Request", async () => {
        vi.spyOn(console, "warn").mockImplementation(() => {});
        setTransport(ls2Transport());
        await expect(request("luna://a.b/c")).rejects.toMatchObject({ code: "unavailable" });
        expect(LS2Request.sent).toHaveLength(0);
    });

    it("PhoenixDecorator installs LS2Request and the design layer", () => {
        const App = PhoenixDecorator(() => createElement(PhoenixHeader, { title: "Notes" }));
        expect(transport().name).toBe("ls2");
        const { container } = render(createElement(App));
        expect(container.querySelector(".phx-header")?.textContent).toBe("Notes");
        expect(document.getElementById("phoenix-sdk-theme")).not.toBeNull();
        expect(document.documentElement.classList.contains("phx-enact")).toBe(true);
        expect(phoenixAgate.accent).toBe("#1f75bf");
    });

    it("re-exports the React hooks", () => {
        expect(typeof useBack).toBe("function");
    });
});
