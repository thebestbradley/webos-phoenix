// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Settings > Bluetooth > Scanning (docs/ACCESSORIES.md, "Power"; the owner,
// 15 October 2026): how often Phoenix listens for AirPods and trackers,
// Battery Saver, Balanced (the default) or Performance, each mode's scan
// windows stated beside it. SCAN_MODES is the service's table
// (services/accessories/scanner.js MODES, where each value's source is;
// Trackers.test.tsx checks they agree). The mode is kept by
// org.webosphoenix.trackers (setScanMode), which runs the scan with the
// screen off; the AirPods' card's scan with the screen on follows it too.
// A system-wide Low Power Mode, when it comes, will set Battery Saver
// (docs/ROADMAP.md, M5).

import { trackers, type ScanMode, type ScanWindow, type TrackerStatus } from "@phoenix/luna";
import { useLuna } from "@phoenix/luna/react";
import { Checkmark, Group, Note, Page, PageHeader, Row } from "@phoenix/ui";

const S = 1000, MIN = 60 * S;
export const SCAN_MODES: Record<ScanMode, { screenOn: ScanWindow; screenOff: ScanWindow }> = {
    saver: { screenOn: { window: 10 * S, every: 30 * S }, screenOff: { window: 20 * S, every: 15 * MIN } },
    balanced: { screenOn: null, screenOff: { window: 10 * S, every: 3 * MIN } },
    performance: { screenOn: null, screenOff: { window: 10 * S, every: 1 * MIN } },
};
export const SCAN_MODE_LABELS: Record<ScanMode, string> = { saver: "Battery Saver", balanced: "Balanced", performance: "Performance" };

function span(ms: number): string {
    if (ms < MIN) return `${Math.round(ms / S)} s`;
    const m = Math.round(ms / MIN);
    return m === 1 ? "minute" : `${m} min`;
}
/** A window in words: "always", "10 s in every 30 s", "20 s every 15 min", "10 s every minute". */
export function windowText(w: ScanWindow): string {
    if (!w) return "always";
    return w.every < MIN ? `${span(w.window)} in every ${span(w.every)}` : `${span(w.window)} every ${span(w.every)}`;
}
/** A mode's windows: "Screen on: always · Screen off: 10 s every 3 min". */
export function scanModeText(m: ScanMode): string {
    return `Screen on: ${windowText(SCAN_MODES[m].screenOn)} · Screen off: ${windowText(SCAN_MODES[m].screenOff)}`;
}

export function ScanningPage() {
    const status = useLuna<TrackerStatus>((cb, err) => trackers.watch(cb, err), []).value;
    return (
        <Page>
            <PageHeader title="Scanning" icon="icons/bluetooth.png" />
            <Group>
                {(["saver", "balanced", "performance"] as ScanMode[]).map((m) => (
                    <Row key={m} title={m === "balanced" ? "Balanced (Default)" : SCAN_MODE_LABELS[m]} subtitle={scanModeText(m)}
                         className="wrap-row" testId={`scan-${m}`} disabled={!status}
                         onClick={() => { if (status && m !== status.scanMode) void trackers.setScanMode(m); }}>
                        {status?.scanMode === m && <Checkmark />}
                    </Row>
                ))}
            </Group>
            <Note>How often Phoenix listens for AirPods opening nearby and for trackers. With the screen off it listens only while Tracker Alerts are on.</Note>
            {status?.scanMode === "saver" && (
                <Note testId="scan-saver-note">AirPods may take up to 20 seconds to show when their case opens.</Note>
            )}
        </Page>
    );
}
