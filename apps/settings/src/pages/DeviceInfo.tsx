// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Device Info: model, software version, battery, storage, memory, open
// source licenses, help, setup (First Use) again, reset options.
// Services: com.webos.service.systemservice deviceInfo/query, osInfo/query;
// com.palm.power batteryStatusQuery (legacy; OSE has no battery service on
// its reference boards); com.webos.settingsservice resetSystemSettings;
// org.webosphoenix.service.reset eraseUserData (Phoenix, not yet on device).

import { useEffect, useState } from "react";
import { apps, call, settings, system, type DeviceInfo, type OsInfo } from "@phoenix/luna";
import { Button, Dialog, ErrorText, Group, Page, PageHeader, Row, Spinner } from "@phoenix/ui";
import { useBack } from "../nav";
import notice from "../../../../NOTICE?raw";
import license from "../../../../LICENSE?raw";
import { LICENSES } from "../licenses";

type Reset = "settings" | "erase";

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
            } else {
                await call("luna://org.webosphoenix.service.reset/eraseUserData", {});
                setDone("Apps and data were erased.");
            }
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setResetting(false);
            setReset(null);
        }
    }

    return (
        <Page>
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
                </div>
            </Group>
            {done && <div className="pui-note">{done}</div>}
            {error && <ErrorText>{error}</ErrorText>}

            <Dialog open={!!reset} onClose={resetting ? undefined : () => setReset(null)} testId="reset-dialog"
                    title={reset === "erase" ? "Erase apps & data?" : "Reset all settings?"}
                    message={reset === "erase"
                        ? "This removes every app you installed and all your data: accounts, memos, messages, photos. It cannot be undone."
                        : "Wi-Fi networks, Bluetooth devices, sounds, screen and region settings go back to their defaults. Your data is kept."}>
                <Button variant="negative" busy={resetting} onClick={() => reset && void doReset(reset)} data-testid="reset-confirm">
                    {reset === "erase" ? "Erase" : "Reset"}
                </Button>
                <Button variant="dark" disabled={resetting} onClick={() => setReset(null)}>Cancel</Button>
            </Dialog>
        </Page>
    );
}

function Licenses() {
    return (
        <Page>
            <PageHeader title="Open Source Licenses" icon="icons/deviceinfo.png" />
            <Group label="webOS Phoenix">
                <pre className="license-text">{notice}</pre>
            </Group>
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
