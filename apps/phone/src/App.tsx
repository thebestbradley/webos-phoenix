// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Phone: dial pad, call log and favourites, switched with the command-menu
// buttons at the bottom as in the webOS phone app; the in-call and
// incoming-call screens take over the card while a call is up.
//
// Tablet (1024 wide): the dial pad stays on the left and the log or the
// favourites fill the right, as the TouchPad's "Phone & Video Calls" did.
//
// Launch params: {number: "..."} fills in the dial pad (tel: links).

import { useEffect, useMemo, useState } from "react";
import { primaryCall, ringingCall, telephony, type Call } from "@phoenix/luna";
import { useLaunchParams } from "@phoenix/luna/react";
import { AppMenu, BackProvider, RadioToolGroup, ToolBar, dialable, useBack } from "@phoenix/ui";
import { callLog, otherParty, type PhoneCall } from "./lib/calllog";
import { useCallBookkeeping, useCallStatus, usePeople, useVoicemail, useWide } from "./lib/hooks";
import { Dialer } from "./views/Dialer";
import { CallLog } from "./views/CallLog";
import { Favorites } from "./views/Favorites";
import { InCall } from "./views/InCall";
import { Incoming } from "./views/Incoming";

type Tab = "dial" | "log" | "favorites";

/** A call that just ended, shown as "Call Ended" for a moment. */
function useJustEnded(calls: readonly Call[]): Call | null {
    const [, force] = useState(0);
    const ended = calls.filter((c) => c.state === "disconnected" && c.endTime && Date.now() - c.endTime < 1500
        && (c.direction === "outgoing" || c.connectTime))
        .sort((a, b) => (b.endTime ?? 0) - (a.endTime ?? 0))[0] ?? null;
    useEffect(() => {
        if (!ended) return;
        const t = setTimeout(() => force((n) => n + 1), Math.max(0, 1500 - (Date.now() - (ended.endTime ?? 0))) + 20);
        return () => clearTimeout(t);
    }, [ended]);
    return ended;
}

function useLastDialed(): string | undefined {
    const [last, setLast] = useState<string>();
    useEffect(() => {
        const sub = callLog.watch(false, (calls: PhoneCall[]) => {
            const out = calls.find((c) => c.type === "outgoing");
            setLast(out ? dialable(otherParty(out).addr) : undefined);
        });
        return () => sub.cancel();
    }, []);
    return last;
}

function Phone() {
    const status = useCallStatus();
    const people = usePeople();
    const voicemail = useVoicemail();
    const wide = useWide();
    const params = useLaunchParams<{ number?: string }>();
    const [tab, setTab] = useState<Tab>("dial");
    const [number, setNumber] = useState(params.number ? dialable(params.number) : "");
    const [error, setError] = useState<string | null>(null);
    const lastDialed = useLastDialed();
    useCallBookkeeping(status.calls, people);

    useEffect(() => {
        if (params.number) {
            setNumber(dialable(params.number));
            setTab("dial");
        }
    }, [params]);

    const ringing = ringingCall(status.calls);
    const justEnded = useJustEnded(status.calls);
    const current = primaryCall(status.calls) ?? justEnded;

    const dial = (n: string) => {
        const d = dialable(n);
        if (!d) return;
        setError(null);
        telephony.dial(d).then(() => setNumber(""), (e) => setError(e.errorText ?? "Call failed"));
    };
    const callVoicemail = () => { if (voicemail?.number) dial(voicemail.number); };
    const callBack = (n: string) => dial(n);

    // Back from the log or favourites returns to the dial pad.
    useBack(() => { setTab("dial"); return true; }, !wide && tab !== "dial" && !current && !ringing);
    useEffect(() => { if (error) { const t = setTimeout(() => setError(null), 4000); return () => clearTimeout(t); } }, [error]);

    const tabs = useMemo(() => [
        ...(wide ? [] : [{ value: "dial" as Tab, label: "Dial Pad" }]),
        { value: "log" as Tab, label: "Call Log" },
        { value: "favorites" as Tab, label: "Favorites" },
    ], [wide]);

    if (ringing)
        return <div className="phone-root call-screen"><Incoming call={ringing} people={people} waiting={!!primaryCall(status.calls)} /></div>;
    if (current)
        return <div className="phone-root call-screen"><InCall key={current.id} status={status} call={current} people={people} /></div>;

    const dialer = (
        <Dialer number={number} setNumber={(n) => { setNumber(n); setError(null); }} people={people} error={error}
                onDial={dial} onVoicemail={callVoicemail} lastDialed={lastDialed} keyboard={wide || tab === "dial"} />
    );
    const shownTab: Tab = wide && tab === "dial" ? "log" : tab;
    const list = shownTab === "log"
        ? <CallLog people={people} voicemail={voicemail} onCall={callBack} onVoicemail={callVoicemail} />
        : shownTab === "favorites" ? <Favorites people={people} onCall={callBack} /> : null;

    return (
        <div className={`phone-root${wide ? " wide" : ""}`}>
            <AppMenu items={[
                { label: "Dial Pad", onSelect: () => setTab("dial") },
                { label: "Call Log", onSelect: () => setTab("log") },
                { label: "Favorites", onSelect: () => setTab("favorites") },
            ]} />
            {wide ? (
                <>
                    <div className="phone-left">{dialer}</div>
                    <div className="phone-right">{list}</div>
                </>
            ) : (
                <div className="phone-main">{shownTab === "dial" ? dialer : list}</div>
            )}
            <ToolBar dark className={wide ? "phone-toolbar wide" : "phone-toolbar"}>
                <RadioToolGroup testId="phone-tabs" value={shownTab} onChange={setTab} options={tabs} />
            </ToolBar>
        </div>
    );
}

export function App() {
    return (
        <BackProvider>
            <Phone />
        </BackProvider>
    );
}
