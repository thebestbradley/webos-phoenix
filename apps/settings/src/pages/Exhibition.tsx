// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Exhibition: dock mode on the Touchstone (webOS 3.0's Exhibition
// preferences, com.palm.app.exhibitionpreferences, as a Settings pane).
// Whether the device shows an exhibition on the Touchstone and when it
// starts; which exhibitions dock mode's menu offers after the built-in Time
// clocks (at most three, in the order set here); their sounds; night mode;
// and dock mode's own wallpaper.
// Services:
//   com.palm.applicationManager listDockModeLaunchPoints {subscribe},
//       setDockModeLaunchPoints {appIds} (add / removeDockModeLaunchPoint)
//   com.webos.service.systemservice get/setPreferences
//       exhibition {enabled, startAfter, nightMode, nightStart, nightEnd} (Phoenix),
//       dockModeSoundPref, dockwallpaper (luna-sysmgr's keys)

import { useState } from "react";
import { DOCK_MODE_MAX_APPS, dockMode, system, type DockModeLaunchPoint, type ExhibitionPrefs, type SystemPreferences } from "@phoenix/luna";
import { useLuna } from "@phoenix/luna/react";
import { CheckBox, Checkmark, Group, ListSelector, Note, Page, PageHeader, Row, ToggleButton } from "@phoenix/ui";
import { useBack } from "../nav";
import { WALLPAPERS } from "./Screen";

const APP_DIR = "/usr/palm/applications/org.webosphoenix.settings/";

export const START_AFTER = [
    { label: "When the screen turns off", value: 0 },
    { label: "After 30 seconds", value: 30 },
    { label: "After 1 minute", value: 60 },
    { label: "After 2 minutes", value: 120 },
    { label: "After 5 minutes", value: 300 },
];

export const SOUNDS = [
    { label: "As set in Sounds", value: "systemsettings" as const },
    { label: "Silent", value: "mute" as const },
];

/** "HH:MM" every half hour, shown in the clock's format. */
function timeOptions(twentyFour: boolean) {
    const out: { label: string; value: string }[] = [];
    for (let m = 0; m < 24 * 60; m += 30) {
        const h = Math.floor(m / 60), mm = m % 60;
        const value = `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
        const label = twentyFour ? value : `${h % 12 === 0 ? 12 : h % 12}:${String(mm).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
        out.push({ label, value });
    }
    return out;
}

const DEFAULTS: ExhibitionPrefs = { enabled: true, startAfter: 0, nightMode: false, nightStart: "22:00", nightEnd: "07:00" };

const PREF_KEYS: (keyof SystemPreferences)[] = ["exhibition", "dockModeSoundPref", "dockwallpaper", "timeFormat"];

/** Move an id one place up (-1) or down (1) in the list. */
export function moved(list: string[], id: string, by: -1 | 1): string[] {
    const i = list.indexOf(id), j = i + by;
    if (i < 0 || j < 0 || j >= list.length) return list;
    const out = list.slice();
    [out[i], out[j]] = [out[j], out[i]];
    return out;
}

export function ExhibitionPage() {
    const prefs = useLuna<SystemPreferences>((cb, err) => system.watchPreferences(PREF_KEYS, cb, err), []).value ?? {};
    const points = useLuna<DockModeLaunchPoint[]>((cb, err) => dockMode.watchLaunchPoints((p) => cb(p), err), []).value;
    const [picking, setPicking] = useState(false);
    useBack(() => { setPicking(false); return true; }, picking);

    const ex: ExhibitionPrefs = { ...DEFAULTS, ...(prefs.exhibition ?? {}) };
    const setEx = (changes: Partial<ExhibitionPrefs>) => void system.setPreferences({ exhibition: { ...ex, ...changes } });
    const twentyFour = prefs.timeFormat === "HH24";
    const times = timeOptions(twentyFour);

    // The ones on, in the menu's order (the service's list is in install
    // order; the order on comes from setDockModeLaunchPoints).
    const [order, setOrder] = useState<string[] | null>(null);
    const on = (points ?? []).filter((p) => p.enabled).map((p) => p.id);
    const enabled = order && order.length === on.length && order.every((id) => on.includes(id)) ? order : on;
    const apply = (ids: string[]) => {
        setOrder(ids);
        void dockMode.setEnabled(ids);
    };

    const wallpaper = WALLPAPERS.find((w) => prefs.dockwallpaper?.wallpaperFile === APP_DIR + w.file) ?? null;

    if (picking) {
        return (
            <Page>
                <PageHeader title="Exhibition Wallpaper" icon="icons/exhibition.png" />
                <div className="wallpaper-grid">
                    {[{ name: "None", file: "", thumb: "" }, ...WALLPAPERS].map((w) => {
                        const chosen = w.file ? wallpaper === w : !wallpaper;
                        return (
                            <button key={w.name} type="button" className={"wallpaper-tile" + (chosen ? " selected" : "")}
                                    data-testid={`dock-wallpaper-${w.name}`}
                                    onClick={() => {
                                        void system.setPreferences({ dockwallpaper: { wallpaperName: w.file ? w.name : "", wallpaperFile: w.file ? APP_DIR + w.file : "" } });
                                        setPicking(false);
                                    }}>
                                <span className={"wallpaper-thumb" + (w.file ? "" : " none")}
                                      style={w.file ? { backgroundImage: `url(${w.thumb})` } : undefined} />
                                <span className="wallpaper-name">{w.name}</span>
                                {chosen && <Checkmark />}
                            </button>
                        );
                    })}
                </div>
            </Page>
        );
    }

    const byId = new Map((points ?? []).map((p) => [p.id, p]));
    const rows = [...enabled.map((id) => byId.get(id)).filter((p): p is DockModeLaunchPoint => !!p),
                  ...(points ?? []).filter((p) => !p.enabled)];
    const full = enabled.length >= DOCK_MODE_MAX_APPS;

    return (
        <Page>
            <PageHeader title="Exhibition" icon="icons/exhibition.png" />

            <Group label="On the Touchstone">
                <Row title="Exhibition" subtitle="Show an exhibition while charging" testId="exhibition-enabled">
                    <ToggleButton value={ex.enabled} label="Exhibition" onChange={(v) => setEx({ enabled: v })} />
                </Row>
                {ex.enabled && (
                    <ListSelector title="Start" value={ex.startAfter} options={START_AFTER}
                                  onChange={(v) => setEx({ startAfter: v })} testId="exhibition-start" />
                )}
            </Group>

            {ex.enabled && (
                <>
                    <Group label="Exhibitions">
                        <Row title="Time" subtitle="Built in" icon={<img className="exhibition-app-icon" src="icons/exhibition-time.png" alt=""
                                       srcSet="icons/exhibition-time@2x.png 2x, icons/exhibition-time@3x.png 3x" />}
                             testId="exhibition-app-time">
                            <CheckBox checked disabled label="Time" />
                        </Row>
                        {rows.map((p) => {
                            const i = enabled.indexOf(p.id);
                            return (
                                <Row key={p.id} title={p.exhibitionModeTitle} subtitle={p.title !== p.exhibitionModeTitle ? p.title : undefined}
                                     icon={<img className="exhibition-app-icon" src={p.icon} alt="" />}
                                     testId={`exhibition-app-${p.id}`}>
                                    {i >= 0 && (
                                        <span className="exhibition-order">
                                            <button type="button" className="exhibition-move up" aria-label={`Move ${p.exhibitionModeTitle} up`}
                                                    disabled={i === 0} data-testid={`exhibition-up-${p.id}`}
                                                    onClick={() => apply(moved(enabled, p.id, -1))} />
                                            <button type="button" className="exhibition-move down" aria-label={`Move ${p.exhibitionModeTitle} down`}
                                                    disabled={i === enabled.length - 1} data-testid={`exhibition-down-${p.id}`}
                                                    onClick={() => apply(moved(enabled, p.id, 1))} />
                                        </span>
                                    )}
                                    <CheckBox checked={i >= 0} disabled={i < 0 && full} label={p.exhibitionModeTitle}
                                              testId={`exhibition-check-${p.id}`}
                                              onChange={(c) => apply(c ? [...enabled, p.id] : enabled.filter((id) => id !== p.id))} />
                                </Row>
                            );
                        })}
                        {points && points.length === 0 && <Note>No other app can be an exhibition yet.</Note>}
                        {full && <Note>Up to {DOCK_MODE_MAX_APPS} exhibitions besides Time. Turn one off to choose another.</Note>}
                    </Group>

                    <Group label="Sounds">
                        <ListSelector<"systemsettings" | "mute"> title="Notifications" value={prefs.dockModeSoundPref === "mute" ? "mute" : "systemsettings"}
                                      options={SOUNDS} onChange={(v) => void system.setPreferences({ dockModeSoundPref: v })}
                                      testId="exhibition-sounds" />
                    </Group>

                    <Group label="Night mode">
                        <Row title="Night mode" subtitle="The screen at its dimmest" testId="exhibition-night">
                            <ToggleButton value={ex.nightMode} label="Night mode" onChange={(v) => setEx({ nightMode: v })} />
                        </Row>
                        {ex.nightMode && (
                            <>
                                <ListSelector title="From" value={ex.nightStart} options={times}
                                              onChange={(v) => setEx({ nightStart: v })} testId="exhibition-night-start" />
                                <ListSelector title="Until" value={ex.nightEnd} options={times}
                                              onChange={(v) => setEx({ nightEnd: v })} testId="exhibition-night-end" />
                            </>
                        )}
                    </Group>

                    <Group label="Wallpaper">
                        <Row title={wallpaper ? wallpaper.name : "None"} chevron onClick={() => setPicking(true)} testId="exhibition-wallpaper"
                             icon={<span className={"wallpaper-mini" + (wallpaper ? "" : " none")}
                                         style={wallpaper ? { backgroundImage: `url(${wallpaper.thumb})` } : undefined} />} />
                    </Group>
                </>
            )}
        </Page>
    );
}

