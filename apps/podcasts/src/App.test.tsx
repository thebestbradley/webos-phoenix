// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Podcasts launched with {playEpisode: id} (the Assistant's "play the latest
// episode of ...", apps/assistant/service lib/commands-music.js), against
// the simulated services: that episode is the one playing, Now Playing shown
// (from where it was left: the player's, player.tsx).

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { call } from "@phoenix/luna";
import { App } from "./App";
import { EPISODE_KIND, PODCAST_KIND } from "./store";

type PS = { launchParams?: string; getResource(p: string): string | undefined };

beforeAll(() => {
    const w = window as unknown as Record<string, unknown>;
    w.phoenixHost = { postToHost: () => {} };
    new Function(readFileSync(resolve(__dirname, "../../../runtime/phoenix-runtime.js"), "utf8")).call(window);
    (w.PalmSystem as PS).getResource = () => undefined;
    // jsdom has no media playback: what plays is the state.
    HTMLMediaElement.prototype.play = () => Promise.resolve();
    HTMLMediaElement.prototype.pause = () => {};
});
afterEach(() => { ((window as unknown as { PalmSystem: PS }).PalmSystem).launchParams = "{}"; });

describe("Podcasts, asked to play an episode", () => {
    it("plays it from where it was left, Now Playing shown", async () => {
        await call("luna://com.palm.db/put", { objects: [
            { _id: "pod-1", _kind: PODCAST_KIND, feedUrl: "https://harbor.example/feed", title: "Harbor Radio", author: "Ada", description: "", subscribed: true },
            { _id: "ep-1", _kind: EPISODE_KIND, podcastId: "pod-1", guid: "g1", title: "Tides", description: "", published: 1, duration: 1800,
              url: "https://cdn.example/tides.mp3", type: "audio/mpeg", position: 754, played: false },
        ] });
        ((window as unknown as { PalmSystem: PS }).PalmSystem).launchParams = JSON.stringify({ playEpisode: "ep-1" });
        render(<App />);
        await waitFor(() => expect(screen.getByTestId("np-title").textContent).toBe("Tides"), { timeout: 5000 });
        // (Whether it then plays is the audio element's: jsdom has none.)
    });
});
