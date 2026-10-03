// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Playback, which carries on with the card in the background: one episode
// in an HTML5 <audio> element (uMediaServer on OSE), from its download if
// there is one, else streamed. The speed (playbackRate, pitch kept), the
// sleep timer, the place in each episode (saved every few seconds and on
// pause), the audio focus (Music and Videos pause when an episode plays,
// and the episode pauses when they start), and what plays for the shell:
// the "nowPlaying" host message and a banner, as Music posts them.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { audioFocus, bannerIfHidden, mediaUrl, postNowPlaying, type Subscription } from "@phoenix/luna";
import { APP_ID, podcasts, type Episode, type Podcast } from "./store";
import { sleepDue, startSleep, type SleepChoice, type SleepTimer } from "./timing";

export interface Player {
    episode: Episode | null;
    podcast: Podcast | null;
    playing: boolean;
    position: number;
    duration: number;
    speed: number;
    sleep: SleepTimer | null;
    sleepChoice: SleepChoice;
    play(e: Episode, p: Podcast): void;
    toggle(): void;
    seek(s: number): void;
    skip(delta: number): void;
    setSpeed(s: number): void;
    setSleep(c: SleepChoice): void;
    stop(): void;
}

const Ctx = createContext<Player | null>(null);
export function usePlayer(): Player {
    const p = useContext(Ctx);
    if (!p) throw new Error("usePlayer outside PlayerProvider");
    return p;
}

const SPEED_KEY = "org.webosphoenix.podcasts:speed";
const SAVE_EVERY = 5000;

function loadSpeed(): number {
    try { const v = Number(localStorage.getItem(SPEED_KEY)); return v >= 0.5 && v <= 3 ? v : 1; } catch { return 1; }
}

export function PlayerProvider({ children }: { children: ReactNode }) {
    const el = useRef<HTMLAudioElement | null>(null);
    if (!el.current && typeof Audio !== "undefined") {
        el.current = new Audio();
        el.current.preload = "auto";
    }
    const [episode, setEpisode] = useState<Episode | null>(null);
    const [podcast, setPodcast] = useState<Podcast | null>(null);
    const [playing, setPlaying] = useState(false);
    const [position, setPosition] = useState(0);
    const [duration, setDuration] = useState(0);
    const [speed, setSpeedState] = useState(loadSpeed);
    const [sleep, setSleepState] = useState<SleepTimer | null>(null);
    const [sleepChoice, setSleepChoice] = useState<SleepChoice>(0);
    const focus = useRef<Subscription | null>(null);
    const current = useRef<Episode | null>(null);
    current.current = episode;

    const save = useCallback(() => {
        const a = el.current, e = current.current;
        if (!a || !e?._id || !isFinite(a.currentTime) || a.currentTime <= 0) return;
        void podcasts.saveProgress(e, a.currentTime, isFinite(a.duration) ? a.duration : undefined).catch(() => {});
    }, []);

    const takeFocus = () => {
        if (focus.current) return;
        focus.current = audioFocus.request(() => {
            focus.current?.cancel();
            focus.current = null;
            el.current?.pause();
        });
    };

    // Element events.
    useEffect(() => {
        const a = el.current;
        if (!a) return;
        const onTime = () => setPosition(a.currentTime);
        const onMeta = () => { if (isFinite(a.duration) && a.duration > 0) setDuration(a.duration); };
        const onPlay = () => { setPlaying(true); takeFocus(); };
        const onPause = () => { setPlaying(false); save(); };
        const onEnded = () => {
            setPlaying(false);
            const e = current.current;
            if (e?._id) void podcasts.setPlayed([e._id], true).catch(() => {});
            // "End of episode" on the sleep timer ends here.
            setSleepState(null);
            setSleepChoice(0);
        };
        a.addEventListener("timeupdate", onTime);
        a.addEventListener("loadedmetadata", onMeta);
        a.addEventListener("durationchange", onMeta);
        a.addEventListener("play", onPlay);
        a.addEventListener("pause", onPause);
        a.addEventListener("ended", onEnded);
        return () => {
            a.removeEventListener("timeupdate", onTime);
            a.removeEventListener("loadedmetadata", onMeta);
            a.removeEventListener("durationchange", onMeta);
            a.removeEventListener("play", onPlay);
            a.removeEventListener("pause", onPause);
            a.removeEventListener("ended", onEnded);
        };
    }, [save]);

    // The place is saved as it plays.
    useEffect(() => {
        if (!playing) return;
        const t = setInterval(save, SAVE_EVERY);
        return () => clearInterval(t);
    }, [playing, save]);

    // The sleep timer.
    useEffect(() => {
        if (!sleep || sleep.until === null) return;
        const t = setInterval(() => {
            if (sleepDue(sleep)) {
                el.current?.pause();
                setSleepState(null);
                setSleepChoice(0);
            }
        }, 1000);
        return () => clearInterval(t);
    }, [sleep]);

    // Tell the shell.
    const announced = useRef<string | undefined>(undefined);
    useEffect(() => {
        if (!episode) return;
        postNowPlaying({ title: episode.title, artist: podcast?.title ?? "", album: podcast?.author ?? "", playing, appId: APP_ID });
        if (playing && announced.current !== episode.guid) {
            announced.current = episode.guid;
            bannerIfHidden(`${episode.title} – ${podcast?.title ?? ""}`);
        }
    }, [episode, podcast, playing]);

    useEffect(() => () => { save(); focus.current?.cancel(); el.current?.pause(); }, [save]);

    const player = useMemo<Player>(() => ({
        episode, podcast, playing, position, duration, speed, sleep, sleepChoice,
        play(e, p) {
            const a = el.current;
            if (!a) return;
            if (current.current?._id === e._id && a.src) { void a.play().catch(() => setPlaying(false)); return; }
            save();
            setEpisode(e);
            setPodcast(p);
            setPosition(e.position || 0);
            setDuration(e.duration || 0);
            const src = e.file ? mediaUrl(e.file) : Promise.resolve(e.url);
            void src.then((u) => {
                a.src = u;
                a.playbackRate = speed;
                // Pitch stays as it is when faster (preservesPitch is the default).
                const start = e.position && e.duration && e.position < e.duration - 5 ? e.position : 0;
                const go = () => { if (start) a.currentTime = start; a.playbackRate = speed; void a.play().catch(() => setPlaying(false)); };
                if (a.readyState >= 1) go(); else a.addEventListener("loadedmetadata", go, { once: true });
            });
        },
        toggle() {
            const a = el.current;
            if (!a || !a.src) return;
            if (a.paused) void a.play().catch(() => setPlaying(false)); else a.pause();
        },
        seek(s) {
            const a = el.current;
            if (!a) return;
            a.currentTime = Math.max(0, Math.min(isFinite(a.duration) ? a.duration : s, s));
            setPosition(a.currentTime);
            save();
        },
        skip(delta) { player.seek((el.current?.currentTime ?? 0) + delta); },
        setSpeed(s) {
            setSpeedState(s);
            if (el.current) el.current.playbackRate = s;
            try { localStorage.setItem(SPEED_KEY, String(s)); } catch { /* ignore */ }
        },
        setSleep(c) { setSleepChoice(c); setSleepState(startSleep(c)); },
        stop() { save(); el.current?.pause(); setEpisode(null); setPodcast(null); },
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }), [episode, podcast, playing, position, duration, speed, sleep, sleepChoice, save]);

    return <Ctx.Provider value={player}>{children}</Ctx.Provider>;
}
