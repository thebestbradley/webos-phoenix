// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import appinfo from "../public/appinfo.json";
import { LAUNCH_PARAMS, parseLaunch } from "./launchParams";

describe("Phone's launch params", () => {
    it("lists in appinfo.json the keys it reads (tools/check-launch-contracts.cjs)", () => {
        expect([...appinfo.phoenix.launchParams].sort()).toEqual([...LAUNCH_PARAMS].sort());
    });

    it("reads Phoenix's own: a number on the dial pad, or called; a tel: link", () => {
        expect(parseLaunch({ number: "5550100" })).toEqual({ kind: "show", number: "5550100" });
        expect(parseLaunch({ number: "5550100", dial: true })).toEqual({ kind: "call", number: "5550100" });
        expect(parseLaunch({ target: "tel:+1-555-0100" })).toEqual({ kind: "show", number: "+1-555-0100" });
        expect(parseLaunch({ emergency: true })).toEqual({ kind: "emergency" });
        expect(parseLaunch({})).toEqual({ kind: "none" });
    });

    it("calls a number tapped in Contacts: {address, transport: com.palm.telephony} (PseudoDetailsInApp.js:342-369)", () => {
        expect(parseLaunch({ address: "(212) 555-0164", transport: "com.palm.telephony" })).toEqual({ kind: "call", number: "(212) 555-0164" });
    });

    it("calls Just Type's Call on a contact's number, and voicemail for its \"1\" (AppLauncher.js:55-67)", () => {
        expect(parseLaunch({ address: "4085550142", personId: "p", label: "type_mobile", service: "phone", transport: "com.palm.telephony" }))
            .toEqual({ kind: "call", number: "4085550142" });
        expect(parseLaunch({ action: "voicemail", transport: "com.palm.telephony" })).toEqual({ kind: "voicemail" });
    });

    it("does not call a Skype address: a dialable one goes on the dial pad", () => {
        expect(parseLaunch({ address: "ada.palmer", transport: "com.palm.skype", video: true })).toEqual({ kind: "none" });
        expect(parseLaunch({ address: "+14085550142", transport: "com.palm.skype.call" })).toEqual({ kind: "show", number: "+14085550142" });
    });

    it("reads {preferences: true} as the phone preferences (TelephonyAlerts.js:59-67)", () => {
        expect(parseLaunch({ preferences: true })).toEqual({ kind: "preferences" });
    });
});
