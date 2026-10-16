// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Where the save and pick sheets go: up from a folder, and the folders the
// column view shows for one (the places first when there are drives).

import { describe, expect, it } from "vitest";
import { MEDIA, PLACES, pickerChain, upOf } from "./places";

describe("the sheets' places", () => {
    it("go up to the places above Internal Storage and a drive's own folder, when there are drives", () => {
        expect(upOf(MEDIA + "/Documents/Work", true)).toBe(MEDIA + "/Documents");
        expect(upOf(MEDIA, true)).toBe(PLACES);
        expect(upOf(MEDIA, false)).toBe(MEDIA);
        expect(upOf("/media/drives/acct-1", true)).toBe(PLACES);
        expect(upOf("/media/drives/acct-1/Photos", true)).toBe("/media/drives/acct-1");
    });

    it("show a column a folder, from the place, with the places first when there are drives", () => {
        expect(pickerChain(MEDIA + "/Documents/Work", false)).toEqual([MEDIA, MEDIA + "/Documents", MEDIA + "/Documents/Work"]);
        expect(pickerChain(MEDIA + "/Documents", true)).toEqual([PLACES, MEDIA, MEDIA + "/Documents"]);
        expect(pickerChain(MEDIA, false)).toEqual([MEDIA]);
        expect(pickerChain("/media/drives/acct-1/Photos", true)).toEqual([PLACES, "/media/drives/acct-1", "/media/drives/acct-1/Photos"]);
        expect(pickerChain(PLACES, true)).toEqual([PLACES]);
    });
});
