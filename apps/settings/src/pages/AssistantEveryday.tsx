// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Settings > Assistant, Messages & Driving (docs/AI-AND-MCP.md, "Everyday
// features"; the service's lib/commands-notify.js):
//
//   Announce Messages   messages read aloud as they come while headphones
//                       are in (a wired headset, a Bluetooth headset); off
//                       by default ("announce my messages on my headphones")
//   Driving Mode        messages read aloud as they come, the reply
//                       listened for and read back before it is sent, the
//                       rest quiet (Do Not Disturb, back as it was after);
//                       "I'm driving", "I'm done driving"
//
// Both through org.webosphoenix.assistant: getSettings / setSettings
// (announceMessages) and driving.
//
// And Home & Work (HomeAndWork): where "remind me when I get home" and
// "when I leave work" mean, the saved places in Maps called "Home" and
// "Work" (the service's lib/commands-places.js: places, setPlace). Each
// row: set to where the phone is now, or cleared; Maps saves one from an
// address, renames and removes them.

import { useEffect, useRef, useState } from "react";
import { assistant, type AssistantSettings, type SavedPlaceInfo } from "@phoenix/luna";
import { Group, Note, PopupMenu, Row, Spinner, ToggleButton } from "@phoenix/ui";

export function MessagesAndDriving({ settings: s, set, off }: { settings: AssistantSettings; set: (c: Partial<AssistantSettings>) => void; off: boolean }) {
    const [driving, setDriving] = useState<boolean | null>(null);
    useEffect(() => {
        let live = true;
        assistant.driving().then((r) => { if (live) setDriving(r.on); }, () => { if (live) setDriving(false); });
        return () => { live = false; };
    }, []);
    const drive = (on: boolean) => {
        setDriving(on);
        assistant.driving(on).then((r) => setDriving(r.on), () => setDriving(!on));
    };
    return (
        <Group label="Messages & Driving">
            <Row title="Announce Messages" subtitle="Read messages aloud as they come while headphones are in" disabled={off} testId="as-announce">
                <ToggleButton value={!!s.announceMessages} label="Announce Messages" testId="as-announce-toggle" disabled={off}
                              onChange={(v) => set({ announceMessages: v })} />
            </Row>
            <Row title="Driving Mode" subtitle="Read messages aloud, take replies by voice, and keep everything else quiet" disabled={off} testId="as-driving">
                <ToggleButton value={!!driving} label="Driving Mode" testId="as-driving-toggle" disabled={off || driving === null}
                              onChange={drive} />
            </Row>
        </Group>
    );
}

type Where = "home" | "work";
type Places = { home: SavedPlaceInfo | null; work: SavedPlaceInfo | null };

// focus: opened on it (launch params {section: "places"}: the Assistant's "Home & Work Settings").
export function HomeAndWork({ off, focus }: { off: boolean; focus?: boolean }) {
    const [places, setPlaces] = useState<Places | null>(null);
    const [said, setSaid] = useState("");
    const [busy, setBusy] = useState<Where | null>(null);
    const [menu, setMenu] = useState<{ which: Where; anchor: HTMLElement } | null>(null);
    const rows = useRef<Record<Where, HTMLDivElement | null>>({ home: null, work: null });
    const load = () => assistant.places().then(setPlaces, () => setPlaces({ home: null, work: null }));
    useEffect(() => { void load(); }, []);
    const top = useRef<HTMLDivElement | null>(null), shown = useRef(false);
    useEffect(() => {
        if (!focus || !places || shown.current) return;
        shown.current = true;
        top.current?.scrollIntoView?.({ block: "start" });
    }, [focus, places]);
    const act = (which: Where, how: "here" | "clear") => {
        setMenu(null);
        setBusy(which);
        assistant.setPlace(which, how === "clear")
            .then((text) => setSaid(how === "clear" ? "" : text), (e: Error) => setSaid(e.message))
            .finally(() => { setBusy(null); void load(); });
    };
    const row = (which: Where, title: string) => {
        const p = places?.[which];
        return (
            <div ref={(el) => { rows.current[which] = el; }}>
                <Row title={title} subtitle={p ? p.detail || `${p.lat.toFixed(4)}, ${p.lon.toFixed(4)}` : "Not set"} disabled={off || !places}
                     testId={`as-place-${which}`} arrow onClick={() => { const el = rows.current[which]; if (el) setMenu({ which, anchor: el }); }}>
                    {busy === which ? <Spinner /> : null}
                </Row>
            </div>
        );
    };
    return (
        <>
            <div ref={top} />
            <Group label="Home & Work">
                {row("home", "Home")}
                {row("work", "Work")}
            </Group>
            <Note testId="as-places-note">{said || "For reminders like “when I get home” and “when I leave work”. They are your saved places in Maps called Home and Work: save one there from an address, or set it here to where you are now."}</Note>
            {menu && (
                <PopupMenu anchor={menu.anchor} onClose={() => setMenu(null)} onSelect={(v: "here" | "clear") => act(menu.which, v)}
                           options={[{ label: "Set to Where I Am Now", value: "here" as const },
                                     ...(places?.[menu.which] ? [{ label: "Clear", value: "clear" as const }] : [])]} />
            )}
        </>
    );
}
