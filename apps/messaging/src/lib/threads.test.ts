// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import type { Message, Person } from "@phoenix/luna";
import { chatItems, suggestRecipients, typedRecipient } from "./threads";

const msg = (id: string, minutes: number, folder: "inbox" | "outbox"): Message => ({
    _id: id, _kind: "com.palm.smsmessage:1", folder, serviceName: "sms", messageText: id,
    localTimestamp: minutes * 60000, timestamp: minutes * 60000,
});

const people: Person[] = [
    { _id: "a", _kind: "com.palm.person:1", name: { givenName: "Ada", familyName: "Palmer" },
      phoneNumbers: [{ value: "(408) 555-0142", type: "type_mobile" }] },
    { _id: "m", _kind: "com.palm.person:1", name: { givenName: "Marcus", familyName: "Reyes" },
      phoneNumbers: [{ value: "(650) 555-0187", type: "type_mobile" }, { value: "(650) 555-0110", type: "type_work" }] },
    { _id: "p", _kind: "com.palm.person:1", name: { givenName: "Priya", familyName: "Nair" } },
];

describe("chatItems", () => {
    it("puts a time stamp first and after quiet gaps", () => {
        const items = chatItems([msg("a", 0, "inbox"), msg("b", 2, "outbox"), msg("c", 3, "outbox"), msg("d", 40, "inbox")]);
        expect(items.map((i) => i.kind === "time" ? "T" : i.key)).toEqual(["T", "a", "b", "c", "T", "d"]);
    });
    it("marks the last message of each run", () => {
        const items = chatItems([msg("a", 0, "inbox"), msg("b", 1, "inbox"), msg("c", 2, "outbox")]);
        const last = items.filter((i) => i.kind === "message").map((i) => i.kind === "message" && i.last);
        expect(last).toEqual([false, true, true]);
    });
});

describe("recipients", () => {
    it("suggests contacts by any word of their name, one entry per number", () => {
        expect(suggestRecipients(people, "rey").map((r) => `${r.name} ${r.label}`)).toEqual(["Marcus Reyes Mobile", "Marcus Reyes Work"]);
        expect(suggestRecipients(people, "ada")[0]).toMatchObject({ addr: "(408) 555-0142", personId: "a" });
        expect(suggestRecipients(people, "pri")).toEqual([]);   // no phone number
        expect(suggestRecipients(people, "")).toEqual([]);
    });
    it("suggests by digits", () => {
        expect(suggestRecipients(people, "5550110").map((r) => r.label)).toEqual(["Work"]);
    });
    it("accepts a typed number", () => {
        expect(typedRecipient("555-0177")).toEqual({ addr: "555-0177" });
        expect(typedRecipient("sam")).toBeNull();
        expect(typedRecipient("12")).toBeNull();
    });
});
