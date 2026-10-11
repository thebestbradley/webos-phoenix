// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The camera and voice memos (docs/AI-AND-MCP.md, "Everyday features"):
//
//   camera         "take a photo", "take a selfie in 3 seconds", "record a
//                  video": the Camera app in front with {capture: "photo" |
//                  "video", facing: "user" (a selfie) | "environment",
//                  timer: seconds}; it counts down over its viewfinder, with
//                  Cancel, then presses its own shutter (apps/camera App.tsx),
//                  so the picture is the Camera's, saved and indexed as one
//                  taken by hand.
//   voiceMemo      "record a voice memo (called groceries)": Voice Memos in
//                  front with {newMemo: title} (its Just Type action's), which
//                  starts recording.
//   stopRecording  "stop recording": what the assistant last started
//                  recording, the Camera's video ({capture: "stop"}) or the
//                  voice memo ({stopRecording: true}).
//
// The apps come to the front (the answer's data.opened: the Assistant's
// view makes way), unlike the apps other answers open behind it.

"use strict";

var CAMERA = "org.webosphoenix.camera";
var VOICE_MEMOS = "org.webosphoenix.voicememos";
var REC_KEY = "assistant:recording";

var COMMANDS = [
    { id: "camera", title: "Photos and videos", risk: "change",
      description: "Take a photo or a selfie (with the front camera), after a countdown if asked, or record a video, with the Camera.",
      parameters: { type: "object", properties: {
          action: { type: "string", enum: ["photo", "video"] },
          front: { type: "boolean", description: "The front camera: a selfie" },
          delay: { type: "integer", minimum: 0, maximum: 30, description: "Seconds to count down first" } }, required: ["action"] },
      examples: ["snap a pic of me", "get a shot of this", "film this for me", "I want a selfie with a timer"] },
    { id: "voiceMemo", title: "Voice memos", risk: "change",
      description: "Start recording a voice memo in Voice Memos, with a title if given.",
      parameters: { type: "object", properties: { title: { type: "string", description: "What it is called, if said" } } },
      examples: ["I need to record myself", "capture some audio", "start an audio note about the meeting"] },
    { id: "stopRecording", title: "Stopping a recording", risk: "change",
      description: "Stop the video or voice memo being recorded, and save it.",
      parameters: { type: "object", properties: { what: { type: "string", enum: ["", "video", "memo"] } } },
      examples: ["that's enough recording", "cut", "finish the recording"] }
];

module.exports = function (h) {
    function front(env, appId, params) {
        return h.lunaCall(env, "luna://com.palm.applicationManager/launch", { id: appId, params: params, returnToCaller: true });
    }
    function camera(args, env) {
        var say = env.lang.say, video = args.action === "video";
        var delay = Math.max(0, Math.min(30, Math.round(Number(args.delay) || 0)));
        var params = { capture: video ? "video" : "photo", facing: args.front ? "user" : "environment", timer: delay };
        return front(env, CAMERA, params).then(function () {
            if (video) env.storage.set(REC_KEY, { what: "video", at: env.now() });
            return { text: video ? say.recordingVideo(!!args.front, delay) : say.takingPhoto(!!args.front, delay), data: { opened: true },
                     open: { appId: CAMERA, params: {}, title: "Camera" } };
        });
    }
    function memo(args, env) {
        var title = String(args.title || "").trim();
        return front(env, VOICE_MEMOS, { newMemo: title }).then(function () {
            env.storage.set(REC_KEY, { what: "memo", at: env.now() });
            return { text: env.lang.say.recordingMemo(title), data: { opened: true }, open: { appId: VOICE_MEMOS, params: {}, title: "Voice Memos" } };
        });
    }
    function stop(args, env) {
        var say = env.lang.say, last = env.storage.get(REC_KEY) || {};
        var what = args.what === "video" || args.what === "memo" ? args.what : last.what;
        if (!what) return Promise.resolve({ text: say.notRecording() });
        env.storage.remove(REC_KEY);
        return (what === "video" ? front(env, CAMERA, { capture: "stop" }) : front(env, VOICE_MEMOS, { stopRecording: true })).then(function () {
            return { text: say.recordingStopped(what), data: { opened: true },
                     open: what === "video" ? { appId: CAMERA, params: {}, title: "Camera" } : { appId: VOICE_MEMOS, params: {}, title: "Voice Memos" } };
        });
    }
    return {
        COMMANDS: COMMANDS,
        run: function (cmd, args, env) {
            if (cmd.id === "camera") return camera(args, env);
            if (cmd.id === "voiceMemo") return memo(args, env);
            if (cmd.id === "stopRecording") return stop(args, env);
            return null;
        }
    };
};
