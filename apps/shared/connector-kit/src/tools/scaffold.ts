// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// phoenix-connector new <app id>: a connector's folder in the layout of
// docs/SYNERGY-CONNECTORS.md 3.1, which passes `validate` as it is and
// whose pull is the one function left to write.

/* eslint-disable @typescript-eslint/no-require-imports */
import { GENERIC_KINDS } from "./checks";

const HEADER = "// SPDX-License-Identifier: Apache-2.0\n";

export interface Scaffold { files: Record<string, string>; service: string; templateId: string }

export function scaffold(appId: string, capability: string): Scaffold {
    if (!/^[a-z0-9]+(\.[a-z0-9-]+){2,}$/.test(appId)) throw new Error("an app id of three labels or more, reverse-DNS, lower case (org.example.foo)");
    capability = capability.toUpperCase();
    const labels = appId.split(".");
    const ns = labels.slice(0, 2).join(".");
    const name = labels.slice(2).join(".");
    const service = ns + ".service." + name;
    const templateId = appId;
    const generic = (GENERIC_KINDS[capability] || [])[capability === "MESSAGING" ? 1 : 0];
    const dataKind = generic ? generic.replace(/:\d+$/, "") + "." + name.replace(/\./g, "-") + ":1" : appId + ".entry:1";
    const stateKind = appId + ".state:1";
    const itemKind = appId + ".item:1";
    const provider = appId + "." + capability.toLowerCase();
    const files: Record<string, string> = {};
    const js = (o: unknown) => JSON.stringify(o, null, 4) + "\n";
    const kind = (id: string, ext?: string) => js(Object.assign({ id, owner: service, sync: false }, ext ? { extends: [ext] } : {}, {
        indexes: [{ name: "accountId", props: [{ name: "accountId" }] }] }));

    files["appinfo.json"] = js({ id: appId, version: "0.1.0", vendor: "Example", type: "web", main: "index.html", title: name,
                                 icon: "icon.png", phoenix: { hidden: true }, requiredPermissions: ["accounts.transport"] });
    files["index.html"] = "<!doctype html>\n<!-- " + appId + " carries a Synergy connector: add the account in Accounts. -->\n" +
        "<html><head><meta charset=\"utf-8\"><title>" + name + "</title></head><body><p>Add the account in Accounts.</p></body></html>\n";
    files["public/accounts/" + templateId + "/" + templateId + ".json"] = js({
        templateId, loc_name: name, icon: { loc_32x32: "images/icon-32x32.png", loc_48x48: "images/icon-48x48.png" },
        loc_usernameLabel: "USER NAME", loc_passwordLabel: "PASSWORD",
        validator: "palm://" + service + "/checkCredentials",
        readPermissions: [service, appId], writePermissions: [appId],
        capabilityProviders: [Object.assign({
            capability, id: provider, loc_name: capability.charAt(0) + capability.slice(1).toLowerCase(),
            implementation: "palm://" + service + "/",
            onCreate: "palm://" + service + "/onCreate", onEnabled: "palm://" + service + "/onEnabled",
            onDelete: "palm://" + service + "/onDelete", onCredentialsChanged: "palm://" + service + "/onCredentialsChanged",
            sync: "palm://" + service + "/sync"
        }, { dbkinds: { [capability.toLowerCase()]: dataKind } })]
    });
    // What the Marketplace's Connections view says of it (publish.ts; server/marketplace Catalog::connectorTypes).
    files["catalog.json"] = js({ accountTypes: [{
        templateId, summary: "What " + name + " brings to this device, in a sentence.",
        protocols: [], auth: { type: "password", registration: "none" }, server: "user",
        privacy: { dataGoesTo: "the server you enter", e2ee: false, phoenixServers: "none" }, push: "poll", status: "experimental"
    }] });
    files["configuration/db/kinds/" + dataKind.replace(/:\d+$/, "")] = kind(dataKind, generic);
    files["configuration/db/kinds/" + stateKind.replace(/:\d+$/, "")] = kind(stateKind);
    files["configuration/db/kinds/" + itemKind.replace(/:\d+$/, "")] = kind(itemKind);
    files["configuration/db/permissions/" + dataKind.replace(/:\d+$/, "")] = js([{
        type: "db.kind", object: dataKind, caller: "com.palm.service.accounts",
        operations: { read: "allow", create: "allow", delete: "allow", update: "allow" } }]);
    files["service/package.json"] = js({ name: service, version: "0.1.0", private: true, main: "service.js", license: "Apache-2.0",
                                         dependencies: { "@phoenix/connector-kit": "*" } });
    files["service/service.js"] = HEADER + "// " + service + " on a device (run-js-service).\n\"use strict\";\n" +
        "require(\"@phoenix/connector-kit/lib/device\").runOnDevice(require(\"./connector\"));\n";
    files["service/connector.js"] = HEADER + [
        "// The " + name + " connector: docs/SYNERGY-SDK.md explains each part.",
        "\"use strict\";",
        "var kit = require(\"@phoenix/connector-kit\");",
        "",
        "module.exports = kit.defineConnector({",
        "    service: " + JSON.stringify(service) + ",",
        "    templateIds: [" + JSON.stringify(templateId) + "],",
        "    kinds: { state: " + JSON.stringify(stateKind) + ", item: " + JSON.stringify(itemKind) + " },",
        "    // The template's validator: check the sign-in, keep what the sync needs.",
        "    validate: function (ctx, p) {",
        "        var server = String((p.config && p.config.serverUrl) || \"\");",
        "        ctx.http.allowHost(new URL(server).host);",
        "        return ctx.http.json({ url: server }).then(function () {",
        "            return { credentials: { common: { password: p.password } }, config: { serverUrl: server } };",
        "        });",
        "    },",
        "    capabilities: {",
        "        " + JSON.stringify(provider) + ": {",
        "            capability: " + JSON.stringify(capability) + ",",
        "            kind: " + JSON.stringify(dataKind) + ",",
        "            // What changed on the server since token (null the first time).",
        "            pull: function (ctx, token) {",
        "                return Promise.resolve({ changes: [], deleted: [], nextToken: token, full: true });",
        "            }",
        "        }",
        "    },",
        "    schedule: { every: \"1h\" }",
        "});",
        ""].join("\n");
    const sysbus = "service/sysbus/" + service;
    files[sysbus + ".service"] = "[D-BUS Service]\nName=" + service + "\nExec=/usr/bin/run-js-service -n /usr/palm/services/" + service + "\nType=dynamic\n";
    files[sysbus + ".role.json"] = js({ appId: service, type: "regular", allowedNames: [service],
        permissions: [{ service, outbound: [service, "com.palm.db", "com.palm.tempdb", "com.palm.activitymanager", "com.palm.service.accounts"] }] });
    files[sysbus + ".api.json"] = js({ "accounts.transport": ["checkCredentials", "onCreate", "onEnabled", "onCredentialsChanged", "onDelete", "sync"]
        .map((m) => service + "/" + m) });
    files[sysbus + ".perm.json"] = js({ [service]: ["database.operation", "activity.operation", "accounts.operation", "accounts.transport"] });
    files[sysbus + ".groups.json"] = js({ allowedNames: [service], "accounts.transport": ["oem"] });
    files[sysbus + ".manifest.json"] = js({ id: service, version: "0.1.0",
        roleFiles: ["/usr/share/luna-service2/roles.d/" + service + ".role.json"],
        serviceFiles: ["/usr/share/luna-service2/services.d/" + service + ".service"],
        apiPermissionFiles: ["/usr/share/luna-service2/api-permissions.d/" + service + ".api.json"],
        clientPermissionFiles: ["/usr/share/luna-service2/client-permissions.d/" + service + ".perm.json"],
        groupsFiles: ["/usr/share/luna-service2/groups.d/" + service + ".groups.json"] });
    return { files, service, templateId };
}

/** A plain picture for the scaffold's icons: a filled square PNG of the given size. */
export function squarePng(size: number, rgb: [number, number, number]): Uint8Array {
    const zlib = require("zlib");
    const crcTable: number[] = [];
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c >>> 0; }
    const crc = (b: Buffer) => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = crcTable[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
    const chunk = (type: string, data: Buffer) => {
        const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
        const td = Buffer.concat([Buffer.from(type, "latin1"), data]);
        const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
        return Buffer.concat([len, td, c]);
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2;
    const raw = Buffer.alloc((size * 3 + 1) * size);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) raw.set(rgb, y * (size * 3 + 1) + 1 + x * 3);
    return new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr),
                                         chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]));
}
