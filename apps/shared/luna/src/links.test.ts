// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { messageTarget, telTarget } from "./links";

describe("links", () => {
    it("reads the number of a tel: link", () => {
        expect(telTarget("tel:+1-555-0100")).toBe("+1-555-0100");
        expect(telTarget("tel://5550100")).toBe("5550100");
        expect(telTarget("tel:555%200100;ext=12")).toBe("555 0100");
        expect(telTarget("TEL:911")).toBe("911");
        expect(telTarget("mailto:a@b.c")).toBeUndefined();
        expect(telTarget("tel:")).toBeUndefined();
        expect(telTarget(undefined)).toBeUndefined();
    });
    it("reads the recipient and text of sms:, smsto: and im: links", () => {
        expect(messageTarget("sms:+15550100?body=Hello%20there")).toEqual({ to: "+15550100", messageText: "Hello there" });
        expect(messageTarget("sms:5550100,5550111")).toEqual({ to: "5550100" });
        expect(messageTarget("smsto:5550100:On my way")).toEqual({ to: "5550100", messageText: "On my way" });
        expect(messageTarget("sms:?body=Hi")).toEqual({ messageText: "Hi" });
        expect(messageTarget("im:ada@example.com")).toEqual({ to: "ada@example.com" });
        expect(messageTarget("tel:5550100")).toBeUndefined();
        expect(messageTarget(42)).toBeUndefined();
    });
});
