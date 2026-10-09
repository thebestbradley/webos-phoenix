// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Device Info: model, software version, the phone (number, carrier,
// network, IMEI, SIM), battery, storage, memory, open source licenses, help,
// setup (First Use) again, and the legacy reset options: Reset All
// Settings, Erase Apps & Data (keeps the files on the USB drive), Full Erase.
// Services: com.webos.service.systemservice deviceInfo/query, osInfo/query;
// com.palm.telephony platformQuery, subscriberIdQuery, simStatusQuery,
// networkStatusQuery (webos-telephonyd; the section is left out without a
// modem, as on the TouchPad); com.palm.power batteryStatusQuery (legacy; OSE
// has no battery service on its reference boards); com.webos.settingsservice
// resetSystemSettings; org.webosphoenix.service.reset eraseUserData,
// fullErase (Phoenix, not yet on device).

import { useEffect, useState } from "react";
import { apps, call, LunaError, settings, system, telephony, type DeviceInfo, type NetworkStatus, type OsInfo,
         type PlatformInfo, type SimState, type SubscriberInfo } from "@phoenix/luna";
import { AppMenu, Button, Dialog, ErrorText, formatNumber, Group, Page, PageHeader, Row, Spinner } from "@phoenix/ui";
import { useBack } from "../nav";
import notice from "../../../../NOTICE?raw";
import license from "../../../../LICENSE?raw";
import { LICENSES } from "../licenses";
import { FirmwareLicenses } from "./Hardware";

type Reset = "settings" | "erase" | "full";

interface Phone {
    platform: PlatformInfo;
    subscriber: SubscriberInfo;
    sim: SimState;
    network: NetworkStatus;
}

// The phone, when the device has one (no telephony service: no section).
function usePhone() {
    const [phone, setPhone] = useState<Phone | null>(null);
    useEffect(() => {
        let live = true;
        telephony.platform().then(async (platform) => {
            const [subscriber, sim, network] = await Promise.all([
                telephony.subscriber().catch(() => ({})),
                telephony.simState().catch((): SimState => "unknown"),
                telephony.network().catch(() => ({})),
            ]);
            if (live) setPhone({ platform, subscriber, sim, network });
        }, () => { /* no modem */ });
        return () => { live = false; };
    }, []);
    return phone;
}

const SIM_STATES: Record<SimState, string> = {
    simready: "Ready", simnotfound: "No SIM card", siminvalid: "Invalid SIM card", pinrequired: "Locked (PIN)",
    pukrequired: "Locked (PUK)", pinpermblocked: "Blocked", unknown: "—",
};
// oFono's radio access technologies.
const RATS: Record<string, string> = {
    gsm: "2G (GSM)", edge: "2G (EDGE)", umts: "3G (UMTS)", hspa: "3G (HSPA)", lte: "4G (LTE)", nr: "5G (NR)",
    "1x": "2G (1xRTT)", evdo: "3G (EV-DO)",
};

function useBattery() {
    const [b, setB] = useState<{ percent: number; charging: boolean } | null>(null);
    useEffect(() => {
        call("luna://com.palm.power/com/palm/power/batteryStatusQuery", {})
            .then((r) => setB({ percent: Number(r.percent_ui ?? r.percent), charging: !!r.charging }))
            .catch(() => setB(null));
    }, []);
    return b;
}

function parseSize(s?: string): number | null {
    const m = /([\d.]+)\s*([KMGT]?)B?/i.exec(s ?? "");
    if (!m) return null;
    const unit = { "": 1, K: 1e3, M: 1e6, G: 1e9, T: 1e12 }[m[2].toUpperCase() as "" | "K" | "M" | "G" | "T"];
    return parseFloat(m[1]) * unit;
}

export function DeviceInfoPage() {
    const [dev, setDev] = useState<DeviceInfo | null>(null);
    const [os, setOs] = useState<OsInfo | null>(null);
    const battery = useBattery();
    const phone = usePhone();
    const [licenses, setLicenses] = useState(false);
    const [reset, setReset] = useState<Reset | null>(null);
    const [resetting, setResetting] = useState(false);
    const [done, setDone] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    useBack(() => { setLicenses(false); return true; }, licenses);

    useEffect(() => {
        system.deviceInfo().then(setDev).catch(() => setDev({}));
        system.osInfo().then(setOs).catch(() => setOs({}));
    }, []);

    if (licenses) return <Licenses />;

    const size = parseSize(dev?.storage_size), free = parseSize(dev?.storage_free);
    const used = size !== null && free !== null ? Math.max(0, Math.min(1, (size - free) / size)) : null;

    async function doReset(kind: Reset) {
        setResetting(true);
        setError(null);
        try {
            if (kind === "settings") {
                await settings.reset();
                setDone("All settings are back to their defaults.");
            } else if (kind === "erase") {
                await call("luna://org.webosphoenix.service.reset/eraseUserData", {});
                setDone("Apps and data were erased; the files on the USB drive are kept. Setup runs at the next start.");
            } else {
                await call("luna://org.webosphoenix.service.reset/fullErase", {});
                setDone("Everything was erased, the USB drive too. Setup runs at the next start.");
            }
        } catch (e) {
            setError(e instanceof LunaError ? e.errorText : String(e));
        } finally {
            setResetting(false);
            setReset(null);
        }
    }

    return (
        <Page>
            {/* The original's app menu had "Certificate Manager..." (com.palm.app.deviceinfo list-assistant.js). */}
            <AppMenu items={[{ label: "Certificate Manager", onSelect: () => void apps.launch("com.palm.app.certificate") }]} />
            <PageHeader title="Device Info" icon="icons/deviceinfo.png" />
            {!dev || !os ? <Row title="Loading…"><Spinner /></Row> : (
                <>
                    <Group label="Device">
                        <Row title="Name" value={dev.device_name ?? dev.modelName ?? "—"} />
                        <Row title="Model" value={dev.product_id ?? dev.board_type ?? "—"} />
                        <Row title="Serial number" value={dev.serial_number ?? "—"} />
                    </Group>
                    <Group label="Software">
                        <Row title={os.webos_name ?? "webOS"} value={os.webos_release ?? "—"} />
                        <Row title="Build" value={os.webos_build_id ?? "—"} />
                        <Row title="Platform" value={[os.core_os_name, os.core_os_release].filter(Boolean).join(" ") || "—"} />
                        <Row title="Kernel" value={os.core_os_kernel_version ?? "—"} />
                    </Group>
                    {phone && (
                        <Group label="Phone">
                            <Row title="Phone number" testId="phone-number"
                                 value={formatNumber(phone.subscriber.msisdn ?? phone.subscriber.mdn ?? "") || "—"} />
                            <Row title="Carrier" value={phone.platform.carrier ?? phone.network.networkName ?? "—"} />
                            <Row title="Network" value={phone.network.state === "service"
                                ? RATS[phone.network.rat ?? ""] ?? phone.network.rat ?? "—" : "No service"} />
                            <Row title={phone.platform.platformType === "cdma" ? "MEID" : "IMEI"} value={phone.platform.imei ?? "—"} testId="imei" />
                            <Row title="SIM" value={SIM_STATES[phone.sim] ?? phone.sim} />
                        </Group>
                    )}
                    <Group label="Hardware">
                        <Row title="Battery" value={battery ? `${battery.percent}%${battery.charging ? " (charging)" : ""}` : "—"} testId="battery" />
                        <Row title="Memory" value={dev.ram_size ?? "—"} />
                        <Row title="Storage" subtitle={dev.storage_free ? `${dev.storage_free} free` : undefined} value={dev.storage_size ?? "—"}>
                        </Row>
                        {used !== null && (
                            <div className="storage-bar" aria-label={`${Math.round(used * 100)}% used`}>
                                <div style={{ width: `${used * 100}%` }} />
                            </div>
                        )}
                        <Row title="Wi-Fi address" value={dev.wifi_addr || "—"} />
                        <Row title="Bluetooth address" value={dev.bt_addr || "—"} />
                    </Group>
                </>
            )}

            <Group label="Help & setup">
                <Row title="Help and tips" chevron testId="open-help"
                     onClick={() => void apps.launch("org.webosphoenix.help")} />
                <Row title="Run setup again" subtitle="Language, Wi-Fi, accounts, passcode and the gesture tutorial" chevron
                     testId="rerun-firstuse" onClick={() => void apps.launch("org.webosphoenix.firstuse", { rerun: true })} />
            </Group>

            <Group label="Legal">
                <Row title="Open source licenses" chevron onClick={() => setLicenses(true)} testId="licenses" />
            </Group>

            <Group label="Reset options">
                <div className="reset-buttons">
                    <Button variant="negative" onClick={() => setReset("settings")} data-testid="reset-settings">Reset All Settings</Button>
                    <Button variant="negative" onClick={() => setReset("erase")} data-testid="erase-data">Erase Apps &amp; Data</Button>
                    <Button variant="negative" onClick={() => setReset("full")} data-testid="full-erase">Full Erase</Button>
                </div>
            </Group>
            {done && <div className="pui-note">{done}</div>}
            {error && <ErrorText>{error}</ErrorText>}

            <Dialog open={!!reset} onClose={resetting ? undefined : () => setReset(null)} testId="reset-dialog"
                    title={RESETS[reset ?? "settings"].title}
                    message={RESETS[reset ?? "settings"].message}>
                <Button variant="negative" busy={resetting} onClick={() => reset && void doReset(reset)} data-testid="reset-confirm">
                    {RESETS[reset ?? "settings"].action}
                </Button>
                <Button variant="dark" disabled={resetting} onClick={() => setReset(null)}>Cancel</Button>
            </Dialog>
        </Page>
    );
}

// As legacy webOS put them.
const RESETS: Record<Reset, { title: string; message: string; action: string }> = {
    settings: {
        title: "Reset all settings?",
        message: "Wi-Fi networks, Bluetooth devices, sounds, screen and region settings go back to their defaults. Your data is kept.",
        action: "Reset",
    },
    erase: {
        title: "Erase apps & data?",
        message: "This removes every app you installed and all your data: accounts, memos, messages, settings. The files on the USB drive (pictures, music, documents) are kept. It cannot be undone.",
        action: "Erase",
    },
    full: {
        title: "Full erase?",
        message: "This erases everything: every app, all your data and every file on the USB drive (pictures, music, videos, documents). It cannot be undone.",
        action: "Erase Everything",
    },
};

function Licenses() {
    return (
        <Page>
            <PageHeader title="Open Source Licenses" icon="icons/deviceinfo.png" />
            <Group label="webOS Phoenix">
                <pre className="license-text">{notice}</pre>
            </Group>
            <FirmwareLicenses />
            {LICENSES.map((l) => (
                <Group key={l.name} label={l.name}>
                    <div className="license-text">{l.text}</div>
                </Group>
            ))}
            <Group label="Apache License 2.0">
                <pre className="license-text">{license}</pre>
            </Group>
        </Page>
    );
}
