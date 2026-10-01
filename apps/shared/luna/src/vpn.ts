// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// VPN: com.webos.service.vpn, LuneOS's luneos-vpn-adapter
// (github.com/webOS-ports/luneos-vpn-adapter, Apache-2.0; src/vpn_service.c).
//
// webOS OSE has no VPN service, and legacy webOS's com.palm.vpn was not
// released. LuneOS bridges connman-vpnd onto the bus with the legacy method
// names and error codes; Phoenix uses it unchanged on a device, and the
// simulator implements it (runtime/phoenix-runtime.js, "VPN").
//
//   getStatus {subscribe}            -> {connmanVpnAvailable, activeProfiles}; the same
//                                       subscription carries credential prompts, notices
//                                       and promptResolved
//   getProfileList {subscribe}       -> {vpnProfiles: [entry]}
//   getProfileDetails {vpnProfileName, subscribe?} -> {vpnAgentGuid, vpnProfile: {vpnHost,
//                                       vpnDomain?, vpnFormFields}}  (secrets never return)
//   getConnectionDetails {vpnProfileName, subscribe?} -> {state, clientIpAddress, ...}
//   getAgents                        -> {vpnAgents: [{vpnAgentGuid, vpnAgentLabel, ...}]}
//   getAgentFormFields {vpnAgentGuid} -> {vpnFormFields}  (the type's blank form)
//   connect {vpnProfileName}          -> ok, or -7 {promptId} when credentials are asked for
//   disconnect {vpnProfileName?}       (none: all)
//   addProfile {vpnProfileName, vpnAgentGuid, vpnProfile: {vpnHost, vpnDomain?, vpnFormFields}}
//   updateProfile {vpnProfileName, vpnProfile}   (no rename, no type change)
//   deleteProfile {vpnProfileName}
//   uiPromptResponse {promptId, vpnFormFields | cancelled: true}
//
// Configuration files: the service advertises import (wg-conf, ovpn) but has
// no import method yet, so clients do it: a wg-quick .conf is split into the
// WireGuard fields (parseWireGuardConf), and an .ovpn file is stored on the
// device and given as OpenVPN.ConfigFile (parseOpenVpnConf finds its server).

import { call, subscribe, type LunaError, type Subscription } from "./bridge";

const VPN = "luna://com.webos.service.vpn";

/** The legacy com.palm.vpn error codes (vpn_errors.h). The UI shows no error for -5 and -7. */
export const VPN_ERRORS = {
    UNKNOWN: -1,
    INVALID_PARAMS: -2,
    PROFILE_NOT_FOUND: -3,
    PROFILE_EXISTS: -4,
    PROMPT_CANCELLED: -5,
    AGENT_FAILURE: -6,
    NEEDS_AUTH: -7,
    NO_BACKEND: -8,
    UNSUPPORTED_TYPE: -9,
    IMMUTABLE: -10,
} as const;

export type VpnConnectState = "connected" | "connecting" | "disconnecting" | "disconnected" | "unknown";

/** getProfileList / getStatus entries. */
export interface VpnProfileEntry {
    vpnProfileName: string;
    vpnAgentGuid?: string;
    vpnHost?: string;
    vpnProfileConnectState: VpnConnectState;
    immutable: boolean;
    splitRouting: boolean;
}

/** A form field (files/formfields/*.json, and the prompts' fields). Values are always strings. */
export interface VpnFormField {
    id: string;
    type: "textfield" | "passwordfield" | "checkbox" | "listselector" | "status" | "label" | "rowgroup" | "groups" | string;
    label?: string;
    value?: string;
    hint?: string;
    inputType?: "number" | string;
    editable?: boolean;
    required?: boolean;
    connmanProperty?: string;
    connmanPropertyMap?: Record<string, Record<string, string>>;
    options?: { label: string; value: string; deprecated?: boolean }[];
    trueValue?: string;
    falseValue?: string;
    statusType?: string;
    note?: string;
    hasStoredValue?: boolean;
    promptValueType?: string;
    vpnFormFields?: VpnFormField[];
    groups?: { vpnFormFields?: VpnFormField[] }[];
}

export interface VpnAgent {
    vpnAgentGuid: string;
    vpnAgentLabel: string;
    vpnAgentTechnology: string[];
    connmanType: string;
    vpnAgentIcon: string;
    vpnAgentEula: string;
    deprecated?: boolean;
    supportsImport?: string[];
}

export interface VpnProfileDetails {
    vpnProfileName: string;
    vpnAgentGuid?: string;
    immutable?: boolean;
    vpnProfile: { vpnHost?: string; vpnDomain?: string; vpnFormFields?: VpnFormField[] };
}

export interface VpnConnectionDetails {
    state: VpnConnectState;
    tunnelType?: string;
    serverHostname?: string;
    domain?: string;
    clientIpAddress?: string;
    netmask?: string;
    gateway?: string;
    ifName?: string;
    bytesRx?: number;
    bytesTx?: number;
    splitRouting: boolean;
    nameservers?: string[];
}

/** What a getStatus subscription delivers: the status, or one of the agent's messages. */
export type VpnStatusEvent =
    | { kind: "status"; available: boolean; active: VpnProfileEntry[] }
    | { kind: "prompt"; promptId: string; vpnProfileName?: string; vpnAgentGuid?: string; label: string; vpnFormFields: VpnFormField[] }
    | { kind: "notice"; vpnProfileName?: string; notice: string; severity: string }
    | { kind: "promptResolved"; promptId: string };

export interface VpnProfileInput {
    vpnHost: string;
    vpnDomain?: string;
    vpnFormFields?: VpnFormField[];
}

function statusEvent(r: Record<string, unknown>): VpnStatusEvent {
    if (typeof r.promptId === "string" && r.promptResolved) return { kind: "promptResolved", promptId: r.promptId };
    if (typeof r.promptId === "string")
        return { kind: "prompt", promptId: r.promptId, vpnProfileName: r.vpnProfileName as string | undefined,
                 vpnAgentGuid: r.vpnAgentGuid as string | undefined, label: String(r.label ?? ""),
                 vpnFormFields: (r.vpnFormFields as VpnFormField[]) ?? [] };
    if ("notice" in r)
        return { kind: "notice", vpnProfileName: r.vpnProfileName as string | undefined, notice: String(r.notice ?? ""),
                 severity: String(r.noticeSeverity ?? "") };
    return { kind: "status", available: !!r.connmanVpnAvailable, active: (r.activeProfiles as VpnProfileEntry[]) ?? [] };
}

export const vpn = {
    watchStatus(cb: (e: VpnStatusEvent) => void, onError?: (e: LunaError) => void): Subscription {
        return subscribe(`${VPN}/getStatus`, {}, (r) => cb(statusEvent(r as Record<string, unknown>)), onError);
    },
    watchProfiles(cb: (profiles: VpnProfileEntry[]) => void, onError?: (e: LunaError) => void): Subscription {
        return subscribe(`${VPN}/getProfileList`, {}, (r) => cb((r as { vpnProfiles?: VpnProfileEntry[] }).vpnProfiles ?? []), onError);
    },
    async details(name: string): Promise<VpnProfileDetails> {
        return await call(`${VPN}/getProfileDetails`, { vpnProfileName: name }) as unknown as VpnProfileDetails;
    },
    watchConnection(name: string, cb: (d: VpnConnectionDetails) => void, onError?: (e: LunaError) => void): Subscription {
        return subscribe(`${VPN}/getConnectionDetails`, { vpnProfileName: name }, (r) => cb(r as unknown as VpnConnectionDetails), onError);
    },
    async agents(): Promise<VpnAgent[]> {
        return ((await call(`${VPN}/getAgents`, {})) as unknown as { vpnAgents?: VpnAgent[] }).vpnAgents ?? [];
    },
    async formFields(guid: string): Promise<VpnFormField[]> {
        return ((await call(`${VPN}/getAgentFormFields`, { vpnAgentGuid: guid })) as unknown as { vpnFormFields: VpnFormField[] }).vpnFormFields;
    },
    /** Rejects with errorCode -7 and reply.promptId when it asks for credentials (the prompt arrives on watchStatus). */
    connect(name: string) {
        return call(`${VPN}/connect`, { vpnProfileName: name });
    },
    /** One profile, or every connected one. */
    disconnect(name?: string) {
        return call(`${VPN}/disconnect`, name ? { vpnProfileName: name } : {});
    },
    add(name: string, guid: string, profile: VpnProfileInput) {
        return call(`${VPN}/addProfile`, { vpnProfileName: name, vpnAgentGuid: guid, vpnProfile: profile });
    },
    update(name: string, profile: Partial<VpnProfileInput>) {
        return call(`${VPN}/updateProfile`, { vpnProfileName: name, vpnProfile: profile });
    },
    remove(name: string) {
        return call(`${VPN}/deleteProfile`, { vpnProfileName: name });
    },
    respond(promptId: string, fields: VpnFormField[]) {
        return call(`${VPN}/uiPromptResponse`, { promptId, vpnFormFields: fields });
    },
    cancelPrompt(promptId: string) {
        return call(`${VPN}/uiPromptResponse`, { promptId, cancelled: true });
    },
};

/** The fields of a form, flattened (rowgroup and groups opened). */
export function flattenFields(fields: readonly VpnFormField[]): VpnFormField[] {
    return fields.flatMap((f) =>
        f.type === "rowgroup" ? flattenFields(f.vpnFormFields ?? [])
        : f.type === "groups" ? (f.groups ?? []).flatMap((g) => flattenFields(g.vpnFormFields ?? []))
        : [f]);
}

/** A form with values set by connmanProperty (the others keep theirs). */
export function withValues(fields: readonly VpnFormField[], values: Record<string, string>): VpnFormField[] {
    return fields.map((f) => {
        if (f.type === "rowgroup") return { ...f, vpnFormFields: withValues(f.vpnFormFields ?? [], values) };
        if (f.type === "groups") return { ...f, groups: (f.groups ?? []).map((g) => ({ ...g, vpnFormFields: withValues(g.vpnFormFields ?? [], values) })) };
        return f.connmanProperty && f.connmanProperty in values ? { ...f, value: values[f.connmanProperty] } : f;
    });
}

export interface ParsedConf {
    /** vpnHost */
    host: string;
    /** connmanProperty -> value */
    values: Record<string, string>;
}

/**
 * A wg-quick configuration (wg-quick(8), wg(8)) split into connman's
 * WireGuard properties, as the service expects (its import is not there yet):
 * [Interface] PrivateKey, Address, DNS, ListenPort; the first [Peer]'s
 * PublicKey, PresharedKey, AllowedIPs, Endpoint (host -> vpnHost, port ->
 * EndpointPort) and PersistentKeepalive. Throws on what connman cannot use.
 */
export function parseWireGuardConf(text: string): ParsedConf {
    let section = "";
    const iface: Record<string, string> = {};
    const peers: Record<string, string>[] = [];
    for (const raw of text.split(/\r?\n/)) {
        const line = raw.replace(/#.*$/, "").trim();
        if (!line) continue;
        const sec = /^\[(\w+)\]$/.exec(line);
        if (sec) {
            section = sec[1].toLowerCase();
            if (section === "peer") peers.push({});
            continue;
        }
        const kv = /^(\w+)\s*=\s*(.*)$/.exec(line);
        if (!kv) continue;
        const target = section === "interface" ? iface : section === "peer" ? peers[peers.length - 1] : null;
        if (target) target[kv[1].toLowerCase()] = kv[2].trim();
    }
    const key = /^[A-Za-z0-9+/]{42}[AEIMQUYcgkosw048]=$/;
    if (!key.test(iface.privatekey ?? "")) throw new Error("The [Interface] needs a PrivateKey (a WireGuard key).");
    if (!iface.address) throw new Error("The [Interface] needs an Address.");
    const peer = peers[0];
    if (!peer) throw new Error("There is no [Peer].");
    if (!key.test(peer.publickey ?? "")) throw new Error("The [Peer] needs a PublicKey (a WireGuard key).");
    const ep = /^\[?([^\]]+?)\]?:(\d+)$/.exec(peer.endpoint ?? "");
    if (!ep) throw new Error("The [Peer] needs an Endpoint (host:port).");
    const values: Record<string, string> = {
        "WireGuard.PrivateKey": iface.privatekey,
        "WireGuard.Address": iface.address,
        "WireGuard.PublicKey": peer.publickey,
        "WireGuard.EndpointPort": ep[2],
        "WireGuard.AllowedIPs": peer.allowedips ?? "0.0.0.0/0, ::/0",
    };
    if (iface.dns) values["WireGuard.DNS"] = iface.dns;
    if (iface.listenport) values["WireGuard.ListenPort"] = iface.listenport;
    if (peer.presharedkey) values["WireGuard.PresharedKey"] = peer.presharedkey;
    if (peer.persistentkeepalive) values["WireGuard.PersistentKeepalive"] = peer.persistentkeepalive;
    return { host: ep[1], values };
}

/**
 * An OpenVPN client configuration (openvpn(8)): its first remote (the
 * server, and port and protocol when given), and whether the server wants a
 * user name and password (auth-user-pass, which connman's OpenVPN.AuthUserPass
 * "-" asks for at connect). The file itself goes to OpenVPN.ConfigFile.
 */
export function parseOpenVpnConf(text: string): ParsedConf {
    let host = "";
    const values: Record<string, string> = {};
    for (const raw of text.split(/\r?\n/)) {
        const line = raw.trim();
        if (!line || /^[#;]/.test(line)) continue;
        const remote = /^remote\s+(\S+)(?:\s+(\d+))?(?:\s+(udp|tcp|tcp-client)\b)?/.exec(line);
        if (remote && !host) {
            host = remote[1];
            if (remote[2]) values["OpenVPN.Port"] = remote[2];
            // The form's choices (files/formfields/openvpn.json): udp, tcp.
            if (remote[3]) values["OpenVPN.Proto"] = remote[3] === "udp" ? "udp" : "tcp";
        }
        if (/^auth-user-pass(\s|$)/.test(line)) values["OpenVPN.AuthUserPass"] = "-";
    }
    if (!host) throw new Error("There is no remote (the server) in this configuration.");
    return { host, values };
}
