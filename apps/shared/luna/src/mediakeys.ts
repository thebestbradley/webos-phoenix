// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The headset's button, the media keys and the headset's plug, for the
// players (Music, Podcasts, Videos), from com.palm.keys (device.ts):
//
//   /headset  headset_button  single_click  play / pause
//                             double_click  next (see below)
//                             hold          nothing here: on webOS it is
//                                           the phone's (Voice Dial)
//             headset, headset-mic  "up"    unplugged: pause
//   /media    play, pause, togglePausePlay, stop, next, prev  ("down")
//
// What luna-sysmgr sends (openwebos/luna-sysmgr Src/base/InputManager.cpp):
// the headset button's clicks come from headsetStateMachine (:254-331),
// which posts single_click when the button is let go (:268-276) and, if it
// is pressed again within DOUBLE_PRESS_TIME_MS (1 s, :73), double_click
// when that press is let go (:314-321); there is no triple click (after a
// double click the machine starts again, :320). A double click therefore
// arrives as single_click then double_click. The player acts on the
// single click at once, as the button should feel, and on the double click
// puts the play state back to what it was before the first click and goes
// to the next track: a double click while playing skips and keeps playing.
// The previous track has no button gesture; it is the media key "prev"
// (Key_MediaPrevious, keyToString :876-955, isMediaKey :968-986). A headset
// plugged in is Key_Headset or Key_HeadsetMic "down" on /headset, taken
// out "up" (getKeyState :784-795).
//
// The original Music app's source was not part of the Open webOS release;
// webOS's own documentation of the headset (luna-sysmgr's com.palm.keys
// pages, InputManager.cpp:655-700) gives the events but not what the app
// did with them, so the mapping above is Phoenix's reading of those
// events: the convention of the time (one click plays or pauses, two
// skip) on exactly what InputManager sent.
//
// Every player that is running hears the keys, so only the one the keys
// are for acts on the buttons: the one holding the media audio focus
// (playback.ts), i.e. the one that played last. Unplugging pauses whatever
// plays.

import type { Subscription } from "./bridge";
import { keys, type KeyEvent } from "./device";

/** What a player does for a key. "unplugged": pause if playing, whoever has the focus. */
export type MediaCommand = "play" | "pause" | "next" | "prev" | "unplugged";

/** The headset button's play state before its first click (for a double click). */
export interface HeadsetClicks {
    playingBeforeClick?: boolean;
}

/**
 * The commands for one com.palm.keys event of the /headset or /media
 * category, given whether the player plays now. clicks carries what a
 * single click did, for the double click that may follow it.
 */
export function mediaKeyCommands(category: "headset" | "media", e: KeyEvent, playing: boolean, clicks: HeadsetClicks): MediaCommand[] {
    if (category === "headset") {
        if (e.key === "headset_button") {
            if (e.state === "single_click") {
                clicks.playingBeforeClick = playing;
                return [playing ? "pause" : "play"];
            }
            if (e.state === "double_click") {
                const was = clicks.playingBeforeClick ?? playing;
                clicks.playingBeforeClick = undefined;
                return [was ? "play" : "pause", "next"];
            }
            return [];
        }
        if ((e.key === "headset" || e.key === "headset-mic") && e.state === "up") return ["unplugged"];
        return [];
    }
    // A media key acts when it goes down (a held key does not repeat:
    // InputManager posts only presses and releases).
    if (e.state !== "down") return [];
    switch (e.key) {
        case "play": return ["play"];
        case "pause":
        case "stop": return ["pause"];
        case "togglePausePlay": return [playing ? "pause" : "play"];
        case "next": return ["next"];
        case "prev": return ["prev"];
        default: return [];
    }
}

/** A player, as the keys see it. */
export interface MediaKeyTarget {
    /** The keys are for this player: it holds the media audio focus. */
    active(): boolean;
    playing(): boolean;
    play(): void;
    pause(): void;
    /** Next track (Music), or ahead (Podcasts, Videos). */
    next?(): void;
    /** Previous track (Music), or back (Podcasts, Videos). */
    prev?(): void;
}

/** Run a command on a player (exported for the tests). */
export function runMediaCommand(target: MediaKeyTarget, c: MediaCommand): void {
    if (c === "unplugged") {
        if (target.playing()) target.pause();
        return;
    }
    if (!target.active()) return;
    if (c === "play") { if (!target.playing()) target.play(); }
    else if (c === "pause") { if (target.playing()) target.pause(); }
    else if (c === "next") target.next?.();
    else if (c === "prev") target.prev?.();
}

/**
 * Subscribe to the headset and media keys for a player until cancelled.
 * The target is read when a key comes, so it can hold refs to live state.
 */
export function watchMediaKeys(target: MediaKeyTarget): Subscription {
    const clicks: HeadsetClicks = {};
    const on = (category: "headset" | "media") => (e: KeyEvent) => {
        // The state before the first command: a double click's "play" and
        // "next" are both decided from it, not from each other's effect.
        const cmds = mediaKeyCommands(category, e, target.playing(), clicks);
        for (const c of cmds) runMediaCommand(target, c);
    };
    const subs = [keys.watch("headset", on("headset"), () => {}), keys.watch("media", on("media"), () => {})];
    let cancelled = false;
    return {
        cancel() {
            if (cancelled) return;
            cancelled = true;
            subs.forEach((s) => s.cancel());
        },
        get cancelled() { return cancelled; },
    };
}
