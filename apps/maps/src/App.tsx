// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Maps: OpenStreetMap maps, place search, directions for driving, walking
// and cycling with a turn list, turn-by-turn navigation with optional
// spoken directions, saved places, sharing a location, and offline maps.
// In the spirit of the webOS 2.x Maps app (Bing Maps), drawn in the
// Phoenix style.
//
// - The map fills the card; the search field floats at the top and the
//   command menu at the bottom (my location, directions, saved places,
//   offline maps). Pinch to zoom, two fingers to rotate (MapLibre), a long
//   press drops a pin.
// - Results, a place, and directions slide up from the bottom on a phone;
//   on a tablet they sit in a column on the left.
// - Navigation shows the next turn at the top and the arrival time at the
//   bottom, follows the user's position, speaks the turns when voice is on
//   and asks for a new route when the user leaves it.
//
// Services (see lib/): com.webos.service.location for the position,
// com.palm.db for saved places, com.webos.service.tts for voice,
// com.webos.applicationManager to share with Messaging and Email; map
// tiles, search and routing from the servers in Preferences
// (lib/providers.ts), or offline from saved areas (lib/offline.ts).
//
// - "Coffee", "pharmacy near me" (typed, or the Assistant's {nearby}):
//   places of that kind around the user, closest first, as a list and pins
//   (lib/nearby.ts); a tap on one, or on a café the map draws, opens its
//   card (address, distance, opening hours: lib/details.ts) with Directions
//   and Start.
//
// Launch params (lib/launch.ts): {target: "geo:..." | "maploc:..." |
// "mapto:..." | map link}, {address}, {route: {endAddress}}, {query},
// {location: {lat, lon}}, {placeId}; the Assistant's {nearby}, {place},
// {destination, travelMode, navigate}. Opened by another app ({$caller}),
// Back on the view it opened goes back to that app (the runtime closes
// the card; apps/photos does the same).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apps, systemFor, units as unitsService } from "@phoenix/luna";
import { useLaunchParams } from "@phoenix/luna/react";
import { AppMenu, BackProvider, Dialog, Button, IconToolButton, PopupMenu, Toolbar, ToolSpacer, cx, useBack, type Option } from "@phoenix/ui";
import { MapView, prepareMapWorker, type Camera, type MapHandle, type MapMarker, type MapPoi } from "./MapView";
import { AboutPage, RegionsPage, SavedPage, SettingsPage } from "./pages";
import { Directions, NavBanner, NavSteps, PlaceCard, Results } from "./panels";
import { MapGlyph } from "./icons";
import { bounds as boundsOf, distance, type LngLat, type Units } from "./lib/geo";
import { cleanNearby, isNearbyQuery, searchNearby } from "./lib/nearby";
import { placeDetails, type PlaceDetails } from "./lib/details";
import { directions as getDirections, findPlaces, whatIsHere } from "./lib/engine";
import { geoUri, osmLink, parseLaunch, shareText, type Intent, type LaunchPlace, type MapsLaunchParams } from "./lib/launch";
import { watchLocation, type Fix } from "./lib/location";
import { dueAnnouncement, progress as navProgress, stepOffsets, type Progress } from "./lib/nav";
import { findSaved, fromSaved, places as placesDb, type SavedPlace } from "./lib/places";
import {
    loadPrefs, loadProviders, loadShippedProviders, resetProviders, saveProviders, savePrefs, type Prefs, type Providers,
} from "./lib/providers";
import type { Route, TravelMode } from "./lib/route";
import { coordsPlace, type Place } from "./lib/search";
import { speak, stopSpeaking } from "./lib/speech";
import { addPmtilesRegion, deleteRegion, loadRegions, regionTileCount, saveRegion, type DownloadProgress, type Region } from "./lib/tiles";

type Page = "settings" | "regions" | "saved" | "about" | null;
type DirState = {
    from: Place | "me";
    to: Place;
    route: Route | null;
    busy: boolean;
    error?: string;
    note?: string;
    /** Start navigating as soon as the route comes (Start on a place, the Assistant's navigate). */
    autoStart?: boolean;
    /** Every mode's time, for the mode buttons. */
    times?: Partial<Record<TravelMode, number>>;
};

const MODES: TravelMode[] = ["drive", "walk", "cycle"];

/** A place another app handed over (the Assistant's cards). */
function launchedPlace(p: LaunchPlace): Place {
    return { id: p.id || `pt:${p.lon.toFixed(6)},${p.lat.toFixed(6)}`, name: p.name, detail: p.detail ?? "", lon: p.lon, lat: p.lat,
             kind: "poi", category: p.category };
}

const errorText = (e: unknown) => (e as { errorText?: string }).errorText ?? (e instanceof Error ? e.message : String(e));

/** A command menu button with one of Maps' glyphs (the look of @phoenix/ui's IconToolButton). */
function MapToolButton({ label, glyph, testId, onClick }: { label: string; glyph: Parameters<typeof MapGlyph>[0]["name"]; testId: string; onClick: () => void }) {
    return (
        <button type="button" className="pui-icon-tool-button" aria-label={label} data-testid={testId}
                onClick={(e) => { e.stopPropagation(); onClick(); }}>
            <MapGlyph name={glyph} size={28} className="pui-glyph" />
        </button>
    );
}

function useWide(): boolean {
    const [wide, setWide] = useState(() => window.innerWidth >= 600);
    useEffect(() => {
        const on = () => setWide(window.innerWidth >= 600);
        window.addEventListener("resize", on);
        return () => window.removeEventListener("resize", on);
    }, []);
    return wide;
}

function MapsApp() {
    const wide = useWide();
    const launch = useLaunchParams<MapsLaunchParams>();
    const map = useRef<MapHandle>(null);
    const [ready, setReady] = useState(false);
    const [providers, setProvidersState] = useState<Providers>(loadProviders);
    const [prefs, setPrefsState] = useState<Prefs>(loadPrefs);
    const [regions, setRegions] = useState<Region[]>([]);
    const [fix, setFix] = useState<Fix | null>(null);
    const [locError, setLocError] = useState("");
    const [query, setQuery] = useState("");
    const [results, setResults] = useState<{ places: Place[]; busy: boolean; note?: string; nearby?: boolean } | null>(null);
    const [details, setDetails] = useState<{ id: string; d: PlaceDetails } | null>(null);
    const [stepsShown, setStepsShown] = useState(false);
    /** The view a launch opened, by viewKey: Back there belongs to the caller ({$caller}). */
    const [opened, setOpened] = useState<string | null>(null);
    const fixRef = useRef<Fix | null>(null);
    const centred = useRef(false);
    const [selected, setSelected] = useState<Place | null>(null);
    const [dir, setDir] = useState<DirState | null>(null);
    const [nav, setNav] = useState<{ route: Route; progress: Progress } | null>(null);
    const [page, setPage] = useState<Page>(null);
    const [saved, setSaved] = useState<SavedPlace[]>([]);
    const [menu, setMenu] = useState<{ kind: "share"; anchor: HTMLElement; place: Place } | { kind: "from"; anchor: HTMLElement } | null>(null);
    const [toast, setToast] = useState("");
    const [download, setDownload] = useState<{ progress: DownloadProgress | null; error: string; abort?: AbortController }>({ progress: null, error: "" });
    const [bearing, setBearing] = useState(0);
    const [renderer, setRenderer] = useState<"vector" | "canvas">("vector");
    const [visibleTiles, setVisibleTiles] = useState(0);
    const [confirm, setConfirm] = useState<{ title: string; message: string; action: () => void } | null>(null);
    const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
    const said = useRef(new Set<string>());
    const offsets = useRef<number[]>([]);
    const lastReroute = useRef(0);
    const routeRequest = useRef(0);
    const handled = useRef<object | null>(null);
    const searchAbort = useRef<AbortController | null>(null);

    const say = useCallback((t: string) => {
        setToast(t);
        if (toastTimer.current) clearTimeout(toastTimer.current);
        toastTimer.current = setTimeout(() => setToast(""), 3000);
    }, []);
    const setPrefs = (p: Partial<Prefs>) => setPrefsState((o) => { const n = { ...o, ...p }; savePrefs(n); return n; });
    const me: LngLat | null = fix ? [fix.lon, fix.lat] : null;
    // The device's units unless Preferences say otherwise.
    const [deviceUnits, setDeviceUnits] = useState<Units>(() => systemFor("auto", navigator.language));
    useEffect(() => { const sub = unitsService.watch((u) => setDeviceUnits(u), () => {}); return () => sub.cancel(); }, []);
    const unitsNow: Units = prefs.distanceUnits === "auto" ? deviceUnits : prefs.distanceUnits;

    // Start: the image's provider defaults, the offline regions, then the map.
    useEffect(() => {
        void loadShippedProviders().then(() => setProvidersState(loadProviders()))
            .then(() => loadRegions()).then(async (r) => { setRegions(r); await prepareMapWorker(); setReady(true); }, () => setReady(true));
    }, []);

    useEffect(() => {
        const sub = placesDb.watch(setSaved);
        return () => sub.cancel();
    }, []);

    useEffect(() => {
        const sub = watchLocation((f) => { fixRef.current = f; setFix(f); setLocError(""); }, setLocError);
        return () => sub.cancel();
    }, []);

    const initial = useMemo(() => {
        const c = prefs.camera;
        if (c) return { center: c.center, zoom: c.zoom, bearing: c.bearing ?? 0 };
        const demo = regions.find((r) => r.kind === "bundled");
        const center: LngLat = demo ? [(demo.bounds[0] + demo.bounds[2]) / 2, (demo.bounds[1] + demo.bounds[3]) / 2] : [-121.8907, 37.3337];
        return { center, zoom: 15, bearing: 0 };
        // Only for the first map.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ready]);

    const onMove = useCallback((c: Camera) => {
        setBearing(c.bearing);
        const b = map.current?.bounds();
        if (b) setVisibleTiles(regionTileCount(b));
        setPrefsState((o) => { const n = { ...o, camera: { center: c.center, zoom: c.zoom, bearing: c.bearing } }; savePrefs(n); return n; });
    }, []);

    // ---- Search ---------------------------------------------------------------------------------

    const near = (): LngLat => me ?? map.current?.camera().center ?? initial.center;

    /** The device's position, waiting up to ms for the first fix (a launch comes before it). */
    const waitForFix = async (ms: number): Promise<LngLat | null> => {
        for (let t = 0; !fixRef.current && t < ms; t += 100) await new Promise((r) => setTimeout(r, 100));
        const f = fixRef.current;
        return f ? [f.lon, f.lat] : null;
    };

    // "Coffee", "pharmacy near me": that kind of place around the user,
    // closest first (lib/nearby.ts), not places named like the words anywhere.
    const runNearby = async (text: string, ac: AbortController, pickFirst: boolean): Promise<Place | undefined> => {
        const at = (await waitForFix(4000)) ?? map.current?.camera().center ?? initial.center;
        if (ac.signal.aborted) return undefined;
        let places: Place[] = [], note: string | undefined;
        try {
            places = (await searchNearby(providers, text, at, ac.signal)).places;
        } catch (e) {
            if (ac.signal.aborted) return undefined;
            // No search server: the saved regions' index, by the words.
            const r = await findPlaces({ ...providers, search: { ...providers.search, kind: "offline" } }, cleanNearby(text), at).catch(() => null);
            places = r ? [...r.places].sort((a, b) => distance(at, [a.lon, a.lat]) - distance(at, [b.lon, b.lat])) : [];
            note = places.length ? "Results from offline maps." : `Search is not available (${errorText(e)}).`;
        }
        if (ac.signal.aborted) return undefined;
        setResults({ places, busy: false, note, nearby: true });
        if (pickFirst && places.length) { choose(places[0]); return places[0]; }
        if (places.length) {
            const pts: LngLat[] = [at, ...places.slice(0, 5).map((p) => [p.lon, p.lat] as LngLat)];
            map.current?.fitBounds(boundsOf(pts), wide ? 70 : 50);
        }
        return undefined;
    };

    const runSearch = useCallback(async (q: string, pickFirst = false) => {
        const text = q.trim();
        if (!text) return;
        searchAbort.current?.abort();
        const ac = new AbortController();
        searchAbort.current = ac;
        setSelected(null);
        setDir(null);
        setResults({ places: [], busy: true });
        if (isNearbyQuery(text)) return runNearby(text, ac, pickFirst);
        try {
            const r = await findPlaces(providers, text, map.current?.camera().center ?? near(), ac.signal);
            if (ac.signal.aborted) return;
            const note = r.error ? `Search is not available (${r.error}).` : r.offline && r.places.length ? "Results from offline maps." : undefined;
            if (pickFirst && r.places.length) {
                setResults({ places: r.places, busy: false, note });
                choose(r.places[0]);
                return r.places[0];
            }
            setResults({ places: r.places, busy: false, note });
            if (r.places.length) map.current?.fitBounds(boundsOf(r.places.slice(0, 8).map((p) => [p.lon, p.lat] as LngLat)), 80);
        } catch (e) {
            if (!ac.signal.aborted) setResults({ places: [], busy: false, note: errorText(e) });
        }
        return undefined;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [providers, me]);

    const choose = (p: Place) => {
        setSelected(p);
        map.current?.flyTo([p.lon, p.lat], 16);
    };

    // The place shown: its opening hours, phone and website, when its OSM element is known.
    useEffect(() => {
        if (!selected || details?.id === selected.id) return;
        const ac = new AbortController();
        const id = selected.id;
        void placeDetails(providers, selected, ac.signal).then((d) => { if (!ac.signal.aborted) setDetails({ id, d }); }, () => {});
        return () => ac.abort();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selected, providers]);

    // A café the map draws, tapped: its card, with the address and OSM
    // element from the search server when it knows the place there.
    const onPoiTap = (poi: MapPoi) => {
        if (nav) return;
        const p: Place = { id: poi.id, name: poi.name, detail: "", lon: poi.lon, lat: poi.lat, kind: "poi", category: poi.category || undefined };
        setDir(null);
        setSelected(p);
        void searchNearby(providers, poi.name, [poi.lon, poi.lat]).then((r) => {
            const hit = r.places.find((x) => x.name === poi.name && distance([x.lon, x.lat], [poi.lon, poi.lat]) < 150);
            if (hit) setSelected((s) => (s?.id === p.id ? { ...hit, category: hit.category ?? p.category } : s));
        }, () => {});
    };

    // ---- Directions -----------------------------------------------------------------------------

    const routeFor = useCallback(async (d: DirState, mode: TravelMode) => {
        // Only the latest request may set the route: switching modes quickly
        // must not let a slower, older answer replace the newer one.
        const request = ++routeRequest.current;
        const from: LngLat | null = d.from === "me" ? me : [d.from.lon, d.from.lat];
        if (!from) {
            setDir({ ...d, busy: false, route: null, error: locError || "Waiting for your location…" });
            return;
        }
        setDir({ ...d, busy: true, route: null, error: undefined, note: undefined });
        try {
            const r = await getDirections(providers, from, [d.to.lon, d.to.lat], mode);
            if (request !== routeRequest.current) return;
            const times = { ...(d.times ?? {}), [mode]: r.route.duration };
            setDir({ ...d, busy: false, route: r.route, note: r.note, error: undefined, autoStart: false, times });
            if (d.autoStart) beginNav(r.route);
            else map.current?.fitBounds(boundsOf(r.route.geometry), wide ? 60 : 50);
            // The other modes' times, for their buttons (online routing only:
            // one small request each).
            if (providers.routing.kind !== "offline" && !r.note) {
                for (const m of MODES.filter((x) => times[x] === undefined)) {
                    void getDirections(providers, from, [d.to.lon, d.to.lat], m).then((o) => {
                        if (request !== routeRequest.current || o.note) return;
                        setDir((cur) => (cur && cur.to.id === d.to.id ? { ...cur, times: { ...(cur.times ?? {}), [m]: o.route.duration } } : cur));
                    }, () => {});
                }
            }
        } catch (e) {
            if (request !== routeRequest.current) return;
            setDir({ ...d, busy: false, route: null, error: errorText(e) });
        }
    }, [me, providers, locError, wide]);

    const startDirections = (to: Place, from: Place | "me" = "me", autoStart = false, mode: TravelMode = prefs.mode) => {
        const d: DirState = { from, to, route: null, busy: true, autoStart };
        setDir(d);
        void routeFor(d, mode);
    };

    // Waiting for a fix to route from "My Location": route when it comes.
    useEffect(() => {
        if (dir && dir.from === "me" && !dir.route && !dir.busy && me && /location/i.test(dir.error ?? "")) void routeFor(dir, prefs.mode);
    }, [me, dir, routeFor, prefs.mode]);

    // ---- Navigation -----------------------------------------------------------------------------

    const startNav = () => { if (dir?.route) beginNav(dir.route); };

    const beginNav = (route: Route) => {
        offsets.current = stepOffsets(route);
        said.current = new Set();
        const at = me ?? route.geometry[0];
        const p = navProgress(route, at, offsets.current);
        setNav({ route, progress: p });
        if (prefs.voice) void speak(route.steps[0].instruction);
        if (fix) map.current?.follow(fix, true);
    };

    const endNav = () => {
        stopSpeaking();
        setNav(null);
        map.current?.resetNorth();
        if (dir?.route) map.current?.fitBounds(boundsOf(dir.route.geometry), 50);
    };

    // Each new position while navigating.
    useEffect(() => {
        if (!nav || !fix) return;
        const p = navProgress(nav.route, [fix.lon, fix.lat], offsets.current);
        setNav((n) => (n ? { ...n, progress: p } : n));
        map.current?.follow(fix, true);
        if (prefs.voice) {
            const text = dueAnnouncement(nav.route, p, unitsNow, said.current);
            if (text) void speak(text);
        }
        if (p.offRoute && dir && Date.now() - lastReroute.current > 10000) {
            lastReroute.current = Date.now();
            void getDirections(providers, [fix.lon, fix.lat], [dir.to.lon, dir.to.lat], nav.route.mode).then((r) => {
                offsets.current = stepOffsets(r.route);
                said.current = new Set();
                setDir((d) => (d ? { ...d, route: r.route } : d));
                setNav({ route: r.route, progress: navProgress(r.route, [fix.lon, fix.lat], offsets.current) });
            }, () => {});
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fix]);

    // The first fix of a session: the map comes to the user (unless a
    // launch or the user already put something on it).
    useEffect(() => {
        if (!fix || centred.current || !ready) return;
        centred.current = true;
        if (!results && !selected && !dir && !nav && handled.current && parseLaunch(handled.current as MapsLaunchParams).kind === "none")
            map.current?.flyTo([fix.lon, fix.lat], 15);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fix, ready]);

    // ---- Launches from other apps -----------------------------------------------------------------

    useEffect(() => {
        if (!ready || handled.current === launch) return;
        handled.current = launch;
        const intent: Intent = parseLaunch(launch);
        void (async () => {
            if (intent.kind === "show") {
                const p = intent.place ? launchedPlace(intent.place) : coordsPlace([intent.lon, intent.lat], intent.label ?? "Shared location");
                setResults(null);
                setDir(null);
                setSelected(p);
                setOpened(`place:${p.id}`);
                map.current?.flyTo([p.lon, p.lat], intent.zoom ?? 16);
                if (!intent.label) void whatIsHere(providers, [p.lon, p.lat]).then((w) => {
                    if (w) setSelected((s) => (s?.id === p.id ? { ...p, detail: `Near ${w.name}${w.detail ? `, ${w.detail}` : ""}` } : s));
                });
            } else if (intent.kind === "search") {
                setQuery(intent.query);
                const first = await runSearch(intent.query, true);
                setOpened(first ? `place:${first.id}` : "results");
            } else if (intent.kind === "nearby") {
                // The field shows what is looked for ("coffee"), not the sentence asked.
                setQuery(cleanNearby(intent.query));
                setOpened("results");
                searchAbort.current?.abort();
                const ac = new AbortController();
                searchAbort.current = ac;
                setSelected(null);
                setDir(null);
                setResults({ places: [], busy: true, nearby: true });
                await runNearby(intent.query, ac, false);
            } else if (intent.kind === "directions") {
                let to: Place | undefined;
                if (typeof intent.to === "string") {
                    setQuery(isNearbyQuery(intent.to) ? cleanNearby(intent.to) : intent.to);
                    to = await runSearch(intent.to, true);
                } else {
                    to = intent.to.place ? launchedPlace(intent.to.place) : coordsPlace([intent.to.lon, intent.to.lat], intent.to.label ?? "Destination");
                }
                if (intent.mode) setPrefs({ mode: intent.mode });
                if (to) {
                    setOpened(intent.start ? "nav" : `dir:${to.id}`);
                    startDirections(to, "me", !!intent.start, intent.mode ?? prefs.mode);
                }
            } else if (intent.kind === "place") {
                const s = await placesDb.get(intent.placeId).catch(() => undefined);
                if (s) { setResults(null); const p = fromSaved(s); choose(p); setOpened(`place:${p.id}`); } else say("That place was deleted.");
            }
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [launch, ready]);

    // ---- Back gesture -----------------------------------------------------------------------------

    // What is on screen, for Back: opened by another app, Back on the view
    // that app opened is the runtime's (the card closes and the caller
    // comes back); Back on anything the user went to from there is Maps'.
    const viewKey = page ? "page" : nav ? "nav" : dir ? `dir:${dir.to.id}` : selected ? `place:${selected.id}` : results ? "results" : "map";
    const caller = !!(launch as MapsLaunchParams | null)?.$caller;
    useBack(() => {
        if (page) setPage(null);
        else if (nav) endNav();
        else if (dir) setDir(null);
        else if (selected) setSelected(null);
        else if (results) setResults(null);
        return true;
    }, !!(page || nav || dir || selected || results) && !(caller && viewKey === opened));

    // ---- Share ------------------------------------------------------------------------------------

    const share = (how: string, p: Place) => {
        const text = shareText(p.name, p.detail, p.lat, p.lon);
        if (how === "messaging") void apps.launch("org.webosphoenix.messaging", { messageText: text });
        else if (how === "email") void apps.launch("com.palm.app.email", { summary: p.name, text: text.replace(/\n/g, "<br>") });
        else if (how === "copy") {
            const done = () => say("Link copied");
            if (navigator.clipboard) void navigator.clipboard.writeText(osmLink(p.lat, p.lon)).then(done, () => say(geoUri(p.lat, p.lon)));
            else say(geoUri(p.lat, p.lon));
        }
    };

    const toggleSave = async (p: Place) => {
        const s = findSaved(saved, p);
        if (s?._id) { await placesDb.remove(s._id); say("Removed from Saved Places"); }
        else { await placesDb.save(p); say("Saved"); }
    };

    // ---- Map contents ---------------------------------------------------------------------------

    const markers = useMemo<MapMarker[]>(() => {
        if (nav || dir) {
            const d = dir!;
            const route = nav?.route ?? d.route;
            const start = route?.geometry[0] ?? (d.from !== "me" ? [d.from.lon, d.from.lat] : null);
            return [
                ...(start && d.from !== "me" ? [{ id: "start", lon: start[0], lat: start[1], kind: "start" as const, label: "Start" }] : []),
                { id: "end", lon: d.to.lon, lat: d.to.lat, kind: "end" as const, label: d.to.name },
            ];
        }
        const list: MapMarker[] = saved.map((s) => ({ id: `saved:${s._id}`, lon: s.lon, lat: s.lat, kind: "saved", label: s.name }));
        if (results) results.places.forEach((p, i) => list.push({ id: `r${i}`, lon: p.lon, lat: p.lat, kind: "result", label: p.name }));
        if (selected) list.push({ id: "selected", lon: selected.lon, lat: selected.lat, kind: "selected", label: selected.name });
        return list;
    }, [results, selected, saved, dir, nav]);

    const onMarkerTap = (id: string) => {
        if (id.startsWith("saved:")) {
            const s = saved.find((x) => `saved:${x._id}` === id);
            if (s) choose(fromSaved(s));
        } else if (/^r\d+$/.test(id) && results) {
            choose(results.places[Number(id.slice(1))]);
        }
    };

    const onLongPress = (p: LngLat) => {
        if (nav) return;
        const pin = coordsPlace(p);
        setDir(null);
        setResults(null);
        setSelected(pin);
        void whatIsHere(providers, p).then((w) => {
            if (w) setSelected((s) => (s?.id === pin.id ? { ...pin, detail: `Near ${w.name}${w.detail ? `, ${w.detail}` : ""}` } : s));
        });
    };

    const locate = () => {
        if (fix) map.current?.flyTo([fix.lon, fix.lat], 16);
        else say(locError || "Finding your location…");
    };

    // ---- Offline regions --------------------------------------------------------------------------

    const saveArea = async (name: string) => {
        const b = map.current?.bounds();
        if (!b) return;
        const abort = new AbortController();
        setDownload({ progress: { done: 0, total: regionTileCount(b), bytes: 0 }, error: "", abort });
        try {
            await saveRegion(providers, name, b, (progress) => setDownload((d) => ({ ...d, progress })), abort.signal);
            setRegions(await loadRegions());
            setDownload({ progress: null, error: "" });
            say(`Saved ${name} for offline use`);
        } catch (e) {
            setDownload({ progress: null, error: errorText(e) });
        }
    };

    const addPmtiles = async (path: string, name: string) => {
        try {
            // A file on the device: its URL in the web runtime (the simulator
            // serves /media/internal through its file manager).
            const fm = (window as { __phoenixRuntime?: { fileManager?: { url(p: string): Promise<string> } } }).__phoenixRuntime?.fileManager;
            const url = /^https?:/.test(path) ? path : fm ? await fm.url(path) : `file://${path}`;
            await addPmtilesRegion(url, name);
            setRegions(await loadRegions());
            say(`Added ${name}`);
        } catch (e) {
            setDownload({ progress: null, error: `Could not read that file: ${errorText(e)}` });
        }
    };

    // ---- Layout ---------------------------------------------------------------------------------

    const fromLabel = dir ? (dir.from === "me" ? "My Location" : dir.from.name) : "";
    const navSteps = nav && (wide || stepsShown) ? (
        <NavSteps route={nav.route} progress={nav.progress} units={unitsNow}
                  onStep={(i) => { const s = nav.route.steps[i]; if (s) map.current?.flyTo(s.location, 17); }} />
    ) : null;
    const panel = nav ? null : dir ? (
        <Directions fromLabel={fromLabel} toLabel={dir.to.name} mode={prefs.mode} route={dir.route} busy={dir.busy} error={dir.error}
                    note={dir.note} units={unitsNow} times={dir.times}
                    onMode={(m) => { setPrefs({ mode: m }); void routeFor(dir, m); }}
                    onSwap={() => {
                        const from = dir.from === "me" ? (me ? coordsPlace(me, "My Location") : null) : dir.from;
                        if (!from) return;
                        const d: DirState = { ...dir, from: dir.to, to: from };
                        void routeFor(d, prefs.mode);
                    }}
                    onFrom={() => {
                        const el = document.querySelector<HTMLElement>("[data-testid='dir-from']");
                        if (el) setMenu({ kind: "from", anchor: el });
                    }}
                    onStart={startNav}
                    onStep={(i) => { const s = dir.route?.steps[i]; if (s) map.current?.flyTo(s.location, 17); }}
                    onClose={() => setDir(null)} />
    ) : selected ? (
        <PlaceCard place={selected} details={details?.id === selected.id ? details.d : undefined} saved={!!findSaved(saved, selected)} near={me} units={unitsNow}
                   onDirections={() => startDirections(selected)} onStart={() => startDirections(selected, "me", true)} onSave={() => void toggleSave(selected)}
                   onShare={(anchor) => setMenu({ kind: "share", anchor, place: selected })} onClose={() => setSelected(null)} />
    ) : results ? (
        <Results places={results.places} busy={results.busy} note={results.note} near={me ?? null} units={unitsNow} onPick={choose} />
    ) : null;

    const routeLine = nav?.route.geometry ?? dir?.route?.geometry ?? null;
    // The route on screen, for phoenix-sim's Simulate > Location > Moving
    // Along the Route (shell/qml/Phoenix/Sim/SimLocation.qml).
    const shownRoute = nav?.route ?? dir?.route ?? null;
    useEffect(() => {
        (window as { __phoenixMapsRoute?: unknown }).__phoenixMapsRoute = shownRoute ? { geometry: shownRoute.geometry, mode: shownRoute.mode } : null;
    }, [shownRoute]);

    const appMenu = [
        { label: "Saved Places", onSelect: () => setPage("saved") },
        { label: "Offline Maps", onSelect: () => setPage("regions") },
        { label: "Preferences", onSelect: () => setPage("settings") },
        { label: "About Maps", onSelect: () => setPage("about") },
    ];

    const attribution = providers.tiles.kind === "style"
        ? "© OpenStreetMap contributors"
        : `© OpenStreetMap contributors · © OpenMapTiles${providers.tiles.kind === "openmaptiles" && /openfreemap/.test(providers.tiles.url) ? " · OpenFreeMap" : ""}`;

    const pageView = page === "settings" ? (
        <SettingsPage prefs={prefs} deviceUnits={deviceUnits} providers={providers} onPrefs={setPrefs} onBack={() => setPage(null)}
                      onProviders={(p) => {
                          if (p) saveProviders(p);
                          setProvidersState(p ?? resetProviders());
                          say("Map servers updated");
                      }} />
    ) : page === "regions" ? (
        <RegionsPage regions={regions} visibleTiles={visibleTiles} progress={download.progress} error={download.error} units={unitsNow}
                     onSave={(n) => void saveArea(n)} onCancel={() => download.abort?.abort()}
                     onDelete={(r) => setConfirm({ title: "Delete Offline Map", message: `Delete "${r.name}"?`, action: () => {
                         void deleteRegion(r.id).then(loadRegions).then(setRegions);
                     } })}
                     onAddPmtiles={(u, n) => void addPmtiles(u, n)}
                     onShow={(r) => { setPage(null); map.current?.fitBounds(r.bounds, 20); }}
                     onBack={() => setPage(null)} />
    ) : page === "saved" ? (
        <SavedPage list={saved} near={me} units={unitsNow} onBack={() => setPage(null)}
                   onPick={(s) => { setPage(null); setResults(null); setDir(null); choose(fromSaved(s)); }}
                   onDelete={(s) => void placesDb.remove(s._id!)} />
    ) : page === "about" ? <AboutPage providers={providers} onBack={() => setPage(null)} /> : null;

    const fromOptions: Option<string>[] = [
        { label: "My Location", value: "me" },
        ...saved.slice(0, 8).map((s) => ({ label: s.name, value: `saved:${s._id}` })),
    ];

    return (
        <div className={cx("mp-app", wide && "wide", nav && "navigating", panel && (wide ? "has-side" : "has-sheet"))}>
            {ready && (
                <MapView ref={map} providers={providers} initial={initial} markers={markers} route={routeLine} me={fix}
                         onMarkerTap={onMarkerTap} onLongPress={onLongPress} onPoiTap={onPoiTap} onMove={onMove} onRenderer={setRenderer} />
            )}
            <div className="mp-attribution" data-testid="attribution" onClick={() => setPage("about")}>{attribution}</div>

            {!nav && (
                <form className="mp-search" data-testid="search-form" onSubmit={(e) => { e.preventDefault(); void runSearch(query); }}>
                    <MapGlyph name="search" size={18} className="mp-search-icon" />
                    <input value={query} placeholder="Search or enter an address" data-testid="search" enterKeyHint="search"
                           onChange={(e) => setQuery(e.target.value)} />
                    {query && <button type="button" className="mp-search-clear" aria-label="Clear" data-testid="search-clear"
                                      onClick={() => { setQuery(""); setResults(null); setSelected(null); }}>&times;</button>}
                </form>
            )}

            {panel && <div className={cx("mp-panel", wide ? "side" : "sheet")} data-testid="panel">{panel}</div>}

            {nav && (
                <NavBanner route={nav.route} progress={nav.progress} units={unitsNow} voice={prefs.voice}
                           onVoice={() => { if (prefs.voice) stopSpeaking(); setPrefs({ voice: !prefs.voice }); }}
                           onEnd={endNav} onOverview={() => map.current?.fitBounds(boundsOf(nav.route.geometry), 60)}
                           onSteps={wide ? undefined : () => setStepsShown((v) => !v)} stepsShown={stepsShown} />
            )}
            {navSteps && <div className={cx("mp-panel", "nav-steps", wide ? "side" : "sheet")} data-testid="nav-steps-panel">{navSteps}</div>}

            {!nav && renderer === "vector" && Math.abs(bearing) > 1 && (
                <button type="button" className="mp-compass" aria-label="North up" data-testid="compass" onClick={() => map.current?.resetNorth()}>
                    <MapGlyph name="compass" size={26} className="mp-compass-glyph" />
                </button>
            )}

            {!nav && (
                <Toolbar className="mp-toolbar">
                    <MapToolButton label="My Location" testId="locate" glyph="locate" onClick={locate} />
                    <ToolSpacer />
                    <MapToolButton label="Directions" testId="directions-button" glyph="directions"
                                   onClick={() => {
                                        if (selected) startDirections(selected);
                                        else say("Search for a place, or press and hold on the map, then tap Directions.");
                                    }} />
                    <IconToolButton label="Saved Places" testId="saved-button" icon="star" onClick={() => setPage("saved")} />
                    <MapToolButton label="Offline Maps" testId="regions-button" glyph="download" onClick={() => setPage("regions")} />
                    <ToolSpacer />
                    <IconToolButton label="Menu" testId="menu-button" icon="menu" onClick={() => document.dispatchEvent(new Event("phoenixAppMenu"))} />
                </Toolbar>
            )}

            {pageView && <div className="mp-page-layer">{pageView}</div>}

            {toast && <div className="mp-toast" data-testid="toast">{toast}</div>}
            {locError && !fix && !page && <div className="mp-locstatus" data-testid="location-status">{locError}</div>}

            {menu?.kind === "share" && (
                <PopupMenu anchor={menu.anchor} onClose={() => setMenu(null)} onSelect={(v: string) => share(v, menu.place)}
                           options={[{ label: "Messaging", value: "messaging" }, { label: "Email", value: "email" }, { label: "Copy Link", value: "copy" }]} />
            )}
            {menu?.kind === "from" && dir && (
                <PopupMenu anchor={menu.anchor} onClose={() => setMenu(null)} options={fromOptions}
                           onSelect={(v: string) => {
                               const from: Place | "me" = v === "me" ? "me" : fromSaved(saved.find((s) => `saved:${s._id}` === v)!);
                               void routeFor({ ...dir, from }, prefs.mode);
                           }} />
            )}
            {confirm && (
                <Dialog open title={confirm.title} message={confirm.message} onClose={() => setConfirm(null)} testId="confirm">
                    <div className="mp-dialog-buttons">
                        <Button variant="negative" data-testid="confirm-ok" onClick={() => { confirm.action(); setConfirm(null); }}>Delete</Button>
                        <Button onClick={() => setConfirm(null)}>Cancel</Button>
                    </div>
                </Dialog>
            )}
            <AppMenu items={appMenu} />
        </div>
    );
}

export function App() {
    return (
        <BackProvider>
            <MapsApp />
        </BackProvider>
    );
}
