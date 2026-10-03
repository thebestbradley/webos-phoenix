// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Photos as an exhibition: the slideshow dock mode shows on the Touchstone,
// the default exhibition after the clocks (luna-sysmgr's
// conf/default-exhibition-apps.json named com.palm.app.photos). The shell
// launches the app with {"dockMode": true, "windowType": "dockModeWindow"}
// (DockModeWindowManager::launchApp), in a window the size of the screen
// under the status bar; App.tsx shows this instead of the albums then.
//
//   - The pictures (not videos) one after another, each for the chosen
//     time, cross-fading over a second; round and round.
//   - A tap shows the controls for five seconds: the album to show (every
//     picture, or one album), how long each picture stays, pause / play.
//     A swipe goes to the next or the previous picture.
//   - The choices are kept for next time (local storage, as the TouchPad
//     Photos app's SlideshowMode kept its sliding interval).
//   - It runs only while it is the exhibition in front: dock mode tells the
//     window when it comes to the front or leaves it (the runtime's
//     "phoenixcardactivation" event), and a hidden page stops too.

import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { mediaIndexer, type ImageItem, type MediaItem } from "@phoenix/luna";
import { useLuna, useMediaUrl } from "@phoenix/luna/react";
import { IconToolButton, PopupMenu, Toolbar, ToolSpacer } from "@phoenix/ui";
import { INTERVALS, loadPrefs, pictureAlbums, savePrefs, slides, step, type SlideshowPrefs } from "./slideshow";

/** Whether the shell has this window in front (dock mode's exhibition, a card). */
function useActive(): boolean {
    const [active, setActive] = useState(true);
    const [visible, setVisible] = useState(document.visibilityState !== "hidden");
    useEffect(() => {
        const onActivation = (e: Event) => setActive(!!(e as CustomEvent<{ active: boolean }>).detail?.active);
        const onVisibility = () => setVisible(document.visibilityState !== "hidden");
        window.addEventListener("phoenixcardactivation", onActivation);
        document.addEventListener("visibilitychange", onVisibility);
        return () => {
            window.removeEventListener("phoenixcardactivation", onActivation);
            document.removeEventListener("visibilitychange", onVisibility);
        };
    }, []);
    return active && visible;
}

function Slide({ item, shown }: { item: MediaItem; shown: boolean }) {
    const url = useMediaUrl(item.file_path);
    return (
        <div className={"ex-slide" + (shown && url ? " shown" : "")} data-testid={shown ? "exhibition-slide" : undefined}
             data-path={item.file_path}>
            {url && <img src={url} alt={item.title ?? ""} draggable={false} />}
        </div>
    );
}

export function Exhibition() {
    const images = useLuna<ImageItem[]>((cb, err) => mediaIndexer.watchImages(cb, err), []);
    const [prefs, setPrefs] = useState<SlideshowPrefs>(() => loadPrefs());
    const list = useMemo(() => slides((images.value ?? []) as MediaItem[], prefs.album), [images.value, prefs.album]);
    const albums = useMemo(() => pictureAlbums((images.value ?? []) as MediaItem[]), [images.value]);
    const active = useActive();
    const [paused, setPaused] = useState(false);
    // The picture showing, by path, so it survives the list changing.
    const [current, setCurrent] = useState<string | null>(null);
    const [previous, setPrevious] = useState<string | null>(null);
    const [chrome, setChrome] = useState(false);
    const [menu, setMenu] = useState<"album" | "interval" | null>(null);
    const albumButton = useRef<HTMLDivElement>(null);
    const intervalButton = useRef<HTMLDivElement>(null);

    const index = Math.max(0, list.findIndex((it) => it.file_path === current));
    const item = list.length ? list[index] : undefined;

    const show = (i: number) => {
        if (!list.length) return;
        setPrevious(item ? item.file_path : null);
        setCurrent(list[i].file_path);
    };

    // The next picture when its time is up, while running.
    const playing = active && !paused && list.length > 1;
    useEffect(() => {
        if (!playing) return;
        const t = setTimeout(() => show(step(index, list.length)), prefs.interval * 1000);
        return () => clearTimeout(t);
    }, [playing, index, list, prefs.interval]);

    // The controls hide by themselves (not while a menu is open).
    useEffect(() => {
        if (!chrome || menu) return;
        const t = setTimeout(() => setChrome(false), 5000);
        return () => clearTimeout(t);
    }, [chrome, menu]);

    const choose = (changes: Partial<SlideshowPrefs>) => {
        const next = { ...prefs, ...changes };
        setPrefs(next);
        savePrefs(next);
    };

    const start = useRef<{ x: number; y: number; id: number } | null>(null);
    const onPointerDown = (e: PointerEvent) => { start.current = { x: e.clientX, y: e.clientY, id: e.pointerId }; };
    const onPointerUp = (e: PointerEvent) => {
        const s = start.current;
        start.current = null;
        if (!s || s.id !== e.pointerId) return;
        const dx = e.clientX - s.x;
        if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(e.clientY - s.y)) show(step(index, list.length, dx < 0 ? 1 : -1));
        else if (Math.abs(dx) < 8) setChrome((c) => !c);
    };

    const near = new Set<string>();
    if (item) near.add(item.file_path);
    if (previous) near.add(previous);
    if (list.length > 1) near.add(list[step(index, list.length)].file_path);

    return (
        <div className="ex-root" data-testid="exhibition" data-playing={playing ? "true" : "false"}
             onPointerDown={onPointerDown} onPointerUp={onPointerUp} onPointerCancel={() => { start.current = null; }}>
            {list.filter((it) => near.has(it.file_path)).map((it) => (
                <Slide key={it.file_path} item={it} shown={it === item} />
            ))}
            {images.value !== undefined && list.length === 0 && (
                <div className="ex-empty" data-testid="exhibition-empty">
                    <div className="ex-empty-title">No photos to show</div>
                    <div className="ex-empty-text">Pictures you take with the Camera or save to this device appear here.</div>
                </div>
            )}
            <div className={"ex-controls" + (chrome ? "" : " hidden")} onPointerDown={(e) => e.stopPropagation()}
                 onPointerUp={(e) => e.stopPropagation()}>
                <Toolbar kind="fade">
                    <div ref={albumButton}>
                        <IconToolButton icon="photos" label="Album" testId="exhibition-album" onClick={() => setMenu("album")} />
                    </div>
                    <ToolSpacer />
                    <IconToolButton icon={paused ? "play" : "pause"} label={paused ? "Play" : "Pause"} testId="exhibition-play"
                                    onClick={() => setPaused((p) => !p)} />
                    <ToolSpacer />
                    <div ref={intervalButton}>
                        <IconToolButton icon="history" label="Time per photo" testId="exhibition-interval" onClick={() => setMenu("interval")} />
                    </div>
                </Toolbar>
            </div>
            {/* The menus are portals, whose taps still bubble through React to
                the slideshow, where a tap would hide the controls. */}
            <div className="ex-menus" onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()}>
                {menu === "album" && (
                    <PopupMenu
                        anchor={albumButton.current}
                        options={[{ label: "All Photos", value: "" }, ...albums.map((a) => ({ label: a.name, value: a.id }))]}
                        value={prefs.album ?? ""}
                        onSelect={(v: string) => { choose({ album: v === "" ? null : v }); setCurrent(null); setPrevious(null); }}
                        onClose={() => setMenu(null)}
                    />
                )}
                {menu === "interval" && (
                    <PopupMenu
                        anchor={intervalButton.current}
                        options={INTERVALS.map((s) => ({ label: `${s} seconds`, value: String(s) }))}
                        value={String(prefs.interval)}
                        onSelect={(v: string) => choose({ interval: Number(v) })}
                        onClose={() => setMenu(null)}
                    />
                )}
            </div>
        </div>
    );
}
