// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// What other apps ask Phone for, from its launch params: the one place they
// are read (docs/LAUNCH-CONTRACTS.md); appinfo.json "phoenix.launchParams"
// lists the keys (tools/check-launch-contracts.cjs checks every caller).
//
// Phoenix's:
//   {number}                 on the dial pad
//   {number, dial: true}     called at once (Voice Dial after "yes", the Assistant)
//   {target: "tel:..."}      a tel: link (@phoenix/luna links.ts): on the dial pad
//   {emergency: true}        the lock screen's emergency calls (views/Emergency)
//
// The original webOS callers' (com.palm.app.phone):
//   {address, transport: "com.palm.telephony", video?}
//       Contacts' phone number tapped (core-apps com.palm.app.contacts
//       app/PseudoDetailsInApp.js:342-351, 367-369; the contacts framework's
//       PseudoDetails.js and DetailsInDialog.js the same) and Just Type's
//       "Call" on a contact's number ({address, personId, label, service:
//       "phone", transport}, luna-applauncher data/AppLauncher.js:55-67).
//       Both are the call itself: Contacts gives the number row the call
//       and the icon beside it the text message (phoneActionIconClick), and
//       on webOS a tapped number placed the call. So it is called at once.
//   {address, transport: "com.palm.skype" | "com.palm.skype.call", video}
//       a Skype voice or video call (Contacts' Skype menu, :327-332; Just
//       Type, AppLauncher.js:70-89). Phoenix has no Skype: a dialable
//       address goes on the dial pad, anything else is not called.
//   {action: "voicemail"}    Just Type's "1" (AppLauncher.js:56-57): voicemail is called.
//   {preferences: true}      the phone preferences (luna-systemui
//                            TelephonyAlerts.js:59-67): the runtime opens
//                            Settings' Phone page instead (APP_ROUTES); here too.
//   {number}                 the webOS SDK's documented launch, on the dial pad.

import { telTarget } from "@phoenix/luna";

/** The keys read here: appinfo.json "phoenix.launchParams" must list the same. */
export const LAUNCH_PARAMS = ["number", "dial", "target", "emergency",
                              "address", "transport", "video", "personId", "label", "service", "action", "preferences"] as const;

export interface PhoneLaunchParams {
    number?: string;
    dial?: boolean;
    target?: string;
    emergency?: boolean;
    address?: string;
    transport?: string;
    video?: boolean;
    personId?: string;
    label?: string;
    service?: string;
    action?: string;
    preferences?: boolean;
    [key: string]: unknown;
}

export type PhoneIntent =
    | { kind: "none" }
    /** The number on the dial pad. */
    | { kind: "show"; number: string }
    /** The number called. */
    | { kind: "call"; number: string }
    | { kind: "voicemail" }
    | { kind: "preferences" }
    | { kind: "emergency" };

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
/** A phone number as it can be dialed: digits, +, *, #, pauses and the like, with at least one digit. */
const dialable = (s: string) => /^[0-9+*#()\-.\s,;pPwWxX/]+$/.test(s) && /\d/.test(s);

export function parseLaunch(p: PhoneLaunchParams | null | undefined): PhoneIntent {
    if (!p || typeof p !== "object") return { kind: "none" };
    if (p.emergency === true) return { kind: "emergency" };
    if (p.preferences === true) return { kind: "preferences" };
    if (p.action === "voicemail") return { kind: "voicemail" };
    const number = str(p.number);
    if (number) return p.dial === true ? { kind: "call", number } : { kind: "show", number };
    const address = str(p.address);
    if (address) {
        const transport = str(p.transport);
        const telephony = !transport || transport === "com.palm.telephony";
        if (telephony && dialable(address)) return { kind: "call", number: address };
        return dialable(address) ? { kind: "show", number: address } : { kind: "none" };
    }
    const tel = telTarget(p.target);
    if (tel) return { kind: "show", number: tel };
    return { kind: "none" };
}
