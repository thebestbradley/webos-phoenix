// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Contacts as the webOS 2.x/3.x apps read them: the linked "person" records
// of db8 kind com.palm.person:1, which the contacts linker builds from every
// account's com.palm.contact:1 records. Schema:
// third_party/app-services/com.palm.service.contacts.linker/db/kinds/com.palm.person
// (name, nickname, phoneNumbers[{value, type, normalizedValue, primary}],
// emails, ims, photos, favorite, sortKey).

import { db, type DbObject } from "./db8";
import type { LunaError, Subscription } from "./bridge";

export const PERSON_KIND = "com.palm.person:1";

export interface PersonField {
    value: string;
    /** "type_mobile", "type_home", "type_work", ... (contacts loadable framework). */
    type?: string;
    normalizedValue?: string;
    primary?: boolean;
}

export interface Person extends DbObject {
    name?: { givenName?: string; familyName?: string; middleName?: string };
    nickname?: string;
    phoneNumbers?: PersonField[];
    emails?: PersonField[];
    ims?: (PersonField & { serviceName?: string })[];
    photos?: { localPathList?: string; localPathSquare?: string; localPathBig?: string };
    favorite?: boolean;
    sortKey?: string;
    organization?: { name?: string };
}

/** "Mary Spetzler", falling back to the nickname, organisation or first number. */
export function personDisplayName(p: Person | null | undefined): string {
    if (!p) return "";
    const n = [p.name?.givenName, p.name?.familyName].filter(Boolean).join(" ").trim();
    return n || p.nickname || p.organization?.name || p.phoneNumbers?.[0]?.value || p.emails?.[0]?.value || "";
}

/**
 * Phone numbers normalised the way the contacts linker indexes them
 * (com.palm.person phoneNumbers.normalizedValue: "stripped and reversed, to
 * allow matching on trailing digits using the prefix operator").
 */
export function normalizePhoneNumber(number: string): string {
    return number.replace(/[^0-9]/g, "").split("").reverse().join("");
}

/** Do two numbers name the same line? Compares the last 7 digits, as the webOS phone app did for caller ID. */
export function sameNumber(a: string, b: string): boolean {
    const x = normalizePhoneNumber(a), y = normalizePhoneNumber(b);
    if (!x || !y) return false;
    const n = Math.min(7, x.length, y.length);
    return x.slice(0, n) === y.slice(0, n) && (n >= 7 || x === y);
}

/** Human label for a phone number type ("type_mobile" -> "Mobile"). */
export function phoneTypeLabel(type?: string): string {
    switch (type) {
    case "type_mobile": return "Mobile";
    case "type_home": return "Home";
    case "type_work": return "Work";
    case "type_fax": case "type_work_fax": case "type_home_fax": return "Fax";
    case "type_pager": return "Pager";
    case "type_main": return "Main";
    case "type_personal": return "Personal";
    default: return "Other";
    }
}

export interface PersonMatch {
    person: Person;
    number: PersonField;
}

/** The person (and which of their numbers) a phone number belongs to. */
export function matchNumber(people: readonly Person[], number: string): PersonMatch | null {
    for (const person of people)
        for (const n of person.phoneNumbers ?? [])
            if (sameNumber(n.value, number)) return { person, number: n };
    return null;
}

export const contacts = {
    /** Everyone, sorted by sortKey. */
    all(): Promise<Person[]> {
        return db.find<Person>({ from: PERSON_KIND, orderBy: "sortKey" });
    },
    /** Everyone, kept up to date (db8 watch). */
    watchAll(cb: (people: Person[]) => void, onError?: (e: LunaError) => void): Subscription {
        return db.watch<Person>({ from: PERSON_KIND, orderBy: "sortKey" }, cb, onError);
    },
    /** Favourites (the phone app's favourites view queried favorite = true). */
    watchFavorites(cb: (people: Person[]) => void, onError?: (e: LunaError) => void): Subscription {
        return db.watch<Person>({ from: PERSON_KIND, where: [{ prop: "favorite", op: "=", val: true }], orderBy: "sortKey" }, cb, onError);
    },
};
