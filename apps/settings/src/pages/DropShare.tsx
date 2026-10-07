// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// DropShare (Phoenix; docs/M6-PLAN.md F4 item 8): whether files may go to
// and from other devices on the network through DropShare's one-time
// address (system preference dropShareEnabled, off by default), and a way
// in to receive files. The DropShare app does the sharing
// (org.webosphoenix.dropshare); the share sheet sends with it, and Touch
// to Share hands its address to a phone.

import { apps, system, type SystemPreferences } from "@phoenix/luna";
import { useLuna } from "@phoenix/luna/react";
import { Button, Group, Note, Page, PageHeader, Row, ToggleButton } from "@phoenix/ui";

export function DropSharePage() {
    const prefs = useLuna<SystemPreferences>((cb, err) => system.watchPreferences(["dropShareEnabled"], cb, err), []).value;
    const on = !!prefs?.dropShareEnabled;
    return (
        <Page>
            <PageHeader title="DropShare" icon="icons/dropshare.png" />
            <Group>
                <Row title="DropShare" subtitle="Send and receive files with phones and computers nearby">
                    <ToggleButton value={on} disabled={!prefs} label="DropShare" testId="ds-enabled"
                                  onChange={(v) => void system.setPreferences({ dropShareEnabled: v })} />
                </Row>
            </Group>
            <Note>The device shows a QR code of a web address on this Wi-Fi network. A phone or computer that opens it, in any
                browser, sends files here (they go into Downloads) or downloads the ones you share. Nothing goes through the internet.</Note>
            {on && (
                <Button variant="affirmative" data-testid="ds-receive" onClick={() => void apps.launch("org.webosphoenix.dropshare")}>
                    Receive Files</Button>
            )}
            <Note>To send, share a file and choose DropShare, or touch a webOS phone to the device in DropShare. Each address works
                once: it stops after the transfer, after ten minutes without use, or when you close DropShare.</Note>
        </Page>
    );
}
