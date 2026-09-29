// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Who plays: audio focus between the players (Music, Videos, Podcasts),
// so starting one pauses the others, as on webOS.
//
//   com.webos.service.audiofocusmanager   OSE (webosose/audiod-pro,
//       audiofocusmanager; LS2 API reference com-webos-service-
//       audiofocusmanager): requestFocus {requestType, streamType,
//       displayId, subscribe: true} -> {result: "AF_GRANTED" |
//       "AF_GRANTEDALREADY" | "AF_CANNOTBEGRANTED"}; while subscribed, the
//       holder is told {result: "AF_LOST"} when another app takes the
//       focus for good, or "AF_PAUSE" for a moment (a call, a
//       notification). releaseFocus {streamType, displayId} ->
//       {result: "AF_SUCCESSFULLY_RELEASED"}. The simulator keeps the holder
//       in the shared store, so pages tell each other.
//
// "AF_LOST" / "AF_PAUSE" are the event names audiod's focus manager sends
// its subscribers; the public API reference lists only the replies to the
// request itself.

import { call, subscribe, type Subscription } from "./bridge";

const AFM = "luna://com.webos.service.audiofocusmanager";

export type FocusRequest = "AFREQUEST_GAIN" | "AFREQUEST_TRANSIENT" | "AFREQUEST_MIX" | "AFREQUEST_RECORD" | "AFREQUEST_CALL";

export const audioFocus = {
    /**
     * Take the media audio focus. onLost is called when another app takes
     * it (pause then). Cancel the subscription, or call release(), when
     * playback stops. Errors (no focus manager) are ignored: playing
     * without focus is better than not playing.
     */
    request(onLost: () => void, streamType = "pmedia", requestType: FocusRequest = "AFREQUEST_GAIN"): Subscription {
        return subscribe(`${AFM}/requestFocus`, { requestType, streamType, displayId: 0 }, (r) => {
            const result = (r as { result?: string }).result;
            if (result === "AF_LOST" || result === "AF_PAUSE") onLost();
        }, () => {});
    },
    /** releaseFocus {streamType, displayId} */
    release(streamType = "pmedia"): Promise<unknown> {
        return call(`${AFM}/releaseFocus`, { streamType, displayId: 0 }).catch(() => undefined);
    },
};

export interface NowPlaying {
    title: string;
    artist?: string;
    album?: string;
    playing: boolean;
    /** The app playing (Music, Podcasts, ...). */
    appId?: string;
}

type Host = { postToHost?: (type: string, payload: object) => void };
type Palm = { addBannerMessage?: (msg: string, params: string, icon?: string) => void; isActivated?: () => boolean };

/** Tell the shell what plays (the "nowPlaying" host message Music posts). */
export function postNowPlaying(n: NowPlaying): void {
    (globalThis as { phoenixHost?: Host }).phoenixHost?.postToHost?.("nowPlaying", n);
}

/** A banner (PalmSystem.addBannerMessage) when the card is not in front. */
export function bannerIfHidden(message: string, params: object = {}): void {
    const palm = (globalThis as { PalmSystem?: Palm }).PalmSystem;
    if (typeof document !== "undefined" && (document.hidden || palm?.isActivated?.() === false))
        palm?.addBannerMessage?.(message, JSON.stringify(params), "icon.png");
}

type WindowPalm = { setWindowOrientation?: (o: string) => void; enableFullScreenMode?: (on: boolean) => void };

/** PalmSystem.setWindowOrientation: "free" follows the device (docs/APP-RUNTIME.md, Orientation). */
export function setWindowOrientation(o: "free" | "up" | "down" | "left" | "right" | "landscape" | "portrait"): void {
    (globalThis as { PalmSystem?: WindowPalm }).PalmSystem?.setWindowOrientation?.(o);
}

/** PalmSystem.enableFullScreenMode: the maximized card gets the whole screen. */
export function setFullScreen(on: boolean): void {
    (globalThis as { PalmSystem?: WindowPalm }).PalmSystem?.enableFullScreenMode?.(on);
}
