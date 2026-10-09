// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// phoenix-tts (CI: build/tts-test): numbers and words, the dictionary's
// phonemes, Kitten's symbols, the voices file and the trimming without a
// model; then, with the model (tools/get-kitten.py puts it in build/kitten;
// PHOENIX_TTS_MODEL names another), speech, checked for its length and
// loudness; and espeak-ng's phonemes where it is installed.

#include "audio.h"
#include "kitten.h"
#include "phonemes.h"

#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <string>
#include <unistd.h>
#include <vector>

using namespace phoenix::tts;

static int failures = 0;
static void check(bool ok, const std::string &what)
{
    std::printf("%s %s\n", ok ? "ok  " : "FAIL", what.c_str());
    if (!ok)
        ++failures;
}
static void same(const std::string &got, const std::string &want, const std::string &what)
{
    check(got == want, what + (got == want ? std::string() : " (got \"" + got + "\", want \"" + want + "\")"));
}

static std::string env(const char *name, const std::string &fallback)
{
    const char *v = std::getenv(name);
    return v && *v ? v : fallback;
}

// A voices.npz of the given arrays (stored, as numpy writes it).
static std::string npz(const std::vector<std::pair<std::string, std::vector<float>>> &arrays, size_t width)
{
    std::string zip;
    auto le = [&](uint32_t v, int bytes) { for (int i = 0; i < bytes; ++i) zip += char(v >> (8 * i)); };
    for (const auto &a : arrays) {
        std::string header = "{'descr': '<f4', 'fortran_order': False, 'shape': (" + std::to_string(a.second.size() / width)
            + ", " + std::to_string(width) + "), }";
        while ((10 + header.size() + 1) % 64)
            header += ' ';
        header += '\n';
        std::string npy = std::string("\x93NUMPY\x01\x00", 8);
        npy += char(header.size() & 0xFF);
        npy += char(header.size() >> 8);
        npy += header;
        npy.append(reinterpret_cast<const char *>(a.second.data()), a.second.size() * 4);
        const std::string name = a.first + ".npy";
        le(0x04034b50, 4); le(20, 2); le(0, 2); le(0, 2); le(0, 2); le(0, 2); le(0, 4);
        le(uint32_t(npy.size()), 4); le(uint32_t(npy.size()), 4); le(uint32_t(name.size()), 2); le(0, 2);
        zip += name + npy;
    }
    le(0x02014b50, 4);  // where the central directory would start: the reader stops here
    return zip;
}

int main()
{
    // ---- Numbers and words ----
    same(normalizeEnglish("It's 7:30 now."), "It's seven thirty now.", "a time");
    same(normalizeEnglish("at 7:05 pm"), "at seven oh five P M", "minutes under ten, pm");
    same(normalizeEnglish("Wake me at 8:00"), "Wake me at eight o'clock", "on the hour");
    same(normalizeEnglish("at 6am"), "at six A M", "an hour and am");
    same(normalizeEnglish("72°F and sunny"), "seventy-two degrees Fahrenheit and sunny", "degrees");
    same(normalizeEnglish("$5.50"), "five dollars and fifty cents", "money with cents");
    same(normalizeEnglish("$1"), "one dollar", "one dollar");
    same(normalizeEnglish("$3 million"), "three million dollars", "money with a scale");
    same(normalizeEnglish("1,234,567 people"), "one million two hundred thirty-four thousand five hundred sixty-seven people",
         "thousands commas");
    same(normalizeEnglish("1,2 and 3"), "one,two and three", "a list is not thousands");
    same(normalizeEnglish("pi is 3.14"), "pi is three point one four", "a decimal");
    same(normalizeEnglish("the 21st and 3rd"), "the twenty-first and third", "ordinals");
    same(normalizeEnglish("in 2026, 1984, 1905 and 2005"), "in twenty twenty-six, nineteen eighty-four, nineteen oh five and two thousand five",
         "years");
    same(normalizeEnglish("50% off"), "fifty percent off", "percent");
    same(normalizeEnglish("5-10 minutes"), "five to ten minutes", "a range");
    same(normalizeEnglish("it is -5 out"), "it is minus five out", "below zero");
    same(normalizeEnglish("Call Dr. Smith on Main St."), "Call doctor Smith on Main street.", "abbreviations");
    same(normalizeEnglish("St. Louis"), "saint Louis", "St. before a name");
    same(normalizeEnglish("fruit, e.g. apples"), "fruit, for example apples", "e.g.");
    same(normalizeEnglish("the U.S. team"), "the U S team", "initials");
    same(normalizeEnglish("10 km away, 1 km more"), "ten kilometers away, one kilometer more", "units");
    same(normalizeEnglish("call 5551234567"), "call five five five one two three four five six seven", "a phone number");
    same(normalizeEnglish("Tom & Jerry"), "Tom and Jerry", "symbols");
    same(normalizeEnglish("\xE2\x80\x9CHi\xE2\x80\x9D, she said \xE2\x80\x94 don\xE2\x80\x99t"), "\"Hi\", she said \xE2\x80\x94 don't",
         "typographic quotes and apostrophes");

    const auto sentences = splitSentences("Hello there. How are you? Fine!\nNext line");
    check(sentences.size() == 4 && sentences[1] == "How are you?" && sentences[3] == "Next line", "sentences");
    const std::string longOne = "This sentence goes on, and on, and on, and on, and on, and on, and on, and on, and on, and on, "
                                "until it is far too long to say in one piece, so it is cut at a comma.";
    const auto pieces = splitSentences(longOne, 80);
    bool short_ = pieces.size() > 1;
    for (const std::string &p : pieces)
        short_ = short_ && p.size() <= 80;
    check(short_ && pieces[0].back() == ',', "long sentences at their commas");

    const auto tokens = tokenize("Hello, \"world\" don't 'quote' stop.");
    std::string joined;
    for (const Token &t : tokens)
        joined += (joined.empty() ? "" : "|") + std::string(t.mark ? "m:" : "") + t.text;
    same(joined, "Hello|m:,|m:\"|world|m:\"|don't|quote|stop|m:.", "words and marks");

    // ---- The dictionary ----
    Lexicon lex;
    lex.loadText(";;; a comment\nworld W ER1 L D\nhello HH AH0 L OW1\nread R IY1 D\nread(2) R EH1 D\nwater W AO1 T ER0\n"
                 "thirty TH ER1 T IY0\nfour F AO1 R\nkeyboard K IY1 B AO2 R D\nnotification N OW2 T AH0 F AH0 K EY1 SH AH0 N\n"
                 "minute M IH1 N AH0 T\nservice S ER1 V AH0 S\nhome HH OW1 M\nscreen S K R IY1 N\nhelp HH EH1 L P\n"
                 "aalborg AA1 L B AO0 R G # place, danish\n");
    check(lex.size() == 14, "entries, without comments and second pronunciations");
    check(lex.find("read") == std::vector<std::string>{ "R", "IY1", "D" }, "the first pronunciation");
    check(lex.find("aalborg").size() == 6, "a comment after the phones is left out");
    check(lex.find("zzz").empty() && lex.find("").empty(), "a word it lacks");

    same(arpabetToIpa({ "HH", "AH0", "L", "OW1" }), "həlˈoʊ", "IPA: the stress before the vowel");
    same(arpabetToIpa({ "W", "AO1", "T", "ER0" }), "wˈɔːɾɚ", "IPA: the en-us flap");
    same(arpabetToIpa({ "F", "AO1", "R" }, "four"), "fˈoːɹ", "IPA: four");
    same(arpabetToIpa({ "K", "IY1", "B", "AO2", "R", "D" }, "keyboard"), "kˈiːboːɹd", "IPA: no secondary stress after the primary");
    same(arpabetToIpa({ "N", "OW2", "T", "AH0", "F", "AH0", "K", "EY1", "SH", "AH0", "N" }, "notification"), "nˌoʊɾɪfɪkˈeɪʃən",
         "IPA: secondary stress before it, unstressed i");
    same(arpabetToIpa({ "D", "IH0", "S", "AY1", "D" }, "decide"), "dᵻsˈaɪd", "IPA: espeak's reduced de-");
    same(arpabetToIpa({ "W", "AA1", "N", "T", "IH0", "D" }, "wanted"), "wˈɑːntᵻd", "IPA: -ed");

    const Phonemizer ph(&lex);
    same(ph.phonemize("Hello, world."), "həlˈoʊ , wˈɜːld .", "a sentence as phonemizer writes it");
    same(ph.word("the"), "ðə", "small words reduced");
    same(ph.phonemize("the world"), "ðə wˈɜːld", "the before a consonant");
    same(ph.phonemize("help the elf"), "hˈɛlp ðɪ " + ph.word("elf"), "the before a vowel");
    same(ph.word("USB"), "jˌuːˌɛsbˈiː", "capitals it lacks are spelled");
    same(ph.word("worlds"), "wˈɜːldz", "an ending on a word it has");
    same(ph.word("helped"), "hˈɛlpt", "-ed after a voiceless sound");
    same(ph.word("world's"), "wˈɜːldz", "a possessive");
    same(ph.word("homescreen"), "hˈoʊmskɹiːn", "two words run together");
    check(!ph.word("zorblax").empty(), "a word nobody knows, by its letters");
    same(ph.phonemize("I'll go 2"), "aɪl " + ph.word("go") + " " + ph.word("two"), "a digit left over");

    // ---- Kitten's symbols ----
    check(kittenIds("həlˈoʊ , wˈɜːld .") == std::vector<long long>{ 50, 83, 54, 156, 57, 135, 16, 3, 16, 65, 156, 87, 158, 54, 46, 16, 4 },
          "symbols as KittenML numbers them");
    check(kittenIds("\"") == std::vector<long long>{ 15 } && kittenIds("'") == std::vector<long long>{ 176 }
              && kittenIds("ᵻ") == std::vector<long long>{ 177 },
          "a symbol listed twice has its later number");
    check(kittenIds("{}#") .empty(), "unknown characters are left out");

    // ---- The voices file ----
    const std::string dir = env("TMPDIR", "/tmp") + "/tts-test-" + std::to_string(getpid());
    const std::string file = dir + ".npz";
    {
        std::vector<float> a(256), b(512);
        for (size_t i = 0; i < a.size(); ++i)
            a[i] = float(i) / 256;
        for (size_t i = 0; i < b.size(); ++i)
            b[i] = -float(i);
        std::ofstream(file, std::ios::binary) << npz({ { "expr-voice-2-f", a }, { "expr-voice-5-m", b } }, 256);
    }
    std::map<std::string, std::vector<std::vector<float>>> voices;
    std::string error;
    check(readVoices(file, &voices, &error) && voices.size() == 2 && voices["expr-voice-2-f"].size() == 1
              && voices["expr-voice-2-f"][0][128] == 0.5f && voices["expr-voice-5-m"].size() == 2
              && voices["expr-voice-5-m"][1][0] == -256.0f,
          "voices.npz: names, rows and values " + error);
    std::remove(file.c_str());
    check(!readVoices("/nonexistent.npz", &voices, &error) && !error.empty(), "a missing voices file");

    // ---- Trimming ----
    {
        Kitten::Audio a;
        // pad(10 frames) h(2) ə(2) .(10) pad(4): speech is frames 10-14.
        a.frames = { 10, 2, 2, 10, 4 };
        a.samples.assign(28 * HOP, 0.5f);
        const std::vector<float> t = Kitten::trimmed(a, { 50, 83, 4 });
        const size_t want = (14 + 4) * HOP - (10 * HOP - SAMPLE_RATE / 50);
        check(t.size() == want && t.front() == 0.0f && std::abs(t[t.size() / 2] - 0.5f) < 1e-6 && t.back() < 0.05f,
              "the silence before and the noise after the words are cut, with fades");
        check(Kitten::trimmed(a, { 4, 4, 4 }).empty(), "marks alone: nothing to say");
    }
    check(toPcm16({ 0.0f, 1.0f, -1.0f, 2.0f }) == std::vector<int16_t>{ 0, 32767, -32767, 32767 }, "16-bit samples, clipped");

    // ---- With the model ----
    const std::string model = env("PHOENIX_TTS_MODEL", PHOENIX_TTS_DIR);
    std::ifstream config(model + "/config.json");
    if (!config) {
        std::printf("skip the model's tests: no Kitten model in %s (tools/get-kitten.py)\n", model.c_str());
    } else {
        Lexicon dict;
        check(dict.load(model + "/cmudict.dict", &error) && dict.size() > 100000, "the CMU dictionary " + error);
        Kitten kitten;
        std::string lib = env("PHOENIX_ONNXRUNTIME", "");
        std::ifstream local(model + "/libonnxruntime.so.1");
        if (lib.empty() && local)
            lib = model + "/libonnxruntime.so.1";
        const bool loaded = kitten.load(model, lib, &error);
        check(loaded, "the model loads " + error);
        if (loaded) {
            check(kitten.voices().size() == 8 && kitten.hasVoice("expr-voice-3-f"), "its eight voices");
            const Phonemizer p(&dict);
            const std::vector<long long> ids = kittenIds(p.phonemize(normalizeEnglish("Hello, I'm your assistant.")));
            Kitten::Audio audio;
            check(kitten.synthesize(ids, "expr-voice-3-f", 1.0f, &audio, &error) && audio.frames.size() == ids.size() + 2,
                  "speech, a duration for each symbol " + error);
            const std::vector<float> speech = Kitten::trimmed(audio, ids);
            double sum = 0, peak = 0;
            for (float s : speech) {
                sum += double(s) * s;
                peak = std::max(peak, double(std::abs(s)));
            }
            const double secs = double(speech.size()) / SAMPLE_RATE, rms = speech.empty() ? 0 : std::sqrt(sum / speech.size());
            check(secs > 0.8 && secs < 3.5, "about as long as the words take (" + std::to_string(secs) + " s)");
            check(rms > 0.03 && peak <= 1.0, "loud enough, not clipped (RMS " + std::to_string(rms) + ")");
            check(!kitten.synthesize(ids, "nobody", 1.0f, &audio, &error), "an unknown voice");
        }
    }

    // ---- espeak-ng, where it is installed ----
    std::string espeak;
    for (const char *d : { "/usr/bin/espeak-ng", "/usr/local/bin/espeak-ng", "/opt/homebrew/bin/espeak-ng" })
        if (espeak.empty() && access(d, X_OK) == 0)
            espeak = d;
    if (espeak.empty()) {
        std::printf("skip espeak-ng's tests: not installed\n");
    } else {
        const Phonemizer e(&lex, espeak);
        same(e.phonemize("Hello, world."), "həlˈoʊ , wˈɜːld .", "espeak-ng: the same sentence, the same way");
    }

    std::printf(failures ? "%d failed\n" : "all passed\n", failures);
    return failures ? 1 : 0;
}
