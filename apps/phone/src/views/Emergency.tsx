// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Phone's restricted mode, for the lock screen: the PIN pad's "Emergency
// Call" opens this page as the shell's emergency window (luna-sysmgr's
// EmergencyWindowManager showed the phone app's Type_Emergency window above
// the lock screen the same way). With the device still locked it may only:
//
//   - dial emergency numbers (3GPP's list and the region's own, see
//     isEmergencyNumber in @phoenix/luna), with no contact look-up and no
//     call log, favourites, voicemail or last-number recall;
//   - show the owner's Medical ID (Settings > Emergency Info) when they
//     allowed it on the lock screen, and call their emergency contacts;
//   - carry the call on the usual in-call screen.
//
// Cancel (or the back gesture) closes the window: back to the PIN pad.
// Launched as index.html with {emergency: true} as its launch params.

import { useEffect, useState } from "react";
import {
    emergencyInfo, hasEmergencyInfo, isEmergencyNumber, primaryCall, primaryEmergencyNumber, settings, telephony,
    type Call, type EmergencyInfo,
} from "@phoenix/luna";
import { useLaunchParams, useLuna } from "@phoenix/luna/react";
import { BackspaceButton, Button, DialButton, Dialpad, dialable, formatNumber, useBack } from "@phoenix/ui";
import { callLog, recordFor } from "../lib/calllog";
import { useCallStatus } from "../lib/hooks";
import { InCall } from "./InCall";

/** Is this page Phone's restricted (lock screen) mode? */
export function useEmergencyMode(): boolean {
    return !!useLaunchParams<{ emergency?: boolean }>().emergency;
}

function closeWindow() {
    window.close();
}

/** The country of the UI locale ("en-US" -> "us"). */
function useCountry(): string {
    const locale = useLuna<{ localeInfo?: { locales?: { UI?: string } } }>(
        (cb, err) => settings.watch("", ["localeInfo"], cb as never, err), []).value;
    const ui = locale?.localeInfo?.locales?.UI ?? "en-US";
    return (ui.split("-")[1] ?? "us").toLowerCase();
}

function age(birth?: string): number | null {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birth ?? "");
    if (!m) return null;
    const now = new Date();
    let a = now.getFullYear() - +m[1];
    if (now.getMonth() + 1 < +m[2] || (now.getMonth() + 1 === +m[2] && now.getDate() < +m[3])) a--;
    return a >= 0 && a < 150 ? a : null;
}

function MedicalId({ info, onCall, onClose }: { info: EmergencyInfo; onCall: (n: string) => void; onClose: () => void }) {
    useBack(() => { onClose(); return true; });
    const years = age(info.birthDate);
    const facts: [string, string | undefined][] = [
        ["Medical conditions", info.conditions],
        ["Allergies and reactions", info.allergies],
        ["Medications", info.medications],
        ["Notes", info.notes],
    ];
    return (
        <div className="emergency-medical" data-testid="medical-id">
            <div className="emergency-medical-head">
                <span className="emergency-star" aria-hidden />
                <div>
                    <div className="emergency-medical-title">Medical ID</div>
                    <div className="emergency-medical-name" data-testid="medical-name">{info.name || "Name not given"}</div>
                </div>
            </div>
            <div className="emergency-medical-scroll">
                <div className="emergency-facts">
                    {years !== null && <div><span>Age</span>{years}</div>}
                    {info.bloodType && <div><span>Blood type</span>{info.bloodType}</div>}
                    {info.organDonor && <div><span>Organ donor</span>Yes</div>}
                </div>
                {facts.filter(([, v]) => v && v.trim()).map(([k, v]) => (
                    <div key={k} className="emergency-fact">
                        <div className="emergency-fact-label">{k}</div>
                        <div className="emergency-fact-text">{v}</div>
                    </div>
                ))}
                {(info.contacts ?? []).length > 0 && <div className="emergency-fact-label contacts">Emergency contacts</div>}
                {(info.contacts ?? []).map((c, i) => (
                    <button key={i} type="button" className="emergency-ice" data-testid={`ice-call-${i}`} onClick={() => onCall(c.number)}>
                        <span className="emergency-ice-body">
                            <span className="emergency-ice-name">{c.name}</span>
                            <span className="emergency-ice-sub">{c.relation ? `${c.relation} · ` : ""}{formatNumber(c.number)}</span>
                        </span>
                        <span className="emergency-ice-call">Call</span>
                    </button>
                ))}
            </div>
            <div className="emergency-actions">
                <Button variant="dark" onClick={onClose} data-testid="medical-back">Back</Button>
            </div>
        </div>
    );
}

export function EmergencyPhone() {
    const status = useCallStatus();
    const country = useCountry();
    const info = useLuna<EmergencyInfo>((cb, err) => emergencyInfo.watch(cb, err), []).value;
    const [number, setNumber] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [medical, setMedical] = useState(false);
    const [ours, setOurs] = useState<Set<number>>(new Set());
    const [ended, setEnded] = useState<Call | null>(null);

    const showMedical = !!info && info.showWhenLocked !== false && hasEmergencyInfo(info);
    const allowed = new Set((showMedical ? info!.contacts ?? [] : []).map((c) => dialable(c.number)));
    const current = primaryCall(status.calls);
    const call = current && ours.has(current.id) ? current : null;

    // Calls placed here go in the call log (the same record Phone writes;
    // its _id makes a second write by Phone's own page harmless).
    useEffect(() => {
        for (const c of status.calls) {
            if (!ours.has(c.id) || c.state !== "disconnected") continue;
            void callLog.add(recordFor(c, [])).catch(() => {});
            setEnded(c);
            setOurs((s) => { const n = new Set(s); n.delete(c.id); return n; });
        }
    }, [status.calls, ours]);
    useEffect(() => {
        if (!ended) return;
        const t = setTimeout(() => setEnded(null), 1500);
        return () => clearTimeout(t);
    }, [ended]);
    useEffect(() => { if (error) { const t = setTimeout(() => setError(null), 5000); return () => clearTimeout(t); } }, [error]);

    useBack(() => { closeWindow(); return true; }, !medical && !call);

    const dial = (n: string) => {
        const d = dialable(n);
        if (!d) return;
        if (!isEmergencyNumber(d, country) && !allowed.has(d)) {
            setError("Only emergency numbers can be called while the phone is locked.");
            setNumber("");
            return;
        }
        setError(null);
        telephony.dial(d).then(() => {
            setNumber("");
            setMedical(false);
            // dial does not answer with the call's id: the next status has it.
            setOurs((s) => new Set(s).add(-1));
        }, (e) => setError(e.errorText ?? "Call failed"));
    };
    // Adopt the call just dialled.
    useEffect(() => {
        if (!ours.has(-1)) return;
        const c = status.calls.find((x) => x.direction === "outgoing" && x.state !== "disconnected");
        if (c) setOurs((s) => { const n = new Set(s); n.delete(-1); n.add(c.id); return n; });
    }, [status.calls, ours]);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (medical || call || e.ctrlKey || e.metaKey || e.altKey) return;
            if (/^[0-9*#+]$/.test(e.key)) setNumber((n) => (n.length < 20 ? n + e.key : n));
            else if (e.key === "Backspace") setNumber((n) => n.slice(0, -1));
            else if (e.key === "Enter") dial(number);
            else return;
            e.preventDefault();
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    });

    if (call || ended)
        return <div className="phone-root call-screen emergency-root"><InCall key={(call ?? ended)!.id} status={status} call={(call ?? ended)!} people={[]} /></div>;

    if (medical && showMedical)
        return <div className="phone-root emergency-root"><MedicalId info={info!} onCall={dial} onClose={() => setMedical(false)} /></div>;

    const primary = primaryEmergencyNumber(country);
    const shown = formatNumber(number);
    return (
        <div className="phone-root emergency-root" data-testid="emergency">
            <div className="dialer">
                <div className="dialer-display emergency-display">
                    <div className="dialer-contact emergency-title" data-testid="emergency-title">
                        {error ? <span className="dialer-error" role="alert">{error}</span> : "Emergency calls only"}
                    </div>
                    <div className="dialer-number-row">
                        <div className={`dialer-number${number ? "" : " empty"}`} data-testid="number-display">
                            {shown || `Dial ${primary} for help`}
                        </div>
                        {number && <BackspaceButton testId="backspace" onClick={() => setNumber(number.slice(0, -1))} onHold={() => setNumber("")} />}
                    </div>
                </div>
                <Dialpad testId="dialpad" voicemailKey={false} onKey={(k) => setNumber(number.length < 20 ? number + k : number)} />
                <div className="dialer-dial emergency-dial">
                    <DialButton testId="dial-button" onClick={() => (number ? dial(number) : setNumber(primary))}
                                label={number ? `Call ${shown}` : `Call ${primary}`} />
                    <div className="emergency-actions">
                        {showMedical && (
                            <Button variant="dark" className="emergency-medical-button" data-testid="medical-id-button"
                                    onClick={() => setMedical(true)}>
                                <span className="emergency-star small" aria-hidden /> Medical ID
                            </Button>
                        )}
                        <Button variant="dark" onClick={closeWindow} data-testid="emergency-cancel">Cancel</Button>
                    </div>
                </div>
            </div>
        </div>
    );
}
