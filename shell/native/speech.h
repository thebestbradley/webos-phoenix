// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Text to speech for the Assistant's answers (docs/M6-PLAN.md F3)
// and org.webosphoenix.tts: a speech program run with the text on its
// standard input, one utterance at a time (a new one stops the last).
//
// command: the program and its arguments, "%l" for the language ("en");
// empty for the default: espeak-ng (-v %l --stdin, GPL-3.0, run as a
// program of its own, not linked) where it is installed, else macOS's say,
// else Flite (BSD-3-Clause; meta-phoenix's image ships it).
// Piper or another engine is a command of its own (phoenix-sim
// --speech-command). Neither Qt's TextToSpeech module (not in the Qt
// installs Phoenix builds with) nor QtWebEngine's speechSynthesis (no
// voices without speech-dispatcher) speak here; see docs/AI-AND-MCP.md.

#pragma once

#include <QObject>
#include <QStringList>
#include <QtQml/qqmlregistration.h>

class QProcess;

class Speech : public QObject
{
    Q_OBJECT
    QML_ELEMENT
    Q_PROPERTY(QStringList command READ command WRITE setCommand NOTIFY commandChanged)
    Q_PROPERTY(bool available READ available NOTIFY commandChanged)
    Q_PROPERTY(QString engine READ engine NOTIFY commandChanged)
    Q_PROPERTY(bool speaking READ speaking NOTIFY speakingChanged)

public:
    explicit Speech(QObject *parent = nullptr);
    ~Speech() override;

    QStringList command() const { return m_command; }
    void setCommand(const QStringList &c);
    bool available() const { return !resolved().isEmpty(); }
    QString engine() const;
    bool speaking() const { return m_process != nullptr; }

    Q_INVOKABLE bool speak(const QString &text, const QString &lang = QStringLiteral("en"));
    Q_INVOKABLE void stop();

signals:
    void commandChanged();
    void speakingChanged();
    void finished();

private:
    QStringList resolved() const;

    QStringList m_command;
    QProcess *m_process = nullptr;
};
