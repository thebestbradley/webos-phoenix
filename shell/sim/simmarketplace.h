// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The Phoenix Marketplace's catalog service on this computer, started with
// the simulator (--marketplace): server/marketplace/bin/serve.sh, which
// sets the catalog up the first time (its database, signing key, curated
// web apps and a first publish) and serves it at http://127.0.0.1:8088/,
// where the simulator's Marketplace looks
// (apps/marketplace/service/etc/palm/marketplace/sources.json). One that
// is already running is used as it is; one started here stops with the
// simulator. Its log is server/marketplace/data/simulator.log.

#pragma once

#include <QProcess>
#include <QString>

class SimMarketplace
{
public:
    // Where the simulator's Marketplace reads the catalog (sources.json).
    static constexpr quint16 defaultPort = 8088;

    explicit SimMarketplace(const QString &repoDir, quint16 port = defaultPort);
    ~SimMarketplace();

    // Starts the service, or finds it running, and waits until it answers
    // (the first time it sets itself up first). False with error() when it
    // cannot: no PHP, or the service failed (its log says why).
    bool start(int timeoutMs = 60000);
    QString error() const { return m_error; }
    QString url() const;
    QString logFile() const;
    // True when this simulator started it (and will stop it).
    bool ownsServer() const { return m_process.state() != QProcess::NotRunning; }

private:
    bool answers(int timeoutMs) const;

    QString m_dir;      // server/marketplace
    quint16 m_port;
    QProcess m_process;
    QString m_error;
};
