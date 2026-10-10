// @vitest-environment node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// phoenix-connector publish (publish.ts) against the Marketplace's own
// catalog service (server/marketplace), started here on a free port as a
// development catalog (MARKETPLACE_DEV=1, as bin/serve.sh runs it), with its
// data in a temporary folder. Skipped without PHP 8 (./phoenix installs it).

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { catalogDetailsProblem, catalogRoot, isLocal, publish } from "./publish";
import { main } from "./cli";
import { pack } from "./package";
import { scaffold, squarePng } from "./scaffold";

const cp = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const REPO = path.resolve(__dirname, "../../../../..");
const SERVER = path.join(REPO, "server/marketplace");
const FEEDS = path.join(REPO, "apps/shared/connector-kit/examples/feeds");
const hasPhp = cp.spawnSync("php", ["-r", "exit(PHP_MAJOR_VERSION >= 8 && extension_loaded('sodium') && extension_loaded('pdo_sqlite') ? 0 : 1);"]).status === 0;

describe("catalog addresses", () => {
    it("a catalog's root from its address or its /v1/", () => {
        expect(catalogRoot("http://127.0.0.1:8088/v1/")).toBe("http://127.0.0.1:8088/");
        expect(catalogRoot("https://apps.example.org/phoenix/v1")).toBe("https://apps.example.org/phoenix/");
        expect(catalogRoot("http://127.0.0.1:8088")).toBe("http://127.0.0.1:8088/");
        expect(isLocal("http://127.0.0.1:8088/")).toBe(true);
        expect(isLocal("http://localhost:9000/")).toBe(true);
        expect(isLocal("https://apps.example.org/")).toBe(false);
    });
    it("catalog.json: there, JSON, and naming each template", () => {
        const enc = (o: unknown) => new TextEncoder().encode(JSON.stringify(o));
        expect(catalogDetailsProblem({}, ["a.b.c"])).toMatch(/catalog.json is missing/);
        expect(catalogDetailsProblem({ "catalog.json": new TextEncoder().encode("{") }, ["a.b.c"])).toMatch(/not valid JSON/);
        expect(catalogDetailsProblem({ "catalog.json": enc({ accountTypes: [{ templateId: "x.y.z" }] }) }, ["a.b.c"])).toMatch(/nothing for the template a.b.c/);
        expect(catalogDetailsProblem({ "catalog.json": enc({ accountTypes: [{ templateId: "a.b.c" }] }) }, ["a.b.c"])).toBe("");
    });
    it("a catalog that is not on this computer needs a token", async () => {
        await expect(publish(FEEDS, { catalog: "https://apps.example.org/v1/", vendor: false }))
            .rejects.toThrow(/--token TOKEN or PHOENIX_CATALOG_TOKEN/);
    });
});

describe.skipIf(!hasPhp)("publishing to a development catalog", () => {
    let tmp: string, data: string, server: any, url: string;
    const php = (...args: string[]) => cp.execFileSync("php", [path.join(SERVER, "bin/marketplace.php"), ...args],
        { env: { ...process.env, MARKETPLACE_DATA: data, MARKETPLACE_DEV: "1", MARKETPLACE_BASE_URL: url + "v1/" }, encoding: "utf8" });
    const index = async () => (await (await fetch(url + "v1/index.json")).json()) as any;

    beforeAll(async () => {
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), "phoenix-publish-"));
        data = path.join(tmp, "data");
        const port = 19000 + Math.floor(Math.random() * 900);
        url = "http://127.0.0.1:" + port + "/";
        php("init");
        php("developer");
        server = cp.spawn("php", ["-S", "127.0.0.1:" + port, path.join(SERVER, "public/router.php")], {
            env: { ...process.env, MARKETPLACE_DATA: data, MARKETPLACE_DEV: "1", MARKETPLACE_BASE_URL: url + "v1/" }, stdio: "ignore"
        });
        for (let i = 0; i < 100; i++) {
            try { if ((await fetch(url + "api/health")).ok) return; } catch (e) { /* not yet */ }
            await new Promise((r) => setTimeout(r, 100));
        }
        throw new Error("the catalog service did not start");
    }, 30000);
    afterAll(() => {
        if (server) server.kill();
        if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
    });

    it("packs, uploads as the catalog's local developer, and the account type is in Connections at once", async () => {
        const logs: string[] = [];
        const r = await publish(FEEDS, { catalog: url, vendor: false, tokenFile: path.join(data, "developer.token"), log: (s) => logs.push(s) });
        expect(r).toMatchObject({ appId: "org.example.feeds", version: "0.1.0", state: "approved", templates: ["org.example.feeds"], catalog: url });
        expect(r.build).toBeGreaterThan(1);
        expect(logs.some((l) => /^Packed org\.example\.feeds_0\.1\.0_all\.ipk/.test(l))).toBe(true);
        const idx = await index();
        expect(idx.build).toBe(r.build);
        const entry = idx.apps.find((a: any) => a.id === "org.example.feeds");
        expect(entry).toMatchObject({ kind: "connector", version: "0.1.0" });
        const type = idx.accounts.find((t: any) => t.templateId === "org.example.feeds");
        expect(type).toMatchObject({ title: "News Feed (example)", status: "experimental", package: { id: "org.example.feeds", builtin: false },
                                     capabilities: [{ capability: "FEEDS", direction: "read-only" }] });
        // The same version again: refused, saying so.
        await expect(publish(FEEDS, { catalog: url, vendor: false, tokenFile: path.join(data, "developer.token") }))
            .rejects.toThrow(/refused it: Version 0\.1\.0 of org\.example\.feeds was uploaded already/);
    });

    it("a new connector (phoenix-connector new) publishes as it is; without a token file it registers a developer and keeps the token", async () => {
        const dir = path.join(tmp, "demo");
        const made = scaffold("org.example.demo", "CONTACTS");
        Object.keys(made.files).forEach((rel) => {
            fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
            fs.writeFileSync(path.join(dir, rel), made.files[rel]);
        });
        const png = squarePng;
        fs.mkdirSync(path.join(dir, "public/accounts/org.example.demo/images"), { recursive: true });
        [32, 48].forEach((s) => [1, 2].forEach((k) => fs.writeFileSync(
            path.join(dir, "public/accounts/org.example.demo/images/icon-" + s + "x" + s + (k > 1 ? "@2x" : "") + ".png"), png(s * k, [1, 2, 3]))));
        const cache = path.join(tmp, "tokens.json");
        const r = await publish(dir, { catalog: url, vendor: false, tokenFile: path.join(tmp, "none.token"), tokenCache: cache });
        expect(r.state).toBe("approved");
        expect(JSON.parse(fs.readFileSync(cache, "utf8"))[url]).toMatch(/^[0-9a-f]{48}$/);
        expect((await index()).accounts.map((t: any) => t.templateId)).toContain("org.example.demo");
    });

    // (The catalog's own refusals are server/marketplace/tests/run.php's.)
    it("refuses, before uploading, a connector without catalog.json or one that breaks a rule", async () => {
        const dir = path.join(tmp, "demo");
        fs.renameSync(path.join(dir, "catalog.json"), path.join(tmp, "catalog.json"));
        await expect(publish(dir, { catalog: url, vendor: false, tokenFile: path.join(data, "developer.token") })).rejects.toThrow(/catalog.json is missing/);
        fs.renameSync(path.join(tmp, "catalog.json"), path.join(dir, "catalog.json"));
        // Another namespace than its template's (C5): the kit runs the catalog's rules first.
        const appinfo = JSON.parse(fs.readFileSync(path.join(dir, "appinfo.json"), "utf8"));
        fs.writeFileSync(path.join(dir, "appinfo.json"), JSON.stringify(Object.assign(appinfo, { version: "0.2.0", id: "org.other.demo" })));
        await expect(publish(dir, { catalog: url, vendor: false, tokenFile: path.join(data, "developer.token") })).rejects.toThrow(/does not pass the checks/);
    });

    it("the command: publish --catalog URL, its words and exit status", async () => {
        const out: string[] = [], err: string[] = [];
        const io = { log: (s: string) => out.push(s), err: (s: string) => err.push(s) };
        process.env.MARKETPLACE_DATA = data;
        // An .ipk packed without the kit inside (vendor: false, as the tests
        // above), so the command does not need the kit built first.
        const ipk = pack(FEEDS, fs.mkdtempSync(path.join(tmp, "ipk-")), { vendor: false }).file;
        try {
            expect(await main(["publish", ipk, "--catalog", url], io)).toBe(1);   // uploaded already (above)
            expect(err.join("\n")).toMatch(/uploaded already/);
            expect(await main(["publish"], io)).toBe(2);
        } finally { delete process.env.MARKETPLACE_DATA; }
    });
});
