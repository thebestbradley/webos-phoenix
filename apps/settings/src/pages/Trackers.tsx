// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Settings > Bluetooth > Tracker Alerts (docs/ACCESSORIES.md): unknown
// tracker alerts on or off, the trackers seen away from their owners, and
// one tracker's page, which the alert's notification opens ({page:
// "bluetooth", view: "tracker", id}): when and where it was with you, Play
// Sound, How to Disable It, Ignore. Service: org.webosphoenix.trackers
// (@phoenix/luna trackers). Everything stays on the device.
//
// What to do with a tracker follows what Apple's and Google's alerts offer
// (play its sound to find it, learn how to disable it; Apple: "What to do
// if you get an alert that an AirTag, Find My network accessory, or set of
// AirPods is with you"; the DULT drafts' non-owner finding and
// disablement, draft-ietf-dult-accessory-protocol-00 §3.13-3.14), in
// Phoenix's words.
//
// Sensitivity (the owner, 15 October 2026; the IETF's threat model,
// draft-ietf-dult-threat-model-05 §4.1.2, recommends it): how soon a
// tracker that travels with you is alerted, Low, Medium (the default) or
// High, each level's rule stated beside it. SENSITIVITY_RULES is the
// service's table (services/accessories/lib/trackerdetect.js SENSITIVITY,
// where each value's source is; Trackers.test.tsx checks they agree).

import { useState } from "react";
import { trackers, type LunaError, type TrackerInfo, type TrackerSensitivity, type TrackerStatus } from "@phoenix/luna";
import { useLuna } from "@phoenix/luna/react";
import { Button, Checkmark, Divider, ErrorText, Group, Note, Page, PageHeader, Row, shortWhen, ToggleButton } from "@phoenix/ui";

const MIN = 60000, HOUR = 60 * MIN;
export const SENSITIVITY_RULES: Record<TrackerSensitivity, { minDuration: number; minSightings: number; minDistance: number; realertAfter: number }> = {
    low: { minDuration: 120 * MIN, minSightings: 4, minDistance: 840, realertAfter: 8 * HOUR },
    medium: { minDuration: 30 * MIN, minSightings: 3, minDistance: 400, realertAfter: 7 * HOUR },
    high: { minDuration: 10 * MIN, minSightings: 2, minDistance: 200, realertAfter: 2 * HOUR },
};
const SENSITIVITY_LABELS: Record<TrackerSensitivity, string> = { low: "Low", medium: "Medium", high: "High" };

/** A level's rule in words: "After 30 min and 400 m, seen 3 times · again after 7 h". */
export function sensitivityRule(l: TrackerSensitivity): string {
    const r = SENSITIVITY_RULES[l];
    const times = r.minSightings === 2 ? "twice" : `${r.minSightings} times`;
    return `After ${minutes(r.minDuration)} and ${metres(r.minDistance)}, seen ${times} · again after ${minutes(r.realertAfter)}`;
}

/** "35 min", "2 h 10 min". */
export function minutes(ms: number): string {
    const m = Math.max(0, Math.round(ms / 60000));
    return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}`;
}

/** "1.2 km", "350 m". */
export function metres(m: number): string {
    return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}

/** How to disable one, by kind. */
export function disableSteps(t: Pick<TrackerInfo, "type">): string[] {
    switch (t.type) {
    case "airtag":
        return ["Press down on the AirTag's round metal back and turn it to the left until it stops.",
                "Lift off the back and take out the battery. The AirTag stops sharing where it is."];
    case "tile":
        return ["Take out its battery if it has a cover that opens; some Tile trackers' batteries are sealed in.",
                "Or leave it somewhere safe, away from you and your things."];
    default:
        return ["Take out its battery, or turn it off as its maker's instructions say (the maker's name is often printed on it).",
                "Once it is off, its owner can no longer see where it is."];
    }
}

function SoundButton({ t, status }: { t: TrackerInfo; status: TrackerStatus }) {
    const [error, setError] = useState<string | null>(null);
    const s = status.sound && status.sound.id === t.id ? status.sound : null;
    const busy = s?.state === "connecting" || s?.state === "playing";
    return (
        <>
            <Button variant="affirmative" busy={busy} disabled={!t.canPlaySound || !status.bluetooth} data-testid="tr-play"
                    onClick={() => { setError(null); void trackers.playSound(t.id).catch((e: LunaError) => setError(e.errorText)); }}>
                {s?.state === "connecting" ? "Connecting…" : s?.state === "playing" ? "Playing Sound…" : "Play Sound"}
            </Button>
            {s?.state === "done" && <Note testId="tr-played">The sound has played. Listen for it to find the tracker.</Note>}
            {s?.state === "failed" && <ErrorText testId="tr-sound-error">{s.error}</ErrorText>}
            {!t.canPlaySound && <Note>This tracker cannot be rung from here.</Note>}
            {error && <ErrorText>{error}</ErrorText>}
        </>
    );
}

/** A sketch of where it was seen: the points in order, first to last. */
function Route({ points }: { points: TrackerInfo["points"] }) {
    const pts = points.filter((p) => typeof p.lat === "number" && typeof p.lon === "number") as { t: number; lat: number; lon: number }[];
    if (pts.length < 2) return null;
    const lats = pts.map((p) => p.lat), lons = pts.map((p) => p.lon);
    const cosLat = Math.cos((lats.reduce((a, b) => a + b, 0) / lats.length) * Math.PI / 180);
    const minX = Math.min(...lons) * cosLat, maxX = Math.max(...lons) * cosLat, minY = Math.min(...lats), maxY = Math.max(...lats);
    const span = Math.max(maxX - minX, maxY - minY) || 1e-6;
    const W = 260, H = 120, pad = 14;
    const xy = (p: { lat: number; lon: number }) => [
        pad + ((p.lon * cosLat - minX) / span) * (W - 2 * pad) + ((W - 2 * pad) - ((maxX - minX) / span) * (W - 2 * pad)) / 2,
        H - pad - ((p.lat - minY) / span) * (H - 2 * pad) - ((H - 2 * pad) - ((maxY - minY) / span) * (H - 2 * pad)) / 2,
    ];
    const line = pts.map((p) => xy(p).map((v) => v.toFixed(1)).join(",")).join(" ");
    const [sx, sy] = xy(pts[0]), [ex, ey] = xy(pts[pts.length - 1]);
    return (
        <svg className="tracker-route" viewBox={`0 0 ${W} ${H}`} width="100%" height={H} data-testid="tr-route" aria-label="Where it was seen">
            <polyline points={line} fill="none" stroke="#3a7bd5" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
            <circle cx={sx} cy={sy} r="5" fill="#fff" stroke="#3a7bd5" strokeWidth="2.5" />
            <circle cx={ex} cy={ey} r="6" fill="#d9442b" stroke="#fff" strokeWidth="2" />
        </svg>
    );
}

export function TrackerPage({ id, status }: { id: string; status: TrackerStatus }) {
    const t = status.trackers.find((x) => x.id === id);
    const [howTo, setHowTo] = useState(false);
    if (!t)
        return (
            <Page>
                <PageHeader title="Tracker" icon="icons/bluetooth.png" />
                <Note>This tracker is no longer in the list.</Note>
            </Page>
        );
    const followed = t.alertedAt > 0;
    return (
        <Page>
            <PageHeader title={`Unknown ${t.name}`} icon="icons/bluetooth.png" />
            <div className="tracker-summary" data-testid="tr-summary">
                <div className="tracker-headline">
                    {followed ? `This ${t.name} has been moving with you` : `This ${t.name} has been near you`}
                </div>
                <div>First seen with you at {shortWhen(t.firstSeen)}, last at {shortWhen(t.lastSeen)}.</div>
                <div>Seen {t.sightings} {t.sightings === 1 ? "time" : "times"} over {minutes(t.duration)}{t.distance > 0 ? `, ${metres(t.distance)} apart` : ""}.</div>
            </div>
            <Route points={t.points} />
            {t.points.some((p) => typeof p.lat === "number") && (
                <Group>
                    {t.points.filter((p) => typeof p.lat === "number").map((p, i, all) => (
                        <Row key={p.t} title={shortWhen(p.t)} testId={`tr-point-${i}`}
                             subtitle={`${p.lat!.toFixed(4)}, ${p.lon!.toFixed(4)}${i === 0 ? " · first seen" : i === all.length - 1 ? " · last seen" : ""}`} />
                    ))}
                </Group>
            )}
            <SoundButton t={t} status={status} />
            <Button data-testid="tr-howto" onClick={() => setHowTo(!howTo)}>How to Disable It</Button>
            {howTo && (
                <Group>
                    {disableSteps(t).map((s, i) => <Row key={i} title={`${i + 1}. ${s}`} className="tracker-step" />)}
                </Group>
            )}
            <Note>
                If you think someone is using it to follow you and you feel unsafe, contact the police and keep the tracker:
                its maker can tell them who owns it.
            </Note>
            <Group>
                <Row title="Ignore This Tracker" subtitle="No more alerts about it">
                    <ToggleButton value={t.ignored} label="Ignore This Tracker" testId="tr-ignore"
                                  onChange={(on) => void trackers.ignore(t.id, on)} />
                </Row>
            </Group>
        </Page>
    );
}

export function TrackersPage({ onOpen }: { onOpen: (id: string) => void }) {
    const status = useLuna<TrackerStatus>((cb, err) => trackers.watch(cb, err), []).value;
    if (!status) return <Page><PageHeader title="Tracker Alerts" icon="icons/bluetooth.png" /></Page>;
    return (
        <Page>
            <PageHeader title="Tracker Alerts" icon="icons/bluetooth.png" />
            <Group>
                <Row title="Tracker Alerts" subtitle="Unknown trackers moving with you" className="wrap-row">
                    <ToggleButton value={status.enabled} label="Tracker Alerts" testId="tr-enabled"
                                  onChange={(on) => void trackers.setEnabled(on)} />
                </Row>
            </Group>
            {status.enabled && !status.bluetooth && <Note testId="tr-bt-off">Turn on Bluetooth for tracker alerts.</Note>}
            {status.enabled && status.bluetooth && !status.location && (
                <Note testId="tr-no-location">Turn on Location Services so Phoenix can tell a tracker that follows you from one that is only nearby.</Note>
            )}
            <Divider caption="Sensitivity" />
            <Group>
                {(["low", "medium", "high"] as TrackerSensitivity[]).map((l) => (
                    <Row key={l} title={l === "medium" ? "Medium (Default)" : SENSITIVITY_LABELS[l]} subtitle={sensitivityRule(l)}
                         className="wrap-row" testId={`tr-sensitivity-${l}`} disabled={!status.enabled}
                         onClick={() => { if (l !== status.sensitivity) void trackers.setSensitivity(l); }}>
                        {status.sensitivity === l && <Checkmark />}
                    </Row>
                ))}
            </Group>
            <Note>High tells you sooner, and may also alert for a tracker that only goes the same way as you, on a bus or a train. Low alerts less often and later.</Note>
            <Divider caption="Trackers seen" />
            <Group>
                {status.trackers.length === 0 && <Row title="None seen" className="dim-row" testId="tr-none" />}
                {status.trackers.map((t) => (
                    <Row key={t.id} title={t.alertedAt ? `${t.name} (moving with you)` : t.name} chevron testId={`tr-${t.id}`}
                         subtitle={`Seen ${t.sightings} ${t.sightings === 1 ? "time" : "times"}, last at ${shortWhen(t.lastSeen)}${t.ignored ? " · ignored" : ""}`}
                         onClick={() => onOpen(t.id)} />
                ))}
            </Group>
            <Note>Phoenix looks for trackers on this device only. Nothing about them, or where you have been, is sent anywhere.</Note>
            {status.trackers.length > 0 && <Button data-testid="tr-clear" onClick={() => void trackers.clear()}>Clear List</Button>}
        </Page>
    );
}

/** The tracker page with its live status (the notification opens it). */
export function TrackerDetail({ id }: { id: string }) {
    const status = useLuna<TrackerStatus>((cb, err) => trackers.watch(cb, err), []).value;
    if (!status) return <Page><PageHeader title="Tracker" icon="icons/bluetooth.png" /></Page>;
    return <TrackerPage id={id} status={status} />;
}
