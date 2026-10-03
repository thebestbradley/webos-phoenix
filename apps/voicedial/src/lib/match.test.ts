// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import type { Person } from "@phoenix/luna";
import { decide, matchPeople, nameScore, numberTypeLabel, parseAnswer, parseCommand, personWithNumber, pickNumber,
         promptFor } from "./match";

const person = (id: string, given: string, family: string, phones: [string, string][], extra: Partial<Person> = {}): Person => ({
    _id: id, _kind: "com.palm.person:1", name: { givenName: given, familyName: family },
    phoneNumbers: phones.map(([type, value]) => ({ type, value })), ...extra,
});

// The simulator's sample contacts (runtime/sample-data.js).
const PEOPLE: Person[] = [
    person("ada", "Ada", "Palmer", [["type_mobile", "(408) 555-0142"]]),
    person("marcus", "Marcus", "Reyes", [["type_mobile", "(650) 555-0187"], ["type_work", "(650) 555-0110"]]),
    person("priya", "Priya", "Nair", [["type_mobile", "(415) 555-0123"]]),
    person("lena", "Lena", "Okafor", [["type_mobile", "(212) 555-0164"]]),
    person("jonah", "Jonah", "Whitfield", [["type_home", "(408) 555-0199"]]),
    person("sam", "Sam", "Delgado", [["type_mobile", "(303) 555-0135"]]),
    person("theo", "Theo", "Lindqvist", [["type_work", "(206) 555-0171"]]),
    person("noone", "Nora", "Pell", []),
];

describe("what was said", () => {
    it("a name, with or without the verb and a number type", () => {
        expect(parseCommand("Call Ada Palmer.")).toEqual({ kind: "name", name: "ada palmer" });
        expect(parseCommand("call Lena Okafor Mobile.")).toEqual({ kind: "name", name: "lena okafor", numberType: "type_mobile" });
        expect(parseCommand("Dial Marcus at work")).toEqual({ kind: "name", name: "marcus", numberType: "type_work" });
        expect(parseCommand("Jonah Whitfield home")).toEqual({ kind: "name", name: "jonah whitfield", numberType: "type_home" });
        expect(parseCommand("Call.")).toEqual({ kind: "none" });
        expect(parseCommand("")).toEqual({ kind: "none" });
    });

    it("a number, in digits or words, as whisper writes it", () => {
        expect(parseCommand("Dial 408-555-0142")).toEqual({ kind: "number", number: "4085550142" });
        // whisper.cpp on "Dial 4 0 8, 5 5 5, 0 1 4 2" (espeak-ng): the verb misheard, "for" for 4.
        expect(parseCommand("Nile for 0-8, 5-5-5, 0-1-4-2")).toEqual({ kind: "number", number: "4085550142" });
        expect(parseCommand("call four oh eight five five five oh one four two")).toEqual({ kind: "number", number: "4085550142" });
        expect(parseCommand("Dial double five five, one two three")).toEqual({ kind: "number", number: "555123" });
        expect(parseCommand("Call 911")).toEqual({ kind: "number", number: "911" });
        expect(parseCommand("Call +1 303 555 0135")).toEqual({ kind: "number", number: "+13035550135" });
        // "for" and "to" are words in a name's sentence.
        expect(parseCommand("Call Ada for me").kind).toBe("name");
    });
});

describe("whom it means", () => {
    it("the person whose name was said", () => {
        const m = matchPeople("ada palmer", PEOPLE);
        expect(m[0].person._id).toBe("ada");
        expect(decide(m).sure?.person._id).toBe("ada");
    });

    it("a name heard wrong, by its words (whisper: \"Call either Palmer.\")", () => {
        const cmd = parseCommand("Call either Palmer.");
        expect(cmd.kind).toBe("name");
        const m = matchPeople(cmd.kind === "name" ? cmd.name : "", PEOPLE);
        expect(m[0].person._id).toBe("ada");
        expect(decide(m).sure?.person._id).toBe("ada");
    });

    it("a first name alone, and a close spelling", () => {
        expect(decide(matchPeople("marcus", PEOPLE)).sure?.person._id).toBe("marcus");
        expect(decide(matchPeople("theo lindquist", PEOPLE)).sure?.person._id).toBe("theo");
    });

    it("offers a choice when two are about as likely", () => {
        const two = [...PEOPLE, person("ada2", "Ada", "Palmieri", [["type_mobile", "(415) 555-0100"]])];
        const d = decide(matchPeople("ada palmer", two));
        expect(d.sure?.person._id).toBe("ada");        // the exact name still wins
        const d2 = decide(matchPeople("ada", two));
        expect(d2.sure).toBeNull();
        expect(d2.choices.map((c) => c.person._id).sort()).toEqual(["ada", "ada2"]);
    });

    it("no one, for a name nobody has, and never a person without a number", () => {
        expect(matchPeople("zebulon quartermaine", PEOPLE)).toEqual([]);
        expect(matchPeople("nora pell", PEOPLE)).toEqual([]);
        expect(nameScore("", PEOPLE[0])).toBe(0);
    });

    it("the number: the type asked for, else primary, mobile, first", () => {
        const marcus = PEOPLE[1];
        expect(pickNumber(marcus)?.value).toBe("(650) 555-0187");
        expect(pickNumber(marcus, "type_work")?.value).toBe("(650) 555-0110");
        expect(pickNumber(marcus, "type_home")?.value).toBe("(650) 555-0187");
        expect(pickNumber(PEOPLE[4])?.value).toBe("(408) 555-0199");
        expect(numberTypeLabel("type_mobile")).toBe("Mobile");
        expect(numberTypeLabel(undefined)).toBe("Phone");
        expect(personWithNumber("4085550142", PEOPLE)?._id).toBe("ada");
        expect(personWithNumber("5551234", PEOPLE)).toBeUndefined();
    });
});

describe("confirming", () => {
    it("yes and no", () => {
        expect(parseAnswer("Yes.")).toBe(true);
        expect(parseAnswer("Yeah, call.")).toBe(true);
        expect(parseAnswer("No.")).toBe(false);
        expect(parseAnswer("Cancel")).toBe(false);
        expect(parseAnswer("Call Ada Palmer")).toBe(true);
        expect(parseAnswer("hmm")).toBeNull();
    });

    it("the transcriber's prompt names everyone with a number", () => {
        const p = promptFor(PEOPLE);
        expect(p).toBe("Call Ada Palmer, Marcus Reyes, Priya Nair, Lena Okafor, Jonah Whitfield, Sam Delgado, Theo Lindqvist.");
        const many = Array.from({ length: 200 }, (_, i) => person("p" + i, "Person", "Number" + i, [["type_mobile", "555-01" + i]]));
        expect(promptFor(many).length).toBeLessThanOrEqual(1000);
    });
});
