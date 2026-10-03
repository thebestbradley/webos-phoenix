// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Settings > Exhibition against the simulated services: turning
// exhibitions on and off (at most three), their order, when dock mode
// starts, night mode, sounds and the dock wallpaper, as the shell hears them.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { BackProvider } from "../nav";
import { ExhibitionPage, moved } from "./Exhibition";

const hostMessages: { type: string; payload: Record<string, unknown> }[] = [];
const APPS = ["org.webosphoenix.photos:Photos", "org.webosphoenix.agenda:Agenda", "com.example.weatherwall:Weather",
              "com.example.lamp:Lamp"].map((s) => {
    const [id, title] = s.split(":");
    return { id, launchPointId: `${id}_default`, title, icon: `/usr/palm/applications/${id}/icon.png`,
             exhibitionMode: true, dockMode: true, exhibitionModeTitle: title };
});

beforeAll(() => {
    const w = window as unknown as Record<string, unknown>;
    w.phoenixHost = { postToHost: (type: string, payload: Record<string, unknown>) => hostMessages.push({ type, payload }) };
    new Function(readFileSync(resolve(__dirname, "../../../../runtime/phoenix-runtime.js"), "utf8")).call(window);
    const files: Record<string, string> = { "/usr/share/phoenix/apps.json": JSON.stringify(APPS) };
    (w.PalmSystem as { getResource: (p: string) => string | undefined }).getResource = (p: string) => files[p];
});

beforeEach(() => {
    localStorage.clear();
    hostMessages.length = 0;
});

const lastStatus = () => [...hostMessages].reverse().find((m) => m.type === "systemStatus")?.payload;
const page = () => render(<BackProvider><ExhibitionPage /></BackProvider>);
const checkbox = (id: string) => screen.getByTestId(`exhibition-check-${id}`);

describe("Settings > Exhibition", () => {
    it("moves an exhibition up or down", () => {
        expect(moved(["a", "b", "c"], "c", -1)).toEqual(["a", "c", "b"]);
        expect(moved(["a", "b", "c"], "a", -1)).toEqual(["a", "b", "c"]);
        expect(moved(["a", "b"], "a", 1)).toEqual(["b", "a"]);
    });

    it("lists the exhibitions, Time first and always on, Photos on at first", async () => {
        page();
        await waitFor(() => expect(screen.getByTestId("exhibition-app-org.webosphoenix.photos")).toBeTruthy());
        expect(screen.getByTestId("exhibition-app-time").textContent).toContain("Time");
        expect(checkbox("org.webosphoenix.photos").className).toContain("checked");
        expect(checkbox("com.example.lamp").className).not.toContain("checked");
    });

    it("turns them on, three at most, and orders them", async () => {
        page();
        await waitFor(() => expect(checkbox("org.webosphoenix.agenda")).toBeTruthy());
        fireEvent.click(checkbox("org.webosphoenix.agenda"));
        await waitFor(() => expect(lastStatus()?.exhibitionApps).toEqual(["org.webosphoenix.photos", "org.webosphoenix.agenda"]));
        fireEvent.click(checkbox("com.example.weatherwall"));
        await waitFor(() => expect((lastStatus()?.exhibitionApps as string[]).length).toBe(3));
        // Full: the fourth cannot be turned on.
        await waitFor(() => expect((checkbox("com.example.lamp") as HTMLButtonElement).disabled).toBe(true));
        expect(screen.getByText(/Up to 3 exhibitions/)).toBeTruthy();
        // Agenda first.
        fireEvent.click(screen.getByTestId("exhibition-up-org.webosphoenix.agenda"));
        await waitFor(() => expect(lastStatus()?.exhibitionApps).toEqual(["org.webosphoenix.agenda", "org.webosphoenix.photos", "com.example.weatherwall"]));
        // Photos off: Lamp can come on.
        fireEvent.click(checkbox("org.webosphoenix.photos"));
        await waitFor(() => expect(lastStatus()?.exhibitionApps).toEqual(["org.webosphoenix.agenda", "com.example.weatherwall"]));
        await waitFor(() => expect((checkbox("com.example.lamp") as HTMLButtonElement).disabled).toBe(false));
    });

    it("sets when it starts, night mode and sounds", async () => {
        page();
        await waitFor(() => expect(screen.getByTestId("exhibition-start")).toBeTruthy());
        fireEvent.click(screen.getByTestId("exhibition-start"));
        fireEvent.click(await screen.findByText("After 1 minute"));
        await waitFor(() => expect(lastStatus()?.exhibition).toMatchObject({ enabled: true, startAfter: 60 }));
        fireEvent.click(screen.getByTestId("exhibition-night").querySelector("[role=switch], button")!);
        await waitFor(() => expect(lastStatus()?.exhibition).toMatchObject({ nightMode: true, nightStart: "22:00", nightEnd: "07:00" }));
        fireEvent.click(screen.getByTestId("exhibition-night-start"));
        fireEvent.click(await screen.findByText("11:00 PM"));
        await waitFor(() => expect(lastStatus()?.exhibition).toMatchObject({ nightStart: "23:00" }));
        fireEvent.click(screen.getByTestId("exhibition-sounds"));
        fireEvent.click(await screen.findByText("Silent"));
        await waitFor(() => expect(lastStatus()?.dockModeSound).toBe("mute"));
    });

    it("picks dock mode's own wallpaper", async () => {
        page();
        await waitFor(() => expect(screen.getByTestId("exhibition-wallpaper")).toBeTruthy());
        expect(screen.getByTestId("exhibition-wallpaper").textContent).toContain("None");
        fireEvent.click(screen.getByTestId("exhibition-wallpaper"));
        fireEvent.click(await screen.findByTestId("dock-wallpaper-Dusk"));
        await waitFor(() => expect(lastStatus()?.dockWallpaperFile).toBe("/usr/palm/applications/org.webosphoenix.settings/wallpapers/dusk.jpg"));
        // The main wallpaper is not touched.
        expect(lastStatus()?.wallpaperFile).toBe("");
        await waitFor(() => expect(screen.getByTestId("exhibition-wallpaper").textContent).toContain("Dusk"));
    });

    it("hides the rest while exhibitions are off", async () => {
        page();
        await waitFor(() => expect(screen.getByTestId("exhibition-enabled")).toBeTruthy());
        await act(async () => {
            fireEvent.click(screen.getByTestId("exhibition-enabled").querySelector("[role=switch], button")!);
        });
        await waitFor(() => expect(lastStatus()?.exhibition).toMatchObject({ enabled: false }));
        await waitFor(() => expect(screen.queryByTestId("exhibition-start")).toBeNull());
        expect(screen.queryByTestId("exhibition-app-time")).toBeNull();
    });
});
