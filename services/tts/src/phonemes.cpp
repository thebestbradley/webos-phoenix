// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0

#include "phonemes.h"

#include <algorithm>
#include <cctype>
#include <cstring>
#include <fstream>
#include <iterator>
#include <map>
#include <sstream>

#include <fcntl.h>
#include <signal.h>
#include <spawn.h>
#include <sys/wait.h>
#include <unistd.h>

extern char **environ;

namespace phoenix::tts {

// ---- UTF-8 ------------------------------------------------------------------------------------

std::u32string utf8ToU32(const std::string &s)
{
    std::u32string out;
    for (size_t i = 0; i < s.size();) {
        const unsigned char c = s[i];
        char32_t cp = c;
        int extra = 0;
        if (c >= 0xF0) { cp = c & 0x07; extra = 3; }
        else if (c >= 0xE0) { cp = c & 0x0F; extra = 2; }
        else if (c >= 0xC0) { cp = c & 0x1F; extra = 1; }
        else if (c >= 0x80) { ++i; continue; }  // a stray continuation byte
        ++i;
        for (int k = 0; k < extra && i < s.size(); ++k, ++i)
            cp = (cp << 6) | (static_cast<unsigned char>(s[i]) & 0x3F);
        out.push_back(cp);
    }
    return out;
}

std::string u32ToUtf8(const std::u32string &s)
{
    std::string out;
    for (char32_t c : s) {
        if (c < 0x80) {
            out += char(c);
        } else if (c < 0x800) {
            out += char(0xC0 | (c >> 6));
            out += char(0x80 | (c & 0x3F));
        } else if (c < 0x10000) {
            out += char(0xE0 | (c >> 12));
            out += char(0x80 | ((c >> 6) & 0x3F));
            out += char(0x80 | (c & 0x3F));
        } else {
            out += char(0xF0 | (c >> 18));
            out += char(0x80 | ((c >> 12) & 0x3F));
            out += char(0x80 | ((c >> 6) & 0x3F));
            out += char(0x80 | (c & 0x3F));
        }
    }
    return out;
}

namespace {

std::string lower(std::string s)
{
    for (char &c : s)
        c = char(std::tolower(static_cast<unsigned char>(c)));
    return s;
}

bool isUpperWord(const std::string &s)
{
    bool any = false;
    for (char c : s) {
        if (std::islower(static_cast<unsigned char>(c)))
            return false;
        any = any || std::isupper(static_cast<unsigned char>(c));
    }
    return any;
}

std::string trim(const std::string &s)
{
    size_t a = 0, b = s.size();
    while (a < b && std::isspace(static_cast<unsigned char>(s[a])))
        ++a;
    while (b > a && std::isspace(static_cast<unsigned char>(s[b - 1])))
        --b;
    return s.substr(a, b - a);
}

// Latin letters with accents as plain ones (café -> cafe), for the
// dictionary and the rules; the rest of the text is left alone.
char32_t plainLetter(char32_t c)
{
    static const std::map<char32_t, char> table = {
        { U'à', 'a' }, { U'á', 'a' }, { U'â', 'a' }, { U'ã', 'a' }, { U'ä', 'a' }, { U'å', 'a' },
        { U'ç', 'c' }, { U'è', 'e' }, { U'é', 'e' }, { U'ê', 'e' }, { U'ë', 'e' }, { U'ì', 'i' },
        { U'í', 'i' }, { U'î', 'i' }, { U'ï', 'i' }, { U'ñ', 'n' }, { U'ò', 'o' }, { U'ó', 'o' },
        { U'ô', 'o' }, { U'õ', 'o' }, { U'ö', 'o' }, { U'ø', 'o' }, { U'ù', 'u' }, { U'ú', 'u' },
        { U'û', 'u' }, { U'ü', 'u' }, { U'ý', 'y' }, { U'ÿ', 'y' },
        { U'À', 'A' }, { U'Á', 'A' }, { U'Â', 'A' }, { U'Ä', 'A' }, { U'Å', 'A' }, { U'Ç', 'C' },
        { U'È', 'E' }, { U'É', 'E' }, { U'Ê', 'E' }, { U'Ë', 'E' }, { U'Í', 'I' }, { U'Î', 'I' },
        { U'Ñ', 'N' }, { U'Ó', 'O' }, { U'Ô', 'O' }, { U'Ö', 'O' }, { U'Ø', 'O' }, { U'Ú', 'U' },
        { U'Ü', 'U' },
    };
    const auto it = table.find(c);
    return it == table.end() ? c : char32_t(it->second);
}

// ---- Numbers as words ---------------------------------------------------------------------------

const char *const ONES[] = { "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
                             "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen",
                             "eighteen", "nineteen" };
const char *const TENS[] = { "", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety" };

std::string under100(int n)
{
    if (n < 20)
        return ONES[n];
    return std::string(TENS[n / 10]) + (n % 10 ? std::string("-") + ONES[n % 10] : std::string());
}

std::string under1000(int n)
{
    std::string s;
    if (n >= 100) {
        s = std::string(ONES[n / 100]) + " hundred";
        n %= 100;
        if (!n)
            return s;
        s += " ";
    }
    return s + under100(n);
}

std::string cardinal(unsigned long long n)
{
    if (n == 0)
        return "zero";
    static const char *const SCALES[] = { "", " thousand", " million", " billion", " trillion" };
    std::vector<std::string> parts;
    for (int scale = 0; n && scale < 5; ++scale, n /= 1000) {
        const int group = int(n % 1000);
        if (group)
            parts.insert(parts.begin(), under1000(group) + SCALES[scale]);
    }
    std::string s;
    for (const std::string &p : parts)
        s += (s.empty() ? "" : " ") + p;
    return s;
}

std::string ordinal(unsigned long long n)
{
    std::string s = cardinal(n);
    const size_t cut = s.find_last_of(" -");
    const std::string head = cut == std::string::npos ? std::string() : s.substr(0, cut + 1);
    std::string last = cut == std::string::npos ? s : s.substr(cut + 1);
    static const std::map<std::string, std::string> irregular = {
        { "one", "first" }, { "two", "second" }, { "three", "third" }, { "five", "fifth" },
        { "eight", "eighth" }, { "nine", "ninth" }, { "twelve", "twelfth" },
    };
    const auto it = irregular.find(last);
    if (it != irregular.end())
        last = it->second;
    else if (!last.empty() && last.back() == 'y')
        last = last.substr(0, last.size() - 1) + "ieth";
    else
        last += "th";
    return head + last;
}

// 1984 -> nineteen eighty-four, 2026 -> twenty twenty-six, 2005 -> two thousand five.
std::string year(int n)
{
    if (n >= 2000 && n < 2010)
        return n == 2000 ? "two thousand" : "two thousand " + std::string(ONES[n % 10]);
    const int hi = n / 100, lo = n % 100;
    if (lo == 0)
        return under100(hi) + " hundred";
    if (lo < 10)
        return under100(hi) + " oh " + ONES[lo];
    return under100(hi) + " " + under100(lo);
}

std::string digitsOneByOne(const std::string &digits)
{
    std::string s;
    for (char c : digits)
        if (std::isdigit(static_cast<unsigned char>(c)))
            s += (s.empty() ? "" : " ") + std::string(ONES[c - '0']);
    return s;
}

bool startsWithAt(const std::string &s, size_t i, const char *what)
{
    return s.compare(i, std::strlen(what), what) == 0;
}

bool letterAt(const std::string &s, size_t i)
{
    return i < s.size() && (std::isalpha(static_cast<unsigned char>(s[i])) || static_cast<unsigned char>(s[i]) >= 0x80);
}

// After a number: a unit word, as words (singular after one).
struct Unit { const char *abbrev; const char *plural; const char *singular; };
const Unit UNITS[] = {
    { "km/h", "kilometers per hour", "kilometer per hour" }, { "kph", "kilometers per hour", "kilometer per hour" },
    { "mph", "miles per hour", "mile per hour" }, { "km", "kilometers", "kilometer" }, { "mi", "miles", "mile" },
    { "cm", "centimeters", "centimeter" }, { "mm", "millimeters", "millimeter" }, { "kg", "kilograms", "kilogram" },
    { "lbs", "pounds", "pound" }, { "lb", "pounds", "pound" }, { "oz", "ounces", "ounce" }, { "ft", "feet", "foot" },
    { "GB", "gigabytes", "gigabyte" }, { "MB", "megabytes", "megabyte" }, { "KB", "kilobytes", "kilobyte" },
    { "kB", "kilobytes", "kilobyte" }, { "TB", "terabytes", "terabyte" }, { "hrs", "hours", "hour" },
    { "hr", "hours", "hour" }, { "mins", "minutes", "minute" }, { "min", "minutes", "minute" },
    { "secs", "seconds", "second" }, { "sec", "seconds", "second" }, { "ms", "milliseconds", "millisecond" },
};

// A number at text[i] (digits, maybe with thousands commas, a decimal
// part, a time's colon, an ordinal's ending, %, °, a unit, am/pm) as
// words; *end is where it stops.
std::string numberAt(const std::string &t, size_t i, size_t *end, const std::string &currency)
{
    size_t j = i;
    std::string digits;
    bool grouped = false;
    size_t sinceComma = 0;
    auto digitAt = [&](size_t k) { return k < t.size() && std::isdigit(static_cast<unsigned char>(t[k])); };
    while (j < t.size()) {
        if (digitAt(j)) {
            digits += t[j++];
            ++sinceComma;
            continue;
        }
        // Thousands commas only as a whole: "1,234,567"; "1,2" is a list.
        const bool groupOk = grouped ? sinceComma == 3 : (digits.size() >= 1 && digits.size() <= 3);
        if (t[j] == ',' && groupOk && digitAt(j + 1) && digitAt(j + 2) && digitAt(j + 3) && !digitAt(j + 4)) {
            grouped = true;
            sinceComma = 0;
            ++j;
            continue;
        }
        break;
    }
    std::string words;
    auto rest = [&](size_t k) { *end = k; };

    // A time: 7:30, 07:05, 12:00 (and am/pm after it).
    if (!grouped && digits.size() <= 2 && j + 2 < t.size() + 0 && t[j] == ':' && std::isdigit(static_cast<unsigned char>(t[j + 1]))
        && std::isdigit(static_cast<unsigned char>(t[j + 2])) && (j + 3 >= t.size() || !std::isdigit(static_cast<unsigned char>(t[j + 3])))) {
        const int h = std::stoi(digits), m = (t[j + 1] - '0') * 10 + (t[j + 2] - '0');
        size_t k = j + 3;
        // :ss seconds are not said.
        if (k + 2 < t.size() && t[k] == ':' && std::isdigit(static_cast<unsigned char>(t[k + 1])) && std::isdigit(static_cast<unsigned char>(t[k + 2])))
            k += 3;
        size_t a = k;
        while (a < t.size() && t[a] == ' ')
            ++a;
        std::string ampm;
        for (const char *w : { "a.m.", "p.m.", "am", "pm", "AM", "PM", "A.M.", "P.M." }) {
            if (ampm.empty() && startsWithAt(t, a, w) && !letterAt(t, a + std::strlen(w))) {
                ampm = std::tolower(static_cast<unsigned char>(w[0])) == 'a' ? "A M" : "P M";
                k = a + std::strlen(w);
            }
        }
        words = cardinal(h ? h : 12);
        if (m == 0)
            words += ampm.empty() ? " o'clock" : "";
        else if (m < 10)
            words += std::string(" oh ") + ONES[m];
        else
            words += " " + under100(m);
        if (!ampm.empty())
            words += " " + ampm;
        rest(k);
        return words;
    }
    // A decimal part.
    std::string decimals;
    if (j + 1 < t.size() && t[j] == '.' && std::isdigit(static_cast<unsigned char>(t[j + 1]))) {
        size_t k = j + 1;
        while (k < t.size() && std::isdigit(static_cast<unsigned char>(t[k])))
            decimals += t[k++];
        j = k;
    }
    // An ordinal: 1st, 22nd, 3rd, 4th.
    for (const char *suffix : { "st", "nd", "rd", "th", "ST", "ND", "RD", "TH" }) {
        if (decimals.empty() && startsWithAt(t, j, suffix) && !letterAt(t, j + 2) && digits.size() < 16) {
            rest(j + 2);
            return ordinal(std::stoull(digits));
        }
    }
    // Long runs of digits (phone numbers, codes) one by one; a leading 0 too.
    if (digits.size() > 15 || (!grouped && decimals.empty() && currency.empty()
                               && (digits.size() >= 7 || (digits.size() > 1 && digits[0] == '0')))) {
        rest(j);
        return digitsOneByOne(digits);
    }
    const unsigned long long n = std::stoull(digits);
    const bool yearLike = !grouped && decimals.empty() && currency.empty() && digits.size() == 4
        && ((n >= 1100 && n < 2000) || (n >= 2000 && n < 2100));
    words = yearLike ? year(int(n)) : cardinal(n);
    if (!decimals.empty() && currency.empty())
        words += " point " + digitsOneByOne(decimals);
    size_t k = j;
    if (!currency.empty()) {
        const bool one = n == 1;
        words += " " + (one ? currency : currency + "s");
        if (!decimals.empty()) {
            const int cents = std::stoi((decimals + "0").substr(0, 2));
            if (cents)
                words += " and " + under100(cents) + (cents == 1 ? " cent" : " cents");
        }
    }
    if (k < t.size() && t[k] == '%') {
        words += " percent";
        ++k;
    } else if (startsWithAt(t, k, "°")) {  // °
        k += 2;
        words += n == 1 && decimals.empty() ? " degree" : " degrees";
        if (k < t.size() && (t[k] == 'F' || t[k] == 'C') && !letterAt(t, k + 1)) {
            words += t[k] == 'F' ? " Fahrenheit" : " Celsius";
            ++k;
        }
    } else {
        size_t a = k;
        while (a < t.size() && t[a] == ' ' && a - k < 1)
            ++a;
        for (const char *w : { "a.m.", "p.m.", "am", "pm", "AM", "PM" }) {
            if (decimals.empty() && n >= 1 && n <= 12 && startsWithAt(t, a, w) && !letterAt(t, a + std::strlen(w))) {
                words += std::tolower(static_cast<unsigned char>(w[0])) == 'a' ? " A M" : " P M";
                k = a + std::strlen(w);
                break;
            }
        }
        if (k == j) {
            for (const Unit &u : UNITS) {
                const size_t len = std::strlen(u.abbrev);
                if (startsWithAt(t, a, u.abbrev) && !letterAt(t, a + len) && !(a + len < t.size() && t[a + len] == '/')) {
                    words += std::string(" ") + (n == 1 && decimals.empty() ? u.singular : u.plural);
                    k = a + len;
                    break;
                }
            }
        }
    }
    rest(k);
    return words;
}

// Words that end with a period without ending the sentence.
const std::map<std::string, std::string> &abbreviations()
{
    static const std::map<std::string, std::string> table = {
        { "mr", "mister" }, { "mrs", "missus" }, { "ms", "miz" }, { "dr", "doctor" }, { "st", "saint" },
        { "jr", "junior" }, { "sr", "senior" }, { "vs", "versus" }, { "etc", "et cetera" }, { "approx", "approximately" },
        { "jan", "January" }, { "feb", "February" }, { "mar", "March" }, { "apr", "April" }, { "jun", "June" },
        { "jul", "July" }, { "aug", "August" }, { "sep", "September" }, { "sept", "September" }, { "oct", "October" },
        { "nov", "November" }, { "dec", "December" }, { "mon", "Monday" }, { "tue", "Tuesday" }, { "tues", "Tuesday" },
        { "wed", "Wednesday" }, { "thu", "Thursday" }, { "thurs", "Thursday" }, { "fri", "Friday" },
        { "sat", "Saturday" }, { "sun", "Sunday" }, { "no", "number" }, { "ave", "avenue" }, { "rd", "road" },
        { "blvd", "boulevard" }, { "mt", "mount" }, { "ft", "fort" }, { "inc", "incorporated" }, { "ltd", "limited" },
        { "co", "company" }, { "corp", "corporation" }, { "dept", "department" },
    };
    return table;
}

} // namespace

// ---- Normalization ----------------------------------------------------------------------------

std::string normalizeEnglish(const std::string &input)
{
    // Typography first: curly quotes and apostrophes, dashes, spaces.
    std::string t;
    {
        const std::u32string u = utf8ToU32(input);
        std::u32string v;
        for (size_t i = 0; i < u.size(); ++i) {
            const char32_t c = u[i];
            if (c == U'’' || c == U'‘' || c == U'ʼ')
                v += U'\'';
            else if (c == U'“' || c == U'”' || c == U'„')
                v += U'"';
            else if (c == U'–')  // en dash: a range between numbers, else a pause
                v += (i > 0 && i + 1 < u.size() && u[i - 1] >= U'0' && u[i - 1] <= U'9' && u[i + 1] >= U'0' && u[i + 1] <= U'9')
                    ? U" to " : U", ";
            else if (c == U' ' || c == U'\t' || c == U'\r' || c == U' ' || c == U' ')
                v += U' ';
            else
                v += c;
        }
        t = u32ToUtf8(v);
    }

    std::string out;
    for (size_t i = 0; i < t.size();) {
        const unsigned char c = t[i];
        const bool wordStart = i == 0 || !(std::isalnum(static_cast<unsigned char>(t[i - 1])) || t[i - 1] == '\'');
        // Money: $5, $5.50, €20, £3 (and "$5 million": the scale before the unit).
        if ((c == '$' || startsWithAt(t, i, "€") || startsWithAt(t, i, "£")) ) {
            const size_t sym = c == '$' ? 1 : (startsWithAt(t, i, "€") ? 3 : 2);
            if (i + sym < t.size() && std::isdigit(static_cast<unsigned char>(t[i + sym]))) {
                const std::string unit = c == '$' ? "dollar" : (sym == 3 ? "euro" : "pound");
                size_t end = 0;
                std::string w = numberAt(t, i + sym, &end, unit);
                // "$5 million" -> "five million dollars"
                for (const char *scale : { " million", " billion", " thousand", " trillion" }) {
                    if (startsWithAt(t, end, scale) && !letterAt(t, end + std::strlen(scale))) {
                        const size_t cut = w.find(" " + unit);
                        w = w.substr(0, cut) + scale + " " + unit + "s";
                        end += std::strlen(scale);
                        break;
                    }
                }
                out += w;
                i = end;
                continue;
            }
        }
        // Minus: "-5" at the start of a word.
        if (c == '-' && wordStart && i + 1 < t.size() && std::isdigit(static_cast<unsigned char>(t[i + 1]))
            && (i == 0 || t[i - 1] == ' ' || t[i - 1] == '(')) {
            out += "minus ";
            ++i;
            continue;
        }
        if (std::isdigit(c)) {
            size_t end = 0;
            out += numberAt(t, i, &end, std::string());
            i = end;
            // A range: 5-10 -> five to ten.
            if (i + 1 < t.size() && t[i] == '-' && std::isdigit(static_cast<unsigned char>(t[i + 1]))) {
                out += " to ";
                ++i;
            }
            continue;
        }
        if (std::isalpha(c) && wordStart) {
            size_t j = i;
            while (j < t.size() && (std::isalpha(static_cast<unsigned char>(t[j])) || t[j] == '.'))
                ++j;
            const std::string dotted = t.substr(i, j - i);
            // e.g. / i.e. / a.m. / p.m. / U.S.
            const std::string ld = lower(dotted);
            if (ld == "e.g." || ld == "e.g") { out += "for example"; i = j; continue; }
            if (ld == "i.e." || ld == "i.e") { out += "that is"; i = j; continue; }
            if (ld == "a.m." || ld == "p.m.") { out += ld[0] == 'a' ? "A M" : "P M"; i = j; continue; }
            if (dotted.size() >= 4 && dotted.size() % 2 == 0) {
                bool initials = true;
                for (size_t k = 0; k < dotted.size(); k += 2)
                    initials = initials && std::isalpha(static_cast<unsigned char>(dotted[k])) && dotted[k + 1] == '.';
                if (initials) {  // U.S. -> U S
                    for (size_t k = 0; k < dotted.size(); k += 2)
                        out += std::string(k ? " " : "") + char(std::toupper(static_cast<unsigned char>(dotted[k])));
                    i = j;
                    continue;
                }
            }
            size_t w = i;
            while (w < t.size() && std::isalpha(static_cast<unsigned char>(t[w])))
                ++w;
            const std::string word = t.substr(i, w - i);
            if (w < t.size() && t[w] == '.') {
                const auto it = abbreviations().find(lower(word));
                // A capitalised abbreviation, or one before a number or a capital name.
                if (it != abbreviations().end()) {
                    size_t a = w + 1;
                    while (a < t.size() && t[a] == ' ')
                        ++a;
                    const bool beforeName = a < t.size() && (std::isupper(static_cast<unsigned char>(t[a])) || std::isdigit(static_cast<unsigned char>(t[a])));
                    const bool title = word == "Mr" || word == "Mrs" || word == "Ms" || word == "Dr" || word == "Jr" || word == "Sr"
                        || word == "vs" || word == "etc" || word == "approx";
                    if (word == "St") {  // St. Louis, Main St.
                        out += beforeName ? "saint" : "street";
                        i = beforeName ? w + 1 : w;
                        continue;
                    }
                    if (title || (std::isupper(static_cast<unsigned char>(word[0])) && beforeName)) {
                        // At the end of a sentence the period still ends it.
                        out += it->second;
                        i = beforeName ? w + 1 : w;
                        continue;
                    }
                }
            }
            out += word;
            i = w;
            continue;
        }
        switch (c) {
        case '&': out += " and "; break;
        case '+': out += " plus "; break;
        case '=': out += " equals "; break;
        case '@': out += " at "; break;
        case '#': out += (i + 1 < t.size() && std::isdigit(static_cast<unsigned char>(t[i + 1]))) ? "number " : " "; break;
        case '%': out += " percent "; break;
        case '/': out += " slash "; break;
        case '~': out += " about "; break;
        case '_': case '*': case '<': case '>': case '|': case '\\': case '^': case '`': case '{': case '}':
        case '[': case ']': case '(': case ')':
            out += ' ';
            break;
        default: out += char(c); break;
        }
        ++i;
    }
    // One space at a time.
    std::string squeezed;
    for (char c : out) {
        if (c == ' ' && (squeezed.empty() || squeezed.back() == ' '))
            continue;
        squeezed += c;
    }
    return trim(squeezed);
}

std::vector<std::string> splitSentences(const std::string &text, size_t maxChars)
{
    std::vector<std::string> sentences;
    std::string cur;
    auto flush = [&]() {
        const std::string s = trim(cur);
        if (!s.empty())
            sentences.push_back(s);
        cur.clear();
    };
    for (size_t i = 0; i < text.size(); ++i) {
        const char c = text[i];
        if (c == '\n') {
            flush();
            continue;
        }
        cur += c;
        const bool end = c == '.' || c == '!' || c == '?' || c == ';' || startsWithAt(text, i, "…");
        if (end && (i + 1 >= text.size() || text[i + 1] == ' ' || text[i + 1] == '\n' || text[i + 1] == '"'))  {
            // Closing quotes stay with their sentence.
            while (i + 1 < text.size() && text[i + 1] == '"')
                cur += text[++i];
            flush();
        }
    }
    flush();
    // Long ones at commas (or, failing that, at spaces).
    std::vector<std::string> out;
    for (const std::string &s : sentences) {
        if (s.size() <= maxChars) {
            out.push_back(s);
            continue;
        }
        std::string rest = s;
        while (rest.size() > maxChars) {
            size_t cut = std::string::npos;
            for (size_t k = std::min(rest.size() - 1, maxChars); k > maxChars / 3; --k) {
                if (rest[k] == ',' || rest[k] == ':') {
                    cut = k + 1;
                    break;
                }
            }
            if (cut == std::string::npos)
                cut = rest.rfind(' ', maxChars);
            if (cut == std::string::npos || cut == 0)
                cut = maxChars;
            out.push_back(trim(rest.substr(0, cut)));
            rest = trim(rest.substr(cut));
        }
        if (!rest.empty())
            out.push_back(rest);
    }
    return out;
}

std::vector<Token> tokenize(const std::string &normalized)
{
    // phonemizer's marks that Kitten has symbols for (the rest are spaces).
    static const std::u32string marks = U";:,.!?¡¿—…\"«»";
    std::vector<Token> out;
    std::u32string word;
    auto flush = [&]() {
        // Apostrophes at the edges are quotes, not part of the word.
        while (!word.empty() && word.front() == U'\'')
            word.erase(word.begin());
        while (!word.empty() && word.back() == U'\'')
            word.pop_back();
        if (!word.empty())
            out.push_back({ u32ToUtf8(word), false });
        word.clear();
    };
    for (char32_t c : utf8ToU32(normalized)) {
        const char32_t p = plainLetter(c);
        if ((p < 0x80 && std::isalnum(int(p))) || (c >= 0xC0 && c != U'×' && c != U'÷' && c < 0x250) || c == U'\'') {
            word += c;
        } else if (marks.find(c) != std::u32string::npos) {
            flush();
            out.push_back({ u32ToUtf8(std::u32string(1, c)), true });
        } else {
            flush();  // spaces, hyphens and anything else between words
        }
    }
    flush();
    return out;
}

// ---- The dictionary -----------------------------------------------------------------------------

bool Lexicon::load(const std::string &path, std::string *error)
{
    std::ifstream in(path, std::ios::binary);
    if (!in) {
        if (error)
            *error = "cannot read " + path;
        return false;
    }
    std::string text((std::istreambuf_iterator<char>(in)), std::istreambuf_iterator<char>());
    loadText(std::move(text));
    if (!loaded() && error)
        *error = path + " has no words";
    return loaded();
}

void Lexicon::loadText(std::string text)
{
    m_text = std::move(text);
    if (m_text.empty() || m_text.back() != '\n')
        m_text += '\n';
    index();
}

namespace {
// The word of the entry at offset o: up to the first space.
std::string_view entryWord(const std::string &text, unsigned o)
{
    const size_t sp = text.find(' ', o);
    const size_t nl = text.find('\n', o);
    return std::string_view(text).substr(o, std::min(sp, nl) - o);
}
} // namespace

void Lexicon::index()
{
    m_entries.clear();
    for (size_t o = 0; o < m_text.size();) {
        const size_t nl = m_text.find('\n', o);
        const std::string_view w = entryWord(m_text, unsigned(o));
        // "word(2)": another pronunciation; ";;;" and "#" lines: comments.
        if (!w.empty() && w.back() != ')' && w[0] != ';' && w[0] != '#' && nl > o + w.size())
            m_entries.push_back(unsigned(o));
        o = nl + 1;
    }
    std::stable_sort(m_entries.begin(), m_entries.end(), [this](unsigned a, unsigned b) {
        return entryWord(m_text, a) < entryWord(m_text, b);
    });
}

std::vector<std::string> Lexicon::find(const std::string &lowerWord) const
{
    const auto it = std::lower_bound(m_entries.begin(), m_entries.end(), lowerWord, [this](unsigned o, const std::string &w) {
        return entryWord(m_text, o) < std::string_view(w);
    });
    if (it == m_entries.end() || entryWord(m_text, *it) != lowerWord)
        return {};
    const size_t start = *it + lowerWord.size();
    const size_t nl = m_text.find('\n', start);
    std::string line = m_text.substr(start, nl - start);
    const size_t hash = line.find('#');
    if (hash != std::string::npos)
        line.resize(hash);
    std::vector<std::string> phones;
    std::istringstream ss(line);
    for (std::string p; ss >> p;)
        phones.push_back(p);
    return phones;
}

// ---- ARPAbet to espeak's IPA --------------------------------------------------------------------

namespace {

bool isVowelPhone(const std::string &p)
{
    return !p.empty() && std::strchr("AEIOU", p[0]);
}

struct Phone { std::string base; int stress = -1; };

std::vector<Phone> parsePhones(const std::vector<std::string> &phones)
{
    std::vector<Phone> out;
    for (const std::string &p : phones) {
        Phone ph;
        ph.base = p;
        if (!p.empty() && std::isdigit(static_cast<unsigned char>(p.back()))) {
            ph.stress = p.back() - '0';
            ph.base.pop_back();
        } else if (isVowelPhone(p)) {
            ph.stress = 0;
        }
        out.push_back(ph);
    }
    return out;
}

const std::map<std::string, std::string> &consonantIpa()
{
    static const std::map<std::string, std::string> table = {
        { "B", "b" }, { "CH", "tʃ" }, { "D", "d" }, { "DH", "ð" }, { "F", "f" }, { "G", "ɡ" },
        { "HH", "h" }, { "JH", "dʒ" }, { "K", "k" }, { "L", "l" }, { "M", "m" }, { "N", "n" },
        { "NG", "ŋ" }, { "P", "p" }, { "R", "ɹ" }, { "S", "s" }, { "SH", "ʃ" }, { "T", "t" },
        { "TH", "θ" }, { "V", "v" }, { "W", "w" }, { "Y", "j" }, { "Z", "z" }, { "ZH", "ʒ" },
    };
    return table;
}

} // namespace

namespace {
// The word's vowel letters, a run each ("minutes": i, u, e), lined up
// with its vowel sounds when there are as many (a silent final e left
// out); empty when they do not line up.
std::vector<std::string> vowelLetters(const std::string &spelling, size_t vowels)
{
    std::vector<std::string> groups;
    for (size_t i = 0; i < spelling.size();) {
        const char c = spelling[i];
        const bool v = std::strchr("aeiou", c) || (c == 'y' && i > 0 && !std::strchr("aeiouy", spelling[i - 1]));
        if (!v || !c) {
            ++i;
            continue;
        }
        size_t j = i + 1;
        while (j < spelling.size() && std::strchr("aeiou", spelling[j]) && spelling[j])
            ++j;
        groups.push_back(spelling.substr(i, j - i));
        i = j;
    }
    const size_t n = spelling.size();
    const bool silentE = n > 2 && (spelling[n - 1] == 'e' || ((spelling[n - 1] == 's' || spelling[n - 1] == 'd') && spelling[n - 2] == 'e'));
    if (groups.size() == vowels + 1 && silentE && groups.back() == "e")
        groups.pop_back();
    return groups.size() == vowels ? groups : std::vector<std::string>();
}
} // namespace

std::string arpabetToIpa(const std::vector<std::string> &input, const std::string &spelling)
{
    const std::vector<Phone> ph = parsePhones(input);
    const size_t n = ph.size();
    auto vowel = [&](size_t k) { return k < n && ph[k].stress >= 0; };
    size_t firstVowel = n, lastVowel = n, vowels = 0;
    for (size_t k = 0; k < n; ++k) {
        if (vowel(k)) {
            if (firstVowel == n)
                firstVowel = k;
            lastVowel = k;
            ++vowels;
        }
    }
    const std::vector<std::string> letters = vowelLetters(spelling, vowels);
    size_t vowelIndex = 0;
    bool stressedLater = false, primarySeen = false;
    // "four", "more", "board": espeak's oː before r; "for", "north": ɔː.
    const bool longO = spelling.find("our") != std::string::npos || spelling.find("oar") != std::string::npos
        || spelling.find("ore") != std::string::npos || spelling.find("oor") != std::string::npos;
    std::string out;
    for (size_t k = 0; k < n; ++k) {
        const Phone &p = ph[k];
        if (!vowel(k)) {
            // en-us flap: t between a vowel (or a vowel's r) and an unstressed vowel
            // ("water" wˈɔːɾɚ, "thirty" θˈɜːɾi), as espeak-ng writes it.
            const bool afterVowel = k > 0 && (vowel(k - 1) || (ph[k - 1].base == "R" && k > 1 && vowel(k - 2)));
            if (p.base == "T" && afterVowel && vowel(k + 1) && ph[k + 1].stress == 0) {
                out += "ɾ";
                continue;
            }
            const auto it = consonantIpa().find(p.base);
            out += it == consonantIpa().end() ? std::string() : it->second;
            continue;
        }
        stressedLater = false;
        for (size_t m = k + 1; m < n; ++m)
            stressedLater = stressedLater || (vowel(m) && ph[m].stress == 1);
        const bool beforeR = k + 1 < n && ph[k + 1].base == "R";
        const bool beforeRVowel = beforeR && vowel(k + 2);
        const bool unstressed = p.stress == 0;
        std::string v;
        if (p.base == "AA") v = "ɑː";
        else if (p.base == "AE") v = "æ";
        else if (p.base == "AH") {
            v = unstressed ? (k == 0 && vowels > 1 ? "ɐ" : "ə") : "ʌ";
            // espeak's ɪ for unstressed i and e ("minutes", "services") and
            // -age ("message"); ᵻ in -es after a hiss ("services" sˈɜːvɪsᵻz).
            const std::string letter = vowelIndex < letters.size() ? letters[vowelIndex] : std::string();
            if (unstressed && k > 0) {
                if (k == lastVowel && k + 2 == n && ph[k + 1].base == "Z"
                    && (ph[k - 1].base == "S" || ph[k - 1].base == "Z" || ph[k - 1].base == "SH" || ph[k - 1].base == "ZH"
                        || ph[k - 1].base == "CH" || ph[k - 1].base == "JH"))
                    v = "ᵻ";
                else if ((k + 2 == n && ph[k + 1].base == "JH") || letter == "i"
                         || (letter == "e" && k + 1 < n && ph[k + 1].base != "N" && ph[k + 1].base != "L" && ph[k + 1].base != "R"
                             && ph[k + 1].base != "M"))
                    v = "ɪ";
            }
        }
        else if (p.base == "AO") v = beforeR && longO ? "oː" : (k + 1 < n && (ph[k + 1].base == "F" || ph[k + 1].base == "N" || ph[k + 1].base == "TH")) ? "ɔ" : "ɔː";
        else if (p.base == "AW") v = "aʊ";
        else if (p.base == "AY") v = "aɪ";
        else if (p.base == "EH") v = "ɛ";
        else if (p.base == "ER") v = unstressed ? "ɚ" : "ɜː";
        else if (p.base == "EY") v = beforeR ? "ɛ" : "eɪ";
        else if (p.base == "IH") {
            v = beforeRVowel && !unstressed ? "iə" : "ɪ";
            if (unstressed) {
                // espeak's reduced i: -ed and -es endings ("wanted", "boxes"),
                // and de-, re-, be-, pre- before the stress ("decide", "return").
                const bool ending = k == lastVowel && k + 2 == n && (ph[k + 1].base == "D" || ph[k + 1].base == "Z")
                    && k > 0 && std::strchr("TDSZ", ph[k - 1].base[0]) && ph[k - 1].base != "TH" && ph[k - 1].base != "DH";
                const bool prefix = k == firstVowel && k >= 1 && k <= 2 && stressedLater && vowels > 1;
                if (ending || prefix)
                    v = "ᵻ";
            }
        }
        else if (p.base == "IY") v = beforeRVowel ? "iə" : beforeR ? "ɪ" : (unstressed ? "i" : "iː");
        else if (p.base == "OW") v = "oʊ";
        else if (p.base == "OY") v = "ɔɪ";
        else if (p.base == "UH") v = "ʊ";
        else if (p.base == "UW") v = beforeR ? "ʊ" : "uː";
        // espeak marks secondary stress before the primary one only
        // ("notification" nˌoʊɾɪfɪkˈeɪʃən, but "keyboard" kˈiːboːɹd).
        if (p.stress == 1)
            out += "ˈ";
        else if (p.stress == 2 && !primarySeen)
            out += "ˌ";
        primarySeen = primarySeen || p.stress == 1;
        ++vowelIndex;
        out += v;
    }
    return out;
}

// ---- Letter to sound ---------------------------------------------------------------------------

std::vector<std::string> letterToSound(const std::string &input)
{
    std::string w;
    for (char32_t c : utf8ToU32(input)) {
        const char32_t p = plainLetter(c);
        if (p < 0x80 && std::isalpha(int(p)))
            w += char(std::tolower(int(p)));
    }
    std::vector<std::string> out;
    const size_t n = w.size();
    auto at = [&](size_t k) -> char { return k < n ? w[k] : '\0'; };
    auto isV = [](char c) { return c && std::strchr("aeiouy", c); };
    auto isC = [&](char c) { return c && !isV(c); };
    // A silent final e (and the long vowel before it: "late", "theme", "line").
    const bool silentE = n > 2 && w[n - 1] == 'e' && !isV(w[n - 2]) && isV(w[n - 3]) && w[n - 2] != 'r';
    auto add = [&](std::initializer_list<const char *> ps) { for (const char *p : ps) out.push_back(p); };
    for (size_t i = 0; i < n;) {
        const char c = w[i];
        auto is = [&](const char *s) { return w.compare(i, std::strlen(s), s) == 0; };
        // Silent final e
        if (c == 'e' && i == n - 1 && n > 2 && !out.empty()) { ++i; continue; }
        if (is("tion")) { add({ "SH", "AH0", "N" }); i += 4; continue; }
        if (is("sion")) { add({ isV(at(i - 1)) ? "ZH" : "SH", "AH0", "N" }); i += 4; continue; }
        if (is("ture")) { add({ "CH", "ER0" }); i += 4; continue; }
        if (is("eigh")) { add({ "EY1" }); i += 4; continue; }
        if (is("augh") || is("ough")) { add({ "AO1" }); i += 4; continue; }
        if (is("igh")) { add({ "AY1" }); i += 3; continue; }
        if (is("tch")) { add({ "CH" }); i += 3; continue; }
        if (is("sch")) { add({ "SH" }); i += 3; continue; }
        if (is("ch")) { add({ "CH" }); i += 2; continue; }
        if (is("sh")) { add({ "SH" }); i += 2; continue; }
        if (is("th")) { add({ "TH" }); i += 2; continue; }
        if (is("ph")) { add({ "F" }); i += 2; continue; }
        if (is("wh")) { add({ "W" }); i += 2; continue; }
        if (is("ck")) { add({ "K" }); i += 2; continue; }
        if (is("ng")) { add({ "NG" }); i += 2; continue; }
        if (is("nk")) { add({ "NG", "K" }); i += 2; continue; }
        if (is("qu")) { add({ "K", "W" }); i += 2; continue; }
        if (is("gh")) { if (i == 0) add({ "G" }); i += 2; continue; }
        if (i == 0 && (is("kn") || is("gn"))) { add({ "N" }); i += 2; continue; }
        if (i == 0 && is("wr")) { add({ "R" }); i += 2; continue; }
        if (i == 0 && is("ps")) { add({ "S" }); i += 2; continue; }
        if (is("ee") || is("ea")) { add({ "IY1" }); i += 2; continue; }
        if (is("oo")) { add({ "UW1" }); i += 2; continue; }
        if (is("ou")) { add({ "AW1" }); i += 2; continue; }
        if (is("ow")) { add({ i + 2 >= n ? "OW1" : "AW1" }); i += 2; continue; }
        if (is("oi") || is("oy")) { add({ "OY1" }); i += 2; continue; }
        if (is("ai") || is("ay")) { add({ "EY1" }); i += 2; continue; }
        if (is("au") || is("aw")) { add({ "AO1" }); i += 2; continue; }
        if (is("ey") && i + 2 >= n) { add({ "IY0" }); i += 2; continue; }
        if (is("ei") || is("ey")) { add({ "EY1" }); i += 2; continue; }
        if (is("ie")) { add({ i + 2 >= n && n <= 4 ? "AY1" : "IY1" }); i += 2; continue; }
        if (is("ue") || is("ew")) { add({ "UW1" }); i += 2; continue; }
        if (is("oa") || (is("oe") && i + 2 >= n)) { add({ "OW1" }); i += 2; continue; }
        if (is("ar") && !isV(at(i + 2))) { add({ "AA1", "R" }); i += 2; continue; }
        if ((is("er") || is("ir") || is("ur")) && !isV(at(i + 2))) { add({ "ER1" }); i += 2; continue; }
        if (is("or") && !isV(at(i + 2))) { add({ "AO1", "R" }); i += 2; continue; }
        // Doubled consonants are one.
        if (isC(c) && at(i + 1) == c) { ++i; continue; }
        if (isV(c)) {
            // A long vowel before consonant + silent e; a final vowel.
            const bool longV = silentE && i == n - 3;
            const bool final = i == n - 1;
            switch (c) {
            case 'a': add({ longV ? "EY1" : final ? "AH0" : "AE1" }); break;
            case 'e': add({ longV ? "IY1" : final ? "IY0" : "EH1" }); break;
            case 'i': add({ longV ? "AY1" : final ? "IY0" : "IH1" }); break;
            case 'o': add({ longV || final ? "OW1" : "AA1" }); break;
            case 'u': add({ longV ? "UW1" : "AH1" }); break;
            case 'y':
                if (i == 0)
                    add({ "Y" });
                else
                    add({ final ? (out.size() <= 2 ? "AY1" : "IY0") : "IH1" });
                break;
            }
            ++i;
            continue;
        }
        switch (c) {
        case 'c': add({ std::strchr("eiy", at(i + 1)) && at(i + 1) ? "S" : "K" }); break;
        case 'g': add({ std::strchr("eiy", at(i + 1)) && at(i + 1) && i + 2 < n ? "JH" : "G" }); break;
        case 'x': add(i == 0 ? std::initializer_list<const char *>{ "Z" } : std::initializer_list<const char *>{ "K", "S" }); break;
        case 'j': add({ "JH" }); break;
        case 'q': add({ "K" }); break;
        case 's': add({ (i == n - 1 && i > 0 && !std::strchr("ptkf", w[i - 1])) || (isV(at(i - 1)) && isV(at(i + 1)) && i > 0) ? "Z" : "S" }); break;
        case 'h': add({ "HH" }); break;
        case 'b': add({ "B" }); break; case 'd': add({ "D" }); break; case 'f': add({ "F" }); break;
        case 'k': add({ "K" }); break; case 'l': add({ "L" }); break; case 'm': add({ "M" }); break;
        case 'n': add({ "N" }); break; case 'p': add({ "P" }); break; case 'r': add({ "R" }); break;
        case 't': add({ "T" }); break; case 'v': add({ "V" }); break; case 'w': add({ "W" }); break;
        case 'z': add({ "Z" }); break;
        default: break;
        }
        ++i;
    }
    // One stress: the first syllable of short words, the antepenult of
    // long ones; the other short vowels reduced.
    std::vector<size_t> vs;
    for (size_t k = 0; k < out.size(); ++k)
        if (isVowelPhone(out[k]))
            vs.push_back(k);
    const size_t stressed = vs.size() >= 4 ? vs[vs.size() - 3] : (vs.empty() ? 0 : vs[0]);
    for (size_t k : vs) {
        std::string base = out[k].substr(0, out[k].size() - 1);
        if (k == stressed) {
            out[k] = base + "1";
        } else {
            if (base == "AE" || base == "EH" || base == "AA" || base == "AH" || base == "AO" || base == "UH")
                base = "AH";
            out[k] = base + "0";
        }
    }
    return out;
}

// ---- The phonemizer ----------------------------------------------------------------------------

namespace {

// Small words as espeak-ng says them in a sentence: unstressed and reduced
// ("a" ɐ, "the" ðə, "to" tə), where the dictionary has them stressed.
const std::map<std::string, std::string> &functionWords()
{
    static const std::map<std::string, std::string> table = {
        { "a", "ɐ" }, { "an", "ɐn" }, { "the", "ðə" }, { "and", "ænd" }, { "or", "ɔːɹ" },
        { "but", "bˌʌt" }, { "of", "ʌv" }, { "to", "tə" }, { "in", "ɪn" }, { "on", "ˌɔn" },
        { "at", "æt" }, { "for", "fɔːɹ" }, { "with", "wɪð" }, { "from", "fɹʌm" },
        { "by", "baɪ" }, { "as", "æz" }, { "is", "ɪz" }, { "are", "ɑːɹ" }, { "was", "wʌz" },
        { "were", "wɜː" }, { "be", "biː" }, { "been", "bɪn" }, { "am", "æm" }, { "i", "aɪ" },
        { "you", "juː" }, { "he", "hiː" }, { "she", "ʃiː" }, { "it", "ɪt" }, { "we", "wiː" },
        { "they", "ðeɪ" }, { "me", "mˌiː" }, { "him", "hɪm" }, { "her", "hɜː" },
        { "us", "ʌs" }, { "them", "ðɛm" }, { "my", "maɪ" }, { "your", "jʊɹ" },
        { "his", "hɪz" }, { "its", "ɪts" }, { "our", "aʊɚ" }, { "their", "ðɛɹ" },
        { "that", "ðæt" }, { "this", "ðɪs" }, { "there", "ðɛɹ" }, { "can", "kæn" },
        { "will", "wɪl" }, { "would", "wʊd" }, { "could", "kʊd" },
        { "has", "hɐz" }, { "have", "hæv" }, { "had", "hɐd" }, { "does", "dʌz" }, { "if", "ɪf" },
        { "so", "sˌoʊ" }, { "than", "ðɐn" }, { "then", "ðɛn" }, { "do", "dˈuː" },
        { "into", "ˌɪntʊ" }, { "which", "wˌɪtʃ" }, { "not", "nˌɑːt" },
        { "where", "wˌɛɹ" }, { "while", "wˌaɪl" }, { "when", "wˌɛn" },
        { "how", "hˌaʊ" }, { "who", "hˌuː" }, { "what", "wʌt" }, { "up", "ˌʌp" },
        { "any", "ˌɛni" }, { "through", "θɹuː" }, { "get", "ɡɛt" }, { "per", "pɜː" },
        { "i'll", "aɪl" }, { "i've", "aɪv" }, { "i'm", "aɪm" }, { "i'd", "aɪd" }, { "it's", "ɪts" },
        { "that's", "ðæts" }, { "there's", "ðɛɹz" }, { "you're", "jʊɹ" },
        { "we're", "wɪɹ" }, { "they're", "ðɛɹ" }, { "those", "ðoʊz" },
        { "ok", "ˌoʊkˈeɪ" }, { "okay", "ˌoʊkˈeɪ" }, { "should", "ʃˌʊd" }, { "onto", "ˌɑːntʊ" }, { "about", "ɐbˈaʊt" },
    };
    return table;
}

const char *const LETTERS[26] = {
    "eɪ", "biː", "siː", "diː", "iː", "ɛf", "dʒiː", "eɪtʃ",
    "aɪ", "dʒeɪ", "keɪ", "ɛl", "ɛm", "ɛn", "oʊ", "piː", "kjuː",
    "ɑːɹ", "ɛs", "tiː", "juː", "viː", "dˈʌbəljuː", "ɛks",
    "waɪ", "ziː",
};

// A word spelled out: each letter's name, the last one stressed (U S B -> jˌuːˌɛsbˈiː).
std::string spell(const std::string &word)
{
    std::string out;
    std::vector<int> letters;
    for (char c : word)
        if (std::isalpha(static_cast<unsigned char>(c)))
            letters.push_back(std::tolower(static_cast<unsigned char>(c)) - 'a');
    for (size_t k = 0; k < letters.size(); ++k) {
        const std::string name = LETTERS[letters[k]];
        if (name.find("ˈ") != std::string::npos) {
            out += name;
            continue;
        }
        // The stress mark before the name's vowel.
        static const std::u32string vowels = U"aeiou\u0251\u025B\u026A\u028A\u028C\u0259\u025C\u00E6\u0254";
        const std::u32string u = utf8ToU32(name);
        size_t v = 0;
        while (v < u.size() && vowels.find(u[v]) == std::u32string::npos)
            ++v;
        const std::string mark = k + 1 == letters.size() ? "ˈ" : "ˌ";
        out += u32ToUtf8(u.substr(0, v)) + mark + u32ToUtf8(u.substr(v));
    }
    return out;
}

// Runs a program with text on its input; its output.
bool runProgram(const std::vector<std::string> &argv, const std::string &input, std::string *output, std::string *error)
{
    int in[2], out[2];
    if (pipe(in) != 0)
        return false;
    if (pipe(out) != 0) {
        close(in[0]);
        close(in[1]);
        return false;
    }
    posix_spawn_file_actions_t fa;
    posix_spawn_file_actions_init(&fa);
    posix_spawn_file_actions_adddup2(&fa, in[0], 0);
    posix_spawn_file_actions_adddup2(&fa, out[1], 1);
    posix_spawn_file_actions_addclose(&fa, in[1]);
    posix_spawn_file_actions_addclose(&fa, out[0]);
    posix_spawn_file_actions_addopen(&fa, 2, "/dev/null", O_WRONLY, 0);
    std::vector<char *> args;
    for (const std::string &a : argv)
        args.push_back(const_cast<char *>(a.c_str()));
    args.push_back(nullptr);
    pid_t pid = 0;
    const int rc = posix_spawn(&pid, args[0], &fa, nullptr, args.data(), environ);
    posix_spawn_file_actions_destroy(&fa);
    close(in[0]);
    close(out[1]);
    if (rc != 0) {
        close(in[1]);
        close(out[0]);
        if (error)
            *error = "cannot run " + argv[0] + ": " + std::strerror(rc);
        return false;
    }
    // Small texts: all of it in, then all of the answer out.
    signal(SIGPIPE, SIG_IGN);
    for (size_t done = 0; done < input.size();) {
        const ssize_t k = write(in[1], input.data() + done, input.size() - done);
        if (k <= 0)
            break;
        done += size_t(k);
    }
    close(in[1]);
    char buf[4096];
    for (ssize_t k; (k = read(out[0], buf, sizeof buf)) > 0;)
        output->append(buf, size_t(k));
    close(out[0]);
    int status = 0;
    waitpid(pid, &status, 0);
    if (!WIFEXITED(status) || WEXITSTATUS(status) != 0) {
        if (error)
            *error = argv[0] + " failed";
        return false;
    }
    return true;
}

} // namespace

Phonemizer::Phonemizer(const Lexicon *lexicon, std::string espeak)
    : m_lexicon(lexicon)
    , m_espeak(std::move(espeak))
{
}

std::string Phonemizer::word(const std::string &original) const
{
    std::string w;
    for (char32_t c : utf8ToU32(original)) {
        const char32_t p = plainLetter(c);
        if (p < 0x80)
            w += char(p);
    }
    if (w.empty())
        return std::string();
    const std::string lw = lower(w);
    // Digits left over (normalizeEnglish says numbers): one by one.
    if (std::all_of(w.begin(), w.end(), [](char c) { return std::isdigit(static_cast<unsigned char>(c)); })) {
        std::string s;
        for (char c : w)
            s += (s.empty() ? "" : " ") + word(ONES[c - '0']);
        return s;
    }
    if (w.size() == 1 && lw != "a" && lw != "i")
        return spell(w);
    const auto fw = functionWords().find(lw);
    if (fw != functionWords().end())
        return fw->second;
    std::vector<std::string> ph = m_lexicon ? m_lexicon->find(lw) : std::vector<std::string>();
    // Capitals the dictionary lacks: letters (USB, NFC).
    if (ph.empty() && isUpperWord(w) && w.size() <= 5)
        return spell(w);
    auto look = [&](const std::string &s) { return m_lexicon && !s.empty() ? m_lexicon->find(s) : std::vector<std::string>(); };
    auto endsWith = [&](const char *s) { const size_t k = std::strlen(s); return lw.size() > k + 2 && lw.compare(lw.size() - k, k, s) == 0; };
    auto last = [](const std::vector<std::string> &p) { return p.empty() ? std::string() : p.back(); };
    if (ph.empty() && endsWith("'s")) {
        ph = look(lw.substr(0, lw.size() - 2));
        if (!ph.empty()) {
            const std::string e = last(ph);
            if (e == "S" || e == "Z" || e == "SH" || e == "ZH" || e == "CH" || e == "JH")
                ph.insert(ph.end(), { "IH0", "Z" });
            else
                ph.push_back(e == "P" || e == "T" || e == "K" || e == "F" || e == "TH" ? "S" : "Z");
        }
    }
    // Endings on a word the dictionary has.
    struct Ending { const char *spelling; const char *strip; std::vector<std::string> phones; };
    static const std::vector<Ending> endings = {
        { "ing", "", { "IH0", "NG" } }, { "ing", "e", { "IH0", "NG" } }, { "ed", "", { "D" } }, { "ed", "e", { "D" } },
        { "s", "", { "Z" } }, { "es", "", { "IH0", "Z" } }, { "er", "", { "ER0" } }, { "ers", "", { "ER0", "Z" } },
        { "ly", "", { "L", "IY0" } }, { "ness", "", { "N", "AH0", "S" } }, { "ful", "", { "F", "AH0", "L" } },
        { "less", "", { "L", "AH0", "S" } }, { "able", "", { "AH0", "B", "AH0", "L" } },
    };
    for (const Ending &e : endings) {
        if (!ph.empty() || !endsWith(e.spelling))
            continue;
        const std::string stem = lw.substr(0, lw.size() - std::strlen(e.spelling)) + e.strip;
        std::vector<std::string> base = look(stem);
        if (base.empty())
            continue;
        ph = base;
        std::vector<std::string> add = e.phones;
        const std::string end = last(base);
        if (std::string(e.spelling) == "s" && (end == "P" || end == "T" || end == "K" || end == "F" || end == "TH"))
            add = { "S" };
        if (std::string(e.spelling) == "ed") {
            if (end == "T" || end == "D")
                add = { "IH0", "D" };
            else if (end == "P" || end == "K" || end == "F" || end == "S" || end == "SH" || end == "CH" || end == "TH")
                add = { "T" };
        }
        ph.insert(ph.end(), add.begin(), add.end());
    }
    // Two words the dictionary has, run together ("homescreen").
    for (size_t cut = 3; ph.empty() && cut + 3 <= lw.size(); ++cut) {
        std::vector<std::string> a = look(lw.substr(0, cut)), b = look(lw.substr(cut));
        if (a.empty() || b.empty())
            continue;
        for (std::string &p : b)
            if (!p.empty() && p.back() == '1')
                p.back() = '2';
        ph = a;
        ph.insert(ph.end(), b.begin(), b.end());
    }
    if (ph.empty())
        ph = letterToSound(lw);
    return arpabetToIpa(ph, lw);
}

std::string Phonemizer::espeakRun(const std::string &text, std::string *error) const
{
    std::string out;
    if (!runProgram({ m_espeak, "-q", "--ipa", "-v", "en-us" }, text, &out, error))
        return std::string();
    // Lines are clauses; "(fr)...(en)" language switches are dropped, as
    // phonemizer does.
    std::string joined;
    bool paren = false;
    for (char c : out) {
        if (c == '(') { paren = true; continue; }
        if (c == ')') { paren = false; continue; }
        if (paren)
            continue;
        joined += (c == '\n' || c == '\r' || c == '_') ? ' ' : c;
    }
    std::string squeezed;
    for (char c : joined) {
        if (c == ' ' && (squeezed.empty() || squeezed.back() == ' '))
            continue;
        squeezed += c;
    }
    return trim(squeezed);
}

std::string Phonemizer::phonemize(const std::string &normalized, std::string *error) const
{
    const std::vector<Token> tokens = tokenize(normalized);
    std::vector<std::string> parts;
    std::string run;  // words up to the next mark (espeak-ng reads them together)
    auto flushRun = [&]() {
        if (run.empty())
            return;
        const std::string ipa = espeakRun(run, error);
        if (!ipa.empty())
            parts.push_back(ipa);
        run.clear();
    };
    for (const Token &t : tokens) {
        if (t.mark) {
            flushRun();
            parts.push_back(t.text);
        } else if (!m_espeak.empty()) {
            run += (run.empty() ? "" : " ") + t.text;
        } else {
            const std::string ipa = word(t.text);
            if (!ipa.empty())
                parts.push_back(m_espeak.empty() ? "\x01" + lower(t.text) + "\x01" + ipa : ipa);
        }
    }
    flushRun();
    // Words said differently by what follows, as espeak-ng does: "the" and
    // "to" before a vowel (ðɪ, tʊ; "to" last, tuː), a final t before one
    // flapped ("it is" ɪɾ ɪz).
    static const std::u32string vowelSounds = U"aeiouæɐɑɒɔəɚɛɜɪʊʌᵻ";
    auto startsWithVowel = [&](const std::string &ipa) {
        std::u32string u = utf8ToU32(ipa);
        while (!u.empty() && (u[0] == U'ˈ' || u[0] == U'ˌ'))
            u.erase(u.begin());
        return !u.empty() && vowelSounds.find(u[0]) != std::u32string::npos;
    };
    for (size_t k = 0; k < parts.size(); ++k) {
        if (parts[k].empty() || parts[k][0] != '\x01')
            continue;
        const size_t sep = parts[k].find('\x01', 1);
        const std::string spelling = parts[k].substr(1, sep - 1);
        std::string ipa = parts[k].substr(sep + 1);
        const std::string next = k + 1 < parts.size() ? parts[k + 1] : std::string();
        const bool nextWord = !next.empty() && next[0] == '\x01';
        const std::string nextIpa = nextWord ? next.substr(next.find('\x01', 1) + 1) : std::string();
        if (spelling == "the" && nextWord && startsWithVowel(nextIpa))
            ipa = "ðɪ";
        else if (spelling == "to")
            ipa = !nextWord ? "tuː" : startsWithVowel(nextIpa) ? "tʊ" : "tə";
        else if (nextWord && startsWithVowel(nextIpa) && ipa.size() > 1 && ipa.back() == 't'
                 && (spelling == "it" || spelling == "at" || spelling == "what" || spelling == "get" || spelling == "let"
                     || spelling == "lot" || spelling == "got" || spelling == "put" || spelling == "bit")) {
            const std::u32string u = utf8ToU32(ipa);
            if (u.size() >= 2 && vowelSounds.find(u[u.size() - 2]) != std::u32string::npos)
                ipa = u32ToUtf8(u.substr(0, u.size() - 1)) + "ɾ";
        }
        parts[k] = ipa;
    }
    std::string out;
    for (const std::string &p : parts)
        out += (out.empty() ? "" : " ") + p;
    return out;
}

// ---- Kitten's symbols ----------------------------------------------------------------------------

std::vector<long long> kittenIds(const std::string &phonemes)
{
    // KittenML's TextCleaner: pad, punctuation, letters, IPA, numbered in
    // this order (a symbol listed twice gets its later number, as the
    // Python dict there does).
    static const std::map<char32_t, long long> table = [] {
        const std::u32string symbols = std::u32string(U"$") + U";:,.!?¡¿—…\"«»\"\" "
            + U"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
            + U"ɑɐɒæɓʙβɔɕçɗɖðʤəɘɚɛ"
              U"ɜɝɞɟʄɡɠɢʛɦɧħɥʜɨɪʝɭ"
              U"ɬɫɮʟɱɯɰŋɳɲɴøɵɸθœɶʘ"
              U"ɹɺɾɻʀʁɽʂʃʈʧʉʊʋⱱʌɣɤ"
              U"ʍχʎʏʑʐʒʔʡʕʢǀǁǂǃˈˌː"
              U"ˑʼʴʰʱʲʷˠˤ˞↓↑→↗↘'̩'ᵻ";
        std::map<char32_t, long long> t;
        for (size_t i = 0; i < symbols.size(); ++i)
            t[symbols[i]] = (long long)i;
        return t;
    }();
    std::vector<long long> ids;
    for (char32_t c : utf8ToU32(phonemes)) {
        const auto it = table.find(c);
        if (it != table.end())
            ids.push_back(it->second);
    }
    return ids;
}

} // namespace phoenix::tts
