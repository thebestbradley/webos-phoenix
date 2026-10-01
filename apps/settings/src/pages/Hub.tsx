// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0

import { AppMenu, Group, Page, PageHeader, Row } from "@phoenix/ui";
import { PAGES, type PageId } from "./index";

/** Every pane in one list (the app launched without a page). */
export function Hub({ onOpen }: { onOpen: (id: PageId) => void }) {
    const groups: { label: string; ids: PageId[] }[] = [
        { label: "Connections", ids: ["wifi", "bluetooth", "vpn", "airplane"] },
        { label: "Device", ids: ["screen", "sounds", "datetime", "language", "accessibility"] },
        { label: "Privacy & Safety", ids: ["location", "emergency"] },
        { label: "About", ids: ["deviceinfo", "backup", "updates"] },
        { label: "Advanced", ids: ["devmode"] },
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
                             icon={<img src={PAGES[id].icon} width={32} height={32} alt="" />} />
                    ))}
                </Group>
            ))}
        </Page>
    );
}
