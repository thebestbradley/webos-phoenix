// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The map itself, with one small API over two renderers:
//
// - "vector": MapLibre GL JS 6 (BSD-3-Clause), WebGL 2: smooth pinch zoom,
//   two-finger rotate and tilt, crisp labels. The default.
// - "canvas": Leaflet with vector tiles drawn by canvasmap.ts, for a web
//   runtime without WebGL 2.
//
// Markers (search results, route ends, saved places) and the blue "you
// are here" dot are DOM elements on both; the route is a line layer.
// A long press drops a pin (onLongPress).

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import * as maplibre from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { hasWebGL2, vectorCanvasLayer } from "./canvasmap";
import type { LngLat } from "./lib/geo";
import type { Fix } from "./lib/location";
import type { Providers } from "./lib/providers";
import { COLORS, phoenixStyle } from "./lib/style";
import { getLocal } from "./lib/local";
import { getTile } from "./lib/tiles";

export interface MapMarker {
    id: string;
    lon: number;
    lat: number;
    kind: "result" | "selected" | "start" | "end" | "saved";
    label?: string;
}

export interface Camera { center: LngLat; zoom: number; bearing: number }

export interface MapHandle {
    flyTo(center: LngLat, zoom?: number): void;
    fitBounds(b: [number, number, number, number], padding?: number): void;
    camera(): Camera;
    bounds(): [number, number, number, number];
    resetNorth(): void;
    follow(fix: Fix, heading?: boolean): void;
    renderer: "vector" | "canvas";
}

export interface MapViewProps {
    providers: Providers;
    initial: { center: LngLat; zoom: number; bearing?: number };
    markers: readonly MapMarker[];
    route: LngLat[] | null;
    me: Fix | null;
    onMarkerTap?: (id: string) => void;
    onLongPress?: (p: LngLat) => void;
    onMove?: (c: Camera) => void;
    onRenderer?: (r: "vector" | "canvas") => void;
}

/**
 * MapLibre's worker, as a blob: URL made from the bundled script: a worker
 * cannot start from file:// (webOS) or phoenix:// (the simulator). Call
 * once before the first map.
 */
let workerReady: Promise<void> | null = null;
export function prepareMapWorker(): Promise<void> {
    workerReady ??= getLocal(workerUrl, "text")
        .then((code) => { maplibre.setWorkerUrl(URL.createObjectURL(new Blob([code], { type: "text/javascript" }))); })
        .catch(() => { maplibre.setWorkerUrl(workerUrl); });
    return workerReady;
}

// Tiles and glyphs for MapLibre come through "phx://" (see tiles.ts).
let providersRef: Providers | null = null;
let protocolReady = false;
const BUNDLED_RANGES = new Set(["0-255", "256-511", "8192-8447"]);

function registerProtocol() {
    if (protocolReady) return;
    protocolReady = true;
    maplibre.addProtocol("phx", async (params, abort) => {
        const m = /^phx:\/\/(tiles|glyphs)\/(.*)$/.exec(params.url);
        if (!m || !providersRef) throw new Error(`Bad map URL ${params.url}`);
        if (m[1] === "tiles") {
            const [z, x, y] = m[2].split("/").map(Number);
            return { data: await getTile(providersRef, z, x, y, abort.signal) };
        }
        const [rawStack, file] = m[2].split("/");
        const stack = decodeURIComponent(rawStack);
        const range = file.replace(".pbf", "").replace(/^(\d+-\d+).*$/, "$1");
        const local = `fonts/${stack.replace(/\s+/g, "-")}/${range}.pbf`;
        if (BUNDLED_RANGES.has(range)) {
            const data = await getLocal(local, "arraybuffer");
            if (data) return { data };
        }
        const remote = providersRef.tiles.glyphsUrl;
        if (remote && providersRef.tiles.kind !== "offline") {
            const r = await fetch(remote.replace("{fontstack}", encodeURIComponent(stack)).replace("{range}", range), { signal: abort.signal });
            if (r.ok) return { data: await r.arrayBuffer() };
        }
        // No glyphs for this script: an empty set, so the rest still draws.
        return { data: new ArrayBuffer(0) };
    });
}

function markerElement(m: MapMarker, onTap?: (id: string) => void): HTMLElement {
    const el = document.createElement("div");
    el.className = `mp-marker ${m.kind}`;
    el.dataset.testid = `marker-${m.kind}`;
    el.title = m.label ?? "";
    if (m.label && (m.kind === "start" || m.kind === "end")) el.textContent = m.kind === "start" ? "A" : "B";
    el.addEventListener("click", (e) => { e.stopPropagation(); onTap?.(m.id); });
    return el;
}

function meElement(): HTMLElement {
    const el = document.createElement("div");
    el.className = "mp-me";
    el.dataset.testid = "my-location";
    el.innerHTML = '<div class="mp-me-halo"></div><div class="mp-me-heading"></div><div class="mp-me-dot"></div>';
    return el;
}

const ROUTE_SOURCE = "phx-route";

export const MapView = forwardRef<MapHandle, MapViewProps>(function MapView(props, ref) {
    const box = useRef<HTMLDivElement>(null);
    const impl = useRef<Impl | null>(null);
    // Where the map was, for the next renderer when Preferences change it.
    const lastCamera = useRef<Camera | null>(null);
    const latest = useRef(props);
    latest.current = props;
    providersRef = props.providers;

    const wantCanvas = props.providers.renderer === "canvas" || (props.providers.renderer === "auto" && !hasWebGL2());
    const styleKey = `${wantCanvas}|${props.providers.tiles.kind}|${props.providers.tiles.url}|${props.providers.tiles.styleUrl}|${props.providers.tiles.rasterUrl}`;

    useEffect(() => {
        const el = box.current!;
        const cam = lastCamera.current ?? { ...props.initial, bearing: props.initial.bearing ?? 0 };
        let made: Impl;
        try {
            made = wantCanvas ? canvasImpl(el, latest, cam) : vectorImpl(el, latest, cam);
        } catch {
            made = canvasImpl(el, latest, cam);
        }
        impl.current = made;
        latest.current.onRenderer?.(made.renderer);
        made.setMarkers(latest.current.markers);
        made.setRoute(latest.current.route);
        made.setMe(latest.current.me);
        return () => { lastCamera.current = made.camera(); made.destroy(); impl.current = null; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [styleKey]);

    useEffect(() => { impl.current?.setMarkers(props.markers); }, [props.markers]);
    useEffect(() => { impl.current?.setRoute(props.route); }, [props.route]);
    useEffect(() => { impl.current?.setMe(props.me); }, [props.me]);

    useImperativeHandle(ref, () => ({
        flyTo: (c, z) => impl.current?.flyTo(c, z),
        fitBounds: (b, p) => impl.current?.fitBounds(b, p ?? 60),
        camera: () => impl.current?.camera() ?? { ...props.initial, bearing: 0 },
        bounds: () => impl.current?.bounds() ?? [0, 0, 0, 0],
        resetNorth: () => impl.current?.resetNorth(),
        follow: (f, h) => impl.current?.follow(f, !!h),
        get renderer() { return impl.current?.renderer ?? "vector"; },
    }), [props.initial]);

    return <div ref={box} className="mp-map" data-testid="map" />;
});

// ---- Renderers ----------------------------------------------------------------------------------

interface Impl {
    renderer: "vector" | "canvas";
    flyTo(c: LngLat, z?: number): void;
    fitBounds(b: [number, number, number, number], padding: number): void;
    camera(): Camera;
    bounds(): [number, number, number, number];
    resetNorth(): void;
    follow(f: Fix, heading: boolean): void;
    setMarkers(m: readonly MapMarker[]): void;
    setRoute(r: LngLat[] | null): void;
    setMe(f: Fix | null): void;
    destroy(): void;
}

type Latest = { current: MapViewProps };

/** A press held still for 600 ms. */
function longPress(el: HTMLElement, fire: (x: number, y: number) => void): () => void {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let start: [number, number] | null = null;
    const down = (e: PointerEvent) => {
        if (!e.isPrimary) { clear(); return; }
        start = [e.clientX, e.clientY];
        const r = el.getBoundingClientRect();
        timer = setTimeout(() => { if (start) fire(start[0] - r.left, start[1] - r.top); start = null; }, 600);
    };
    const move = (e: PointerEvent) => { if (start && Math.hypot(e.clientX - start[0], e.clientY - start[1]) > 8) clear(); };
    const clear = () => { if (timer) clearTimeout(timer); timer = undefined; start = null; };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", clear);
    el.addEventListener("pointercancel", clear);
    el.addEventListener("contextmenu", (e) => e.preventDefault());
    return () => {
        clear();
        el.removeEventListener("pointerdown", down);
        el.removeEventListener("pointermove", move);
        el.removeEventListener("pointerup", clear);
        el.removeEventListener("pointercancel", clear);
    };
}

function vectorImpl(el: HTMLElement, latest: Latest, cam: Camera): Impl {
    registerProtocol();
    const p = latest.current.providers;
    const style = p.tiles.kind === "style" && p.tiles.styleUrl ? p.tiles.styleUrl : phoenixStyle({ attribution: p.tiles.attribution });
    const map = new maplibre.Map({
        container: el, style, center: cam.center, zoom: cam.zoom, bearing: cam.bearing,
        attributionControl: false, maxZoom: 19, fadeDuration: 0, pitchWithRotate: true,
        // Keep the drawing buffer so screenshots and tests can read the canvas.
        canvasContextAttributes: { preserveDrawingBuffer: true },
    });
    (window as unknown as { __phoenixMap?: maplibre.Map }).__phoenixMap = map;
    let markers: maplibre.Marker[] = [];
    let me: maplibre.Marker | null = null;
    let route: LngLat[] | null = null;
    // Set once the style has loaded. isStyleLoaded() and loaded() also go
    // false while tiles load (after every fitBounds), which would drop a
    // route set in that window; sources and layers can be added then.
    let styleReady = false;
    const addRoute = () => {
        if (!styleReady) return;
        const data = { type: "Feature" as const, properties: {}, geometry: { type: "LineString" as const, coordinates: route ?? [] } };
        const src = map.getSource(ROUTE_SOURCE) as maplibre.GeoJSONSource | undefined;
        if (src) { src.setData(data); return; }
        map.addSource(ROUTE_SOURCE, { type: "geojson", data });
        const before = map.getLayer("road-name") ? "road-name" : undefined;
        map.addLayer({ id: "route-casing", type: "line", source: ROUTE_SOURCE, layout: { "line-cap": "round", "line-join": "round" },
                       paint: { "line-color": COLORS.routeCasing, "line-width": ["interpolate", ["linear"], ["zoom"], 10, 5, 18, 14] } }, before);
        map.addLayer({ id: "route", type: "line", source: ROUTE_SOURCE, layout: { "line-cap": "round", "line-join": "round" },
                       paint: { "line-color": COLORS.route, "line-width": ["interpolate", ["linear"], ["zoom"], 10, 3, 18, 10] } }, before);
    };
    map.on("load", () => { styleReady = true; addRoute(); el.dataset.ready = "1"; });
    map.on("idle", () => { el.dataset.idle = String(Date.now()); });
    map.on("moveend", () => latest.current.onMove?.(camera()));
    const camera = (): Camera => ({ center: map.getCenter().toArray() as LngLat, zoom: map.getZoom(), bearing: map.getBearing() });
    const stopLong = longPress(el, (x, y) => latest.current.onLongPress?.(map.unproject([x, y]).toArray() as LngLat));
    return {
        renderer: "vector",
        flyTo: (c, z) => map.flyTo({ center: c, zoom: z ?? Math.max(map.getZoom(), 15), duration: 600 }),
        fitBounds: (b, padding) => map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding, duration: 600, maxZoom: 17 }),
        camera,
        bounds: () => { const b = map.getBounds(); return [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]; },
        resetNorth: () => map.easeTo({ bearing: 0, pitch: 0, duration: 400 }),
        follow: (f, heading) => map.easeTo({ center: [f.lon, f.lat], zoom: Math.max(map.getZoom(), 16.5),
                                             bearing: heading && f.heading >= 0 ? f.heading : map.getBearing(), pitch: heading ? 45 : 0, duration: 800 }),
        setMarkers(list) {
            markers.forEach((m) => m.remove());
            markers = list.map((m) => new maplibre.Marker({ element: markerElement(m, latest.current.onMarkerTap), anchor: "bottom" })
                .setLngLat([m.lon, m.lat]).addTo(map));
        },
        setRoute(r) {
            route = r;
            addRoute();
        },
        setMe(f) {
            if (!f) { me?.remove(); me = null; return; }
            if (!me) me = new maplibre.Marker({ element: meElement(), rotationAlignment: "map" }).setLngLat([f.lon, f.lat]).addTo(map);
            me.setLngLat([f.lon, f.lat]);
            me.getElement().classList.toggle("has-heading", f.heading >= 0);
            if (f.heading >= 0) me.setRotation(f.heading);
        },
        destroy() { stopLong(); map.remove(); },
    };
}

function canvasImpl(el: HTMLElement, latest: Latest, cam: Camera): Impl {
    const p = latest.current.providers;
    const map = L.map(el, { zoomControl: false, attributionControl: false, center: [cam.center[1], cam.center[0]], zoom: Math.round(cam.zoom),
                            maxZoom: 19, zoomSnap: 0.5 });
    const layer = p.tiles.rasterUrl
        ? L.tileLayer(p.tiles.rasterUrl, { maxZoom: 19 })
        : vectorCanvasLayer((z, x, y) => getTile(latest.current.providers, z, x, y), p.tiles.attribution);
    layer.addTo(map);
    layer.on("load", () => { el.dataset.ready = "1"; el.dataset.idle = String(Date.now()); });
    let markers: L.Marker[] = [];
    let me: L.Marker | null = null;
    let line: L.Polyline[] = [];
    const camera = (): Camera => { const c = map.getCenter(); return { center: [c.lng, c.lat], zoom: map.getZoom(), bearing: 0 }; };
    map.on("moveend", () => latest.current.onMove?.(camera()));
    const stopLong = longPress(el, (x, y) => { const q = map.containerPointToLatLng([x, y]); latest.current.onLongPress?.([q.lng, q.lat]); });
    const icon = (e: HTMLElement) => L.divIcon({ html: e, className: "mp-leaflet-icon", iconSize: [0, 0] });
    // Leaflet does not notice its box changing size (the side panel).
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(() => map.invalidateSize()) : null;
    ro?.observe(el);
    return {
        renderer: "canvas",
        flyTo: (c, z) => map.flyTo([c[1], c[0]], z ?? Math.max(map.getZoom(), 15), { duration: 0.6 }),
        fitBounds: (b, padding) => map.fitBounds([[b[1], b[0]], [b[3], b[2]]], { padding: [padding, padding], maxZoom: 17 }),
        camera,
        bounds: () => { const b = map.getBounds(); return [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]; },
        resetNorth: () => {},
        follow: (f) => map.setView([f.lat, f.lon], Math.max(map.getZoom(), 16.5)),
        setMarkers(list) {
            markers.forEach((m) => m.remove());
            markers = list.map((m) => L.marker([m.lat, m.lon], { icon: icon(markerElement(m, latest.current.onMarkerTap)) }).addTo(map));
        },
        setRoute(r) {
            line.forEach((l) => l.remove());
            line = r ? [
                L.polyline(r.map(([x, y]) => [y, x] as [number, number]), { color: COLORS.routeCasing, weight: 9, opacity: 1 }).addTo(map),
                L.polyline(r.map(([x, y]) => [y, x] as [number, number]), { color: COLORS.route, weight: 6, opacity: 1 }).addTo(map),
            ] : [];
        },
        setMe(f) {
            if (!f) { me?.remove(); me = null; return; }
            if (!me) me = L.marker([f.lat, f.lon], { icon: icon(meElement()), interactive: false }).addTo(map);
            me.setLatLng([f.lat, f.lon]);
        },
        destroy() { ro?.disconnect(); stopLong(); map.remove(); },
    };
}
