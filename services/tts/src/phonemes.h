// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// From English text to the phonemes Kitten TTS reads (docs/AI-AND-MCP.md,
// Speech). Kitten was trained on espeak-ng's IPA (en-us, with stress marks,
// punctuation kept, as the Python `phonemizer` package writes it), so that
// is the target here, by one of two routes:
//
//   Lexicon   built in and permissive: the CMU Pronouncing Dictionary
//             (BSD-2-Clause, 135,000 words) turned into espeak-style IPA
//             by the rules below, letter-to-sound rules for words it lacks,
//             and English numbers, times, money and symbols as words
//   Espeak    the espeak-ng program (GPL-3.0), run as a program of its own
//             for each stretch between punctuation marks (never linked),
//             where it is installed: exactly what Kitten was trained on
//
// Either way the result is phonemizer's: words separated by spaces, each
// punctuation mark kept as a word of its own ("həlˈoʊ , wˈɜːld ."), which
// kittenIds() turns into the model's symbol numbers.

#pragma once

#include <string>
#include <vector>

namespace phoenix::tts {

// Numbers, times, money, units, symbols and common abbreviations as
// English words ("It's 7:30 and 72°F" -> "It's seven thirty and
// seventy-two degrees Fahrenheit").
std::string normalizeEnglish(const std::string &text);

// The text in pieces to speak one after the other: sentences, and long
// sentences at their commas (Kitten reads at most about 500 symbols at a
// time, and the first piece is heard sooner the shorter it is).
std::vector<std::string> splitSentences(const std::string &text, size_t maxChars = 240);

// A word or a punctuation mark (one of Kitten's: ; : , . ! ? ¡ ¿ — … " « » “ ”).
struct Token
{
    std::string text;
    bool mark = false;
};
std::vector<Token> tokenize(const std::string &normalized);

// The CMU Pronouncing Dictionary (cmudict.dict: "word PH1 PH2 ...", "word(2)"
// for other pronunciations, "#" comments), read once and searched in place.
class Lexicon
{
public:
    bool load(const std::string &path, std::string *error);
    // For tests: a dictionary from text in the same format.
    void loadText(std::string text);
    bool loaded() const { return !m_entries.empty(); }
    size_t size() const { return m_entries.size(); }
    // The ARPAbet phones of a lower-case word, its first pronunciation;
    // empty when it is not there.
    std::vector<std::string> find(const std::string &lowerWord) const;

private:
    void index();
    std::string m_text;
    std::vector<unsigned> m_entries;  // offsets of first pronunciations, sorted by word
};

// ARPAbet phones (with stress digits) as espeak-ng's en-us IPA, the stress
// mark before the stressed vowel as espeak writes it ("HH AH0 L OW1" ->
// "həlˈoʊ").
// spelling: the word, for the few sounds its letters decide ("four" oːɹ).
std::string arpabetToIpa(const std::vector<std::string> &phones, const std::string &spelling = std::string());

// A word's ARPAbet phones from its spelling, for words the dictionary
// lacks (names, new words): English letter-to-sound rules, approximate.
std::vector<std::string> letterToSound(const std::string &lowerWord);

class Phonemizer
{
public:
    enum Backend { Lexicon_, Espeak };
    // espeak: the espeak-ng program, or "" for the lexicon only.
    Phonemizer(const Lexicon *lexicon, std::string espeak = std::string());
    Backend backend() const { return m_espeak.empty() ? Lexicon_ : Espeak; }

    // Normalized text (normalizeEnglish) as phonemizer writes it.
    std::string phonemize(const std::string &normalized, std::string *error = nullptr) const;
    // One word by the lexicon (and the rules).
    std::string word(const std::string &word) const;

private:
    std::string espeakRun(const std::string &text, std::string *error) const;
    const Lexicon *m_lexicon;
    std::string m_espeak;
};

// Kitten's symbols (the TextCleaner of KittenML's kittentts, 0.1-0.8):
// phonemes as the model's input numbers, without the 0 it starts and ends
// with. Characters it does not know are left out, as there.
std::vector<long long> kittenIds(const std::string &phonemes);

// Splits text into UTF-8 code points / joins them.
std::u32string utf8ToU32(const std::string &s);
std::string u32ToUtf8(const std::u32string &s);

} // namespace phoenix::tts
