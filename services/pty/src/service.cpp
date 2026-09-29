// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0

#include "service.h"

#include <glib-unix.h>

#include <csignal>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <vector>

namespace phoenix {
namespace pty {

namespace {

LSMethod kMethods[] = {
    { "open", PtyService::onOpen, LUNA_METHOD_FLAGS_NONE },
    { "write", PtyService::onWrite, LUNA_METHOD_FLAGS_NONE },
    { "resize", PtyService::onResize, LUNA_METHOD_FLAGS_NONE },
    { "ack", PtyService::onAck, LUNA_METHOD_FLAGS_NONE },
    { "close", PtyService::onClose, LUNA_METHOD_FLAGS_NONE },
    { "list", PtyService::onList, LUNA_METHOD_FLAGS_NONE },
    { "getShells", PtyService::onGetShells, LUNA_METHOD_FLAGS_NONE },
    { "exec", PtyService::onExec, LUNA_METHOD_FLAGS_NONE },
    { nullptr, nullptr, LUNA_METHOD_FLAGS_NONE },
};

int signalNamed(const std::string &name)
{
    if (name.empty() || name == "SIGHUP") return SIGHUP;
    if (name == "SIGTERM") return SIGTERM;
    if (name == "SIGKILL") return SIGKILL;
    if (name == "SIGINT") return SIGINT;
    return 0;
}

std::string number(double v)
{
    char buf[32];
    std::snprintf(buf, sizeof buf, "%.0f", v);
    return buf;
}

void logf(const char *fmt, const std::string &a, const std::string &b = std::string())
{
    // The journal (systemd) keeps stderr: session start and end, never contents.
    std::fprintf(stderr, fmt, a.c_str(), b.c_str());
    std::fputc('\n', stderr);
}

} // namespace

PtyService::PtyService(LSHandle *handle) : m_handle(handle) {}

PtyService::~PtyService()
{
    if (m_flushTimer)
        g_source_remove(m_flushTimer);
    if (m_reapTimer)
        g_source_remove(m_reapTimer);
    for (auto &kv : m_sessions) {
        unwatch(kv.second);
        if (kv.second.subscription)
            LSMessageUnref(kv.second.subscription);
    }
}

bool PtyService::attach(LSError *error)
{
    if (!LSRegisterCategory(m_handle, "/", kMethods, nullptr, nullptr, error))
        return false;
    if (!LSCategorySetData(m_handle, "/", this, error))
        return false;
    return LSSubscriptionSetCancelFunction(m_handle, &PtyService::onCancel, this, error);
}

std::string PtyService::callerOf(LSMessage *msg)
{
    // Web apps: WebAppMgr puts the app's id on the call. Native callers
    // have only their service name, which is never the Terminal's id.
    const char *app = LSMessageGetApplicationID(msg);
    if (app && *app)
        return appIdOf(app);
    const char *service = LSMessageGetSenderServiceName(msg);
    return service ? std::string(service) : std::string();
}

void PtyService::reply(LSMessage *msg, const std::string &json)
{
    LSError err;
    LSErrorInit(&err);
    if (!LSMessageReply(m_handle, msg, json.c_str(), &err)) {
        LSErrorPrint(&err, stderr);
        LSErrorFree(&err);
    }
}

void PtyService::replyError(LSMessage *msg, int code, const std::string &text)
{
    reply(msg, "{\"returnValue\":false,\"errorCode\":" + std::to_string(code) + ",\"errorText\":" + jsonQuote(text) + "}");
}

PtyService::Entry *PtyService::find(LSMessage *msg, const Json &params, bool *replied)
{
    *replied = false;
    const std::string id = params["sessionId"].str();
    if (id.empty()) {
        replyError(msg, BadParams, "sessionId is required");
        *replied = true;
        return nullptr;
    }
    auto it = m_sessions.find(id);
    // Another app's session is as good as none.
    if (it == m_sessions.end() || it->second.owner != callerOf(msg)) {
        replyError(msg, NoSession, "No such session: " + id);
        *replied = true;
        return nullptr;
    }
    return &it->second;
}

static Json paramsOf(LSMessage *msg, bool *ok)
{
    const char *payload = LSMessageGetPayload(msg);
    Json p = Json::parse(payload ? payload : "{}", ok);
    if (*ok && !p.isObject())
        *ok = false;
    return p;
}

// ---- open -----------------------------------------------------------------------------

bool PtyService::onOpen(LSHandle *, LSMessage *msg, void *ctx)
{
    auto *self = static_cast<PtyService *>(ctx);
    bool ok = false;
    const Json p = paramsOf(msg, &ok);
    if (!ok) {
        self->replyError(msg, BadParams, "Malformed JSON");
        return true;
    }
    const std::string caller = callerOf(msg);
    if (!mayOpenShells(caller)) {
        logf("pty: refused open from %s%s", caller.empty() ? std::string("(unknown)") : caller);
        self->replyError(msg, NotAllowed, "Only the Terminal app may open a shell");
        return true;
    }
    if (!LSMessageIsSubscription(msg)) {
        self->replyError(msg, BadParams, "open needs subscribe: true (the output comes as replies)");
        return true;
    }
    size_t mine = 0;
    for (const auto &kv : self->m_sessions)
        mine += kv.second.owner == caller;
    if (mine >= static_cast<size_t>(kMaxSessionsPerApp)) {
        self->replyError(msg, TooMany, "Too many sessions");
        return true;
    }
    const std::string shellName = p["shell"].str(kDefaultShell);
    const std::string shellPath = findShell(shellName);
    if (shellPath.empty()) {
        self->replyError(msg, NoShell, "Shell not installed: " + shellName);
        return true;
    }

    SpawnOptions opts;
    opts.shellPath = shellPath;
    opts.cols = static_cast<int>(p["cols"].num(80));
    opts.rows = static_cast<int>(p["rows"].num(24));
    opts.cwd = p["cwd"].str();
    opts.inheritEnv = false;
    auto session = std::make_unique<Session>();
    std::string error;
    if (!session->spawn(opts, &error)) {
        self->replyError(msg, SpawnFailed, error);
        return true;
    }

    char idBuf[40];
    std::snprintf(idBuf, sizeof idBuf, "pty%u-%08x", self->m_nextId++, g_random_int());
    const std::string id = idBuf;
    Entry &e = self->m_sessions[id];
    e.id = id;
    e.owner = caller;
    e.shellName = shellName;
    e.session = std::move(session);
    e.subscription = msg;
    LSMessageRef(msg);
    const char *token = LSMessageGetUniqueToken(msg);
    e.token = token ? token : "";
    LSError err;
    LSErrorInit(&err);
    if (!LSSubscriptionAdd(self->m_handle, id.c_str(), msg, &err)) {
        LSErrorPrint(&err, stderr);
        LSErrorFree(&err);
    }
    logf("pty: session %s opened by %s", id, caller);

    self->reply(msg, "{\"returnValue\":true,\"subscribed\":true,\"sessionId\":" + jsonQuote(id)
                + ",\"pid\":" + std::to_string(e.session->pid()) + ",\"shell\":" + jsonQuote(shellName)
                + ",\"shellPath\":" + jsonQuote(shellPath) + "}");
    self->watch(e);
    return true;
}

// ---- write, resize, ack, close, list -----------------------------------------------

bool PtyService::onWrite(LSHandle *, LSMessage *msg, void *ctx)
{
    auto *self = static_cast<PtyService *>(ctx);
    bool ok = false, replied = false;
    const Json p = paramsOf(msg, &ok);
    if (!ok) { self->replyError(msg, BadParams, "Malformed JSON"); return true; }
    Entry *e = self->find(msg, p, &replied);
    if (!e) return true;
    if (!p["data"].isString()) { self->replyError(msg, BadParams, "data must be a string"); return true; }
    if (!e->session->write(p["data"].str())) { self->replyError(msg, NoSession, "The shell has exited"); return true; }
    self->reply(msg, "{\"returnValue\":true}");
    return true;
}

bool PtyService::onResize(LSHandle *, LSMessage *msg, void *ctx)
{
    auto *self = static_cast<PtyService *>(ctx);
    bool ok = false, replied = false;
    const Json p = paramsOf(msg, &ok);
    if (!ok) { self->replyError(msg, BadParams, "Malformed JSON"); return true; }
    Entry *e = self->find(msg, p, &replied);
    if (!e) return true;
    if (!e->session->resize(static_cast<int>(p["cols"].num()), static_cast<int>(p["rows"].num()))) {
        self->replyError(msg, BadParams, "cols and rows must be 1 to 999");
        return true;
    }
    self->reply(msg, "{\"returnValue\":true}");
    return true;
}

bool PtyService::onAck(LSHandle *, LSMessage *msg, void *ctx)
{
    auto *self = static_cast<PtyService *>(ctx);
    bool ok = false, replied = false;
    const Json p = paramsOf(msg, &ok);
    if (!ok) { self->replyError(msg, BadParams, "Malformed JSON"); return true; }
    Entry *e = self->find(msg, p, &replied);
    if (!e) return true;
    const double bytes = p["bytes"].num(-1);
    if (bytes < 0) { self->replyError(msg, BadParams, "bytes must be a number"); return true; }
    const bool wasPaused = e->session->paused();
    e->session->ack(static_cast<size_t>(bytes));
    if (wasPaused && !e->session->paused())
        self->watch(*e);
    self->reply(msg, "{\"returnValue\":true}");
    return true;
}

bool PtyService::onClose(LSHandle *, LSMessage *msg, void *ctx)
{
    auto *self = static_cast<PtyService *>(ctx);
    bool ok = false, replied = false;
    const Json p = paramsOf(msg, &ok);
    if (!ok) { self->replyError(msg, BadParams, "Malformed JSON"); return true; }
    Entry *e = self->find(msg, p, &replied);
    if (!e) return true;
    const int sig = signalNamed(p["signal"].str());
    if (!sig) { self->replyError(msg, BadParams, "signal must be SIGHUP, SIGTERM, SIGKILL or SIGINT"); return true; }
    // The exited reply follows on the session's subscription.
    e->session->hangup(sig);
    self->reply(msg, "{\"returnValue\":true}");
    return true;
}

bool PtyService::onList(LSHandle *, LSMessage *msg, void *ctx)
{
    auto *self = static_cast<PtyService *>(ctx);
    const std::string caller = callerOf(msg);
    std::string out = "{\"returnValue\":true,\"sessions\":[";
    bool first = true;
    for (const auto &kv : self->m_sessions) {
        if (kv.second.owner != caller)
            continue;
        out += first ? "" : ",";
        first = false;
        out += "{\"sessionId\":" + jsonQuote(kv.first) + ",\"pid\":" + std::to_string(kv.second.session->pid())
               + ",\"shell\":" + jsonQuote(kv.second.shellName) + "}";
    }
    self->reply(msg, out + "]}");
    return true;
}

bool PtyService::onGetShells(LSHandle *, LSMessage *msg, void *ctx)
{
    auto *self = static_cast<PtyService *>(ctx);
    std::string out = "{\"returnValue\":true,\"default\":" + jsonQuote(kDefaultShell) + ",\"shells\":[";
    bool first = true;
    for (const auto &name : shellNames()) {
        const std::string path = findShell(name);
        out += first ? "" : ",";
        first = false;
        out += "{\"name\":" + jsonQuote(name) + ",\"path\":" + jsonQuote(path) + ",\"installed\":" + (path.empty() ? "false" : "true") + "}";
    }
    self->reply(msg, out + "]}");
    return true;
}

bool PtyService::onExec(LSHandle *, LSMessage *msg, void *ctx)
{
    // MCP's os.shell.exec (docs/AI-AND-MCP.md) and root shells wait for
    // Developer Mode (docs/TERMINAL.md, phase T4).
    static_cast<PtyService *>(ctx)->replyError(msg, DevModeRequired,
        "Developer Mode is not available yet: exec, sudo and SSH are a follow-up (docs/TERMINAL.md, T4)");
    return true;
}

bool PtyService::onCancel(LSHandle *, LSMessage *msg, void *ctx)
{
    // The page cancelled its open subscription (the card went, or the page
    // reloaded): hang the shell up.
    auto *self = static_cast<PtyService *>(ctx);
    const char *token = LSMessageGetUniqueToken(msg);
    if (!token)
        return true;
    for (auto &kv : self->m_sessions) {
        if (kv.second.token == token) {
            self->remove(kv.first, SIGHUP);
            break;
        }
    }
    return true;
}

// ---- Output -------------------------------------------------------------------------

void PtyService::watch(Entry &e)
{
    if (e.watch || !e.session || e.session->eof())
        return;
    // One source per session; the id outlives it in the map (the watch is
    // removed before the entry is).
    auto *key = new std::string(e.id);
    e.watch = g_unix_fd_add_full(G_PRIORITY_DEFAULT, e.session->fd(),
                                 static_cast<GIOCondition>(G_IO_IN | G_IO_HUP | G_IO_ERR),
                                 &PtyService::readable, new std::pair<PtyService *, std::string *>(this, key),
                                 [](gpointer d) {
                                     auto *pair = static_cast<std::pair<PtyService *, std::string *> *>(d);
                                     delete pair->second;
                                     delete pair;
                                 });
}

void PtyService::unwatch(Entry &e)
{
    if (e.watch) {
        g_source_remove(e.watch);
        e.watch = 0;
    }
}

gboolean PtyService::readable(gint, GIOCondition, gpointer data)
{
    auto *pair = static_cast<std::pair<PtyService *, std::string *> *>(data);
    PtyService *self = pair->first;
    auto it = self->m_sessions.find(*pair->second);
    if (it == self->m_sessions.end())
        return G_SOURCE_REMOVE;
    Entry &e = it->second;
    e.session->readAvailable();
    self->scheduleFlush();
    if (!e.session->wantsRead()) {
        // Paused (flow control), holding a full chunk, or the shell is gone:
        // the flush or the next ack watches again.
        e.watch = 0;
        return G_SOURCE_REMOVE;
    }
    return G_SOURCE_CONTINUE;
}

void PtyService::scheduleFlush()
{
    if (!m_flushTimer)
        m_flushTimer = g_timeout_add(kFlushIntervalMs, &PtyService::flushTimeout, this);
}

gboolean PtyService::flushTimeout(gpointer data)
{
    auto *self = static_cast<PtyService *>(data);
    if (self->flush())
        return G_SOURCE_CONTINUE;
    self->m_flushTimer = 0;
    return G_SOURCE_REMOVE;
}

bool PtyService::flush()
{
    bool more = false;
    std::vector<std::string> ended;
    for (auto &kv : m_sessions) {
        Entry &e = kv.second;
        if (e.session->hasOutput()) {
            const Chunk c = e.session->takeChunk();
            if (c.bytes) {
                reply(e.subscription, "{\"returnValue\":true,\"sessionId\":" + jsonQuote(e.id) + ",\"output\":" + jsonQuote(c.text)
                      + (c.latin1 ? ",\"encoding\":\"latin1\"" : "") + ",\"bytes\":" + number(static_cast<double>(c.bytes)) + "}");
            }
        }
        if (e.session->hasOutput())
            more = true;
        else if (e.session->eof())
            ended.push_back(kv.first);
        if (!e.watch && e.session->wantsRead())
            watch(e);
    }
    for (const auto &id : ended) {
        auto it = m_sessions.find(id);
        if (it != m_sessions.end())
            finish(it->second);
    }
    return more;
}

void PtyService::finish(Entry &e)
{
    int code = 0, sig = 0;
    if (!e.session->reap(&code, &sig)) {
        // The PTY closed before the process was gone: look again shortly.
        if (!m_reapTimer)
            m_reapTimer = g_timeout_add(50, &PtyService::reapTimeout, this);
        return;
    }
    if (!e.exitedSent) {
        e.exitedSent = true;
        reply(e.subscription, "{\"returnValue\":true,\"sessionId\":" + jsonQuote(e.id) + ",\"exited\":true,\"exitCode\":"
              + std::to_string(code) + ",\"signal\":" + std::to_string(sig) + "}");
    }
    remove(e.id, 0);
}

gboolean PtyService::reapTimeout(gpointer data)
{
    auto *self = static_cast<PtyService *>(data);
    std::vector<std::string> ended;
    for (auto &kv : self->m_sessions)
        if (kv.second.session->eof() && !kv.second.session->hasOutput())
            ended.push_back(kv.first);
    self->m_reapTimer = 0;
    for (const auto &id : ended) {
        auto it = self->m_sessions.find(id);
        if (it != self->m_sessions.end())
            self->finish(it->second);
    }
    return G_SOURCE_REMOVE;
}

void PtyService::remove(const std::string &id, int signal)
{
    auto it = m_sessions.find(id);
    if (it == m_sessions.end())
        return;
    Entry &e = it->second;
    unwatch(e);
    if (signal && !e.session->reaped())
        e.session->hangup(signal);
    if (e.subscription)
        LSMessageUnref(e.subscription);
    logf("pty: session %s ended (%s)", id, e.owner);
    // ~Session reaps the shell (or kills it if it ignores SIGHUP).
    m_sessions.erase(it);
}

} // namespace pty
} // namespace phoenix
