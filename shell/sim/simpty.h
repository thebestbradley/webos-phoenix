// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// phoenix-sim's org.webosphoenix.pty: real shells on this machine for the
// Terminal app, with the device service's PTY core (services/pty/src/
// ptycore.cpp) on Qt's event loop instead of GLib's.
//
// The page's runtime (runtime/phoenix-runtime.js, block "Terminal") posts
// "pty" host messages ({op: "open" | "write" | "resize" | "ack" | "close" |
// "shells", id, ...}); SimWindowSource hands them to request() with the id
// of the window and the app that sent them, which the shell knows, not the
// page. Replies come back through event(), which SimWindowSource runs in
// that window as __phoenixRuntime.ptyEvent(...). Only the Terminal's
// windows get a shell; a window's shells are hung up when it closes.
//
// This is YOUR shell on YOUR computer, in your home directory, with your
// environment: phoenix-sim --no-host-shell turns it off (the Terminal then
// gets the runtime's simulated shell).

#pragma once

#include <QHash>
#include <QObject>
#include <QSocketNotifier>
#include <QString>
#include <QTimer>
#include <QVariantMap>

#include <memory>

#include "ptycore.h"

class SimPty : public QObject
{
    Q_OBJECT
public:
    explicit SimPty(QObject *parent = nullptr);
    ~SimPty() override;

    // A program to run instead of the shell the page names (phoenix-sim
    // --host-shell PATH), e.g. for a fixed demo.
    void setShellOverride(const QString &path) { m_override = path; }

    // A "pty" host message from a page.
    Q_INVOKABLE void request(const QString &windowUid, const QString &appId, const QVariantMap &payload);
    // The window went (its card was thrown away): hang up its shells.
    Q_INVOKABLE void closeWindow(const QString &windowUid);
    Q_INVOKABLE int sessionCount() const { return m_sessions.size(); }

signals:
    // Deliver to the page in windowUid: __phoenixRuntime.ptyEvent(json).
    void event(const QString &windowUid, const QString &json);

private:
    struct Entry
    {
        QString window;
        QString id;           // the page's id for it
        QString shellName;
        std::unique_ptr<phoenix::pty::Session> session;
        std::unique_ptr<QSocketNotifier> notifier;
    };

    void send(const QString &window, const QString &id, const std::string &replyJson);
    void sendError(const QString &window, const QString &id, int code, const QString &text);
    void open(const QString &window, const QString &id, const QVariantMap &p);
    void flush();
    void finish(const QString &key);
    void remove(const QString &key, int signal);
    static QString keyOf(const QString &window, const QString &id) { return window + QLatin1Char('/') + id; }

    QHash<QString, Entry *> m_sessions;
    QTimer m_flush;
    QTimer m_reap;
    QString m_override;
};
