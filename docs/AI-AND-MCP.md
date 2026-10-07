# AI and MCP

> **Decisions (28 September 2026, from the project owner).** The assistant
> is **on by default**, like on any modern phone, with settings to turn it
> off or limit it. Where the device can run one, a local model answers
> first. Beyond bring-your-own keys, the project may run its own **paid
> Phoenix AI service**, alongside iCloud-style Phoenix cloud services, so
> Settings > Assistant must allow a first-party provider next to the others.
> Which third-party providers come first is still open.

## 1.0 and 2.0

> **Decision (29 September 2026, from the project owner).** A digital
> assistant like Siri is part of **1.0**. The MCP layer and the frontier
> AI work (the agent, local LLMs, bring-your-own LLM, a Phoenix AI service)
> are **2.0**.

> **Revised (7 October 2026, from the project owner).** 1.0 adds language
> models after all, in layers: the commands below first; then an optional
> on-device model (llama.cpp, downloaded in Settings), which becomes the
> default for actions once installed; then, when neither can answer, the
> choice of a cloud model (Anthropic, OpenAI, Google, any OpenAI-compatible
> URL) or a web search. A cloud model may run commands only with the user's
> permission, set in Settings > Assistant. It opens by holding the launcher
> button, has its own app with chat threads, and shows the active thread
> over a translucent backdrop. The MCP agent stays 2.0. The plan is
> [M6-PLAN.md](M6-PLAN.md) F3; the table below is its command layer.

The **Phoenix Assistant in 1.0** starts with a voice assistant in the classic style:

| Part | 1.0 |
| --- | --- |
| **Asking** | Push-to-talk from the gesture area (press and hold while the keyboard is down; see [spec/GAPS.md](spec/GAPS.md) V4 for the keyboard-up case), a mic button in Just Type, a headset button. A wake word stays for later |
| **Hearing** | On-device speech recognition with the transcriber Voice Memos already uses (`org.webosphoenix.transcriber`, whisper.cpp); nothing leaves the phone |
| **Understanding** | Intents: a fixed grammar per command in each supported language ("call Mum", "text Sam I'm late", "set a timer for 10 minutes", "wake me at 7", "turn off Wi-Fi", "open Maps", "navigate home", "play <artist>", "remind me to ...", "what's the weather", "what's 15% of 80"). Apps add their own through `appinfo.json`, the same way they add Just Type Quick Actions |
| **Doing** | The same Luna calls Just Type's actions and the apps already make: Phone, Messaging, Clock, Settings, Maps, Music, Tasks, Weather, Contacts. Anything that sends or deletes is read back first ("Send 'I'm late' to Sam?") |
| **Answering** | A popup alert or dashboard in the webOS style with the answer, spoken by the text-to-speech service; for anything it cannot do, "Search the web for ...", as Just Type does |

**In 2.0** the same assistant grows into the agent this document plans:
the MCP hub behind it, language models (local or a provider) for open
questions and multi-step tasks, memory, Settings > Assistant with
providers. The 1.0 intents stay as the fast, offline path (the "short
command" row of Routing).

A plan for three things (2.0, except where the table above says 1.0):

1. an **MCP layer**, so that an AI client can use every app and the OS
   through the Model Context Protocol;
2. an **on-device assistant**, an app and a system service that uses that
   layer to act on the device and answer questions;
3. **Bring your own LLM**, a Settings page to plug in the model you like,
   from a cloud provider, a machine on your network, or the phone itself.

This is a plan, not a status report: none of it is built. Facts are as of
28 September 2026 and each has a source at the end. Where we could not
check something it says *unverified*. Performance figures for Phoenix's
devices are **estimates** until measured on them.

## Summary

- **One MCP hub for the whole device**: a Luna service,
  `org.webosphoenix.mcp`, that serves OS tools itself and collects the tools
  apps declare in their `appinfo.json`. Every call goes through one policy
  engine (grants, confirmations, rate limits, audit log). Apps never talk
  MCP to clients directly.
- **Target MCP 2026-07-28**, the current revision: stateless, no
  `initialize` handshake, results carry `resultType`, user input through
  Multi Round-Trip Requests. Accept 2025-11-25 clients too, since many
  clients will lag.
- **Transports**: Luna (on the device, access controlled by OSE's ACG), a
  stdio program (`phoenix-mcp`) that also works over SSH from a Mac, and
  later Streamable HTTP on the LAN, paired with a QR code and OAuth 2.1.
- **Confirm on the phone, in webOS style**: a popup alert for anything that
  sends, spends, deletes or changes a setting; a dashboard while the
  assistant works in the background; a banner when it is done; an activity
  log in Settings.
- **The assistant is an MCP client** of the hub like any other. Its model
  comes from a provider adapter: Anthropic, OpenAI, Google, any
  OpenAI-compatible endpoint (Ollama, LM Studio, llama.cpp's server, vLLM),
  or llama.cpp on the device, which is just another OpenAI-compatible
  endpoint on localhost.
- **Honest about local models**: on a Raspberry Pi 4 a local model is too
  slow for chat (1 to 2 tokens/s for 1B to 3B models); on an 8 GB
  Snapdragon 845 phone a 2B model should be usable (estimate). Default to
  "cloud or LAN model for conversation, local model for short commands and
  offline".
- **Prompt injection is designed in, not bolted on**: content from the web,
  email, messages and files is untrusted; once it is in the context,
  consequential tools need a confirmation even if pre-approved, and sending
  data to a recipient the user did not name is blocked.

## Background

### MCP in September 2026

The current revision is **2026-07-28** (released 28 July 2026, release
candidate 21 May 2026). The previous one, 2025-11-25, is what many clients
still speak. What matters for Phoenix:

| Topic | 2026-07-28 | Consequence for Phoenix |
| --- | --- | --- |
| Sessions | Removed: no `initialize` / `initialized`, no `Mcp-Session-Id`. Each request carries its protocol version and client capabilities in `_meta` | The hub is a stateless request handler, which suits Luna calls. Cross-call state is an explicit handle passed as a tool argument |
| Discovery | `server/discover` is mandatory: versions, capabilities, identity | Implement it; clients may probe with it over stdio |
| Server-to-client requests | Replaced by **Multi Round-Trip Requests** (MRTR): the server returns `resultType: "input_required"` with `inputRequests`; the client retries with `inputResponses` | Used for elicitation (asking the user to pick a contact, fill a field) |
| Tools | `tools/list`, `tools/call`; JSON Schema 2020-12 input and output schemas; `structuredContent`; deterministic order; `ttlMs` and `cacheScope` on list results | One tool per action; list in a stable order |
| Tool annotations | Hints such as read-only or destructive. Clients **must** treat annotations as untrusted unless the server is trusted | The hub decides risk itself; app-declared hints can only raise it |
| Resources, prompts | Still core; `resources/subscribe` replaced by one `subscriptions/listen` stream | Contacts, calendar, messages, memos as resources; prompts as Just Type quick actions |
| Elicitation | Form mode (flat schemas, no secrets) and URL mode (secrets, OAuth, payment) | Form mode for choices; never ask for a password in a form |
| Deprecated | **Sampling, Roots, Logging** (SEP-2577), the old HTTP+SSE transport, Dynamic Client Registration (in favour of Client ID Metadata Documents) | Do not build on sampling: the assistant calls its LLM directly |
| Transports | stdio (newline-delimited JSON-RPC) and Streamable HTTP (a POST per message, JSON or a request-scoped SSE stream). Custom byte-stream transports **should** reuse the stdio framing | Luna and Unix socket transports reuse stdio framing |
| HTTP security | Servers **must** validate `Origin` (DNS rebinding), **should** bind to localhost when local, **should** authenticate; `MCP-Protocol-Version`, `Mcp-Method`, `Mcp-Name` headers required | The LAN listener is off by default and always authenticated |
| Authorization | OAuth 2.1 for HTTP transports: Protected Resource Metadata (RFC 9728) is required, resource indicators (RFC 8707), PKCE, `iss` validation (RFC 9207). stdio **should not** use it and takes credentials from the environment | The phone is its own authorization server for LAN clients |
| Extensions | Formal framework. **Tasks** (long-running calls, polled with `tasks/get`) and **MCP Apps** (`io.modelcontextprotocol/ui`: HTML tool UIs in a sandboxed iframe, `ui://` resources, since 26 January 2026) | Tasks for slow tools (transcription, sync); MCP Apps later, to show tool results as cards |
| SDKs | Tier 1 SDKs updated for 2026-07-28: TypeScript, Python, Go, C#; Rust in beta | The hub is Node.js on the TypeScript SDK, like Files' and Voice Memos' services |

The spec's own security advice for tools matches what we want anyway: a
human in the loop who can deny calls, visible indicators when a tool runs,
confirmation for sensitive operations, showing tool inputs before the call,
timeouts, rate limits and an audit log.

### How other mobile systems expose app actions

| System | Mechanism | Who may call | Notes |
| --- | --- | --- | --- |
| **Android** | **AppFunctions** (Android 16+): Kotlin functions marked `@AppFunction` in an `AppFunctionService`; the Jetpack library generates an XML schema that the OS indexes | Callers holding `EXECUTE_APP_FUNCTIONS` (agents, assistants such as Gemini). During the experimental phase only a few apps and system agents get the whole pipeline | Google calls them "the mobile equivalent of tools within MCP", running locally in the app. Jetpack library in alpha (1.0.0-alpha10 in July 2026, *per a secondary source*); Gemini integration in private preview |
| **iOS / macOS** | **App Intents**. WWDC26 added app schemas, entity schemas (app content in the Spotlight semantic index, for Siri's personal context) and a View Annotations API (on-screen awareness) | Siri, Shortcuts, Spotlight | The Foundation Models framework gives apps the on-device model and, per Apple's WWDC26 guide, other providers too |
| **Legacy webOS** | Just Type's `universalSearch` in `appinfo.json` (actions and db8 searches), app launch params, and Luna services with a permission check on the caller | Just Type and apps allowed by the service | Phoenix already implements these ([APP-RUNTIME.md](APP-RUNTIME.md#just-type)) |

The lesson: both big platforms put **a declaration in the app package**,
**an OS index**, and **a privileged caller permission** in front of the
functions. Phoenix does the same, with MCP as the wire format, and gets a
head start from what webOS apps already declare.

## Part 1: the MCP layer

### Architecture

```
                MCP clients
   +--------------+   +---------------------+   +-----------------------+
   | Assistant    |   | phoenix-mcp (stdio) |   | Claude Code / Desktop |
   | service      |   | in Terminal, or     |   | on the user's Mac     |
   | (on device)  |   | over SSH from a Mac |   | (Streamable HTTP, LAN)|
   +------+-------+   +----------+----------+   +-----------+-----------+
          | Luna rpc             | Unix socket              | HTTPS + OAuth
          v                      v                          v
   +--------------------------------------------------------------------+
   |  org.webosphoenix.mcp  (the hub, Node.js, TypeScript MCP SDK)      |
   |                                                                    |
   |  transports -> client identity -> policy engine -> tool router     |
   |                 (appId / token)   grants, confirm,   |             |
   |                                   rate limit, taint, |             |
   |                                   audit log          |             |
   |  registry: OS tools + app manifests + universalSearch-derived      |
   +------+-------------------+--------------------+--------------------+
          |                   |                    |
          v                   v                    v
   Luna services         db8 (resources,      app pages (web apps that
   (SAM, settings,       read with the        register tools through
   wifi, telephony,      hub's own            window.phoenixMcp while
   audio, files, ...)    permissions)         they run)
          |
          v
   shell: popup alert / dashboard / banner for confirmations and progress
```

**Why one hub, not an MCP server per app.** Clients would otherwise need to
find and connect to dozens of servers, each app would have to implement MCP
and its own security, and the user would have no single place to see and
revoke what an AI may do. The hub is also the only component that needs the
broad Luna permissions; apps keep theirs.

### The hub service: `org.webosphoenix.mcp`

- **Language and runtime**: Node.js with `webos-service`, started on demand
  by OSE's `run-js-service` and installed by `tools/install-rootfs.py`, the
  same as `apps/files/service` and `apps/voicememos/service`. MCP logic uses
  the official TypeScript SDK (Tier 1 for 2026-07-28). OSE 2.27 upgraded
  Node.js to 20.12.2; the version in 2.28 and the SDK's minimum Node
  version are *unverified*.
- **Luna API** (ACG group `mcp.client`, `trustLevel` `oem` for system
  clients):
  - `rpc {message}`: one MCP JSON-RPC request in, one result out (with
    `subscribe: true`, progress notifications arrive as extra replies,
    then the final result). This is the stdio framing carried in Luna
    messages, as the spec suggests for custom transports.
  - `listen {types}`: the `subscriptions/listen` stream (tool list changes
    as apps are installed, resource updates from db8 watches).
  - `grants`, `setGrant`, `auditLog`, `pair`, `revoke`: for Settings.
- **The registry** is rebuilt when apps are installed or removed (SAM's
  app list subscription) from: the OS tool set (below), each app's `mcp`
  manifest, Phoenix overlay manifests for original apps, and tools derived
  from `universalSearch`.
- **Simulator**: a block "MCP" in `runtime/phoenix-runtime.js` answers the
  same Luna methods against the simulated services, like every other
  Phoenix service. `phoenix-sim --mcp-stdio` bridges stdin/stdout to it, so
  Claude Code on a Mac can drive the simulator; that is also how we test the
  hub end to end.

### OS tools

Tool names use dots (allowed by the spec): `os.<area>.<verb>`. Every tool has
a **risk class**, assigned by the hub, that decides the default policy.

| Risk class | Meaning | Default for the assistant | Default for a remote client |
| --- | --- | --- | --- |
| `read` | Reads non-personal state (battery, Wi-Fi status, app list) | Allow | Allow after pairing |
| `personal-read` | Reads personal data (contacts, messages, calendar, location, files) | Ask once per data class | Ask once per data class |
| `local-write` | Changes something on the device that is easy to undo (open an app, set volume, create a task) | Allow, show in the dashboard | Ask once per tool |
| `settings` | Changes a setting or radio (Wi-Fi, Bluetooth, airplane mode, brightness) | Allow for "on"; ask for "off" of a radio the client is connected through | Ask once per tool |
| `outbound` | Sends something off the device or to a person (SMS, email, call, post to a URL) | **Confirm every time** (can be relaxed per recipient, never for new recipients) | Confirm every time |
| `destructive` | Deletes or overwrites user data, uninstalls, factory reset | **Confirm every time**; factory reset is not a tool | Confirm every time |
| `developer` | Shell commands, installing packages, reading system logs | Not available unless Developer Mode is on; then confirm every time | Same |

| Area | Tools (first set) | Backed by | Risk |
| --- | --- | --- | --- |
| Apps | `os.apps.list`, `os.apps.launch {appId, params}`, `os.apps.close`, `os.apps.running` | SAM `com.webos.applicationManager` (`listApps`, `launch`, `close`, `running`) | read, local-write |
| Cards | `os.cards.list`, `os.cards.focus`, `os.cards.minimize` | the shell (a small Luna API on the compositor side, M1 work) | read, local-write |
| Notifications | `os.notifications.list`, `os.notifications.post {title, message}`, `os.notifications.dismiss` | `com.webos.notification` and the shell's notification model | personal-read, local-write |
| Settings | `os.settings.get {key}`, `os.settings.set {key, value}` for an allow-list of keys (brightness, screen timeout, volume, rotation lock, wallpaper, time format) | `com.webos.settingsservice`, system service `setPreferences`, `com.webos.service.audio` | read, settings |
| Radios | `os.wifi.status`, `os.wifi.setEnabled`, `os.wifi.scan`, `os.wifi.connect {ssid}` (known networks only), `os.bluetooth.*`, `os.airplane.set` | `com.webos.service.wifi`, `bluetooth2`, `connectionmanager` | read, settings |
| db8 | `os.db.find {kind, where, limit}` on kinds the client was granted; no `put` or `del` (writes go through app tools) | `com.palm.db` | personal-read |
| Activities | `os.activities.list`, `os.reminders.create {when, text}` | `com.palm.activitymanager` (as Tasks' reminders) | read, local-write |
| Files | `os.files.list`, `os.files.read {path, maxBytes}`, `os.files.write` (under `/media/internal` only), `os.files.remove` | `org.webosphoenix.filemanager` | personal-read, local-write, destructive |
| Media | `os.media.play`, `pause`, `next`, `nowPlaying`, `os.volume.set` | Music's service, `com.webos.service.audio` | read, local-write |
| Telephony | `os.phone.call {number}`, `os.phone.hangup`, `os.sms.send {to, text}`, `os.calls.recent` | `com.palm.telephony`, `org.webosports.service.messaging` ([APP-RUNTIME.md](APP-RUNTIME.md#phone-and-messaging)) | outbound, personal-read |
| Location | `os.location.get {accuracy}` | `com.webos.service.location` | personal-read |
| Device | `os.device.info`, `os.battery.status`, `os.screenshot` (returns an image of the front card) | system service `deviceInfo`, `com.palm.power` | read, personal-read (screenshot) |
| Developer | `os.shell.exec {command, timeout}` | the Terminal's PTY service ([TERMINAL.md](TERMINAL.md)) | developer |

Not tools, on purpose: factory reset, changing the passcode, reading the
key store, turning Developer Mode on, granting permissions, and anything in
Settings > Assistant itself. An AI must not be able to widen its own access.

### Per-app tools: the `mcp` section of `appinfo.json`

Apps declare tools, resources and prompts next to the `universalSearch` and
`phoenix` fields they already have. Three kinds of handler cover every app
Phoenix runs:

```json
"mcp": {
    "tools": [
        {
            "name": "create_task",
            "title": "New task",
            "description": "Create a task in a list, optionally with a due date and a reminder.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "title": { "type": "string" },
                    "due": { "type": "string", "format": "date-time" },
                    "list": { "type": "string", "description": "List name; the default list if omitted" }
                },
                "required": ["title"],
                "additionalProperties": false
            },
            "risk": "local-write",
            "handler": { "luna": "luna://org.webosphoenix.tasks.service/createTask" }
        },
        {
            "name": "show_task",
            "description": "Open a task in the Tasks app.",
            "inputSchema": { "type": "object", "properties": { "taskId": { "type": "string" } }, "required": ["taskId"] },
            "risk": "local-write",
            "handler": { "launch": { "params": { "taskId": "{taskId}" } } }
        },
        {
            "name": "selected_text",
            "description": "The text selected in the front Tasks card.",
            "inputSchema": { "type": "object", "additionalProperties": false },
            "risk": "personal-read",
            "handler": { "page": true }
        }
    ],
    "resources": [
        {
            "uriTemplate": "phoenix://tasks/{_id}",
            "name": "Tasks",
            "mimeType": "application/json",
            "db8": { "kind": "com.palm.task:1", "fields": ["title", "due", "completed", "notes"] },
            "risk": "personal-read"
        }
    ],
    "prompts": [
        { "name": "plan_my_day", "title": "Plan my day", "description": "Today's tasks and events, ordered by time and priority" }
    ]
}
```

| Handler | How the hub runs it | For |
| --- | --- | --- |
| `luna` | Calls the Luna method with the arguments as its payload, **as the app** (the hub asks luna-service2 to check the app's own ACG permissions for that method, so declaring a tool cannot reach more than the app can) *(how to call on behalf of an app in luna-service2 is unverified; fall back to an allow-list of the app's own service names)* | Apps with a Luna service (Files, Voice Memos, DAV, Tasks) |
| `launch` | Launches the app, or relaunches it, with the params (placeholders filled from the arguments), and returns once the card is up | Every app that takes launch params, including the original apps |
| `page` | Sends the call to the app's running page through `window.phoenixMcp` (see below) and waits for its answer; if the app is not running, the tool is listed but reports "open the app first" | Web apps and PWAs whose logic lives in the page |

The hub checks every manifest when it loads it: schemas must be valid
JSON Schema 2020-12, names must follow the spec's character rules, the tool
is exposed to clients as `<appId>.<name>` (so `org.webosphoenix.tasks.create_task`),
and `risk` can be raised but never lowered below what the hub infers from
the handler (a `luna` handler that calls telephony is `outbound` whatever
the manifest says).

**The page API.** `runtime/phoenix-runtime.js` (in the simulator) and a
small injected script on the device add:

```ts
window.phoenixMcp.registerTool("selected_text", async (args, ctx) => {
    return { content: [{ type: "text", text: getSelection().toString() }] };
});
```

It only accepts names the app's manifest declares, so a page cannot invent
tools at runtime. `@phoenix/luna` gets a typed wrapper
(`useMcpTool(name, handler)` in `@phoenix/luna/react`).

**Original webOS apps.** `third_party` stays unmodified, as elsewhere in
Phoenix. Their manifests are overlay files,
`compat/rootfs/usr/share/phoenix/mcp/<appId>.json`, with `launch` and
`luna` handlers against what the apps and their services already accept
(for example Email's compose params, as Voice Memos already uses them to
share, and the calendar and contacts db8 kinds as resources). The exact
launch params of each original app have to be catalogued from their
sources; we have not done that yet.

**Tools for free from Just Type.** Every `universalSearch.action` becomes a
tool (`new_voice_memo {text}` from Voice Memos' "New Voice Memo") and every
`dbsearch` a search tool (`search_voice_memos {query}`) with the same db8
query and display fields, marked `personal-read`. Apps can turn this off
with `"mcp": {"fromUniversalSearch": false}`.

### Resources and prompts

- **Resources** are db8 records and files, addressed `phoenix://<area>/<id>`
  (`phoenix://contacts/...`, `phoenix://calendar/...`,
  `phoenix://messages/<thread>`), plus `file:///media/internal/...` for
  files. The hub reads db8 **with its own permissions** and returns only the
  fields a manifest lists, so a client never gets whole records it did not
  ask for (no `_rev`, sync ids or account credentials). Resource templates
  let clients read one record without listing all of them.
- **Data classes** group resources for grants: Contacts, Calendar, Messages,
  Email, Call log, Location, Photos, Files, Notes and memos, Tasks,
  Health (later). The user grants a class, not a kind.
- **Prompts** are user-invoked templates, not tools. Phoenix shows them in
  Just Type's Quick Actions ("Plan my day", "Summarize unread email") and in
  the assistant card's menu.

### Transports

| Transport | Who uses it | Identity | Default |
| --- | --- | --- | --- |
| **Luna** (`org.webosphoenix.mcp/rpc`) | The assistant service, other on-device apps and services | The caller's app or service id from luna-service2, checked by ACG (`mcp.client` group) | On, for system apps only |
| **Unix socket** `/run/phoenix/mcp.sock` + the `phoenix-mcp` program (stdio framing) | Command-line clients on the device; **a Mac over SSH**: `ssh phone phoenix-mcp` | The Unix user (peer credentials); over SSH, the SSH key | On when Developer Mode is on |
| **Streamable HTTP** `https://<device>.local:8443/mcp` | Claude Code, Claude Desktop (through a local bridge) or any MCP client on the LAN | OAuth 2.1 access token from pairing | Off; turned on per pairing |

**The SSH route is the first remote route to build.** Claude Code, Claude
Desktop and most MCP clients can start a stdio server from a command line,
and the command can be `ssh`. It needs no TLS certificates, no OAuth and no
new listener; authorization is the user's SSH key, which Developer Mode
already asks for ([TERMINAL.md](TERMINAL.md#security-model)). In the
stdio case the spec says to take credentials from the environment, which
is what this is.

**Streamable HTTP on the LAN** follows the spec: `Origin` validation, the
required headers, 2026-07-28 and 2025-11-25 clients, OAuth 2.1:

1. Settings > Assistant > Connected computers > **Pair a computer** shows
   a QR code and a URL containing the device's `.local` name, its TLS
   certificate fingerprint (self-signed; the client pins it), and a
   one-time pairing code.
2. The client finds the phone's Protected Resource Metadata and
   authorization server (the phone itself, a small OAuth 2.1 server inside
   the hub), registers (Client ID Metadata Document, pre-registration from
   the QR code, or Dynamic Client Registration for older clients) and opens
   the authorization URL with PKCE and the `resource` parameter.
3. The authorization page in the Mac's browser says "Approve on your
   phone" and shows a four-digit code; the phone shows a popup alert with
   the client's name, the same code and the scopes (data classes and risk
   classes) with checkboxes. Approve, and the browser is redirected with
   the code and `iss`.
4. Tokens are short-lived (1 hour) with a refresh token; the phone keeps
   only their hashes. Revoking the computer in Settings kills both.

Caveats: Claude Desktop's own remote connectors are added through claude.ai
and reached from Anthropic's cloud, so a LAN-only server needs a local
bridge or the stdio route there *(unverified; check when building)*. A
self-signed certificate means clients must support fingerprint pinning or
the user installs a local CA; the SSH route avoids both.

### Permission model

A **grant** is (client, target, decision), where the target is a tool, a
data class or a risk class, and the decision is **Allow**, **Ask every
time** or **Deny**. The most specific grant wins; defaults come from the
risk table above.

```
tools/call arrives
  -> identify client (Luna caller id | Unix peer | OAuth token)
  -> tool known and visible to this client? (tools/list is filtered per client)
  -> validate arguments against inputSchema
  -> rate limit (per client, per risk class)
  -> taint check (see Safety): does untrusted content in this turn
     force a confirmation?
  -> grant: Allow | Ask | Deny
       Ask -> confirmation UI on the phone -> Approve / Deny / timeout (60 s)
  -> run the handler with a timeout (15 s default, Tasks extension for longer)
  -> validate structuredContent against outputSchema
  -> audit log entry
  -> result
```

**Confirmation UI, in the webOS idiom:**

| Situation | UI |
| --- | --- |
| A tool needs approval and the user is looking at the phone | A **popup alert** (the small window at the bottom of a phone, the corner of a tablet, like an incoming call or a calendar alarm): the client's icon and name, one plain sentence ("Send a text to Mom: 'Running 10 minutes late'"), the exact arguments behind a "Details" row, and **Allow** / **Don't allow**, with "Always allow for Mom" where the grant can be relaxed |
| The screen is off or locked | The alert shows over the lock screen like a call, with the phone's `showAlertsWhenLocked` preference; `outbound` and `destructive` actions also need the device unlocked |
| The assistant or a remote client is working in the background | A **dashboard** entry ("Assistant: 3 steps, 1 waiting for you"), tapped to open the assistant card; a Stop button in the dashboard's drop-down cancels the run |
| An action finished | A **banner** ("Wi-Fi turned on", "Text sent to Mom"), and the dashboard entry updates |
| A remote computer is connected | A persistent dashboard entry and a status bar icon while an MCP HTTP or SSH client is active, like the legacy USB-connected notice |

**Audit log**: db8 kind `org.webosphoenix.mcp.audit:1` (time, client, tool,
arguments summary, decision, result status), readable only by the hub and
Settings. Settings > Assistant > Activity lists it by day; entries older
than 30 days are deleted (configurable 7 to 365). Message bodies and file
contents are not logged, only their size.

**Rate limits** (token buckets per client): `read` 60/min, `personal-read`
30/min, `local-write` 30/min, `settings` 10/min, `outbound` 5 per 10 min,
`destructive` 5 per 10 min. Exceeding one returns a tool error the model
can read, and three in a row pause the client until the user resumes it
from the dashboard.

### Sandboxing

- The hub holds broad Luna permissions, so it is the component to protect.
  It runs as its own service user where OSE allows (*which user OSE runs
  JS services as is unverified*), and its ACG role lists only the
  services it wraps.
- The policy engine is the only path to a handler. There is no generic
  "call any Luna method" tool.
- App manifests are data. The hub never evaluates code from them, and
  `page` handlers run in the app's own page and process.
- The OAuth server, TLS listener and SSH route are off until the user turns
  them on, and the LAN listener only answers on the LAN interface.
- Tool results are sanitized (length limits, stripped control characters)
  before the hub returns them.

### Just Type

- **Ask the assistant**: a row at the bottom of Just Type's results, next
  to the web search engines ("Ask Assistant about 'wifi off at 11'"),
  added as a Phoenix entry in the simulated `com.palm.universalsearch`
  list. Tapping it opens the assistant card with the text.
- **Quick Actions from MCP prompts**: "Plan my day" and app prompts appear
  in Quick Actions.
- **Direct commands**: when the local model is on, Just Type can show a
  best-guess action inline as the user types ("Turn off Wi-Fi", "Text Mom
  ..."), computed only on Enter or after a pause, and always as a
  suggestion to tap, never run by itself.
- The tools derived from `universalSearch` keep Just Type and MCP in step:
  what an app offers one, it offers the other.

## Part 2: the on-device assistant

### Pieces

| Piece | What |
| --- | --- |
| `org.webosphoenix.assistant` (service) | Node.js Luna service: the agent loop, provider adapters, conversation store, memory, routing. An MCP client of the hub over Luna |
| Assistant app (`apps/assistant`, React + TypeScript) | The card: conversation, voice button, tool activity, settings shortcut. Draws with `@phoenix/ui` |
| `org.webosphoenix.llm` (service) | llama.cpp's `llama-server` on 127.0.0.1 (or a Unix socket), started on demand by systemd and stopped after 5 idle minutes to give the RAM back. OpenAI-compatible, so the assistant treats it like any provider |
| `org.webosphoenix.transcriber` | Exists (Voice Memos). The assistant uses it for push-to-talk |
| Settings > Assistant | Part 3 |

### Entry points

| Entry point | How | Notes |
| --- | --- | --- |
| The launcher and quick launch | Assistant icon | A normal card |
| Just Type | "Ask Assistant" row, prompts in Quick Actions | See above |
| Gesture | Press and hold in the gesture area for 0.6 s, then speak or type | Must not clash with the wave launcher (slow swipe up and hold) or the tap; *to be tried on a device* |
| Hardware | Long press of a headset's button; long press of the power key (off by default) | Through the keys module ([HARDWARE.md](HARDWARE.md#hardware-abstraction-plan)) |
| Voice | Push-to-talk first (the mic button in the card and in Just Type). A wake word later | See Voice |
| Notifications | An "Ask Assistant" action on message and email notifications ("Reply", "Summarize"), once notification actions exist (M4 item) | The notification's content is untrusted (Safety) |
| Share | "Share to Assistant" from Photos, Files, Web | The shared item is untrusted |

### The agent loop

```
user turn (text or transcript)
  -> router picks a model (local or a provider, see Routing)
  -> build context: system prompt, the user's memories, recent turns,
     tool list (filtered: only tools this client may use, and at most
     ~40 of them, chosen by the request's topic to fit small models)
  -> model call (streaming)
       text -> show in the card
       tool call -> hub (policy, confirmation, audit) -> result
                 -> mark result trusted/untrusted -> back to the model
  -> stop when the model answers without a tool call,
     or after 12 tool calls, or 2 minutes, or the user taps Stop
  -> store the turn (text, tool calls, results summary)
```

- **Plan first for voice and background runs.** When the assistant runs
  without the card in front, it asks the model for the list of tool calls
  up front, shows the plan in the dashboard ("Turn on Wi-Fi, then open
  Music"), and runs only that plan. This is the plan-then-execute pattern
  from the prompt-injection literature, and it also makes background runs
  easier to follow.
- **Small models get help.** Tools are grouped by area, and a local model
  first chooses an area, then sees only that area's tools. Arguments are
  generated with grammar-constrained decoding (llama.cpp supports JSON
  Schema grammars) so a 1B to 4B model produces valid calls.

### On-device models per device class

Q4 GGUF sizes are about 0.6 GB per billion parameters plus a few hundred MB
of KV cache and runtime for a 4k context. Decode speed on phones is mostly
limited by memory bandwidth. Measured numbers are cited; the rest are
**estimates to replace with measurements** (a `tools/bench-llm.sh` run on
each reference device is part of phase A2).

| Device class ([HARDWARE.md](HARDWARE.md)) | RAM | Local model that fits | Speed | Verdict |
| --- | --- | --- | --- | --- |
| Raspberry Pi 4 (Cortex-A72) | 4 to 8 GB | 0.6B to 1B | 1 to 2 tokens/s for 1B to 3B (SitePoint, measured) | Too slow for chat; command parsing only with a 0.6B to 1B model. Use a LAN or cloud model |
| qemux86-64 emulator | host's | any | host's CPU | Development only |
| Pixel 3a (Snapdragon 670) | 4 GB | 1B to 2B | estimate 4 to 8 tokens/s for 1B | Commands and short answers |
| PinePhone Pro (RK3399S) | 4 GB | 1B | estimate 2 to 5 tokens/s | Commands only; battery cost high |
| OnePlus 6 / 6T, Poco F1, SHIFT6mq (Snapdragon 845) | 6 to 8 GB | 2B to 4B | estimate 8 to 15 tokens/s for 2B, 3 to 6 for 4B | Usable offline assistant with a 2B model |
| Fairphone 4/5, Pixel 6a/7 (Halium) | 6 to 8 GB | 2B to 4B | estimate 8 to 20 tokens/s on CPU | Good. NPUs (Hexagon, Tensor TPU) are not reachable from our Linux stack today (*llama.cpp has a Hexagon backend for Android; on Halium, unverified*) |
| Surface Go and x86 tablets | 4 to 8 GB | 2B to 4B | estimate 5 to 15 tokens/s | Usable |

For comparison, a Raspberry Pi 5 does 12 to 18 tokens/s with a 1.1B model
and 4 to 6 with a 3B model (measured, secondary sources), and Qualcomm's
OpenCL backend for Adreno GPUs in llama.cpp targets Adreno 800-series and
X-series GPUs, not the Adreno 6xx in our first phones.

**Candidate models** (all open weights; check each model card before
shipping one, as for the Whisper model in [LEGAL.md](LEGAL.md)):

| Model | Sizes | Licence | Notes |
| --- | --- | --- | --- |
| **Qwen3.5** small (March 2026) | 0.8B, 2B, 4B, 9B | Apache-2.0 | Tool use, thinking and non-thinking modes, multimodal. **Default candidate**: 0.8B for the Pi and command parsing, 2B for phones |
| **Gemma 4** E2B, E4B (April 2026) | ~2B and ~4B effective | Apache-2.0 (a change from Gemma 3's own terms) | Built for phones; Google's own runtime is LiteRT-LM. Good second choice |
| Phi-4-mini | 3.8B | MIT (*per the model card, unverified here*) | Strong reasoning for its size |
| Llama 3.2 | 1B, 3B | Llama 3.2 Community License (not OSI open source, has an acceptable use policy) | Widely tested for tool calling; do not ship by default, let users download it |

Models are **not in the image** (hundreds of MB to GB). Settings downloads
one on request, over Wi-Fi, from Hugging Face, and checks its SHA-256
against a list shipped with Phoenix.

**Runtime choice: llama.cpp.**

| Runtime | Licence | Fit for Phoenix |
| --- | --- | --- |
| **llama.cpp** (`llama-server`) | MIT | **Chosen.** Plain C/C++, builds with Yocto like the `whisper-cpp` recipe (same ggml), CPU NEON everywhere, Vulkan and OpenCL backends to try on GPUs, OpenAI-compatible server with tool calls and JSON Schema grammars, GGUF models for every candidate. Daily builds (b11239 on 28 September 2026) |
| ExecuTorch (1.0 in October 2025, 1.4 now per PyPI) | BSD-3-Clause | ARM64 Linux supported; strong on Android/iOS and NPUs through vendor delegates. More build machinery, per-model export step. Revisit for NPUs |
| LiteRT-LM (Google) | Apache-2.0 | Linux and Raspberry Pi CLI and Python API; best path for Gemma. A second backend if Gemma 4 becomes the default |
| ONNX Runtime GenAI (0.17, September 2026) | MIT | Good on Windows and DirectML/QNN; less natural on our Yocto ARM Linux |
| MLC LLM | Apache-2.0 | Compiles per device (Vulkan, OpenCL, WebGPU). Powerful, but a compiler toolchain per target model is heavy for a volunteer project |

### Voice

- **Push-to-talk now**: record 16 kHz WAV (Voice Memos' code), send it to
  `org.webosphoenix.transcriber`, show the text, run it. whisper.cpp's
  `base.en` on a Snapdragon 845 should take one to three seconds for a
  short command (*estimate*); `tiny.en` halves that. The transcript goes
  into the text field first so the user can fix it; a setting runs it
  directly.
- **Wake word later**: whisper is not a wake-word engine. openWakeWord runs
  many models on one Raspberry Pi 3 core, and its **code is Apache-2.0 but
  its pre-trained models are CC BY-NC-SA 4.0**, so Phoenix would have to
  train its own "Hey Phoenix" model with its tools. Off by default; a
  status bar mic indicator whenever the microphone is open.
- **Speaking answers**: OSE has `com.webos.service.tts` (engine per build,
  *unverified*). Piper is the usual open alternative; the original
  `rhasspy/piper` was MIT and its successor is GPL-3.0 (*unverified*;
  either would run as a separate program, like whisper-cli). Off by
  default; on for voice-started turns.
- OSE's `com.webos.service.ai.voice` is a Google Assistant client with
  cloud recognition. Phoenix does not use it.

### Routing between local and cloud

The user picks a **mode** in Settings: **On device only**, **Prefer on
device**, or **Prefer cloud** (default when a provider is set up; On device
only otherwise).

| Request | Prefer on device | Prefer cloud |
| --- | --- | --- |
| Short command that maps to one or two tools ("Wi-Fi off", "timer 10 minutes") | Local | Local if a local model is installed (faster, private), else cloud |
| Question or multi-step task | Local; offer "Ask <provider>" if the local answer is low-confidence or the local model gives up | Cloud |
| Involves a data class the provider is not allowed to see | Local | Local, and say why |
| No network | Local | Local, with a banner "Offline: using the on-device model" |
| Local model not installed or too slow on this device class | Cloud (with a one-time notice) | Cloud |

"Allowed to see" is per provider and per data class (Settings, Part 3). The
router checks before any content leaves the device, and the card shows a
small label on each answer: "On device", "Home server (Ollama)",
"Anthropic".

### Memory and context

| What | Where | Retention | Who sees it |
| --- | --- | --- | --- |
| Conversations | db8 `org.webosphoenix.assistant.conversation:1` | 30 days by default (1 day to forever, or "don't keep") | The assistant; sent to a provider only as part of that conversation |
| Memories ("my partner is Sam", "I prefer metric") | db8 `org.webosphoenix.assistant.memory:1` | Until deleted | Listed in Settings > Assistant > Memories, editable. The assistant proposes a memory and the user confirms ("Remember this?"); nothing is remembered silently |
| Personal data (contacts, messages, ...) | Where it already is | Not copied | Read on demand through the hub, per grant; tool results are kept in the conversation only as a short summary |
| Screen content | Not read by default | | An explicit "Ask about this screen" action takes a screenshot of the front card for that one turn |

There is no background indexing of the user's data for the assistant in
this plan. A local semantic index (embeddings of notes and email for "find
the email about the boiler") is an open question, not a default.

### Safety

**The threat.** An assistant that can read untrusted content (web pages,
email, messages, files), can see private data, and can send data out has
all three parts of what Simon Willison calls the "lethal trifecta" (*not
re-checked for this plan*): an attacker writes instructions into an email,
and the model follows them. No model is reliably immune, so the defences
are architectural, following *Design Patterns for Securing LLM Agents
against Prompt Injections* (Beurer-Kellner et al., June 2025) and
DeepMind's CaMeL (*Defeating Prompt Injections by Design*, March 2025).

| Defence | How |
| --- | --- |
| **Trust labels** | The hub labels each tool result `trusted` (OS state, the user's own settings) or `untrusted` (message and email bodies, web pages, file contents, notification text, anything from another person). The label travels with the content in the conversation |
| **Taint rule** | After untrusted content enters a turn, every `local-write`, `settings`, `outbound`, `destructive` and `developer` call in that turn needs a confirmation, even if pre-approved. `outbound` calls whose recipient or URL did not come from the user's own words or their contacts are **blocked**, not just confirmed |
| **Quarantined reading** | Summarizing or extracting from untrusted content ("what does this email say") goes to a separate model call **with no tools**, whose output comes back as data (the dual-LLM pattern). The planning model sees the summary labelled untrusted |
| **Plan-then-execute** | Voice and background runs fix their tool calls before reading untrusted data (above) |
| **No silent exfiltration** | The assistant card does not load remote images or follow links in model output; links are shown as text with the domain highlighted and open only on tap. `os.files.read` results never go to a URL tool in the same turn without a confirmation |
| **Show the arguments** | Every confirmation shows the exact recipient, text and target, not the model's description of them |
| **Allow and deny lists** | Per tool, per recipient (numbers and addresses), per domain for anything that fetches or posts; a global "never" list (emergency numbers are callable only by the user, not by a tool; payment and banking apps have no tools unless they declare them and the user enables them) |
| **Limits** | Rate limits, 12 tool calls and 2 minutes per turn, Stop in the dashboard |
| **Tests** | A red-team suite in CI: sample emails, SMS and pages with injected instructions, run against the simulator with a scripted model and with real small models, checking that the taint rule blocks or asks every time |

What this does not solve: a user who approves a malicious action because
the confirmation looked routine. Confirmations must stay rare enough to be
read, which is why reads and easy-to-undo local actions do not ask.

### UI

- **The assistant card**: a conversation drawn like a Messaging thread
  (the user's words right, the assistant's left), with tool steps as small
  grey rows ("Turned on Wi-Fi", "Read 3 unread emails") that expand to show
  arguments and results. A text field and a mic button in the command menu.
  The app menu has New conversation, Conversations, Memories, and
  Preferences (which opens Settings > Assistant).
- **While listening**: a banner-height strip with a level meter over the
  current card, or in the dashboard when the screen is off.
- **While working in the background**: a dashboard entry with the step list
  and Stop.
- **Confirmations**: popup alerts (above).
- **Answers to voice requests** arrive as a banner, and as speech when TTS
  is on.
- **MCP Apps** (later): a tool that returns a `ui://` resource is shown as
  a small card in the conversation, in a sandboxed web view, following the
  extension's rules.

## Part 3: Bring your own LLM

### Settings > Assistant

A new launch point in `apps/settings` (one pane per launch point, like the
others), drawn with the same Enyo 1.0 art:

```
Assistant
 [ Assistant                       ON ]
 Mode              Prefer cloud  >
 ---- Models ----------------------------
 On device          Qwen3.5 2B (1.3 GB)  >
 Anthropic          claude-...           >
 Home server        Ollama, qwen3:8b     >
 + Add a model provider
 ---- Privacy ---------------------------
 What providers may see                 >
 Conversations      Keep 30 days        >
 Memories                               >
 Activity                               >
 ---- Connections -----------------------
 Connected computers                    >
 ---- Usage -----------------------------
 This month  Anthropic 412k tokens, about $1.90
             Home server 1.2M tokens
```

### Providers

| Provider type | Endpoint and API | Setup | Model list |
| --- | --- | --- | --- |
| **Anthropic** | Messages API (`/v1/messages`), streaming, tool use | API key | `GET /v1/models` |
| **OpenAI** | **Responses API** (`/v1/responses`). OpenAI recommends it for new projects, and from GPT-5.4 Chat Completions does not support tool calls with reasoning turned on | API key, optional organization | `GET /v1/models` |
| **Google** | Gemini API (`generateContent`, function calling) | API key | models list |
| **OpenAI-compatible** | `/v1/chat/completions` with `tools` (the dialect Ollama, LM Studio, llama.cpp's server and vLLM share); `/v1/responses` where the server has it (Ollama: stateless only) | Base URL, optional key; "Find on my network" looks for Ollama (port 11434) and LM Studio (1234) on the LAN (*default ports from their docs; confirm*) | `GET /v1/models` |
| **On device** | `org.webosphoenix.llm` (llama.cpp's OpenAI-compatible server) | Download a model | Installed models |

The adapters are small TypeScript modules in the assistant service, one per
API shape (Messages, Responses, Chat Completions, Gemini), each mapping
MCP tool definitions to the provider's tool format and back. Provider SDKs
are not required; `fetch` with streaming is enough and keeps the service
small. Model ids are **never hard-coded in the UI**; they come from the
provider's model list, with the user's choice saved.

Per provider the user sets: the model for conversation, an optional
cheaper model for quick tasks, a monthly token or spending cap, and which
data classes it may see.

### API keys

- Keys live in the **Phoenix key store**, `org.webosphoenix.service.keystore`,
  the same one Synergy needs ([SYNERGY.md](SYNERGY.md#29-where-credentials-live)):
  OSE publishes no key manager, so Phoenix provides one that implements the
  legacy `com.palm.keymanager` calls. webOS-ports' Node.js keymanager
  (Apache-2.0) is a candidate to reuse. Keys are encrypted with a device key
  (TPM or TEE where there is one, else a file readable only by the key
  store's user).
- Only the assistant service can read provider keys (key store ACL by
  caller id). The Settings page can write and delete a key but only shows
  its last four characters.
- Keys never go into the conversation, the audit log, crash reports or MCP
  results. Per the MCP spec, the hub never asks for a key through a form
  elicitation.
- In the simulator the key store is simulated in localStorage (clearly
  marked), and calls to cloud providers go through `tools/serve-rootfs.py`'s
  proxy (browsers block cross-origin calls, as with DAV). On a device the
  service calls providers directly.

### Usage and cost

- Token counts come from each response's `usage` fields and are kept per
  provider per day in db8.
- Cost is an **estimate** from a price table shipped with Phoenix and
  editable by the user, because prices change more often than releases.
  Labelled "about".
- Caps: at 80% a banner; at 100% the provider is paused until the next
  month or until the user raises the cap, and the router falls back to the
  local model.

### Offline fallback

With no network (or a provider down, or a cap reached): the on-device model
if one is installed, otherwise the assistant says it is offline and offers
the direct commands Just Type can still do without a model (open apps,
toggles). Queued requests are not replayed later without the user asking.

### Privacy notice

Shown when the user adds a cloud provider, and always available from the
provider's page, in plain words:

- what is sent (your messages to the assistant, the content of tools it
  reads for you, for the data classes you allow), and what is never sent
  (keys, the audit log, data classes you did not allow);
- that the provider's own terms and retention apply, with a link;
- that "On device" and a server on your own network keep everything local.

### Features by provider

| Feature | On device (2B) | LAN (Ollama etc.) | Anthropic / OpenAI / Google |
| --- | --- | --- | --- |
| Direct commands (toggles, open, timers) | Yes | Yes | Yes |
| Multi-step tasks with tools | Simple ones | Depends on the model | Yes |
| Summarize email, messages, web pages | Short ones | Yes | Yes |
| Drafting replies | Basic | Yes | Yes |
| Images ("what is in this photo") | With a multimodal model (Qwen3.5, Gemma 4), slow | Model dependent | Yes |
| Works offline | Yes | On the same network | No |
| Data stays on the device | Yes | Stays in your home | No |
| Cost | Battery | Your server | Per token |

## Roadmap

Sizes: **S** up to 2 weeks, **M** 2 to 6 weeks, **L** more than 6 weeks,
for one contributor.

| Phase | What | Size | Depends on |
| --- | --- | --- | --- |
| **P0** | This plan agreed; manifest schema and tool list frozen as `docs/spec/mcp-manifest.md` | S | |
| **P1** | Hub with read-only OS tools, Luna transport, registry, audit log; simulated in the runtime; `phoenix-sim --mcp-stdio`; tests driving it with the TypeScript SDK's client | M | |
| **P2** | Write tools, the policy engine and grants, popup alert confirmations and the dashboard entry in the shell; `appinfo.json` `mcp` sections for Phoenix apps; `universalSearch`-derived tools; overlay manifests for the original apps | M | Popup alerts and dashboards in the shell on OSE (M1) |
| **P3** | `phoenix-mcp` stdio program and the Unix socket; the SSH route documented for Claude Code and Claude Desktop | S | Developer Mode and SSH ([TERMINAL.md](TERMINAL.md)) |
| **P4** | Streamable HTTP, TLS, pairing and the OAuth 2.1 server | M to L | P2 |
| **A1** | Assistant app and service with cloud and OpenAI-compatible providers; Settings > Assistant; key store | M | Key store (shared with Synergy) |
| **A2** | `llama-cpp` recipe, `org.webosphoenix.llm`, model downloads, `bench-llm` on each reference device, the router | M | Reference devices (M3) for real numbers |
| **A3** | Push-to-talk, Just Type entry, gesture, notification actions | M | `whisper-cpp` recipe built; notification actions (M4) |
| **A4** | Safety hardening: trust labels and taint rule end to end, quarantined reading, red-team suite in CI | M | P2, A1 |
| **A5** | Wake word (own model), TTS, MCP Apps cards, local semantic search | L | A3 |

Build P1, P2 and A1 in the simulator first, as every Phoenix app has been;
the device work waits for the M1 shell on OSE.

## Risks

| Risk | Mitigation |
| --- | --- |
| MCP keeps changing (the 2026-07-28 revision removed sessions and deprecated sampling) | Keep the MCP code in one module on the official SDK; support one previous revision |
| Prompt injection leads to a harmful action | The Safety section; confirmations cannot be turned off for `outbound` and `destructive` |
| The hub becomes a confused deputy with broad permissions | One policy path, per-app `luna` handlers limited to the app's own services, no generic Luna tool |
| Local models too slow on the first devices | Cloud and LAN providers first; local only where measured to be usable |
| RAM pressure: a 2B model plus Chromium on a 4 GB phone | Start the model on demand and stop it when idle; refuse to load when free memory is low |
| Battery drain from local inference or a wake word | Both off by default; measure |
| OSE is quiet (no release since March 2025) | Nothing here depends on OSE changes beyond what HARDWARE.md already covers |
| Provider APIs change (models renamed, tools moved to newer endpoints) | Adapters per API shape, model lists read at runtime |
| Legal: model licences and acceptable use policies | Ship no model in the image; list licences in the download screen; Apache-2.0 or MIT models as defaults |

## Open questions for you

1. **Default model mode**: should a fresh install have the assistant off
   until the user sets it up, or on with the local model where the device
   can run one?
2. **Which cloud providers at first**: Anthropic, OpenAI, Google and
   OpenAI-compatible all in A1, or start with Anthropic plus
   OpenAI-compatible (which covers Ollama and LM Studio)?
3. **Remote control from your Mac**: is the SSH route (`ssh phone
   phoenix-mcp`, Developer Mode only) enough for you, or do you want the
   LAN HTTP server with QR pairing early?
4. **The gesture**: press and hold in the gesture area, or something else
   (a double tap, a long press on the power key)? *Proposed (29 September
   2026): hold in the gesture area asks the assistant while the keyboard is
   down; while it is up, hold and slide moves the text cursor
   ([spec/GAPS.md](spec/GAPS.md) V4).*
5. **Wake word**: wanted at all? It needs our own trained model and costs
   battery.
6. **Memory**: is "the assistant proposes, you confirm" right, or do you
   want it to remember nothing between conversations by default?
7. **Local semantic search** over email, notes and messages: worth the
   storage and battery, or leave it out?
8. **Shell access for AI clients** (`os.shell.exec` in Developer Mode):
   include it, or never expose a shell through MCP?
9. **A home relay**: you prefer LAMP. Would you want an optional PHP/MySQL
   companion on your own server (for example to reach the phone's MCP from
   outside the LAN, or to keep conversation history), or should everything
   stay on the phone?

## Sources

Accessed 28 September 2026 unless noted.

- MCP versioning, current revision 2026-07-28: <https://modelcontextprotocol.io/specification/versioning>
- MCP 2026-07-28 changelog (sessions removed, MRTR, `server/discover`, deprecations): <https://modelcontextprotocol.io/specification/2026-07-28/changelog>
- MCP 2026-07-28 release post (Tier 1 SDKs, extensions): <https://blog.modelcontextprotocol.io/posts/2026-07-28/>; release candidate (21 May 2026): <https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/>
- Transports overview and Streamable HTTP: <https://modelcontextprotocol.io/specification/2026-07-28/basic/transports>, <https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http>
- Authorization: <https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization>
- Tools: <https://modelcontextprotocol.io/specification/2026-07-28/server/tools>
- Elicitation: <https://modelcontextprotocol.io/specification/2026-07-28/client/elicitation>
- MCP Apps (26 January 2026): <https://blog.modelcontextprotocol.io/posts/2026-01-26-mcp-apps/>, <https://modelcontextprotocol.io/seps/1865-mcp-apps-interactive-user-interfaces-for-mcp>
- Android AppFunctions: <https://developer.android.com/ai/appfunctions>; Android Developers Blog (February 2026): <https://android-developers.googleblog.com/2026/02/the-intelligent-os-making-ai-agents.html>; Jetpack release list: <https://developer.android.com/jetpack/androidx/releases/appfunctions>
- Apple WWDC26 Apple Intelligence guide (App Intents, schemas, View Annotations, Foundation Models): <https://developer.apple.com/wwdc26/guides/apple-intelligence/>
- llama.cpp releases (b11239, 28 September 2026): <https://github.com/ggml-org/llama.cpp/releases>; OpenCL backend for Adreno (IWOCL 2026 slides): <https://www.iwocl.org/wp-content/uploads/IWOCL-2026-Wang-Llamacpp.pdf>
- ExecuTorch 1.0: <https://pytorch.org/blog/introducing-executorch-1-0/>; releases: <https://github.com/pytorch/executorch/releases>
- LiteRT-LM: <https://ai.google.dev/edge/litert-lm/overview>
- ONNX Runtime GenAI (0.17.0 on PyPI): <https://pypi.org/project/onnxruntime-genai/>
- MLC LLM: <https://llm.mlc.ai/>
- Gemma 4 under Apache-2.0: <https://opensource.googleblog.com/2026/03/gemma-4-expanding-the-gemmaverse-with-apache-20.html>
- Qwen3.5 small models (2 March 2026, Apache-2.0): <https://artificialanalysis.ai/articles/qwen3-5-small-models> (secondary)
- Raspberry Pi 4 and 5 llama.cpp speeds: <https://www.sitepoint.com/llms-raspberry-pi-edge/>, <https://www.stratosphereips.org/blog/2025/6/5/how-well-do-llms-perform-on-a-raspberry-pi-5> (secondary)
- Design Patterns for Securing LLM Agents against Prompt Injections (June 2025): <https://arxiv.org/abs/2506.08837>; CaMeL, Defeating Prompt Injections by Design (March 2025): <https://arxiv.org/abs/2503.18813>
- OpenAI, migrating to the Responses API (GPT-5.4 tool-calling note): <https://developers.openai.com/api/docs/guides/migrate-to-responses>
- Ollama OpenAI compatibility: <https://docs.ollama.com/api/openai-compatibility>; LM Studio: <https://lmstudio.ai/docs/developer/openai-compat>
- openWakeWord (code Apache-2.0, models CC BY-NC-SA 4.0): <https://github.com/dscripka/openWakeWord>
- webOS OSE LS2 API index (no key manager; `com.webos.service.tts`, `ai.voice`, `devmode`): <https://www.webosose.org/docs/reference/ls2-api/ls2-api-index/>; `ai.voice`: <https://www.webosose.org/docs/reference/ls2-api/com-webos-service-ai-voice/>
- webOS OSE 2.27.0 release notes (Node.js 20.12.2): <https://www.webosose.org/about/release-notes/webos-ose-2-27-0-release-notes/>
- webOS-ports keymanager (Apache-2.0, Node.js): <https://github.com/webOS-ports/keymanager>
