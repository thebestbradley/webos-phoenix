// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Text to speech for the Assistant's answers (docs/M6-PLAN.md F3)
// and org.webosphoenix.tts: a speech program run with the text on its
// standard input, one utterance at a time (a new one stops the last).
//
// command: the program and its arguments, "%l" for the language ("en"),
// "%v" for the voice; empty for the default: Kitten TTS (phoenix-tts,
// services/tts: KittenML's nano model on ONNX Runtime, Apache-2.0 and MIT)
// for English where it and its model are installed (beside the program, or
// on the PATH: the device's /usr/bin), else as before Kitten: espeak-ng
// (-v %l --stdin, GPL-3.0, run as a program of its own, not linked) where
// it is installed, else macOS's say, else Flite (BSD-3-Clause; meta-
// phoenix's image ships it). When phoenix-tts cannot speak after all (it
// exits with 3 or 4: no ONNX Runtime, no sound output) the same words go to
// that fallback. Piper or another engine is a command of its own
// (phoenix-sim --speech-command). Neither Qt's TextToSpeech module (not in
// the Qt installs Phoenix builds with) nor QtWebEngine's speechSynthesis (no
// voices without speech-dispatcher) speak here; see docs/AI-AND-MCP.md.
//
// voice: Kitten's voice (expr-voice-3-f, ...; Settings > Assistant >
// Voice), "" for its default; voices: the ones it has.

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
    Q_PROPERTY(QString voice READ voice WRITE setVoice NOTIFY voiceChanged)
    Q_PROPERTY(QStringList voices READ voices NOTIFY commandChanged)

public:
    explicit Speech(QObject *parent = nullptr);
    ~Speech() override;

    QStringList command() const { return m_command; }
    void setCommand(const QStringList &c);
    bool available() const { return !resolved().isEmpty(); }
    QString engine() const;
    bool speaking() const { return m_process != nullptr; }
    QString voice() const { return m_voice; }
    void setVoice(const QString &v);
    QStringList voices() const;

    // voice: this one instead of the voice property ("" for it).
    Q_INVOKABLE bool speak(const QString &text, const QString &lang = QStringLiteral("en"),
                           const QString &voice = QString());
    Q_INVOKABLE void stop();

    // phoenix-tts beside the program or on the PATH ("" when not there), and
    // what its --check says (the voices; nothing when it cannot speak).
    static QString kittenProgram();

signals:
    void commandChanged();
    void speakingChanged();
    void voiceChanged();
    void finished();

private:
    QStringList resolved(const QString &lang = QStringLiteral("en")) const;
    QStringList fallback() const;
    bool kittenReady() const;
    bool run(const QStringList &command, const QString &text, const QString &lang, const QString &voice);

    QStringList m_command;
    QString m_voice;
    QProcess *m_process = nullptr;
    mutable int m_kitten = -1;  // -1 not checked yet, 0 cannot speak, 1 can
    mutable QStringList m_kittenVoices;
};
