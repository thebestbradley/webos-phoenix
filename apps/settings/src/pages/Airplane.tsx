// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Airplane mode. Service: com.webos.service.connectionmanager
// setstate {offlineMode} / getstatus; radios: wifi getstatus, bluetooth2
// adapter/getStatus.

import { bluetooth, connection, wifi, type BluetoothAdapter, type ConnectionStatus, type WifiStatus } from "@phoenix/luna";
import { useLuna } from "@phoenix/luna/react";
import { Group, Note, Page, PageHeader, Row, ToggleButton } from "@phoenix/ui";

export function AirplanePage() {
    const cm = useLuna<ConnectionStatus>((cb, err) => connection.watchStatus(cb, err), []).value;
    const wifiStatus = useLuna<WifiStatus>((cb, err) => wifi.watchStatus(cb, err), []).value;
    const bt = useLuna<BluetoothAdapter | null>((cb, err) => bluetooth.watchAdapter(cb, err), []).value;
    const on = cm?.offlineMode === "enabled";
    const wifiOn = wifiStatus ? wifiStatus.status !== "serviceDisabled" : false;
    return (
        <Page>
            <PageHeader title="Airplane Mode" icon="icons/airplane.png" />
            <Group>
                <Row title="Airplane Mode">
                    <ToggleButton value={on} disabled={!cm} label="Airplane Mode" testId="airplane-toggle"
                                  onChange={(v) => void connection.setAirplaneMode(v)} />
                </Row>
            </Group>
            <Note>
                Airplane mode turns off the phone, Wi-Fi and Bluetooth radios. You can turn Wi-Fi and Bluetooth
                back on while it is on.
            </Note>
            <Group label="Radios">
                <Row title="Wi-Fi">
                    <ToggleButton value={wifiOn} disabled={!wifiStatus} label="Wi-Fi radio" onChange={(v) => void wifi.setEnabled(v)} />
                </Row>
                <Row title="Bluetooth">
                    <ToggleButton value={!!bt?.powered} disabled={!bt} label="Bluetooth radio" onChange={(v) => void bluetooth.setPowered(v)} />
                </Row>
            </Group>
        </Page>
    );
}
