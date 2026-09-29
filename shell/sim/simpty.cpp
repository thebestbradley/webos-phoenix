// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0

#include "simpty.h"

#include <QDir>

#include <csignal>

using namespace phoenix::pty;

namespace {

std::string idJson(const QString &id)
{
    return jsonQuote(id.toStdString());
}

int signalNamed(const QString &name)
{
    if (name.isEmpty() || name == QLatin1String("SIGHUP")) return SIGHUP;
    if (name == QLatin1String("SIGTERM")) return SIGTERM;
    if (name == QLatin1String("SIGKILL")) return SIGKILL;
    if (name == QLatin1String("SIGINT")) return SIGINT;
    return 0;
}

} // namespace

SimPty::SimPty(QObject *parent) : QObject(parent)
{
    m_flush.setInterval(kFlushIntervalMs);
    connect(&m_flush, &QTimer::timeout, this, &SimPty::flush);
    m_reap.setInterval(50);
    connect(&m_reap, &QTimer::timeout, this, [this]() {
        const QStringList keys = m_sessions.keys();
        for (const QString &k : keys)
            if (m_sessions.contains(k) && m_sessions[k]->session->eof() && !m_sessions[k]->session->hasOutput())
                finish(k);
        bool any = false;
        for (Entry *e : std::as_const(m_sessions))
            any = any || e->session->eof();
        if (!any)
            m_reap.stop();
    });
}

SimPty::~SimPty()
{
    const QStringList keys = m_sessions.keys();
    for (const QString &k : keys)
        remove(k, SIGHUP);
}

void SimPty::send(const QString &window, const QString &id, const std::string &replyJson)
{
    emit event(window, QString::fromStdString("{\"id\":" + idJson(id) + ",\"reply\":" + replyJson + "}"));
}

void SimPty::sendError(const QString &window, const QString &id, int code, const QString &text)
{
    send(window, id, "{\"returnValue\":false,\"errorCode\":" + std::to_string(code) + ",\"errorText\":"
                     + jsonQuote(text.toStdString()) + "}");
}

void SimPty::request(const QString &windowUid, const QString &appId, const QVariantMap &p)
{
    const QString op = p.value(QStringLiteral("op")).toString();
    const QString id = p.value(QStringLiteral("id")).toString();
    // The app id comes from the shell's own record of the window, not the page.
    if (!mayOpenShells(appId.toStdString())) {
        qWarning("phoenix-sim: %s may not open a shell", qPrintable(appId));
        sendError(windowUid, id, NotAllowed, QStringLiteral("Only the Terminal app may open a shell"));
        return;
    }
    if (op == QLatin1String("open")) {
        open(windowUid, id, p);
        return;
    }
    if (op == QLatin1String("shells")) {
        std::string out = "{\"returnValue\":true,\"default\":" + jsonQuote(kDefaultShell) + ",\"host\":true,\"shells\":[";
        bool first = true;
        for (const auto &name : shellNames()) {
            const std::string path = findShell(name);
            out += first ? "" : ",";
            first = false;
            out += "{\"name\":" + jsonQuote(name) + ",\"path\":" + jsonQuote(path) + ",\"installed\":" + (path.empty() ? "false" : "true") + "}";
        }
        send(windowUid, id, out + "]}");
        return;
    }
    Entry *e = m_sessions.value(keyOf(windowUid, id));
    if (!e)
        return;   // gone already: the page learnt from its exited reply
    if (op == QLatin1String("write")) {
        e->session->write(p.value(QStringLiteral("data")).toString().toStdString());
    } else if (op == QLatin1String("resize")) {
        e->session->resize(p.value(QStringLiteral("cols")).toInt(), p.value(QStringLiteral("rows")).toInt());
    } else if (op == QLatin1String("ack")) {
        e->session->ack(static_cast<size_t>(p.value(QStringLiteral("bytes")).toDouble()));
        if (e->session->wantsRead())
            e->notifier->setEnabled(true);
    } else if (op == QLatin1String("close")) {
        const int sig = signalNamed(p.value(QStringLiteral("signal")).toString());
        e->session->hangup(sig ? sig : SIGHUP);
        // With "cancel" the page is gone and wants no exited reply.
        if (p.value(QStringLiteral("cancel")).toBool())
            remove(keyOf(windowUid, id), SIGHUP);
    }
}

void SimPty::open(const QString &window, const QString &id, const QVariantMap &p)
{
    const QString key = keyOf(window, id);
    if (id.isEmpty() || m_sessions.contains(key)) {
        sendError(window, id, BadParams, QStringLiteral("Bad session id"));
        return;
    }
    int mine = 0;
    for (Entry *e : std::as_const(m_sessions))
        mine += e->window == window;
    if (mine >= kMaxSessionsPerApp) {
        sendError(window, id, TooMany, QStringLiteral("Too many sessions"));
        return;
    }
    QString shellName = p.value(QStringLiteral("shell")).toString();
    if (shellName.isEmpty())
        shellName = QString::fromLatin1(kDefaultShell);
    SpawnOptions opts;
    if (!m_override.isEmpty()) {
        opts.shellPath = m_override.toStdString();
        opts.args = { };
    } else {
        opts.shellPath = findShell(shellName.toStdString());
        if (opts.shellPath.empty()) {
            sendError(window, id, NoShell, QStringLiteral("Shell not installed on this computer: ") + shellName);
            return;
        }
    }
    opts.cols = p.value(QStringLiteral("cols"), 80).toInt();
    opts.rows = p.value(QStringLiteral("rows"), 24).toInt();
    opts.cwd = QDir::homePath().toStdString();
    // Your own shell on your own computer: your environment.
    opts.inheritEnv = true;
    opts.env = { { "PHOENIX_SIM", "1" } };

    auto *e = new Entry;
    e->window = window;
    e->id = id;
    e->shellName = shellName;
    e->session = std::make_unique<Session>();
    std::string error;
    if (!e->session->spawn(opts, &error)) {
        delete e;
        sendError(window, id, SpawnFailed, QString::fromStdString(error));
        return;
    }
    m_sessions.insert(key, e);
    e->notifier = std::make_unique<QSocketNotifier>(e->session->fd(), QSocketNotifier::Read);
    connect(e->notifier.get(), &QSocketNotifier::activated, this, [this, key]() {
        Entry *x = m_sessions.value(key);
        if (!x)
            return;
        x->session->readAvailable();
        if (!x->session->wantsRead())
            x->notifier->setEnabled(false);   // flow control, a full chunk, or the end
        if (!m_flush.isActive())
            m_flush.start();
    });
    qInfo("phoenix-sim: terminal session %s: %s (pid %d) on this computer", qPrintable(key),
          e->session->shellPath().c_str(), int(e->session->pid()));
    send(window, id, "{\"returnValue\":true,\"subscribed\":true,\"sessionId\":" + idJson(id) + ",\"pid\":"
                     + std::to_string(e->session->pid()) + ",\"shell\":" + jsonQuote(shellName.toStdString())
                     + ",\"shellPath\":" + jsonQuote(e->session->shellPath()) + ",\"host\":true}");
}

void SimPty::flush()
{
    bool more = false;
    QStringList ended;
    for (auto it = m_sessions.begin(); it != m_sessions.end(); ++it) {
        Entry *e = it.value();
        if (e->session->hasOutput()) {
            const Chunk c = e->session->takeChunk();
            if (c.bytes)
                send(e->window, e->id, "{\"returnValue\":true,\"sessionId\":" + idJson(e->id) + ",\"output\":" + jsonQuote(c.text)
                                       + (c.latin1 ? ",\"encoding\":\"latin1\"" : "") + ",\"bytes\":" + std::to_string(c.bytes) + "}");
        }
        if (e->session->hasOutput())
            more = true;
        else if (e->session->eof())
            ended << it.key();
        if (e->session->wantsRead() && !e->notifier->isEnabled())
            e->notifier->setEnabled(true);
    }
    for (const QString &k : ended)
        finish(k);
    if (!more)
        m_flush.stop();
}

void SimPty::finish(const QString &key)
{
    Entry *e = m_sessions.value(key);
    if (!e)
        return;
    int code = 0, sig = 0;
    if (!e->session->reap(&code, &sig)) {
        if (!m_reap.isActive())
            m_reap.start();
        return;
    }
    send(e->window, e->id, "{\"returnValue\":true,\"sessionId\":" + idJson(e->id) + ",\"exited\":true,\"exitCode\":"
                           + std::to_string(code) + ",\"signal\":" + std::to_string(sig) + "}");
    remove(key, 0);
}

void SimPty::remove(const QString &key, int signal)
{
    Entry *e = m_sessions.take(key);
    if (!e)
        return;
    e->notifier.reset();
    if (signal && !e->session->reaped())
        e->session->hangup(signal);
    delete e;   // ~Session collects the process
}

void SimPty::closeWindow(const QString &windowUid)
{
    const QStringList keys = m_sessions.keys();
    for (const QString &k : keys)
        if (m_sessions[k]->window == windowUid)
            remove(k, SIGHUP);
}
