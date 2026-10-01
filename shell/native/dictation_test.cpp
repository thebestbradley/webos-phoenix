// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Dictation's recording format and the transcriber's replies, without a
// microphone (CI: build/dictation-test).

#include "dictation.h"

#include <QCoreApplication>
#include <QtEndian>
#include <cmath>
#include <cstdio>
#include <cstring>

static int failures = 0;
static void check(bool ok, const char *what)
{
    std::printf("%s %s\n", ok ? "ok  " : "FAIL", what);
    if (!ok)
        ++failures;
}

int main(int argc, char **argv)
{
    QCoreApplication app(argc, argv);

    // A 16 kHz mono WAV header around the samples.
    QByteArray pcm(3200, 0);
    const QByteArray w = Dictation::wav(pcm, 16000);
    check(w.size() == 44 + 3200 && w.startsWith("RIFF") && w.mid(8, 8) == "WAVEfmt ", "a WAV file");
    check(qFromLittleEndian<quint32>(w.constData() + 24) == 16000 && qFromLittleEndian<quint16>(w.constData() + 22) == 1
          && qFromLittleEndian<quint16>(w.constData() + 34) == 16, "16 kHz, mono, 16-bit");
    check(qFromLittleEndian<quint32>(w.constData() + 40) == 3200 && qFromLittleEndian<quint32>(w.constData() + 4) == 36 + 3200,
          "its sizes");

    // 48 kHz stereo float (a laptop microphone) to 16 kHz mono 16-bit.
    const int frames = 4800;
    QByteArray f(frames * 2 * 4, 0);
    for (int i = 0; i < frames; ++i) {
        const float v = 0.5f * std::sin(2 * M_PI * 440 * i / 48000.0);
        std::memcpy(f.data() + (i * 2) * 4, &v, 4);
        std::memcpy(f.data() + (i * 2 + 1) * 4, &v, 4);
    }
    const QByteArray out = Dictation::toWhisperPcm(f, 2, 48000, true);
    check(out.size() == 1600 * 2, "a tenth of a second at 16 kHz");
    int peak = 0;
    for (int i = 0; i < 1600; ++i)
        peak = qMax(peak, qAbs(int(qFromLittleEndian<qint16>(out.constData() + i * 2))));
    check(peak > 15000 && peak < 17000, "the level kept (half of full scale)");
    // Already 16 kHz mono 16-bit: as it is.
    check(Dictation::toWhisperPcm(pcm, 1, 16000, false) == pcm, "16 kHz mono 16-bit unchanged");

    // The transcriber's reply.
    auto r = Dictation::parseReply("{\"returnValue\":true,\"text\":\" Hello there. \",\"state\":\"done\"}\n", 0);
    check(r.first == QStringLiteral("Hello there.") && r.second.isEmpty(), "a transcript");
    r = Dictation::parseReply("{\"returnValue\":false,\"errorCode\":2,\"errorText\":\"Speech recognition is not installed\"}", 1);
    check(r.first.isEmpty() && r.second == QStringLiteral("Speech recognition is not installed"), "an error");
    r = Dictation::parseReply("garbage", 1);
    check(r.first.isEmpty() && !r.second.isEmpty(), "no reply");

    std::printf(failures ? "%d failed\n" : "all passed\n", failures);
    return failures ? 1 : 0;
}
