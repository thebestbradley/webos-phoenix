// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Hotspot & Tethering (Phoenix; docs/M6-PLAN.md F4 item 8, after webOS
// Internals' freeTether): the phone's mobile data shared over Wi-Fi (a
// hotspot with its name and password) or a USB cable
// (org.webosphoenix.tethering; on a device the connection manager's
// tethering). Phones only: a tablet without mobile data has nothing to share.

import { useState } from "react";
import { tethering, type TetheringStatus } from "@phoenix/luna";
import { useLuna } from "@phoenix/luna/react";
import { Button, ErrorText, Group, ListSelector, Note, Page, PageHeader, Row, TextField, ToggleButton } from "@phoenix/ui";

/** The hotspot's name and password, checked as WPA2 wants them. */
export function hotspotProblem(ssid: string, security: "wpa2" | "open", passphrase: string): string | null {
    if (!ssid.trim() || ssid.trim().length > 32) return "The network name has 1 to 32 characters.";
    if (security === "wpa2" && (passphrase.length < 8 || passphrase.length > 63)) return "The password has 8 to 63 characters.";
    return null;
}

export function HotspotPage() {
    const st = useLuna<TetheringStatus>((cb, err) => tethering.watch(cb, err), []).value;
    const [ssid, setSsid] = useState<string | null>(null);
    const [pass, setPass] = useState<string | null>(null);
    const [error, setError] = useState("");
    if (!st) return <Page><PageHeader title="Hotspot & Tethering" icon="icons/hotspot.png" /></Page>;
    const name = ssid ?? st.wifi.ssid;
    const password = pass ?? st.wifi.passphrase;
    const problem = hotspotProblem(name, st.wifi.security, password);
    const run = (p: Promise<unknown>) => p.then(() => { setError(""); setSsid(null); setPass(null); },
                                                (e: { errorText?: string }) => setError(e.errorText ?? String(e)));
    return (
        <Page>
            <PageHeader title="Hotspot & Tethering" icon="icons/hotspot.png" />
            {!st.available ? (
                <Note testId="ht-unavailable">This device has no mobile data to share.</Note>
            ) : (
                <>
                    <Group label="Wi-Fi Hotspot">
                        <Row title="Wi-Fi Hotspot" subtitle={st.wifi.enabled ? `On as “${st.wifi.ssid}”` : "Other devices use your mobile data"}>
                            <ToggleButton value={st.wifi.enabled} label="Wi-Fi Hotspot" testId="ht-wifi" disabled={!st.wifi.enabled && !!problem}
                                          onChange={(v) => void run(tethering.setWifi({ enabled: v, ssid: name.trim(), passphrase: password }))} />
                        </Row>
                        <div className="field-row"><TextField label="Network name" value={name} onChange={setSsid} testId="ht-ssid" /></div>
                        <ListSelector title="Security" value={st.wifi.security} testId="ht-security"
                                      options={[{ label: "WPA2", value: "wpa2" as const }, { label: "None", value: "open" as const }]}
                                      onChange={(v) => void run(tethering.setWifi({ security: v }))} />
                        {st.wifi.security === "wpa2" && (
                            <div className="field-row"><TextField label="Password" value={password} onChange={setPass} testId="ht-password" /></div>
                        )}
                    </Group>
                    {(ssid !== null || pass !== null) && problem && <ErrorText testId="ht-problem">{problem}</ErrorText>}
                    {(ssid !== null || pass !== null) && (
                        <Button variant="affirmative" disabled={!!problem} data-testid="ht-save"
                                onClick={() => void run(tethering.setWifi({ ssid: name.trim(), passphrase: password }))}>Save</Button>
                    )}
                    <Group label="USB Tethering">
                        <Row title="USB Tethering" subtitle={st.usb.enabled ? (st.usb.connected ? "Sharing with the computer" : "On: connect a USB cable")
                            : "A computer on a USB cable uses your mobile data"}>
                            <ToggleButton value={st.usb.enabled} label="USB Tethering" testId="ht-usb"
                                          onChange={(v) => void run(tethering.setUsb(v))} />
                        </Row>
                    </Group>
                    {error && <ErrorText testId="ht-error">{error}</ErrorText>}
                    <Note>Your carrier may charge for the data other devices use.</Note>
                </>
            )}
        </Page>
    );
}
