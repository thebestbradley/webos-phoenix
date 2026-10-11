// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The types of a connector (docs/SYNERGY-SDK.md): what a developer writes
// (ConnectorDefinition, made with defineConnector) and what the kit gives
// each of its functions (the contexts).

import type { DbApi, DbObject, Http, Luna, RequestFn } from "@phoenix/synckit";

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Json = any;

/** A Luna reply. */
export interface Reply { returnValue: boolean; errorCode?: string; errorText?: string; [k: string]: Json }

/** One object on the server, as a connector's pull gives it. */
export interface RemoteObject {
    /** The server's stable id of the object (a URL, an id). */
    remoteId: string;
    /** Its change key (etag, version, updated_at): unchanged means nothing to do. */
    etag?: string;
    /** The mapped fields, in the db8 kind's own names. */
    fields: Record<string, Json>;
}

export interface PullResult {
    /** Objects new or changed since `token` (all of them on a full pull). */
    changes: RemoteObject[];
    /** remoteIds deleted on the server since `token`. */
    deleted?: string[];
    /** The token for the next incremental pull (sync-token, since_id, delta link). */
    nextToken?: string | null;
    /** A full listing: anything not in changes is gone from the server. */
    full?: boolean;
}

/** A device change sent to the server by a two-way capability's push. */
export interface LocalChange {
    op: "create" | "update" | "delete";
    remoteId?: string;
    etag?: string;
    /** The fields as they are on the device (create, update). */
    fields?: Record<string, Json>;
    /** The fields as both sides last agreed on them (update, delete). */
    base?: Record<string, Json>;
}

export interface PushResult { remoteId: string; etag?: string }

export interface CapabilityDefinition {
    /** The template's capability name: "CONTACTS", "CALENDAR", "MESSAGING", "FEEDS", ... */
    capability: string;
    /** The db8 kind the synced objects are written to (the template's dbkinds). */
    kind?: string;
    /** The fields the mapping owns (item records keep a base copy of them). */
    fields?: string[];
    /**
     * What changed on the server since token (null: the first sync). With
     * kind, the kit writes the objects, keeps item records and deletes
     * what is gone.
     */
    pull?(ctx: AccountContext, token: string | null): Promise<PullResult>;
    /** Two-way capabilities: send one device change; the new remote id and etag. */
    push?(ctx: AccountContext, change: LocalChange): Promise<PushResult | void>;
    /** db8 object fields from the remote fields (default: the fields as they are). */
    toDb?(fields: Record<string, Json>, ctx: AccountContext): Record<string, Json> | Promise<Record<string, Json>>;
    /** Remote fields from a db8 object (two-way; default: the `fields` of the object). */
    fromDb?(object: DbObject): Record<string, Json>;
    /** Who wins a field changed on both sides (default "remote": the server, as SYNERGY.md 3.3). */
    conflict?: "remote" | "local";
    /** CONTACTS: keep com.palm.person:1 records (the linker's rules; default true). */
    linkPersons?: boolean;
    /**
     * A capability that is not a set of objects (notifications, messages):
     * runs on each sync instead of pull / push.
     */
    sync?(ctx: AccountContext): Promise<Json | void>;
    /** Turned off or the account deleted: remove what it wrote (default: its kind's objects of the account). */
    remove?(ctx: AccountContext): Promise<void>;
    /**
     * A db8 watch that calls one of the connector's methods with {accountId}
     * when objects match the query (an outbox of pending messages, as
     * mojomail's watches: docs/SYNERGY-CONNECTORS.md 3.2 rule 6): an
     * activity with a db8 trigger while the capability is on.
     */
    watch?: { query: Json; method: string };
}

export interface ConnectorDefinition {
    /** The Luna service name ("org.example.service.foo"). */
    service: string;
    /** The templates this service implements (their capabilityProviders name it). */
    templateIds: string[];
    /** The connector's own bookkeeping kinds: state (one per account) and item records. */
    kinds: { state: string; item?: string };
    /** Hosts the connector may reach besides the user's server ("*.example.com"). */
    hosts?: string[];
    userAgent?: string;
    /** Capabilities by capability provider id (the template's capabilityProviders[].id). */
    capabilities: Record<string, CapabilityDefinition>;
    /** The periodic sync (the activity manager's interval, 15m or more; default 1h). */
    schedule?: { every?: string; network?: boolean };
    /** C6: register for push (UnifiedPush). Recorded only, for now. */
    push?: { unifiedPush?: boolean };
    /** The template's validator: {username, password, config} -> {credentials, config?, username?}. */
    validate(ctx: ValidateContext, params: ValidateParams): Promise<ValidateResult>;
    /** After createAccount (the validator's config is in ctx.config already). */
    onCreate?(ctx: AccountContext): Promise<void>;
    /** Before the account's data goes (revoke a token, ...). */
    onDelete?(ctx: AccountContext): Promise<void>;
    /** More service methods ({accountId?} gets an account context). */
    methods?: Record<string, (ctx: MethodContext, params: Json) => Promise<Json>>;
    /**
     * Sharing to the service (docs/SYNERGY-SDK.md "Sharing to your service"):
     * what it can post and how. The share sheet lists the connector once per
     * signed-in account; the kit makes the `share` method from it.
     */
    share?: ShareDefinition;
    /**
     * Where a person without an account signs up (docs/SYNERGY-SDK.md
     * "Sign-up link"): the service's page, or for a federated service a page
     * to choose a server and/or servers to suggest. https only. Written into
     * the account template by phoenix-connector pack.
     */
    signUp?: string | { url?: string; servers?: { name: string; url: string }[] };
    /**
     * A long-lived connection per account (an XMPP stream, a Matrix sync
     * loop, a TDLib client): opened by the kit while the account has an
     * enabled capability and the host keeps connections (Environment.live),
     * after each sync when it is not open, and by ctx.connect(); closed when
     * the last capability is turned off or the account is deleted
     * (docs/SYNERGY-SDK.md "Staying connected").
     */
    connection?: { open(ctx: AccountContext): Promise<LiveConnection> };
    /**
     * Build-time settings the connector needs (an app id registered with the
     * service): their names. A device keeps them in
     * /etc/phoenix/connectors/<service>.json, never in the source tree; a
     * build without them has ctx.setting give undefined.
     */
    settings?: string[];
    /**
     * System programs the connector runs (first-party connectors only: a
     * library's JSON interface the image installs, such as TDLib's or Delta
     * Chat's): their names, as Environment.helper knows them.
     */
    helpers?: string[];
}

/** An open long-lived connection (definition.connection). */
export interface LiveConnection {
    close(): Promise<void> | void;
    /** True once it has ended (the server closed it, the network went): the kit opens a new one when asked. */
    readonly closed?: boolean;
    [k: string]: Json;
}

/** A socket of the host (Environment.net): text in and out. */
export interface NetSocket {
    /** "stream": TCP, text as it comes; "message": WebSocket, one message per frame. */
    readonly framing: "stream" | "message";
    /** Whether the connection is encrypted (TLS, wss:). */
    readonly secure: boolean;
    write(data: string): void;
    /** STARTTLS on a stream socket: TLS on the same connection, the certificate checked for servername. */
    startTls?(servername: string): Promise<void>;
    onData(fn: (text: string) => void): void;
    onClose(fn: (error?: Error) => void): void;
    close(): void;
}

export interface SrvRecord { name: string; port: number; priority: number; weight: number }

/** What the host gives for sockets (a device: Node's net, tls and dns; the simulator: WebSocket). */
export interface NetEnvironment {
    resolveSrv?(name: string): Promise<SrvRecord[]>;
    /** A TCP connection, TLS from the start when tls (direct TLS, XEP-0368). */
    connect?(options: { host: string; port: number; tls: boolean; servername?: string }): Promise<NetSocket>;
    websocket?(url: string, protocols?: string[]): Promise<NetSocket>;
}

/** A system helper program (Environment.helper): lines of JSON in and out. */
export interface HelperProcess {
    send(line: string): void;
    onLine(fn: (line: string) => void): void;
    onExit(fn: (code: number | null) => void): void;
    kill(): void;
}

/** The sockets a connector may open (ctx.net): to its user's server, the hosts it names, or their SRV targets. */
export interface Net {
    resolveSrv(name: string): Promise<SrvRecord[]>;
    connect(options: { host: string; port: number; tls: boolean; servername?: string }): Promise<NetSocket>;
    websocket(url: string, protocols?: string[]): Promise<NetSocket>;
    /** What this host can do. */
    readonly supports: { srv: boolean; tcp: boolean; websocket: boolean };
    allowHost(host: string): void;
}

/** What a connector can be given to post. */
export type ShareKind = "text" | "link" | "image" | "video" | "file";

export interface MediaLimits {
    /** At most this many of the kind in one post. */
    max?: number;
    /** The largest file the service takes, in bytes. */
    maxBytes?: number;
    /** The MIME types taken (default: image/*, video/*, or any file). */
    mimeTypes?: string[];
    /** Each file may have a description (alt text), up to maxLength characters. */
    altText?: boolean | { maxLength?: number };
    /** Text: the longest text, in characters. */
    maxLength?: number;
}

export interface ShareAccepts {
    text?: true | { maxLength?: number };
    link?: true | Record<string, never>;
    image?: true | MediaLimits;
    video?: true | MediaLimits;
    file?: true | MediaLimits;
}

export interface ShareAudienceOption { value: string; label: string; hint?: string }

export interface ShareDefinition {
    /** The sheet's label (default: the app's title). */
    label?: string;
    /** How an account is named in the sheet: "{username}" (the default), "@{username}". */
    accountLabel?: string;
    /** The template whose accounts are listed (default: the first of templateIds). */
    templateId?: string;
    /** What it takes, and the limits of each kind. */
    accepts: ShareAccepts;
    /** Who may see a post, if the service has a choice (Mastodon's visibilities). */
    audience?: { label?: string; options: ShareAudienceOption[]; default?: string };
    /**
     * Post it, as the account the user chose (ctx is that account's). The
     * content is already checked against accepts; ctx.readFile reads only
     * the files of this share. -> {url?, id?}; throw an error with an
     * errorCode (401_UNAUTHORIZED, ...) when it is not posted.
     */
    send(ctx: AccountContext, content: ShareContent): Promise<ShareResult | void>;
}

export interface SharedFile {
    path: string;
    mimeType: string;
    kind: ShareKind;
    /** The description (alt text) the user wrote; "" without one, or when the kind takes none. */
    description: string;
    /** Its bytes (refused with SHARE_TOO_LARGE above the kind's maxBytes). */
    read(): Promise<{ bytes: Uint8Array; mimeType: string }>;
}

export interface ShareContent {
    title: string;
    text: string;
    /** The link, when the declaration takes links (otherwise it is in text). */
    url: string;
    files: SharedFile[];
    /** One of audience.options[].value, when the declaration has an audience. */
    audience?: string;
    /** The same for a retry of the same share: post it once (an Idempotency-Key). */
    idempotencyKey: string;
}

export interface ShareResult { url?: string; id?: string }

export interface ValidateParams {
    username?: string;
    password?: string;
    templateId?: string;
    accountId?: string;
    config?: Record<string, Json>;
    [k: string]: Json;
}
export interface ValidateResult {
    credentials: Record<string, Json>;
    config?: Record<string, Json>;
    username?: string;
}

/** What every function of a connector gets. */
export interface BaseContext {
    luna: Luna;
    db: DbApi;
    tempdb: DbApi;
    http: Http;
    log(message: string): void;
    now(): number;
    service: string;
    /** OAuth tokens kept by org.webosphoenix.service.oauth (docs/SYNERGY-SDK.md). */
    oauth: OAuthClient;
    /** A remote picture kept on the device: a path (device) or a data: URL (simulator). */
    cachePhoto(key: string, url: string): Promise<string>;
    /** A file the user picked (sharing): its bytes and type. */
    readFile(path: string): Promise<{ bytes: Uint8Array; mimeType: string }>;
    /** Sockets (definition.connection's streams). */
    net: Net;
    /** A build-time setting (definition.settings), or undefined when this build has none. */
    setting(name: string): Promise<Json>;
    /** Start a system helper (definition.helpers); HELPER_NOT_AVAILABLE where this host has none. */
    helper(name: string, args?: string[]): Promise<HelperProcess>;
    /** Keep a file (a picture received) under the connector's own folder of the device -> its path. */
    writeFile(name: string, bytes: Uint8Array, mimeType?: string): Promise<string>;
    /** Timers the tests can drive. */
    setTimeout(fn: () => void, ms: number): Json;
    clearTimeout(handle: Json): void;
}

export interface ValidateContext extends BaseContext {
    templateId: string;
}

export interface AccountContext extends BaseContext {
    accountId: string;
    /** The account (getAccountInfo): username, templateId, capabilityProviders. */
    account: Json;
    /** The account's "common" credentials. */
    credentials: Record<string, Json>;
    /** The validator's config, kept by the kit since onCreate. */
    config: Record<string, Json>;
    /** The connector's own per-account state; saved after the call when changed. */
    state: Record<string, Json>;
    /** A webOS notification (com.webos.notification createToast). */
    notify(n: { title: string; body?: string; appId?: string; params?: Json }): Promise<void>;
    /** A message into Messaging (org.webosports.service.messaging putMessage). */
    putMessage(message: Json): Promise<Json>;
    /** The account's open connection (definition.connection), or null. */
    live(): LiveConnection | null;
    /** The account's connection, opened when it is not (NOT_LIVE_HERE where this host keeps none now). */
    connect(): Promise<LiveConnection>;
    /** Whether this host keeps the connections (false: a call that needs one answers NOT_LIVE_HERE and goes to the host that does). */
    connectionsHere(): boolean;
    /** Save ctx.state now (a long-lived connection's context; a call's is saved after it). */
    saveState(): Promise<void>;
}

export type MethodContext = BaseContext & Partial<AccountContext>;

export interface OAuthClient {
    /** The access token of a key held by the OAuth service (credentials.common.oauthKey). */
    token(keyId: string): Promise<string>;
    /** Forget the key (account deleted). */
    forget(keyId: string): Promise<void>;
}

/** What the host gives the kit: a device (device.ts), the simulator, the tests. */
export interface Environment {
    luna: { call(uri: string, params?: object): Promise<Json> | Json };
    request: RequestFn;
    log?(message: string): void;
    now?(): number;
    sleep?(ms: number): Promise<void>;
    /** false: no periodic activity (tests). */
    periodicSync?: boolean;
    /** false: no com.palm.person:1 upkeep (once the real linker runs on the device). */
    linkPersons?: boolean;
    cachePhoto?(key: string, url: string): Promise<string>;
    readFile?(path: string): Promise<{ bytes: Uint8Array; mimeType: string }>;
    /** Longest Retry-After waited out within a sync (ms, default 30000). */
    maxWaitMs?: number;
    /** Sockets (a device: TCP, TLS and SRV; the simulator: WebSocket only). */
    net?: NetEnvironment;
    /** Whether this host keeps long-lived connections now (default true; the simulator: one page at a time). */
    live?(): boolean;
    /** Build-time settings of the service ({name: value}), or null. */
    settings?(service: string): Promise<Record<string, Json> | null>;
    /** Start a system helper program by name. */
    helper?(name: string, args?: string[]): Promise<HelperProcess>;
    /** Keep a file under the connector's folder (pictures received) -> its path. */
    writeFile?(service: string, name: string, bytes: Uint8Array, mimeType?: string): Promise<string>;
    /** Timers (tests drive them; default setTimeout / clearTimeout). */
    setTimeout?(fn: () => void, ms: number): Json;
    clearTimeout?(handle: Json): void;
}

export type ServiceMethods = Record<string, (params: Json) => Promise<Reply>>;
