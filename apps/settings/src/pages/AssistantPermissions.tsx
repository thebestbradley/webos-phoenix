// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Settings > Assistant, Permissions: what the Assistant may use beyond its
// commands (the Commands list below them). Location is the Assistant's row
// in Settings > Location Services (org.webosphoenix.service.location, appId
// org.webosphoenix.assistant): the same grant, changed from either page or
// from the Assistant's own "Allow" in a conversation. Off until allowed,
// and with Location Services off it says so (the switch is there).

import { location, locationPermissions, type LocationHandler, type LocationPermission } from "@phoenix/luna";
import { useLuna } from "@phoenix/luna/react";
import { Group, Row, ToggleButton } from "@phoenix/ui";

export const ASSISTANT_APP = "org.webosphoenix.assistant";

export function AssistantPermissions({ disabled }: { disabled?: boolean }) {
    const perms = useLuna<LocationPermission[]>((cb, err) => locationPermissions.watch(cb, err), []);
    const handlers = useLuna<Record<LocationHandler, boolean>>((cb, err) => location.watchHandlers(cb, err), []).value;
    const mine = (perms.value ?? []).find((p) => p.appId === ASSISTANT_APP);
    const servicesOff = !!handlers && !handlers.gps && !handlers.network;
    const subtitle = servicesOff ? "Location Services are off: turn them on in Settings > Location Services"
        : mine ? (mine.allowed ? "For the weather and distances where you are" : "Not allowed: say a city instead")
        : "Not asked yet: the Assistant asks the first time it needs it";
    return (
        <Group label="Permissions">
            <Row title="Location" subtitle={subtitle} testId="as-perm-location" disabled={disabled}>
                <ToggleButton value={!!mine?.allowed} label="Location" testId="as-perm-location-toggle" disabled={disabled || perms.value === undefined}
                              onChange={(v) => void locationPermissions.set(ASSISTANT_APP, v)} />
            </Row>
        </Group>
    );
}
