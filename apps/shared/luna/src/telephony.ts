// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Voice calls: the legacy webOS telephony service, com.palm.telephony.
//
// webOS OSE has no telephony. LuneOS (webOS-ports) reimplemented the legacy
// service on oFono as webos-telephonyd; Phoenix codes against it:
//
//   dial {number, blockId}, answer {id}, ignore {id}, hangup {id}
//       webOS-ports/webos-telephonyd src/telephonyservice.c (method table)
//       and src/telephonyservice_call.c (parameters)
//   isTelephonyReady, powerQuery, networkStatusQuery, platformQuery
//       same method table; also what luna-systemui's TelephonyService.js
//       subscribes to (third_party/luna-systemui/data/TelephonyService.js)
//
// telephonyd has no call-state notification on the bus: the LuneOS phone app
// (webOS-ports/org.webosports.app.phone, qml/services/VoiceCallMgrWrapper.qml)
// talks to oFono's VoiceCallManager directly. Phoenix therefore adds a few
// methods to the same service, named like the legacy *Query/*Set methods and
// shaped after oFono's D-Bus API (ofono doc/voicecall-api.txt,
// voicecallmanager-api.txt, call-volume-api.txt, message-waiting-api.txt):
//
//   callStatusQuery {subscribe}  -> {calls: [Call], muted, speaker}
//   hold {id}, unhold {id}       -> VoiceCallManager.SwapCalls / HoldAndAnswer
//   sendDtmf {tones}             -> VoiceCallManager.SendTones
//   muteSet {mute}               -> CallVolume.Muted
//   speakerSet {speaker}         -> the audio route (earpiece / speaker)
//   voicemailQuery {subscribe}   -> MessageWaiting (VoicemailWaiting,
//                                   VoicemailMessageCount, VoicemailMailboxNumber)
//
// The simulator implements all of them (runtime/phoenix-runtime.js,
// "Phone and Messaging services").

import { call, subscribe, type LunaError, type Subscription } from "./bridge";

const TEL = "luna://com.palm.telephony";

/** oFono VoiceCall "State". */
export type CallState = "incoming" | "waiting" | "dialing" | "alerting" | "active" | "held" | "disconnected";

export interface Call {
    /** Call id for answer/ignore/hangup/hold. */
    id: number;
    state: CallState;
    /** The other party's number (oFono LineIdentification). */
    number: string;
    /** Caller name from the network, if any (oFono Name / CNAP). */
    name?: string;
    direction: "incoming" | "outgoing";
    /** When the call started ringing or dialing (ms since epoch). */
    startTime: number;
    /** When it was answered (ms since epoch). */
    connectTime?: number;
    /** When it ended. */
    endTime?: number;
    /** Why it ended (oFono VoiceCall.DisconnectReason): local, remote or network. */
    disconnectReason?: "local" | "remote" | "network";
    /** Set when an incoming call was declined with ignore. */
    ignored?: boolean;
}

export interface CallStatus {
    calls: Call[];
    muted: boolean;
    speaker: boolean;
}

export interface VoicemailStatus {
    number: string;
    waiting: boolean;
    count: number;
}

type OnError = (e: LunaError) => void;

export const telephony = {
    /** callStatusQuery {subscribe}: every call and its state; replies again on each change. */
    watchCalls(cb: (s: CallStatus) => void, onError?: OnError): Subscription {
        return subscribe(`${TEL}/callStatusQuery`, {}, (r) => {
            const s = r as unknown as Partial<CallStatus>;
            cb({ calls: s.calls ?? [], muted: !!s.muted, speaker: !!s.speaker });
        }, onError);
    },
    /** dial {number, blockId}: place a call. blockId hides caller ID. */
    dial(number: string, blockId = false) {
        return call(`${TEL}/dial`, { number, blockId });
    },
    /** answer {id} */
    answer(id: number) {
        return call(`${TEL}/answer`, { id });
    },
    /** ignore {id}: decline an incoming call. */
    ignore(id: number) {
        return call(`${TEL}/ignore`, { id });
    },
    /** hangup {id} */
    hangup(id: number) {
        return call(`${TEL}/hangup`, { id });
    },
    /** hold {id} (Phoenix, oFono SwapCalls) */
    hold(id: number) {
        return call(`${TEL}/hold`, { id });
    },
    /** unhold {id} (Phoenix) */
    unhold(id: number) {
        return call(`${TEL}/unhold`, { id });
    },
    /** sendDtmf {tones} (Phoenix, oFono SendTones) */
    sendDtmf(tones: string) {
        return call(`${TEL}/sendDtmf`, { tones });
    },
    /** muteSet {mute} (Phoenix, oFono CallVolume.Muted) */
    setMuted(mute: boolean) {
        return call(`${TEL}/muteSet`, { mute });
    },
    /** speakerSet {speaker} (Phoenix) */
    setSpeaker(speaker: boolean) {
        return call(`${TEL}/speakerSet`, { speaker });
    },
    /** voicemailQuery {subscribe} (Phoenix, oFono MessageWaiting) */
    watchVoicemail(cb: (v: VoicemailStatus) => void, onError?: OnError): Subscription {
        return subscribe(`${TEL}/voicemailQuery`, {}, (r) => {
            const v = r as unknown as Partial<VoicemailStatus>;
            cb({ number: v.number ?? "", waiting: !!v.waiting, count: v.count ?? 0 });
        }, onError);
    },
};

/** Calls that are still up or ringing. */
export function liveCalls(calls: readonly Call[]): Call[] {
    return calls.filter((c) => c.state !== "disconnected");
}

/** The call the in-call screen is about: the active one, else the one being set up, else a held one. */
export function primaryCall(calls: readonly Call[]): Call | null {
    const live = liveCalls(calls);
    const order: CallState[] = ["active", "dialing", "alerting", "held"];
    for (const st of order) {
        const c = live.find((x) => x.state === st);
        if (c) return c;
    }
    return null;
}

/** An incoming (or waiting) call that has not been answered yet. */
export function ringingCall(calls: readonly Call[]): Call | null {
    return liveCalls(calls).find((c) => c.state === "incoming" || c.state === "waiting") ?? null;
}
