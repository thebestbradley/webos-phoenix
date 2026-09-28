// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Photos: albums, a thumbnail grid per album and a full-screen viewer, in
// the style of the webOS 2.x "Photos & Videos" app. Pictures and videos
// come from the media indexer (com.webos.service.mediaindexer
// getImageList/getVideoList, subscribed, so a photo just taken in Camera
// appears at once).
//
// Launch params: {imageList: {results: [item]}} (the convention OSE's
// camera app uses to open its image viewer) or {target: "/media/internal/..."}
// open that picture in the viewer.

import { useEffect, useMemo, useState } from "react";
import { folderOf, mediaIndexer, type ImageItem, type MediaItem, type VideoItem } from "@phoenix/luna";
import { useLaunchParams, useLuna } from "@phoenix/luna/react";
import { BackProvider, Spinner, useBack } from "@phoenix/ui";
import { countLabel, groupAlbums, isVideo, type Album } from "./albums";
import { Thumb } from "./Thumb";
import { Viewer } from "./Viewer";

interface LaunchParams {
    imageList?: { results?: { file_path?: string; uri?: string }[] };
    target?: string;
}

function launchTarget(p: LaunchParams): string | null {
    const first = p.imageList?.results?.[0];
    const path = first?.file_path ?? (first?.uri ? first.uri.replace(/^storage:\/\//, "") : undefined) ?? p.target;
    return path ? path.replace(/^file:\/\//, "") : null;
}

function Header({ title, subtitle }: { title: string; subtitle?: string }) {
    return (
        <header className="ph-header">
            <img className="ph-header-icon" src="icon.png" alt="" />
            <div className="ph-header-title" role="heading" aria-level={1}>{title}</div>
            {subtitle && <div className="ph-header-sub">{subtitle}</div>}
        </header>
    );
}

function AlbumTile({ album, onOpen }: { album: Album; onOpen: () => void }) {
    const cover = album.items.slice(0, 3);
    return (
        <button type="button" className="ph-album" onClick={onOpen} data-testid={`album-${album.name}`}>
            <span className="ph-stack">
                {cover.length === 0 && <span className="ph-stack-photo empty" />}
                {cover.slice().reverse().map((it, i) => (
                    <span key={it.uri} className={`ph-stack-photo n${cover.length - 1 - i}`}>
                        <Thumb item={it} />
                    </span>
                ))}
            </span>
            <span className="ph-album-name">{album.name}</span>
            <span className="ph-album-count">{album.items.length ? countLabel(album.items) : "No photos"}</span>
        </button>
    );
}

function AlbumGrid({ album, onOpen }: { album: Album; onOpen: (index: number) => void }) {
    return (
        <div className="ph-scroll">
            <Header title={album.name} subtitle={countLabel(album.items)} />
            {album.items.length === 0 ? (
                <div className="ph-empty" data-testid="album-empty">
                    No photos yet. Pictures you take with the Camera appear here.
                </div>
            ) : (
                <div className="ph-grid">
                    {album.items.map((it, i) => (
                        <button type="button" key={it.uri} className="ph-cell" onClick={() => onOpen(i)} data-testid={`thumb-${i}`}>
                            <Thumb item={it} />
                            {isVideo(it) && <span className="ph-cell-video" />}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

function Photos() {
    const images = useLuna<ImageItem[]>((cb, err) => mediaIndexer.watchImages(cb, err), []);
    const videos = useLuna<VideoItem[]>((cb, err) => mediaIndexer.watchVideos(cb, err), []);
    const loaded = images.value !== undefined;
    const albums = useMemo(
        () => groupAlbums([...(images.value ?? []), ...(videos.value ?? [])] as MediaItem[]),
        [images.value, videos.value],
    );

    const [albumId, setAlbumId] = useState<string | null>(null);
    // The picture shown in the viewer, by path, so it survives list changes.
    const [viewing, setViewing] = useState<string | null>(null);

    const params = useLaunchParams<LaunchParams>();
    useEffect(() => {
        const path = launchTarget(params);
        if (!path) return;
        setAlbumId(folderOf(path));
        setViewing(path);
    }, [params]);

    const album = albums.find((a) => a.id === albumId) ?? null;
    const index = album && viewing ? album.items.findIndex((it) => it.file_path === viewing) : -1;

    useBack(() => { setViewing(null); return true; }, viewing !== null);
    useBack(() => { setAlbumId(null); return true; }, viewing === null && albumId !== null);

    if (!loaded) {
        return (
            <div className="ph-scroll">
                <Header title="Photos & Videos" />
                <div className="ph-loading"><Spinner large /></div>
            </div>
        );
    }

    if (album && viewing !== null && index >= 0) {
        return (
            <Viewer
                items={album.items}
                index={index}
                onIndex={(i) => setViewing(album.items[i].file_path)}
                onClose={() => setViewing(null)}
                onDeleted={(i) => {
                    const rest = album.items.filter((_, j) => j !== i);
                    setViewing(rest.length ? rest[Math.min(i, rest.length - 1)].file_path : null);
                }}
            />
        );
    }

    if (album) return <AlbumGrid album={album} onOpen={(i) => setViewing(album.items[i].file_path)} />;

    return (
        <div className="ph-scroll">
            <Header title="Photos & Videos" />
            <div className="ph-albums" data-testid="albums">
                {albums.map((a) => <AlbumTile key={a.id} album={a} onOpen={() => setAlbumId(a.id)} />)}
            </div>
        </div>
    );
}

export function App() {
    return (
        <BackProvider>
            <Photos />
        </BackProvider>
    );
}
