// @vitest-environment node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The packages service's libraries against independent implementations:
// Ed25519 signatures made by Node's crypto (OpenSSL), .ipk packages made and
// read by the system's ar and tar, opkg's version order, and web app
// manifests read as browsers do.

import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;
const ed25519 = require("./lib/ed25519.js") as Any;
const ipkLib = require("./lib/ipk.js") as Any;
const { compare } = require("./lib/version.js") as Any;
const pwa = require("./lib/pwa.js") as Any;

const sha512 = async (b: Uint8Array) => new Uint8Array(crypto.createHash("sha512").update(b).digest());
const gzip = { gzip: async (b: Uint8Array) => new Uint8Array(zlib.gzipSync(b)), gunzip: async (b: Uint8Array) => new Uint8Array(zlib.gunzipSync(b)) };
const ipk = ipkLib.createIpk({ gzip });

function rawPublicKey(key: crypto.KeyObject): Uint8Array {
    // SPKI DER for Ed25519 ends with the 32-byte key.
    const der = key.export({ type: "spki", format: "der" });
    return new Uint8Array(der.subarray(der.length - 32));
}

describe("Ed25519", () => {
    it("accepts signatures made by OpenSSL and refuses changed ones", async () => {
        for (let i = 0; i < 4; i++) {
            const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
            const msg = new TextEncoder().encode(i === 0 ? "" : JSON.stringify({ apps: [i], build: i * 7 }));
            const sig = new Uint8Array(crypto.sign(null, msg, privateKey));
            const pub = rawPublicKey(publicKey);
            expect(await ed25519.verify(sig, msg, pub, sha512)).toBe(true);
            const bad = new Uint8Array(sig);
            bad[i * 9] ^= 1;
            expect(await ed25519.verify(bad, msg, pub, sha512)).toBe(false);
            const other = new Uint8Array(msg.length + 1);
            other.set(msg);
            expect(await ed25519.verify(sig, other, pub, sha512)).toBe(false);
            const otherKey = rawPublicKey(crypto.generateKeyPairSync("ed25519").publicKey);
            expect(await ed25519.verify(sig, msg, otherKey, sha512)).toBe(false);
        }
    });

    it("passes RFC 8032's first test vector", async () => {
        const hex = (s: string) => new Uint8Array(Buffer.from(s, "hex"));
        const pub = hex("d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a");
        const sig = hex("e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b");
        expect(await ed25519.verify(sig, new Uint8Array(0), pub, sha512)).toBe(true);
    });

    it("refuses malformed input", async () => {
        expect(await ed25519.verify(new Uint8Array(10), new Uint8Array(0), new Uint8Array(32), sha512)).toBe(false);
        expect(await ed25519.verify(new Uint8Array(64).fill(255), new Uint8Array(0), new Uint8Array(32).fill(255), sha512)).toBe(false);
    });
});

// These run tar and ar: on a busy CI runner, with every test file at once,
// starting them has taken longer than the default 5 s.
describe(".ipk packages", { timeout: 30000 }, () => {
    const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "phoenix-ipk-"));

    it("reads what opkg-build's tools (ar, tar) make", async () => {
        const d = tmp();
        fs.mkdirSync(path.join(d, "data/usr/palm/applications/com.example.hello/images"), { recursive: true });
        fs.writeFileSync(path.join(d, "data/usr/palm/applications/com.example.hello/appinfo.json"),
            "﻿" + JSON.stringify({ id: "com.example.hello", title: "Hello", version: "1.0.2", type: "web", main: "index.html" }));
        fs.writeFileSync(path.join(d, "data/usr/palm/applications/com.example.hello/index.html"), "<h1>Hello</h1>");
        const long = "a".repeat(120) + ".png";
        fs.writeFileSync(path.join(d, "data/usr/palm/applications/com.example.hello/images/" + long), "png");
        fs.mkdirSync(path.join(d, "control"));
        fs.writeFileSync(path.join(d, "control/control"), "Package: com.example.hello\nVersion: 1.0.2\nArchitecture: all\nDescription: Hello\n second line\n");
        fs.writeFileSync(path.join(d, "control/postinst"), "#!/bin/sh\n");
        fs.writeFileSync(path.join(d, "debian-binary"), "2.0\n");
        execFileSync("tar", ["-czf", "../control.tar.gz", "."], { cwd: path.join(d, "control") });
        execFileSync("tar", ["--format=gnu", "-czf", "../data.tar.gz", "."], { cwd: path.join(d, "data") });
        execFileSync("ar", ["rc", "pkg.ipk", "debian-binary", "control.tar.gz", "data.tar.gz"], { cwd: d });
        const pkg = await ipk.read(new Uint8Array(fs.readFileSync(path.join(d, "pkg.ipk"))));
        expect(pkg.control).toMatchObject({ Package: "com.example.hello", Version: "1.0.2", Architecture: "all", Description: "Hello\nsecond line" });
        expect(pkg.scripts).toEqual(["postinst"]);
        expect(pkg.apps).toEqual([{ id: "com.example.hello", dir: "usr/palm/applications/com.example.hello/",
                                    appinfo: expect.objectContaining({ title: "Hello" }) }]);
        expect(pkg.files.map((f: Any) => f.path).sort()).toEqual([
            "usr/palm/applications/com.example.hello/appinfo.json",
            "usr/palm/applications/com.example.hello/images/" + long,
            "usr/palm/applications/com.example.hello/index.html"]);
    });

    it("writes packages ar and tar read", async () => {
        const bytes = await ipk.write({
            control: { Package: "org.example.pwa", Version: "1.0.0", Architecture: "all", Description: "A web app" },
            files: [{ path: "usr/palm/applications/org.example.pwa/appinfo.json", data: "{\"id\":\"org.example.pwa\"}" },
                    { path: "usr/palm/applications/org.example.pwa/icon.png", data: new Uint8Array([137, 80, 78, 71]) }]
        });
        const d = tmp();
        fs.writeFileSync(path.join(d, "x.ipk"), bytes);
        expect(execFileSync("ar", ["t", "x.ipk"], { cwd: d }).toString().split("\n").filter(Boolean)).toEqual(["debian-binary", "control.tar.gz", "data.tar.gz"]);
        execFileSync("ar", ["x", "x.ipk"], { cwd: d });
        expect(execFileSync("tar", ["-xzOf", "control.tar.gz", "./control"], { cwd: d }).toString()).toContain("Package: org.example.pwa");
        expect(execFileSync("tar", ["-tzf", "data.tar.gz"], { cwd: d }).toString()).toContain("./usr/palm/applications/org.example.pwa/icon.png");
        expect(execFileSync("tar", ["-xzOf", "data.tar.gz", "./usr/palm/applications/org.example.pwa/appinfo.json"], { cwd: d }).toString())
            .toBe("{\"id\":\"org.example.pwa\"}");
        const back = await ipk.read(bytes);
        expect(back.apps[0].id).toBe("org.example.pwa");
        expect(Array.from(back.files[1].data)).toEqual([137, 80, 78, 71]);
    });

    it("refuses what is not a package", async () => {
        await expect(ipk.read(new TextEncoder().encode("<html>404</html>"))).rejects.toMatchObject({ code: "NOT_AN_IPK" });
    });
});

describe("versions", () => {
    it("orders as opkg does", () => {
        const sorted = ["1.0", "1.0~beta1", "1.0.1", "1.0-1", "1.0-10", "1.0-2", "1:0.1", "1.0a", "1.0+b1", "0.9.9", "1.10", "1.9"]
            .sort(compare);
        expect(sorted).toEqual(["0.9.9", "1.0~beta1", "1.0", "1.0-1", "1.0-2", "1.0-10", "1.0a", "1.0+b1", "1.0.1", "1.9", "1.10", "1:0.1"]);
        expect(compare("2.3.4", "2.3.4")).toBe(0);
    });
});

describe("web app manifests", () => {
    it("start where the site's page says, even when the manifest is on a CDN", () => {
        // open.spotify.com links its manifest on open.spotifycdn.com.
        const m = pwa.parseManifest({ name: "Spotify", start_url: "https://open.spotify.com/", icons: [{ src: "i/192.png", sizes: "192x192", type: "image/png" }] },
                                    "https://open.spotifycdn.com/cdn/manifest.json", "https://open.spotify.com/");
        expect(m.startUrl).toBe("https://open.spotify.com/");
        expect(m.icons[0].src).toBe("https://open.spotifycdn.com/cdn/i/192.png");
        // A relative start_url resolves against the CDN, which is not the page's origin: the page is the start.
        expect(pwa.parseManifest({ name: "Box", start_url: "." }, "https://cdn01.boxcdn.net/m.json", "https://app.box.com/").startUrl)
            .toBe("https://app.box.com/");
        expect(pwa.parseManifest({ name: "Tides", start_url: "https://evil.example/" }, "https://tides.example/app/m.json").startUrl)
            .toBe("https://tides.example/");
    });
});
