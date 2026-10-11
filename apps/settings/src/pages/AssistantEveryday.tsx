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
//
// And News (NewsFeeds): the feeds "what's the news" reads headlines from
// (RSS or Atom; lib/commands-facts.js: newsFeeds, setNewsFeeds): each with
// Remove, and an address to add.
//
// And Smart Home (SmartHome): the user's Home Assistant, which "turn off the
// lights", "set the thermostat to 70" and "lock the front door" go to
// (lib/commands-home.js: homeAssistant, setHomeAssistant,
// removeHomeAssistant): its address and a long-lived access token (made in
// Home Assistant under the user's profile, Security), checked before they
// are kept; the token sealed by the service and never shown again.

import { useEffect, useRef, useState } from "react";
import { assistant, type AssistantSettings, type HomeAssistantInfo, type NewsFeed, type SavedPlaceInfo } from "@phoenix/luna";
import { Button, Group, Note, PopupMenu, Row, Spinner, TextField, ToggleButton } from "@phoenix/ui";

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

// focus: opened on it (launch params {section: "news"}: the Assistant's "add one in Settings").
export function NewsFeeds({ off, focus }: { off: boolean; focus?: boolean }) {
    const [feeds, setFeeds] = useState<NewsFeed[] | null>(null);
    const [url, setUrl] = useState("");
    const [error, setError] = useState("");
    useEffect(() => { void assistant.newsFeeds().then((r) => setFeeds(r.feeds), () => setFeeds([])); }, []);
    const top = useRef<HTMLDivElement | null>(null), shown = useRef(false);
    useEffect(() => {
        if (!focus || !feeds || shown.current) return;
        shown.current = true;
        top.current?.scrollIntoView?.({ block: "start" });
    }, [focus, feeds]);
    const save = (next: NewsFeed[]) => assistant.setNewsFeeds(next).then(setFeeds, (e: Error) => setError(e.message));
    const add = () => {
        const u = url.trim();
        if (!/^https?:\/\/\S+$/i.test(u)) { setError("Enter a feed's address, starting with https://"); return; }
        setError("");
        setUrl("");
        void save([...(feeds ?? []), { title: u.replace(/^https?:\/\/(?:www\.)?/i, "").replace(/\/.*$/, ""), url: u }]);
    };
    return (
        <>
            <div ref={top} />
            <Group label="News">
                {(feeds ?? []).map((f, i) => (
                    <Row key={f.url} title={f.title || f.url} subtitle={f.url} disabled={off} testId={`as-feed-${i}`}>
                        <Button variant="dark" className="hw-small-button" disabled={off} data-testid={`as-feed-remove-${i}`}
                                onClick={() => void save((feeds ?? []).filter((x) => x.url !== f.url))}>Remove</Button>
                    </Row>
                ))}
                {feeds && feeds.length === 0 && <Row title="No feeds" subtitle={"“What’s the news” has nothing to read"} disabled testId="as-feeds-none" />}
                <div className="as-feed-add">
                    <TextField value={url} onChange={setUrl} onSubmit={add} label="Add a feed (RSS or Atom)" placeholder="https://" testId="as-feed-url" />
                    <Button variant="dark" disabled={off || !url.trim()} onClick={add} data-testid="as-feed-add">Add Feed</Button>
                </div>
            </Group>
            <Note testId="as-feeds-note">{error || "“What’s the news” reads the newest headlines from these."}</Note>
        </>
    );
}

// focus: opened on it (launch params {section: "home"}: the Assistant's "connect it in Settings").
export function SmartHome({ off, focus }: { off: boolean; focus?: boolean }) {
    const [info, setInfo] = useState<HomeAssistantInfo | null>(null);
    const [url, setUrl] = useState("");
    const [token, setToken] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    useEffect(() => {
        void assistant.homeAssistant().then((r) => { setInfo(r); if (r.url) setUrl(r.url); }, () => setInfo({ url: "", connected: false, entities: 0 }));
    }, []);
    const top = useRef<HTMLDivElement | null>(null), shown = useRef(false);
    useEffect(() => {
        if (!focus || !info || shown.current) return;
        shown.current = true;
        top.current?.scrollIntoView?.({ block: "start" });
    }, [focus, info]);
    const connect = () => {
        setBusy(true);
        setError("");
        assistant.setHomeAssistant(url.trim(), token.trim()).then((r) => { setInfo(r); setToken(""); }, (e: Error) => setError(e.message))
            .finally(() => setBusy(false));
    };
    const disconnect = () => { void assistant.removeHomeAssistant().then(() => setInfo({ url: info?.url ?? "", connected: false, entities: 0 })); };
    return (
        <>
            <div ref={top} />
            <Group label="Smart Home">
                {info?.connected ? (
                    <>
                        <Row title="Home Assistant" subtitle={`${info.url}${info.entities ? ` · ${info.entities} device${info.entities === 1 ? "" : "s"} and scenes` : ""}`}
                             disabled={off} testId="as-home-connected" />
                        <div className="as-feed-add">
                            <Button variant="dark" disabled={off} onClick={disconnect} data-testid="as-home-remove">Disconnect</Button>
                        </div>
                    </>
                ) : (
                    <div className="as-feed-add">
                        <TextField value={url} onChange={setUrl} label="Home Assistant address" placeholder="http://homeassistant.local:8123" testId="as-home-url" />
                        <TextField type="password" value={token} onChange={setToken} onSubmit={connect} label="Long-lived access token" placeholder="token" testId="as-home-token" />
                        <Button variant="dark" busy={busy} disabled={off || !url.trim() || !token.trim()} onClick={connect} data-testid="as-home-connect">Connect</Button>
                    </div>
                )}
            </Group>
            <Note testId="as-home-note">{error || (info?.connected
                ? "“Turn off the lights”, “set the thermostat to 70”, “is the front door locked?” and your scenes by name. Unlocking and opening are asked first."
                : "Lights, switches, the thermostat, locks and scenes, through your Home Assistant. Make a token in Home Assistant: your profile, Security, Long-lived access tokens.")}</Note>
        </>
    );
}
