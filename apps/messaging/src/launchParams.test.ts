// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import type { ChatThread, ImBuddy, ImLoginState } from "@phoenix/luna";
import appinfo from "../public/appinfo.json";
import { LAUNCH_PARAMS, parseLaunch, resolveLaunch } from "./launchParams";

const lena = { _id: "p1", value: "(212) 555-0164", type: "type_mobile", normalizedValue: "4610555212" };

describe("Messaging's launch params", () => {
    it("lists in appinfo.json the keys it reads (tools/check-launch-contracts.cjs)", () => {
        expect([...appinfo.phoenix.launchParams].sort()).toEqual([...LAUNCH_PARAMS].sort());
    });

    it("reads Phoenix's own", () => {
        expect(parseLaunch({ threadId: "t1" })).toEqual({ kind: "thread", threadId: "t1" });
        expect(parseLaunch({ to: "5550100", name: "Ada" })).toEqual({ kind: "compose", to: { addr: "5550100", name: "Ada" }, text: undefined, parts: [] });
        expect(parseLaunch({ messageText: "Meet here" })).toEqual({ kind: "compose", to: null, text: "Meet here", parts: [] });
        expect(parseLaunch({ attachment: "/media/internal/a.jpg" })).toMatchObject({ kind: "compose", to: null,
            parts: [{ path: "/media/internal/a.jpg", mimeType: "image/jpeg", name: "a.jpg" }] });
        expect(parseLaunch({ share: { text: "Look", url: "https://x.org", files: [{ path: "/p.png", mimeType: "image/png" }] } }))
            .toEqual({ kind: "compose", to: null, text: "Look https://x.org", parts: [{ path: "/p.png", mimeType: "image/png", name: "p.png" }] });
        expect(parseLaunch({ target: "sms:5550100?body=Hi%20there" })).toEqual({ kind: "compose", to: { addr: "5550100" }, text: "Hi there", parts: [] });
        expect(parseLaunch({})).toEqual({ kind: "none" });
    });

    it("reads Contacts' message button: {compose: {personId, phoneNumbers}} (PseudoDetailsInApp.js:352-363)", () => {
        expect(parseLaunch({ compose: { personId: "person-1", phoneNumbers: [lena] } }))
            .toEqual({ kind: "compose", to: { addr: "(212) 555-0164", personId: "person-1" }, text: undefined, parts: [] });
    });

    it("reads an IM address: {compose: {personId, ims}} and Just Type's {personId, address, serviceName}", () => {
        expect(parseLaunch({ compose: { personId: "p", ims: [{ value: "ada@jabber.example", type: "type_jabber" }] } }))
            .toMatchObject({ kind: "compose", to: { addr: "ada@jabber.example", personId: "p", service: "type_jabber" } });
        expect(parseLaunch({ personId: "p", address: "ada@jabber.example", serviceName: "type_jabber", type: "jabber" }))
            .toMatchObject({ kind: "compose", to: { addr: "ada@jabber.example", personId: "p", service: "type_jabber" } });
    });

    it("reads the text and pictures: compose {messageText, attachment(s)} (the browser's Share Link)", () => {
        expect(parseLaunch({ compose: { messageText: "Check out this web page: https://a.b" } }))
            .toEqual({ kind: "compose", to: null, text: "Check out this web page: https://a.b", parts: [] });
        expect(parseLaunch({ compose: { phoneNumbers: [{ value: "5550100" }], attachments: [{ fullPath: "file:///media/internal/b.png" }] } }))
            .toMatchObject({ to: { addr: "5550100" }, parts: [{ path: "/media/internal/b.png", mimeType: "image/png" }] });
    });

    it("reads the SDK's composeRecipients and composeAddress", () => {
        expect(parseLaunch({ composeRecipients: [{ address: "5550100", serviceName: "sms" }], messageText: "x" }))
            .toEqual({ kind: "compose", to: { addr: "5550100" }, text: "x", parts: [] });
        expect(parseLaunch({ composeAddress: "5550101" })).toMatchObject({ to: { addr: "5550101" } });
    });

    describe("resolveLaunch", () => {
        const threads: ChatThread[] = [
            { _id: "t-lena", replyAddress: "2125550164", replyService: "sms", displayName: "Lena Okafor" },
            { _id: "t-ada", replyAddress: "ada@jabber.example", replyService: "type_jabber", username: "me@jabber.example" },
        ] as ChatThread[];
        const accounts = [{ _id: "l1", accountId: "acc1", username: "me@jabber.example", serviceName: "type_jabber", state: "online", availability: 0 }] as ImLoginState[];
        const buddies = [{ _id: "b1", accountId: "acc1", username: "ada@jabber.example", serviceName: "type_jabber", displayName: "Ada", availability: 0 }] as ImBuddy[];

        it("opens the conversation with that number, the text in its compose line", () => {
            const v = resolveLaunch(parseLaunch({ compose: { personId: "p", phoneNumbers: [lena], messageText: "On my way" } }),
                                    { threads, buddies, accounts });
            expect(v).toEqual({ kind: "thread", id: "t-lena", text: "On my way" });
        });

        it("starts a new message to a number with no conversation, with the person's name", () => {
            const v = resolveLaunch(parseLaunch({ compose: { personId: "p9", phoneNumbers: [{ value: "(415) 555-0199" }] } }),
                                    { threads, buddies, accounts, personName: "Marcus Webb" });
            expect(v).toEqual({ kind: "compose", to: { addr: "(415) 555-0199", name: "Marcus Webb", personId: "p9" } });
        });

        it("opens the IM conversation with that buddy", () => {
            const v = resolveLaunch(parseLaunch({ compose: { ims: [{ value: "Ada@jabber.example", type: "type_jabber" }] } }), { threads, buddies, accounts });
            expect(v).toEqual({ kind: "thread", id: "t-ada" });
        });

        it("starts an IM to a buddy with no conversation, from the account they are a buddy of", () => {
            const v = resolveLaunch(parseLaunch({ compose: { ims: [{ value: "ada@jabber.example", type: "type_jabber" }] } }),
                                    { threads: [], buddies, accounts });
            expect(v).toMatchObject({ kind: "compose", to: { addr: "ada@jabber.example", service: "type_jabber", account: "me@jabber.example", name: "Ada" } });
        });
    });
});
