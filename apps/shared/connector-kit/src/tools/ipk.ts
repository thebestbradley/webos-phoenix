// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// .ipk packages as opkg-build, palm-package and the Marketplace read and
// write them (apps/marketplace/service/lib/ipk.js, server/marketplace/src/Ipk.php):
// an ar archive of "debian-binary" ("2.0\n"), control.tar.gz (./control)
// and data.tar.gz (the files at their device paths). Node only (zlib).

/* eslint-disable @typescript-eslint/no-require-imports */

export interface IpkFile { path: string; data: Uint8Array; mode?: number }
export interface ReadIpk {
    control: Record<string, string>;
    scripts: string[];
    files: IpkFile[];
    links: string[];
}

const SCRIPTS = ["preinst", "postinst", "prerm", "postrm", "pmPostInstall.script", "pmPreRemove.script"];

function zlib(): any { return require("zlib"); }
const enc = (s: string) => new Uint8Array(Buffer.from(s, "utf8"));
const ascii = (b: Uint8Array, a: number, z: number) => Buffer.from(b.subarray(a, z)).toString("latin1");

function concat(parts: Uint8Array[]): Uint8Array {
    return new Uint8Array(Buffer.concat(parts.map((p) => Buffer.from(p))));
}

// ---- ar --------------------------------------------------------------------------------

function writeAr(entries: { name: string; data: Uint8Array }[]): Uint8Array {
    const field = (v: string | number, n: number) => { let s = String(v); while (s.length < n) s += " "; return s.slice(0, n); };
    const parts: Uint8Array[] = [enc("!<arch>\n")];
    entries.forEach((e) => {
        parts.push(enc(field(e.name, 16) + field(0, 12) + field(0, 6) + field(0, 6) + field("100644", 8) + field(e.data.length, 10) + "`\n"), e.data);
        if (e.data.length % 2) parts.push(new Uint8Array([10]));
    });
    return concat(parts);
}

function readAr(b: Uint8Array): Record<string, Uint8Array> {
    if (ascii(b, 0, 8) !== "!<arch>\n") throw new Error("Not an .ipk package (no ar header)");
    const out: Record<string, Uint8Array> = {};
    let pos = 8;
    while (pos + 60 <= b.length) {
        const name = ascii(b, pos, pos + 16).trim().replace(/\/$/, "");
        const size = parseInt(ascii(b, pos + 48, pos + 58).trim(), 10);
        if (ascii(b, pos + 58, pos + 60) !== "`\n" || !(size >= 0)) throw new Error("Damaged .ipk package (ar)");
        out[name] = b.subarray(pos + 60, pos + 60 + size);
        pos += 60 + size + (size % 2);
    }
    return out;
}

// ---- tar (ustar) -----------------------------------------------------------------------

function tarHeader(path: string, size: number, type: string, mode: number): Uint8Array {
    const h = new Uint8Array(512);
    const put = (off: number, len: number, s: string) => h.set(enc(s).subarray(0, len), off);
    const octal = (off: number, len: number, n: number) => { let s = n.toString(8); while (s.length < len - 1) s = "0" + s; put(off, len, s + "\0"); };
    let name = path, prefix = "";
    if (enc(name).length > 100) {
        const cut = path.lastIndexOf("/", 154);
        prefix = path.slice(0, cut);
        name = path.slice(cut + 1);
        if (cut < 0 || enc(name).length > 100) throw new Error("Path too long for the package: " + path);
    }
    put(0, 100, name);
    octal(100, 8, mode);
    octal(108, 8, 0);
    octal(116, 8, 0);
    octal(124, 12, size);
    octal(136, 12, Math.floor(Date.UTC(2026, 0, 1) / 1000));
    for (let i = 148; i < 156; i++) h[i] = 32;
    h[156] = type.charCodeAt(0);
    put(257, 6, "ustar\0");
    put(263, 2, "00");
    put(345, 155, prefix);
    let sum = 0;
    for (let j = 0; j < 512; j++) sum += h[j];
    octal(148, 7, sum);
    h[155] = 32;
    return h;
}

function writeTar(files: IpkFile[]): Uint8Array {
    const parts: Uint8Array[] = [];
    const dirs: Record<string, boolean> = {};
    files.forEach((f) => {
        const segs = f.path.split("/");
        for (let i = 1; i < segs.length; i++) {
            const d = "./" + segs.slice(0, i).join("/") + "/";
            if (dirs[d]) continue;
            dirs[d] = true;
            parts.push(tarHeader(d, 0, "5", 0o755));
        }
        parts.push(tarHeader("./" + f.path, f.data.length, "0", f.mode || 0o644), f.data);
        if (f.data.length % 512) parts.push(new Uint8Array(512 - (f.data.length % 512)));
    });
    parts.push(new Uint8Array(1024));
    return concat(parts);
}

function readTar(b: Uint8Array): { files: IpkFile[]; links: string[] } {
    const files: IpkFile[] = [], links: string[] = [];
    let pos = 0, longName: string | null = null;
    while (pos + 512 <= b.length) {
        const h = b.subarray(pos, pos + 512);
        if (h.every((x) => x === 0)) break;
        const name = ascii(h, 0, 100).replace(/\0.*$/s, "");
        const size = parseInt(ascii(h, 124, 136).replace(/\0.*$/s, "").trim() || "0", 8);
        const type = String.fromCharCode(h[156] || 48);
        const prefix = ascii(h, 345, 500).replace(/\0.*$/s, "");
        const mode = parseInt(ascii(h, 100, 108).replace(/\0.*$/s, "").trim() || "0", 8);
        const body = b.subarray(pos + 512, pos + 512 + size);
        pos += 512 + Math.ceil(size / 512) * 512;
        if (type === "L") { longName = Buffer.from(body).toString("utf8").replace(/\0.*$/s, ""); continue; }
        if (type === "x") { const m = /\d+ path=([^\n]*)\n/.exec(Buffer.from(body).toString("utf8")); if (m) longName = m[1]; continue; }
        if (type === "g") continue;
        let path = longName || (prefix ? prefix + "/" + name : name);
        longName = null;
        path = path.replace(/^\.\//, "").replace(/^\/+/, "");
        if (("/" + path + "/").indexOf("/../") >= 0) throw new Error("The package has a path with .. (" + path + ")");
        if (type === "0" || type === "\0" || type === "7") files.push({ path, data: body, mode });
        else if (type === "1" || type === "2") links.push(path);
    }
    return { files, links };
}

export function parseControl(t: string): Record<string, string> {
    const out: Record<string, string> = {};
    let key: string | null = null;
    t.split(/\r?\n/).forEach((line) => {
        if (key && /^\s/.test(line)) out[key] += "\n" + line.trim();
        else {
            const m = /^([A-Za-z0-9-]+):\s*(.*)$/.exec(line);
            if (m) { key = m[1]; out[key] = m[2]; }
        }
    });
    return out;
}

export function writeIpk(control: Record<string, string>, files: IpkFile[]): Uint8Array {
    const z = zlib();
    const controlText = Object.keys(control).map((k) => k + ": " + control[k]).join("\n") + "\n";
    const gz = (b: Uint8Array) => new Uint8Array(z.gzipSync(Buffer.from(b), { level: 9 }));
    return writeAr([
        { name: "debian-binary", data: enc("2.0\n") },
        { name: "control.tar.gz", data: gz(writeTar([{ path: "control", data: enc(controlText) }])) },
        { name: "data.tar.gz", data: gz(writeTar(files)) }
    ]);
}

export function readIpk(bytes: Uint8Array): ReadIpk {
    const z = zlib();
    const ar = readAr(bytes);
    if (!ar["control.tar.gz"] || !ar["data.tar.gz"]) throw new Error("Not an .ipk package (no control.tar.gz or data.tar.gz)");
    const gunzip = (b: Uint8Array) => {
        try { return new Uint8Array(z.gunzipSync(Buffer.from(b))); } catch (e) { throw new Error("Damaged .ipk package (gzip)"); }
    };
    const control = readTar(gunzip(ar["control.tar.gz"]));
    const data = readTar(gunzip(ar["data.tar.gz"]));
    const controlFile = control.files.filter((f) => f.path === "control")[0];
    return {
        control: controlFile ? parseControl(Buffer.from(controlFile.data).toString("utf8")) : {},
        scripts: control.files.map((f) => f.path).filter((p) => SCRIPTS.indexOf(p) >= 0),
        files: data.files,
        links: data.links
    };
}
