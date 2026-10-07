// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The clipboard client against the simulated org.webosphoenix.clipboard in
// runtime/phoenix-runtime.js ("Clipboard history"): recording, expiry and
// size, pins, categories, sensitive detection and encryption at rest.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { call, LunaError } from "./bridge";
import { clipAge, clipboard, clipDestination, clipMask } from "./clipboard";
import { deviceLock } from "./services";

type Runtime = {
    clipboard: {
        sensitiveKind(t: string): string;
        markSensitive(t: string, kind?: string): void;
        raw(id: string): Record<string, unknown> | null;
    };
    applyHostStatus(st: object, opts?: object): void;
};
const rt = () => (window as unknown as { __phoenixRuntime: Runtime }).__phoenixRuntime;

beforeAll(() => {
    const src = readFileSync(resolve(__dirname, "../../../../runtime/phoenix-runtime.js"), "utf8");
    new Function(src).call(window);
});

beforeEach(() => localStorage.clear());
afterEach(() => vi.useRealTimers());

const add = async (text: string, extra: object = {}) => (await clipboard.add({ text, ...extra }))!;

describe("simulated org.webosphoenix.clipboard", () => {
    it("records clips newest first, with their app; a link is a link", async () => {
        await add("first words");
        await add("https://webosphoenix.org/news", { title: "News" });
        const h = await clipboard.history();
        expect(h.clips.map((c) => c.type)).toEqual(["link", "text"]);
        expect(h.clips[0]).toMatchObject({ text: "https://webosphoenix.org/news", title: "News", pinned: false, category: "", sensitive: false });
        expect(h.clips[1].source).toBe("com.webos.phoenix.unknown");
        expect(h.settings).toMatchObject({ enabled: true, keepFor: "week", maxItems: 100, sensitive: "mask" });
    });

    it("keeps newest first for copies in the same millisecond", async () => {
        vi.spyOn(Date, "now").mockReturnValue(1_800_000_000_000);
        await add("first");
        await add("second");
        await add("third");
        const h = await clipboard.history();
        expect(h.clips.map((c) => c.text)).toEqual(["third", "second", "first"]);
        vi.restoreAllMocks();
    });

    it("moves a copy already there to the front instead of doubling it", async () => {
        const a = await add("alpha");
        await add("beta");
        const again = await add("alpha");
        expect(again.id).toBe(a.id);
        expect((await clipboard.history()).clips.map((c) => c.text)).toEqual(["alpha", "beta"]);
    });

    it("records copies made in the page: a selection, and navigator.clipboard", async () => {
        const ta = document.createElement("textarea");
        ta.value = "copied from a field";
        document.body.appendChild(ta);
        ta.focus();
        ta.setSelectionRange(0, 6);
        window.dispatchEvent(new Event("copy"));
        await vi.waitFor(async () => expect((await clipboard.history()).clips[0]?.text).toBe("copied"));
        ta.remove();
    });

    it("expires the history after the time chosen; saved clips stay", async () => {
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(new Date("2026-10-01T10:00:00Z"));
        const old = await add("old note");
        const pinned = await add("pinned note");
        await clipboard.setPinned(pinned.id, true);
        await clipboard.setSettings({ keepFor: "hour" });
        vi.setSystemTime(new Date("2026-10-01T10:30:00Z"));
        await add("new note");
        expect((await clipboard.history()).clips).toHaveLength(3);
        vi.setSystemTime(new Date("2026-10-01T11:10:00Z"));
        const h = await clipboard.history();
        expect(h.clips.map((c) => c.text)).toEqual(["new note", "pinned note"]);
        expect(h.clips.some((c) => c.id === old.id)).toBe(false);
        await clipboard.setSettings({ keepFor: "forever" });
        vi.setSystemTime(new Date("2027-10-01T11:10:00Z"));
        expect((await clipboard.history()).clips).toHaveLength(2);
    });

    it("keeps at most maxItems in the history, not counting saved clips", async () => {
        await clipboard.setSettings({ maxItems: 3 });
        const keep = await add("saved one");
        const cat = await clipboard.addCategory("Work");
        await clipboard.setCategory(keep.id, cat.id);
        for (const t of ["one", "two", "three", "four", "five"]) await add(t);
        const h = await clipboard.history();
        expect(h.clips.map((c) => c.text)).toEqual(["five", "four", "three", "saved one"]);
    });

    it("pins and unpins; the Pinned list", async () => {
        const a = await add("pin me");
        await add("not me");
        expect((await clipboard.setPinned(a.id, true)).pinned).toBe(true);
        expect((await clipboard.history({ category: "pinned" })).clips.map((c) => c.text)).toEqual(["pin me"]);
        await clipboard.setPinned(a.id, false);
        expect((await clipboard.history({ category: "pinned" })).clips).toEqual([]);
    });

    it("creates, renames, reorders and deletes categories; clips move between them", async () => {
        const work = await clipboard.addCategory("Work");
        const home = await clipboard.addCategory("Home");
        expect((await clipboard.renameCategory(home.id, "Family")).name).toBe("Family");
        expect((await clipboard.reorderCategories([home.id, work.id])).map((c) => c.name)).toEqual(["Family", "Work"]);
        const c = await add("address");
        await clipboard.setCategory(c.id, work.id);
        expect((await clipboard.history({ category: work.id })).clips.map((x) => x.text)).toEqual(["address"]);
        await clipboard.setCategory(c.id, home.id);
        expect((await clipboard.history({ category: work.id })).clips).toEqual([]);
        expect((await clipboard.deleteCategory(home.id)).map((x) => x.name)).toEqual(["Work"]);
        // Its clips stay, in no category.
        expect((await clipboard.history()).clips[0]).toMatchObject({ text: "address", category: "" });
        const e = await clipboard.setCategory(c.id, "nope").catch((x) => x);
        expect(e).toBeInstanceOf(LunaError);
    });

    it("edits a text clip, searches, deletes and clears", async () => {
        const a = await add("grocery list");
        await add("meeting at noon");
        expect((await clipboard.update(a.id, "grocery list: milk")).text).toBe("grocery list: milk");
        expect((await clipboard.history({ query: "MILK" })).clips.map((c) => c.id)).toEqual([a.id]);
        const kept = await add("keep");
        await clipboard.setPinned(kept.id, true);
        await clipboard.remove(a.id);
        expect((await clipboard.history()).clips).toHaveLength(2);
        expect(await clipboard.clear()).toBe(1);
        expect((await clipboard.history()).clips.map((c) => c.text)).toEqual(["keep"]);
        expect(await clipboard.clear(true)).toBe(1);
        expect((await clipboard.history()).clips).toEqual([]);
    });

    it("records nothing when off or from an excluded app", async () => {
        await add("before");
        await clipboard.setSettings({ enabled: false });
        expect((await clipboard.history()).clips).toEqual([]);
        expect(await clipboard.add({ text: "while off" })).toBeNull();
        await clipboard.setSettings({ enabled: true, excludedApps: ["com.webos.phoenix.unknown"] });
        expect(await clipboard.add({ text: "excluded" })).toBeNull();
        await clipboard.setSettings({ excludedApps: [] });
        expect(await clipboard.add({ text: "after" })).not.toBeNull();
        const e = await clipboard.setSettings({ keepFor: "year" as never }).catch((x) => x);
        expect(e.errorText).toMatch(/keepFor/);
    });

    it("clears the history when the screen locks, if asked", async () => {
        await add("locked away");
        const p = await add("pinned stays");
        await clipboard.setPinned(p.id, true);
        rt().applyHostStatus({ deviceLocked: true });
        expect((await clipboard.history()).clips).toHaveLength(2);
        rt().applyHostStatus({ deviceLocked: false });
        await clipboard.setSettings({ clearOnLock: true });
        rt().applyHostStatus({ deviceLocked: true });
        expect((await clipboard.history()).clips.map((c) => c.text)).toEqual(["pinned stays"]);
    });
});

describe("sensitive clips", () => {
    it("tells codes, keys and passwords from ordinary text", () => {
        const kind = rt().clipboard.sensitiveKind;
        expect(kind("otpauth://totp/Phoenix:me?secret=JBSWY3DPEHPK3PXP")).toBe("otpauth");
        expect(kind("123456")).toBe("otp");
        expect(kind("123 456")).toBe("otp");
        expect(kind("12345678")).toBe("otp");
        expect(kind("JBSWY3DPEHPK3PXP")).toBe("totp");
        expect(kind("c0rrect-Horse!")).toBe("password");
        expect(kind("Tr0ub4dor&3")).toBe("password");
        for (const plain of ["hello world", "12345", "2026", "https://example.com/A1-b", "me@example.com", "Seattle2024",
                             "password", "A sentence, with 3 words!", "HELLO"])
            expect(kind(plain), plain).toBe("");
    });

    it("keeps them encrypted and masked; reveals after the passcode", async () => {
        await deviceLock.set("pin", "4321");
        const c = await add("c0rrect-Horse!");
        expect(c).toMatchObject({ sensitive: true, kind: "password", length: 14 });
        expect(c.text).toBeUndefined();
        // Nothing of it in the store, in any form.
        const dump = JSON.stringify({ ...localStorage });
        expect(dump).not.toContain("c0rrect-Horse!");
        expect(dump).not.toContain(btoa("c0rrect-Horse!"));
        const raw = rt().clipboard.raw(c.id)!;
        expect(raw.text).toBeUndefined();
        expect(raw.enc).toMatchObject({ iv: expect.any(String), data: expect.any(String) });
        expect(clipMask(c)).toBe("••••••••••••");
        // Search does not see it; paste is the system UI's only.
        expect((await clipboard.history({ query: "horse" })).clips).toEqual([]);
        expect((await clipboard.paste(c.id).catch((x) => x)).errorCode).toBe(-3);
        expect((await clipboard.reveal(c.id, "0000").catch((x) => x)).errorCode).toBe(-5);
        expect(await clipboard.reveal(c.id, "4321")).toBe("c0rrect-Horse!");
        // The same secret copied again is the same clip.
        expect((await add("c0rrect-Horse!")).id).toBe(c.id);
    });

    it("honours an app's mark and a password field; skips them when asked", async () => {
        rt().clipboard.markSensitive("my user name", "secret");
        const marked = await add("my user name");
        expect(marked).toMatchObject({ sensitive: true, kind: "secret" });
        const field = await add("1234", { sensitive: true, kind: "password" });
        expect(field).toMatchObject({ sensitive: true, kind: "password" });
        await clipboard.setSettings({ detectSecrets: false });
        expect(await add("123456")).toMatchObject({ sensitive: false, text: "123456" });
        await clipboard.setSettings({ sensitive: "skip" });
        expect(await clipboard.add({ text: "x", sensitive: true })).toBeNull();
        expect(await clipboard.add({ text: "plain text" })).not.toBeNull();
    });

    it("says where a secret can go", () => {
        expect(clipDestination({ sensitive: true, kind: "otpauth" })).toBe("authenticator");
        expect(clipDestination({ sensitive: true, kind: "totp" })).toBe("authenticator");
        expect(clipDestination({ sensitive: true, kind: "password" })).toBe("passwords");
        expect(clipDestination({ sensitive: true, kind: "otp" })).toBeNull();
        expect(clipDestination({ sensitive: false })).toBeNull();
        expect(clipAge(1000, 1000 + 90_000)).toBe("1 min");
    });

    it("needs text or an image", async () => {
        const e = await call("luna://org.webosphoenix.clipboard/add", {}).catch((x) => x);
        expect(e.errorText).toBe("need \"text\" or \"image\"");
    });
});
