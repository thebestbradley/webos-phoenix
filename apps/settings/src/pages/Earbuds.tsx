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
 * Generic earbuds in their case, drawn as plain shapes (the shell's
 * EarbudsArt.qml draws the same): a rounded case, its lid standing open
 * behind it, the earbuds' heads in their wells; closed, the lid's seam.
 * Not Apple's artwork.
 */
export function EarbudsArt({ lidOpen = true, size = 120, kind = "" }: { lidOpen?: boolean; size?: number; kind?: string }) {
    const stroke = { stroke: "#8a8a85", strokeWidth: 1.5 };
    if (kind === "airpodsmax") {
        return (
            <svg width={size} height={size * 0.8} viewBox="0 0 120 96" aria-hidden className="earbuds-art">
                <defs>
                    <linearGradient id="earbuds-white" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0" stopColor="#ffffff" /><stop offset="1" stopColor="#d4d4cf" />
                    </linearGradient>
                </defs>
                <path d="M26 58 C26 14 94 14 94 58" fill="none" stroke="#d9d9d6" strokeWidth="8" strokeLinecap="round" />
                <rect x="12" y="46" width="28" height="42" rx="12" fill="url(#earbuds-white)" {...stroke} />
                <rect x="80" y="46" width="28" height="42" rx="12" fill="url(#earbuds-white)" {...stroke} />
            </svg>
        );
    }
    return (
        <svg width={size} height={size * 0.8} viewBox="0 0 120 96" aria-hidden className="earbuds-art">
            <defs>
                <linearGradient id="earbuds-white" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" stopColor="#ffffff" /><stop offset="1" stopColor="#d4d4cf" />
                </linearGradient>
            </defs>
            {lidOpen && (
                <>
                    <rect x="24" y="8" width="72" height="40" rx="16" fill="url(#earbuds-white)" {...stroke} />
                    <rect x="30" y="13" width="60" height="30" rx="12" fill="#c9c9c4" />
                    {[47, 73].map((cx, i) => (
                        <g key={cx}>
                            <ellipse cx={cx} cy="46" rx="10" ry="9" fill="url(#earbuds-white)" {...stroke} />
                            <ellipse cx={cx + (i === 0 ? -3.5 : 3.5)} cy="44" rx="2.5" ry="3" fill="#4f4f4a" />
                        </g>
                    ))}
                </>
            )}
            <rect x="20" y={lidOpen ? 48 : 30} width="80" height={lidOpen ? 44 : 62} rx="18" fill="url(#earbuds-white)" {...stroke} />
            <line x1={lidOpen ? 28 : 21} y1={lidOpen ? 52 : 50} x2={lidOpen ? 92 : 99} y2={lidOpen ? 52 : 50} stroke="#b0b0aa" strokeWidth="1.5" />
            <circle cx="60" cy={lidOpen ? 76 : 72} r="2" fill="#9fd88a" />
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
            <div className="earbuds-gauge-value">{known ? percent(level) : "—"}</div>
            {charging && known && <div className="earbuds-gauge-charging">Charging</div>}
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
                <Row title="Automatic Ear Detection" subtitle="Pause when an earbud comes out">
                    <ToggleButton value={device.earDetection} label="Automatic Ear Detection" testId="ab-ear-detection"
                                  onChange={(on) => { setError(null); void run(earbuds.setEarDetection(device.address, on)); }} />
                </Row>
                {device.conversationAwareness !== null && (
                    <Row title="Conversation Awareness" subtitle="Lower media when you talk">
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
