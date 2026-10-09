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
import http from "node:http";
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

function setup(opts: { llm?: object; voice?: () => unknown; deadlineMs?: number } = {}) {
    const data = new Map<string, unknown>();
    const calls: { uri: string; params: any }[] = [];
    const spoken: string[] = [];
    const voices: string[] = [];
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
        caller: () => who, tts: { speak: (t: string, _l: string, v: string) => { spoken.push(t); voices.push(v); return Promise.resolve(); }, stop() {} },
        llm: opts.llm, voice: opts.voice, locale: () => "en-GB", localDeadlineMs: opts.deadlineMs,
    });
    return {
        svc, calls, data, spoken, voices,
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

// The launch an answer made, without the flags every command's launch has
// (behind, returnToCaller: checked once on their own).
function launched(x: { called(part: string): { params: any }[] }) {
    const p = { ...x.called("applicationManager/launch").at(-1)!.params };
    delete p.behind;
    delete p.returnToCaller;
    return p;
}

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
        expect(launched(t)).toEqual({ id: "org.webosphoenix.maps", params: {} });
        await ask(t, "play daft punk");
        expect(launched(t)).toEqual({ id: "org.webosphoenix.music", params: { play: "daft punk" } });
        await ask(t, "navigate to the station");
        expect(launched(t)).toEqual({ id: "org.webosphoenix.maps", params: { target: "mapto:station" } });
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
        expect(launched(t)).toEqual({ id: "org.webosphoenix.phone", params: { number: "555-0199", dial: true } });
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
        expect(launched(t)).toEqual(
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
        const MODEL = "qwen3-1.7b-q8_0";
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
        expect(last(r).text).toBe("I'm not sure how to help with that yet. Did you mean something like “add a meeting with Sam tomorrow at 3” or “what's on my calendar tomorrow”?");
        expect(last(r).data.suggest).toEqual(["add a meeting with Sam tomorrow at 3", "what's on my calendar tomorrow"]);
        // Nothing close: no suggestion.
        const q = await ask(t, "who wrote the odyssey");
        expect(last(q).text).toBe("I can't answer that on my own yet, but I can search the web for it.");
        expect(last(q).data).toBeUndefined();
    });

    it("lets only the system and the Assistant connect and retry", async () => {
        const t = setup();
        t.as("org.webosphoenix.somebody");
        expect((await t.svc.connect({ mode: "local" })).errorCode).toBe(ERRORS.NOT_ALLOWED);
        expect((await t.svc.retry({ threadId: "x" })).errorCode).toBe(ERRORS.NOT_ALLOWED);
    });
});

describe("never a dead end (the owner's banana pudding, 9 October 2026)", () => {
    const MODEL = "qwen3-1.7b-q8_0";
    const local = () => ({
        status: () => Promise.resolve({ available: true, installed: [{ id: MODEL }], ramBytes: 4 * 2 ** 30 }),
        ensure: () => Promise.resolve({ baseUrl: mock.url + "/v1" }),
        download: () => Promise.resolve(), cancel: () => Promise.resolve(), remove: () => Promise.resolve(),
    });

    it("a question with no model: one reply, a web search, no \"on the phone\"", async () => {
        const t = setup();
        const r = await ask(t, "how do you make bananna pudding");
        expect(r.messages.map((m: Reply) => m.role)).toEqual(["user", "assistant"]);
        expect(last(r)).toMatchObject({ kind: "fallback", text: "I can't answer that on my own yet, but I can search the web for it." });
        expect(last(r).choices.map((c: Reply) => c.id)).toEqual(["web", "connect"]);
        expect(JSON.stringify(r)).not.toMatch(/on the phone/);
    });

    it("the model answering later never sees the fallback, so it cannot copy it", async () => {
        const t = setup({ llm: local() });
        const r = await ask(t, "how do you make bananna pudding");
        await t.svc.connect({ threadId: r.thread.id, messageId: last(r).id, mode: "local" });
        t.as("org.webosphoenix.settings");
        await t.svc.selectModel({ id: MODEL });
        t.as("org.webosphoenix.assistant");
        const again = await t.svc.retry({ threadId: r.thread.id });
        // One answer, from the model.
        expect(again.messages.map((m: Reply) => [m.role, m.via])).toEqual([["assistant", "on-device"]]);
        const sent = mock.requests.at(-1)!.body;
        expect(sent.messages.filter((m: Reply) => m.role !== "system").map((m: Reply) => [m.role, m.content]))
            .toEqual([["user", "how do you make bananna pudding"]]);
        // Told to answer how-tos and recipes, not to refuse them.
        const system = sent.messages.find((m: Reply) => m.role === "system").content;
        expect(system).toMatch(/how-tos, recipes, advice, small talk/);
        expect(system).not.toMatch(/one to three sentences|on the phone/);
        // Then: save the recipe as a memo, or search the web.
        expect(last(again).choices.map((c: Reply) => c.label)).toEqual(["Save as Memo", "Search the web"]);
        const saved = await t.svc.choose({ threadId: r.thread.id, messageId: last(again).id, choice: "do:0" });
        expect(last(saved).text).toBe("Saved to Memos.");
        const memo = t.called("com.palm.db/put").at(-1)!.params.objects[0];
        expect(memo).toMatchObject({ _kind: "com.palm.note:1" });
        expect(memo.text).toMatch(/^Bananna pudding\n\nchat says: how do you make bananna pudding/);
    });

    it("the on-device model answers small talk with nothing to search", async () => {
        const t = setup({ llm: local() });
        t.as("org.webosphoenix.settings");
        await t.svc.selectModel({ id: MODEL });
        t.as("org.webosphoenix.assistant");
        const r = await ask(t, "tell me a joke");
        expect(r.messages).toHaveLength(2);
        expect(last(r)).toMatchObject({ via: "on-device", text: "chat says: tell me a joke" });
        expect(last(r).choices).toBeUndefined();
        const q = await ask(t, "who wrote the odyssey");
        expect(last(q).choices).toEqual([{ id: "web", label: "Search the web" }]);
        const w = await t.svc.choose({ threadId: q.thread.id, messageId: last(q).id, choice: "web" });
        expect(last(w).text).toBe("Searching the web for \"who wrote the odyssey\".");
        // Device requests still go to the tools.
        const f = await ask(t, "can you put the torch on for me");
        expect(last(f)).toMatchObject({ command: "toggle", status: "done", via: "on-device" });
    });

    it("offers the app that does what it cannot", async () => {
        const t = setup();
        const r = await ask(t, "make a playlist of my favourite songs");
        expect(last(r).text).toMatch(/^I don't have the tools for that yet, but I can open Music for you\. Did you mean/);
        expect(last(r).choices.map((c: Reply) => c.id)).toEqual(["open:0", "web", "connect"]);
        await t.svc.choose({ threadId: r.thread.id, messageId: last(r).id, choice: "open:0" });
        expect(launched(t)).toEqual({ id: "org.webosphoenix.music", params: {} });
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
        const r = await ask(t, "hmm, where was I");
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
    const MODEL = "qwen3-1.7b-q8_0";
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
        expect(last(r)).toMatchObject({ text: "chat says: why is the sky blue", via: "on-device", source: "Qwen3 1.7B" });
        // A question about the world: no tools (a short prompt, no misfires).
        expect(mock.requests.at(-1)!.body.tools).toBeUndefined();
        const act = await ask(t, "it's dark, put the flashlight on for me");
        // A request of the device: the command it chose (pickCommand), its
        // arguments held to that command's schema (callCommand).
        const called = mock.requests.at(-1)!.body;
        expect(called.response_format.json_schema.schema.properties.setting).toBeDefined();
        expect(called.messages[1].content).toMatch(/asked the phone to do this: toggle: /);
        expect(last(act)).toMatchObject({ via: "on-device", status: "done", text: "The flashlight is on." });
        // Its times as said: "tomorrow at 6:30 am".
        const wake = await ask(t, "please could you wake me early tomorrow");
        expect(last(wake).text).toBe("Alarm set for 6:30 AM tomorrow.");
    });

    // One prompt, read once (assistant.js localPrefix): the choice and the
    // call (or the answer in words) start with the same system prompt, the
    // same for every request; llama-server keeps it (cache_prompt, its one slot).
    // The choice shows examples only for the few commands the words come near.
    it("shares one prompt between the choice and the call, and across requests", async () => {
        const t = setup({ llm: llm() });
        t.as("org.webosphoenix.settings");
        await t.svc.selectModel({ id: MODEL });
        t.as("com.palm.systemui");
        const from = mock.requests.length;
        await ask(t, "it's dark, put the flashlight on for me");
        await ask(t, "why is the sky blue");
        const sent = mock.requests.slice(from).map((r) => r.body);
        const [pick, call, pick2, chat] = sent;
        expect(pick.response_format).toBeDefined();
        expect(call.tools).toBeUndefined();
        expect(Object.keys(call.response_format.json_schema.schema.properties)).toContain("setting");
        expect(pick2.response_format).toBeDefined();
        expect(chat.tools).toBeUndefined();
        const system = pick.messages[0];
        expect(system.role).toBe("system");
        for (const b of [call, pick2, chat]) expect(b.messages[0]).toEqual(system);
        // Every command by name and the choice's examples, no command's own examples, no time.
        expect(system.content).toMatch(/\ntoggle: /);
        expect(system.content).toMatch(/\n"why is the sky blue": none/);
        expect(system.content).not.toMatch(/e\.g\.|Today is/);
        // What fits the words comes after it.
        expect(pick.messages).toHaveLength(3);
        const hint = pick.messages.at(-2).content as string;
        expect(hint).toMatch(/^Pick the phone command/);
        expect((hint.match(/\n[a-zA-Z]+: "/g) || []).length).toBeLessThanOrEqual(4);
        expect(hint).toMatch(/\ntoggle: "/);
        expect(pick.messages.at(-1)).toEqual({ role: "user", content: "it's dark, put the flashlight on for me" });
        for (const b of sent) expect([b.cache_prompt, b.id_slot]).toEqual([true, undefined]);
        // The time and the command to call come after the shared prompt.
        expect(call.messages[1].role).toBe("system");
        expect(call.messages[1].content).toMatch(/^Today is /);
        expect(call.max_tokens).toBe(160);
    });

    // Its context is 4,096 tokens: the conversation it sees is the latest
    // turns that fit (LOCAL_HISTORY_CHARS), the shared prompt whole.
    it("sees the latest turns that fit in its context", async () => {
        const t = setup({ llm: llm() });
        t.as("org.webosphoenix.settings");
        await t.svc.selectModel({ id: MODEL });
        t.as("com.palm.systemui");
        const long = (n: number) => "tell me about " + String(n).repeat(1500);
        let r: Reply = {};
        for (let i = 1; i <= 4; ++i) r = await ask(t, long(i), r.thread ? { threadId: r.thread.id } : {});
        const sent = mock.requests.at(-1)!.body;
        const turns = sent.messages.slice(2);
        const chars = turns.reduce((n: number, m: Reply) => n + m.content.length, 0);
        expect(chars).toBeLessThanOrEqual(5000);
        expect(turns.at(-1)).toEqual({ role: "user", content: long(4) });
        expect(turns.some((m: Reply) => m.content === long(1))).toBe(false);
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
        expect(m.models.map((x: Reply) => [x.id, x.fits, x.recommended, x.installed, x.builtIn])).toEqual([
            // 4 GB: the built-in model is the one that fits (and so recommended).
            // Qwen3 1.7B stays listed beside the Qwen3.5 2B that replaces it:
            // it is installed.
            ["qwen3-0.6b-q8_0", true, true, false, true], [MODEL, false, false, true, false],
            ["qwen3.5-2b-q8_0", false, false, false, false],
            ["qwen3.5-4b-q4_k_m", false, false, false, false], ["qwen3.5-9b-q4_k_m", false, false, false, false],
            ["qwen3-14b-q4_k_m", false, false, false, false], ["qwen3-30b-a3b-q4_k_m", false, false, false, false]]);
    });

    it("recommends the largest that fits each kind of device", async () => {
        const models = req("./lib/models.js") as { forDevice(r: number): { id: string; recommended: boolean }[] };
        const best = (gb: number) => models.forDevice(gb * 2 ** 30).find((m) => m.recommended)!.id;
        // As devices report their memory: a little under what they are sold as.
        expect([3.7, 5.6, 7.5, 11.4, 15.5, 31, 62].map(best)).toEqual([
            "qwen3-0.6b-q8_0", "qwen3.5-2b-q8_0", "qwen3.5-4b-q4_k_m", "qwen3.5-9b-q4_k_m", "qwen3-14b-q4_k_m",
            "qwen3-30b-a3b-q4_k_m", "qwen3-30b-a3b-q4_k_m"]);
    });

    // The owner's rule: the Qwen team's GGUF first, Phoenix's conversion of
    // their weights when there is none; a newer model hides the one it
    // replaces once it can be downloaded (unless that one is installed).
    it("offers a newer model once there is a file for it, official first", () => {
        type Cat = { find(id: string): { sources: { kind: string; files: { url: string }[] }[]; size: number } | null;
                     forDevice(r: number, keep?: string[]): { id: string; recommended: boolean }[] };
        // Without conversions (models-converted.js empty): only the official files.
        const models = (req("./lib/models.js") as { catalog(c: object): Cat & { catalog(c: object): Cat } }).catalog({});
        expect(models.find("qwen3.5-4b-q4_k_m")!.sources).toEqual([]);
        expect(models.forDevice(0).map((m) => m.id)).not.toContain("qwen3.5-4b-q4_k_m");
        expect(models.find("qwen3-4b-q4_k_m")!.sources.map((x) => x.kind)).toEqual(["official"]);
        const four = { from: { repo: "Qwen/Qwen3.5-4B", revision: "851bf6e806efd8d0a36b00ddf55e13ccb7b8cd0a" }, quant: "Q4_K_M",
                       files: [{ name: "Qwen3.5-4B-Q4_K_M-00001-of-00002.gguf", size: 2e9, sha256: "a".repeat(64) },
                               { name: "Qwen3.5-4B-Q4_K_M-00002-of-00002.gguf", size: 7e8, sha256: "b".repeat(64) }] };
        const c = models.catalog({ "qwen3.5-4b-q4_k_m": four,
                                   // made from other weights: not used
                                   "qwen3.5-9b-q4_k_m": { ...four, from: { repo: "Qwen/Qwen3.5-9B", revision: "0".repeat(40) } } });
        const m = c.find("qwen3.5-4b-q4_k_m")!;
        expect(m.sources.map((x) => x.kind)).toEqual(["phoenix"]);
        expect(m.sources[0].files[1].url).toBe(
            "https://github.com/thebestbradley/webos-phoenix/releases/download/models-qwen3.5-4b-q4_k_m/Qwen3.5-4B-Q4_K_M-00002-of-00002.gguf");
        expect(m.size).toBe(2.7e9);
        const ids = c.forDevice(7.5 * 2 ** 30).map((x) => x.id);
        expect(ids).toContain("qwen3.5-4b-q4_k_m");
        expect(ids).not.toContain("qwen3-4b-q4_k_m");
        expect(ids).not.toContain("qwen3.5-9b-q4_k_m");
        expect(c.forDevice(7.5 * 2 ** 30).find((x) => x.recommended)!.id).toBe("qwen3.5-4b-q4_k_m");
        // The one it replaces, installed: still listed.
        expect(c.forDevice(7.5 * 2 ** 30, ["qwen3-4b-q4_k_m"]).map((x) => x.id)).toContain("qwen3-4b-q4_k_m");
        // Qwen3.8 27B (dense, slow) is offered but never recommended over the MoE.
        const big = models.catalog({ "qwen3.8-27b-q4_k_m": { ...four, from: { repo: "Qwen/Qwen3.8-27B", revision: "1d4bf0f2ff6012fd82039f2fa52739d0dd7c60c0" },
                                                             files: [{ name: "x.gguf", size: 1.7e10, sha256: "c".repeat(64) }] } });
        expect(big.forDevice(62 * 2 ** 30).find((x) => x.recommended)!.id).toBe("qwen3-30b-a3b-q4_k_m");
    });

    describe("built in: Qwen3 0.6B", () => {
        const BUILT_IN = "qwen3-0.6b-q8_0";
        const withBuiltIn = () => ({
            ...llm(),
            status: () => Promise.resolve({ available: true, installed: [{ id: BUILT_IN, builtIn: true }], ramBytes: 2 * 2 ** 30 }),
        });

        it("is the one in use until another is chosen, and answers what the commands do not", async () => {
            const t = setup({ llm: withBuiltIn() });
            const m = await t.svc.models();
            expect(m.selected).toBe(BUILT_IN);
            expect(m.models[0]).toMatchObject({ id: BUILT_IN, installed: true, builtIn: true, name: "Qwen3 0.6B" });
            const r = await ask(t, "why is the sky blue");
            expect(last(r)).toMatchObject({ via: "on-device", source: "Qwen3 0.6B" });
        });

        it("comes after the commands: what the grammar knows never reaches it", async () => {
            const t = setup({ llm: withBuiltIn() });
            const before = mock.requests.length;
            const r = await ask(t, "turn on the flashlight");
            expect(last(r)).toMatchObject({ via: "commands", text: "The flashlight is on." });
            expect(mock.requests.length).toBe(before);
            // What it does not know goes to the model in two steps: it chooses
            // a command (its answer held to their names), then calls that one.
            const act = await ask(t, "it's dark, put the flashlight on for me");
            expect(mock.requests.length).toBe(before + 2);
            const [pick, call] = mock.requests.slice(-2).map((q) => q.body);
            expect(pick.response_format.json_schema.schema.properties.command.enum).toContain("toggle");
            expect(pick.temperature).toBe(0);
            // Its arguments as JSON held to toggle's schema: generation ends at its closing brace.
            expect(call.response_format.json_schema.schema.properties.state).toBeDefined();
            expect(call.temperature).toBe(0);
            expect(call.tools).toBeUndefined();
            expect(call.chat_template_kwargs).toEqual({ enable_thinking: false });
            expect(last(act)).toMatchObject({ via: "on-device", status: "done", text: "The flashlight is on." });
        });

        it("cannot be removed or downloaded, and \"off\" turns it off", async () => {
            const t = setup({ llm: withBuiltIn() });
            t.as("org.webosphoenix.settings");
            expect((await t.svc.removeModel({ id: BUILT_IN })).errorCode).toBe(ERRORS.NOT_ALLOWED);
            expect((await t.svc.downloadModel({ id: BUILT_IN })).errorCode).toBe(ERRORS.NOT_ALLOWED);
            expect((await t.svc.selectModel({ id: "off" })).returnValue).toBe(true);
            expect((await t.svc.models()).selected).toBe("");
            t.as("com.palm.systemui");
            const before = mock.requests.length;
            const r = await ask(t, "why is the sky blue");
            expect(last(r).via).toBe("commands");
            expect(mock.requests.length).toBe(before);
        });

        it("answers a question with a command that reads, never one that changes", async () => {
            const t = setup({ llm: withBuiltIn() });
            const r = await ask(t, "how busy is my friday looking");
            expect(last(r)).toMatchObject({ via: "on-device", command: "agenda" });
            // The choice says toggle, but a question is not asked to switch anything.
            const q = await ask(t, "is it true a flashlight attracts moths?");
            expect(mock.requests.at(-1)!.body.tools).toBeUndefined();
            expect(last(q)).toMatchObject({ via: "on-device", text: "chat says: is it true a flashlight attracts moths?" });
        });

        it("is not used where it is not installed", async () => {
            const t = setup({ llm: llm() });
            const r = await ask(t, "why is the sky blue");
            expect(last(r).via).toBe("commands");
        });
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

    // One deadline for the whole answer (assistant.js bounded): a model
    // that never answers (llama-server busy behind another request) is
    // given up on then, not after each step's own HTTP timeout; its request
    // is closed; the thread says what it is doing meanwhile.
    it("gives up at one deadline, says so, and closes the request", async () => {
        const held: { closed: boolean }[] = [];
        const stall = http.createServer((rq) => { const h = { closed: false }; held.push(h); rq.socket.on("close", () => { h.closed = true; }); });
        await new Promise<void>((r) => stall.listen(0, "127.0.0.1", () => r()));
        const url = `http://127.0.0.1:${(stall.address() as { port: number }).port}/v1`;
        try {
            const t = setup({ llm: { ...llm(), ensure: () => Promise.resolve({ baseUrl: url }) }, deadlineMs: 600 });
            t.as("org.webosphoenix.settings");
            await t.svc.selectModel({ id: MODEL });
            t.as("com.palm.systemui");
            const started = Date.now();
            const asking = ask(t, "why is the sky blue");
            await new Promise((r) => setTimeout(r, 200));
            const th = await t.svc.thread({});
            expect(th.thread.working).toMatchObject({ stage: "thinking" });
            expect(th.thread.working.until - started).toBeLessThanOrEqual(700);
            const r = await asking;
            expect(Date.now() - started).toBeLessThan(2000);
            expect(last(r).text).toBe("I couldn't think that through in time. Want me to search the web?");
            expect(last(r).choices.map((c: Reply) => c.id)).toContain("web");
            expect((await t.svc.thread({})).thread.working).toBeUndefined();
            for (let i = 0; i < 50 && !(held[0] && held[0].closed); ++i) await new Promise((r) => setTimeout(r, 20));
            expect(held.length).toBe(1);
            expect(held[0].closed).toBe(true);
        } finally {
            stall.close();
        }
    });
});

describe("the grammar knew the command, not all it needs: the model fills it in", () => {
    const BUILT_IN = "qwen3-0.6b-q8_0";
    const withModel = () => ({
        status: () => Promise.resolve({ available: true, installed: [{ id: BUILT_IN, builtIn: true }], ramBytes: 2 * 2 ** 30 }),
        ensure: () => Promise.resolve({ baseUrl: mock.url + "/v1" }),
        download: () => Promise.resolve(), cancel: () => Promise.resolve(), remove: () => Promise.resolve(),
    });

    it("a time the grammar could not read, held to the command's parameters", async () => {
        const t = setup({ llm: withModel() });
        const before = mock.requests.length;
        const r = await ask(t, "add an event called dentist friday-ish");
        expect(mock.requests.length).toBe(before + 1);
        const fill = mock.requests.at(-1)!.body;
        expect(Object.keys(fill.response_format.json_schema.schema.properties)).toContain("start");
        expect(fill.response_format.json_schema.schema.required).toEqual([]);
        expect(fill.temperature).toBe(0);
        // The model's Friday 9 AM is the start: the event is made (this test has
        // no calendar to make it in), not asked "When is it?".
        expect(last(r)).toMatchObject({ via: "on-device", source: "Qwen3 0.6B", command: "event" });
        expect(last(r).data?.awaiting).toBeUndefined();
        expect(last(r).text).toMatch(/no calendar/);
    });

    it("what the words never said is dropped, and asked for as before", async () => {
        const t = setup({ llm: withModel() });
        const r = await ask(t, "add an event called dentist");
        expect(last(r)).toMatchObject({ via: "commands", command: "event", data: { awaiting: { command: "event" } } });
    });

    it("without an on-device model, the grammar asks as before", async () => {
        const t = setup();
        const r = await ask(t, "add an event called dentist friday-ish");
        expect(last(r)).toMatchObject({ via: "commands", data: { awaiting: { command: "event" } } });
    });
});

describe("the voice", () => {
    it("speaks with the chosen voice; Play Sample with the one asked for", async () => {
        const t = setup();
        t.as("org.webosphoenix.settings");
        expect((await t.svc.setSettings({ speechVoice: "expr-voice-5-m" })).returnValue).toBe(true);
        expect((await t.svc.setSettings({ speechVoice: "../../etc" })).errorCode).toBe(ERRORS.BAD_PARAMS);
        await t.svc.speak({ text: "Hello." });
        await t.svc.speak({ text: "Sample.", voice: "expr-voice-2-f" });
        expect(t.voices).toEqual(["expr-voice-5-m", "expr-voice-2-f"]);
        t.as("com.palm.systemui");
        await ask(t, "turn on the flashlight");
        expect(t.voices.at(-1)).toBe("expr-voice-5-m");
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
