// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The wallpaper picker, in albums: first the list of albums (each with its
// first picture in a frame, its name and how many it holds), then, tapped,
// the album's pictures in a grid. As webOS's own picker showed wallpapers:
// the system file picker's image picker (luna-systemui
// app/FilePicker/ImagePicker.js:32-33) lists the albums
// (ImageAlbumList.js:44-50: album art, name, "(count)") and opens one as a
// grid of its pictures (AlbumGridView), "Wallpapers" among the albums
// (ImageAlbumList.js:64).

import { useState } from "react";
import { Checkmark, Group, Page, PageHeader, Row } from "@phoenix/ui";
import { useBack } from "./nav";

export interface Wallpaper { name: string; file: string; thumb: string; album: string }
export interface WallpaperAlbum { name: string; wallpapers: Wallpaper[] }

function album(name: string, names: string[]): WallpaperAlbum {
    return {
        name,
        wallpapers: names.map((n) => {
            const slug = n.toLowerCase().replace(/ /g, "-");
            return { name: n, file: `wallpapers/${slug}.jpg`, thumb: `wallpapers/thumbs/${slug}.jpg`, album: name };
        }),
    };
}

/** Bundled wallpapers, in two albums: "Artistic", Phoenix's own drawn ones
 *  (tools/wallpapers/generate.py), and "Nature", photographs under open
 *  licences (tools/wallpapers/photos.py; authors and licences in
 *  public/wallpapers/PROVENANCE.md and the licences page). A square master
 *  each, which the shell crops to the screen, and a 2:3 thumbnail for the
 *  picker. The first, Northern Lights, is the default (the system service's
 *  default wallpaper preference, runtime/phoenix-runtime.js), shown too
 *  while none is set. */
export const WALLPAPER_ALBUMS: WallpaperAlbum[] = [
    album("Artistic", ["Northern Lights", "Phoenix", "Twilight", "Amber", "Garden", "Sea and Sky",
        "Dawn", "Silk", "Midnight", "Bloom", "Shallows", "Linen"]),
    album("Nature", ["Lily Pads", "River Stones", "Clownfish", "Jellyfish", "Raindrops", "Dandelion",
        "Gerbera", "Wave", "Seashells"]),
];

export const WALLPAPERS: Wallpaper[] = WALLPAPER_ALBUMS.flatMap((a) => a.wallpapers);

export interface WallpaperPickerProps {
    title: string;
    icon: string;
    /** The wallpaper set now (checked), or null for none of these. */
    chosen: Wallpaper | null;
    onPick: (w: Wallpaper | null) => void;
    /** Offer "None" above the albums (dock mode's wallpaper); checked when it is the choice. */
    none?: { chosen: boolean };
    /** data-testid prefix: `${testPrefix}-album-Artistic`, `${testPrefix}-Dawn`, `${testPrefix}-None`. */
    testPrefix: string;
}

export function WallpaperPicker({ title, icon, chosen, onPick, none, testPrefix }: WallpaperPickerProps) {
    const [open, setOpen] = useState<WallpaperAlbum | null>(null);
    // Back from an album goes to the albums; from the albums, out (the page's own handler).
    useBack(() => { setOpen(null); return true; }, open !== null);

    if (open) {
        return (
            <Page>
                <PageHeader title={open.name} icon={icon} />
                <div className="wallpaper-grid" data-testid={`${testPrefix}-album`}>
                    {open.wallpapers.map((w) => (
                        <button key={w.name} type="button" className={"wallpaper-tile" + (w === chosen ? " selected" : "")}
                                data-testid={`${testPrefix}-${w.name}`} onClick={() => onPick(w)}>
                            <span className="wallpaper-thumb" style={{ backgroundImage: `url(${w.thumb})` }} />
                            <span className="wallpaper-name">{w.name}</span>
                            {w === chosen && <Checkmark />}
                        </button>
                    ))}
                </div>
            </Page>
        );
    }

    return (
        <Page>
            <PageHeader title={title} icon={icon} />
            {none && (
                <Group>
                    <Row title="None" onClick={() => onPick(null)} testId={`${testPrefix}-None`}
                         icon={<span className="wallpaper-mini none" />}>
                        {none.chosen && <Checkmark />}
                    </Row>
                </Group>
            )}
            <Group label="Albums">
                {WALLPAPER_ALBUMS.map((a) => (
                    <Row key={a.name} chevron onClick={() => setOpen(a)} testId={`${testPrefix}-album-${a.name}`}
                         title={<>{a.name} <span className="wallpaper-album-count">({a.wallpapers.length})</span></>}
                         subtitle={chosen?.album === a.name ? chosen.name : undefined}
                         icon={<span className="wallpaper-album-art">
                             <span className="wallpaper-album-photo" style={{ backgroundImage: `url(${a.wallpapers[0].thumb})` }} />
                         </span>} />
                ))}
            </Group>
        </Page>
    );
}
