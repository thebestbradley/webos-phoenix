// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Location Services, after the webOS 2.x Location Services preferences
// ("Auto Locate", "GPS", "Google Services"): Location Services on or off,
// how the position is found (GPS; network location, the lookup legacy
// webOS called "Google Services"), where the device is now, and the apps
// that asked for the position, each allowed or not.
// Services:
//   com.webos.service.location getAllLocationHandlers / setState {Handler, state}
//       / getLocationUpdates (one fix) / getReverseLocation (OSE)
//   org.webosphoenix.service.location getPermissions / setPermission /
//       removePermission (Phoenix: OSE has no per-app location permission)

import { useEffect, useState } from "react";
import {
    formatCoordinates, location, locationPermissions, LunaError, LOCATION_ERRORS,
    type LocationFix, type LocationHandler, type LocationPermission, type ReverseLocation,
} from "@phoenix/luna";
import { useLuna } from "@phoenix/luna/react";
import { Divider, Group, ListSelector, Note, Page, PageHeader, Row, Spinner, ToggleButton, shortWhen } from "@phoenix/ui";

type Access = "allow" | "deny" | "ask";

function usePosition(handlers: Record<LocationHandler, boolean> | undefined) {
    const [state, setState] = useState<{ fix?: LocationFix; place?: ReverseLocation | null; error?: string } | null>(null);
    const key = handlers ? `${handlers.gps}-${handlers.network}` : "";
    useEffect(() => {
        if (!handlers) return;
        let live = true;
        setState(null);
        location.currentPosition().then(async (fix) => {
            const place = await location.reverse(fix.latitude, fix.longitude).catch(() => null);
            if (live) setState({ fix, place });
        }, (e: LunaError) => {
            if (live) setState({ error: e.errorCode === LOCATION_ERRORS.LOCATION_OFF ? "Location services are off" : e.errorText });
        });
        return () => { live = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key]);
    return state;
}

export function LocationPage() {
    const handlers = useLuna<Record<LocationHandler, boolean>>((cb, err) => location.watchHandlers(cb, err), []).value;
    const apps = useLuna<LocationPermission[]>((cb, err) => locationPermissions.watch(cb, err), []).value ?? [];
    const position = usePosition(handlers);
    const on = !!handlers && (handlers.gps || handlers.network);

    const setAccess = (appId: string, a: Access) =>
        void (a === "ask" ? locationPermissions.remove(appId) : locationPermissions.set(appId, a === "allow"));

    const where = position?.fix
        ? `${position.place ? position.place.locality + ", " + position.place.region : formatCoordinates(position.fix.latitude, position.fix.longitude, 4)}`
        : undefined;
    const how = position?.fix
        ? `${position.fix.handler === "gps" ? "GPS" : "Network"}, within ${Math.round(position.fix.horizAccuracy)} m`
        : undefined;

    return (
        <Page>
            <PageHeader title="Location Services" icon="icons/location.png" />
            <Group>
                <Row title="Location services">
                    <ToggleButton value={on} disabled={!handlers} label="Location services" testId="location-toggle"
                                  onChange={(v) => void location.setEnabled(v)} />
                </Row>
            </Group>

            {handlers && !on && (
                <Note>Apps cannot find where you are. Emergency calls can still send your position where the network asks for it.</Note>
            )}

            {on && (
                <>
                    <Group label="Find my location with">
                        <Row title="GPS" subtitle="Satellites: exact, outdoors">
                            <ToggleButton value={!!handlers?.gps} label="GPS" testId="gps-toggle"
                                          onChange={(v) => void location.setHandler("gps", v)} />
                        </Row>
                        <Row title="Network location" subtitle="Wi-Fi and cell towers">
                            <ToggleButton value={!!handlers?.network} label="Network location" testId="network-toggle"
                                          onChange={(v) => void location.setHandler("network", v)} />
                        </Row>
                    </Group>
                    <Group label="This device">
                        <Row testId="current-location" title={where ?? (position?.error ?? "Finding your location…")}
                             subtitle={how}>
                            {!position && <Spinner />}
                        </Row>
                    </Group>
                </>
            )}

            <Divider caption="Apps" />
            {apps.length === 0 ? (
                <Note>No app has asked for your location yet. An app asks the first time it needs it.</Note>
            ) : (
                <Group>
                    {apps.map((a) => (
                        <ListSelector<Access> key={a.appId} testId={`app-${a.appId}`}
                                              title={<>{a.title}<div className="pui-row-subtitle">
                                                  {a.lastUsed ? `Last used ${shortWhen(a.lastUsed)}` : "Not used yet"}</div></>}
                                              value={a.allowed ? "allow" : "deny"}
                                              options={[{ label: "Allowed", value: "allow" }, { label: "Not allowed", value: "deny" },
                                                        { label: "Ask next time", value: "ask" }]}
                                              onChange={(v) => setAccess(a.appId, v)} />
                    ))}
                </Group>
            )}
            <Note>Your position stays on this device unless an app you allow sends it somewhere. Change an answer here at any time.</Note>
        </Page>
    );
}
