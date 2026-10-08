// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The wake word spotter (CI: build/wakeword-test): its grammars, results
// and gate without a model, then the recordings in tests/data with Vosk's
// small English model (tools/get-wakeword.py puts it in build/wakeword;
// PHOENIX_WAKE_MODEL and PHOENIX_VOSK_LIBRARY name others).

#include "wakeword.h"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <iterator>
#include <string>
#include <vector>

using namespace phoenix;

static int failures = 0;
static void check(bool ok, const std::string &what)
{
    std::printf("%s %s\n", ok ? "ok  " : "FAIL", what.c_str());
    if (!ok)
        ++failures;
}

static std::vector<int16_t> readWav(const std::string &name)
{
    std::ifstream in(name, std::ios::binary);
    const std::vector<char> d((std::istreambuf_iterator<char>(in)), std::istreambuf_iterator<char>());
    for (size_t pos = 12; pos + 8 <= d.size();) {
        uint32_t len;
        std::memcpy(&len, &d[pos + 4], 4);
        if (!std::memcmp(&d[pos], "data", 4)) {
            std::vector<int16_t> pcm(std::min<size_t>(len, d.size() - pos - 8) / 2);
            std::memcpy(pcm.data(), &d[pos + 8], pcm.size() * 2);
            return pcm;
        }
        pos += 8 + len + (len & 1);
    }
    return {};
}

static std::vector<WakeDetection> listen(WakeWord &w, const std::vector<int16_t> &pcm)
{
    std::vector<WakeDetection> out;
    for (size_t i = 0; i < pcm.size(); i += 1600) {
        const auto d = w.feed(pcm.data() + i, std::min<size_t>(1600, pcm.size() - i));
        out.insert(out.end(), d.begin(), d.end());
    }
    const auto d = w.finish();
    out.insert(out.end(), d.begin(), d.end());
    return out;
}

static std::string env(const char *name, const std::string &fallback)
{
    const char *v = std::getenv(name);
    return v && *v ? v : fallback;
}

int main()
{
    // The grammars.
    check(WakeWord::spotterGrammar("hey phoenix") == "[\"hey phoenix\", \"[unk]\"]", "the spotter: the phrase or anything else");
    const std::string g = WakeWord::checkGrammar("hey phoenix");
    check(g.find("\"felix\"") != std::string::npos && g.find("\"hey\"") != std::string::npos && g.rfind("\"[unk]\"]") == g.size() - 8,
          "the check: the phrase against words that sound like it");
    check(g.find("\"phoenix\"") == std::string::npos, "\"phoenix\" only after \"hey\" (not \"I flew to Phoenix\")");

    // Results.
    double s = 0, e = 0, c = 0;
    const std::string final = R"({"result":[{"conf":0.9,"end":1.0,"start":0.5,"word":"hey"},{"conf":0.8,"end":1.6,"start":1.0,"word":"phoenix"}],"text":"hey phoenix"})";
    check(WakeWord::findPhrase(final, "hey phoenix", &s, &e, &c) && s == 0.5 && e == 1.6 && std::abs(c - 0.8) < 1e-9,
          "a result's phrase: where it starts and ends, the lower confidence");
    const std::string partial = R"({"partial":"hey phoenix","partial_result":[{"conf":1,"end":2.1,"start":1.7,"word":"hey"},{"conf":1,"end":2.6,"start":2.1,"word":"phoenix"}]})";
    check(WakeWord::findPhrase(partial, "hey phoenix", &s, &e, &c) && e == 2.6, "a partial result's");
    check(!WakeWord::findPhrase(R"({"result":[{"conf":1,"end":1,"start":0,"word":"hey"},{"conf":1,"end":2,"start":1,"word":"[unk]"},{"conf":1,"end":3,"start":2,"word":"phoenix"}]})",
                                "hey phoenix", &s, &e, &c),
          "the words apart are not the phrase");
    check(!WakeWord::findPhrase(R"({"text":""})", "hey phoenix", &s, &e, &c) && !WakeWord::findPhrase("junk", "hey phoenix", &s, &e, &c),
          "nothing, or not JSON");

    // The gate.
    WakeWord::Gate gate;
    bool open = false;
    for (int i = 0; i < 100; ++i)
        open = gate.feed(-75, 20);
    check(!open, "quiet: nothing decoded");
    check(gate.feed(-25, 20), "speech opens it");
    for (int i = 0; i < 55; ++i)
        open = gate.feed(-75, 20);
    check(open, "and it stays open a moment after (1.2 s)");
    for (int i = 0; i < 10; ++i)
        open = gate.feed(-75, 20);
    check(!open, "then closes");
    WakeWord::Gate fan;
    for (int i = 0; i < 1500; ++i)                       // half a minute of a steady -40 dBFS hum
        open = fan.feed(-40, 20);
    check(!open, "a steady noise becomes the floor and closes it");
    check(fan.feed(-25, 20), "speech over the noise opens it");

    // The recordings, with the model.
    const std::string dir = env("PHOENIX_WAKE_DIR", PHOENIX_WAKE_DIR);
    WakeConfig config;
    config.modelDir = env("PHOENIX_WAKE_MODEL", dir + "/vosk-model-small-en-us-0.15");
#ifdef __APPLE__
    config.voskLibrary = env("PHOENIX_VOSK_LIBRARY", dir + "/libvosk.dylib");
#else
    config.voskLibrary = env("PHOENIX_VOSK_LIBRARY", dir + "/libvosk.so");
#endif
    WakeWord wake;
    std::string error;
    const bool loaded = wake.open(config, &error);
    check(loaded, "the model loads (" + (loaded ? config.modelDir : error + "; run tools/get-wakeword.py") + ")");
    if (loaded) {
        const std::string data = PHOENIX_WAKE_DATA;
        struct Case { const char *file; bool heard; };
        const Case cases[] = {
            { "hey-phoenix", true }, { "hey-phoenix-f", true }, { "hey-phoenix-gb", true }, { "hey-phoenix-timer", true },
            { "hey-felix", false }, { "hey-phoebe", false }, { "flew-to-phoenix", false }, { "talk", false },
            { "weather", false }, { "text-sam", false }, { "yes", false },
        };
        std::vector<int16_t> all;
        for (const Case &k : cases) {
            const std::vector<int16_t> pcm = readWav(data + "/" + k.file + ".wav");
            wake.reset();
            const auto d = listen(wake, pcm);
            // The recordings start with half a second of quiet; "Hey Phoenix"
            // takes about 0.85 s.
            const bool right = k.heard ? d.size() == 1 && d[0].start > 0.3 && d[0].end > 1.1 && d[0].end < 1.7 : d.empty();
            check(!pcm.empty() && right, std::string(k.file) + (k.heard ? ": heard, once, where it was said" : ": not heard"));
            all.insert(all.end(), pcm.begin(), pcm.end());
        }
        // One breath: the request follows at once.
        {
            wake.reset();
            const auto d = listen(wake, readWav(data + "/hey-phoenix-timer.wav"));
            check(d.size() == 1 && d[0].end < 1.5, "\"Hey Phoenix, set a timer\": the phrase ends before the request");
        }
        // All of them as one stream, and quiet.
        wake.reset();
        const auto d = listen(wake, all);
        check(d.size() == 4, "in one stream: the four times it was said (" + std::to_string(d.size()) + ")");
        wake.reset();
        std::vector<int16_t> quiet(16000 * 60);
        unsigned seed = 1;
        for (int16_t &v : quiet) {                       // a quiet room, about -60 dBFS
            seed = seed * 1103515245 + 12345;
            v = int16_t(int((seed >> 16) % 65) - 32);
        }
        check(listen(wake, quiet).empty() && wake.stats().decoded < 16000, "a minute of a quiet room: nothing decoded");
    }

    std::printf(failures ? "%d failed\n" : "all passed\n", failures);
    return failures ? 1 : 0;
}
