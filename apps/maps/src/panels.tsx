// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Maps' panels: search results, the place card, directions with the turn
// list, and the navigation banner with the turn list, the turn coming up
// highlighted.

import { useEffect, useRef } from "react";
import { cx, Spinner } from "@phoenix/ui";
import { distance, formatCoords, formatDistance, formatDuration, type LngLat, type Units } from "./lib/geo";
import type { Route, TravelMode } from "./lib/route";
import type { Progress } from "./lib/nav";
import type { Place } from "./lib/search";
import { hoursText, type PlaceDetails } from "./lib/details";
import { MapGlyph, TurnArrow } from "./icons";

const KIND_LABEL: Record<Place["kind"], string> = {
    poi: "", street: "Street", address: "Address", place: "Place", coords: "Location", saved: "Saved place", contact: "Contact",
};

export function Results({ places, near, units, busy, note, onPick }: {
    places: readonly Place[]; near: LngLat | null; units: Units; busy: boolean; note?: string; onPick: (p: Place) => void;
}) {
    return (
        <div className="mp-results" data-testid="results">
            {busy && <div className="mp-busy"><Spinner /></div>}
            {note && <div className="mp-note" data-testid="results-note">{note}</div>}
            {!busy && places.length === 0 && <div className="mp-empty" data-testid="no-results">No places found.</div>}
            {places.map((p, i) => (
                <div key={p.id + i} className="pui-row tappable mp-result" role="button" tabIndex={0} data-testid="result" data-index={i}
                     onClick={() => onPick(p)} onKeyDown={(e) => { if (e.key === "Enter") onPick(p); }}>
                    <div className="mp-result-pin"><MapGlyph name="pin" size={22} /></div>
                    <div className="pui-row-body">
                        <div className="pui-row-title">{p.name}</div>
                        <div className="pui-row-subtitle">{[p.category ?? KIND_LABEL[p.kind], p.detail].filter(Boolean).join(" · ")}</div>
                    </div>
                    {near && <div className="mp-result-dist">{formatDistance(distance(near, [p.lon, p.lat]), units)}</div>}
                </div>
            ))}
        </div>
    );
}

export function PlaceCard({ place, details, saved, near, units, onDirections, onStart, onSave, onShare, onClose }: {
    place: Place; details?: PlaceDetails; saved: boolean; near: LngLat | null; units: Units;
    onDirections: () => void; onStart?: () => void; onSave: () => void; onShare: (anchor: HTMLElement) => void; onClose: () => void;
}) {
    return (
        <div className="mp-card" data-testid="place-card">
            <button type="button" className="mp-card-close" aria-label="Close" data-testid="place-close" onClick={onClose}>&times;</button>
            <div className="mp-card-title" data-testid="place-name">{place.name}</div>
            <div className="mp-card-detail" data-testid="place-detail">
                {[place.category ?? KIND_LABEL[place.kind], place.detail].filter(Boolean).join(" · ")}
            </div>
            {place.kind === "coords" && <div className="mp-card-coords" data-testid="place-coords">{formatCoords([place.lon, place.lat])}</div>}
            {near && <div className="mp-card-dist" data-testid="place-distance">{formatDistance(distance(near, [place.lon, place.lat]), units)} away</div>}
            {details?.hours && (
                <div className="mp-card-hours" data-testid="place-hours">
                    {details.openNow !== undefined && (
                        <span className={cx("mp-open", details.openNow ? "yes" : "no")} data-testid="place-open">{details.openNow ? "Open now" : "Closed now"}</span>
                    )}
                    <span>{hoursText(details.hours)}</span>
                </div>
            )}
            {(details?.phone || details?.website) && (
                <div className="mp-card-contact">
                    {details.phone && <a href={`tel:${details.phone.replace(/[^\d+]/g, "")}`} data-testid="place-phone">{details.phone}</a>}
                    {details.website && <a href={details.website} target="_blank" rel="noreferrer" data-testid="place-website">{details.website.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}</a>}
                </div>
            )}
            <div className="mp-card-actions">
                <button type="button" className="mp-action primary" data-testid="directions" onClick={onDirections}>
                    <MapGlyph name="directions" size={20} /> Directions
                </button>
                {onStart && <button type="button" className="mp-action go" data-testid="place-start" onClick={onStart}>Start</button>}
                <button type="button" className={cx("mp-action", saved && "on")} data-testid="save-place" onClick={onSave}
                        aria-pressed={saved}>
                    <svg width="18" height="18" viewBox="0 0 32 32" aria-hidden="true" fill={saved ? "#f2b51b" : "none"} stroke="currentColor" strokeWidth="2.5">
                        <path d="M16 3l3.9 8.2 9 1.1-6.6 6.2 1.7 8.9L16 23l-8 4.4 1.7-8.9-6.6-6.2 9-1.1z" strokeLinejoin="round" />
                    </svg>
                    {saved ? "Saved" : "Save"}
                </button>
                <button type="button" className="mp-action" data-testid="share" onClick={(e) => onShare(e.currentTarget)}>Share</button>
            </div>
        </div>
    );
}

const MODES: { value: TravelMode; label: string; glyph: "drive" | "walk" | "cycle" }[] = [
    { value: "drive", label: "Drive", glyph: "drive" },
    { value: "walk", label: "Walk", glyph: "walk" },
    { value: "cycle", label: "Cycle", glyph: "cycle" },
];

export function Directions({ fromLabel, toLabel, mode, route, busy, error, note, units, times, onMode, onSwap, onFrom, onStart, onStep, onClose }: {
    fromLabel: string; toLabel: string; mode: TravelMode; route: Route | null; busy: boolean; error?: string; note?: string; units: Units;
    /** Each travel mode's time (s), as far as known, shown on its button. */
    times?: Partial<Record<TravelMode, number>>;
    onMode: (m: TravelMode) => void; onSwap: () => void; onFrom: () => void; onStart: () => void; onStep: (i: number) => void; onClose: () => void;
}) {
    return (
        <div className="mp-directions" data-testid="directions-panel">
            <div className="mp-dir-head">
                <div className="mp-dir-ends">
                    <button type="button" className="mp-dir-end" data-testid="dir-from" onClick={onFrom}>
                        <span className="mp-dot start">A</span><span className="mp-dir-text">{fromLabel}</span>
                    </button>
                    <div className="mp-dir-end" data-testid="dir-to">
                        <span className="mp-dot end">B</span><span className="mp-dir-text">{toLabel}</span>
                    </div>
                </div>
                <button type="button" className="mp-icon-button" aria-label="Swap start and end" data-testid="dir-swap" onClick={onSwap}>
                    <MapGlyph name="swap" size={22} />
                </button>
                <button type="button" className="mp-card-close" aria-label="Close directions" data-testid="dir-close" onClick={onClose}>&times;</button>
            </div>
            <div className="mp-modes" role="radiogroup" aria-label="Travel mode">
                {MODES.map((m, i) => (
                    <button key={m.value} type="button" role="radio" aria-checked={mode === m.value} aria-label={m.label} data-testid={`mode-${m.value}`}
                            className={cx("pui-grouped-toolbutton", i === 0 ? "first" : i === MODES.length - 1 ? "last" : "middle", mode === m.value && "depressed")}
                            onClick={() => onMode(m.value)}>
                        <MapGlyph name={m.glyph} size={22} />{" "}
                        {/* Once known, each mode's time in place of its name (the glyph says which). */}
                        {times?.[m.value] !== undefined
                            ? <span className="mp-mode-time" data-testid={`mode-time-${m.value}`}>{formatDuration(times[m.value]!)}</span>
                            : <span>{m.label}</span>}
                    </button>
                ))}
            </div>
            {busy && <div className="mp-busy"><Spinner /></div>}
            {error && <div className="mp-error" data-testid="route-error">{error}</div>}
            {route && !busy && (
                <>
                    <div className="mp-summary" data-testid="route-summary">
                        <div>
                            <span className="mp-summary-time">{formatDuration(route.duration)}</span>
                            <span className="mp-summary-dist">{formatDistance(route.distance, units)}</span>
                        </div>
                        <button type="button" className="mp-action primary" data-testid="start-nav" onClick={onStart}>Start</button>
                    </div>
                    {note && <div className="mp-note" data-testid="route-note">{note}</div>}
                    <ol className="mp-steps" data-testid="steps">
                        {route.steps.map((s, i) => (
                            <li key={i} className="mp-step" data-testid="step" onClick={() => onStep(i)}>
                                <span className="mp-step-arrow"><TurnArrow step={s} size={26} /></span>
                                <span className="mp-step-text">{s.instruction}</span>
                                {s.distance > 0 && <span className="mp-step-dist">{formatDistance(s.distance, units)}</span>}
                            </li>
                        ))}
                    </ol>
                    <div className="mp-credit">Directions: {route.provider === "Offline" ? "offline, from OpenStreetMap data" : route.provider}</div>
                </>
            )}
        </div>
    );
}

export function NavBanner({ route, progress, units, voice, onVoice, onEnd, onOverview, onSteps, stepsShown }: {
    route: Route; progress: Progress; units: Units; voice: boolean; onVoice: () => void; onEnd: () => void; onOverview: () => void;
    /** The phone's button that shows the turn list (a tablet always shows it). */
    onSteps?: () => void; stepsShown?: boolean;
}) {
    const next = route.steps[progress.step + 1] ?? route.steps[route.steps.length - 1];
    const eta = new Date(Date.now() + progress.remainingTime * 1000);
    return (
        <>
            <div className={cx("mp-nav-banner", progress.offRoute && "off")} data-testid="nav-banner">
                <div className="mp-nav-arrow"><TurnArrow step={progress.arrived ? { kind: "arrive" } : next} size={44} /></div>
                <div className="mp-nav-body">
                    <div className="mp-nav-dist" data-testid="nav-distance">
                        {progress.arrived ? "Arrived" : progress.offRoute ? "Rerouting…" : formatDistance(progress.toNext, units)}
                    </div>
                    <div className="mp-nav-text" data-testid="nav-instruction">
                        {progress.arrived ? "You have arrived at your destination" : next.instruction}
                    </div>
                </div>
            </div>
            <div className="mp-nav-bottom" data-testid="nav-bottom">
                <button type="button" className="mp-icon-button" aria-label={voice ? "Mute directions" : "Speak directions"} data-testid="nav-voice"
                        aria-pressed={voice} onClick={onVoice}>
                    <MapGlyph name={voice ? "speaker" : "mute"} size={24} />
                </button>
                {onSteps && (
                    <button type="button" className="mp-action" data-testid="nav-steps-button" aria-pressed={!!stepsShown} onClick={onSteps}>Steps</button>
                )}
                <div className="mp-nav-eta" onClick={onOverview}>
                    <span className="mp-nav-eta-time">{eta.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
                    <span className="mp-nav-eta-rest">{formatDuration(progress.remainingTime)}{" · "}{formatDistance(progress.remaining, units)}</span>
                </div>
                <button type="button" className="mp-action negative" data-testid="nav-end" onClick={onEnd}>End</button>
            </div>
        </>
    );
}

/** While navigating: every turn, the one coming up highlighted and kept in view, the ones done dimmed. */
export function NavSteps({ route, progress, units, onStep }: { route: Route; progress: Progress; units: Units; onStep: (i: number) => void }) {
    const next = progress.arrived ? route.steps.length - 1 : Math.min(progress.step + 1, route.steps.length - 1);
    const list = useRef<HTMLOListElement>(null);
    useEffect(() => {
        const el = list.current?.querySelector<HTMLElement>(".mp-step.current");
        if (el && typeof el.scrollIntoView === "function") el.scrollIntoView({ block: "nearest" });
    }, [next]);
    return (
        <div className="mp-directions mp-nav-steps" data-testid="nav-steps">
            <ol className="mp-steps" ref={list}>
                {route.steps.map((s, i) => (
                    <li key={i} className={cx("mp-step", i === next && "current", i < next && "done")} data-testid="nav-step"
                        aria-current={i === next ? "step" : undefined} onClick={() => onStep(i)}>
                        <span className="mp-step-arrow"><TurnArrow step={s} size={26} /></span>
                        <span className="mp-step-text">{s.instruction}</span>
                        {i === next && !progress.arrived ? <span className="mp-step-dist">{formatDistance(progress.toNext, units)}</span>
                            : s.distance > 0 && <span className="mp-step-dist">{formatDistance(s.distance, units)}</span>}
                    </li>
                ))}
            </ol>
        </div>
    );
}
