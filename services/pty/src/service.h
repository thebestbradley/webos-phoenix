// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// org.webosphoenix.pty: the Terminal's shells on the Luna bus (luna-service2
// and a GLib main loop). Methods (docs/TERMINAL.md; the page's client is
// apps/shared/luna/src/pty.ts):
//
//   open {cols, rows, shell?, cwd?, subscribe: true}
//        -> {subscribed: true, sessionId, pid, shell, shellPath}
//        -> {sessionId, output, encoding?: "latin1", bytes}   (as the shell writes)
//        -> {sessionId, exited: true, exitCode, signal}       (then the subscription ends)
//        Cancelling the subscription hangs the shell up (SIGHUP), as closing
//        a terminal window does.
//   write  {sessionId, data}
//   resize {sessionId, cols, rows}
//   ack    {sessionId, bytes}          flow control: the page drew this much
//   close  {sessionId, signal?}        "SIGHUP" (default), "SIGTERM", "SIGKILL", "SIGINT"
//   list   {}  -> {sessions: [{sessionId, pid, shell}]}   the caller's own
//   getShells {} -> {shells: [{name, path, installed}], default}
//   exec   {}  -> error DevModeRequired: Developer Mode is a follow-up (T4)
//
// Only org.webosphoenix.terminal may call open (the caller's application id
// on the message); a session belongs to the app that opened it. The
// service runs as the device's unprivileged user (systemd User=), so every
// shell it starts is that user's.

#pragma once

#include <glib.h>
#include <luna-service2/lunaservice.h>

#include <map>
#include <memory>
#include <string>

#include "ptycore.h"

namespace phoenix {
namespace pty {

class PtyService
{
public:
    explicit PtyService(LSHandle *handle);
    ~PtyService();

    // Register the methods on the handle's "/" category.
    bool attach(LSError *error);

    size_t sessionCount() const { return m_sessions.size(); }

    static bool onOpen(LSHandle *sh, LSMessage *msg, void *ctx);
    static bool onWrite(LSHandle *sh, LSMessage *msg, void *ctx);
    static bool onResize(LSHandle *sh, LSMessage *msg, void *ctx);
    static bool onAck(LSHandle *sh, LSMessage *msg, void *ctx);
    static bool onClose(LSHandle *sh, LSMessage *msg, void *ctx);
    static bool onList(LSHandle *sh, LSMessage *msg, void *ctx);
    static bool onGetShells(LSHandle *sh, LSMessage *msg, void *ctx);
    static bool onExec(LSHandle *sh, LSMessage *msg, void *ctx);
    static bool onCancel(LSHandle *sh, LSMessage *msg, void *ctx);

private:
    struct Entry
    {
        std::string id;
        std::string owner;          // app id that opened it
        std::string shellName;
        LSMessage *subscription = nullptr;
        std::string token;          // the subscription's unique token
        std::unique_ptr<Session> session;
        guint watch = 0;            // fd watch while reading
        bool exitedSent = false;
    };

    static std::string callerOf(LSMessage *msg);
    void reply(LSMessage *msg, const std::string &json);
    void replyError(LSMessage *msg, int code, const std::string &text);
    Entry *find(LSMessage *msg, const Json &params, bool *replied);

    void watch(Entry &e);
    void unwatch(Entry &e);
    void scheduleFlush();
    bool flush();                   // false: nothing left to send
    void finish(Entry &e);          // the shell is gone: exited reply, forget it
    void remove(const std::string &id, int signal);

    static gboolean readable(gint fd, GIOCondition cond, gpointer data);
    static gboolean flushTimeout(gpointer data);
    static gboolean reapTimeout(gpointer data);

    LSHandle *m_handle;
    std::map<std::string, Entry> m_sessions;
    guint m_flushTimer = 0;
    guint m_reapTimer = 0;
    unsigned m_nextId = 1;
};

} // namespace pty
} // namespace phoenix
