// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import appinfo from "../public/appinfo.json";
import { LAUNCH_PARAMS, parseLaunch } from "./launchParams";

describe("Music's launch params", () => {
    it("lists in appinfo.json the keys it reads (tools/check-launch-contracts.cjs)", () => {
        expect([...appinfo.phoenix.launchParams].sort()).toEqual([...LAUNCH_PARAMS].sort());
    });

    it("reads the Assistant's {play} and the share sheet's {share}", () => {
        expect(parseLaunch({ play: "Miles Davis" })).toEqual({ kind: "play", query: "Miles Davis" });
        const share = { title: "Memo", files: [{ path: "/media/internal/memo.m4a" }] };
        expect(parseLaunch({ share })).toEqual({ kind: "share", share });
    });

    it("plays an audio file opened with it: Files' {target: path}, Email's {target: uri, mimeType, fileName}", () => {
        expect(parseLaunch({ target: "/media/internal/music/song.mp3" })).toEqual({ kind: "file", path: "/media/internal/music/song.mp3" });
        expect(parseLaunch({ target: "file:///media/internal/.email/My%20Song.mp3", mimeType: "audio/mpeg", fileName: "My Song.mp3" }))
            .toEqual({ kind: "file", path: "/media/internal/.email/My Song.mp3", mimeType: "audio/mpeg", title: "My Song" });
        expect(parseLaunch({ target: "https://example.com/a.ogg" })).toEqual({ kind: "file", url: "https://example.com/a.ogg" });
        expect(parseLaunch({ target: "relative.mp3" })).toEqual({ kind: "none" });
        expect(parseLaunch({})).toEqual({ kind: "none" });
    });
});
