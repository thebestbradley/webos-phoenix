// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// What Voice Dial heard, and whom it means: "Call Ada Palmer", "Call Ada
// Palmer mobile", "Dial 4 0 8 5 5 5 0 1 4 2", "four oh eight five five
// five ...". The transcriber gets the contacts' names as its prompt, so a
// name usually comes back as written; a name heard wrong ("Call either
// Palmer") is still matched by its words, letter by letter, and when two
// people are about as likely, both are offered.

import { personDisplayName, sameNumber, type Person, type PersonField } from "@phoenix/luna";

export type Command =
    | { kind: "number"; number: string }
    | { kind: "name"; name: string; numberType?: string }
    | { kind: "none" };

const VERBS = new Set(["call", "dial", "phone", "ring", "telephone", "please"]);
const DIGIT_WORDS: Record<string, string> = {
    zero: "0", oh: "0", o: "0", one: "1", two: "2", three: "3", four: "4", five: "5",
    six: "6", seven: "7", eight: "8", nine: "9",
};
// Words that sound like digits, taken as digits only beside other digits.
const SOUNDALIKES: Record<string, string> = { won: "1", to: "2", too: "2", tree: "3", for: "4", fore: "4", ate: "8" };
const TYPE_WORDS: Record<string, string> = {
    mobile: "type_mobile", cell: "type_mobile", cellphone: "type_mobile", iphone: "type_mobile",
    home: "type_home", work: "type_work", office: "type_work",
};

function words(text: string): string[] {
    return text.toLowerCase()
        .replace(/(\d)[-.\s]+(?=\d)/g, "$1 ")          // 0-8, 5-5-5 -> digits apart
        .replace(/[^a-z0-9+' ]+/g, " ")
        .split(/\s+/).filter(Boolean);
}

/** The digits a word stands for ("4", "408", "four", "oh"), or null. */
function digitsOf(w: string): string | null {
    if (/^\+?\d+$/.test(w)) return w;
    return DIGIT_WORDS[w] ?? null;
}

/** "Call Ada Palmer mobile" -> {kind: "name", name: "ada palmer", numberType: "type_mobile"}. */
export function parseCommand(text: string): Command {
    let ws = words(text);
    // A number: digits and digit words (with "double five", "triple oh"),
    // soundalikes beside them, whatever the verb was heard as.
    let digits = "";
    let digitWords = 0;
    for (let i = 0; i < ws.length; ++i) {
        const w = ws[i];
        let d = digitsOf(w);
        if (d === null && SOUNDALIKES[w] && (digitsOf(ws[i - 1] ?? "") !== null || digitsOf(ws[i + 1] ?? "") !== null))
            d = SOUNDALIKES[w];
        if ((w === "double" || w === "triple") && digitsOf(ws[i + 1] ?? "") !== null) {
            const next = digitsOf(ws[i + 1])!;
            d = next.repeat(w === "double" ? 1 : 2);   // the next word adds the last one
        }
        if (d !== null) {
            digits += d;
            digitWords++;
        }
    }
    const plain = digits.replace(/^\+/, "");
    if (/^\+?\d+$/.test(digits) && plain.length >= 3 && digitWords * 2 >= ws.length - 1)
        return { kind: "number", number: digits };

    // A name: without the verb and a number type at the end.
    while (ws.length && VERBS.has(ws[0])) ws = ws.slice(1);
    let numberType: string | undefined;
    const last = ws[ws.length - 1];
    if (last && TYPE_WORDS[last]) {
        numberType = TYPE_WORDS[last];
        ws = ws.slice(0, -1);
        if (ws.length && (ws[ws.length - 1] === "at" || ws[ws.length - 1] === "on")) ws = ws.slice(0, -1);
    }
    if (!ws.length) return { kind: "none" };
    return { kind: "name", name: ws.join(" "), numberType };
}

export function editDistance(a: string, b: string): number {
    const row = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; ++i) {
        let prev = row[0];
        row[0] = i;
        for (let j = 1; j <= b.length; ++j) {
            const cur = row[j];
            row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
            prev = cur;
        }
    }
    return row[b.length];
}

/** 1 for the same word, 0 for nothing alike. */
export function wordLikeness(a: string, b: string): number {
    if (a === b) return 1;
    const n = Math.max(a.length, b.length);
    return n ? Math.max(0, 1 - editDistance(a, b) / n) : 0;
}

function nameWords(p: Person): string[] {
    const ws = [p.name?.givenName, p.name?.middleName, p.name?.familyName, p.nickname, p.organization?.name]
        .filter((x): x is string => !!x)
        .flatMap((x) => words(x));
    return [...new Set(ws)];
}

/**
 * How well the spoken name fits a person, 0..1: each spoken word against
 * the person's best fitting name word, and both their given and family name
 * counted when both were said.
 */
export function nameScore(spoken: string, p: Person): number {
    const said = words(spoken);
    const theirs = nameWords(p);
    if (!said.length || !theirs.length) return 0;
    const full = words(personDisplayName(p)).join(" ");
    const whole = wordLikeness(said.join(" "), full);
    const perWord = said.reduce((sum, w) => sum + Math.max(...theirs.map((t) => wordLikeness(w, t))), 0) / said.length;
    // Saying fewer words than the person's name has ("Ada") is fine, but a
    // single loose word should not beat a whole name.
    return Math.max(whole, perWord * (said.length >= 2 ? 1 : 0.9));
}

export interface Match {
    person: Person;
    name: string;
    score: number;
}

/** People with a phone number, best match first (score >= 0.45). */
export function matchPeople(spoken: string, people: readonly Person[]): Match[] {
    return people
        .filter((p) => p.phoneNumbers?.length)
        .map((p) => ({ person: p, name: personDisplayName(p), score: nameScore(spoken, p) }))
        .filter((m) => m.score >= 0.45)
        .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}

/** One clear winner, or the few that are about as likely (a choice). */
export function decide(matches: readonly Match[]): { sure: Match | null; choices: Match[] } {
    if (!matches.length) return { sure: null, choices: [] };
    const [best, next] = matches;
    // The name as written, or well ahead of the next.
    if (best.score >= 0.999 && (!next || next.score < 0.999)) return { sure: best, choices: [] };
    if (best.score >= 0.6 && (!next || best.score - next.score >= 0.15)) return { sure: best, choices: [] };
    return { sure: null, choices: matches.slice(0, 4) };
}

/** The number to call: the type asked for, else the primary, a mobile, the first. */
export function pickNumber(p: Person, numberType?: string): PersonField | undefined {
    const nums = p.phoneNumbers ?? [];
    return (numberType ? nums.find((n) => n.type === numberType) : undefined)
        ?? nums.find((n) => n.primary)
        ?? nums.find((n) => n.type === "type_mobile")
        ?? nums[0];
}

/** "Mobile", "Home", "Work", ... from type_mobile. */
export function numberTypeLabel(type?: string): string {
    const t = (type ?? "").replace(/^type_/, "");
    return t ? t.charAt(0).toUpperCase() + t.slice(1) : "Phone";
}

/** The contact a dialled number belongs to, if any. */
export function personWithNumber(number: string, people: readonly Person[]): Person | undefined {
    return people.find((p) => p.phoneNumbers?.some((n) => sameNumber(n.value, number)));
}

/** "Yes" / "No" to "Call Ada Palmer?", or null for anything else. */
export function parseAnswer(text: string): boolean | null {
    const ws = words(text);
    if (ws.some((w) => ["yes", "yeah", "yep", "sure", "correct", "right", "ok", "okay", "call", "dial"].includes(w))) return true;
    if (ws.some((w) => ["no", "nope", "cancel", "stop", "wrong"].includes(w))) return false;
    return null;
}

/** The words Voice Dial expects: whisper's initial prompt. */
export function promptFor(people: readonly Person[]): string {
    const names = people.filter((p) => p.phoneNumbers?.length).map(personDisplayName).filter(Boolean);
    let prompt = "Call";
    for (const n of names) {
        const next = `${prompt} ${n},`;
        if (next.length > 900) break;
        prompt = next;
    }
    return prompt.replace(/,$/, ".");
}
