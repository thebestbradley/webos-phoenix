// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0

#include "wakeword.h"

#include "json.h"

#include <algorithm>
#include <cmath>
#include <dlfcn.h>
#include <sstream>

namespace phoenix {

namespace {
constexpr int kRate = 16000;
constexpr int kFrame = kRate / 50;              // the gate's 20 ms
constexpr int kLeadMs = 400;                    // decoded before the gate opened
constexpr int kHangMs = 1200;                   // decoded after the sound stopped
constexpr size_t kHistory = kRate * 4;          // kept for the check
constexpr double kStableS = 0.3;                // a partial result's phrase this long ago is final enough
constexpr double kCheckBefore = 0.5;            // the check's stretch around the phrase
constexpr double kCheckAfter = 0.3;

double levelDb(const int16_t *s, size_t n)
{
    if (!n)
        return -120;
    double sum = 0;
    for (size_t i = 0; i < n; ++i)
        sum += double(s[i]) * s[i];
    const double rms = std::sqrt(sum / n) / 32768.0;
    return rms > 0 ? 20 * std::log10(rms) : -120;
}

std::vector<std::string> words(const std::string &phrase)
{
    std::vector<std::string> out;
    std::istringstream in(phrase);
    for (std::string w; in >> w;)
        out.push_back(w);
    return out;
}
} // namespace

// libvosk's C API (vosk_api.h), the few calls used, found at run time.
struct WakeWord::Vosk {
    void *lib = nullptr;
    void *(*model_new)(const char *) = nullptr;
    void (*model_free)(void *) = nullptr;
    void *(*recognizer_new_grm)(void *, float, const char *) = nullptr;
    void (*recognizer_free)(void *) = nullptr;
    void (*set_words)(void *, int) = nullptr;
    void (*set_partial_words)(void *, int) = nullptr;
    int (*accept)(void *, const short *, int) = nullptr;
    const char *(*result)(void *) = nullptr;
    const char *(*partial)(void *) = nullptr;
    const char *(*final_result)(void *) = nullptr;
    void (*reset)(void *) = nullptr;
    void (*set_log_level)(int) = nullptr;
    void *model = nullptr;
    void *spotter = nullptr;
    void *checker = nullptr;

    ~Vosk()
    {
        if (checker)
            recognizer_free(checker);
        if (spotter)
            recognizer_free(spotter);
        if (model)
            model_free(model);
        if (lib)
            dlclose(lib);
    }
    bool load(const std::string &path, std::string *error)
    {
        std::vector<std::string> names;
        if (!path.empty())
            names.push_back(path);
#ifdef __APPLE__
        names.insert(names.end(), { "libvosk.dylib", "/opt/homebrew/lib/libvosk.dylib", "/usr/local/lib/libvosk.dylib" });
#else
        names.insert(names.end(), { "libvosk.so", "/usr/lib/libvosk.so", "/usr/local/lib/libvosk.so" });
#endif
        for (const std::string &n : names) {
            lib = dlopen(n.c_str(), RTLD_NOW | RTLD_LOCAL);
            if (lib)
                break;
        }
        if (!lib) {
            *error = "libvosk was not found" + (path.empty() ? std::string() : " (" + path + ")");
            return false;
        }
        bool ok = true;
        auto sym = [&](auto &fn, const char *name) {
            fn = reinterpret_cast<std::remove_reference_t<decltype(fn)>>(dlsym(lib, name));
            ok = ok && fn;
        };
        sym(model_new, "vosk_model_new");
        sym(model_free, "vosk_model_free");
        sym(recognizer_new_grm, "vosk_recognizer_new_grm");
        sym(recognizer_free, "vosk_recognizer_free");
        sym(set_words, "vosk_recognizer_set_words");
        sym(set_partial_words, "vosk_recognizer_set_partial_words");
        sym(accept, "vosk_recognizer_accept_waveform_s");
        sym(result, "vosk_recognizer_result");
        sym(partial, "vosk_recognizer_partial_result");
        sym(final_result, "vosk_recognizer_final_result");
        sym(reset, "vosk_recognizer_reset");
        sym(set_log_level, "vosk_set_log_level");
        if (!ok)
            *error = "libvosk is too old (vosk_recognizer_set_partial_words and the rest are needed: 0.3.45 or later)";
        return ok;
    }
};

WakeWord::WakeWord() = default;
WakeWord::~WakeWord() = default;

std::vector<std::string> WakeWord::competitors()
{
    // Sounds like "hey", like "phoenix" or its parts, and the short words
    // that come before a name; measured against espeak-ng's and Piper's
    // near misses ("Hey Felix", "Hey Phoebe", "Hey Venice"; docs/AI-AND-MCP.md).
    return {
        "a", "the", "and", "to", "of", "in", "is", "it", "i", "you", "he", "she", "we", "they", "that", "this",
        "what", "for", "on", "with", "at", "by", "from", "up", "so", "no", "not", "but", "or", "if", "me", "my",
        "hey", "hay", "hi", "high", "hello", "hate", "pay", "say", "may", "way", "day", "they", "play", "stay", "okay",
        "felix", "phoebe", "venice", "fiona", "felicia", "phineas", "phone", "phones", "fee", "fees", "feel", "fifteen",
        "fish", "fix", "fixes", "nick", "nicks", "next", "mix", "vixen", "phonics", "phonetics", "peanut", "peanuts",
        "penny", "bonnie", "benny", "kenny", "finish", "finnish", "feline", "genius", "venus", "fiction", "physics",
        "phase", "ethnic", "tonic", "sonic", "finland", "phoenician", "fenwick", "funny", "phony", "feeney", "vinnie",
        "siri", "google", "alexa", "computer", "there", "fellas", "fella", "fellow", "pheasant", "freezing", "fusion",
    };
}

std::string WakeWord::spotterGrammar(const std::string &phrase)
{
    return "[\"" + phrase + "\", \"[unk]\"]";
}

std::string WakeWord::checkGrammar(const std::string &phrase)
{
    std::string g = "[\"" + phrase + "\"";
    const std::vector<std::string> own = words(phrase);
    for (const std::string &w : competitors()) {
        // The phrase's last word only as part of the phrase: alone it would
        // match without "hey" ("I flew to Phoenix").
        if (!own.empty() && w == own.back())
            continue;
        g += ", \"" + w + "\"";
    }
    return g + ", \"[unk]\"]";
}

bool WakeWord::findPhrase(const std::string &text, const std::string &phrase, double *start, double *end, double *score)
{
    const Json r = Json::parse(text);
    const Json &list = r.has("result") ? r["result"] : r["partial_result"];
    const std::vector<std::string> want = words(phrase);
    const std::vector<Json> &got = list.items();
    if (want.empty() || got.size() < want.size())
        return false;
    // The last time it was said.
    for (size_t i = got.size() - want.size() + 1; i-- > 0;) {
        bool match = true;
        double conf = 1;
        for (size_t k = 0; k < want.size() && match; ++k) {
            match = got[i + k]["word"].str() == want[k];
            conf = std::min(conf, got[i + k]["conf"].num(1));
        }
        if (match) {
            *start = got[i]["start"].num();
            *end = got[i + want.size() - 1]["end"].num();
            *score = conf;
            return true;
        }
    }
    return false;
}

bool WakeWord::Gate::feed(double level, int ms)
{
    // The floor follows the quiet slowly, and quickly when it gets quieter.
    if (level < floorDb)
        floorDb = level;
    else
        floorDb += (level - floorDb) * (level < floorDb + 6 ? 0.05 : 0.002);
    floorDb = std::max(floorDb, -90.0);
    if (level > gateDb && level > floorDb + 9)
        hangMs = kHangMs;
    else
        hangMs = std::max(0, hangMs - ms);
    return hangMs > 0;
}

bool WakeWord::open(const WakeConfig &config, std::string *error)
{
    std::string err;
    m_config = config;
    m_gate.gateDb = config.gateDb;
    m_vosk = std::make_unique<Vosk>();
    if (!m_vosk->load(config.voskLibrary, &err)) {
        m_vosk.reset();
        if (error)
            *error = err;
        return false;
    }
    m_vosk->set_log_level(-1);
    m_vosk->model = m_vosk->model_new(config.modelDir.c_str());
    if (m_vosk->model) {
        m_vosk->spotter = m_vosk->recognizer_new_grm(m_vosk->model, kRate, spotterGrammar(config.phrase).c_str());
        m_vosk->checker = m_vosk->recognizer_new_grm(m_vosk->model, kRate, checkGrammar(config.phrase).c_str());
    }
    if (!m_vosk->spotter || !m_vosk->checker) {
        if (error)
            *error = "the wake word model could not be loaded from " + config.modelDir;
        m_vosk.reset();
        return false;
    }
    m_vosk->set_words(m_vosk->spotter, 1);
    m_vosk->set_partial_words(m_vosk->spotter, 1);
    m_vosk->set_words(m_vosk->checker, 1);
    return true;
}

std::vector<WakeDetection> WakeWord::feed(const int16_t *samples, size_t count)
{
    std::vector<WakeDetection> out;
    if (!m_vosk)
        return out;
    for (size_t pos = 0; pos < count; pos += kFrame) {
        const size_t n = std::min<size_t>(kFrame, count - pos);
        const int16_t *s = samples + pos;
        const uint64_t at = m_stats.samples;
        m_history.insert(m_history.end(), s, s + n);
        m_stats.samples += n;
        if (m_history.size() > kHistory + kRate) {
            const size_t drop = m_history.size() - kHistory;
            m_history.erase(m_history.begin(), m_history.begin() + drop);
            m_historyStart += drop;
        }
        const bool open = m_gate.feed(levelDb(s, n), int(n * 1000 / kRate));
        if (open && !m_decoding) {
            // The gate opens: from a little before.
            m_decoding = true;
            const uint64_t from = std::max<uint64_t>(m_historyStart, at > kRate * kLeadMs / 1000 ? at - kRate * kLeadMs / 1000 : 0);
            m_offset = int64_t(from) - int64_t(m_fed);
            const auto d = decode(m_history.data() + (from - m_historyStart), size_t(at + n - from), false);
            out.insert(out.end(), d.begin(), d.end());
        } else if (m_decoding) {
            const auto d = decode(s, n, !open);
            out.insert(out.end(), d.begin(), d.end());
            if (!open)
                m_decoding = false;
        }
    }
    return out;
}

void WakeWord::reset()
{
    if (m_vosk) {
        m_vosk->reset(m_vosk->spotter);
        m_vosk->reset(m_vosk->checker);
    }
    m_stats = WakeStats();
    m_gate = Gate();
    m_gate.gateDb = m_config.gateDb;
    m_history.clear();
    m_historyStart = 0;
    m_decoding = false;
    m_offset = -int64_t(m_fed);
    m_quietUntil = 0;
}

std::vector<WakeDetection> WakeWord::finish()
{
    if (!m_vosk || !m_decoding)
        return {};
    m_decoding = false;
    return decode(nullptr, 0, true);
}

std::vector<WakeDetection> WakeWord::decode(const int16_t *samples, size_t count, bool last)
{
    std::vector<WakeDetection> out;
    void *rec = m_vosk->spotter;
    bool final = false;
    if (count) {
        final = m_vosk->accept(rec, samples, int(count)) == 1;
        m_fed += count;
        m_stats.decoded += count;
    }
    const char *json = last ? m_vosk->final_result(rec) : final ? m_vosk->result(rec) : m_vosk->partial(rec);
    double start = 0, end = 0, score = 0;
    if (!json || !findPhrase(json, m_config.phrase, &start, &end, &score))
        return out;
    // A partial result's phrase once the decoder is well past it.
    const double now = double(m_fed) / kRate;
    if (!final && !last && now - end < kStableS)
        return out;
    start += double(m_offset) / kRate;
    end += double(m_offset) / kRate;
    if (end <= m_quietUntil)
        return out;
    m_quietUntil = end;
    ++m_stats.candidates;
    WakeDetection d;
    d.start = start;
    d.end = end;
    d.score = score;
    if (m_config.check && !check(start, end, &d.heard)) {
        ++m_stats.rejected;
        d.accepted = false;
        if (m_config.reportRejected)
            out.push_back(d);
    } else {
        out.push_back(d);
    }
    // What follows is the request (or more talk), not the phrase again.
    if (!final && !last)
        m_vosk->reset(rec);
    return out;
}

bool WakeWord::check(double start, double end, std::string *heard)
{
    const auto index = [this](double t) {
        const int64_t i = int64_t(t * kRate) - int64_t(m_historyStart);
        return size_t(std::clamp<int64_t>(i, 0, int64_t(m_history.size())));
    };
    const size_t a = index(start - kCheckBefore), b = index(end + kCheckAfter);
    void *rec = m_vosk->checker;
    m_vosk->reset(rec);
    if (b > a)
        m_vosk->accept(rec, m_history.data() + a, int(b - a));
    const std::vector<int16_t> quiet(kRate * 3 / 10, 0);
    m_vosk->accept(rec, quiet.data(), int(quiet.size()));
    const std::string json = m_vosk->final_result(rec);
    const Json r = Json::parse(json);
    *heard = r["text"].str();
    double s = 0, e = 0, c = 0;
    return findPhrase(json, m_config.phrase, &s, &e, &c);
}

} // namespace phoenix
