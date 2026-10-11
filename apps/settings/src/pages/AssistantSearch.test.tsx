// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Settings > Assistant > Search your phone against the simulated
// org.webosphoenix.service.index (the runtime runs services/index in the
// page), with a stand-in for the shell's model host (the "index" host
// messages: the model downloaded, its server's address) and for the
// server itself (the host's proxy answering /v1/embeddings with the fake
// embedder's vectors, services/index/test/fake-embedder.cjs): off until
// turned on, then indexed, its size, a source turned off, searched, and
// deleted.

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";
import { call, semanticIndex } from "@phoenix/luna";
import { SearchYourPhone } from "./AssistantSearch";

type PS = { getResource(p: string): string | undefined; appIdentifier: string };
const ps = () => (window as unknown as { PalmSystem: PS }).PalmSystem;
const REPO = resolve(__dirname, "../../../..");
const { embed } = createRequire(__filename)(resolve(REPO, "services/index/test/fake-embedder.cjs"));
const installed: { id: string }[] = [];

beforeAll(() => {
    // The shell: the model host answering at once.
    (window as unknown as { phoenixHost: object }).phoenixHost = {
        postToHost(type: string, p: { op: string; requestId: string; id?: string }) {
            const rt = () => (window as unknown as { __phoenixRuntime: { indexHostEvent?(e: object): void; assistantHostEvent?(e: object): void } }).__phoenixRuntime;
            if (type === "index") {
                const answer = p.op === "status" ? { available: true, installed: installed.slice(), downloading: null }
                    : p.op === "download" ? (installed.push({ id: p.id! }), {})
                    : p.op === "ensure" ? { baseUrl: "http://127.0.0.1:9/v1" } : {};
                setTimeout(() => rt().indexHostEvent?.({ requestId: p.requestId, ...answer }), 0);
            } else if (type === "assistant") {
                setTimeout(() => rt().assistantHostEvent?.({ requestId: p.requestId, available: false, installed: [] }), 0);
            }
        },
    };
    // The host's proxy, and llama-server's /v1/embeddings behind it.
    const realFetch = window.fetch;
    window.fetch = ((url: string, init?: { body?: string }) => {
        if (url !== "/__phoenix/proxy") return realFetch(url as never, init as never);
        const req = JSON.parse(init!.body!);
        const input: string[] = JSON.parse(req.body).input;
        const body = JSON.stringify({ data: input.map((t, i) => ({ index: i, embedding: Array.from(embed(t)) })) });
        return Promise.resolve({ json: () => Promise.resolve({ status: 200, headers: {}, body }) });
    }) as typeof window.fetch;
    new Function(readFileSync(resolve(REPO, "runtime/phoenix-runtime.js"), "utf8")).call(window);
    const base = ps().getResource.bind(ps());
    ps().getResource = (p) => {
        if (p === "/usr/share/phoenix/host.json") return JSON.stringify({ assistant: true });
        const m = /^\/usr\/palm\/services\/org\.webosphoenix\.service\.index\/(.+)$/.exec(p);
        if (m) {
            try { return readFileSync(resolve(REPO, "services/index", m[1]), "utf8"); } catch { return undefined; }
        }
        return base(p);
    };
    ps().appIdentifier = "org.webosphoenix.settings";
});
beforeAll(async () => {
    await call("luna://com.palm.db/put", { objects: [
        { _kind: "com.palm.note:1", text: "Wi-Fi at the cabin: network Lakeview, password on the fridge", modifiedTimestamp: 2 },
        { _kind: "com.palm.note:1", text: "Books to read", modifiedTimestamp: 1 },
        { _kind: "com.palm.email:1", subject: "Your furnace visit", from: { name: "Northside Heating", addr: "jobs@northside.example" }, timestamp: 3,
          flags: { visible: true }, parts: [{ type: "body", mimeType: "text/plain", content: "Our engineer will service the radiators on Tuesday." }] },
    ] });
}, 30000);

const toggle = (id: string) => screen.getByTestId(id) as HTMLButtonElement;
const checked = (id: string) => toggle(id).getAttribute("aria-checked") === "true";

describe("Settings > Assistant: Search your phone", () => {
    it("is off; turned on, it downloads its model, indexes, and finds things by meaning", async () => {
        render(<SearchYourPhone off={false} />);
        await waitFor(() => expect(screen.getByTestId("ix-enabled")).toBeTruthy());
        expect(checked("ix-enabled")).toBe(false);
        expect(screen.getByTestId("ix-state").textContent).toContain("Off");
        expect(screen.getByTestId("ix-model-text").textContent).toMatch(/EmbeddingGemma 2.*310 MB.*Apache-2.0/);
        expect(screen.getByTestId("ix-source-email").getAttribute("aria-disabled")).toBe("true");

        fireEvent.click(toggle("ix-enabled"));
        await waitFor(() => expect(checked("ix-enabled")).toBe(true));
        await waitFor(() => expect(screen.getByTestId("ix-state").textContent).toContain("Needs EmbeddingGemma 2"));
        fireEvent.click(screen.getByTestId("ix-download-text"));
        await waitFor(() => expect(installed.length).toBe(1));
        // The first pass starts once the model is in.
        await waitFor(() => expect(screen.getByTestId("ix-state").textContent).toContain("Up to date"), { timeout: 10000 });
        await waitFor(() => expect(screen.getByTestId("ix-source-memos").textContent).toContain("2 items"));
        expect(screen.getByTestId("ix-size").textContent).toMatch(/\d+ items · \d+ passages · \d+ KB/);

        const found = await semanticIndex.search("the email about the boiler", { sources: ["email"] });
        expect(found[0]).toMatchObject({ title: "Your furnace visit", appId: "com.palm.app.email", source: "email" });
        expect((await semanticIndex.search("internet password"))[0].title).toMatch(/^Wi-Fi at the cabin/);
    }, 30000);

    it("turns a source off (its part of the index goes), and deletes the index", async () => {
        render(<SearchYourPhone off={false} />);
        await waitFor(() => expect(checked("ix-toggle-email")).toBe(true));
        fireEvent.click(toggle("ix-toggle-email"));
        await waitFor(() => expect(checked("ix-toggle-email")).toBe(false));
        expect((await semanticIndex.search("boiler")).every((r) => r.source !== "email")).toBe(true);
        fireEvent.click(screen.getByTestId("ix-delete"));
        fireEvent.click(screen.getByTestId("ix-delete-ok"));
        await waitFor(() => expect(checked("ix-enabled")).toBe(false));
        const st = await semanticIndex.status();
        expect(st.records).toBe(0);
        expect(st.enabled).toBe(false);
        expect(await semanticIndex.search("boiler")).toEqual([]);
    }, 30000);
});
