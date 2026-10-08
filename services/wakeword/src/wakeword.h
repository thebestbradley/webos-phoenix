// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The assistant's wake word ("Hey Phoenix"; docs/AI-AND-MCP.md, Voice):
// spotted on the device, in 16 kHz mono 16-bit audio, by Vosk (Kaldi) with
// its small English model (vosk-model-small-en-us-0.15, Apache-2.0) and a
// grammar of the phrase and [unk] (anything else), in three steps that
// keep listening cheap:
//
//   1. A gate: the audio is decoded only while there is sound above the
//      room's noise floor (and a little before, so the start of a word is
//      not lost). Quiet costs next to nothing.
//   2. The spotter: the grammar decoder. It hears the phrase readily, also
//      in things that only sound like it ("Hey Felix").
//   3. The check: the moment the spotter hears it, the same model decodes
//      that stretch again with words that sound like it as competitors
//      (`competitors()`), and the phrase must win. This runs only on a
//      candidate, a few times an hour at most.
//
// Vosk is loaded at run time (libvosk, Apache-2.0: its own release or the
// one in the vosk Python wheel), so nothing is linked and the shell runs
// without it: no library or model, no wake word.

#pragma once

#include <cstdint>
#include <memory>
#include <string>
#include <vector>

namespace phoenix {

struct WakeConfig {
    std::string modelDir;                 // vosk-model-small-en-us-0.15
    std::string voskLibrary;              // libvosk.so / libvosk.dylib ("" for the usual names)
    std::string phrase = "hey phoenix";   // lower case, words in the model
    bool check = true;                    // step 3
    double gateDb = -52;                  // quieter than this is never speech (dBFS)
    bool reportRejected = false;          // also the candidates the check turned down (measuring)
};

struct WakeDetection {
    double start = 0;      // seconds from the start of the audio
    double end = 0;        // where the phrase ends: what follows is the request
    double score = 0;      // the spotter's word confidence (lowest)
    std::string heard;     // what the check heard around it
    bool accepted = true;  // false: a candidate the check turned down (reportRejected)
};

struct WakeStats {
    uint64_t samples = 0;  // fed
    uint64_t decoded = 0;  // passed by the gate to the spotter
    int candidates = 0;    // the spotter's
    int rejected = 0;      // by the check
};

class WakeWord
{
public:
    WakeWord();
    ~WakeWord();
    WakeWord(const WakeWord &) = delete;
    WakeWord &operator=(const WakeWord &) = delete;

    bool open(const WakeConfig &config, std::string *error);
    // Audio as it comes; what was heard in it.
    std::vector<WakeDetection> feed(const int16_t *samples, size_t count);
    // The end of the audio.
    std::vector<WakeDetection> finish();
    // From the start again (another recording), the model kept.
    void reset();
    const WakeStats &stats() const { return m_stats; }

    // The words the check sets against the phrase: ones that sound like
    // its parts ("Felix", "Phoebe", "hay") and common short words.
    static std::vector<std::string> competitors();
    // The grammars (Vosk's JSON list of phrases).
    static std::string spotterGrammar(const std::string &phrase);
    static std::string checkGrammar(const std::string &phrase);
    // The phrase in a decoder's result ({"result": [{word, start, end,
    // conf}]} or a partial's "partial_result"), or false.
    static bool findPhrase(const std::string &json, const std::string &phrase, double *start, double *end,
                           double *score);

    // The gate on its own (tests): fed 20 ms frames, says whether to decode.
    struct Gate {
        double floorDb = -70;
        double gateDb = -52;
        int hangMs = 0;
        bool feed(double levelDb, int ms);
    };

private:
    struct Vosk;
    std::vector<WakeDetection> decode(const int16_t *samples, size_t count, bool last);
    bool check(double start, double end, std::string *heard);

    std::unique_ptr<Vosk> m_vosk;
    WakeConfig m_config;
    WakeStats m_stats;
    Gate m_gate;
    std::vector<int16_t> m_history;   // the last seconds, for the gate's lead-in and the check
    uint64_t m_historyStart = 0;      // the sample index of m_history[0]
    bool m_decoding = false;
    uint64_t m_fed = 0;               // samples the spotter has had (its clock)
    int64_t m_offset = 0;             // audio sample index - spotter sample index, for this stretch
    double m_quietUntil = 0;          // no second detection of the same words
};

} // namespace phoenix
