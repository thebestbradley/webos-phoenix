// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Connections: the home's groups, the type page's words (where the data
// goes, the sign-in, how new data arrives), the Accounts app's "Find
// More..." params, and Set up launching Accounts at the template.

import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AccountType } from "@phoenix/luna";

const luna = vi.hoisted(() => ({ launch: vi.fn(() => Promise.resolve({ returnValue: true })) }));
vi.mock("@phoenix/luna", async (orig) => {
    const real = await orig<typeof import("@phoenix/luna")>();
    return { ...real, apps: { ...real.apps, launch: luna.launch } };
});

import { AccountTypePage, ConnectionsFiltered, ConnectionsHome } from "./Connections";
import {
    addedTemplates, applyFilter, capabilityChips, findMoreFilter, groupAccountTypes, privacyLines, pushText, setUpLaunch, signInText, statusBadge,
} from "./accountTypes";

function type(templateId: string, o: Partial<AccountType> = {}): AccountType {
    return {
        templateId, sourceId: "phoenix", title: templateId, provider: "", icon: "", summary: "", capabilities: [], protocols: [],
        auth: { type: "password", registration: "none" }, server: "user",
        privacy: { dataGoesTo: "the server you enter", e2ee: false, phoenixServers: "none" },
        push: "poll", status: "stable", package: { id: "", builtin: true }, help: "", featured: false, ...o,
    };
}

const DAV = type("org.webosphoenix.dav", { title: "CalDAV & CardDAV", provider: "Any DAV server", protocols: ["caldav", "carddav"],
    capabilities: [{ capability: "CONTACTS", direction: "two-way" }, { capability: "CALENDAR", direction: "two-way" }] });
const ICLOUD = type("org.webosphoenix.dav.icloud", { title: "iCloud", provider: "Apple", featured: true, auth: { type: "app-password", registration: "none" },
    server: "fixed", capabilities: [{ capability: "CONTACTS" }, { capability: "CALENDAR" }],
    privacy: { dataGoesTo: "Apple's servers", e2ee: false, phoenixServers: "none" } });
const IMAP = type("com.palm.imap", { title: "IMAP", capabilities: [{ capability: "MAIL" }] });
const MS = type("com.example.microsoft", { title: "Microsoft", provider: "Microsoft", status: "beta", push: "relay",
    auth: { type: "oauth", registration: "required" }, capabilities: [{ capability: "MAIL" }, { capability: "CALENDAR" }, { capability: "CONTACTS" }],
    privacy: { dataGoesTo: "Microsoft's servers", e2ee: false, phoenixServers: "token-relay" } });
const IMMICH = type("com.example.immich", { title: "Immich", status: "experimental", auth: { type: "api-key", registration: "none" },
    capabilities: [{ capability: "PHOTO", direction: "two-way" }, { capability: "PHOTO.UPLOAD" }] });
const SIGNAL = type("com.example.matrix", { title: "Matrix", push: "unifiedpush", capabilities: [{ capability: "IM" }],
    privacy: { dataGoesTo: "your homeserver", e2ee: true, phoenixServers: "push-relay" } });
const ODD = type("com.example.passwords", { title: "Vault", capabilities: [{ capability: "PASSWORDS" }] });

describe("the Connections home", () => {
    it("groups by capability, Featured first, only groups that have any", () => {
        const groups = groupAccountTypes([IMAP, DAV, ICLOUD, MS, IMMICH, SIGNAL, ODD]);
        expect(groups.map((g) => g.label)).toEqual(["Featured", "Contacts & Calendars", "Mail", "Messaging", "Photos & Media", "More"]);
        const by = (id: string) => groups.find((g) => g.id === id)!.types.map((t) => t.title);
        expect(by("featured")).toEqual(["iCloud"]);
        expect(by("contacts")).toEqual(["CalDAV & CardDAV", "iCloud", "Microsoft"]);
        expect(by("mail")).toEqual(["IMAP", "Microsoft"]);
        expect(by("photos")).toEqual(["Immich"]);
        expect(by("more")).toEqual(["Vault"]);
        expect(groupAccountTypes([IMAP]).map((g) => g.label)).toEqual(["Mail"]);
        expect(groupAccountTypes([])).toEqual([]);
    });

    it("draws the groups, Added for templates already added, and says when there are none", () => {
        const open = vi.fn();
        const { getByTestId, container } = render(<ConnectionsHome types={[DAV, IMAP]} added={new Set(["com.palm.imap"])} open={open} />);
        expect(getByTestId("group-contacts").textContent).toContain("CalDAV & CardDAV");
        expect(getByTestId("account-com.palm.imap").textContent).toContain("Added");
        fireEvent.click(getByTestId("account-org.webosphoenix.dav"));
        expect(open).toHaveBeenCalledWith(DAV);
        expect(container.querySelector("[data-testid=connections-empty]")).toBeNull();
        expect(render(<ConnectionsHome types={[]} added={new Set()} open={open} />).getByTestId("connections-empty")).toBeTruthy();
    });
});

describe("an account type in words", () => {
    it("capability chips, with two-way once when every one says so", () => {
        expect(capabilityChips(DAV)).toEqual(["Contacts", "Calendar", "two-way"]);
        expect(capabilityChips(ICLOUD)).toEqual(["Contacts", "Calendar"]);
        expect(capabilityChips(IMMICH)).toEqual(["Photos (two-way)", "Photo upload"]);
        expect(capabilityChips(ODD)).toEqual(["Passwords"]);
    });

    it("where the data goes", () => {
        expect(privacyLines(DAV)).toEqual(["Your data goes to the server you enter.", "Not end-to-end encrypted", "Phoenix's servers: none"]);
        expect(privacyLines(SIGNAL)).toEqual(["Your data goes to your homeserver.", "End-to-end encrypted",
            "Phoenix's servers: a push relay, which only tells this device there is something new"]);
        expect(privacyLines(MS)[2]).toBe("Phoenix's servers: the sign-in passes through them; your data does not");
        expect(privacyLines(type("x.y", { privacy: null }))).toEqual(["The catalog does not say where your data goes."]);
        expect(privacyLines(type("x.y", { privacy: { dataGoesTo: "nowhere: Phoenix only reads the address you enter", e2ee: false, phoenixServers: "none" } }))[0])
            .toBe("Your data goes nowhere: Phoenix only reads the address you enter.");
    });

    it("the sign-in, new data and the status", () => {
        expect([DAV, ICLOUD, MS, IMMICH].map(signInText)).toEqual(["Password", "App password", "Sign in with Microsoft", "API key"]);
        expect(signInText(type("x.y", { title: "Mastodon", auth: { type: "oauth", registration: "none" } }))).toBe("Sign in with Mastodon");
        expect(pushText(DAV)).toBe("Checks for new data every few minutes");
        expect(pushText(SIGNAL)).toMatch(/as it happens/);
        expect([DAV, MS, IMMICH].map(statusBadge)).toEqual(["", "Beta", "Experimental"]);
    });
});

describe("Find More... from the Accounts app", () => {
    // As add-account.js:85-92 sends them.
    const findMore = (types: unknown, searchBarTitle?: unknown) => ({ common: { sceneType: "search", params: { type: "connector",
        connectorInfo: { searchBarTitle, searchBarIcon: "/usr/palm/frameworks/enyo/1.0/framework/lib/accounts/images/acounts-48x48.png", types } } } });

    it("reads the capabilities and the title; ignores other launches", () => {
        expect(findMoreFilter(findMore(["CONTACTS"], "Contacts Accounts"))).toEqual({ title: "Contacts Accounts", types: ["CONTACTS"] });
        // The capability was undefined (Accounts without one): all of them.
        expect(findMoreFilter(findMore([undefined]))).toEqual({ title: "Connections", types: [] });
        expect(findMoreFilter(findMore("MAIL", " "))).toEqual({ title: "Connections", types: ["MAIL"] });
        expect(findMoreFilter({})).toBeNull();
        expect(findMoreFilter(null)).toBeNull();
        expect(findMoreFilter({ section: "updates" })).toBeNull();
        expect(findMoreFilter({ common: { sceneType: "search", params: { type: "app" } } })).toBeNull();
    });

    it("keeps the types with any of them, and offers all of them", () => {
        const all = [DAV, ICLOUD, IMAP, MS, IMMICH];
        expect(applyFilter(all, { title: "", types: ["MAIL"] }).map((t) => t.title)).toEqual(["IMAP", "Microsoft"]);
        expect(applyFilter(all, { title: "", types: ["CALENDAR", "PHOTO"] }).length).toBe(4);
        expect(applyFilter(all, { title: "", types: [] })).toBe(all);
        const showAll = vi.fn();
        const { getByTestId } = render(<ConnectionsFiltered filter={{ title: "Email Accounts", types: ["MAIL"] }} types={all} added={new Set()}
                                                             open={() => {}} showAll={showAll} />);
        expect(getByTestId("filter-title").textContent).toBe("Email Accounts");
        expect(getByTestId("connections-filtered").querySelectorAll("[data-testid^=account-]").length).toBe(2);
        fireEvent.click(getByTestId("show-all-connections"));
        expect(showAll).toHaveBeenCalled();
    });
});

describe("Set up", () => {
    it("launches Accounts at the template; Open in Accounts once it is added", () => {
        expect(setUpLaunch(DAV)).toEqual({ id: "com.palm.app.accounts", params: { templateId: "org.webosphoenix.dav" } });
        const page = render(<AccountTypePage t={MS} added={false} />);
        expect(page.getByTestId("privacy").textContent).toContain("Where your data goes");
        expect(page.getByTestId("capability-chips").textContent).toBe("MailCalendarContacts");
        expect(page.getByTestId("status-badge").textContent).toBe("Beta");
        fireEvent.click(page.getByTestId("set-up"));
        expect(luna.launch).toHaveBeenLastCalledWith("com.palm.app.accounts", { templateId: "com.example.microsoft" });
        page.unmount();
        const again = render(<AccountTypePage t={MS} added />);
        expect(again.queryByTestId("set-up")).toBeNull();
        fireEvent.click(again.getByTestId("open-accounts"));
        expect(luna.launch).toHaveBeenLastCalledWith("com.palm.app.accounts", {});
    });

    it("lists the templates added as accounts", () => {
        expect([...addedTemplates([{ templateId: "com.palm.imap" }, { templateId: 3 }, {}])]).toEqual(["com.palm.imap"]);
    });
    it("never shows Palm's or HP's names from the original's Find More", () => {
        const f = findMoreFilter({ common: { sceneType: "search", params: { type: "connector", connectorInfo: { searchBarTitle: "HP Synergy Services", types: ["MAIL", null] } } } });
        expect(f).toEqual({ title: "Connections", types: ["MAIL"] });
    });
});
