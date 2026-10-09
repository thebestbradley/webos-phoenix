// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Hardware: the device's hardware and what fills its gaps, as Ubuntu's
// "Additional Drivers" and Windows' driver installer show them
// (docs/HARDWARE.md, "Hardware support and the Hardware app"). The system
// carries the open source drivers and the redistributable firmware; this
// offers what it does not have: firmware it lacks, newer firmware, drivers
// outside the kernel, optional extras, and (with Developer Mode) drivers
// from other catalogs, marked as such.
// Each device with its state (working, needs firmware, needs a driver, no
// driver, an optional extra); what the signed driver catalog has for it,
// with its licence, size and source; installing it (the licence first when
// it is not open source), with its progress here and as an ongoing
// activity in the notification area; removing it. And the opt-in report of
// hardware nothing drives yet, which sends only the devices' IDs.
//
// Launch params {page: "hardware", driverId?}: the ongoing activity and the
// "needs firmware" notification open it; driverId opens the device it is for.
// Service: org.webosphoenix.hardware (@phoenix/luna hardware).

import { useEffect, useRef, useState } from "react";
import {
    deviceTitle, hardware, installable, needsAttention, reflowLicense, LunaError, call,
    type DriverOffer, type DriverSource, type HardwareCategory, type HardwareDevice, type HardwareList, type HardwareReport, type DriverInstallProgress,
    type ImageFirmware, type PendingDriverSource,
} from "@phoenix/luna";
import { useLaunchParams, useLuna } from "@phoenix/luna/react";
import { Button, Dialog, ErrorText, Group, Note, Page, PageHeader, Row, Spinner, TextField, ToggleButton } from "@phoenix/ui";
import { useBack } from "../nav";
import { size } from "./Backup";

const ICON = "icons/hardware.png";

export const CATEGORY_LABELS: [HardwareCategory[], string][] = [
    [["wifi", "bluetooth", "network", "modem"], "Wireless & Network"],
    [["graphics"], "Graphics"],
    [["camera"], "Camera"],
    [["audio"], "Sound"],
    [["input"], "Touch & Input"],
    [["sensors"], "Sensors"],
    [["storage", "usb"], "Storage & USB"],
    [["other"], "Other"],
];

/** What a device's row says under its name. */
export function statusText(d: HardwareDevice): string {
    switch (d.status) {
    case "needs-firmware": return installable(d).length ? "Needs firmware, available to install" : "Needs firmware";
    case "needs-driver": return "Needs a driver, available to install";
    case "no-driver": return d.offers.some((o) => !o.available && o.reason) ? "No driver for this device yet" : "No driver";
    case "restart": return "Restart to finish installing";
    default:
        if (installable(d).some((o) => o.update)) return "Working · newer firmware available";
        return installable(d).some((o) => o.optional) ? "Working · optional driver available" : "Working";
    }
}

const STEP_TEXT: Record<string, string> = {
    queued: "Waiting…", downloading: "Downloading…", checking: "Checking…", installing: "Installing…", activating: "Starting the driver…",
};

function kindText(o: DriverOffer): string {
    return o.kind === "firmware" ? "Firmware" : o.kind === "module" ? "Driver" : "Service";
}

function errorText(e: unknown): string {
    return e instanceof LunaError ? e.errorText : String(e);
}

/** The licence, in full, before installing what is not open source. */
function LicenseDialog({ offer, onAccept, onClose }: { offer: DriverOffer; onAccept: () => void; onClose: () => void }) {
    return (
        <Dialog open title={offer.license.name} onClose={onClose} testId="hw-license"
                message={`${offer.title} is not open source. Its maker allows passing it on under this licence; read it before installing.`}>
            <pre className="hw-license-text" data-testid="hw-license-text">{reflowLicense(offer.license.text)}</pre>
            {offer.license.url && <div className="hw-license-url">{offer.license.url}</div>}
            <Button variant="affirmative" data-testid="hw-license-accept" onClick={onAccept}>Accept and Install</Button>
            <Button variant="dark" onClick={onClose}>Cancel</Button>
        </Dialog>
    );
}

function Offer({ device, offer, onDone }: { device: HardwareDevice; offer: DriverOffer; onDone: (text: string) => void }) {
    const [progress, setProgress] = useState<DriverInstallProgress | null>(offer.installing ? { driverId: offer.driverId, ...offer.installing } : null);
    const [error, setError] = useState<string | null>(null);
    const [asking, setAsking] = useState(false);
    const [removing, setRemoving] = useState(false);
    const busy = !!progress && progress.state !== "failed";

    const install = async () => {
        setAsking(false);
        setError(null);
        setProgress({ driverId: offer.driverId, state: "queued", progress: 0 });
        try {
            const r = await hardware.install(offer.driverId, { deviceId: device.id, acceptLicense: offer.license.free ? undefined : offer.license.id },
                                             (p) => setProgress(p));
            onDone(r.state === "restart" ? `${offer.title} is installed. It starts when you restart the device.`
                                         : `${offer.title} is installed.`);
        } catch (e) {
            setError(errorText(e));
        } finally {
            setProgress(null);
        }
    };
    const remove = async () => {
        setRemoving(false);
        setError(null);
        try {
            const r = await hardware.remove(offer.driverId);
            onDone(r.restart ? `${offer.title} is removed. Restart the device to stop it.` : `${offer.title} is removed.`);
        } catch (e) {
            setError(errorText(e));
        }
    };

    return (
        <Group label={`${offer.update ? "Newer firmware" : kindText(offer)}${offer.optional && !offer.update ? " (optional)" : ""}`}>
            <Row title={offer.title} subtitle={offer.summary || undefined} className="wrap-subtitle" testId={`hw-offer-${offer.driverId}`} />
            {offer.thirdParty && (
                <Note testId="hw-offer-thirdparty">
                    From {offer.sourceName}, a catalog you added, not Phoenix's. Phoenix has not checked it: install it only if you trust who made it.
                </Note>
            )}
            {offer.inImage && <Row title="Included with Phoenix" value={offer.installedVersion ?? ""} testId="hw-offer-inimage" />}
            {offer.included && !offer.installed && <Row title="In the system now" value={offer.included} testId="hw-offer-included" />}
            <Row title="Licence" value={offer.license.name} testId="hw-offer-license"
                 subtitle={offer.license.free ? "Open source" : "Not open source"} />
            <Row title="Download" value={size(offer.size)} testId="hw-offer-size" />
            {offer.installedSize !== null && <Row title="On the device" value={size(offer.installedSize)} />}
            <Row title="Version" value={offer.installed && offer.installedVersion ? offer.installedVersion : offer.version} />
            {offer.source && <Row title="From" subtitle={offer.source} className="wrap-subtitle" />}
            {busy && progress && (
                <>
                    <div className="updates-status" data-testid="hw-progress-text">{STEP_TEXT[progress.state] ?? ""}</div>
                    <div className="update-progress" data-testid="hw-progress"><div style={{ width: `${progress.progress ?? 0}%` }} /></div>
                </>
            )}
            {!offer.available && <Note testId="hw-offer-unavailable">{offer.reason}</Note>}
            {offer.available && !offer.installed && !busy && (
                <Button variant="affirmative" data-testid={`hw-install-${offer.driverId}`}
                        onClick={() => (offer.license.free ? void install() : setAsking(true))}>
                    {offer.update ? "Update" : "Install"}{offer.size ? ` (${size(offer.size)})` : ""}
                </Button>
            )}
            {offer.installed && !offer.inImage && !busy && (
                <Button variant="dark" data-testid={`hw-remove-${offer.driverId}`} onClick={() => setRemoving(true)}>Remove</Button>
            )}
            {error && <ErrorText testId="hw-error">{error}</ErrorText>}
            {asking && <LicenseDialog offer={offer} onAccept={() => void install()} onClose={() => setAsking(false)} />}
            <Dialog open={removing} title={`Remove ${offer.title}?`} onClose={() => setRemoving(false)} testId="hw-remove-dialog"
                    message={offer.optional ? `${deviceTitle(device)} goes back to the built-in driver.` : `${deviceTitle(device)} stops working until it is installed again.`}>
                <Button variant="negative" data-testid="hw-remove-confirm" onClick={() => void remove()}>Remove</Button>
                <Button variant="dark" onClick={() => setRemoving(false)}>Cancel</Button>
            </Dialog>
        </Group>
    );
}

function DeviceDetails({ device, onRestart }: { device: HardwareDevice; onRestart: () => void }) {
    const [notice, setNotice] = useState<string | null>(null);
    return (
        <Page>
            <PageHeader title={deviceTitle(device)} icon={ICON} />
            <Group>
                <Row title="Status" subtitle={statusText(device)} testId="hw-detail-status"
                     className={`wrap-subtitle${needsAttention(device) || device.status === "no-driver" ? " hw-attention" : ""}`} />
                <Row title="Driver" value={device.driver ?? "None"} testId="hw-detail-driver" />
                {device.firmwareMissing.length > 0 && (
                    <Row title="Missing firmware" subtitle={device.firmwareMissing.join(", ")} className="wrap-subtitle" testId="hw-detail-missing" />
                )}
                <Row title="Hardware IDs" className="wrap-subtitle" subtitle={<span className="hw-ids">{device.ids.join("\n")}</span>} />
            </Group>
            {notice && <Note testId="hw-notice">{notice}</Note>}
            {device.status === "restart" && <Button data-testid="hw-restart" onClick={onRestart}>Restart Now</Button>}
            {device.offers.map((o) => <Offer key={o.driverId} device={device} offer={o} onDone={setNotice} />)}
            {device.offers.length === 0 && device.status !== "working" && (
                <Note testId="hw-no-offer">
                    There is no driver for this device in the catalog yet. Sending a hardware report (on the Hardware page) tells the
                    people who add drivers that it is wanted.
                </Note>
            )}
        </Page>
    );
}

function ReportDialog({ onClose }: { onClose: () => void }) {
    const report = useLuna<HardwareReport>((cb, err) => {
        let live = true;
        hardware.getReport().then((r) => { if (live) cb(r); }, (e) => { if (live) err(e as LunaError); });
        return { cancel() { live = false; }, get cancelled() { return !live; } };
    }, []).value;
    const [sending, setSending] = useState(false);
    const [result, setResult] = useState<string | null>(null);
    const send = async () => {
        setSending(true);
        try {
            const r = await hardware.sendReport();
            setResult(r.sent ? "Sent. Thank you." : "There is nothing to send.");
        } catch (e) {
            setResult(errorText(e));
        } finally {
            setSending(false);
        }
    };
    return (
        <Dialog open title="Hardware Report" onClose={onClose} testId="hw-report"
                message="Only these IDs are sent: no names, serial numbers, addresses, or which device this is.">
            {!report && <Spinner />}
            {report && report.devices.length === 0 && <Note>All your hardware has a driver. There is nothing to send.</Note>}
            {report && report.devices.length > 0 && (
                <pre className="hw-report-ids" data-testid="hw-report-ids">
                    {report.devices.map((d) => [...d.ids, ...d.firmwareMissing.map((f) => `  firmware: ${f}`)].join("\n")).join("\n")}
                </pre>
            )}
            {result && <Note testId="hw-report-result">{result}</Note>}
            {report && report.devices.length > 0 && !result && (
                <Button variant="affirmative" busy={sending} data-testid="hw-report-send" onClick={() => void send()}>Send Now</Button>
            )}
            <Button variant="dark" onClick={onClose}>{result ? "Done" : "Cancel"}</Button>
        </Dialog>
    );
}

/** Other driver catalogs (Developer Mode): added by their address, trusted by their key's fingerprint. */
function OtherCatalogs({ data }: { data: HardwareList }) {
    const others = (data.sources ?? []).filter((x) => x.thirdParty);
    const [adding, setAdding] = useState(false);
    const [url, setUrl] = useState("");
    const [pending, setPending] = useState<PendingDriverSource | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const close = () => { setAdding(false); setPending(null); setUrl(""); setError(null); };
    const look = async () => {
        setBusy(true);
        setError(null);
        try { setPending(await hardware.addSource(url.trim())); } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
    };
    const trust = async () => {
        if (!pending) return;
        setBusy(true);
        try { await hardware.trustSource({ url: pending.url, key: pending.key, name: pending.name }); close(); }
        catch (e) { setError(errorText(e)); } finally { setBusy(false); }
    };
    if (!data.devMode && others.length === 0) return null;
    return (
        <Group label="Other driver catalogs">
            {others.map((x: DriverSource) => (
                <Row key={x.id} title={x.name} className="wrap-subtitle" testId={`hw-source-${x.id}`}
                     subtitle={x.error ? x.error.errorText : `${x.count} drivers · key ${x.fingerprint ?? ""}`}>
                    <Button variant="dark" className="hw-small-button" onClick={() => void hardware.removeSource(x.id)}>Remove</Button>
                </Row>
            ))}
            {data.devMode && <Row title="Add Catalog" chevron testId="hw-source-add" onClick={() => setAdding(true)} />}
            <Dialog open={adding} title={pending ? `Trust ${pending.name}?` : "Add a Driver Catalog"} onClose={close} testId="hw-source-dialog"
                    message={pending ? undefined : "Drivers install as the system. Add only a catalog whose makers you trust."}>
                {!pending && <TextField value={url} onChange={setUrl} placeholder="https://…/v1/" testId="hw-source-url" onSubmit={() => void look()} />}
                {pending && (
                    <>
                        <Note>Its drivers are not Phoenix's and Phoenix has not checked them. Check that this key fingerprint is the one its makers publish:</Note>
                        <pre className="hw-report-ids" data-testid="hw-source-fingerprint">{pending.fingerprint}</pre>
                    </>
                )}
                {error && <ErrorText testId="hw-source-error">{error}</ErrorText>}
                {!pending && <Button variant="affirmative" busy={busy} disabled={!url.trim()} data-testid="hw-source-look" onClick={() => void look()}>Next</Button>}
                {pending && <Button variant="negative" busy={busy} data-testid="hw-source-trust" onClick={() => void trust()}>Trust This Catalog</Button>}
                <Button variant="dark" onClick={close}>Cancel</Button>
            </Dialog>
        </Group>
    );
}

/**
 * The firmware the system image carries (not open source; its makers allow
 * passing it on), each package with its licence, the licence files' text on
 * a tap (org.webosphoenix.hardware firmwareLicenses; docs/LEGAL.md,
 * "Firmware and drivers").
 */
export function FirmwareLicenses() {
    const [packages, setPackages] = useState<ImageFirmware[] | null>(null);
    const [open, setOpen] = useState<string | null>(null);
    const [text, setText] = useState<Record<string, string>>({});
    useEffect(() => {
        let live = true;
        hardware.firmwareLicenses().then((p) => { if (live) setPackages(p); }, () => { if (live) setPackages([]); });
        return () => { live = false; };
    }, []);
    if (!packages || packages.length === 0) return null;
    const files = [...new Set(packages.flatMap((p) => p.licenseFiles))];
    const show = (f: string) => {
        setOpen(open === f ? null : f);
        if (!text[f]) void hardware.firmwareLicense(f).then((t) => setText((x) => ({ ...x, [f]: t })), () => {});
    };
    return (
        <Group label="Firmware">
            <div className="license-text" data-testid="firmware-packages">
                Firmware for Wi-Fi, Bluetooth, graphics and other hardware, passed on unmodified as its makers allow:{" "}
                {packages.map((p) => `${p.name} ${p.version} (${p.license})`).join(", ")}.
            </div>
            {files.map((f) => (
                <div key={f}>
                    <Row title={f.split("/").pop()} chevron onClick={() => show(f)} testId={`firmware-license-${f.split("/").pop()}`} />
                    {open === f && <pre className="license-text">{text[f] ?? "…"}</pre>}
                </div>
            ))}
        </Group>
    );
}

export function HardwarePage() {
    const sub = useLuna<HardwareList>((cb, err) => hardware.watch(cb, err), []);
    const params = useLaunchParams<{ driverId?: string }>();
    const [shown, setShown] = useState<string | null>(null);
    const [reporting, setReporting] = useState(false);
    const [refreshing, setRefreshing] = useState(false);
    const opened = useRef(false);
    useBack(() => { setShown(null); return true; }, shown !== null);
    const data = sub.value;

    // The notification or the ongoing activity: straight to the device the driver is for.
    useEffect(() => {
        if (!data || opened.current || !params.driverId) return;
        opened.current = true;
        const d = data.devices.find((x) => x.offers.some((o) => o.driverId === params.driverId));
        if (d) setShown(d.id);
    }, [data, params.driverId]);

    const restart = () => void call("luna://com.palm.power/shutdown/machineReboot", { reason: "Drivers installed" });

    if (!data) {
        return (
            <Page>
                <PageHeader title="Hardware" icon={ICON} />
                {sub.error ? <ErrorText>{sub.error.errorText}</ErrorText> : <Row title="Looking at the hardware…"><Spinner /></Row>}
            </Page>
        );
    }
    const device = shown ? data.devices.find((d) => d.id === shown) : null;
    if (device) return <DeviceDetails key={device.id} device={device} onRestart={restart} />;

    const attention = data.devices.filter((d) => needsAttention(d) || d.status === "restart");
    const rest = data.devices.filter((d) => !attention.includes(d));
    const row = (d: HardwareDevice) => (
        <Row key={d.id} title={deviceTitle(d)} subtitle={statusText(d)} chevron testId={`hw-device-${d.id}`} onClick={() => setShown(d.id)}
             className={needsAttention(d) || d.status === "no-driver" ? "hw-attention" : undefined} />
    );
    const cat = data.catalog;
    return (
        <Page>
            <PageHeader title="Hardware" icon={ICON} />
            {data.pendingRestart.length > 0 && (
                <>
                    <Note testId="hw-restart-note">Restart the device to start the drivers you installed.</Note>
                    <Button data-testid="hw-restart-all" onClick={restart}>Restart Now</Button>
                </>
            )}
            {attention.length > 0 && <Group label="Needs attention">{attention.map(row)}</Group>}
            {CATEGORY_LABELS.map(([cats, label]) => {
                const ds = rest.filter((d) => cats.includes(d.category));
                return ds.length ? <Group key={label} label={label}>{ds.map(row)}</Group> : null;
            })}
            <Group label="Driver catalog">
                <Row title={cat.name ?? "No catalog"} testId="hw-catalog"
                     subtitle={cat.error ? cat.error.errorText : cat.refreshed ? `Checked ${new Date(cat.refreshed).toLocaleString()}` : undefined}
                     className={cat.error ? "hw-attention wrap-subtitle" : undefined} />
                <Button variant="dark" busy={refreshing} data-testid="hw-refresh"
                        onClick={() => { setRefreshing(true); void hardware.refresh().finally(() => setRefreshing(false)); }}>Check Again</Button>
            </Group>
            <OtherCatalogs data={data} />
            <Group label="Unsupported hardware">
                <Row title="Send hardware reports" subtitle="Anonymous: only the IDs of devices without a driver">
                    <ToggleButton value={data.report.enabled} label="Send hardware reports" testId="hw-report-toggle"
                                  onChange={(v) => void hardware.setPreferences({ reportEnabled: v })} />
                </Row>
                <Row title="See What Is Sent" chevron testId="hw-report-open" onClick={() => setReporting(true)}
                     subtitle={data.report.lastSent ? `Last sent ${new Date(data.report.lastSent).toLocaleDateString()}` : undefined} />
            </Group>
            <Note>
                Phoenix comes with open source drivers and the firmware its makers allow passing on, so most hardware works as it is.
                What it does not have is offered here; what is not open source is installed only after you accept its licence.
                The firmware's licences are in Device Info &gt; Open source licenses.
            </Note>
            {reporting && <ReportDialog onClose={() => setReporting(false)} />}
        </Page>
    );
}
