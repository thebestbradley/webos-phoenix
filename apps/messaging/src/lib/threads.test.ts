// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import type { ImBuddy, ImLoginState, Message, Person } from "@phoenix/luna";
import { buddyFor, buddyRecipient, chatItems, groupBuddies, presenceText, suggestBuddies, suggestRecipients, typedRecipient } from "./threads";

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

describe("buddies", () => {
    const buddy = (username: string, displayName: string, availability: number, status = ""): ImBuddy => ({
        _kind: "com.palm.imbuddystatus:1", accountId: "acc", serviceName: "type_jabber", username, displayName, availability, status,
    });
    const roster = [buddy("theo@chat.example", "Theo Lindqvist", 4), buddy("marcus@chat.example", "Marcus Reyes", 2, "In a meeting"),
                    buddy("lena@chat.example", "Lena Okafor", 0), buddy("ada@chat.example", "Ada Palmer", 0, "Flashing a Pre 3")];
    const accounts: ImLoginState[] = [{ _kind: "com.palm.imloginstate:1", accountId: "acc", username: "me@chat.example",
                                        serviceName: "type_jabber", state: "online", availability: 0 }];

    it("groups them under Available, Busy and Offline, by name", () => {
        expect(groupBuddies(roster).map((g) => [g.label, g.buddies.map((b) => b.displayName)])).toEqual([
            ["Available", ["Ada Palmer", "Lena Okafor"]], ["Busy", ["Marcus Reyes"]], ["Offline", ["Theo Lindqvist"]]]);
    });

    it("says their presence and status, but not an offline one's", () => {
        expect(presenceText(roster[1])).toBe("Busy: In a meeting");
        expect(presenceText(roster[2])).toBe("Available");
        expect(presenceText({ availability: 4, status: "gone fishing" })).toBe("Offline");
        expect(presenceText(undefined)).toBe("Offline");
    });

    it("finds a conversation's buddy, and makes a buddy a recipient on their account", () => {
        expect(buddyFor({ replyService: "type_jabber", replyAddress: "ADA@chat.example" }, roster)?.displayName).toBe("Ada Palmer");
        expect(buddyFor({ replyService: "sms", replyAddress: "ada@chat.example" }, roster)).toBeUndefined();
        expect(buddyRecipient(roster[3], accounts)).toMatchObject({ addr: "ada@chat.example", service: "type_jabber",
                                                                     account: "me@chat.example", label: "Jabber (XMPP)" });
    });

    it("suggests buddies of signed-in accounts in To:", () => {
        expect(suggestBuddies(roster, accounts, "le").map((r) => r.name)).toEqual(["Lena Okafor"]);
        expect(suggestBuddies(roster, accounts, "marcus@").map((r) => r.addr)).toEqual(["marcus@chat.example"]);
        expect(suggestBuddies(roster, [{ ...accounts[0], state: "offline" }], "le")).toEqual([]);
    });
});
