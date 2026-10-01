// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// VPN: the profiles, connect and disconnect, add, edit, delete, and the
// sign-in a VPN asks for when connecting. Legacy webOS had a VPN app
// (com.palm.app.vpn) behind the system menu's VPN drawer; it and its service
// were not released. This works the way it did, on LuneOS's
// com.webos.service.vpn (connman-vpnd; legacy method names and error codes):
// the VPN types are the service's agents, each type's settings are its form
// fields (getAgentFormFields), drawn here as they come, and a sign-in is a
// prompt on getStatus answered with uiPromptResponse.
//
// A configuration file from the VPN provider fills the form (the service
// does not import yet): a WireGuard .conf is split into its fields, and an
// OpenVPN .ovpn is stored on the device (/media/internal/vpn) and used as
// OpenVPN.ConfigFile.
//
// Launch params {page: "vpn", connect: name} (the system menu, for a VPN that
// asks for a user name and password) connect it here, where the sign-in is.

import { useEffect, useRef, useState } from "react";
import {
    call, connection, flattenFields, LunaError, parseOpenVpnConf, parseWireGuardConf, vpn, VPN_ERRORS, withValues,
    type VpnAgent, type VpnConnectionDetails, type VpnFormField, type VpnProfileEntry, type VpnStatusEvent,
} from "@phoenix/luna";
import { useLaunchParams, useLuna } from "@phoenix/luna/react";
import {
    Button, Dialog, ErrorText, Group, ListSelector, Note, Page, PageHeader, Row, Spinner, TextField, ToggleButton,
} from "@phoenix/ui";

const errorText = (e: unknown) => (e instanceof LunaError ? e.errorText : String(e));

// connman's agent notices (ReportError), in words.
const NOTICES: Record<string, string> = {
    "auth-failed": "The user name or password was not accepted.",
    "login-failed": "The user name or password was not accepted.",
    "connect-failed": "Could not connect to the VPN server.",
    "invalid-key": "The VPN's key or certificate is not valid.",
};

// connman's prompt keys are raw ("OpenVPN.Username"); what they mean.
function promptLabel(id: string): string {
    if (/(^|\.)Username$/.test(id)) return "User name";
    if (/PrivateKeyPassword$/.test(id)) return "Private key password";
    if (/(^|\.)Password$/.test(id)) return "Password";
    if (/Cookie$/.test(id)) return "Sign-in cookie";
    return id;
}

function stateText(state: VpnProfileEntry["vpnProfileConnectState"]): string {
    return { connected: "Connected", connecting: "Connecting…", disconnecting: "Disconnecting…", disconnected: "Off", unknown: "—" }[state];
}

type Editing =
    | { step: "type" }
    | { step: "form"; agent: VpnAgent; name?: string; host: string; fields: VpnFormField[] };

export function VpnPage() {
    const profiles = useLuna<VpnProfileEntry[]>((cb, err) => vpn.watchProfiles(cb, err), []).value;
    const airplane = useLuna<boolean>((cb, err) => connection.watchStatus((s) => cb(s.offlineMode === "enabled"), err), []).value ?? false;
    const [agents, setAgents] = useState<VpnAgent[]>([]);
    const [prompt, setPrompt] = useState<Extract<VpnStatusEvent, { kind: "prompt" }> | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [editing, setEditing] = useState<Editing | null>(null);
    const [details, setDetails] = useState<string | null>(null);
    const [deleting, setDeleting] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const launch = useLaunchParams<{ connect?: unknown }>();

    useEffect(() => { vpn.agents().then(setAgents).catch(() => setAgents([])); }, []);
    // Sign-ins and notices come on the status subscription.
    useEffect(() => {
        const sub = vpn.watchStatus((e) => {
            if (e.kind === "prompt") setPrompt(e);
            else if (e.kind === "promptResolved") setPrompt((p) => (p && p.promptId === e.promptId ? null : p));
            else if (e.kind === "notice") setNotice(NOTICES[e.notice] ?? (e.notice || "The VPN disconnected."));
        });
        return () => sub.cancel();
    }, []);

    const agentOf = (guid?: string) => agents.find((a) => a.vpnAgentGuid === guid);

    function connect(name: string) {
        setError(null);
        setNotice(null);
        vpn.connect(name).catch((e: unknown) => {
            // -7: the sign-in prompt is on its way; -5: the user cancelled it.
            if (e instanceof LunaError && (e.errorCode === VPN_ERRORS.NEEDS_AUTH || e.errorCode === VPN_ERRORS.PROMPT_CANCELLED)) return;
            setError(errorText(e));
        });
    }
    function disconnect(name: string) {
        setError(null);
        vpn.disconnect(name).catch((e: unknown) => setError(errorText(e)));
    }

    // The system menu sent a VPN that asks for a user name and password.
    const launchConnect = typeof launch?.connect === "string" ? launch.connect : null;
    useEffect(() => { if (launchConnect) connect(launchConnect); }, [launchConnect]);

    async function startEdit(name: string) {
        setDetails(null);
        try {
            const d = await vpn.details(name);
            const agent = agentOf(d.vpnAgentGuid);
            if (!agent) throw new Error("This VPN's type is not available on this device.");
            setEditing({ step: "form", agent, name, host: d.vpnProfile.vpnHost ?? "", fields: d.vpnProfile.vpnFormFields ?? [] });
        } catch (e) {
            setError(e instanceof LunaError ? e.errorText : e instanceof Error ? e.message : String(e));
        }
    }

    async function chooseType(agent: VpnAgent) {
        try {
            setEditing({ step: "form", agent, host: "", fields: await vpn.formFields(agent.vpnAgentGuid) });
        } catch (e) {
            setEditing(null);
            setError(errorText(e));
        }
    }

    async function remove(name: string) {
        setDeleting(null);
        try { await vpn.remove(name); } catch (e) { setError(errorText(e)); }
    }

    const shown = details !== null ? profiles?.find((p) => p.vpnProfileName === details) : undefined;

    return (
        <Page>
            <PageHeader title="VPN" icon="icons/vpn.png" />
            <Group label="VPN profiles">
                {!profiles ? <Row title="Loading…"><Spinner /></Row>
                    : profiles.length === 0 ? <Row title="No VPN profiles" subtitle="Add the one your provider or workplace gave you." />
                    : profiles.map((p) => {
                        const st = p.vpnProfileConnectState;
                        return (
                            <Row key={p.vpnProfileName} title={p.vpnProfileName} testId={`vpn-${p.vpnProfileName}`}
                                 subtitle={[agentOf(p.vpnAgentGuid)?.vpnAgentLabel, p.vpnHost].filter(Boolean).join(" · ")}
                                 onClick={() => setDetails(p.vpnProfileName)}>
                                {st === "connecting" || st === "disconnecting" ? <Spinner /> : null}
                                {/* The toggle connects; the rest of the row opens the details. */}
                                <span onClick={(e) => e.stopPropagation()}>
                                    <ToggleButton value={st === "connected" || st === "connecting"} label={p.vpnProfileName}
                                                  disabled={airplane || st === "disconnecting"} testId={`vpn-toggle-${p.vpnProfileName}`}
                                                  onChange={(on) => (on ? connect(p.vpnProfileName) : disconnect(p.vpnProfileName))} />
                                </span>
                            </Row>
                        );
                    })}
                <Row title="Add VPN Profile" chevron testId="vpn-add" onClick={() => setEditing({ step: "type" })} />
            </Group>
            {airplane && <Note>Airplane mode is on: a VPN needs a network.</Note>}
            {notice && <ErrorText>{notice}</ErrorText>}
            {error && <ErrorText>{error}</ErrorText>}

            <Dialog open={editing?.step === "type"} title="Add VPN Profile" message="Which kind of VPN is it?"
                    onClose={() => setEditing(null)} testId="vpn-type-dialog">
                {agents.map((a) => (
                    <Row key={a.vpnAgentGuid} title={a.vpnAgentLabel} chevron testId={`vpn-agent-${a.connmanType}`}
                         subtitle={a.deprecated ? "Not secure: only for old servers" : undefined}
                         onClick={() => void chooseType(a)} />
                ))}
                <Button variant="dark" onClick={() => setEditing(null)}>Cancel</Button>
            </Dialog>
            {editing?.step === "form" && <EditDialog start={editing} onClose={() => setEditing(null)} />}

            <Dialog open={!!shown} title={shown?.vpnProfileName} onClose={() => setDetails(null)} testId="vpn-details">
                {shown && <Details profile={shown} agent={agentOf(shown.vpnAgentGuid)}
                                   onEdit={() => void startEdit(shown.vpnProfileName)}
                                   onDelete={() => { setDetails(null); setDeleting(shown.vpnProfileName); }} />}
            </Dialog>

            <Dialog open={deleting !== null} title="Delete VPN profile?" testId="vpn-delete-dialog" onClose={() => setDeleting(null)}
                    message={deleting ? `"${deleting}" and its settings are removed from this device.` : undefined}>
                <Button variant="negative" onClick={() => deleting && void remove(deleting)} data-testid="vpn-delete-confirm">Delete</Button>
                <Button variant="dark" onClick={() => setDeleting(null)}>Cancel</Button>
            </Dialog>

            {prompt && <PromptDialog prompt={prompt} onDone={() => setPrompt(null)} />}
        </Page>
    );
}

function Details({ profile, agent, onEdit, onDelete }: {
    profile: VpnProfileEntry; agent?: VpnAgent; onEdit: () => void; onDelete: () => void;
}) {
    const conn = useLuna<VpnConnectionDetails>((cb, err) => vpn.watchConnection(profile.vpnProfileName, cb, err),
                                                [profile.vpnProfileName]).value;
    return (
        <>
            <Row title="Type" value={agent?.vpnAgentLabel ?? "—"} />
            <Row title="Server" value={profile.vpnHost ?? "—"} />
            <Row title="Status" value={stateText(profile.vpnProfileConnectState)} testId="vpn-status" />
            {conn?.clientIpAddress && <Row title="Address" value={conn.clientIpAddress} testId="vpn-address" />}
            {conn?.nameservers && <Row title="DNS" value={conn.nameservers.join(", ")} />}
            {profile.immutable && <Note>This profile was installed with the device and cannot be changed here.</Note>}
            <Button disabled={profile.immutable} onClick={onEdit} data-testid="vpn-edit">Edit</Button>
            <Button variant="negative" disabled={profile.immutable} onClick={onDelete} data-testid="vpn-delete">Delete Profile</Button>
        </>
    );
}

/** One form field from the service (files/formfields/*.json, or a prompt's). */
function FieldView({ field, onChange, editingExisting }: {
    field: VpnFormField; onChange: (value: string) => void; editingExisting?: boolean;
}) {
    const label = field.required ? `${field.label ?? field.id} (required)` : field.label ?? field.id;
    switch (field.type) {
    case "passwordfield":
        return <TextField label={label} type="password" value={field.value ?? ""} onChange={onChange}
                          placeholder={editingExisting ? "Unchanged" : field.hint} testId={`vpn-field-${field.id}`} />;
    case "checkbox":
        return (
            <Row title={field.label ?? field.id}>
                <ToggleButton value={field.value === (field.trueValue ?? "true")} label={field.label}
                              onChange={(on) => onChange(on ? field.trueValue ?? "true" : field.falseValue ?? "false")}
                              testId={`vpn-field-${field.id}`} />
            </Row>
        );
    case "listselector":
        return <ListSelector title={field.label ?? field.id} value={field.value ?? ""} testId={`vpn-field-${field.id}`}
                             options={(field.options ?? []).map((o) => ({ label: o.deprecated ? `${o.label} (not secure)` : o.label, value: o.value }))}
                             onChange={onChange} />;
    case "status":
        return field.statusType === "error" ? <ErrorText>{field.value}</ErrorText> : <Note>{field.value}</Note>;
    case "label":
        return <Row title={promptLabel(field.label ?? field.id)} value={field.value} />;
    default:
        if (field.editable === false)
            return field.value ? <Row title={field.label ?? field.id} subtitle={field.value} testId={`vpn-field-${field.id}`} /> : null;
        return <TextField label={label} value={field.value ?? ""} onChange={onChange} placeholder={field.hint}
                          type={field.inputType === "number" ? "number" : "text"} testId={`vpn-field-${field.id}`} />;
    }
}

function EditDialog({ start, onClose }: { start: Extract<Editing, { step: "form" }>; onClose: () => void }) {
    const existing = start.name !== undefined;
    const [name, setName] = useState(start.name ?? "");
    const [host, setHost] = useState(start.host);
    const [fields, setFields] = useState(() => flattenFields(start.fields));
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const file = useRef<HTMLInputElement>(null);
    const format = start.agent.supportsImport?.[0];

    const set = (id: string, value: string) => setFields((fs) => fs.map((f) => (f.id === id ? { ...f, value } : f)));
    // Required fields; a stored secret may stay blank when editing (unchanged).
    const missing = !name.trim() || !host.trim() || fields.some((f) => f.required && f.editable !== false
        && !(f.value ?? "").trim() && !(existing && f.type === "passwordfield"));

    async function importFile(f: File | undefined) {
        if (!f) return;
        setError(null);
        try {
            const text = await f.text();
            const base = f.name.replace(/\.[^.]*$/, "");
            const profile = name.trim() || base;
            if (format === "wg-conf") {
                const conf = parseWireGuardConf(text);
                setHost(conf.host);
                setFields((fs) => withValues(fs, conf.values));
            } else if (format === "ovpn") {
                const conf = parseOpenVpnConf(text);
                // connman's openvpn reads the file itself (OpenVPN.ConfigFile).
                const dir = "/media/internal/vpn";
                const path = `${dir}/${profile.replace(/[^\w.-]+/g, "_")}.ovpn`;
                const there = await call("luna://org.webosphoenix.filemanager/stat", { path: dir })
                    .then(() => true, () => false);
                if (!there) await call("luna://org.webosphoenix.filemanager/mkdir", { path: dir });
                await call("luna://org.webosphoenix.filemanager/write", { path, data: text, overwrite: true });
                setHost(conf.host);
                setFields((fs) => withValues(fs, { ...conf.values, "OpenVPN.ConfigFile": path }));
            }
            if (!name.trim()) setName(base);
        } catch (e) {
            setError(e instanceof LunaError ? e.errorText : e instanceof Error ? e.message : String(e));
        } finally {
            if (file.current) file.current.value = "";
        }
    }

    async function save() {
        setSaving(true);
        setError(null);
        try {
            const profile = { vpnHost: host.trim(), vpnFormFields: fields };
            if (existing) await vpn.update(start.name!, profile);
            else await vpn.add(name.trim(), start.agent.vpnAgentGuid, profile);
            onClose();
        } catch (e) {
            setError(errorText(e));
        } finally {
            setSaving(false);
        }
    }

    return (
        <Dialog open title={existing ? `Edit ${start.name}` : `Add ${start.agent.vpnAgentLabel} VPN`}
                onClose={saving ? undefined : onClose} testId="vpn-edit-dialog">
            {format && (
                <div className="vpn-import">
                    <input ref={file} type="file" accept={format === "wg-conf" ? ".conf,text/plain" : ".ovpn,.conf,text/plain"}
                           hidden data-testid="vpn-file" onChange={(e) => void importFile(e.target.files?.[0])} />
                    <Button variant="dark" onClick={() => file.current?.click()} data-testid="vpn-import">
                        {format === "wg-conf" ? "Import .conf File…" : "Import .ovpn File…"}
                    </Button>
                </div>
            )}
            {existing ? <Row title="Name" value={name} />
                : <TextField label="Name (required)" value={name} onChange={setName} testId="vpn-name" />}
            <TextField label="Server (required)" value={host} onChange={setHost} placeholder="vpn.example.com" testId="vpn-host" />
            {fields.map((f) => <FieldView key={f.id} field={f} editingExisting={existing} onChange={(v) => set(f.id, v)} />)}
            {error && <ErrorText>{error}</ErrorText>}
            <Button busy={saving} disabled={missing} onClick={() => void save()} data-testid="vpn-save">{existing ? "Save" : "Add Profile"}</Button>
            <Button variant="dark" disabled={saving} onClick={onClose}>Cancel</Button>
        </Dialog>
    );
}

/** A VPN asks for a sign-in while connecting (connman's agent RequestInput). */
function PromptDialog({ prompt, onDone }: { prompt: Extract<VpnStatusEvent, { kind: "prompt" }>; onDone: () => void }) {
    const [fields, setFields] = useState(prompt.vpnFormFields);
    const [sending, setSending] = useState(false);
    useEffect(() => setFields(prompt.vpnFormFields), [prompt]);
    const inputs = fields.filter((f) => f.type !== "label");
    const missing = inputs.some((f) => f.required && !(f.value ?? "").trim());

    async function answer(cancel: boolean) {
        setSending(true);
        try {
            if (cancel) await vpn.cancelPrompt(prompt.promptId);
            else await vpn.respond(prompt.promptId, fields);
        } finally {
            setSending(false);
            onDone();
        }
    }

    return (
        <Dialog open title={`Sign in to ${prompt.label}`} onClose={() => void answer(true)} testId="vpn-prompt">
            {inputs.map((f) => (
                <TextField key={f.id} label={promptLabel(f.id)} type={f.type === "passwordfield" ? "password" : "text"}
                           value={f.value ?? ""} testId={`vpn-prompt-${promptLabel(f.id).replace(/\s+/g, "-").toLowerCase()}`}
                           onChange={(v) => setFields((fs) => fs.map((x) => (x.id === f.id ? { ...x, value: v } : x)))} />
            ))}
            <Button busy={sending} disabled={missing} onClick={() => void answer(false)} data-testid="vpn-prompt-ok">Connect</Button>
            <Button variant="dark" disabled={sending} onClick={() => void answer(true)}>Cancel</Button>
        </Dialog>
    );
}
