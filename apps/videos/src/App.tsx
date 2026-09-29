// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Videos: the video library and player. webOS phones played videos from
// Photos & Videos and from a separate video player (with the YouTube app
// beside them); Palm never open-sourced either, so this is new, in the
// webOS 2.x style of the other Phoenix apps: a light library of stills with
// how far each has been watched, and a black full-screen player.
//
//   The library: com.webos.service.mediaindexer getVideoList {uri,
//       subscribe} (media.ts), so a clip recorded in Camera appears at once.
//   Launch params: {target: path | "file://..." | "http://..."} plays that
//       file (Files' "Open with", Photos' "Play in Videos", Email
//       attachments, the browser's downloads; appinfo.json registers video/*).

import { useEffect, useMemo, useState } from "react";
import { mediaIndexer, openTarget, targetName, type OpenParams, type VideoItem } from "@phoenix/luna";
import { useLaunchParams, useLuna } from "@phoenix/luna/react";
import { AppMenu, BackProvider, Glyph, PageHeader, PopupMenu, Row, Spinner, useBack } from "@phoenix/ui";
import { durationLabel, loadPositions, loadPrefs, progressOf, resumeAt, savePrefs, sortVideos, titleOf, type Prefs } from "./library";
import { Player } from "./Player";
import { Poster } from "./Poster";

type Playing = { target: string; title: string } | null;

function dateLabel(iso?: string): string {
    const t = Date.parse(iso ?? "");
    return t ? new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "";
}

function Videos() {
    const list = useLuna<VideoItem[]>((cb, err) => mediaIndexer.watchVideos(cb, err), []);
    const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
    const [playing, setPlaying] = useState<Playing>(null);
    const [menu, setMenu] = useState<HTMLElement | null>(null);
    const [positions, setPositions] = useState(loadPositions);
    const params = useLaunchParams<OpenParams>();

    const updatePrefs = (p: Prefs) => { setPrefs(p); savePrefs(p); };

    useEffect(() => {
        const t = openTarget(params);
        if (!t) return;
        setPlaying({ target: t, title: targetName(t, params.fileName).replace(/\.[^.]+$/, "") });
    }, [params]);

    const close = () => { setPlaying(null); setPositions(loadPositions()); };
    useBack(() => { close(); return true; }, playing !== null);

    const items = useMemo(() => sortVideos(list.value ?? [], prefs.sort), [list.value, prefs.sort]);

    // The library's title for the video, once it is known.
    const known = playing && list.value?.find((v) => v.file_path === playing.target);
    if (playing)
        return <Player target={playing.target} title={known ? titleOf(known) : playing.title} prefs={prefs} onPrefs={updatePrefs} onClose={close} />;

    return (
        <div className="vi-app">
            <AppMenu items={[
                { label: "Sort by Date", onSelect: () => updatePrefs({ ...prefs, sort: "date" }) },
                { label: "Sort by Name", onSelect: () => updatePrefs({ ...prefs, sort: "name" }) },
            ]} />
            <div className="vi-scroll">
                <div className="vi-page">
                    <PageHeader icon="icon.png" title="Videos">
                        <button type="button" className="vi-menu-button" aria-label="Menu" data-testid="menu" onClick={(e) => setMenu(e.currentTarget)}>
                            <Glyph name="menu" size={22} />
                        </button>
                    </PageHeader>
                    {list.value === undefined && <div className="vi-loading"><Spinner large /></div>}
                    {list.value?.length === 0 && (
                        <div className="vi-empty" data-testid="empty">No videos yet. Videos you record with the Camera or copy to the device appear here.</div>
                    )}
                    <div className="vi-list" data-testid="library">
                        {items.map((v) => {
                            const r = positions[v.file_path];
                            const progress = progressOf(r, v.duration);
                            const resume = resumeAt(r, v.duration);
                            return (
                                <Row key={v.uri} className="vi-row" testId={`video-${titleOf(v)}`}
                                     icon={(
                                         <span className="vi-thumb">
                                             <Poster path={v.file_path} stamp={v.last_modified_date ?? ""} duration={v.duration} />
                                             {!!v.duration && <span className="vi-badge">{durationLabel(v.duration)}</span>}
                                             {progress > 0 && <span className="vi-progress"><i style={{ width: `${progress * 100}%` }} /></span>}
                                         </span>
                                     )}
                                     title={titleOf(v)}
                                     subtitle={resume > 0 ? `Resume at ${durationLabel(resume)}` : r?.watched ? "Watched" : dateLabel(v.last_modified_date)}
                                     onClick={() => setPlaying({ target: v.file_path, title: titleOf(v) })}>
                                    {r?.watched && <span className="vi-watched" aria-label="Watched" />}
                                </Row>
                            );
                        })}
                    </div>
                </div>
            </div>
            {menu && (
                <PopupMenu anchor={menu} value={prefs.sort}
                           options={[{ label: "Sort by Date", value: "date" as const }, { label: "Sort by Name", value: "name" as const }]}
                           onSelect={(v) => updatePrefs({ ...prefs, sort: v })} onClose={() => setMenu(null)} />
            )}
        </div>
    );
}

export function App() {
    return (
        <BackProvider>
            <Videos />
        </BackProvider>
    );
}
