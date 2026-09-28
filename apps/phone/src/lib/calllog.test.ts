// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import type { Call, Person } from "@phoenix/luna";
import { callType, groupByDay, isMissed, otherParty, recordFor } from "./calllog";

const ada: Person = { _id: "p1", _kind: "com.palm.person:1", name: { givenName: "Ada", familyName: "Palmer" },
    phoneNumbers: [{ value: "(408) 555-0142", type: "type_mobile" }] };
const base: Call = { id: 3, state: "disconnected", number: "+1 408 555 0142", direction: "incoming",
    startTime: 1_000_000, endTime: 1_095_000 };

describe("call log records", () => {
    it("classifies ended calls as webOS did", () => {
        expect(callType({ ...base, direction: "outgoing" })).toBe("outgoing");
        expect(callType({ ...base, connectTime: 1_005_000 })).toBe("incoming");
        expect(callType(base)).toBe("missed");
        expect(callType({ ...base, ignored: true })).toBe("ignored");
    });

    it("builds a com.palm.phonecall:1 record with the contact", () => {
        const r = recordFor({ ...base, connectTime: 1_005_000 }, [ada]);
        expect(r).toMatchObject({
            _id: "phonecall-1000000-3", _kind: "com.palm.phonecall:1", type: "incoming", duration: 90_000,
            timestamp: 1_000_000, timestampInSecs: 1000,
            from: { addr: "+1 408 555 0142", name: "Ada Palmer", personId: "p1", personAddressType: "type_mobile",
                    normalizedAddr: "24105558041", service: "com.palm.telephony" },
        });
        expect(otherParty(r).name).toBe("Ada Palmer");
    });

    it("puts the other party of an outgoing call in to[]", () => {
        const r = recordFor({ ...base, direction: "outgoing", number: "555-0100", name: "Voicemail" }, [ada]);
        expect(r.type).toBe("outgoing");
        expect(r.duration).toBe(0);
        expect(r.to[0]).toMatchObject({ addr: "555-0100", name: "Voicemail" });
        expect(otherParty(r).addr).toBe("555-0100");
        expect(isMissed(r)).toBe(false);
    });

    it("groups by calendar day", () => {
        const d = (day: number, h: number) => ({ timestamp: new Date(2026, 8, day, h).getTime() });
        const g = groupByDay([d(28, 15), d(28, 9), d(27, 22), d(20, 1)]);
        expect(g.map((x) => x.items.length)).toEqual([2, 1, 1]);
    });
});
