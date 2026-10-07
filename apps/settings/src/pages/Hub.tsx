// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0

import { AppMenu, Group, Page, PageHeader, Row, iconSrcSet } from "@phoenix/ui";
import { tethering as tetheringService, type TetheringStatus } from "@phoenix/luna";
import { useLuna } from "@phoenix/luna/react";
import { PAGES, type PageId } from "./index";

/** Every pane in one list (the app launched without a page). */
export function Hub({ onOpen }: { onOpen: (id: PageId) => void }) {
    // Hotspot & Tethering where there is mobile data to share (phones).
    const tethering = useLuna<TetheringStatus>((cb, err) => tetheringService.watch(cb, err), []).value?.available !== false;
    const groups: { label: string; ids: PageId[] }[] = [
        { label: "Connections", ids: ["wifi", "bluetooth", "vpn", "airplane", "phone", ...(tethering ? ["hotspot" as const] : []), "dropshare"] },
        { label: "Device", ids: ["screen", "battery", "usb", "gamepads", "exhibition", "sounds", "datetime", "language", "textassist", "justtype", "clipboard", "assistant", "accessibility"] },
        { label: "Privacy & Safety", ids: ["location", "emergency", "certificates"] },
        { label: "About", ids: ["deviceinfo", "backup", "updates"] },
        { label: "Advanced", ids: ["advanced", "devmode"] },
    ];
    return (
        <Page>
            <AppMenu items={[
                { label: "Device Info", onSelect: () => onOpen("deviceinfo") },
                { label: "Updates", onSelect: () => onOpen("updates") },
            ]} />
            <PageHeader title="Settings" icon="icon.png" />
            {groups.map((g) => (
                <Group key={g.label} label={g.label}>
                    {g.ids.map((id) => (
                        <Row key={id} title={PAGES[id].title} chevron onClick={() => onOpen(id)} testId={`hub-${id}`}
                             icon={<img src={PAGES[id].icon} srcSet={iconSrcSet(PAGES[id].icon)} sizes="32px"
                                             width={32} height={32} alt="" />} />
                    ))}
                </Group>
            ))}
        </Page>
    );
}
