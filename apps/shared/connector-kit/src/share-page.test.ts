// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The kit's compose page (share-page/; docs/SYNERGY-SDK.md "Sharing to your
// service"), in jsdom: launched by the share sheet with {share, accountId,
// target}, it shows what the declaration takes, and posts through the
// connector's share method as the account picked, with one key for retries.

/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const DIR = join(__dirname, "..", "share-page");
const target = {
    templateId: "org.example.wall", service: "org.example.service.wall", label: "Wall", accountLabel: "@{username}",
    accepts: { text: { maxLength: 20 }, link: true, image: { max: 1, altText: { maxLength: 50 } } },
    audience: { options: [{ value: "public", label: "Everyone", hint: "Anyone" }, { value: "members", label: "Members" }], default: "public" }
};

function open(params: any, answers: (uri: string, p: any) => any) {
    const calls: { uri: string; params: any }[] = [];
    document.body.innerHTML = readFileSync(join(DIR, "index.html"), "utf8").replace(/^[\s\S]*<body>|<\/body>[\s\S]*$/g, "").replace(/<script[^>]*><\/script>/, "");
    (window as any).PalmSystem = { launchParams: JSON.stringify(params), stageReady: () => {} };
    (window as any).PalmServiceBridge = function (this: any) {
        this.call = (uri: string, text: string) => {
            const p = JSON.parse(text);
            calls.push({ uri, params: p });
            Promise.resolve(answers(uri, p)).then((r) => this.onservicecallback(JSON.stringify(r)));
        };
    };
    window.close = () => {};
    new Function(readFileSync(join(DIR, "compose.js"), "utf8"))();
    return calls;
}
const tick = () => new Promise((r) => setTimeout(r, 0));
const $ = (id: string) => document.getElementById(id) as any;
const accounts = { returnValue: true, results: [{ _id: "a1", username: "anna@wall.example" }, { _id: "a2", username: "ben@wall.example" }] };

afterEach(() => { document.body.innerHTML = ""; });

describe("the kit's compose page", () => {
    it("shows the share as the declaration takes it, the account picked, and posts it", async () => {
        const answers: any[] = [{ returnValue: false, errorCode: "503_SERVICE_UNAVAILABLE", errorText: "busy", retryable: true },
                                { returnValue: true, posted: { url: "https://wall.example/1" }, url: "https://wall.example/1" }];
        const calls = open({ share: { title: "T", text: "Hello", url: "https://example.org/",
                                      files: [{ path: "/media/internal/a.jpg", mimeType: "image/jpeg" }, { path: "/media/internal/b.jpg", mimeType: "image/jpeg" },
                                              { path: "/media/internal/c.mp4", mimeType: "video/mp4" }] },
                             accountId: "a2", target },
                           (uri) => /listAccounts$/.test(uri) ? accounts : answers.shift());
        for (let i = 0; i < 5; i++) await tick();
        expect(calls[0]).toEqual({ uri: "luna://com.palm.service.accounts/listAccounts", params: { templateId: "org.example.wall" } });
        expect($("compose").hidden).toBe(false);
        expect($("heading").textContent).toBe("Post to Wall");
        expect($("account").value).toBe("a2");
        expect(Array.from($("account").options as ArrayLike<any>).map((o: any) => o.textContent)).toEqual(["@anna@wall.example", "@ben@wall.example"]);
        expect($("text").value).toBe("Hello");
        expect($("link").textContent).toBe("https://example.org/");
        expect($("count").textContent).toBe("15");
        // One picture (max 1), the video not taken: two left out, and said so.
        expect(document.querySelectorAll(".file")).toHaveLength(1);
        expect($("trimmed").textContent).toMatch(/^2 files are not posted/);
        expect(Array.from(document.querySelectorAll("#audience button")).map((b: any) => b.textContent)).toEqual(["Everyone", "Members"]);
        $("alt0").value = "A lake";
        (document.querySelector("#audience [data-v=members]") as any).click();
        $("post").click();
        for (let i = 0; i < 3; i++) await tick();
        expect($("error").textContent).toMatch(/Not posted: busy\. Try again\./);
        expect($("post").textContent).toBe("Try Again");
        $("post").click();
        for (let i = 0; i < 3; i++) await tick();
        const shares = calls.filter((c) => c.uri === "luna://org.example.service.wall/share");
        expect(shares).toHaveLength(2);
        expect(shares[0].params).toMatchObject({ accountId: "a2", audience: "members",
            content: { title: "T", text: "Hello", url: "https://example.org/", files: [{ path: "/media/internal/a.jpg", mimeType: "image/jpeg", description: "A lake" }] } });
        // A retry is the same post: the same key.
        expect(shares[1].params.idempotencyKey).toBe(shares[0].params.idempotencyKey);
        expect($("done").hidden).toBe(false);
        expect($("posted").textContent).toBe("https://wall.example/1");
    });

    it("with no account signed in, offers to add one", async () => {
        const calls = open({ share: { text: "Hi" }, target }, (uri) => /listAccounts$/.test(uri) ? { returnValue: true, results: [] } : { returnValue: true });
        for (let i = 0; i < 5; i++) await tick();
        expect($("none").hidden).toBe(false);
        expect($("compose").hidden).toBe(true);
        $("setup").click();
        await tick();
        expect(calls.pop()).toEqual({ uri: "luna://com.palm.applicationManager/launch", params: { id: "com.palm.app.accounts", params: { templateId: "org.example.wall" } } });
    });

    it("too long a text cannot be posted", async () => {
        open({ share: { text: "x".repeat(25) }, accountId: "a1", target }, (uri) => /listAccounts$/.test(uri) ? accounts : { returnValue: true });
        for (let i = 0; i < 5; i++) await tick();
        expect($("count").className).toBe("count over");
        expect($("post").disabled).toBe(true);
    });
});
