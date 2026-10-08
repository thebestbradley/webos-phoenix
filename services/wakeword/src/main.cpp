// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// phoenix-wakeword: listens for the assistant's wake word (wakeword.h) in
// 16 kHz mono 16-bit audio on its standard input, or in WAV files, and
// writes a JSON line for each time it is heard:
//
//   {"ready":true}                                   the model is loaded
//   {"wake":"hey phoenix","start":1.52,"end":2.31,"score":0.97,"heard":"hey phoenix"}
//   {"error":"..."}                                  and exits with 1
//
// start and end are seconds from the start of the audio (of each file). The
// shell's Dictation runs it while it listens for the wake word and pipes
// the microphone to it (shell/native/dictation.cpp); tests and the
// measurements in docs/AI-AND-MCP.md run it on files.
//
//   phoenix-wakeword --model DIR [--vosk LIB] [--phrase "hey phoenix"]
//                    [--no-check] [--stats] [FILE.wav ...]
//
// --stats writes, at the end, what the gate passed and the CPU time used:
// {"stats":{"seconds":..,"decodedSeconds":..,"cpuSeconds":..,"candidates":..,"rejected":..}}

#include "json.h"
#include "wakeword.h"

#include <cstdio>
#include <cstring>
#include <ctime>
#include <fstream>
#include <iterator>
#include <string>
#include <vector>

using namespace phoenix;

namespace {

void print(const WakeDetection &d, const std::string &phrase, const std::string &file)
{
    std::printf("{\"wake\":%s,\"start\":%.2f,\"end\":%.2f,\"score\":%.3f,\"heard\":%s%s%s}\n", jsonQuote(phrase).c_str(),
                d.start, d.end, d.score, jsonQuote(d.heard).c_str(), d.accepted ? "" : ",\"rejected\":true",
                file.empty() ? "" : (",\"file\":" + jsonQuote(file)).c_str());
    std::fflush(stdout);
}

uint32_t le32(const unsigned char *p) { return p[0] | p[1] << 8 | p[2] << 16 | uint32_t(p[3]) << 24; }
uint16_t le16(const unsigned char *p) { return uint16_t(p[0] | p[1] << 8); }

// A 16 kHz mono 16-bit WAV file's samples.
bool readWav(const std::string &name, std::vector<int16_t> *out, std::string *error)
{
    std::ifstream in(name, std::ios::binary);
    const std::vector<unsigned char> d((std::istreambuf_iterator<char>(in)), std::istreambuf_iterator<char>());
    if (d.size() < 12 || std::memcmp(d.data(), "RIFF", 4) || std::memcmp(d.data() + 8, "WAVE", 4)) {
        *error = name + " is not a WAV file";
        return false;
    }
    bool fmtOk = false;
    for (size_t pos = 12; pos + 8 <= d.size();) {
        const uint32_t len = le32(&d[pos + 4]);
        const size_t body = pos + 8;
        if (!std::memcmp(&d[pos], "fmt ", 4) && body + 16 <= d.size())
            fmtOk = le16(&d[body]) == 1 && le16(&d[body + 2]) == 1 && le32(&d[body + 4]) == 16000 && le16(&d[body + 14]) == 16;
        else if (!std::memcmp(&d[pos], "data", 4)) {
            if (!fmtOk)
                break;
            const size_t n = std::min<size_t>(len, d.size() - body) / 2;
            out->resize(n);
            std::memcpy(out->data(), &d[body], n * 2);
            return true;
        }
        pos = body + len + (len & 1);
    }
    *error = name + " is not 16 kHz mono 16-bit PCM";
    return false;
}

int fail(const std::string &e)
{
    std::printf("{\"error\":%s}\n", jsonQuote(e).c_str());
    return 1;
}

} // namespace

int main(int argc, char **argv)
{
    WakeConfig config;
    bool stats = false;
    std::vector<std::string> files;
    for (int i = 1; i < argc; ++i) {
        const std::string a = argv[i];
        const bool more = i + 1 < argc;
        if (a == "--model" && more)
            config.modelDir = argv[++i];
        else if (a == "--vosk" && more)
            config.voskLibrary = argv[++i];
        else if (a == "--phrase" && more)
            config.phrase = argv[++i];
        else if (a == "--no-check")
            config.check = false;
        else if (a == "--rejected")
            config.reportRejected = true;
        else if (a == "--stats")
            stats = true;
        else if (a == "-h" || a == "--help") {
            std::printf("usage: phoenix-wakeword --model DIR [--vosk LIB] [--phrase TEXT] [--no-check] [--stats] [FILE.wav ...]\n");
            return 0;
        } else if (!a.empty() && a[0] != '-')
            files.push_back(a);
        else
            return fail("unknown option " + a);
    }
    if (config.modelDir.empty())
        return fail("--model is needed");
    WakeWord wake;
    std::string error;
    if (!wake.open(config, &error))
        return fail(error);
    std::printf("{\"ready\":true}\n");
    std::fflush(stdout);

    const std::clock_t cpu0 = std::clock();
    double seconds = 0;
    WakeStats total;
    if (files.empty()) {
        std::vector<int16_t> buf(1600);
        size_t got;
        while ((got = std::fread(buf.data(), 2, buf.size(), stdin)) > 0) {
            for (const auto &d : wake.feed(buf.data(), got))
                print(d, config.phrase, std::string());
        }
        for (const auto &d : wake.finish())
            print(d, config.phrase, std::string());
        total = wake.stats();
    } else {
        for (const std::string &f : files) {
            // Each file on its own, from its start.
            WakeWord &one = wake;
            one.reset();
            std::vector<int16_t> pcm;
            if (!readWav(f, &pcm, &error))
                return fail(error);
            // Fed as a microphone would, a tenth of a second at a time.
            for (size_t i = 0; i < pcm.size(); i += 1600)
                for (const auto &d : one.feed(pcm.data() + i, std::min<size_t>(1600, pcm.size() - i)))
                    print(d, config.phrase, f);
            for (const auto &d : one.finish())
                print(d, config.phrase, f);
            total.samples += one.stats().samples;
            total.decoded += one.stats().decoded;
            total.candidates += one.stats().candidates;
            total.rejected += one.stats().rejected;
        }
    }
    seconds = total.samples / 16000.0;
    if (stats)
        std::printf("{\"stats\":{\"seconds\":%.1f,\"decodedSeconds\":%.1f,\"cpuSeconds\":%.2f,\"candidates\":%d,\"rejected\":%d}}\n",
                    seconds, total.decoded / 16000.0, double(std::clock() - cpu0) / CLOCKS_PER_SEC, total.candidates,
                    total.rejected);
    return 0;
}
