// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Wi-Fi: on/off, networks in range, join (with password), forget.
// Services: com.webos.service.wifi setstate / getstatus / findnetworks /
// connect / deleteprofile; com.webos.service.connectionmanager getstatus
// (airplane mode).

import { useState } from "react";
import { connection, LunaError, wifi, WIFI_ERROR_INVALID_KEY, type WifiNetworkInfo, type WifiStatus } from "@phoenix/luna";
import { useLuna } from "@phoenix/luna/react";
import {
    Button, Dialog, Divider, ErrorText, Group, icons, ListSelector, Note, Page, PageHeader, Row, Spinner, TextField, ToggleButton,
} from "@phoenix/ui";

type Security = "none" | "psk" | "wep";

interface JoinTarget {
    ssid: string;
    security: Security;
    /** Typed SSID (Join Other Network). */
    other?: boolean;
}

function securityOf(n: WifiNetworkInfo): Security {
    const t = n.availableSecurityTypes.find((s) => s !== "none");
    return t === "wep" ? "wep" : t ? "psk" : "none";
}

function SignalIcon({ bars }: { bars: number }) {
    return <img src={icons.wifiSignal[Math.max(0, Math.min(3, bars))]} width={33} height={25} alt={`${bars} bars`} />;
}

export function WifiPage() {
    const status = useLuna<WifiStatus>((cb, err) => wifi.watchStatus(cb, err), []).value;
    const airplane = useLuna<boolean>((cb, err) => connection.watchStatus((s) => cb(s.offlineMode === "enabled"), err), []).value ?? false;
    const enabled = status ? status.status !== "serviceDisabled" : undefined;
    const networks = useLuna<WifiNetworkInfo[]>(
        (cb, err) => (enabled ? wifi.watchNetworks(cb, err) : null), [enabled]).value ?? [];

    const [busy, setBusy] = useState<string | null>(null);        // ssid being joined
    const [failed, setFailed] = useState<{ ssid: string; text: string } | null>(null);
    const [join, setJoin] = useState<JoinTarget | null>(null);
    const [details, setDetails] = useState<WifiNetworkInfo | null>(null);
    const [toggling, setToggling] = useState(false);

    const connectedSsid = status?.networkInfo?.connectState === "ipConfigured" ? status.networkInfo.ssid : null;

    async function setEnabled(on: boolean) {
        setToggling(true);
        setFailed(null);
        try {
            await wifi.setEnabled(on);
        } finally {
            setToggling(false);
        }
    }

    async function connect(target: JoinTarget, passKey?: string): Promise<string | null> {
        setBusy(target.ssid);
        setFailed(null);
        try {
            await wifi.connect(target.ssid, target.security, passKey, target.other);
            return null;
        } catch (e) {
            const text = e instanceof LunaError && e.errorCode === WIFI_ERROR_INVALID_KEY
                ? "The password is incorrect." : e instanceof LunaError ? e.errorText : String(e);
            setFailed({ ssid: target.ssid, text });
            return text;
        } finally {
            setBusy(null);
        }
    }

    function tap(n: WifiNetworkInfo) {
        if (n.ssid === connectedSsid) {
            setDetails(n);
        } else if (n.profileId !== undefined) {
            setBusy(n.ssid);
            setFailed(null);
            wifi.connectProfile(n.profileId)
                .catch((e: LunaError) => setFailed({ ssid: n.ssid, text: e.errorText }))
                .finally(() => setBusy(null));
        } else if (securityOf(n) === "none") {
            void connect({ ssid: n.ssid, security: "none" });
        } else {
            setJoin({ ssid: n.ssid, security: securityOf(n) });
        }
    }

    const sorted = [...networks].sort((a, b) =>
        (b.ssid === connectedSsid ? 1 : 0) - (a.ssid === connectedSsid ? 1 : 0)
        || (b.profileId !== undefined ? 1 : 0) - (a.profileId !== undefined ? 1 : 0)
        || b.signalLevel - a.signalLevel);

    return (
        <Page>
            <PageHeader title="Wi-Fi" icon="icons/wifi.png" />
            <Group>
                <Row title="Wi-Fi" subtitle={airplane ? "Airplane mode is on" : undefined}>
                    {toggling && <Spinner />}
                    <ToggleButton value={!!enabled} onChange={setEnabled} disabled={enabled === undefined || toggling}
                                  label="Wi-Fi" testId="wifi-toggle" />
                </Row>
            </Group>

            {enabled === false && (
                <Note>Turn on Wi-Fi to see the networks around you. {airplane && "You can use Wi-Fi in airplane mode."}</Note>
            )}

            {enabled && (
                <>
                    <Divider caption="Choose a network" />
                    <Group>
                        {sorted.length === 0 && (
                            <Row title="Searching…"><Spinner /></Row>
                        )}
                        {sorted.map((n) => {
                            const connected = n.ssid === connectedSsid;
                            const joining = busy === n.ssid || (status?.networkInfo?.ssid === n.ssid && status.networkInfo.connectState === "associating");
                            const error = failed?.ssid === n.ssid ? failed.text : undefined;
                            return (
                                <Row
                                    key={n.ssid}
                                    testId={`network-${n.ssid}`}
                                    className={connected ? "wifi-connected" : undefined}
                                    title={n.ssid}
                                    subtitle={joining ? "Connecting…" : connected ? "Connected" : error
                                        ? <span className="wifi-error">{error}</span>
                                        : n.profileId !== undefined ? "Saved" : undefined}
                                    onClick={() => tap(n)}
                                    icon={connected ? <span className="wifi-check" /> : <span className="wifi-check-space" />}
                                >
                                    {joining && <Spinner />}
                                    {securityOf(n) !== "none" && <img src={icons.secure} width={14} height={25} alt="secure" />}
                                    <SignalIcon bars={n.signalBars} />
                                </Row>
                            );
                        })}
                        <Row title="Join other network" onClick={() => setJoin({ ssid: "", security: "psk", other: true })}
                             icon={<img src={icons.joinPlus} width={18} height={18} alt="" style={{ margin: "0 7px" }} />} />
                    </Group>
                </>
            )}

            <JoinDialog
                target={join}
                onCancel={() => setJoin(null)}
                onJoin={async (t, key) => {
                    const err = await connect(t, key);
                    if (!err) setJoin(null);
                    return err;
                }}
            />

            <Dialog open={!!details} title={details?.ssid} onClose={() => setDetails(null)} testId="wifi-details">
                {status?.networkInfo?.ipInfo && (
                    <div className="wifi-ipinfo">
                        <div><span>IP address</span>{status.networkInfo.ipInfo.ip}</div>
                        <div><span>Subnet mask</span>{status.networkInfo.ipInfo.subnet}</div>
                        <div><span>Gateway</span>{status.networkInfo.ipInfo.gateway}</div>
                        <div><span>DNS</span>{status.networkInfo.ipInfo.dns.join(", ")}</div>
                    </div>
                )}
                <Button variant="negative" onClick={() => {
                    const id = details?.profileId ?? status?.networkInfo?.profileId;
                    if (id !== undefined) void wifi.forget(id);
                    setDetails(null);
                }}>Forget Network</Button>
                <Button variant="light" onClick={() => setDetails(null)}>Done</Button>
            </Dialog>
        </Page>
    );
}

function JoinDialog({ target, onCancel, onJoin }: {
    target: JoinTarget | null;
    onCancel: () => void;
    onJoin: (t: JoinTarget, passKey?: string) => Promise<string | null>;
}) {
    const [ssid, setSsid] = useState("");
    const [security, setSecurity] = useState<Security>("psk");
    const [password, setPassword] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [shownFor, setShownFor] = useState<JoinTarget | null>(null);
    if (target !== shownFor) {
        // Opened for another network: start clean.
        setShownFor(target);
        setSsid(target?.ssid ?? "");
        setSecurity(target?.security ?? "psk");
        setPassword("");
        setError(null);
        setBusy(false);
    }
    if (!target) return null;
    const other = !!target.other;
    const needsKey = security !== "none";
    const tooShort = security === "psk" && password.length < 8;
    const canJoin = !busy && (!other || ssid.trim() !== "") && (!needsKey || (password.length > 0 && !tooShort));

    async function submit() {
        if (!canJoin || !target) return;
        setBusy(true);
        setError(null);
        const err = await onJoin({ ssid: other ? ssid.trim() : target.ssid, security, other }, needsKey ? password : undefined);
        setBusy(false);
        if (err) setError(err);
    }

    return (
        <Dialog open title={other ? "Join Network" : target.ssid}
                message={other ? undefined : "Enter the password for this network."}
                onClose={busy ? undefined : onCancel} testId="wifi-join">
            {other && (
                <>
                    <TextField label="Network name" value={ssid} onChange={setSsid} autoFocus testId="wifi-ssid" />
                    <div className="dialog-group">
                        <ListSelector title="Security" value={security} onChange={setSecurity}
                                      options={[{ label: "Open", value: "none" }, { label: "WPA Personal", value: "psk" }, { label: "WEP", value: "wep" }]} />
                    </div>
                </>
            )}
            {needsKey && (
                <TextField label="Password" type="password" value={password} onChange={setPassword}
                           autoFocus={!other} onSubmit={submit} testId="wifi-password" />
            )}
            {needsKey && tooShort && password.length > 0 && <div className="pui-note">WPA passwords have at least 8 characters.</div>}
            {error && <ErrorText>{error}</ErrorText>}
            <Button variant="affirmative" disabled={!canJoin} busy={busy} onClick={submit} data-testid="wifi-join-button">
                {busy ? "Connecting…" : "Connect"}
            </Button>
            <Button variant="dark" disabled={busy} onClick={onCancel}>Cancel</Button>
        </Dialog>
    );
}
