// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Playback. The songs play in an HTML5 <audio> element: on OSE, WebAppMgr
// (Chromium) plays web media through uMediaServer (com.webos.media), the
// same pipeline a native player would drive with load/play/pause/seek.
// Volume is the media stream's volume in the audio service
// (com.webos.service.audio setInputVolume/getInputVolume {streamType:
// "pmedia"}, as Settings' Sounds pane uses), so Settings moves it too.
//
// The shell gets a "nowPlaying" host message ({title, artist, album,
// playing}) whenever the song or play state changes, and a banner when a
// new song starts while the card is not in front.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { audio as audioService, mediaUrl, type AudioItem } from "@phoenix/luna";
import { artistOf, playOrder, titleOf } from "./library";

export type Repeat = "off" | "all" | "one";

export interface PlayerState {
    queue: AudioItem[];
    /** Play order: indexes into queue. */
    order: number[];
    /** Position in order. */
    at: number;
    playing: boolean;
    position: number;
    duration: number;
    volume: number;
    shuffle: boolean;
    repeat: Repeat;
    /** Bumped whenever the current song must load from the start. */
    token: number;
}

export interface Player extends PlayerState {
    current?: AudioItem;
    play(queue: AudioItem[], index: number): void;
    toggle(): void;
    next(): void;
    prev(): void;
    seek(seconds: number): void;
    setVolume(v: number): void;
    setShuffle(on: boolean): void;
    setRepeat(r: Repeat): void;
}

const Ctx = createContext<Player | null>(null);

export function usePlayer(): Player {
    const p = useContext(Ctx);
    if (!p) throw new Error("usePlayer outside PlayerProvider");
    return p;
}

type Host = { postToHost?: (type: string, payload: object) => void };
type Palm = { addBannerMessage?: (msg: string, params: string, icon?: string) => void; isActivated?: () => boolean };

function onDevice(): boolean {
    return !!(globalThis as { __phoenixRuntime?: { onDevice?: boolean } }).__phoenixRuntime?.onDevice;
}

export function PlayerProvider({ children }: { children: ReactNode }) {
    const el = useRef<HTMLAudioElement | null>(null);
    if (!el.current && typeof Audio !== "undefined") {
        el.current = new Audio();
        el.current.preload = "auto";
    }
    const [s, setS] = useState<PlayerState>({
        queue: [], order: [], at: 0, playing: false, position: 0, duration: 0, volume: 60, shuffle: false, repeat: "off", token: 0,
    });
    const playing = useRef(s.playing);
    playing.current = s.playing;
    const current = s.queue[s.order[s.at]];

    // Media stream volume from the audio service.
    useEffect(() => {
        const sub = audioService.watchStream("pmedia", (v) => setS((x) => ({ ...x, volume: v })), () => {});
        return () => sub.cancel();
    }, []);
    useEffect(() => {
        // On a device audiod applies the stream volume itself.
        if (el.current && !onDevice()) el.current.volume = Math.max(0, Math.min(1, s.volume / 100));
    }, [s.volume]);

    // Load the current song.
    const path = current?.file_path;
    useEffect(() => {
        const a = el.current;
        if (!a || !path) return;
        let live = true;
        void mediaUrl(path).then((url) => {
            if (!live) return;
            a.src = url;
            if (playing.current) void a.play().catch(() => setS((x) => ({ ...x, playing: false })));
        });
        return () => { live = false; };
    }, [path, s.token]);

    // Play/pause follows the state.
    useEffect(() => {
        const a = el.current;
        if (!a || !a.src) return;
        if (s.playing && a.paused) void a.play().catch(() => setS((x) => ({ ...x, playing: false })));
        else if (!s.playing && !a.paused) a.pause();
    }, [s.playing]);

    const step = useCallback((dir: 1 | -1, auto = false) => {
        setS((x) => {
            if (!x.queue.length) return x;
            if (auto && x.repeat === "one") return { ...x, position: 0, token: x.token + 1 };
            let at = x.at + dir;
            if (at >= x.order.length) {
                if (auto && x.repeat !== "all") return { ...x, at: 0, playing: false, position: 0, token: x.token + 1 };
                at = 0;
            }
            if (at < 0) at = x.order.length - 1;
            const next = x.queue[x.order[at]];
            return { ...x, at, position: 0, duration: next?.duration ?? 0, token: x.token + 1 };
        });
    }, []);

    // Element events.
    useEffect(() => {
        const a = el.current;
        if (!a) return;
        const onTime = () => setS((x) => (Math.abs(x.position - a.currentTime) < 0.2 ? x : { ...x, position: a.currentTime }));
        const onMeta = () => setS((x) => ({ ...x, duration: isFinite(a.duration) && a.duration > 0 ? a.duration : x.duration }));
        const onEnded = () => step(1, true);
        a.addEventListener("timeupdate", onTime);
        a.addEventListener("loadedmetadata", onMeta);
        a.addEventListener("durationchange", onMeta);
        a.addEventListener("ended", onEnded);
        return () => {
            a.removeEventListener("timeupdate", onTime);
            a.removeEventListener("loadedmetadata", onMeta);
            a.removeEventListener("durationchange", onMeta);
            a.removeEventListener("ended", onEnded);
        };
    }, [step]);

    // Tell the shell.
    const announced = useRef<string | undefined>(undefined);
    useEffect(() => {
        if (!current) return;
        const host = (globalThis as { phoenixHost?: Host }).phoenixHost;
        const palm = (globalThis as { PalmSystem?: Palm }).PalmSystem;
        host?.postToHost?.("nowPlaying", {
            title: titleOf(current), artist: artistOf(current), album: current.album ?? "", playing: s.playing,
        });
        if (s.playing && announced.current !== current.uri) {
            announced.current = current.uri;
            if (document.hidden || palm?.isActivated?.() === false)
                palm?.addBannerMessage?.(`${titleOf(current)} – ${artistOf(current)}`, "{}", "icon.png");
        }
    }, [current, s.playing]);

    const player = useMemo<Player>(() => ({
        ...s,
        current,
        play(queue, index) {
            setS((x) => ({
                ...x, queue, order: playOrder(queue.length, index, x.shuffle), at: x.shuffle ? 0 : index,
                playing: true, position: 0, duration: queue[index]?.duration ?? 0, token: x.token + 1,
            }));
        },
        toggle() { setS((x) => (x.queue.length ? { ...x, playing: !x.playing } : x)); },
        next() { step(1); },
        prev() {
            const a = el.current;
            if (a && a.currentTime > 3) {
                a.currentTime = 0;
                setS((x) => ({ ...x, position: 0 }));
            } else {
                step(-1);
            }
        },
        seek(seconds) {
            const a = el.current;
            if (a) a.currentTime = seconds;
            setS((x) => ({ ...x, position: seconds }));
        },
        setVolume(v) {
            setS((x) => ({ ...x, volume: v }));
            void audioService.setStreamVolume("pmedia", v).catch(() => {});
        },
        setShuffle(on) {
            setS((x) => {
                const idx = x.order[x.at] ?? 0;
                return { ...x, shuffle: on, order: playOrder(x.queue.length, idx, on), at: on ? 0 : idx };
            });
        },
        setRepeat(r) { setS((x) => ({ ...x, repeat: r })); },
    }), [s, current, step]);

    return <Ctx.Provider value={player}>{children}</Ctx.Provider>;
}
