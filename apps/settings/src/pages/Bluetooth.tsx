// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Bluetooth: on/off, paired devices, search and pair, forget.
// Services: com.webos.service.bluetooth2 adapter/getStatus, adapter/setState,
// adapter/startDiscovery, adapter/cancelDiscovery, adapter/pair,
// adapter/unpair, device/getStatus.

import { useEffect, useState } from "react";
import { bluetooth, connection, type BluetoothAdapter, type BluetoothDevice, type LunaError } from "@phoenix/luna";
import { useLuna } from "@phoenix/luna/react";
import { Button, Dialog, Divider, ErrorText, Group, Note, Page, PageHeader, Row, Spinner, ToggleButton } from "@phoenix/ui";

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

export function BluetoothPage() {
    const adapter = useLuna<BluetoothAdapter | null>((cb, err) => bluetooth.watchAdapter(cb, err), []);
    const powered = adapter.value?.powered;
    const devices = useLuna<BluetoothDevice[]>((cb, err) => (powered ? bluetooth.watchDevices(cb, err) : null), [powered]).value ?? [];
    const airplane = useLuna<boolean>((cb, err) => connection.watchStatus((s) => cb(s.offlineMode === "enabled"), err), []).value ?? false;
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
                        {paired.map((d) => (
                            <Row key={d.address} title={d.name} subtitle={kindOf(d)} testId={`bt-${d.address}`}
                                 onClick={() => setForget(d)} chevron />
                        ))}
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
