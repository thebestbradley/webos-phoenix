// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Dictation (GAPS V2): the keyboard's microphone. start() records from the
// default microphone; stop() ends the recording, writes it as a 16 kHz mono
// WAV (what whisper.cpp reads) and runs the transcriber on it; transcribed()
// gives the text, or why there is none. A recording stops by itself after
// two minutes.
//
// The transcriber is a command, `command` with "%f" for the file. Its output
// is transcribe's reply as JSON: {text} or {errorText}. On a device that is
// the Luna service Voice Memos uses (org.webosphoenix.transcriber,
// whisper.cpp) through luna-send, the default; phoenix-sim runs the same
// service's code on the computer instead (node .../transcribe-cli.js %f).
//
// Recording needs Qt Multimedia; built without it, `available` is false and
// the keyboard shows no microphone.

#pragma once

#include <QByteArray>
#include <QObject>
#include <QStringList>
#include <QtQml/qqmlregistration.h>

class QAudioSource;
class QIODevice;
class QProcess;
class QTimer;

class Dictation : public QObject
{
    Q_OBJECT
    QML_ELEMENT
    Q_PROPERTY(bool available READ available CONSTANT)
    Q_PROPERTY(bool listening READ listening NOTIFY stateChanged)
    Q_PROPERTY(bool busy READ busy NOTIFY stateChanged)
    Q_PROPERTY(QStringList command READ command WRITE setCommand NOTIFY commandChanged)
    Q_PROPERTY(QString language READ language WRITE setLanguage NOTIFY languageChanged)

public:
    explicit Dictation(QObject *parent = nullptr);
    ~Dictation() override;

    bool available() const;
    bool listening() const { return m_listening; }
    bool busy() const { return m_busy; }
    QStringList command() const { return m_command; }
    void setCommand(const QStringList &c);
    QString language() const { return m_language; }
    void setLanguage(const QString &l);

    Q_INVOKABLE void start();
    Q_INVOKABLE void stop();
    Q_INVOKABLE void cancel();
    // Transcribes a recording made elsewhere (16 kHz WAV), as stop() does
    // its own; the file is left where it is (tests).
    Q_INVOKABLE void transcribeFile(const QString &file);

    // For tests: the WAV file the samples make (16-bit mono PCM at `rate`).
    static QByteArray wav(const QByteArray &pcm16, int rate);
    // transcribe's reply -> {text, error}.
    static QPair<QString, QString> parseReply(const QByteArray &out, int exitCode);
    // Interleaved samples (any channel count and rate, 16-bit or float) to
    // 16 kHz mono 16-bit.
    static QByteArray toWhisperPcm(const QByteArray &in, int channels, int rate, bool isFloat);

signals:
    void stateChanged();
    void commandChanged();
    void languageChanged();
    void transcribed(const QString &text, const QString &error);

private:
    void finishRecording(bool transcribe);
    void runTranscriber(const QString &file, bool removeAfter);

    QStringList m_command;
    QString m_language;
    bool m_listening = false;
    bool m_busy = false;
    QByteArray m_pcm;            // as recorded (m_channels, m_rate, m_float)
    int m_channels = 1;
    int m_rate = 16000;
    bool m_float = false;
    QAudioSource *m_source = nullptr;
    QIODevice *m_io = nullptr;
    QProcess *m_process = nullptr;
    QTimer *m_limit = nullptr;
};
