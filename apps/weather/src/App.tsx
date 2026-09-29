// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Weather: forecasts from Open-Meteo for the places the user saves and,
// when allowed, where the device is. Palm never shipped a weather app
// (people used third-party ones from the App Catalog); this one is drawn
// like the other Phoenix apps in the webOS 2.x style, and it has no
// dashboard, banner or notification: it only shows what it is asked for.
//
// - Forecast: now (temperature, conditions, feels like, today's high and
//   low, wind, humidity, sunrise and sunset), the next 24 hours in a strip,
//   and 7 days.
// - Places: "Current Location" (com.webos.service.location, once per
//   start; off in Preferences) and cities found with Open-Meteo's search,
//   in the user's order. Edit to reorder or remove.
// - Offline: the last forecast of each place is kept (localStorage) and
//   shown with the time it is from when the service can't be reached.
//   Forecasts are fetched again when older than 30 minutes, or on Refresh.
// - Units follow the system region (Settings > Language & Region) unless
//   set in Preferences; hours follow the system clock (12/24 hour).
// - Tablet cards show the places at the left and the forecast at the
//   right; phone cards one at a time (the back gesture goes back).
//
// Privacy: see lib/openmeteo.ts; the app menu's "About Weather Data" says
// the same to the user.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { location as locationService, settings, system, type LocaleInfo } from "@phoenix/luna";
import { useLuna } from "@phoenix/luna/react";
import {
    AppMenu, BackProvider, Button, cx, Dialog, Divider, ErrorText, Glyph, Group, IconToolButton, ListSelector, Note, PageHeader, Row, Spinner,
    TextField, ToggleButton, Toolbar, ToolSpacer, useBack,
} from "@phoenix/ui";
import { describe as describeCode, isNightSky } from "./lib/codes";
import {
    ATTRIBUTION_URL, DEFAULT_SERVER, fetchForecast, placeLine, searchPlaces, WeatherError, type Forecast, type Place,
} from "./lib/openmeteo";
import { addPlace, CURRENT_ID, freshness, load, movePlace, removePlace, save, type Prefs, type State } from "./lib/store";
import { compass, dayLabel, hourLabel, safeLocale, temp, unitsFor, wind, type Units, type UnitsPref } from "./lib/units";
import { WeatherIcon } from "./WeatherIcon";

type Clock = "HH12" | "HH24";

function useWide(): boolean {
    const [wide, setWide] = useState(() => window.innerWidth >= 600);
    useEffect(() => {
        const on = () => setWide(window.innerWidth >= 600);
        window.addEventListener("resize", on);
        return () => window.removeEventListener("resize", on);
    }, []);
    return wide;
}

/** "4:05 PM" / "16:05" on this device's clock, or a date when it was not today. */
function whenText(ms: number, clock: Clock, now: number, locale: string): string {
    const d = new Date(ms);
    const time = new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit", hour12: clock === "HH12" }).format(d);
    if (new Date(now).toDateString() === d.toDateString()) return time;
    return `${new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" }).format(d)} ${time}`;
}

function Sky({ code, isDay, size, className }: { code: number; isDay: boolean; size: number; className?: string }) {
    const { sky } = describeCode(code);
    return <WeatherIcon sky={sky} night={isNightSky(sky, isDay)} size={size} className={className} />;
}

// ---- The forecast ---------------------------------------------------------------------------

function ForecastView({ place, forecast, status, units, clock, locale, now, onRetry }: {
    place: Place; forecast: Forecast | undefined; status: Status | undefined; units: Units; clock: Clock; locale: string; now: number;
    onRetry: () => void;
}) {
    if (!forecast) {
        return (
            <div className="wx-empty" data-testid="forecast-empty">
                {status?.loading && <Spinner large />}
                {status?.error && <>
                    <ErrorText>{status.error}</ErrorText>
                    <Button onClick={onRetry} data-testid="retry">Try Again</Button>
                </>}
            </div>
        );
    }
    const c = forecast.current;
    const today = forecast.daily[0];
    const d = describeCode(c.code);
    const fresh = freshness(forecast, now);
    const maxT = Math.max(...forecast.daily.map((x) => x.max));
    const minT = Math.min(...forecast.daily.map((x) => x.min));
    return (
        <div className="wx-forecast" data-testid="forecast">
            {status?.error && (
                <div className="wx-notice" data-testid="notice">
                    {status.offline ? "Offline." : `Not updated: ${status.error}`} Forecast from {whenText(forecast.fetchedAt, clock, now, locale)}.
                </div>
            )}
            <div className={cx("wx-now", c.isDay ? "day" : "night", d.sky)} data-testid="now">
                <div className="wx-now-main">
                    <Sky code={c.code} isDay={c.isDay} size={96} className="wx-now-icon" />
                    <div className="wx-now-temp" data-testid="now-temp">{temp(c.temp, units)}</div>
                </div>
                <div className="wx-now-text" data-testid="now-text">{d.text}</div>
                <div className="wx-now-sub">
                    Feels like {temp(c.feels, units)}{today && <> &middot; H {temp(today.max, units)} L {temp(today.min, units)}</>}
                </div>
            </div>
            <div className="wx-details" data-testid="details">
                <div><span>Wind</span><b data-testid="wind">{wind(c.wind, units)} {compass(c.windDir)}</b></div>
                <div><span>Humidity</span><b>{Math.round(c.humidity)}%</b></div>
                {today?.sunrise && <div><span>Sunrise</span><b>{hourLabel(today.sunrise, clock)}</b></div>}
                {today?.sunset && <div><span>Sunset</span><b>{hourLabel(today.sunset, clock)}</b></div>}
            </div>

            <Divider caption="Next 24 Hours" />
            <div className="wx-hours" data-testid="hours">
                {forecast.hourly.map((h, i) => (
                    <div key={h.time} className="wx-hour">
                        <div className="wx-hour-time">{i === 0 ? "Now" : hourLabel(h.time, clock)}</div>
                        <Sky code={h.code} isDay={h.isDay} size={34} />
                        <div className="wx-hour-temp">{temp(h.temp, units)}</div>
                        <div className="wx-hour-pop">{h.precipProb >= 20 ? `${Math.round(h.precipProb)}%` : " "}</div>
                    </div>
                ))}
            </div>

            <Divider caption="7 Days" />
            <Group className="wx-days">
                <div data-testid="days">
                    {forecast.daily.map((day) => {
                        const span = maxT - minT || 1;
                        return (
                            <div key={day.date} className="pui-row wx-day" data-testid={`day-${day.date}`}>
                                <div className="wx-day-name">{dayLabel(day.date, forecast.daily[0].date, locale)}</div>
                                <Sky code={day.code} isDay size={30} className="wx-day-icon" />
                                <div className="wx-day-pop">{day.precipProb >= 20 ? `${Math.round(day.precipProb)}%` : ""}</div>
                                <div className="wx-day-lo">{temp(day.min, units)}</div>
                                <div className="wx-day-bar"><span style={{
                                    left: `${((day.min - minT) / span) * 100}%`, right: `${((maxT - day.max) / span) * 100}%`,
                                }} /></div>
                                <div className="wx-day-hi">{temp(day.max, units)}</div>
                            </div>
                        );
                    })}
                </div>
            </Group>

            <div className="wx-footer">
                <div data-testid="updated">
                    Updated {whenText(forecast.fetchedAt, clock, now, locale)}
                    {status?.loading && <Spinner />}
                </div>
                {fresh === "expired" && <div className="wx-expired">This forecast is out of date.</div>}
                <a href={ATTRIBUTION_URL} target="_blank" rel="noreferrer" data-testid="attribution">Weather data by Open-Meteo.com</a>
            </div>
            <span hidden data-testid="place-name">{place.name}</span>
        </div>
    );
}

// ---- Places --------------------------------------------------------------------------------

function PlacesView({ places, selected, cache, units, editing, language, locating, locationNote, onSelect, onAdd, onRemove, onMove }: {
    places: Place[]; selected: string | null; cache: Record<string, Forecast>; units: Units; editing: boolean; language: string;
    locating: boolean; locationNote: string;
    onSelect: (id: string) => void; onAdd: (p: Place) => void; onRemove: (id: string) => void; onMove: (id: string, by: -1 | 1) => void;
}) {
    const [query, setQuery] = useState("");
    const [results, setResults] = useState<Place[] | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const search = async () => {
        const q = query.trim();
        if (!q) { setResults(null); return; }
        setBusy(true);
        setError("");
        try {
            setResults(await searchPlaces(q, { language }));
        } catch (e) {
            setResults(null);
            setError(e instanceof WeatherError ? e.message : String(e));
        } finally {
            setBusy(false);
        }
    };
    useBack(() => { setQuery(""); setResults(null); return true; }, results !== null);

    return (
        <div className="wx-places" data-testid="places">
            <div className="wx-search">
                <TextField value={query} onChange={(v) => { setQuery(v); if (!v.trim()) setResults(null); }} onSubmit={search}
                           placeholder="Add a city" testId="search" />
                <Button className="wx-search-go" onClick={search} disabled={!query.trim() || busy} data-testid="search-go">
                    {busy ? <Spinner /> : "Search"}
                </Button>
            </div>
            {error && <ErrorText>{error}</ErrorText>}
            {results && (
                <>
                    <Divider caption="Results" />
                    <Group>
                        {results.length === 0 && <Row title={`No places called "${query.trim()}"`} />}
                        {results.map((r) => (
                            <Row key={r.id} title={r.name} subtitle={placeLine(r)} testId={`result-${r.name}-${r.admin ?? ""}`}
                                 onClick={() => { onAdd(r); setQuery(""); setResults(null); }} />
                        ))}
                    </Group>
                </>
            )}
            <Divider caption="Places" />
            {places.length === 0 && !locating && (
                <Note>{locationNote || "Search for a city to see its weather."}</Note>
            )}
            <Group>
                {locating && !places.some((p) => p.id === CURRENT_ID) && (
                    <Row title="Current Location" subtitle="Finding where you are…"><Spinner /></Row>
                )}
                {places.map((p, i) => {
                    const f = cache[p.id];
                    return (
                        <Row key={p.id} testId={`place-${p.name}`}
                             className={cx("wx-place", p.id === selected && "current")}
                             icon={p.id === CURRENT_ID ? <Glyph name="location" size={20} className="wx-loc-glyph" /> : undefined}
                             title={p.name} subtitle={p.id === CURRENT_ID ? (f ? describeCode(f.current.code).text : undefined) : placeLine(p)}
                             onClick={editing ? undefined : () => onSelect(p.id)}>
                            {editing ? (
                                <span className="wx-edit">
                                    <button type="button" aria-label={`Move ${p.name} up`} disabled={i === 0} onClick={() => onMove(p.id, -1)}>&#x25B2;</button>
                                    <button type="button" aria-label={`Move ${p.name} down`} disabled={i === places.length - 1} onClick={() => onMove(p.id, 1)}>&#x25BC;</button>
                                    <button type="button" className="wx-remove" aria-label={`Remove ${p.name}`} data-testid={`remove-${p.name}`}
                                            onClick={() => onRemove(p.id)}><Glyph name="close" size={16} /></button>
                                </span>
                            ) : f ? (
                                <span className="wx-place-now">
                                    <Sky code={f.current.code} isDay={f.current.isDay} size={30} />
                                    <span className="wx-place-temp">{temp(f.current.temp, units)}</span>
                                </span>
                            ) : null}
                        </Row>
                    );
                })}
            </Group>
        </div>
    );
}

// ---- Preferences and about -----------------------------------------------------------------

function PrefsDialog({ prefs, autoUnits, onChange, onClose }: { prefs: Prefs; autoUnits: Units; onChange: (p: Partial<Prefs>) => void; onClose: () => void }) {
    const [server, setServer] = useState(prefs.server);
    const valid = /^https?:\/\/\S+$/.test(server.trim());
    return (
        <Dialog open title="Preferences" onClose={onClose} testId="prefs-dialog">
            <div className="wx-prefs">
                <ListSelector<UnitsPref> title="Units" value={prefs.units} testId="pref-units" onChange={(units) => onChange({ units })} options={[
                    { label: `Automatic (${autoUnits.temp === "F" ? "°F" : "°C"}, ${autoUnits.wind === "mph" ? "mph" : "km/h"})`, value: "auto" },
                    { label: "Metric (°C, km/h)", value: "metric" },
                    { label: "Imperial (°F, mph)", value: "imperial" },
                ]} />
                <Row title="Use My Location">
                    <ToggleButton value={prefs.useLocation} onChange={(useLocation) => onChange({ useLocation })} label="Use My Location" testId="pref-location" />
                </Row>
            </div>
            <TextField label="Forecast server" value={server} onChange={setServer} testId="pref-server" />
            {!valid && <ErrorText>Enter an https:// address.</ErrorText>}
            <Button variant="affirmative" data-testid="prefs-done" onClick={() => {
                onChange({ server: valid ? server.trim().replace(/\/+$/, "") : prefs.server });
                onClose();
            }}>Done</Button>
            {prefs.server !== DEFAULT_SERVER && <Button onClick={() => setServer(DEFAULT_SERVER)}>Use Open-Meteo</Button>}
        </Dialog>
    );
}

function AboutDialog({ onClose }: { onClose: () => void }) {
    return (
        <Dialog open title="About Weather Data" onClose={onClose} testId="about-dialog">
            <div className="wx-about">
                <p>Forecasts come from <b>Open-Meteo.com</b> (data licensed CC BY 4.0), free for non-commercial use.</p>
                <p>To get a forecast, Weather sends Open-Meteo the place's coordinates rounded to about 1 km. To find a city it
                    sends the name you type. Your device's IP address is seen, as with any request; Open-Meteo says it keeps
                    server logs for 90 days and shares them with no one.</p>
                <p>No account, key or device identifier is sent. Your places and the last forecasts stay on this device.</p>
            </div>
            <Button onClick={onClose}>Done</Button>
        </Dialog>
    );
}

// ---- The app ---------------------------------------------------------------------------------

interface Status { loading?: boolean; error?: string; offline?: boolean }

function WeatherApp() {
    const wide = useWide();
    const [state, setState] = useState<State>(load);
    const [status, setStatus] = useState<Record<string, Status>>({});
    const [screen, setScreen] = useState<"places" | "forecast">(() => (load().places.length ? "forecast" : "places"));
    const [editing, setEditing] = useState(false);
    const [sheet, setSheet] = useState<"prefs" | "about" | null>(null);
    const [locating, setLocating] = useState(false);
    const [locationNote, setLocationNote] = useState("");
    const [now, setNow] = useState(() => Date.now());
    const inFlight = useRef(new Set<string>());
    const stateRef = useRef(state);
    stateRef.current = state;

    const localeInfo = useLuna<LocaleInfo | undefined>((cb, err) => settings.watch("", ["localeInfo"], (s) => cb(s.localeInfo), err), []).value;
    const clock = useLuna<Clock>((cb, err) => system.watchPreferences(["timeFormat"], (p) => cb(p.timeFormat === "HH24" ? "HH24" : "HH12"), err), [])
        .value ?? "HH12";
    const fmt = safeLocale(localeInfo?.locales?.FMT ?? localeInfo?.locales?.UI ?? navigator.language);
    const ui = localeInfo?.locales?.UI ?? "en-US";
    const units = useMemo(() => unitsFor(state.prefs.units, fmt), [state.prefs.units, fmt]);
    const autoUnits = useMemo(() => unitsFor("auto", fmt), [fmt]);

    const update = useCallback((f: (s: State) => State) => {
        setState((old) => { const n = f(old); save(n); return n; });
    }, []);

    const refresh = useCallback(async (p: Place, force = false) => {
        const cached = stateRef.current.cache[p.id];
        if (!force && freshness(cached, Date.now()) === "fresh") return;
        if (inFlight.current.has(p.id)) return;
        inFlight.current.add(p.id);
        setStatus((s) => ({ ...s, [p.id]: { loading: true } }));
        try {
            const f = await fetchForecast(p, { server: stateRef.current.prefs.server });
            update((s) => ({ ...s, cache: { ...s.cache, [p.id]: f } }));
            setStatus((s) => ({ ...s, [p.id]: {} }));
        } catch (e) {
            setStatus((s) => ({ ...s, [p.id]: { error: e instanceof Error ? e.message : String(e), offline: e instanceof WeatherError && e.kind === "offline" } }));
        } finally {
            inFlight.current.delete(p.id);
            setNow(Date.now());
        }
    }, [update]);

    // Where the device is, once per start (and when turned on in Preferences).
    useEffect(() => {
        if (!state.prefs.useLocation) {
            update((s) => ({ ...s, places: removePlace(s.places, CURRENT_ID), selected: s.selected === CURRENT_ID ? null : s.selected }));
            return;
        }
        let live = true;
        // First start (no places yet): show the forecast as soon as there is
        // a position. Later a fix can come seconds after the start (GPS), and
        // must not take the user away from where they have gone since.
        const firstStart = !stateRef.current.places.length;
        setLocating(true);
        locationService.currentPosition()
            .then((pos) => {
                if (!live) return;
                setLocationNote("");
                const here: Place = { id: CURRENT_ID, name: "Current Location", latitude: pos.latitude, longitude: pos.longitude };
                update((s) => {
                    const old = s.places.find((p) => p.id === CURRENT_ID);
                    const moved = old && (Math.abs(old.latitude - here.latitude) > 0.01 || Math.abs(old.longitude - here.longitude) > 0.01);
                    const cache = { ...s.cache };
                    if (moved) delete cache[CURRENT_ID];
                    const places = old ? s.places.map((p) => (p.id === CURRENT_ID ? here : p)) : addPlace(s.places, here);
                    return { ...s, places, cache, selected: s.selected ?? CURRENT_ID };
                });
                if (firstStart) setScreen((sc) => (sc === "places" ? "forecast" : sc));
            })
            .catch((e: { errorText?: string }) => {
                if (!live) return;
                setLocationNote(`Your location isn't available${e?.errorText ? ` (${e.errorText})` : ""}. Search for a city to see its weather.`);
            })
            .finally(() => { if (live) setLocating(false); });
        return () => { live = false; };
    }, [state.prefs.useLocation, update]);

    const selected = state.places.find((p) => p.id === state.selected) ?? state.places[0];

    // Fetch what is shown when it is stale, then the other places (for their rows).
    useEffect(() => {
        if (selected) void refresh(selected);
        const others = state.places.filter((p) => p.id !== selected?.id);
        let i = 0;
        const t = setInterval(() => { if (i < others.length) void refresh(others[i++]); else clearInterval(t); }, 400);
        return () => clearInterval(t);
    }, [selected?.id, selected?.latitude, state.places.length, state.prefs.server, refresh]);  // eslint-disable-line react-hooks/exhaustive-deps

    // Once a minute: the clock for "Updated", and a refresh when the forecast goes stale.
    useEffect(() => {
        const t = setInterval(() => {
            setNow(Date.now());
            const p = stateRef.current.places.find((x) => x.id === stateRef.current.selected) ?? stateRef.current.places[0];
            if (p && !document.hidden) void refresh(p);
        }, 60_000);
        return () => clearInterval(t);
    }, [refresh]);

    useBack(() => { setScreen("places"); return true; }, !wide && screen === "forecast" && state.places.length > 0);
    useBack(() => { setEditing(false); return true; }, editing);

    const choose = (id: string) => {
        update((s) => ({ ...s, selected: id }));
        setScreen("forecast");
    };
    const add = (p: Place) => {
        update((s) => {
            const places = addPlace(s.places, p);
            const existing = places.find((q) => q.id === p.id) ?? places.find((q) => Math.abs(q.latitude - p.latitude) < 0.01 && Math.abs(q.longitude - p.longitude) < 0.01);
            return { ...s, places, selected: existing?.id ?? p.id };
        });
        setScreen("forecast");
    };
    const remove = (id: string) => {
        update((s) => {
            const places = removePlace(s.places, id);
            const cache = { ...s.cache };
            delete cache[id];
            return { ...s, places, cache, selected: s.selected === id ? places[0]?.id ?? null : s.selected };
        });
        if (id === CURRENT_ID) update((s) => ({ ...s, prefs: { ...s.prefs, useLocation: false } }));
    };
    const setPrefs = (p: Partial<Prefs>) => update((s) => ({ ...s, prefs: { ...s.prefs, ...p } }));

    const menu = (
        <AppMenu items={[
            { label: "Preferences", onSelect: () => setSheet("prefs") },
            { label: "About Weather Data", onSelect: () => setSheet("about") },
        ]} />
    );

    const placesPane = (
        <nav className="wx-pane-places" aria-label="Places" data-testid="places-pane">
            <PageHeader icon="icon.png" title="Weather" />
            <div className="wx-scroll">
                <PlacesView places={state.places} selected={selected?.id ?? null} cache={state.cache} units={units} editing={editing}
                            language={ui.split("-")[0]} locating={locating} locationNote={locationNote}
                            onSelect={choose} onAdd={add} onRemove={remove} onMove={(id, by) => update((s) => ({ ...s, places: movePlace(s.places, id, by) }))} />
            </div>
            <Toolbar>
                <ToolSpacer />
                {state.places.length > 0 && (
                    <IconToolButton caption={editing ? "Done" : "Edit"} testId="edit" depressed={editing} onClick={() => setEditing(!editing)} />
                )}
            </Toolbar>
        </nav>
    );

    const forecastPane = selected ? (
        <div className="wx-pane-forecast" data-testid="forecast-pane">
            <PageHeader icon={wide ? undefined : "icon.png"} title={<span data-testid="title">{selected.name}</span>} />
            <div className="wx-scroll">
                <ForecastView place={selected} forecast={state.cache[selected.id]} status={status[selected.id]} units={units} clock={clock}
                              locale={fmt} now={now} onRetry={() => void refresh(selected, true)} />
            </div>
            <Toolbar>
                {!wide && <IconToolButton icon="list" label="Places" testId="to-places" onClick={() => setScreen("places")} />}
                <ToolSpacer />
                <IconToolButton icon="refresh" label="Refresh" testId="refresh" disabled={!!status[selected.id]?.loading}
                                onClick={() => void refresh(selected, true)} />
            </Toolbar>
        </div>
    ) : (
        <div className="wx-pane-forecast"><PageHeader title="Weather" /><div className="wx-empty">No place yet.</div></div>
    );

    return (
        <div className={cx("wx-app", wide ? "wide" : "narrow")}>
            {menu}
            {wide ? <>{placesPane}{forecastPane}</> : screen === "places" || !selected ? placesPane : forecastPane}
            {sheet === "prefs" && <PrefsDialog prefs={state.prefs} autoUnits={autoUnits} onChange={setPrefs} onClose={() => setSheet(null)} />}
            {sheet === "about" && <AboutDialog onClose={() => setSheet(null)} />}
        </div>
    );
}

export function App() {
    return (
        <BackProvider>
            <WeatherApp />
        </BackProvider>
    );
}
