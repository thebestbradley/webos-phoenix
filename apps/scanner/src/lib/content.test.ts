// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { historyText, kindTitle, parseContent, parseVcard, safeUrl, splitFields, summary } from "./content";
import { addScan, clearHistory, loadHistory, loadPrefs, MAX_HISTORY, saveHistory, savePrefs } from "./history";

describe("what a code says", () => {
    it("web addresses, only http(s)", () => {
        expect(parseContent("https://webosphoenix.org/apps?x=1")).toEqual({ kind: "url", url: "https://webosphoenix.org/apps?x=1" });
        expect(parseContent("www.example.com/a")).toEqual({ kind: "url", url: "http://www.example.com/a" });
        expect(parseContent("javascript:alert(1)").kind).toBe("text");
        expect(parseContent("file:///etc/passwd").kind).toBe("text");
        expect(safeUrl("https://a.example/")).toBe("https://a.example/");
        expect(safeUrl("javascript:alert(1)")).toBeNull();
        expect(safeUrl("not a url")).toBeNull();
    });

    it("Wi-Fi networks, with escapes, hidden and open ones", () => {
        expect(parseContent("WIFI:T:WPA;S:Phoenix Lab;P:web\\;os\\:2009;;")).toEqual(
            { kind: "wifi", ssid: "Phoenix Lab", security: "psk", password: "web;os:2009", hidden: false });
        expect(parseContent("WIFI:S:Cafe;T:nopass;P:;;")).toEqual({ kind: "wifi", ssid: "Cafe", security: "none", password: "", hidden: false });
        expect(parseContent("wifi:T:WEP;S:Old;P:12345;H:true;;")).toMatchObject({ security: "wep", hidden: true });
        expect(parseContent("WIFI:S:NoType;P:secretpass;;")).toMatchObject({ security: "psk", password: "secretpass" });
        expect(parseContent("WIFI:T:WPA;P:x;;").kind).toBe("text");
        expect(splitFields("A:1;B:x\\\\y;;")).toEqual([["A", "1"], ["B", "x\\y"]]);
    });

    it("vCards to Contacts' fields", () => {
        const v = [
            "BEGIN:VCARD", "VERSION:3.0", "N:Palm;Pre;;Dr.;", "FN:Dr. Pre Palm",
            "ORG:Palm\\, Inc.;Devices", "TITLE:Phone", "TEL;TYPE=CELL:+1 408 555 0100", "TEL;TYPE=WORK,VOICE:+1 408 555 0101",
            "EMAIL;TYPE=INTERNET,WORK:pre@example.com", "URL:https://example.com",
            "ADR;TYPE=WORK:;;950 W Maude Ave;Sunnyvale;CA;94085;USA", "BDAY:20090606",
            "NOTE:Line one\\nline two, folded", "  and continued", "END:VCARD",
        ].join("\r\n");
        const c = parseContent(v);
        expect(c).toMatchObject({ kind: "contact", name: "Dr. Pre Palm" });
        if (c.kind !== "contact") throw new Error();
        expect(c.contact).toEqual({
            name: { givenName: "Pre", familyName: "Palm", middleName: "", honorificPrefix: "Dr.", honorificSuffix: "" },
            organizations: [{ name: "Palm, Inc., Devices", title: "Phone" }],
            phoneNumbers: [{ value: "+1 408 555 0100", type: "type_mobile" }, { value: "+1 408 555 0101", type: "type_work" }],
            emails: [{ value: "pre@example.com", type: "type_work" }],
            urls: [{ value: "https://example.com", type: "type_other" }],
            addresses: [{ streetAddress: "950 W Maude Ave", locality: "Sunnyvale", region: "CA", postalCode: "94085", country: "USA", type: "type_work" }],
            birthday: "2009-06-06",
            note: "Line one\nline two, folded and continued",
        });
        expect(parseVcard("BEGIN:VCARD\nFN:Only Name\nEND:VCARD")).toMatchObject({ name: "Only Name", contact: { name: { givenName: "Only", familyName: "Name" } } });
        expect(parseContent("BEGIN:VCARD\nVERSION:3.0\nEND:VCARD").kind).toBe("text");
    });

    it("MeCards", () => {
        const c = parseContent("MECARD:N:Doe,Jane;TEL:5551234;EMAIL:jane@example.com;ADR:1 Main St\\, Springfield;BDAY:19800131;NOTE:Hi\\;there;;");
        expect(c).toMatchObject({ kind: "contact", name: "Jane Doe" });
        if (c.kind !== "contact") throw new Error();
        expect(c.contact).toMatchObject({
            name: { givenName: "Jane", familyName: "Doe" },
            phoneNumbers: [{ value: "5551234", type: "type_mobile" }],
            emails: [{ value: "jane@example.com", type: "type_home" }],
            addresses: [{ streetAddress: "1 Main St, Springfield" }],
            birthday: "1980-01-31",
            note: "Hi;there",
        });
    });

    it("authenticator keys, never kept or shown with their secret", () => {
        const uri = "otpauth://totp/ACME%20Co:jane@example.com?secret=JBSWY3DPEHPK3PXP&issuer=ACME%20Co&period=30";
        const c = parseContent(uri);
        expect(c).toEqual({ kind: "otpauth", uri, type: "totp", account: "jane@example.com", issuer: "ACME Co" });
        expect(summary(c)).toBe("ACME Co: jane@example.com");
        expect(historyText(uri, c)).toBe("otpauth://totp/ACME%20Co%3A%20jane%40example.com");
        expect(historyText(uri, c)).not.toContain("JBSWY3DPEHPK3PXP");
        expect(parseContent(historyText(uri, c)).kind).toBe("text");   // no secret: not a key any more
        expect(parseContent("otpauth://hotp/x?secret=AB&counter=1")).toMatchObject({ type: "hotp", account: "x", issuer: "" });
    });

    it("phone numbers, email, text messages, places, products, text", () => {
        expect(parseContent("tel:+1-408-555-0100")).toEqual({ kind: "tel", number: "+1-408-555-0100" });
        expect(parseContent("mailto:a@example.com?subject=Hi%20there&body=Yo")).toEqual({ kind: "email", to: "a@example.com", subject: "Hi there", body: "Yo" });
        expect(parseContent("MATMSG:TO:b@example.com;SUB:Lunch;BODY:Noon?;;")).toEqual({ kind: "email", to: "b@example.com", subject: "Lunch", body: "Noon?" });
        expect(parseContent("SMSTO:5550100:On my way")).toEqual({ kind: "sms", number: "5550100", body: "On my way" });
        expect(parseContent("sms:+15550100?body=Hello")).toEqual({ kind: "sms", number: "+15550100", body: "Hello" });
        expect(parseContent("geo:37.3688,-122.0363?q=Palm")).toEqual({ kind: "geo", latitude: 37.3688, longitude: -122.0363 });
        expect(parseContent("geo:137,0").kind).toBe("text");
        expect(parseContent("4006381333931", "EAN13")).toEqual({ kind: "product", code: "4006381333931" });
        expect(parseContent("4006381333931", "QRCode").kind).toBe("text");
        expect(parseContent("  Hello, webOS  ")).toEqual({ kind: "text", text: "Hello, webOS" });
        expect(kindTitle(parseContent("tel:1"))).toBe("Phone Number");
        expect(summary(parseContent("WIFI:T:WPA;S:Lab;P:secretpass;;"))).toBe("Lab");
    });
});

describe("history", () => {
    function memory() {
        const m = new Map<string, string>();
        return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
    }

    it("keeps scans newest first, without repeats, up to a limit", () => {
        let h = addScan([], { text: "a", format: "QRCode", at: 1 });
        h = addScan(h, { text: "b", format: "QRCode", at: 2 });
        h = addScan(h, { text: "a", format: "QRCode", at: 3 });
        expect(h.map((s) => [s.text, s.at])).toEqual([["a", 3], ["b", 2]]);
        for (let i = 0; i < 150; i++) h = addScan(h, { text: String(i), format: "QRCode", at: 10 + i });
        expect(h).toHaveLength(MAX_HISTORY);
        expect(h[0].text).toBe("149");
    });

    it("is stored on the device and can be cleared", () => {
        const s = memory();
        expect(loadHistory(s)).toEqual([]);
        const h = addScan([], { text: "x", format: "EAN13", at: 5 });
        saveHistory(h, s);
        expect(loadHistory(s)).toEqual(h);
        clearHistory(s);
        expect(loadHistory(s)).toEqual([]);
        s.setItem("org.webosphoenix.scanner.history", "{bad");
        expect(loadHistory(s)).toEqual([]);
        expect(loadPrefs(s)).toEqual({ keepHistory: true });
        savePrefs({ keepHistory: false }, s);
        expect(loadPrefs(s)).toEqual({ keepHistory: false });
    });
});
