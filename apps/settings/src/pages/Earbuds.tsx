// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Settings > Bluetooth > AirPods (docs/ACCESSORIES.md): paired AirPods or
// Beats, as a phone shows them: each earbud's and the case's battery, the
// listening mode (Off, Transparency, Adaptive, Noise Cancellation, as the
// model has them), Automatic Ear Detection, Conversation Awareness, the
// name, forgetting them. Service: org.webosphoenix.earbuds (@phoenix/luna
// earbuds). In the classic webOS look: a header, grouped rows with toggle
// buttons and a checkmark list (the Mojo list selector's), a negative
// button at the bottom (Bluetooth's Forget, Wi-Fi's).
//
// The picture is Phoenix's own, drawn here (generic earbuds and a case; no
// Apple artwork): docs/ACCESSORIES.md, "Art".

import { useState } from "react";
import { earbuds, type EarbudsBattery, type EarbudsCharging, type EarbudsDevice, type NoiseMode, type LunaError } from "@phoenix/luna";
import { Button, Checkmark, Dialog, Divider, ErrorText, Group, Note, Page, PageHeader, Row, TextField, ToggleButton } from "@phoenix/ui";

export const NOISE_MODE_LABELS: Record<NoiseMode, string> = {
    off: "Off",
    transparency: "Transparency",
    adaptive: "Adaptive",
    anc: "Noise Cancellation",
};
// Apple's order (AirPods User Guide, "Switch between listening modes").
const MODE_ORDER: NoiseMode[] = ["off", "transparency", "adaptive", "anc"];

/** "80%", or "" with no reading. */
export function percent(v: number | undefined): string {
    return typeof v === "number" && v >= 0 ? `${Math.round(v)}%` : "";
}

/** One line for a list row: "L 80% · R 70% · Case 40%". */
export function batteryLine(b: EarbudsBattery): string {
    const parts: string[] = [];
    if (typeof b.single === "number" && b.single >= 0) parts.push(percent(b.single));
    if (b.left >= 0) parts.push(`L ${percent(b.left)}`);
    if (b.right >= 0) parts.push(`R ${percent(b.right)}`);
    if (b.case >= 0) parts.push(`Case ${percent(b.case)}`);
    return parts.join(" · ");
}

/**
 * Generic earbuds and their case, drawn as plain shapes: two rounded
 * heads on stems over an open (or closed) case. Not Apple's artwork.
 */
export function EarbudsArt({ lidOpen = true, size = 120, kind = "" }: { lidOpen?: boolean; size?: number; kind?: string }) {
    const max = kind === "airpodsmax";
    if (max) {
        return (
            <svg width={size} height={size * 0.8} viewBox="0 0 120 96" aria-hidden className="earbuds-art">
                <path d="M22 60 C22 18 98 18 98 60" fill="none" stroke="#d9d9d6" strokeWidth="8" strokeLinecap="round" />
                <rect x="10" y="50" width="26" height="38" rx="11" fill="#f4f4f2" stroke="#9a9a96" strokeWidth="1.5" />
                <rect x="84" y="50" width="26" height="38" rx="11" fill="#f4f4f2" stroke="#9a9a96" strokeWidth="1.5" />
            </svg>
        );
    }
    return (
        <svg width={size} height={size * 0.8} viewBox="0 0 120 96" aria-hidden className="earbuds-art">
            <defs>
                <linearGradient id="earbuds-shine" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0" stopColor="#ffffff" />
                    <stop offset="1" stopColor="#dcdcd8" />
                </linearGradient>
            </defs>
            {/* The case: its lid up when open. */}
            {lidOpen
                ? <rect x="30" y="34" width="60" height="16" rx="7" fill="url(#earbuds-shine)" stroke="#9a9a96" strokeWidth="1.5" transform="rotate(-8 30 50)" />
                : null}
            <rect x="30" y={lidOpen ? 52 : 46} width="60" height={lidOpen ? 40 : 46} rx="12" fill="url(#earbuds-shine)" stroke="#9a9a96" strokeWidth="1.5" />
            {!lidOpen && <line x1="31" y1="60" x2="89" y2="60" stroke="#b8b8b4" strokeWidth="1.2" />}
            {/* The earbuds: a round head on a stem, mirrored. */}
            {[0, 1].map((i) => (
                <g key={i} transform={i ? "translate(120 0) scale(-1 1)" : undefined}>
                    <rect x="31" y="14" width="8" height="30" rx="4" fill="url(#earbuds-shine)" stroke="#9a9a96" strokeWidth="1.2" />
                    <ellipse cx="30" cy="12" rx="11" ry="10" fill="url(#earbuds-shine)" stroke="#9a9a96" strokeWidth="1.4" />
                    <ellipse cx="24" cy="12" rx="3.5" ry="4" fill="#5d5d5a" />
                </g>
            ))}
        </svg>
    );
}

/** One battery gauge: a label, the level and a bar (green, red under 20%). */
function Gauge({ label, level, charging, testId }: { label: string; level: number; charging: boolean; testId: string }) {
    const known = level >= 0;
    return (
        <div className={`earbuds-gauge${known ? "" : " unknown"}`} data-testid={testId}>
            <div className="earbuds-gauge-label">{label}</div>
            <div className="earbuds-gauge-bar">
                <span className={level >= 0 && level < 20 ? "low" : ""} style={{ width: `${known ? level : 0}%` }} />
            </div>
            <div className="earbuds-gauge-value">{known ? percent(level) : "—"}{charging && known ? " ⚡" : ""}</div>
        </div>
    );
}

export function EarbudsBatteries({ battery, charging }: { battery: EarbudsBattery; charging: EarbudsCharging }) {
    if (typeof battery.single === "number" && battery.single >= 0)
        return <div className="earbuds-gauges"><Gauge label="Battery" level={battery.single} charging={!!charging.single} testId="ab-single" /></div>;
    return (
        <div className="earbuds-gauges">
            <Gauge label="Left" level={battery.left} charging={charging.left} testId="ab-left" />
            <Gauge label="Right" level={battery.right} charging={charging.right} testId="ab-right" />
            <Gauge label="Case" level={battery.case} charging={charging.case} testId="ab-case" />
        </div>
    );
}

export function EarbudsPage({ device, onForgotten }: { device: EarbudsDevice; onForgotten: () => void }) {
    const [error, setError] = useState<string | null>(null);
    const [renaming, setRenaming] = useState<string | null>(null);
    const [forget, setForget] = useState(false);
    const run = (p: Promise<unknown>) => p.catch((e: LunaError) => setError(e.errorText));
    const modes = MODE_ORDER.filter((m) => device.noiseModes.includes(m));
    const live = device.connected && device.aap;

    return (
        <Page>
            <PageHeader title={device.name} icon="icons/bluetooth.png" />
            <div className="earbuds-hero">
                <EarbudsArt kind={device.kind} />
                {live ? <EarbudsBatteries battery={device.battery} charging={device.charging} />
                      : <div className="earbuds-offline" data-testid="ab-offline">Not connected</div>}
            </div>
            {!device.connected && <Note>Open the case near this device, or take the AirPods out, to connect them.</Note>}
            {error && <ErrorText>{error}</ErrorText>}

            {modes.length > 0 && (
                <>
                    <Divider caption="Noise Control" />
                    <Group>
                        {modes.map((m) => (
                            <Row key={m} title={NOISE_MODE_LABELS[m]} testId={`ab-mode-${m}`} disabled={!live}
                                 onClick={() => { setError(null); if (m !== device.noiseMode) void run(earbuds.setNoiseMode(device.address, m)); }}>
                                {device.noiseMode === m && <Checkmark />}
                            </Row>
                        ))}
                    </Group>
                </>
            )}

            <Divider caption="Settings" />
            <Group>
                <Row title="Automatic Ear Detection" subtitle="Pauses when you take an earbud out, plays when you put it back">
                    <ToggleButton value={device.earDetection} label="Automatic Ear Detection" testId="ab-ear-detection"
                                  onChange={(on) => { setError(null); void run(earbuds.setEarDetection(device.address, on)); }} />
                </Row>
                {device.conversationAwareness !== null && (
                    <Row title="Conversation Awareness" subtitle="Lowers your media when you start talking">
                        <ToggleButton value={device.conversationAwareness} label="Conversation Awareness" testId="ab-conversation"
                                      disabled={!live}
                                      onChange={(on) => { setError(null); void run(earbuds.setConversationAwareness(device.address, on)); }} />
                    </Row>
                )}
                <Row title="Name" value={device.name} chevron testId="ab-name" onClick={() => setRenaming(device.name)} />
                {device.model && (
                    <Row title="Model" value={device.modelNumber ? `${device.model} (${device.modelNumber})` : device.model} />
                )}
            </Group>

            <Button variant="negative" data-testid="ab-forget" onClick={() => setForget(true)}>Forget This Device</Button>

            <Dialog open={renaming !== null} title="Name" onClose={() => setRenaming(null)}>
                <TextField value={renaming ?? ""} onChange={setRenaming} maxLength={32} autoFocus testId="ab-name-field"
                           onSubmit={() => { if (renaming?.trim()) void run(earbuds.rename(device.address, renaming)); setRenaming(null); }} />
                <Button variant="affirmative" disabled={!renaming?.trim()} data-testid="ab-name-done"
                        onClick={() => { if (renaming?.trim()) void run(earbuds.rename(device.address, renaming)); setRenaming(null); }}>Done</Button>
                <Button variant="dark" onClick={() => setRenaming(null)}>Cancel</Button>
            </Dialog>
            <Dialog open={forget} title={device.name} message="Forget this device? You will need to pair it again to use it."
                    onClose={() => setForget(false)}>
                <Button variant="negative" data-testid="ab-forget-confirm"
                        onClick={() => { setForget(false); void earbuds.forget(device.address).then(onForgotten, (e: LunaError) => setError(e.errorText)); }}>
                    Forget Device
                </Button>
                <Button variant="dark" onClick={() => setForget(false)}>Cancel</Button>
            </Dialog>
        </Page>
    );
}
