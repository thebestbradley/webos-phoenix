// @vitest-environment node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The Assistant's router (assistant.js) end to end, with a stand-in Luna
// bus and a local mock of every provider's API (test/mock-providers.cjs,
// real HTTP through lib/node-http.js): the command layer, confirmations for
// what sends or calls, "Ask <cloud model>" and "Search the web", each API
// shape, the permission gate on cloud models, the on-device model, keys at
// rest, threads.

import { createRequire } from "node:module";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

type Reply = { returnValue: boolean; errorCode?: number; errorText?: string; [k: string]: any };
type Methods = Record<string, (p?: object) => Promise<Reply>>;
const req = createRequire(import.meta.url);
const { createAssistantService, ERRORS } = req("./assistant.js") as { createAssistantService(d: object): Methods; ERRORS: Record<string, number> };
const { createRequest } = req("./lib/node-http.js") as { createRequest(o?: object): (r: object) => Promise<{ status: number; body: string }> };
const mockProviders = req("./test/mock-providers.cjs") as {
    start(): Promise<{ url: string; requests: { shape: string; path: string; headers: Record<string, string>; body: any }[]; close(): Promise<void> }>;
    KEYS: Record<string, string>;
};

let mock: Awaited<ReturnType<typeof mockProviders.start>>;
beforeAll(async () => { mock = await mockProviders.start(); });
afterAll(async () => { await mock.close(); });

const NOW = new Date(2026, 9, 7, 10, 0, 0).getTime();
const PEOPLE = [
    { _id: "p1", name: { givenName: "Sam", familyName: "Jones" }, phoneNumbers: [{ value: "555-0100", type: "type_mobile" }] },
    { _id: "p2", name: { givenName: "Mary", familyName: "Spetzler" }, phoneNumbers: [{ value: "555-0199", type: "type_work" }] },
];
const APPS = [{ id: "org.webosphoenix.maps", title: "Maps" }, { id: "org.webosphoenix.music", title: "Music" }];

function setup(opts: { llm?: object; voice?: () => unknown } = {}) {
    const data = new Map<string, unknown>();
    const calls: { uri: string; params: any }[] = [];
    const spoken: string[] = [];
    let who = "com.palm.systemui";
    let n = 0;
    const luna = {
        call(uri: string, params: any): Promise<any> {
            calls.push({ uri, params });
            if (uri.endsWith("/listLaunchPoints")) return Promise.resolve({ returnValue: true, launchPoints: APPS });
            if (uri === "luna://com.palm.db/find")
                return Promise.resolve({ returnValue: true, results: params.query.from === "com.palm.person:1" ? PEOPLE : [] });
            if (uri === "luna://com.palm.db/put")
                return Promise.resolve({ returnValue: true, results: params.objects.map(() => ({ id: "db" + ++n, rev: 1 })) });
            if (uri.endsWith("/getUniversalSearchList"))
                return Promise.resolve({ returnValue: true, defaultSearchEngine: "google", UniversalSearchList: [{ id: "google", url: "https://www.google.com/search?q=#{searchTerms}" }] });
            return Promise.resolve({ returnValue: true });
        },
    };
    const storage = {
        get: (k: string) => (data.has(k) ? JSON.parse(JSON.stringify(data.get(k))) : null),
        set: (k: string, v: unknown) => { data.set(k, JSON.parse(JSON.stringify(v))); },
        remove: (k: string) => { data.delete(k); },
        keys: (prefix: string) => [...data.keys()].filter((k) => k.startsWith(prefix)),
    };
    // Sealed: reversible here, but never the key itself.
    const secrets = {
        seal: (t: string) => Promise.resolve({ iv: "x", data: Buffer.from(t).toString("base64").split("").reverse().join("") }),
        unseal: (e: { data: string }) => Promise.resolve(Buffer.from(e.data.split("").reverse().join(""), "base64").toString()),
    };
    const svc = createAssistantService({
        luna, storage, secrets, request: createRequest({ timeoutMs: 5000 }), now: () => NOW,
        caller: () => who, tts: { speak: (t: string) => { spoken.push(t); return Promise.resolve(); }, stop() {} },
        llm: opts.llm, voice: opts.voice, locale: () => "en-GB",
    });
    return {
        svc, calls, data, spoken,
        as(id: string) { who = id; },
        called: (part: string) => calls.filter((c) => c.uri.includes(part)),
    };
}

async function ask(t: ReturnType<typeof setup>, text: string, extra: object = {}) {
    const r = await t.svc.ask({ text, ...extra });
    expect(r.returnValue, r.errorText).toBe(true);
    return r;
}
const last = (r: Reply) => r.messages[r.messages.length - 1];

async function addProvider(t: ReturnType<typeof setup>, type: string, extra: object = {}) {
    t.as("org.webosphoenix.settings");
    const base = type === "compatible" ? mock.url + "/v1" : mock.url;
    const r = await t.svc.setProvider({ type, baseUrl: base, key: mockProviders.KEYS[type] ?? "", ...extra });
    expect(r.returnValue, r.errorText).toBe(true);
    t.as("com.palm.systemui");
    return r.provider;
}

beforeEach(() => { mock.requests.length = 0; });

describe("the command layer", () => {
    it("runs a command at once, offline, and says what it did", async () => {
        const t = setup();
        const r = await ask(t, "Turn on the flashlight");
        expect(r.messages.map((m: Reply) => m.role)).toEqual(["user", "assistant"]);
        expect(last(r)).toMatchObject({ text: "The flashlight is on.", via: "commands", command: "toggle", status: "done" });
        expect(t.called("torch/set")[0].params).toEqual({ on: true });
        expect(mock.requests).toHaveLength(0);
        expect(t.spoken).toEqual(["The flashlight is on."]);
    });

    it("sets a timer as an activity that opens the Assistant when it is done", async () => {
        const t = setup();
        const r = await ask(t, "set a timer for 10 minutes");
        expect(last(r).text).toBe("Timer set for 10 minutes.");
        const a = t.called("activitymanager/create")[0].params.activity;
        expect(a.schedule.start).toBe("2026-10-07 " + new Date(NOW + 600000).toISOString().slice(11, 19) + "Z");
        expect(a.callback.params).toMatchObject({ id: "org.webosphoenix.assistant", params: { timerDone: { seconds: 600 } } });
    });

    it("sets an alarm the way the Clock does: its record and its activity", async () => {
        const t = setup();
        const r = await ask(t, "wake me at 7");
        expect(last(r).text).toBe("Alarm set for 7:00 AM tomorrow.");
        const rec = t.called("com.palm.db/put")[0].params.objects[0];
        expect(rec).toMatchObject({ _kind: "com.palm.clock.alarm:1", hour: 7, minute: 0, occurs: "once", enabled: true });
        const a = t.called("activitymanager/create")[0].params.activity;
        expect(a).toMatchObject({ name: rec.key, schedule: { start: "2026-10-08 07:00:00", local: true },
                                  callback: { params: { id: "com.palm.app.clock", params: { action: "ring", key: rec.key } } } });
    });

    it("adds a reminder to Tasks with its reminder activity", async () => {
        const t = setup();
        const r = await ask(t, "remind me to buy milk at 5");
        expect(last(r).text).toBe("I'll remind you to buy milk today at 5:00 PM.");
        const puts = t.called("com.palm.db/put").map((c) => c.params.objects[0]);
        expect(puts.map((o) => o._kind)).toEqual(["com.palm.tasklist:1", "com.palm.task:1"]);
        expect(puts[1]).toMatchObject({ summary: "buy milk", remind: new Date(2026, 9, 7, 17).getTime() });
        expect(t.called("activitymanager/create")[0].params.activity.callback.params).toMatchObject({ id: "org.webosphoenix.tasks" });
    });

    it("answers sums, opens apps, plays music, gets directions", async () => {
        const t = setup();
        expect(last(await ask(t, "what's 15% of 80")).text).toBe("15% × 80 = 12");
        expect(last(await ask(t, "open maps")).text).toBe("Opening Maps.");
        expect(t.called("applicationManager/launch").at(-1)!.params).toEqual({ id: "org.webosphoenix.maps", params: {} });
        await ask(t, "play daft punk");
        expect(t.called("applicationManager/launch").at(-1)!.params).toEqual({ id: "org.webosphoenix.music", params: { play: "daft punk" } });
        await ask(t, "navigate to the station");
        expect(t.called("applicationManager/launch").at(-1)!.params).toEqual({ id: "org.webosphoenix.maps", params: { target: "mapto:station" } });
    });

    it("does not run a command turned off in Settings", async () => {
        const t = setup();
        t.as("org.webosphoenix.settings");
        await t.svc.setSettings({ disabledCommands: ["toggle"] });
        t.as("com.palm.systemui");
        const r = await ask(t, "turn off wifi");
        expect(last(r).status).toBe("failed");
        expect(t.called("wifi/setstate")).toHaveLength(0);
    });
});

describe("confirmation for what sends or calls", () => {
    it("reads a text back and sends it only on Yes", async () => {
        const t = setup();
        const r = await ask(t, "text Sam I'm running late");
        const m = last(r);
        expect(m).toMatchObject({ status: "pending", text: "Send \"I'm running late\" to Sam Jones?" });
        expect(t.called("messaging/putMessage")).toHaveLength(0);
        const done = await t.svc.confirm({ threadId: r.thread.id, messageId: m.id, accept: true });
        expect(last(done).text).toBe("Sent to Sam Jones.");
        expect(t.called("messaging/putMessage")[0].params.message).toMatchObject({
            _kind: "com.palm.smsmessage:1", folder: "outbox", messageText: "I'm running late", to: [{ addr: "555-0100", name: "Sam Jones" }] });
        // Answered once.
        expect((await t.svc.confirm({ threadId: r.thread.id, messageId: m.id, accept: true })).returnValue).toBe(false);
    });

    it("sends nothing on No", async () => {
        const t = setup();
        const r = await ask(t, "text Mary see you soon");
        const no = await t.svc.confirm({ threadId: r.thread.id, messageId: last(r).id, accept: false });
        expect(last(no).text).toBe("OK, I won't.");
        expect(t.called("messaging/putMessage")).toHaveLength(0);
        const th = await t.svc.thread({ id: r.thread.id });
        expect(th.messages.find((x: Reply) => x.id === last(r).id).status).toBe("cancelled");
    });

    it("asks before calling", async () => {
        const t = setup();
        const r = await ask(t, "call Mary");
        expect(last(r)).toMatchObject({ status: "pending", text: "Call Mary Spetzler (555-0199)?" });
        expect(t.called("applicationManager/launch")).toHaveLength(0);
        await t.svc.confirm({ threadId: r.thread.id, messageId: last(r).id, accept: true });
        expect(t.called("applicationManager/launch")[0].params).toEqual({ id: "org.webosphoenix.phone", params: { number: "555-0199", dial: true } });
    });

    it("says so when the contact is unknown", async () => {
        const t = setup();
        expect(last(await ask(t, "call Bob")).text).toBe("I couldn't find bob in your contacts.");
    });
});

describe("when nothing on the phone can answer", () => {
    it("offers to search the web, and to connect a model", async () => {
        const t = setup();
        const r = await ask(t, "who wrote the odyssey");
        expect(last(r).choices).toEqual([{ id: "web", label: "Search the web" }, { id: "connect", label: "Connect model" }]);
        const w = await t.svc.choose({ threadId: r.thread.id, messageId: last(r).id, choice: "web" });
        expect(last(w).text).toBe("Searching the web for \"who wrote the odyssey\".");
        expect(t.called("applicationManager/open")[0].params.target).toBe("https://www.google.com/search?q=who%20wrote%20the%20odyssey");
    });

    it("offers the default cloud model once one is set up, and the thread stays with it", async () => {
        const t = setup();
        await addProvider(t, "anthropic");
        const r = await ask(t, "who wrote the odyssey");
        const offer = last(r);
        expect(offer.choices[0]).toMatchObject({ label: "Ask Anthropic (claude-sonnet-5-5)" });
        const a = await t.svc.choose({ threadId: r.thread.id, messageId: offer.id, choice: offer.choices[0].id });
        expect(last(a)).toMatchObject({ text: "anthropic says: who wrote the odyssey", via: "cloud", source: "Anthropic (claude-sonnet-5-5)" });
        const next = await ask(t, "and when", { threadId: r.thread.id });
        expect(last(next).text).toBe("anthropic says: and when");
        // The model saw the conversation, starting with the user.
        expect(mock.requests.at(-1)!.body.messages.map((m: Reply) => m.role)).toEqual(["user", "assistant", "user"]);
    });
});

describe("Connect model", () => {
    it("opens Settings > Assistant for the kind chosen, and the question waits for it", async () => {
        const t = setup();
        const r = await ask(t, "who wrote the odyssey");
        const offer = last(r);
        const c = await t.svc.connect({ threadId: r.thread.id, messageId: offer.id, mode: "cloud" });
        expect(c).toMatchObject({ returnValue: true, mode: "cloud", waiting: true });
        expect(t.called("applicationManager/launch").at(-1)!.params).toEqual(
            { id: "org.webosphoenix.settings", params: { page: "assistant", connect: "cloud", threadId: r.thread.id } });
        // Not taken: the buttons stay until a model answers.
        expect((await t.svc.thread({ id: r.thread.id })).messages.find((m: Reply) => m.id === offer.id).chosen).toBeUndefined();
        // The choice itself (an older client) asks which kind in Settings.
        await t.svc.choose({ threadId: r.thread.id, messageId: offer.id, choice: "connect" });
        expect(t.called("applicationManager/launch").at(-1)!.params.params).toMatchObject({ connect: "choose" });
    });

    it("asks the question again once a cloud model is there", async () => {
        const t = setup();
        const r = await ask(t, "who wrote the odyssey");
        await t.svc.connect({ threadId: r.thread.id, messageId: last(r).id, mode: "cloud" });
        // Nothing set up yet: it says so, and the question still waits.
        const early = await t.svc.retry({ threadId: r.thread.id });
        expect(last(early).text).toBe("No model is connected yet. You can connect one in Settings > Assistant.");
        await addProvider(t, "anthropic");
        const again = await t.svc.retry({ threadId: r.thread.id });
        expect(last(again)).toMatchObject({ text: "anthropic says: who wrote the odyssey", via: "cloud" });
        const th = await t.svc.thread({ id: r.thread.id });
        expect(th.messages.find((m: Reply) => m.id === last(r).id).chosen).toBe("connect");
        expect(th.thread.provider).not.toBe("");
        // Asked once: a second retry has nothing to do.
        expect((await t.svc.retry({ threadId: r.thread.id })).messages).toEqual([]);
    });

    it("asks the on-device model first when both are there", async () => {
        const MODEL = "qwen2.5-0.5b-instruct-q4_k_m";
        const t = setup({ llm: {
            status: () => Promise.resolve({ available: true, installed: [{ id: MODEL }], ramBytes: 4 * 2 ** 30 }),
            ensure: () => Promise.resolve({ baseUrl: mock.url + "/v1" }),
            download: () => Promise.resolve(), cancel: () => Promise.resolve(), remove: () => Promise.resolve(),
        } });
        const r = await ask(t, "why is the sky blue");
        await t.svc.connect({ threadId: r.thread.id, messageId: last(r).id, mode: "both" });
        // Something else asked meanwhile: the question comes again, last.
        await ask(t, "turn on the flashlight", { threadId: r.thread.id });
        await addProvider(t, "anthropic");
        t.as("org.webosphoenix.settings");
        await t.svc.selectModel({ id: MODEL });
        t.as("org.webosphoenix.assistant");
        const again = await t.svc.retry({ threadId: r.thread.id });
        expect(again.messages.map((m: Reply) => [m.role, m.text])).toEqual([["user", "why is the sky blue"], ["assistant", "chat says: why is the sky blue"]]);
        expect(last(again).via).toBe("on-device");
    });

    it("suggests the commands close to words it did not understand", async () => {
        const t = setup();
        const r = await ask(t, "I have a meeting thing with the dentist sometime");
        expect(last(r).text).toBe("I can't do that on the phone. Did you mean something like “add a meeting with Sam tomorrow at 3” or “what's on my calendar tomorrow”?");
        expect(last(r).data.suggest).toEqual(["add a meeting with Sam tomorrow at 3", "what's on my calendar tomorrow"]);
        // Nothing close: no suggestion.
        const q = await ask(t, "who wrote the odyssey");
        expect(last(q).text).toBe("I can't do that on the phone.");
        expect(last(q).data).toBeUndefined();
    });

    it("lets only the system and the Assistant connect and retry", async () => {
        const t = setup();
        t.as("org.webosphoenix.somebody");
        expect((await t.svc.connect({ mode: "local" })).errorCode).toBe(ERRORS.NOT_ALLOWED);
        expect((await t.svc.retry({ threadId: "x" })).errorCode).toBe(ERRORS.NOT_ALLOWED);
    });
});

describe("each provider's API", () => {
    for (const type of ["anthropic", "openai", "gemini", "compatible"]) {
        it(`${type}: chats with the right request`, async () => {
            const t = setup();
            const p = await addProvider(t, type, type === "compatible" ? { model: "mock-model", name: "Home server" } : {});
            const r = await ask(t, "tell me about palm");
            await t.svc.choose({ threadId: r.thread.id, messageId: last(r).id, choice: "cloud:" + p.id });
            const sent = mock.requests.at(-1)!;
            const shape = { anthropic: "anthropic", openai: "openai", gemini: "gemini", compatible: "chat" }[type];
            expect(sent.shape).toBe(shape);
            if (type === "anthropic") {
                expect(sent.headers["x-api-key"]).toBe("test-anthropic");
                expect(sent.headers["anthropic-version"]).toBe("2023-06-01");
                expect(sent.body).toMatchObject({ model: "claude-sonnet-5-5", max_tokens: 1024 });
            }
            if (type === "openai") expect(sent.headers.authorization).toBe("Bearer test-openai");
            if (type === "gemini") {
                expect(sent.headers["x-goog-api-key"]).toBe("test-gemini");
                expect(sent.path).toBe("/v1beta/models/gemini-2.5-flash:generateContent");
            }
            if (type === "compatible") expect(sent.path).toBe("/v1/chat/completions");
            // No tools: cloud models chat until allowed to act.
            expect(JSON.stringify(sent.body)).not.toMatch(/"tools"|functionDeclarations/);
            const th = await t.svc.thread({ id: r.thread.id });
            expect(th.messages.at(-1).text).toBe(`${shape} says: tell me about palm`);
        });
    }

    it("tests a connection, and says why one fails", async () => {
        const t = setup();
        t.as("org.webosphoenix.settings");
        expect(await t.svc.testProvider({ type: "openai", baseUrl: mock.url, key: "test-openai" })).toMatchObject({ ok: true });
        const bad = await t.svc.testProvider({ type: "anthropic", baseUrl: mock.url, key: "wrong" });
        expect(bad).toMatchObject({ ok: false });
        expect(bad.error).toMatch(/401.*invalid x-api-key.*check the key/);
        expect((await t.svc.listModels({ type: "compatible", baseUrl: mock.url + "/v1" })).models).toEqual(["mock-model", "mock-model-large"]);
        expect((await t.svc.listModels({ type: "gemini", baseUrl: mock.url, key: "test-gemini" })).models).toEqual(["gemini-mock"]);
    });
});

describe("the permission gate", () => {
    it("lets a cloud model act only after Settings allows it", async () => {
        const t = setup();
        const p = await addProvider(t, "openai");
        const r = await ask(t, "it's dark in here");
        await t.svc.choose({ threadId: r.thread.id, messageId: last(r).id, choice: "cloud:" + p.id });
        // A provider that calls a tool it was never given is refused.
        const forced = await ask(t, "force a tool", { threadId: r.thread.id });
        expect(last(forced)).toMatchObject({ status: "failed", via: "cloud" });
        expect(last(forced).text).toMatch(/cloud models may only chat/);
        expect(t.called("torch/set")).toHaveLength(0);

        // Only Settings may turn it on.
        expect((await t.svc.setSettings({ allowCloudControl: true })).errorCode).toBe(ERRORS.NOT_ALLOWED);
        t.as("org.webosphoenix.settings");
        expect((await t.svc.setSettings({ allowCloudControl: true })).returnValue).toBe(true);
        t.as("com.palm.systemui");

        const allowed = await ask(t, "put the flashlight on for me", { threadId: r.thread.id });
        expect(mock.requests.at(-1)!.body.tools.map((x: Reply) => x.name)).toContain("toggle");
        expect(last(allowed)).toMatchObject({ text: "The flashlight is on.", via: "cloud", status: "done" });
        expect(t.called("torch/set")[0].params).toEqual({ on: true });
    });

    it("still confirms what a cloud model wants to send", async () => {
        const t = setup();
        const p = await addProvider(t, "gemini");
        t.as("org.webosphoenix.settings");
        await t.svc.setSettings({ allowCloudControl: true });
        t.as("com.palm.systemui");
        const r = await ask(t, "hmm");
        await t.svc.choose({ threadId: r.thread.id, messageId: last(r).id, choice: "cloud:" + p.id });
        const s = await ask(t, "text Sam the meeting moved", { threadId: r.thread.id });
        // (The grammar caught it first: the same confirmation either way.)
        expect(last(s)).toMatchObject({ status: "pending" });
        expect(t.called("messaging/putMessage")).toHaveLength(0);
    });

    it("keeps keys sealed and shows only their last four characters", async () => {
        const t = setup();
        t.as("org.webosphoenix.settings");
        const r = await t.svc.setProvider({ type: "anthropic", key: "sk-ant-secret-1234567890" });
        expect(r.provider).toMatchObject({ hasKey: true, keyHint: "7890" });
        expect(JSON.stringify([...t.data.values()])).not.toContain("sk-ant-secret");
        expect(JSON.stringify(await t.svc.providers())).not.toContain("sk-ant-secret");
        t.as("com.palm.systemui");
        expect((await t.svc.setProvider({ type: "openai", key: "x" })).errorCode).toBe(ERRORS.NOT_ALLOWED);
        t.as("org.webosphoenix.somebody");
        expect((await t.svc.ask({ text: "hello" })).errorCode).toBe(ERRORS.NOT_ALLOWED);
    });
});

describe("the on-device model", () => {
    const MODEL = "qwen2.5-0.5b-instruct-q4_k_m";
    const llm = () => ({
        status: () => Promise.resolve({ available: true, installed: [{ id: MODEL }], ramBytes: 4 * 2 ** 30 }),
        ensure: () => Promise.resolve({ baseUrl: mock.url + "/v1" }),
        download: () => Promise.resolve(), cancel: () => Promise.resolve(), remove: () => Promise.resolve(),
    });

    it("answers free-form requests and chooses commands once chosen", async () => {
        const t = setup({ llm: llm() });
        t.as("org.webosphoenix.settings");
        expect((await t.svc.selectModel({ id: MODEL })).returnValue).toBe(true);
        t.as("com.palm.systemui");
        const r = await ask(t, "why is the sky blue");
        expect(last(r)).toMatchObject({ text: "chat says: why is the sky blue", via: "on-device", source: "Qwen2.5 0.5B Instruct" });
        expect(mock.requests.at(-1)!.body.tools.length).toBeGreaterThan(10);
        const act = await ask(t, "it's dark, put the flashlight on for me");
        expect(last(act)).toMatchObject({ via: "on-device", status: "done", text: "The flashlight is on." });
        // Its times as said: "tomorrow at 6:30 am".
        const wake = await ask(t, "please could you wake me early tomorrow");
        expect(last(wake).text).toBe("Alarm set for 6:30 AM tomorrow.");
    });

    it("reads back a choice the words did not ask for", async () => {
        const t = setup({ llm: llm() });
        t.as("org.webosphoenix.settings");
        await t.svc.selectModel({ id: MODEL });
        t.as("com.palm.systemui");
        // The stand-in calls the toggle tool for "force a tool": nothing said a flashlight.
        const r = await ask(t, "force a tool");
        expect(last(r)).toMatchObject({ status: "pending", via: "on-device", text: "Did you mean: turn the flashlight on?" });
        expect(t.called("torch/set")).toHaveLength(0);
        await t.svc.confirm({ threadId: r.thread.id, messageId: last(r).id, accept: true });
        expect(t.called("torch/set")[0].params).toEqual({ on: true });
    });

    it("lists the models for the device's memory", async () => {
        const t = setup({ llm: llm() });
        const m = await t.svc.models();
        expect(m.models.map((x: Reply) => [x.id, x.fits, x.recommended, x.installed])).toEqual([
            [MODEL, true, false, true], ["qwen2.5-1.5b-instruct-q4_k_m", true, true, false], ["qwen3-4b-q4_k_m", false, false, false]]);
    });

    it("falls back to the offer when the model does not answer", async () => {
        const t = setup({ llm: { ...llm(), ensure: () => Promise.reject(new Error("llama-server is not installed")) } });
        t.as("org.webosphoenix.settings");
        await t.svc.selectModel({ id: MODEL });
        t.as("com.palm.systemui");
        const r = await ask(t, "why is the sky blue");
        expect(last(r).text).toMatch(/^The on-device model didn't answer \(llama-server is not installed\)/);
        expect(last(r).choices[0].id).toBe("web");
    });
});

describe("conversations", () => {
    it("keeps threads, each message under its own key, and the one in use", async () => {
        const t = setup();
        const a = await ask(t, "what time is it");
        const b = await ask(t, "what's 2 + 2", { newThread: true });
        expect(b.thread.id).not.toBe(a.thread.id);
        const list = await t.svc.threads();
        expect(list.current).toBe(b.thread.id);
        expect(list.threads.map((x: Reply) => x.title)).toEqual(["what's 2 + 2", "what time is it"]);
        expect([...t.data.keys()].filter((k) => k.startsWith("assistant:msg:" + a.thread.id + ":"))).toHaveLength(2);
        await t.svc.setCurrent({ id: a.thread.id });
        const more = await ask(t, "what's the date");
        expect(more.thread.id).toBe(a.thread.id);
        expect((await t.svc.thread({})).messages).toHaveLength(4);
        await t.svc.deleteThread({ id: b.thread.id });
        expect((await t.svc.threads()).threads).toHaveLength(1);
        expect((await t.svc.clearHistory()).deleted).toBe(1);
        expect([...t.data.keys()].filter((k) => k.startsWith("assistant:msg:"))).toEqual([]);
    });

    it("answers nothing while turned off, and does not speak when asked not to", async () => {
        const t = setup();
        await ask(t, "what's 1 + 1", { speak: false });
        expect(t.spoken).toEqual([]);
        t.as("org.webosphoenix.settings");
        await t.svc.setSettings({ enabled: false });
        t.as("com.palm.systemui");
        expect((await t.svc.ask({ text: "what's 1 + 1" })).errorCode).toBe(ERRORS.OFF);
    });
});

describe("asking by voice (docs/AI-AND-MCP.md, Voice)", () => {
    it("answers \"Yes\" and \"No\" to a read-back in words", async () => {
        const t = setup();
        const r = await ask(t, "text Sam I'm running late", { voice: true });
        expect(last(r).status).toBe("pending");
        const yes = await ask(t, "Yes.", { threadId: r.thread.id, voice: true });
        expect(yes.messages.map((m: Reply) => [m.role, m.text])).toEqual([["user", "Yes."], ["assistant", "Sent to Sam Jones."]]);
        expect(t.called("messaging/putMessage")).toHaveLength(1);
        const r2 = await ask(t, "text Mary see you soon", { threadId: r.thread.id });
        const no = await ask(t, "Cancel", { threadId: r.thread.id });
        expect(last(no).text).toBe("OK, I won't.");
        expect((await t.svc.thread({ id: r.thread.id })).messages.find((x: Reply) => x.id === last(r2).id).status).toBe("cancelled");
        expect(t.called("messaging/putMessage")).toHaveLength(1);
        // Without a read-back waiting, "yes" is just words.
        expect(last(await ask(t, "yes", { threadId: r.thread.id })).command).toBeUndefined();
    });

    it("speaks answers to spoken requests with Voice replies, typed ones with Speak answers", async () => {
        const t = setup();
        t.as("org.webosphoenix.settings");
        await t.svc.setSettings({ speak: false });
        t.as("com.palm.systemui");
        await ask(t, "Turn on the flashlight");
        expect(t.spoken).toEqual([]);
        await ask(t, "Turn off the flashlight", { voice: true });
        expect(t.spoken).toEqual(["The flashlight is off."]);
        t.as("org.webosphoenix.settings");
        await t.svc.setSettings({ voiceReplies: false });
        t.as("com.palm.systemui");
        await ask(t, "Turn on the flashlight", { voice: true });
        expect(t.spoken).toEqual(["The flashlight is off."]);
    });

    it("keeps the wake word settings, off until turned on", async () => {
        const t = setup();
        expect((await t.svc.getSettings({})).settings).toMatchObject({ wakeWord: false, wakeWhenLocked: false, voiceReplies: true });
        t.as("org.webosphoenix.settings");
        expect((await t.svc.setSettings({ wakeWord: true, wakeWhenLocked: true })).returnValue).toBe(true);
        expect((await t.svc.setSettings({ wakeWord: "yes" })).returnValue).toBe(false);
        expect((await t.svc.getSettings({})).settings).toMatchObject({ wakeWord: true, wakeWhenLocked: true });
    });

    it("over the lock screen, does only what shows nothing private and sends nothing", async () => {
        const t = setup();
        const timer = await ask(t, "set a timer for 5 minutes", { voice: true, locked: true });
        expect(last(timer)).toMatchObject({ command: "timer", status: "done" });
        const text = await ask(t, "text Sam I'm running late", { voice: true, locked: true });
        expect(last(text)).toMatchObject({ command: "text", status: "locked", text: "Unlock your phone first, and I'll do that." });
        const open = await ask(t, "open Maps", { locked: true });
        expect(last(open).status).toBe("locked");
        expect(t.called("applicationManager/launch")).toHaveLength(0);
        // Unlocked, the same words work.
        expect(last(await ask(t, "text Sam I'm running late")).status).toBe("pending");
    });

    it("gives the words to expect: the wake phrase and the contacts' names, to the system UI only", async () => {
        const t = setup();
        const v = await t.svc.vocabulary({});
        expect(v.words[0]).toBe("Hey Phoenix");
        expect(v.words).toContain("Sam Jones");
        expect(v.prompt).toMatch(/^Hey Phoenix, set a timer\. Call [A-Z][a-z]+ [A-Z][a-z]+\. Text /);
        expect(v.prompt).toContain("Sam Jones.");
        t.as("com.example.app");
        expect((await t.svc.vocabulary({})).returnValue).toBe(false);
    });
});

describe("what the voice needs (voice)", () => {
    it("lists the parts in order, with a hint only for what is missing", async () => {
        const t = setup({ voice: () => Promise.resolve([
            { id: "speech", available: false, engine: "", howToInstall: "Install espeak-ng." },
            { id: "recognition", available: true, engine: "whisper.cpp", howToInstall: "never shown" },
            { id: "wakeWord", available: false, howToInstall: "Run tools/get-wakeword.py." },
        ]) });
        const r = await t.svc.voice({});
        expect(r.returnValue).toBe(true);
        expect(r.parts.map((p: Reply) => [p.id, p.available, p.howToInstall])).toEqual([
            ["recognition", true, ""], ["wakeWord", false, "Run tools/get-wakeword.py."], ["speech", false, "Install espeak-ng."]]);
        expect(r.parts[0].name).toMatch(/whisper/);
    });

    it("answers with nothing where nobody knows (a browser), and when asking fails", async () => {
        expect((await setup().svc.voice({})).parts).toEqual([]);
        expect((await setup({ voice: () => Promise.reject(new Error("no")) }).svc.voice({})).parts).toEqual([]);
    });
});
