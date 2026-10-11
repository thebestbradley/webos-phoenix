// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Music: the library by artist, album and song in the light webOS 2.x list
// style, and the dark Now Playing view with the transport controls, seek
// and volume. Songs come from the media indexer
// (com.webos.service.mediaindexer getAudioList, subscribed). Launch params
// {play: "<artist, album or song>"} play it (the Assistant); {share: {title,
// files}} plays audio from the system share sheet (SHARE-AND-FILES.md);
// {target} plays an audio file opened with Music (src/launchParams.ts).

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { mediaIndexer, type AudioItem } from "@phoenix/luna";
import { useLaunchParams, useLuna, useMediaUrl } from "@phoenix/luna/react";
import {
    AppMenu, BackProvider, Divider, Glyph, GroupedToolButtons, Page, PageHeader, Row, Slider, Spinner, IconToolButton, Toolbar, ToolSpacer,
    formatSeconds, useBack,
} from "@phoenix/ui";
import { albums, artists, artistOf, artistSummary, sharedSongs, songs, songsFor, titleOf, type AlbumEntry, type ArtistEntry } from "./library";
import { PlayerProvider, usePlayer } from "./player";
import { parseLaunch, type MusicLaunchParams } from "./launchParams";
import { favoriteOf, favorites, favoriteSongs, type Favorite } from "./favorites";

type Tab = "artists" | "albums" | "songs" | "favorites";

/** The favorite songs (favorites.ts), watched once for the whole app. */
const Favorites = createContext<Favorite[] | null>(null);
type View = { kind: "artist"; name: string } | { kind: "album"; name: string; artist: string } | null;

/** Opens Now Playing (tapping a song plays it and shows it, as on webOS). */
const ShowNowPlaying = createContext<() => void>(() => {});

function Art({ path, size, className }: { path?: string; size?: number; className?: string }) {
    const url = useMediaUrl(path);
    return (
        <span className={"mu-art" + (className ? " " + className : "")} style={size ? { width: size, height: size } : undefined}>
            {url ? <img src={url} alt="" draggable={false} /> : <Glyph name="note" size={Math.round((size ?? 120) * 0.55)} />}
        </span>
    );
}

function SongRow({ song, index, list, showTrack, showAlbum }: {
    song: AudioItem; index: number; list: AudioItem[]; showTrack?: boolean; showAlbum?: boolean;
}) {
    const player = usePlayer();
    const show = useContext(ShowNowPlaying);
    const playingThis = player.current?.uri === song.uri;
    return (
        <Row
            className={"mu-song" + (playingThis ? " current" : "")}
            icon={showTrack ? <span className="mu-track">{song.track || index + 1}</span> : undefined}
            title={titleOf(song)}
            subtitle={showAlbum ? `${artistOf(song)} – ${song.album ?? ""}` : undefined}
            value={formatSeconds(song.duration ?? 0)}
            onClick={() => { player.play(list, index); show(); }}
            testId={`song-${titleOf(song)}`}
        >
            {playingThis && <span className={"mu-eq" + (player.playing ? " on" : "")}><i /><i /><i /></span>}
        </Row>
    );
}

function ArtistView({ artist }: { artist: ArtistEntry }) {
    return (
        <Page>
            <PageHeader title={artist.name} icon="icon.png" />
            {artist.albums.map((al) => (
                <div key={al.name}>
                    <Divider caption={al.name} />
                    <div className="mu-list">
                        {al.songs.map((s) => (
                            <SongRow key={s.uri} song={s} index={artist.songs.indexOf(s)} list={artist.songs} showTrack />
                        ))}
                    </div>
                </div>
            ))}
        </Page>
    );
}

function AlbumView({ album }: { album: AlbumEntry }) {
    const player = usePlayer();
    const show = useContext(ShowNowPlaying);
    const total = album.songs.reduce((t, s) => t + (s.duration ?? 0), 0);
    return (
        <Page>
            <div className="mu-album-head">
                <Art path={album.art} size={112} className="big" />
                <div className="mu-album-info">
                    <div className="mu-album-title">{album.name}</div>
                    <div className="mu-album-artist">{album.artist}</div>
                    <div className="mu-album-meta">{album.songs.length} songs, {formatSeconds(total)}{album.year ? ` · ${album.year}` : ""}</div>
                    <button type="button" className="mu-play-all" onClick={() => { player.play(album.songs, 0); show(); }} data-testid="play-album">
                        <Glyph name="play" size={18} /> Play
                    </button>
                </div>
            </div>
            <div className="mu-list">
                {album.songs.map((s, i) => <SongRow key={s.uri} song={s} index={i} list={album.songs} showTrack />)}
            </div>
        </Page>
    );
}

function MiniPlayer({ onOpen }: { onOpen: () => void }) {
    const player = usePlayer();
    const cur = player.current;
    if (!cur) return null;
    return (
        <div className="mu-mini" onClick={onOpen} role="button" data-testid="mini-player">
            <Art path={cur.thumbnail} size={40} />
            <div className="mu-mini-text">
                <div className="mu-mini-title">{titleOf(cur)}</div>
                <div className="mu-mini-artist">{artistOf(cur)}</div>
            </div>
            <IconToolButton icon={player.playing ? "pause" : "play"} label={player.playing ? "Pause" : "Play"} testId="mini-play"
                        onClick={() => player.toggle()} />
        </div>
    );
}

function NowPlaying({ onClose }: { onClose: () => void }) {
    const player = usePlayer();
    const cur = player.current;
    const artUrl = useMediaUrl(cur?.thumbnail);
    const [scrub, setScrub] = useState<number | null>(null);
    const favs = useContext(Favorites);
    if (!cur) return null;
    const fav = favoriteOf(favs ?? [], cur);
    const duration = player.duration || cur.duration || 0;
    const pos = scrub ?? player.position;
    const repeatNext = { off: "all", all: "one", one: "off" } as const;
    return (
        <div className="mu-np" data-testid="now-playing">
            {artUrl && <div className="mu-np-bg" style={{ backgroundImage: `url(${artUrl})` }} />}
            <div className="mu-np-top">
                <button type="button" className="mu-np-back" aria-label="Library" onClick={onClose} data-testid="np-back" />
                <div className="mu-np-titles">
                    <div className="mu-np-title" data-testid="np-title">{titleOf(cur)}</div>
                    <div className="mu-np-sub">{artistOf(cur)}{cur.album ? ` – ${cur.album}` : ""}</div>
                </div>
                <IconToolButton icon="star" label={fav ? "Remove from Favorites" : "Add to Favorites"} depressed={!!fav} testId="np-favorite"
                                onClick={() => void (fav ? favorites.remove(fav) : favorites.add(cur))} />
            </div>
            <div className="mu-np-body">
                <div className="mu-np-art">
                    <Art path={cur.thumbnail} className="cover" />
                </div>
                <div className="mu-np-controls">
                    <div className="mu-np-seek">
                        <Slider progress value={duration ? pos : 0} min={0} max={Math.max(1, duration)} step={0.1} label="Position" testId="np-seek"
                                onChange={setScrub} onChangeComplete={(v) => { setScrub(null); player.seek(v); }} />
                        <div className="mu-np-times">
                            <span data-testid="np-elapsed">{formatSeconds(pos)}</span>
                            <span>-{formatSeconds(Math.max(0, duration - pos))}</span>
                        </div>
                    </div>
                    <div className="mu-np-volume">
                        <Glyph name="volume" size={22} />
                        <Slider value={player.volume} label="Volume" testId="np-volume" onChange={player.setVolume} />
                    </div>
                </div>
            </div>
            <Toolbar kind="dark">
                <IconToolButton icon="shuffle" label="Shuffle" depressed={player.shuffle} testId="np-shuffle" onClick={() => player.setShuffle(!player.shuffle)} />
                <ToolSpacer />
                <IconToolButton icon="prev" label="Previous" testId="np-prev" onClick={() => player.prev()} />
                <IconToolButton icon={player.playing ? "pause" : "play"} label={player.playing ? "Pause" : "Play"} testId="np-play" onClick={() => player.toggle()} />
                <IconToolButton icon="next" label="Next" testId="np-next" onClick={() => player.next()} />
                <ToolSpacer />
                <IconToolButton icon="repeat" label={`Repeat: ${player.repeat}`} depressed={player.repeat !== "off"} testId="np-repeat"
                            caption={player.repeat === "one" ? "1" : undefined}
                            onClick={() => player.setRepeat(repeatNext[player.repeat])} />
            </Toolbar>
        </div>
    );
}

function Library() {
    const list = useLuna<AudioItem[]>((cb, err) => mediaIndexer.watchAudio(cb, err), []);
    const items = list.value;
    const [tab, setTab] = useState<Tab>("artists");
    const [view, setView] = useState<View>(null);
    const [nowPlaying, setNowPlaying] = useState(false);
    const player = usePlayer();

    const favs = useContext(Favorites);
    const byArtist = useMemo(() => artists(items ?? []), [items]);
    const byAlbum = useMemo(() => albums(items ?? []), [items]);
    const bySong = useMemo(() => songs(items ?? []), [items]);
    const byFavorite = useMemo(() => favoriteSongs(items ?? [], favs ?? []), [items, favs]);

    // What the launch asks to play (launchParams.ts, docs/LAUNCH-CONTRACTS.md):
    // {play: "<artist, album or song>"}: the Assistant's "play ..." (docs/M6-PLAN.md F3).
    // {share: {title, files}}: audio from the share sheet (appinfo.json
    // shareTargets; a voice memo from Voice Memos' Share) plays at once;
    // {target}: an audio file opened with Music (Files, Email's attachments) too.
    // {favorites: true}: the favorite songs; {shuffle}, {repeat}: how what plays plays.
    const launch = useLaunchParams<MusicLaunchParams>();
    const intent = useMemo(() => parseLaunch(launch), [launch]);
    const played = useRef<object | null>(null);
    useEffect(() => {
        if (!items || intent.kind === "none" || played.current === intent) return;
        if (intent.kind === "mode") {
            played.current = intent;
            if (intent.shuffle !== undefined) player.setShuffle(intent.shuffle);
            if (intent.repeat) player.setRepeat(intent.repeat);
            return;
        }
        // The favorites come from db8 after the library: wait for them (an empty list is an answer too).
        if (intent.kind === "favorites" && favs === null) return;
        played.current = intent;
        const list = intent.kind === "share" ? sharedSongs(intent.share, items)
            : intent.kind === "file" ? (intent.path
                ? sharedSongs({ title: intent.title, files: [{ path: intent.path, mimeType: intent.mimeType }] }, items)
                : [{ uri: intent.url!, type: "audio", mime: intent.mimeType, title: intent.title ?? intent.url!.replace(/^.*\//, "") } as AudioItem])
            : intent.kind === "favorites" ? byFavorite
            : songsFor(items, intent.query);
        if (list && list.length) {
            // Shuffled: from any song, not always the first.
            const shuffle = (intent.kind === "play" || intent.kind === "favorites") ? intent.shuffle : undefined;
            if (shuffle !== undefined) player.setShuffle(shuffle);
            player.play(list, shuffle ? Math.floor(Math.random() * list.length) : 0);
            setNowPlaying(true);
        } else if (intent.kind === "favorites") {
            setTab("favorites");
        }
    }, [items, intent, player, favs, byFavorite]);

    useBack(() => { setNowPlaying(false); return true; }, nowPlaying);
    useBack(() => { setView(null); return true; }, !nowPlaying && view !== null);

    const openNowPlaying = () => setNowPlaying(true);

    if (nowPlaying && player.current) return <NowPlaying onClose={() => setNowPlaying(false)} />;

    let body;
    if (!items) {
        body = <div className="mu-loading"><Spinner large /></div>;
    } else if (view?.kind === "artist") {
        const a = byArtist.find((x) => x.name === view.name);
        body = a ? <ArtistView artist={a} /> : null;
    } else if (view?.kind === "album") {
        const a = byAlbum.find((x) => x.name === view.name && x.artist === view.artist);
        body = a ? <AlbumView album={a} /> : null;
    } else {
        body = (
            <Page>
                <PageHeader title="Music" icon="icon.png" />
                <div className="mu-tabs">
                    <GroupedToolButtons value={tab} onChange={setTab} options={[
                        { value: "artists", caption: "Artists", testId: "tab-artists" },
                        { value: "albums", caption: "Albums", testId: "tab-albums" },
                        { value: "songs", caption: "Songs", testId: "tab-songs" },
                        // A star, not a word: four words do not fit a phone's width.
                        { value: "favorites", icon: "star", label: "Favorites", testId: "tab-favorites" },
                    ]} />
                </div>
                {items.length === 0 && <div className="mu-empty">No music yet. Copy songs to the device to see them here.</div>}
                {items.length > 0 && tab === "favorites" && byFavorite.length === 0 &&
                    <div className="mu-empty" data-testid="favorites-empty">No favorites yet. Tap the star while a song plays, or say “like this song”.</div>}
                <div className="mu-list">
                    {tab === "artists" && byArtist.map((a) => (
                        <Row key={a.name} icon={<Art path={a.albums[0]?.art} size={40} />} title={a.name} subtitle={artistSummary(a)} chevron
                             onClick={() => setView({ kind: "artist", name: a.name })} testId={`artist-${a.name}`} />
                    ))}
                    {tab === "albums" && byAlbum.map((a) => (
                        <Row key={a.name + a.artist} icon={<Art path={a.art} size={48} />} title={a.name} subtitle={a.artist} chevron
                             onClick={() => setView({ kind: "album", name: a.name, artist: a.artist })} testId={`album-${a.name}`} />
                    ))}
                    {tab === "songs" && bySong.map((s, i) => <SongRow key={s.uri} song={s} index={i} list={bySong} showAlbum />)}
                    {tab === "favorites" && byFavorite.map((s, i) => <SongRow key={s.uri} song={s} index={i} list={byFavorite} showAlbum />)}
                </div>
            </Page>
        );
    }

    return (
        <ShowNowPlaying.Provider value={openNowPlaying}>
            <div className={"mu-library" + (player.current ? " with-mini" : "")}>
                <AppMenu items={[
                    { label: "Now Playing", disabled: !player.current, onSelect: openNowPlaying },
                    { label: "Artists", onSelect: () => { setTab("artists"); setView(null); } },
                    { label: "Albums", onSelect: () => { setTab("albums"); setView(null); } },
                    { label: "Songs", onSelect: () => { setTab("songs"); setView(null); } },
                    { label: "Favorites", onSelect: () => { setTab("favorites"); setView(null); } },
                ]} />
                <div className="mu-scroll">{body}</div>
                <MiniPlayer onOpen={openNowPlaying} />
            </div>
        </ShowNowPlaying.Provider>
    );
}

export function App() {
    const favs = useLuna<Favorite[]>((cb) => favorites.watch(cb), []);
    return (
        <BackProvider>
            <PlayerProvider>
                <Favorites.Provider value={favs.value ?? null}>
                    <Library />
                </Favorites.Provider>
            </PlayerProvider>
        </BackProvider>
    );
}
