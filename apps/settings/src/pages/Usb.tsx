// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// USB (Phoenix; docs/M6-PLAN.md F4 item 8, after the webOS Archive's USB
// Settings and the older USB FlashMount OTG): drives plugged into the
// device's own USB port (host mode, with an OTG cable), how full they are,
// and Safely Remove, which writes them out and lets them go
// (org.webosphoenix.usb; on a device udisks2's Unmount and PowerOff).

import { usbDrives, type UsbDrive } from "@phoenix/luna";
import { useLuna } from "@phoenix/luna/react";
import { Button, Group, Note, Page, PageHeader, Row } from "@phoenix/ui";

export function sizeText(n: number): string {
    if (n >= 1e9) return `${(n / 1e9).toFixed(1)} GB`;
    if (n >= 1e6) return `${Math.round(n / 1e6)} MB`;
    return `${Math.round(n / 1e3)} KB`;
}

export function UsbPage() {
    const drives = useLuna<UsbDrive[]>((cb, err) => usbDrives.watch(cb, err), []).value;
    return (
        <Page>
            <PageHeader title="USB" icon="icons/usb.png" />
            {drives && drives.length === 0 && (
                <Note testId="usb-none">No USB drives. Plug one into this device's USB port with an OTG adapter.</Note>
            )}
            {drives && drives.map((d) => (
                <Group key={d.id} label={d.label || "USB drive"}>
                    <Row title={d.vendor || "USB drive"} testId={`usb-drive-${d.id}`}
                         subtitle={d.safeToRemove ? "Safe to remove" : `${sizeText(d.size - d.used)} free of ${sizeText(d.size)}`} />
                    {d.mounted && (
                        <div className="usb-meter" role="img" aria-label={`${Math.round((d.used / d.size) * 100)}% used`}>
                            <div className="usb-meter-used" style={{ width: `${Math.min(100, (d.used / d.size) * 100)}%` }} />
                        </div>
                    )}
                    {d.mounted
                        ? <Button data-testid={`usb-remove-${d.id}`} onClick={() => void usbDrives.unmount(d.id)}>Safely Remove</Button>
                        : <Button data-testid={`usb-mount-${d.id}`} onClick={() => void usbDrives.mount(d.id)}>Use Again</Button>}
                </Group>
            ))}
            <Note>Remove a drive safely before you unplug it, so nothing being written is lost.</Note>
        </Page>
    );
}
