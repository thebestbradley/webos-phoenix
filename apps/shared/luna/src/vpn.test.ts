// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { flattenFields, parseOpenVpnConf, parseWireGuardConf, withValues, type VpnFormField } from "./vpn";

// The WireGuard documentation's example keys.
const PRIV = "yAnz5TF+lXXJte14tji3zlMNq+hd2rYUIgJBgB3fBmk=";
const PUB = "xTIBA5rboUvnH4htodjb6e697QjLERt1NAB4mZqp8Dg=";

describe("parseWireGuardConf", () => {
    it("splits a wg-quick file into connman's WireGuard properties", () => {
        const r = parseWireGuardConf(`# home
[Interface]
PrivateKey = ${PRIV}
Address = 10.8.0.2/32, fd00::2/128
DNS = 10.8.0.1
ListenPort = 51000

[Peer]
PublicKey = ${PUB}
PresharedKey = ${PRIV}
Endpoint = vpn.example.com:51820
AllowedIPs = 0.0.0.0/0, ::/0
PersistentKeepalive = 25
`);
        expect(r.host).toBe("vpn.example.com");
        expect(r.values).toEqual({
            "WireGuard.PrivateKey": PRIV,
            "WireGuard.Address": "10.8.0.2/32, fd00::2/128",
            "WireGuard.PublicKey": PUB,
            "WireGuard.EndpointPort": "51820",
            "WireGuard.AllowedIPs": "0.0.0.0/0, ::/0",
            "WireGuard.DNS": "10.8.0.1",
            "WireGuard.ListenPort": "51000",
            "WireGuard.PresharedKey": PRIV,
            "WireGuard.PersistentKeepalive": "25",
        });
    });

    it("takes an IPv6 endpoint in brackets", () => {
        const r = parseWireGuardConf(`[Interface]\nPrivateKey=${PRIV}\nAddress=10.0.0.2/32\n[Peer]\nPublicKey=${PUB}\nEndpoint=[2001:db8::1]:443\n`);
        expect(r.host).toBe("2001:db8::1");
        expect(r.values["WireGuard.EndpointPort"]).toBe("443");
    });

    it("says what is missing", () => {
        expect(() => parseWireGuardConf("[Interface]\nAddress = 10.0.0.2/32\n")).toThrow(/PrivateKey/);
        expect(() => parseWireGuardConf(`[Interface]\nPrivateKey = ${PRIV}\n`)).toThrow(/Address/);
        expect(() => parseWireGuardConf(`[Interface]\nPrivateKey = ${PRIV}\nAddress = 10.0.0.2/32\n`)).toThrow(/Peer/);
        expect(() => parseWireGuardConf(`[Interface]\nPrivateKey = ${PRIV}\nAddress = a\n[Peer]\nPublicKey = ${PUB}\n`)).toThrow(/Endpoint/);
        expect(() => parseWireGuardConf(`[Interface]\nPrivateKey = not-a-key\nAddress = a\n`)).toThrow(/PrivateKey/);
    });
});

describe("parseOpenVpnConf", () => {
    it("finds the server, its port and protocol, and auth-user-pass", () => {
        const r = parseOpenVpnConf("client\ndev tun\n# remote old.example.net\nremote home.example.net 443 tcp\nremote backup.example.net\nauth-user-pass\n<ca>\n...\n</ca>\n");
        expect(r.host).toBe("home.example.net");
        expect(r.values).toEqual({ "OpenVPN.Port": "443", "OpenVPN.Proto": "tcp", "OpenVPN.AuthUserPass": "-" });
    });

    it("needs a remote", () => {
        expect(() => parseOpenVpnConf("client\ndev tun\n")).toThrow(/remote/);
    });
});

describe("form helpers", () => {
    const form: VpnFormField[] = [
        { id: "a", type: "textfield", connmanProperty: "X.A" },
        { id: "g", type: "rowgroup", vpnFormFields: [{ id: "b", type: "textfield", connmanProperty: "X.B", value: "old" }] },
    ];
    it("fills fields by connmanProperty, in groups too", () => {
        const filled = withValues(form, { "X.A": "1", "X.B": "2" });
        expect(flattenFields(filled).map((f) => f.value)).toEqual(["1", "2"]);
        expect(form[0].value).toBeUndefined();
    });
});
