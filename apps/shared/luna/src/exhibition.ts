// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Exhibitions: dock mode on the Touchstone (docs/APP-RUNTIME.md
// "Exhibitions"). The legacy webOS APIs luna-sysmgr served:
//   com.palm.systemmanager getDockModeStatus {subscribe} -> {enabled}
//       (SystemService.cpp:1913-1990): whether dock mode is up.
//   com.palm.applicationManager listDockModeLaunchPoints, addDockModeLaunchPoint
//       {appId}, removeDockModeLaunchPoint {appId}
//       (ApplicationManagerService.cpp:2486-2985): the apps that can be
//       exhibitions (appinfo.json "exhibitionMode") and the ones turned on;
//       Phoenix adds setDockModeLaunchPoints {appIds} (the order) and
//       {subscribe: true} on the list.
// An exhibition app is launched with {dockMode: true, windowType:
// "dockModeWindow"} (isExhibitionLaunch), and told when it comes to the front
// of dock mode or leaves it ("phoenixcardactivation").

import { call, subscribe, type LunaError, type Subscription } from "./bridge";
import type { DockModeLaunchPoint } from "./types";

type OnError = (e: LunaError) => void;

const SM = "luna://com.palm.systemmanager";
const AM = "luna://com.palm.applicationManager";

/** dockModeMaxApps (luna-sysmgr Settings.cpp:183). */
export const DOCK_MODE_MAX_APPS = 3;

/** The launch params dock mode starts an exhibition with. */
export function isExhibitionLaunch(params: unknown): boolean {
    const p = (params ?? {}) as { dockMode?: unknown; windowType?: unknown };
    return p.dockMode === true || p.windowType === "dockModeWindow";
}

export const dockMode = {
    /** getDockModeStatus {subscribe}: true while dock mode is up. */
    watch(cb: (enabled: boolean) => void, onError?: OnError): Subscription {
        return subscribe(`${SM}/getDockModeStatus`, {}, (r) => cb(r.enabled === true), onError);
    },
    async status(): Promise<boolean> {
        return (await call(`${SM}/getDockModeStatus`, {})).enabled === true;
    },
    /** listDockModeLaunchPoints {subscribe}: every app that can be an exhibition. */
    watchLaunchPoints(cb: (points: DockModeLaunchPoint[], maxApps: number) => void, onError?: OnError): Subscription {
        return subscribe(`${AM}/listDockModeLaunchPoints`, {}, (r) =>
            cb((r.launchPoints ?? []) as DockModeLaunchPoint[], typeof r.maxApps === "number" ? r.maxApps : DOCK_MODE_MAX_APPS), onError);
    },
    async launchPoints(): Promise<DockModeLaunchPoint[]> {
        return ((await call(`${AM}/listDockModeLaunchPoints`, {})).launchPoints ?? []) as DockModeLaunchPoint[];
    },
    /** addDockModeLaunchPoint {appId}: on, last in the menu. */
    enable(appId: string) {
        return call(`${AM}/addDockModeLaunchPoint`, { appId });
    },
    /** removeDockModeLaunchPoint {appId} */
    disable(appId: string) {
        return call(`${AM}/removeDockModeLaunchPoint`, { appId });
    },
    /** setDockModeLaunchPoints {appIds} (Phoenix): the ones on, in the menu's order. */
    setEnabled(appIds: string[]) {
        return call(`${AM}/setDockModeLaunchPoints`, { appIds });
    },
};
