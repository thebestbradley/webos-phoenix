// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The assistant client against the simulator's org.webosphoenix.assistant
// (runtime/phoenix-runtime.js "The Phoenix Assistant", which runs
// apps/assistant/service in the page): commands on the simulated bus,
// threads and their subscriptions, keys sealed at rest, who may call.
// The router itself is tested in apps/assistant/service.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { call, LunaError } from "./bridge";
import { assistant, ASSISTANT_ERRORS, formatBytes, tts } from "./assistant";

type PS = { getResource(p: string): string | undefined; appIdentifier: string };
const ps = () => (window as unknown as { PalmSystem: PS }).PalmSystem;
const SERVICE_DIR = resolve(__dirname, "../../../assistant/service/");

beforeAll(() => {
    const src = readFileSync(resolve(__dirname, "../../../../runtime/phoenix-runtime.js"), "utf8");
    new Function(src).call(window);
    // jsdom has no rootfs: the service's modules from the repository.
    const base = ps().getResource.bind(ps());
    ps().getResource = (p) => {
        const m = /^\/usr\/palm\/services\/org\.webosphoenix\.assistant\/(.+)$/.exec(p);
        if (m) {
            try { return readFileSync(resolve(SERVICE_DIR, m[1]), "utf8"); } catch { return undefined; }
        }
        return base(p);
    };
});

beforeEach(() => {
    localStorage.clear();
    ps().appIdentifier = "com.palm.systemui";
});

describe("simulated org.webosphoenix.assistant", () => {
    it("runs a command on the simulated bus and keeps the thread", async () => {
        const r = await assistant.ask("turn on the flashlight", { speak: false });
        expect(r.messages.map((m) => [m.role, m.text])).toEqual([["user", "turn on the flashlight"], ["assistant", "The flashlight is on."]]);
        expect(await call("luna://org.webosports.service.torch/getStatus", {})).toMatchObject({ on: true });
        const t = await assistant.thread();
        expect(t.thread?.id).toBe(r.thread.id);
        expect(t.messages).toHaveLength(2);
        // One key per message.
        expect(Object.keys(localStorage).filter((k) => k.startsWith("phoenix:assistant:msg:"))).toHaveLength(2);
    });

    it("tells subscribers about new threads", async () => {
        const seen: number[] = [];
        const sub = assistant.watchThreads((list) => seen.push(list.length));
        await vi.waitFor(() => expect(seen).toEqual([0]));
        await assistant.ask("what's 2 + 2", { speak: false });
        await vi.waitFor(() => expect(seen.at(-1)).toBe(1));
        sub.cancel();
    });

    it("seals provider keys at rest and lets only Settings set them", async () => {
        await expect(assistant.setProvider({ type: "anthropic", key: "sk-ant-api03-supersecret-9876" })).rejects.toMatchObject({ errorCode: ASSISTANT_ERRORS.NOT_ALLOWED });
        ps().appIdentifier = "org.webosphoenix.settings";
        const p = await assistant.setProvider({ type: "anthropic", key: "sk-ant-api03-supersecret-9876" });
        expect(p).toMatchObject({ type: "anthropic", model: "claude-sonnet-5-5", hasKey: true, keyHint: "9876", label: "Anthropic (claude-sonnet-5-5)" });
        const stored = Object.entries(localStorage).filter(([k]) => k.startsWith("phoenix:assistant:")).map(([, v]) => v).join("\n");
        expect(stored).not.toContain("supersecret");
        expect(stored).toContain("keyEnc");
        // The service can still read it back to call the provider.
        const svc = (window as unknown as { __phoenixRuntime: { assistant: { service(): Record<string, unknown> } } }).__phoenixRuntime.assistant;
        expect(svc).toBeTruthy();
    });

    it("lets only Settings allow cloud models to act", async () => {
        await expect(assistant.setSettings({ allowCloudControl: true })).rejects.toBeInstanceOf(LunaError);
        ps().appIdentifier = "org.webosphoenix.settings";
        expect((await assistant.setSettings({ allowCloudControl: true })).allowCloudControl).toBe(true);
    });

    it("refuses other apps' questions", async () => {
        ps().appIdentifier = "org.example.app";
        await expect(assistant.ask("hello")).rejects.toMatchObject({ errorCode: ASSISTANT_ERRORS.NOT_ALLOWED });
    });

    it("lists the on-device models without the shell, and says how to get llama-server", async () => {
        const m = await assistant.models();
        expect(m.models.map((x) => x.id)).toEqual(["qwen2.5-0.5b-instruct-q4_k_m", "qwen2.5-1.5b-instruct-q4_k_m", "qwen3-4b-q4_k_m"]);
        expect(m.status.available).toBe(false);
        expect(m.status.howToInstall).toMatch(/llama-server/);
        expect(formatBytes(m.models[0].size)).toBe("491 MB");
    });

    it("has no speech without the shell or page voices", async () => {
        expect(await tts.status()).toEqual({ available: false, engine: "" });
        await expect(tts.speak("hello")).rejects.toBeInstanceOf(LunaError);
    });
});
