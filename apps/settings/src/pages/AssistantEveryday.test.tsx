// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Settings > Assistant, Messages & Driving (AssistantEveryday.tsx), against
// the simulated services and the Assistant's own service code run in the
// page: Announce Messages is the setting the Assistant reads, and Driving
// Mode the same mode "I'm driving" turns on (Do Not Disturb with it).

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { useEffect, useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";
import { assistant, call, type AssistantSettings } from "@phoenix/luna";
import { HomeAndWork, MessagesAndDriving, NewsFeeds, SmartHome } from "./AssistantEveryday";

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

function Page() {
    const [s, setS] = useState<AssistantSettings | null>(null);
    useEffect(() => { void assistant.settings().then(setS); }, []);
    if (!s) return null;
    return <MessagesAndDriving settings={s} off={false} set={(c) => { void assistant.setSettings(c).then(setS); }} />;
}

describe("Settings > Assistant: Messages & Driving", () => {
    it("turns announcing messages on, as the Assistant reads it", async () => {
        render(<Page />);
        const toggle = await screen.findByTestId("as-announce-toggle");
        expect(toggle.getAttribute("aria-checked")).toBe("false");
        fireEvent.click(toggle);
        await waitFor(async () => expect((await assistant.settings()).announceMessages).toBe(true));
        // The Assistant says so when asked.
        const r = (await call("luna://org.webosphoenix.assistant/ask", { text: "are you announcing my messages", newThread: true })) as unknown as R;
        expect(r.messages.at(-1).text).toMatch(/^Yes/);
    });
    it("turns driving mode on and off, the same mode the Assistant's words do", async () => {
        render(<Page />);
        const toggle = await screen.findByTestId("as-driving-toggle");
        await waitFor(() => expect((toggle as HTMLButtonElement).disabled).toBe(false));
        fireEvent.click(toggle);
        await waitFor(async () => expect((await assistant.driving()).on).toBe(true));
        const r = (await call("luna://org.webosphoenix.assistant/ask", { text: "am I in driving mode", newThread: true })) as unknown as R;
        expect(r.messages.at(-1).text).toMatch(/^Yes, driving mode has been on/);
        await call("luna://org.webosphoenix.assistant/ask", { text: "I'm done driving", newThread: true });
        expect((await assistant.driving()).on).toBe(false);
    });
});

describe("Settings > Assistant: Home & Work", () => {
    it("sets home to where the phone is, as Maps' saved Home, which the Assistant's reminders use", async () => {
        render(<HomeAndWork off={false} />);
        const home = await screen.findByTestId("as-place-home");
        // The row takes a tap once the saved places are read: until then it is
        // disabled (HomeAndWork: disabled={!places}) and says "Not set" either
        // way, so wait for the tap, not the words (on a busy machine the read is late).
        await waitFor(() => expect(home.getAttribute("aria-disabled")).toBeNull(), { timeout: 5000 });
        expect(home.textContent).toContain("Not set");
        fireEvent.click(home);
        fireEvent.click(await screen.findByRole("option", { name: "Set to Where I Am Now" }));
        // A fix first (the simulated GPS answers after 250 ms, runtime getLocationUpdates), then the
        // address: some 450 ms alone, past waitFor's own second on a busy machine (the whole suite at once).
        await waitFor(() => expect(screen.getByTestId("as-places-note").textContent).toMatch(/^OK, this is your home now/), { timeout: 5000 });
        await waitFor(() => expect(screen.getByTestId("as-place-home").textContent).not.toContain("Not set"));
        // A saved place in Maps called Home.
        const saved = (await call("luna://com.palm.db/find", { query: { from: "org.webosphoenix.maps.place:1" } })) as unknown as R;
        expect(saved.results.filter((p: { name: string }) => p.name === "Home")).toHaveLength(1);
        const r = (await call("luna://org.webosphoenix.assistant/ask", { text: "remind me to water the plants when I get home", newThread: true })) as unknown as R;
        expect(r.messages.at(-1).text).toBe("OK, I'll remind you to water the plants when you get home.");
        // The simulated phone leaves home and comes back: the activity
        // manager's trigger (getLocationUpdates inside the box, the runtime's)
        // wakes the Assistant each time, and Tasks is launched to remind.
        const rt = (window as unknown as { __phoenixRuntime: { location: { set(lat: number, lon: number): unknown }; activities: { list(): any[] } } }).__phoenixRuntime;
        const launches: any[] = [];
        const host = (window as unknown as { phoenixHost: { postToHost(kind: string, m: any): void } }).phoenixHost;
        host.postToHost = (kind: string, m: any) => { if (kind === "launch") launches.push(m); };
        const act = () => rt.activities.list().find((a) => /^assistant\.place\./.test(a.name));
        expect(act()?.trigger.or).toHaveLength(4);      // made at home: first it waits to be away
        const start = (await call("luna://com.webos.service.location/getLocationUpdates", {})) as unknown as R;
        rt.location.set(start.latitude + 0.01, start.longitude);      // a kilometre north
        await waitFor(() => expect(act()?.trigger.where).toHaveLength(4), { timeout: 5000 });
        rt.location.set(start.latitude, start.longitude);
        await waitFor(() => expect(launches.find((l) => l.id === "org.webosphoenix.tasks" && l.params.reminder)).toBeTruthy(), { timeout: 5000 });
        expect(act()).toBeUndefined();
        // Cleared.
        fireEvent.click(screen.getByTestId("as-place-home"));
        fireEvent.click(await screen.findByRole("option", { name: "Clear" }));
        await waitFor(() => expect(screen.getByTestId("as-place-home").textContent).toContain("Not set"));
    }, 20000);
});

describe("Settings > Assistant: News", () => {
    it("lists the feeds the news is read from, adds one and removes one", async () => {
        render(<NewsFeeds off={false} />);
        await waitFor(() => expect(screen.getByTestId("as-feed-0").textContent).toContain("BBC News"));
        fireEvent.change(screen.getByTestId("as-feed-url"), { target: { value: "https://news.example/rss.xml" } });
        fireEvent.click(screen.getByTestId("as-feed-add"));
        await waitFor(async () => expect((await assistant.newsFeeds()).feeds.map((f) => f.url)).toContain("https://news.example/rss.xml"));
        await waitFor(() => expect(screen.getByTestId("as-feed-2").textContent).toContain("news.example"));
        fireEvent.click(screen.getByTestId("as-feed-remove-0"));
        await waitFor(async () => expect((await assistant.newsFeeds()).feeds.map((f) => f.title)).toEqual(["NPR News", "news.example"]));
    });
});

describe("Settings > Assistant: Smart Home", () => {
    it("connects Home Assistant with its address and token, checked first, and disconnects it", async () => {
        // The Assistant's stand-in Home Assistant, reached through the page's fetch (the runtime's request).
        const ha = createRequire(import.meta.url)(resolve(REPO, "apps/assistant/service/test/home-assistant.cjs")).create();
        const real = globalThis.fetch;
        globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
            const proxied = String(input) === "/__phoenix/proxy";
            const req = proxied ? JSON.parse(String(init?.body)) : { url: String(input), method: init?.method, headers: init?.headers, body: init?.body };
            if (!String(req.url).startsWith(ha.URL)) return real(input, init);
            const r = await ha.request(req);
            return { status: r.status, json: async () => r, text: async () => r.body, headers: new Headers() } as unknown as Response;
        }) as typeof fetch;
        try {
            render(<SmartHome off={false} />);
            await waitFor(() => expect(screen.getByTestId("as-home-url")).toBeTruthy());
            fireEvent.change(screen.getByTestId("as-home-url"), { target: { value: ha.URL } });
            fireEvent.change(screen.getByTestId("as-home-token"), { target: { value: "not-the-token" } });
            fireEvent.click(screen.getByTestId("as-home-connect"));
            await waitFor(() => expect(screen.getByTestId("as-home-note").textContent).toMatch(/didn't take the access token/));
            fireEvent.change(screen.getByTestId("as-home-token"), { target: { value: ha.TOKEN } });
            fireEvent.click(screen.getByTestId("as-home-connect"));
            await waitFor(() => expect(screen.getByTestId("as-home-connected").textContent).toContain("10 devices"));
            expect((await assistant.homeAssistant()).connected).toBe(true);
            // What it connected to is what the Assistant's words reach.
            const r = (await call("luna://org.webosphoenix.assistant/ask", { text: "turn off the kitchen light", newThread: true })) as unknown as R;
            expect(r.messages.at(-1).text).toBe("Turned off the Kitchen Light.");
            expect(ha.find("light.kitchen").state).toBe("off");
            fireEvent.click(screen.getByTestId("as-home-remove"));
            await waitFor(async () => expect((await assistant.homeAssistant()).connected).toBe(false));
            await waitFor(() => expect(screen.getByTestId("as-home-token")).toBeTruthy());
        } finally {
            globalThis.fetch = real;
        }
    }, 20000);
});

describe("the Assistant in the page, with its data files", () => {
    it("reads the dictionary as Node would require it (the runtime's loader)", async () => {
        const r = (await call("luna://org.webosphoenix.assistant/ask", { text: "define ephemeral", newThread: true })) as unknown as R;
        expect(r.messages.at(-1).text).toMatch(/^Ephemeral, adjective: lasting a very short time\./);
    });
});
