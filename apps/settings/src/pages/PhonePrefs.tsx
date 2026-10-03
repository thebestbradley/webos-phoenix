// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Phone Preferences: the phone-era preferences, as webOS's Phone Preferences had them
// (com.palm.app.phone shared/phoneprefs, opened from the Phone app's menu;
// launch params {page: "phone"}):
//
//   Calls         Call Forwarding (unconditional, to a number), Show My
//                 Caller ID, Call Waiting: settings kept by the network,
//                 read from it ("Reading from network") and unavailable
//                 without it (CallsPref.js)
//   Voicemail     the voicemail number (VoicemailNumberPref.js)
//   Network       Data Usage and Data Roaming (com.palm.wan), Voice Network
//                 (roaming: Carrier Only or Automatic) and Network Type
//                 (2G, 3G, Automatic) (NetworkPref.js)
//
// @phoenix/luna phonePrefs and mobileData. While call forwarding is on, the
// status bar shows its icon and calls go to the other number.

import { useEffect, useState } from "react";
import { LunaError, mobileData, phonePrefs, TELEPHONY_NO_NETWORK, type CallForwarding, type MobileData, type NetworkType, type VoiceRoaming } from "@phoenix/luna";
import { useLuna } from "@phoenix/luna/react";
import { Button, ErrorText, Group, ListSelector, Note, Page, PageHeader, Row, Spinner, TextField, ToggleButton } from "@phoenix/ui";

const NO_NETWORK = "You need a network connection to your wireless service provider to see some settings.";
const why = (e: unknown) => (e instanceof LunaError && e.errorCode === TELEPHONY_NO_NETWORK ? NO_NETWORK : e instanceof LunaError ? e.errorText : String(e));
/** What a forwarding number may hold (forwardRegister keeps digits, + * #). */
export const forwardable = (n: string) => n.replace(/[^0-9+*#]/g, "").length >= 3;

/** A setting the network keeps: read once, then set; null while reading. */
function useNetworkSetting(read: () => Promise<boolean>, write: (v: boolean) => Promise<unknown>) {
    const [value, setValue] = useState<boolean | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    useEffect(() => {
        let live = true;
        read().then((v) => { if (live) setValue(v); }, (e) => { if (live) setError(why(e)); });
        return () => { live = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    const set = async (v: boolean) => {
        const before = value;
        setValue(v);
        setBusy(true);
        try { await write(v); setError(null); } catch (e) { setValue(before); setError(why(e)); } finally { setBusy(false); }
    };
    return { value, error, busy, set };
}

function NetworkToggle({ title, s, testId }: { title: string; s: ReturnType<typeof useNetworkSetting>; testId: string }) {
    if (s.value === null)
        return <Row title={title} subtitle={s.error ?? "Reading from network"} testId={`${testId}-status`} className="wrap-subtitle">{!s.error && <Spinner />}</Row>;
    return (
        <Row title={title} subtitle={s.error ?? undefined}>
            <ToggleButton value={s.value} label={title} testId={testId} disabled={s.busy} onChange={(v) => void s.set(v)} />
        </Row>
    );
}

function Forwarding() {
    const f = useLuna<CallForwarding>((cb, err) => phonePrefs.watchForwarding(cb, err), []);
    const [on, setOn] = useState<boolean | null>(null);
    const [number, setNumber] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const state = f.value;
    if (!state)
        return <Row title="Call Forwarding" subtitle={f.error ? why(f.error) : "Reading from network"} testId="phone-forward-status" className="wrap-subtitle">{!f.error && <Spinner />}</Row>;
    const shownOn = on ?? state.activated;
    const typed = number ?? state.number;
    const register = async (n: string) => {
        setBusy(true);
        setError(null);
        try {
            await phonePrefs.setForwarding(n);
            setOn(null);
            setNumber(null);
        } catch (e) {
            setOn(null);
            setError(why(e));
        } finally {
            setBusy(false);
        }
    };
    return (
        <>
            <Row title="Call Forwarding" subtitle={state.activated ? `To ${state.number}` : undefined}>
                <ToggleButton value={shownOn} label="Call Forwarding" testId="phone-forward" disabled={busy}
                              onChange={(v) => {
                                  setOn(v);
                                  // On with a number already: forward at once; off: stop.
                                  if (!v) void register("");
                                  else if (forwardable(typed)) void register(typed);
                              }} />
            </Row>
            {shownOn && (
                <div className="pui-row phone-forward-number">
                    <TextField value={typed} type="tel" placeholder="Enter Number" testId="phone-forward-number"
                               onChange={setNumber} onSubmit={() => { if (forwardable(typed)) void register(typed); }} />
                    {(typed !== state.number || !state.activated) && (
                        <Button variant="affirmative" disabled={busy || !forwardable(typed)} data-testid="phone-forward-save"
                                onClick={() => void register(typed)}>Forward Calls</Button>
                    )}
                </div>
            )}
            {error && <ErrorText testId="phone-forward-error">{error}</ErrorText>}
        </>
    );
}

function VoicemailNumber() {
    const saved = useLuna<string>((cb, err) => phonePrefs.watchVoicemailNumber(cb, err), []).value;
    const [typed, setTyped] = useState<string | null>(null);
    const value = typed ?? saved ?? "";
    const save = () => { if (typed !== null && typed !== saved) void phonePrefs.setVoicemailNumber(typed).then(() => setTyped(null)); };
    return (
        <div className="pui-row phone-forward-number">
            <TextField value={value} type="tel" placeholder={saved === undefined ? "Waiting for network" : "Voicemail number"}
                       testId="phone-voicemail" onChange={setTyped} onSubmit={save} />
            {typed !== null && typed !== saved && (
                <Button variant="affirmative" data-testid="phone-voicemail-save" onClick={save}>Save</Button>
            )}
        </div>
    );
}

function Choice<T extends string>({ title, read, write, options, testId }: {
    title: string; read: () => Promise<T>; write: (v: T) => Promise<unknown>; options: { label: string; value: T }[]; testId: string;
}) {
    const [value, setValue] = useState<T | null>(null);
    useEffect(() => {
        let live = true;
        read().then((v) => { if (live) setValue(v); }, () => {});
        return () => { live = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return <ListSelector<T> title={title} value={value ?? options[0].value} options={options} testId={testId} disabled={value === null}
                            onChange={(v) => { setValue(v); void write(v); }} />;
}

export function PhonePrefsPage() {
    const callerId = useNetworkSetting(phonePrefs.callerIdShown, phonePrefs.setCallerIdShown);
    const waiting = useNetworkSetting(phonePrefs.callWaiting, phonePrefs.setCallWaiting);
    const data = useLuna<MobileData>((cb, err) => mobileData.watch(cb, err), []).value;
    return (
        <Page>
            <PageHeader title="Phone Preferences" icon="icons/phoneprefs.png" />
            <Group label="Calls">
                <Forwarding />
                <NetworkToggle title="Show My Caller ID" s={callerId} testId="phone-callerid" />
                <NetworkToggle title="Call Waiting" s={waiting} testId="phone-waiting" />
            </Group>
            <Group label="Voicemail Number">
                <VoicemailNumber />
            </Group>
            <Group label="Network">
                <Row title="Data Usage" subtitle="Mobile data for the internet">
                    <ToggleButton value={data?.enabled ?? true} disabled={!data} label="Data Usage" testId="phone-data"
                                  onChange={(v) => void mobileData.setEnabled(v)} />
                </Row>
                <ListSelector<string> title="Data Roaming" value={data?.roaming ? "on" : "off"} disabled={!data} testId="phone-roaming"
                                      options={[{ label: "Enabled", value: "on" }, { label: "Disabled", value: "off" }]}
                                      onChange={(v) => void mobileData.setRoaming(v === "on")} />
                <Choice<VoiceRoaming> title="Voice Network" read={phonePrefs.voiceRoaming} write={phonePrefs.setVoiceRoaming} testId="phone-voice-roaming"
                                      options={[{ label: "Automatic", value: "automatic" }, { label: "Carrier Only", value: "carrieronly" }]} />
                <Choice<NetworkType> title="Network Type" read={phonePrefs.networkType} write={phonePrefs.setNetworkType} testId="phone-network-type"
                                     options={[{ label: "Automatic", value: "automatic" }, { label: "3G", value: "umts" }, { label: "2G", value: "gsm" }]} />
            </Group>
            <Note>With Data Roaming disabled, apps use the internet abroad only over Wi-Fi; your carrier may charge for roaming data.</Note>
        </Page>
    );
}
