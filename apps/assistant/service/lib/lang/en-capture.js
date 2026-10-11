// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// English for lib/commands-capture.js: photos, selfies (with a countdown),
// videos, voice memos and stopping a recording. h: lib/lang/en.js's helpers.

"use strict";

module.exports = function (h) {
    var N = "(\\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|fifteen|twenty|thirty)";
    // "in 3 seconds", "with a 10 second timer", "after five seconds", "on a timer".
    var DELAY = new RegExp("(?: (?:in|after|with a|with an|on a|using a) " + N + "[ -]?(?:seconds?|secs?|second timer|second delay|s)(?: timer| delay)?| (?:with|on|using) a (?:timer|countdown|self[- ]?timer))$");
    function delayOf(t) {
        var m = DELAY.exec(t);
        if (!m) return { rest: t, delay: 0 };
        var n = m[1] ? (h.number(m[1]) || Number(m[1]) || 0) : 3;
        return { rest: t.slice(0, m.index), delay: Math.max(0, Math.min(30, n)) };
    }
    var PHOTO = "(?:photo|picture|pic|snapshot|snap)";
    function camera(t) {
        var d = delayOf(t), s = d.rest;
        var m;
        if ((m = /^(?:take|snap|grab|shoot|capture|get|make)(?: me)?(?: a| an| my)? (selfie|(?:front[- ]camera |selfie )?(?:photo|picture|pic|snapshot|snap))(?: of (?:me|myself|us|this|that|it))?(?: with the (front|selfie|back|rear) camera)?$/.exec(s)))
            return { action: "photo", front: /selfie|front/.test(m[1]) || m[2] === "front" || m[2] === "selfie", delay: d.delay };
        if (/^(?:selfie|say cheese|cheese|selfie time)$/.test(s)) return { action: "photo", front: true, delay: d.delay };
        if (new RegExp("^" + PHOTO + "(?: please)?$").test(s) && d.delay) return { action: "photo", front: false, delay: d.delay };
        if ((m = /^(?:record|take|shoot|start|film|capture|make|start recording)(?: me)?(?: a| an)? (selfie |front[- ]camera )?(?:video|movie|clip|vid)(?: of (?:me|myself|us|this|that|it))?(?: with the (front|selfie|back|rear) camera)?$/.exec(s)))
            return { action: "video", front: !!m[1] || m[2] === "front" || m[2] === "selfie", delay: d.delay };
        if (/^(?:start )?(?:recording|filming) (?:a )?(?:video|this)$/.test(s)) return { action: "video", front: false, delay: d.delay };
        return null;
    }
    var MEMO = "(?:voice (?:memo|note|recording|message to myself)|audio (?:memo|note|recording|clip)|memo recording|sound recording)";
    function voiceMemo(t, ctx) {
        var m = new RegExp("^(?:record|start|make|take|create|begin|new|start recording)(?: me)?(?: a| an| my)? (?:new )?" + MEMO + "(?: (?:called|named|titled|about|for|on) (.+))?$").exec(t);
        if (m) return { title: m[1] ? h.capital(h.cased(m[1].replace(/^(?:the|my|a|an) /, ""), ctx)) : "" };
        if (/^(?:start recording|record (?:me|myself|some audio|audio|my voice)|start a recording)$/.test(t)) return { title: "" };
        return null;
    }
    function stopRecording(t) {
        var m = /^(?:stop|end|finish|done|cut|save)(?: the| my)? (?:recording|filming|video|voice memo|voice note|audio recording|memo recording)(?: now)?$/.exec(t);
        if (!m) return null;
        return { what: /video|filming/.test(t) ? "video" : /memo|note|audio/.test(t) ? "memo" : "" };
    }

    function seconds(n) { return n === 1 ? "1 second" : n + " seconds"; }
    var say = {
        takingPhoto: function (selfie, delay) {
            if (delay) return (selfie ? "Taking a selfie in " : "Taking a photo in ") + seconds(delay) + (selfie ? ". Smile!" : ".");
            return selfie ? "Taking a selfie. Smile!" : "Taking a photo.";
        },
        recordingVideo: function (selfie, delay) {
            return (delay ? "Recording " + (selfie ? "a selfie video" : "a video") + " in " + seconds(delay) + "." : "Recording " + (selfie ? "a selfie video." : "a video.")) +
                   " Say “stop recording” when you're done.";
        },
        recordingMemo: function (title) {
            return (title ? "Recording a voice memo, “" + title + "”." : "Recording a voice memo.") + " Say “stop recording” when you're done.";
        },
        recordingStopped: function (what) { return what === "video" ? "Stopped recording. The video is in Photos." : "Stopped recording. The memo is in Voice Memos."; },
        notRecording: function () { return "I'm not recording anything. One started in the Camera or Voice Memos stops there."; }
    };

    return {
        // After the timer's ("set a 3 second timer" stays a timer): these say photo, video, memo or recording.
        rules: [["camera", camera], ["voiceMemo", voiceMemo], ["stopRecording", stopRecording]],
        say: say,
        MENTIONS: {
            camera: /\b(photo|picture|pic|selfie|snap|snapshot|shot|video|movie|clip|film|record\w*|camera|cheese)\b/,
            voiceMemo: /\b(voice|audio|memo|record\w*|recording)\b/,
            // Words to stop and words for a recording, both ("stop driving mode" is no recording, "start filming" no stop).
            stopRecording: /^(?=.*\b(?:stop|end|finish|cut|done|save|enough|wrap)\b)(?=.*\b(?:record\w*|video|memo|film\w*|cut|clip)\b)/
        },
        describe: function (command, args) {
            if (command === "camera") return args.action === "video" ? "record a video" : args.front ? "take a selfie" : "take a photo";
            if (command === "voiceMemo") return "record a voice memo";
            if (command === "stopRecording") return "stop recording";
            return "";
        },
        help: { title: "Camera & Recordings", examples: ["Take a selfie in 3 seconds", "Record a video", "Record a voice memo", "Stop recording"] }
    };
};
