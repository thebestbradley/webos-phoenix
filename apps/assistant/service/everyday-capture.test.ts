// @vitest-environment node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The camera and voice memos (lib/commands-capture.js, lib/lang/en-capture.js):
// the words, the Camera brought to the front with what it should capture
// (a selfie: the front camera; "in 3 seconds": its countdown), Voice Memos
// recording, and "stop recording" stopping whichever the assistant started.

import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { device, NOW } from "./test/device";

const req = createRequire(import.meta.url);
const grammar = req("./lib/grammar.js") as { parse(text: string, ctx?: object): { command: string; args: Record<string, any> } | null };
const parse = (t: string) => grammar.parse(t, { lang: "en", now: NOW });

describe("the words", () => {
    it("takes photos and selfies, with a countdown when asked", () => {
        expect(parse("take a photo")).toEqual({ command: "camera", args: { action: "photo", front: false, delay: 0 } });
        expect(parse("take a selfie")).toEqual({ command: "camera", args: { action: "photo", front: true, delay: 0 } });
        expect(parse("take a selfie in 3 seconds")).toEqual({ command: "camera", args: { action: "photo", front: true, delay: 3 } });
        expect(parse("take a picture in five seconds")).toEqual({ command: "camera", args: { action: "photo", front: false, delay: 5 } });
        expect(parse("take a photo with a 10 second timer")).toEqual({ command: "camera", args: { action: "photo", front: false, delay: 10 } });
        expect(parse("take a picture with the front camera")).toEqual({ command: "camera", args: { action: "photo", front: true, delay: 0 } });
        expect(parse("say cheese")?.args).toMatchObject({ action: "photo", front: true });
        expect(parse("snap a pic of me")?.command).toBe("camera");
    });
    it("records videos and voice memos, and stops them", () => {
        expect(parse("record a video")).toEqual({ command: "camera", args: { action: "video", front: false, delay: 0 } });
        expect(parse("record a selfie video")).toEqual({ command: "camera", args: { action: "video", front: true, delay: 0 } });
        expect(parse("record a voice memo")).toEqual({ command: "voiceMemo", args: { title: "" } });
        expect(parse("record a voice memo called groceries")).toEqual({ command: "voiceMemo", args: { title: "Groceries" } });
        expect(parse("start recording")).toEqual({ command: "voiceMemo", args: { title: "" } });
        expect(parse("stop recording")).toEqual({ command: "stopRecording", args: { what: "" } });
        expect(parse("stop the video")).toEqual({ command: "stopRecording", args: { what: "video" } });
    });
    it("leaves screenshots, notes, timers and drinks alone", () => {
        expect(parse("take a screenshot")?.command).toBe("screenshot");
        expect(parse("take a picture of the screen")?.command).toBe("screenshot");
        expect(parse("take a note")?.command).not.toBe("voiceMemo");
        expect(parse("set a timer for 3 seconds")?.command).toBe("timer");
        expect(parse("take a shot")?.command).not.toBe("camera");
    });
});

describe("the apps", () => {
    it("brings the Camera to the front for a selfie in 3 seconds, the view making way", async () => {
        const d = device();
        const m = await d.ask("take a selfie in 3 seconds");
        expect(m).toMatchObject({ command: "camera", status: "done", text: "Taking a selfie in 3 seconds. Smile!" });
        expect(m.data.opened).toBe(true);
        const launch = d.state.launched.at(-1);
        expect(launch).toMatchObject({ id: "org.webosphoenix.camera", params: { capture: "photo", facing: "user", timer: 3 } });
        expect(launch.behind).toBeUndefined();
    });
    it("records a video and stops it", async () => {
        const d = device();
        expect((await d.ask("record a video")).text).toBe("Recording a video. Say “stop recording” when you're done.");
        expect(d.state.launched.at(-1)).toMatchObject({ id: "org.webosphoenix.camera", params: { capture: "video", facing: "environment", timer: 0 } });
        expect((await d.ask("stop recording")).text).toBe("Stopped recording. The video is in Photos.");
        expect(d.state.launched.at(-1)).toMatchObject({ id: "org.webosphoenix.camera", params: { capture: "stop" } });
        expect((await d.ask("stop recording")).text).toBe("I'm not recording anything.");
    });
    it("records a voice memo with its title, and stops it", async () => {
        const d = device();
        expect((await d.ask("record a voice memo called groceries")).text).toBe("Recording a voice memo, “Groceries”. Say “stop recording” when you're done.");
        expect(d.state.launched.at(-1)).toMatchObject({ id: "org.webosphoenix.voicememos", params: { newMemo: "Groceries" } });
        expect((await d.ask("stop recording")).text).toBe("Stopped recording. The memo is in Voice Memos.");
        expect(d.state.launched.at(-1)).toMatchObject({ id: "org.webosphoenix.voicememos", params: { stopRecording: true } });
    });
    it("waits for the unlock over the lock screen", async () => {
        const d = device();
        const m = await d.ask("take a photo", { locked: true, voice: true });
        expect(m.status).toBe("locked");
        expect(d.state.launched).toEqual([]);
    });
});
