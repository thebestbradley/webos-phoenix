// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Maps' full pages: Preferences (units, voice, and every data provider),
// Offline Maps (the demo region, saved areas and PMTiles files), Saved
// Places, and About (data sources and licences).

import { useState } from "react";
import { Button, Divider, ErrorText, Group, ListSelector, Note, PageHeader, Row, Slider, TextField, ToggleButton } from "@phoenix/ui";
import { formatDistance, type Units } from "./lib/geo";
import {
    cleanUrl, isValidUrl, ROUTING_URLS, SEARCH_URLS, shippedProviders,
    type Prefs, type Providers, type RendererKind, type RoutingKind, type SearchKind, type TilesKind,
} from "./lib/providers";
import type { SavedPlace } from "./lib/places";
import { MAX_REGION_TILES, type DownloadProgress, type Region } from "./lib/tiles";

function PageShell({ title, onBack, children, testId }: { title: string; onBack: () => void; children: React.ReactNode; testId: string }) {
    return (
        <div className="mp-page" data-testid={testId}>
            <PageHeader icon="icon.png" title={title}>
                <button type="button" className="mp-header-button" data-testid="page-done" onClick={onBack}>Done</button>
            </PageHeader>
            <div className="mp-page-scroll">{children}</div>
        </div>
    );
}

// ---- Preferences ---------------------------------------------------------------------------------

export function SettingsPage({ prefs, deviceUnits, providers, onPrefs, onProviders, onBack }: {
    prefs: Prefs; deviceUnits: Units; providers: Providers; onPrefs: (p: Partial<Prefs>) => void; onProviders: (p: Providers | null) => void; onBack: () => void;
}) {
    const [draft, setDraft] = useState<Providers>(providers);
    const [error, setError] = useState("");
    const set = (fn: (d: Providers) => Providers) => { setDraft(fn); setError(""); };
    const changed = JSON.stringify(draft) !== JSON.stringify(providers);
    const apply = () => {
        const urls = [draft.tiles.url, draft.tiles.styleUrl, draft.tiles.rasterUrl, draft.tiles.glyphsUrl, draft.search.url, draft.routing.url];
        if (urls.some((u) => !isValidUrl(u))) { setError("Every server address must start with https:// or http://."); return; }
        if (draft.tiles.kind === "style" && !draft.tiles.styleUrl) { setError("Enter the address of the map style."); return; }
        onProviders({
            ...draft,
            tiles: { ...draft.tiles, url: cleanUrl(draft.tiles.url), styleUrl: draft.tiles.styleUrl.trim(), rasterUrl: draft.tiles.rasterUrl.trim() },
            search: { ...draft.search, url: cleanUrl(draft.search.url) },
            routing: { ...draft.routing, url: cleanUrl(draft.routing.url) },
        });
    };
    return (
        <PageShell title="Preferences" onBack={onBack} testId="settings">
            <Group label="Directions">
                <ListSelector<Prefs["distanceUnits"]> title="Distances" value={prefs.distanceUnits} testId="pref-units"
                                     onChange={(distanceUnits) => onPrefs({ distanceUnits })}
                                     options={[{ label: `Automatic (${deviceUnits === "imperial" ? "miles" : "kilometres"})`, value: "auto" },
                                               { label: "Miles and feet", value: "imperial" }, { label: "Kilometres and metres", value: "metric" }]} />
                <Row title="Spoken directions" testId="pref-voice"><ToggleButton value={prefs.voice} onChange={(voice) => onPrefs({ voice })} /></Row>
            </Group>

            <Divider caption="Map" />
            <Group>
                <ListSelector<TilesKind> title="Map tiles" value={draft.tiles.kind} testId="pref-tiles"
                    onChange={(kind) => set((d) => ({ ...d, tiles: { ...d.tiles, kind } }))}
                    options={[
                        { label: "OpenMapTiles server", value: "openmaptiles" },
                        { label: "Custom map style", value: "style" },
                        { label: "Offline maps only", value: "offline" },
                    ]} />
                {draft.tiles.kind === "openmaptiles" && (
                    <TextField label="Tile server (TileJSON or {z}/{x}/{y})" value={draft.tiles.url} testId="pref-tiles-url"
                               onChange={(url) => set((d) => ({ ...d, tiles: { ...d.tiles, url } }))} />
                )}
                {draft.tiles.kind === "style" && (
                    <TextField label="Style URL (MapLibre style JSON, with your key)" value={draft.tiles.styleUrl} testId="pref-style-url"
                               onChange={(styleUrl) => set((d) => ({ ...d, tiles: { ...d.tiles, styleUrl } }))} />
                )}
                <ListSelector<RendererKind> title="Drawing" value={draft.renderer} testId="pref-renderer"
                    onChange={(renderer) => set((d) => ({ ...d, renderer }))}
                    options={[
                        { label: "Automatic", value: "auto" },
                        { label: "Vector (WebGL)", value: "vector" },
                        { label: "Canvas (no WebGL)", value: "canvas" },
                    ]} />
                {draft.renderer !== "vector" && (
                    <TextField label="Raster tiles for canvas drawing (optional)" value={draft.tiles.rasterUrl} testId="pref-raster-url"
                               placeholder="https://example.org/{z}/{x}/{y}.png"
                               onChange={(rasterUrl) => set((d) => ({ ...d, tiles: { ...d.tiles, rasterUrl } }))} />
                )}
            </Group>

            <Divider caption="Search" />
            <Group>
                <ListSelector<SearchKind> title="Search with" value={draft.search.kind} testId="pref-search"
                    onChange={(kind) => set((d) => ({ ...d, search: { kind, url: SEARCH_URLS[kind] || d.search.url } }))}
                    options={[{ label: "Photon", value: "photon" }, { label: "Nominatim", value: "nominatim" }, { label: "Offline maps only", value: "offline" }]} />
                {draft.search.kind !== "offline" && (
                    <TextField label="Search server" value={draft.search.url} testId="pref-search-url"
                               onChange={(url) => set((d) => ({ ...d, search: { ...d.search, url } }))} />
                )}
            </Group>

            <Divider caption="Directions" />
            <Group>
                <ListSelector<RoutingKind> title="Route with" value={draft.routing.kind} testId="pref-routing"
                    onChange={(kind) => set((d) => ({ ...d, routing: { ...d.routing, kind, url: ROUTING_URLS[kind] || d.routing.url } }))}
                    options={[{ label: "Valhalla", value: "valhalla" }, { label: "OSRM", value: "osrm" }, { label: "Offline maps only", value: "offline" }]} />
                {draft.routing.kind !== "offline" && (
                    <TextField label="Routing server" value={draft.routing.url} testId="pref-routing-url"
                               onChange={(url) => set((d) => ({ ...d, routing: { ...d.routing, url } }))} />
                )}
            </Group>
            {draft.routing.kind === "osrm" && /openstreetmap\.de|project-osrm\.org/.test(draft.routing.url) && (
                <Note>The public OSRM demo server is for non-commercial use only.</Note>
            )}
            {error && <ErrorText>{error}</ErrorText>}
            <div className="mp-page-buttons">
                <Button variant="affirmative" disabled={!changed} data-testid="pref-apply" onClick={apply}>Use These Servers</Button>
                <Button data-testid="pref-reset" onClick={() => { setDraft(shippedProviders()); onProviders(null); }}>Reset to Defaults</Button>
            </div>
            <Note>
                Maps uses public OpenStreetMap services by default. To use your own servers, see "Hosting your own map
                servers" in the Phoenix documentation (docs/MAPS.md).
            </Note>
        </PageShell>
    );
}

// ---- Offline maps --------------------------------------------------------------------------------

export function RegionsPage({ regions, visibleTiles, progress, error, units, onSave, onCancel, onDelete, onAddPmtiles, onShow, onBack }: {
    regions: readonly Region[]; visibleTiles: number; progress: DownloadProgress | null; error: string; units: Units;
    onSave: (name: string) => void; onCancel: () => void; onDelete: (r: Region) => void; onAddPmtiles: (url: string, name: string) => void;
    onShow: (r: Region) => void; onBack: () => void;
}) {
    const [name, setName] = useState("");
    const [pm, setPm] = useState("");
    const tooBig = visibleTiles > MAX_REGION_TILES;
    const mb = (b: number) => `${(b / 1048576).toFixed(b < 10485760 ? 1 : 0)} MB`;
    void units;
    return (
        <PageShell title="Offline Maps" onBack={onBack} testId="regions">
            <Group label="Saved areas">
                {regions.map((r) => (
                    <Row key={r.id} title={r.name} testId={`region-${r.id}`} onClick={() => onShow(r)}
                         subtitle={r.kind === "bundled" ? "Comes with Maps" : r.kind === "pmtiles" ? "PMTiles file" : `${r.tiles} tiles, ${mb(r.bytes)}`}>
                        {r.kind !== "bundled" && (
                            <button type="button" className="mp-row-delete" data-testid={`region-delete-${r.id}`}
                                    onClick={(e) => { e.stopPropagation(); onDelete(r); }}>Delete</button>
                        )}
                    </Row>
                ))}
            </Group>
            <Divider caption="Save the area on screen" />
            <Group>
                <TextField label="Name" value={name} placeholder="e.g. Home" testId="region-name" onChange={setName} />
                <Row title="Size" value={`${visibleTiles} tiles`} testId="region-size" />
            </Group>
            {progress ? (
                <div className="mp-progress" data-testid="region-progress">
                    <Slider value={progress.done} max={progress.total} progress />
                    <div>{progress.done} of {progress.total} tiles, {mb(progress.bytes)}</div>
                    <Button onClick={onCancel}>Cancel</Button>
                </div>
            ) : (
                <div className="mp-page-buttons">
                    <Button variant="affirmative" disabled={tooBig} data-testid="region-save" onClick={() => onSave(name.trim() || "Saved area")}>Save Area</Button>
                </div>
            )}
            {tooBig && <Note>That area is too big to save at once (at most {MAX_REGION_TILES} tiles): zoom in first.</Note>}
            {error && <ErrorText>{error}</ErrorText>}
            <Divider caption="PMTiles file" />
            <Group>
                <TextField label="File path or URL" value={pm} placeholder="/media/internal/maps/city.pmtiles" testId="pmtiles-url" onChange={setPm} />
            </Group>
            <div className="mp-page-buttons">
                <Button disabled={!pm.trim()} data-testid="pmtiles-add"
                        onClick={() => onAddPmtiles(pm.trim(), pm.trim().split("/").pop()!.replace(/\.pmtiles$/, ""))}>Add File</Button>
            </div>
            <Note>
                A PMTiles file in the OpenMapTiles schema (for example made with Planetiler) works as an offline map of any size.
                Saved areas and files also make search and directions work without a connection.
            </Note>
        </PageShell>
    );
}

// ---- Saved places --------------------------------------------------------------------------------

export function SavedPage({ list, near, units, onPick, onDelete, onBack }: {
    list: readonly SavedPlace[]; near: [number, number] | null; units: Units;
    onPick: (s: SavedPlace) => void; onDelete: (s: SavedPlace) => void; onBack: () => void;
}) {
    return (
        <PageShell title="Saved Places" onBack={onBack} testId="saved">
            {list.length === 0 && <Note>Places you save (the star on a place) appear here.</Note>}
            <Group>
                {list.map((s) => (
                    <Row key={s._id} title={s.name} testId={`saved-${s.name}`} onClick={() => onPick(s)}
                         subtitle={[s.detail, near ? formatDistance(Math.hypot((s.lon - near[0]) * 88000, (s.lat - near[1]) * 111000), units) : ""].filter(Boolean).join(" · ")}>
                        <button type="button" className="mp-row-delete" data-testid={`saved-delete-${s.name}`}
                                onClick={(e) => { e.stopPropagation(); onDelete(s); }}>Delete</button>
                    </Row>
                ))}
            </Group>
        </PageShell>
    );
}

// ---- About ---------------------------------------------------------------------------------------

export function AboutPage({ providers, onBack }: { providers: Providers; onBack: () => void }) {
    return (
        <PageShell title="About Maps" onBack={onBack} testId="about">
            <Group label="Map data">
                <Row title="© OpenStreetMap contributors" subtitle="Open Database License (ODbL) 1.0 — openstreetmap.org/copyright" />
                <Row title="© OpenMapTiles" subtitle="Vector tile schema, CC-BY 4.0 — openmaptiles.org" />
                {providers.tiles.kind === "openmaptiles" && /openfreemap/.test(providers.tiles.url) && <Row title="OpenFreeMap" subtitle="Map tiles — openfreemap.org" />}
            </Group>
            <Group label="Services">
                <Row title="Search" subtitle={providers.search.kind === "offline" ? "Offline maps" : `${providers.search.kind === "photon" ? "Photon" : "Nominatim"} — ${providers.search.url}`} />
                <Row title="Directions" subtitle={providers.routing.kind === "offline" ? "Offline maps" : `${providers.routing.kind === "valhalla" ? "Valhalla" : "OSRM"} — ${providers.routing.url}`} />
            </Group>
            <Group label="Software">
                <Row title="MapLibre GL JS" subtitle="BSD-3-Clause" />
                <Row title="Leaflet" subtitle="BSD-2-Clause" />
                <Row title="PMTiles, vector-tile, pbf" subtitle="BSD-3-Clause" />
                <Row title="Noto Sans" subtitle="SIL Open Font License 1.1" />
            </Group>
            <Note>Improve the map at openstreetmap.org. Maps shows these sources on the map at all times, as their licences ask.</Note>
        </PageShell>
    );
}
