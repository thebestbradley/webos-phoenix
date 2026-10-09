// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Assistant: settings for the Assistant (docs/M6-PLAN.md F3; launch params
// {page: "assistant"}, which the Assistant app's Preferences open). All
// through org.webosphoenix.assistant (@phoenix/luna assistant); the shell's
// view and the app follow at once.
//
// "Connect model" (an answer's choice, in the shell's view and the app:
// service connect) opens it with {connect: "choose" | "local" | "cloud" |
// "both", threadId}: a page of its own for just that, asking which kind
// first when it was not chosen, then the download or the provider, and
// once a model is there "Back to Your Question", which opens the Assistant
// app on the conversation with {retry: true} to ask it again.
//
//   Assistant        on or off (on by default), speak answers
//   Voice            listen for "Hey Phoenix" (off by default), also with
//                    the screen off or locked (off by default), voice
//                    replies (on by default), and what listening means for
//                    privacy (docs/AI-AND-MCP.md, Voice); the speaking
//                    voice and Play Sample (AssistantSpeech.tsx); what the
//                    voice is missing here and how to get it (AssistantVoice.tsx)
//   On device        llama.cpp models to download, use or remove, with their
//                    size and the memory they want (what fits is offered);
//                    how to get llama-server when it is missing
//   Cloud models     providers (Anthropic, OpenAI, Google Gemini, any
//                    OpenAI-compatible server) with their model and key; add,
//                    edit, test, remove; the one "Ask ..." offers
//   Control          whether cloud models may run commands (off by default)
//   Follow-up        questions after something is made (on by default),
//   questions        their quiet hours, the ones waiting, and a switch per
//                    topic (AssistantFollowUps.tsx)
//   Permissions      Location: the Assistant's grant in Location Services
//                    (AssistantPermissions.tsx)
//   Commands         which commands the assistant may run
//   History          clear every conversation
//
// Keys go to the service, which seals them; this page only ever sees their
// last four characters (docs/APP-RUNTIME.md "Assistant").

import { useEffect, useState } from "react";
import {
    apps, assistant, formatBytes, ASSISTANT_APP_ID, type ConnectMode, type AssistantCommand, type AssistantProvider, type AssistantSettings, type LocalModel,
    type LocalModelStatus, type LunaError, type ProviderType, type ProviderTypeInfo,
} from "@phoenix/luna";
import { useLaunchParams, useLuna } from "@phoenix/luna/react";
import { Button, Dialog, Group, ListSelector, Note, Page, PageHeader, PopupMenu, Row, Spinner, TextField, ToggleButton } from "@phoenix/ui";
import { useBack } from "../nav";
import { FollowUpQuestions } from "./AssistantFollowUps";
import { VoiceMissing } from "./AssistantVoice";
import { SpeakingVoice } from "./AssistantSpeech";
import { AssistantPermissions } from "./AssistantPermissions";

const errorText = (e: unknown) => (e as LunaError).errorText ?? (e instanceof Error ? e.message : String(e));
const gb = (n: number) => `${Math.round(n / 2 ** 30)} GB`;

type Providers = { providers: AssistantProvider[]; defaultProvider: string; types: Record<ProviderType, ProviderTypeInfo> };
type Models = { models: LocalModel[]; selected: string; status: LocalModelStatus };

// ---- A provider: add or edit ------------------------------------------------------------

function ProviderEditor({ editing, types, onDone }: {
    editing: AssistantProvider | { type: ProviderType }; types: Record<ProviderType, ProviderTypeInfo>; onDone: () => void;
}) {
    const existing = "id" in editing ? editing : null;
    const type = editing.type;
    const info = types[type];
    const [name, setName] = useState(existing?.name ?? info.label);
    const [baseUrl, setBaseUrl] = useState(existing?.baseUrl ?? (type === "compatible" ? info.base : ""));
    const [model, setModel] = useState(existing?.model ?? info.model);
    const [key, setKey] = useState("");
    const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
    const [busy, setBusy] = useState("");
    const [list, setList] = useState<string[] | null>(null);
    const [picking, setPicking] = useState<HTMLElement | null>(null);
    const [removing, setRemoving] = useState(false);
    useBack(() => { onDone(); return true; });

    const draft = () => ({ ...(existing ? { id: existing.id } : { type }), name, model, ...(type === "compatible" || baseUrl ? { baseUrl } : {}), ...(key ? { key } : {}) });
    const test = () => {
        setBusy("test");
        setResult(null);
        assistant.testProvider(existing && !key ? { id: existing.id, model } : { type, model, baseUrl: baseUrl || undefined, key })
            .then((r) => setResult({ ok: r.ok, text: r.ok ? `Connected. ${model} answered: ${r.text || "OK"}` : r.error || "No answer" }),
                  (e) => setResult({ ok: false, text: errorText(e) }))
            .finally(() => setBusy(""));
    };
    const save = () => {
        setBusy("save");
        assistant.setProvider(draft()).then(onDone, (e) => setResult({ ok: false, text: errorText(e) })).finally(() => setBusy(""));
    };
    const loadModels = (anchor: HTMLElement) => {
        setBusy("models");
        assistant.listModels(existing && !key ? { id: existing.id } : { type, baseUrl: baseUrl || undefined, key }).then((r) => {
            if (r.error) setResult({ ok: false, text: r.error });
            else { setList(r.models ?? []); setPicking(anchor); }
        }, (e) => setResult({ ok: false, text: errorText(e) })).finally(() => setBusy(""));
    };
    const needsKey = info.needsKey && !existing?.hasKey;
    const suggestions = [...new Set([...(list ?? []), ...info.models])];

    return (
        <Page>
            <PageHeader title={existing ? existing.name || info.label : `Add ${info.label}`} icon="icons/assistant.png" />
            <Group label="Provider">
                <Row title="Name"><div className="as-field"><TextField value={name} onChange={setName} testId="as-provider-name" /></div></Row>
                <Row title={type === "compatible" ? "Server address" : "Address (optional)"}>
                    <div className="as-field"><TextField value={baseUrl} onChange={setBaseUrl} testId="as-provider-url"
                                                         placeholder={type === "compatible" ? "http://192.168.1.5:11434/v1" : info.base} /></div>
                </Row>
                <Row title="Model">
                    <div className="as-field"><TextField value={model} onChange={setModel} testId="as-provider-model" placeholder={info.model || "model name"} /></div>
                </Row>
                <Row title="API key" subtitle={existing?.hasKey ? `Saved (…${existing.keyHint || "••••"}); type a new one to replace it` : info.needsKey ? "Needed" : "If the server asks for one"}>
                    <div className="as-field"><TextField type="password" value={key} onChange={setKey} testId="as-provider-key" placeholder={existing?.hasKey ? "••••••••" : "key"} /></div>
                </Row>
            </Group>
            {suggestions.length > 0 && <Note>Models: {suggestions.slice(0, 6).join(", ")}{suggestions.length > 6 ? "…" : ""}. Type any model the provider has.</Note>}
            <Button data-testid="as-provider-models" busy={busy === "models"} onClick={(e) => loadModels(e.currentTarget)}>Choose a Model…</Button>
            <Button data-testid="as-provider-test" busy={busy === "test"} disabled={needsKey && !key} onClick={test}>Test Connection</Button>
            {result && <Note testId="as-provider-result">{result.ok ? "✓ " : "✗ "}{result.text}</Note>}
            <Button variant="affirmative" data-testid="as-provider-save" busy={busy === "save"} disabled={(needsKey && !key) || !model.trim() || (type === "compatible" && !baseUrl.trim())}
                    onClick={save}>{existing ? "Save" : "Add Provider"}</Button>
            {existing && <Button variant="negative" data-testid="as-provider-remove" onClick={() => setRemoving(true)}>Remove Provider</Button>}
            <Note>Your key is kept encrypted on this device and sent only to this provider. What you ask a cloud model goes to the provider, under its terms; commands run on the phone.</Note>
            {picking && list && (
                <PopupMenu anchor={picking} options={list.slice(0, 60).map((m) => ({ label: m, value: m }))}
                           onClose={() => setPicking(null)} onSelect={(m) => { setPicking(null); setModel(m); }} />
            )}
            <Dialog open={removing} onClose={() => setRemoving(false)} testId="as-provider-remove-dialog" title="Remove this provider?"
                    message="Its key is deleted from this device.">
                <Button variant="negative" data-testid="as-provider-remove-ok" onClick={() => {
                    setRemoving(false);
                    if (existing) void assistant.removeProvider(existing.id).then(onDone);
                }}>Remove</Button>
                <Button onClick={() => setRemoving(false)}>Cancel</Button>
            </Dialog>
        </Page>
    );
}

// ---- On-device models ------------------------------------------------------------------------

function LocalModels({ m, onDownload }: { m: Models; onDownload?: (id: string) => void }) {
    const [error, setError] = useState("");
    const act = (p: Promise<void>) => { setError(""); p.catch((e) => setError(errorText(e))); };
    const st = m.status;
    return (
        <>
            <Group label="On-device model">
                {/* "off": none, not even the built-in one ("" is the built-in one). */}
                <ListSelector title="Use" value={m.selected || "off"} testId="as-local-use"
                              options={[{ label: "None", value: "off" }, ...m.models.filter((x) => x.installed).map((x) => ({ label: x.name, value: x.id }))]}
                              onChange={(id) => act(assistant.selectModel(id))} />
                {m.models.map((x) => (
                    <Row key={x.id} testId={`as-model-${x.id}`}
                         title={<>{x.name}{x.builtIn ? <span className="as-badge">Built in</span> : x.recommended && <span className="as-badge">Recommended</span>}</>}
                         subtitle={`${formatBytes(x.size)} · needs ${gb(x.ram)} of memory · ${x.licence}${x.fits ? "" : " · too big for this device"}${x.builtIn && !x.installed ? " · not installed here" : ""}${x.downloading ? ` · ${Math.round(100 * x.downloading.received / Math.max(1, x.downloading.total))}%` : ""}`}>
                        {x.builtIn ? null : x.downloading ? <button type="button" className="as-small" data-testid={`as-cancel-${x.id}`} onClick={() => act(assistant.cancelDownload(x.id))}>Cancel</button>
                         : x.installed ? <button type="button" className="as-small negative" data-testid={`as-remove-${x.id}`} onClick={() => act(assistant.removeModel(x.id))}>Remove</button>
                         : <button type="button" className="as-small" disabled={!x.fits || !!m.models.some((y) => y.downloading)} data-testid={`as-download-${x.id}`}
                                   onClick={() => { onDownload?.(x.id); act(assistant.downloadModel(x.id)); }}>Download</button>}
                    </Row>
                ))}
            </Group>
            <Note testId="as-local-status">
                {st.available
                    ? `Runs on this device with llama.cpp${st.ramBytes ? ` (${gb(st.ramBytes)} of memory here)` : ""}. Once you choose one, it answers what the phone's commands cannot, and picks commands from what you say, without the network.`
                    : `On-device models need llama.cpp's llama-server, which is not installed. ${st.howToInstall}`}
                {st.error ? ` ${st.error}` : ""}
            </Note>
            {error && <Note testId="as-local-error">{error}</Note>}
        </>
    );
}

// ---- Connect a model ------------------------------------------------------------------------
// The kinds "Connect model" offers, as Settings' rows say them.

const KINDS: { mode: ConnectMode; title: string; subtitle: string }[] = [
    { mode: "local", title: "On-Device Model",
      subtitle: "Private and offline: it runs on this device and nothing you ask leaves it. A one-time download of 0.5 to 2.5 GB, for the memory here." },
    { mode: "cloud", title: "Cloud Model",
      subtitle: "Anthropic, OpenAI, Google Gemini or any OpenAI-compatible server, with your API key. Best at open questions; what you ask goes to the provider." },
    { mode: "both", title: "Both",
      subtitle: "The on-device model answers first; what it can't, you can ask the cloud model." },
];

function localReady(m: Models | undefined): string {
    const x = m?.selected ? m.models.find((y) => y.id === m.selected) : undefined;
    return x && x.installed && m!.status.available ? x.name : "";
}

interface Connecting {
    /** Launched with: "choose" asks which kind first. */
    asked: ConnectMode | "choose";
    mode: ConnectMode | "choose";
    threadId: string;
    /** The launch params it came with (a new launch starts it again). */
    from: object;
    closed?: boolean;
    /** A model downloaded from here: used once it is in. */
    downloading?: string;
}

function ConnectModel({ c, set, prov, local, settings, onEdit }: {
    c: Connecting; set: (c: Connecting) => void; prov: Providers | undefined; local: Models | undefined; settings: AssistantSettings;
    onEdit: (p: AssistantProvider | { type: ProviderType }) => void;
}) {
    const mode = c.mode;
    const setMode = (m: Connecting["mode"]) => set({ ...c, mode: m });
    const onClose = () => set({ ...c, closed: true });
    useBack(() => { if (mode !== "choose" && c.asked === "choose") setMode("choose"); else onClose(); return true; });
    useEffect(() => {
        const id = c.downloading;
        if (!id || !local || local.selected) return;
        if (local.models.some((x) => x.id === id && x.installed)) {
            set({ ...c, downloading: "" });
            void assistant.selectModel(id).catch(() => undefined);
        }
    }, [local, c, set]);

    const onDevice = localReady(local);
    const cloud = prov?.providers.find((p) => p.id === prov.defaultProvider) ?? prov?.providers[0];
    const wantsLocal = mode === "local" || mode === "both", wantsCloud = mode === "cloud" || mode === "both";
    const ready = (wantsLocal && onDevice) || (wantsCloud && cloud?.label) || "";
    const back = () => {
        if (c.threadId) void apps.launch(ASSISTANT_APP_ID, { threadId: c.threadId, retry: true });
        onClose();
    };

    return (
        <Page>
            <PageHeader title="Connect a Model" icon="icons/assistant.png" />
            {mode === "choose" ? (
                <>
                    <Note>The phone's own commands answer first, offline. A model answers the rest: questions, and requests the commands don't know.</Note>
                    <Group label="Which kind?">
                        {KINDS.map((k) => (
                            <Row key={k.mode} testId={`as-connect-${k.mode}`} title={k.title} subtitle={k.subtitle} chevron onClick={() => setMode(k.mode)} />
                        ))}
                    </Group>
                </>
            ) : (
                <>
                    {ready ? (
                        <Note testId="as-connect-ready">{`✓ ${mode === "both" && onDevice && cloud ? `${onDevice} and ${cloud.label} are` : `${ready} is`} ready.`}</Note>
                    ) : (
                        <Note testId="as-connect-waiting">{KINDS.find((k) => k.mode === mode)?.subtitle}</Note>
                    )}
                    {ready && (
                        <Button variant="affirmative" data-testid="as-connect-back" onClick={back}>
                            {c.threadId ? "Back to Your Question" : "Done"}
                        </Button>
                    )}
                    {wantsLocal && (local ? <LocalModels m={local} onDownload={(id) => set({ ...c, downloading: id })} />
                                          : <Group label="On-device model"><Row title={<Spinner />} /></Group>)}
                    {wantsCloud && prov && (
                        <>
                            <Group label="Cloud models">
                                {prov.providers.map((p) => (
                                    <Row key={p.id} testId={`as-provider-${p.id}`} title={p.name} chevron onClick={() => onEdit(p)}
                                         subtitle={`${prov.types[p.type]?.label ?? p.type} · ${p.model}`} />
                                ))}
                                {(Object.keys(prov.types) as ProviderType[]).map((t) => (
                                    <Row key={t} testId={`as-connect-add-${t}`} title={`Add ${prov.types[t].label}`} chevron onClick={() => onEdit({ type: t })}
                                         subtitle={prov.types[t].needsKey ? "With your API key" : "A server on your network or elsewhere"} />
                                ))}
                            </Group>
                            <Group label="Control">
                                <Row title="Allow cloud models to control the device" subtitle="Off: they only chat. On: they can run the phone's commands">
                                    <ToggleButton value={settings.allowCloudControl} label="Allow cloud models to control the device" testId="as-connect-cloud-control"
                                                  onChange={(v) => void assistant.setSettings({ allowCloudControl: v })} />
                                </Row>
                            </Group>
                        </>
                    )}
                    {mode === "both" && <Note>Whichever answers, anything that sends a message, calls or deletes is read back to you first.</Note>}
                </>
            )}
        </Page>
    );
}

// ---- The page ------------------------------------------------------------------------------------

export function AssistantPage() {
    const s = useLuna<AssistantSettings>((cb, err) => assistant.watchSettings(cb, err), []).value;
    const prov = useLuna<Providers>((cb, err) => assistant.watchProviders(cb, err), []).value;
    const local = useLuna<Models>((cb, err) => assistant.watchModels(cb, err), []).value;
    const cmds = useLuna<AssistantCommand[]>((cb, err) => assistant.watchCommands(cb, err), []).value;
    const [editing, setEditing] = useState<AssistantProvider | { type: ProviderType } | null>(null);
    const [adding, setAdding] = useState<HTMLElement | null>(null);
    const [clearing, setClearing] = useState(false);
    const [done, setDone] = useState("");
    // "Connect model" (launch params {connect, threadId}): until closed, and again at each such launch.
    const params = useLaunchParams<{ connect?: string; threadId?: string }>();
    const [connect, setConnect] = useState<Connecting | null>(null);
    if (params.connect && connect?.from !== params) {
        const mode = (["local", "cloud", "both"] as string[]).includes(params.connect) ? params.connect as ConnectMode : "choose";
        setConnect({ asked: mode, mode, threadId: params.threadId ?? "", from: params });
    }

    if (editing && prov) return <ProviderEditor editing={editing} types={prov.types} onDone={() => setEditing(null)} />;
    if (!s) return <Page><PageHeader title="Assistant" icon="icons/assistant.png" /></Page>;
    if (connect && !connect.closed)
        return <ConnectModel c={connect} set={setConnect} prov={prov} local={local} settings={s} onEdit={setEditing} />;

    const set = (changes: Partial<AssistantSettings>) => void assistant.setSettings(changes);
    const off = !s.enabled;

    return (
        <Page>
            <PageHeader title="Assistant" icon="icons/assistant.png" />
            <Note>Hold the launcher button, or open the Assistant app, and say or type what you want. The phone's own commands answer first, offline; then the on-device model, if you choose one; then, if you like, a cloud model or a web search.</Note>
            <Group label="Assistant">
                <Row title="Assistant" subtitle="Hold the launcher button to ask">
                    <ToggleButton value={s.enabled} label="Assistant" testId="as-enabled" onChange={(v) => set({ enabled: v })} />
                </Row>
                <Row title="Speak answers" subtitle="With the device's voice, also when you type" disabled={off}>
                    <ToggleButton value={s.speak} label="Speak answers" testId="as-speak" disabled={off} onChange={(v) => set({ speak: v })} />
                </Row>
                <ListSelector title="Weather units" value={s.units} disabled={off} testId="as-units"
                              options={[{ label: "Automatic", value: "auto" as const }, { label: "°C", value: "metric" as const }, { label: "°F", value: "imperial" as const }]}
                              onChange={(v) => set({ units: v })} />
            </Group>

            <Group label="Voice">
                <Row title={"Listen for \u201cHey Phoenix\u201d"} subtitle="Then say what you want, in the same breath or after the chime" disabled={off}>
                    <ToggleButton value={s.wakeWord} label="Listen for Hey Phoenix" testId="as-wake" disabled={off} onChange={(v) => set({ wakeWord: v })} />
                </Row>
                <Row title="When the screen is off or locked" subtitle="Only what shows nothing private; for the rest it asks you to unlock" disabled={off || !s.wakeWord}>
                    <ToggleButton value={s.wakeWhenLocked} label="When the screen is off or locked" testId="as-wake-locked" disabled={off || !s.wakeWord}
                                  onChange={(v) => set({ wakeWhenLocked: v })} />
                </Row>
                <Row title="Voice replies" subtitle="Answer spoken requests aloud" disabled={off}>
                    <ToggleButton value={s.voiceReplies} label="Voice replies" testId="as-voice-replies" disabled={off} onChange={(v) => set({ voiceReplies: v })} />
                </Row>
                <SpeakingVoice settings={s} set={set} off={off} />
            </Group>
            <VoiceMissing />
            <Note testId="as-voice-privacy">{"Listening for \u201cHey Phoenix\u201d happens on this phone. The microphone goes only to the wake word spotter, which keeps the last few seconds in memory and nothing more; nothing is recorded, sent or saved until it hears the phrase, and what you say after it is turned into text on the phone too. A microphone in the status bar shows whenever it is open: faint while it waits for the phrase, orange while it listens to you."}</Note>

            <FollowUpQuestions settings={s} set={set} off={off} />

            {local ? <LocalModels m={local} /> : <Group label="On-device model"><Row title={<Spinner />} /></Group>}

            <Group label="Cloud models">
                {prov && prov.providers.length === 0 && <Row title={<span className="as-none">None yet</span>} />}
                {prov?.providers.map((p) => (
                    <Row key={p.id} testId={`as-provider-${p.id}`} title={p.name} chevron onClick={() => setEditing(p)}
                         subtitle={`${prov.types[p.type]?.label ?? p.type} · ${p.model}${p.hasKey ? ` · key …${p.keyHint || "••••"}` : ""}${p.baseUrl ? ` · ${p.baseUrl}` : ""}`} />
                ))}
                {prov && prov.providers.length > 1 && (
                    <ListSelector title="Ask" value={prov.defaultProvider} testId="as-default-provider"
                                  options={prov.providers.map((p) => ({ label: p.label, value: p.id }))}
                                  onChange={(id) => set({ defaultProvider: id })} />
                )}
            </Group>
            <Button data-testid="as-add-provider" disabled={!prov} onClick={(e) => setAdding(e.currentTarget)}>Add a Model Provider…</Button>
            <Group label="Control">
                <Row title="Allow cloud models to control the device" subtitle="Off: they only chat. On: they can run the commands below">
                    <ToggleButton value={s.allowCloudControl} label="Allow cloud models to control the device" testId="as-cloud-control"
                                  onChange={(v) => set({ allowCloudControl: v })} />
                </Row>
            </Group>
            <Note>Whoever chose it, anything that sends a message, calls or deletes is read back to you first.</Note>

            <AssistantPermissions disabled={off} />
            <Group label="Commands">
                {(cmds ?? []).map((c) => (
                    <Row key={c.id} testId={`as-cmd-${c.id}`} title={c.title} subtitle={c.confirms ? "Asks you first" : c.builtIn ? undefined : "From an app"}>
                        <ToggleButton value={c.enabled} label={c.title} testId={`as-cmd-toggle-${c.id}`}
                                      onChange={(v) => set({ disabledCommands: v ? s.disabledCommands.filter((x) => x !== c.id) : [...s.disabledCommands, c.id] })} />
                    </Row>
                ))}
            </Group>

            <Button variant="negative" data-testid="as-clear" onClick={() => setClearing(true)}>Clear History</Button>
            {done && <Note testId="as-cleared">{done}</Note>}

            {adding && prov && (
                <PopupMenu anchor={adding} onClose={() => setAdding(null)}
                           options={(Object.keys(prov.types) as ProviderType[]).map((t) => ({ label: prov.types[t].label, value: t }))}
                           onSelect={(t) => { setAdding(null); setEditing({ type: t }); }} />
            )}
            <Dialog open={clearing} onClose={() => setClearing(false)} testId="as-clear-dialog" title="Clear the history?"
                    message="Every conversation with the assistant is deleted from this device.">
                <Button variant="negative" data-testid="as-clear-ok" onClick={() => {
                    setClearing(false);
                    assistant.clearHistory().then((n) => setDone(n === 1 ? "1 conversation cleared." : `${n} conversations cleared.`), () => setDone(""));
                }}>Clear History</Button>
                <Button onClick={() => setClearing(false)}>Cancel</Button>
            </Dialog>
        </Page>
    );
}
