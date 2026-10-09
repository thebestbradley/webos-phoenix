// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Settings > Assistant > Permissions: the Location row is the Assistant's
// grant in Settings > Location Services (org.webosphoenix.service.location),
// against the simulated services and the Assistant's own service code run in
// the page: the Assistant asking in a conversation, the row and Location
// Services' list showing the same answer, and the row changing it.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";
import { call } from "@phoenix/luna";
import { AssistantPermissions, ASSISTANT_APP } from "./AssistantPermissions";

type PS = { getResource(p: string): string | undefined; appIdentifier: string };
type R = { returnValue: boolean; [k: string]: any };
const ps = () => (window as unknown as { PalmSystem: PS }).PalmSystem;
const REPO = resolve(__dirname, "../../../..");

beforeAll(() => {
    (window as unknown as Record<string, unknown>).phoenixHost = { postToHost: () => {} };
    new Function(readFileSync(resolve(REPO, "runtime/phoenix-runtime.js"), "utf8")).call(window);
    const base = ps().getResource.bind(ps());
    ps().getResource = (p) => {
        const m = /^\/usr\/palm\/services\/org\.webosphoenix\.assistant\/(.+)$/.exec(p);
        if (m) {
            try { return readFileSync(resolve(REPO, "apps/assistant/service", m[1]), "utf8"); } catch { return undefined; }
        }
        return base(p);
    };
    ps().appIdentifier = "org.webosphoenix.settings";
});
beforeAll(async () => { await call("luna://com.palm.applicationManager/listLaunchPoints", {}); }, 30000);

const mine = async () => ((await call("luna://org.webosphoenix.service.location/getPermissions", {})) as unknown as R)
    .permissions.find((p: R) => p.appId === ASSISTANT_APP);

describe("Settings > Assistant: Permissions", () => {
    it("Location: asked in a conversation, the same grant as Location Services', changed from the row", async () => {
        render(<AssistantPermissions />);
        await waitFor(() => expect(screen.getByTestId("as-perm-location").textContent).toMatch(/Not asked yet/));
        // The Assistant asks before it uses the position, in the conversation.
        const r = (await call("luna://org.webosphoenix.assistant/ask", { text: "what's the weather", newThread: true })) as unknown as R;
        const q = r.messages.at(-1);
        expect(q.text).toBe("To check the weather where you are, I need your location. Is it OK if I use it?");
        await call("luna://org.webosphoenix.assistant/choose", { threadId: r.thread.id, messageId: q.id, choice: "do:1" });
        expect(await mine()).toMatchObject({ allowed: false });
        await waitFor(() => expect(screen.getByTestId("as-perm-location").textContent).toMatch(/Not allowed/));
        // The row allows it: Location Services' list says so too.
        fireEvent.click(screen.getByTestId("as-perm-location-toggle"));
        await waitFor(() => expect(screen.getByTestId("as-perm-location").textContent).toMatch(/For the weather/));
        expect((await mine()).allowed).toBe(true);
        // The Assistant's calls are its own (not the page's): allowed, it has the position.
        const fix = (await call("luna://com.webos.service.location/getLocationUpdates", {})) as unknown as R;
        expect(typeof fix.latitude).toBe("number");
        // Location Services off: the row says so.
        await call("luna://com.webos.service.location/setState", { Handler: "gps", state: false });
        await call("luna://com.webos.service.location/setState", { Handler: "network", state: false });
        await waitFor(() => expect(screen.getByTestId("as-perm-location").textContent).toMatch(/Location Services are off/));
        await call("luna://com.webos.service.location/setState", { Handler: "gps", state: true });
    });

    it("OSE's service has no getCurrentPosition: an unknown method, not a position-less success", async () => {
        await expect(call("luna://com.webos.service.location/getCurrentPosition", {})).rejects.toMatchObject({ errorText: expect.stringMatching(/Unknown method/) });
    });
});
