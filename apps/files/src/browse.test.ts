// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0

import { beforeEach, describe, expect, it } from "vitest";
import { FILE_ERRORS } from "@phoenix/luna";
import { folderChain } from "@phoenix/ui";
import { columnRoot, crumbs, DEFAULT_FAVORITES, folderProblem, folderTitle, kindLabel, loadPrefs, planPaste, savePrefs, shortDate } from "./browse";

beforeEach(() => localStorage.clear());

describe("Files helpers", () => {
    it("splits a path into the path bar", () => {
        expect(crumbs("/media/internal/Documents")).toEqual([
            { label: "/", path: "/" },
            { label: "media", path: "/media" },
            { label: "internal", path: "/media/internal" },
            { label: "Documents", path: "/media/internal/Documents" },
        ]);
        expect(crumbs("/")).toEqual([{ label: "/", path: "/" }]);
        expect(folderTitle("/media/internal")).toBe("Internal storage");
        expect(folderTitle("/")).toBe("Device");
        expect(folderTitle("/media/internal/Music")).toBe("Music");
        // A drive: its account type's name, and a path bar from the drive (not its account id).
        const names = { "/media/drives/acct-1": "Nextcloud" };
        expect(folderTitle("/media/drives")).toBe("Drives");
        expect(folderTitle("/media/drives/acct-1", names)).toBe("Nextcloud");
        expect(crumbs("/media/drives/acct-1/Photos", names)).toEqual([
            { label: "Drives", path: "/media/drives" },
            { label: "Nextcloud", path: "/media/drives/acct-1" },
            { label: "Photos", path: "/media/drives/acct-1/Photos" },
        ]);
    });

    it("plans a paste: free names for copies, nothing for a cut in place, no folder into itself", () => {
        const copy = planPaste({ mode: "copy", paths: ["/m/Docs/a.txt", "/m/Docs/b.txt"] }, "/m/Docs", ["a.txt", "b.txt", "a 2.txt"]);
        expect(copy.steps).toEqual([
            { from: "/m/Docs/a.txt", to: "/m/Docs/a 3.txt", move: false },
            { from: "/m/Docs/b.txt", to: "/m/Docs/b 2.txt", move: false },
        ]);
        const cut = planPaste({ mode: "cut", paths: ["/m/Docs/a.txt", "/m/Other/c.txt"] }, "/m/Docs", ["a.txt"]);
        expect(cut.steps).toEqual([{ from: "/m/Other/c.txt", to: "/m/Docs/c.txt", move: true }]);
        const into = planPaste({ mode: "copy", paths: ["/m/Docs"] }, "/m/Docs/Sub", []);
        expect(into).toEqual({ steps: [], skipped: ["/m/Docs"] });
    });

    it("dates rows by time today, day this year, and year before", () => {
        const now = new Date(2026, 8, 28, 15, 0).getTime();
        expect(shortDate(new Date(2026, 8, 28, 9, 5).getTime(), now)).toBe("9:05 AM");
        expect(shortDate(new Date(2026, 8, 3).getTime(), now)).toBe("Sep 3");
        expect(shortDate(new Date(2025, 11, 24).getTime(), now)).toBe("Dec 24, 2025");
        expect(kindLabel({ name: "a.ipk", type: "file" })).toBe("webOS package");
        expect(kindLabel({ name: "x", type: "directory" })).toBe("Folder");
    });

    it("keeps preferences, with /media/internal and its folders as the first favourites", () => {
        expect(loadPrefs()).toEqual({ sort: "name", showHidden: false, favorites: DEFAULT_FAVORITES, view: "list" });
        expect(DEFAULT_FAVORITES).toEqual(["/media/internal", "/media/internal/Downloads", "/media/internal/Documents",
                                           "/media/internal/Pictures", "/media/internal/Music"]);
        savePrefs({ sort: "date", showHidden: true, favorites: ["/tmp"], view: "columns" });
        expect(loadPrefs()).toEqual({ sort: "date", showHidden: true, favorites: ["/tmp"], view: "columns" });
        localStorage.setItem("org.webosphoenix.files:prefs", "{bad json");
        expect(loadPrefs().sort).toBe("name");
    });

    it("remembers List or Columns, the list unless columns were chosen (preferences from before columns too)", () => {
        localStorage.setItem("org.webosphoenix.files:prefs", JSON.stringify({ sort: "size", showHidden: false, favorites: [] }));
        expect(loadPrefs().view).toBe("list");
        localStorage.setItem("org.webosphoenix.files:prefs", JSON.stringify({ view: "grid" }));
        expect(loadPrefs().view).toBe("list");
        localStorage.setItem("org.webosphoenix.files:prefs", JSON.stringify({ view: "columns" }));
        expect(loadPrefs().view).toBe("columns");
    });

    it("starts the columns at the place a folder is in", () => {
        expect(columnRoot("/media/internal")).toBe("/media/internal");
        expect(columnRoot("/media/internal/Documents/Work")).toBe("/media/internal");
        expect(columnRoot("/media/drives/acct-1/Photos/2026")).toBe("/media/drives/acct-1");
        expect(columnRoot("/media/drives/acct-1")).toBe("/media/drives/acct-1");
        expect(columnRoot("/media/drives")).toBe("/media/drives");
        expect(columnRoot("/media")).toBe("/");
        expect(columnRoot("/etc/palm")).toBe("/");
        expect(columnRoot("/")).toBe("/");
        // The columns of a folder: the place, then each folder down to it.
        expect(folderChain(columnRoot("/media/internal/Documents/Work"), "/media/internal/Documents/Work"))
            .toEqual(["/media/internal", "/media/internal/Documents", "/media/internal/Documents/Work"]);
        expect(folderChain(columnRoot("/media/drives/acct-1/Photos"), "/media/drives/acct-1/Photos"))
            .toEqual(["/media/drives/acct-1", "/media/drives/acct-1/Photos"]);
        expect(folderChain(columnRoot("/etc/palm"), "/etc/palm")).toEqual(["/", "/etc", "/etc/palm"]);
    });

    it("says why a drive's folder did not open, loudest for a server whose key changed", () => {
        expect(folderProblem(FILE_ERRORS.OFFLINE, undefined, "x", "SFTP")).toEqual(
            { message: "SFTP can't be reached. Check your connection; nothing was lost.", warning: false, accounts: false });
        expect(folderProblem(FILE_ERRORS.AUTH, "401_UNAUTHORIZED", "x", "Nextcloud")).toEqual(
            { message: "Nextcloud did not accept the sign-in. Sign in again in Accounts.", warning: false, accounts: true });
        const changed = "WARNING: the key of nas.local has changed. It was SHA256:a and is now SHA256:b.";
        expect(folderProblem(FILE_ERRORS.AUTH, "HOST_KEY_CHANGED", changed, "SFTP")).toEqual({ message: changed, warning: true, accounts: true });
        expect(folderProblem(FILE_ERRORS.PERMISSION, undefined, "Permission denied", "SFTP").message).toBe("Permission denied");
    });
});
