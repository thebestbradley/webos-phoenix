// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Battery (Phoenix; docs/M6-PLAN.md F4 item 9, after the community's
// battery monitors, Dr. Battery and friends): the charge now, its level
// over the last 24 hours, and which apps used it: each app's share of the
// time the screen was on with it in front, the screen being most of a
// phone's drain (org.webosphoenix.battery/usage; estimates, as on any
// phone). Drawn in Settings' own grey and blue.

import { useState } from "react";
import { battery, type BatteryUsage } from "@phoenix/luna";
import { useLuna } from "@phoenix/luna/react";
import { Group, Note, Page, PageHeader, Row } from "@phoenix/ui";

const DAY = 24 * 3600 * 1000;

export function durationText(ms: number): string {
    if (ms < 60000) return "less than a minute";
    const min = Math.round(ms / 60000);
    if (min < 60) return `${min} min`;
    const h = Math.floor(min / 60), m = min % 60;
    return m ? `${h} h ${m} min` : `${h} h`;
}

/** The level line's points, in a w × h box: time across the last day, 0-100 % up. */
export function levelPath(history: BatteryUsage["history"], now: number, w: number, h: number): string {
    const pts = history.filter((p) => now - p.t <= DAY).map((p) => [((p.t - (now - DAY)) / DAY) * w, h - (p.percent / 100) * h]);
    if (!pts.length) return "";
    // A level holds until it changes: steps, carried on to now.
    const out: string[] = [`M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`];
    for (let i = 1; i < pts.length; i++) out.push(`H${pts[i][0].toFixed(1)}`, `V${pts[i][1].toFixed(1)}`);
    out.push(`H${w}`);
    return out.join(" ");
}

function LevelChart({ usage }: { usage: BatteryUsage }) {
    const [now] = useState(() => Date.now());
    const [hover, setHover] = useState<{ x: number; text: string } | null>(null);
    const W = 600, H = 120;
    const line = levelPath(usage.history, now, W, H);
    const at = (x: number) => {
        const t = now - DAY + (x / W) * DAY;
        const before = usage.history.filter((p) => p.t <= t);
        const p = before[before.length - 1];
        return p ? `${p.percent}% at ${new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : "";
    };
    return (
        <div className="bat-chart" data-testid="bat-chart">
            <div className="bat-tip">{hover?.text || `${usage.percent}% now`}</div>
            <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`Battery level over the last 24 hours, ${usage.percent}% now`}
                 onPointerMove={(e) => {
                     const r = e.currentTarget.getBoundingClientRect();
                     const x = ((e.clientX - r.left) / r.width) * W;
                     setHover({ x, text: at(x) });
                 }}
                 onPointerLeave={() => setHover(null)}>
                {[25, 50, 75].map((v) => <line key={v} x1={0} x2={W} y1={H - (v / 100) * H} y2={H - (v / 100) * H} className="bat-grid" />)}
                {line && <path d={`${line} V${H} H${line.match(/^M([\d.]+)/)![1]} Z`} className="bat-area" />}
                {line && <path d={line} className="bat-line" data-testid="bat-line" />}
                {hover && <line x1={hover.x} x2={hover.x} y1={0} y2={H} className="bat-cross" />}
            </svg>
            <div className="bat-axis"><span>24 h ago</span><span>12 h</span><span>Now</span></div>
        </div>
    );
}

export function BatteryPage() {
    const usage = useLuna<BatteryUsage>((cb, err) => battery.watchUsage(cb, err), []).value;
    return (
        <Page>
            <PageHeader title="Battery" icon="icons/battery.png" />
            {usage && (
                <>
                    <Group>
                        <Row title={`${usage.percent}%`} subtitle={usage.charging ? "Charging" : "On battery"} testId="bat-level"
                             value={`${usage.temperature} °C`} />
                    </Group>
                    <Group label="Last 24 hours">
                        <LevelChart usage={usage} />
                    </Group>
                    <Group label="Battery use by app">
                        {usage.apps.length === 0 && <Row title="Nothing yet" subtitle="Apps show here once you have used them for a while" />}
                        {usage.apps.map((a) => (
                            <div key={a.appId || "system"} className="bat-app" data-testid={`bat-app-${a.appId || "system"}`}>
                                <div className="bat-app-text">
                                    <span className="bat-app-title">{a.title}</span>
                                    <span className="bat-app-share">{Math.round(a.share * 100)}%</span>
                                </div>
                                <div className="bat-app-bar"><div style={{ width: `${Math.max(1, a.share * 100)}%` }} /></div>
                                <div className="bat-app-time">{durationText(a.ms)} on screen</div>
                            </div>
                        ))}
                    </Group>
                    <Note>Estimates from the time each app was in front with the screen on, over the last 24 hours. Screen on in all:
                        {" "}{durationText(usage.screenOnMs)}.</Note>
                </>
            )}
        </Page>
    );
}
