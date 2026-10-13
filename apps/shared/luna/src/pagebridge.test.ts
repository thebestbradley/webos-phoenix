// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// A page view's bridge in runtime/phoenix-runtime.js (BrowserAdapter,
// "setPageBridge"), on a phoenix:// page as phoenix-sim shows one: what the
// runtime asks the shell (WebAppWindow.qml's "bridge" and "bridgePost"), and
// the page's messages coming back to the app as pageMessage(json). jsdom
// cannot have a phoenix: page (an opaque origin has no localStorage), so
// the runtime runs with a global whose location says phoenix: and is
// otherwise the window.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

type BridgeNode = HTMLObjectElement & {
    eventListener: Record<string, (...a: unknown[]) => void>;
    connectBrowserServer(): void;
    pageBridgeAvailable(): boolean;
    setPageBridge(script: string, origin: string): boolean;
    postToPage(json: string | object): void;
};
type Runtime = { webViewEvent(id: string, name: string, args: unknown[]): void };

beforeAll(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const src = readFileSync(resolve(__dirname, "../../../../runtime/phoenix-runtime.js"), "utf8");
    const location = { protocol: "phoenix:", href: "phoenix://rootfs/usr/palm/applications/org.example.bridge/index.html",
                       pathname: "/usr/palm/applications/org.example.bridge/index.html", host: "rootfs", hostname: "rootfs",
                       origin: "phoenix://rootfs", search: "", hash: "" };
    const global = new Proxy(window, {
        get(target, key) {
            if (key === "location") return location;
            const v = Reflect.get(target, key);
            // The window's own methods, called on the window (not on the proxy).
            return typeof v === "function" && typeof key === "string" && !/^[A-Z]/.test(key) ? v.bind(target) : v;
        },
        set(target, key, value) { return Reflect.set(target, key, value); },
    });
    new Function(src).call(global);
});
afterEach(() => vi.restoreAllMocks());

/** The host messages a call posts (console.info "__phoenix__{type, payload}"). */
function hostMessages(fn: () => void): { type: string; payload: Record<string, unknown> }[] {
    const out: { type: string; payload: Record<string, unknown> }[] = [];
    const spy = vi.spyOn(console, "info").mockImplementation((m: unknown) => {
        const s = String(m);
        if (s.startsWith("__phoenix__")) out.push(JSON.parse(s.slice(11)));
    });
    fn();
    spy.mockRestore();
    return out;
}

describe("a page view's bridge (phoenix-sim's native view)", () => {
    it("asks the shell for the script with a fresh secret, posts JSON to the page, and passes the page's messages on", async () => {
        const node = document.createElement("object") as BridgeNode;
        node.setAttribute("type", "application/x-palm-browser");
        document.body.append(node);
        const heard: unknown[] = [];
        node.eventListener = { pageMessage: (json: unknown) => heard.push(json), serverConnected: () => {} };
        expect(node.pageBridgeAvailable()).toBe(true);

        const created = hostMessages(() => node.connectBrowserServer());
        const id = created.find((m) => m.type === "webView" && m.payload.op === "create")?.payload.id as string;
        expect(id).toBeTruthy();

        const first = hostMessages(() => expect(node.setPageBridge("window.x = 1;", "http://ha.local:8123")).toBe(true));
        const again = hostMessages(() => node.setPageBridge("window.x = 1;", "http://ha.local:8123"));
        const b1 = first.find((m) => m.payload.op === "bridge")!.payload;
        const b2 = again.find((m) => m.payload.op === "bridge")!.payload;
        expect(b1).toMatchObject({ id, script: "window.x = 1;", origin: "http://ha.local:8123" });
        expect(String(b1.nonce)).toMatch(/^[0-9a-f]{36}$/);
        expect(b2.nonce).not.toBe(b1.nonce);

        const posted = hostMessages(() => { node.postToPage({ id: 1, type: "result" }); node.postToPage('{"a":2}'); });
        expect(posted.map((m) => m.payload)).toEqual([
            { id, op: "bridgePost", message: '{"id":1,"type":"result"}' },
            { id, op: "bridgePost", message: '{"a":2}' },
        ]);

        (window as unknown as { __phoenixRuntime: Runtime }).__phoenixRuntime.webViewEvent(id, "pageMessage", ['{"type":"config/get","id":1}']);
        expect(heard).toEqual(['{"type":"config/get","id":1}']);
        node.remove();
    });
});
