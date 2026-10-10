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
//
// For Voice Dial (and other listeners that are not typing):
//   prompt     words to expect, passed to the transcriber (%p in the
//              command; whisper's initial prompt), e.g. the contacts' names
//   autoStop   the recording ends by itself once something was said and it
//              has been quiet for a second (EndOfSpeech), or with "Nothing
//              was heard." when nothing was said for 7 seconds
//   owner      who the recording is for: "" the keyboard, else the window
//              of the app that asked (the window source sets it), so each
//              takes only its own transcriptions
//   loudness   while it listens, how loud the microphone is, 0 (-50 dBFS
//              and quieter) to 1 (-10 dBFS and louder), for each stretch
//              of the recording (the Assistant's bird follows it); 0 when
//              not listening
//   inputFiles WAV files played as the microphone instead of the real one
//              (phoenix-sim --microphone-file), one per recording in turn
//              (the last one again after that), each followed by quiet; for
//              testing on computers without a microphone
//
// The assistant's wake word ("Hey Phoenix"; docs/AI-AND-MCP.md, Voice):
//   wakeCommand  the spotter, services/wakeword's phoenix-wakeword with its
//                model; it reads the microphone (16 kHz mono 16-bit) on its
//                input and writes a JSON line each time it hears the phrase
//   wakeWord     the spotter runs (its model loaded), ready to stand by
//   standby      listen for it now: the microphone stays open between
//                recordings and goes to the spotter, nowhere else (nothing
//                is kept but the last few seconds, in memory)
//   standingBy   the microphone is open for it (the status bar's subtle
//                microphone)
//   wakeHeard()  it was heard. A start() from its handler records on from
//                the start of the phrase, so "Hey Phoenix, set a timer" in
//                one breath keeps "set a timer" (the listener drops the
//                phrase from the transcript). With inputFiles, standing by
//                plays the next file not yet played (else quiet), and a
//                recording that follows the wake word goes on in the same
//                file; hear(file) plays a WAV into the microphone now (the
//                simulator's "Say 'Hey Phoenix'")

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
    Q_PROPERTY(QString prompt READ prompt WRITE setPrompt NOTIFY promptChanged)
    Q_PROPERTY(bool autoStop READ autoStop WRITE setAutoStop NOTIFY autoStopChanged)
    Q_PROPERTY(QStringList inputFiles READ inputFiles WRITE setInputFiles NOTIFY inputFilesChanged)
    Q_PROPERTY(QString owner READ owner WRITE setOwner NOTIFY ownerChanged)
    Q_PROPERTY(qreal loudness READ loudness NOTIFY loudnessChanged)
    Q_PROPERTY(QStringList wakeCommand READ wakeCommand WRITE setWakeCommand NOTIFY wakeCommandChanged)
    Q_PROPERTY(bool wakeAvailable READ wakeAvailable NOTIFY wakeCommandChanged)
    Q_PROPERTY(bool wakeWord READ wakeWord WRITE setWakeWord NOTIFY wakeWordChanged)
    Q_PROPERTY(bool standby READ standby WRITE setStandby NOTIFY standbyChanged)
    Q_PROPERTY(bool standingBy READ standingBy NOTIFY stateChanged)
    Q_PROPERTY(QString wakeError READ wakeError NOTIFY wakeErrorChanged)

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
    QString prompt() const { return m_prompt; }
    void setPrompt(const QString &p);
    bool autoStop() const { return m_autoStop; }
    void setAutoStop(bool a);
    QStringList inputFiles() const { return m_inputFiles; }
    void setInputFiles(const QStringList &f);
    QString owner() const { return m_owner; }
    void setOwner(const QString &o) { if (o != m_owner) { m_owner = o; emit ownerChanged(); } }
    qreal loudness() const { return m_loudness; }
    QStringList wakeCommand() const { return m_wakeCommand; }
    void setWakeCommand(const QStringList &c);
    bool wakeAvailable() const { return !m_wakeCommand.isEmpty() && (available() || !m_inputFiles.isEmpty()); }
    bool wakeWord() const { return m_wakeWord; }
    void setWakeWord(bool w);
    bool standby() const { return m_standby; }
    void setStandby(bool s);
    bool standingBy() const { return m_capturing && !m_listening && standbyWanted(); }
    QString wakeError() const { return m_wakeError; }

    // Plays a WAV file into the microphone from now (over it), while it is
    // open; false when it is not, or the file is not a WAV recording.
    Q_INVOKABLE bool hear(const QString &file);

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
    // The loudness of a stretch of samples: RMS, 0..1.
    static double level(const QByteArray &in, int channels, bool isFloat);
    // A level (RMS) as loudness: -50 dBFS and under 0, -10 dBFS and over 1,
    // even steps of decibels between.
    static double loudnessOf(double level);
    // The transcriber's command line for a file: %f the file, %l the
    // language, %p the prompt; in an argument that is JSON (luna-send's
    // payload) the values are JSON-escaped.
    static QStringList commandLine(const QStringList &command, const QString &file, const QString &language,
                                   const QString &prompt);
    // A WAV file's samples: {pcm, channels, rate, isFloat}; ok false if it
    // is not 16-bit or float PCM.
    struct Wav { QByteArray pcm; int channels = 1; int rate = 16000; bool isFloat = false; bool ok = false; };
    static Wav readWav(const QByteArray &file);

    // When the speaker has finished: fed the level of each stretch of the
    // recording, says Ended after speech followed by a second of quiet, and
    // NothingHeard after 7 seconds without speech.
    struct EndOfSpeech {
        enum Result { Going, Ended, NothingHeard };
        int speechMs = 0;
        int quietMs = 0;
        int totalMs = 0;
        Result feed(double level, int ms);
    };

signals:
    void stateChanged();
    void commandChanged();
    void languageChanged();
    void promptChanged();
    void autoStopChanged();
    void inputFilesChanged();
    void ownerChanged();
    void loudnessChanged();
    void wakeCommandChanged();
    void wakeWordChanged();
    void standbyChanged();
    void wakeErrorChanged();
    void wakeHeard(const QString &heard);
    void transcribed(const QString &text, const QString &error);

private:
    bool openCapture(bool standby, QString *error);
    bool loadFile(QString *error);
    void closeCapture();
    void updateStandby();
    bool standbyWanted() const { return m_wakeWord && m_standby && wakeAvailable() && m_wakeError.isEmpty(); }
    void startSpotter();
    void stopSpotter();
    void spotterOutput();
    void setWakeError(const QString &e);
    void finishRecording(bool transcribe);
    void runTranscriber(const QString &file, bool removeAfter);
    void recorded(const QByteArray &chunk);
    void setLoudness(qreal l);

    QStringList m_command;
    QString m_language;
    QString m_prompt;
    bool m_autoStop = false;
    QStringList m_inputFiles;
    int m_nextInput = 0;
    QString m_owner;
    qreal m_loudness = 0;
    EndOfSpeech m_end;
    QTimer *m_fileTimer = nullptr;   // inputFiles: plays one as the microphone
    Wav m_fileWav;
    qsizetype m_filePos = 0;
    bool m_listening = false;
    bool m_busy = false;
    QByteArray m_pcm;            // the recording, 16 kHz mono 16-bit
    bool m_capturing = false;    // the microphone (or file) is open
    bool m_fileDone = true;      // the file being played has ended (quiet follows)
    QByteArray m_inject;         // hear(): 16 kHz mono 16-bit, mixed in
    QStringList m_wakeCommand;
    bool m_wakeWord = false;
    bool m_standby = false;
    QString m_wakeError;
    QProcess *m_spotter = nullptr;
    QByteArray m_spotterLine;
    qint64 m_spotterFed = 0;     // samples written to the spotter (its clock)
    QByteArray m_ring;           // the last seconds it was given
    qint64 m_ringStart = 0;      // the sample (its clock) at m_ring's start
    QByteArray m_preroll;        // after the phrase, for a start() in wakeHeard
    qsizetype m_prerollPhraseEnd = 0;   // bytes: where the phrase ends in m_preroll
    bool m_inWake = false;
    int m_channels = 1;
    int m_rate = 16000;
    bool m_float = false;
    QAudioSource *m_source = nullptr;
    QIODevice *m_io = nullptr;
    QProcess *m_process = nullptr;
    QTimer *m_limit = nullptr;
};
