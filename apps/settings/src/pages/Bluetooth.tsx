// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Bluetooth: on/off, paired devices, search and pair, forget.
// Services: com.webos.service.bluetooth2 adapter/getStatus, adapter/setState,
// adapter/startDiscovery, adapter/cancelDiscovery, adapter/pair,
// adapter/unpair, device/getStatus.
//
// AirPods and Beats (docs/ACCESSORIES.md; org.webosphoenix.earbuds): a
// paired pair shows its batteries in the list and opens its own page
// (Earbuds.tsx) instead of the Forget dialog. Tracker Alerts
// (org.webosphoenix.trackers) is a row at the bottom that opens its page
// (Trackers.tsx). Launch params {view: "earbuds", address} and {view:
// "tracker", id} (the tracker alert's notification) open those pages.

import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import {
    bluetooth, connection, earbuds, sceneTransition, trackers,
    type BluetoothAdapter, type BluetoothDevice, type EarbudsStatus, type LunaError, type TrackerStatus,
} from "@phoenix/luna";
import { useLaunchParams, useLuna } from "@phoenix/luna/react";
import { Button, Dialog, Divider, ErrorText, Group, Note, Page, PageHeader, Row, Spinner, ToggleButton } from "@phoenix/ui";
import { useBack } from "../nav";
import { batteryLine, EarbudsPage } from "./Earbuds";
import { TrackerDetail, TrackersPage } from "./Trackers";

/** Major device class (Bluetooth assigned numbers, bits 8-12 of the class of device). */
function kindOf(d: BluetoothDevice): string {
    switch ((d.classOfDevice >> 8) & 0x1f) {
    case 1: return "Computer";
    case 2: return "Phone";
    case 4: return "Audio";
    case 5: return "Keyboard or mouse";
    default: return "Device";
    }
}

export type BluetoothView = { kind: "earbuds"; address: string } | { kind: "trackers" } | { kind: "tracker"; id: string };

/** The sub-page a launch asks for ({view: "earbuds", address} | {view: "trackers"} | {view: "tracker", id}). */
export function viewFromParams(p: { view?: unknown; address?: unknown; id?: unknown }): BluetoothView | null {
    if (p.view === "earbuds" && typeof p.address === "string") return { kind: "earbuds", address: p.address };
    if (p.view === "trackers") return { kind: "trackers" };
    if (p.view === "tracker" && typeof p.id === "string") return { kind: "tracker", id: p.id };
    return null;
}

export function BluetoothPage() {
    const launch = useLaunchParams<{ view?: unknown; address?: unknown; id?: unknown }>();
    const [view, setView] = useState<BluetoothView | null>(() => viewFromParams(launch));
    const handled = useRef<object>(launch);
    useEffect(() => {
        if (handled.current === launch) return;
        handled.current = launch;
        setView(viewFromParams(launch));
    }, [launch]);
    // A sub-page is a scene of its own: the back gesture pops it, with the
    // card's zoom-fade (Mojo's pushScene / popScene); a tracker's page
    // opened from the list goes back to the list.
    const go = (v: BluetoothView | null, pop: boolean) => void sceneTransition(() => {
        flushSync(() => setView(v));
        window.scrollTo(0, 0);
    }, { pop });
    useBack(() => {
        go(view && view.kind === "tracker" && !viewFromParams(launch) ? { kind: "trackers" } : null, true);
        return true;
    }, view !== null);

    const pods = useLuna<EarbudsStatus>((cb, err) => earbuds.watch(cb, err), []).value;
    if (view?.kind === "earbuds") {
        const d = pods?.devices.find((x) => x.address === view.address);
        if (d) return <EarbudsPage device={d} onForgotten={() => go(null, true)} />;
        return (
            <Page>
                <PageHeader title="AirPods" icon="icons/bluetooth.png" />
                {pods && <Note>These AirPods are no longer paired.</Note>}
            </Page>
        );
    }
    if (view?.kind === "trackers") return <TrackersPage onOpen={(id) => go({ kind: "tracker", id }, false)} />;
    if (view?.kind === "tracker") return <TrackerDetail id={view.id} />;
    return <DevicesPage pods={pods} onOpen={(v) => go(v, false)} />;
}

function DevicesPage({ pods, onOpen }: { pods: EarbudsStatus | undefined; onOpen: (v: BluetoothView) => void }) {
    const adapter = useLuna<BluetoothAdapter | null>((cb, err) => bluetooth.watchAdapter(cb, err), []);
    const powered = adapter.value?.powered;
    const devices = useLuna<BluetoothDevice[]>((cb, err) => (powered ? bluetooth.watchDevices(cb, err) : null), [powered]).value ?? [];
    const airplane = useLuna<boolean>((cb, err) => connection.watchStatus((s) => cb(s.offlineMode === "enabled"), err), []).value ?? false;
    const alerts = useLuna<TrackerStatus>((cb, err) => trackers.watch(cb, err), []).value;
    const [error, setError] = useState<string | null>(null);
    const [forget, setForget] = useState<BluetoothDevice | null>(null);
    const [searching, setSearching] = useState(false);
    const discovering = !!adapter.value?.discovering;

    useEffect(() => {
        // Stop searching when leaving the page.
        return () => { if (searching) void bluetooth.cancelDiscovery().catch(() => {}); };
    }, [searching]);

    const paired = devices.filter((d) => d.paired);
    const found = devices.filter((d) => !d.paired);
    const podsOf = (address: string) => pods?.devices.find((p) => p.address === address);

    const run = (p: Promise<unknown>) => p.catch((e: LunaError) => setError(e.errorText));

    return (
        <Page>
            <PageHeader title="Bluetooth" icon="icons/bluetooth.png" />
            <Group>
                <Row title="Bluetooth" subtitle={powered ? `Visible as "${adapter.value?.name}"` : airplane ? "Airplane mode is on" : undefined}>
                    <ToggleButton value={!!powered} disabled={adapter.value === undefined} label="Bluetooth" testId="bt-toggle"
                                  onChange={(on) => { setError(null); void run(bluetooth.setPowered(on)); }} />
                </Row>
            </Group>
            {error && <ErrorText>{error}</ErrorText>}
            {powered === false && <Note>Turn on Bluetooth to use headsets, speakers, car kits and keyboards.</Note>}

            {powered && (
                <>
                    <Divider caption="My devices" />
                    <Group>
                        {paired.length === 0 && <Row title="No devices" className="dim-row" />}
                        {paired.map((d) => {
                            const p = podsOf(d.address);
                            if (p) {
                                const line = p.connected && p.aap ? batteryLine(p.battery) : "";
                                return (
                                    <Row key={d.address} title={p.name} testId={`bt-${d.address}`} chevron
                                         subtitle={p.connected ? line || "Connected" : "Not connected"}
                                         onClick={() => onOpen({ kind: "earbuds", address: d.address })} />
                                );
                            }
                            return (
                                <Row key={d.address} title={d.name} subtitle={kindOf(d)} testId={`bt-${d.address}`}
                                     onClick={() => setForget(d)} chevron />
                            );
                        })}
                    </Group>

                    {(searching || found.length > 0) && (
                        <>
                            <Divider caption="Available devices" />
                            <Group>
                                {found.map((d) => (
                                    <Row key={d.address} title={d.name || d.address}
                                         subtitle={d.pairing ? "Pairing…" : kindOf(d)} testId={`bt-${d.address}`}
                                         onClick={d.pairing ? undefined : () => { setError(null); void run(bluetooth.pair(d.address)); }}>
                                        {d.pairing && <Spinner />}
                                    </Row>
                                ))}
                                {discovering && <Row title="Searching…"><Spinner /></Row>}
                            </Group>
                        </>
                    )}

                    <Button disabled={discovering} busy={discovering} data-testid="bt-search"
                            onClick={() => { setSearching(true); setError(null); void run(bluetooth.startDiscovery()); }}>
                        {discovering ? "Searching…" : "Add Device"}
                    </Button>
                </>
            )}

            <Divider caption="Privacy" />
            <Group>
                <Row title="Tracker Alerts" value={alerts ? (alerts.enabled ? "On" : "Off") : undefined} chevron testId="bt-trackers"
                     subtitle="Unknown trackers moving with you"
                     onClick={() => onOpen({ kind: "trackers" })} />
            </Group>

            <Dialog open={!!forget} title={forget?.name} message="Forget this device? You will need to pair it again to use it."
                    onClose={() => setForget(null)}>
                <Button variant="negative" onClick={() => { if (forget) void run(bluetooth.unpair(forget.address)); setForget(null); }}>
                    Forget Device
                </Button>
                <Button variant="dark" onClick={() => setForget(null)}>Cancel</Button>
            </Dialog>
        </Page>
    );
}
