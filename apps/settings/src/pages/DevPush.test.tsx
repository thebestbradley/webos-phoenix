// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Settings > Developer Mode's dev push groups (DevPush.tsx; docs/DEV-PUSH.md
// 7.4) against a stand-in org.webosphoenix.nova: a waiting bundle from a
// granted developer, Apply with the passcode and a wrong one, Decline;
// what the overlay holds, Restart Now, Revert to Image with its
// confirmation; Pair a Computer's code; the paired computers and trusted
// developers with Remove; the two switches. tools/test-nova.cjs drives it
// in Chromium against the simulator's real novad.

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NovaKeys, NovaStatus, NovaWaiting } from "@phoenix/luna";

const svc = vi.hoisted(() => ({
    status: null as unknown as NovaStatus, waiting: [] as unknown[], keys: null as unknown,
    calls: [] as unknown[][], listeners: [] as ((s: unknown) => void)[],
}));
vi.mock("@phoenix/luna", async (orig) => {
    const real = await orig<typeof import("@phoenix/luna")>();
    const push = () => svc.listeners.forEach((l) => l({ ...svc.status }));
    return {
        ...real,
        nova: {
            watchStatus: (cb: (s: unknown) => void) => { svc.listeners.push(cb); setTimeout(() => cb(svc.status), 0); return { cancel() {}, cancelled: false }; },
            waiting: () => Promise.resolve(svc.waiting),
            keys: () => Promise.resolve(svc.keys),
            apply: (id: string, code: string) => {
                svc.calls.push(["apply", id, code]);
                if (code !== "1234") return Promise.reject(new real.LunaError("luna://org.webosphoenix.nova/apply", { returnValue: false, errorCode: "BAD_PASSCODE", errorText: "That passcode is not correct" } as never));
                svc.waiting = [];
                svc.status = { ...svc.status, waiting: 0, files: [{ path: "/usr/palm/applications/org.example.demo/app.js", bundle: "b", by: "k", name: "Ada", kind: "grant", at: "2026-11-26T12:00:00Z" }] };
                push();
                return Promise.resolve({ applied: id, restarted: [], pendingReboot: false });
            },
            decline: (id: string) => { svc.calls.push(["decline", id]); svc.waiting = []; svc.status = { ...svc.status, waiting: 0 }; push(); return Promise.resolve(); },
            revertToImage: () => { svc.calls.push(["revertToImage"]); svc.status = { ...svc.status, clearing: true }; push(); return Promise.resolve(); },
            restartNow: () => { svc.calls.push(["restartNow"]); return Promise.resolve(); },
            pairStart: () => {
                svc.calls.push(["pairStart"]);
                svc.status = { ...svc.status, pairing: { code: "482913", fingerprint: "SHA256:device", expires: new Date(Date.now() + 120000).toISOString(), runsLeft: 5 } };
                push();
                return Promise.resolve({ code: "482913" });
            },
            pairCancel: () => { svc.calls.push(["pairCancel"]); svc.status = { ...svc.status, pairing: null }; push(); return Promise.resolve(); },
            removeKey: (k: string) => { svc.calls.push(["removeKey", k]); return Promise.resolve(); },
            setOptions: (o: unknown) => { svc.calls.push(["setOptions", o]); return Promise.resolve(); },
        },
    };
});

import { DevPushGroups, partName, restartText } from "./DevPush";

function status(o: Partial<NovaStatus> = {}): NovaStatus {
    return {
        devMode: true, build: "20261124093012", product: "1.0", compatible: "phoenix-pinephonepro", deviceId: "nova-0011223344556677",
        fingerprint: "SHA256:device", active: false, clearing: false, files: [], removed: [], bundles: [], usage: 0, cap: 268435456,
        pendingReboot: false, restarts: [], waiting: 0, pairing: null, paired: 1, options: { network: false, usb: true, overlayCap: 268435456 }, ...o,
    };
}
const ada: NovaWaiting = {
    id: "0123456789abcdef0123456789abcdef", by: "ed25519:x", fingerprint: "SHA256:ada", kind: "grant", name: "Ada Developer", grant: "grant-1",
    note: "Fix the card view", made: "2026-11-26T10:00:00Z", received: "2026-11-26T10:05:00Z", mode: "replace", parts: ["apps", "roles"], roles: true,
    files: ["/usr/palm/applications/org.example.demo/app.js", "/usr/share/luna-service2/roles.d/org.example.demo.role.json"], removed: [],
    reverts: [], restart: ["hub", "app:org.example.demo"], size: 2048,
};
const keys: NovaKeys = {
    paired: [{ key: "AAAA", fingerprint: "SHA256:laptop", name: "Laptop", paired: "2026-11-25T10:00:00Z", lastUsed: null }],
    grants: [{ id: "grant-1", key: "ed25519:x", fingerprint: "SHA256:ada", name: "Ada Developer", account: "ada", devices: ["nova-0011223344556677"],
               product: "1.0", parts: ["apps", "roles"], issued: "2026-11-20T00:00:00Z", expires: "2026-12-04T00:00:00Z", expired: false, revoked: false }],
    master: null,
};

beforeEach(() => {
    svc.status = status();
    svc.waiting = [];
    svc.keys = keys;
    svc.calls = [];
    svc.listeners = [];
});

describe("Settings > Developer Mode, dev push", () => {
    it("names the parts and the restarts in words", () => {
        expect(partName("/usr/share/phoenix/qml/Phoenix/Shell/CardView.qml")).toBe("Shell");
        expect(partName("/usr/share/luna-service2/roles.d/x.json")).toBe("What services may do");
        expect(restartText("shell")).toBe("The system UI will restart");
        expect(restartText("app:org.example.demo")).toBe("org.example.demo will restart");
    });

    it("shows a waiting bundle; Apply asks the passcode, says when it is wrong, then applies", async () => {
        svc.status = status({ waiting: 1 });
        svc.waiting = [ada];
        render(<DevPushGroups />);
        await screen.findByTestId(`devpush-waiting-${ada.id}`);
        expect(screen.getByText("Waiting: from Ada Developer")).toBeTruthy();
        expect(screen.getByTestId("devpush-roles").textContent).toMatch(/what services may do/);
        expect(screen.getByText("org.example.demo will restart")).toBeTruthy();
        fireEvent.click(screen.getByTestId("devpush-apply"));
        const input = (await screen.findByTestId("devpush-passcode")).querySelector("input") ?? screen.getByTestId("devpush-passcode");
        fireEvent.change(input, { target: { value: "0000" } });
        fireEvent.click(screen.getByTestId("devpush-apply-confirm"));
        await waitFor(() => expect(screen.getByTestId("devpush-apply-error").textContent).toMatch(/not correct/));
        fireEvent.change(input, { target: { value: "1234" } });
        fireEvent.click(screen.getByTestId("devpush-apply-confirm"));
        await waitFor(() => expect(screen.queryByTestId(`devpush-waiting-${ada.id}`)).toBeNull());
        expect(svc.calls).toEqual([["apply", ada.id, "0000"], ["apply", ada.id, "1234"]]);
        await waitFor(() => expect(screen.getByTestId("devpush-summary").textContent).toMatch(/1 file changed/));
    });

    it("lists what a waiting replace puts back, and the restarts that causes", async () => {
        svc.status = status({ waiting: 1 });
        svc.waiting = [{ ...ada, reverts: ["/usr/palm/applications/org.example.demo/old.js"], restart: ["hub", "app:org.example.demo"] }];
        render(<DevPushGroups />);
        expect((await screen.findByTestId("devpush-reverts")).textContent).toMatch(/Puts back as the system image has it/);
        expect(screen.getByText("/usr/palm/applications/org.example.demo/old.js")).toBeTruthy();
        expect(screen.queryAllByTestId("devpush-reverts")).toHaveLength(1);
    });

    it("Decline drops one", async () => {
        svc.status = status({ waiting: 1 });
        svc.waiting = [ada];
        render(<DevPushGroups />);
        fireEvent.click(await screen.findByTestId("devpush-decline"));
        await waitFor(() => expect(svc.calls).toEqual([["decline", ada.id]]));
    });

    it("lists what the overlay holds; Restart Now; Revert to Image after the confirmation", async () => {
        svc.status = status({
            active: true, pendingReboot: true, usage: 2048,
            files: [{ path: "/usr/share/phoenix/qml/Phoenix/Shell/CardView.qml", size: 2048, bundle: "b", by: "k", name: "Laptop", kind: "paired", at: "2026-11-26T12:00:00Z" }],
            bundles: [{ id: "b", by: "k", fingerprint: "SHA256:laptop", name: "Laptop", kind: "paired", note: "Card fix", made: "", applied: "2026-11-26T12:00:00Z",
                        mode: "replace", files: 1, removed: 0, reverted: 0, parts: ["shell"] }],
        });
        render(<DevPushGroups />);
        await screen.findByTestId("devpush-revert");
        expect(screen.getByTestId("devpush-file").textContent).toContain("/usr/share/phoenix/qml/Phoenix/Shell/CardView.qml, from Laptop");
        expect(screen.getByTestId("devpush-bundle").textContent).toContain("Card fix");
        fireEvent.click(screen.getByTestId("devpush-restart"));
        fireEvent.click(screen.getByTestId("devpush-revert"));
        await screen.findByTestId("devpush-revert-confirm");
        fireEvent.click(screen.getByTestId("devpush-revert-yes"));
        await screen.findByTestId("devpush-clearing");
        expect(svc.calls).toEqual([["restartNow"], ["revertToImage"]]);
        expect(screen.queryByTestId("devpush-revert")).toBeNull();
    });

    it("Pair a Computer shows the code and the device's key, and Cancel ends it", async () => {
        render(<DevPushGroups />);
        fireEvent.click(await screen.findByTestId("devpush-pair"));
        await waitFor(() => expect(screen.getByTestId("devpush-code").textContent).toBe("482 913"));
        expect(screen.getByText(/SHA256:device/)).toBeTruthy();
        fireEvent.click(screen.getByTestId("devpush-pair-cancel"));
        await screen.findByTestId("devpush-pair");
        expect(svc.calls).toEqual([["pairStart"], ["pairCancel"]]);
    });

    it("lists paired computers and trusted developers, and removes one after asking", async () => {
        render(<DevPushGroups />);
        const computer = await screen.findByTestId("devpush-computer");
        expect(computer.textContent).toContain("Laptop");
        expect(screen.getByTestId("devpush-developer").textContent).toMatch(/Ada Developer.*apps, roles; until/);
        fireEvent.click(screen.getByTestId("devpush-developer-remove"));
        await screen.findByTestId("devpush-remove-confirm");
        await act(async () => { fireEvent.click(screen.getByTestId("devpush-remove-yes")); });
        expect(svc.calls).toEqual([["removeKey", "grant-1"]]);
    });

    it("turns Push over network on", async () => {
        render(<DevPushGroups />);
        const t = await screen.findByTestId("devpush-network");
        fireEvent.click(t.querySelector("input") ?? t);
        await waitFor(() => expect(svc.calls).toEqual([["setOptions", { network: true }]]));
    });

    it("says so in a simulator without its novad", async () => {
        svc.status = { available: false } as unknown as NovaStatus;
        render(<DevPushGroups />);
        expect((await screen.findByTestId("devpush-unavailable")).textContent).toMatch(/Node\.js/);
    });
});
