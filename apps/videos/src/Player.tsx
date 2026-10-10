// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The player: the video on black, full screen, turning with the device.
// Tap to show or hide the controls (the title and back button at the top;
// the seek bar and the command menu at the bottom: subtitles, back 10 s,
// play / pause, ahead 30 s, fit / fill). It picks up where the video was
// left, draws SRT or WebVTT subtitles found beside it, and takes the audio
// focus, so Music and Podcasts pause when it plays (and it pauses when
// they start).
//
//   Playback: HTML5 <video>, which WebAppMgr plays through uMediaServer on OSE.
//   Orientation: PalmSystem.setWindowOrientation("free") while playing, back
//       to "up" in the library; enableFullScreenMode hides the status bar.
//   Audio focus: com.webos.service.audiofocusmanager requestFocus (playback.ts).
//   Headset and media keys: com.palm.keys, as Music takes them (@phoenix/luna
//       mediakeys.ts): the headset button's single click plays or pauses,
//       taking the headset out pauses; a double click and the next key go
//       ahead 30 s, the previous key back 10 s, as the toolbar's buttons.
//       The buttons act while the player holds the audio focus.

import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react";
import { audioFocus, captionsOn, fileManager, isWebAddress, listFolderPaths, playableUrl, setFullScreen, setWindowOrientation, watchMediaKeys, type Subscription } from "./platform";
import { IconToolButton, PopupMenu, Slider, Toolbar, ToolSpacer, cssImage, formatSeconds, icons, type Option } from "@phoenix/ui";
import { forgetPosition, loadPositions, resumeAt, savePosition, type Prefs } from "./library";
import { cueText, parseSubtitles, pickTrack, subtitleTracks, type Cue, type SubtitleTrack } from "./subtitles";

export interface PlayerProps {
    /** A file path or web address. */
    target: string;
    title: string;
    prefs: Prefs;
    onPrefs: (p: Prefs) => void;
    onClose: () => void;
}

const HIDE_AFTER = 3000;

export function Player({ target, title, prefs, onPrefs, onClose }: PlayerProps) {
    const video = useRef<HTMLVideoElement>(null);
    const [url, setUrl] = useState<string | null>(null);
    const [error, setError] = useState("");
    const [playing, setPlaying] = useState(false);
    const [position, setPosition] = useState(0);
    const [duration, setDuration] = useState(0);
    const [scrub, setScrub] = useState<number | null>(null);
    const [chrome, setChrome] = useState(true);
    const [tracks, setTracks] = useState<SubtitleTrack[]>([]);
    const [track, setTrack] = useState<SubtitleTrack | null>(null);
    const [cues, setCues] = useState<Cue[]>([]);
    const [menu, setMenu] = useState<HTMLElement | null>(null);
    const [toast, setToast] = useState<{ text: string; restart?: boolean } | null>(null);
    const focus = useRef<Subscription | null>(null);
    const resumed = useRef(false);
    const ccButton = useRef<HTMLDivElement>(null);
    const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Full screen, free to turn, while the player is open.
    useEffect(() => {
        setWindowOrientation("free");
        setFullScreen(true);
        return () => { setFullScreen(false); setWindowOrientation("up"); };
    }, []);

    useEffect(() => {
        let live = true;
        playableUrl(target).then((u) => { if (live) setUrl(u); }, () => { if (live) setError("This video cannot be opened."); });
        return () => { live = false; };
    }, [target]);

    // Subtitle files beside the video; the language chosen last time.
    useEffect(() => {
        if (isWebAddress(target)) return;
        let live = true;
        Promise.all([listFolderPaths(target), captionsOn()]).then(([paths, captions]) => {
            if (!live) return;
            const found = subtitleTracks(target, paths);
            setTracks(found);
            setTrack(pickTrack(found, prefs.subtitles, captions));
        }, () => {});
        return () => { live = false; };
        // Only when the video changes, not when the preference does.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [target]);

    useEffect(() => {
        setCues([]);
        if (!track) return;
        let live = true;
        fileManager.readText(track.path, 1024 * 1024).then((text) => { if (live) setCues(parseSubtitles(text)); }, () => {});
        return () => { live = false; };
    }, [track]);

    // Remember where it is, now and then and on the way out.
    const save = useCallback(() => {
        const v = video.current;
        if (!v || isWebAddress(target) || !isFinite(v.duration) || v.duration <= 0 || !resumed.current) return;
        savePosition(target, v.currentTime, v.duration);
    }, [target]);
    useEffect(() => {
        const t = setInterval(save, 5000);
        return () => { clearInterval(t); save(); };
    }, [save]);

    const releaseFocus = () => {
        focus.current?.cancel();
        focus.current = null;
    };
    useEffect(() => () => { releaseFocus(); void audioFocus.release(); }, []);

    // Controls hide themselves while playing.
    const poke = useCallback(() => {
        setChrome(true);
        if (hideTimer.current) clearTimeout(hideTimer.current);
        hideTimer.current = setTimeout(() => { if (video.current && !video.current.paused) setChrome(false); }, HIDE_AFTER);
    }, []);
    useEffect(() => () => { if (hideTimer.current) clearTimeout(hideTimer.current); }, []);

    const play = useCallback(() => {
        const v = video.current;
        if (!v) return;
        if (!focus.current) focus.current = audioFocus.request(() => { video.current?.pause(); releaseFocus(); });
        void v.play().catch(() => setPlaying(false));
        poke();
    }, [poke]);
    const pause = () => { video.current?.pause(); setChrome(true); };
    const toggle = () => (video.current?.paused ? play() : pause());
    const seek = (t: number) => {
        const v = video.current;
        if (!v) return;
        v.currentTime = Math.max(0, Math.min(isFinite(v.duration) ? v.duration : t, t));
        setPosition(v.currentTime);
        poke();
    };

    const onLoaded = () => {
        const v = video.current!;
        setDuration(isFinite(v.duration) ? v.duration : 0);
        if (!resumed.current) {
            resumed.current = true;
            const at = isWebAddress(target) ? 0 : resumeAt(loadPositions()[target], v.duration);
            if (at > 0) {
                v.currentTime = at;
                setPosition(at);
                setToast({ text: `Resuming at ${formatSeconds(at)}`, restart: true });
            }
            play();
        }
    };

    useEffect(() => {
        if (!toast) return;
        const t = setTimeout(() => setToast(null), 4000);
        return () => clearTimeout(t);
    }, [toast]);

    // Keys: space plays and pauses, arrows seek (desktop, the simulator).
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            const v = video.current;
            if (!v) return;
            if (e.key === " ") { e.preventDefault(); toggle(); }
            else if (e.key === "ArrowRight") seek(v.currentTime + 10);
            else if (e.key === "ArrowLeft") seek(v.currentTime - 10);
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    });

    // The headset and media keys, through refs to this render's controls.
    const controls = useRef({ play, pause, seek });
    controls.current = { play, pause, seek };
    useEffect(() => {
        const sub = watchMediaKeys({
            active: () => focus.current !== null,
            playing: () => !!video.current && !video.current.paused,
            play: () => controls.current.play(),
            pause: () => controls.current.pause(),
            next: () => { if (video.current) controls.current.seek(video.current.currentTime + 30); },
            prev: () => { if (video.current) controls.current.seek(video.current.currentTime - 10); },
        });
        return () => sub.cancel();
    }, []);

    // A tap shows or hides the controls; it does not pause (the button does).
    const down = useRef<{ x: number; y: number; t: number } | null>(null);
    const onPointerDown = (e: PointerEvent) => { down.current = { x: e.clientX, y: e.clientY, t: Date.now() }; };
    const onPointerUp = (e: PointerEvent) => {
        const d = down.current;
        down.current = null;
        if (!d || Math.abs(e.clientX - d.x) > 10 || Math.abs(e.clientY - d.y) > 10 || Date.now() - d.t > 600) return;
        if (chrome && playing) { setChrome(false); if (hideTimer.current) clearTimeout(hideTimer.current); }
        else poke();
    };

    const chooseTrack = (v: string) => {
        const t = v === "" ? null : tracks.find((x) => x.path === v) ?? null;
        setTrack(t);
        onPrefs({ ...prefs, subtitles: t ? t.language ?? "*" : "" });
    };
    const trackOptions: Option<string>[] = [{ label: "Off", value: "" }, ...tracks.map((t) => ({ label: t.label, value: t.path }))];

    const shown = scrub ?? position;
    const caption = cueText(cues, position);
    return (
        <div className={"vi-player" + (chrome ? " chrome" : "")} data-testid="player"
             onPointerDown={onPointerDown} onPointerUp={onPointerUp}>
            {url && (
                <video ref={video} className={"vi-video" + (prefs.fill ? " fill" : "")} src={url} playsInline preload="auto" data-testid="video"
                       onLoadedMetadata={onLoaded} onDurationChange={() => { const v = video.current!; if (isFinite(v.duration)) setDuration(v.duration); }}
                       onTimeUpdate={() => setPosition(video.current!.currentTime)}
                       onPlay={() => { setPlaying(true); poke(); }}
                       onPause={() => { setPlaying(false); setChrome(true); save(); }}
                       onEnded={() => { setPlaying(false); setChrome(true); if (!isWebAddress(target)) savePosition(target, duration, duration); releaseFocus(); }}
                       onError={() => setError("This video cannot be played. Its format may not be supported.")} />
            )}
            {caption && <div className="vi-caption" data-testid="caption">{caption.split("\n").map((l, i) => <span key={i}>{l}</span>)}</div>}
            {!playing && url && !error && (
                <button type="button" className="vi-bigplay" aria-label="Play" data-testid="big-play" style={{ backgroundImage: cssImage(icons.fullscreenPlay) }}
                        onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()} onClick={play} />
            )}
            {error && <div className="vi-error" role="alert">{error}</div>}

            <div className="vi-top" onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()}>
                <button type="button" className="vi-back" aria-label="Back" data-testid="player-back" onClick={onClose} />
                <div className="vi-title" data-testid="player-title">{title}</div>
            </div>

            <div className="vi-bottom" onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()}>
                <div className="vi-seek">
                    <span className="vi-time" data-testid="elapsed">{formatSeconds(shown)}</span>
                    <Slider progress value={duration ? shown : 0} min={0} max={Math.max(1, duration)} step={0.1} label="Position" testId="seek"
                            onChange={(v) => { setScrub(v); poke(); }} onChangeComplete={(v) => { setScrub(null); seek(v); }} />
                    <span className="vi-time" data-testid="remaining">-{formatSeconds(Math.max(0, duration - shown))}</span>
                </div>
                <Toolbar kind="dark" className="vi-toolbar">
                    <div ref={ccButton}>
                        <IconToolButton icon="subtitles" label="Subtitles" testId="subtitles" depressed={!!track} disabled={!tracks.length}
                                        onClick={() => setMenu(ccButton.current)} />
                    </div>
                    <ToolSpacer />
                    <IconToolButton icon="replay" label="Back 10 seconds" testId="back10" onClick={() => seek(position - 10)} />
                    <IconToolButton icon={playing ? "pause" : "play"} label={playing ? "Pause" : "Play"} testId="play" onClick={toggle} />
                    <IconToolButton icon="forward" label="Ahead 30 seconds" testId="fwd30" onClick={() => seek(position + 30)} />
                    <ToolSpacer />
                    <IconToolButton icon={prefs.fill ? "fit" : "fill"} label={prefs.fill ? "Fit to screen" : "Fill the screen"} testId="fit"
                                    onClick={() => { onPrefs({ ...prefs, fill: !prefs.fill }); poke(); }} />
                </Toolbar>
            </div>

            {toast && (
                <div className="vi-toast" role="status" data-testid="toast" onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()}>
                    {toast.text}
                    {toast.restart && (
                        <button type="button" data-testid="start-over" onClick={() => { forgetPosition(target); seek(0); setToast(null); }}>Start Over</button>
                    )}
                </div>
            )}
            {menu && (
                <PopupMenu anchor={menu} options={trackOptions} value={track?.path ?? ""} onSelect={chooseTrack} onClose={() => setMenu(null)} />
            )}
        </div>
    );
}
