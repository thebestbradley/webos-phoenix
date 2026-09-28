// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Date & Time: 12/24-hour clock, network time, time zone, manual date and time.
// Services: com.webos.service.systemservice get/setPreferences (timeFormat,
// useNetworkTime, useNetworkTimeZone, timeZone), getPreferenceValues
// {key:"timeZone"}, time/getSystemTime, time/setSystemTime.

import { useEffect, useMemo, useState } from "react";
import { system, type SystemPreferences, type SystemTime, type TimeZone } from "@phoenix/luna";
import { useLuna } from "@phoenix/luna/react";
import { Button, Checkmark, Group, ListSelector, Note, Page, PageHeader, Picker, Row, TextField, ToggleButton } from "@phoenix/ui";
import { useBack } from "../nav";

const KEYS: (keyof SystemPreferences)[] = ["timeFormat", "useNetworkTime", "useNetworkTimeZone", "timeZone"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function pad(n: number) { return n < 10 ? "0" + n : String(n); }

function offsetText(minutes: number | undefined) {
    if (minutes === undefined) return "";
    const s = minutes < 0 ? "-" : "+";
    const m = Math.abs(minutes);
    return `GMT${s}${Math.floor(m / 60)}:${pad(m % 60)}`;
}

/** The device clock, refreshed every second. */
function useSystemTime(): SystemTime | undefined {
    const [t, setT] = useState<SystemTime>();
    useEffect(() => {
        let alive = true;
        const tick = () => system.systemTime().then((x) => { if (alive) setT(x); }).catch(() => {});
        void tick();
        const id = setInterval(tick, 1000);
        return () => { alive = false; clearInterval(id); };
    }, []);
    return t;
}

export function DateTimePage() {
    const prefs = useLuna<SystemPreferences>((cb, err) => system.watchPreferences(KEYS, cb, err), []).value;
    const time = useSystemTime();
    const [zones, setZones] = useState<TimeZone[] | null>(null);
    const [choosingZone, setChoosingZone] = useState(false);
    const [edit, setEdit] = useState<{ y: number; mo: number; d: number; h: number; mi: number } | null>(null);
    useBack(() => { setChoosingZone(false); return true; }, choosingZone);

    useEffect(() => {
        system.timeZones().then(setZones).catch(() => setZones([]));
    }, []);

    const h24 = prefs?.timeFormat === "HH24";
    const network = prefs?.useNetworkTime !== false;
    const lt = time?.localtime;
    const shown = edit ?? (lt ? { y: lt.year, mo: lt.month, d: lt.day, h: lt.hour, mi: lt.minute } : null);

    const set = (p: SystemPreferences) => void system.setPreferences(p);

    if (choosingZone) {
        return <ZonePicker zones={zones ?? []} current={prefs?.timeZone?.ZoneID}
                           onPick={(z) => { set({ timeZone: z, useNetworkTimeZone: false }); setChoosingZone(false); }} />;
    }

    const clock = lt ? (h24 ? `${pad(lt.hour)}:${pad(lt.minute)}` : `${lt.hour % 12 || 12}:${pad(lt.minute)} ${lt.hour < 12 ? "AM" : "PM"}`) : "";
    const zone = prefs?.timeZone;

    return (
        <Page>
            <PageHeader title="Date & Time" icon="icons/datetime.png" />
            <div className="datetime-now" data-testid="clock">
                <div className="datetime-clock">{clock}</div>
                <div className="datetime-date">{lt ? new Date(lt.year, lt.month - 1, lt.day).toDateString() : ""}</div>
            </div>

            <Group label="Time format">
                <ListSelector title="Clock" value={h24 ? "HH24" : "HH12"} testId="time-format"
                              options={[{ label: "12 hour", value: "HH12" }, { label: "24 hour", value: "HH24" }]}
                              onChange={(v) => set({ timeFormat: v as "HH12" | "HH24" })} />
            </Group>

            <Group label="Time zone">
                <Row title="Network time zone">
                    <ToggleButton value={prefs?.useNetworkTimeZone !== false} disabled={!prefs} label="Network time zone"
                                  onChange={(v) => set({ useNetworkTimeZone: v })} />
                </Row>
                <Row title={zone?.City || zone?.ZoneID || "…"} subtitle={[zone?.Country, offsetText(zone?.offsetFromUTC ?? time?.offset)].filter(Boolean).join(", ")}
                     chevron onClick={() => setChoosingZone(true)} testId="timezone" />
            </Group>

            <Group label="Date & time">
                <Row title="Network time">
                    <ToggleButton value={network} disabled={!prefs} label="Network time" testId="network-time"
                                  onChange={(v) => { setEdit(null); set({ useNetworkTime: v }); }} />
                </Row>
            </Group>

            {!network && shown && (
                <>
                    <div className="picker-row" data-testid="date-pickers">
                        <Picker label="Month" value={shown.mo} options={MONTHS.map((m, i) => ({ label: m, value: i + 1 }))}
                                onChange={(mo) => setEdit({ ...shown, mo })} />
                        <Picker label="Day" value={shown.d} options={Array.from({ length: 31 }, (_, i) => ({ label: String(i + 1), value: i + 1 }))}
                                onChange={(d) => setEdit({ ...shown, d })} />
                        <Picker label="Year" value={shown.y} options={Array.from({ length: 30 }, (_, i) => ({ label: String(2010 + i), value: 2010 + i }))}
                                onChange={(y) => setEdit({ ...shown, y })} />
                    </div>
                    <div className="picker-row" data-testid="time-pickers">
                        <Picker label="Hour" value={h24 ? shown.h : (shown.h % 12 || 12)}
                                options={h24 ? Array.from({ length: 24 }, (_, i) => ({ label: pad(i), value: i }))
                                    : Array.from({ length: 12 }, (_, i) => ({ label: String(i + 1), value: i + 1 }))}
                                onChange={(h) => setEdit({ ...shown, h: h24 ? h : (h % 12) + (shown.h >= 12 ? 12 : 0) })} />
                        <Picker label="Minute" value={shown.mi} options={Array.from({ length: 60 }, (_, i) => ({ label: pad(i), value: i }))}
                                onChange={(mi) => setEdit({ ...shown, mi })} />
                        {!h24 && (
                            <Picker label="" value={shown.h >= 12 ? "PM" : "AM"} options={[{ label: "AM", value: "AM" }, { label: "PM", value: "PM" }]}
                                    onChange={(ap) => setEdit({ ...shown, h: (shown.h % 12) + (ap === "PM" ? 12 : 0) })} />
                        )}
                    </div>
                    <Button disabled={!edit} data-testid="set-time"
                            onClick={() => {
                                if (!edit) return;
                                void system.setSystemTime(new Date(edit.y, edit.mo - 1, edit.d, edit.h, edit.mi)).then(() => setEdit(null));
                            }}>
                        Set Date & Time
                    </Button>
                </>
            )}
            {network && <Note>The date and time are set automatically from the network.</Note>}
        </Page>
    );
}

function ZonePicker({ zones, current, onPick }: { zones: TimeZone[]; current?: string; onPick: (z: TimeZone) => void }) {
    const [filter, setFilter] = useState("");
    const shown = useMemo(() => {
        const f = filter.trim().toLowerCase();
        return zones
            .filter((z) => !f || [z.City, z.Country, z.ZoneID].some((s) => s?.toLowerCase().includes(f)))
            .sort((a, b) => (a.offsetFromUTC ?? 0) - (b.offsetFromUTC ?? 0) || (a.City ?? "").localeCompare(b.City ?? ""));
    }, [zones, filter]);
    return (
        <Page>
            <PageHeader title="Time Zone" icon="icons/datetime.png" />
            <TextField value={filter} onChange={setFilter} placeholder="Search for a city or country" testId="zone-filter" />
            <Group>
                {shown.map((z) => (
                    <Row key={z.ZoneID} title={z.City || z.ZoneID} subtitle={[z.Country, offsetText(z.offsetFromUTC)].filter(Boolean).join(", ")}
                         onClick={() => onPick(z)} testId={`zone-${z.ZoneID}`}>
                        {z.ZoneID === current && <Checkmark />}
                    </Row>
                ))}
                {shown.length === 0 && <Row title="No matches" />}
            </Group>
        </Page>
    );
}
